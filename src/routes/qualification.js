/**
 * qualification.js — Workflow complet de qualification d'un lead
 * Validation email → Création lead → HubSpot (contact, company, deal, task) → Séquence
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const hubspot = require('../services/hubspotService');
const { inscrireLead } = require('../jobs/sequenceScheduler');

module.exports = (db) => {

  // POST /api/qualification/create-and-launch
  // Body: { email, prenom, nom, hotel, ville, segment, company_hubspot_id, create_deal?, create_task?, sequence_id }
  router.post('/create-and-launch', async (req, res) => {
    try {
      const {
        email,
        prenom,
        nom,
        hotel,
        ville,
        segment,
        poste,
        company_hubspot_id,
        create_deal,
        deal_amount,
        deal_name,
        create_task,
        task_subject,
        sequence_id
      } = req.body;

      // Validation des données requises
      if (!email || !hotel || !prenom) {
        return res.status(400).json({ erreur: 'email, prenom et hotel requis' });
      }

      const results = {
        lead: null,
        hubspot_contact: null,
        hubspot_deal: null,
        hubspot_task: null,
        sequence: null,
        errors: []
      };

      // 1. Créer le lead
      const leadId = uuidv4();
      try {
        db.prepare(`
          INSERT INTO leads (id, prenom, nom, email, hotel, ville, segment, tags, statut, poste)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Nouveau', ?)
        `).run(
          leadId,
          prenom,
          nom || '',
          email,
          hotel,
          ville || '',
          segment || '5*',
          JSON.stringify([segment || '5*']),
          poste || null
        );

        results.lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
        logger.info('✅ Lead créé via qualification', { email, hotel });
      } catch (err) {
        if (err.message.includes('UNIQUE')) {
          results.errors.push('Email déjà existant dans la base');
          return res.status(409).json(results);
        }
        throw err;
      }

      // 2. Synchronisation HubSpot (si clé API configurée)
      if (process.env.HUBSPOT_API_KEY) {
        try {
          const leadWithCompany = { ...results.lead, company_hubspot_id };
          const hubspotContactId = await hubspot.syncContact(db, leadWithCompany);

          if (hubspotContactId) {
            results.hubspot_contact = { id: hubspotContactId };
            logger.info('✅ Contact HubSpot créé', { hubspotContactId });

            // 2a. Créer un deal si demandé
            if (create_deal && hubspotContactId) {
              try {
                const dealData = {
                  properties: {
                    dealname: deal_name || `Deal - ${hotel}`,
                    amount: deal_amount || 0,
                    dealstage: 'appointmentscheduled',
                    pipeline: 'default',
                    closedate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                  },
                  associations: [
                    {
                      to: { id: hubspotContactId },
                      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
                    }
                  ]
                };

                if (company_hubspot_id) {
                  dealData.associations.push({
                    to: { id: company_hubspot_id },
                    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }]
                  });
                }

                const dealRes = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(dealData)
                });

                if (dealRes.ok) {
                  const deal = await dealRes.json();
                  results.hubspot_deal = { id: deal.id };
                  logger.info('✅ Deal HubSpot créé', { dealId: deal.id });
                }
              } catch (dealErr) {
                results.errors.push(`Deal: ${dealErr.message}`);
                logger.error('Erreur création deal', { error: dealErr.message });
              }
            }

            // 2b. Créer une task si demandé
            if (create_task && hubspotContactId) {
              try {
                const taskData = {
                  properties: {
                    hs_task_subject: task_subject || `Contacter ${prenom} ${nom}`,
                    hs_task_body: `Lead qualifié via ${hotel}. Séquence email lancée.`,
                    hs_task_status: 'NOT_STARTED',
                    hs_task_priority: 'MEDIUM',
                    hs_timestamp: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                  },
                  associations: [
                    {
                      to: { id: hubspotContactId },
                      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }]
                    }
                  ]
                };

                const taskRes = await fetch('https://api.hubapi.com/crm/v3/objects/tasks', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(taskData)
                });

                if (taskRes.ok) {
                  const task = await taskRes.json();
                  results.hubspot_task = { id: task.id };
                  logger.info('✅ Task HubSpot créée', { taskId: task.id });
                }
              } catch (taskErr) {
                results.errors.push(`Task: ${taskErr.message}`);
                logger.error('Erreur création task', { error: taskErr.message });
              }
            }
          }
        } catch (hsErr) {
          results.errors.push(`HubSpot: ${hsErr.message}`);
          logger.error('Erreur sync HubSpot', { error: hsErr.message });
        }
      }

      // 3. Inscrire à la séquence si demandé
      if (sequence_id) {
        try {
          const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(sequence_id);
          if (!seq) {
            results.errors.push('Séquence introuvable');
          } else {
            const inscription = inscrireLead(leadId, sequence_id);
            // Mettre à jour la campaign du lead avec le nom de la séquence
            db.prepare("UPDATE leads SET campaign = ?, updated_at = datetime('now') WHERE id = ?").run(seq.nom, leadId);
            results.sequence = {
              id: sequence_id,
              nom: seq.nom,
              inscription_id: inscription.id,
              prochain_envoi: inscription.prochainEnvoi
            };
            logger.info('✅ Lead inscrit à la séquence', { sequenceNom: seq.nom });
          }
        } catch (seqErr) {
          results.errors.push(`Séquence: ${seqErr.message}`);
          logger.error('Erreur inscription séquence', { error: seqErr.message });
        }
      }

      res.json({
        message: 'Lead qualifié avec succès',
        ...results
      });

    } catch (err) {
      logger.error('Erreur qualification', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
