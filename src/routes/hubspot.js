/**
 * hubspot.js — Routes HubSpot (webhook entrant + actions manuelles)
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const hubspot = require('../services/hubspotService');

module.exports = (db) => {

  // POST /api/hubspot/webhook — Webhook HubSpot (contact modifié dans le CRM)
  // Configurer dans HubSpot : Settings > Integrations > Webhooks
  router.post('/webhook', express.json(), (req, res) => {
    res.sendStatus(200); // Répondre vite

    setImmediate(async () => {
      try {
        const events = Array.isArray(req.body) ? req.body : [req.body];
        for (const event of events) {
          logger.info('Webhook HubSpot reçu', { type: event.subscriptionType, objectId: event.objectId });

          if (event.subscriptionType === 'contact.propertyChange') {
            // Chercher le lead local par hubspot_id
            const lead = db.prepare('SELECT * FROM leads WHERE hubspot_id = ?').get(String(event.objectId));
            if (!lead) continue;

            // Synchroniser les changements
            if (event.propertyName === 'email') {
              db.prepare('UPDATE leads SET email = ?, updated_at = datetime(\'now\') WHERE id = ?').run(event.propertyValue, lead.id);
            }
            if (event.propertyName === 'firstname') {
              db.prepare('UPDATE leads SET prenom = ?, updated_at = datetime(\'now\') WHERE id = ?').run(event.propertyValue, lead.id);
            }
            if (event.propertyName === 'company') {
              db.prepare('UPDATE leads SET hotel = ?, updated_at = datetime(\'now\') WHERE id = ?').run(event.propertyValue, lead.id);
            }
          }

          // Si un lead HubSpot répond à un email → créer un deal
          if (event.subscriptionType === 'contact.creation') {
            logger.info('Nouveau contact HubSpot créé', { id: event.objectId });
          }
        }
      } catch (err) {
        logger.error('Erreur webhook HubSpot', { error: err.message });
      }
    });
  });

  // POST /api/hubspot/sync-lead/:id — Synchroniser un lead vers HubSpot
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

  // POST /api/hubspot/sync-all — Synchroniser tous les leads
  router.post('/sync-all', async (req, res) => {
    try {
      const leads = db.prepare('SELECT * FROM leads WHERE hubspot_id IS NULL AND unsubscribed = 0').all();
      let syncs = 0;
      for (const lead of leads) {
        await hubspot.syncContact(db, lead).catch(() => {});
        syncs++;
        await new Promise(r => setTimeout(r, 200)); // Respecter le rate limit HubSpot
      }
      res.json({ message: `${syncs} leads synchronisés` });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/hubspot/creer-deal/:leadId — Créer manuellement un deal
  router.post('/creer-deal/:leadId', async (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });

      const dealId = await hubspot.creerDeal(db, lead);

      // Mettre à jour le statut du lead
      db.prepare('UPDATE leads SET statut = \'Converti\', updated_at = datetime(\'now\') WHERE id = ?').run(lead.id);

      res.json({ message: 'Deal créé', dealId });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/hubspot/recherche-companies?q=barriere
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

  // GET /api/hubspot/deals/:hubspotContactId — Deals d'un contact
  router.get('/deals/:hubspotContactId', async (req, res) => {
    try {
      const API_KEY = process.env.HUBSPOT_API_KEY;
      if (!API_KEY) return res.json({ deals: [] });

      // Récupérer les deals associés au contact
      const assocResp = await fetch(
        `https://api.hubapi.com/crm/v4/objects/contacts/${req.params.hubspotContactId}/associations/deals`,
        { headers: { Authorization: `Bearer ${API_KEY}` } }
      );
      if (!assocResp.ok) return res.json({ deals: [] });
      const assocData = await assocResp.json();
      const dealIds = (assocData.results || []).map(r => r.toObjectId);
      if (!dealIds.length) return res.json({ deals: [] });

      // Batch read des deals
      const batchResp = await fetch('https://api.hubapi.com/crm/v3/objects/deals/batch/read', {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: dealIds.map(id => ({ id: String(id) })),
          properties: ['dealname', 'dealstage', 'amount', 'closedate', 'pipeline'],
        }),
      });
      const batchData = await batchResp.json();
      res.json({ deals: batchData.results || [] });
    } catch(err) {
      logger.error('GET /hubspot/deals erreur', { error: err.message });
      res.json({ deals: [] });
    }
  });

  // GET /api/hubspot/notes/:hubspotContactId — Notes d'un contact
  router.get('/notes/:hubspotContactId', async (req, res) => {
    try {
      const API_KEY = process.env.HUBSPOT_API_KEY;
      if (!API_KEY) return res.json({ notes: [] });

      // Associations contact → notes
      const assocResp = await fetch(
        `https://api.hubapi.com/crm/v4/objects/contacts/${req.params.hubspotContactId}/associations/notes`,
        { headers: { Authorization: `Bearer ${API_KEY}` } }
      );
      if (!assocResp.ok) return res.json({ notes: [] });
      const assocData = await assocResp.json();
      const noteIds = (assocData.results || []).slice(0, 10).map(r => r.toObjectId); // max 10 notes
      if (!noteIds.length) return res.json({ notes: [] });

      const batchResp = await fetch('https://api.hubapi.com/crm/v3/objects/notes/batch/read', {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: noteIds.map(id => ({ id: String(id) })),
          properties: ['hs_note_body', 'hs_lastmodifieddate', 'hubspot_owner_id'],
        }),
      });
      const batchData = await batchResp.json();
      // Trier par date desc
      const notes = (batchData.results || []).sort((a, b) => {
        const da = new Date(a.properties?.hs_lastmodifieddate || 0);
        const db2 = new Date(b.properties?.hs_lastmodifieddate || 0);
        return db2 - da;
      });
      res.json({ notes });
    } catch(err) {
      logger.error('GET /hubspot/notes erreur', { error: err.message });
      res.json({ notes: [] });
    }
  });

  // POST /api/hubspot/sync-all — Sync bidirectionnelle : HS → local pour les leads déjà liés
  router.post('/sync-all', async (req, res) => {
    try {
      const API_KEY = process.env.HUBSPOT_API_KEY;
      // 1. Sync leads locaux sans hubspot_id vers HubSpot
      const leadsASyncer = db.prepare('SELECT * FROM leads WHERE hubspot_id IS NULL AND unsubscribed = 0').all();
      let syncs = 0;
      for (const lead of leadsASyncer) {
        await hubspot.syncContact(db, lead).catch(() => {});
        syncs++;
        await new Promise(r => setTimeout(r, 150));
      }

      // 2. Sync bidirectionnelle : mettre à jour les leads déjà liés depuis HubSpot
      if (API_KEY) {
        const leadsLies = db.prepare('SELECT * FROM leads WHERE hubspot_id IS NOT NULL').all();
        for (const lead of leadsLies) {
          try {
            const resp = await fetch(
              `https://api.hubapi.com/crm/v3/objects/contacts/${lead.hubspot_id}?properties=email,firstname,lastname,company,city,lifecyclestage`,
              { headers: { Authorization: `Bearer ${API_KEY}` } }
            );
            if (!resp.ok) continue;
            const data = await resp.json();
            const p = data.properties || {};
            // Mapper lifecyclestage → statut local
            const stageMap = { 'subscriber': 'Nouveau', 'lead': 'Nouveau', 'marketingqualifiedlead': 'En séquence', 'salesqualifiedlead': 'Répondu', 'opportunity': 'Répondu', 'customer': 'Converti' };
            const nouveauStatut = stageMap[p.lifecyclestage] || null;
            db.prepare(`UPDATE leads SET
              prenom = COALESCE(NULLIF(?, ''), prenom),
              nom = COALESCE(NULLIF(?, ''), nom),
              hotel = COALESCE(NULLIF(?, ''), hotel),
              ville = COALESCE(NULLIF(?, ''), ville),
              ${nouveauStatut ? "statut = ?," : ""}
              updated_at = datetime('now')
            WHERE id = ?`).run(
              p.firstname || '', p.lastname || '', p.company || '', p.city || '',
              ...(nouveauStatut ? [nouveauStatut] : []),
              lead.id
            );
          } catch(e) { /* continuer */ }
          await new Promise(r => setTimeout(r, 100));
        }
      }

      res.json({ message: `Sync terminée — ${syncs} nouveaux leads envoyés, ${leadsASyncer.length ? "+" : ""}${db.prepare('SELECT COUNT(*) as c FROM leads WHERE hubspot_id IS NOT NULL').get().c} leads mis à jour` });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};

// Ces routes sont ajoutées ci-dessous par patch Python
