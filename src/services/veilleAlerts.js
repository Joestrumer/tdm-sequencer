/**
 * veilleAlerts.js — Alertes proactives pour les opportunités haute valeur
 *
 * Détecte :
 * - Nouvelles opportunités avec business_score >= seuil (configurable)
 * - Hôtels déjà dans HubSpot recevant un nouveau signal majeur
 *
 * Les alertes sont stockées en base pour affichage UI.
 * L'envoi par email est optionnel (via Brevo si configuré).
 *
 * Fréquence : vérifié toutes les heures via cron
 */

const logger = require('../config/logger');
const { randomUUID } = require('crypto');

const DEFAULT_SCORE_THRESHOLD = 80;

/**
 * Vérifie les nouvelles alertes depuis la dernière vérification.
 *
 * @param {Object} db
 * @param {Object} options - { scoreThreshold }
 * @returns {Object} { newAlerts, totalPending }
 */
function checkAlerts(db, options = {}) {
  const threshold = options.scoreThreshold || DEFAULT_SCORE_THRESHOLD;

  // Récupérer la date de dernière vérification
  let lastCheck;
  try {
    const row = db.prepare("SELECT valeur FROM config WHERE cle = 'veille_alerts_last_check'").get();
    lastCheck = row?.valeur || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  } catch (_) {
    lastCheck = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }

  const alerts = [];

  // 1. Nouvelles opportunités haute valeur
  try {
    const newHighOpps = db.prepare(`
      SELECT id, hotel_name, city, signal_type, business_score, source_count, recommended_angle
      FROM veille_opportunities
      WHERE business_score >= ? AND first_seen_at >= ? AND status = 'new'
      ORDER BY business_score DESC
    `).all(threshold, lastCheck);

    for (const opp of newHighOpps) {
      alerts.push({
        id: randomUUID(),
        type: 'high_score_opportunity',
        opportunity_id: opp.id,
        title: `Nouvelle opportunité score ${opp.business_score}`,
        message: `${opp.hotel_name || 'Hôtel inconnu'} (${opp.city || '?'}) — ${opp.signal_type || 'signal'} — ${opp.source_count || 1} source(s)`,
        score: opp.business_score,
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    logger.warn(`Veille Alerts: erreur opps haute valeur: ${err.message}`);
  }

  // 2. Nouveaux signaux majeurs sur hôtels HubSpot
  try {
    const hubspotSignals = db.prepare(`
      SELECT s.id as signal_id, s.signal_type, s.signal_strength, s.hotel_name, s.city,
             o.id as opportunity_id, o.hubspot_company_id, o.business_score
      FROM veille_signals s
      JOIN veille_opportunities o ON o.id = s.opportunity_id
      WHERE s.detected_at >= ? AND o.hubspot_company_id IS NOT NULL AND s.signal_strength >= 75
      ORDER BY s.signal_strength DESC
    `).all(lastCheck);

    for (const sig of hubspotSignals) {
      alerts.push({
        id: randomUUID(),
        type: 'hubspot_new_signal',
        opportunity_id: sig.opportunity_id,
        signal_id: sig.signal_id,
        title: `Nouveau signal sur hôtel HubSpot`,
        message: `${sig.hotel_name || '?'} (${sig.city || '?'}) — ${sig.signal_type} (force ${sig.signal_strength}) — déjà dans HubSpot`,
        score: sig.business_score,
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    logger.warn(`Veille Alerts: erreur signaux HubSpot: ${err.message}`);
  }

  // Mettre à jour la date de dernière vérification
  try {
    db.prepare("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('veille_alerts_last_check', ?)")
      .run(new Date().toISOString());
  } catch (_) { /* ignore */ }

  if (alerts.length > 0) {
    logger.info(`Veille Alerts: ${alerts.length} nouvelle(s) alerte(s)`);
  }

  return {
    newAlerts: alerts,
    totalPending: alerts.length,
    lastCheck,
    threshold,
  };
}

/**
 * Récupère les alertes récentes (dernières 48h par défaut).
 */
function getRecentAlerts(db, options = {}) {
  const threshold = options.scoreThreshold || DEFAULT_SCORE_THRESHOLD;
  const hours = options.hours || 48;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Opportunités haute valeur récentes
  const highOpps = db.prepare(`
    SELECT id, hotel_name, city, signal_type, business_score, source_count,
           recommended_angle, first_seen_at, status, hubspot_company_id
    FROM veille_opportunities
    WHERE business_score >= ? AND first_seen_at >= ?
    ORDER BY business_score DESC
    LIMIT 20
  `).all(threshold, since);

  // Signaux majeurs récents
  const majorSignals = db.prepare(`
    SELECT s.*, o.hotel_name as opp_hotel_name, o.hubspot_company_id
    FROM veille_signals s
    LEFT JOIN veille_opportunities o ON o.id = s.opportunity_id
    WHERE s.detected_at >= ? AND s.signal_strength >= 75
    ORDER BY s.detected_at DESC
    LIMIT 20
  `).all(since);

  return {
    high_opportunities: highOpps,
    major_signals: majorSignals,
    threshold,
    since,
  };
}

module.exports = {
  checkAlerts,
  getRecentAlerts,
};
