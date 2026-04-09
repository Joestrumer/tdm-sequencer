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
 * Même hôtel + même ville + même signal + même trimestre = même opportunité.
 *
 * Si hotel_name absent, on utilise le titre normalisé (fallback dégradé).
 */
function buildFingerprint({ hotel_name, city, signal_type, project_date }) {
  const parts = [];

  // Entité
  if (hotel_name) {
    parts.push(normalizeText(hotel_name));
  }

  // Lieu
  if (city) {
    parts.push(normalizeText(city));
  }

  // Signal
  parts.push(signal_type || 'autre');

  // Fenêtre temporelle : trimestre du projet ou trimestre courant
  let quarter;
  if (project_date && /^\d{4}$/.test(project_date)) {
    quarter = `${project_date}-Q0`; // Année seule → Q0
  } else {
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3);
    quarter = `${now.getFullYear()}-Q${q}`;
  }
  parts.push(quarter);

  return parts.join('|');
}

// ─── Scoring hybride ────────────────────────────────────────────────────────

/**
 * Score business sur 100.
 * Composantes :
 * - signal_type       : 0-30 pts
 * - fraîcheur         : 0-15 pts
 * - entité détectée   : 0-15 pts
 * - source_count      : 0-15 pts
 * - segment premium   : 0-10 pts
 * - date projet       : 0-10 pts
 * - confiance         : 0-5 pts
 */
function computeBusinessScore(opp) {
  let score = 0;

  // 1. Type de signal (max 30)
  const signalScores = {
    renovation: 30,
    nomination: 25,
    acquisition: 25,
    conversion: 22,
    ouverture: 20,
    spa_wellness: 15,
    autre: 5,
  };
  score += signalScores[opp.signal_type] || 5;

  // 2. Fraîcheur (max 15) — basée sur first_seen_at
  if (opp.first_seen_at) {
    const ageMs = Date.now() - new Date(opp.first_seen_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays <= 1) score += 15;
    else if (ageDays <= 3) score += 12;
    else if (ageDays <= 7) score += 8;
    else if (ageDays <= 14) score += 5;
    else if (ageDays <= 30) score += 2;
  }

  // 3. Entité détectée (max 15)
  if (opp.hotel_name) score += 8;
  if (opp.city) score += 4;
  if (opp.group_name) score += 3;

  // 4. Nombre de sources (max 15)
  const sc = opp.source_count || 1;
  if (sc >= 4) score += 15;
  else if (sc >= 3) score += 12;
  else if (sc >= 2) score += 8;
  else score += 3;

  // 5. Segment premium (max 10) — détecté via mots-clés dans le titre/resume
  const premiumKeywords = ['palace', '5 étoiles', '5*', 'luxe', 'boutique-hôtel', 'boutique hôtel', 'relais & châteaux'];
  const oppText = `${opp.hotel_name || ''} ${opp.group_name || ''} ${opp.brand_name || ''}`.toLowerCase();
  if (premiumKeywords.some(k => oppText.includes(k))) {
    score += 10;
  }

  // 6. Date projet connue (max 10)
  if (opp.project_date) score += 10;

  // 7. Confiance (max 5) — simple heuristique
  if (opp.hotel_name && opp.city && opp.signal_type !== 'autre') score += 5;
  else if (opp.hotel_name || opp.city) score += 2;

  return Math.min(100, score);
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
  conversion: 'Changement d\'enseigne = obligations de brand standards. Les amenities sont souvent imposées ou recommandées — se positionner comme alternative premium compatible.',
  spa_wellness: 'Extension spa/wellness = besoin de gammes dédiées bien-être. Proposer la ligne spa/resort avec personnalisation aux codes de l\'établissement.',
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

  const fingerprint = buildFingerprint({ hotel_name, city, signal_type, project_date });

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
    if (!existing.hotel_name && hotel_name) { updates.push('hotel_name = ?'); params.push(hotel_name); }
    if (!existing.city && city) { updates.push('city = ?'); params.push(city); }
    if (!existing.region && region) { updates.push('region = ?'); params.push(region); }
    if (!existing.group_name && group_name) { updates.push('group_name = ?'); params.push(group_name); }
    if (!existing.project_date && project_date) { updates.push('project_date = ?'); params.push(project_date); }
    if (signal_subtype && !existing.signal_subtype) { updates.push('signal_subtype = ?'); params.push(signal_subtype); }

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
    const strength = derivePriority(businessScore);
    const angle = getRecommendedAngle(updated.signal_type);

    db.prepare(`
      UPDATE veille_opportunities
      SET business_score = ?, confidence_score = ?, signal_strength = ?, recommended_angle = ?
      WHERE id = ?
    `).run(businessScore, confidenceScore, strength, angle, existing.id);

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

    logger.info(`Veille opp: fusion ${existing.id} (${hotel_name || '?'} / ${city || '?'}) — ${updated.source_count + 1} sources`);
    return existing.id;

  } else {
    // Création
    const id = randomUUID();
    const angle = getRecommendedAngle(signal_type);

    const oppData = {
      id,
      fingerprint,
      hotel_name,
      city,
      region,
      country: 'FR',
      group_name,
      brand_name: null,
      owner_name: null,
      operator_name: null,
      signal_type,
      signal_subtype: signal_subtype || null,
      signal_strength: 'medium',
      project_date: project_date || null,
      first_seen_at: now,
      last_seen_at: now,
      source_count: 1,
      confidence_score: 0,
      business_score: 0,
      recommended_angle: angle,
      status: 'new',
    };

    // Calculer les scores
    oppData.business_score = computeBusinessScore(oppData);
    oppData.confidence_score = computeConfidenceScore(oppData);
    oppData.signal_strength = derivePriority(oppData.business_score);

    db.prepare(`
      INSERT INTO veille_opportunities (
        id, fingerprint, hotel_name, city, region, country,
        group_name, brand_name, owner_name, operator_name,
        signal_type, signal_subtype, signal_strength,
        project_date, first_seen_at, last_seen_at, source_count,
        confidence_score, business_score, recommended_angle, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      oppData.id, oppData.fingerprint, oppData.hotel_name, oppData.city, oppData.region, oppData.country,
      oppData.group_name, oppData.brand_name, oppData.owner_name, oppData.operator_name,
      oppData.signal_type, oppData.signal_subtype, oppData.signal_strength,
      oppData.project_date, oppData.first_seen_at, oppData.last_seen_at, oppData.source_count,
      oppData.confidence_score, oppData.business_score, oppData.recommended_angle, oppData.status
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
      signal_type: signal.type,
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
  upsertOpportunity,
  processEnrichedArticles,
};
