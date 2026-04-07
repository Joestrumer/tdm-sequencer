/**
 * dashboard.js — Route pour vue d'ensemble du dashboard
 */

const express = require('express');
const router = express.Router();
const logger = require('../config/logger');

module.exports = (db) => {

  // GET /api/dashboard — Vue d'ensemble
  router.get('/', (req, res) => {
    try {
      // 1. Métriques clés
      const stats = {
        leadsActifs: db.prepare(`
          SELECT COUNT(*) as count FROM leads
          WHERE statut != 'Désabonné' AND unsubscribed = 0
        `).get().count,

        leadsEnSequence: db.prepare(`
          SELECT COUNT(DISTINCT lead_id) as count FROM inscriptions
          WHERE statut = 'actif'
        `).get().count,

        emailsSemaine: db.prepare(`
          SELECT COUNT(*) as count FROM emails
          WHERE envoye_at >= datetime('now', '-7 days')
        `).get().count,

        tauxOuverture: db.prepare(`
          SELECT
            CAST(SUM(CASE WHEN ouvertures > 0 THEN 1 ELSE 0 END) AS REAL) * 100.0 / COALESCE(NULLIF(COUNT(*), 0), 1) as taux
          FROM emails
          WHERE envoye_at >= datetime('now', '-30 days')
        `).get().taux || 0,

        sequencesActives: db.prepare(`
          SELECT COUNT(*) as count FROM sequences WHERE actif = 1
        `).get().count
      };

      // 2. Prochains envois (10 prochains)
      const prochainsEnvois = db.prepare(`
        SELECT
          i.id,
          i.prochain_envoi,
          i.etape_courante,
          l.prenom,
          l.nom,
          l.email,
          l.hotel,
          s.nom as sequence_nom,
          (SELECT COUNT(*) FROM etapes WHERE sequence_id = s.id) as nb_etapes
        FROM inscriptions i
        JOIN leads l ON i.lead_id = l.id
        JOIN sequences s ON i.sequence_id = s.id
        WHERE i.statut = 'actif'
          AND i.prochain_envoi IS NOT NULL
          AND l.unsubscribed = 0
        ORDER BY i.prochain_envoi ASC
        LIMIT 10
      `).all();

      // 3. Quota du jour
      const today = new Date().toISOString().split('T')[0];
      const quota = db.prepare('SELECT count FROM envoi_quota WHERE date_jour = ?').get(today);
      const quotaUtilise = quota ? quota.count : 0;
      const configMax = db.prepare("SELECT valeur FROM config WHERE cle = 'max_emails_par_jour'").get();
      const quotaMax = configMax ? parseInt(configMax.valeur) : parseInt(process.env.MAX_EMAILS_PER_DAY || 50);

      // 4. Activité récente (20 derniers events)
      const activite = db.prepare(`
        SELECT
          e.type,
          e.created_at,
          e.meta,
          l.prenom,
          l.nom,
          l.email,
          l.hotel,
          em.sujet
        FROM events e
        LEFT JOIN leads l ON e.lead_id = l.id
        LEFT JOIN emails em ON e.email_id = em.id
        WHERE e.type IN ('envoi', 'ouverture', 'clic', 'desabonnement')
        ORDER BY e.created_at DESC
        LIMIT 20
      `).all();

      // 5. Erreurs récentes (7 derniers jours)
      const erreurs = db.prepare(`
        SELECT
          id,
          sujet,
          erreur,
          envoye_at,
          lead_id
        FROM emails
        WHERE statut = 'erreur'
          AND envoye_at >= datetime('now', '-7 days')
        ORDER BY envoye_at DESC
        LIMIT 5
      `).all();

      // 6. Top séquences (par nombre d'inscrits actifs)
      const topSequences = db.prepare(`
        SELECT
          s.id,
          s.nom,
          COUNT(i.id) as inscrits_actifs,
          (SELECT COUNT(*) FROM emails e
           JOIN inscriptions i2 ON e.inscription_id = i2.id
           WHERE i2.sequence_id = s.id AND e.ouvertures > 0) as total_ouvertures,
          (SELECT COUNT(*) FROM emails e
           JOIN inscriptions i2 ON e.inscription_id = i2.id
           WHERE i2.sequence_id = s.id) as total_emails
        FROM sequences s
        LEFT JOIN inscriptions i ON s.id = i.sequence_id AND i.statut = 'actif'
        WHERE s.actif = 1
        GROUP BY s.id
        ORDER BY inscrits_actifs DESC
        LIMIT 5
      `).all();

      res.json({
        stats,
        prochainsEnvois,
        quota: { utilise: quotaUtilise, max: quotaMax },
        activite,
        erreurs,
        topSequences
      });

    } catch (err) {
      logger.error('GET /dashboard erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/dashboard/marketing — Métriques email marketing
  router.get('/marketing', (req, res) => {
    try {
      const campaignesTerminees = db.prepare(`
        SELECT COUNT(*) as count FROM campaigns WHERE statut = 'terminée'
      `).get().count;

      const campaignesEnCours = db.prepare(`
        SELECT COUNT(*) as count FROM campaigns WHERE statut = 'en_cours'
      `).get().count;

      const emailsMarketing30j = db.prepare(`
        SELECT COUNT(*) as count FROM emails
        WHERE campaign_id IS NOT NULL AND envoye_at >= datetime('now', '-30 days')
      `).get().count;

      const tauxOuvertureData = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN ouvertures > 0 THEN 1 ELSE 0 END) as opened
        FROM emails
        WHERE campaign_id IS NOT NULL AND envoye_at >= datetime('now', '-30 days')
      `).get();
      const tauxOuverture = tauxOuvertureData.total > 0
        ? Math.round((tauxOuvertureData.opened || 0) / tauxOuvertureData.total * 100)
        : 0;

      const tauxClicData = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN clics > 0 THEN 1 ELSE 0 END) as clicked
        FROM emails
        WHERE campaign_id IS NOT NULL AND envoye_at >= datetime('now', '-30 days')
      `).get();
      const tauxClic = tauxClicData.total > 0
        ? Math.round((tauxClicData.clicked || 0) / tauxClicData.total * 100)
        : 0;

      // Top 10 dernières campagnes terminées avec stats
      const topCampagnes = db.prepare(`
        SELECT
          c.id, c.nom, c.completed_at, c.sent_count, c.error_count, c.total_recipients,
          (SELECT SUM(CASE WHEN e.ouvertures > 0 THEN 1 ELSE 0 END) FROM emails e WHERE e.campaign_id = c.id) as opened,
          (SELECT SUM(CASE WHEN e.clics > 0 THEN 1 ELSE 0 END) FROM emails e WHERE e.campaign_id = c.id) as clicked
        FROM campaigns c
        WHERE c.statut = 'terminée'
        ORDER BY c.completed_at DESC
        LIMIT 10
      `).all().map(c => ({
        ...c,
        open_rate: c.sent_count > 0 ? Math.round((c.opened || 0) / c.sent_count * 100) : 0,
        click_rate: c.sent_count > 0 ? Math.round((c.clicked || 0) / c.sent_count * 100) : 0,
      }));

      // Campagnes en cours avec progression
      const campagnesEnCoursDetail = db.prepare(`
        SELECT c.id, c.nom, c.started_at, c.total_recipients, c.sent_count, c.error_count
        FROM campaigns c
        WHERE c.statut = 'en_cours'
        ORDER BY c.started_at DESC
      `).all().map(c => ({
        ...c,
        progression: c.total_recipients > 0 ? Math.round((c.sent_count + c.error_count) / c.total_recipients * 100) : 0,
      }));

      res.json({
        stats: {
          campaignesTerminees,
          campaignesEnCours,
          emailsMarketing30j,
          tauxOuverture,
          tauxClic,
        },
        topCampagnes,
        campagnesEnCours: campagnesEnCoursDetail,
      });

    } catch (err) {
      logger.error('GET /dashboard/marketing erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
