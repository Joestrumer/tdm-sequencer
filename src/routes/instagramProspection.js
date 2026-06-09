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
const { addOrUpdateTag } = require('../utils/leadTags');

module.exports = (db) => {

  // ─── Backfill pays + re-classification pour comptes existants ─────────────
  try {
    const toBackfill = db.prepare(`
      SELECT id, external_url, bio, category, business_type, city_name, phone_country_code, address_street
      FROM instagram_scraped_accounts
      WHERE country IS NULL AND (external_url IS NOT NULL OR bio IS NOT NULL OR city_name IS NOT NULL OR phone_country_code IS NOT NULL OR address_street IS NOT NULL)
    `).all();
    if (toBackfill.length > 0) {
      const updateStmt = db.prepare('UPDATE instagram_scraped_accounts SET country = ?, business_type = COALESCE(?, business_type) WHERE id = ?');
      let updated = 0;
      for (const a of toBackfill) {
        const country = igService.detectCountry(a.external_url, a.bio, a.city_name, a.phone_country_code, a.address_street);
        const newType = igService.classifyBusiness(a.bio, a.category);
        if (country || (newType && newType !== a.business_type)) {
          updateStmt.run(country, newType, a.id);
          updated++;
        }
      }
      if (updated > 0) logger.info(`🌍 Backfill Instagram: ${updated} compte(s) mis à jour (pays + type)`);
    }
  } catch (err) {
    logger.warn('⚠️ Erreur backfill pays Instagram:', err.message);
  }

  // ─── Backfill spa : reclassifier TOUS les comptes spa avec la logique corrigée ──
  try {
    const spaToReclassify = db.prepare(`
      SELECT id, bio, category
      FROM instagram_scraped_accounts
      WHERE business_type = 'spa'
    `).all();
    if (spaToReclassify.length > 0) {
      const updateSpaStmt = db.prepare('UPDATE instagram_scraped_accounts SET business_type = ? WHERE id = ?');
      let spaFixed = 0;
      for (const a of spaToReclassify) {
        const newType = igService.classifyBusiness(a.bio, a.category);
        if (newType !== 'spa') {
          updateSpaStmt.run(newType, a.id);
          spaFixed++;
        }
      }
      if (spaFixed > 0) logger.info(`🧖 Backfill spa: ${spaFixed} compte(s) reclassifié(s) (mots-clés word-boundary + keywords réduits)`);
    }
  } catch (err) {
    logger.warn('⚠️ Erreur backfill spa Instagram:', err.message);
  }

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
  // Teste via l'API privée mobile (i.instagram.com) en priorité,
  // puis via l'API web (www.instagram.com) en fallback.
  // Une seule requête par API pour ne pas aggraver un éventuel rate limit.
  router.post('/test-credentials', async (req, res) => {
    try {
      const { session_id, csrf_token } = req.body || {};
      const credentials = (session_id && csrf_token)
        ? { sessionId: session_id.trim(), csrfToken: csrf_token.trim() }
        : igService.getCredentials(db);

      if (!credentials.sessionId || !credentials.csrfToken) {
        return res.json({ valid: false, error: 'Credentials non configurées' });
      }

      const results = {};

      // Test 1 : API privée mobile (i.instagram.com) — pool de serveurs différent
      try {
        const controller1 = new AbortController();
        setTimeout(() => controller1.abort(), 10000);
        const mobileUrl = 'https://i.instagram.com/api/v1/users/instagram/usernameinfo/';

        // Auth via Cookie (pas Bearer — le Bearer nécessite un vrai login mobile)
        const dsUserId = credentials.sessionId.split('%3A')[0] || credentials.sessionId.split(':')[0];

        const mobileRes = await fetch(mobileUrl, {
          headers: {
            'User-Agent': 'Instagram 428.0.0.47.67 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 961145276)',
            'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}; ds_user_id=${dsUserId}`,
            'X-CSRFToken': credentials.csrfToken,
            'X-IG-App-ID': '936619743392459',
            'X-IG-Connection-Type': 'WIFI',
            'X-IG-Capabilities': '3brTv10=',
            'X-FB-HTTP-Engine': 'Tigon/MNS/TCP',
            'Host': 'i.instagram.com',
            'Accept': '*/*',
            'Accept-Language': 'en-US',
            'Connection': 'keep-alive',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
          },
          signal: controller1.signal,
        });

        results.mobile_status = mobileRes.status;
        if (mobileRes.ok) {
          const data = await mobileRes.json();
          if (data?.user?.pk) {
            return res.json({
              valid: true,
              message: `Session valide via API mobile (test: @instagram, id=${data.user.pk})`,
              api: 'mobile',
            });
          }
        }
      } catch (err) {
        results.mobile_error = err.name === 'AbortError' ? 'timeout' : err.message;
      }

      // Test 2 : API web (www.instagram.com) — fallback
      try {
        const controller2 = new AbortController();
        setTimeout(() => controller2.abort(), 10000);
        const webUrl = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram';

        const webRes = await fetch(webUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}; ig_pr=1; ig_vw=1920; ig_cb=1`,
            'X-CSRFToken': credentials.csrfToken,
            'X-Instagram-AJAX': '1',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': 'https://www.instagram.com',
            'Referer': 'https://www.instagram.com/',
            'Host': 'www.instagram.com',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.8',
          },
          signal: controller2.signal,
        });

        results.web_status = webRes.status;
        if (webRes.ok) {
          const data = await webRes.json();
          if (data?.data?.user?.id) {
            return res.json({
              valid: true,
              message: `Session valide via API web (test: @instagram, id=${data.data.user.id})`,
              api: 'web',
            });
          }
        }
      } catch (err) {
        results.web_error = err.name === 'AbortError' ? 'timeout' : err.message;
      }

      // Les deux ont échoué
      const detail = [];
      if (results.mobile_status === 429 || results.web_status === 429) {
        detail.push('Rate limit (429) — IP temporairement bloquée');
      }
      if (results.mobile_status === 401 || results.web_status === 401) {
        detail.push('Session expirée (401) — recréez vos cookies');
      }
      logger.warn('⚠️ IG test credentials échoué:', results);
      res.json({
        valid: false,
        error: detail.length > 0 ? detail.join('. ') : `Échec — mobile: ${results.mobile_status || results.mobile_error}, web: ${results.web_status || results.web_error}`,
      });
    } catch (err) {
      res.json({ valid: false, error: err.message });
    }
  });

  // POST /api/instagram/debug — Diagnostic raw IG API (teste les 2 APIs)
  router.post('/debug', async (req, res) => {
    try {
      const { session_id, csrf_token } = req.body || {};
      const credentials = (session_id && csrf_token)
        ? { sessionId: session_id.trim(), csrfToken: csrf_token.trim() }
        : igService.getCredentials(db);

      if (!credentials.sessionId || !credentials.csrfToken) {
        return res.json({ error: 'Credentials manquantes' });
      }

      const dsUserId = credentials.sessionId.split('%3A')[0] || credentials.sessionId.split(':')[0];
      const results = {};

      // Test mobile API (i.instagram.com)
      try {
        const ctrl1 = new AbortController();
        setTimeout(() => ctrl1.abort(), 10000);
        const mobileRes = await fetch('https://i.instagram.com/api/v1/users/instagram/usernameinfo/', {
          headers: {
            'User-Agent': 'Instagram 428.0.0.47.67 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 961145276)',
            'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}; ds_user_id=${dsUserId}`,
            'X-CSRFToken': credentials.csrfToken,
            'X-IG-App-ID': '936619743392459',
            'X-IG-Connection-Type': 'WIFI',
            'X-IG-Capabilities': '3brTv10=',
            'Host': 'i.instagram.com',
            'Accept': '*/*',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
          },
          signal: ctrl1.signal,
        });
        let mBody = '';
        try { mBody = await mobileRes.text(); } catch { /* ignore */ }
        results.mobile = { status: mobileRes.status, body: mBody.slice(0, 500) };
      } catch (e) { results.mobile = { error: e.message }; }

      // Test web API (www.instagram.com)
      try {
        const ctrl2 = new AbortController();
        setTimeout(() => ctrl2.abort(), 10000);
        const webRes = await fetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}; ig_pr=1; ig_vw=1920; ig_cb=1`,
            'X-CSRFToken': credentials.csrfToken,
            'X-Instagram-AJAX': '1',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': 'https://www.instagram.com',
            'Referer': 'https://www.instagram.com/',
            'Host': 'www.instagram.com',
            'Accept': '*/*',
          },
          signal: ctrl2.signal,
        });
        let wBody = '';
        try { wBody = await webRes.text(); } catch { /* ignore */ }
        results.web = { status: webRes.status, body: wBody.slice(0, 500) };
      } catch (e) { results.web = { error: e.message }; }

      logger.info('🔍 IG Debug:', JSON.stringify(results));
      return res.json(results);
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
      if (job && ['paused', 'error', 'processing', 'fetching_profile', 'fetching_following'].includes(job.status)) {
        igService.processJob(db, req.params.id);
        res.json({ success: true, message: 'Job relancé (reprise)' });
      } else {
        res.status(400).json({ erreur: 'Job non trouvé ou non relançable' });
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
      const { search, business_type, has_email, has_website, status, country, has_contacts, sort_column, sort_direction, limit = 100, offset = 0 } = req.query;

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

      if (country) {
        where += ' AND country = ?';
        params.push(country);
      }

      if (has_contacts === 'true') {
        where += " AND linkedin_contacts IS NOT NULL AND linkedin_contacts != '[]'";
      } else if (has_contacts === 'false') {
        where += " AND (linkedin_contacts IS NULL OR linkedin_contacts = '[]')";
      }

      const total = db.prepare(`SELECT COUNT(*) as count FROM instagram_scraped_accounts ${where}`).get(...params).count;

      // Tri dynamique avec whitelist de colonnes autorisées
      const SORTABLE_COLUMNS = ['full_name', 'instagram_username', 'business_type', 'country', 'best_email', 'follower_count', 'following_count', 'scraping_status', 'created_at', 'city_name'];
      let orderClause = `ORDER BY
          CASE WHEN best_email IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN business_type IS NOT NULL THEN 0 ELSE 1 END,
          full_name ASC`;

      if (sort_column && SORTABLE_COLUMNS.includes(sort_column)) {
        const dir = sort_direction === 'desc' ? 'DESC' : 'ASC';
        orderClause = `ORDER BY ${sort_column} ${dir} NULLS LAST`;
      }

      const accounts = db.prepare(`
        SELECT * FROM instagram_scraped_accounts
        ${where}
        ${orderClause}
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

  // ─── Mappings pour conversion lead ─────────────────────────────────────────

  const BUSINESS_TYPE_SEGMENT_MAP = {
    'hotel': 'Hotel', 'sport': 'Sport', 'spa': 'Spa',
    'restaurant': 'Restaurant', 'bar': 'Bar',
    'hospitality': 'Hospitality', 'retail': 'Retail', 'event': 'Event',
  };

  const COUNTRY_LANGUAGE_MAP = {
    'France': 'fr', 'Belgique': 'fr', 'Suisse': 'fr', 'Monaco': 'fr',
    'Maroc': 'fr', 'Tunisie': 'fr', 'Sénégal': 'fr', 'Luxembourg': 'fr',
    'La Réunion': 'fr', 'Maurice': 'fr', 'Madagascar': 'fr',
    'Royaume-Uni': 'en', 'Irlande': 'en', 'États-Unis': 'en', 'Canada': 'en',
    'Australie': 'en', 'Singapour': 'en', 'Émirats arabes unis': 'en',
    'Hong Kong': 'en', 'Inde': 'en',
    'Espagne': 'es', 'Mexique': 'es', 'Argentine': 'es', 'Colombie': 'es',
    'Pérou': 'es', 'Chili': 'es',
    'Italie': 'it',
    'Allemagne': 'de', 'Autriche': 'de',
    'Portugal': 'pt', 'Brésil': 'pt',
    'Pays-Bas': 'nl',
    'Danemark': 'da', 'Suède': 'sv', 'Norvège': 'no', 'Finlande': 'fi',
    'Pologne': 'pl', 'Tchéquie': 'cs', 'Hongrie': 'hu',
    'Roumanie': 'ro', 'Bulgarie': 'bg', 'Croatie': 'hr',
    'Grèce': 'el', 'Turquie': 'tr', 'Japon': 'ja', 'Chine': 'zh',
    'Thaïlande': 'th', 'Indonésie': 'id',
  };

  // POST /api/instagram/accounts/create-leads — Convertir en leads
  router.post('/accounts/create-leads', (req, res) => {
    const { account_ids } = req.body;
    if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
      return res.status(400).json({ erreur: 'account_ids requis' });
    }

    try {
      const accounts = db.prepare(`
        SELECT a.*, j.instagram_username as source_account
        FROM instagram_scraped_accounts a
        LEFT JOIN instagram_scrape_jobs j ON a.job_id = j.id
        WHERE a.id IN (${account_ids.map(() => '?').join(',')})
          AND a.best_email IS NOT NULL
          AND a.imported_as_lead = 0
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

            // Source améliorée : "Scrap Instagram @compte_source"
            const leadSource = account.source_account
              ? `Scrap Instagram @${account.source_account}`
              : 'Scrap Instagram';

            // Segment : mapping business_type → segment lisible
            const leadSegment = BUSINESS_TYPE_SEGMENT_MAP[account.business_type] || 'Autre';

            // Langue : mapping country → code langue
            const leadLangue = COUNTRY_LANGUAGE_MAP[account.country] || 'en';

            createLead.run(
              leadId,
              '', // prenom — pas toujours dispo depuis IG
              account.full_name || account.instagram_username,
              account.best_email,
              account.full_name || account.instagram_username, // hotel
              '', // ville — pas toujours dispo
              leadSegment,
              account.category || null,
              leadLangue,
              leadSource,
              'Nouveau'
            );

            // Ajouter le tag de prospection avec le compte source
            addOrUpdateTag(db, leadId, 'Prospection', leadSource);

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
      const { business_type, has_email, country } = req.query;

      let where = 'WHERE job_id = ?';
      const params = [req.params.id];

      if (business_type) {
        where += ' AND business_type = ?';
        params.push(business_type);
      }
      if (has_email === 'true') {
        where += ' AND best_email IS NOT NULL';
      }
      if (country) {
        where += ' AND country = ?';
        params.push(country);
      }

      const accounts = db.prepare(`
        SELECT instagram_username, full_name, bio, category, business_type,
               external_url, best_email, email_source, email_confidence,
               business_email, is_business, follower_count, following_count,
               scraping_status, existing_lead_email, country
        FROM instagram_scraped_accounts
        ${where}
        ORDER BY full_name ASC
      `).all(...params);

      // Générer CSV
      const headers = [
        'Username', 'Nom complet', 'Bio', 'Catégorie', 'Type business', 'Pays',
        'Site web', 'Email', 'Source email', 'Confiance', 'Email business IG',
        'Compte business', 'Followers', 'Following', 'Statut', 'Doublon lead'
      ];

      const rows = accounts.map(a => [
        `@${a.instagram_username}`,
        a.full_name || '',
        (a.bio || '').replace(/[\n\r,]/g, ' ').slice(0, 200),
        a.category || '',
        a.business_type || '',
        a.country || '',
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

  // ─── Endpoints unifiés (cross-jobs) ─────────────────────────────────────────

  /**
   * Helper : ajoute un filtre multi-valeurs (comma-separated) à la clause WHERE
   */
  function addMultiFilter(where, params, value, column) {
    if (!value) return where;
    const values = value.split(',').map(v => v.trim()).filter(Boolean);
    if (values.length === 0) return where;
    const placeholders = values.map(() => '?').join(',');
    where += ` AND ${column} IN (${placeholders})`;
    params.push(...values);
    return where;
  }

  // GET /api/instagram/accounts/all — Tous les comptes cross-jobs avec filtres
  router.get('/accounts/all', (req, res) => {
    try {
      const { search, business_type, has_email, country, status, has_contacts, source, sort_column, sort_direction, limit = 200, offset = 0 } = req.query;

      let where = 'WHERE 1=1';
      const params = [];

      if (search) {
        where += ' AND (a.instagram_username LIKE ? OR a.full_name LIKE ? OR a.bio LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s);
      }

      where = addMultiFilter(where, params, business_type, 'a.business_type');
      where = addMultiFilter(where, params, country, 'a.country');
      where = addMultiFilter(where, params, status, 'a.scraping_status');
      where = addMultiFilter(where, params, source, 'j.instagram_username');

      if (has_email === 'true') {
        where += ' AND a.best_email IS NOT NULL';
      } else if (has_email === 'false') {
        where += ' AND a.best_email IS NULL';
      }

      if (has_contacts === 'true') {
        where += " AND a.linkedin_contacts IS NOT NULL AND a.linkedin_contacts != '[]'";
      } else if (has_contacts === 'false') {
        where += " AND (a.linkedin_contacts IS NULL OR a.linkedin_contacts = '[]')";
      }

      const statsRow = db.prepare(`
        SELECT COUNT(*) as total,
          SUM(CASE WHEN a.best_email IS NOT NULL AND a.best_email != '' THEN 1 ELSE 0 END) as with_email,
          SUM(CASE WHEN a.business_type = 'hotel' AND a.best_email IS NOT NULL AND a.best_email != '' THEN 1 ELSE 0 END) as hotels_with_email,
          SUM(CASE WHEN a.business_type = 'sport' AND a.best_email IS NOT NULL AND a.best_email != '' THEN 1 ELSE 0 END) as sport_with_email
        FROM instagram_scraped_accounts a
        LEFT JOIN instagram_scrape_jobs j ON a.job_id = j.id
        ${where}
      `).get(...params);
      const total = statsRow.total;

      // Tri dynamique
      const SORTABLE_COLUMNS = ['full_name', 'instagram_username', 'business_type', 'country', 'best_email', 'follower_count', 'following_count', 'scraping_status', 'created_at', 'city_name', 'source_account'];
      let orderClause = `ORDER BY
          CASE WHEN a.best_email IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN a.business_type IS NOT NULL THEN 0 ELSE 1 END,
          a.full_name ASC`;

      if (sort_column && SORTABLE_COLUMNS.includes(sort_column)) {
        const dir = sort_direction === 'desc' ? 'DESC' : 'ASC';
        const col = sort_column === 'source_account' ? 'j.instagram_username' : `a.${sort_column}`;
        orderClause = `ORDER BY ${col} ${dir} NULLS LAST`;
      }

      const accounts = db.prepare(`
        SELECT a.*, j.instagram_username AS source_account
        FROM instagram_scraped_accounts a
        LEFT JOIN instagram_scrape_jobs j ON a.job_id = j.id
        ${where}
        ${orderClause}
        LIMIT ? OFFSET ?
      `).all(...params, parseInt(limit), parseInt(offset));

      res.json({ accounts, total, stats: { total: statsRow.total, with_email: statsRow.with_email, hotels_with_email: statsRow.hotels_with_email, sport_with_email: statsRow.sport_with_email } });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/instagram/filter-options — Options disponibles pour multi-selects
  router.get('/filter-options', (req, res) => {
    try {
      const sources = db.prepare(`
        SELECT DISTINCT j.instagram_username
        FROM instagram_scrape_jobs j
        INNER JOIN instagram_scraped_accounts a ON a.job_id = j.id
        WHERE j.instagram_username IS NOT NULL
        ORDER BY j.instagram_username ASC
      `).all().map(r => r.instagram_username);

      const countries = db.prepare(`
        SELECT DISTINCT country
        FROM instagram_scraped_accounts
        WHERE country IS NOT NULL AND country != ''
        ORDER BY country ASC
      `).all().map(r => r.country);

      const types = db.prepare(`
        SELECT DISTINCT business_type
        FROM instagram_scraped_accounts
        WHERE business_type IS NOT NULL AND business_type != ''
        ORDER BY business_type ASC
      `).all().map(r => r.business_type);

      res.json({ sources, countries, types });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/instagram/accounts/all/export — Export CSV cross-jobs
  router.get('/accounts/all/export', (req, res) => {
    try {
      const { search, business_type, has_email, country, status, has_contacts, source } = req.query;

      let where = 'WHERE 1=1';
      const params = [];

      if (search) {
        where += ' AND (a.instagram_username LIKE ? OR a.full_name LIKE ? OR a.bio LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s);
      }

      where = addMultiFilter(where, params, business_type, 'a.business_type');
      where = addMultiFilter(where, params, country, 'a.country');
      where = addMultiFilter(where, params, status, 'a.scraping_status');
      where = addMultiFilter(where, params, source, 'j.instagram_username');

      if (has_email === 'true') {
        where += ' AND a.best_email IS NOT NULL';
      } else if (has_email === 'false') {
        where += ' AND a.best_email IS NULL';
      }

      if (has_contacts === 'true') {
        where += " AND a.linkedin_contacts IS NOT NULL AND a.linkedin_contacts != '[]'";
      } else if (has_contacts === 'false') {
        where += " AND (a.linkedin_contacts IS NULL OR a.linkedin_contacts = '[]')";
      }

      const accounts = db.prepare(`
        SELECT a.instagram_username, a.full_name, a.bio, a.category, a.business_type,
               a.external_url, a.best_email, a.email_source, a.email_confidence,
               a.business_email, a.is_business, a.follower_count, a.following_count,
               a.scraping_status, a.existing_lead_email, a.country,
               j.instagram_username AS source_account
        FROM instagram_scraped_accounts a
        LEFT JOIN instagram_scrape_jobs j ON a.job_id = j.id
        ${where}
        ORDER BY a.full_name ASC
      `).all(...params);

      const headers = [
        'Username', 'Nom complet', 'Bio', 'Catégorie', 'Type business', 'Pays', 'Source',
        'Site web', 'Email', 'Source email', 'Confiance', 'Email business IG',
        'Compte business', 'Followers', 'Following', 'Statut', 'Doublon lead'
      ];

      const rows = accounts.map(a => [
        `@${a.instagram_username}`,
        a.full_name || '',
        (a.bio || '').replace(/[\n\r,]/g, ' ').slice(0, 200),
        a.category || '',
        a.business_type || '',
        a.country || '',
        a.source_account ? `@${a.source_account}` : '',
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

      const filename = `instagram_all_${new Date().toISOString().slice(0, 10)}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\ufeff' + csv);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
