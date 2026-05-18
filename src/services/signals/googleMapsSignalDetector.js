/**
 * googleMapsSignalDetector.js — Détecteur de signaux Google Maps
 *
 * Trois sous-détecteurs en croisement :
 * A. Delta de reviews (chute anormale = probable fermeture/travaux)
 * B. Mots-clés dans les avis récents (mention travaux/rénovation)
 * C. Changement d'horaires (réduction massive)
 *
 * Tourne 1x/semaine en batch (rate limit + coût Google Places).
 * Utilise veille_google_snapshots pour stocker l'historique.
 *
 * Dépendances : Google Places API v1 (New)
 * Coût : ~$17/1000 Place Details, ~$32/1000 Text Search
 */

const { randomUUID } = require('crypto');
const logger = require('../../config/logger');
const { insertSignal, getConfigValue } = require('./signalUtils');

// ─── Config ──────────────────────────────────────────────────────────────────

function getApiKey(db) {
  return getConfigValue(db, 'google_places_api_key', 'GOOGLE_PLACES_API_KEY', '');
}

// ─── API helpers ─────────────────────────────────────────────────────────────

/**
 * Place Details (New API) — retourne reviews, horaires, statut.
 * Champs demandés : reviews, currentOpeningHours, businessStatus,
 *                   userRatingCount, rating, websiteUri, displayName
 */
async function getPlaceDetails(apiKey, placeId) {
  const fieldMask = [
    'displayName', 'formattedAddress', 'businessStatus',
    'rating', 'userRatingCount', 'websiteUri',
    'currentOpeningHours', 'reviews',
  ].join(',');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
        'Accept-Language': 'fr',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google Places Details ${res.status}: ${body.substring(0, 200)}`);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Google Places Details timeout');
    throw err;
  }
}

/**
 * Text Search pour résoudre un nom d'hôtel en place_id.
 */
async function resolveHotelPlaceId(apiKey, hotelName, city) {
  const query = city ? `${hotelName} ${city} hôtel` : `${hotelName} hôtel France`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.businessStatus',
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: 'fr',
        regionCode: 'FR',
        pageSize: 3,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google Places TextSearch ${res.status}: ${body.substring(0, 200)}`);
    }

    const data = await res.json();
    const places = data.places || [];
    return places[0] || null;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('Google Places TextSearch timeout');
    throw err;
  }
}

// ─── Snapshot management ─────────────────────────────────────────────────────

function saveSnapshot(db, { hotel_place_id, hotel_name, city, review_count, rating, business_status, opening_hours_json, website_uri }) {
  const today = new Date().toISOString().split('T')[0];

  try {
    db.prepare(`
      INSERT OR REPLACE INTO veille_google_snapshots
        (id, hotel_place_id, hotel_name, city, snapshot_date, review_count, rating, business_status, opening_hours_json, website_uri)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), hotel_place_id, hotel_name, city, today,
      review_count, rating, business_status,
      opening_hours_json ? JSON.stringify(opening_hours_json) : null,
      website_uri || null
    );
  } catch (err) {
    logger.warn(`Erreur sauvegarde snapshot ${hotel_place_id}: ${err.message}`);
  }
}

function getRecentSnapshots(db, hotel_place_id, months = 6) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return db.prepare(`
    SELECT * FROM veille_google_snapshots
    WHERE hotel_place_id = ? AND snapshot_date >= ?
    ORDER BY snapshot_date ASC
  `).all(hotel_place_id, cutoff.toISOString().split('T')[0]);
}

// ─── Sous-détecteur A : Delta de reviews ─────────────────────────────────────

/**
 * Compare le review_count actuel vs la moyenne mobile des 6 derniers mois.
 * Si 0 reviews ou < 10% de la moyenne sur 60 jours → signal google_review_drop.
 */
function detectReviewDrop(db, { hotel_place_id, hotel_name, city, current_review_count }) {
  const snapshots = getRecentSnapshots(db, hotel_place_id, 6);
  if (snapshots.length < 2) return null; // Pas assez d'historique

  // Calculer le delta reviews par mois
  const deltas = [];
  for (let i = 1; i < snapshots.length; i++) {
    const delta = (snapshots[i].review_count || 0) - (snapshots[i - 1].review_count || 0);
    deltas.push(Math.max(0, delta)); // Ignorer les baisses (corrections Google)
  }

  if (deltas.length === 0) return null;

  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  if (avgDelta < 1) return null; // Hôtel avec très peu de reviews normalement

  // Dernier snapshot vs avant-dernier
  const lastSnap = snapshots[snapshots.length - 1];
  const prevSnap = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
  if (!prevSnap) return null;

  const recentDelta = (current_review_count || 0) - (prevSnap.review_count || 0);
  const ratio = avgDelta > 0 ? recentDelta / avgDelta : 0;

  // Si le delta récent est < 10% de la moyenne → chute anormale
  if (ratio < 0.1 && avgDelta >= 2) {
    const strength = Math.min(90, Math.round(60 + (1 - ratio) * 30));
    return {
      signal_type: 'google_review_drop',
      signal_strength: strength,
      source: 'google_places',
      hotel_name,
      city,
      raw_payload: {
        hotel_place_id,
        avg_monthly_delta: Math.round(avgDelta * 10) / 10,
        recent_delta: recentDelta,
        ratio: Math.round(ratio * 100) / 100,
        snapshot_count: snapshots.length,
        current_review_count,
      },
    };
  }

  return null;
}

// ─── Sous-détecteur B : Mots-clés dans les avis récents ─────────────────────

const REVIEW_KEYWORDS_FR = [
  { pattern: /ferm[ée]+\s+(pour|en)\s+(travaux|r[ée]novation|transformation)/i, strength: 95 },
  { pattern: /en\s+(travaux|r[ée]novation|chantier|restauration)/i, strength: 90 },
  { pattern: /r[ée]ouverture\s+(pr[ée]vue|en|le|courant)/i, strength: 85 },
  { pattern: /hôtel\s+(fermé|closed)/i, strength: 80 },
  { pattern: /travaux\s+(en\s+cours|importants|lourds)/i, strength: 85 },
];

const REVIEW_KEYWORDS_EN = [
  { pattern: /closed\s+for\s+(refurbishment|renovation|remodel)/i, strength: 95 },
  { pattern: /(under|undergoing)\s+(renovation|construction|refurbishment)/i, strength: 90 },
  { pattern: /reopening\s+(soon|in|expected|planned)/i, strength: 85 },
  { pattern: /(hotel|property)\s+(is\s+)?closed/i, strength: 80 },
];

/**
 * Analyse les 5 derniers avis Google d'un hôtel.
 * Recherche des mentions de travaux/rénovation/fermeture.
 */
function detectReviewKeywords(reviews, { hotel_name, city }) {
  if (!reviews || reviews.length === 0) return [];

  const signals = [];
  const now = Date.now();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;

  for (const review of reviews) {
    // Vérifier la date (Google renvoie publishTime en ISO)
    if (review.publishTime) {
      const reviewDate = new Date(review.publishTime);
      if (now - reviewDate.getTime() > ninetyDays) continue; // Trop ancien
    }

    const text = (review.text?.text || review.originalText?.text || '').trim();
    if (!text) continue;

    const allPatterns = [...REVIEW_KEYWORDS_FR, ...REVIEW_KEYWORDS_EN];
    for (const { pattern, strength } of allPatterns) {
      if (pattern.test(text)) {
        signals.push({
          signal_type: 'google_review_keyword',
          signal_strength: strength,
          source: 'google_places',
          hotel_name,
          city,
          source_url: null,
          signal_date: review.publishTime || null,
          raw_payload: {
            review_text: text.substring(0, 500),
            pattern_matched: pattern.source,
            author: review.authorAttribution?.displayName || null,
            rating: review.rating,
          },
        });
        break; // Un signal par review suffit
      }
    }
  }

  return signals;
}

// ─── Sous-détecteur C : Changement d'horaires ───────────────────────────────

/**
 * Compare les horaires actuels vs le dernier snapshot.
 * Si passage de 7j/7 à 0j ou réduction > 50% → signal.
 */
function detectHoursChange(db, { hotel_place_id, hotel_name, city, current_hours }) {
  const snapshots = getRecentSnapshots(db, hotel_place_id, 3);
  if (snapshots.length === 0) return null;

  const lastSnap = snapshots[snapshots.length - 1];
  let previousHours;
  try {
    previousHours = lastSnap.opening_hours_json ? JSON.parse(lastSnap.opening_hours_json) : null;
  } catch (_) {
    previousHours = null;
  }
  if (!previousHours) return null;

  // Compter les jours ouverts
  const countOpenDays = (hours) => {
    if (!hours) return 0;
    // Format Google Places v1 : weekdayDescriptions array
    const descs = hours.weekdayDescriptions || hours.periods || [];
    if (Array.isArray(descs) && descs.length > 0) {
      if (typeof descs[0] === 'string') {
        // weekdayDescriptions : ["Lundi : 08:00 – 22:00", "Mardi : Fermé", ...]
        return descs.filter(d => !/(ferm|closed)/i.test(d)).length;
      }
      // periods format
      return new Set(descs.map(p => p.open?.day)).size;
    }
    return 7; // Par défaut, supposer ouvert
  };

  const prevDays = countOpenDays(previousHours);
  const currDays = countOpenDays(current_hours);

  if (prevDays >= 5 && currDays === 0) {
    // Passage de ouvert à complètement fermé
    return {
      signal_type: 'google_hours_change',
      signal_strength: 70,
      source: 'google_places',
      hotel_name,
      city,
      raw_payload: {
        hotel_place_id,
        previous_open_days: prevDays,
        current_open_days: currDays,
        change: 'full_closure',
      },
    };
  }

  if (prevDays > 0 && currDays > 0 && currDays < prevDays * 0.5) {
    // Réduction massive (> 50%)
    return {
      signal_type: 'google_hours_change',
      signal_strength: 50,
      source: 'google_places',
      hotel_name,
      city,
      raw_payload: {
        hotel_place_id,
        previous_open_days: prevDays,
        current_open_days: currDays,
        change: 'major_reduction',
      },
    };
  }

  return null;
}

// ─── Orchestrateur batch ─────────────────────────────────────────────────────

/**
 * Lance les 3 détecteurs sur un batch d'hôtels.
 *
 * Sources d'hôtels à analyser (par ordre de priorité) :
 * 1. Hôtels avec google_place_id dans veille_opportunities
 * 2. Hôtels de veille_google_snapshots (déjà trackés)
 * 3. Hôtels depuis la table leads (résolution place_id nécessaire)
 *
 * @param {Object} db - Base de données SQLite
 * @param {Object} options - { batchSize: 50, resolveFromLeads: false }
 * @returns {{ signals_found, snapshots_saved, hotels_checked, errors }}
 */
async function runBatch(db, options = {}) {
  const apiKey = getApiKey(db);
  if (!apiKey) {
    logger.warn('Google Maps Signal Detector: clé API non configurée');
    return { signals_found: 0, snapshots_saved: 0, hotels_checked: 0, errors: ['Clé API Google Places manquante'] };
  }

  const batchSize = options.batchSize || 50;
  const errors = [];
  let signalsFound = 0;
  let snapshotsSaved = 0;

  // Récupérer les hôtels à analyser
  // 1. Depuis les opportunités avec google_place_id
  const fromOpps = db.prepare(`
    SELECT DISTINCT google_place_id, hotel_name, city
    FROM veille_opportunities
    WHERE google_place_id IS NOT NULL AND status NOT IN ('archived', 'lost')
    LIMIT ?
  `).all(batchSize);

  // 2. Depuis les snapshots existants (hôtels déjà trackés)
  const fromSnapshots = db.prepare(`
    SELECT DISTINCT hotel_place_id AS google_place_id, hotel_name, city
    FROM veille_google_snapshots
    WHERE hotel_place_id NOT IN (
      SELECT DISTINCT google_place_id FROM veille_opportunities WHERE google_place_id IS NOT NULL
    )
    LIMIT ?
  `).all(Math.max(0, batchSize - fromOpps.length));

  const hotels = [...fromOpps, ...fromSnapshots].slice(0, batchSize);
  logger.info(`Google Maps Detector: ${hotels.length} hôtels à analyser`);

  for (const hotel of hotels) {
    try {
      // Fetch détails Google Places
      const details = await getPlaceDetails(apiKey, hotel.google_place_id);
      if (!details) continue;

      const hotelName = hotel.hotel_name || details.displayName?.text;
      const city = hotel.city;
      const reviewCount = details.userRatingCount || 0;

      // Sauvegarder le snapshot
      saveSnapshot(db, {
        hotel_place_id: hotel.google_place_id,
        hotel_name: hotelName,
        city,
        review_count: reviewCount,
        rating: details.rating,
        business_status: details.businessStatus,
        opening_hours_json: details.currentOpeningHours,
        website_uri: details.websiteUri,
      });
      snapshotsSaved++;

      // A. Delta reviews
      const dropSignal = detectReviewDrop(db, {
        hotel_place_id: hotel.google_place_id,
        hotel_name: hotelName,
        city,
        current_review_count: reviewCount,
      });
      if (dropSignal) {
        const id = insertSignal(db, dropSignal);
        if (id) signalsFound++;
      }

      // B. Mots-clés reviews
      const keywordSignals = detectReviewKeywords(details.reviews || [], { hotel_name: hotelName, city });
      for (const sig of keywordSignals) {
        const id = insertSignal(db, sig);
        if (id) signalsFound++;
      }

      // C. Changement horaires
      const hoursSignal = detectHoursChange(db, {
        hotel_place_id: hotel.google_place_id,
        hotel_name: hotelName,
        city,
        current_hours: details.currentOpeningHours,
      });
      if (hoursSignal) {
        const id = insertSignal(db, hoursSignal);
        if (id) signalsFound++;
      }

      // Fermeture temporaire Google (signal classique, conservé)
      if (details.businessStatus === 'CLOSED_TEMPORARILY') {
        insertSignal(db, {
          signal_type: 'google_closed_temporarily',
          signal_strength: 65,
          source: 'google_places',
          hotel_name: hotelName,
          city,
          raw_payload: { hotel_place_id: hotel.google_place_id, business_status: details.businessStatus },
        });
        signalsFound++;
      }

      // Rate limiting entre requêtes
      await new Promise(r => setTimeout(r, 350));

    } catch (err) {
      logger.warn(`Google Maps Detector: erreur ${hotel.hotel_name}: ${err.message}`);
      errors.push(`${hotel.hotel_name}: ${err.message}`);
    }
  }

  logger.info(`Google Maps Detector terminé: ${signalsFound} signaux, ${snapshotsSaved} snapshots, ${errors.length} erreurs`);
  return { signals_found: signalsFound, snapshots_saved: snapshotsSaved, hotels_checked: hotels.length, errors };
}

/**
 * Résoudre le place_id d'un hôtel par nom + ville, et l'enregistrer.
 * Utile pour les opportunités qui n'ont pas encore de google_place_id.
 */
async function resolveAndTrack(db, hotelName, city) {
  const apiKey = getApiKey(db);
  if (!apiKey) return null;

  const place = await resolveHotelPlaceId(apiKey, hotelName, city);
  if (!place) return null;

  const placeId = place.id;

  // Sauvegarder le premier snapshot
  saveSnapshot(db, {
    hotel_place_id: placeId,
    hotel_name: place.displayName?.text || hotelName,
    city,
    review_count: place.userRatingCount || 0,
    rating: place.rating,
    business_status: place.businessStatus,
    opening_hours_json: null,
    website_uri: place.websiteUri,
  });

  return {
    place_id: placeId,
    name: place.displayName?.text,
    address: place.formattedAddress,
    rating: place.rating,
    review_count: place.userRatingCount,
    website: place.websiteUri,
    business_status: place.businessStatus,
  };
}

module.exports = {
  runBatch,
  resolveAndTrack,
  getPlaceDetails,
  resolveHotelPlaceId,
  detectReviewDrop,
  detectReviewKeywords,
  detectHoursChange,
};
