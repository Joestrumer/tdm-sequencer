/**
 * veille.js — Routes API pour la veille web hôtelière
 *
 * Passe 2 :
 * - frequence_cron = champ canonique (plus de frequence seul)
 * - Replanification auto après POST/PATCH/DELETE source
 * - Endpoints runs et santé des sources
 * - Trigger type passé à scraperUneSource
 */

const { Router } = require('express');
const { randomUUID } = require('crypto');
const { scraperUneSource, scraperToutesSources, planifierCrons, getStatus } = require('../jobs/veilleScraper');

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
   * POST /run-all — Scraping de toutes les sources
   */
  router.post('/run-all', async (req, res) => {
    try {
      const result = await scraperToutesSources();
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

  return router;
};
