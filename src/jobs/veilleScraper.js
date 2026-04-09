/**
 * veilleScraper.js — Job cron de scraping des sources de veille hôtelière
 *
 * - Cron toutes les 6 heures
 * - Scrape toutes les sources actives
 * - Filtre par mots-clés et déduplique par URL
 */

const cron = require('node-cron');
const logger = require('../config/logger');
const { scraperSource, filtrerParMotsCles, sauvegarderArticles } = require('../services/veilleService');

let db;
let scraping = false;

/**
 * Scraper une source individuelle
 */
async function scraperUneSource(source) {
  try {
    logger.info(`🔍 Veille : scraping ${source.nom} (${source.url})`);

    const articles = await scraperSource(source, db);
    if (!articles || articles.length === 0) {
      logger.info(`🔍 Veille : aucun article trouvé pour ${source.nom}`);
      db.prepare('UPDATE veille_sources SET last_run = datetime("now") WHERE id = ?').run(source.id);
      return 0;
    }

    // Filtrer par mots-clés
    const motsCles = typeof source.mots_cles === 'string' ? JSON.parse(source.mots_cles) : source.mots_cles;
    const articlesFiltres = filtrerParMotsCles(articles, motsCles);

    // Ne garder que les articles avec un score > 0 (au moins un mot-clé trouvé)
    const articlesPertinenents = articlesFiltres.filter(a => a.score_pertinence > 0);

    // Sauvegarder (déduplique par URL)
    const inseres = sauvegarderArticles(db, source.id, articlesPertinenents);

    // Mettre à jour last_run
    db.prepare('UPDATE veille_sources SET last_run = datetime("now") WHERE id = ?').run(source.id);

    logger.info(`🔍 Veille : ${source.nom} — ${articles.length} articles trouvés, ${articlesPertinenents.length} pertinents, ${inseres} nouveaux`);
    return inseres;
  } catch (err) {
    logger.error(`🔍 Veille : erreur scraping ${source.nom} — ${err.message}`);
    return 0;
  }
}

/**
 * Scraper toutes les sources actives
 */
async function scraperToutesSources() {
  if (scraping) {
    logger.warn('🔍 Veille : scraping déjà en cours, skip');
    return { total: 0, nouveaux: 0 };
  }

  scraping = true;
  try {
    const sources = db.prepare('SELECT * FROM veille_sources WHERE actif = 1').all();
    if (sources.length === 0) {
      logger.info('🔍 Veille : aucune source active');
      return { total: 0, nouveaux: 0 };
    }

    logger.info(`🔍 Veille : lancement du scraping de ${sources.length} source(s)`);
    let totalNouveaux = 0;

    for (const source of sources) {
      const n = await scraperUneSource(source);
      totalNouveaux += n;
      // Pause entre les sources pour ne pas surcharger
      if (sources.length > 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    logger.info(`🔍 Veille terminée : ${totalNouveaux} nouvel(s) article(s)`);
    return { total: sources.length, nouveaux: totalNouveaux };
  } finally {
    scraping = false;
  }
}

/**
 * Initialiser le job cron
 */
function initialiser(database) {
  db = database;

  // Toutes les 6 heures : 0 */6 * * *
  cron.schedule('0 */6 * * *', async () => {
    try {
      await scraperToutesSources();
    } catch (err) {
      logger.error('🔍 Veille cron erreur:', err.message);
    }
  });

  logger.info('🔍 Job veille initialisé (toutes les 6h)');
}

module.exports = {
  initialiser,
  scraperToutesSources,
  scraperUneSource,
};
