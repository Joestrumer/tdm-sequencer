/**
 * veilleScraper.js — Job cron de scraping des sources de veille hôtelière
 *
 * - Cron par source : chaque source a sa propre fréquence (frequence_cron)
 * - Fallback : cron global toutes les 6h
 * - Scrape avec Brave Search API, filtre par mots-clés, score par priorité A/B/C
 * - Déduplique via URL UNIQUE
 */

const cron = require('node-cron');
const logger = require('../config/logger');
const { scraperSource, filtrerParMotsCles, sauvegarderArticles } = require('../services/veilleService');

let db;
let scraping = false;
const scheduledJobs = new Map();

/**
 * Scraper une source individuelle
 */
async function scraperUneSource(source) {
  try {
    logger.info(`🔍 Veille : scraping ${source.nom} (${source.type})`);

    const articles = await scraperSource(source, db);
    if (!articles || articles.length === 0) {
      logger.info(`🔍 Veille : aucun article trouvé pour ${source.nom}`);
      db.prepare('UPDATE veille_sources SET last_run = datetime("now") WHERE id = ?').run(source.id);
      return 0;
    }

    const motsCles = typeof source.mots_cles === 'string' ? JSON.parse(source.mots_cles) : source.mots_cles;
    const articlesFiltres = filtrerParMotsCles(articles, motsCles);

    // Garder les articles avec au moins 1 signal détecté
    const articlesPertinenents = articlesFiltres.filter(a => a.score_pertinence > 0);

    const inseres = sauvegarderArticles(db, source.id, articlesPertinenents);

    db.prepare('UPDATE veille_sources SET last_run = datetime("now") WHERE id = ?').run(source.id);

    logger.info(`🔍 Veille : ${source.nom} — ${articles.length} trouvés, ${articlesPertinenents.length} pertinents, ${inseres} nouveaux`);
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

    logger.info(`🔍 Veille : scraping de ${sources.length} source(s)`);
    let totalNouveaux = 0;

    for (const source of sources) {
      const n = await scraperUneSource(source);
      totalNouveaux += n;
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
 * Planifier les crons par source (fréquence individuelle)
 */
function planifierCrons() {
  // Arrêter les jobs existants
  for (const [, job] of scheduledJobs) {
    job.stop();
  }
  scheduledJobs.clear();

  const sources = db.prepare('SELECT * FROM veille_sources WHERE actif = 1').all();
  const seenCrons = new Map(); // Regrouper les sources ayant le même cron

  for (const source of sources) {
    const cronExpr = source.frequence_cron || '0 */6 * * *';
    if (!cron.validate(cronExpr)) {
      logger.warn(`🔍 Cron invalide pour ${source.nom}: ${cronExpr}, fallback 6h`);
      continue;
    }

    if (!seenCrons.has(cronExpr)) {
      seenCrons.set(cronExpr, []);
    }
    seenCrons.get(cronExpr).push(source);
  }

  // Créer un job par expression cron unique
  for (const [cronExpr, cronSources] of seenCrons) {
    const names = cronSources.map(s => s.nom).join(', ');
    const job = cron.schedule(cronExpr, async () => {
      // Recharger les sources depuis la DB (elles ont pu changer)
      for (const s of cronSources) {
        const fresh = db.prepare('SELECT * FROM veille_sources WHERE id = ? AND actif = 1').get(s.id);
        if (fresh) {
          try {
            await scraperUneSource(fresh);
          } catch (err) {
            logger.error(`🔍 Veille cron erreur ${fresh.nom}: ${err.message}`);
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    });

    scheduledJobs.set(cronExpr, job);
    logger.info(`🔍 Cron veille [${cronExpr}] : ${names}`);
  }
}

/**
 * Initialiser le job cron
 */
function initialiser(database) {
  db = database;
  planifierCrons();
  logger.info(`🔍 Job veille initialisé (${scheduledJobs.size} cron(s) planifié(s))`);
}

module.exports = {
  initialiser,
  scraperToutesSources,
  scraperUneSource,
  planifierCrons,
};
