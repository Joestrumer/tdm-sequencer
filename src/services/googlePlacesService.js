/**
 * googlePlacesService.js — Scanner Google Places pour hôtels temporairement fermés
 *
 * Utilise l'API Text Search (New) de Google Places pour détecter
 * les hôtels avec businessStatus = CLOSED_TEMPORARILY.
 * Signal fort de rénovation → création automatique d'opportunités.
 */

const logger = require('../config/logger');
const { upsertOpportunity } = require('./veilleOpportunity');

// Régions avec leurs villes pour le scan ciblé
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

// Liste plate de toutes les villes
const VILLES_SCAN = Object.values(REGIONS).flat();

function getApiKey(db) {
  try {
    const row = db.prepare("SELECT valeur FROM config WHERE cle = 'google_places_api_key'").get();
    return row?.valeur || process.env.GOOGLE_PLACES_API_KEY || '';
  } catch (_) {
    return process.env.GOOGLE_PLACES_API_KEY || '';
  }
}

/**
 * Recherche les hôtels dans une ville via Google Places Text Search (New).
 * Retourne TOUS les hôtels avec leur businessStatus.
 */
async function searchHotelsInCity(apiKey, city) {
  const allPlaces = [];
  let pageToken = null;

  do {
    const body = {
      textQuery: `hôtel ${city} France`,
      includedType: 'lodging',
      languageCode: 'fr',
      regionCode: 'FR',
      pageSize: 20,
    };
    if (pageToken) body.pageToken = pageToken;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.businessStatus,places.id,places.rating,places.userRatingCount,places.websiteUri,nextPageToken',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Google Places API ${res.status}: ${errText.substring(0, 500)}`);
      }

      const data = await res.json();
      const places = data.places || [];

      for (const place of places) {
        allPlaces.push({
          name: place.displayName?.text || 'Inconnu',
          address: place.formattedAddress || '',
          placeId: place.id,
          rating: place.rating || null,
          ratingCount: place.userRatingCount || 0,
          website: place.websiteUri || null,
          businessStatus: place.businessStatus || 'OPERATIONAL',
          city,
        });
      }

      pageToken = data.nextPageToken || null;

      // Respecter le rate limiting
      if (pageToken) {
        await new Promise(r => setTimeout(r, 1200));
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        logger.warn(`Google Places: timeout pour ${city}`);
      } else {
        throw err;
      }
      break;
    }
  } while (pageToken);

  return allPlaces;
}

/**
 * Scanner une ville et créer des opportunités pour les CLOSED_TEMPORARILY.
 * Retourne tous les résultats (pour affichage) + les fermés (pour opportunités).
 */
async function scanCity(db, city) {
  const apiKey = getApiKey(db);
  if (!apiKey) throw new Error('Clé API Google Places non configurée');

  const allHotels = await searchHotelsInCity(apiKey, city);
  const closed = allHotels.filter(h => h.businessStatus === 'CLOSED_TEMPORARILY');
  const opportunities = [];

  for (const hotel of closed) {
    const oppId = upsertOpportunity(db, {
      article_id: null,
      hotel_name: hotel.name,
      city: hotel.city,
      region: null,
      group_name: null,
      signal_type: 'fermeture_temp',
      signal_subtype: 'google_places',
      project_date: null,
    });
    opportunities.push({ ...hotel, opportunity_id: oppId });
  }

  return {
    city,
    total: allHotels.length,
    closed: closed.length,
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

  for (const city of cities) {
    try {
      const allHotels = await searchHotelsInCity(apiKey, city);
      const closed = allHotels.filter(h => h.businessStatus === 'CLOSED_TEMPORARILY');

      for (const hotel of closed) {
        upsertOpportunity(db, {
          article_id: null,
          hotel_name: hotel.name,
          city: hotel.city,
          region: null,
          group_name: null,
          signal_type: 'fermeture_temp',
          signal_subtype: 'google_places',
          project_date: null,
        });
      }

      results.push({ city, total: allHotels.length, closed: closed.length, hotels: closed });
      totalFound += closed.length;

      // Rate limiting entre villes
      await new Promise(r => setTimeout(r, 1100));
    } catch (err) {
      logger.error(`Google Places: erreur pour ${city}: ${err.message}`);
      results.push({ city, total: 0, closed: 0, hotels: [], error: err.message });
    }
  }

  logger.info(`Google Places scan: ${cities.length} villes, ${totalFound} hôtels fermés`);
  return { scanned: cities.length, found: totalFound, results };
}

module.exports = {
  getApiKey,
  searchHotelsInCity,
  scanCity,
  scanCities,
  VILLES_SCAN,
  REGIONS,
};
