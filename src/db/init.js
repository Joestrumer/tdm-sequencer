/**
 * init.js — Initialisation de la base de données SQLite
 * Crée toutes les tables nécessaires si elles n'existent pas
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/sequencer.db';

// Créer le dossier data si nécessaire
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Activer les foreign keys et le mode WAL pour les performances
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- ─── LEADS ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS leads (
    id          TEXT PRIMARY KEY,
    prenom      TEXT NOT NULL,
    nom         TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    hotel       TEXT NOT NULL,
    ville       TEXT,
    segment     TEXT DEFAULT '5*',
    tags        TEXT DEFAULT '[]',        -- JSON array
    statut      TEXT DEFAULT 'Nouveau',   -- Nouveau | En séquence | Répondu | Converti | Désabonné
    score       INTEGER DEFAULT 50,
    hubspot_id  TEXT,                     -- ID contact HubSpot si synchronisé
    unsubscribed INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  -- ─── SÉQUENCES ────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS sequences (
    id          TEXT PRIMARY KEY,
    nom         TEXT NOT NULL,
    segment     TEXT DEFAULT '5*',
    actif       INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- ─── ÉTAPES DE SÉQUENCE ───────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS etapes (
    id          TEXT PRIMARY KEY,
    sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    ordre       INTEGER NOT NULL,
    jour_delai  INTEGER NOT NULL DEFAULT 0,  -- délai en jours depuis l'étape précédente
    sujet       TEXT NOT NULL,
    corps       TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- ─── INSCRIPTIONS LEAD → SÉQUENCE ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS inscriptions (
    id              TEXT PRIMARY KEY,
    lead_id         TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    sequence_id     TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    etape_courante  INTEGER DEFAULT 0,        -- index de la prochaine étape à envoyer
    statut          TEXT DEFAULT 'actif',     -- actif | pause | terminé | répondu
    date_debut      TEXT DEFAULT (datetime('now')),
    prochain_envoi  TEXT,                     -- datetime ISO du prochain email à envoyer
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(lead_id, sequence_id)
  );

  -- ─── EMAILS ENVOYÉS ───────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS emails (
    id              TEXT PRIMARY KEY,
    inscription_id  TEXT NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
    lead_id         TEXT NOT NULL REFERENCES leads(id),
    etape_id        TEXT NOT NULL REFERENCES etapes(id),
    sujet           TEXT NOT NULL,
    brevo_message_id TEXT,                    -- ID de message retourné par Brevo
    tracking_id     TEXT UNIQUE,              -- UUID pour le pixel de tracking
    statut          TEXT DEFAULT 'envoyé',    -- envoyé | ouvert | cliqué | bounced | erreur
    ouvertures      INTEGER DEFAULT 0,
    clics           INTEGER DEFAULT 0,
    erreur          TEXT,
    envoye_at       TEXT DEFAULT (datetime('now')),
    premier_ouvert  TEXT,
    dernier_ouvert  TEXT
  );

  -- ─── ÉVÉNEMENTS DE TRACKING ───────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    email_id    TEXT REFERENCES emails(id),
    lead_id     TEXT REFERENCES leads(id),
    type        TEXT NOT NULL,   -- ouverture | clic | réponse | bounce | désabonnement
    meta        TEXT,            -- JSON : url cliquée, user-agent, etc.
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- ─── COMPTEUR JOURNALIER D'ENVOI ──────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS envoi_quota (
    date_jour   TEXT PRIMARY KEY,   -- YYYY-MM-DD
    count       INTEGER DEFAULT 0
  );

  -- ─── LOGS HUBSPOT ─────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS hubspot_logs (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,    -- contact | deal | engagement | lifecycle
    action      TEXT NOT NULL,    -- create | update | error
    lead_id     TEXT,
    hubspot_id  TEXT,
    payload     TEXT,             -- JSON
    erreur      TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- ─── INDEX ────────────────────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
  CREATE INDEX IF NOT EXISTS idx_leads_statut ON leads(statut);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_prochain ON inscriptions(prochain_envoi, statut);
  CREATE INDEX IF NOT EXISTS idx_emails_tracking ON emails(tracking_id);
  CREATE INDEX IF NOT EXISTS idx_events_lead ON events(lead_id, created_at);
`);

console.log('✅ Base de données initialisée :', DB_PATH);
module.exports = db;
