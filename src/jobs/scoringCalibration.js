/**
 * scoringCalibration.js — Calibration hebdomadaire du scoring veille
 *
 * Calcule pour chaque type de signal sa valeur prédictive empirique :
 * ratio won/(won+lost) pour les opportunités où ce signal était présent.
 *
 * Ne modifie PAS les poids automatiquement (humain dans la boucle).
 * Génère un rapport avec recommandations d'ajustement.
 *
 * Fréquence : 1x/semaine (dimanche 22h)
 */

const logger = require('../config/logger');

/**
 * Calcule les métriques de calibration du scoring.
 *
 * @param {Object} db
 * @returns {Object} { signalMetrics, overallMetrics, recommendations, generatedAt }
 */
function computeCalibration(db) {
  const generatedAt = new Date().toISOString();

  // ─── Métriques globales ─────────────────────────────────────────────────

  const totalOpps = db.prepare('SELECT COUNT(*) as n FROM veille_opportunities').get().n;
  const wonCount = db.prepare("SELECT COUNT(*) as n FROM veille_scoring_feedback WHERE feedback_type = 'won'").get().n;
  const lostCount = db.prepare("SELECT COUNT(*) as n FROM veille_scoring_feedback WHERE feedback_type = 'lost'").get().n;
  const notRelevant = db.prepare("SELECT COUNT(*) as n FROM veille_scoring_feedback WHERE feedback_type = 'not_relevant'").get().n;
  const wrongContact = db.prepare("SELECT COUNT(*) as n FROM veille_scoring_feedback WHERE feedback_type = 'wrong_contact'").get().n;
  const totalFeedback = wonCount + lostCount + notRelevant + wrongContact;

  const overallMetrics = {
    total_opportunities: totalOpps,
    total_feedback: totalFeedback,
    won: wonCount,
    lost: lostCount,
    not_relevant: notRelevant,
    wrong_contact: wrongContact,
    win_rate: totalFeedback > 0 ? Math.round((wonCount / (wonCount + lostCount + notRelevant)) * 100) : null,
    statistically_significant: totalFeedback >= 20,
  };

  // ─── Métriques par type de signal ───────────────────────────────────────

  // Récupérer tous les types de signaux distincts
  const signalTypes = db.prepare(`
    SELECT DISTINCT signal_type FROM veille_signals WHERE signal_type IS NOT NULL
    UNION
    SELECT DISTINCT signal_type FROM veille_opportunities WHERE signal_type IS NOT NULL
  `).all().map(r => r.signal_type);

  const signalMetrics = [];

  for (const signalType of signalTypes) {
    // Opportunités qui ont ce type de signal
    const oppsWithSignal = db.prepare(`
      SELECT DISTINCT o.id FROM veille_opportunities o
      LEFT JOIN veille_signals s ON s.opportunity_id = o.id
      WHERE o.signal_type = ? OR s.signal_type = ?
    `).all(signalType, signalType).map(r => r.id);

    if (oppsWithSignal.length === 0) continue;

    // Feedbacks pour ces opportunités
    const placeholders = oppsWithSignal.map(() => '?').join(',');
    const feedbacks = db.prepare(`
      SELECT feedback_type, COUNT(*) as n
      FROM veille_scoring_feedback
      WHERE opportunity_id IN (${placeholders})
      GROUP BY feedback_type
    `).all(...oppsWithSignal);

    const fbMap = {};
    for (const f of feedbacks) fbMap[f.feedback_type] = f.n;

    const won = fbMap['won'] || 0;
    const lost = fbMap['lost'] || 0;
    const nr = fbMap['not_relevant'] || 0;
    const total = won + lost + nr;

    // Score moyen des opportunités avec ce signal
    const avgScore = db.prepare(`
      SELECT AVG(business_score) as avg FROM veille_opportunities WHERE id IN (${placeholders})
    `).get(...oppsWithSignal).avg;

    signalMetrics.push({
      signal_type: signalType,
      opportunities_count: oppsWithSignal.length,
      feedback_count: total,
      won,
      lost,
      not_relevant: nr,
      win_rate: total > 0 ? Math.round((won / total) * 100) : null,
      avg_business_score: Math.round(avgScore || 0),
      significant: total >= 5,
    });
  }

  // Trier par win_rate décroissant
  signalMetrics.sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0));

  // ─── Recommandations ────────────────────────────────────────────────────

  const recommendations = [];

  if (totalFeedback < 20) {
    recommendations.push({
      type: 'warning',
      message: `Seulement ${totalFeedback} feedbacks enregistrés. Minimum 20 recommandés pour des ajustements fiables.`,
    });
  }

  for (const m of signalMetrics) {
    if (!m.significant) continue;

    if (m.win_rate !== null && m.win_rate >= 60) {
      recommendations.push({
        type: 'increase',
        signal_type: m.signal_type,
        message: `${m.signal_type} a un taux de conversion de ${m.win_rate}% (${m.won}/${m.won + m.lost + m.not_relevant}). Envisager d'augmenter son poids.`,
        current_win_rate: m.win_rate,
      });
    }

    if (m.win_rate !== null && m.win_rate <= 15 && m.feedback_count >= 10) {
      recommendations.push({
        type: 'decrease',
        signal_type: m.signal_type,
        message: `${m.signal_type} n'a qu'un taux de ${m.win_rate}% (${m.won}/${m.won + m.lost + m.not_relevant}). Envisager de baisser son poids.`,
        current_win_rate: m.win_rate,
      });
    }
  }

  // Wrong contact rate
  if (wrongContact > 0 && totalFeedback > 0) {
    const wcRate = Math.round((wrongContact / totalFeedback) * 100);
    if (wcRate >= 30) {
      recommendations.push({
        type: 'contact_quality',
        message: `${wcRate}% des feedbacks sont "mauvais contact". Améliorer le pipeline de recherche de contacts.`,
      });
    }
  }

  return {
    signalMetrics,
    overallMetrics,
    recommendations,
    generatedAt,
  };
}

/**
 * Sauvegarde le dernier rapport de calibration dans la config.
 */
function saveCalibrationReport(db) {
  try {
    const report = computeCalibration(db);
    db.prepare("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('veille_calibration_report', ?)")
      .run(JSON.stringify(report));
    logger.info(`Scoring calibration: ${report.signalMetrics.length} types analysés, ${report.recommendations.length} recommandation(s)`);
    return report;
  } catch (err) {
    logger.error(`Scoring calibration: ${err.message}`);
    return { error: err.message };
  }
}

/**
 * Récupère le dernier rapport de calibration.
 */
function getLastCalibrationReport(db) {
  try {
    const row = db.prepare("SELECT valeur FROM config WHERE cle = 'veille_calibration_report'").get();
    return row?.valeur ? JSON.parse(row.valeur) : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  computeCalibration,
  saveCalibrationReport,
  getLastCalibrationReport,
};
