/**
 * googlePlacesService.js — Scanner Google Places pour hôtels temporairement fermés
 *
 * Stratégie multi-requêtes : pour chaque ville on lance plusieurs recherches
 * avec des angles différents, puis on déduplique par placeId.
 * Les grandes villes (Paris, Lyon, Marseille) sont découpées par quartier.
 */

const logger = require('../config/logger');
const { upsertOpportunity } = require('./veilleOpportunity');

// Régions avec leurs villes
const REGIONS = {
  'Île-de-France': ['Paris', 'Versailles', 'Fontainebleau', 'Saint-Germain-en-Laye', 'Enghien-les-Bains', 'Chantilly'],
  'Provence-Alpes-Côte d\'Azur': ['Nice', 'Cannes', 'Marseille', 'Aix-en-Provence', 'Avignon', 'Saint-Tropez', 'Antibes', 'Menton', 'Èze', 'Fréjus', 'Saint-Raphaël', 'Bandol', 'Cassis', 'Hyères', 'Arles', 'Gordes', 'Saint-Rémy-de-Provence'],
  'Auvergne-Rhône-Alpes': ['Lyon', 'Grenoble', 'Annecy', 'Chamonix', 'Megève', 'Courchevel', 'Méribel', 'Val d\'Isère', 'Chambéry', 'Aix-les-Bains', 'Valence', 'Vichy', 'Clermont-Ferrand'],
  'Nouvelle-Aquitaine': ['Bordeaux', 'Biarritz', 'La Rochelle', 'Arcachon', 'Saint-Jean-de-Luz', 'Hossegor', 'Pau', 'Bayonne', 'Limoges', 'Poitiers', 'Angoulême', 'Périgueux', 'Cognac'],
  'Occitanie': ['Toulouse', 'Montpellier', 'Perpignan', 'Nîmes', 'Carcassonne', 'Narbonne', 'Béziers', 'Sète', 'Montauban', 'Albi', 'Lourdes', 'Collioure'],
  'Bretagne': ['Rennes', 'Saint-Malo', 'Dinard', 'Quimper', 'Vannes', 'Brest', 'Saint-Brieuc', 'Lorient', 'Quiberon', 'Carnac'],
  'Normandie': ['Deauville', 'Honfleur', 'Rouen', 'Caen', 'Le Havre', 'Étretat', 'Cabourg', 'Trouville', 'Granville'],
  'Pays de la Loire': ['Nantes', 'La Baule', 'Angers', 'Le Mans', 'Les Sables-d\'Olonne', 'Saumur'],
  'Grand Est': ['Strasbourg', 'Colmar', 'Metz', 'Nancy', 'Mulhouse', 'Reims', 'Troyes'],
  'Hauts-de-France': ['Lille', 'Amiens', 'Le Touquet'],
  'Bourgogne-Franche-Comté': ['Dijon', 'Besançon', 'Mâcon', 'Beaune'],
  'Centre-Val de Loire': ['Tours', 'Orléans', 'Blois', 'Chartres', 'Bourges', 'Amboise'],
  'Corse': ['Ajaccio', 'Bastia', 'Bonifacio', 'Porto-Vecchio', 'Calvi', 'Propriano'],
};

const VILLES_SCAN = Object.values(REGIONS).flat();

// Quartiers pour les grandes villes (multiplier les requêtes)
const QUARTIERS = {
  'Paris': [
    'Paris 1er Louvre', 'Paris 2ème Bourse', 'Paris 3ème Marais',
    'Paris 4ème Hôtel de Ville', 'Paris 5ème Quartier Latin',
    'Paris 6ème Saint-Germain-des-Prés', 'Paris 7ème Tour Eiffel',
    'Paris 8ème Champs-Élysées', 'Paris 9ème Opéra',
    'Paris 10ème Gare du Nord', 'Paris 11ème Bastille',
    'Paris 12ème Bercy', 'Paris 13ème', 'Paris 14ème Montparnasse',
    'Paris 15ème', 'Paris 16ème Trocadéro', 'Paris 17ème Batignolles',
    'Paris 18ème Montmartre', 'Paris 19ème', 'Paris 20ème Belleville',
  ],
  'Lyon': ['Lyon Presqu\'île', 'Lyon Vieux Lyon', 'Lyon Part-Dieu', 'Lyon Confluence', 'Lyon Bellecour'],
  'Marseille': ['Marseille Vieux-Port', 'Marseille Prado', 'Marseille Joliette', 'Marseille Castellane'],
  'Nice': ['Nice Promenade des Anglais', 'Nice Vieux Nice', 'Nice port'],
  'Bordeaux': ['Bordeaux centre', 'Bordeaux Chartrons', 'Bordeaux Saint-Pierre'],
};

function getApiKey(db) {
  try {
    const row = db.prepare("SELECT valeur FROM config WHERE cle = 'google_places_api_key'").get();
    return row?.valeur || process.env.GOOGLE_PLACES_API_KEY || '';
  } catch (_) {
    return process.env.GOOGLE_PLACES_API_KEY || '';
  }
}

/**
 * Effectue UNE requête Text Search et retourne les résultats.
 */
async function textSearch(apiKey, query, options = {}) {
  const body = {
    textQuery: query,
    languageCode: 'fr',
    regionCode: 'FR',
    pageSize: 20,
    ...options,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.businessStatus,places.id,places.rating,places.userRatingCount,places.websiteUri',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Google Places API ${res.status}: ${errText.substring(0, 300)}`);
    }

    const data = await res.json();
    return (data.places || []).map(place => ({
      name: place.displayName?.text || 'Inconnu',
      address: place.formattedAddress || '',
      placeId: place.id,
      rating: place.rating || null,
      ratingCount: place.userRatingCount || 0,
      website: place.websiteUri || null,
      businessStatus: place.businessStatus || 'OPERATIONAL',
    }));
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      logger.warn(`Google Places: timeout pour "${query}"`);
      return [];
    }
    throw err;
  }
}

/**
 * Génère les requêtes de recherche pour une ville.
 * Grandes villes → recherche par quartier.
 * Petites villes → quelques variantes de requêtes.
 */
function buildQueries(city) {
  const queries = [];

  if (QUARTIERS[city]) {
    // Grande ville : rechercher par quartier
    for (const quartier of QUARTIERS[city]) {
      queries.push(`hôtel ${quartier}`);
    }
  } else {
    // Ville normale : quelques variantes
    queries.push(`hôtel ${city}`);
    queries.push(`hotel ${city} France`);
    queries.push(`hébergement ${city}`);
  }

  return queries;
}

/**
 * Scanner une ville avec multi-requêtes et déduplication.
 */
async function scanCity(db, city) {
  const apiKey = getApiKey(db);
  if (!apiKey) throw new Error('Clé API Google Places non configurée');

  const queries = buildQueries(city);
  const seenIds = new Set();
  const allHotels = [];
  let queryCount = 0;

  for (const query of queries) {
    try {
      const results = await textSearch(apiKey, query);
      queryCount++;

      for (const place of results) {
        if (!seenIds.has(place.placeId)) {
          seenIds.add(place.placeId);
          allHotels.push({ ...place, city, query });
        }
      }

      // Rate limiting entre requêtes
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      logger.error(`Google Places: erreur requête "${query}": ${err.message}`);
    }
  }

  const closed = allHotels.filter(h => h.businessStatus === 'CLOSED_TEMPORARILY');
  const opportunities = [];

  for (const hotel of closed) {
    const oppId = upsertOpportunity(db, {
      article_id: null,
      hotel_name: hotel.name,
      city,
      region: null,
      group_name: null,
      signal_type: 'fermeture_temp',
      signal_subtype: 'google_places',
      project_date: null,
    });
    opportunities.push({ ...hotel, opportunity_id: oppId });
  }

  logger.info(`Google Places scan ${city}: ${queryCount} requêtes, ${allHotels.length} hôtels uniques, ${closed.length} fermé(s)`);

  return {
    city,
    total: allHotels.length,
    closed: closed.length,
    queries: queryCount,
    hotels: allHotels,
    opportunities,
  };
}

/**
 * Scanner plusieurs villes (par région ou liste custom).
 */
async function scanCities(db, cities) {
  const apiKey = getApiKey(db);
  if (!apiKey) throw new Error('Clé API Google Places non configurée');

  const results = [];
  let totalFound = 0;
  let totalHotels = 0;

  for (const city of cities) {
    try {
      const result = await scanCity(db, city);
      results.push({
        city,
        total: result.total,
        closed: result.closed,
        queries: result.queries,
        hotels: result.opportunities, // Seulement les fermés pour la vue région
      });
      totalFound += result.closed;
      totalHotels += result.total;

      // Pause entre villes
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      logger.error(`Google Places: erreur pour ${city}: ${err.message}`);
      results.push({ city, total: 0, closed: 0, queries: 0, hotels: [], error: err.message });
    }
  }

  logger.info(`Google Places scan: ${cities.length} villes, ${totalHotels} hôtels scannés, ${totalFound} fermés`);
  return { scanned: cities.length, found: totalFound, totalHotels, results };
}

module.exports = {
  getApiKey,
  textSearch,
  scanCity,
  scanCities,
  VILLES_SCAN,
  REGIONS,
  QUARTIERS,
};
