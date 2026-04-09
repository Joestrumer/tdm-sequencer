/**
 * veilleOpportunity.js — Gestion des opportunités commerciales
 *
 * Responsabilités :
 * - Fingerprint métier : normalize(hotel_name) + normalize(city) + signal_type + project_quarter
 * - Création / fusion d'opportunités depuis articles enrichis
 * - Scoring hybride (signal, fraîcheur, entité, sources, segment)
 * - Angle commercial recommandé
 */

const { randomUUID } = require('crypto');
const logger = require('../config/logger');
const { normalizeText } = require('./veilleEnrichment');

// ─── Fingerprint métier ─────────────────────────────────────────────────────

/**
 * Génère un fingerprint unique pour une opportunité.
 * Même hôtel + même ville + même semestre = même opportunité.
 *
 * IMPORTANT : signal_type n'est PAS dans le fingerprint.
 * Ainsi "rénovation" + "nomination" du même hôtel fusionnent
 * dans une seule opportunité multi-signaux.
 */
function buildFingerprint({ hotel_name, city, project_date }) {
  const parts = [];

  // Entité
  if (hotel_name) {
    parts.push(normalizeText(hotel_name));
  }

  // Lieu
  if (city) {
    parts.push(normalizeText(city));
  }

  // Fenêtre temporelle : semestre du projet ou semestre courant (plus large que trimestre)
  let semester;
  if (project_date && /^\d{4}$/.test(project_date)) {
    semester = `${project_date}-S0`; // Année seule → S0
  } else {
    const now = new Date();
    const s = now.getMonth() < 6 ? 1 : 2;
    semester = `${now.getFullYear()}-S${s}`;
  }
  parts.push(semester);

  return parts.join('|');
}

// ─── Scoring hybride ────────────────────────────────────────────────────────

/**
 * Score business sur 100.
 * Composantes :
 * - signal principal   : 0-25 pts
 * - signaux composites : 0-35 pts (bonus multi-signaux)
 * - fraîcheur          : 0-15 pts
 * - entité détectée    : 0-15 pts
 * - sources convergentes : 0-15 pts
 * - segment premium    : 0-10 pts
 * - date projet        : 0-10 pts
 * - confiance          : 0-5 pts
 *
 * Plafonné à 100.
 */
function computeBusinessScore(opp) {
  let score = 0;

  // Extraire les signaux (supporting_signals est un JSON array de types)
  const signals = parseSignals(opp.supporting_signals);
  const signalSet = new Set(signals);
  const primarySignal = opp.signal_type || (signals[0]) || 'autre';

  // 1. Type de signal principal (max 25)
  const signalScores = {
    renovation: 25,
    acquisition: 22,
    nomination: 20,
    conversion: 20,
    ouverture: 18,
    boamp_travaux: 25,
    recrutement: 12,
    fermeture_temp: 5,
    spa_wellness: 15,
    architecte: 18,
    vente: 22,
    autre: 3,
  };
  score += signalScores[primarySignal] || 3;

  // 2. Bonus signaux composites (max 35)
  // Le vrai avantage concurrentiel vient des combinaisons
  const numSignals = signalSet.size;
  if (numSignals >= 3) score += 35;
  else if (numSignals >= 2) score += 20;

  // Combos spécifiques
  if (signalSet.has('fermeture_temp') && signalSet.has('renovation')) score += 15;
  if (signalSet.has('renovation') && signalSet.has('architecte')) score += 15;
  if (signalSet.has('renovation') && signalSet.has('recrutement')) score += 10;
  if (signalSet.has('vente') && (signalSet.has('ouverture') || signalSet.has('renovation'))) score += 15;
  if (signalSet.has('boamp_travaux') && opp.hotel_name) score += 15;
  if (signalSet.has('nomination') && signalSet.has('renovation')) score += 10;

  // 3. Fraîcheur (max 15) — basée sur first_seen_at
  if (opp.first_seen_at) {
    const ageMs = Date.now() - new Date(opp.first_seen_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays <= 1) score += 15;
    else if (ageDays <= 3) score += 12;
    else if (ageDays <= 7) score += 8;
    else if (ageDays <= 14) score += 5;
    else if (ageDays <= 30) score += 2;
  }

  // 4. Entité détectée (max 15)
  if (opp.hotel_name) score += 8;
  if (opp.city) score += 4;
  if (opp.group_name) score += 3;

  // 5. Nombre de sources (max 15)
  const sc = opp.source_count || 1;
  if (sc >= 4) score += 15;
  else if (sc >= 3) score += 12;
  else if (sc >= 2) score += 8;
  else score += 3;

  // 6. Segment premium (max 10)
  const premiumKeywords = ['palace', '5 étoiles', '5*', 'luxe', 'boutique-hôtel', 'boutique hôtel', 'relais & châteaux'];
  const oppText = `${opp.hotel_name || ''} ${opp.group_name || ''} ${opp.brand_name || ''}`.toLowerCase();
  if (premiumKeywords.some(k => oppText.includes(k))) {
    score += 10;
  }

  // 7. Date projet connue (max 10)
  if (opp.project_date) score += 10;

  // 8. Confiance (max 5)
  if (opp.hotel_name && opp.city && primarySignal !== 'autre') score += 5;
  else if (opp.hotel_name || opp.city) score += 2;

  return Math.min(100, score);
}

/**
 * Parse supporting_signals (JSON array ou string)
 */
function parseSignals(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch (_) { return []; }
}

/**
 * Score de confiance sur 100.
 * Mesure la fiabilité de l'extraction.
 */
function computeConfidenceScore(opp) {
  let score = 0;

  if (opp.hotel_name) score += 25;
  if (opp.city) score += 20;
  if (opp.group_name) score += 10;
  if (opp.signal_type && opp.signal_type !== 'autre') score += 20;
  if (opp.project_date) score += 10;

  // Multi-sources = plus fiable
  const sc = opp.source_count || 1;
  if (sc >= 3) score += 15;
  else if (sc >= 2) score += 10;
  else score += 5;

  return Math.min(100, score);
}

// ─── Angles recommandés ─────────────────────────────────────────────────────

const ANGLES = {
  renovation: 'Cohérence de repositionnement : accompagner la montée en gamme des amenities pour matcher le nouveau standing. Fenêtre de décision ouverte pendant les travaux.',
  ouverture: 'Mise en place du standard dès le lancement : se positionner avant que les choix fournisseurs soient figés. Proposer un kit de lancement adapté au positionnement.',
  nomination: 'Nouveau décideur = remise à plat des choix historiques. Fenêtre courte (3-6 mois) pour se présenter avec une proposition fraîche.',
  acquisition: 'Changement de propriétaire = arbitrages image, expérience, fournisseurs. Période de transition favorable à de nouveaux partenaires.',
  vente: 'Cession/vente = période de transition. Nouveau propriétaire fera des arbitrages image et fournisseurs. Se positionner avant la reprise.',
  conversion: 'Changement d\'enseigne = obligations de brand standards. Les amenities sont souvent imposées ou recommandées — se positionner comme alternative premium compatible.',
  spa_wellness: 'Extension spa/wellness = besoin de gammes dédiées bien-être. Proposer la ligne spa/resort avec personnalisation aux codes de l\'établissement.',
  boamp_travaux: 'Marché public de travaux hôteliers = budget validé, calendrier ferme. Identifier le maître d\'ouvrage et proposer avant l\'appel d\'offres amenities.',
  architecte: 'Architecte/designer identifié = phase de conception. Se positionner comme fournisseur premium compatible avec la direction artistique.',
  recrutement: 'Recrutement lié à transformation = établissement en mouvement. Fenêtre de contact via le nouveau DG/directeur.',
  fermeture_temp: 'Fermeture temporaire = signal faible seul, mais fort si corroboré (rénovation, recrutement). Vérifier le contexte.',
  autre: 'Signal à qualifier. Vérifier le contexte commercial avant approche.',
};

function getRecommendedAngle(signal_type) {
  return ANGLES[signal_type] || ANGLES.autre;
}

// ─── Dérivation priorité depuis score ───────────────────────────────────────

function derivePriority(businessScore) {
  if (businessScore >= 60) return 'A';
  if (businessScore >= 35) return 'B';
  return 'C';
}

// ─── Création / fusion opportunité ──────────────────────────────────────────

function upsertOpportunity(db, articleData) {
  const {
    article_id, hotel_name, city, region, group_name,
    signal_type, signal_subtype, project_date
  } = articleData;

  const fingerprint = buildFingerprint({ hotel_name, city, project_date });

  // Si pas d'hôtel ET pas de ville → pas assez pour créer une opportunité
  if (!hotel_name && !city) {
    return null;
  }

  const existing = db.prepare('SELECT * FROM veille_opportunities WHERE fingerprint = ?').get(fingerprint);
  const now = new Date().toISOString();

  if (existing) {
    // Fusion : mettre à jour l'opportunité existante
    const updates = [];
    const params = [];

    // Enrichir les champs manquants
    if (!existing.hotel_name && hotel_name) {
      updates.push('hotel_name = ?'); params.push(hotel_name);
      updates.push('hotel_name_normalized = ?'); params.push(normalizeText(hotel_name));
    }
    if (!existing.city && city) { updates.push('city = ?'); params.push(city); }
    if (!existing.region && region) { updates.push('region = ?'); params.push(region); }
    if (!existing.group_name && group_name) { updates.push('group_name = ?'); params.push(group_name); }
    if (!existing.project_date && project_date) { updates.push('project_date = ?'); params.push(project_date); }
    if (signal_subtype && !existing.signal_subtype) { updates.push('signal_subtype = ?'); params.push(signal_subtype); }

    // Fusionner les supporting_signals (ajouter le nouveau signal s'il est différent)
    const existingSignals = parseSignals(existing.supporting_signals);
    if (signal_type && !existingSignals.includes(signal_type)) {
      existingSignals.push(signal_type);
      updates.push('supporting_signals = ?'); params.push(JSON.stringify(existingSignals));
    }

    // signal_type principal = le signal le plus "fort" parmi tous
    const bestSignal = pickPrimarySignal(existingSignals);
    if (bestSignal !== existing.signal_type) {
      updates.push('signal_type = ?'); params.push(bestSignal);
    }

    // Toujours mettre à jour
    updates.push('last_seen_at = ?'); params.push(now);
    updates.push('source_count = source_count + 1');
    updates.push('updated_at = ?'); params.push(now);

    if (updates.length > 0) {
      params.push(existing.id);
      db.prepare(`UPDATE veille_opportunities SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    // Re-scorer après fusion
    const updated = db.prepare('SELECT * FROM veille_opportunities WHERE id = ?').get(existing.id);
    const businessScore = computeBusinessScore(updated);
    const confidenceScore = computeConfidenceScore(updated);
    const priority = derivePriority(businessScore);
    const angle = getRecommendedAngle(pickPrimarySignal(parseSignals(updated.supporting_signals)));

    db.prepare(`
      UPDATE veille_opportunities
      SET business_score = ?, confidence_score = ?, signal_strength = ?, priority = ?, recommended_angle = ?
      WHERE id = ?
    `).run(businessScore, confidenceScore, priority, priority, angle, existing.id);

    // Lier l'article
    try {
      db.prepare(`
        INSERT OR IGNORE INTO veille_opportunity_sources (id, opportunity_id, article_id)
        VALUES (?, ?, ?)
      `).run(randomUUID(), existing.id, article_id);
    } catch (_) {}

    // Mettre à jour l'article
    try {
      db.prepare('UPDATE veille_articles SET opportunity_id = ? WHERE id = ?').run(existing.id, article_id);
    } catch (_) {}

    const updatedSignals = parseSignals(updated.supporting_signals);
    logger.info(`Veille opp: fusion ${existing.id} (${hotel_name || '?'} / ${city || '?'}) — ${updated.source_count + 1} sources, signaux: [${updatedSignals.join(', ')}]`);
    return existing.id;

  } else {
    // Création
    const id = randomUUID();
    const supportingSignals = signal_type ? [signal_type] : [];
    const angle = getRecommendedAngle(signal_type);

    const oppData = {
      id,
      fingerprint,
      hotel_name,
      hotel_name_normalized: hotel_name ? normalizeText(hotel_name) : null,
      city,
      region,
      country: 'FR',
      group_name,
      brand_name: null,
      owner_name: null,
      operator_name: null,
      signal_type: signal_type || 'autre',
      signal_subtype: signal_subtype || null,
      signal_strength: 'medium',
      supporting_signals: JSON.stringify(supportingSignals),
      project_date: project_date || null,
      first_seen_at: now,
      last_seen_at: now,
      source_count: 1,
      confidence_score: 0,
      business_score: 0,
      recommended_angle: angle,
      status: 'new',
      priority: 'C',
    };

    // Calculer les scores
    oppData.business_score = computeBusinessScore(oppData);
    oppData.confidence_score = computeConfidenceScore(oppData);
    oppData.signal_strength = derivePriority(oppData.business_score);
    oppData.priority = oppData.signal_strength;

    db.prepare(`
      INSERT INTO veille_opportunities (
        id, fingerprint, hotel_name, hotel_name_normalized, city, region, country,
        group_name, brand_name, owner_name, operator_name,
        signal_type, signal_subtype, signal_strength, supporting_signals,
        project_date, first_seen_at, last_seen_at, source_count,
        confidence_score, business_score, recommended_angle, status, priority
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      oppData.id, oppData.fingerprint, oppData.hotel_name, oppData.hotel_name_normalized,
      oppData.city, oppData.region, oppData.country,
      oppData.group_name, oppData.brand_name, oppData.owner_name, oppData.operator_name,
      oppData.signal_type, oppData.signal_subtype, oppData.signal_strength, oppData.supporting_signals,
      oppData.project_date, oppData.first_seen_at, oppData.last_seen_at, oppData.source_count,
      oppData.confidence_score, oppData.business_score, oppData.recommended_angle, oppData.status, oppData.priority
    );

    // Lier l'article
    try {
      db.prepare(`
        INSERT OR IGNORE INTO veille_opportunity_sources (id, opportunity_id, article_id)
        VALUES (?, ?, ?)
      `).run(randomUUID(), id, article_id);
    } catch (_) {}

    // Mettre à jour l'article
    try {
      db.prepare('UPDATE veille_articles SET opportunity_id = ? WHERE id = ?').run(id, article_id);
    } catch (_) {}

    logger.info(`Veille opp: nouvelle ${id} — ${hotel_name || '?'} / ${city || '?'} / ${signal_type} (score=${oppData.business_score})`);
    return id;
  }
}

/**
 * Choisir le signal principal parmi les supporting_signals.
 * Prend le signal avec le poids business le plus élevé.
 */
function pickPrimarySignal(signals) {
  const weights = {
    renovation: 10, boamp_travaux: 10, acquisition: 9, vente: 9,
    conversion: 8, nomination: 7, ouverture: 7, architecte: 6,
    spa_wellness: 5, recrutement: 4, fermeture_temp: 2, autre: 0,
  };
  if (!signals || signals.length === 0) return 'autre';
  return signals.reduce((best, s) => (weights[s] || 0) > (weights[best] || 0) ? s : best, signals[0]);
}

// ─── Pipeline : articles enrichis → opportunités ────────────────────────────

function processEnrichedArticles(db, limit = 50) {
  // Articles enrichis mais pas encore liés à une opportunité
  const articles = db.prepare(`
    SELECT id, titre, url, resume, hotel_name, city, group_name, signal_type,
           score_pertinence, priorite, source_id, content_full
    FROM veille_articles
    WHERE enriched = 1 AND opportunity_id IS NULL AND score_pertinence >= 3
    ORDER BY score_pertinence DESC
    LIMIT ?
  `).all(limit);

  if (articles.length === 0) return { processed: 0, opportunities_created: 0, opportunities_merged: 0 };

  let created = 0;
  let merged = 0;

  for (const article of articles) {
    const signal = { type: article.signal_type || 'autre', subtype: null };

    // Vérifier si l'hôtel ou la ville ont été extraits
    if (!article.hotel_name && !article.city) {
      // Pas assez d'info pour une opportunité — marquer comme traité
      try {
        db.prepare('UPDATE veille_articles SET opportunity_id = ? WHERE id = ?').run('none', article.id);
      } catch (_) {}
      continue;
    }

    const existingFp = buildFingerprint({
      hotel_name: article.hotel_name,
      city: article.city,
      project_date: null,
    });

    const existing = db.prepare('SELECT id FROM veille_opportunities WHERE fingerprint = ?').get(existingFp);

    const oppId = upsertOpportunity(db, {
      article_id: article.id,
      hotel_name: article.hotel_name,
      city: article.city,
      region: null, // sera enrichi par upsert
      group_name: article.group_name,
      signal_type: signal.type,
      signal_subtype: signal.subtype,
      project_date: null,
    });

    if (oppId) {
      if (existing) merged++;
      else created++;
    }
  }

  logger.info(`Veille opp pipeline: ${articles.length} traités, ${created} créées, ${merged} fusionnées`);
  return { processed: articles.length, opportunities_created: created, opportunities_merged: merged };
}

module.exports = {
  buildFingerprint,
  computeBusinessScore,
  computeConfidenceScore,
  derivePriority,
  getRecommendedAngle,
  pickPrimarySignal,
  parseSignals,
  upsertOpportunity,
  processEnrichedArticles,
};
