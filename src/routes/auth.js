/**
 * auth.js — Routes d'authentification (login, profil)
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

module.exports = (db) => {
  const router = express.Router();

  // POST /api/auth/login — Connexion (route publique)
  router.post('/login', (req, res) => {
    const { email, password } = req.body;

    // Permettre le login avec juste le mot de passe (AUTH_SECRET legacy)
    if (!password) {
      return res.status(400).json({ erreur: 'Mot de passe requis' });
    }

    // Mode 1 : login par email + mot de passe (table users)
    if (email) {
      const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.trim());

      if (user) {
        if (!user.actif) {
          return res.status(403).json({ erreur: 'Compte désactivé' });
        }

        if (bcrypt.compareSync(password, user.password_hash)) {
          const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

          let permissions = {};
          try { permissions = JSON.parse(user.permissions || '{}'); } catch (_) {}

          return res.json({
            token,
            user: {
              id: user.id,
              email: user.email,
              nom: user.nom,
              role: user.role,
              permissions,
              vf_api_token: user.vf_api_token ? true : false,
            },
          });
        }
      }
    }

    // Mode 2 : fallback AUTH_SECRET (rétro-compatibilité)
    if (process.env.AUTH_SECRET && password === process.env.AUTH_SECRET) {
      return res.json({
        token: process.env.AUTH_SECRET,
        user: {
          id: '_legacy_admin',
          nom: 'Admin',
          email: email || 'admin@terredemars.com',
          role: 'admin',
          permissions: {},
          vf_api_token: false,
        },
      });
    }

    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
  });

  // GET /api/auth/me — Utilisateur courant (protégé)
  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ erreur: 'Non authentifié' });

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        nom: req.user.nom,
        role: req.user.role,
        permissions: req.user.permissions,
        vf_api_token: req.user.vf_api_token ? true : false,
      },
    });
  });

  // PATCH /api/auth/profile — Modifier mot de passe et/ou clé VF (protégé)
  router.patch('/profile', (req, res) => {
    if (!req.user || req.user.id === '_legacy_admin') {
      return res.status(400).json({ erreur: 'Non disponible avec authentification legacy' });
    }

    const { old_password, new_password, vf_api_token } = req.body;

    // Changer le mot de passe
    if (new_password) {
      if (!old_password) {
        return res.status(400).json({ erreur: 'Ancien mot de passe requis' });
      }

      const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!bcrypt.compareSync(old_password, user.password_hash)) {
        return res.status(401).json({ erreur: 'Ancien mot de passe incorrect' });
      }

      if (new_password.length < 6) {
        return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 6 caractères' });
      }

      const hash = bcrypt.hashSync(new_password, 10);
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, req.user.id);
    }

    // Changer la clé VF
    if (vf_api_token !== undefined) {
      db.prepare("UPDATE users SET vf_api_token = ?, updated_at = datetime('now') WHERE id = ?").run(
        vf_api_token || null, req.user.id
      );
    }

    res.json({ ok: true, message: 'Profil mis à jour' });
  });

  return router;
};
