/**
 * config.js — Sauvegarde et lecture de la configuration
 * Clés API, paramètres d'envoi, etc.
 */

const express = require('express');

// Clés sensibles à ne jamais renvoyer en clair (masquées)
const CLES_SENSIBLES = ['brevo_api_key', 'hubspot_api_key', 'auth_secret', 'zerobounce_api_key', 'vf_api_token', 'gsheets_credentials', 'external_api_key', 'smtp_password', 'imap_password', 'brave_search_api_key', 'google_places_api_key', 'pappers_api_key', 'lusha_api_key', 'lemlist_api_key'];

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
    'external_api_key', 'gsheets_credentials', 'wms_user', 'wms_password',
    'smtp_host', 'smtp_port', 'smtp_user', 'smtp_secure', 'smtp_password',
    'imap_host', 'imap_port', 'imap_user', 'imap_secure', 'imap_password',
    'email_signature_html', 'brave_search_api_key', 'google_places_api_key', 'pappers_api_key',
    'lusha_api_key', 'lemlist_api_key'];

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

  // Lire la signature email (complète, non masquée)
  router.get('/signature', (req, res) => {
    try {
      const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get('email_signature_html');
      const { SIGNATURE_HUGO } = require('../services/brevoService');
      res.json({ signature: row?.valeur || SIGNATURE_HUGO, is_default: !row?.valeur });
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

  // ── Diagnostic stockage ──────────────────────────────────────────────────
  router.get('/storage', (req, res) => {
    try {
      const fs = require('fs');
      const path = require('path');

      // Taille des tables SQLite
      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
      `).all();

      const tableSizes = tables.map(t => {
        const count = db.prepare(`SELECT COUNT(*) as n FROM "${t.name}"`).get().n;
        return { table: t.name, rows: count };
      }).sort((a, b) => b.rows - a.rows);

      // Taille du fichier DB
      const dbPath = process.env.DB_PATH || './data/sequencer.db';
      const dbStat = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;
      const walPath = dbPath + '-wal';
      const walStat = fs.existsSync(walPath) ? fs.statSync(walPath) : null;

      // Taille des backups
      const backupDir = path.resolve('./data/backups');
      let backupSize = 0;
      let backupCount = 0;
      if (fs.existsSync(backupDir)) {
        const files = fs.readdirSync(backupDir);
        backupCount = files.length;
        files.forEach(f => {
          try { backupSize += fs.statSync(path.join(backupDir, f)).size; } catch (_) {}
        });
      }

      // Taille des logs
      const logsDir = path.resolve('./data/logs');
      let logsSize = 0;
      let logsCount = 0;
      if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir);
        logsCount = files.length;
        files.forEach(f => {
          try { logsSize += fs.statSync(path.join(logsDir, f)).size; } catch (_) {}
        });
      }

      const formatMB = (bytes) => bytes ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : '0 MB';

      res.json({
        db: {
          file: formatMB(dbStat?.size),
          wal: formatMB(walStat?.size),
          total: formatMB((dbStat?.size || 0) + (walStat?.size || 0)),
        },
        backups: { count: backupCount, size: formatMB(backupSize) },
        logs: { count: logsCount, size: formatMB(logsSize) },
        tables: tableSizes,
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ── Purge : VACUUM la DB pour récupérer l'espace ──────────────────────
  router.post('/storage/vacuum', (req, res) => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.exec('VACUUM');
      res.json({ ok: true, message: 'VACUUM terminé, WAL tronqué' });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ── Purge events anciens ──────────────────────────────────────────────
  router.post('/storage/purge-events', (req, res) => {
    try {
      const months = parseInt(req.body.months || '3', 10);
      const before = new Date();
      before.setMonth(before.getMonth() - months);
      const dateStr = before.toISOString();

      const result = db.prepare(`DELETE FROM events WHERE date < ?`).run(dateStr);
      db.pragma('wal_checkpoint(TRUNCATE)');

      res.json({ ok: true, deleted: result.changes, before: dateStr });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ── Purge : supprimer backups locaux ───────────────────────────────────
  router.post('/storage/purge-backups', (req, res) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const keep = parseInt(req.body.keep || '2', 10);
      const backupDir = path.resolve('./data/backups');

      if (!fs.existsSync(backupDir)) return res.json({ ok: true, deleted: 0 });

      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .sort().reverse();

      let deleted = 0;
      for (const f of files.slice(keep)) {
        fs.unlinkSync(path.join(backupDir, f));
        deleted++;
      }

      res.json({ ok: true, deleted, remaining: Math.min(files.length, keep) });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
