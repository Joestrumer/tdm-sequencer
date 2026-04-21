/**
 * prospection.js — Routes pour la prospection automatisée des hôtels français
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../config/logger');
const scraperService = require('../services/hotelScraperService');
const linkedinService = require('../services/linkedinScraperService');
const emailFinderService = require('../services/emailFinderService');
const { v4: uuidv4 } = require('uuid');

// Configuration multer pour upload CSV
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

module.exports = (db) => {

  // ──────────────────────────────────────────────────────────────────────────────
  // Helper : Classification email et gestion email_registry
  // ──────────────────────────────────────────────────────────────────────────────

  const GENERIC_PATTERNS = [
    /^contact@/i, /^info@/i, /^reservation@/i, /^booking@/i, /^mail@/i,
    /^admin@/i, /^support@/i, /^service@/i, /^communication@/i,
    /^accueil@/i, /^reception@/i, /^hotel@/i, /^manager@/i,
  ];

  function classifyEmailType(email) {
    if (!email || typeof email !== 'string') return 'generic';

    for (const pattern of GENERIC_PATTERNS) {
      if (pattern.test(email)) return 'generic';
    }

    // Si contient prénom.nom@ ou initiale, probablement personnel
    if (/^[a-z]+\.[a-z]+@/i.test(email) || /^[a-z]\.[a-z]+@/i.test(email)) {
      return 'personal';
    }

    return 'generic';
  }

  function upsertLinkedInEmailRegistry(email, sourceInfo) {
    const emailType = classifyEmailType(email);
    const existing = db.prepare('SELECT * FROM email_registry WHERE email = ?').get(email);

    if (existing) {
      // Ajouter la source LinkedIn si pas déjà présente
      let sources = [];
      try { sources = JSON.parse(existing.sources || '[]'); } catch { sources = []; }
      if (!Array.isArray(sources)) sources = [];

      const alreadyExists = sources.find(s =>
        s.type === 'linkedin' &&
        s.hotel_id === sourceInfo.hotel_id &&
        s.linkedin_url === sourceInfo.linkedin_url
      );

      if (!alreadyExists) {
        sources.push(sourceInfo);
        db.prepare(`
          UPDATE email_registry
          SET sources = ?, last_updated = datetime('now')
          WHERE email = ?
        `).run(JSON.stringify(sources), email);
      }
    } else {
      // Créer nouvelle entrée
      db.prepare(`
        INSERT INTO email_registry (email, email_type, sources, is_lead, created_at, last_updated)
        VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))
      `).run(email, emailType, JSON.stringify([sourceInfo]));
    }
  }

  // POST /api/prospection/import — Import CSV des hôtels français
  router.post('/import', upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ erreur: 'Aucun fichier fourni' });
    }

    const results = [];
    const errors = [];
    let lineNumber = 0;
    let firstRow = null;

    try {
      // Détection encodage avec chardet (fiable pour CSV français)
      const chardet = require('chardet');
      const rawBuffer = fs.readFileSync(req.file.path);
      const detected = chardet.detect(rawBuffer) || 'utf-8';
      const isLatin = detected.includes('ISO-8859') || detected.includes('windows') || detected.includes('Windows');
      const encoding = isLatin ? 'latin1' : 'utf8';
      let rawData = rawBuffer.toString(encoding);
      logger.info(`📄 Encodage détecté: ${detected} → utilisation ${encoding}`);

      // Analyser les retours à la ligne
      const hasLF = rawData.includes('\n');
      const hasCR = rawData.includes('\r');
      const linebreakType = hasLF && hasCR ? 'CRLF' : hasLF ? 'LF' : hasCR ? 'CR' : 'NONE';

      logger.info(`📄 Analyse fichier CSV: encodage=${encoding}, retours à la ligne=${linebreakType}`);

      // Normaliser les retours à la ligne (CR seul → LF, CRLF → LF)
      let normalizedData = rawData.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // Détecter le séparateur
      const sampleData = normalizedData.slice(0, 2000);
      const separator = sampleData.includes(';') && sampleData.split(';').length > sampleData.split(',').length ? ';' : ',';

      // Compter les lignes attendues
      const lines = normalizedData.split('\n').filter(l => l.trim().length > 0);
      logger.info(`Import CSV: séparateur="${separator}", ${lines.length} ligne(s) détectée(s)`);

      // Si moins de 5 lignes, c'est probablement un problème
      if (lines.length < 5) {
        logger.warn(`⚠️ Fichier CSV suspect: seulement ${lines.length} ligne(s). Vérifiez le format du fichier.`);
      }

      // Sauvegarder le fichier normalisé temporairement
      const normalizedPath = req.file.path + '.normalized';
      fs.writeFileSync(normalizedPath, normalizedData, 'utf8');

      // Lecture et parsing du CSV (utiliser le fichier normalisé)
      await new Promise((resolve, reject) => {
        fs.createReadStream(normalizedPath, { encoding: 'utf8' })
          .pipe(csv({
            separator,
            skipEmptyLines: true,
            trim: true,
            strict: false // Mode permissif pour gérer les CSV malformés
          }))
          .on('data', (row) => {
            lineNumber++;

            // Log première ligne pour debug
            if (lineNumber === 1) {
              firstRow = Object.keys(row);
              logger.info('Colonnes CSV détectées:', firstRow);
            }

            try {
              // Mapping des colonnes CSV vers la base de données
              const hotel = {
                date_classement: row['DATE DE CLASSEMENT'] || null,
                type_hebergement: row["TYPE D'HÉBERGEMENT"] || null,
                classement: row['CLASSEMENT'] || null,
                categorie: row['CATÉGORIE'] || null,
                mention: row['MENTION'] || null,
                nom_commercial: row['NOM COMMERCIAL']?.trim(),
                adresse: row['ADRESSE'] || null,
                code_postal: row['CODE POSTAL'] || null,
                commune: row['COMMUNE'] || null,
                site_internet: row['SITE INTERNET'] || null,
                type_sejour: row['TYPE DE SÉJOUR'] || null,
                capacite_accueil: parseInt(row["CAPACITÉ D'ACCUEIL (PERSONNES)"]) || null,
                nombre_chambres: parseInt(row['NOMBRE DE CHAMBRES']) || null,
                nombre_emplacements: parseInt(row['NOMBRE D\'EMPLACEMENTS']) || null,
                nombre_unites: parseInt(row["NOMBRE D'UNITÉS D'HABITATION"]) || null,
                nombre_logements: parseInt(row['NOMBRE DE LOGEMENTS']) || null,
                classement_proroge: row['classement prorogé'] || null
              };

              // Validation: nom_commercial est requis
              if (!hotel.nom_commercial) {
                if (lineNumber <= 5) {
                  errors.push({ line: lineNumber, error: 'NOM COMMERCIAL manquant', row: Object.keys(row).slice(0, 3) });
                }
                return;
              }

              results.push(hotel);
            } catch (err) {
              if (lineNumber <= 10) {
                errors.push({ line: lineNumber, error: err.message });
              }
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });

      // Suppression des fichiers temporaires
      fs.unlinkSync(req.file.path);
      if (fs.existsSync(normalizedPath)) {
        fs.unlinkSync(normalizedPath);
      }

      if (results.length === 0) {
        return res.status(400).json({
          error: 'Aucune donnée valide à importer',
          errors
        });
      }

      // Insertion dans la base de données
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO hotels_france (
          date_classement, type_hebergement, classement, categorie, mention,
          nom_commercial, adresse, code_postal, commune, site_internet,
          type_sejour, capacite_accueil, nombre_chambres, nombre_emplacements,
          nombre_unites, nombre_logements, classement_proroge
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let imported = 0;
      let duplicates = 0;

      const insertMany = db.transaction((hotels) => {
        for (const hotel of hotels) {
          const result = insertStmt.run(
            hotel.date_classement,
            hotel.type_hebergement,
            hotel.classement,
            hotel.categorie,
            hotel.mention,
            hotel.nom_commercial,
            hotel.adresse,
            hotel.code_postal,
            hotel.commune,
            hotel.site_internet,
            hotel.type_sejour,
            hotel.capacite_accueil,
            hotel.nombre_chambres,
            hotel.nombre_emplacements,
            hotel.nombre_unites,
            hotel.nombre_logements,
            hotel.classement_proroge
          );
          if (result.changes > 0) {
            imported++;
          } else {
            duplicates++;
          }
        }
      });

      insertMany(results);

      logger.info(`Import CSV: ${imported} hôtels importés, ${duplicates} doublons ignorés`);

      res.json({
        success: true,
        imported,
        duplicates,
        total: results.length,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (err) {
      logger.error('Erreur import CSV:', err);
      // Nettoyage des fichiers temporaires en cas d'erreur
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      const normalizedPath = req.file?.path + '.normalized';
      if (normalizedPath && fs.existsSync(normalizedPath)) {
        fs.unlinkSync(normalizedPath);
      }
      res.status(500).json({ erreur: 'Erreur lors de l\'import du CSV', details: err.message });
    }
  });

  // GET /api/prospection/hotels — Liste des hôtels avec filtres
  router.get('/hotels', (req, res) => {
    try {
      const {
        classement,
        commune,
        code_postal,
        type_hebergement,
        capacite_min,
        capacite_max,
        chambres_min,
        chambres_max,
        scraping_status,
        imported,
        search,
        linkedin_contacts,
        limit = 100,
        offset = 0
      } = req.query;

      let query = 'SELECT * FROM hotels_france WHERE 1=1';
      const params = [];

      if (classement) {
        query += ' AND classement = ?';
        params.push(classement);
      }
      if (commune) {
        query += ' AND commune LIKE ?';
        params.push(`%${commune}%`);
      }
      if (code_postal) {
        query += ' AND code_postal = ?';
        params.push(code_postal);
      }
      if (type_hebergement) {
        query += ' AND type_hebergement = ?';
        params.push(type_hebergement);
      }
      if (capacite_min) {
        query += ' AND capacite_accueil >= ?';
        params.push(parseInt(capacite_min));
      }
      if (capacite_max) {
        query += ' AND capacite_accueil <= ?';
        params.push(parseInt(capacite_max));
      }
      if (chambres_min) {
        query += ' AND nombre_chambres >= ?';
        params.push(parseInt(chambres_min));
      }
      if (chambres_max) {
        query += ' AND nombre_chambres <= ?';
        params.push(parseInt(chambres_max));
      }
      if (scraping_status) {
        query += ' AND scraping_status = ?';
        params.push(scraping_status);
      }
      if (imported !== undefined) {
        query += ' AND imported_as_lead = ?';
        params.push(imported === 'true' ? 1 : 0);
      }
      if (search) {
        query += ' AND (nom_commercial LIKE ? OR adresse LIKE ? OR commune LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s);
      }
      if (linkedin_contacts === 'true') {
        query += ' AND linkedin_contacts IS NOT NULL AND linkedin_contacts != \'[]\'';
      }

      // Comptage total
      const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
      const total = db.prepare(countQuery).get(...params).total;

      // Pagination (validée)
      const safeLim = Math.min(Math.max(parseInt(limit) || 100, 1), 1000);
      const safeOff = Math.max(parseInt(offset) || 0, 0);
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(safeLim, safeOff);

      const hotels = db.prepare(query).all(...params);

      // Stats globales
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN scraping_status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN scraping_status = 'success' THEN 1 ELSE 0 END) as scraped,
          SUM(CASE WHEN scraping_status = 'error' THEN 1 ELSE 0 END) as errors,
          SUM(CASE WHEN imported_as_lead = 1 THEN 1 ELSE 0 END) as imported_as_leads
        FROM hotels_france
      `).get();

      res.json({ hotels, total, stats });
    } catch (err) {
      logger.error('Erreur GET /hotels:', err);
      res.status(500).json({ erreur: 'Erreur lors de la récupération des hôtels' });
    }
  });

  // GET /api/prospection/stats — Statistiques globales
  router.get('/stats', (req, res) => {
    try {
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total_hotels,
          COUNT(DISTINCT classement) as nb_classements,
          COUNT(DISTINCT type_hebergement) as nb_types,
          COUNT(DISTINCT commune) as nb_communes,
          SUM(CASE WHEN scraping_status = 'pending' THEN 1 ELSE 0 END) as a_scraper,
          SUM(CASE WHEN scraping_status = 'success' THEN 1 ELSE 0 END) as scrapes_ok,
          SUM(CASE WHEN scraping_status = 'error' THEN 1 ELSE 0 END) as scrapes_erreur,
          SUM(CASE WHEN imported_as_lead = 1 THEN 1 ELSE 0 END) as convertis_leads,
          SUM(CASE WHEN contact_email IS NOT NULL THEN 1 ELSE 0 END) as avec_email
        FROM hotels_france
      `).get();

      const byClassement = db.prepare(`
        SELECT classement, COUNT(*) as count
        FROM hotels_france
        WHERE classement IS NOT NULL
        GROUP BY classement
        ORDER BY classement DESC
      `).all();

      const byType = db.prepare(`
        SELECT type_hebergement, COUNT(*) as count
        FROM hotels_france
        WHERE type_hebergement IS NOT NULL
        GROUP BY type_hebergement
        ORDER BY count DESC
      `).all();

      res.json({ stats, byClassement, byType });
    } catch (err) {
      logger.error('Erreur GET /stats:', err);
      res.status(500).json({ erreur: 'Erreur lors de la récupération des statistiques' });
    }
  });

  // POST /api/prospection/scrape — Lance le scraping pour une sélection d'hôtels
  router.post('/scrape', async (req, res) => {
    const { hotel_ids } = req.body;

    if (!hotel_ids || !Array.isArray(hotel_ids) || hotel_ids.length === 0) {
      return res.status(400).json({ erreur: 'hotel_ids requis (array)' });
    }

    logger.info(`🔍 Lancement scraping pour ${hotel_ids.length} hôtels`);

    try {
      // Lancer le scraping en background (async sans await)
      // Pour éviter le timeout de la requête HTTP, on retourne immédiatement
      // et le scraping se poursuit en arrière-plan

      scrapeBatchAsync(db, hotel_ids);

      res.json({
        success: true,
        queued: hotel_ids.length,
        message: `Scraping lancé pour ${hotel_ids.length} hôtel(s)`,
      });

    } catch (err) {
      logger.error('Erreur POST /scrape:', err);
      res.status(500).json({ erreur: 'Erreur lors du lancement du scraping' });
    }
  });

  // GET /api/prospection/scrape-status — Statut du scraping en cours
  router.get('/scrape-status', (req, res) => {
    try {
      const processing = db.prepare(`
        SELECT COUNT(*) as count FROM hotels_france WHERE scraping_status = 'processing'
      `).get();

      const recent = db.prepare(`
        SELECT id, nom_commercial, scraping_status, scraping_error, scraping_date
        FROM hotels_france
        WHERE scraping_date >= datetime('now', '-1 hour')
        ORDER BY scraping_date DESC
        LIMIT 50
      `).all();

      res.json({
        processing: processing.count,
        recent,
      });
    } catch (err) {
      logger.error('Erreur GET /scrape-status:', err);
      res.status(500).json({ erreur: 'Erreur lors de la récupération du statut' });
    }
  });

  // POST /api/prospection/create-leads — Convertit des hôtels scrapés en leads
  router.post('/create-leads', (req, res) => {
    const { hotel_ids } = req.body;

    if (!hotel_ids || !Array.isArray(hotel_ids) || hotel_ids.length === 0) {
      return res.status(400).json({ erreur: 'hotel_ids requis (array)' });
    }

    try {
      // Récupérer les hôtels avec contact_email
      const placeholders = hotel_ids.map(() => '?').join(',');
      const hotels = db.prepare(`
        SELECT * FROM hotels_france
        WHERE id IN (${placeholders})
          AND contact_email IS NOT NULL
          AND imported_as_lead = 0
      `).all(...hotel_ids);

      if (hotels.length === 0) {
        return res.json({
          success: true,
          created: 0,
          message: 'Aucun hôtel éligible (contact_email manquant ou déjà converti)',
        });
      }

      const createLead = db.prepare(`
        INSERT INTO leads (
          id, prenom, nom, email, hotel, ville, segment,
          poste, langue, source, statut, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      const markHotel = db.prepare(`
        UPDATE hotels_france
        SET imported_as_lead = 1, lead_id = ?
        WHERE id = ?
      `);

      let created = 0;
      let errors = [];
      const leadIds = []; // Collecter les IDs des leads créés

      const transaction = db.transaction((hotelsToConvert) => {
        for (const hotel of hotelsToConvert) {
          try {
            const leadId = uuidv4();

            // Mapper classement vers segment
            let segment = '3*'; // Par défaut
            if (hotel.classement) {
              if (hotel.classement.includes('5')) segment = '5*';
              else if (hotel.classement.includes('4')) segment = '4*';
              else if (hotel.classement.includes('3')) segment = '3*';
              else if (hotel.classement.includes('2')) segment = '2*';
              else if (hotel.classement.includes('1')) segment = '1*';
            }

            // Déterminer si c'est un email personnel ou générique
            const isGeneric = /^(contact|info|reservation|booking|mail|admin|support|service|communication|accueil|reception|hotel)@/i.test(hotel.contact_email);

            // Créer le lead
            createLead.run(
              leadId,
              isGeneric ? '' : (hotel.contact_prenom || ''),
              isGeneric ? hotel.nom_commercial : (hotel.contact_nom || hotel.nom_commercial),
              hotel.contact_email,
              hotel.nom_commercial,
              hotel.commune,
              segment,
              isGeneric ? null : (hotel.contact_fonction || null),
              'fr',
              'Prospection automatique',
              'Nouveau'
            );

            // Marquer l'hôtel comme converti
            markHotel.run(leadId, hotel.id);

            leadIds.push(leadId); // Ajouter l'ID au tableau
            created++;
          } catch (err) {
            // Ignorer les erreurs de doublons (email déjà existant)
            if (err.message.includes('UNIQUE constraint')) {
              errors.push({ hotel: hotel.nom_commercial, error: 'Email déjà existant' });
            } else {
              errors.push({ hotel: hotel.nom_commercial, error: err.message });
            }
          }
        }
      });

      transaction(hotels);

      logger.info(`✅ ${created} hôtel(s) converti(s) en leads`);

      res.json({
        success: true,
        created,
        total: hotels.length,
        lead_ids: leadIds, // Retourner les IDs des leads créés
        errors: errors.length > 0 ? errors : undefined,
      });

    } catch (err) {
      logger.error('Erreur POST /create-leads:', err);
      res.status(500).json({ erreur: 'Erreur lors de la création des leads' });
    }
  });

  // DELETE /api/prospection/reset — Vide les données CSV de hotels_france
  // PROTÈGE les contacts LinkedIn et emails scrapés
  router.delete('/reset', (req, res) => {
    try {
      // Compter les lignes avec et sans données de scraping
      const totalCount = db.prepare('SELECT COUNT(*) as n FROM hotels_france').get().n;
      const withScraping = db.prepare(`
        SELECT COUNT(*) as n FROM hotels_france
        WHERE (contact_email IS NOT NULL AND contact_email != '')
           OR (linkedin_contacts IS NOT NULL AND linkedin_contacts != '[]' AND linkedin_contacts != '')
           OR scraping_status IN ('success', 'completed')
      `).get().n;
      const withoutScraping = totalCount - withScraping;

      // Ne supprimer que les lignes SANS données de scraping
      const result = db.prepare(`
        DELETE FROM hotels_france
        WHERE (contact_email IS NULL OR contact_email = '')
          AND (linkedin_contacts IS NULL OR linkedin_contacts = '[]' OR linkedin_contacts = '')
          AND scraping_status NOT IN ('success', 'completed')
      `).run();

      // Pour les lignes avec scraping : reset les données CSV mais GARDER le scraping
      // (On ne fait PAS ça pour l'instant, on garde tout)

      logger.info(`🗑️ Reset hotels_france: ${result.changes} lignes supprimées, ${withScraping} lignes protégées (scraping)`);
      res.json({
        success: true,
        deleted: result.changes,
        protected: withScraping,
        message: withScraping > 0
          ? `${result.changes} hôtels supprimés. ${withScraping} hôtels avec contacts/emails conservés.`
          : `${result.changes} hôtels supprimés.`
      });
    } catch (err) {
      logger.error('Erreur DELETE /reset:', err);
      res.status(500).json({ erreur: 'Erreur lors de la suppression' });
    }
  });

  // PATCH /api/prospection/hotels/:id/contact — Met à jour le contact d'un hôtel
  router.patch('/hotels/:id/contact', (req, res) => {
    const { id } = req.params;
    const { contact_prenom, contact_nom, contact_email, contact_fonction, scraping_status } = req.body;

    try {
      db.prepare(`
        UPDATE hotels_france
        SET contact_prenom = ?,
            contact_nom = ?,
            contact_email = ?,
            contact_fonction = ?,
            scraping_status = ?,
            scraping_date = datetime('now')
        WHERE id = ?
      `).run(contact_prenom, contact_nom, contact_email, contact_fonction, scraping_status || 'success', id);

      res.json({ ok: true });
    } catch (err) {
      logger.error('Erreur PATCH /hotels/:id/contact:', err);
      res.status(500).json({ erreur: 'Erreur lors de la mise à jour' });
    }
  });

  // GET /api/prospection/emails-generiques — Liste des emails génériques scrappés
  router.get('/emails-generiques', (req, res) => {
    try {
      const { search, limit = 100, offset = 0 } = req.query;

      // Condition WHERE commune à la base query et count query
      let whereClause = 'WHERE h.contact_email IS NOT NULL AND h.contact_email != \'\'';
      const params = [];

      if (search) {
        whereClause += ' AND (h.nom_commercial LIKE ? OR h.commune LIKE ? OR h.contact_email LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s);
      }

      // Comptage total (requête simple sans JOIN)
      const total = db.prepare(`SELECT COUNT(*) as total FROM hotels_france h ${whereClause}`).get(...params).total;

      let query = `
        SELECT h.id, h.nom_commercial, h.commune, h.code_postal, h.site_internet,
               h.contact_email, h.scraping_date, h.classement, h.capacite_accueil,
               h.imported_as_lead, h.lead_id,
               r.is_lead as registry_is_lead,
               r.lead_id as registry_lead_id,
               l.statut as lead_statut
        FROM hotels_france h
        LEFT JOIN email_registry r ON r.email = h.contact_email
        LEFT JOIN leads l ON l.email = h.contact_email
        ${whereClause}
      `;

      // Pagination
      query += ' ORDER BY h.scraping_date DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

      const emails = db.prepare(query).all(...params);

      res.json({
        emails,
        total,
        stats: {
          total_emails: total,
          total_hotels: db.prepare('SELECT COUNT(*) as count FROM hotels_france WHERE contact_email IS NOT NULL AND contact_email != \'\'').get().count
        }
      });

    } catch (err) {
      logger.error('Erreur GET /emails-generiques:', err);
      res.status(500).json({ erreur: 'Erreur lors de la récupération des emails génériques' });
    }
  });

  // GET /api/prospection/contacts — Liste de tous les contacts LinkedIn trouvés
  router.get('/contacts', (req, res) => {
    try {
      const { search, avec_email, fonction, limit = 100, offset = 0 } = req.query;

      // Récupérer tous les hôtels avec des contacts LinkedIn
      let query = `
        SELECT id, nom_commercial, commune, site_internet,
               linkedin_contacts, linkedin_search_date,
               contact_email as email_generique
        FROM hotels_france
        WHERE linkedin_contacts IS NOT NULL
          AND linkedin_contacts != '[]'
      `;
      const params = [];

      if (search) {
        query += ' AND nom_commercial LIKE ?';
        params.push(`%${search}%`);
      }

      query += ' ORDER BY linkedin_search_date DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

      const hotels = db.prepare(query).all(...params);

      // Parser et aplatir les contacts + enrichir avec email_registry
      const allContacts = [];
      // Collecter tous les emails d'abord pour un batch lookup (évite N+1)
      const allEmails = [];
      const tempContacts = [];
      for (const hotel of hotels) {
        try {
          const contacts = JSON.parse(hotel.linkedin_contacts || '[]');
          for (const contact of contacts) {
            if (avec_email === 'true' && !contact.email) continue;
            if (fonction && !(contact.fonction || '').toLowerCase().includes(fonction.toLowerCase())) continue;
            tempContacts.push({ hotel, contact });
            if (contact.email) allEmails.push(contact.email);
          }
        } catch (err) {
          logger.warn(`Erreur parse contacts pour ${hotel.nom_commercial}:`, err.message);
        }
      }

      // Batch lookup leads par email (1 requête au lieu de N)
      const leadMap = new Map();
      if (allEmails.length > 0) {
        const placeholders = allEmails.map(() => '?').join(',');
        const leads = db.prepare(`SELECT id, email, statut FROM leads WHERE email IN (${placeholders})`).all(...allEmails);
        for (const l of leads) leadMap.set(l.email, l);
      }

      for (const { hotel, contact } of tempContacts) {
        const lead = contact.email ? leadMap.get(contact.email) : null;
        allContacts.push({
          hotel_id: hotel.id,
          hotel_nom: hotel.nom_commercial,
          hotel_commune: hotel.commune,
          email_generique: hotel.email_generique,
          ...contact,
          search_date: hotel.linkedin_search_date,
          is_lead: !!lead,
          lead_id: lead?.id || null,
          lead_statut: lead?.statut || null,
        });
      }

      // Stats
      const totalContacts = allContacts.length;
      const avecEmail = allContacts.filter(c => c.email).length;
      const sansEmail = totalContacts - avecEmail;

      res.json({
        contacts: allContacts,
        total: totalContacts,
        stats: {
          avec_email: avecEmail,
          sans_email: sansEmail,
          hotels: hotels.length,
        },
      });

    } catch (err) {
      logger.error('Erreur GET /contacts:', err);
      res.status(500).json({ erreur: 'Erreur lors de la récupération des contacts' });
    }
  });

  // POST /api/prospection/find-contacts — Recherche LinkedIn + ZeroBounce pour un hôtel
  router.post('/find-contacts', async (req, res) => {
    const { hotel_id } = req.body;

    if (!hotel_id) {
      return res.status(400).json({ erreur: 'hotel_id requis' });
    }

    try {
      // Récupérer l'hôtel
      const hotel = db.prepare('SELECT * FROM hotels_france WHERE id = ?').get(hotel_id);
      if (!hotel) {
        return res.status(404).json({ erreur: 'Hôtel non trouvé' });
      }

      if (!hotel.site_internet && !hotel.contact_email) {
        return res.json({ erreur: 'Pas de site internet ni email', contacts: [] });
      }

      // Extraire le domaine : priorité à l'email scrapé (plus fiable), sinon site web
      let domaine;
      const extensionsImages = ['.gif', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.bmp', '.ico'];

      if (hotel.contact_email && hotel.contact_email.includes('@')) {
        const domaineCandidat = hotel.contact_email.split('@')[1];
        // Vérifier que ce n'est pas un fichier image
        if (!extensionsImages.some(ext => domaineCandidat.toLowerCase().endsWith(ext))) {
          domaine = domaineCandidat;
          logger.info(`📧 Domaine extrait de l'email scrapé: ${domaine}`);
        } else {
          logger.warn(`⚠️ Domaine invalide détecté dans email (fichier image): ${domaineCandidat}`);
        }
      }

      if (!domaine && hotel.site_internet) {
        const domaineCandidat = hotel.site_internet.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        // Vérifier que ce n'est pas un fichier image
        if (!extensionsImages.some(ext => domaineCandidat.toLowerCase().endsWith(ext))) {
          domaine = domaineCandidat;
          logger.info(`🌐 Domaine extrait du site web: ${domaine}`);
        } else {
          logger.warn(`⚠️ Domaine invalide détecté dans site web (fichier image): ${domaineCandidat}`);
        }
      }

      if (!domaine) {
        return res.json({ erreur: 'Impossible d\'extraire un domaine valide', contacts: [] });
      }

      logger.info(`🔍 Recherche contacts LinkedIn pour ${hotel.nom_commercial}${hotel.commune ? ' (' + hotel.commune + ')' : ''}`);

      // Récupérer la clé Brave Search API si disponible
      const braveApiKey = process.env.BRAVE_SEARCH_API_KEY ||
        db.prepare("SELECT valeur FROM config WHERE cle = 'brave_search_api_key'").get()?.valeur ||
        null;

      // Récupérer la clé Pappers API si disponible
      const pappersApiKey = process.env.PAPPERS_API_KEY ||
        db.prepare("SELECT valeur FROM config WHERE cle = 'pappers_api_key'").get()?.valeur ||
        null;

      // Rechercher les contacts sur LinkedIn et Pappers (avec commune pour meilleurs résultats)
      const contacts = await linkedinService.rechercherContactsHotel(hotel.nom_commercial, braveApiKey, hotel.commune, pappersApiKey);

      if (contacts.length === 0) {
        return res.json({ message: 'Aucun contact trouvé', contacts: [] });
      }

      // Extraire prénom/nom pour chaque contact (sans chercher les emails)
      const results = contacts.map(contact => {
        const { prenom, nom } = linkedinService.extraireNomPrenom(contact.nom_complet);
        return {
          ...contact,
          prenom,
          nom,
          email: null,
          email_source: null,
          email_confidence: null,
          email_pattern: null,
        };
      });

      logger.info(`✅ ${results.length} contact(s) trouvé(s) (emails non recherchés - en attente de sélection utilisateur)`);

      // Mettre à jour la date de recherche (sans sauvegarder les contacts — seuls ceux sélectionnés pour recherche email seront sauvegardés)
      try {
        db.prepare(`
          UPDATE hotels_france
          SET linkedin_search_date = datetime('now')
          WHERE id = ?
        `).run(hotel.id);
      } catch (err) {
        logger.warn(`Erreur mise à jour date recherche:`, err.message);
      }

      // Trier par pertinence
      results.sort((a, b) => {
        if (a.pertinence === 'haute' && b.pertinence !== 'haute') return -1;
        if (a.pertinence !== 'haute' && b.pertinence === 'haute') return 1;
        return 0;
      });

      res.json({
        success: true,
        hotel: {
          id: hotel.id,
          nom: hotel.nom_commercial,
          domaine,
        },
        contacts: results,
        total: results.length,
      });

    } catch (err) {
      logger.error('Erreur POST /find-contacts:', err);
      res.status(500).json({ erreur: 'Erreur lors de la recherche de contacts', details: err.message });
    }
  });

  // POST /api/prospection/find-emails — Recherche emails pour des contacts sélectionnés
  router.post('/find-emails', async (req, res) => {
    const { hotel_id, contacts } = req.body;

    if (!hotel_id || !contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ erreur: 'hotel_id et contacts[] requis' });
    }

    try {
      const hotel = db.prepare('SELECT * FROM hotels_france WHERE id = ?').get(hotel_id);
      if (!hotel) {
        return res.status(404).json({ erreur: 'Hôtel non trouvé' });
      }

      // Extraire le domaine
      let domaine = null;
      const extensionsImages = ['.gif', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.bmp', '.ico'];
      if (hotel.contact_email && hotel.contact_email.includes('@')) {
        const domaineCandidat = hotel.contact_email.split('@')[1];
        if (!extensionsImages.some(ext => domaineCandidat.toLowerCase().endsWith(ext))) {
          domaine = domaineCandidat;
        }
      }
      if (!domaine && hotel.site_internet) {
        const domaineCandidat = hotel.site_internet.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        if (!extensionsImages.some(ext => domaineCandidat.toLowerCase().endsWith(ext))) {
          domaine = domaineCandidat;
        }
      }

      // Récupérer les clés API
      const lushaApiKey = process.env.LUSHA_API_KEY ||
        db.prepare("SELECT valeur FROM config WHERE cle = 'lusha_api_key'").get()?.valeur || null;
      const lemlistApiKey = process.env.LEMLIST_API_KEY ||
        db.prepare("SELECT valeur FROM config WHERE cle = 'lemlist_api_key'").get()?.valeur || null;
      const zbKey = process.env.ZEROBOUNCE_API_KEY ||
        db.prepare("SELECT valeur FROM config WHERE cle = 'zerobounce_api_key'").get()?.valeur || null;

      logger.info(`📧 Recherche emails pour ${contacts.length} contact(s) sélectionné(s) de ${hotel.nom_commercial}`);
      logger.info(`🔑 APIs: Lusha=${!!lushaApiKey}, Lemlist=${!!lemlistApiKey}, ZeroBounce=${!!zbKey}, Domaine=${domaine}`);

      const results = [];
      let patternMemoire = null;

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        const prenom = contact.prenom;
        const nom = contact.nom;

        logger.info(`📧 [${i + 1}/${contacts.length}] ${contact.nom_complet} (${contact.fonction})`);

        let emailResult = null;

        if (prenom && nom) {
          logger.info(`  → Prénom: "${prenom}", Nom: "${nom}", Domaine: ${domaine}`);

          try {
            emailResult = await emailFinderService.trouverEmail({
              prenom,
              nom,
              entreprise: hotel.nom_commercial,
              domaine,
              lushaApiKey,
              lemlistApiKey,
              zerobounceApiKey: zbKey,
              patternMemoire,
              zbFallback: linkedinService.trouverEmailAvecZeroBounce,
            });

            if (emailResult) {
              logger.info(`  ✅ Email trouvé: ${emailResult.email} (source: ${emailResult.source})`);
              if (emailResult.source === 'ZeroBounce' && emailResult.pattern) {
                patternMemoire = emailResult.pattern;
                logger.info(`🎯 Pattern ZB mémorisé: ${patternMemoire}`);
              }
            } else {
              logger.warn(`  ❌ Aucun email trouvé`);
            }

            await new Promise(resolve => setTimeout(resolve, 100)); // Délai minimal pour rapidité
          } catch (err) {
            logger.warn(`Erreur recherche email pour ${contact.nom_complet}:`, err.message);
          }
        } else {
          logger.warn(`⚠️ Nom incomplet pour ${contact.nom_complet}`);
        }

        results.push({
          ...contact,
          email: emailResult?.email || null,
          email_source: emailResult?.source || null,
          email_confidence: emailResult?.confidence || null,
          email_pattern: emailResult?.pattern || null,
        });
      }

      logger.info(`✅ Recherche terminée: ${results.filter(r => r.email).length}/${results.length} emails trouvés`);

      // Sauvegarder uniquement les contacts sélectionnés dans linkedin_contacts (transaction pour éviter race condition)
      try {
        const updateContacts = db.transaction(() => {
          const currentHotel = db.prepare('SELECT linkedin_contacts FROM hotels_france WHERE id = ?').get(hotel.id);
          const savedContacts = JSON.parse(currentHotel?.linkedin_contacts || '[]');
          for (const result of results) {
            const idx = savedContacts.findIndex(c =>
              (result.linkedin_url && c.linkedin_url === result.linkedin_url) ||
              (result.nom_complet && c.nom_complet === result.nom_complet)
            );
            if (idx !== -1) {
              // Mettre à jour le contact existant
              savedContacts[idx] = { ...savedContacts[idx], ...result };
            } else {
              // Ajouter le nouveau contact sélectionné
              savedContacts.push(result);
            }

            // Ajouter l'email à email_registry si trouvé
            if (result.email) {
              upsertLinkedInEmailRegistry(result.email, {
                type: 'linkedin',
                hotel_id: hotel.id,
                linkedin_url: result.linkedin_url,
                nom_complet: result.nom_complet,
                found_date: new Date().toISOString(),
              });
            }
          }
          db.prepare('UPDATE hotels_france SET linkedin_contacts = ? WHERE id = ?')
            .run(JSON.stringify(savedContacts), hotel.id);
        });
        updateContacts();
      } catch (err) {
        logger.warn('Erreur mise à jour contacts:', err.message);
      }

      res.json({
        success: true,
        contacts: results,
        total: results.length,
        avec_email: results.filter(r => r.email).length,
      });

    } catch (err) {
      logger.error('Erreur POST /find-emails:', err);
      res.status(500).json({ erreur: 'Erreur recherche emails', details: err.message });
    }
  });

  // PATCH /api/prospection/contacts/:hotelId/email — Met à jour l'email d'un contact LinkedIn
  router.patch('/contacts/:hotelId/email', (req, res) => {
    const { hotelId } = req.params;
    const { linkedin_url, nom_complet, email, fonction } = req.body;

    if (!email) {
      return res.status(400).json({ erreur: 'Email requis' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ erreur: 'Format email invalide' });
    }

    try {
      // Transaction pour éviter race condition sur linkedin_contacts
      const updateEmail = db.transaction(() => {
        const hotel = db.prepare('SELECT linkedin_contacts FROM hotels_france WHERE id = ?').get(hotelId);
        if (!hotel) {
          throw new Error('Hôtel non trouvé');
        }

        const contacts = JSON.parse(hotel.linkedin_contacts || '[]');
        const idx = contacts.findIndex(c =>
          (linkedin_url && c.linkedin_url === linkedin_url) ||
          (nom_complet && c.nom_complet === nom_complet)
        );

        let contactIdx = idx;
        if (idx === -1) {
          // Contact pas encore dans linkedin_contacts — l'ajouter
          contacts.push({
            nom_complet: nom_complet || 'Inconnu',
            linkedin_url: linkedin_url || null,
            fonction: fonction || null,
            email: null,
            email_source: null,
          });
          contactIdx = contacts.length - 1;
        }

        contacts[contactIdx].email = email.trim().toLowerCase();
        contacts[contactIdx].email_source = 'manual';

        db.prepare('UPDATE hotels_france SET linkedin_contacts = ? WHERE id = ?')
          .run(JSON.stringify(contacts), hotelId);

        // Ajouter l'email à email_registry
        upsertLinkedInEmailRegistry(email.trim().toLowerCase(), {
          type: 'linkedin',
          hotel_id: hotelId,
          linkedin_url: contacts[contactIdx].linkedin_url,
          nom_complet: contacts[contactIdx].nom_complet,
          found_date: new Date().toISOString(),
          source: 'manual',
        });

        logger.info(`Email manuel ajouté: ${email} pour ${contacts[contactIdx].nom_complet}`);
        return { success: true };
      });

      const result = updateEmail();
      res.json(result);
    } catch (err) {
      logger.error('Erreur PATCH contacts/:hotelId/email:', err);
      if (err.message === 'Hôtel non trouvé') {
        return res.status(404).json({ erreur: err.message });
      }
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/prospection/contacts-to-leads — Convertit des contacts LinkedIn en leads
  router.post('/contacts-to-leads', (req, res) => {
    const { contacts, sequence_id } = req.body;

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ erreur: 'contacts requis (array)' });
    }

    try {
      const createLead = db.prepare(`
        INSERT OR IGNORE INTO leads (
          id, prenom, nom, email, hotel, ville, segment,
          poste, langue, source, statut, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      let created = 0;
      let errors = [];
      const leadIds = [];

      const transaction = db.transaction((contactsToConvert) => {
        for (const contact of contactsToConvert) {
          try {
            // Skip si pas d'email
            if (!contact.email) {
              errors.push({ contact: contact.nom_complet, error: 'Email manquant' });
              continue;
            }

            const leadId = uuidv4();

            // Mapper depuis contact LinkedIn
            const segment = '5*'; // Par défaut, à ajuster selon classement hôtel

            createLead.run(
              leadId,
              contact.prenom || contact.nom_complet.split(' ')[0],
              contact.nom || contact.nom_complet.split(' ').slice(1).join(' '),
              contact.email,
              contact.hotel_nom || 'Hotel',
              contact.hotel_commune || null,
              segment,
              contact.fonction || null,
              'fr',
              'Prospection LinkedIn',
              'Nouveau'
            );

            leadIds.push(leadId);
            created++;
          } catch (err) {
            if (err.message.includes('UNIQUE constraint')) {
              errors.push({ contact: contact.nom_complet, error: 'Email déjà existant' });
            } else {
              errors.push({ contact: contact.nom_complet, error: err.message });
            }
          }
        }
      });

      transaction(contacts);

      // Si une séquence est spécifiée, inscrire les leads
      if (sequence_id && leadIds.length > 0) {
        const scheduler = require('../jobs/sequenceScheduler');
        let inscribed = 0;
        for (const leadId of leadIds) {
          try {
            scheduler.inscrireLead(db, leadId, sequence_id);
            inscribed++;
          } catch (err) {
            logger.warn(`Erreur inscription lead ${leadId} en séquence:`, err.message);
          }
        }
        logger.info(`✅ ${inscribed} lead(s) inscrit(s) en séquence ${sequence_id}`);
      }

      logger.info(`✅ ${created} contact(s) converti(s) en leads`);

      res.json({
        success: true,
        created,
        total: contacts.length,
        lead_ids: leadIds,
        errors: errors.length > 0 ? errors : undefined,
      });

    } catch (err) {
      logger.error('Erreur POST /contacts-to-leads:', err);
      res.status(500).json({ erreur: 'Erreur lors de la conversion des contacts' });
    }
  });

  return router;
};

/**
 * Scrape un batch d'hôtels en arrière-plan
 */
async function scrapeBatchAsync(db, hotelIds) {
  try {
    const results = await scraperService.scrapeBatch(db, hotelIds, (progress) => {
      if (progress.success + progress.errors === progress.total) {
        logger.info(`✅ Scraping batch terminé: ${progress.success} OK, ${progress.errors} erreurs`);
      }
    });

    return results;
  } catch (err) {
    logger.error('❌ Erreur scraping batch:', err);
  }
}
