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

  CREATE TABLE IF NOT EXISTS pause_periods (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL CHECK(type IN ('global', 'sequence')),
    sequence_id  TEXT REFERENCES sequences(id) ON DELETE CASCADE,
    mode         TEXT NOT NULL CHECK(mode IN ('scheduled', 'manual')),
    date_debut   TEXT NOT NULL,
    date_fin     TEXT,
    raison       TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_leads_email       ON leads(email);
  CREATE INDEX IF NOT EXISTS idx_leads_statut      ON leads(statut);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_next ON inscriptions(prochain_envoi, statut);
  CREATE INDEX IF NOT EXISTS idx_inscriptions_statut_envoi ON inscriptions(statut, prochain_envoi);
  CREATE INDEX IF NOT EXISTS idx_emails_tracking   ON emails(tracking_id);
  CREATE INDEX IF NOT EXISTS idx_events_lead       ON events(lead_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_blocklist_value   ON email_blocklist(value);
  CREATE INDEX IF NOT EXISTS idx_blocklist_type    ON email_blocklist(type);
  CREATE INDEX IF NOT EXISTS idx_pause_periods_active ON pause_periods(type, date_debut, date_fin);
  CREATE INDEX IF NOT EXISTS idx_pause_periods_sequence ON pause_periods(sequence_id);

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
  CREATE INDEX IF NOT EXISTS idx_emails_envoye_at ON emails(envoye_at);
  CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);
  CREATE INDEX IF NOT EXISTS idx_emails_statut ON emails(statut);

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

  -- ─── Tables Entités et Opportunités (Passe 3) ────────────────────────────────

  CREATE TABLE IF NOT EXISTS veille_entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    city TEXT,
    region TEXT,
    country TEXT DEFAULT 'FR',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(type, name_normalized)
  );

  CREATE INDEX IF NOT EXISTS idx_veille_entities_type ON veille_entities(type);
  CREATE INDEX IF NOT EXISTS idx_veille_entities_norm ON veille_entities(name_normalized);

  CREATE TABLE IF NOT EXISTS veille_opportunities (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL UNIQUE,
    hotel_name TEXT,
    city TEXT,
    region TEXT,
    country TEXT DEFAULT 'FR',
    group_name TEXT,
    brand_name TEXT,
    owner_name TEXT,
    operator_name TEXT,
    signal_type TEXT NOT NULL,
    signal_subtype TEXT,
    signal_strength TEXT DEFAULT 'medium',
    project_date TEXT,
    first_seen_at TEXT,
    last_seen_at TEXT,
    source_count INTEGER DEFAULT 1,
    confidence_score INTEGER DEFAULT 0,
    business_score INTEGER DEFAULT 0,
    recommended_angle TEXT,
    status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_veille_opp_fingerprint ON veille_opportunities(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_veille_opp_signal ON veille_opportunities(signal_type);
  CREATE INDEX IF NOT EXISTS idx_veille_opp_status ON veille_opportunities(status);
  CREATE INDEX IF NOT EXISTS idx_veille_opp_business ON veille_opportunities(business_score DESC);
  CREATE INDEX IF NOT EXISTS idx_veille_opp_city ON veille_opportunities(city);

  CREATE TABLE IF NOT EXISTS veille_opportunity_sources (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL REFERENCES veille_opportunities(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL REFERENCES veille_articles(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(opportunity_id, article_id)
  );

  CREATE INDEX IF NOT EXISTS idx_veille_oppsrc_opp ON veille_opportunity_sources(opportunity_id);
  CREATE INDEX IF NOT EXISTS idx_veille_oppsrc_art ON veille_opportunity_sources(article_id);

  -- ─── Phase 1 Refonte Veille — Signaux individuels ───────────────────────────

  CREATE TABLE IF NOT EXISTS veille_signals (
    id TEXT PRIMARY KEY,
    hotel_name TEXT,
    city TEXT,
    postcode TEXT,
    country TEXT DEFAULT 'FR',
    signal_type TEXT NOT NULL,
    signal_strength INTEGER DEFAULT 50,
    source TEXT NOT NULL,
    source_url TEXT,
    raw_payload TEXT,
    detected_at TEXT DEFAULT (datetime('now')),
    signal_date TEXT,
    opportunity_id TEXT,
    fingerprint TEXT NOT NULL,
    UNIQUE(fingerprint)
  );

  CREATE INDEX IF NOT EXISTS idx_veille_sig_hotel ON veille_signals(hotel_name);
  CREATE INDEX IF NOT EXISTS idx_veille_sig_city ON veille_signals(city);
  CREATE INDEX IF NOT EXISTS idx_veille_sig_type ON veille_signals(signal_type);
  CREATE INDEX IF NOT EXISTS idx_veille_sig_opp ON veille_signals(opportunity_id);
  CREATE INDEX IF NOT EXISTS idx_veille_sig_detected ON veille_signals(detected_at DESC);

  CREATE TABLE IF NOT EXISTS veille_google_snapshots (
    id TEXT PRIMARY KEY,
    hotel_place_id TEXT NOT NULL,
    hotel_name TEXT,
    city TEXT,
    snapshot_date TEXT NOT NULL,
    review_count INTEGER,
    rating REAL,
    business_status TEXT,
    opening_hours_json TEXT,
    website_uri TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(hotel_place_id, snapshot_date)
  );

  CREATE INDEX IF NOT EXISTS idx_veille_gsnap_place ON veille_google_snapshots(hotel_place_id);

  -- ─── Contacts décideurs (Phase 2 Refonte Veille) ──────────────────────────

  CREATE TABLE IF NOT EXISTS veille_contacts (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT REFERENCES veille_opportunities(id) ON DELETE SET NULL,
    hotel_name TEXT,
    full_name TEXT,
    first_name TEXT,
    last_name TEXT,
    role TEXT,
    role_relevance INTEGER DEFAULT 50,
    linkedin_url TEXT,
    email TEXT,
    email_pattern TEXT,
    email_status TEXT DEFAULT 'unverified',
    email_score INTEGER,
    email_source TEXT,
    phone TEXT,
    phone_status TEXT,
    domain TEXT,
    siren TEXT,
    enrichment_date TEXT,
    last_verified_at TEXT,
    raw_payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_veille_ct_opp ON veille_contacts(opportunity_id);
  CREATE INDEX IF NOT EXISTS idx_veille_ct_email ON veille_contacts(email);
  CREATE INDEX IF NOT EXISTS idx_veille_ct_name ON veille_contacts(full_name);

  -- ─── Tentatives d'enrichissement contact (audit trail) ─────────────────────

  CREATE TABLE IF NOT EXISTS veille_contact_attempts (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES veille_contacts(id) ON DELETE CASCADE,
    opportunity_id TEXT,
    attempt_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    payload TEXT,
    credits_used INTEGER DEFAULT 0,
    attempted_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_veille_ca_contact ON veille_contact_attempts(contact_id);
  CREATE INDEX IF NOT EXISTS idx_veille_ca_opp ON veille_contact_attempts(opportunity_id);

  -- ─── Feedback scoring (boucle d'apprentissage Phase 3) ─────────────────────

  CREATE TABLE IF NOT EXISTS veille_scoring_feedback (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT REFERENCES veille_opportunities(id) ON DELETE CASCADE,
    feedback_type TEXT NOT NULL,
    feedback_reason TEXT,
    business_score_at_time INTEGER,
    signals_snapshot TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_veille_fb_opp ON veille_scoring_feedback(opportunity_id);
  CREATE INDEX IF NOT EXISTS idx_veille_fb_type ON veille_scoring_feedback(feedback_type);

  -- ─── Table Prospection Hôtels France (import CSV officiel) ──────────────────

  CREATE TABLE IF NOT EXISTS hotels_france (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_classement TEXT,
    type_hebergement TEXT,
    classement TEXT,
    categorie TEXT,
    mention TEXT,
    nom_commercial TEXT NOT NULL,
    adresse TEXT,
    code_postal TEXT,
    commune TEXT,
    site_internet TEXT,
    type_sejour TEXT,
    capacite_accueil INTEGER,
    nombre_chambres INTEGER,
    nombre_emplacements INTEGER,
    nombre_unites INTEGER,
    nombre_logements INTEGER,
    classement_proroge TEXT,
    -- Champs scraping
    contact_nom TEXT,
    contact_prenom TEXT,
    contact_fonction TEXT,
    contact_email TEXT,
    scraping_status TEXT DEFAULT 'pending',
    scraping_date TEXT,
    scraping_error TEXT,
    -- Champs conversion
    imported_as_lead INTEGER DEFAULT 0,
    lead_id TEXT REFERENCES leads(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hotels_france_classement ON hotels_france(classement);
  CREATE INDEX IF NOT EXISTS idx_hotels_france_commune ON hotels_france(commune);
  CREATE INDEX IF NOT EXISTS idx_hotels_france_code_postal ON hotels_france(code_postal);
  CREATE INDEX IF NOT EXISTS idx_hotels_france_type ON hotels_france(type_hebergement);
  CREATE INDEX IF NOT EXISTS idx_hotels_france_scraping ON hotels_france(scraping_status);
  CREATE INDEX IF NOT EXISTS idx_hotels_france_imported ON hotels_france(imported_as_lead);
  CREATE INDEX IF NOT EXISTS idx_hotels_france_capacite ON hotels_france(capacite_accueil);
  CREATE INDEX IF NOT EXISTS idx_hotels_france_chambres ON hotels_france(nombre_chambres);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_hotels_france_unique ON hotels_france(nom_commercial, code_postal);

  -- ─── Tables Import Multi-Sources (Architecture Flexible) ──────────────────────

  CREATE TABLE IF NOT EXISTS import_sources (
    id TEXT PRIMARY KEY,
    nom TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('csv_import', 'scraping', 'manual')),
    colonnes TEXT DEFAULT '[]',
    scraping_enabled INTEGER DEFAULT 0,
    scraping_config TEXT,
    scraping_status TEXT,
    total_records INTEGER DEFAULT 0,
    scraped_records INTEGER DEFAULT 0,
    import_date TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS imported_prospects (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES import_sources(id) ON DELETE CASCADE,
    email TEXT,
    data TEXT NOT NULL,
    scraping_status TEXT DEFAULT 'pending',
    scraping_date TEXT,
    scraping_error TEXT,
    scraped_data TEXT,
    import_batch TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_registry (
    email TEXT PRIMARY KEY,
    email_type TEXT NOT NULL CHECK(email_type IN ('generic', 'personal')),
    sources TEXT DEFAULT '[]',
    last_sequence_date TEXT,
    last_sequence_id TEXT,
    last_campaign_date TEXT,
    last_campaign_id TEXT,
    total_emails_sent INTEGER DEFAULT 0,
    is_lead INTEGER DEFAULT 0,
    lead_id TEXT,
    is_unsubscribed INTEGER DEFAULT 0,
    first_seen_date TEXT DEFAULT (datetime('now')),
    last_updated TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_import_sources_type ON import_sources(type);
  CREATE INDEX IF NOT EXISTS idx_imported_prospects_source ON imported_prospects(source_id);
  CREATE INDEX IF NOT EXISTS idx_imported_prospects_email ON imported_prospects(email);
  CREATE INDEX IF NOT EXISTS idx_imported_prospects_scraping ON imported_prospects(scraping_status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_prospects_source_email ON imported_prospects(source_id, email) WHERE email IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_email_registry_type ON email_registry(email_type);
  CREATE INDEX IF NOT EXISTS idx_email_registry_lead ON email_registry(is_lead);
  CREATE INDEX IF NOT EXISTS idx_email_registry_updated ON email_registry(last_updated);

  -- ─── Tables Account Management ──────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS partner_communications (
    id TEXT PRIMARY KEY,
    partner_id INTEGER NOT NULL REFERENCES vf_partners(id),
    type TEXT NOT NULL DEFAULT 'email',
    sujet TEXT,
    corps_html TEXT,
    template_id TEXT,
    brevo_message_id TEXT,
    batch_id TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_programs (
    id TEXT PRIMARY KEY,
    partner_id INTEGER NOT NULL REFERENCES vf_partners(id),
    tier TEXT NOT NULL DEFAULT 'standard',
    label TEXT,
    engagement_volume REAL,
    engagement_notes TEXT,
    contreparties TEXT,
    date_debut TEXT,
    date_revision TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_alert_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seuil_jours INTEGER NOT NULL DEFAULT 60,
    actif INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS partner_notes (
    id TEXT PRIMARY KEY,
    partner_id INTEGER NOT NULL REFERENCES vf_partners(id),
    type TEXT DEFAULT 'note',
    contenu TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_partner_comms_partner ON partner_communications(partner_id);
  CREATE INDEX IF NOT EXISTS idx_partner_comms_batch ON partner_communications(batch_id);
  CREATE INDEX IF NOT EXISTS idx_partner_programs_partner ON partner_programs(partner_id);
  CREATE INDEX IF NOT EXISTS idx_partner_notes_partner ON partner_notes(partner_id);

  -- ─── Tables HubSpot Partners ──────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS hubspot_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hubspot_company_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    domain TEXT,
    business_type TEXT,
    capacite INTEGER DEFAULT 0,
    city TEXT,
    postal_code TEXT,
    country TEXT,
    partner_since TEXT,
    synced_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hubspot_partner_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hubspot_contact_id TEXT UNIQUE NOT NULL,
    hubspot_company_id TEXT NOT NULL,
    firstname TEXT,
    lastname TEXT,
    email TEXT,
    jobtitle TEXT,
    synced_at TEXT,
    FOREIGN KEY (hubspot_company_id) REFERENCES hubspot_partners(hubspot_company_id)
  );

  CREATE TABLE IF NOT EXISTS hubspot_deals_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hubspot_deal_id TEXT UNIQUE NOT NULL,
    hubspot_company_id TEXT,
    dealname TEXT,
    amount REAL DEFAULT 0,
    closedate TEXT,
    dealstage TEXT,
    cached_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_hubspot_partners_type ON hubspot_partners(business_type);
  CREATE INDEX IF NOT EXISTS idx_hubspot_partner_contacts_company ON hubspot_partner_contacts(hubspot_company_id);
  CREATE INDEX IF NOT EXISTS idx_hubspot_deals_company ON hubspot_deals_cache(hubspot_company_id);
  CREATE INDEX IF NOT EXISTS idx_hubspot_deals_stage ON hubspot_deals_cache(dealstage);

  -- ─── Listes de contacts partenaires ───────────────────────────────────────

  CREATE TABLE IF NOT EXISTS partner_contact_lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_contact_list_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id TEXT NOT NULL REFERENCES partner_contact_lists(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES hubspot_partner_contacts(id) ON DELETE CASCADE,
    added_at TEXT DEFAULT (datetime('now')),
    UNIQUE(list_id, contact_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pcl_members_list ON partner_contact_list_members(list_id);
  CREATE INDEX IF NOT EXISTS idx_pcl_members_contact ON partner_contact_list_members(contact_id);

  -- ─── Tables Partner Relationship Center ──────────────────────────────────────

  CREATE TABLE IF NOT EXISTS partner_segments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_segment_rules (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL REFERENCES partner_segments(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    operator TEXT NOT NULL,
    value TEXT NOT NULL,
    ordre INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS partner_campaigns (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    sujet TEXT NOT NULL,
    corps_html TEXT,
    statut TEXT DEFAULT 'brouillon',
    scheduled_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    source_type TEXT,
    source_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_campaign_recipients (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES partner_campaigns(id) ON DELETE CASCADE,
    contact_id INTEGER,
    email TEXT NOT NULL,
    firstname TEXT,
    lastname TEXT,
    partner_name TEXT,
    statut TEXT DEFAULT 'en_attente',
    tracking_id TEXT UNIQUE,
    sent_at TEXT,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS partner_campaign_events (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES partner_campaigns(id),
    recipient_id TEXT,
    type TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_auto_programs (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    type TEXT NOT NULL,
    actif INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_program_milestones (
    id TEXT PRIMARY KEY,
    program_id TEXT NOT NULL REFERENCES partner_auto_programs(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL,
    trigger_value INTEGER,
    sujet TEXT NOT NULL,
    corps_html TEXT,
    ordre INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS partner_milestone_logs (
    id TEXT PRIMARY KEY,
    milestone_id TEXT NOT NULL,
    partner_id INTEGER NOT NULL,
    contact_id INTEGER,
    sent_at TEXT DEFAULT (datetime('now')),
    statut TEXT DEFAULT 'envoyé'
  );

  CREATE TABLE IF NOT EXISTS partner_email_templates (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    categorie TEXT DEFAULT 'General',
    sujet TEXT NOT NULL,
    corps_html TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_segment_exclusions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_id TEXT NOT NULL REFERENCES partner_segments(id) ON DELETE CASCADE,
    hubspot_company_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(segment_id, hubspot_company_id)
  );

  CREATE INDEX IF NOT EXISTS idx_partner_seg_excl ON partner_segment_exclusions(segment_id);
  CREATE INDEX IF NOT EXISTS idx_partner_email_templates_cat ON partner_email_templates(categorie);
  CREATE INDEX IF NOT EXISTS idx_partner_segments_name ON partner_segments(name);
  CREATE INDEX IF NOT EXISTS idx_partner_segment_rules_seg ON partner_segment_rules(segment_id);
  CREATE INDEX IF NOT EXISTS idx_partner_campaigns_statut ON partner_campaigns(statut);
  CREATE INDEX IF NOT EXISTS idx_partner_cr_campaign ON partner_campaign_recipients(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_partner_cr_tracking ON partner_campaign_recipients(tracking_id);
  CREATE INDEX IF NOT EXISTS idx_partner_ce_campaign ON partner_campaign_events(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_partner_auto_programs_type ON partner_auto_programs(type);
  CREATE INDEX IF NOT EXISTS idx_partner_milestones_program ON partner_program_milestones(program_id);
  CREATE INDEX IF NOT EXISTS idx_partner_milestone_logs_ms ON partner_milestone_logs(milestone_id);

  -- ─── Tables Anniversaires Partenaires (emails auto) ────────────────────────

  CREATE TABLE IF NOT EXISTS partner_anniversary_config (
    id TEXT PRIMARY KEY,
    template_id TEXT,
    days_before INTEGER DEFAULT 0,
    active INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS partner_anniversary_logs (
    id TEXT PRIMARY KEY,
    partner_id INTEGER NOT NULL,
    contact_email TEXT,
    template_id TEXT,
    year INTEGER NOT NULL,
    sent_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_anniv_logs_partner ON partner_anniversary_logs(partner_id, year);

  -- ─── Table Exclusions Anniversaires ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS partner_anniversary_exclusions (
    partner_id INTEGER PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── Règles anniversaires par business_type ──────────────────────────────────
  CREATE TABLE IF NOT EXISTS partner_anniversary_rules (
    id TEXT PRIMARY KEY,
    business_type TEXT NOT NULL UNIQUE,
    template_id TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── Maps Prospection ───────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS maps_prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT UNIQUE NOT NULL,
    name TEXT, category TEXT, address TEXT, city TEXT, country TEXT,
    phone TEXT, website TEXT,
    website_age_years REAL, website_last_updated TEXT,
    website_is_old INTEGER DEFAULT 0, website_age_method TEXT,
    rating REAL, reviews_count INTEGER, maps_url TEXT,
    email TEXT, email_source TEXT, email_confidence TEXT,
    instagram TEXT, facebook TEXT, linkedin TEXT, notes TEXT,
    status TEXT DEFAULT 'new',
    enrichment_attempted INTEGER DEFAULT 0,
    enrichment_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_maps_prospects_place_id ON maps_prospects(place_id);
  CREATE INDEX IF NOT EXISTS idx_maps_prospects_city ON maps_prospects(city);
  CREATE INDEX IF NOT EXISTS idx_maps_prospects_status ON maps_prospects(status);
  CREATE INDEX IF NOT EXISTS idx_maps_prospects_email ON maps_prospects(email);
  CREATE INDEX IF NOT EXISTS idx_maps_prospects_rating ON maps_prospects(rating);
`);

// ─── Instagram Scraping ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS instagram_scrape_jobs (
    id TEXT PRIMARY KEY,
    instagram_url TEXT NOT NULL,
    instagram_username TEXT NOT NULL,
    instagram_user_id TEXT,
    status TEXT DEFAULT 'pending',
    total_following INTEGER DEFAULT 0,
    processed INTEGER DEFAULT 0,
    emails_found INTEGER DEFAULT 0,
    contacts_found INTEGER DEFAULT 0,
    error_message TEXT,
    filter_keywords TEXT DEFAULT '[]',
    options TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS instagram_scraped_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL REFERENCES instagram_scrape_jobs(id) ON DELETE CASCADE,
    instagram_username TEXT NOT NULL,
    instagram_user_id TEXT,
    full_name TEXT,
    bio TEXT,
    website TEXT,
    external_url TEXT,
    business_email TEXT,
    category TEXT,
    is_business INTEGER DEFAULT 0,
    is_private INTEGER DEFAULT 0,
    follower_count INTEGER,
    following_count INTEGER,
    scraped_emails TEXT DEFAULT '[]',
    best_email TEXT,
    email_source TEXT,
    email_confidence TEXT,
    social_links TEXT DEFAULT '{}',
    linkedin_contacts TEXT DEFAULT '[]',
    business_type TEXT,
    bio_keywords TEXT DEFAULT '[]',
    scraping_status TEXT DEFAULT 'pending',
    scraping_error TEXT,
    imported_as_lead INTEGER DEFAULT 0,
    lead_id TEXT REFERENCES leads(id),
    existing_lead_email TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ig_accounts_job_id ON instagram_scraped_accounts(job_id);
  CREATE INDEX IF NOT EXISTS idx_ig_accounts_username ON instagram_scraped_accounts(instagram_username);
  CREATE INDEX IF NOT EXISTS idx_ig_accounts_best_email ON instagram_scraped_accounts(best_email);
  CREATE INDEX IF NOT EXISTS idx_ig_accounts_scraping_status ON instagram_scraped_accounts(scraping_status);
  CREATE INDEX IF NOT EXISTS idx_ig_accounts_business_type ON instagram_scraped_accounts(business_type);
`);

// ─── Table de suivi détaillé des appels Brave API (par jour et par source) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS api_brave_daily (
    date     TEXT NOT NULL,
    source   TEXT NOT NULL,
    requests INTEGER DEFAULT 0,
    PRIMARY KEY (date, source)
  )
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
  'ALTER TABLE veille_articles ADD COLUMN opportunity_id TEXT',
  'ALTER TABLE veille_articles ADD COLUMN hotel_name TEXT',
  'ALTER TABLE veille_articles ADD COLUMN city TEXT',
  'ALTER TABLE veille_articles ADD COLUMN group_name TEXT',
  'ALTER TABLE veille_articles ADD COLUMN signal_type TEXT',
  // Audit Passe 2 — Opportunités enrichies
  'ALTER TABLE veille_opportunities ADD COLUMN hotel_name_normalized TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN postal_code TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN reopening_date TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN opening_date TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN supporting_signals TEXT DEFAULT \'[]\'',
  'ALTER TABLE veille_opportunities ADD COLUMN priority TEXT DEFAULT \'C\'',
  // Audit Passe 2 — Runs enrichis
  'ALTER TABLE veille_source_runs ADD COLUMN items_merged INTEGER DEFAULT 0',
  // Audit Passe 2 — Sources : support type recherche large
  'ALTER TABLE veille_sources ADD COLUMN search_mode TEXT DEFAULT \'site\'',
  // Prospection — Contacts LinkedIn trouvés
  'ALTER TABLE hotels_france ADD COLUMN linkedin_contacts TEXT DEFAULT \'[]\'',
  'ALTER TABLE hotels_france ADD COLUMN linkedin_search_date TEXT',
  // Account Management
  'ALTER TABLE vf_partners ADD COLUMN derniere_commande_at TEXT',
  'ALTER TABLE vf_partners ADD COLUMN programme_tier TEXT DEFAULT \'standard\'',
  // HubSpot Partners
  'ALTER TABLE hubspot_partners ADD COLUMN partner_since TEXT',
  // Partner Relationship Center
  'ALTER TABLE hubspot_partners ADD COLUMN phone TEXT',
  'ALTER TABLE hubspot_partners ADD COLUMN email TEXT',
  'ALTER TABLE hubspot_partners ADD COLUMN notes TEXT',
  'ALTER TABLE hubspot_partner_contacts ADD COLUMN phone TEXT',
  'ALTER TABLE hubspot_partners ADD COLUMN hubspot_owner_id TEXT',
  'ALTER TABLE partner_campaigns ADD COLUMN piece_jointe TEXT',
  // Anniversaires — type de campagne + filtre business_type
  "ALTER TABLE partner_campaigns ADD COLUMN type TEXT DEFAULT 'marketing'",
  'ALTER TABLE partner_campaigns ADD COLUMN business_type_filter TEXT',
  'ALTER TABLE partner_campaigns ADD COLUMN days_before INTEGER DEFAULT 0',
  'ALTER TABLE vf_client_mappings ADD COLUMN hubspot_company_id TEXT',
  // Emails génériques — exclusion des mauvais emails
  'ALTER TABLE hotels_france ADD COLUMN email_excluded INTEGER DEFAULT 0',
  // ─── Phase 1 Refonte Veille — Signaux multi-sources ───────────────
  'ALTER TABLE veille_opportunities ADD COLUMN signal_summary TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN best_contact_id TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN hubspot_company_id TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN hubspot_deal_id TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN stars TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN website TEXT',
  'ALTER TABLE veille_opportunities ADD COLUMN google_place_id TEXT',
  'ALTER TABLE veille_articles ADD COLUMN signal_id TEXT',
  // Priorité des séquences d'envoi (1=haute, 5=basse, 3=normal)
  'ALTER TABLE sequences ADD COLUMN priorite INTEGER DEFAULT 3',
  'ALTER TABLE shipments ADD COLUMN delivery_notified_at TEXT',
  'ALTER TABLE shipments ADD COLUMN client_prenom TEXT',
  // Maps Prospection — statut business (OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY)
  'ALTER TABLE maps_prospects ADD COLUMN business_status TEXT DEFAULT \'OPERATIONAL\'',
  // Maps Prospection — TikTok
  'ALTER TABLE maps_prospects ADD COLUMN tiktok TEXT',
  // Séparation notification interne (Hugo) vs email client
  'ALTER TABLE shipments ADD COLUMN client_notified_at TEXT',
  // Notification point de retrait envoyée au client
  'ALTER TABLE shipments ADD COLUMN pickup_notified_at TEXT',
  // Timestamps pour retour, échec et point de retrait (pour notifications configurables)
  'ALTER TABLE shipments ADD COLUMN returned_at TEXT',
  'ALTER TABLE shipments ADD COLUMN failed_at TEXT',
  'ALTER TABLE shipments ADD COLUMN pickup_at TEXT',
  // Notifications retour + échec envoyées
  'ALTER TABLE shipments ADD COLUMN returned_notified_at TEXT',
  'ALTER TABLE shipments ADD COLUMN failed_notified_at TEXT',
  // Instagram — Pays détecté
  'ALTER TABLE instagram_scraped_accounts ADD COLUMN country TEXT',
  // Instagram — Champs business pour détection pays améliorée
  'ALTER TABLE instagram_scraped_accounts ADD COLUMN city_name TEXT',
  'ALTER TABLE instagram_scraped_accounts ADD COLUMN phone_country_code TEXT',
  'ALTER TABLE instagram_scraped_accounts ADD COLUMN address_street TEXT',
  // Instagram — Mode scraping (following ou followers)
  "ALTER TABLE instagram_scrape_jobs ADD COLUMN scrape_mode TEXT DEFAULT 'following'",
  // Instagram — Recherche par catégorie business
  'ALTER TABLE instagram_scrape_jobs ADD COLUMN search_category TEXT',
  'ALTER TABLE instagram_scrape_jobs ADD COLUMN search_country TEXT',
  "ALTER TABLE instagram_scrape_jobs ADD COLUMN search_progress TEXT DEFAULT '{}'",
  // Instagram — Numéro de téléphone
  'ALTER TABLE instagram_scraped_accounts ADD COLUMN phone_number TEXT',
  // Leads — Numéro de téléphone
  'ALTER TABLE leads ADD COLUMN telephone TEXT',
];
for (const sql of migrations) {
  try { db.prepare(sql).run(); } catch (e) {
    // Ignorer "duplicate column" qui est attendu, logger les vraies erreurs
    if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
      console.error('⚠️  Erreur migration:', sql, '-', e.message);
    }
  }
}

// ─── Migration : backfill returned_at/failed_at/pickup_at + marquer comme notifiés ──
try {
  const backfillDone = db.prepare("SELECT valeur FROM config WHERE cle = 'migration_shipment_notif_timestamps_v1'").get();
  if (!backfillDone) {
    // Remplir les timestamps depuis last_wms_check pour les shipments existants
    db.prepare(`UPDATE shipments SET returned_at = COALESCE(returned_at, last_wms_check) WHERE wms_status_code = 'RET' AND returned_at IS NULL`).run();
    db.prepare(`UPDATE shipments SET failed_at = COALESCE(failed_at, last_wms_check) WHERE wms_status_code = 'ECH' AND failed_at IS NULL`).run();
    db.prepare(`UPDATE shipments SET pickup_at = COALESCE(pickup_at, last_wms_check) WHERE wms_status_code = 'PRP' AND pickup_at IS NULL`).run();
    // Marquer comme déjà notifiés pour éviter un backlog d'envoi
    db.prepare(`UPDATE shipments SET returned_notified_at = datetime('now') WHERE wms_status_code = 'RET' AND returned_notified_at IS NULL`).run();
    db.prepare(`UPDATE shipments SET failed_notified_at = datetime('now') WHERE wms_status_code = 'ECH' AND failed_notified_at IS NULL`).run();
    db.prepare("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('migration_shipment_notif_timestamps_v1', '1')").run();
    console.log('✅ Migration shipment notification timestamps : backfill terminé');
  }
} catch (e) {
  console.error('⚠️  Erreur migration shipment notif timestamps:', e.message);
}

// ─── Migration : statut "Échantillon envoyé" pour leads ayant déjà un échantillon ──
try {
  const alreadyDone = db.prepare("SELECT valeur FROM config WHERE cle = 'migration_echantillon_envoye_v2'").get();
  if (!alreadyDone) {
    const preserveStatuts = ['Converti', 'Désabonné', 'Closed Lost'];
    const placeholders = preserveStatuts.map(() => '?').join(',');
    const result = db.prepare(`
      UPDATE leads SET statut = 'Échantillon envoyé', updated_at = datetime('now')
      WHERE email IN (SELECT DISTINCT client_email FROM shipments WHERE type = 'echantillon' AND client_email IS NOT NULL)
      AND statut NOT IN (${placeholders})
    `).run(...preserveStatuts);
    // Aussi remplir client_prenom sur les shipments existants
    db.prepare(`
      UPDATE shipments SET client_prenom = (
        SELECT l.prenom FROM leads l WHERE l.email = shipments.client_email LIMIT 1
      )
      WHERE type = 'echantillon' AND client_email IS NOT NULL AND client_prenom IS NULL
    `).run();
    db.prepare("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('migration_echantillon_envoye_v2', '1')").run();
    console.log(`✅ Migration "Échantillon envoyé" v2 : ${result.changes} lead(s) mis à jour`);
  }
} catch (e) {
  console.error('⚠️  Erreur migration échantillon envoyé:', e.message);
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
  { vf_name: 'SAS Melt Lille', file_name: 'Jost Hotel Lille' },
  { vf_name: 'HOTEL LITTERAIRE MARCEL AYME', file_name: 'Marcel Aymé' },
  { vf_name: 'HOTEL LITTERAIRE MARCEL AYMÉ', file_name: 'Marcel Aymé' },
  { vf_name: 'Château de Herces', file_name: 'Château de Herces' },
  { vf_name: 'Domaine de Biar', file_name: 'Domaine de Biar' },
  { vf_name: 'CLOS MARCAMPS', file_name: 'CLOS MARCAMPS' },
  { vf_name: 'Bread et Couette Chambres d\'hotes', file_name: 'Bread et Couette Chambres d\'hotes' },
  { vf_name: 'Auberge du Cabestan - Attn : Eric', file_name: 'Auberge Du Cabestan' },
  { vf_name: 'Chateau de Cop Choux', file_name: 'Le Château de Cop Choux' },
  { vf_name: 'Château de Sannes - MLGT Holding', file_name: 'Château de Sannes' },
  { vf_name: 'Château de Blanat - Jerome simeon', file_name: 'Château de Blanat' },
  { vf_name: 'CHATEAUFORM France – CAMPUS ENGIE', file_name: 'CAMPUS ENGIE' },
  { vf_name: 'Escale Marine - Delphine Gaudin', file_name: 'Escale Marine' },
  { vf_name: 'Suite Balnéo Canet - Erik Mullie', file_name: 'Suite Balnéo Canet' },
  { vf_name: 'GROUPE FRANCK PUTELAT - attn : Aurore', file_name: 'Hôtel Le Parc' },
  { vf_name: 'Hotel Théorème Paris', file_name: 'Dream Hotel Opera (Théorème)' },
  { vf_name: 'Claridge', file_name: 'Hotel Claridge' },
  { vf_name: 'Nouvelle société hotel Bellman - claridge', file_name: 'Hotel Claridge' },
  { vf_name: 'Chalet B - SCI Ballovitch', file_name: 'Chalet B' },
  { vf_name: 'Carlton Hotel St. Moritz - Stephanie Lehnort', file_name: 'Carlton Hotel St. Moritz' },
  { vf_name: 'Châteauform\' de Nointel', file_name: 'Chateauform' },
  { vf_name: 'Domaine de Biar - Stéphane SERRES', file_name: 'Domaine de Biar' },
  { vf_name: 'Hilo Collection - Clery - Hélène WEISS', file_name: 'HILO Collection' },
];
for (const m of missingClientMappings) {
  const exists = db.prepare('SELECT id FROM vf_client_mappings WHERE vf_name = ?').get(m.vf_name);
  if (!exists) {
    try {
      db.prepare('INSERT INTO vf_client_mappings (vf_name, file_name) VALUES (?, ?)').run(m.vf_name, m.file_name);
    } catch (e) { /* ignore */ }
  }
}

// ─── Mapping centralisé HubSpot / Google Sheets / VosFactures ───────────────
const centralMappings = [
  { hs: '11064528604', gs: 'le Beau Moulin', vf: 'Beau Moulin SAS', vfId: '142842770' },
  { hs: '9850052567', gs: 'Lodging Le Lac', vf: 'sarl LODGING LE LAC', vfId: '141898669' },
  { hs: '11135098315', gs: 'Hôtel Restaurant des Iles', vf: 'Hôtel Restaurant des Iles', vfId: '146263477' },
  { hs: '10196401607', gs: 'Domaine des Bidaudières', vf: 'SARL Château des ARPENTIS', vfId: '189916346' },
  { hs: '10101542869', gs: 'Au Lion Rouge', vf: 'Au Lion Rouge - Christophe KOENIG', vfId: '153567611' },
  { hs: '9289052109', gs: 'Domaine de Canaille', vf: 'Revestel Cap Canaille - attn: Marie Treppoz', vfId: '146176750' },
  { hs: '34583453890', gs: 'Daroco 16', vf: 'SA TURQUOISE - Daroco 16', vfId: '161809265' },
  { hs: '34583452869', gs: 'Daroco Bourse', vf: 'SAS DAROCO - Daroco Bourse', vfId: '161808883' },
  { hs: '34425533639', gs: 'Daroco Soho', vf: 'DAROCO LTD - Daroco Soho', vfId: '158523505' },
  { hs: '10466912193', gs: 'Omar Dhiab', vf: 'Restaurant Omar Dhiab', vfId: '170177412' },
  { hs: '49757464780', gs: 'Le Domaine du Pech Eternel', vf: 'Guillaume JOLY', vfId: '171767114' },
  { hs: '79622842574', gs: 'Chalet B', vf: 'Chalet B - SCI Ballovitch', vfId: '177724123' },
  { hs: '41354947803', gs: 'IMMOBILIERE DU BOURGAGE', vf: 'Immobilere du Bourgage - Antoine Rousselet', vfId: '172408077' },
  { hs: '7813509353', gs: 'Escale Blanche', vf: 'LANA VACANCES SAS - Escale Blanche', vfId: '140305806' },
  { hs: '77541777626', gs: 'La Maison Normande', vf: 'La Maison Normande', vfId: '178704703' },
  { hs: '10687480294', gs: 'La Source', vf: 'LA SOURCE', vfId: '180140790' },
  { hs: '14347507700', gs: 'Relais de Saint-Preuil', vf: 'Relais de Saint-Preuil', vfId: '180507227' },
  { hs: '79279474935', gs: 'DS_Niel et Franklin', vf: 'SJM - DS Café - Niel-Franklin & Défense-Lafayette', vfId: '182352633' },
  { hs: '79279474935', gs: 'DS_Defense et Lafayette', vf: 'SJM - DS Café - Niel-Franklin & Défense-Lafayette', vfId: '182352633' },
  { hs: '79279474935', gs: 'DS_Victor Hugo', vf: 'SOCIETE LOUMI - DS Café - Victor Hugo', vfId: '182352889' },
  { hs: '79279474935', gs: 'DS_Boulogne', vf: 'Société MILOUBOU - DS Café - Boulogne', vfId: '182353153' },
  { hs: '79279474935', gs: 'DS_Bordeaux', vf: 'SOCIETE DS CAFE BORDEAUX - DS Café - Bordeaux', vfId: '180733900' },
  { hs: '7198934767', gs: 'Villa Beaumarchais', vf: 'Machefert - VILLA BEAUMARCHAIS', vfId: '106006848' },
  { hs: '12981789882', gs: 'Les Chalets De La Clusaz', vf: 'POLLET IMMOBILIER 2022 - Chalet Caribou', vfId: '155144319' },
  { hs: '85839606990', gs: 'Suite Balnéo Canet', vf: 'Suite Balnéo Canet - Erik Mullie', vfId: '179695087' },
  { hs: '83324012763', gs: 'Conquer Your Day (Blanche)', vf: 'Conquer Your Day', vfId: '189526185' },
  { hs: '8107699158', gs: 'Le Château de Cop Choux', vf: 'Chateau de Cop Choux', vfId: '116447938' },
  { hs: '45034726627', gs: 'Château de Blanat', vf: 'SAS Chateau Blanat', vfId: '189668650' },
  { hs: '121133183165', gs: 'Chalets Uto', vf: 'GLMZ', vfId: '186709706' },
  { hs: '125103244497', gs: 'Le Mas Vidau', vf: 'Le Mas Vidau - Ana Archip', vfId: '187925398' },
  { hs: '8890134728', gs: 'Kraft Hotel', vf: 'Kraft Hôtel', vfId: '126089818' },
  { hs: '10101114845', gs: 'La Fraichette', vf: 'La Fraichette', vfId: '148537207' },
  { hs: '10156749246', gs: 'Hotel Clairefontaine', vf: 'Hotel Clairefontaine', vfId: '138554535' },
  { hs: '10458328259', gs: 'Hotel Marina Adelphia', vf: 'HOTEL MARINA ADELPHIA - attn : Christian Galice', vfId: '147321768' },
  { hs: '6587092954', gs: 'Hôtel de La Groirie', vf: 'La Groirie', vfId: '103579962' },
  { hs: '7030501102', gs: 'Holmes Place Austria', vf: 'Holmes Place Wien GmbH', vfId: '178071590' },
  { hs: '6616981735', gs: 'Monsieur Alfred', vf: 'Monsieur Alfred', vfId: '123106664' },
  { hs: '13421267673', gs: 'Manoir des Douets Fleuris', vf: 'SAS Hôtel le Manoir des Douets Fleuris - Émilie Léost', vfId: '158115820' },
  { hs: '10608646135', gs: 'BAO Chambres d\'hôtes', vf: 'SAS BAO Chambres d\'hôtes', vfId: '140880747' },
  { hs: '267283185854', gs: 'Jost Hotel Montpellier Gare', vf: 'MELT MONTPELLIER GARE', vfId: '202107270' },
  { hs: '11289478107', gs: 'Hôtel La Résidence', vf: 'Hôtel La Résidence - attn : Magali Azam', vfId: '145301472' },
  { hs: '11289156323', gs: 'Auberge Du Cabestan', vf: 'Auberge du Cabestan - Attn : Eric', vfId: '145519766' },
  { hs: '116472911055', gs: 'Le Domaine de l\'Ecorcerie', vf: 'Le Domaine de l\'Ecorcerie', vfId: '185691418' },
  { hs: '10155480004', gs: 'Hôtel de Mougins', vf: 'La Bastide de Mougins - OPCO MOUGINS', vfId: '188655831' },
  { hs: '10172516050', gs: 'Hotel Nyx', vf: 'Hotel Nyx - MIVA SARL', vfId: '143859662' },
  { hs: '9732720369', gs: 'Chateau des Arpentis', vf: 'SARL Château des ARPENTIS - Mr Suzanne', vfId: '138520089' },
  { hs: '72811258075', gs: 'Hôtel au Coq Dort Spa', vf: 'Hôtel au Coq Dort Spa - Laura Cotillon', vfId: '1766214443' },
  { hs: '428503187672', gs: 'Appart\'Hôtel Le Génépy', vf: 'Appart\'Hôtel Le Génépy', vfId: '213629620' },
  { hs: '428582886599', gs: 'Hôtel Le Faucigny', vf: 'Hôtel Le Faucigny', vfId: '212464800' },
  { hs: '428502469863', gs: 'Plan B Saint Gervais', vf: 'Plan B Saint Gervais', vfId: '194193320' },
  { hs: '18685856974', gs: 'Hôtel Le Lyret', vf: 'Hôtel Le Lyret', vfId: '212465333' },
  { hs: '262224605406', gs: 'Shd Invest Srl - Shams Demaret', vf: 'Shd Invest Srl - Shams Demaret', vfId: '207472711' },
  { hs: '9675837160', gs: 'Hôtel Oré Saint Malo', vf: 'HOTEL ORE', vfId: '135095350' },
  { hs: '125517683910', gs: 'Les Pins Blancs', vf: 'Les Pins Blancs', vfId: '214907101' },
  { hs: '79279474935', gs: 'DS_Reims', vf: 'DS Café Reims - SAS Ed\'N', vfId: '219415419' },
  { hs: '79279474935', gs: 'DS_Lyon', vf: 'SOCIETE DS CAFE LYON - DS Café - Lyon', vfId: '178139425' },
  { hs: '306170559680', gs: 'Chalet APY', vf: 'SARL LA BANQUISE - Hôtel Igloo', vfId: '221924084' },
  { hs: '12635214820', gs: 'Kyriad Prestige Residence & Spa Cabourg-Dives-sur-Mer', vf: 'Hotel Kyriad Prestige Residence & Spa Cabourg', vfId: '152850849' },
  { hs: '8378206190', gs: 'HK Montparnasse', vf: 'HK Montparnasse', vfId: '120247990' },
  { hs: '7905216193', gs: 'HK MONTMARTRE', vf: 'HK MONTMARTRE - Korner', vfId: '114150451' },
  { hs: '12277638857', gs: 'Gustave Flaubert', vf: 'HOTEL LITTERAIRE FLAUBERT', vfId: '150115547' },
  { hs: '9088782045', gs: 'Hôtel L\'Ormaie', vf: 'L\'ORMAIE', vfId: '156393263' },
  { hs: '9714186978', gs: 'Le Château d\'Argens', vf: 'Le Château d\'Argens - Daphnée Godin', vfId: '148174343' },
  { hs: '332188302572', gs: 'Chamkeys Prestige', vf: 'Angélique Dussollier - Chamkeys', vfId: '222461778' },
  { hs: '6654029787', gs: 'KYRIAD PRESTIGE PERPIGNAN', vf: 'Hotel Kyriad Prestige Perpignan', vfId: '96053973' },
  { hs: '359855035638', gs: 'La Trêve', vf: 'La Trêve - Ousmane Sow', vfId: '225255804' },
  { hs: '6818052286', gs: 'Villa Panthéon', vf: 'Machefert Group - Villa Pantheon', vfId: '99051095' },
  { hs: '116472966392', gs: 'Causse Comtal', vf: 'Hôtel Causse Comtal Rodez, The Originals Relais', vfId: '185680429' },
  { hs: '9427207622', gs: 'HK OPERA', vf: 'HK OPERA - Korner', vfId: '133522653' },
  { hs: '8430078454', gs: 'HK Eiffel', vf: 'HK Eiffel', vfId: '120902220' },
  { hs: '7905770977', gs: 'Hôtel Elysées Bassano', vf: 'Hôtel Elysées Bassano', vfId: '147393359' },
  { hs: '36287471819', gs: 'Escale Marine', vf: 'Escale Marine - Delphine Gaudin', vfId: '167992881' },
  { hs: '428583602381', gs: 'Plan B Chamonix', vf: 'Plan B Chamonix', vfId: '213629513' },
  { hs: '79279474935', gs: 'DS_Parly 2', vf: 'SOCIETE DS PARLY - DS Café - Parly 2', vfId: '182353071' },
  { hs: '12277260754', gs: 'Alexandre Vialatte', vf: 'HOTEL LITTERAIRE VIALATTE', vfId: '150115357' },
  { hs: '9638068469', gs: 'Château de Sannes', vf: 'Château de Sannes - MLGT Holding', vfId: '136087687' },
  { hs: '346506158270', gs: 'L\'Hermitage', vf: 'L\'Hermitage - Florian Méheust', vfId: '226025543' },
  { hs: '428583592122', gs: 'CAMPUS ENGIE', vf: 'CHATEAUFORM France – CAMPUS ENGIE', vfId: '211294381' },
  { hs: '8433966556', gs: 'HK Saint Marcel', vf: 'HK Saint Marcel - Korner', vfId: '197877986' },
  { hs: '428583598329', gs: 'Les Airelles', vf: 'Hôtel les Airelles - LES AIRELLES PLAGNAT ET FILS', vfId: '227442300' },
  { hs: '11459840228', gs: 'HK CHÂTELET', vf: 'HK CHÂTELET - Korner', vfId: '145951345' },
  { hs: '9776272831', gs: 'HK Etoile', vf: 'HK Etoile', vfId: '135846494' },
  { hs: '11460248782', gs: 'HK LOUVRE', vf: 'HK LOUVRE - Korner', vfId: '146070420' },
  { hs: '287075027143', gs: 'Maison Montgrand', vf: 'Hôtel Maison Montgrand Vieux Port - Fanny Sauvage', vfId: '218679803' },
  { hs: '124461148348', gs: 'Hôtel Des Deux Gares', vf: 'Hôtel Des Deux Gares', vfId: '212465199' },
  { hs: '6504755391', gs: '1K Paris', vf: '1K - Machefert', vfId: '112513649' },
  { hs: '274780658904', gs: 'Hôtel Provençal Bandol', vf: 'HÔTEL PROVENÇAL BANDOL - SARL M A D Y S - Fabien VOCICOT', vfId: '214886795' },
  { hs: '132194822358', gs: 'Hôtel le Portillo', vf: 'Hôtel le Portillo - Juliette Moreau Bonaldi', vfId: '189836312' },
  { hs: '9673663196', gs: 'Hôtel Le Renaissance', vf: 'SARL SEHR - Renaissance', vfId: '136285729' },
  { hs: '267122065602', gs: 'HK République', vf: 'HK République', vfId: '202808264' },
  { hs: '274612176104', gs: 'Osmo Studio', vf: 'OSMO STUDIO SAS - Jihene Kasbi', vfId: '218956851' },
  { hs: '12277260757', gs: 'Arthur Rimbaud', vf: 'HOTEL LITTERAIRE RIMBAUD', vfId: '150114897' },
  { hs: '13351238853', gs: 'Les chalets Covarel', vf: 'MCOVAREL SA - Mathilde COVAREL', vfId: '157431383' },
  { hs: '9109098174', gs: 'Le Saint Nicolas', vf: 'SAS St-Nicolas', vfId: '150910249' },
  { hs: '56675877080', gs: 'Les Relais Du Capitole', vf: 'Les Relais Du Capitole', vfId: '173815575' },
  { hs: '22685807831', gs: 'Mana Homes', vf: 'Mana homes - Aymeric Koenig', vfId: '203527558' },
  { hs: '415037362402', gs: 'Pisco and co sas Le Manoir de la Campagne', vf: 'Pisco and co sas Le Manoir de la Campagne Tristan Philippon', vfId: '238087488' },
  { hs: '51855073508', gs: 'HOTEL 96', vf: 'HOTEL 96 - Alice Denoix et William Racine', vfId: '172741666' },
  { hs: '171829251285', gs: 'Hôtel Best Western Saint Antoine', vf: 'Hôtel Best Western Saint Antoine - Ksenia LISSINE', vfId: '196703321' },
  { hs: '108362207445', gs: 'Hôtel Boronali (Le Rodrigue)', vf: 'Hotel Le Rodrigue (Boronali)', vfId: '183147362' },
  { hs: '46943395013', gs: 'Loire Valley Lodges', vf: 'Loire Valley Lodges - Anne Caroline FREY', vfId: '171305487' },
  { hs: '87649999057', gs: 'Globe et Cecil Hotel', vf: 'Globe et Cecil Hotel', vfId: '180342544' },
  { hs: '229376638173', gs: 'Domaine de Biar', vf: 'Domaine de Biar - Stéphane SERRES', vfId: '207317649' },
  { hs: '9675251697', gs: 'Hôtel La Balance', vf: 'Hotel La Balance', vfId: '137052934' },
  { hs: '7905068006', gs: 'Hotel Claridge', vf: 'Nouvelle société hotel Bellman - claridge', vfId: '135357372' },
  { hs: '8979080927', gs: 'HK Sorbonne', vf: 'HK Sorbonne', vfId: '127792862' },
  { hs: '95968436462', gs: 'Les Rives Oceanik', vf: 'Les Rives Oceanik - Philippine BOULAY', vfId: '181560789' },
  { hs: '9428369090', gs: 'Hôtel Grand Cœur Latin', vf: 'Hotel Grand Coeur Latin SAS Hoteliere Excelsior Latin', vfId: '136279629' },
  { hs: '378365718751', gs: 'CLOS MARCAMPS', vf: 'CLOS MARCAMPS - Jean-Philippe Illarine', vfId: '229251784' },
  { hs: '136893591752', gs: 'The Central (Loewe)', vf: 'Loewe Sarl', vfId: '190592719' },
  { hs: '9170649033', gs: 'Barry\'s Bootcamp Paris', vf: 'Barry\'s Bootcamp Paris', vfId: '131149479' },
  { hs: '6802535361', gs: 'Maison Eugenie', vf: 'Machefert Group - Villa Eugenie', vfId: '98761254' },
  { hs: '415932920050', gs: 'Bread et Couette Chambres d\'hotes', vf: 'Bread et Couette Chambres d\'hotes', vfId: '237029341' },
  { hs: '82477580498', gs: 'Pantoufle Hôtels', vf: 'SAS PH GROUPE - Pantoufle Hôtels', vfId: '178543549' },
  { hs: '85839351994', gs: 'HILO Collection', vf: 'HILO Collection - Hélène WEISS', vfId: '193145449' },
  { hs: '9474249923', gs: 'Sangha Hotels', vf: 'Sangha Toulouse', vfId: '146071675' },
  { hs: '10688245752', gs: 'My Ginger', vf: 'My Ginger - attn : Candice', vfId: '145300324' },
  { hs: '423026510067', gs: 'Hotel Snob', vf: 'Hotel Snob - Glenn Ricafrente', vfId: '238907600' },
  { hs: '8357575104', gs: 'Life Hotels Bordeaux', vf: 'Life Hotels Bordeaux', vfId: '121254624' },
  { hs: '11235978745', gs: 'Casa del Capitan', vf: 'DOMINI LA CAPITAINERIE', vfId: '190863056' },
  { hs: '12096899832', gs: 'Hôtel Moderniste', vf: 'Hôtel Moderniste - Bertrand Mignard', vfId: '151284732' },
  { hs: '9059531498', gs: 'Dream Hotel Opera (Théorème)', vf: 'Hotel Théorème Paris', vfId: '125549920' },
  { hs: '12277638860', gs: 'Marcel Aymé', vf: 'HOTEL LITTERAIRE MARCEL AYME', vfId: '147749123' },
  { hs: '12277260760', gs: 'Stendhal', vf: 'HOTEL LITTERAIRE STENDHAL', vfId: '147745856' },
  { hs: '424330141906', gs: 'Château de Herces', vf: 'Château de Herces - Isabelle et Matthieu Poydenot', vfId: '236350864' },
  { hs: '10608864198', gs: 'Le Swann', vf: 'HOTEL LITTERAIRE LE SWANN', vfId: '150114610' },
  { hs: '6553940941', gs: 'MyNestinn', vf: 'Phillipe Bos - URL BOS', vfId: '95040122' },
  { hs: '150657585388', gs: 'Jost Hotel Lille', vf: 'SAS Melt Lille', vfId: '190947835' },
  { hs: '11838832374', gs: 'Hôtel Le Parc', vf: 'GROUPE FRANCK PUTELAT', vfId: '149178374' },
  { hs: '125158430941', gs: 'PONT DU CHALON Hôtel', vf: 'PONT DU CHALON Hôtel - Catheryne Ginot', vfId: '214849985' },
  { hs: '114687740133', gs: 'Hôtel des Mines', vf: 'Hôtel des Mines - Victor Forêt', vfId: '194301500' },
  { hs: '374749174001', gs: 'Hôtel Le 10 Bis', vf: 'Hôtel Le 10 Bis - EMERAUDE HOTELS', vfId: '228994005' },
];
const upsertMapping = db.prepare(`
  INSERT INTO vf_client_mappings (vf_name, file_name, vf_client_id, hubspot_company_id)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`);
// Use vf_name as lookup key to update existing or insert new
for (const m of centralMappings) {
  const existing = db.prepare('SELECT id FROM vf_client_mappings WHERE vf_name = ?').get(m.vf);
  if (existing) {
    db.prepare('UPDATE vf_client_mappings SET file_name = ?, vf_client_id = ?, hubspot_company_id = ? WHERE id = ?')
      .run(m.gs, m.vfId, m.hs, existing.id);
  } else {
    db.prepare('INSERT INTO vf_client_mappings (vf_name, file_name, vf_client_id, hubspot_company_id) VALUES (?, ?, ?, ?)')
      .run(m.vf, m.gs, m.vfId, m.hs);
  }
}
// Also ensure we can look up by vf_client_id → hubspot_company_id (for deals)
// Update any existing mappings that have the same vf_client_id but no hubspot_company_id
for (const m of centralMappings) {
  db.prepare('UPDATE vf_client_mappings SET hubspot_company_id = ? WHERE vf_client_id = ? AND (hubspot_company_id IS NULL OR hubspot_company_id = ?)').run(m.hs, m.vfId, m.hs);
}

// ─── Sync partenaires canoniques manquants ──────────────────────────────────
const CANONICAL_PARTNERS = [
  // Liste canonique officielle (source de vérité Google Sheet)
  "le Beau Moulin", "Lodging Le Lac", "Hôtel Restaurant des Iles",
  "Domaine des Bidaudières", "Au Lion Rouge", "Domaine de Canaille",
  "Daroco Bourse", "Daroco 16", "Daroco Soho", "MyNestinn", "Omar Dhiab",
  "Le Domaine du Pech Eternel", "Chalet B", "IMMOBILIERE DU BOURGAGE",
  "Escale Blanche", "La Maison Normande", "La Source", "Relais de Saint-Preuil",
  "DS_Niel et Franklin", "DS_Defense et Lafayette", "DS_Victor Hugo", "DS_Boulogne",
  "DS_Bordeaux", "Villa Beaumarchais", "Les Chalets De La Clusaz",
  "Suite Balnéo Canet", "Conquer Your Day (Blanche)", "Le Château de Cop Choux",
  "Château de Blanat", "Chalets Uto", "Le Mas Vidau", "Kraft Hotel",
  "Hotel Clairefontaine", "La Fraichette", "Hotel Marina Adelphia",
  "Hôtel de La Groirie", "Holmes Place Austria", "Monsieur Alfred",
  "Manoir des Douets Fleuris", "BAO Chambres d'hôtes", "Jost Hotel Montpellier Gare",
  "Hôtel La Résidence", "Auberge Du Cabestan", "Le Domaine de l'Ecorcerie",
  "Hôtel de Mougins", "Hotel Nyx", "Chateau des Arpentis", "Hôtel au Coq Dort Spa",
  "Hôtel Le Lyret", "Hôtel Le Faucigny", "Appart'Hôtel Le Génépy",
  "Plan B Saint Gervais", "Shd Invest Srl - Shams Demaret", "Hôtel Oré Saint Malo",
  "Les Pins Blancs", "DS_Reims", "DS_Lyon", "Chalet APY",
  "Kyriad Prestige Residence & Spa Cabourg-Dives-sur-Mer",
  "HK Montparnasse", "HK MONTMARTRE", "Gustave Flaubert", "Hôtel L'Ormaie",
  "Le Château d'Argens", "KYRIAD PRESTIGE PERPIGNAN", "Chamkeys Prestige",
  "Villa Panthéon", "La Trêve", "Causse Comtal", "HK OPERA", "HK Eiffel",
  "Hôtel Elysées Bassano", "Escale Marine", "Plan B Chamonix", "DS_Parly 2",
  "Alexandre Vialatte", "Château de Sannes", "L'Hermitage", "HK Saint Marcel",
  "CAMPUS ENGIE", "HK CHÂTELET", "HK Etoile", "HK LOUVRE", "Maison Montgrand",
  "Hôtel des 2 Gares", "1K Paris", "Hôtel Le Renaissance", "Hôtel le Portillo",
  "Hôtel Provençal Bandol", "HK République", "Arthur Rimbaud", "Les chalets Covarel",
  "Osmo Studio", "Le Saint Nicolas", "Les Relais Du Capitole", "Mana Homes",
  "HOTEL 96", "Hôtel des Mines", "Pisco and co sas Le Manoir de la Campagne",
  "Hôtel Best Western Saint Antoine", "Hôtel Boronali (Le Rodrigue)",
  "Loire Valley Lodges", "Globe et Cecil Hotel", "Hôtel La Balance",
  "Domaine de Biar", "Hotel Claridge", "HK Sorbonne", "Les Rives Oceanik",
  "Hôtel Grand Cœur Latin", "The Central (Loewe)", "Barry's Bootcamp Paris",
  "CLOS MARCAMPS", "Maison Eugenie", "Pantoufle Hôtels", "Sangha Hotels",
  "HILO Collection", "Bread et Couette Chambres d'hotes", "My Ginger",
  "Life Hotels Bordeaux", "Dream Hotel Opera (Théorème)", "Casa del Capitan",
  "Hôtel Moderniste", "Marcel Aymé", "Stendhal", "Le Swann",
  "Château de Herces", "Jost Hotel Lille", "Hôtel Le Parc",
  // Noms internes / non-hôtels (conservés pour compatibilité)
  "Douglas Italy", "ACCOR ALL Hearties 1", "ACCOR ALL Hearties 2",
  "ACCOR ALL Hearties 3", "ACCOR ALL Hearties 4", "Sofitel Paris Baltimore Tour Eiffel",
  "Nocibe reappro new products", "Hello CSE - 17,5€", "Hotel Waldorf Trocadero",
  "Better Beauty Box", "Les Airelles", "Juliana Brussel", "Les chalets Covarel",
  "Hôtel Abbaye du Golf", "Carlton Hotel St. Moritz", "Hôtel du golf lacanau (La Baignoire)",
  "Le Swann (mariage)", "Hôtel Bourgogne & Montana", "The Bradery",
  "Institut Corpo", "Yangon Excelsior Hotel", "Château des Ayes",
  "Hotel Stanley", "Chateauform", "Hotel de France",
  "Hotel Le A", "La Maison Normande",
];
const normPartner = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const stmtInsertPartner = db.prepare('INSERT OR IGNORE INTO vf_partners (nom, nom_normalise) VALUES (?, ?)');
let partnersInserted = 0;
for (const name of CANONICAL_PARTNERS) {
  const r = stmtInsertPartner.run(name, normPartner(name));
  if (r.changes > 0) partnersInserted++;
}
if (partnersInserted > 0) console.log(`🏨 ${partnersInserted} partenaire(s) ajouté(s)`);

// Fix : renommer le partenaire avec nom de contact inclus
try {
  db.prepare("UPDATE vf_partners SET nom = 'Hôtel Best Western Saint Antoine' WHERE nom = 'Hôtel Best Western Saint Antoine - Ksenia LISSINE'").run();
} catch (e) { /* ignore */ }

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
  { ref: 'P044', nom: 'Shampoing Brillance Revelation Flacon 500ml', prix_ht: 7.50, moq: 6 },
  { ref: 'P044-30', nom: 'Shampoing Brillance Revelation Flacon 30ml', prix_ht: 0.65, moq: 6 },
  { ref: 'P044-5000', nom: 'Shampoing Brillance Revelation Recharge 5L', prix_ht: 41.00, moq: 4 },
  { ref: 'P045', nom: 'Gel lavant corps et mains Revelation Flacon 500ml', prix_ht: 7.50, moq: 6 },
  { ref: 'P045-5000', nom: 'Gel lavant corps et mains Revelation Recharge 5L', prix_ht: 41.00, moq: 4 },
  { ref: 'P046', nom: 'Shampoing Purifiant Radiance Flacon 500ml', prix_ht: 7.50, moq: 6 },
  { ref: 'P046-150', nom: 'Shampoing Purifiant Radiance Flacon 30ml', prix_ht: 2.00, moq: 6 },
  { ref: 'P046-5000', nom: 'Shampoing Purifiant Radiance Flacon 5L', prix_ht: 41.00, moq: 4 },
  { ref: 'P047', nom: 'Gel lavant corps et mains Radiance Flacon 500ml', prix_ht: 7.50, moq: 6 },
  { ref: 'P047-30', nom: 'Gel lavant corps et mains Radiance Flacon 30ml', prix_ht: 0.65, moq: 6 },
  { ref: 'P047-5000', nom: 'Gel lavant corps et mains Radiance Recharge 5L', prix_ht: 41.00, moq: 4 },
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
  'Portes flacons': ['SPFS', 'PFS', 'PFD', 'PFT', 'PFDS', 'PFSS', 'PFTS', 'BAV'],
  'Cadeaux VIP & Spa': ['P016', 'P023', 'P012', 'P009', 'P020', 'P021-20', 'P026'],
  'Produits Spa & VIP': ['P021', 'P022', 'P317-100', 'P005', 'P006', 'P027', 'P003', 'P004', 'P004-500', 'P029'],
  'Parfums & gel hydroalcoolique': ['P015'],
  'Produits hygiène format voyage': ['P010-30', 'P010-50', 'P010-150', 'P024-40', 'P011-100', 'P017-30', 'P017', 'P038-30', 'P008-150', 'P008-75', 'P035-30', 'P008-30', 'P011-30', 'P042-30', 'P007-30', 'P014-100', 'P034-100', 'P035-100', 'P036-100', 'P037-100'],
  'Autres': ['P5L', 'P500ml', 'P300ML', 'SPRAY-VIDE'],
};

// Refs avec wildcard (startsWith) pour Parfums & gel hydroalcoolique
const CATEGORIE_PREFIX = {
  'Parfums & gel hydroalcoolique': ['P039', 'P041', 'P018'],
};

// Force update pour les refs listées explicitement (corrige les mauvaises catégories)
const stmtForceCat = db.prepare('UPDATE vf_catalog SET categorie = ? WHERE ref = ?');
let catForced = 0;
for (const [cat, refs] of Object.entries(CATEGORIE_MAP)) {
  for (const ref of refs) {
    const r = stmtForceCat.run(cat, ref);
    if (r.changes > 0) catForced++;
  }
}

// Ensuite les refs par préfixe pour les produits sans catégorie
const stmtUpdateCat = db.prepare('UPDATE vf_catalog SET categorie = ? WHERE ref = ? AND categorie IS NULL');
let catUpdated = 0;
const allProducts = db.prepare('SELECT ref FROM vf_catalog WHERE categorie IS NULL').all();
for (const [cat, prefixes] of Object.entries(CATEGORIE_PREFIX)) {
  for (const p of allProducts) {
    if (prefixes.some(prefix => p.ref.startsWith(prefix))) {
      const r = stmtUpdateCat.run(cat, p.ref);
      if (r.changes > 0) catUpdated++;
    }
  }
}

if (catForced > 0 || catUpdated > 0) console.log(`🏷️  ${catForced + catUpdated} catégorie(s) assignée(s) au catalogue`);

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
      nom: 'Recherche large — Rénovation',
      url: 'https://search.brave.com',
      categorie: 'radar',
      frequence_cron: '0 7,19 * * *',
      search_mode: 'wide',
      mots_cles: ['rénovation hôtel palace boutique 2025 2026',
        'travaux transformation hôtel étoiles france',
        'réhabilitation hôtel chantier ouverture'],
    },
    {
      nom: 'Recherche large — Transactions',
      url: 'https://search.brave.com',
      categorie: 'radar',
      frequence_cron: '0 8 * * 1,3,5',
      search_mode: 'wide',
      mots_cles: ['cession hôtel france vente fonds commerce',
        'acquisition hôtel groupe hôtelier rachat',
        'investissement hôtelier immobilier tourisme'],
    },
    {
      nom: 'Recherche large — Signaux faibles',
      url: 'https://search.brave.com',
      categorie: 'radar',
      frequence_cron: '0 9 * * 2,4',
      search_mode: 'wide',
      mots_cles: ['architecte intérieur hôtel projet design france',
        'recrutement directeur hôtel palace nomination',
        'nouveau directeur général hôtel nommé'],
    },
    {
      nom: 'Recherche large — Fermetures temporaires',
      url: 'https://search.brave.com',
      categorie: 'radar',
      frequence_cron: '0 8,20 * * *',
      search_mode: 'wide',
      mots_cles: ['"temporairement fermé" OR "temporarily closed" hôtel france',
        '"fermé pour travaux" OR "fermé pour rénovation" hôtel',
        'hôtel "fermeture temporaire" réouverture 2025 2026',
        '"closed for renovation" hotel france palace boutique'],
    },
  ];

  const stmtInsertSource = db.prepare(`
    INSERT INTO veille_sources (id, nom, url, type, selecteurs, mots_cles, frequence, frequence_cron, categorie, actif, search_mode)
    VALUES (?, ?, ?, 'brave_search', '{}', ?, '6h', ?, ?, 1, ?)
  `);

  let sourcesAdded = 0;
  for (const src of VEILLE_SOURCES) {
    // Pour les sources wide (même URL brave), dédupliquer par nom
    const exists = src.search_mode === 'wide'
      ? db.prepare('SELECT id FROM veille_sources WHERE nom = ?').get(src.nom)
      : db.prepare('SELECT id FROM veille_sources WHERE url LIKE ?').get(`%${new URL(src.url).hostname.replace('www.', '')}%`);
    if (!exists) {
      stmtInsertSource.run(
        randomUUID(), src.nom, src.url,
        JSON.stringify(src.mots_cles),
        src.frequence_cron || '0 */6 * * *',
        src.categorie || 'hebdo',
        src.search_mode || 'site'
      );
      sourcesAdded++;
    } else {
      // Mettre à jour les mots-clés, fréquence et catégorie des sources existantes
      db.prepare('UPDATE veille_sources SET mots_cles = ?, frequence_cron = ?, categorie = ?, type = ?, search_mode = ? WHERE id = ?').run(
        JSON.stringify(src.mots_cles),
        src.frequence_cron || '0 */6 * * *',
        src.categorie || 'hebdo',
        'brave_search',
        src.search_mode || 'site',
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

// ─── Seed config alertes partenaires ─────────────────────────────────────────
try {
  const alertConfigExists = db.prepare('SELECT COUNT(*) as n FROM partner_alert_config').get();
  if (alertConfigExists.n === 0) {
    db.prepare('INSERT INTO partner_alert_config (seuil_jours, actif) VALUES (60, 1)').run();
    console.log('🔔 Config alertes partenaires initialisée (seuil: 60 jours)');
  }
} catch (e) { /* ignore */ }

// ─── Sync derniere_commande_at depuis partner_orders ────────────────────────
try {
  db.prepare(`
    UPDATE vf_partners SET derniere_commande_at = (
      SELECT MAX(created_at) FROM partner_orders WHERE partner_orders.partner_id = vf_partners.id AND partner_orders.statut != 'annule'
    ) WHERE derniere_commande_at IS NULL
  `).run();
} catch (e) { /* ignore */ }

// ─── Migration : marquer les échantillons livrés AVANT le 22/05/2026 comme déjà contactés ──
// Ceux depuis le 22/05 doivent recevoir l'email auto (backlog traité via bulk-notify)
try {
  const alreadyDone = db.prepare("SELECT valeur FROM config WHERE cle = 'migration_client_notified_v3'").get();
  if (!alreadyDone) {
    // Marquer les pré-22/05 comme déjà contactés (gérés manuellement)
    const result = db.prepare(`
      UPDATE shipments SET client_notified_at = COALESCE(delivery_notified_at, delivered_at)
      WHERE type = 'echantillon'
        AND delivered_at IS NOT NULL
        AND delivered_at < '2026-05-22'
        AND client_notified_at IS NULL
    `).run();
    // Reset ceux depuis le 22/05 (au cas où la migration v2 les a marqués à tort)
    const reset = db.prepare(`
      UPDATE shipments SET client_notified_at = NULL
      WHERE type = 'echantillon'
        AND delivered_at IS NOT NULL
        AND delivered_at >= '2026-05-22'
    `).run();
    db.prepare("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('migration_client_notified_v3', '1')").run();
    console.log(`✅ Migration client_notified_at v3 : ${result.changes} pré-22/05 marqué(s), ${reset.changes} post-22/05 reset`);
  }
} catch (e) {
  console.error('⚠️  Erreur migration client_notified_at v3:', e.message);
}

// ─── Data fix : corriger les types blocklist mal assignés ────────────────────
try {
  const fixDomains = db.prepare(`UPDATE email_blocklist SET type = 'domain' WHERE type = 'email' AND value NOT LIKE '%@%'`).run();
  const fixEmails = db.prepare(`UPDATE email_blocklist SET type = 'email' WHERE type = 'domain' AND value LIKE '%@%'`).run();
  if (fixDomains.changes || fixEmails.changes) {
    console.log(`🔧 Blocklist fix-types: ${fixDomains.changes} domaine(s), ${fixEmails.changes} email(s) corrigé(s)`);
  }
} catch (e) {
  console.error('⚠️  Erreur fix blocklist types:', e.message);
}

console.log('✅ Base de données initialisée :', DB_PATH);
module.exports = db;
