/**
 * blocklist.js — Gestion de la liste d'exclusion d'emails
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

module.exports = (db) => {

  // GET /api/blocklist — Liste toutes les entrées bloquées
  router.get('/', (req, res) => {
    try {
      const entries = db.prepare('SELECT * FROM email_blocklist ORDER BY created_at DESC').all();
      res.json({ blocklist: entries });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/blocklist — Ajouter une entrée à la blocklist
  router.post('/', (req, res) => {
    try {
      const { type, value, raison } = req.body;

      if (!type || !value) {
        return res.status(400).json({ erreur: 'type et value requis' });
      }

      if (type !== 'email' && type !== 'domain') {
        return res.status(400).json({ erreur: 'type doit être "email" ou "domain"' });
      }

      const id = uuidv4();
      db.prepare(`
        INSERT INTO email_blocklist (id, type, value, raison)
        VALUES (?, ?, ?, ?)
      `).run(id, type, value.toLowerCase().trim(), raison || null);

      const entry = db.prepare('SELECT * FROM email_blocklist WHERE id = ?').get(id);
      logger.info('📛 Ajout blocklist', { type, value });
      res.status(201).json(entry);
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(409).json({ erreur: 'Cette entrée existe déjà dans la blocklist' });
      }
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/blocklist/from-lead/:leadId — Ajouter l'email d'un lead à la blocklist
  router.post('/from-lead/:leadId', (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });

      const { raison } = req.body;
      const id = uuidv4();

      try {
        const bloquerLead = db.transaction(() => {
          db.prepare(`
            INSERT INTO email_blocklist (id, type, value, raison)
            VALUES (?, 'email', ?, ?)
          `).run(id, lead.email.toLowerCase().trim(), raison || `Lead ${lead.prenom} ${lead.nom}`);

          db.prepare(`
            UPDATE leads SET unsubscribed = 1, statut = 'Désabonné', updated_at = datetime('now')
            WHERE id = ?
          `).run(lead.id);

          db.prepare(`
            UPDATE inscriptions SET statut = 'terminé' WHERE lead_id = ? AND statut = 'actif'
          `).run(lead.id);
        });

        bloquerLead();

        const entry = db.prepare('SELECT * FROM email_blocklist WHERE id = ?').get(id);
        logger.info('📛 Lead ajouté à la blocklist', { email: lead.email });
        res.json({ message: 'Lead ajouté à la blocklist', entry });
      } catch (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(409).json({ erreur: 'Cet email est déjà dans la blocklist' });
        }
        throw err;
      }
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // DELETE /api/blocklist/:id — Retirer une entrée de la blocklist
  router.delete('/:id', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM email_blocklist WHERE id = ?').run(req.params.id);
      if (!result.changes) return res.status(404).json({ erreur: 'Entrée introuvable' });
      res.json({ message: 'Entrée retirée de la blocklist' });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // PATCH /api/blocklist/:id/override — Autoriser l'envoi malgré le blocage
  router.patch('/:id/override', (req, res) => {
    try {
      const { allowed } = req.body;
      db.prepare(`
        UPDATE email_blocklist SET override_allowed = ? WHERE id = ?
      `).run(allowed ? 1 : 0, req.params.id);

      const entry = db.prepare('SELECT * FROM email_blocklist WHERE id = ?').get(req.params.id);
      res.json(entry);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/blocklist/check/:email — Vérifier si un email est bloqué
  router.get('/check/:email', (req, res) => {
    try {
      const email = req.params.email.toLowerCase().trim();
      const domain = email.split('@')[1];

      // Vérifier email exact
      const emailBlock = db.prepare('SELECT * FROM email_blocklist WHERE type = "email" AND value = ?').get(email);

      // Vérifier domaine
      const domainBlock = db.prepare('SELECT * FROM email_blocklist WHERE type = "domain" AND value = ?').get(domain);

      const blocked = emailBlock || domainBlock;

      res.json({
        blocked: !!blocked,
        entry: blocked || null,
        canOverride: blocked?.override_allowed === 1,
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
