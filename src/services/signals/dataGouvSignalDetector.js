/**
 * dataGouvSignalDetector.js — Détecteur de signaux institutionnels France
 *
 * Sources :
 * - Permis de construire (data.gouv.fr / Sit@del2)
 *   Filtre : hébergement hôtelier, surface > 500m²
 *   Signal : permis_construire, strength 90
 *
 * Fréquence : 1x/semaine
 * Coût : gratuit
 */

const logger = require('../../config/logger');
const { insertSignal } = require('./signalUtils');

// ─── API data.gouv.fr — Permis de construire ────────────────────────────────

/**
 * Recherche les permis de construire récents pour hébergement hôtelier.
 *
 * Approche : utilise l'API DREAL/Sit@del2 via data.gouv.fr
 * Dataset : "Base des permis de construire et autres autorisations d'urbanisme"
 *
 * Comme le dataset est un CSV mensuel volumineux, on passe par l'API
 * de recherche data.gouv.fr pour trouver les ressources les plus récentes,
 * puis on parse le CSV avec les filtres nécessaires.
 *
 * Alternative plus légère : recherche Brave "permis de construire hôtel"
 * sur les sites institutionnels et presse locale.
 */
async function fetchPermisHoteliers(db, options = {}) {
  const months = options.months || 3;
  const signals = [];

  // Stratégie 1 : API recherche sur les données ouvertes
  // Les permis de construire sont publiés par le MTES sur data.gouv.fr
  // mais le format change régulièrement. On utilise une approche hybride.

  // Stratégie retenue : recherche Brave ciblée sur les publications officielles
  // + données structurées quand le format est stable

  try {
    // Recherche de permis via l'API data.gouv.fr (métadonnées)
    const datasetId = '5b2861c1-23a4-47f8-a98e-4a1eab06b7e4'; // Sit@del2 permis de construire
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(`https://www.data.gouv.fr/api/1/datasets/${datasetId}/`, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn(`data.gouv.fr API ${res.status}`);
      return signals;
    }

    const dataset = await res.json();
    const resources = dataset.resources || [];

    // Trouver le fichier CSV le plus récent
    const csvResources = resources
      .filter(r => r.format === 'csv' || r.url?.endsWith('.csv'))
      .sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified));

    if (csvResources.length === 0) {
      logger.warn('data.gouv.fr: aucun CSV trouvé dans le dataset Sit@del2');
      return signals;
    }

    // Télécharger et parser le CSV le plus récent
    const csvUrl = csvResources[0].url;
    logger.info(`data.gouv.fr: téléchargement du CSV permis: ${csvUrl}`);

    const csvRes = await fetch(csvUrl, {
      headers: { 'Accept': 'text/csv' },
      signal: AbortSignal.timeout(30000),
    });

    if (!csvRes.ok) {
      logger.warn(`data.gouv.fr CSV ${csvRes.status}`);
      return signals;
    }

    const csvText = await csvRes.text();
    const lines = csvText.split('\n');
    if (lines.length < 2) return signals;

    // Parser le header pour trouver les colonnes pertinentes
    const header = lines[0].split(';').map(h => h.trim().replace(/"/g, '').toLowerCase());
    const getCol = (name) => header.indexOf(name);

    // Colonnes Sit@del2 typiques :
    // dest_principale, surface_plancher, commune, departement, date_autorisation
    const colDest = header.findIndex(h => h.includes('dest') && h.includes('principal'));
    const colSurface = header.findIndex(h => h.includes('surface') && h.includes('plancher'));
    const colCommune = header.findIndex(h => h.includes('commune'));
    const colDept = header.findIndex(h => h.includes('departement') || h.includes('dep'));
    const colDate = header.findIndex(h => h.includes('date') && (h.includes('auto') || h.includes('decision')));
    const colNature = header.findIndex(h => h.includes('nature') || h.includes('type_travaux'));

    if (colDest < 0 && colNature < 0) {
      logger.warn('data.gouv.fr: colonnes destination/nature non trouvées dans le CSV');
      // Fallback : pas de parsing, retourner vide
      return signals;
    }

    // Filtrer les lignes pertinentes
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);

    const hotelKeywords = ['hôtel', 'hotel', 'hébergement hôtelier', 'hebergement hotelier', '5510'];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';').map(c => c.trim().replace(/"/g, ''));
      if (cols.length < Math.max(colDest, colSurface, colCommune) + 1) continue;

      // Filtre destination = hôtelier
      const dest = (cols[colDest] || '').toLowerCase();
      const nature = colNature >= 0 ? (cols[colNature] || '').toLowerCase() : '';
      const isHotel = hotelKeywords.some(k => dest.includes(k) || nature.includes(k));
      if (!isHotel) continue;

      // Filtre surface > 500m²
      const surface = parseFloat((cols[colSurface] || '0').replace(',', '.'));
      if (surface < 500) continue;

      // Filtre date récente
      const dateStr = cols[colDate] || '';
      if (dateStr) {
        const permisDate = new Date(dateStr);
        if (!isNaN(permisDate.getTime()) && permisDate < cutoffDate) continue;
      }

      const commune = cols[colCommune] || 'Inconnue';
      const dept = colDept >= 0 ? cols[colDept] || '' : '';

      signals.push({
        signal_type: 'permis_construire',
        signal_strength: 90,
        source: 'data_gouv',
        source_url: csvUrl,
        hotel_name: null, // Le permis ne contient pas le nom commercial
        city: commune,
        postcode: dept.padStart(2, '0'),
        raw_payload: {
          destination: dest,
          surface_plancher: surface,
          commune,
          departement: dept,
          date_autorisation: dateStr,
          nature: nature,
          csv_line: i,
        },
        signal_date: dateStr || null,
      });
    }

    logger.info(`data.gouv.fr: ${signals.length} permis hôteliers trouvés (> 500m²)`);

  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      logger.warn('data.gouv.fr: timeout téléchargement CSV');
    } else {
      logger.error(`data.gouv.fr: ${err.message}`);
    }
  }

  return signals;
}

// ─── Batch principal ─────────────────────────────────────────────────────────

async function runBatch(db, options = {}) {
  let signalsFound = 0;
  const errors = [];

  try {
    // Permis de construire
    const permis = await fetchPermisHoteliers(db, options);
    for (const sig of permis) {
      const id = insertSignal(db, sig);
      if (id) signalsFound++;
    }
  } catch (err) {
    logger.error(`DataGouv Detector: ${err.message}`);
    errors.push(err.message);
  }

  logger.info(`DataGouv Detector terminé: ${signalsFound} signaux`);
  return { signals_found: signalsFound, errors };
}

module.exports = {
  runBatch,
  fetchPermisHoteliers,
};
