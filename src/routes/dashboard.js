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

      // 3. Quota du jour (heure Paris, cohérent avec le scheduler)
      const _pad2 = n => String(n).padStart(2, '0');
      const _nowParis = new Date(new Date().toLocaleString('en-US', { timeZone: process.env.FUSEAU || 'Europe/Paris' }));
      const today = `${_nowParis.getFullYear()}-${_pad2(_nowParis.getMonth()+1)}-${_pad2(_nowParis.getDate())}`;
      const nowParis = `${today} ${_pad2(_nowParis.getHours())}:${_pad2(_nowParis.getMinutes())}:${_pad2(_nowParis.getSeconds())}`;
      const quota = db.prepare('SELECT count FROM envoi_quota WHERE date_jour = ?').get(today);
      const quotaUtilise = quota ? quota.count : 0;
      const configMax = db.prepare("SELECT valeur FROM config WHERE cle = 'max_emails_par_jour'").get();
      const quotaMax = parseInt(configMax?.valeur || process.env.MAX_EMAILS_PER_DAY || '50') || 50;

      // 3b. État des envois du jour
      const todayStart = today + ' 00:00:00';
      const todayEnd = today + ' 23:59:59';
      const envoiAujourdHui = {
        // Emails déjà envoyés aujourd'hui (quota = source de vérité)
        envoyes: quotaUtilise,
        // En attente : prochain_envoi déjà passé, le scheduler va les traiter au prochain cycle
        en_attente: db.prepare(`
          SELECT COUNT(*) as count FROM inscriptions i
          JOIN leads l ON i.lead_id = l.id
          WHERE i.statut = 'actif'
            AND i.prochain_envoi IS NOT NULL
            AND datetime(i.prochain_envoi) <= datetime(?)
            AND l.unsubscribed = 0
        `).get(nowParis)?.count || 0,
        // Prévus plus tard : programmés pour plus tard dans la journée
        prevus_plus_tard: db.prepare(`
          SELECT COUNT(*) as count FROM inscriptions i
          JOIN leads l ON i.lead_id = l.id
          WHERE i.statut = 'actif'
            AND i.prochain_envoi IS NOT NULL
            AND datetime(i.prochain_envoi) > datetime(?)
            AND datetime(i.prochain_envoi) <= datetime(?)
            AND l.unsubscribed = 0
        `).get(nowParis, todayEnd)?.count || 0,
        // Erreurs d'envoi aujourd'hui
        erreurs: db.prepare(`
          SELECT COUNT(*) as count FROM emails
          WHERE date(envoye_at) = ? AND statut = 'erreur'
        `).get(today)?.count || 0,
      };

      // 3c. Prévision des envois sur 10 jours
      const joursNoms = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
      const dates10 = [];
      for (let i = 0; i < 10; i++) {
        const d = new Date(_nowParis);
        d.setDate(d.getDate() + i);
        const dateStr = `${d.getFullYear()}-${_pad2(d.getMonth()+1)}-${_pad2(d.getDate())}`;
        dates10.push({ date: dateStr, jour: d.getDay(), label: `${joursNoms[d.getDay()]} ${d.getDate()}` });
      }
      const dateDebut = dates10[0].date;
      const dateFin = dates10[dates10.length - 1].date;

      const previsionRows = db.prepare(`
        SELECT DATE(i.prochain_envoi) as jour, COUNT(*) as total
        FROM inscriptions i
        JOIN leads l ON i.lead_id = l.id
        WHERE i.statut = 'actif'
          AND i.prochain_envoi IS NOT NULL
          AND l.unsubscribed = 0
          AND DATE(i.prochain_envoi) >= ?
          AND DATE(i.prochain_envoi) <= ?
        GROUP BY DATE(i.prochain_envoi)
      `).all(dateDebut, dateFin);

      const previsionMap = {};
      for (const row of previsionRows) previsionMap[row.jour] = row.total;

      const previsionEnvois = dates10.map(d => ({
        date: d.date,
        total: previsionMap[d.date] || 0,
        jourSemaine: d.label
      }));

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
        envoiAujourdHui,
        previsionEnvois,
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

  // GET /api/dashboard/send-analytics — Analyse des créneaux d'envoi
  router.get('/send-analytics', (req, res) => {
    try {
      // Offset Paris dynamique (UTC+1 ou UTC+2 selon DST)
      const offsetParis = (() => {
        const now = new Date();
        const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
        const paris = new Date(now.toLocaleString('en-US', { timeZone: process.env.FUSEAU || 'Europe/Paris' }));
        return Math.round((paris - utc) / 3600000);
      })();
      const tzAdjust = `+${offsetParis} hours`;

      // Total emails 30j
      const totalEmails = db.prepare(`
        SELECT COUNT(*) as count FROM emails
        WHERE envoye_at >= datetime('now', '-30 days') AND statut != 'erreur'
      `).get().count;

      // Q1 — Heatmap ouvertures
      const heatmapOuvertures = db.prepare(`
        SELECT CAST(strftime('%w', datetime(created_at, ?)) AS INTEGER) as j,
               CAST(strftime('%H', datetime(created_at, ?)) AS INTEGER) as h,
               COUNT(*) as n
        FROM events
        WHERE type = 'ouverture' AND created_at >= datetime('now', '-30 days')
        GROUP BY j, h
      `).all(tzAdjust, tzAdjust).map(r => [r.j, r.h, r.n]);

      // Q2 — Heatmap clics
      const heatmapClics = db.prepare(`
        SELECT CAST(strftime('%w', datetime(created_at, ?)) AS INTEGER) as j,
               CAST(strftime('%H', datetime(created_at, ?)) AS INTEGER) as h,
               COUNT(*) as n
        FROM events
        WHERE type = 'clic' AND created_at >= datetime('now', '-30 days')
        GROUP BY j, h
      `).all(tzAdjust, tzAdjust).map(r => [r.j, r.h, r.n]);

      // Q3 — Heatmap réponses
      const heatmapReponses = db.prepare(`
        SELECT CAST(strftime('%w', datetime(created_at, ?)) AS INTEGER) as j,
               CAST(strftime('%H', datetime(created_at, ?)) AS INTEGER) as h,
               COUNT(*) as n
        FROM events
        WHERE type = 'réponse' AND created_at >= datetime('now', '-30 days')
        GROUP BY j, h
      `).all(tzAdjust, tzAdjust).map(r => [r.j, r.h, r.n]);

      // Q4 — Taux réponse par heure d'envoi
      const tauxParHeure = db.prepare(`
        SELECT CAST(strftime('%H', datetime(e.envoye_at, ?)) AS INTEGER) as heure,
               COUNT(DISTINCT e.id) as envoyes,
               COUNT(DISTINCT CASE WHEN e.ouvertures > 0 THEN e.id END) as ouverts,
               COUNT(DISTINCT CASE WHEN ev.id IS NOT NULL THEN e.id END) as repondus
        FROM emails e
        LEFT JOIN events ev ON ev.email_id = e.id AND ev.type = 'réponse'
        WHERE e.envoye_at >= datetime('now', '-30 days') AND e.statut != 'erreur'
        GROUP BY heure ORDER BY heure
      `).all(tzAdjust).map(r => ({
        heure: r.heure,
        envoyes: r.envoyes,
        ouverts: r.ouverts,
        repondus: r.repondus,
        taux: r.envoyes > 0 ? Math.round(r.repondus / r.envoyes * 1000) / 10 : 0
      }));

      // Q5 — Taux réponse par jour d'envoi
      const tauxParJour = db.prepare(`
        SELECT CAST(strftime('%w', datetime(e.envoye_at, ?)) AS INTEGER) as jour,
               COUNT(DISTINCT e.id) as envoyes,
               COUNT(DISTINCT CASE WHEN e.ouvertures > 0 THEN e.id END) as ouverts,
               COUNT(DISTINCT CASE WHEN ev.id IS NOT NULL THEN e.id END) as repondus
        FROM emails e
        LEFT JOIN events ev ON ev.email_id = e.id AND ev.type = 'réponse'
        WHERE e.envoye_at >= datetime('now', '-30 days') AND e.statut != 'erreur'
        GROUP BY jour ORDER BY jour
      `).all(tzAdjust).map(r => ({
        jour: r.jour,
        envoyes: r.envoyes,
        ouverts: r.ouverts,
        repondus: r.repondus,
        taux: r.envoyes > 0 ? Math.round(r.repondus / r.envoyes * 1000) / 10 : 0
      }));

      // Q6 — Meilleurs créneaux par taux de réponse (jour × heure)
      const creneauxRaw = db.prepare(`
        SELECT CAST(strftime('%w', datetime(e.envoye_at, ?)) AS INTEGER) as jour,
               CAST(strftime('%H', datetime(e.envoye_at, ?)) AS INTEGER) as heure,
               COUNT(DISTINCT e.id) as envoyes,
               COUNT(DISTINCT CASE WHEN e.ouvertures > 0 THEN e.id END) as ouverts,
               COUNT(DISTINCT CASE WHEN ev.id IS NOT NULL THEN e.id END) as repondus
        FROM emails e
        LEFT JOIN events ev ON ev.email_id = e.id AND ev.type = 'réponse'
        WHERE e.envoye_at >= datetime('now', '-30 days') AND e.statut != 'erreur'
        GROUP BY jour, heure
        HAVING envoyes >= 3
      `).all(tzAdjust, tzAdjust);

      const joursLabels = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
      const topCreneaux = creneauxRaw
        .map(r => ({
          jour: r.jour,
          heure: r.heure,
          envoyes: r.envoyes,
          repondus: r.repondus,
          taux: r.envoyes > 0 ? Math.round(r.repondus / r.envoyes * 1000) / 10 : 0,
          label: `${joursLabels[r.jour]} ${r.heure}h`
        }))
        .filter(r => r.repondus > 0)
        .sort((a, b) => b.taux - a.taux)
        .slice(0, 5);

      // Meilleur créneau global
      const meilleurCreneau = topCreneaux.length > 0 ? topCreneaux[0] : null;

      // Meilleur jour / meilleure heure individuels
      const meilleurJour = tauxParJour.length > 0
        ? tauxParJour.reduce((best, r) => r.taux > best.taux ? r : best, tauxParJour[0])
        : null;
      const meilleureHeure = tauxParHeure.length > 0
        ? tauxParHeure.reduce((best, r) => r.taux > best.taux ? r : best, tauxParHeure[0])
        : null;

      res.json({
        periode: '30 jours',
        totalEmails,
        heatmap: {
          ouvertures: heatmapOuvertures,
          clics: heatmapClics,
          reponses: heatmapReponses
        },
        tauxParHeure,
        tauxParJour,
        meilleurCreneau,
        meilleurJour,
        meilleureHeure,
        topCreneaux
      });

    } catch (err) {
      logger.error('GET /dashboard/send-analytics erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
