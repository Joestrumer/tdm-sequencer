/**
 * maps.js — Routes pour la prospection via Google Maps / Places
 */

const { Router } = require('express');
const { getApiKey } = require('../services/googlePlacesService');
const { analyzeWebsite } = require('../services/websiteAnalyzer');
const { findEmail } = require('../services/mapsEmailFinder');
const { v4: uuidv4 } = require('uuid');

module.exports = (db) => {
  const router = Router();

  // ─── In-memory batch jobs ──────────────────────────────────────────────────
  const batchJobs = new Map();

  // Cleanup jobs > 30min
  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of batchJobs) {
      if (now - job.startedAt > 30 * 60 * 1000) batchJobs.delete(id);
    }
  }, 5 * 60 * 1000);

  // ─── Helpers Places API ─────────────────────────────────────────────────

  const FIELD_MASK = [
    'places.id', 'places.displayName', 'places.formattedAddress',
    'places.internationalPhoneNumber', 'places.websiteUri',
    'places.rating', 'places.userRatingCount', 'places.types',
    'places.googleMapsUri', 'places.businessStatus',
  ].join(',');

  const TYPE_MAPPING = {
    restaurant: 'Restaurant', hotel: 'Hôtel', lodging: 'Hébergement', spa: 'Spa',
    beauty_salon: 'Salon de beauté', hair_care: 'Coiffure', gym: 'Salle de sport',
    dentist: 'Dentiste', doctor: 'Médecin', lawyer: 'Avocat', accounting: 'Comptabilité',
    real_estate_agency: 'Immobilier', store: 'Commerce', cafe: 'Café', bar: 'Bar',
    bakery: 'Boulangerie', car_dealer: 'Concessionnaire', car_repair: 'Garage auto',
    pharmacy: 'Pharmacie', florist: 'Fleuriste', travel_agency: 'Agence de voyage',
  };

  function parsePlaces(rawPlaces) {
    return (rawPlaces || []).map(place => {
      const addressParts = (place.formattedAddress || '').split(',').map(s => s.trim());
      const extractedCity = addressParts.length >= 2 ? addressParts[addressParts.length - 2] : '';
      const extractedCountry = addressParts.length >= 1 ? addressParts[addressParts.length - 1] : '';
      const types = place.types || [];
      const category = types.map(t => TYPE_MAPPING[t]).find(Boolean) || types[0] || '';

      return {
        place_id: place.id,
        name: place.displayName?.text || 'Inconnu',
        category,
        address: place.formattedAddress || '',
        city: extractedCity,
        country: extractedCountry,
        phone: place.internationalPhoneNumber || null,
        website: place.websiteUri || null,
        rating: place.rating || null,
        reviews_count: place.userRatingCount || 0,
        maps_url: place.googleMapsUri || null,
        business_status: place.businessStatus || 'OPERATIONAL',
      };
    });
  }

  // ─── Compteur d'utilisation API ─────────────────────────────────────────
  function incrementApiUsage() {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    try {
      // Total
      const existing = db.prepare("SELECT valeur FROM config WHERE cle = 'maps_api_calls_total'").get();
      if (existing) {
        db.prepare("UPDATE config SET valeur = ? WHERE cle = 'maps_api_calls_total'").run(String(parseInt(existing.valeur || '0') + 1));
      } else {
        db.prepare("INSERT INTO config (cle, valeur) VALUES ('maps_api_calls_total', '1')").run();
      }
      // Par mois
      const monthKey = `maps_api_calls_${month}`;
      const monthRow = db.prepare("SELECT valeur FROM config WHERE cle = ?").get(monthKey);
      if (monthRow) {
        db.prepare("UPDATE config SET valeur = ? WHERE cle = ?").run(String(parseInt(monthRow.valeur || '0') + 1), monthKey);
      } else {
        db.prepare("INSERT INTO config (cle, valeur) VALUES (?, '1')").run(monthKey);
      }
    } catch (e) {
      console.warn('Erreur compteur API Maps:', e.message);
    }
  }

  async function doTextSearch(apiKey, textQuery) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const apiRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({ textQuery, languageCode: 'fr', pageSize: 20 }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      incrementApiUsage();
      if (!apiRes.ok) return [];
      const data = await apiRes.json();
      return parsePlaces(data.places);
    } catch {
      clearTimeout(timeout);
      return [];
    }
  }

  // ─── POST /search — Google Places multi-requêtes + déduplication ──────
  router.post('/search', async (req, res) => {
    try {
      const { query, category, city, country } = req.body;

      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: 'Clé API Google Places non configurée' });

      const baseQuery = [category, city, country].filter(Boolean).join(' ') || query;
      if (!baseQuery) return res.status(400).json({ error: 'Requête vide' });

      // Stratégie multi-requêtes : Google Places (New) renvoie max 20 résultats
      // par requête sans pagination fiable. On lance plusieurs requêtes avec
      // des variantes (synonymes, proximité) et on déduplique par place_id.
      const queries = [baseQuery];
      if (category && city) {
        // Synonymes courants par catégorie
        const synonyms = {
          'coiffeur': ['salon de coiffure', 'coiffure', 'barbier', 'hair salon'],
          'restaurant': ['brasserie', 'bistrot', 'traiteur'],
          'boulangerie': ['pâtisserie', 'boulangerie pâtisserie'],
          'garage': ['garage auto', 'réparation automobile', 'carrosserie'],
          'dentiste': ['cabinet dentaire', 'chirurgien dentiste'],
          'médecin': ['cabinet médical', 'docteur', 'médecin généraliste'],
          'avocat': ['cabinet avocat', 'avocat droit'],
          'spa': ['institut de beauté', 'centre de bien-être', 'esthéticienne'],
          'fleuriste': ['boutique fleurs', 'compositions florales'],
          'pharmacie': ['parapharmacie'],
          'immobilier': ['agence immobilière', 'agent immobilier'],
          'comptable': ['expert comptable', 'cabinet comptable'],
        };
        const catLower = category.toLowerCase();
        const syns = synonyms[catLower] || [];

        // Variantes avec synonymes
        for (const syn of syns.slice(0, 2)) {
          queries.push(`${syn} ${city}`);
        }

        // Variantes géographiques (alentours)
        queries.push(`${category} à ${city}`);
        queries.push(`${category} près de ${city}`);
        queries.push(`tous les ${category}s ${city}`);
      }

      // Lancer toutes les requêtes en parallèle
      const batches = await Promise.all(queries.map(q => doTextSearch(apiKey, q)));

      // Dédupliquer par place_id
      const seen = new Set();
      const allPlaces = [];
      for (const batch of batches) {
        for (const place of batch) {
          if (!seen.has(place.place_id)) {
            seen.add(place.place_id);
            allPlaces.push(place);
          }
        }
      }

      console.log(`[Maps Search] "${baseQuery}" → ${queries.length} requêtes, ${allPlaces.length} résultats uniques`);

      res.json({ places: allPlaces, total: allPlaces.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET /prospects — Liste paginée avec filtres ──────────────────────────
  router.get('/prospects', (req, res) => {
    try {
      const { status, city, country, category, has_email, is_old, business_status, search, limit = 50, offset = 0 } = req.query;

      let where = [];
      let params = [];

      if (status) { where.push('status = ?'); params.push(status); }
      if (category) { where.push('category = ?'); params.push(category); }
      if (city) { where.push('city LIKE ?'); params.push(`%${city}%`); }
      if (country) { where.push('country LIKE ?'); params.push(`%${country}%`); }
      if (has_email === 'true') { where.push('email IS NOT NULL AND email != \'\''); }
      if (has_email === 'false') { where.push('(email IS NULL OR email = \'\')'); }
      if (is_old === 'true') { where.push('website_is_old = 1'); }
      if (is_old === 'false') { where.push('website_is_old = 0'); }
      if (business_status) { where.push('business_status = ?'); params.push(business_status); }
      if (search) {
        where.push('(name LIKE ? OR address LIKE ? OR email LIKE ? OR city LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }

      const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

      const total = db.prepare(`SELECT COUNT(*) as n FROM maps_prospects ${whereClause}`).get(...params).n;

      const prospects = db.prepare(`
        SELECT * FROM maps_prospects ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, parseInt(limit), parseInt(offset));

      // Stats globales
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN email IS NOT NULL AND email != '' THEN 1 ELSE 0 END) as with_email,
          SUM(CASE WHEN website IS NULL OR website = '' THEN 1 ELSE 0 END) as no_website,
          SUM(CASE WHEN website_is_old = 1 THEN 1 ELSE 0 END) as old_website,
          SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted,
          SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
          SUM(CASE WHEN status = 'enriched' THEN 1 ELSE 0 END) as enriched_count,
          SUM(CASE WHEN business_status = 'CLOSED_TEMPORARILY' THEN 1 ELSE 0 END) as closed_temporarily
        FROM maps_prospects
      `).get();

      // Liste des catégories distinctes
      const categories = db.prepare('SELECT DISTINCT category FROM maps_prospects WHERE category IS NOT NULL AND category != \'\' ORDER BY category').all().map(r => r.category);

      res.json({ prospects, total, stats, categories });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── PATCH /prospects/:id — Mise à jour manuelle ──────────────────────────
  router.patch('/prospects/:id', (req, res) => {
    try {
      const { id } = req.params;
      const allowed = ['name', 'category', 'address', 'city', 'country', 'phone', 'website',
        'email', 'email_source', 'email_confidence', 'instagram', 'facebook', 'linkedin',
        'notes', 'status'];
      const updates = [];
      const params = [];

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          updates.push(`${key} = ?`);
          params.push(req.body[key]);
        }
      }

      if (updates.length === 0) return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });

      updates.push("updated_at = datetime('now')");
      params.push(id);

      db.prepare(`UPDATE maps_prospects SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      const prospect = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
      res.json(prospect);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── DELETE /prospects/:id — Suppression ──────────────────────────────────
  router.delete('/prospects/:id', (req, res) => {
    try {
      const { id } = req.params;
      db.prepare('DELETE FROM maps_prospects WHERE id = ?').run(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST /prospects/save-batch — Sauvegarder des résultats de recherche ─
  router.post('/prospects/save-batch', (req, res) => {
    try {
      const { places } = req.body;
      if (!Array.isArray(places) || places.length === 0) {
        return res.status(400).json({ error: 'Fournir un tableau de places' });
      }

      const upsert = db.prepare(`
        INSERT INTO maps_prospects (place_id, name, category, address, city, country, phone, website, rating, reviews_count, maps_url, business_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(place_id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          address = excluded.address,
          city = excluded.city,
          country = excluded.country,
          phone = COALESCE(excluded.phone, maps_prospects.phone),
          website = COALESCE(excluded.website, maps_prospects.website),
          rating = excluded.rating,
          reviews_count = excluded.reviews_count,
          maps_url = COALESCE(excluded.maps_url, maps_prospects.maps_url),
          business_status = excluded.business_status,
          updated_at = datetime('now')
      `);

      const transaction = db.transaction((places) => {
        let saved = 0;
        for (const p of places) {
          upsert.run(
            p.place_id, p.name, p.category || null, p.address || null,
            p.city || null, p.country || null, p.phone || null, p.website || null,
            p.rating || null, p.reviews_count || 0, p.maps_url || null,
            p.business_status || 'OPERATIONAL'
          );
          saved++;
        }
        return saved;
      });

      const saved = transaction(places);
      res.json({ saved });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST /prospects/:id/analyze-website — Lancer websiteAnalyzer ────────
  router.post('/prospects/:id/analyze-website', async (req, res) => {
    try {
      const { id } = req.params;
      const prospect = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
      if (!prospect) return res.status(404).json({ error: 'Prospect non trouvé' });
      if (!prospect.website) return res.status(400).json({ error: 'Pas de site web' });

      const analysis = await analyzeWebsite(prospect.website);

      db.prepare(`
        UPDATE maps_prospects SET
          website_age_years = ?,
          website_last_updated = ?,
          website_is_old = ?,
          website_age_method = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        analysis.age_years,
        analysis.last_updated,
        analysis.is_old ? 1 : 0,
        analysis.method,
        id
      );

      const updated = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST /prospects/:id/find-email — Lancer mapsEmailFinder ─────────────
  router.post('/prospects/:id/find-email', async (req, res) => {
    try {
      const { id } = req.params;
      const prospect = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
      if (!prospect) return res.status(404).json({ error: 'Prospect non trouvé' });

      const result = await findEmail({
        name: prospect.name,
        website: prospect.website,
        city: prospect.city,
      });

      db.prepare(`
        UPDATE maps_prospects SET
          email = COALESCE(?, email),
          email_source = ?,
          email_confidence = ?,
          enrichment_attempted = 1,
          enrichment_at = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        result.email,
        result.source,
        result.confidence,
        id
      );

      const updated = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
      res.json({ ...updated, all_emails: result.all_emails });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST /prospects/:id/enrich-all — analyze + find-email en séquence ───
  router.post('/prospects/:id/enrich-all', async (req, res) => {
    try {
      const { id } = req.params;
      const prospect = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
      if (!prospect) return res.status(404).json({ error: 'Prospect non trouvé' });

      // Étape 1 : analyser le site web
      let analysis = null;
      if (prospect.website) {
        analysis = await analyzeWebsite(prospect.website);
        db.prepare(`
          UPDATE maps_prospects SET
            website_age_years = ?, website_last_updated = ?,
            website_is_old = ?, website_age_method = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(analysis.age_years, analysis.last_updated, analysis.is_old ? 1 : 0, analysis.method, id);
      }

      // Étape 2 : rechercher un email
      const emailResult = await findEmail({
        name: prospect.name,
        website: prospect.website,
        city: prospect.city,
      });

      db.prepare(`
        UPDATE maps_prospects SET
          email = COALESCE(?, email),
          email_source = ?, email_confidence = ?,
          enrichment_attempted = 1, enrichment_at = datetime('now'),
          status = CASE WHEN status = 'new' THEN 'enriched' ELSE status END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(emailResult.email, emailResult.source, emailResult.confidence, id);

      const updated = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
      res.json({ ...updated, analysis, all_emails: emailResult.all_emails });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST /enrich-batch — Batch enrichissement ────────────────────────────
  router.post('/enrich-batch', (req, res) => {
    try {
      const { prospect_ids } = req.body;
      if (!Array.isArray(prospect_ids) || prospect_ids.length === 0) {
        return res.status(400).json({ error: 'Fournir prospect_ids' });
      }

      const jobId = uuidv4();
      const job = {
        id: jobId,
        total: prospect_ids.length,
        processed: 0,
        success: 0,
        errors: 0,
        status: 'running',
        startedAt: Date.now(),
        cancelled: false,
      };
      batchJobs.set(jobId, job);

      // Lancer en background
      (async () => {
        for (const id of prospect_ids) {
          if (job.cancelled) {
            job.status = 'cancelled';
            break;
          }

          try {
            const prospect = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
            if (!prospect) { job.errors++; job.processed++; continue; }

            // Analyser le site web
            if (prospect.website) {
              const analysis = await analyzeWebsite(prospect.website);
              db.prepare(`
                UPDATE maps_prospects SET
                  website_age_years = ?, website_last_updated = ?,
                  website_is_old = ?, website_age_method = ?,
                  updated_at = datetime('now')
                WHERE id = ?
              `).run(analysis.age_years, analysis.last_updated, analysis.is_old ? 1 : 0, analysis.method, id);
            }

            // Rechercher un email
            const emailResult = await findEmail({
              name: prospect.name,
              website: prospect.website,
              city: prospect.city,
            });

            db.prepare(`
              UPDATE maps_prospects SET
                email = COALESCE(?, email),
                email_source = ?, email_confidence = ?,
                enrichment_attempted = 1, enrichment_at = datetime('now'),
                status = CASE WHEN status = 'new' THEN 'enriched' ELSE status END,
                updated_at = datetime('now')
              WHERE id = ?
            `).run(emailResult.email, emailResult.source, emailResult.confidence, id);

            job.success++;
          } catch (err) {
            job.errors++;
          }

          job.processed++;

          // Délai entre chaque prospect
          if (!job.cancelled && job.processed < prospect_ids.length) {
            await new Promise(r => setTimeout(r, 1500));
          }
        }

        if (job.status !== 'cancelled') job.status = 'completed';
      })();

      res.json({ jobId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET /enrich-batch/:jobId/status — Statut du batch ────────────────────
  router.get('/enrich-batch/:jobId/status', (req, res) => {
    const job = batchJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job non trouvé' });
    res.json({
      id: job.id,
      total: job.total,
      processed: job.processed,
      success: job.success,
      errors: job.errors,
      status: job.status,
    });
  });

  // ─── POST /enrich-batch/:jobId/cancel — Annuler un batch ──────────────────
  router.post('/enrich-batch/:jobId/cancel', (req, res) => {
    const job = batchJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job non trouvé' });
    job.cancelled = true;
    res.json({ ok: true });
  });

  // ─── POST /prospects/:id/create-contact — Créer un lead depuis le prospect ─
  router.post('/prospects/:id/create-contact', (req, res) => {
    try {
      const { id } = req.params;
      const prospect = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
      if (!prospect) return res.status(404).json({ error: 'Prospect non trouvé' });
      if (!prospect.email) return res.status(400).json({ error: 'Email requis pour créer un contact' });

      // Vérifier si le lead existe déjà
      const existing = db.prepare('SELECT id FROM leads WHERE email = ?').get(prospect.email);
      if (existing) {
        db.prepare("UPDATE maps_prospects SET status = 'contacted', updated_at = datetime('now') WHERE id = ?").run(id);
        return res.json({ lead_id: existing.id, already_exists: true });
      }

      // Source = "Maps — Catégorie"
      const source = prospect.category ? `Maps — ${prospect.category}` : 'Maps Prospection';

      // Créer le lead — le nom du business va dans hotel, Contact comme prénom par défaut
      const leadId = uuidv4();

      db.prepare(`
        INSERT INTO leads (id, prenom, nom, email, hotel, ville, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(leadId, 'Contact', '', prospect.email, prospect.name || '', prospect.city || '', source);

      db.prepare("UPDATE maps_prospects SET status = 'contacted', updated_at = datetime('now') WHERE id = ?").run(id);

      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
      res.json({ lead_id: leadId, lead, already_exists: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET /api-usage — Utilisation de l'API Google Places ─────────────────
  router.get('/api-usage', (req, res) => {
    try {
      const month = new Date().toISOString().slice(0, 7);
      const monthKey = `maps_api_calls_${month}`;
      const total = parseInt(db.prepare("SELECT valeur FROM config WHERE cle = 'maps_api_calls_total'").get()?.valeur || '0');
      const monthCount = parseInt(db.prepare("SELECT valeur FROM config WHERE cle = ?").get(monthKey)?.valeur || '0');
      const costPerRequest = 0.032;
      res.json({
        total,
        month: monthCount,
        month_label: month,
        cost_month: Math.round(monthCount * costPerRequest * 100) / 100,
        cost_total: Math.round(total * costPerRequest * 100) / 100,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
