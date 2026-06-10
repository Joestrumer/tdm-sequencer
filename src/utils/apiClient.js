/**
 * apiClient.js — Wrapper centralisé pour les appels API externes
 *
 * Fonctionnalités :
 * - Rate limiting par service (token bucket)
 * - Retry exponentiel avec backoff
 * - Suivi des coûts API (crédits/requêtes) en base
 * - Blocage si quota mensuel dépassé (configurable)
 * - Logs structurés pour debug Railway
 *
 * Services gérés : brave, google_places, pappers, zerobounce, amadeus
 */

const logger = require('../config/logger');

// ─── Configuration par service ──────────────────────────────────────────────

const SERVICE_DEFAULTS = {
  brave: {
    label: 'Brave Search',
    rateLimit: 1,            // req/sec
    ratePeriod: 1200,        // ms entre requêtes
    monthlyQuota: 2000,      // requêtes gratuites/mois
    costPerRequest: 0,       // inclus dans le plan
    retries: 3,
  },
  google_places: {
    label: 'Google Places',
    rateLimit: 10,
    ratePeriod: 100,
    monthlyQuota: 1000,
    costPerRequest: 0.017,   // ~$17/1000 Place Details
    retries: 2,
  },
  pappers: {
    label: 'Pappers',
    rateLimit: 2,
    ratePeriod: 500,
    monthlyQuota: 100,       // tier gratuit
    costPerRequest: 0,
    retries: 2,
  },
  zerobounce: {
    label: 'ZeroBounce',
    rateLimit: 10,
    ratePeriod: 100,
    monthlyQuota: 2000,
    costPerRequest: 0.008,   // ~$15/2000 crédits
    retries: 2,
  },
  amadeus: {
    label: 'Amadeus',
    rateLimit: 5,
    ratePeriod: 200,
    monthlyQuota: 10000,     // tier gratuit
    costPerRequest: 0,
    retries: 3,
  },
  instagram: {
    label: 'Instagram',
    rateLimit: 1,
    ratePeriod: 2500,        // 2.5s entre requêtes
    monthlyQuota: 5000,
    costPerRequest: 0,
    retries: 3,
  },
};

// ─── État interne — timestamps dernières requêtes par service ────────────────

const lastRequestTime = {};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Récupère le compteur de requêtes du mois courant pour un service.
 */
function getMonthlyUsage(db, service) {
  const month = getCurrentMonth();
  const key = `api_usage_${service}_${month}`;
  try {
    const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get(key);
    return row?.valeur ? JSON.parse(row.valeur) : { requests: 0, cost: 0 };
  } catch (_) {
    return { requests: 0, cost: 0 };
  }
}

/**
 * Incrémente le compteur de requêtes du mois courant.
 */
function incrementUsage(db, service, cost = 0) {
  const month = getCurrentMonth();
  const key = `api_usage_${service}_${month}`;
  try {
    const current = getMonthlyUsage(db, service);
    current.requests += 1;
    current.cost = Math.round((current.cost + cost) * 1000) / 1000;
    db.prepare("INSERT OR REPLACE INTO config (cle, valeur) VALUES (?, ?)")
      .run(key, JSON.stringify(current));
  } catch (_) { /* ignore */ }
}

/**
 * Récupère le quota mensuel configuré pour un service (config ou défaut).
 */
function getQuota(db, service) {
  try {
    const row = db.prepare('SELECT valeur FROM config WHERE cle = ?')
      .get(`api_quota_${service}`);
    if (row?.valeur) return parseInt(row.valeur, 10);
  } catch (_) { /* ignore */ }
  return SERVICE_DEFAULTS[service]?.monthlyQuota || Infinity;
}

// ─── Rate limiter (token bucket simple) ─────────────────────────────────────

async function waitForRateLimit(service) {
  const config = SERVICE_DEFAULTS[service];
  if (!config) return;

  const now = Date.now();
  const last = lastRequestTime[service] || 0;
  const minInterval = config.ratePeriod;
  const wait = Math.max(0, minInterval - (now - last));

  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  lastRequestTime[service] = Date.now();
}

// ─── Retry avec backoff exponentiel ─────────────────────────────────────────

async function withRetry(fn, retries, serviceName) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        logger.warn(`${serviceName}: retry ${i + 1}/${retries} dans ${delay}ms — ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ─── Fonction principale — apiCall ──────────────────────────────────────────

/**
 * Effectue un appel API avec rate limiting, retry et suivi des coûts.
 *
 * @param {Object} db - Instance SQLite
 * @param {string} service - Nom du service (brave, google_places, pappers, zerobounce, amadeus)
 * @param {Function} fn - Fonction async qui effectue l'appel réel
 * @param {Object} options - { skipQuotaCheck, customCost, label }
 * @returns {*} Résultat de fn()
 * @throws Si quota dépassé ou si tous les retries échouent
 */
async function apiCall(db, service, fn, options = {}) {
  const config = SERVICE_DEFAULTS[service];
  if (!config) {
    logger.warn(`apiClient: service inconnu '${service}', appel direct`);
    return fn();
  }

  // Vérification quota
  if (!options.skipQuotaCheck) {
    const usage = getMonthlyUsage(db, service);
    const quota = getQuota(db, service);
    if (usage.requests >= quota) {
      const msg = `${config.label}: quota mensuel atteint (${usage.requests}/${quota})`;
      logger.warn(msg);
      throw new Error(msg);
    }
  }

  // Rate limiting
  await waitForRateLimit(service);

  // Exécution avec retry
  const retries = config.retries || 2;
  const label = options.label || config.label;
  const result = await withRetry(fn, retries, label);

  // Enregistrer l'usage
  const cost = options.customCost ?? config.costPerRequest;
  incrementUsage(db, service, cost);

  return result;
}

// ─── Statistiques globales ──────────────────────────────────────────────────

/**
 * Récupère les stats d'utilisation API pour le mois courant.
 */
function getApiStats(db) {
  const month = getCurrentMonth();
  const stats = {};

  for (const [service, config] of Object.entries(SERVICE_DEFAULTS)) {
    const usage = getMonthlyUsage(db, service);
    const quota = getQuota(db, service);
    stats[service] = {
      label: config.label,
      requests: usage.requests,
      cost: usage.cost,
      quota,
      remaining: Math.max(0, quota - usage.requests),
      percentUsed: quota > 0 ? Math.round((usage.requests / quota) * 100) : 0,
    };
  }

  return { month, services: stats };
}

/**
 * Récupère l'historique d'utilisation sur les N derniers mois.
 */
function getApiHistory(db, months = 6) {
  const history = [];
  const now = new Date();

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthData = { month, services: {} };

    for (const service of Object.keys(SERVICE_DEFAULTS)) {
      const key = `api_usage_${service}_${month}`;
      try {
        const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get(key);
        monthData.services[service] = row?.valeur ? JSON.parse(row.valeur) : { requests: 0, cost: 0 };
      } catch (_) {
        monthData.services[service] = { requests: 0, cost: 0 };
      }
    }

    history.push(monthData);
  }

  return history;
}

// ─── Suivi détaillé Brave par source ─────────────────────────────────────────

/**
 * Enregistre un appel Brave API avec sa source d'origine.
 * @param {Object} db - Instance SQLite
 * @param {string} source - Identifiant de la source (veille, linkedin_contacts, email_patterns, signal_boamp, signal_linkedin)
 */
function trackBraveCall(db, source) {
  if (!db || !source) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    db.prepare(`
      INSERT INTO api_brave_daily (date, source, requests)
      VALUES (?, ?, 1)
      ON CONFLICT(date, source) DO UPDATE SET requests = requests + 1
    `).run(today, source);
  } catch (_) { /* table peut ne pas exister sur anciennes bases */ }

  // Incrémenter aussi le compteur mensuel global existant
  incrementUsage(db, 'brave', 0);
}

/**
 * Récupère le détail d'utilisation Brave par source pour les N derniers jours.
 */
function getBraveUsageDetail(db, days = 30) {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    // Par source (total sur la période)
    const bySource = db.prepare(`
      SELECT source, SUM(requests) as total
      FROM api_brave_daily
      WHERE date >= ?
      GROUP BY source
      ORDER BY total DESC
    `).all(since);

    // Par jour (total toutes sources)
    const byDay = db.prepare(`
      SELECT date, SUM(requests) as total
      FROM api_brave_daily
      WHERE date >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(since);

    // Par jour et source (pour le graphe détaillé)
    const byDaySource = db.prepare(`
      SELECT date, source, requests
      FROM api_brave_daily
      WHERE date >= ?
      ORDER BY date ASC, source
    `).all(since);

    // Total
    const totalRow = db.prepare(`
      SELECT COALESCE(SUM(requests), 0) as total
      FROM api_brave_daily
      WHERE date >= ?
    `).get(since);

    // Aujourd'hui
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = db.prepare(`
      SELECT COALESCE(SUM(requests), 0) as total
      FROM api_brave_daily
      WHERE date = ?
    `).get(today);

    return {
      period_days: days,
      since,
      total: totalRow.total,
      today: todayRow.total,
      by_source: bySource,
      by_day: byDay,
      by_day_source: byDaySource,
    };
  } catch (_) {
    return { period_days: days, total: 0, today: 0, by_source: [], by_day: [], by_day_source: [] };
  }
}

module.exports = {
  apiCall,
  getApiStats,
  getApiHistory,
  getMonthlyUsage,
  getQuota,
  trackBraveCall,
  getBraveUsageDetail,
  SERVICE_DEFAULTS,
};
