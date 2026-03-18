/**
 * emailTemplates.js — Routes CRUD pour les templates d'emails
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

module.exports = (db) => {

  // GET /api/email-templates — Liste tous les templates
  router.get('/', (req, res) => {
    try {
      const { categorie } = req.query;
      let query = 'SELECT * FROM email_templates WHERE 1=1';
      const params = [];

      if (categorie && categorie !== 'Tous') {
        query += ' AND categorie = ?';
        params.push(categorie);
      }

      query += ' ORDER BY created_at DESC';
      const templates = db.prepare(query).all(...params);

      // Parse tags JSON
      const templatesWithTags = templates.map(t => ({
        ...t,
        tags: JSON.parse(t.tags || '[]')
      }));

      res.json({ templates: templatesWithTags });
    } catch (err) {
      logger.error('GET /email-templates erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/email-templates/categories — Liste les catégories
  router.get('/categories', (req, res) => {
    try {
      const categories = db.prepare(`
        SELECT DISTINCT categorie FROM email_templates
        ORDER BY categorie
      `).all().map(c => c.categorie);

      res.json({ categories: ['Tous', ...categories] });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/email-templates/:id — Détail d'un template
  router.get('/:id', (req, res) => {
    try {
      const template = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id);
      if (!template) return res.status(404).json({ erreur: 'Template introuvable' });

      res.json({
        ...template,
        tags: JSON.parse(template.tags || '[]')
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/email-templates — Créer un template
  router.post('/', (req, res) => {
    try {
      const { nom, categorie, sujet, corps_html, content_json, tags } = req.body;
      if (!nom || !sujet) {
        return res.status(400).json({ erreur: 'nom et sujet sont requis' });
      }

      const id = uuidv4();
      const tagsStr = typeof tags === 'string' ? tags : JSON.stringify(tags || []);

      db.prepare(`
        INSERT INTO email_templates (id, nom, categorie, sujet, corps_html, content_json, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        nom,
        categorie || 'General',
        sujet,
        corps_html || null,
        content_json || null,
        tagsStr
      );

      const template = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(id);
      logger.info('✅ Template email créé', { nom });
      res.status(201).json({
        ...template,
        tags: JSON.parse(template.tags || '[]')
      });
    } catch (err) {
      logger.error('POST /email-templates erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // PATCH /api/email-templates/:id — Mettre à jour un template
  router.patch('/:id', (req, res) => {
    try {
      const template = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id);
      if (!template) return res.status(404).json({ erreur: 'Template introuvable' });

      const { nom, categorie, sujet, corps_html, content_json, tags } = req.body;

      db.prepare(`
        UPDATE email_templates SET
          nom = COALESCE(?, nom),
          categorie = COALESCE(?, categorie),
          sujet = COALESCE(?, sujet),
          corps_html = COALESCE(?, corps_html),
          content_json = COALESCE(?, content_json),
          tags = COALESCE(?, tags)
        WHERE id = ?
      `).run(
        nom,
        categorie,
        sujet,
        corps_html,
        content_json,
        tags ? JSON.stringify(tags) : null,
        req.params.id
      );

      const updated = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id);
      res.json({
        ...updated,
        tags: JSON.parse(updated.tags || '[]')
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // DELETE /api/email-templates/:id — Supprimer un template
  router.delete('/:id', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
      if (!result.changes) {
        return res.status(404).json({ erreur: 'Template introuvable' });
      }

      logger.info('🗑 Template email supprimé', { id: req.params.id });
      res.json({ message: 'Template supprimé' });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
