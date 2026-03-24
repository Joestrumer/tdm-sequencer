/**
 * permissions.js — Vérification des accès par onglet
 */

/**
 * Vérifie que l'utilisateur a accès à un onglet avec le niveau requis
 * @param {string} tabId - Identifiant de l'onglet (dashboard, leads, etc.)
 * @param {string} level - Niveau requis : 'r' (lecture) ou 'rw' (lecture+écriture)
 */
function requireAccess(tabId, level = 'r') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ erreur: 'Authentification requise' });
    }

    // Admin → accès total
    if (req.user.role === 'admin') return next();

    const perm = req.user.permissions[tabId];

    // Pas d'accès
    if (!perm) {
      return res.status(403).json({ erreur: 'Accès non autorisé à cet onglet' });
    }

    // Vérifier le niveau d'écriture si requis
    if (level === 'rw' && perm !== 'rw') {
      return res.status(403).json({ erreur: 'Modification non autorisée (lecture seule)' });
    }

    next();
  };
}

/**
 * Détermine le niveau requis selon la méthode HTTP
 * GET/HEAD → lecture, POST/PUT/PATCH/DELETE → écriture
 */
function requireAccessAuto(tabId) {
  return (req, res, next) => {
    const writeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const level = writeMethod ? 'rw' : 'r';
    return requireAccess(tabId, level)(req, res, next);
  };
}

/**
 * Vérifie que l'utilisateur est admin
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ erreur: 'Authentification requise' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ erreur: 'Réservé aux administrateurs' });
  }
  next();
}

module.exports = { requireAccess, requireAccessAuto, requireAdmin };
