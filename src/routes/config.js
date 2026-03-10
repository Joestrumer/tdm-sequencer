/**
 * config.js — Sauvegarde et lecture de la configuration
 * Clés API, paramètres d'envoi, etc.
 */

const express = require('express');

// Clés sensibles à ne jamais renvoyer en clair (masquées)
const CLES_SENSIBLES = ['brevo_api_key', 'hubspot_api_key', 'auth_secret'];

module.exports = (db) => {
  const router = express.Router();

  // Lire toute la config
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare('SELECT cle, valeur FROM config').all();
      const config = {};
      for (const { cle, valeur } of rows) {
        // Masquer les clés sensibles (afficher juste les 6 premiers chars)
        if (CLES_SENSIBLES.includes(cle) && valeur) {
          config[cle] = valeur.substring(0, 8) + '••••••••';
          config[cle + '_configured'] = true;
        } else {
          config[cle] = valeur;
        }
      }
      res.json(config);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Sauvegarder une ou plusieurs clés
  router.post('/', (req, res) => {
    try {
      const upsert = db.prepare(`
        INSERT INTO config (cle, valeur, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, updated_at = excluded.updated_at
      `);

      const saveMany = db.transaction((entries) => {
        for (const [cle, valeur] of entries) {
          if (valeur !== undefined && valeur !== null) {
            upsert.run(cle, String(valeur));
            // Mettre à jour process.env en temps réel
            const envKey = cle.toUpperCase();
            process.env[envKey] = String(valeur);
          }
        }
      });

      saveMany(Object.entries(req.body));
      res.json({ ok: true, saved: Object.keys(req.body).length });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Lire une clé spécifique (valeur complète, pour usage interne)
  router.get('/:cle', (req, res) => {
    try {
      const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get(req.params.cle);
      if (!row) return res.status(404).json({ erreur: 'Clé introuvable' });
      res.json({ cle: req.params.cle, valeur: row.valeur });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
