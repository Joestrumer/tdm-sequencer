/**
 * external.js — API externe pour outils tiers (Make, Zapier, n8n, etc.)
 * Auth par API key dans le header X-API-Key (clé stockée dans config.external_api_key)
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const hubspot = require('../services/hubspotService');
const { inscrireLead } = require('../jobs/sequenceScheduler');

module.exports = (db) => {

  // Middleware auth par API key
  router.use((req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ erreur: 'Header X-API-Key requis' });

    const cfg = db.prepare("SELECT valeur FROM config WHERE cle = 'external_api_key'").get();
    if (!cfg || !cfg.valeur) return res.status(503).json({ erreur: 'API externe non configurée (clé manquante dans config)' });
    if (apiKey !== cfg.valeur) return res.status(403).json({ erreur: 'API key invalide' });

    next();
  });

  // POST /api/external/push-lead
  // Crée un lead (ou récupère l'existant) et l'inscrit à une séquence
  //
  // Body: {
  //   email (requis), prenom (requis), hotel (requis),
  //   nom, ville, segment, poste, langue, campaign, comment,
  //   sequence_id (optionnel — inscrit à la séquence si fourni),
  //   sequence_nom (optionnel — cherche la séquence par nom si sequence_id absent),
  //   tags (optionnel — tableau de strings),
  //   hubspot_sync (optionnel — sync HubSpot, default true),
  //   company_hubspot_id (optionnel)
  // }
  router.post('/push-lead', async (req, res) => {
    try {
      const {
        email, prenom, nom, hotel, ville, segment, poste, langue, campaign, comment,
        sequence_id, sequence_nom, tags,
        hubspot_sync = true, company_hubspot_id
      } = req.body;

      if (!email || !prenom || !hotel) {
        return res.status(400).json({ erreur: 'email, prenom et hotel sont requis' });
      }

      const result = {
        lead: null,
        created: false,
        sequence: null,
        hubspot: null,
        errors: []
      };

      // 1. Créer ou récupérer le lead
      let lead = db.prepare('SELECT * FROM leads WHERE email = ?').get(email.toLowerCase().trim());

      if (lead) {
        // Lead existe — mettre à jour les champs fournis
        const updates = {};
        if (prenom) updates.prenom = prenom;
        if (nom) updates.nom = nom;
        if (hotel) updates.hotel = hotel;
        if (ville) updates.ville = ville;
        if (segment) updates.segment = segment;
        if (poste) updates.poste = poste;
        if (langue) updates.langue = langue;
        if (campaign) updates.campaign = campaign;
        if (comment) updates.comment = comment;
        if (tags) updates.tags = JSON.stringify(tags);

        if (Object.keys(updates).length > 0) {
          const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
          db.prepare(`UPDATE leads SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`)
            .run(...Object.values(updates), lead.id);
          lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id);
        }

        result.lead = { id: lead.id, email: lead.email, statut: lead.statut };
        result.created = false;
      } else {
        // Créer le lead
        const id = uuidv4();
        db.prepare(`
          INSERT INTO leads (id, prenom, nom, email, hotel, ville, segment, tags, poste, langue, campaign, comment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, prenom, nom || '', email.toLowerCase().trim(), hotel,
          ville || '', segment || '5*', JSON.stringify(tags || []),
          poste || null, langue || 'fr', campaign || null, comment || null
        );

        lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
        result.lead = { id: lead.id, email: lead.email, statut: lead.statut };
        result.created = true;
        logger.info('📥 Lead créé via API externe', { email, hotel });
      }

      // 2. Sync HubSpot si demandé
      if (hubspot_sync && process.env.HUBSPOT_API_KEY) {
        const cfgSync = db.prepare("SELECT valeur FROM config WHERE cle = 'hs_sync_contact'").get();
        const syncEnabled = cfgSync ? cfgSync.valeur !== '0' && cfgSync.valeur !== 'false' : true;
        if (syncEnabled) {
          try {
            const leadData = { ...lead, company_hubspot_id: company_hubspot_id || null };
            const hubspotId = await hubspot.syncContact(db, leadData);
            if (hubspotId) result.hubspot = { contact_id: hubspotId };
          } catch (e) {
            result.errors.push(`HubSpot: ${e.message}`);
          }
        }
      }

      // 3. Inscrire à la séquence
      let seqId = sequence_id;
      if (!seqId && sequence_nom) {
        const seq = db.prepare('SELECT id FROM sequences WHERE nom = ? LIMIT 1').get(sequence_nom);
        if (seq) seqId = seq.id;
        else result.errors.push(`Séquence "${sequence_nom}" introuvable`);
      }

      if (seqId) {
        // Vérifier que le lead n'est pas désabonné
        if (lead.unsubscribed) {
          result.errors.push('Lead désabonné — inscription à la séquence ignorée');
        } else {
          try {
            const inscription = inscrireLead(lead.id, seqId);
            const seq = db.prepare('SELECT nom FROM sequences WHERE id = ?').get(seqId);
            result.sequence = {
              id: seqId,
              nom: seq?.nom,
              inscription_id: inscription.id,
              prochain_envoi: inscription.prochainEnvoi
            };
          } catch (e) {
            result.errors.push(`Séquence: ${e.message}`);
          }
        }
      }

      res.status(result.created ? 201 : 200).json({
        ok: true,
        message: result.created ? 'Lead créé' : 'Lead mis à jour',
        ...result
      });

    } catch (err) {
      logger.error('Erreur API externe push-lead', { error: err.message });
      if (err.message.includes('UNIQUE')) {
        return res.status(409).json({ erreur: 'Conflit de données', detail: err.message });
      }
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/external/sequences — Lister les séquences disponibles (pour config de l'outil externe)
  router.get('/sequences', (req, res) => {
    try {
      const sequences = db.prepare(`
        SELECT id, nom, segment,
          (SELECT COUNT(*) FROM etapes WHERE sequence_id = sequences.id) as nb_etapes
        FROM sequences WHERE archived = 0
        ORDER BY nom ASC
      `).all();
      res.json({ sequences });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
