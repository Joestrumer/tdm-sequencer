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

  // ─── POST /search — Google Places Text Search ─────────────────────────────
  router.post('/search', async (req, res) => {
    try {
      const { query, category, city, country, radius, pageToken } = req.body;

      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: 'Clé API Google Places non configurée' });

      const textQuery = [category, city, country].filter(Boolean).join(' ') || query;
      if (!textQuery) return res.status(400).json({ error: 'Requête vide' });

      const body = {
        textQuery,
        languageCode: 'fr',
        pageSize: 20,
      };

      if (pageToken) body.pageToken = pageToken;

      if (radius && city) {
        // Geocoder la ville pour le centre de recherche n'est pas nécessaire
        // Places API Text Search gère la localisation via le texte
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const fieldMask = [
        'places.id', 'places.displayName', 'places.formattedAddress',
        'places.internationalPhoneNumber', 'places.websiteUri',
        'places.rating', 'places.userRatingCount', 'places.types',
        'places.googleMapsUri', 'places.businessStatus',
      ].join(',');

      const apiRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!apiRes.ok) {
        const errText = await apiRes.text().catch(() => '');
        return res.status(apiRes.status).json({ error: `Google Places API: ${errText.substring(0, 300)}` });
      }

      const data = await apiRes.json();
      const places = (data.places || []).map(place => {
        // Extraire la ville depuis l'adresse formatée
        const addressParts = (place.formattedAddress || '').split(',').map(s => s.trim());
        const extractedCity = addressParts.length >= 2 ? addressParts[addressParts.length - 2] : '';
        // Extraire le pays (dernier élément)
        const extractedCountry = addressParts.length >= 1 ? addressParts[addressParts.length - 1] : '';

        // Catégorie à partir des types Google
        const typeMapping = {
          restaurant: 'Restaurant',
          hotel: 'Hôtel',
          lodging: 'Hébergement',
          spa: 'Spa',
          beauty_salon: 'Salon de beauté',
          hair_care: 'Coiffure',
          gym: 'Salle de sport',
          dentist: 'Dentiste',
          doctor: 'Médecin',
          lawyer: 'Avocat',
          accounting: 'Comptabilité',
          real_estate_agency: 'Immobilier',
          store: 'Commerce',
          cafe: 'Café',
          bar: 'Bar',
          bakery: 'Boulangerie',
          car_dealer: 'Concessionnaire',
          car_repair: 'Garage auto',
          pharmacy: 'Pharmacie',
          florist: 'Fleuriste',
          travel_agency: 'Agence de voyage',
        };
        const types = place.types || [];
        const category = types.map(t => typeMapping[t]).find(Boolean) || types[0] || '';

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

      res.json({
        places,
        nextPageToken: data.nextPageToken || null,
        total: places.length,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST /search/next-page — Pagination Places ──────────────────────────
  router.post('/search/next-page', async (req, res) => {
    try {
      const { pageToken } = req.body;
      if (!pageToken) return res.status(400).json({ error: 'pageToken requis' });

      const apiKey = getApiKey(db);
      if (!apiKey) return res.status(400).json({ error: 'Clé API Google Places non configurée' });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const fieldMask = [
        'places.id', 'places.displayName', 'places.formattedAddress',
        'places.internationalPhoneNumber', 'places.websiteUri',
        'places.rating', 'places.userRatingCount', 'places.types',
        'places.googleMapsUri', 'places.businessStatus',
      ].join(',');

      const apiRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        body: JSON.stringify({ pageToken, pageSize: 20 }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!apiRes.ok) {
        const errText = await apiRes.text().catch(() => '');
        return res.status(apiRes.status).json({ error: `Google Places API: ${errText.substring(0, 300)}` });
      }

      const data = await apiRes.json();
      const places = (data.places || []).map(place => {
        const addressParts = (place.formattedAddress || '').split(',').map(s => s.trim());
        const extractedCity = addressParts.length >= 2 ? addressParts[addressParts.length - 2] : '';
        const extractedCountry = addressParts.length >= 1 ? addressParts[addressParts.length - 1] : '';

        const types = place.types || [];
        const category = types[0] || '';

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
        };
      });

      res.json({
        places,
        nextPageToken: data.nextPageToken || null,
        total: places.length,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── GET /prospects — Liste paginée avec filtres ──────────────────────────
  router.get('/prospects', (req, res) => {
    try {
      const { status, city, country, has_email, is_old, search, limit = 50, offset = 0 } = req.query;

      let where = [];
      let params = [];

      if (status) { where.push('status = ?'); params.push(status); }
      if (city) { where.push('city LIKE ?'); params.push(`%${city}%`); }
      if (country) { where.push('country LIKE ?'); params.push(`%${country}%`); }
      if (has_email === 'true') { where.push('email IS NOT NULL AND email != \'\''); }
      if (has_email === 'false') { where.push('(email IS NULL OR email = \'\')'); }
      if (is_old === 'true') { where.push('website_is_old = 1'); }
      if (is_old === 'false') { where.push('website_is_old = 0'); }
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
          SUM(CASE WHEN status = 'in_pipeline' THEN 1 ELSE 0 END) as in_pipeline,
          SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
          SUM(CASE WHEN status = 'enriched' THEN 1 ELSE 0 END) as enriched_count
        FROM maps_prospects
      `).get();

      res.json({ prospects, total, stats });
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
        INSERT INTO maps_prospects (place_id, name, category, address, city, country, phone, website, rating, reviews_count, maps_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          updated_at = datetime('now')
      `);

      const transaction = db.transaction((places) => {
        let saved = 0;
        for (const p of places) {
          upsert.run(
            p.place_id, p.name, p.category || null, p.address || null,
            p.city || null, p.country || null, p.phone || null, p.website || null,
            p.rating || null, p.reviews_count || 0, p.maps_url || null
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

  // ─── POST /prospects/:id/push-to-pipeline — Créer un lead ────────────────
  router.post('/prospects/:id/push-to-pipeline', (req, res) => {
    try {
      const { id } = req.params;
      const prospect = db.prepare('SELECT * FROM maps_prospects WHERE id = ?').get(id);
      if (!prospect) return res.status(404).json({ error: 'Prospect non trouvé' });
      if (!prospect.email) return res.status(400).json({ error: 'Email requis pour push en pipeline' });

      // Vérifier si le lead existe déjà
      const existing = db.prepare('SELECT id FROM leads WHERE email = ?').get(prospect.email);
      if (existing) {
        // Mettre à jour le statut du prospect
        db.prepare("UPDATE maps_prospects SET status = 'in_pipeline', updated_at = datetime('now') WHERE id = ?").run(id);
        return res.json({ lead_id: existing.id, already_exists: true });
      }

      // Créer le lead
      const leadId = uuidv4();
      const nameParts = (prospect.name || '').split(' ');
      const prenom = nameParts[0] || prospect.name || 'Contact';
      const nom = nameParts.slice(1).join(' ') || '';

      db.prepare(`
        INSERT INTO leads (id, prenom, nom, email, hotel, ville, source)
        VALUES (?, ?, ?, ?, ?, ?, 'Maps Prospection')
      `).run(leadId, prenom, nom, prospect.email, prospect.name || '', prospect.city || '');

      // Mettre à jour le statut du prospect
      db.prepare("UPDATE maps_prospects SET status = 'in_pipeline', updated_at = datetime('now') WHERE id = ?").run(id);

      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
      res.json({ lead_id: leadId, lead, already_exists: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
