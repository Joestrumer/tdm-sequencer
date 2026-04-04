/**
 * segments.js — CRUD segments dynamiques
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

module.exports = (db) => {
  const router = express.Router();

  // GET / — Liste ordonnée
  router.get('/', (req, res) => {
    try {
      const segments = db.prepare('SELECT * FROM segments ORDER BY ordre ASC, nom ASC').all();
      res.json(segments);
    } catch (err) {
      logger.error('GET /segments erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST / — Créer
  router.post('/', (req, res) => {
    try {
      const { nom, couleur, ordre } = req.body;
      if (!nom || !nom.trim()) return res.status(400).json({ erreur: 'Nom requis' });

      const id = uuidv4();
      db.prepare('INSERT INTO segments (id, nom, couleur, ordre) VALUES (?, ?, ?, ?)')
        .run(id, nom.trim(), couleur || '#64748b', ordre || 0);

      const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(id);
      res.status(201).json(segment);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) {
        return res.status(400).json({ erreur: 'Un segment avec ce nom existe déjà' });
      }
      logger.error('POST /segments erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // PUT /:id — Modifier
  router.put('/:id', (req, res) => {
    try {
      const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(req.params.id);
      if (!segment) return res.status(404).json({ erreur: 'Segment introuvable' });

      const { nom, couleur, ordre } = req.body;
      db.prepare('UPDATE segments SET nom = ?, couleur = ?, ordre = ? WHERE id = ?')
        .run(nom || segment.nom, couleur !== undefined ? couleur : segment.couleur, ordre !== undefined ? ordre : segment.ordre, req.params.id);

      res.json(db.prepare('SELECT * FROM segments WHERE id = ?').get(req.params.id));
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) {
        return res.status(400).json({ erreur: 'Un segment avec ce nom existe déjà' });
      }
      logger.error('PUT /segments erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // DELETE /:id — Supprimer (erreur si leads existent)
  router.delete('/:id', (req, res) => {
    try {
      const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(req.params.id);
      if (!segment) return res.status(404).json({ erreur: 'Segment introuvable' });

      const leadsCount = db.prepare('SELECT COUNT(*) as n FROM leads WHERE segment = ?').get(segment.nom).n;
      if (leadsCount > 0) {
        return res.status(400).json({ erreur: `Impossible de supprimer : ${leadsCount} lead(s) utilisent ce segment` });
      }

      db.prepare('DELETE FROM segments WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /segments erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
