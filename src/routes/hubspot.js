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

  return router;
};
