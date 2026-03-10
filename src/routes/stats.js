/**
 * stats.js — Routes pour le dashboard et les statistiques
 */

const express = require('express');
const router = express.Router();
const { getQuotaRestant } = require('../services/brevoService');
const hubspot = require('../services/hubspotService');

module.exports = (db) => {

  // GET /api/stats/dashboard — Toutes les métriques pour le dashboard
  router.get('/dashboard', (req, res) => {
    try {
      // KPIs globaux
      const totalLeads = db.prepare('SELECT COUNT(*) as n FROM leads').get().n;
      const leadsActifs = db.prepare(`SELECT COUNT(*) as n FROM inscriptions WHERE statut = 'actif'`).get().n;
      const emailsEnvoyes = db.prepare('SELECT COUNT(*) as n FROM emails WHERE statut != \'erreur\'').get().n;
      const emailsOuverts = db.prepare('SELECT COUNT(*) as n FROM emails WHERE ouvertures > 0').get().n;
      const emailsCliques = db.prepare('SELECT COUNT(*) as n FROM emails WHERE clics > 0').get().n;
      const reponses = db.prepare(`SELECT COUNT(*) as n FROM leads WHERE statut IN ('Répondu', 'Converti')`).get().n;
      const convertis = db.prepare(`SELECT COUNT(*) as n FROM leads WHERE statut = 'Converti'`).get().n;

      const tOuverture = emailsEnvoyes > 0 ? Math.round((emailsOuverts / emailsEnvoyes) * 100) : 0;
      const tClic = emailsEnvoyes > 0 ? Math.round((emailsCliques / emailsEnvoyes) * 100) : 0;
      const tReponse = totalLeads > 0 ? Math.round((reponses / totalLeads) * 100) : 0;

      // Répartition par statut
      const parStatut = db.prepare(`
        SELECT statut, COUNT(*) as count FROM leads GROUP BY statut
      `).all();

      // Activité récente (30 derniers events)
      const activitesRecentes = db.prepare(`
        SELECT e.type, e.created_at, e.meta,
               l.prenom, l.nom, l.hotel,
               em.sujet
        FROM events e
        LEFT JOIN leads l ON e.lead_id = l.id
        LEFT JOIN emails em ON e.email_id = em.id
        ORDER BY e.created_at DESC
        LIMIT 30
      `).all();

      // Leads chauds (3+ ouvertures, pas de réponse)
      const leadsChauds = db.prepare(`
        SELECT l.*, SUM(e.ouvertures) as total_ouvertures
        FROM leads l
        JOIN emails e ON e.lead_id = l.id
        WHERE l.statut = 'En séquence'
        GROUP BY l.id
        HAVING total_ouvertures >= 3
        ORDER BY total_ouvertures DESC
        LIMIT 10
      `).all();

      // Performance par jour (7 derniers jours)
      const performance7j = db.prepare(`
        SELECT
          date(envoye_at) as jour,
          COUNT(*) as envoyes,
          SUM(CASE WHEN ouvertures > 0 THEN 1 ELSE 0 END) as ouverts,
          SUM(clics) as clics
        FROM emails
        WHERE envoye_at >= datetime('now', '-7 days')
        GROUP BY date(envoye_at)
        ORDER BY jour ASC
      `).all();

      // Quota Brevo du jour
      const quota = getQuotaRestant(db);

      res.json({
        kpis: { totalLeads, leadsActifs, emailsEnvoyes, emailsOuverts, emailsCliques, reponses, convertis, tOuverture, tClic, tReponse },
        parStatut,
        activitesRecentes,
        leadsChauds,
        performance7j,
        quota,
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/stats/hubspot — Statut de la connexion HubSpot
  router.get('/hubspot', async (req, res) => {
    try {
      const connexion = await hubspot.verifierConnexion();
      const logsRecents = db.prepare('SELECT * FROM hubspot_logs ORDER BY created_at DESC LIMIT 20').all();
      res.json({ connexion, logsRecents });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/stats/sequences — Performance par séquence
  router.get('/sequences', (req, res) => {
    try {
      const stats = db.prepare(`
        SELECT s.id, s.nom, s.segment,
          COUNT(DISTINCT i.lead_id) as total_leads,
          COUNT(DISTINCT CASE WHEN i.statut = 'actif' THEN i.lead_id END) as leads_actifs,
          COUNT(DISTINCT CASE WHEN i.statut = 'terminé' THEN i.lead_id END) as leads_termines,
          COUNT(e.id) as emails_envoyes,
          SUM(e.ouvertures) as total_ouvertures,
          AVG(CASE WHEN e.ouvertures > 0 THEN 1.0 ELSE 0 END) * 100 as taux_ouverture
        FROM sequences s
        LEFT JOIN inscriptions i ON i.sequence_id = s.id
        LEFT JOIN emails e ON e.inscription_id = i.id
        GROUP BY s.id
      `).all();
      res.json({ stats });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
