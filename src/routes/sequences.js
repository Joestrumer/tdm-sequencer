/**
 * sequences.js — Séquences d'emails et inscriptions
 */

const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger   = require('../config/logger');
const { inscrireLead, traiterInscriptionDirect } = require('../jobs/sequenceScheduler');

module.exports = (db) => {

  // GET /api/sequences
  router.get('/', (req, res) => {
    try {
      const sequences = db.prepare(`
        SELECT s.*,
          (SELECT COUNT(*) FROM etapes       WHERE sequence_id = s.id) as nb_etapes,
          (SELECT COUNT(*) FROM inscriptions WHERE sequence_id = s.id AND statut = 'actif')   as leads_actifs,
          (SELECT COUNT(*) FROM inscriptions WHERE sequence_id = s.id AND statut = 'terminé') as leads_termines
        FROM sequences s ORDER BY s.created_at DESC
      `).all();

      const result = sequences.map(s => {
        const etapes = db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(s.id);
        // Parser les pièces jointes JSON
        const etapesParsed = etapes.map(e => {
          let pieceJointe = null;
          if (e.piece_jointe) {
            try {
              pieceJointe = JSON.parse(e.piece_jointe);
            } catch (err) {
              logger.warn('Erreur parsing piece_jointe', { etapeId: e.id, error: err.message });
            }
          }
          return { ...e, piece_jointe: pieceJointe };
        });
        return { ...s, etapes: etapesParsed };
      });

      res.json({ sequences: result });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/sequences/:id
  router.get('/:id', (req, res) => {
    try {
      const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
      if (!seq) return res.status(404).json({ erreur: 'Séquence introuvable' });
      const etapes = db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(req.params.id);
      // Parser les pièces jointes JSON
      const etapesParsed = etapes.map(e => {
        let pieceJointe = null;
        if (e.piece_jointe) {
          try {
            pieceJointe = JSON.parse(e.piece_jointe);
          } catch (err) {
            logger.warn('Erreur parsing piece_jointe', { etapeId: e.id, error: err.message });
          }
        }
        return { ...e, piece_jointe: pieceJointe };
      });
      res.json({ ...seq, etapes: etapesParsed });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences
  router.post('/', (req, res) => {
    try {
      const { nom, segment, etapes, options } = req.body;
      if (!nom || !etapes?.length) return res.status(400).json({ erreur: 'nom et etapes sont requis' });

      const seqId = uuidv4();
      db.prepare('INSERT INTO sequences (id, nom, segment, options) VALUES (?, ?, ?, ?)')
        .run(seqId, nom, segment || '5*', options ? JSON.stringify(options) : null);

      db.transaction((etapes) => {
        etapes.forEach((e, i) => {
          // Log si pièce jointe présente
          if (e.piece_jointe) {
            logger.info('📎 Backend reçoit pièce jointe', {
              etape: i + 1,
              nom: e.piece_jointe.nom,
              taille: e.piece_jointe.taille,
              hasData: !!e.piece_jointe.data
            });
          }
          db.prepare('INSERT INTO etapes (id, sequence_id, ordre, jour_delai, sujet, corps, corps_html, piece_jointe) VALUES (?,?,?,?,?,?,?,?)')
            .run(uuidv4(), seqId, i + 1, e.jour_delai ?? e.jour ?? 0, e.sujet || '', e.corps || '', e.corps_html || null, e.piece_jointe ? JSON.stringify(e.piece_jointe) : null);
        });
      })(etapes);

      const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(seqId);
      logger.info('✅ Séquence créée', { nom, etapes: etapes.length });
      res.status(201).json({ ...seq, etapes: db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(seqId) });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // PUT /api/sequences/:id
  router.put('/:id', (req, res) => {
    try {
      const { nom, segment, etapes, options } = req.body;
      const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
      if (!seq) return res.status(404).json({ erreur: 'Séquence introuvable' });

      db.prepare('UPDATE sequences SET nom = ?, segment = ?, options = ? WHERE id = ?')
        .run(nom || seq.nom, segment || seq.segment, options ? JSON.stringify(options) : seq.options, req.params.id);

      if (etapes?.length) {
        db.transaction((etapes) => {
          const existantes = db.prepare('SELECT id FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(req.params.id);

          etapes.forEach((e, i) => {
            const corps_html   = e.corps_html !== undefined ? e.corps_html : null;
            const piece_jointe = e.piece_jointe ? JSON.stringify(e.piece_jointe) : null;

            // Log si pièce jointe présente
            if (e.piece_jointe) {
              logger.info('📎 Backend MAJ pièce jointe', {
                etape: i + 1,
                nom: e.piece_jointe.nom,
                taille: e.piece_jointe.taille,
                hasData: !!e.piece_jointe.data
              });
            }

            if (i < existantes.length) {
              db.prepare('UPDATE etapes SET ordre=?,jour_delai=?,sujet=?,corps=?,corps_html=?,piece_jointe=? WHERE id=?')
                .run(i + 1, e.jour_delai ?? e.jour ?? 0, e.sujet || '', e.corps || '', corps_html, piece_jointe, existantes[i].id);
            } else {
              db.prepare('INSERT INTO etapes (id,sequence_id,ordre,jour_delai,sujet,corps,corps_html,piece_jointe) VALUES (?,?,?,?,?,?,?,?)')
                .run(uuidv4(), req.params.id, i + 1, e.jour_delai ?? e.jour ?? 0, e.sujet || '', e.corps || '', corps_html, piece_jointe);
            }
          });

          // Supprimer les étapes en surplus (seulement si pas d'emails liés)
          for (let i = etapes.length; i < existantes.length; i++) {
            const { c } = db.prepare('SELECT COUNT(*) as c FROM emails WHERE etape_id=?').get(existantes[i].id);
            if (!c) db.prepare('DELETE FROM etapes WHERE id=?').run(existantes[i].id);
          }
        })(etapes);
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
      const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
      if (!seq) return res.status(404).json({ erreur: 'Séquence introuvable' });

      // Supprimer dans une transaction pour garantir la cohérence
      db.transaction(() => {
        // 1. Récupérer tous les IDs des inscriptions et étapes
        const inscriptionIds = db.prepare('SELECT id FROM inscriptions WHERE sequence_id = ?').all(req.params.id).map(i => i.id);
        const etapeIds = db.prepare('SELECT id FROM etapes WHERE sequence_id = ?').all(req.params.id).map(e => e.id);

        // 2. Supprimer TOUS les emails liés à cette séquence en une seule fois
        if (inscriptionIds.length > 0) {
          const placeholders = inscriptionIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM emails WHERE inscription_id IN (${placeholders})`).run(...inscriptionIds);
        }
        if (etapeIds.length > 0) {
          const placeholders = etapeIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM emails WHERE etape_id IN (${placeholders})`).run(...etapeIds);
        }

        // 3. Supprimer les events liés aux emails (déjà supprimés, mais par sécurité)
        // Les events avec email_id NULL sont conservés

        // 4. Supprimer les inscriptions
        db.prepare('DELETE FROM inscriptions WHERE sequence_id = ?').run(req.params.id);

        // 5. Supprimer les étapes
        db.prepare('DELETE FROM etapes WHERE sequence_id = ?').run(req.params.id);

        // 6. Supprimer la séquence
        db.prepare('DELETE FROM sequences WHERE id = ?').run(req.params.id);
      })();

      logger.info('🗑️  Séquence supprimée', { nom: seq.nom, id: req.params.id });
      res.json({ message: 'Séquence supprimée avec succès' });
    } catch (err) {
      logger.error('Erreur suppression séquence', { error: err.message, stack: err.stack });
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences/:id/inscrire
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
      logger.info('🚀 Lead inscrit', { lead: lead.email, sequence: seq.nom });
      res.json({ message: `${lead.prenom} ${lead.nom} inscrit(e) à "${seq.nom}"`, inscription });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences/:id/inscrire-batch
  router.post('/:id/inscrire-batch', (req, res) => {
    try {
      const { lead_ids } = req.body;
      if (!Array.isArray(lead_ids)) return res.status(400).json({ erreur: 'lead_ids doit être un tableau' });

      const resultats = lead_ids.map(leadId => {
        try {
          return { lead_id: leadId, statut: 'inscrit', inscription: inscrireLead(leadId, req.params.id) };
        } catch (e) {
          return { lead_id: leadId, statut: 'erreur', erreur: e.message };
        }
      });

      res.json({ resultats, inscrits: resultats.filter(r => r.statut === 'inscrit').length });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/sequences/:id/inscriptions
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

  // DELETE /api/sequences/inscriptions/:id — Retirer un lead
  router.delete('/inscriptions/:id', (req, res) => {
    try {
      db.prepare(`UPDATE inscriptions SET statut = 'terminé' WHERE id = ?`).run(req.params.id);
      res.json({ message: 'Lead retiré de la séquence' });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // PATCH /api/sequences/inscriptions/:id — Modifier une inscription (pour tests)
  router.patch('/inscriptions/:id', (req, res) => {
    try {
      const { etape_courante, prochain_envoi } = req.body;
      const updates = [];
      const params = [];

      if (etape_courante !== undefined) {
        updates.push('etape_courante = ?');
        params.push(etape_courante);
      }
      if (prochain_envoi !== undefined) {
        updates.push('prochain_envoi = ?');
        params.push(prochain_envoi);
      }

      if (updates.length === 0) {
        return res.status(400).json({ erreur: 'Aucune mise à jour fournie' });
      }

      params.push(req.params.id);
      db.prepare(`UPDATE inscriptions SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const updated = db.prepare('SELECT * FROM inscriptions WHERE id = ?').get(req.params.id);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences/stop-lead/:leadId — Arrêter toutes les séquences d'un lead
  router.post('/stop-lead/:leadId', (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });

      const result = db.prepare(`
        UPDATE inscriptions
        SET statut = 'terminé', prochain_envoi = NULL
        WHERE lead_id = ? AND statut = 'actif'
      `).run(req.params.leadId);

      logger.info(`⏹️  Séquences arrêtées pour ${lead.email}`, { count: result.changes });
      res.json({ message: `${result.changes} séquence(s) arrêtée(s)`, count: result.changes });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences/test-email — Tester un seul email
  router.post('/test-email', async (req, res) => {
    try {
      const { inscription_id } = req.body;
      if (!inscription_id) return res.status(400).json({ erreur: 'inscription_id requis' });

      const inscription = db.prepare('SELECT * FROM inscriptions WHERE id = ?').get(inscription_id);
      if (!inscription) return res.status(404).json({ erreur: 'Inscription introuvable' });

      // Envoyer directement cet email uniquement
      await traiterInscriptionDirect(inscription);

      res.json({ message: 'Email de test envoyé', inscription_id });
    } catch (err) {
      logger.error('Erreur test email', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences/:id/test-complete — Tester TOUTE la séquence (tous les emails)
  router.post('/:id/test-complete', async (req, res) => {
    try {
      const { test_email } = req.body;
      if (!test_email) return res.status(400).json({ erreur: 'test_email requis' });

      const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
      if (!seq) return res.status(404).json({ erreur: 'Séquence introuvable' });

      const etapes = db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(req.params.id);
      if (!etapes.length) return res.status(400).json({ erreur: 'Séquence vide' });

      // Chercher ou créer le lead de test
      const existing = db.prepare('SELECT * FROM leads WHERE email = ?').get(test_email);
      let leadId;
      if (existing) {
        leadId = existing.id;
      } else {
        leadId = uuidv4();
        db.prepare('INSERT INTO leads (id, email, prenom, nom, hotel, segment, statut) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(leadId, test_email, 'Test', 'Séquence', 'Test Hotel', '5*', 'Nouveau');
      }

      // Inscrire le lead (ou réinscrire)
      const inscription = inscrireLead(leadId, req.params.id);

      // Retourner immédiatement et traiter en arrière-plan
      res.json({
        message: `Test lancé : ${etapes.length} email(s) seront envoyés vers ${test_email}`,
        emails_total: etapes.length,
        test_email
      });

      // Envoyer tous les emails en arrière-plan
      setImmediate(async () => {
        let envoyes = 0;
        for (let i = 0; i < etapes.length; i++) {
          try {
            // Récupérer l'inscription à jour
            const inscriptionActuelle = db.prepare('SELECT * FROM inscriptions WHERE lead_id = ? AND sequence_id = ?')
              .get(leadId, req.params.id);

            if (!inscriptionActuelle) {
              logger.error('Inscription introuvable pour test complet', { leadId, sequenceId: req.params.id });
              break;
            }

            // Mettre à jour l'étape courante
            db.prepare('UPDATE inscriptions SET etape_courante = ?, prochain_envoi = ? WHERE id = ?')
              .run(i, new Date().toISOString(), inscriptionActuelle.id);

            // Récupérer l'inscription mise à jour
            const inscriptionUpdated = db.prepare('SELECT * FROM inscriptions WHERE id = ?').get(inscriptionActuelle.id);

            // Envoyer cet email
            await traiterInscriptionDirect(inscriptionUpdated);
            envoyes++;

            logger.info(`✅ Test complet: Email ${i + 1}/${etapes.length} envoyé à ${test_email}`);

            // Attendre 2-3 secondes avant le suivant pour éviter la limite de taux
            if (i < etapes.length - 1) {
              await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
            }
          } catch (err) {
            logger.error(`❌ Erreur envoi email ${i + 1} du test complet`, { error: err.message });
          }
        }

        // Marquer comme terminé
        db.prepare('UPDATE inscriptions SET statut = ?, prochain_envoi = NULL WHERE lead_id = ? AND sequence_id = ?')
          .run('terminé', leadId, req.params.id);

        logger.info(`🎉 Test complet terminé: ${envoyes}/${etapes.length} emails envoyés à ${test_email}`);
      });
    } catch (err) {
      logger.error('Erreur test complet', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/sequences/trigger-now — Envoi direct (bypass fenêtre horaire)
  router.post('/trigger-now', async (req, res) => {
    try {
      const { lead_ids, async } = req.body || {};

      let inscriptions;
      if (lead_ids?.length) {
        const placeholders = lead_ids.map(() => '?').join(',');
        inscriptions = db.prepare(`
          SELECT i.* FROM inscriptions i
          WHERE i.statut = 'actif' AND i.lead_id IN (${placeholders})
          ORDER BY i.created_at DESC
        `).all(...lead_ids);
      } else {
        inscriptions = db.prepare(`
          SELECT * FROM inscriptions WHERE statut = 'actif'
          ORDER BY created_at DESC LIMIT 50
        `).all();
      }

      if (!inscriptions.length) return res.json({ message: 'Aucune inscription active', envoyes: 0 });

      // Mode asynchrone : retourne immédiatement et traite en arrière-plan
      if (async) {
        res.json({
          message: `Envoi de ${inscriptions.length} email(s) en cours en arrière-plan...`,
          count: inscriptions.length,
          async: true
        });

        // Traitement en arrière-plan (fire and forget)
        setImmediate(async () => {
          let envoyes = 0;
          for (const inscription of inscriptions) {
            try {
              await traiterInscriptionDirect(inscription);
              envoyes++;
              await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
            } catch (err) {
              logger.error('Erreur envoi forcé async', { error: err.message });
            }
          }
          logger.info(`✅ Envoi async terminé: ${envoyes}/${inscriptions.length} emails envoyés`);
        });

        return;
      }

      // Mode synchrone (comportement par défaut)
      let envoyes = 0;
      const erreurs = [];

      for (const inscription of inscriptions) {
        try {
          await traiterInscriptionDirect(inscription);
          envoyes++;
        } catch (err) {
          erreurs.push({ inscription_id: inscription.id, erreur: err.message });
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
