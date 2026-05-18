# Plan de refonte — Module Veille TDM Sequencer

## 1. État des lieux

### Ce qui fonctionne bien (conserver)

| Composant | Fichier | Verdict |
|-----------|---------|---------|
| **Pipeline scraping Brave Search** | `veilleService.js` | Solide. Modes `site` et `wide`, freshness adaptée, dédup URL, scoring A/B/C par mots-clés. |
| **Scraping HTML + RSS** | `veilleService.js` | Fonctionnel, peu utilisé (la plupart des sources sont en Brave). Garder comme fallback. |
| **Enrichissement articles** | `veilleEnrichment.js` | Bon pipeline : fetch full content → extraction hôtel/ville/groupe/signal/date projet. Regex robustes, listes de villes/groupes/régions complètes. |
| **Fusion en opportunités** | `veilleOpportunity.js` | Architecture solide : fingerprint `hotel|city|semester`, scoring hybride 0-100 avec composantes décomposées, angles commerciaux recommandés. Multi-signaux déjà gérés. |
| **Scheduler dynamique** | `veilleScraper.js` | Crons dynamiques par source, locks par source, health monitoring, pipeline enrichissement toutes les 30min. |
| **Observabilité** | `veille_source_runs` + routes `/runs`, `/status`, `/health` | Run history complète, health auto-calculée (healthy/degraded/failing). |
| **UI 4 onglets** | `app.jsx` L19363-20305 | Opportunities avec filtres/détail, Articles avec lu/favori/archivé, Sources/Health, Scanner. Fonctionnel. |

### Ce qui est défaillant

| Problème | Impact | Cause racine |
|----------|--------|-------------|
| **Scanner Google Places quasi inutile** | 0-2 résultats sur 200+ villes | Google ne marque pas les hôtels en travaux comme `CLOSED_TEMPORARILY`. Les hôteliers gardent leur fiche active pour le SEO. |
| **Aucun contact décideur** | Opportunités détectées mais pas exploitables directement | Pas de pipeline contacts. L'utilisateur doit chercher manuellement le bon interlocuteur. |
| **Scoring statique** | Pas d'apprentissage des won/lost | Aucune table feedback, pas de boucle de calibration. Les poids sont hardcodés. |
| **Sources haute valeur manquantes** | Signaux faibles non captés | Pas de delta reviews Google, pas de monitoring Booking, pas de permis de construire data.gouv, pas de LinkedIn jobs pré-ouverture. |
| **Pas d'export CRM** | Double saisie HubSpot | Aucun bouton "Envoyer vers HubSpot" depuis une opportunité Veille. |

### Code mort ou sous-utilisé

| Élément | Fichier | Raison |
|---------|---------|--------|
| `veille_entities` (table) | `init.js` L396 | Créée mais jamais peuplée. L'enrichissement stocke directement sur `veille_articles` (hotel_name, city, group_name), pas dans cette table. |
| `QUARTIERS` (constantes détaillées Paris 1-20, Lyon, etc.) | `googlePlacesService.js` | Bonne données mais le scanner `CLOSED_TEMPORARILY` ne remonte rien. Récupérable pour le nouveau Google Maps signal detector. |
| `hotel_name_normalized` sur `veille_opportunities` | `veilleOpportunity.js` | Peuplé mais jamais utilisé dans les requêtes SQL. Utile pour la dédup — le garder. |

---

## 2. Architecture cible

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SOURCES DE SIGNAUX                          │
├──────────┬──────────┬───────────┬──────────┬──────────┬────────────┤
│  Brave   │ Google   │ Booking   │ Data.gouv│ LinkedIn │ BOAMP      │
│  Search  │ Maps API │ Dispo     │ Permis   │ Jobs     │ BODACC     │
│ (presse) │ (reviews,│ (scraping │ construire│ (Brave   │ (existant  │
│          │  hours,  │  ou API   │          │  search) │  renforcé) │
│          │  delta)  │  affiliée)│          │          │            │
└────┬─────┴────┬─────┴────┬──────┴────┬─────┴────┬─────┴────┬───────┘
     │          │          │           │          │          │
     ▼          ▼          ▼           ▼          ▼          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     veille_signals (NOUVEAU)                       │
│  fingerprint = hotel|city|signal_type|month → dédup                │
│  signal_type, signal_strength 0-100, source, raw_payload           │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
┌──────────────────────────┐  ┌──────────────────────────────────────┐
│    veille_articles        │  │    veille_opportunities (ENRICHI)    │
│    (existant, inchangé)   │  │    + signal_summary JSON             │
│    articles presse        │  │    + business_score recalibré        │
│    → enrichis → opp_id    │  │    + convergence multi-sources       │
└──────────────────────────┘  └───────────────────┬──────────────────┘
                                                  │
                                    ┌─────────────┴──────────────┐
                                    ▼                            ▼
                    ┌─────────────────────────┐  ┌──────────────────────────┐
                    │  veille_contacts (NOUV)  │  │  veille_scoring_feedback │
                    │  Pipeline :              │  │  (NOUVEAU)               │
                    │  Pappers → LinkedIn →    │  │  won/lost/not_relevant   │
                    │  email pattern →         │  │  → calibration scoring   │
                    │  ZeroBounce verify       │  │                          │
                    └────────────┬─────────────┘  └──────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  Export HubSpot          │
                    │  Company + Contact +     │
                    │  Deal + Tags             │
                    └─────────────────────────┘
```

---

## 3. Nouveau schéma DB

### Tables à AJOUTER

```sql
-- Signaux individuels datés (coeur du nouveau système)
CREATE TABLE IF NOT EXISTS veille_signals (
  id TEXT PRIMARY KEY,
  hotel_name TEXT,
  city TEXT,
  postcode TEXT,
  country TEXT DEFAULT 'FR',
  signal_type TEXT NOT NULL,
  -- Types : google_review_drop, google_review_keyword, google_hours_change,
  --         booking_unavailable, booking_delisted,
  --         permis_construire, boamp_marche, bodacc_movement,
  --         linkedin_preopening_job, press_renovation, press_ouverture, etc.
  signal_strength INTEGER DEFAULT 50, -- 0-100
  source TEXT NOT NULL,
  -- Sources : google_places, booking, data_gouv, linkedin, press, boamp, bodacc
  source_url TEXT,
  raw_payload TEXT,                    -- JSON brut pour debug
  detected_at TEXT DEFAULT (datetime('now')),
  signal_date TEXT,                    -- quand le signal s'est produit (≠ détection)
  opportunity_id TEXT,                 -- FK nullable, lien après fusion
  fingerprint TEXT NOT NULL,           -- hotel|city|signal_type|YYYY-MM → dédup
  UNIQUE(fingerprint)
);
CREATE INDEX idx_veille_sig_hotel ON veille_signals(hotel_name);
CREATE INDEX idx_veille_sig_city ON veille_signals(city);
CREATE INDEX idx_veille_sig_type ON veille_signals(signal_type);
CREATE INDEX idx_veille_sig_opp ON veille_signals(opportunity_id);
CREATE INDEX idx_veille_sig_detected ON veille_signals(detected_at DESC);

-- Snapshots Google Places mensuels (delta reviews)
CREATE TABLE IF NOT EXISTS veille_google_snapshots (
  id TEXT PRIMARY KEY,
  hotel_place_id TEXT NOT NULL,
  hotel_name TEXT,
  city TEXT,
  snapshot_date TEXT NOT NULL,          -- YYYY-MM-DD
  review_count INTEGER,
  rating REAL,
  business_status TEXT,
  opening_hours_json TEXT,
  website_uri TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(hotel_place_id, snapshot_date)
);
CREATE INDEX idx_veille_gsnap_place ON veille_google_snapshots(hotel_place_id);

-- Contacts décideurs
CREATE TABLE IF NOT EXISTS veille_contacts (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT REFERENCES veille_opportunities(id) ON DELETE SET NULL,
  hotel_name TEXT,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT,
  role_relevance INTEGER DEFAULT 50,   -- 0-100
  linkedin_url TEXT,
  email TEXT,
  email_pattern TEXT,                  -- 'firstname.lastname', 'flastname', etc.
  email_status TEXT DEFAULT 'unverified',
  -- Statuts : unverified, valid, invalid, catch_all, unknown
  email_score INTEGER,                 -- ZeroBounce confidence
  email_source TEXT,
  -- Sources : pappers, linkedin_scrape, hunter, pattern_guess, manual
  phone TEXT,
  phone_status TEXT,
  domain TEXT,                         -- domaine email de l'hôtel
  siren TEXT,
  enrichment_date TEXT,
  last_verified_at TEXT,
  raw_payload TEXT,                    -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_veille_ct_opp ON veille_contacts(opportunity_id);
CREATE INDEX idx_veille_ct_email ON veille_contacts(email);

-- Tentatives d'enrichissement contact (audit trail)
CREATE TABLE IF NOT EXISTS veille_contact_attempts (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES veille_contacts(id) ON DELETE CASCADE,
  attempt_type TEXT NOT NULL,
  -- Types : pappers_lookup, linkedin_scrape, hunter_domain,
  --         pattern_guess, zerobounce_verify
  status TEXT DEFAULT 'pending',       -- pending, success, failed
  payload TEXT,                        -- JSON résultat
  credits_used INTEGER DEFAULT 0,      -- coût en crédits API
  attempted_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_veille_ca_contact ON veille_contact_attempts(contact_id);

-- Feedback scoring (boucle d'apprentissage)
CREATE TABLE IF NOT EXISTS veille_scoring_feedback (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT REFERENCES veille_opportunities(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL,         -- won, lost, not_relevant, wrong_contact
  feedback_reason TEXT,                -- texte libre optionnel
  business_score_at_time INTEGER,
  signals_snapshot TEXT,               -- JSON des signaux contributeurs
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_veille_fb_opp ON veille_scoring_feedback(opportunity_id);
CREATE INDEX idx_veille_fb_type ON veille_scoring_feedback(feedback_type);
```

### Colonnes à AJOUTER aux tables existantes

```sql
-- veille_opportunities : résumé des signaux + champs contacts
ALTER TABLE veille_opportunities ADD COLUMN signal_summary TEXT;
-- JSON : [{ type, strength, source, date, url }]
ALTER TABLE veille_opportunities ADD COLUMN best_contact_id TEXT;
ALTER TABLE veille_opportunities ADD COLUMN hubspot_company_id TEXT;
ALTER TABLE veille_opportunities ADD COLUMN hubspot_deal_id TEXT;
ALTER TABLE veille_opportunities ADD COLUMN stars TEXT;
-- Étoiles de l'hôtel (détectées via Google ou presse)
ALTER TABLE veille_opportunities ADD COLUMN website TEXT;
ALTER TABLE veille_opportunities ADD COLUMN google_place_id TEXT;

-- veille_articles : lien vers signal
ALTER TABLE veille_articles ADD COLUMN signal_id TEXT;
-- FK vers veille_signals si l'article a généré un signal
```

### Migrations

Toutes via `ALTER TABLE ... ADD COLUMN` dans un fichier `migrations/YYYYMMDD_veille_refonte.js`, exécuté au démarrage via try/catch (pattern existant dans `init.js`).

---

## 4. Nouvelles sources — Rate limits, coûts, fréquences

| Source | API / Méthode | Rate limit | Coût | Fréquence cron | Notes |
|--------|---------------|------------|------|----------------|-------|
| **Google Places (reviews/hours)** | Places API v1 `places/{id}` champs `reviews,currentOpeningHours` | 100 req/sec | ~$17/1000 req (Place Details) | 1x/semaine batch 50 hôtels | Le poste de coût principal. Batché et limité. |
| **Google Places (snapshots)** | Places API v1 Text Search | 100 req/sec | ~$32/1000 req (Text Search) | 1x/mois pour nouveaux hôtels | Seulement pour résoudre place_id. Après ça, on utilise Place Details. |
| **Booking.com** | Scraping HTML respectueux OU API Amadeus Self-Service | Scraping: 1 req/5s. Amadeus: 10K req/mois gratuit | Scraping: gratuit. Amadeus: gratuit tier | 2x/mois, 3 fenêtres par hôtel | Recommandation: commencer par Amadeus (légal et gratuit). Fallback scraping si insuffisant. |
| **Data.gouv — Permis construire** | REST API data.gouv.fr + CSV Sit@del2 | Pas de limite stricte | Gratuit | 1x/semaine | Parsing CSV mensuel. Filtre NAF 5510Z + surface > 500m². |
| **BOAMP** | API BOAMP (boamp.fr) | Raisonnable | Gratuit | 1x/jour | Filtre code NAF 5510Z, montant > 100k. Existant dans mots-clés Brave, mais accès API direct plus fiable. |
| **BODACC** | API bodacc.fr | Raisonnable | Gratuit | 1x/semaine | Changements dirigeants, créations/radiations SCI hôtelière. |
| **LinkedIn jobs (via Brave)** | Brave Search `site:linkedin.com/jobs` | 1 req/1.2s (quota Brave existant) | Inclus dans plan Brave | 2x/semaine | Recherche `"pré-ouverture" OR "pre-opening" hotel`. Pas de scraping LinkedIn direct. |
| **Presse (existant)** | Brave Search mode wide/site | 1 req/1.2s | Inclus dans plan Brave | Quotidien/Hebdo selon source | Inchangé, fonctionne bien. |
| **Pappers** | REST API pappers.fr | 100 req/jour (gratuit), 1000/jour (pro) | Gratuit: 100/j. Pro: ~50/mois | À la demande (pipeline contact) | SIREN + dirigeants. Budget critique si > 100 contacts/mois. |
| **ZeroBounce** | REST API zerobounce.net | 10 req/sec | ~$15/2000 crédits | À la demande (pipeline contact) | 1-6 patterns testés par contact. Budget à surveiller. |

**Estimation coûts mensuels (usage normal ~50 opps actives) :**

| API | Estimation req/mois | Coût estimé |
|-----|---------------------|-------------|
| Google Places (snapshots + details) | ~200-400 | ~$5-12 |
| Brave Search (existant) | ~500-1000 | Inclus dans plan |
| Pappers | ~50-100 | Gratuit (tier free) |
| ZeroBounce | ~200-500 | ~$15-30 |
| **Total** | | **~$20-42/mois** |

---

## 5. Stratégie de détection "hôtel en travaux" — logique multi-signaux

### Principe

Abandonner la détection binaire `CLOSED_TEMPORARILY` (trop rare) au profit d'une **convergence de signaux faibles** qui, combinés, donnent un signal fort.

### Matrice des signaux

| Signal | Strength seul | Source | Fiabilité | Fréquence détection |
|--------|--------------|--------|-----------|---------------------|
| `google_review_drop` (delta reviews 60j < 10% de la moyenne 6 mois) | 60 | Google Places | Haute — signal objectif, difficile à simuler | Courante |
| `google_review_keyword` (avis mentionnant travaux/rénovation) | 80-100 | Google Places | Très haute — preuve directe | Rare mais très fiable |
| `google_hours_change` (passage 7j → 0j ou réduction > 50%) | 70 | Google Places | Moyenne — peut être saisonnier | Moyennement courante |
| `booking_unavailable_long` (pas de dispo J+30/90/150) | 85 | Booking / Amadeus | Haute — un hôtel indisponible 5+ mois est anormal | Courante |
| `booking_delisted` (disparu des résultats) | 75 | Booking / Amadeus | Moyenne — peut être un choix commercial | Peu courante |
| `permis_construire` (hébergement hôtelier > 500m²) | 90 | Data.gouv | Très haute — signal officiel | Rare mais ultra-fiable |
| `boamp_marche` (travaux NAF 5510Z > 100k) | 85 | BOAMP | Très haute — budget officiel | Rare |
| `bodacc_movement` (changement dirigeant SCI hôtelière) | 60 | BODACC | Moyenne — pas forcément lié à travaux | Courante |
| `linkedin_preopening_job` (recrutement pré-ouverture) | 75 | LinkedIn via Brave | Haute — signal d'ouverture/réouverture imminente | Moyennement courante |
| `press_renovation` (article presse mentionnant rénovation) | 70-90 | Brave Search existant | Haute (si source fiable) | Le plus courant |

### Combinaisons clés (convergence → score amplifié)

| Combinaison | Score convergence | Signification |
|-------------|-------------------|---------------|
| `review_drop` + `press_renovation` | +20 | Confirmation croisée : travaux détectés par 2 sources indépendantes |
| `review_drop` + `booking_unavailable` | +25 | Signal très fort : l'hôtel est probablement fermé physiquement |
| `permis_construire` + `press_renovation` | +15 | Projet officialisé + couverture médiatique |
| `linkedin_preopening_job` + `press_ouverture` | +20 | Réouverture imminente — timing idéal pour approche |
| `booking_unavailable` + `google_hours_change` | +15 | Fermeture confirmée par 2 canaux indépendants |
| 3+ signaux de sources différentes | +10 par source au-delà de 2 | Convergence multi-sources |

### Algorithme de scoring révisé

```
business_score = min(100, sum_of:
  signal_max_strength           : 0-25 pts (force du signal le plus fort, normalisée)
  convergence_multi_sources     : 0-25 pts (+5 par source distincte, cap 25)
  convergence_multi_signaux     : 0-20 pts (+10 si 3+ types, +20 si 5+)
  combo_bonus                   : 0-15 pts (combos spécifiques ci-dessus)
  fraicheur                     : 0-15 pts (décroissance exponentielle 6 mois)
  entite_detectee               : 0-10 pts (hotel_name +5, city +3, group +2)
  segment_premium               : 0-10 pts (palace/5*/luxe)
)
```

---

## 6. Pipeline contacts (Phase 2)

```
┌────────────────────────────────────────────────────────────────────┐
│  Opportunité avec business_score >= 50                            │
└───────────────────────┬────────────────────────────────────────────┘
                        │
        ┌───────────────▼───────────────┐
        │  Étape 1 — Pappers            │
        │  SIREN par nom commercial +   │
        │  ville → dirigeants actuels   │
        │  (président, gérant, DG)      │
        │  + SCI propriétaire           │
        └───────────────┬───────────────┘
                        │
        ┌───────────────▼───────────────┐
        │  Étape 2 — LinkedIn (Brave)   │
        │  site:linkedin.com/in         │
        │  "<hotel>" (directeur OR DG)  │
        │  Dédup Levenshtein vs Pappers │
        │  Rôles clés : Dir. technique, │
        │  F&B, Housekeeping, Achats    │
        └───────────────┬───────────────┘
                        │
        ┌───────────────▼───────────────┐
        │  Étape 3 — Domaine email      │
        │  Google Places websiteUri     │
        │  OU Brave "<hotel> contact"   │
        │  Domaines chaînes connus      │
        └───────────────┬───────────────┘
                        │
        ┌───────────────▼───────────────┐
        │  Étape 4 — Patterns email     │
        │  6 patterns générés :         │
        │  first.last, flast, first,    │
        │  first-last, last.first,      │
        │  firstlast                    │
        │  Si pattern connu pour ce     │
        │  domaine → priorité           │
        └───────────────┬───────────────┘
                        │
        ┌───────────────▼───────────────┐
        │  Étape 5 — ZeroBounce         │
        │  Test patterns en cascade :   │
        │  valid → stop                 │
        │  catch-all → 2e test pour     │
        │    confirmer, sinon warning   │
        │  invalid → pattern suivant    │
        │  Tous invalid → unknown       │
        │  Log dans contact_attempts    │
        └───────────────┬───────────────┘
                        │
        ┌───────────────▼───────────────┐
        │  Étape 6 — Score contact      │
        │  role_relevance × email_score │
        │  × fraîcheur LinkedIn         │
        │  → best_contact sur l'opp     │
        └───────────────────────────────┘
```

### Priorité des rôles pour notre offre amenity

| Rôle | role_relevance | Justification |
|------|---------------|---------------|
| Directeur technique / Directeur des services techniques | 100 | Décideur direct amenities |
| Directeur des achats / Acheteur | 95 | Décideur budget fournisseurs |
| Directeur F&B / House Keeping Manager | 90 | Utilisateur direct, influence forte |
| DG / Directeur général / General Manager | 85 | Décideur final, vision stratégique |
| Spa Manager | 80 | Décideur gamme spa |
| Propriétaire / Président SCI | 70 | Pas toujours opérationnel, mais pouvoir de décision |
| Directeur commercial / Revenue Manager | 40 | Rarement impliqué dans choix amenities |

---

## 7. Roadmap UI (Phase 3)

### 5 sous-onglets (au lieu de 4)

| Onglet | Contenu | Existant → Nouveau |
|--------|---------|---------------------|
| **Dashboard** | KPIs : opps nouvelles 7j, signaux par type, taux conversion new→contacted→won, top opps score | **NOUVEAU** — remplace les KPI cards actuels en haut |
| **Opportunités** | Fiche opp enrichie : identité hôtel, timeline signaux, score décomposé, contacts triés, boutons HubSpot + feedback | **REFONTE** — vue détail beaucoup plus riche |
| **Signaux** | Liste brute des signaux, filtrable type/source/date, utile pour debug | **NOUVEAU** |
| **Sources & Santé** | Monitoring crons, taux erreur par source, coûts API du mois | **REFONTE** — fusion du tab Health actuel + ajout monitoring coûts |
| **Paramètres** | Clés API, seuils scoring, hôtels exclus, boutons test, compteurs crédits ZeroBounce/Pappers | **NOUVEAU** (actuellement dans Paramètres global) |

### Fiche Opportunité (vue détail) — maquette

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Retour                                          Score: 78/100 ■  │
│                                                                      │
│  🏨 Hôtel Le Grand Lyon ★★★★               Lyon, ARA               │
│  Groupe : Indépendant    Site : legrandlyon.com                      │
│  Signal dominant : Rénovation                                        │
│                                                                      │
│  ┌─ Score décomposé ──────────────────────────────────────────────┐  │
│  │ Signal max    ████████████████░░░░░░░░░  18/25                │  │
│  │ Multi-sources ██████████████████░░░░░░░  20/25                │  │
│  │ Multi-signaux ████████████░░░░░░░░░░░░░  10/20                │  │
│  │ Fraîcheur     ████████████████████░░░░░  12/15                │  │
│  │ Entité        ████████████████░░░░░░░░░   8/10                │  │
│  │ Premium       ██████████████████████████  10/10                │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Timeline des signaux ────────────────────────────────────────┐  │
│  │ Jan 2026  ●── press_renovation (Hospitality ON, score 85)     │  │
│  │ Fev 2026  ●── google_review_drop (-92% vs moyenne, score 75)  │  │
│  │ Mar 2026  ●── booking_unavailable (3 fenêtres, score 85)      │  │
│  │ Avr 2026  ●── linkedin_preopening_job (DG, score 75)          │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ Contacts ────────────────────────────────────────────────────┐  │
│  │ ★ Jean Dupont — DG (rel: 85)                                  │  │
│  │   📧 j.dupont@legrandlyon.com  ✅ valid   [Copier] [Compose]  │  │
│  │   🔗 linkedin.com/in/jeandupont                               │  │
│  │                                                                │  │
│  │   Marie Martin — Dir. technique (rel: 100)                     │  │
│  │   📧 m.martin@legrandlyon.com  ⚠️ catch-all  [Copier]         │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  💡 Angle : Cohérence de repositionnement : accompagner la montée   │
│     en gamme des amenities pour matcher le nouveau standing.         │
│                                                                      │
│  Statut: [new] [qualified] [contacted] [won] [lost]                  │
│                                                                      │
│  [🔗 Envoyer vers HubSpot]    [👎 Pas pertinent]  [❌ Mauvais contact]│
│                                                                      │
│  ┌─ Articles liés (3) ──────────────────────────────────────────┐  │
│  │ • "Le Grand Lyon se refait une beauté" — Hospitality ON      │  │
│  │ • "Rénovation palace Lyon" — Le Figaro                        │  │
│  │ • "Lyon : le marché hôtelier en ébullition" — TendanceHôtellerie│
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. Estimation effort par phase et points de risque

### Phase 1 — Détection multi-signaux

| Tâche | Fichiers | Complexité |
|-------|----------|------------|
| Migration SQL (veille_signals, veille_google_snapshots) | `init.js` | Faible |
| `googleMapsSignalDetector.js` (3 sous-détecteurs) | Nouveau fichier | Moyenne-Haute — le delta reviews nécessite un batch weekly + snapshots |
| `bookingSignalDetector.js` | Nouveau fichier | Haute — choix Amadeus vs scraping, pas de solution prête |
| Sources institutionnelles (data.gouv, BOAMP, BODACC) | 3 nouveaux fichiers | Moyenne — APIs publiques mais parsing CSV/XML |
| LinkedIn jobs (via Brave) | Extension du Brave scraper existant | Faible |
| Refonte `veilleOpportunity.js` (scoring + signal_summary) | Existant modifié | Moyenne |
| Nouvelles routes API + crons | `veille.js`, `veilleScraper.js` | Moyenne |

**Risques Phase 1 :**
- **Google Places coût** : le batch de Place Details peut devenir cher si le nombre d'hôtels trackés croît. Mitigation : limiter à 50-100 hôtels actifs, cache 7j.
- **Booking scraping** : risque légal + détection bot. Mitigation : privilégier Amadeus Self-Service. Si insuffisant, scraping minimal avec cache long.
- **Data.gouv parsing** : les datasets permis de construire changent de format régulièrement. Mitigation : parser résilient + alertes si format change.

### Phase 2 — Pipeline contacts

| Tâche | Fichiers | Complexité |
|-------|----------|------------|
| Migration SQL (veille_contacts, veille_contact_attempts) | `init.js` | Faible |
| `contactPipeline.js` orchestrateur | Nouveau fichier | Haute — cascade d'APIs, gestion d'erreurs, Levenshtein |
| Intégration Pappers | Nouveau fichier | Moyenne |
| Pattern email + ZeroBounce | Nouveau fichier | Moyenne |
| Export HubSpot | Extension `hubspotService.js` | Moyenne |
| Routes API contacts | `veille.js` | Faible |

**Risques Phase 2 :**
- **Pappers quota gratuit** (100/jour) : peut bloquer si beaucoup d'opps à traiter. Mitigation : file d'attente + priorisation par score.
- **ZeroBounce coûts** : 1-6 patterns × N contacts. Mitigation : commencer par le pattern le plus probable, s'arrêter dès `valid`.
- **Qualité LinkedIn via Brave** : les résultats Brave sur LinkedIn sont limités. Mitigation : croiser avec Pappers (dirigeants légaux).

### Phase 3 — UI + boucle d'apprentissage

| Tâche | Fichiers | Complexité |
|-------|----------|------------|
| Migration SQL (veille_scoring_feedback) | `init.js` | Faible |
| Dashboard KPIs | `app.jsx` | Moyenne |
| Fiche opportunité enrichie (timeline, contacts, score décomposé) | `app.jsx` | Haute — beaucoup de UI |
| Onglet Signaux | `app.jsx` | Faible |
| Onglet Sources & Santé (refonte) | `app.jsx` | Faible (évolution existant) |
| Onglet Paramètres | `app.jsx` | Faible |
| `scoringCalibration.js` (job hebdo) | Nouveau fichier | Moyenne |
| `veilleAlerts.js` (alertes proactives) | Nouveau fichier | Faible-Moyenne |

**Risques Phase 3 :**
- **Taille de `app.jsx`** : le fichier est déjà très gros (~20K lignes). La refonte UI Veille va ajouter ~1000-1500 lignes. Mitigation : composants bien découpés en sous-fonctions.
- **Calibration scoring** : nécessite suffisamment de feedbacks won/lost pour être statistiquement significatif. En early stage, le rapport sera peu fiable. Mitigation : afficher un avertissement "N feedbacks insuffisants" et ne pas modifier les poids auto.

---

## Prochaine étape

Ce document constitue le livrable **Phase 0 — Audit & Plan**. Aucun code n'a été modifié.

En attente de validation pour passer à la **Phase 1 — Détection multi-signaux**.
