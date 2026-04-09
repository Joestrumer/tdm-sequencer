/**
 * veilleScraper.js — Job cron de scraping des sources de veille hôtelière
 *
 * Passe 2 :
 * - Lock par source_id (pas de double exécution)
 * - Observabilité : chaque run historisé dans veille_source_runs
 * - Santé des sources calculée après chaque run
 * - Replanification automatique via planifierCrons()
 * - frequence_cron = champ canonique de fréquence
 */

const cron = require('node-cron');
const { randomUUID } = require('crypto');
const logger = require('../config/logger');
const { scraperSource, filtrerParMotsCles, sauvegarderArticles } = require('../services/veilleService');
const { enrichBatch } = require('../services/veilleEnrichment');
const { processEnrichedArticles } = require('../services/veilleOpportunity');

let db;
const scheduledJobs = new Map();
const runningLocks = new Set(); // Lock par source_id

// ─── Seuil de pertinence minimal ────────────────────────────────────────────
const SCORE_SEUIL = 3;

// ─── Observabilité : enregistrer un run ─────────────────────────────────────

function startRun(sourceId, triggerType) {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO veille_source_runs (id, source_id, started_at, status, trigger_type)
      VALUES (?, ?, ?, 'running', ?)
    `).run(id, sourceId, startedAt, triggerType);
  } catch (e) {
    logger.warn(`Veille: impossible de créer le run — ${e.message}`);
  }
  return { id, startedAt, startMs: Date.now() };
}

function finishRun(run, { status, itemsFound, itemsFiltered, itemsInserted, itemsDuplicate, errorMessage }) {
  const durationMs = Date.now() - run.startMs;
  try {
    db.prepare(`
      UPDATE veille_source_runs
      SET finished_at = ?, status = ?, duration_ms = ?,
          items_found = ?, items_filtered = ?, items_inserted = ?, items_duplicate = ?,
          error_message = ?
      WHERE id = ?
    `).run(
      new Date().toISOString(), status, durationMs,
      itemsFound || 0, itemsFiltered || 0, itemsInserted || 0, itemsDuplicate || 0,
      errorMessage || null,
      run.id
    );
  } catch (e) {
    logger.warn(`Veille: impossible de finaliser le run — ${e.message}`);
  }
  return durationMs;
}

// ─── Santé des sources ──────────────────────────────────────────────────────

function updateSourceHealth(sourceId) {
  try {
    // Regarder les 5 derniers runs
    const runs = db.prepare(`
      SELECT status FROM veille_source_runs
      WHERE source_id = ? ORDER BY started_at DESC LIMIT 5
    `).all(sourceId);

    if (runs.length === 0) {
      db.prepare('UPDATE veille_sources SET health_status = ? WHERE id = ?').run('unknown', sourceId);
      return;
    }

    const errors = runs.filter(r => r.status === 'error').length;
    let health;
    if (errors === 0) {
      health = 'healthy';
    } else if (errors <= 2) {
      health = 'degraded';
    } else {
      health = 'failing';
    }

    db.prepare('UPDATE veille_sources SET health_status = ? WHERE id = ?').run(health, sourceId);
  } catch (e) {
    logger.warn(`Veille: erreur calcul santé source — ${e.message}`);
  }
}

// ─── Scraper une source (avec lock + observabilité) ─────────────────────────

async function scraperUneSource(source, triggerType = 'cron') {
  // Lock par source_id
  if (runningLocks.has(source.id)) {
    logger.warn(`Veille: ${source.nom} déjà en cours, skip (trigger: ${triggerType})`);
    return { inserted: 0, skipped: true };
  }

  runningLocks.add(source.id);
  const run = startRun(source.id, triggerType);

  try {
    logger.info(`Veille: scraping ${source.nom} (${source.type}) [${triggerType}]`);

    const articles = await scraperSource(source, db);
    const itemsFound = articles ? articles.length : 0;

    if (!articles || articles.length === 0) {
      logger.info(`Veille: aucun article trouvé pour ${source.nom}`);
      finishRun(run, { status: 'success', itemsFound: 0 });
      updateSourceTimestamps(source.id, true);
      updateSourceHealth(source.id);
      return { inserted: 0, skipped: false };
    }

    const motsCles = typeof source.mots_cles === 'string' ? JSON.parse(source.mots_cles) : source.mots_cles;
    const articlesFiltres = filtrerParMotsCles(articles, motsCles);

    // Seuil de pertinence remonté à SCORE_SEUIL
    const articlesPertinents = articlesFiltres.filter(a => a.score_pertinence >= SCORE_SEUIL);
    const itemsFiltered = articlesFiltres.length - articlesPertinents.length;

    const inseres = sauvegarderArticles(db, source.id, articlesPertinents);
    const itemsDuplicate = articlesPertinents.length - inseres;

    const durationMs = finishRun(run, {
      status: 'success',
      itemsFound,
      itemsFiltered,
      itemsInserted: inseres,
      itemsDuplicate,
    });

    updateSourceTimestamps(source.id, true);
    updateSourceHealth(source.id);

    logger.info(`Veille: ${source.nom} — ${itemsFound} trouvés, ${articlesPertinents.length} pertinents (seuil>=${SCORE_SEUIL}), ${inseres} nouveaux, ${itemsDuplicate} doublons [${durationMs}ms]`);
    return { inserted: inseres, skipped: false };
  } catch (err) {
    finishRun(run, { status: 'error', errorMessage: err.message });
    updateSourceTimestamps(source.id, false);
    updateSourceHealth(source.id);
    logger.error(`Veille: erreur scraping ${source.nom} — ${err.message}`);
    return { inserted: 0, skipped: false, error: err.message };
  } finally {
    runningLocks.delete(source.id);
  }
}

function updateSourceTimestamps(sourceId, success) {
  try {
    if (success) {
      db.prepare(`
        UPDATE veille_sources
        SET last_run = datetime('now'), last_success_at = datetime('now'), error_count = 0
        WHERE id = ?
      `).run(sourceId);
    } else {
      db.prepare(`
        UPDATE veille_sources
        SET last_run = datetime('now'), last_error_at = datetime('now'), error_count = error_count + 1
        WHERE id = ?
      `).run(sourceId);
    }
  } catch (e) {
    logger.warn(`Veille: erreur mise à jour timestamps source — ${e.message}`);
  }
}

// ─── Scraper toutes les sources actives ─────────────────────────────────────

async function scraperToutesSources() {
  const sources = db.prepare('SELECT * FROM veille_sources WHERE actif = 1').all();
  if (sources.length === 0) {
    logger.info('Veille: aucune source active');
    return { total: 0, nouveaux: 0, skipped: 0 };
  }

  logger.info(`Veille: run-all de ${sources.length} source(s)`);
  let totalNouveaux = 0;
  let totalSkipped = 0;

  for (const source of sources) {
    const result = await scraperUneSource(source, 'run_all');
    totalNouveaux += result.inserted;
    if (result.skipped) totalSkipped++;
    if (sources.length > 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  logger.info(`Veille run-all terminé: ${totalNouveaux} nouveau(x), ${totalSkipped} skippé(s)`);
  return { total: sources.length, nouveaux: totalNouveaux, skipped: totalSkipped };
}

// ─── Planification des crons ────────────────────────────────────────────────

function planifierCrons() {
  if (!db) return;

  // Arrêter les jobs existants
  for (const [, job] of scheduledJobs) {
    job.stop();
  }
  scheduledJobs.clear();

  const sources = db.prepare('SELECT * FROM veille_sources WHERE actif = 1').all();
  const seenCrons = new Map();

  for (const source of sources) {
    const cronExpr = source.frequence_cron || '0 */6 * * *';
    if (!cron.validate(cronExpr)) {
      logger.warn(`Veille: cron invalide pour ${source.nom}: ${cronExpr}, skip`);
      continue;
    }

    if (!seenCrons.has(cronExpr)) {
      seenCrons.set(cronExpr, []);
    }
    seenCrons.get(cronExpr).push(source);
  }

  for (const [cronExpr, cronSources] of seenCrons) {
    const sourceIds = cronSources.map(s => s.id);
    const names = cronSources.map(s => s.nom).join(', ');

    const job = cron.schedule(cronExpr, async () => {
      for (const id of sourceIds) {
        const fresh = db.prepare('SELECT * FROM veille_sources WHERE id = ? AND actif = 1').get(id);
        if (fresh) {
          await scraperUneSource(fresh, 'cron');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    });

    scheduledJobs.set(cronExpr, job);
    logger.info(`Veille cron [${cronExpr}]: ${names}`);
  }

  logger.info(`Veille: ${scheduledJobs.size} cron(s) planifié(s)`);
}

// ─── Enrichissement + pipeline opportunités (cron séparé) ───────────────────

let enrichmentRunning = false;

async function runEnrichmentPipeline() {
  if (enrichmentRunning) {
    logger.warn('Veille enrichment: déjà en cours, skip');
    return;
  }
  enrichmentRunning = true;
  try {
    // 1. Enrichir les articles non encore traités
    const enrichResult = await enrichBatch(db, 15);

    // 2. Transformer les articles enrichis en opportunités
    const oppResult = processEnrichedArticles(db, 50);

    if (enrichResult.enriched > 0 || oppResult.processed > 0) {
      logger.info(`Veille pipeline: ${enrichResult.enriched} enrichi(s), ${oppResult.opportunities_created} opp créée(s), ${oppResult.opportunities_merged} fusionnée(s)`);
    }
  } catch (err) {
    logger.error(`Veille pipeline erreur: ${err.message}`);
  } finally {
    enrichmentRunning = false;
  }
}

// ─── Initialisation ─────────────────────────────────────────────────────────

function initialiser(database) {
  db = database;
  planifierCrons();

  // Cron enrichissement : toutes les 30 minutes
  cron.schedule('*/30 * * * *', () => {
    runEnrichmentPipeline();
  });
  logger.info('Veille: cron enrichissement planifié (toutes les 30 min)');
}

// ─── Status (pour debug / API) ──────────────────────────────────────────────

function getStatus() {
  return {
    crons: scheduledJobs.size,
    running: [...runningLocks],
    cronExpressions: [...scheduledJobs.keys()],
  };
}

module.exports = {
  initialiser,
  scraperToutesSources,
  scraperUneSource,
  planifierCrons,
  runEnrichmentPipeline,
  getStatus,
};
