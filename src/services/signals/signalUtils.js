/**
 * signalUtils.js — Utilitaires communs pour les détecteurs de signaux
 *
 * - Fingerprint signal (dédup)
 * - Insertion / upsert signal
 * - Liaison signal → opportunité
 * - Helpers config / API keys
 */

const { randomUUID } = require('crypto');
const logger = require('../../config/logger');

// ─── Fingerprint signal ──────────────────────────────────────────────────────

/**
 * Génère un fingerprint unique pour un signal.
 * Format : hotel_norm|city_norm|signal_type|YYYY-MM
 * Un même signal pour le même hôtel dans le même mois = dédup.
 */
function buildSignalFingerprint({ hotel_name, city, signal_type, signal_date }) {
  const normalize = s => (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '').trim();

  const parts = [
    normalize(hotel_name) || '_',
    normalize(city) || '_',
    signal_type || '_',
  ];

  // Mois du signal (ou mois courant)
  let month;
  if (signal_date) {
    const d = new Date(signal_date);
    if (!isNaN(d.getTime())) {
      month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
  }
  if (!month) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  parts.push(month);

  return parts.join('|');
}

// ─── Insertion signal ────────────────────────────────────────────────────────

/**
 * Insère un signal dans veille_signals (ignoré si fingerprint déjà existant).
 * @returns {string|null} id du signal inséré, ou null si doublon
 */
function insertSignal(db, {
  hotel_name, city, postcode, country,
  signal_type, signal_strength, source, source_url,
  raw_payload, signal_date, opportunity_id,
}) {
  const fingerprint = buildSignalFingerprint({ hotel_name, city, signal_type, signal_date });
  const id = randomUUID();
  const now = new Date().toISOString();

  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO veille_signals
        (id, hotel_name, city, postcode, country, signal_type, signal_strength,
         source, source_url, raw_payload, detected_at, signal_date, opportunity_id, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, hotel_name || null, city || null, postcode || null, country || 'FR',
      signal_type, signal_strength || 50,
      source, source_url || null,
      raw_payload ? JSON.stringify(raw_payload) : null,
      now, signal_date || null, opportunity_id || null, fingerprint
    );

    if (result.changes > 0) {
      logger.info(`Signal inséré: ${signal_type} — ${hotel_name || '?'} / ${city || '?'} (strength: ${signal_strength})`);
      return id;
    }
    // Doublon
    return null;
  } catch (err) {
    logger.warn(`Erreur insertion signal: ${err.message}`, { hotel_name, signal_type });
    return null;
  }
}

// ─── Batch insertion ─────────────────────────────────────────────────────────

/**
 * Insère plusieurs signaux en une transaction.
 * @returns {{ inserted: number, duplicates: number }}
 */
function insertSignalBatch(db, signals) {
  let inserted = 0;
  let duplicates = 0;

  const tx = db.transaction(() => {
    for (const sig of signals) {
      const id = insertSignal(db, sig);
      if (id) inserted++;
      else duplicates++;
    }
  });
  tx();

  return { inserted, duplicates };
}

// ─── Config helper ───────────────────────────────────────────────────────────

/**
 * Lire une valeur de config (table config ou env var).
 */
function getConfigValue(db, key, envKey, defaultValue) {
  try {
    const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get(key);
    return row?.valeur || process.env[envKey] || defaultValue;
  } catch (_) {
    return process.env[envKey] || defaultValue;
  }
}

// ─── Liaison signaux → opportunité ───────────────────────────────────────────

/**
 * Lie les signaux orphelins (opportunity_id IS NULL) aux opportunités existantes
 * en matchant hotel_name + city.
 */
function linkOrphanSignals(db) {
  const orphans = db.prepare(`
    SELECT id, hotel_name, city FROM veille_signals
    WHERE opportunity_id IS NULL AND hotel_name IS NOT NULL
  `).all();

  let linked = 0;
  for (const sig of orphans) {
    // Chercher une opportunité existante pour cet hôtel/ville
    const opp = db.prepare(`
      SELECT id FROM veille_opportunities
      WHERE hotel_name_normalized = ? AND city = ?
      LIMIT 1
    `).get(
      (sig.hotel_name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(),
      sig.city
    );

    if (opp) {
      db.prepare('UPDATE veille_signals SET opportunity_id = ? WHERE id = ?').run(opp.id, sig.id);
      linked++;
    }
  }

  if (linked > 0) logger.info(`Signaux orphelins liés: ${linked}/${orphans.length}`);
  return linked;
}

module.exports = {
  buildSignalFingerprint,
  insertSignal,
  insertSignalBatch,
  getConfigValue,
  linkOrphanSignals,
};
