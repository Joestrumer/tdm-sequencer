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
    const users = db.prepare('SELECT id, email, nom, role, permissions, actif, vf_api_token, gsheets_spreadsheet_id, created_at, updated_at FROM users ORDER BY created_at').all();
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

    const { nom, role, permissions, actif, password, gsheets_spreadsheet_id } = req.body;
    const updates = [];
    const values = [];

    if (nom !== undefined) { updates.push('nom = ?'); values.push(nom.trim()); }
    if (role !== undefined && (role === 'admin' || role === 'member')) { updates.push('role = ?'); values.push(role); }
    if (permissions !== undefined) { updates.push('permissions = ?'); values.push(JSON.stringify(permissions)); }
    if (actif !== undefined) { updates.push('actif = ?'); values.push(actif ? 1 : 0); }
    if (gsheets_spreadsheet_id !== undefined) { updates.push('gsheets_spreadsheet_id = ?'); values.push(gsheets_spreadsheet_id || null); }
    if (password) {
      if (password.length < 6) return res.status(400).json({ erreur: 'Mot de passe trop court (min 6)' });
      updates.push('password_hash = ?'); values.push(bcrypt.hashSync(password, 10));
    }

    if (updates.length === 0) return res.status(400).json({ erreur: 'Aucune modification' });

    updates.push("updated_at = datetime('now')");
    values.push(id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT id, email, nom, role, permissions, actif, vf_api_token, gsheets_spreadsheet_id, created_at, updated_at FROM users WHERE id = ?').get(id);
    res.json({
      ...updated,
      permissions: JSON.parse(updated.permissions || '{}'),
      vf_api_token: updated.vf_api_token ? true : false,
    });
  });

  // POST /api/users/:id/send-credentials — Envoyer les identifiants par email
  router.post('/:id/send-credentials', async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;
      if (!password) return res.status(400).json({ erreur: 'Mot de passe requis' });

      const user = db.prepare('SELECT id, email, nom, role FROM users WHERE id = ?').get(id);
      if (!user) return res.status(404).json({ erreur: 'Utilisateur introuvable' });

      const { brevoSendEmail } = require('../services/brevoService');
      const PUBLIC_URL = `${req.protocol}://${req.get('host')}`;

      const htmlContent = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="color:#1a1a1a;margin-bottom:16px;">Bienvenue sur TDM Sequencer</h2>
          <p style="color:#444;font-size:14px;line-height:1.6;">Bonjour <strong>${user.nom}</strong>,</p>
          <p style="color:#444;font-size:14px;line-height:1.6;">Votre compte a été créé. Voici vos identifiants de connexion :</p>
          <div style="background:#f8f9fa;border:1px solid #e9ecef;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="margin:4px 0;font-size:14px;"><strong>Email :</strong> ${user.email}</p>
            <p style="margin:4px 0;font-size:14px;"><strong>Mot de passe :</strong> ${password}</p>
          </div>
          <p style="color:#444;font-size:14px;line-height:1.6;">
            Connectez-vous ici : <a href="${PUBLIC_URL}" style="color:#aa8d3e;">${PUBLIC_URL}</a>
          </p>
          <p style="color:#999;font-size:12px;margin-top:24px;">Nous vous recommandons de changer votre mot de passe après votre première connexion.</p>
        </div>
      `;

      await brevoSendEmail({
        sender: { email: 'hugo@terredemars.com', name: 'Hugo Montiel' },
        to: [{ email: user.email, name: user.nom }],
        subject: 'Vos identifiants TDM Sequencer',
        htmlContent,
      });

      res.json({ ok: true, message: 'Identifiants envoyés par email' });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // DELETE /api/users/:id — Supprimer un utilisateur
  router.delete('/:id', (req, res) => {
    const { id } = req.params;

    // Empêcher de se supprimer soi-même
    if (req.user.id === id) {
      return res.status(400).json({ erreur: 'Impossible de supprimer votre propre compte' });
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ erreur: 'Utilisateur introuvable' });

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true, message: 'Utilisateur supprimé' });
  });

  return router;
};
