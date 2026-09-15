/**
 * partnerAuth.js — Middleware JWT pour auth partenaire
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.PARTNER_JWT_SECRET || process.env.AUTH_SECRET;
if (!JWT_SECRET) {
  console.error('⛔ FATAL : PARTNER_JWT_SECRET ou AUTH_SECRET doit être défini dans les variables d\'environnement');
  process.exit(1);
}

function partnerAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erreur: 'Token partenaire requis' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.partner = { id: decoded.partnerId, nom: decoded.partnerNom };

    // Support compte maître multi-établissements
    if (decoded.isMaster) {
      req.partner.isMaster = true;
      req.partner.subAccountIds = decoded.subAccountIds || [];

      const actingAsHeader = req.headers['x-acting-partner-id'];
      if (actingAsHeader) {
        const actingAsId = parseInt(actingAsHeader, 10);
        if (!req.partner.subAccountIds.includes(actingAsId)) {
          return res.status(403).json({ erreur: 'Accès non autorisé à cet établissement' });
        }
        req.partner.effectiveId = actingAsId;
      } else {
        req.partner.effectiveId = decoded.partnerId;
      }
    } else {
      req.partner.effectiveId = decoded.partnerId;
    }

    next();
  } catch (e) {
    return res.status(401).json({ erreur: 'Token partenaire invalide ou expiré' });
  }
}

partnerAuth.JWT_SECRET = JWT_SECRET;

module.exports = partnerAuth;
