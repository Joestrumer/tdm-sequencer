/**
 * auth.js — Middleware d'authentification par token
 * Usage : Authorization: Bearer <token>
 */

function authMiddleware(req, res, next) {
  // Les routes de tracking sont publiques (pixel, désabonnement)
  if (req.path.startsWith('/api/tracking')) return next();

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token || token !== process.env.AUTH_SECRET) {
    return res.status(401).json({ erreur: 'Non autorisé. Fournissez un token valide dans le header Authorization.' });
  }

  next();
}

module.exports = authMiddleware;
