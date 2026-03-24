/**
 * users.js — CRUD utilisateurs (admin only)
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const { requireAdmin } = require('../middleware/permissions');

module.exports = (db) => {
  const router = express.Router();

  // Toutes les routes sont admin-only
  router.use(requireAdmin);

  // GET /api/users — Liste tous les utilisateurs
  router.get('/', (req, res) => {
    const users = db.prepare('SELECT id, email, nom, role, permissions, actif, vf_api_token, created_at, updated_at FROM users ORDER BY created_at').all();
    res.json(users.map(u => ({
      ...u,
      permissions: JSON.parse(u.permissions || '{}'),
      vf_api_token: u.vf_api_token ? true : false,
    })));
  });

  // POST /api/users — Créer un utilisateur
  router.post('/', (req, res) => {
    const { email, nom, password, role, permissions } = req.body;

    if (!email || !nom || !password) {
      return res.status(400).json({ erreur: 'Email, nom et mot de passe requis' });
    }

    if (password.length < 6) {
      return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    // Vérifier unicité email
    const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email.trim());
    if (existing) {
      return res.status(409).json({ erreur: 'Un utilisateur avec cet email existe déjà' });
    }

    const id = randomUUID();
    const hash = bcrypt.hashSync(password, 10);
    const permsJson = JSON.stringify(permissions || {});
    const userRole = (role === 'admin' || role === 'member') ? role : 'member';

    db.prepare(`INSERT INTO users (id, email, password_hash, nom, role, permissions) VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, email.trim(), hash, nom.trim(), userRole, permsJson
    );

    res.json({
      id,
      email: email.trim(),
      nom: nom.trim(),
      role: userRole,
      permissions: permissions || {},
      actif: 1,
    });
  });

  // PATCH /api/users/:id — Modifier un utilisateur
  router.patch('/:id', (req, res) => {
    const { id } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ erreur: 'Utilisateur introuvable' });

    const { nom, role, permissions, actif, password } = req.body;
    const updates = [];
    const values = [];

    if (nom !== undefined) { updates.push('nom = ?'); values.push(nom.trim()); }
    if (role !== undefined && (role === 'admin' || role === 'member')) { updates.push('role = ?'); values.push(role); }
    if (permissions !== undefined) { updates.push('permissions = ?'); values.push(JSON.stringify(permissions)); }
    if (actif !== undefined) { updates.push('actif = ?'); values.push(actif ? 1 : 0); }
    if (password) {
      if (password.length < 6) return res.status(400).json({ erreur: 'Mot de passe trop court (min 6)' });
      updates.push('password_hash = ?'); values.push(bcrypt.hashSync(password, 10));
    }

    if (updates.length === 0) return res.status(400).json({ erreur: 'Aucune modification' });

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT id, email, nom, role, permissions, actif, vf_api_token, created_at, updated_at FROM users WHERE id = ?').get(id);
    res.json({
      ...updated,
      permissions: JSON.parse(updated.permissions || '{}'),
      vf_api_token: updated.vf_api_token ? true : false,
    });
  });

  // DELETE /api/users/:id — Désactiver (soft delete)
  router.delete('/:id', (req, res) => {
    const { id } = req.params;

    // Empêcher de se supprimer soi-même
    if (req.user.id === id) {
      return res.status(400).json({ erreur: 'Impossible de désactiver votre propre compte' });
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ erreur: 'Utilisateur introuvable' });

    db.prepare("UPDATE users SET actif = 0, updated_at = datetime('now') WHERE id = ?").run(id);
    res.json({ ok: true, message: 'Utilisateur désactivé' });
  });

  return router;
};
