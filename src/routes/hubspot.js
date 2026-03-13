/**
 * hubspot.js — Routes HubSpot (webhook entrant + actions manuelles)
 */

const express  = require('express');
const router   = express.Router();
const logger   = require('../config/logger');
const hubspot  = require('../services/hubspotService');

module.exports = (db) => {

  // POST /api/hubspot/webhook — Webhook HubSpot (contact modifié)
  router.post('/webhook', express.json(), (req, res) => {
    res.sendStatus(200);
    setImmediate(async () => {
      try {
        const events = Array.isArray(req.body) ? req.body : [req.body];
        for (const event of events) {
          logger.info('Webhook HubSpot reçu', { type: event.subscriptionType, objectId: event.objectId });

          if (event.subscriptionType === 'contact.propertyChange') {
            const lead = db.prepare('SELECT * FROM leads WHERE hubspot_id = ?').get(String(event.objectId));
            if (!lead) continue;

            const FIELDS = { email: 'email', firstname: 'prenom', company: 'hotel' };
            const col = FIELDS[event.propertyName];
            if (col) {
              db.prepare(`UPDATE leads SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(event.propertyValue, lead.id);
            }
          }
        }
      } catch (err) {
        logger.error('Erreur webhook HubSpot', { error: err.message });
      }
    });
  });

  // POST /api/hubspot/sync-lead/:id
  router.post('/sync-lead/:id', async (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });
      const hubspotId = await hubspot.syncContact(db, lead);
      res.json({ message: 'Lead synchronisé', hubspotId });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/hubspot/sync-all — Sync bidirectionnelle
  router.post('/sync-all', async (req, res) => {
    try {
      const API_KEY = process.env.HUBSPOT_API_KEY;

      // 1. Pousser les leads locaux sans hubspot_id
      const leadsASyncer = db.prepare('SELECT * FROM leads WHERE hubspot_id IS NULL AND unsubscribed = 0').all();
      for (const lead of leadsASyncer) {
        await hubspot.syncContact(db, lead).catch(() => {});
        await new Promise(r => setTimeout(r, 150));
      }

      // 2. Pull depuis HubSpot pour les leads déjà liés
      if (API_KEY) {
        const leadsLies = db.prepare('SELECT * FROM leads WHERE hubspot_id IS NOT NULL').all();
        const stageMap = {
          subscriber: 'Nouveau', lead: 'Nouveau',
          marketingqualifiedlead: 'En séquence', salesqualifiedlead: 'Répondu',
          opportunity: 'Répondu', customer: 'Converti',
        };

        for (const lead of leadsLies) {
          try {
            const resp = await fetch(
              `https://api.hubapi.com/crm/v3/objects/contacts/${lead.hubspot_id}?properties=email,firstname,lastname,company,city,lifecyclestage`,
              { headers: { Authorization: `Bearer ${API_KEY}` } }
            );
            if (!resp.ok) continue;
            const { properties: p } = await resp.json();
            const nouveauStatut = stageMap[p.lifecyclestage] || null;

            db.prepare(`
              UPDATE leads SET
                prenom = COALESCE(NULLIF(?, ''), prenom),
                nom    = COALESCE(NULLIF(?, ''), nom),
                hotel  = COALESCE(NULLIF(?, ''), hotel),
                ville  = COALESCE(NULLIF(?, ''), ville),
                ${nouveauStatut ? 'statut = ?,' : ''}
                updated_at = datetime('now')
              WHERE id = ?
            `).run(
              p.firstname || '', p.lastname || '', p.company || '', p.city || '',
              ...(nouveauStatut ? [nouveauStatut] : []),
              lead.id
            );
          } catch (_) { /* continuer */ }
          await new Promise(r => setTimeout(r, 100));
        }
      }

      const totalLies = db.prepare('SELECT COUNT(*) as c FROM leads WHERE hubspot_id IS NOT NULL').get().c;
      res.json({ message: `Sync terminée — ${leadsASyncer.length} nouveaux, ${totalLies} mis à jour` });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/hubspot/creer-deal/:leadId
  router.post('/creer-deal/:leadId', async (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });
      const dealId = await hubspot.creerDeal(db, lead);
      db.prepare(`UPDATE leads SET statut = 'Converti', updated_at = datetime('now') WHERE id = ?`).run(lead.id);
      res.json({ message: 'Deal créé', dealId });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/hubspot/recherche-companies?q=
  router.get('/recherche-companies', async (req, res) => {
    try {
      const results = await hubspot.rechercherCompanies(req.query.q || '');
      res.json(results);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // GET /api/hubspot/contacts-company/:companyId
  router.get('/contacts-company/:companyId', async (req, res) => {
    try {
      const contacts = await hubspot.contactsDeCompany(req.params.companyId);
      res.json(contacts);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // GET /api/hubspot/status
  router.get('/status', async (req, res) => {
    const status = await hubspot.verifierConnexion();
    res.json(status);
  });

  // GET /api/hubspot/deals/:hubspotContactId
  router.get('/deals/:hubspotContactId', async (req, res) => {
    try {
      const deals = await hubspot.getDealsForContact(req.params.hubspotContactId);
      res.json({ deals });
    } catch (err) {
      logger.error('GET /hubspot/deals erreur', { error: err.message });
      res.json({ deals: [] });
    }
  });

  // GET /api/hubspot/notes/:hubspotContactId
  router.get('/notes/:hubspotContactId', async (req, res) => {
    try {
      const notes = await hubspot.getNotesForContact(req.params.hubspotContactId);
      res.json({ notes });
    } catch (err) {
      logger.error('GET /hubspot/notes erreur', { error: err.message });
      res.json({ notes: [] });
    }
  });

  return router;
};
