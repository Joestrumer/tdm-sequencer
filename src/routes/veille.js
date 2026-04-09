/**
 * veille.js — Routes API pour la veille web hôtelière
 */

const { Router } = require('express');
const { randomUUID } = require('crypto');
const { scraperUneSource, scraperToutesSources } = require('../jobs/veilleScraper');

module.exports = (db) => {
  const router = Router();

  // ─── Articles ──────────────────────────────────────────────────────────────

  /**
   * GET /articles — Liste paginée avec filtres
   * Query: source, lu (0/1), favori (0/1), mot_cle, score_min, archived (0/1), page, limit, search
   */
  router.get('/articles', (req, res) => {
    try {
      const {
        source, lu, favori, mot_cle, score_min, archived,
        page = 1, limit = 30, search
      } = req.query;

      let where = ['1=1'];
      const params = [];

      // Par défaut, ne pas montrer les archivés
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

      const parSource = db.prepare(`
        SELECT s.id, s.nom, COUNT(a.id) as count
        FROM veille_sources s
        LEFT JOIN veille_articles a ON a.source_id = s.id AND a.archived = 0
        WHERE s.actif = 1
        GROUP BY s.id
      `).all();

      res.json({ total, nonLus, favoris, parSource });
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
   * GET /sources — Liste des sources
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
   * POST /sources — Ajouter une source
   */
  router.post('/sources', (req, res) => {
    try {
      const { nom, url, type = 'html', selecteurs, mots_cles, frequence = '6h' } = req.body;
      if (!nom || !url) return res.status(400).json({ erreur: 'nom et url requis' });

      const id = randomUUID();
      db.prepare(`
        INSERT INTO veille_sources (id, nom, url, type, selecteurs, mots_cles, frequence, actif)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        id, nom, url, type,
        typeof selecteurs === 'string' ? selecteurs : JSON.stringify(selecteurs || {}),
        typeof mots_cles === 'string' ? mots_cles : JSON.stringify(mots_cles || []),
        frequence
      );

      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * PATCH /sources/:id — Modifier une source
   */
  router.patch('/sources/:id', (req, res) => {
    try {
      const { nom, url, type, selecteurs, mots_cles, frequence, actif } = req.body;
      const updates = [];
      const params = [];

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
      if (frequence !== undefined) { updates.push('frequence = ?'); params.push(frequence); }
      if (actif !== undefined) { updates.push('actif = ?'); params.push(actif ? 1 : 0); }

      if (updates.length === 0) return res.status(400).json({ erreur: 'Aucun champ à modifier' });

      params.push(req.params.id);
      db.prepare(`UPDATE veille_sources SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * DELETE /sources/:id — Supprimer une source
   */
  router.delete('/sources/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM veille_sources WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  /**
   * POST /sources/:id/run — Scraping manuel d'une source
   */
  router.post('/sources/:id/run', async (req, res) => {
    try {
      const source = db.prepare('SELECT * FROM veille_sources WHERE id = ?').get(req.params.id);
      if (!source) return res.status(404).json({ erreur: 'Source introuvable' });

      const inseres = await scraperUneSource(source);
      res.json({ ok: true, nouveaux: inseres });
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

  return router;
};
