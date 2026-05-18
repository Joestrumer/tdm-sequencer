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

// ─── Scoring hybride (recalibré Phase 1 Refonte) ────────────────────────────

/**
 * Score business sur 100.
 * Composantes (recalibrées avec signaux multi-sources) :
 * - signal_max_strength      : 0-25 pts (force du signal le plus fort, normalisée)
 * - convergence_multi_sources: 0-25 pts (+5 par source distincte, cap 25)
 * - convergence_multi_signaux: 0-20 pts (+10 si 3+ types, +20 si 5+)
 * - combo_bonus              : 0-15 pts (combos spécifiques)
 * - fraîcheur                : 0-15 pts (décroissance exponentielle 6 mois)
 * - entité_detectée          : 0-10 pts (hotel +5, city +3, group +2)
 * - segment_premium          : 0-10 pts (palace, 5 étoiles, luxe)
 *
 * Plafonné à 100.
 *
 * @param {Object} opp - L'opportunité avec ses champs
 * @param {Object} db - Optionnel : si fourni, charge les signaux depuis veille_signals
 */
function computeBusinessScore(opp, db) {
  let score = 0;

  // Extraire les signaux (supporting_signals existants + veille_signals si db fourni)
  const signals = parseSignals(opp.supporting_signals);
  let signalSet = new Set(signals);
  let maxStrength = 0;
  let distinctSources = new Set();

  // Si db fourni, enrichir avec les signaux de veille_signals
  if (db && opp.id) {
    try {
      const dbSignals = db.prepare(`
        SELECT signal_type, signal_strength, source FROM veille_signals
        WHERE opportunity_id = ?
      `).all(opp.id);

      for (const s of dbSignals) {
        signalSet.add(s.signal_type);
        if (s.signal_strength > maxStrength) maxStrength = s.signal_strength;
        distinctSources.add(s.source);
      }
    } catch (_) {}
  }

  // Ajouter les signaux des articles (source = 'press')
  if (signals.length > 0) distinctSources.add('press');
  const primarySignal = opp.signal_type || [...signalSet][0] || 'autre';

  // 1. Force max du signal individuel (max 25) — normalisée depuis 0-100 → 0-25
  const signalScores = {
    renovation: 25, permis_construire: 25, boamp_marche: 23,
    acquisition: 22, vente: 22, booking_unavailable_long: 22,
    google_review_keyword: 22, google_review_drop: 20,
    conversion: 20, nomination: 20, ouverture: 18, architecte: 18,
    linkedin_preopening_job: 18, google_hours_change: 17,
    spa_wellness: 15, booking_delisted: 14,
    recrutement: 12, bodacc_movement: 10,
    fermeture_temp: 8, google_closed_temporarily: 8,
    autre: 3,
  };
  // Prendre le meilleur entre le score du signal principal et maxStrength normalisé
  const primaryScore = signalScores[primarySignal] || 3;
  const strengthNorm = Math.round(maxStrength * 25 / 100);
  score += Math.max(primaryScore, strengthNorm);

  // 2. Convergence multi-sources (max 25) — +5 par source distincte
  // Sources possibles : press, google_places, amadeus, data_gouv, linkedin, boamp, bodacc
  const sc = Math.max(distinctSources.size, opp.source_count || 1);
  score += Math.min(25, sc * 5);

  // 3. Convergence multi-signaux (max 20)
  const numSignalTypes = signalSet.size;
  if (numSignalTypes >= 5) score += 20;
  else if (numSignalTypes >= 3) score += 10;
  else if (numSignalTypes >= 2) score += 5;

  // 4. Combo bonus (max 15) — combinaisons spécifiques haute valeur
  let comboBonus = 0;
  if (signalSet.has('google_review_drop') && signalSet.has('booking_unavailable_long')) comboBonus += 8;
  if (signalSet.has('google_review_drop') && (signalSet.has('renovation') || signalSet.has('google_review_keyword'))) comboBonus += 6;
  if (signalSet.has('permis_construire') && (signalSet.has('renovation') || signalSet.has('ouverture'))) comboBonus += 5;
  if (signalSet.has('linkedin_preopening_job') && (signalSet.has('ouverture') || signalSet.has('renovation'))) comboBonus += 6;
  if (signalSet.has('booking_unavailable_long') && signalSet.has('google_hours_change')) comboBonus += 5;
  if (signalSet.has('fermeture_temp') && signalSet.has('renovation')) comboBonus += 5;
  if (signalSet.has('renovation') && signalSet.has('architecte')) comboBonus += 4;
  if (signalSet.has('nomination') && signalSet.has('renovation')) comboBonus += 4;
  if (signalSet.has('boamp_marche') && opp.hotel_name) comboBonus += 5;
  if (signalSet.has('vente') && (signalSet.has('ouverture') || signalSet.has('renovation'))) comboBonus += 5;
  score += Math.min(15, comboBonus);

  // 5. Fraîcheur (max 15) — décroissance exponentielle sur 6 mois
  if (opp.first_seen_at) {
    const ageMs = Date.now() - new Date(opp.first_seen_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Exponentielle : 15 * e^(-ageDays/60), plancher 0
    score += Math.max(0, Math.round(15 * Math.exp(-ageDays / 60)));
  }

  // 6. Entité détectée (max 10)
  if (opp.hotel_name) score += 5;
  if (opp.city) score += 3;
  if (opp.group_name) score += 2;

  // 7. Segment premium (max 10)
  const premiumKeywords = ['palace', '5 étoiles', '5*', 'luxe', 'boutique-hôtel', 'boutique hôtel', 'relais & châteaux'];
  const oppText = `${opp.hotel_name || ''} ${opp.group_name || ''} ${opp.brand_name || ''} ${opp.stars || ''}`.toLowerCase();
  if (premiumKeywords.some(k => oppText.includes(k))) {
    score += 10;
  }

  return Math.min(100, score);
}

/**
 * Construit le signal_summary JSON pour une opportunité.
 * Liste tous les signaux contributeurs avec leurs dates et forces.
 */
function buildSignalSummary(db, opportunityId) {
  try {
    const signals = db.prepare(`
      SELECT signal_type, signal_strength, source, detected_at, source_url
      FROM veille_signals
      WHERE opportunity_id = ?
      ORDER BY signal_strength DESC, detected_at DESC
    `).all(opportunityId);

    return signals.map(s => ({
      type: s.signal_type,
      strength: s.signal_strength,
      source: s.source,
      date: s.detected_at,
      url: s.source_url,
    }));
  } catch (_) {
    return [];
  }
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
  boamp_marche: 'Marché public de travaux hôteliers = budget validé, calendrier ferme. Identifier le maître d\'ouvrage et proposer avant l\'appel d\'offres amenities.',
  architecte: 'Architecte/designer identifié = phase de conception. Se positionner comme fournisseur premium compatible avec la direction artistique.',
  recrutement: 'Recrutement lié à transformation = établissement en mouvement. Fenêtre de contact via le nouveau DG/directeur.',
  fermeture_temp: 'Fermeture temporaire = signal faible seul, mais fort si corroboré (rénovation, recrutement). Vérifier le contexte.',
  // Nouveaux signaux Phase 1
  google_review_drop: 'Chute des avis Google = probable fermeture/travaux. Signal objectif et difficile à simuler. Vérifier le contexte et croiser avec Booking.',
  google_review_keyword: 'Avis Google mentionnant travaux/rénovation = preuve directe. Contacter rapidement avant que les choix fournisseurs soient faits.',
  google_hours_change: 'Changement d\'horaires Google = possible fermeture partielle ou totale. Croiser avec d\'autres signaux pour confirmer.',
  google_closed_temporarily: 'Fermeture temporaire confirmée Google = signal direct mais rare. Vérifier la raison (travaux, saisonnier, autre).',
  booking_unavailable_long: 'Indisponible sur Booking 5+ mois = fermeture probable pour travaux. Signal fort et indépendant. Timing idéal pour prise de contact.',
  booking_delisted: 'Disparu des résultats Booking = possible retrait volontaire pendant travaux. À confirmer avec d\'autres signaux.',
  permis_construire: 'Permis de construire officiel = projet validé avec budget et calendrier. Signal ultra-fiable. Identifier le maître d\'ouvrage et proposer avant l\'appel d\'offres.',
  linkedin_preopening_job: 'Recrutement pré-ouverture = ouverture/réouverture dans 3-6 mois. Se positionner avant que l\'équipe soit constituée et les choix fournisseurs figés.',
  bodacc_movement: 'Mouvement au BODACC (changement dirigeant, SCI) = période de transition. Nouveau décideur potentiel. Vérifier le contexte hôtelier.',
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
    renovation: 10, permis_construire: 10, boamp_travaux: 10, boamp_marche: 10,
    acquisition: 9, vente: 9, booking_unavailable_long: 9,
    google_review_keyword: 9, google_review_drop: 8,
    conversion: 8, nomination: 7, ouverture: 7, architecte: 6,
    linkedin_preopening_job: 6, google_hours_change: 5,
    spa_wellness: 5, booking_delisted: 4, recrutement: 4,
    bodacc_movement: 3, fermeture_temp: 2, google_closed_temporarily: 2,
    autre: 0,
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
  buildSignalSummary,
};
