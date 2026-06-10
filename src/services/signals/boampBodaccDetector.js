/**
 * boampBodaccDetector.js — Détecteur de signaux BOAMP + BODACC
 *
 * BOAMP (Bulletin Officiel des Annonces de Marchés Publics) :
 * - Filtre code NAF 5510Z (hôtels), montant > 100k
 * - Signal : boamp_marche, strength 85
 *
 * BODACC (Bulletin Officiel des Annonces Civiles et Commerciales) :
 * - Changements de dirigeants + radiation/création SCI hôtelière
 * - Signal : bodacc_movement, strength 60
 *
 * Les deux utilisent l'API Brave Search pour trouver les annonces récentes
 * (l'accès direct aux APIs BOAMP/BODACC est plus fiable mais nécessite
 * un traitement XML lourd — on commence par Brave comme proxy).
 *
 * Fréquence : BOAMP 1x/jour, BODACC 1x/semaine
 * Coût : inclus dans le plan Brave
 */

const logger = require('../../config/logger');
const { insertSignal, getConfigValue } = require('./signalUtils');
const { trackBraveCall } = require('../../utils/apiClient');

// ─── BOAMP via Brave ─────────────────────────────────────────────────────────

const BOAMP_QUERIES = [
  'site:boamp.fr hôtel travaux rénovation',
  'site:boamp.fr hébergement hôtelier maîtrise oeuvre',
  'site:boamp.fr hotel 5510Z',
  '"marché public" hôtel rénovation travaux France site:boamp.fr OR site:marches-publics.gouv.fr',
];

const BODACC_QUERIES = [
  'site:bodacc.fr hôtel SCI cession',
  'site:bodacc.fr hébergement hôtelier changement gérant',
  '"société civile immobilière" hôtel création OR modification site:bodacc.fr',
  'site:societe.com hôtel "changement de dirigeant" OR "nouveau gérant"',
];

// ─── Brave Search helper ─────────────────────────────────────────────────────

async function searchBrave(apiKey, query, freshness = 'pw', db = null) {
  const params = new URLSearchParams({
    q: query,
    count: '15',
    search_lang: 'fr',
    country: 'fr',
    freshness,
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

    trackBraveCall(db, 'signal_boamp');
    const data = await res.json();
    return data.web?.results || [];
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      logger.warn(`BOAMP/BODACC Detector: timeout Brave`);
      return [];
    }
    throw err;
  }
}

// ─── Extraction ──────────────────────────────────────────────────────────────

const HOTEL_PATTERNS = [
  /(?:hôtel|hotel|palace|resort)\s+([A-ZÀ-Ü][a-zà-ü-]+(?:\s+[A-ZÀ-Ü&][a-zà-ü-]*)*)/gi,
  /([A-ZÀ-Ü][a-zà-ü-]+(?:\s+[A-ZÀ-Ü&][a-zà-ü-]*)*)\s+(?:hôtel|hotel|palace)/gi,
];

const CITY_PATTERNS = [
  /(?:à|a|commune\s+de)\s+([A-ZÀ-Ü][a-zà-ü-]+(?:[- ][A-ZÀ-Ü][a-zà-ü-]+)*)/gi,
];

// Montants (BOAMP)
const MONTANT_PATTERN = /(\d[\d\s.,]*)\s*(?:€|EUR|euros)/gi;

function extractInfo(title, description) {
  const text = `${title} ${description}`;

  let hotelName = null;
  for (const p of HOTEL_PATTERNS) {
    p.lastIndex = 0;
    const m = p.exec(text);
    if (m && m[1] && m[1].length > 2 && m[1].length < 60) {
      hotelName = m[1].trim();
      break;
    }
  }

  let city = null;
  for (const p of CITY_PATTERNS) {
    p.lastIndex = 0;
    const m = p.exec(text);
    if (m && m[1] && m[1].length > 2 && m[1].length < 40) {
      city = m[1].trim();
      break;
    }
  }

  let montant = null;
  MONTANT_PATTERN.lastIndex = 0;
  const mMontant = MONTANT_PATTERN.exec(text);
  if (mMontant) {
    montant = parseFloat(mMontant[1].replace(/[\s.]/g, '').replace(',', '.'));
  }

  return { hotelName, city, montant };
}

// ─── BOAMP batch ─────────────────────────────────────────────────────────────

async function runBoamp(db, apiKey) {
  let signalsFound = 0;
  const seenUrls = new Set();

  for (const query of BOAMP_QUERIES) {
    try {
      const results = await searchBrave(apiKey, query, 'pw', db); // Past week

      for (const r of results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);

        const { hotelName, city, montant } = extractInfo(r.title || '', r.description || '');

        // Filtre montant > 100k si détecté
        if (montant !== null && montant < 100000) continue;

        // Vérifier que c'est bien un marché hôtelier
        const text = `${r.title} ${r.description}`.toLowerCase();
        const isHotel = ['hôtel', 'hotel', '5510', 'hébergement hôtelier', 'palace'].some(k => text.includes(k));
        const isTravaux = ['travaux', 'rénovation', 'maîtrise', 'construction', 'aménagement'].some(k => text.includes(k));
        if (!isHotel || !isTravaux) continue;

        const id = insertSignal(db, {
          signal_type: 'boamp_marche',
          signal_strength: 85,
          source: 'boamp',
          source_url: r.url,
          hotel_name: hotelName,
          city,
          raw_payload: {
            title: r.title,
            description: (r.description || '').substring(0, 500),
            montant,
            query_used: query,
          },
          signal_date: r.page_age || null,
        });

        if (id) signalsFound++;
      }

      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      logger.warn(`BOAMP Detector: erreur: ${err.message}`);
    }
  }

  return signalsFound;
}

// ─── BODACC batch ────────────────────────────────────────────────────────────

async function runBodacc(db, apiKey) {
  let signalsFound = 0;
  const seenUrls = new Set();

  for (const query of BODACC_QUERIES) {
    try {
      const results = await searchBrave(apiKey, query, 'pm', db); // Past month

      for (const r of results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);

        const { hotelName, city } = extractInfo(r.title || '', r.description || '');

        // Vérifier le contexte hôtelier
        const text = `${r.title} ${r.description}`.toLowerCase();
        const isHotel = ['hôtel', 'hotel', 'sci', 'hébergement'].some(k => text.includes(k));
        const isMovement = ['cession', 'changement', 'gérant', 'dirigeant', 'création', 'radiation', 'modification'].some(k => text.includes(k));
        if (!isHotel || !isMovement) continue;

        const id = insertSignal(db, {
          signal_type: 'bodacc_movement',
          signal_strength: 60,
          source: 'bodacc',
          source_url: r.url,
          hotel_name: hotelName,
          city,
          raw_payload: {
            title: r.title,
            description: (r.description || '').substring(0, 500),
            query_used: query,
          },
          signal_date: r.page_age || null,
        });

        if (id) signalsFound++;
      }

      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      logger.warn(`BODACC Detector: erreur: ${err.message}`);
    }
  }

  return signalsFound;
}

// ─── Batch principal ─────────────────────────────────────────────────────────

async function runBatch(db, options = {}) {
  const apiKey = getConfigValue(db, 'brave_search_api_key', 'BRAVE_SEARCH_API_KEY', '');
  if (!apiKey) {
    logger.warn('BOAMP/BODACC Detector: clé API Brave non configurée');
    return { signals_found: 0, errors: ['Clé API Brave manquante'] };
  }

  const errors = [];
  let boampSignals = 0;
  let bodaccSignals = 0;

  try {
    boampSignals = await runBoamp(db, apiKey);
  } catch (err) {
    errors.push(`BOAMP: ${err.message}`);
  }

  try {
    bodaccSignals = await runBodacc(db, apiKey);
  } catch (err) {
    errors.push(`BODACC: ${err.message}`);
  }

  const total = boampSignals + bodaccSignals;
  logger.info(`BOAMP/BODACC Detector terminé: ${boampSignals} BOAMP + ${bodaccSignals} BODACC = ${total} signaux`);
  return { signals_found: total, boamp: boampSignals, bodacc: bodaccSignals, errors };
}

module.exports = {
  runBatch,
  runBoamp,
  runBodacc,
};
