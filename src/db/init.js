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
db.pragma('synchronous = FULL');       // Durabilité maximale contre les crashes
db.pragma('wal_autocheckpoint = 100'); // Checkpoint WAL tous les 100 pages (plus fréquent)

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

  -- ─── Tables Factures / VosFactures ──────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS vf_catalog (
    ref TEXT PRIMARY KEY,
    vf_product_id TEXT,
    nom TEXT NOT NULL,
    prix_ht REAL,
    tva REAL DEFAULT 20,
    csv_ref TEXT,
    vf_ref TEXT,
    actif INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vf_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL UNIQUE,
    nom_normalise TEXT NOT NULL,
    actif INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS vf_client_discounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    product_code TEXT NOT NULL,
    discount_pct REAL NOT NULL,
    UNIQUE(client_name, product_code)
  );

  CREATE TABLE IF NOT EXISTS vf_client_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vf_name TEXT,
    file_name TEXT,
    vf_client_id TEXT,
    shipping_id TEXT,
    shipping_name TEXT
  );

  CREATE TABLE IF NOT EXISTS vf_code_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_source TEXT NOT NULL,
    type TEXT NOT NULL,
    code_cible TEXT,
    valeur TEXT,
    UNIQUE(code_source, type)
  );

  CREATE TABLE IF NOT EXISTS vf_invoice_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vf_invoice_id TEXT,
    vf_invoice_number TEXT,
    client_name TEXT,
    mode TEXT,
    montant_ht REAL,
    montant_ttc REAL,
    csv_generated INTEGER DEFAULT 0,
    gsheet_logged INTEGER DEFAULT 0,
    email_sent INTEGER DEFAULT 0,
    meta TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── Indexes performance ──────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_emails_lead_id ON emails(lead_id);
  CREATE INDEX IF NOT EXISTS idx_emails_inscription_id ON emails(inscription_id);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_lead_id ON inscriptions(lead_id);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_statut ON inscriptions(statut);
  CREATE INDEX IF NOT EXISTS idx_events_lead_id ON events(lead_id);
  CREATE INDEX IF NOT EXISTS idx_leads_hotel ON leads(hotel);

  CREATE INDEX IF NOT EXISTS idx_vf_catalog_actif ON vf_catalog(actif);
  CREATE INDEX IF NOT EXISTS idx_vf_partners_nom ON vf_partners(nom_normalise);
  CREATE INDEX IF NOT EXISTS idx_vf_discounts_client ON vf_client_discounts(client_name);
  CREATE INDEX IF NOT EXISTS idx_vf_code_mappings_type ON vf_code_mappings(type);
  CREATE INDEX IF NOT EXISTS idx_vf_invoice_logs_date ON vf_invoice_logs(created_at);

  -- ─── Table Templates Email ────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    categorie TEXT DEFAULT 'General',
    sujet TEXT NOT NULL,
    corps_html TEXT,
    content_json TEXT,
    tags TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_email_templates_categorie ON email_templates(categorie);

  -- ─── Table Commandes Partenaires ─────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS partner_orders (
    id TEXT PRIMARY KEY,
    partner_id INTEGER NOT NULL REFERENCES vf_partners(id),
    statut TEXT DEFAULT 'en_attente',
    products TEXT NOT NULL,
    notes TEXT,
    total_ht REAL,
    total_ttc REAL,
    vf_invoice_id TEXT,
    vf_invoice_number TEXT,
    validated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_partner_orders_partner ON partner_orders(partner_id);
  CREATE INDEX IF NOT EXISTS idx_partner_orders_statut ON partner_orders(statut);
`);

// ─── Migrations colonnes (bases existantes) ───────────────────────────────────
const migrations = [
  'ALTER TABLE etapes    ADD COLUMN corps_html   TEXT',
  'ALTER TABLE etapes    ADD COLUMN piece_jointe TEXT',
  'ALTER TABLE sequences ADD COLUMN options      TEXT',
  'ALTER TABLE leads     ADD COLUMN statut_email TEXT',
  'ALTER TABLE leads     ADD COLUMN email_score  REAL',
  'ALTER TABLE leads     ADD COLUMN poste        TEXT',
  'ALTER TABLE leads     ADD COLUMN langue       TEXT DEFAULT "fr"',
  'ALTER TABLE leads     ADD COLUMN campaign     TEXT',
  'ALTER TABLE leads     ADD COLUMN comment      TEXT',
  'ALTER TABLE etapes    ADD COLUMN content_json TEXT',
  'ALTER TABLE vf_partners ADD COLUMN password_hash TEXT',
  'ALTER TABLE vf_partners ADD COLUMN email TEXT',
  'ALTER TABLE vf_partners ADD COLUMN contact_nom TEXT',
  'ALTER TABLE vf_partners ADD COLUMN telephone TEXT',
  'ALTER TABLE vf_partners ADD COLUMN adresse TEXT',
  'ALTER TABLE vf_partners ADD COLUMN shipping_id TEXT',
  'ALTER TABLE vf_partners ADD COLUMN password_plain TEXT',
  'ALTER TABLE vf_partners ADD COLUMN vf_client_id TEXT',
  'ALTER TABLE vf_catalog ADD COLUMN moq INTEGER DEFAULT 1',
  'ALTER TABLE vf_partners ADD COLUMN amenities TEXT',
  'ALTER TABLE vf_partners ADD COLUMN franco_seuil REAL DEFAULT 800',
  'ALTER TABLE vf_partners ADD COLUMN frais_port REAL DEFAULT 0',
  'ALTER TABLE vf_partners ADD COLUMN frais_exonere INTEGER DEFAULT 0',
];
for (const sql of migrations) {
  try { db.prepare(sql).run(); } catch (e) {
    // Ignorer "duplicate column" qui est attendu, logger les vraies erreurs
    if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
      console.error('⚠️  Erreur migration:', sql, '-', e.message);
    }
  }
}

// ─── Seed MOQ (quantité par carton) ────────────────────────────────────────
const MOQ_MAP = {
  // 4 par carton
  'P004-500': 4, 'P007-5000': 4, 'P008-5000': 4, 'P010-5000': 4, 'P011-5000': 4,
  'P014-5000': 4, 'P015': 4, 'P019-5000': 4, 'P024-5000': 4, 'P034-5000': 4,
  'P035-5000': 4, 'P036-5000': 4, 'P037-5000': 4, 'P039-500': 4, 'P041-500': 4,
  'P042-5000': 4, 'P040-5000': 4,
  // 6 par carton
  'P003': 6, 'P004': 6, 'P005': 6, 'P006': 6, 'P007': 6, 'P007-30': 6,
  'P008': 6, 'P008-30': 6, 'P010': 6, 'P011': 6, 'P011-30': 6, 'P014': 6,
  'P018': 6, 'P019': 6, 'P022': 6, 'P024': 6, 'P027': 6, 'P034': 6,
  'P035': 6, 'P035-30': 6, 'P036': 6, 'P037': 6, 'P039': 6, 'P039-200V': 6,
  'P041': 6, 'P041-200V': 6, 'P042-30': 6, 'P317-100': 6, 'P040': 6,
  // 12 par carton
  'P017': 12, 'P039SPRAY': 12,
  // 30 par carton
  'P021': 30,
  // 44 par carton
  'P017-30': 44, 'P026': 44, 'P038-30': 44,
  // 50 par carton
  'P011-100': 50, 'P014-100': 50, 'P034-100': 50, 'P035-100': 50, 'P036-100': 50, 'P037-100': 50,
  // 56 par carton
  'P008-75': 56,
  // 66 par carton
  'P016': 66,
  // 100 par carton
  'P008-150': 100, 'P009': 100, 'P010-150': 100, 'P010-30': 100, 'P010-50': 100,
  'P018-50': 100, 'P019-50': 100, 'P020': 100, 'P024-40': 100, 'P029': 100,
  // 112 par carton
  'P023': 112,
  // 300 par carton
  'P012': 300,
  // 336 par carton
  'P021-20': 336,
};

const stmtMoq = db.prepare('UPDATE vf_catalog SET moq = ? WHERE ref = ? AND moq = 1');
let moqUpdated = 0;
for (const [ref, moq] of Object.entries(MOQ_MAP)) {
  const r = stmtMoq.run(moq, ref);
  if (r.changes > 0) moqUpdated++;
}
if (moqUpdated > 0) console.log(`📦 ${moqUpdated} MOQ mis à jour`);

console.log('✅ Base de données initialisée :', DB_PATH);
module.exports = db;
