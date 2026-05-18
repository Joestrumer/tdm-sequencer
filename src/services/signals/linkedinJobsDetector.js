/**
 * linkedinJobsDetector.js — Détecteur de signaux LinkedIn pré-ouverture
 *
 * Recherche via Brave Search (pas de scraping LinkedIn direct) :
 * - site:linkedin.com/jobs "hôtel" "pré-ouverture" OR "pre-opening"
 * - Pages carrières des grands groupes hôteliers
 *
 * Signal : linkedin_preopening_job, strength 75
 *
 * Dépendances : API Brave Search (existante)
 * Coût : inclus dans le plan Brave
 * Fréquence : 2x/semaine
 */

const logger = require('../../config/logger');
const { insertSignal, getConfigValue } = require('./signalUtils');

// ─── Queries de recherche ────────────────────────────────────────────────────

const PREOPENING_QUERIES = [
  // LinkedIn Jobs
  'site:linkedin.com/jobs "hôtel" ("pré-ouverture" OR "pre-opening" OR "ouverture prochaine") France',
  'site:linkedin.com/jobs hotel ("pre-opening" OR "opening soon" OR "nouvelle ouverture") France',
  // Pages carrières groupes
  '"pré-ouverture" hôtel recrutement France -site:linkedin.com',
  '"pre-opening" hotel recruitment France -site:linkedin.com',
  // Recherche large ouverture/réouverture
  '"hôtel" ("recrute" OR "recrutement") ("ouverture" OR "réouverture") France 2025 OR 2026',
];

// Patterns pour extraire le nom d'hôtel et la ville depuis le titre/résumé
const HOTEL_EXTRACT = [
  /(?:hôtel|hotel|palace|resort)\s+([A-ZÀ-Ü][a-zà-ü-]+(?:\s+[A-ZÀ-Ü&][a-zà-ü-]*)*)/gi,
  /([A-ZÀ-Ü][a-zà-ü-]+(?:\s+[A-ZÀ-Ü&][a-zà-ü-]*)*)\s+(?:hôtel|hotel|palace|resort)/gi,
];

const CITY_PATTERNS = [
  /(?:à|a|in|near)\s+([A-ZÀ-Ü][a-zà-ü-]+(?:[- ][A-ZÀ-Ü][a-zà-ü-]+)*)/g,
  /([A-ZÀ-Ü][a-zà-ü-]+(?:[- ][A-ZÀ-Ü][a-zà-ü-]+)*)\s*(?:\(\d{2}\)|\d{5})/g,
];

// ─── Brave Search ────────────────────────────────────────────────────────────

async function searchBrave(apiKey, query) {
  const params = new URLSearchParams({
    q: query,
    count: '20',
    search_lang: 'fr',
    country: 'fr',
    freshness: 'pm', // Dernier mois
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Brave API ${res.status}: ${body.substring(0, 200)}`);
    }

    const data = await res.json();
    return data.web?.results || [];
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      logger.warn(`LinkedIn Detector: timeout Brave pour: ${query}`);
      return [];
    }
    throw err;
  }
}

// ─── Extraction d'info depuis les résultats ──────────────────────────────────

function extractHotelInfo(title, description) {
  const text = `${title} ${description}`;

  let hotelName = null;
  for (const pattern of HOTEL_EXTRACT) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match[1] && match[1].length > 2 && match[1].length < 60) {
      hotelName = match[1].trim();
      break;
    }
  }

  let city = null;
  for (const pattern of CITY_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match[1] && match[1].length > 2 && match[1].length < 40) {
      city = match[1].trim();
      break;
    }
  }

  return { hotelName, city };
}

// Patterns qui confirment un contexte pré-ouverture
const PREOPENING_CONFIRM = [
  /pr[ée]-?ouverture/i,
  /pre-?opening/i,
  /ouverture\s+(prochaine|imminente|pr[ée]vue)/i,
  /opening\s+soon/i,
  /nouvelle?\s+ouverture/i,
  /r[ée]ouverture/i,
  /rejoignez.*[ée]quipe.*ouverture/i,
];

function isPreopening(title, description) {
  const text = `${title} ${description}`;
  return PREOPENING_CONFIRM.some(p => p.test(text));
}

// ─── Batch principal ─────────────────────────────────────────────────────────

async function runBatch(db, options = {}) {
  const apiKey = getConfigValue(db, 'brave_search_api_key', 'BRAVE_SEARCH_API_KEY', '');
  if (!apiKey) {
    logger.warn('LinkedIn Detector: clé API Brave non configurée');
    return { signals_found: 0, errors: ['Clé API Brave manquante'] };
  }

  let signalsFound = 0;
  const errors = [];
  const seenUrls = new Set();

  for (const query of PREOPENING_QUERIES) {
    try {
      const results = await searchBrave(apiKey, query);

      for (const r of results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);

        const title = r.title || '';
        const desc = r.description || '';

        // Vérifier que c'est bien un contexte pré-ouverture
        if (!isPreopening(title, desc)) continue;

        const { hotelName, city } = extractHotelInfo(title, desc);

        const id = insertSignal(db, {
          signal_type: 'linkedin_preopening_job',
          signal_strength: 75,
          source: 'linkedin',
          source_url: r.url,
          hotel_name: hotelName,
          city,
          raw_payload: {
            title,
            description: desc.substring(0, 500),
            url: r.url,
            query_used: query,
          },
          signal_date: r.page_age || null,
        });

        if (id) signalsFound++;
      }

      // Rate limiting Brave
      await new Promise(r => setTimeout(r, 1200));

    } catch (err) {
      logger.warn(`LinkedIn Detector: erreur requête Brave: ${err.message}`);
      errors.push(err.message);
    }
  }

  logger.info(`LinkedIn Detector terminé: ${signalsFound} signaux pré-ouverture`);
  return { signals_found: signalsFound, results_scanned: seenUrls.size, errors };
}

module.exports = {
  runBatch,
};
