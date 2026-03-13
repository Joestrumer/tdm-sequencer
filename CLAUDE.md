# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sales email sequencer for Terre de Mars — automates multi-step email campaigns for hotel leads. Node.js/Express backend with SQLite database, Brevo email service integration, and optional HubSpot CRM sync.

## Development Commands

```bash
# Start the server (port 3001 by default)
npm start

# Initialize/rebuild database schema
npm run build
# or directly:
node src/db/init.js

# Seed database with sample data
node src/db/seed.js
```

## Architecture

### Database Schema (SQLite with WAL mode)

Core tables:
- **leads** - Contact records with email, hotel, segment, hubspot_id, unsubscribed status
- **sequences** - Email campaign templates with segment targeting
- **etapes** - Individual email steps (ordre, jour_delai, sujet, corps, corps_html, piece_jointe)
- **inscriptions** - Lead enrollments in sequences (tracks etape_courante, prochain_envoi, statut)
- **emails** - Sent email records with tracking_id, brevo_message_id, ouvertures, clics
- **events** - Activity log (envoi, ouverture, clic, desabonnement)
- **envoi_quota** - Daily email sending limits
- **hubspot_logs** - HubSpot sync audit trail
- **config** - Key-value configuration store

### Core Services

**brevoService.js** (`src/services/`):
- Sends emails via Brevo API (tries SMTP first if BREVO_SMTP_KEY set, falls back to REST API)
- Injects tracking pixel for opens: `/api/tracking/open/:trackingId`
- Wraps all links with click tracking: `/api/tracking/click/:trackingId?url=...`
- Adds RGPD-compliant unsubscribe link
- Variable substitution: `{{prenom}}`, `{{nom}}`, `{{hotel}}`, `{{ville}}`, `{{segment}}`
- Cleans HTML from Froala editor (removes fr-original-style, data-fr-* attributes)
- Applies Hugo Montiel signature automatically
- Retry logic with exponential backoff (3 attempts)
- Daily quota enforcement via `envoi_quota` table

**hubspotService.js** (`src/services/`):
- Syncs leads to HubSpot contacts
- Associates contacts with companies
- Logs email activity to timeline
- Updates lifecycle stages
- Creates tasks when sequences complete

**sequenceScheduler.js** (`src/jobs/`):
- Cron job runs every 15 minutes via node-cron
- Checks for `inscriptions` with `prochain_envoi <= now()` and `statut='actif'`
- Respects sending window (env: SEND_HOUR_START, SEND_HOUR_END, ACTIVE_DAYS)
- Sends emails with natural randomization (1500-2500ms delays between sends)
- Advances inscription to next etape or marks 'terminé' when sequence completes
- `inscrireLead(leadId, sequenceId)` - Enrolls a lead and schedules first email
- `traiterInscriptionDirect(inscription)` - Bypasses time window for trigger-now endpoint

### Email Sending Flow

1. Scheduler identifies due inscriptions
2. Fetches lead + current etape
3. Checks lead not unsubscribed
4. Verifies daily quota not exceeded
5. Substitutes variables in sujet/corps
6. Generates unique trackingId
7. Builds HTML with tracking pixel + linked signature
8. Sends via brevoService (SMTP or API)
9. Records email in `emails` table with brevo_message_id
10. Increments quota counter
11. Calculates next send date (respects ACTIVE_DAYS + randomized hour)
12. Updates inscription with new etape_courante and prochain_envoi

### Routing Structure

All routes under `/api` require auth (via `src/middleware/auth.js`) except:
- `/api/health` - Service health check
- `/api/tracking/*` - Open/click/unsubscribe tracking (must be public for email clients)

Key endpoints:
- **POST /api/sequences/:id/inscrire** - Enroll single lead
- **POST /api/sequences/:id/inscrire-batch** - Bulk enrollment
- **POST /api/sequences/trigger-now** - Force send now (bypasses sending window)
- **GET /api/sequences/:id/inscriptions** - View enrolled leads
- **DELETE /api/sequences/inscriptions/:id** - Remove lead from sequence
- **POST /api/leads/import** - Bulk CSV import
- **GET /api/stats** - Campaign analytics
- **POST /api/hubspot/sync-companies** - Sync HubSpot companies to local DB

### Environment Variables

Required:
- `BREVO_API_KEY` - Brevo API key for email sending (REST API fallback)
- `BREVO_SMTP_KEY` - Brevo SMTP password (preferred method, tries first)
- `BREVO_SMTP_USER` - Brevo SMTP username (default: hugo@terredemars.com)

Optional:
- `HUBSPOT_API_KEY` - Enable HubSpot integration
- `ZEROBOUNCE_API_KEY` - Enable email validation
- `SEND_HOUR_START=8` - Start of sending window (default: 8am)
- `SEND_HOUR_END=18` - End of sending window (default: 6pm)
- `ACTIVE_DAYS=1,2,3,4,5` - Days to send (0=Sun, 1=Mon... 6=Sat)
- `MAX_EMAILS_PER_DAY=50` - Daily sending limit
- `PUBLIC_URL=http://localhost:3001` - Base URL for tracking links
- `DB_PATH=./data/sequencer.db` - SQLite database path
- `BREVO_SMTP_PORT=587` - SMTP port (tries 587, 465, 2525)
- `NODE_ENV=development` - In dev mode, first email sends after 1 minute

## Key Implementation Details

### Date Handling
- All dates stored as ISO strings via `datetime('now')` in SQLite
- `prochaineDateEnvoi(joursDelai)` calculates next send time:
  - Adds joursDelai to current date
  - Skips to next active weekday if needed
  - Sets time to SEND_HOUR_START + random(0-120 minutes)

### Tracking System
- Each email gets unique UUID `tracking_id`
- Pixel: `<img src="/api/tracking/open/:trackingId" width="1" height="1" />`
- Links: All `href="https://..."` replaced with `/api/tracking/click/:trackingId?url=...`
- Opens/clicks increment `emails.ouvertures` and `emails.clics`
- Events logged to `events` table with type='ouverture' or 'clic'

### HTML Email Construction
- `texteVersHtml(texte, trackingId, lead, estHtml, options)` in brevoService.js
- If `etape.corps_html` exists: cleans editor artifacts, injects tracking
- Otherwise: escapes text, converts newlines to `<br>`, linkifies URLs
- Always appends signature (SIGNATURE_HUGO constant)
- Adds unsubscribe footer unless `options.desabonnement === false`

### Quota Management
- `verifierQuotaJournalier(db)` throws if count >= MAX_EMAILS_PER_DAY
- `incrementerQuota(db, today)` uses `ON CONFLICT DO UPDATE SET count = count + 1`
- Scheduler stops processing batch when quota error thrown

### Migrations
- Schema created in `src/db/init.js` with `CREATE TABLE IF NOT EXISTS`
- Column additions handled via try/catch array of `ALTER TABLE` statements
- Foreign keys enabled via `pragma('foreign_keys = ON')`
- WAL mode for concurrent reads: `pragma('journal_mode = WAL')`

## Testing & Debugging

**Check service health:**
```bash
curl http://localhost:3001/api/health
```

**Test Brevo connectivity:**
```bash
curl http://localhost:3001/api/test-brevo
```
Returns diagnostics for both REST API and SMTP (tries ports 587, 465, 2525).

**Force send queued emails immediately:**
```bash
curl -X POST http://localhost:3001/api/sequences/trigger-now \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**View scheduler logs:**
Uses winston logger (`src/config/logger.js`). Key log patterns:
- `🔄 Vérification des séquences...` - Scheduler run started
- `📬 N email(s) à traiter` - Emails pending
- `✉️ Email envoyé via Brevo` - Successful send
- `❌ Erreur envoi email` - Send failure

## Deployment

**Docker:**
```bash
docker build -t tdm-sequencer .
docker run -p 3001:3001 --env-file .env tdm-sequencer
```

**Railway:**
- Configured via `railway.toml`
- Database persists in `/app/data` volume
- Dockerfile installs build dependencies for better-sqlite3 compilation

## Common Patterns

**Creating a sequence:**
```javascript
POST /api/sequences
{
  "nom": "Sequence Name",
  "segment": "5*",
  "options": { "desabonnement": true },
  "etapes": [
    { "ordre": 1, "jour_delai": 0, "sujet": "...", "corps": "..." },
    { "ordre": 2, "jour_delai": 3, "sujet": "...", "corps_html": "<p>...</p>" }
  ]
}
```

**Enrolling leads:**
```javascript
POST /api/sequences/:sequenceId/inscrire
{ "lead_id": "..." }

// Batch:
POST /api/sequences/:sequenceId/inscrire-batch
{ "lead_ids": ["id1", "id2", ...] }
```

**Variable substitution in email templates:**
Use `{{prenom}}`, `{{nom}}`, `{{hotel}}`, `{{ville}}`, `{{segment}}` in sujet or corps.

**Unsubscribe a lead:**
When user clicks unsubscribe link, `PATCH /api/tracking/unsubscribe/:leadId` sets:
- `leads.unsubscribed = 1`
- `leads.statut = 'Désabonné'`
- All active inscriptions set to `statut='terminé'`
