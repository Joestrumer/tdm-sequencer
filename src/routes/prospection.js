/**
 * prospection.js — Routes pour la prospection automatisée des hôtels français
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const logger = require('../config/logger');
const scraperService = require('../services/hotelScraperService');
const { v4: uuidv4 } = require('uuid');

// Configuration multer pour upload CSV
const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

module.exports = (db) => {

  // POST /api/prospection/import — Import CSV des hôtels français
  router.post('/import', upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    const results = [];
    const errors = [];
    let lineNumber = 0;

    try {
      // Lecture et parsing du CSV
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv({
            separator: ',',
            skipEmptyLines: true,
            trim: true
          }))
          .on('data', (row) => {
            lineNumber++;
            try {
              // Mapping des colonnes CSV vers la base de données
              const hotel = {
                date_classement: row['DATE DE CLASSEMENT'] || null,
                type_hebergement: row['TYPE D\'HÉBERGEMENT'] || null,
                classement: row['CLASSEMENT'] || null,
                categorie: row['CATÉGORIE'] || null,
                mention: row['MENTION'] || null,
                nom_commercial: row['NOM COMMERCIAL']?.trim(),
                adresse: row['ADRESSE'] || null,
                code_postal: row['CODE POSTAL'] || null,
                commune: row['COMMUNE'] || null,
                site_internet: row['SITE INTERNET'] || null,
                type_sejour: row['TYPE DE SÉJOUR'] || null,
                capacite_accueil: parseInt(row['CAPACITÉ D\'ACCUEIL (PERSONNES)']) || null,
                nombre_chambres: parseInt(row['NOMBRE DE CHAMBRES']) || null,
                nombre_emplacements: parseInt(row['NOMBRE D\'EMPLACEMENTS']) || null,
                nombre_unites: parseInt(row['NOMBRE D\'UNITÉS D\'HABITATION']) || null,
                nombre_logements: parseInt(row['NOMBRE DE LOGEMENTS']) || null,
                classement_proroge: row['classement prorogé'] || null
              };

              // Validation: nom_commercial est requis
              if (!hotel.nom_commercial) {
                errors.push({ line: lineNumber, error: 'NOM COMMERCIAL manquant' });
                return;
              }

              results.push(hotel);
            } catch (err) {
              errors.push({ line: lineNumber, error: err.message });
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });

      // Suppression du fichier temporaire
      fs.unlinkSync(req.file.path);

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
      // Nettoyage du fichier temporaire en cas d'erreur
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: 'Erreur lors de l\'import du CSV', details: err.message });
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

      // Comptage total
      const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
      const total = db.prepare(countQuery).get(...params).total;

      // Pagination
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

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
      res.status(500).json({ error: 'Erreur lors de la récupération des hôtels' });
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
      res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
  });

  // POST /api/prospection/scrape — Lance le scraping pour une sélection d'hôtels
  router.post('/scrape', async (req, res) => {
    const { hotel_ids } = req.body;

    if (!hotel_ids || !Array.isArray(hotel_ids) || hotel_ids.length === 0) {
      return res.status(400).json({ error: 'hotel_ids requis (array)' });
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
      res.status(500).json({ error: 'Erreur lors du lancement du scraping' });
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
      res.status(500).json({ error: 'Erreur lors de la récupération du statut' });
    }
  });

  // POST /api/prospection/create-leads — Convertit des hôtels scrapés en leads
  router.post('/create-leads', (req, res) => {
    const { hotel_ids } = req.body;

    if (!hotel_ids || !Array.isArray(hotel_ids) || hotel_ids.length === 0) {
      return res.status(400).json({ error: 'hotel_ids requis (array)' });
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

            // Créer le lead
            createLead.run(
              leadId,
              hotel.contact_prenom || 'Contact',
              hotel.contact_nom || hotel.nom_commercial,
              hotel.contact_email,
              hotel.nom_commercial,
              hotel.commune,
              segment,
              hotel.contact_fonction || null,
              'fr',
              'Prospection automatique',
              'Nouveau'
            );

            // Marquer l'hôtel comme converti
            markHotel.run(leadId, hotel.id);

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
        errors: errors.length > 0 ? errors : undefined,
      });

    } catch (err) {
      logger.error('Erreur POST /create-leads:', err);
      res.status(500).json({ error: 'Erreur lors de la création des leads' });
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
