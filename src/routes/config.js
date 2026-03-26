/**
 * config.js — Sauvegarde et lecture de la configuration
 * Clés API, paramètres d'envoi, etc.
 */

const express = require('express');

// Clés sensibles à ne jamais renvoyer en clair (masquées)
const CLES_SENSIBLES = ['brevo_api_key', 'hubspot_api_key', 'auth_secret', 'zerobounce_api_key', 'vf_api_token', 'gsheets_credentials', 'external_api_key'];

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

  // Clés autorisées à être écrites dans process.env
  const CLES_ENV_AUTORISEES = ['brevo_api_key', 'hubspot_api_key', 'zerobounce_api_key', 'vf_api_token',
    'brevo_smtp_key', 'brevo_smtp_user', 'brevo_smtp_port', 'max_emails_per_day',
    'send_hour_start', 'send_hour_end', 'active_days', 'public_url',
    'hs_sync_contact', 'hs_log_email', 'hs_lifecycle', 'hs_task_fin_sequence', 'hs_deal_conversion',
    'external_api_key', 'gsheets_credentials', 'wms_user', 'wms_password'];

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
            // Mettre à jour process.env uniquement pour les clés autorisées
            if (CLES_ENV_AUTORISEES.includes(cle)) {
              const envKey = cle.toUpperCase();
              process.env[envKey] = String(valeur);
            }
          }
        }
      });

      saveMany(Object.entries(req.body));
      res.json({ ok: true, saved: Object.keys(req.body).length });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Lire une clé spécifique
  router.get('/:cle', (req, res) => {
    try {
      const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get(req.params.cle);
      if (!row) return res.status(404).json({ erreur: 'Clé introuvable' });
      // Masquer les clés sensibles
      if (CLES_SENSIBLES.includes(req.params.cle) && row.valeur) {
        return res.json({ cle: req.params.cle, valeur: row.valeur.substring(0, 8) + '••••••••', configured: true });
      }
      res.json({ cle: req.params.cle, valeur: row.valeur });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
