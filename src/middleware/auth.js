/**
 * auth.js — Middleware d'authentification JWT + fallback AUTH_SECRET
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || process.env.AUTH_SECRET || 'tdm-sequencer-secret';

function authMiddleware(db) {
  return (req, res, next) => {
    // Routes de tracking publiques
    if (req.path.startsWith('/api/tracking')) return next();

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ erreur: 'Authentification requise' });
    }

    // Mode 1 : fallback AUTH_SECRET (rétro-compatibilité)
    if (process.env.AUTH_SECRET && token === process.env.AUTH_SECRET) {
      req.user = {
        id: '_legacy_admin',
        nom: 'Admin',
        email: 'admin@terredemars.com',
        role: 'admin',
        permissions: {},
        vf_api_token: null,
      };
      return next();
    }

    // Mode 2 : JWT
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, email, nom, role, permissions, vf_api_token, gsheets_spreadsheet_id, actif FROM users WHERE id = ?').get(decoded.userId);

      if (!user || !user.actif) {
        return res.status(401).json({ erreur: 'Compte désactivé ou introuvable' });
      }

      let permissions = {};
      try { permissions = JSON.parse(user.permissions || '{}'); } catch (_) {}

      req.user = {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        permissions,
        vf_api_token: user.vf_api_token,
        gsheets_spreadsheet_id: user.gsheets_spreadsheet_id,
      };
      next();
    } catch (e) {
      return res.status(401).json({ erreur: 'Token invalide ou expiré' });
    }
  };
}

module.exports = authMiddleware;
module.exports.JWT_SECRET = JWT_SECRET;
