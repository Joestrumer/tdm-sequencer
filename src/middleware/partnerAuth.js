/**
 * partnerAuth.js — Middleware JWT pour auth partenaire
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.PARTNER_JWT_SECRET || process.env.AUTH_SECRET || 'tdm-partner-secret';

function partnerAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erreur: 'Token partenaire requis' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.partner = { id: decoded.partnerId, nom: decoded.partnerNom };
    next();
  } catch (e) {
    return res.status(401).json({ erreur: 'Token partenaire invalide ou expiré' });
  }
}

partnerAuth.JWT_SECRET = JWT_SECRET;

module.exports = partnerAuth;
