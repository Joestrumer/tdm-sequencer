/**
 * bookingSignalDetector.js — Détecteur de signaux Booking/disponibilité
 *
 * Stratégie : utilise l'API Amadeus Hotel Search (gratuit 10K req/mois)
 * pour vérifier la disponibilité des hôtels sur 3 fenêtres (J+30, J+90, J+150).
 *
 * Si un hôtel est indisponible sur les 3 fenêtres → signal booking_unavailable_long (85)
 * Si l'hôtel n'apparaît plus dans les résultats → signal booking_delisted (75)
 *
 * Alternative : scraping Booking respectueux (documenté mais non implémenté par défaut).
 *
 * Dépendances : Amadeus Self-Service API (inscription gratuite)
 * Coût : gratuit jusqu'à 10K req/mois
 * Fréquence : 2x/mois
 */

const logger = require('../../config/logger');
const { insertSignal, getConfigValue } = require('./signalUtils');

// ─── Amadeus Auth ────────────────────────────────────────────────────────────

let amadeusToken = null;
let tokenExpiry = 0;

async function getAmadeusToken(db) {
  if (amadeusToken && Date.now() < tokenExpiry) return amadeusToken;

  const clientId = getConfigValue(db, 'amadeus_client_id', 'AMADEUS_CLIENT_ID', '');
  const clientSecret = getConfigValue(db, 'amadeus_client_secret', 'AMADEUS_CLIENT_SECRET', '');

  if (!clientId || !clientSecret) {
    throw new Error('Amadeus API non configurée (amadeus_client_id / amadeus_client_secret)');
  }

  const res = await fetch('https://api.amadeus.com/v1/security/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Amadeus auth ${res.status}: ${body.substring(0, 200)}`);
  }

  const data = await res.json();
  amadeusToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // Marge 60s
  return amadeusToken;
}

// ─── Hotel Search ────────────────────────────────────────────────────────────

/**
 * Recherche d'hôtel par ville (IATA city code) et vérification de disponibilité.
 * Utilise l'endpoint Hotel List + Hotel Offers.
 */
async function checkHotelAvailability(db, { hotelName, cityCode, checkIn, checkOut }) {
  const token = await getAmadeusToken(db);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    // Recherche de l'hôtel par nom dans la ville
    const searchParams = new URLSearchParams({
      keyword: hotelName,
      subType: 'HOTEL_LEISURE,HOTEL_GDS',
      countryCode: 'FR',
      max: '5',
    });

    const searchRes = await fetch(`https://api.amadeus.com/v1/reference-data/locations/hotels/by-keyword?${searchParams}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (!searchRes.ok) {
      if (searchRes.status === 429) {
        logger.warn('Amadeus: rate limit atteint');
        return { status: 'rate_limited' };
      }
      return { status: 'not_found' };
    }

    const searchData = await searchRes.json();
    const hotels = searchData.data || [];

    if (hotels.length === 0) return { status: 'not_found' };

    // Prendre le premier résultat (le plus pertinent)
    const hotelId = hotels[0].hotelId;

    // Vérifier la disponibilité
    const offerParams = new URLSearchParams({
      hotelIds: hotelId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      adults: '2',
      roomQuantity: '1',
    });

    const offerRes = await fetch(`https://api.amadeus.com/v3/shopping/hotel-offers?${offerParams}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (!offerRes.ok) {
      if (offerRes.status === 429) return { status: 'rate_limited' };
      // 400 = pas de disponibilité
      return { status: 'unavailable', hotelId, hotelName: hotels[0].name };
    }

    const offerData = await offerRes.json();
    const offers = offerData.data || [];

    if (offers.length === 0 || !offers[0].offers || offers[0].offers.length === 0) {
      return { status: 'unavailable', hotelId, hotelName: hotels[0].name };
    }

    return { status: 'available', hotelId, hotelName: hotels[0].name, offers: offers[0].offers.length };

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') return { status: 'timeout' };
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Formatage dates ─────────────────────────────────────────────────────────

function formatDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

// ─── Détection batch ─────────────────────────────────────────────────────────

/**
 * Vérifie la disponibilité d'un hôtel sur 3 fenêtres (J+30, J+90, J+150).
 * Si indisponible sur les 3 → signal booking_unavailable_long.
 */
async function checkHotel(db, { hotelName, city, cityCode }) {
  const windows = [
    { checkIn: formatDate(30), checkOut: formatDate(32) },
    { checkIn: formatDate(90), checkOut: formatDate(92) },
    { checkIn: formatDate(150), checkOut: formatDate(152) },
  ];

  let unavailableCount = 0;
  let notFoundCount = 0;
  const results = [];

  for (const window of windows) {
    try {
      const result = await checkHotelAvailability(db, {
        hotelName,
        cityCode,
        checkIn: window.checkIn,
        checkOut: window.checkOut,
      });
      results.push(result);

      if (result.status === 'unavailable') unavailableCount++;
      if (result.status === 'not_found') notFoundCount++;
      if (result.status === 'rate_limited') {
        logger.warn('Amadeus rate limit — arrêt du batch');
        return null;
      }

      // Politesse
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      logger.warn(`Amadeus erreur ${hotelName}: ${err.message}`);
      results.push({ status: 'error', error: err.message });
    }
  }

  // Indisponible sur les 3 fenêtres
  if (unavailableCount === 3) {
    return {
      signal_type: 'booking_unavailable_long',
      signal_strength: 85,
      source: 'amadeus',
      hotel_name: hotelName,
      city,
      raw_payload: {
        windows: windows.map((w, i) => ({ ...w, result: results[i]?.status })),
        amadeus_hotel_id: results[0]?.hotelId,
      },
    };
  }

  // Hôtel non trouvé du tout dans Amadeus
  if (notFoundCount === 3) {
    return {
      signal_type: 'booking_delisted',
      signal_strength: 60, // Plus faible que le plan initial — peut être juste absent d'Amadeus
      source: 'amadeus',
      hotel_name: hotelName,
      city,
      raw_payload: { reason: 'not_found_in_amadeus', windows },
    };
  }

  return null;
}

// ─── Batch principal ─────────────────────────────────────────────────────────

/**
 * Lance la vérification de disponibilité sur les opportunités actives.
 * Cible les hôtels avec un business_score >= 30 (pré-qualifiés).
 *
 * Mapping ville → code IATA nécessaire (table ou lookup).
 */
const CITY_IATA = {
  'paris': 'PAR', 'lyon': 'LYS', 'marseille': 'MRS', 'nice': 'NCE',
  'bordeaux': 'BOD', 'toulouse': 'TLS', 'nantes': 'NTE', 'strasbourg': 'SXB',
  'montpellier': 'MPL', 'lille': 'LIL', 'rennes': 'RNS', 'grenoble': 'GNB',
  'annecy': 'NCY', 'cannes': 'NCE', 'biarritz': 'BIQ', 'ajaccio': 'AJA',
  'bastia': 'BIA', 'deauville': 'DOL', 'chamonix': 'GVA', 'avignon': 'AVN',
  'aix-en-provence': 'MRS', 'la rochelle': 'LRH', 'perpignan': 'PGF',
  'saint-tropez': 'NCE', 'megève': 'GVA', 'courchevel': 'GVA',
  'val d\'isère': 'GVA', 'dijon': 'DIJ', 'tours': 'TUF', 'reims': 'RHE',
  'metz': 'ETZ', 'nancy': 'ETZ', 'colmar': 'SXB', 'pau': 'PUF',
};

async function runBatch(db, options = {}) {
  const batchSize = options.batchSize || 30;
  let signalsFound = 0;
  const errors = [];

  // Vérifier que Amadeus est configuré
  try {
    await getAmadeusToken(db);
  } catch (err) {
    logger.warn(`Booking Detector: ${err.message}`);
    return { signals_found: 0, hotels_checked: 0, errors: [err.message] };
  }

  // Récupérer les opportunités à vérifier
  const opps = db.prepare(`
    SELECT hotel_name, city FROM veille_opportunities
    WHERE status NOT IN ('archived', 'lost', 'won')
      AND business_score >= 30
      AND hotel_name IS NOT NULL AND city IS NOT NULL
    ORDER BY business_score DESC
    LIMIT ?
  `).all(batchSize);

  logger.info(`Booking Detector: ${opps.length} hôtels à vérifier`);

  for (const opp of opps) {
    const cityCode = CITY_IATA[(opp.city || '').toLowerCase()];
    if (!cityCode) {
      logger.debug(`Booking Detector: pas de code IATA pour ${opp.city}`);
      continue;
    }

    try {
      const signal = await checkHotel(db, {
        hotelName: opp.hotel_name,
        city: opp.city,
        cityCode,
      });

      if (signal === null && errors.includes('rate_limited')) break;

      if (signal) {
        const id = insertSignal(db, signal);
        if (id) signalsFound++;
      }

      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      logger.warn(`Booking Detector: erreur ${opp.hotel_name}: ${err.message}`);
      errors.push(`${opp.hotel_name}: ${err.message}`);
    }
  }

  logger.info(`Booking Detector terminé: ${signalsFound} signaux sur ${opps.length} hôtels`);
  return { signals_found: signalsFound, hotels_checked: opps.length, errors };
}

module.exports = {
  runBatch,
  checkHotel,
  checkHotelAvailability,
};
