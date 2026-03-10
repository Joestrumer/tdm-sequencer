/**
 * sequences.js — Routes pour les séquences d'emails et les inscriptions
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { inscrireLead } = require('../jobs/sequenceScheduler');

module.exports = (db) => {

  // GET /api/sequences — Liste toutes les séquences avec stats
  router.get('/', (req, res) => {
    try {
      const sequences = db.prepare(`
        SELECT s.*,
          (SELECT COUNT(*) FROM etapes WHERE sequence_id = s.id) as nb_etapes,
          (SELECT COUNT(*) FROM inscriptions WHERE sequence_id = s.id AND statut = 'actif') as leads_actifs,
          (SELECT COUNT(*) FROM inscriptions WHERE sequence_id = s.id AND statut = 'terminé') as leads_termines
        FROM sequences s ORDER BY s.created_at DESC
      `).all();

      const result = sequences.map(s => ({
        ...s,
        etapes: db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(s.id),
      }));

      res.json({ sequences: result });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/sequences/:id — Détail d'une séquence
  router.get('/:id', (req, res) => {
    try {
      const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
      if (!seq) return res.status(404).json({ erreur: 'Séquence introuvable' });

      const etapes = db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(req.params.id);
      res.json({ ...seq, etapes });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences — Créer une séquence avec ses étapes
  router.post('/', (req, res) => {
    try {
      const { nom, segment, etapes } = req.body;
      if (!nom || !etapes?.length) return res.status(400).json({ erreur: 'nom et etapes sont requis' });

      const seqId = uuidv4();
      db.prepare('INSERT INTO sequences (id, nom, segment) VALUES (?, ?, ?)').run(seqId, nom, segment || '5*');

      const insererEtapes = db.transaction((etapes) => {
        for (let i = 0; i < etapes.length; i++) {
          const e = etapes[i];
          db.prepare('INSERT INTO etapes (id, sequence_id, ordre, jour_delai, sujet, corps) VALUES (?, ?, ?, ?, ?, ?)').run(uuidv4(), seqId, i + 1, e.jour_delai ?? e.jour ?? 0, e.sujet, e.corps);
        }
      });
      insererEtapes(etapes);

      const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(seqId);
      logger.info('✅ Séquence créée', { nom, etapes: etapes.length });
      res.status(201).json({ ...seq, etapes: db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(seqId) });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // PUT /api/sequences/:id — Mettre à jour une séquence (remplace les étapes)
  router.put('/:id', (req, res) => {
    try {
      const { nom, segment, etapes } = req.body;
      const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
      if (!seq) return res.status(404).json({ erreur: 'Séquence introuvable' });

      db.prepare('UPDATE sequences SET nom = ?, segment = ? WHERE id = ?').run(nom || seq.nom, segment || seq.segment, req.params.id);

      if (etapes?.length) {
        db.prepare('DELETE FROM etapes WHERE sequence_id = ?').run(req.params.id);
        const insererEtapes = db.transaction((etapes) => {
          for (let i = 0; i < etapes.length; i++) {
            const e = etapes[i];
            db.prepare('INSERT INTO etapes (id, sequence_id, ordre, jour_delai, sujet, corps) VALUES (?, ?, ?, ?, ?, ?)').run(uuidv4(), req.params.id, i + 1, e.jour_delai ?? e.jour ?? 0, e.sujet, e.corps);
          }
        });
        insererEtapes(etapes);
      }

      const updated = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
      res.json({ ...updated, etapes: db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(req.params.id) });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // DELETE /api/sequences/:id
  router.delete('/:id', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM sequences WHERE id = ?').run(req.params.id);
      if (!result.changes) return res.status(404).json({ erreur: 'Séquence introuvable' });
      res.json({ message: 'Séquence supprimée' });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences/:id/inscrire — Inscrire un lead à une séquence
  router.post('/:id/inscrire', (req, res) => {
    try {
      const { lead_id } = req.body;
      if (!lead_id) return res.status(400).json({ erreur: 'lead_id requis' });

      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead_id);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });

      if (lead.unsubscribed) return res.status(400).json({ erreur: 'Ce lead est désabonné' });

      const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
      if (!seq) return res.status(404).json({ erreur: 'Séquence introuvable' });

      const inscription = inscrireLead(lead_id, req.params.id);
      logger.info(`🚀 Lead inscrit à la séquence`, { lead: lead.email, sequence: seq.nom });
      res.json({ message: `${lead.prenom} ${lead.nom} inscrit(e) à "${seq.nom}"`, inscription });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences/:id/inscrire-batch — Inscrire plusieurs leads
  router.post('/:id/inscrire-batch', (req, res) => {
    try {
      const { lead_ids } = req.body;
      if (!Array.isArray(lead_ids)) return res.status(400).json({ erreur: 'lead_ids doit être un tableau' });

      const resultats = [];
      for (const leadId of lead_ids) {
        try {
          const inscription = inscrireLead(leadId, req.params.id);
          resultats.push({ lead_id: leadId, statut: 'inscrit', inscription });
        } catch (e) {
          resultats.push({ lead_id: leadId, statut: 'erreur', erreur: e.message });
        }
      }

      res.json({ resultats, inscrits: resultats.filter(r => r.statut === 'inscrit').length });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/sequences/:id/inscriptions — Leads inscrits à une séquence
  router.get('/:id/inscriptions', (req, res) => {
    try {
      const inscriptions = db.prepare(`
        SELECT i.*, l.prenom, l.nom, l.email, l.hotel, l.statut as lead_statut
        FROM inscriptions i
        JOIN leads l ON i.lead_id = l.id
        WHERE i.sequence_id = ?
        ORDER BY i.created_at DESC
      `).all(req.params.id);
      res.json({ inscriptions });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // DELETE /api/sequences/inscriptions/:id — Retirer un lead d'une séquence
  router.delete('/inscriptions/:id', (req, res) => {
    try {
      db.prepare(`UPDATE inscriptions SET statut = 'terminé' WHERE id = ?`).run(req.params.id);
      res.json({ message: 'Lead retiré de la séquence' });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences/trigger-now — Envoi direct bypass total (fenêtre + heure planifiée)
  router.post('/trigger-now', async (req, res) => {
    try {
      const { envoyerEmail } = require('../services/brevoService');
      const hubspot = require('../services/hubspotService');
      const logger = require('../config/logger');

      // Chercher toutes les inscriptions actives peu importe l'heure planifiée
      const inscriptions = db.prepare(`
        SELECT i.*, l.email as lead_email
        FROM inscriptions i
        JOIN leads l ON i.lead_id = l.id
        WHERE i.statut = 'actif'
        LIMIT 20
      `).all();

      if (inscriptions.length === 0) {
        return res.json({ message: 'Aucune inscription active', envoyes: 0 });
      }

      let envoyes = 0;
      const erreurs = [];

      for (const inscription of inscriptions) {
        try {
          const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(inscription.lead_id);
          if (!lead || lead.unsubscribed || lead.statut === 'Désabonné') continue;

          const etapes = db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(inscription.sequence_id);
          if (!etapes.length) continue;

          const indexCourant = inscription.etape_courante || 0;
          if (indexCourant >= etapes.length) continue;

          const etape = etapes[indexCourant];

          await envoyerEmail(db, { lead, etape, inscriptionId: inscription.id });
          envoyes++;

          // Log HubSpot
          if (process.env.HUBSPOT_API_KEY && lead.hubspot_id) {
            await hubspot.logEmailTimeline(db, lead, { sujet: etape.sujet, corps: etape.corps }).catch(() => {});
          }

          // Passer à l'étape suivante
          const prochainIndex = indexCourant + 1;
          const { prochaineDateEnvoi } = require('../jobs/sequenceScheduler');
          if (prochainIndex >= etapes.length) {
            db.prepare(`UPDATE inscriptions SET etape_courante = ?, statut = 'terminé', prochain_envoi = NULL WHERE id = ?`)
              .run(prochainIndex, inscription.id);
            db.prepare(`UPDATE leads SET statut = 'En séquence', updated_at = datetime('now') WHERE id = ?`).run(lead.id);
            if (process.env.HUBSPOT_API_KEY) {
              const seq = db.prepare('SELECT nom FROM sequences WHERE id = ?').get(inscription.sequence_id);
              await hubspot.creerTaskFinSequence(db, lead, seq?.nom || 'Séquence').catch(() => {});
            }
          } else {
            const prochainEtape = etapes[prochainIndex];
            const prochainDate = prochaineDateEnvoi(prochainEtape.jour_delai || 0);
            db.prepare(`UPDATE inscriptions SET etape_courante = ?, prochain_envoi = ? WHERE id = ?`)
              .run(prochainIndex, prochainDate, inscription.id);
          }

          logger.info(`⚡ Email forcé envoyé`, { email: lead.email, etape: indexCourant + 1 });
        } catch (err) {
          erreurs.push({ email: inscription.lead_email, erreur: err.message });
          logger.error('Erreur envoi forcé', { error: err.message });
        }
      }

      res.json({ message: `${envoyes} email(s) envoyé(s)`, envoyes, erreurs });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
