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
  CREATE INDEX IF NOT EXISTS idx_emails_brevo_msgid ON emails(brevo_message_id);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_lead_id ON inscriptions(lead_id);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_statut ON inscriptions(statut);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_seq_statut ON inscriptions(sequence_id, statut);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_lead_statut ON inscriptions(lead_id, statut);
  CREATE INDEX IF NOT EXISTS idx_etapes_sequence ON etapes(sequence_id, ordre);
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

  -- ─── Table Utilisateurs (multi-user) ───────────────────────────────────────

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nom TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
    vf_api_token TEXT,
    permissions TEXT DEFAULT '{}',
    actif INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

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

  -- ─── Tables Campagnes Email Marketing ──────────────────────────────────────

  CREATE TABLE IF NOT EXISTS campaigns (
    id               TEXT PRIMARY KEY,
    nom              TEXT NOT NULL,
    sujet            TEXT NOT NULL,
    corps_html       TEXT,
    template_id      TEXT,
    statut           TEXT DEFAULT 'brouillon',
    scheduled_at     TEXT,
    started_at       TEXT,
    completed_at     TEXT,
    total_recipients INTEGER DEFAULT 0,
    sent_count       INTEGER DEFAULT 0,
    error_count      INTEGER DEFAULT 0,
    options          TEXT,
    created_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaign_recipients (
    id            TEXT PRIMARY KEY,
    campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id       TEXT,
    email         TEXT NOT NULL,
    prenom        TEXT,
    nom           TEXT,
    hotel         TEXT,
    ville         TEXT,
    segment       TEXT,
    statut        TEXT DEFAULT 'en_attente',
    tracking_id   TEXT UNIQUE,
    sent_at       TEXT,
    error         TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_statut ON campaigns(statut);
  CREATE INDEX IF NOT EXISTS idx_cr_campaign ON campaign_recipients(campaign_id, statut);
  CREATE INDEX IF NOT EXISTS idx_cr_tracking ON campaign_recipients(tracking_id);
  CREATE INDEX IF NOT EXISTS idx_cr_email ON campaign_recipients(email);

  -- ─── Table Segments dynamiques ──────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS segments (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL UNIQUE,
    couleur TEXT DEFAULT '#64748b',
    ordre INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── Tables Veille Web (Scraping actualités hôtelières) ─────────────────────

  CREATE TABLE IF NOT EXISTS veille_sources (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT DEFAULT 'html',
    selecteurs TEXT,
    mots_cles TEXT DEFAULT '[]',
    frequence TEXT DEFAULT '6h',
    actif INTEGER DEFAULT 1,
    last_run TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS veille_articles (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES veille_sources(id) ON DELETE CASCADE,
    titre TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    resume TEXT,
    date_article TEXT,
    mots_cles_trouves TEXT DEFAULT '[]',
    score_pertinence INTEGER DEFAULT 0,
    priorite TEXT DEFAULT 'C',
    lu INTEGER DEFAULT 0,
    favori INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_veille_articles_source ON veille_articles(source_id);
  CREATE INDEX IF NOT EXISTS idx_veille_articles_score ON veille_articles(score_pertinence DESC);
  CREATE INDEX IF NOT EXISTS idx_veille_articles_lu ON veille_articles(lu);
  CREATE INDEX IF NOT EXISTS idx_veille_articles_favori ON veille_articles(favori);
  CREATE INDEX IF NOT EXISTS idx_veille_articles_url ON veille_articles(url);

  -- ─── Table Runs de veille (observabilité) ────────────────────────────────────

  CREATE TABLE IF NOT EXISTS veille_source_runs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES veille_sources(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT DEFAULT 'running',
    duration_ms INTEGER,
    items_found INTEGER DEFAULT 0,
    items_filtered INTEGER DEFAULT 0,
    items_inserted INTEGER DEFAULT 0,
    items_duplicate INTEGER DEFAULT 0,
    http_status INTEGER,
    error_message TEXT,
    trigger_type TEXT DEFAULT 'cron',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_veille_runs_source ON veille_source_runs(source_id);
  CREATE INDEX IF NOT EXISTS idx_veille_runs_status ON veille_source_runs(status);
  CREATE INDEX IF NOT EXISTS idx_veille_runs_started ON veille_source_runs(started_at DESC);
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
  'ALTER TABLE vf_catalog ADD COLUMN categorie TEXT',
  'ALTER TABLE partner_orders ADD COLUMN validated_by TEXT',
  'ALTER TABLE users ADD COLUMN gsheets_spreadsheet_id TEXT',
  'ALTER TABLE emails ADD COLUMN campaign_id TEXT',
  'ALTER TABLE emails ADD COLUMN campaign_recipient_id TEXT',
  'ALTER TABLE leads ADD COLUMN source TEXT DEFAULT \'\'',
  'ALTER TABLE leads ADD COLUMN civilite TEXT DEFAULT \'\'',
  'ALTER TABLE campaigns ADD COLUMN piece_jointe TEXT',
  'ALTER TABLE vf_partners ADD COLUMN vf_display_name TEXT',
  'ALTER TABLE veille_articles ADD COLUMN priorite TEXT DEFAULT \'C\'',
  'ALTER TABLE veille_sources ADD COLUMN frequence_cron TEXT',
  'ALTER TABLE veille_sources ADD COLUMN categorie TEXT',
  // Passe 2 — Observabilité et santé des sources
  'ALTER TABLE veille_sources ADD COLUMN last_success_at TEXT',
  'ALTER TABLE veille_sources ADD COLUMN last_error_at TEXT',
  'ALTER TABLE veille_sources ADD COLUMN error_count INTEGER DEFAULT 0',
  'ALTER TABLE veille_sources ADD COLUMN health_status TEXT DEFAULT \'unknown\'',
  // Passe 2 — Enrichissement articles
  'ALTER TABLE veille_articles ADD COLUMN content_full TEXT',
  'ALTER TABLE veille_articles ADD COLUMN content_hash TEXT',
  'ALTER TABLE veille_articles ADD COLUMN enriched INTEGER DEFAULT 0',
  'ALTER TABLE veille_articles ADD COLUMN first_seen_at TEXT',
  'ALTER TABLE veille_articles ADD COLUMN last_seen_at TEXT',
  'ALTER TABLE veille_articles ADD COLUMN published_at TEXT',
];
for (const sql of migrations) {
  try { db.prepare(sql).run(); } catch (e) {
    // Ignorer "duplicate column" qui est attendu, logger les vraies erreurs
    if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
      console.error('⚠️  Erreur migration:', sql, '-', e.message);
    }
  }
}

// ─── Migration emails : rendre inscription_id/etape_id nullable (campagnes) ──
try {
  // Vérifier si la migration est nécessaire (colonnes NOT NULL ?)
  const emailsInfo = db.pragma('table_info(emails)');
  const inscCol = emailsInfo.find(c => c.name === 'inscription_id');
  if (inscCol && inscCol.notnull === 1) {
    console.log('🔄 Migration emails : rendre inscription_id/etape_id nullable...');
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE emails_new (
        id               TEXT PRIMARY KEY,
        inscription_id   TEXT REFERENCES inscriptions(id) ON DELETE CASCADE,
        lead_id          TEXT REFERENCES leads(id),
        etape_id         TEXT REFERENCES etapes(id),
        sujet            TEXT NOT NULL,
        brevo_message_id TEXT,
        tracking_id      TEXT UNIQUE,
        statut           TEXT DEFAULT 'envoyé',
        ouvertures       INTEGER DEFAULT 0,
        clics            INTEGER DEFAULT 0,
        erreur           TEXT,
        envoye_at        TEXT DEFAULT (datetime('now')),
        premier_ouvert   TEXT,
        dernier_ouvert   TEXT,
        campaign_id      TEXT,
        campaign_recipient_id TEXT
      );
      INSERT INTO emails_new SELECT id, inscription_id, lead_id, etape_id, sujet, brevo_message_id, tracking_id, statut, ouvertures, clics, erreur, envoye_at, premier_ouvert, dernier_ouvert,
        CASE WHEN 1=0 THEN NULL END as campaign_id,
        CASE WHEN 1=0 THEN NULL END as campaign_recipient_id
      FROM emails;
      DROP TABLE emails;
      ALTER TABLE emails_new RENAME TO emails;
      CREATE INDEX IF NOT EXISTS idx_emails_tracking ON emails(tracking_id);
      CREATE INDEX IF NOT EXISTS idx_emails_lead_id ON emails(lead_id);
      CREATE INDEX IF NOT EXISTS idx_emails_inscription_id ON emails(inscription_id);
      CREATE INDEX IF NOT EXISTS idx_emails_brevo_msgid ON emails(brevo_message_id);
      CREATE INDEX IF NOT EXISTS idx_emails_campaign_id ON emails(campaign_id);
    `);
    db.pragma('foreign_keys = ON');
    console.log('✅ Migration emails terminée');
  }
} catch (e) {
  console.error('⚠️  Erreur migration emails:', e.message);
  try { db.pragma('foreign_keys = ON'); } catch(_) {}
}

// ─── Data fixes : prix et vf_product_id manquants ───────────────────────────
const catalogFixes = [
  { ref: 'P500ml', prix_ht: 0.5, vf_product_id: '8719078876858' },
  { ref: 'SPFS', vf_product_id: '1115238245' },
];
for (const fix of catalogFixes) {
  try {
    if (fix.prix_ht !== undefined) {
      db.prepare('UPDATE vf_catalog SET prix_ht = ? WHERE ref = ? AND prix_ht = 0').run(fix.prix_ht, fix.ref);
    }
    if (fix.vf_product_id) {
      db.prepare('UPDATE vf_catalog SET vf_product_id = ? WHERE ref = ? AND (vf_product_id IS NULL OR vf_product_id = \'\')').run(fix.vf_product_id, fix.ref);
    }
  } catch (e) { /* ignore */ }
}

// ─── Data fixes : mappings clients manquants ────────────────────────────────
const missingClientMappings = [
  { vf_name: 'Hotel Le Rodrigue (Boronali)', file_name: 'Hôtel Boronali (Le Rodrigue)' },
];
for (const m of missingClientMappings) {
  const exists = db.prepare('SELECT id FROM vf_client_mappings WHERE vf_name = ?').get(m.vf_name);
  if (!exists) {
    try {
      db.prepare('INSERT INTO vf_client_mappings (vf_name, file_name) VALUES (?, ?)').run(m.vf_name, m.file_name);
    } catch (e) { /* ignore */ }
  }
}

// ─── Sync partenaires canoniques manquants ──────────────────────────────────
const CANONICAL_PARTNERS = [
  "MyNestinn", "KYRIAD PRESTIGE PERPIGNAN", "Maison Eugenie", "Villa Panthéon",
  "ACCOR ALL Hearties 1", "Douglas Italy", "Hôtel de La Groirie", "Villa Beaumarchais",
  "ACCOR ALL Hearties 2", "ACCOR ALL Hearties 3", "ACCOR ALL Hearties 4",
  "AVIS website 1", "AVIS website 2", "Sofitel Paris Baltimore Tour Eiffel",
  "Nocibe reappro new products", "AVIS website 3", "1K Paris", "Coupon HELLOCSE",
  "AVIS website 4", "HK MONTMARTRE", "HK Montparnasse", "HK Eiffel", "HK Saint Marcel",
  "club employé", "AVIS website 5", "Life Hotels Bordeaux", "Escale Blanche",
  "Kraft Hotel", "Hello CSE - 17,5€", "Hotel Waldorf Trocadero",
  "Dream Hotel Opera (Théorème)", "Flacons vides entrepot SHURGARD SELF STORAGE ASNIERES",
  "HK Sorbonne", "Better Beauty Box", "Monsieur Alfred", "Barry's Bootcamp Paris",
  "HK OPERA", "Hôtel Oré Saint Malo", "Hotel Claridge", "HK Etoile",
  "Hôtel Grand Cœur Latin", "Hôtel Le Renaissance",
  "Shooting photo Lancaster Mrs Dong Jihyun 11/02/24", "Hôtel La Balance",
  "Chateau des Arpentis", "Château de Sannes", "BAO Chambres d'hôtes",
  "Hôtel de Mougins", "Le Château de Cop Choux", "Holmes Place Austria",
  "le Beau Moulin", "Lodging Le Lac", "Domaine de Canaille",
  "Hôtel Restaurant des Iles", "Auberge Du Cabestan", "Hotel Le A",
  "HK LOUVRE", "HK CHÂTELET", "Sangha Hotels", "Hotel Nyx", "Hotel Marina Adelphia",
  "Le Château d'Argens", "Hôtel Le Parc", "Hotel Clairefontaine", "Hôtel La Résidence",
  "Domaine des Bidaudières", "Au Lion Rouge", "La Fraichette", "Le Saint Nicolas",
  "Les Chalets De La Clusaz", "My Ginger", "Stendhal", "Hotel Stanley",
  "Hôtel L'Ormaie", "Hôtel Moderniste", "Marcel Aymé", "Le Swann", "Arthur Rimbaud",
  "Daroco Bourse", "Daroco 16", "Daroco Soho",
  "Kyriad Prestige Residence & Spa Cabourg-Dives-sur-Mer", "Les chalets Covarel",
  "Alexandre Vialatte", "Gustave Flaubert", "Manoir des Douets Fleuris",
  "Snov.io Starter Monthly Subscription - October 2024", "Omar Dhiab", "Institut Corpo",
  "Yangon Excelsior Hotel", "Le Domaine du Pech Eternel",
  "Snov.io Starter Monthly Subscription - November 2024", "Château des Ayes",
  "Snov.io Starter 2025 Annual Subscription - Black Friday offer", "HOTEL 96",
  "Hôtel au Coq Dort Spa", "Chalet B", "IMMOBILIERE DU BOURGAGE",
  "La Maison Normande", "Pantoufle Hôtels", "La Source", "Relais de Saint-Preuil",
  "DS_Niel et Franklin", "DS_Defense et Lafayette", "DS_Victor Hugo", "DS_Boulogne",
  "DS_Parly 2", "DS_Lyon", "DS_Bordeaux", "Hôtel Boronali (Le Rodrigue)",
  "Escale Marine", "Chateauform", "Hotel de France", "Le Domaine de l'Ecorcerie",
  "Hôtel Abbaye du Golf", "Suite Balnéo Canet", "Carlton Hotel St. Moritz",
  "Les Rives Oceanik", "Causse Comtal", "Hôtel du golf lacanau (La Baignoire)",
  "Château de Blanat", "Casa del Capitan", "Globe et Cecil Hotel", "Jost Hotel Lille",
  "Chalets Uto", "Loire Valley Lodges", "Le Mas Vidau", "Les Relais Du Capitole",
  "The Central (Loewe)", "The Bradery", "Hôtel Elysées Bassano",
  "Conquer Your Day (Blanche)", "Mana Homes", "Le Swann (mariage)", "HILO Collection",
  "HK République", "Hôtel des Mines", "Jost Hotel Montpellier Gare",
  "Shd Invest Srl - Shams Demaret", "Hôtel le Portillo", "Hôtel Bourgogne & Montana",
  "Hôtel Provençal Bandol", "Hôtel Le Lyret", "Hôtel Le Faucigny",
  "Appart'Hôtel Le Génépy", "Hôtel des 2 Gares", "Plan B Chamonix",
  "Plan B Saint Gervais", "CAMPUS ENGIE", "Les Pins Blancs", "Chalet APY",
  "La Trêve", "Chamkeys Prestige", "DS_Reims", "Maison Montgrand", "Juliana Brussel",
  "Les Airelles", "L'Hermitage", "Osmo Studio",
  "Pisco and co sas Le Manoir de la Campagne",
  "Hôtel Best Western Saint Antoine - Ksenia LISSINE",
];
const normPartner = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const stmtInsertPartner = db.prepare('INSERT OR IGNORE INTO vf_partners (nom, nom_normalise) VALUES (?, ?)');
let partnersInserted = 0;
for (const name of CANONICAL_PARTNERS) {
  const r = stmtInsertPartner.run(name, normPartner(name));
  if (r.changes > 0) partnersInserted++;
}
if (partnersInserted > 0) console.log(`🏨 ${partnersInserted} partenaire(s) ajouté(s)`);

// ─── Seed produits manquants ──────────────────────────────────────────────────
const MISSING_PRODUCTS = [
  { ref: 'P036', nom: 'Lotion Mains & Corps Élégance 500ml', prix_ht: 10, moq: 6 },
  { ref: 'P036-100', nom: 'Lotion Mains & Corps Élégance 100ml', prix_ht: 2.10, moq: 50 },
  { ref: 'P036-5000', nom: 'Lotion Mains & Corps Élégance Recharge 5L', prix_ht: 70, moq: 4 },
  { ref: 'P037-100', nom: 'Après Shampoing Élégance 100ml', prix_ht: 2.10, moq: 50 },
  { ref: 'P034-100', nom: 'Shampoing Élégance 100ml', prix_ht: 1.80, moq: 50 },
  { ref: 'P035-100', nom: 'Gel nettoyant Élégance 100ml', prix_ht: 1.80, moq: 50 },
  { ref: 'P019-50', nom: 'Shampoing Reddition 50ml', prix_ht: 0.85, moq: 100 },
  { ref: 'P040-5000', nom: 'Gel Corps Cheveux Élégance Recharge 5L', prix_ht: 41, moq: 4 },
  { ref: 'P042-5000', nom: 'Gel Corps Cheveux Reddition Recharge 5L', prix_ht: 39, moq: 4 },
  { ref: 'P008-75', nom: 'Gel nettoyant Reddition 75ml', prix_ht: 0.85, moq: 56 },
  { ref: 'P029', nom: 'Poudre Exfoliante Résurgence', prix_ht: 1, moq: 100 },
  { ref: 'SPFS', nom: 'Porte flacon Simple Sécurisé Temperproof', prix_ht: 0, moq: 1 },
  { ref: 'PFS', nom: 'Porte flacon simple (305 Stainless Steel black)', prix_ht: 0, moq: 1 },
  { ref: 'PFD', nom: 'Porte flacon double (305 Stainless Steel black)', prix_ht: 0, moq: 1 },
  { ref: 'PFT', nom: 'Porte flacon triple (305 Stainless Steel black)', prix_ht: 0, moq: 1 },
  { ref: 'P5L', nom: 'POMPE 5L', prix_ht: 0, moq: 1 },
  { ref: 'P500ml', nom: 'Pompe 500ML', prix_ht: 0.5, moq: 1 },
];

const stmtInsertProduct = db.prepare('INSERT OR IGNORE INTO vf_catalog (ref, nom, prix_ht, moq) VALUES (?, ?, ?, ?)');
const stmtActivateProduct = db.prepare('UPDATE vf_catalog SET actif = 1 WHERE ref = ? AND actif = 0');
let productsInserted = 0;
let productsActivated = 0;
for (const p of MISSING_PRODUCTS) {
  const r = stmtInsertProduct.run(p.ref, p.nom, p.prix_ht, p.moq);
  if (r.changes > 0) productsInserted++;
  else {
    const a = stmtActivateProduct.run(p.ref);
    if (a.changes > 0) productsActivated++;
  }
}
if (productsInserted > 0) console.log(`🆕 ${productsInserted} produit(s) manquant(s) ajouté(s) au catalogue`);
if (productsActivated > 0) console.log(`✅ ${productsActivated} produit(s) réactivé(s) dans le catalogue`);

// ─── Correction noms produits ────────────────────────────────────────────────
const NOM_CORRECTIONS = {
  'SPFS': 'Porte flacon Simple Sécurisé Temperproof',
  'PFS': 'Porte flacon simple (305 Stainless Steel black)',
  'PFD': 'Porte flacon double (305 Stainless Steel black)',
  'PFT': 'Porte flacon triple (305 Stainless Steel black)',
  'P5L': 'POMPE 5L',
  'P500ml': 'Pompe 500ML',
};
const stmtFixNom = db.prepare('UPDATE vf_catalog SET nom = ? WHERE ref = ? AND nom != ?');
let nomsFixed = 0;
for (const [ref, nom] of Object.entries(NOM_CORRECTIONS)) {
  const r = stmtFixNom.run(nom, ref, nom);
  if (r.changes > 0) nomsFixed++;
}
if (nomsFixed > 0) console.log(`✏️  ${nomsFixed} nom(s) de produit(s) corrigé(s)`);

// ─── Seed catégories catalogue ───────────────────────────────────────────────
const CATEGORIE_MAP = {
  'Flacons 500 ml': ['P008', 'P010', 'P024', 'P011', 'P007', 'P035', 'P036', 'P037', 'P034', 'P040', 'P042', 'P014', 'P019'],
  'Recharges 5 litres': ['P007-5000', 'P008-5000', 'P010-5000', 'P011-5000', 'P014-5000', 'P019-5000', 'P024-5000', 'P034-5000', 'P035-5000', 'P036-5000', 'P037-5000', 'P040-5000', 'P042-5000'],
  'Portes flacons': ['SPFS', 'PFS', 'PFD', 'PFT', 'P5L', 'P500ml', 'PFDS', 'PFSS', 'PFTS', 'BAV'],
  'Cadeaux VIP & Spa': ['P016', 'P023', 'P012', 'P009', 'P020', 'P021-20'],
  'Produits Spa & VIP': ['P021', 'P022', 'P317-100', 'P005', 'P006', 'P027', 'P003', 'P004', 'P004-500', 'P029'],
  'Parfums & gel hydroalcoolique': ['P015', 'P039SPRAY-VIDE'],
  'Produits hygiène format voyage': ['P010-30', 'P010-50', 'P010-150', 'P024-40', 'P011-100', 'P017-30', 'P017', 'P038-30', 'P008-150', 'P008-75'],
  'Produits hygiène format 30ml': ['P035-30', 'P008-30', 'P011-30', 'P042-30', 'P007-30', 'P014-100', 'P034-100', 'P035-100', 'P036-100', 'P037-100'],
};

// Refs avec wildcard (startsWith) pour Parfums & gel hydroalcoolique
const CATEGORIE_PREFIX = {
  'Parfums & gel hydroalcoolique': ['P039', 'P041', 'P018'],
};

const stmtUpdateCat = db.prepare('UPDATE vf_catalog SET categorie = ? WHERE ref = ? AND categorie IS NULL');
let catUpdated = 0;

// D'abord les refs exactes
for (const [cat, refs] of Object.entries(CATEGORIE_MAP)) {
  for (const ref of refs) {
    const r = stmtUpdateCat.run(cat, ref);
    if (r.changes > 0) catUpdated++;
  }
}

// Ensuite les refs par préfixe (pour P039*, P041*, P018*)
const allProducts = db.prepare('SELECT ref FROM vf_catalog WHERE categorie IS NULL').all();
for (const [cat, prefixes] of Object.entries(CATEGORIE_PREFIX)) {
  for (const p of allProducts) {
    if (prefixes.some(prefix => p.ref.startsWith(prefix))) {
      const r = stmtUpdateCat.run(cat, p.ref);
      if (r.changes > 0) catUpdated++;
    }
  }
}

if (catUpdated > 0) console.log(`🏷️  ${catUpdated} catégorie(s) assignée(s) au catalogue`);

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

// ─── Seed admin initial si table users vide ────────────────────────────────
if (process.env.ADMIN_EMAIL) {
  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (userCount === 0) {
    try {
      const bcrypt = require('bcryptjs');
      const { randomUUID } = require('crypto');
      const password = process.env.ADMIN_PASSWORD || process.env.AUTH_SECRET || 'admin';
      const hash = bcrypt.hashSync(password, 10);
      db.prepare(`INSERT INTO users (id, email, password_hash, nom, role, permissions) VALUES (?, ?, ?, ?, 'admin', '{}')`).run(
        randomUUID(), process.env.ADMIN_EMAIL, hash, process.env.ADMIN_NAME || 'Admin'
      );
      console.log(`👤 Admin initial créé : ${process.env.ADMIN_EMAIL}`);
    } catch (e) {
      if (!e.message.includes('UNIQUE constraint')) {
        console.error('⚠️  Erreur création admin:', e.message);
      }
    }
  }
}

// ─── Seed segments par défaut ────────────────────────────────────────────────
const DEFAULT_SEGMENTS = [
  { id: 'seg-5star', nom: '5*', couleur: '#eab308', ordre: 1 },
  { id: 'seg-4star', nom: '4*', couleur: '#3b82f6', ordre: 2 },
  { id: 'seg-boutique', nom: 'Boutique', couleur: '#8b5cf6', ordre: 3 },
  { id: 'seg-retail', nom: 'Retail', couleur: '#10b981', ordre: 4 },
  { id: 'seg-spa', nom: 'SPA', couleur: '#ec4899', ordre: 5 },
  { id: 'seg-conceptstore', nom: 'Concept Store', couleur: '#f97316', ordre: 6 },
];
const stmtInsertSegment = db.prepare('INSERT OR IGNORE INTO segments (id, nom, couleur, ordre) VALUES (?, ?, ?, ?)');
let segmentsInserted = 0;
for (const s of DEFAULT_SEGMENTS) {
  const r = stmtInsertSegment.run(s.id, s.nom, s.couleur, s.ordre);
  if (r.changes > 0) segmentsInserted++;
}
if (segmentsInserted > 0) console.log(`🏷️  ${segmentsInserted} segment(s) par défaut ajouté(s)`);

// ─── Seed sources de veille hôtelière (10 sources) ──────────────────────────
try {
  const { randomUUID } = require('crypto');

  const VEILLE_SOURCES = [
    // ── Quotidien (sources principales) ──
    {
      nom: "L'Hôtellerie Restauration",
      url: 'https://www.lhotellerie-restauration.fr',
      categorie: 'quotidien',
      frequence_cron: '0 7,13,19 * * *',  // 3x/jour
      mots_cles: ['rénovation hôtel', 'ouverture 2026', 'pré-ouverture', 'réouverture',
        'repositionnement', 'montée en gamme', 'nouveau directeur général',
        'boutique-hôtel', 'palace', 'spa', 'Paris', 'Lyon', 'Bordeaux'],
    },
    {
      nom: 'Hospitality ON',
      url: 'https://hospitality-on.com',
      categorie: 'quotidien',
      frequence_cron: '0 7,13,19 * * *',
      mots_cles: ['rénovation', 'ouverture', 'inauguration', 'repositionnement',
        'conversion', 'signing', 'pipeline', 'nomination directeur',
        'boutique hotel', 'resort', 'palace', 'luxe', 'acquisition hôtel'],
    },
    {
      nom: 'Journal des Palaces',
      url: 'https://www.journaldespalaces.com',
      categorie: 'quotidien',
      frequence_cron: '0 8,14,20 * * *',
      mots_cles: ['rénovation', 'nomination', 'directeur général', 'nommé',
        'palace', 'luxe', '5 étoiles', 'boutique-hôtel', 'relais châteaux',
        'spa', 'transformation', 'ouverture'],
    },
    // ── 2-3x par semaine ──
    {
      nom: 'Business Immo',
      url: 'https://www.businessimmo.com',
      categorie: 'hebdo',
      frequence_cron: '0 8 * * 1,3,5',  // Lun, Mer, Ven
      mots_cles: ['acquisition hôtel', 'cession hôtel', 'portefeuille hôtelier',
        'rachat', 'investissement hôtelier', 'repositionnement', 'asset management',
        'foncière hôtelière', 'reconversion hôtel'],
    },
    {
      nom: 'La Tribune de l\'Hôtellerie',
      url: 'https://www.latribunedelhotellerie.com',
      categorie: 'hebdo',
      frequence_cron: '0 9 * * 1,3,5',
      mots_cles: ['rénovation', 'ouverture', 'fermeture temporaire', 'travaux',
        'nouveau concept', 'repositionnement', 'montée en gamme',
        'boutique-hôtel', 'lifestyle', 'spa', 'Paris', 'province'],
    },
    {
      nom: 'Voyages d\'Affaires',
      url: 'https://www.voyages-d-affaires.com',
      categorie: 'hebdo',
      frequence_cron: '0 9 * * 2,4',  // Mar, Jeu
      mots_cles: ['ouverture hôtel Paris', 'ouverture 2026', 'nouvel hôtel',
        'rénovation', 'upscale', 'business hotel', 'Île-de-France',
        'hub transport', 'concept hôtelier'],
    },
    {
      nom: 'Industrie Hôtelière',
      url: 'https://www.industrie-hoteliere.com',
      categorie: 'hebdo',
      frequence_cron: '0 10 * * 1,4',  // Lun, Jeu
      mots_cles: ['rénovation', 'transformation', 'ouverture', 'groupe hôtelier',
        'déploiement', 'conversion', 'rebranding', 'sous enseigne',
        'IHG', 'Accor', 'Marriott', 'Hilton'],
    },
    // ── Radar / opportuniste ──
    {
      nom: 'Tendance Hôtellerie',
      url: 'https://www.tendancehotellerie.fr',
      categorie: 'radar',
      frequence_cron: '0 8 * * 1',  // 1x/semaine (lundi)
      mots_cles: ['rénovation', 'ouverture', 'acquisition', 'réouverture',
        'transformation', 'rebranding', 'communiqué', 'nouveau concept',
        'palace', 'boutique', 'lifestyle'],
    },
    {
      nom: 'BOAMP',
      url: 'https://www.boamp.fr',
      categorie: 'radar',
      frequence_cron: '0 7 * * 1,3,5',
      mots_cles: ['rénovation hôtel', 'travaux hôtel', 'maîtrise œuvre hôtel',
        'aménagement hôtelier', 'équipement hôtelier', 'salle de bain hôtel',
        'réhabilitation hébergement', 'marché public hôtel'],
    },
    {
      nom: 'BODACC',
      url: 'https://www.bodacc.fr',
      categorie: 'radar',
      frequence_cron: '0 7 * * 2,4',
      mots_cles: ['hôtel cession', 'hôtel création', 'hôtellerie mutation',
        'SCI hôtel', 'fonds commerce hôtel', 'société hôtelière',
        'hébergement touristique'],
    },
  ];

  const stmtInsertSource = db.prepare(`
    INSERT INTO veille_sources (id, nom, url, type, selecteurs, mots_cles, frequence, frequence_cron, categorie, actif)
    VALUES (?, ?, ?, 'brave_search', '{}', ?, '6h', ?, ?, 1)
  `);

  let sourcesAdded = 0;
  for (const src of VEILLE_SOURCES) {
    const domain = new URL(src.url).hostname.replace('www.', '');
    const exists = db.prepare('SELECT id FROM veille_sources WHERE url LIKE ?').get(`%${domain}%`);
    if (!exists) {
      stmtInsertSource.run(
        randomUUID(), src.nom, src.url,
        JSON.stringify(src.mots_cles),
        src.frequence_cron || '0 */6 * * *',
        src.categorie || 'hebdo'
      );
      sourcesAdded++;
    } else {
      // Mettre à jour les mots-clés, fréquence et catégorie des sources existantes
      db.prepare('UPDATE veille_sources SET mots_cles = ?, frequence_cron = ?, categorie = ?, type = ? WHERE id = ?').run(
        JSON.stringify(src.mots_cles),
        src.frequence_cron || '0 */6 * * *',
        src.categorie || 'hebdo',
        'brave_search',
        exists.id
      );
    }
  }
  if (sourcesAdded > 0) console.log(`🔍 ${sourcesAdded} source(s) de veille ajoutée(s)`);
} catch (e) {
  if (!e.message.includes('UNIQUE constraint')) {
    console.error('⚠️  Erreur seed veille:', e.message);
  }
}

console.log('✅ Base de données initialisée :', DB_PATH);
module.exports = db;
