# AUDIT — Veille & Prospection

**Date** : 2026-05-13
**Périmètre** : Veille web hôtelière + Prospection hôtels France (LinkedIn + email finder)

---

## 1. État fonctionnel par composant

### 1.1 Veille web hôtelière

| Composant | Fichier(s) | État | Remarques |
|---|---|---|---|
| Scraping Brave Search | `veilleService.js:271-315` | ✅ Fonctionnel | 3 modes : site, wide, RSS. Freshness par catégorie (pd/pw/pm). Quota limité à 4-5 requêtes/source. |
| Scraping HTML (cheerio) | `veilleService.js:319-401` | ✅ Fonctionnel | Sélecteurs CSS configurables avec fallback intelligent. Timeout 15s. |
| Scraping RSS | `veilleService.js:406-443` | ✅ Fonctionnel | Parse XML via cheerio en mode xmlMode. Nettoyage HTML dans descriptions. |
| Scoring mots-clés (A/B/C) | `veilleService.js:79-152` | ✅ Fonctionnel | 3 niveaux de priorité, bonus géo France + segments premium. Seuil >= 3 dans le scheduler. |
| Scheduler crons par source | `veilleScraper.js:203-249` | ✅ Fonctionnel | Replanification auto après CRUD source. Lock par source_id (pas de double exécution). |
| Observabilité (runs, santé) | `veilleScraper.js:28-92` | ✅ Fonctionnel | Chaque run historisé dans `veille_source_runs`. Santé calculée sur 5 derniers runs (healthy/degraded/failing). |
| Enrichissement NER | `veilleEnrichment.js:269-437` | ⚠️ Partiel | Extraction déterministe (regex/lookup) sans LLM. Hôtel, ville, groupe, signal OK. Pas de résumé auto ni de validation croisée. |
| Pipeline opportunités | `veilleOpportunity.js:209-439` | ✅ Fonctionnel | Fingerprint `hotel_name|city|semester`. Fusion multi-signaux. Score business 0-100 avec 8 composantes. |
| Google Places fermetures | `googlePlacesService.js:157-248` | ⚠️ Limité | Voir section 2.1 ci-dessous. |
| API Routes veille | `veille.js` (887 lignes) | ✅ Fonctionnel | 20+ endpoints : articles (CRUD, stats), sources (CRUD, health, runs), opportunités (CRUD, dashboard, alerts, digest), scan fermetures. |

### 1.2 Prospection hôtels France

| Composant | Fichier(s) | État | Remarques |
|---|---|---|---|
| Import CSV AtoutFrance | `prospection.js:85-270` | ✅ Fonctionnel | Détection encodage (chardet), séparateur auto (`;`/`,`), normalisation retours de ligne. INSERT OR IGNORE sur `hotels_france`. |
| Scraping site web (email) | `hotelScraperService.js` (non audité) | ✅ Présumé fonctionnel | Appelé via `scrapeBatchAsync`. Extrait `contact_email` des sites hôteliers. |
| Recherche contacts LinkedIn | `linkedinScraperService.js` (1438 lignes) | ⚠️ Fragile | 4 sources : Google CSE, Brave Search, scraping Google direct, Pappers. Voir section 2.2. |
| Email finder cascade | `emailFinderService.js` (265 lignes) | ⚠️ Non vérifié en prod | Cascade : Lusha → Lemlist → ZeroBounce patterns. Lusha essaie 3 endpoints (API instable). Lemlist async avec polling 1s. |
| ZeroBounce pattern validation | `linkedinScraperService.js` (fonction `trouverEmailAvecZeroBounce`) | ✅ Fonctionnel | 6 patterns testés (prenom.nom@, p.nom@, prenom@, etc.). Quality score > 8 = high. |
| Conversion hôtels → leads | `prospection.js:507-615` | ✅ Fonctionnel | Mapping classement → segment. Email personnel vs générique. Transaction protégée. |
| Conversion contacts LinkedIn → leads | `prospection.js:1308-1398` | ✅ Fonctionnel | Inscription optionnelle en séquence. INSERT OR IGNORE. |
| Emails génériques (vue, clean, exclude) | `prospection.js:682-878` | ✅ Fonctionnel | Auto-clean détecte extensions image, TLD invalides, gibberish. Exclusion batch. |
| Email registry | `prospection.js:51-82` | ✅ Fonctionnel | Centralise les emails trouvés avec source/type. Upsert sur doublons. |
| API Routes prospection | `prospection.js` (1419 lignes) | ✅ Fonctionnel | 15+ endpoints : import, hotels, scrape, contacts, find-emails, create-leads, etc. |

---

## 2. Top 5 bugs / lacunes critiques

### 2.1 ❌ Google Places `CLOSED_TEMPORARILY` — fiabilité douteuse

**Fichier** : `googlePlacesService.js:185`

**Problème** : Le statut `CLOSED_TEMPORARILY` de Google Places est peu fiable pour détecter des hôtels en rénovation :
- Google ne distingue pas "fermé pour travaux" de "fermé saisonnier", "fermé définitivement non encore mis à jour", ou "propriétaire a cliqué le mauvais bouton"
- Les hôtels fermés ne remontent pas dans les résultats Text Search triés par popularité (le service ajoute des requêtes ciblées `hôtel fermé`, `hotel closed` mais ces termes ne matchent pas le businessStatus Google)
- Aucune validation croisée avec les articles de veille ou d'autres signaux
- Le scan par zone (Paris = 20 arrondissements × 5 requêtes = 100 appels API) consomme beaucoup de quota Google

**Impact** : Faux positifs probables. Un hôtel "fermé temporairement" n'est pas nécessairement en rénovation.

**Recommandation** : Croiser systématiquement les résultats Google Places avec les signaux de veille Brave avant de créer une opportunité. Ajouter un champ `verified = false` par défaut pour les opportunités Google Places.

---

### 2.2 ⚠️ LinkedIn contact search — dépendance fragile sur le scraping Google

**Fichier** : `linkedinScraperService.js`

**Problème** : Les 4 sources de contacts ont chacune des faiblesses :
1. **Google CSE** (`rechercherContactsGoogleCSE`) : Meilleure source, mais limitée à 100 requêtes/jour gratuites. Le setup (Programmable Search Engine + API key) est un pré-requis manuel.
2. **Brave Search** : Résultats LinkedIn souvent pauvres (Brave indexe mal les profils LinkedIn).
3. **Scraping Google direct** : Parsing HTML de google.com — extrêmement fragile car Google change régulièrement son HTML. Risque de blocage par CAPTCHA/rate limiting sans proxy.
4. **Pappers** : Source fiable (API officielle registre du commerce) mais ne donne que les dirigeants légaux, pas les managers opérationnels.

**Impact** : La recherche LinkedIn peut retourner 0 résultat si Google CSE n'est pas configuré et si Brave ne trouve rien.

**Recommandation** :
- Ajouter un indicateur dans l'UI pour indiquer quelle source a trouvé chaque contact
- Prioriser Google CSE et avertir l'utilisateur quand le quota quotidien est atteint
- Considérer l'ajout d'une source type RapidAPI/Proxycurl pour les profils LinkedIn

---

### 2.3 ⚠️ Aucun lien veille_opportunities ↔ hotels_france / leads

**Fichiers** : `veilleOpportunity.js`, `prospection.js`

**Problème** : Les deux systèmes sont complètement cloisonnés :
- `veille_opportunities` n'a aucune FK vers `hotels_france` ni `leads`
- Un hôtel détecté par la veille (ex: "Hôtel Le Negresco — rénovation") n'est pas automatiquement rapproché d'un lead existant dans la base
- Le parcours est 100% manuel : l'utilisateur voit une opportunité A dans la veille, puis va chercher manuellement le même hôtel dans les leads

**Impact** : Perte d'opportunités commerciales par manque de rapprochement automatique. Le score business de l'opportunité n'enrichit pas le lead correspondant.

**Recommandation** : Ajouter un matching automatique `veille_opportunities.hotel_name_normalized` ↔ `leads.hotel` (fuzzy matching tolérant) pour :
- Signaler dans la vue leads les hôtels qui ont une opportunité active
- Auto-créer un lead depuis une opportunité qualifiée si aucun lead n'existe

---

### 2.4 ⚠️ Enrichissement limité à des heuristiques sans validation

**Fichier** : `veilleEnrichment.js:269-292`

**Problème** : L'extraction d'entités repose uniquement sur des regex et des lookups statiques :
- **hotel_name** : Les patterns regex (`HOTEL_PATTERNS`) échouent sur des noms atypiques (ex: "Le 25", "OKKO Hotels", noms sans "Hôtel/Palace/Château")
- **city** : Le lookup `VILLES_FRANCE` contient ~150 villes — toutes les villes de plus petite taille sont invisibles (ex: "Amboise" est dans Google Places mais pas dans `VILLES_NORM`)
- **group_name** : La liste `GROUPES_HOTELIERS` est figée (40 groupes). Les nouveaux groupes ou les marques moins connues ne seront pas détectés
- L'enrichissement ne stocke pas le `signal_subtype` (le champ existe dans l'extraction `detectSignalType` mais n'est pas écrit en DB dans `enrichArticle` à la ligne 422-431)

**Impact** : Le taux d'extraction hotel_name est probablement < 50%. Les opportunités sans hotel_name ont un score de confiance faible et sont difficiles à exploiter.

**Recommandation** :
- Ajouter `signal_subtype` à la requête UPDATE de `enrichArticle`
- Compléter la liste de villes (utiliser la base communes INSEE ou un fallback regex sur code postal)
- Envisager un appel LLM léger (Haiku) pour les cas où les regex échouent

---

### 2.5 ⚠️ Email finder — Lusha API endpoints devinés

**Fichier** : `emailFinderService.js:57-70`

**Problème** : La fonction `trouverEmailLusha` essaie 3 endpoints différents en séquence :
```
https://api.lusha.com/person
https://api.lusha.com/company/person
https://api.lusha.com/v1/person
```
Le commentaire dit "Lusha change souvent". Ce n'est pas documenté officiellement — les endpoints sont devinés. Chaque appel qui échoue consomme du temps et génère des logs d'erreur.

De plus, le service Lemlist Enrich utilise un polling naïf (attente fixe de 1s après le POST) — si l'enrichissement prend plus longtemps, l'email est perdu.

**Impact** : Lusha peut retourner des faux négatifs si les endpoints ont encore changé. Le taux de succès email est probablement bas (Lusha instable + Lemlist timing).

**Recommandation** :
- Vérifier les endpoints Lusha actuels dans la documentation officielle
- Augmenter le polling Lemlist (3 tentatives à 1s, 2s, 4s)
- Ajouter des compteurs de succès/échec par source dans les logs pour mesurer l'efficacité réelle

---

## 3. Fichiers concernés (lecture seule — aucune modification)

| Fichier | Lignes | Rôle |
|---|---|---|
| `src/services/veilleService.js` | 493 | Scraping (Brave, HTML, RSS), scoring mots-clés |
| `src/services/veilleEnrichment.js` | 487 | NER heuristique, fetch contenu, content hash |
| `src/services/veilleOpportunity.js` | 451 | Fingerprint, scoring business/confiance, upsert |
| `src/services/googlePlacesService.js` | 353 | Scanner fermetures Google Places |
| `src/services/linkedinScraperService.js` | 1438 | Recherche contacts LinkedIn (4 sources) |
| `src/services/emailFinderService.js` | 265 | Cascade Lusha → Lemlist → ZeroBounce |
| `src/jobs/veilleScraper.js` | 308 | Cron scheduling, runs, enrichment pipeline |
| `src/routes/veille.js` | 887 | API endpoints veille (articles, sources, opportunités, scans, digest) |
| `src/routes/prospection.js` | 1419 | API endpoints prospection (import, scrape, contacts, leads) |

---

## 4. Dépendances installées

| Package | Version | Utilisé par | Statut |
|---|---|---|---|
| `cheerio` | ^1.2.0 | veilleService, veilleEnrichment, linkedinScraperService | ✅ Installé |
| `node-cron` | ^3.0.3 | veilleScraper | ✅ Installé |
| `chardet` | ^2.1.1 | prospection.js (import CSV) | ✅ Installé |
| `csv-parser` | ^3.2.0 | prospection.js (import CSV) | ✅ Installé |
| `multer` | ^2.1.1 | prospection.js (upload CSV) | ✅ Installé |
| `uuid` | ^9.0.1 | prospection.js (lead IDs) | ✅ Installé |
| `winston` | ^3.11.0 | Logger partagé | ✅ Installé |

**Note** : Aucune dépendance manquante détectée. Les services Brave Search, Google Places, Lusha, Lemlist, ZeroBounce, Pappers et Google CSE utilisent tous `fetch` natif (Node 18+).

---

## 5. Résumé des risques par ordre de priorité

| # | Risque | Sévérité | Effort fix |
|---|---|---|---|
| 1 | Pas de lien veille → leads/hotels_france | Haute | Moyen |
| 2 | Google Places CLOSED_TEMPORARILY non fiable | Moyenne | Faible |
| 3 | Enrichissement NER < 50% taux extraction | Moyenne | Moyen |
| 4 | LinkedIn search dépend de Google CSE (100 req/jour) | Moyenne | Élevé |
| 5 | Lusha endpoints instables / Lemlist polling naïf | Basse | Faible |
| 6 | `signal_subtype` non persisté en DB (enrichArticle) | Basse | Trivial |
