/**
 * googlePlacesService.js — Scanner Google Places pour hôtels temporairement fermés
 *
 * Utilise l'API Text Search (New) de Google Places pour détecter
 * les hôtels avec businessStatus = CLOSED_TEMPORARILY.
 * Signal fort de rénovation → création automatique d'opportunités.
 */

const logger = require('../config/logger');
const { upsertOpportunity } = require('./veilleOpportunity');

// Liste des villes françaises (réutilisée depuis veilleEnrichment)
const VILLES_SCAN = [
  'Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Nice', 'Toulouse', 'Nantes',
  'Strasbourg', 'Montpellier', 'Lille', 'Rennes', 'Reims', 'Toulon',
  'Grenoble', 'Dijon', 'Angers', 'Nîmes', 'Aix-en-Provence',
  'Rouen', 'Clermont-Ferrand', 'Tours', 'Limoges', 'Pau', 'Bayonne',
  'Saint-Étienne', 'Le Mans', 'Colmar', 'Mulhouse', 'Metz', 'Nancy',
  'Besançon', 'Orléans', 'Poitiers', 'Amiens', 'Caen', 'Le Havre',
  'Cannes', 'Saint-Tropez', 'Antibes', 'Biarritz', 'Deauville',
  'La Rochelle', 'Avignon', 'Arles', 'La Baule',
  'Saint-Malo', 'Dinard',
  'Chamonix', 'Megève', 'Courchevel', 'Méribel', "Val d'Isère",
  'Annecy', 'Aix-les-Bains',
  'Ajaccio', 'Bastia', 'Bonifacio', 'Porto-Vecchio', 'Calvi',
  'Versailles', 'Fontainebleau',
  'Gordes', 'Saint-Rémy-de-Provence',
  'Carcassonne', 'Perpignan', 'Montauban', 'Albi',
  'Vichy', 'Chambéry', 'Valence', 'Troyes',
  'Honfleur', 'Cabourg', 'Trouville',
  'Arcachon', 'Saint-Jean-de-Luz', 'Hossegor',
  'Menton', 'Èze', 'Fréjus', 'Saint-Raphaël', 'Bandol', 'Cassis',
];

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
 * Filtre les résultats CLOSED_TEMPORARILY.
 */
async function searchHotelsInCity(apiKey, city) {
  const results = [];
  let pageToken = null;

  do {
    const body = {
      textQuery: `hôtel ${city}`,
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
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.businessStatus,places.id,places.types,places.rating,places.websiteUri,nextPageToken',
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
      const places = data.places || [];

      for (const place of places) {
        if (place.businessStatus === 'CLOSED_TEMPORARILY') {
          results.push({
            name: place.displayName?.text || 'Inconnu',
            address: place.formattedAddress || '',
            placeId: place.id,
            rating: place.rating || null,
            website: place.websiteUri || null,
            city,
          });
        }
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

  return results;
}

/**
 * Scanner toutes les villes et créer des opportunités pour les hôtels fermés temporairement.
 */
async function scanAllCities(db, onProgress) {
  const apiKey = getApiKey(db);
  if (!apiKey) throw new Error('Clé API Google Places non configurée');

  const allFound = [];
  let scanned = 0;

  for (const city of VILLES_SCAN) {
    try {
      const closed = await searchHotelsInCity(apiKey, city);

      for (const hotel of closed) {
        // Créer une opportunité via le système existant
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

        allFound.push({
          ...hotel,
          opportunity_id: oppId,
        });
      }

      scanned++;

      if (onProgress) {
        onProgress({ scanned, total: VILLES_SCAN.length, city, found: closed.length });
      }

      // Rate limiting entre villes (~1 req/sec)
      await new Promise(r => setTimeout(r, 1100));

    } catch (err) {
      logger.error(`Google Places: erreur pour ${city}: ${err.message}`);
      scanned++;
      // Continuer avec les autres villes
    }
  }

  logger.info(`Google Places scan terminé: ${scanned} villes scannées, ${allFound.length} hôtels fermés trouvés`);

  return {
    scanned,
    total_cities: VILLES_SCAN.length,
    found: allFound.length,
    hotels: allFound,
  };
}

module.exports = {
  getApiKey,
  searchHotelsInCity,
  scanAllCities,
  VILLES_SCAN,
};
