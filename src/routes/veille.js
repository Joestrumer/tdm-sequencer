/**
 * veille.js — Routes API pour la veille web hôtelière
 *
 * Passe 2 + 3 :
 * - frequence_cron = champ canonique
 * - Replanification auto après CRUD source
 * - Observabilité (runs, santé)
 * - Opportunités : CRUD, filtres métier, alertes
 * - Enrichissement : trigger manuel
 */

const { Router } = require('express');
const { randomUUID } = require('crypto');
const { scraperUneSource, scraperToutesSources, planifierCrons, runEnrichmentPipeline, getStatus } = require('../jobs/veilleScraper');

module.exports = (db) => {
  const router = Router();

  // ─── Articles ──────────────────────────────────────────────────────────────

  /**
   * GET /articles — Liste paginée avec filtres
   */
  router.get('/articles', (req, res) => {
    try {
      const {
        source, lu, favori, mot_cle, score_min, archived, priorite,
        page = 1, limit = 30, search
      } = req.query;

      let where = ['1=1'];
      const params = [];

      if (archived === '1') {
        where.push('a.archived = 1');
      } else {
        where.push('a.archived = 0');
      }

      if (source) {
        where.push('a.source_id = ?');
        params.push(source);
      }

      if (lu === '0') {
        where.push('a.lu = 0');
      } else if (lu === '1') {
        where.push('a.lu = 1');
      }

      if (favori === '1') {
        where.push('a.favori = 1');
      }

      if (score_min) {
        where.push('a.score_pertinence >= ?');
        params.push(parseInt(score_min));
      }

      if (mot_cle) {
        where.push('a.mots_cles_trouves LIKE ?');
        params.push(`%${mot_cle}%`);
      }

      if (priorite) {
        where.push('a.priorite = ?');
        params.push(priorite);
      }

      if (search) {
        where.push('(a.titre LIKE ? OR a.resume LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }

      const whereClause = where.join(' AND ');
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const total = db.prepare(`SELECT COUNT(*) as n FROM veille_articles a WHERE ${whereClause}`).get(...params).n;

      const articles = db.prepare(`
        SELECT a.*, s.nom as source_nom
        FROM veille_articles a
        LEFT JOIN veille_sources s ON s.id = a.source_id
        WHERE ${whereClause}
        ORDER BY a.created_at DESC, a.score_pertinence DESC
        LIMIT ? OFFSET ?
      `).all(...params, parseInt(limit), offset);

      res.json({
        articles: articles.map(a => ({
          ...a,
          mots_cles_trouves: typeof a.mots_cles_trouves === 'string' ? JSON.parse(a.mots_cles_trouves) : a.mots_cles_trouves,
        })),
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * GET /articles/stats — Compteurs
   */
  router.get('/articles/stats', (req, res) => {
    try {
      const total = db.prepare('SELECT COUNT(*) as n FROM veille_articles WHERE archived = 0').get().n;
      const nonLus = db.prepare('SELECT COUNT(*) as n FROM veille_articles WHERE lu = 0 AND archived = 0').get().n;
      const favoris = db.prepare('SELECT COUNT(*) as n FROM veille_articles WHERE favori = 1 AND archived = 0').get().n;
      const prioA = db.prepare("SELECT COUNT(*) as n FROM veille_articles WHERE priorite = 'A' AND archived = 0").get().n;
      const prioB = db.prepare("SELECT COUNT(*) as n FROM veille_articles WHERE priorite = 'B' AND archived = 0").get().n;
      const prioC = db.prepare("SELECT COUNT(*) as n FROM veille_articles WHERE priorite = 'C' AND archived = 0").get().n;

      const parSource = db.prepare(`
        SELECT s.id, s.nom, s.categorie, s.health_status, COUNT(a.id) as count,
          SUM(CASE WHEN a.lu = 0 THEN 1 ELSE 0 END) as unread
        FROM veille_sources s
        LEFT JOIN veille_articles a ON a.source_id = s.id AND a.archived = 0
        WHERE s.actif = 1
        GROUP BY s.id
      `).all();

      res.json({ total, nonLus, favoris, prioA, prioB, prioC, parSource });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * PATCH /articles/:id — Marquer lu, favori, archivé
   */
  router.patch('/articles/:id', (req, res) => {
    try {
      const { lu, favori, archived } = req.body;
      const updates = [];
      const params = [];

      if (lu !== undefined) { updates.push('lu = ?'); params.push(lu ? 1 : 0); }
      if (favori !== undefined) { updates.push('favori = ?'); params.push(favori ? 1 : 0); }
      if (archived !== undefined) { updates.push('archived = ?'); params.push(archived ? 1 : 0); }

      if (updates.length === 0) return res.status(400).json({ erreur: 'Aucun champ à modifier' });

      params.push(req.params.id);
      db.prepare(`UPDATE veille_articles SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── Sources ───────────────────────────────────────────────────────────────

  /**
   * GET /sources — Liste des sources avec santé
   */
  router.get('/sources', (req, res) => {
    try {
      const sources = db.prepare(`
        SELECT s.*,
          (SELECT COUNT(*) FROM veille_articles a WHERE a.source_id = s.id) as article_count,
          (SELECT COUNT(*) FROM veille_articles a WHERE a.source_id = s.id AND a.lu = 0) as unread_count
        FROM veille_sources s
        ORDER BY s.nom
      `).all();

      res.json(sources.map(s => ({
        ...s,
        selecteurs: typeof s.selecteurs === 'string' ? JSON.parse(s.selecteurs) : s.selecteurs,
        mots_cles: typeof s.mots_cles === 'string' ? JSON.parse(s.mots_cles) : s.mots_cles,
      })));
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * GET /sources/health — Santé de toutes les sources
   */
  router.get('/sources/health', (req, res) => {
    try {
      const sources = db.prepare(`
        SELECT id, nom, categorie, health_status, last_run, last_success_at, last_error_at, error_count, actif
        FROM veille_sources
        ORDER BY
          CASE health_status WHEN 'failing' THEN 0 WHEN 'degraded' THEN 1 WHEN 'healthy' THEN 2 ELSE 3 END,
          nom
      `).all();

      const summary = {
        healthy: sources.filter(s => s.health_status === 'healthy').length,
        degraded: sources.filter(s => s.health_status === 'degraded').length,
        failing: sources.filter(s => s.health_status === 'failing').length,
        unknown: sources.filter(s => s.health_status === 'unknown' || !s.health_status).length,
      };

      res.json({ sources, summary });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * POST /sources — Ajouter une source (frequence_cron canonique)
   */
  router.post('/sources', (req, res) => {
    try {
      const { nom, url, type = 'brave_search', selecteurs, mots_cles, frequence_cron = '0 */6 * * *', categorie = 'hebdo' } = req.body;
      if (!nom || !url) return res.status(400).json({ erreur: 'nom et url requis' });

      const id = randomUUID();
      db.prepare(`
        INSERT INTO veille_sources (id, nom, url, type, selecteurs, mots_cles, frequence, frequence_cron, categorie, actif)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        id, nom, url, type,
        typeof selecteurs === 'string' ? selecteurs : JSON.stringify(selecteurs || {}),
        typeof mots_cles === 'string' ? mots_cles : JSON.stringify(mots_cles || []),
        frequence_cron, // frequence = frequence_cron (canonical)
        frequence_cron,
        categorie
      );

      // Replanifier les crons
      planifierCrons();

      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * PATCH /sources/:id — Modifier une source (replanifie si fréquence/actif changé)
   */
  router.patch('/sources/:id', (req, res) => {
    try {
      const { nom, url, type, selecteurs, mots_cles, frequence_cron, categorie, actif } = req.body;
      const updates = [];
      const params = [];
      let needReplan = false;

      if (nom !== undefined) { updates.push('nom = ?'); params.push(nom); }
      if (url !== undefined) { updates.push('url = ?'); params.push(url); }
      if (type !== undefined) { updates.push('type = ?'); params.push(type); }
      if (selecteurs !== undefined) {
        updates.push('selecteurs = ?');
        params.push(typeof selecteurs === 'string' ? selecteurs : JSON.stringify(selecteurs));
      }
      if (mots_cles !== undefined) {
        updates.push('mots_cles = ?');
        params.push(typeof mots_cles === 'string' ? mots_cles : JSON.stringify(mots_cles));
      }
      if (frequence_cron !== undefined) {
        updates.push('frequence_cron = ?');
        updates.push('frequence = ?'); // garder les 2 en sync
        params.push(frequence_cron);
        params.push(frequence_cron);
        needReplan = true;
      }
      if (categorie !== undefined) { updates.push('categorie = ?'); params.push(categorie); }
      if (actif !== undefined) {
        updates.push('actif = ?');
        params.push(actif ? 1 : 0);
        needReplan = true;
      }

      if (updates.length === 0) return res.status(400).json({ erreur: 'Aucun champ à modifier' });

      params.push(req.params.id);
      db.prepare(`UPDATE veille_sources SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      // Replanifier si fréquence ou activation changée
      if (needReplan) {
        planifierCrons();
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * DELETE /sources/:id — Supprimer une source (replanifie)
   */
  router.delete('/sources/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM veille_sources WHERE id = ?').run(req.params.id);
      planifierCrons();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── Exécution manuelle ──────────────────────────────────────────────────

  /**
   * POST /sources/:id/run — Scraping manuel d'une source
   */
  router.post('/sources/:id/run', async (req, res) => {
    try {
      const source = db.prepare('SELECT * FROM veille_sources WHERE id = ?').get(req.params.id);
      if (!source) return res.status(404).json({ erreur: 'Source introuvable' });

      const result = await scraperUneSource(source, 'manual');
      if (result.skipped) {
        return res.status(409).json({ erreur: 'Source déjà en cours de scraping', skipped: true });
      }
      res.json({ ok: true, nouveaux: result.inserted, error: result.error || null });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * POST /run-all — Scraping de toutes les sources + enrichissement
   */
  router.post('/run-all', async (req, res) => {
    try {
      const result = await scraperToutesSources();
      // Lancer l'enrichissement après le scraping
      runEnrichmentPipeline().catch(err => {
        console.error('Veille: erreur enrichissement post-run-all:', err.message);
      });
      // Si toutes les sources ont échoué, remonter l'erreur
      if (result.errors === result.total && result.lastError) {
        return res.status(500).json({ ok: false, erreur: result.lastError, ...result });
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── Observabilité : runs ─────────────────────────────────────────────────

  /**
   * GET /runs — Derniers runs (toutes sources)
   */
  router.get('/runs', (req, res) => {
    try {
      const { source_id, status, limit = 50 } = req.query;
      let where = ['1=1'];
      const params = [];

      if (source_id) {
        where.push('r.source_id = ?');
        params.push(source_id);
      }
      if (status) {
        where.push('r.status = ?');
        params.push(status);
      }

      const runs = db.prepare(`
        SELECT r.*, s.nom as source_nom
        FROM veille_source_runs r
        LEFT JOIN veille_sources s ON s.id = r.source_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.started_at DESC
        LIMIT ?
      `).all(...params, parseInt(limit));

      res.json(runs);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * GET /sources/:id/runs — Runs d'une source spécifique
   */
  router.get('/sources/:id/runs', (req, res) => {
    try {
      const { limit = 20 } = req.query;
      const runs = db.prepare(`
        SELECT * FROM veille_source_runs
        WHERE source_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `).all(req.params.id, parseInt(limit));

      res.json(runs);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── Status scheduler ────────────────────────────────────────────────────

  /**
   * GET /status — Statut du scheduler (crons actifs, sources en cours)
   */
  router.get('/status', (req, res) => {
    try {
      res.json(getStatus());
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── Test Brave ──────────────────────────────────────────────────────────

  /**
   * GET /test-brave — Tester la connexion API Brave Search
   */
  router.get('/test-brave', async (req, res) => {
    try {
      const row = db.prepare("SELECT valeur FROM config WHERE cle = 'brave_search_api_key'").get();
      const apiKey = row?.valeur || process.env.BRAVE_SEARCH_API_KEY || '';

      if (!apiKey) {
        return res.json({ ok: false, erreur: 'Clé API Brave non configurée. Allez dans Paramètres > Intégrations.' });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const params = new URLSearchParams({ q: 'site:hospitality-on.com hôtel rénovation', count: '3', search_lang: 'fr' });
        const r = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
          headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!r.ok) {
          const body = await r.text().catch(() => '');
          return res.json({ ok: false, status: r.status, erreur: body.substring(0, 300) });
        }

        const data = await r.json();
        const results = data.web?.results || [];

        res.json({
          ok: true,
          resultats: results.length,
          exemples: results.slice(0, 3).map(r => ({ titre: r.title, url: r.url })),
          plan: data.query?.plan || 'inconnu',
        });
      } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
          return res.json({ ok: false, erreur: 'Timeout (10s) — problème réseau ?' });
        }
        throw err;
      }
    } catch (err) {
      res.status(500).json({ ok: false, erreur: err.message });
    }
  });

  // ─── Google Places — Scanner fermetures temporaires ──────────────────────

  /**
   * GET /test-google-places — Tester la clé API Google Places
   */
  router.get('/test-google-places', async (req, res) => {
    try {
      const { getApiKey, searchHotelsInCity } = require('../services/googlePlacesService');
      const apiKey = getApiKey(db);

      if (!apiKey) {
        return res.json({ ok: false, erreur: 'Clé API Google Places non configurée. Allez dans Paramètres > Intégrations.' });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        // Test simple : recherche hôtels à Paris
        const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.displayName,places.businessStatus',
          },
          body: JSON.stringify({ textQuery: 'hôtel Paris', includedType: 'lodging', pageSize: 3 }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!r.ok) {
          const body = await r.text().catch(() => '');
          return res.json({ ok: false, status: r.status, erreur: body.substring(0, 300) });
        }

        const data = await r.json();
        const places = data.places || [];

        res.json({
          ok: true,
          resultats: places.length,
          exemples: places.map(p => ({
            nom: p.displayName?.text,
            statut: p.businessStatus || 'OPERATIONAL',
          })),
        });
      } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
          return res.json({ ok: false, erreur: 'Timeout (10s) — problème réseau ?' });
        }
        throw err;
      }
    } catch (err) {
      res.status(500).json({ ok: false, erreur: err.message });
    }
  });

  /**
   * POST /scan-fermetures — Scanner une ville ou une région
   * Body: { city: "Paris" } ou { region: "Bretagne" } ou { cities: ["Paris","Lyon"] }
   */
  router.post('/scan-fermetures', async (req, res) => {
    // Timeout long pour les scans multi-requêtes (Paris = 20 arrondissements)
    req.setTimeout(120000);
    res.setTimeout(120000);
    try {
      const { scanCity, scanCities, REGIONS } = require('../services/googlePlacesService');
      const { city, region, cities } = req.body;

      if (city) {
        // Scan d'une seule ville
        const result = await scanCity(db, city);
        return res.json({ ok: true, ...result });
      }

      if (region && REGIONS[region]) {
        // Scan d'une région entière
        const result = await scanCities(db, REGIONS[region]);
        return res.json({ ok: true, region, ...result });
      }

      if (cities && Array.isArray(cities) && cities.length > 0) {
        const result = await scanCities(db, cities.slice(0, 20)); // max 20 villes par requête
        return res.json({ ok: true, ...result });
      }

      return res.status(400).json({ ok: false, erreur: 'Paramètre requis: city, region ou cities' });
    } catch (err) {
      res.status(500).json({ ok: false, erreur: err.message });
    }
  });

  /**
   * GET /scan-fermetures/regions — Liste des régions disponibles
   */
  router.get('/scan-fermetures/regions', (req, res) => {
    const { REGIONS } = require('../services/googlePlacesService');
    res.json(Object.entries(REGIONS).map(([name, cities]) => ({ name, cities, count: cities.length })));
  });

  // ─── Enrichissement manuel ─────────────────────────────────────────────────

  /**
   * POST /enrich — Lancer l'enrichissement + pipeline opportunités manuellement
   */
  router.post('/enrich', async (req, res) => {
    try {
      await runEnrichmentPipeline();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── Opportunités ─────────────────────────────────────────────────────────

  /**
   * GET /opportunities — Liste paginée avec filtres métier
   */
  router.get('/opportunities', (req, res) => {
    try {
      const {
        city, region, group_name, signal_type, signal_strength,
        status, min_business_score, min_confidence_score,
        page = 1, limit = 30, search
      } = req.query;

      let where = ['1=1'];
      const params = [];

      if (city) { where.push('o.city = ?'); params.push(city); }
      if (region) { where.push('o.region = ?'); params.push(region); }
      if (group_name) { where.push('o.group_name LIKE ?'); params.push(`%${group_name}%`); }
      if (signal_type) { where.push('o.signal_type = ?'); params.push(signal_type); }
      if (signal_strength) { where.push('o.signal_strength = ?'); params.push(signal_strength); }
      if (status) { where.push('o.status = ?'); params.push(status); }
      if (min_business_score) { where.push('o.business_score >= ?'); params.push(parseInt(min_business_score)); }
      if (min_confidence_score) { where.push('o.confidence_score >= ?'); params.push(parseInt(min_confidence_score)); }
      if (search) {
        where.push('(o.hotel_name LIKE ? OR o.city LIKE ? OR o.group_name LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      const whereClause = where.join(' AND ');
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const total = db.prepare(`SELECT COUNT(*) as n FROM veille_opportunities o WHERE ${whereClause}`).get(...params).n;

      const opportunities = db.prepare(`
        SELECT o.*,
          (SELECT COUNT(*) FROM veille_opportunity_sources os WHERE os.opportunity_id = o.id) as article_count
        FROM veille_opportunities o
        WHERE ${whereClause}
        ORDER BY o.business_score DESC, o.last_seen_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, parseInt(limit), offset);

      res.json({
        opportunities,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * GET /opportunities/dashboard — KPIs opportunités
   */
  router.get('/opportunities/dashboard', (req, res) => {
    try {
      const total = db.prepare('SELECT COUNT(*) as n FROM veille_opportunities').get().n;
      const prioA = db.prepare("SELECT COUNT(*) as n FROM veille_opportunities WHERE signal_strength = 'A'").get().n;
      const prioB = db.prepare("SELECT COUNT(*) as n FROM veille_opportunities WHERE signal_strength = 'B'").get().n;
      const newCount = db.prepare("SELECT COUNT(*) as n FROM veille_opportunities WHERE status = 'new'").get().n;

      const bySignal = db.prepare(`
        SELECT signal_type, COUNT(*) as count, AVG(business_score) as avg_score
        FROM veille_opportunities
        GROUP BY signal_type
        ORDER BY count DESC
      `).all();

      const byCity = db.prepare(`
        SELECT city, COUNT(*) as count
        FROM veille_opportunities
        WHERE city IS NOT NULL
        GROUP BY city
        ORDER BY count DESC
        LIMIT 10
      `).all();

      const multiSource = db.prepare(`
        SELECT COUNT(*) as n FROM veille_opportunities WHERE source_count >= 2
      `).get().n;

      const recentA = db.prepare(`
        SELECT id, hotel_name, city, signal_type, business_score, first_seen_at, source_count
        FROM veille_opportunities
        WHERE signal_strength = 'A'
        ORDER BY first_seen_at DESC
        LIMIT 5
      `).all();

      // Stats enrichissement
      const enriched = db.prepare('SELECT COUNT(*) as n FROM veille_articles WHERE enriched = 1').get().n;
      const notEnriched = db.prepare('SELECT COUNT(*) as n FROM veille_articles WHERE enriched = 0 AND score_pertinence >= 3').get().n;

      res.json({
        total, prioA, prioB, newCount, multiSource,
        bySignal, byCity, recentA,
        enrichment: { enriched, pending: notEnriched },
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * GET /opportunities/:id — Détail d'une opportunité avec ses articles
   */
  router.get('/opportunities/:id', (req, res) => {
    try {
      const opp = db.prepare('SELECT * FROM veille_opportunities WHERE id = ?').get(req.params.id);
      if (!opp) return res.status(404).json({ erreur: 'Opportunité introuvable' });

      const articles = db.prepare(`
        SELECT a.id, a.titre, a.url, a.resume, a.source_id, a.score_pertinence, a.priorite,
               a.hotel_name, a.city, a.group_name, a.signal_type, a.created_at,
               s.nom as source_nom
        FROM veille_opportunity_sources os
        JOIN veille_articles a ON a.id = os.article_id
        LEFT JOIN veille_sources s ON s.id = a.source_id
        WHERE os.opportunity_id = ?
        ORDER BY a.created_at DESC
      `).all(req.params.id);

      res.json({ ...opp, articles });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * PATCH /opportunities/:id — Modifier le statut d'une opportunité
   */
  router.patch('/opportunities/:id', (req, res) => {
    try {
      const { status } = req.body;
      const validStatuses = ['new', 'qualified', 'contacted', 'won', 'lost', 'archived'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ erreur: `Statut invalide. Valeurs: ${validStatuses.join(', ')}` });
      }

      db.prepare('UPDATE veille_opportunities SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * GET /alerts — Nouvelles opportunités A/B non encore qualifiées
   */
  router.get('/alerts', (req, res) => {
    try {
      const { since } = req.query;
      let where = "o.status = 'new' AND o.signal_strength IN ('A', 'B')";
      const params = [];

      if (since) {
        where += ' AND o.first_seen_at >= ?';
        params.push(since);
      }

      const alerts = db.prepare(`
        SELECT o.*,
          (SELECT COUNT(*) FROM veille_opportunity_sources os WHERE os.opportunity_id = o.id) as article_count
        FROM veille_opportunities o
        WHERE ${where}
        ORDER BY o.business_score DESC, o.first_seen_at DESC
        LIMIT 50
      `).all(...params);

      res.json({
        count: alerts.length,
        alerts: alerts.map(a => ({
          ...a,
          summary: [
            a.hotel_name || 'Établissement inconnu',
            a.city ? `à ${a.city}` : '',
            a.group_name ? `(${a.group_name})` : '',
            `— ${a.signal_type}`,
            a.project_date ? `prévu ${a.project_date}` : '',
            `| score=${a.business_score} confiance=${a.confidence_score}`,
            `| ${a.source_count} source(s)`,
          ].filter(Boolean).join(' '),
        })),
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * GET /digest — Résumé actionnable des dernières 24h
   * Retourne les nouvelles opportunités, sources en échec, stats enrichissement
   */
  router.get('/digest', (req, res) => {
    try {
      const since = req.query.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Nouvelles opportunités A/B depuis
      const newOpps = db.prepare(`
        SELECT o.*,
          (SELECT COUNT(*) FROM veille_opportunity_sources os WHERE os.opportunity_id = o.id) as article_count
        FROM veille_opportunities o
        WHERE o.first_seen_at >= ? AND o.signal_strength IN ('A', 'B')
        ORDER BY o.business_score DESC
      `).all(since);

      // Opportunités mises à jour (fusion multi-sources)
      const mergedOpps = db.prepare(`
        SELECT o.id, o.hotel_name, o.city, o.signal_type, o.source_count, o.business_score
        FROM veille_opportunities o
        WHERE o.last_seen_at >= ? AND o.first_seen_at < ? AND o.source_count >= 2
        ORDER BY o.source_count DESC
        LIMIT 10
      `).all(since, since);

      // Articles insérés
      const articlesInserted = db.prepare(`
        SELECT COUNT(*) as n FROM veille_articles WHERE created_at >= ?
      `).get(since).n;

      // Articles enrichis
      const articlesEnriched = db.prepare(`
        SELECT COUNT(*) as n FROM veille_articles WHERE enriched = 1 AND created_at >= ?
      `).get(since).n;

      // Sources en échec
      const failingSources = db.prepare(`
        SELECT id, nom, health_status, error_count, last_error_at
        FROM veille_sources
        WHERE health_status IN ('failing', 'degraded') AND actif = 1
      `).all();

      // Runs avec erreurs
      const errorRuns = db.prepare(`
        SELECT r.source_id, s.nom as source_nom, r.error_message, r.started_at
        FROM veille_source_runs r
        LEFT JOIN veille_sources s ON s.id = r.source_id
        WHERE r.status = 'error' AND r.started_at >= ?
        ORDER BY r.started_at DESC
        LIMIT 10
      `).all(since);

      res.json({
        period: { since, until: new Date().toISOString() },
        opportunities: {
          new_a_b: newOpps.map(o => ({
            id: o.id,
            hotel_name: o.hotel_name,
            city: o.city,
            group_name: o.group_name,
            signal_type: o.signal_type,
            business_score: o.business_score,
            confidence_score: o.confidence_score,
            source_count: o.article_count,
            recommended_angle: o.recommended_angle,
            project_date: o.project_date,
          })),
          merged: mergedOpps,
        },
        articles: {
          inserted: articlesInserted,
          enriched: articlesEnriched,
        },
        health: {
          failing_sources: failingSources,
          error_runs: errorRuns,
        },
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
