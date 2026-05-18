# Module Veille — Guide utilisateur

## Vue d'ensemble

Le module Veille de TDM Sequencer identifie les **hotels en transition** (renovation, ouverture, repositionnement) avant les concurrents, trouve les **contacts decideurs** avec emails verifies, et permet l'**export CRM HubSpot** en un clic.

---

## Architecture

```
Sources (Brave, Google, Booking, data.gouv, LinkedIn, BOAMP, BODACC)
    |
    v
veille_signals — signaux individuels dates avec fingerprint dedup
    |
    v
veille_opportunities — agregation multi-signaux, scoring 0-100
    |
    v
veille_contacts — pipeline Pappers + LinkedIn + email pattern + ZeroBounce
    |
    v
Export HubSpot (Company + Contacts + Deal)
```

---

## Les 6 onglets

### 1. Dashboard

KPIs globaux :
- Nombre d'opportunites par categorie (A/B/C)
- Signaux detectes par type
- Stats pipeline contacts (total, emails valides, taux)
- Calibration scoring (si feedbacks suffisants)

### 2. Opportunites

Liste filtrable par signal, score, statut. Vue detail enrichie :
- **Identite hotel** : nom, ville, etoiles, site web
- **Timeline signaux** : frise chronologique des signaux dates
- **Contacts** : liste triee par score, email avec statut (valid/catch-all/invalid), bouton copier + lien LinkedIn
- **Angle commercial** : recommandation automatique basee sur le type de signal
- **Actions** : Export HubSpot, Feedback (Won/Lost/Pas pertinent/Mauvais contact)

### 3. Signaux

Liste brute de tous les signaux detectes. Filtrable par type et source. Utile pour debug et validation des detecteurs.

Types de signaux detectes :
| Signal | Source | Force typique |
|--------|--------|---------------|
| `google_review_drop` | Google Places | 60-80 |
| `google_review_keyword` | Google Places | 80-100 |
| `google_hours_change` | Google Places | 50-70 |
| `booking_unavailable_long` | Amadeus | 85 |
| `permis_construire` | data.gouv (Sit@del2) | 90 |
| `linkedin_preopening_job` | LinkedIn via Brave | 75 |
| `boamp_marche` | BOAMP via Brave | 85 |
| `bodacc_movement` | BODACC via Brave | 60 |
| `press_renovation` | Presse (Brave/RSS) | 70-90 |
| `press_ouverture` | Presse (Brave/RSS) | 70-90 |

### 4. Articles

Articles de veille presse, tries par priorite (A/B/C). Fonctionnalites : lu/non lu, favoris, archivage, recherche.

### 5. Sources & Sante

Monitoring des sources de donnees :
- Statut sante (healthy/degraded/failing)
- Nombre d'articles par source
- Historique des runs avec erreurs
- Ajout/modification/suppression de sources

### 6. Parametres

- **Cles API** : statut configure/non configure, boutons de test de connexion
- **Utilisation API** : barres de progression requetes/quota par service et mois
- **Seuils de scoring** : score minimum opportunites, score pipeline contacts, seuil alertes
- **Hotels exclus** : liste de noms a ignorer (concurrents deja clients)

---

## Scoring des opportunites

Le `business_score` (0-100) est calcule ainsi :

| Composante | Points max | Description |
|------------|-----------|-------------|
| Signal max strength | 25 | Force du signal individuel le plus fort |
| Convergence multi-sources | 25 | +5 pts par source distincte (cap 25) |
| Convergence multi-signaux | 20 | +10 si 3+ types, +20 si 5+ |
| Combo bonus | 15 | Combinaisons specifiques amplifiees |
| Fraicheur | 15 | Decroissance exponentielle sur 6 mois |
| Entite detectee | 10 | hotel_name +5, city +3, group +2 |
| Segment premium | 10 | Palace, 5 etoiles, luxe |

### Combos amplifies

- `review_drop` + `press_renovation` → +20
- `review_drop` + `booking_unavailable` → +25
- `permis_construire` + `press_renovation` → +15
- `linkedin_preopening_job` + `press_ouverture` → +20
- `booking_unavailable` + `google_hours_change` → +15

---

## Pipeline contacts

Pour chaque opportunite avec `business_score >= 50`, le pipeline s'execute en cascade :

1. **Pappers** — recherche SIREN par nom commercial + ville, recupere les dirigeants
2. **LinkedIn** — recherche Brave `site:linkedin.com/in` avec nom hotel + role
3. **Domaine email** — detecte via chaines connues, Google Places, ou Brave
4. **Patterns email** — genere 6 variantes (first.last, flast, first, etc.)
5. **ZeroBounce** — verification en cascade (stop au premier `valid`)
6. **Score contact** — combinaison role_relevance + email_status + LinkedIn

### Priorite des roles

| Role | Relevance |
|------|-----------|
| Directeur technique | 100 |
| Directeur des achats | 95 |
| Directeur F&B / Housekeeping | 90 |
| DG / General Manager | 85 |
| Spa Manager | 80 |
| Proprietaire / President SCI | 70 |

---

## Export HubSpot

Le bouton "Envoyer vers HubSpot" sur chaque opportunite :
1. Cree ou met a jour la **Company** HubSpot
2. Cree les **Contacts** avec email verifie et role
3. Cree un **Deal** avec le business score et l'angle commercial

---

## Boucle de feedback

Les boutons Won/Lost/Pas pertinent/Mauvais contact alimentent `veille_scoring_feedback`.

Un job hebdomadaire (`scoringCalibration.js`, dimanche 22h) :
- Calcule le taux de conversion par type de signal
- Genere des recommandations d'ajustement de ponderation
- **Ne modifie PAS les poids automatiquement** (humain dans la boucle)

Les recommandations sont visibles dans le Dashboard.

---

## Crons planifies

| Cron | Frequence | Description |
|------|-----------|-------------|
| Sources presse | Variable par source | Brave Search / RSS / HTML |
| Enrichissement articles | Toutes les 30 min | Extraction hotel/ville/signal |
| Google Maps detector | Lundi + Jeudi 6h | Delta reviews + keywords + hours |
| Data.gouv detector | Dimanche 3h | Permis de construire |
| BOAMP/BODACC detector | 1er et 15 du mois 4h | Marches publics + mouvements |
| LinkedIn jobs detector | Lundi + Jeudi 6h | Offres pre-ouverture |
| Pipeline contacts | Mercredi 10h | Batch sur top opportunites |
| Calibration scoring | Dimanche 22h | Rapport hebdomadaire |
| Alertes proactives | Toutes les heures (8h-20h) | Detection opportunites haute valeur |

---

## Configuration requise

### Cles API

| Service | Variable env / Config | Obligatoire |
|---------|----------------------|-------------|
| Brave Search | `BRAVE_SEARCH_API_KEY` / `brave_search_api_key` | Oui (coeur du systeme) |
| Google Places | `GOOGLE_PLACES_API_KEY` / `google_places_api_key` | Recommande |
| Pappers | `PAPPERS_API_KEY` / `pappers_api_key` | Pour pipeline contacts |
| ZeroBounce | `ZEROBOUNCE_API_KEY` / `zerobounce_api_key` | Pour verification email |
| Amadeus | `AMADEUS_CLIENT_ID` + `AMADEUS_CLIENT_SECRET` | Pour detection Booking |

Les cles se configurent dans **Parametres > Configuration** ou via variables d'environnement.
