/**
 * pauses.js — Gestion des periodes de pause pour les sequences
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { getPausesActives, getAllPauses, getPauseGlobaleActive, getPauseSequenceActive } = require('../services/pauseService');

module.exports = (db) => {

  // GET /api/pauses — Lister toutes les pauses (actives + historique)
  router.get('/', (req, res) => {
    try {
      const pauses = getAllPauses(db);
      res.json({ pauses });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/pauses/actives — Pauses actives uniquement
  router.get('/actives', (req, res) => {
    try {
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const pauses = getPausesActives(db, now);
      res.json({ pauses });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/pauses/status — Status rapide
  router.get('/status', (req, res) => {
    try {
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const pauseGlobale = getPauseGlobaleActive(db, now);
      const sequencePauses = db.prepare(`
        SELECT p.*, s.nom as sequence_nom
        FROM pause_periods p
        LEFT JOIN sequences s ON s.id = p.sequence_id
        WHERE p.type = 'sequence'
          AND datetime(p.date_debut) <= datetime(?)
          AND (p.date_fin IS NULL OR datetime(p.date_fin) > datetime(?))
      `).all(now, now);
      res.json({
        global_paused: !!pauseGlobale,
        global_pause: pauseGlobale || null,
        sequence_pauses: sequencePauses,
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/pauses — Creer une pause
  router.post('/', (req, res) => {
    try {
      const { type, sequence_id, mode, date_debut, date_fin, raison } = req.body;

      // Validations
      if (!type || !['global', 'sequence'].includes(type)) {
        return res.status(400).json({ erreur: 'type doit etre "global" ou "sequence"' });
      }
      if (type === 'sequence' && !sequence_id) {
        return res.status(400).json({ erreur: 'sequence_id requis pour une pause de type "sequence"' });
      }
      if (!mode || !['scheduled', 'manual'].includes(mode)) {
        return res.status(400).json({ erreur: 'mode doit etre "scheduled" ou "manual"' });
      }
      if (mode === 'scheduled') {
        if (!date_debut || !date_fin) {
          return res.status(400).json({ erreur: 'date_debut et date_fin requis pour une pause programmee' });
        }
        if (new Date(date_fin) <= new Date(date_debut)) {
          return res.status(400).json({ erreur: 'date_fin doit etre posterieure a date_debut' });
        }
      }

      const id = uuidv4();
      const debut = date_debut || new Date().toISOString().replace('T', ' ').slice(0, 19);
      const fin = mode === 'manual' ? null : date_fin;

      db.prepare(`
        INSERT INTO pause_periods (id, type, sequence_id, mode, date_debut, date_fin, raison)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, type, type === 'global' ? null : sequence_id, mode, debut, fin, raison || null);

      const pause = db.prepare('SELECT * FROM pause_periods WHERE id = ?').get(id);
      logger.info('Pause creee', { id, type, mode, sequence_id: sequence_id || null });
      res.status(201).json(pause);
    } catch (err) {
      logger.error('Erreur creation pause', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/pauses/:id/resume — Terminer une pause manuelle
  router.post('/:id/resume', (req, res) => {
    try {
      const pause = db.prepare('SELECT * FROM pause_periods WHERE id = ?').get(req.params.id);
      if (!pause) return res.status(404).json({ erreur: 'Pause introuvable' });

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      // Terminer la pause en fixant date_fin = maintenant
      db.prepare('UPDATE pause_periods SET date_fin = ? WHERE id = ?').run(now, pause.id);

      // Declencher le recalcul via le scheduler
      let recalculated = 0;
      try {
        const { recalculerApresReprise } = require('../jobs/sequenceScheduler');
        recalculated = recalculerApresReprise(pause.id);
      } catch (e) {
        logger.warn('Recalcul apres reprise echoue', { error: e.message });
      }

      logger.info('Pause terminee (reprise)', { id: pause.id, recalculated });
      res.json({ ok: true, recalculated });
    } catch (err) {
      logger.error('Erreur reprise pause', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // DELETE /api/pauses/:id — Supprimer une pause
  router.delete('/:id', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM pause_periods WHERE id = ?').run(req.params.id);
      if (result.changes === 0) return res.status(404).json({ erreur: 'Pause introuvable' });
      logger.info('Pause supprimee', { id: req.params.id });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
