/**
 * instagramProspection.js — Routes API pour la prospection Instagram
 *
 * Scrape les "following" d'un compte Instagram, récupère les profils,
 * classifie les business, scrape les sites web pour emails.
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const igService = require('../services/instagramScraperService');

module.exports = (db) => {

  // ─── Config & Credentials ──────────────────────────────────────────────────

  // POST /api/instagram/config — Stocker les credentials Instagram
  router.post('/config', (req, res) => {
    const { session_id, csrf_token } = req.body;

    if (!session_id || !csrf_token) {
      return res.status(400).json({ erreur: 'session_id et csrf_token requis' });
    }

    try {
      const upsert = db.prepare(`
        INSERT INTO config (cle, valeur) VALUES (?, ?)
        ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur
      `);

      upsert.run('ig_session_id', session_id.trim());
      upsert.run('ig_csrf_token', csrf_token.trim());

      res.json({ success: true, message: 'Credentials Instagram enregistrées' });
    } catch (err) {
      logger.error('Erreur POST /instagram/config:', err);
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/instagram/config — Vérifier si configuré + retourner les valeurs
  router.get('/config', (req, res) => {
    try {
      const configured = igService.hasCredentials(db);
      const sessionId = db.prepare("SELECT valeur FROM config WHERE cle = 'ig_session_id'").get()?.valeur || '';
      const csrfToken = db.prepare("SELECT valeur FROM config WHERE cle = 'ig_csrf_token'").get()?.valeur || '';
      res.json({
        configured,
        session_id: sessionId,
        csrf_token: csrfToken,
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/instagram/test-credentials — Tester validité session
  router.post('/test-credentials', async (req, res) => {
    try {
      // Utiliser les credentials du body si fournies, sinon celles en DB
      const { session_id, csrf_token } = req.body || {};
      const credentials = (session_id && csrf_token)
        ? { sessionId: session_id.trim(), csrfToken: csrf_token.trim() }
        : igService.getCredentials(db);

      if (!credentials.sessionId || !credentials.csrfToken) {
        return res.json({ valid: false, error: 'Credentials non configurées' });
      }

      // Test avec une seule requête (pas de retry) pour ne pas aggraver un éventuel rate limit
      const testUrl = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram';
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10000);

      const rawRes = await fetch(testUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}; ig_pr=1; ig_vw=1920; ig_cb=1`,
          'X-CSRFToken': credentials.csrfToken,
          'X-IG-App-ID': '124024574287414',
          'X-IG-WWW-Claim': '0',
          'X-Instagram-AJAX': '1',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://www.instagram.com',
          'Referer': 'https://www.instagram.com/',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });

      if (rawRes.status === 429) {
        return res.json({ valid: false, error: 'Rate limit Instagram (429). L\'IP du serveur est temporairement bloquée. Réessayez dans 1-2 heures.' });
      }

      if (rawRes.status === 401 || rawRes.status === 403) {
        return res.json({ valid: false, error: 'Session expirée ou invalide. Vérifiez que les cookies sont à jour.' });
      }

      if (!rawRes.ok) {
        return res.json({ valid: false, error: `Instagram a répondu ${rawRes.status}. Vérifiez vos credentials.` });
      }

      const data = await rawRes.json();
      const user = data?.data?.user;
      if (user?.id) {
        res.json({ valid: true, message: `Session valide (test: @instagram, id=${user.id})` });
      } else {
        res.json({ valid: false, error: 'Réponse inattendue de l\'API Instagram' });
      }
    } catch (err) {
      res.json({ valid: false, error: err.name === 'AbortError' ? 'Timeout — Instagram ne répond pas' : err.message });
    }
  });

  // POST /api/instagram/debug — Diagnostic raw IG API
  router.post('/debug', async (req, res) => {
    try {
      const { session_id, csrf_token } = req.body || {};
      const credentials = (session_id && csrf_token)
        ? { sessionId: session_id.trim(), csrfToken: csrf_token.trim() }
        : igService.getCredentials(db);

      if (!credentials.sessionId || !credentials.csrfToken) {
        return res.json({ error: 'Credentials manquantes' });
      }

      const url = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram';
      const headers = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}; ig_pr=1; ig_vw=1920; ig_cb=1`,
        'X-CSRFToken': credentials.csrfToken,
        'X-IG-App-ID': '124024574287414',
        'X-IG-WWW-Claim': '0',
        'X-Instagram-AJAX': '1',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://www.instagram.com',
        'Referer': 'https://www.instagram.com/',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      };

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 15000);

      const rawRes = await fetch(url, { headers, signal: controller.signal });
      const responseHeaders = Object.fromEntries(rawRes.headers.entries());
      let body = '';
      try { body = await rawRes.text(); } catch (e) { body = `read error: ${e.message}`; }

      logger.info(`🔍 IG Debug: status=${rawRes.status}, headers=${JSON.stringify(responseHeaders)}, body=${body.slice(0, 500)}`);

      res.json({
        status: rawRes.status,
        statusText: rawRes.statusText,
        response_headers: responseHeaders,
        body_preview: body.slice(0, 1000),
        request_url: url,
        session_id_preview: `${credentials.sessionId.slice(0, 10)}...`,
      });
    } catch (err) {
      res.json({ error: err.message });
    }
  });

  // ─── Jobs ─────────────────────────────────────────────────────────────────

  // POST /api/instagram/scrape — Lancer un job de scraping
  router.post('/scrape', async (req, res) => {
    const { url, options = {} } = req.body;

    if (!url) {
      return res.status(400).json({ erreur: 'URL Instagram requise' });
    }

    const username = igService.extractUsername(url);
    if (!username) {
      return res.status(400).json({ erreur: 'URL Instagram invalide' });
    }

    if (!igService.hasCredentials(db)) {
      return res.status(400).json({ erreur: 'Credentials Instagram non configurées' });
    }

    try {
      const jobId = uuidv4();

      db.prepare(`
        INSERT INTO instagram_scrape_jobs (id, instagram_url, instagram_username, filter_keywords, options)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        jobId,
        url,
        username,
        JSON.stringify(options.filter_keywords || []),
        JSON.stringify({
          max_accounts: options.max_accounts || 500,
          skip_private: options.skip_private !== false,
        })
      );

      // Lancer le job en arrière-plan
      igService.processJob(db, jobId);

      res.json({
        success: true,
        job_id: jobId,
        username,
        message: `Scraping lancé pour @${username}`,
      });

    } catch (err) {
      logger.error('Erreur POST /instagram/scrape:', err);
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/instagram/jobs — Liste des jobs
  router.get('/jobs', (req, res) => {
    try {
      const jobs = db.prepare(`
        SELECT id, instagram_url, instagram_username, status,
               total_following, processed, emails_found, contacts_found,
               error_message, filter_keywords, options,
               created_at, updated_at, completed_at
        FROM instagram_scrape_jobs
        ORDER BY created_at DESC
        LIMIT 50
      `).all();

      // Ajouter l'info is_active pour chaque job
      const enriched = jobs.map(j => ({
        ...j,
        is_active: igService.isJobActive(j.id),
      }));

      res.json(enriched);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/instagram/jobs/:id/status — Polling progression
  router.get('/jobs/:id/status', (req, res) => {
    try {
      const job = db.prepare(`
        SELECT id, instagram_username, status,
               total_following, processed, emails_found, contacts_found,
               error_message, updated_at, completed_at
        FROM instagram_scrape_jobs WHERE id = ?
      `).get(req.params.id);

      if (!job) return res.status(404).json({ erreur: 'Job non trouvé' });

      // Stats comptes
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN best_email IS NOT NULL THEN 1 ELSE 0 END) as with_email,
          SUM(CASE WHEN business_type IS NOT NULL THEN 1 ELSE 0 END) as classified,
          SUM(CASE WHEN external_url IS NOT NULL AND external_url != '' THEN 1 ELSE 0 END) as with_website,
          SUM(CASE WHEN business_type = 'hotel' THEN 1 ELSE 0 END) as hotels,
          SUM(CASE WHEN scraping_status = 'skipped' THEN 1 ELSE 0 END) as skipped,
          SUM(CASE WHEN scraping_status = 'error' THEN 1 ELSE 0 END) as errors
        FROM instagram_scraped_accounts
        WHERE job_id = ?
      `).get(req.params.id);

      res.json({
        ...job,
        is_active: igService.isJobActive(job.id),
        stats,
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/instagram/jobs/:id/pause — Pause
  router.post('/jobs/:id/pause', (req, res) => {
    const paused = igService.pauseJob(req.params.id);
    if (paused) {
      db.prepare("UPDATE instagram_scrape_jobs SET status = 'paused', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
      res.json({ success: true, message: 'Job en pause' });
    } else {
      res.status(400).json({ erreur: 'Job non actif' });
    }
  });

  // POST /api/instagram/jobs/:id/resume — Reprise
  router.post('/jobs/:id/resume', (req, res) => {
    const resumed = igService.resumeJob(req.params.id);
    if (resumed) {
      db.prepare("UPDATE instagram_scrape_jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
      res.json({ success: true, message: 'Job repris' });
    } else {
      // Si le job n'est plus actif en mémoire, relancer
      const job = db.prepare('SELECT * FROM instagram_scrape_jobs WHERE id = ?').get(req.params.id);
      if (job && (job.status === 'paused' || job.status === 'error')) {
        igService.processJob(db, req.params.id);
        res.json({ success: true, message: 'Job relancé' });
      } else {
        res.status(400).json({ erreur: 'Job non trouvé ou non pausable' });
      }
    }
  });

  // DELETE /api/instagram/jobs/:id — Supprimer un job
  router.delete('/jobs/:id', (req, res) => {
    try {
      igService.cancelJob(req.params.id);
      db.prepare('DELETE FROM instagram_scraped_accounts WHERE job_id = ?').run(req.params.id);
      db.prepare('DELETE FROM instagram_scrape_jobs WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── Accounts ─────────────────────────────────────────────────────────────

  // GET /api/instagram/jobs/:id/accounts — Liste paginée + filtres
  router.get('/jobs/:id/accounts', (req, res) => {
    try {
      const { search, business_type, has_email, has_website, status, limit = 100, offset = 0 } = req.query;

      let where = 'WHERE job_id = ?';
      const params = [req.params.id];

      if (search) {
        where += ' AND (instagram_username LIKE ? OR full_name LIKE ? OR bio LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s);
      }

      if (business_type) {
        where += ' AND business_type = ?';
        params.push(business_type);
      }

      if (has_email === 'true') {
        where += ' AND best_email IS NOT NULL';
      } else if (has_email === 'false') {
        where += ' AND best_email IS NULL';
      }

      if (has_website === 'true') {
        where += " AND external_url IS NOT NULL AND external_url != ''";
      }

      if (status) {
        where += ' AND scraping_status = ?';
        params.push(status);
      }

      const total = db.prepare(`SELECT COUNT(*) as count FROM instagram_scraped_accounts ${where}`).get(...params).count;

      const accounts = db.prepare(`
        SELECT * FROM instagram_scraped_accounts
        ${where}
        ORDER BY
          CASE WHEN best_email IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN business_type IS NOT NULL THEN 0 ELSE 1 END,
          full_name ASC
        LIMIT ? OFFSET ?
      `).all(...params, parseInt(limit), parseInt(offset));

      res.json({ accounts, total });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/instagram/accounts/:id/scrape-website — Scrape site web unitaire
  router.post('/accounts/:id/scrape-website', async (req, res) => {
    try {
      const result = await igService.scrapeWebsitesBatch(db, [parseInt(req.params.id)]);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/instagram/accounts/:id/find-contacts — Recherche LinkedIn unitaire
  router.post('/accounts/:id/find-contacts', async (req, res) => {
    try {
      const account = db.prepare('SELECT * FROM instagram_scraped_accounts WHERE id = ?').get(parseInt(req.params.id));
      if (!account) return res.status(404).json({ erreur: 'Compte non trouvé' });

      const linkedinService = require('../services/linkedinScraperService');
      const braveApiKey = process.env.BRAVE_SEARCH_API_KEY ||
        db.prepare("SELECT valeur FROM config WHERE cle = 'brave_search_api_key'").get()?.valeur || null;

      const searchName = account.full_name || account.instagram_username;
      const contacts = await linkedinService.rechercherContactsHotel(searchName, braveApiKey);

      db.prepare(`
        UPDATE instagram_scraped_accounts
        SET linkedin_contacts = ?, contacts_found = ?
        WHERE id = ?
      `).run(JSON.stringify(contacts), contacts.length, parseInt(req.params.id));

      // Mettre à jour contacts_found du job
      if (account.job_id) {
        db.prepare(`
          UPDATE instagram_scrape_jobs
          SET contacts_found = (
            SELECT SUM(json_array_length(linkedin_contacts))
            FROM instagram_scraped_accounts
            WHERE job_id = ? AND linkedin_contacts != '[]'
          ), updated_at = datetime('now')
          WHERE id = ?
        `).run(account.job_id, account.job_id);
      }

      res.json({ success: true, contacts });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/instagram/accounts/scrape-websites-batch — Scrape sites web en lot
  router.post('/accounts/scrape-websites-batch', async (req, res) => {
    const { account_ids } = req.body;
    if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
      return res.status(400).json({ erreur: 'account_ids requis' });
    }

    try {
      // Lancer en background
      igService.scrapeWebsitesBatch(db, account_ids).then(result => {
        logger.info(`✅ Batch scrape websites terminé: ${result.success} OK, ${result.errors} erreurs, ${result.emails_found} emails`);
      });

      res.json({ success: true, message: `Scraping lancé pour ${account_ids.length} compte(s)`, queued: account_ids.length });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/instagram/accounts/find-contacts-batch — Recherche contacts en lot
  router.post('/accounts/find-contacts-batch', async (req, res) => {
    const { account_ids } = req.body;
    if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
      return res.status(400).json({ erreur: 'account_ids requis' });
    }

    // Lancer en background
    (async () => {
      const linkedinService = require('../services/linkedinScraperService');
      const braveApiKey = process.env.BRAVE_SEARCH_API_KEY ||
        db.prepare("SELECT valeur FROM config WHERE cle = 'brave_search_api_key'").get()?.valeur || null;

      for (const id of account_ids) {
        try {
          const account = db.prepare('SELECT * FROM instagram_scraped_accounts WHERE id = ?').get(id);
          if (!account) continue;

          const searchName = account.full_name || account.instagram_username;
          const contacts = await linkedinService.rechercherContactsHotel(searchName, braveApiKey);

          db.prepare('UPDATE instagram_scraped_accounts SET linkedin_contacts = ? WHERE id = ?')
            .run(JSON.stringify(contacts), id);
        } catch (err) {
          logger.warn(`⚠️ Erreur find-contacts pour account ${id}: ${err.message}`);
        }
      }

      logger.info(`✅ Batch find-contacts terminé pour ${account_ids.length} comptes`);
    })();

    res.json({ success: true, message: `Recherche lancée pour ${account_ids.length} compte(s)`, queued: account_ids.length });
  });

  // POST /api/instagram/accounts/create-leads — Convertir en leads
  router.post('/accounts/create-leads', (req, res) => {
    const { account_ids } = req.body;
    if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
      return res.status(400).json({ erreur: 'account_ids requis' });
    }

    try {
      const accounts = db.prepare(`
        SELECT * FROM instagram_scraped_accounts
        WHERE id IN (${account_ids.map(() => '?').join(',')})
          AND best_email IS NOT NULL
          AND imported_as_lead = 0
      `).all(...account_ids);

      if (accounts.length === 0) {
        return res.json({ success: true, created: 0, message: 'Aucun compte éligible (email manquant ou déjà converti)' });
      }

      const createLead = db.prepare(`
        INSERT INTO leads (
          id, prenom, nom, email, hotel, ville, segment,
          poste, langue, source, statut, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      const markAccount = db.prepare(`
        UPDATE instagram_scraped_accounts SET imported_as_lead = 1, lead_id = ? WHERE id = ?
      `);

      let created = 0;
      const errors = [];

      const transaction = db.transaction(() => {
        for (const account of accounts) {
          try {
            // Vérifier si l'email existe déjà comme lead
            const existing = db.prepare('SELECT id FROM leads WHERE email = ?').get(account.best_email);
            if (existing) {
              markAccount.run(existing.id, account.id);
              continue;
            }

            const leadId = uuidv4();

            createLead.run(
              leadId,
              '', // prenom — pas toujours dispo depuis IG
              account.full_name || account.instagram_username,
              account.best_email,
              account.full_name || account.instagram_username, // hotel
              '', // ville — pas toujours dispo
              '3*', // segment par défaut
              account.category || null,
              'fr',
              'Scrap Instagram',
              'Nouveau'
            );

            markAccount.run(leadId, account.id);
            created++;
          } catch (err) {
            errors.push({ account: account.instagram_username, error: err.message });
          }
        }
      });

      transaction();

      res.json({
        success: true,
        created,
        skipped: accounts.length - created,
        errors: errors.length > 0 ? errors : undefined,
      });

    } catch (err) {
      logger.error('Erreur create-leads Instagram:', err);
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/instagram/jobs/:id/export — Export CSV
  router.get('/jobs/:id/export', (req, res) => {
    try {
      const { business_type, has_email } = req.query;

      let where = 'WHERE job_id = ?';
      const params = [req.params.id];

      if (business_type) {
        where += ' AND business_type = ?';
        params.push(business_type);
      }
      if (has_email === 'true') {
        where += ' AND best_email IS NOT NULL';
      }

      const accounts = db.prepare(`
        SELECT instagram_username, full_name, bio, category, business_type,
               external_url, best_email, email_source, email_confidence,
               business_email, is_business, follower_count, following_count,
               scraping_status, existing_lead_email
        FROM instagram_scraped_accounts
        ${where}
        ORDER BY full_name ASC
      `).all(...params);

      // Générer CSV
      const headers = [
        'Username', 'Nom complet', 'Bio', 'Catégorie', 'Type business',
        'Site web', 'Email', 'Source email', 'Confiance', 'Email business IG',
        'Compte business', 'Followers', 'Following', 'Statut', 'Doublon lead'
      ];

      const rows = accounts.map(a => [
        `@${a.instagram_username}`,
        a.full_name || '',
        (a.bio || '').replace(/[\n\r,]/g, ' ').slice(0, 200),
        a.category || '',
        a.business_type || '',
        a.external_url || '',
        a.best_email || '',
        a.email_source || '',
        a.email_confidence || '',
        a.business_email || '',
        a.is_business ? 'Oui' : 'Non',
        a.follower_count || '',
        a.following_count || '',
        a.scraping_status || '',
        a.existing_lead_email || '',
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const job = db.prepare('SELECT instagram_username FROM instagram_scrape_jobs WHERE id = ?').get(req.params.id);
      const filename = `instagram_${job?.instagram_username || 'export'}_${new Date().toISOString().slice(0, 10)}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\ufeff' + csv); // BOM pour Excel
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
