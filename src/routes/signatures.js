/**
 * signatures.js — CRUD signatures email multiples
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

module.exports = (db) => {
  const router = express.Router();

  // GET / — Lister toutes les signatures (active en premier)
  router.get('/', (req, res) => {
    try {
      const signatures = db.prepare('SELECT * FROM email_signatures ORDER BY is_active DESC, created_at ASC').all();
      res.json(signatures);
    } catch (err) {
      logger.error('GET /signatures erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /active — Retourner uniquement la signature active
  router.get('/active', (req, res) => {
    try {
      const sig = db.prepare('SELECT * FROM email_signatures WHERE is_active = 1').get();
      if (!sig) {
        const { SIGNATURE_HUGO } = require('../services/brevoService');
        return res.json({ signature: SIGNATURE_HUGO, is_default: true });
      }
      res.json({ signature: sig.contenu_html, is_default: false, id: sig.id, nom: sig.nom });
    } catch (err) {
      logger.error('GET /signatures/active erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST / — Creer une signature (inactive par defaut)
  router.post('/', (req, res) => {
    try {
      const { nom, contenu_html } = req.body;
      if (!nom || !nom.trim()) return res.status(400).json({ erreur: 'Nom requis' });
      if (!contenu_html || !contenu_html.trim()) return res.status(400).json({ erreur: 'Contenu HTML requis' });

      const id = uuidv4();
      db.prepare('INSERT INTO email_signatures (id, nom, contenu_html, is_active) VALUES (?, ?, ?, 0)')
        .run(id, nom.trim(), contenu_html);

      const signature = db.prepare('SELECT * FROM email_signatures WHERE id = ?').get(id);
      res.status(201).json(signature);
    } catch (err) {
      logger.error('POST /signatures erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // PUT /:id — Modifier nom et/ou contenu_html
  router.put('/:id', (req, res) => {
    try {
      const sig = db.prepare('SELECT * FROM email_signatures WHERE id = ?').get(req.params.id);
      if (!sig) return res.status(404).json({ erreur: 'Signature introuvable' });

      const { nom, contenu_html } = req.body;
      db.prepare('UPDATE email_signatures SET nom = ?, contenu_html = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(nom || sig.nom, contenu_html !== undefined ? contenu_html : sig.contenu_html, req.params.id);

      res.json(db.prepare('SELECT * FROM email_signatures WHERE id = ?').get(req.params.id));
    } catch (err) {
      logger.error('PUT /signatures erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // PUT /:id/activate — Activer cette signature (desactiver toutes les autres)
  router.put('/:id/activate', (req, res) => {
    try {
      const sig = db.prepare('SELECT * FROM email_signatures WHERE id = ?').get(req.params.id);
      if (!sig) return res.status(404).json({ erreur: 'Signature introuvable' });

      const activate = db.transaction(() => {
        db.prepare('UPDATE email_signatures SET is_active = 0, updated_at = datetime(\'now\')').run();
        db.prepare('UPDATE email_signatures SET is_active = 1, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
      });
      activate();

      res.json(db.prepare('SELECT * FROM email_signatures WHERE id = ?').get(req.params.id));
    } catch (err) {
      logger.error('PUT /signatures/activate erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // DELETE /:id — Supprimer (refuse si is_active = 1)
  router.delete('/:id', (req, res) => {
    try {
      const sig = db.prepare('SELECT * FROM email_signatures WHERE id = ?').get(req.params.id);
      if (!sig) return res.status(404).json({ erreur: 'Signature introuvable' });

      if (sig.is_active) {
        return res.status(400).json({ erreur: 'Impossible de supprimer la signature active. Activez une autre signature d\'abord.' });
      }

      db.prepare('DELETE FROM email_signatures WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /signatures erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
