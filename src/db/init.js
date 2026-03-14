/**
 * init.js — Initialisation SQLite
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = process.env.DB_PATH || './data/sequencer.db';
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schéma principal ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id           TEXT PRIMARY KEY,
    prenom       TEXT NOT NULL,
    nom          TEXT NOT NULL,
    email        TEXT NOT NULL UNIQUE,
    hotel        TEXT NOT NULL,
    ville        TEXT,
    segment      TEXT DEFAULT '5*',
    tags         TEXT DEFAULT '[]',
    statut       TEXT DEFAULT 'Nouveau',
    score        INTEGER DEFAULT 50,
    hubspot_id   TEXT,
    unsubscribed INTEGER DEFAULT 0,
    statut_email TEXT,
    email_score  REAL,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sequences (
    id         TEXT PRIMARY KEY,
    nom        TEXT NOT NULL,
    segment    TEXT DEFAULT '5*',
    actif      INTEGER DEFAULT 1,
    options    TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS etapes (
    id           TEXT PRIMARY KEY,
    sequence_id  TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    ordre        INTEGER NOT NULL,
    jour_delai   INTEGER NOT NULL DEFAULT 0,
    sujet        TEXT NOT NULL,
    corps        TEXT NOT NULL,
    corps_html   TEXT,
    piece_jointe TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS inscriptions (
    id             TEXT PRIMARY KEY,
    lead_id        TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    sequence_id    TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    etape_courante INTEGER DEFAULT 0,
    statut         TEXT DEFAULT 'actif',
    date_debut     TEXT DEFAULT (datetime('now')),
    prochain_envoi TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    UNIQUE(lead_id, sequence_id)
  );

  CREATE TABLE IF NOT EXISTS emails (
    id               TEXT PRIMARY KEY,
    inscription_id   TEXT NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
    lead_id          TEXT NOT NULL REFERENCES leads(id),
    etape_id         TEXT NOT NULL REFERENCES etapes(id),
    sujet            TEXT NOT NULL,
    brevo_message_id TEXT,
    tracking_id      TEXT UNIQUE,
    statut           TEXT DEFAULT 'envoyé',
    ouvertures       INTEGER DEFAULT 0,
    clics            INTEGER DEFAULT 0,
    erreur           TEXT,
    envoye_at        TEXT DEFAULT (datetime('now')),
    premier_ouvert   TEXT,
    dernier_ouvert   TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,
    email_id   TEXT REFERENCES emails(id),
    lead_id    TEXT REFERENCES leads(id),
    type       TEXT NOT NULL,
    meta       TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS envoi_quota (
    date_jour TEXT PRIMARY KEY,
    count     INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS hubspot_logs (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    action     TEXT NOT NULL,
    lead_id    TEXT,
    hubspot_id TEXT,
    payload    TEXT,
    erreur     TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    cle        TEXT PRIMARY KEY,
    valeur     TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_blocklist (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL CHECK(type IN ('email', 'domain')),
    value           TEXT NOT NULL UNIQUE,
    raison          TEXT,
    override_allowed INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_leads_email       ON leads(email);
  CREATE INDEX IF NOT EXISTS idx_leads_statut      ON leads(statut);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_next ON inscriptions(prochain_envoi, statut);
  CREATE INDEX IF NOT EXISTS idx_emails_tracking   ON emails(tracking_id);
  CREATE INDEX IF NOT EXISTS idx_events_lead       ON events(lead_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_blocklist_value   ON email_blocklist(value);
  CREATE INDEX IF NOT EXISTS idx_blocklist_type    ON email_blocklist(type);
`);

// ─── Migrations colonnes (bases existantes) ───────────────────────────────────
const migrations = [
  'ALTER TABLE etapes    ADD COLUMN corps_html   TEXT',
  'ALTER TABLE etapes    ADD COLUMN piece_jointe TEXT',
  'ALTER TABLE sequences ADD COLUMN options      TEXT',
  'ALTER TABLE leads     ADD COLUMN statut_email TEXT',
  'ALTER TABLE leads     ADD COLUMN email_score  REAL',
  'ALTER TABLE leads     ADD COLUMN poste        TEXT',
];
for (const sql of migrations) {
  try { db.prepare(sql).run(); } catch (_) { /* colonne déjà présente */ }
}

console.log('✅ Base de données initialisée :', DB_PATH);
module.exports = db;
