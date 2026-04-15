/**
 * imports.js — Routes pour gestion des imports multi-sources avec scraping flexible
 */

const express = require('express');
const multer = require('multer');
const { randomUUID } = require('crypto');
const fs = require('fs');
const csv = require('csv-parse/sync');
const chardet = require('chardet');
const logger = require('../config/logger');

const upload = multer({ dest: 'uploads/' });

module.exports = (db) => {
  const router = express.Router();

  // ──────────────────────────────────────────────────────────────────────────────
  // Utilitaires validation et classification emails
  // ──────────────────────────────────────────────────────────────────────────────

  const INVALID_EMAIL_PATTERNS = [
    /^(test|exemple|example|sample|john|demo|noreply|no-reply)@/i,
    /\.(png|jpg|jpeg|gif|webp|svg|pdf)(@|\.)/i,
    /@(sentry|wix|mailgun|sendgrid|postmark|vercel|heroku)/i,
    /@\d{2}[a-zA-Z]{2}\d{2}/,  // Patterns bizarres type L2dbDo2@07hYnQDI
    /^[^@]+@[^.]+$/,            // Pas de TLD
    /@[^.]*\.(bDo|wf|local|test|invalid)$/i, // TLDs invalides
  ];

  const GENERIC_PATTERNS = [
    /^(contact|info|reservation|booking|mail|admin|support|service|communication|accueil|reception|hotel)@/i,
  ];

  function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    email = email.trim().toLowerCase();

    // Pattern basique email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;

    // Filtrer les patterns invalides
    for (const pattern of INVALID_EMAIL_PATTERNS) {
      if (pattern.test(email)) return false;
    }

    return true;
  }

  function classifyEmailType(email) {
    if (!email) return null;
    email = email.trim().toLowerCase();

    // Tester si email générique
    for (const pattern of GENERIC_PATTERNS) {
      if (pattern.test(email)) return 'generic';
    }

    // Si contient prénom.nom@ ou initiale, probablement personnel
    if (/^[a-z]+\.[a-z]+@/i.test(email) || /^[a-z]\.[a-z]+@/i.test(email)) {
      return 'personal';
    }

    // Par défaut, considérer comme générique
    return 'generic';
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Gestion email_registry
  // ──────────────────────────────────────────────────────────────────────────────

  function upsertEmailRegistry(email, sourceInfo) {
    const emailType = classifyEmailType(email);

    const existing = db.prepare('SELECT * FROM email_registry WHERE email = ?').get(email);

    if (existing) {
      // Ajouter la source si pas déjà présente
      const sources = JSON.parse(existing.sources || '[]');
      if (!sources.find(s => s.source_id === sourceInfo.source_id && s.prospect_id === sourceInfo.prospect_id)) {
        sources.push(sourceInfo);
      }

      db.prepare(`
        UPDATE email_registry
        SET sources = ?, last_updated = datetime('now')
        WHERE email = ?
      `).run(JSON.stringify(sources), email);
    } else {
      // Créer nouvelle entrée
      db.prepare(`
        INSERT INTO email_registry (email, email_type, sources, first_seen_date, last_updated)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(email, emailType, JSON.stringify([sourceInfo]));
    }
  }

  function checkEmailHistory(email) {
    const registry = db.prepare('SELECT * FROM email_registry WHERE email = ?').get(email);
    if (!registry) return { exists: false };

    return {
      exists: true,
      email_type: registry.email_type,
      sources: JSON.parse(registry.sources || '[]'),
      last_sequence_date: registry.last_sequence_date,
      last_campaign_date: registry.last_campaign_date,
      total_emails_sent: registry.total_emails_sent,
      is_lead: registry.is_lead === 1,
      lead_id: registry.lead_id,
      is_unsubscribed: registry.is_unsubscribed === 1,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Routes
  // ──────────────────────────────────────────────────────────────────────────────

  // GET /api/imports/sources - Liste des sources importées
  router.get('/sources', (req, res) => {
    try {
      const sources = db.prepare(`
        SELECT
          s.*,
          COUNT(p.id) as prospects_count,
          SUM(CASE WHEN p.scraping_status = 'completed' THEN 1 ELSE 0 END) as scraped_count
        FROM import_sources s
        LEFT JOIN imported_prospects p ON p.source_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at DESC
      `).all();

      res.json({ sources });
    } catch (err) {
      logger.error('Erreur liste sources:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/imports/upload - Upload CSV avec détection colonnes
  router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier uploadé' });
      }

      const { sourceName, scrapingEnabled, scrapingConfig, columnMapping } = req.body;

      if (!sourceName) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Nom de source requis' });
      }

      // Parser le columnMapping
      const mapping = columnMapping ? JSON.parse(columnMapping) : {};

      // Lire et détecter encoding
      const rawData = fs.readFileSync(req.file.path);
      const encoding = chardet.detect(rawData);
      logger.info(`Upload CSV: encodage=${encoding}`);

      // Normaliser retours à la ligne
      let content = rawData.toString(encoding === 'ISO-8859-1' ? 'latin1' : 'utf8');
      content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Parser CSV
      const records = csv.parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });

      if (records.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'CSV vide' });
      }

      // Détecter colonnes
      const colonnes = Object.keys(records[0]);

      // Utiliser le mapping fourni ou auto-détecter
      const emailColumn = mapping.email || colonnes.find(c =>
        /^(email|e-mail|mail|contact_email|adresse_email)$/i.test(c)
      );

      // Créer source avec mapping
      const sourceId = randomUUID();
      const scrapingConfigParsed = scrapingConfig ? JSON.parse(scrapingConfig) : null;

      db.prepare(`
        INSERT INTO import_sources (
          id, nom, type, colonnes, scraping_enabled, scraping_config,
          scraping_status, total_records, import_date
        ) VALUES (?, ?, 'csv_import', ?, ?, ?, 'pending', ?, datetime('now'))
      `).run(
        sourceId,
        sourceName,
        JSON.stringify({ columns: colonnes, mapping }), // Stocker colonnes + mapping
        scrapingEnabled === 'true' ? 1 : 0,
        scrapingConfigParsed ? JSON.stringify(scrapingConfigParsed) : null,
        records.length
      );

      // Insérer prospects
      const batchId = randomUUID();
      let validEmails = 0;
      let invalidEmails = 0;
      let duplicates = 0;

      const stmtInsert = db.prepare(`
        INSERT INTO imported_prospects (id, source_id, email, data, import_batch, scraping_status)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const record of records) {
        const prospectId = randomUUID();
        const email = emailColumn ? record[emailColumn] : null;

        // Valider email si présent
        let validEmail = null;
        if (email && isValidEmail(email)) {
          validEmail = email.trim().toLowerCase();
          validEmails++;
        } else if (email) {
          invalidEmails++;
        }

        // Extraire les champs mappés pour accès rapide
        const mappedFields = {
          nom: mapping.nom ? record[mapping.nom] : null,
          email: validEmail,
          site_web: mapping.site_web ? record[mapping.site_web] : null,
          ville: mapping.ville ? record[mapping.ville] : null,
          telephone: mapping.telephone ? record[mapping.telephone] : null,
          adresse: mapping.adresse ? record[mapping.adresse] : null,
        };

        // Stocker avec champs mappés + données brutes
        const dataToStore = {
          _mapped: mappedFields,  // Champs mappés pour accès rapide
          _raw: record,            // Données brutes complètes
        };

        // Insérer prospect
        stmtInsert.run(
          prospectId,
          sourceId,
          validEmail,
          JSON.stringify(dataToStore),
          batchId,
          scrapingEnabled === 'true' ? 'pending' : 'skipped'
        );

        // Ajouter à email_registry si email valide
        if (validEmail) {
          const history = checkEmailHistory(validEmail);
          if (history.exists) {
            duplicates++;
          }

          upsertEmailRegistry(validEmail, {
            type: 'csv',
            source_id: sourceId,
            prospect_id: prospectId,
          });
        }
      }

      // Cleanup
      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        source_id: sourceId,
        source_name: sourceName,
        total_records: records.length,
        valid_emails: validEmails,
        invalid_emails: invalidEmails,
        duplicates,
        colonnes,
        email_column: emailColumn || null,
        scraping_enabled: scrapingEnabled === 'true',
      });

    } catch (err) {
      logger.error('Erreur upload CSV:', err);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/imports/sources/:id/prospects - Liste prospects d'une source
  router.get('/sources/:id/prospects', (req, res) => {
    try {
      const { id } = req.params;
      const { search, limit = 100, offset = 0 } = req.query;

      let query = `
        SELECT
          p.*,
          er.email_type,
          er.is_lead,
          er.is_unsubscribed,
          er.last_sequence_date,
          er.last_campaign_date,
          er.total_emails_sent,
          er.sources as email_sources
        FROM imported_prospects p
        LEFT JOIN email_registry er ON er.email = p.email
        WHERE p.source_id = ?
      `;
      const params = [id];

      if (search) {
        query += ` AND (p.email LIKE ? OR p.data LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`);
      }

      query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
      params.push(parseInt(limit), parseInt(offset));

      const prospects = db.prepare(query).all(...params);

      // Parser data JSON
      prospects.forEach(p => {
        if (p.data) p.data = JSON.parse(p.data);
        if (p.scraped_data) p.scraped_data = JSON.parse(p.scraped_data);
        if (p.email_sources) p.email_sources = JSON.parse(p.email_sources);
      });

      const total = db.prepare('SELECT COUNT(*) as n FROM imported_prospects WHERE source_id = ?').get(id).n;

      res.json({ prospects, total });
    } catch (err) {
      logger.error('Erreur liste prospects:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/imports/email-check/:email - Vérifier historique d'un email
  router.get('/email-check/:email', (req, res) => {
    try {
      const { email } = req.params;
      const history = checkEmailHistory(email);
      res.json(history);
    } catch (err) {
      logger.error('Erreur check email:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/imports/validate-emails - Valider et classifier une liste d'emails
  router.post('/validate-emails', (req, res) => {
    try {
      const { emails } = req.body;

      if (!Array.isArray(emails)) {
        return res.status(400).json({ error: 'Format invalide' });
      }

      const results = emails.map(email => ({
        email,
        valid: isValidEmail(email),
        type: isValidEmail(email) ? classifyEmailType(email) : null,
        history: isValidEmail(email) ? checkEmailHistory(email) : null,
      }));

      res.json({ results });
    } catch (err) {
      logger.error('Erreur validation emails:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/imports/sources/:id - Supprimer une source
  router.delete('/sources/:id', (req, res) => {
    try {
      const { id } = req.params;

      // Cascade delete via foreign key
      db.prepare('DELETE FROM import_sources WHERE id = ?').run(id);

      res.json({ success: true });
    } catch (err) {
      logger.error('Erreur suppression source:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
