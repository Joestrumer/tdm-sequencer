/**
 * contactPipeline.js — Orchestrateur du pipeline contacts décideurs
 *
 * Pour chaque opportunité avec business_score >= seuil :
 * 1. Pappers → SIREN + dirigeants légaux
 * 2. LinkedIn (Brave) → profils décideurs, dédup Levenshtein
 * 3. Domaine email → chaîne connue / Google Places / Brave
 * 4. Patterns email → 6 variantes ordonnées
 * 5. ZeroBounce → vérification en cascade
 * 6. Scoring contact → sélection best_contact
 *
 * Dépendances : pappersService, linkedinContactFinder, emailPatternService
 */

const logger = require('../../config/logger');
const { rechercherEntreprise, insertPappersContacts, logAttempt } = require('./pappersService');
const { findLinkedInContacts } = require('./linkedinContactFinder');
const { resolveEmail, findEmailDomain } = require('./emailPatternService');

// ─── Seuil minimum de business_score ────────────────────────────────────────

const DEFAULT_SCORE_THRESHOLD = 50;

// ─── Pipeline pour une opportunité ──────────────────────────────────────────

/**
 * Lance le pipeline contact complet pour une opportunité.
 *
 * @param {Object} db
 * @param {Object} opportunity - L'opportunité (row de veille_opportunities)
 * @param {Object} options - { skipPappers, skipLinkedin, skipEmail }
 * @returns {Object} { contacts_total, contacts_with_email, best_contact, steps }
 */
async function runPipelineForOpportunity(db, opportunity, options = {}) {
  const oppId = opportunity.id;
  const hotelName = opportunity.hotel_name || '';
  const city = opportunity.city || '';
  const groupName = opportunity.group_name || '';
  const googlePlaceId = opportunity.google_place_id || null;

  const steps = {};

  if (!hotelName) {
    logger.warn(`Contact Pipeline: opportunité ${oppId} sans hotel_name, skip`);
    return { contacts_total: 0, contacts_with_email: 0, best_contact: null, steps };
  }

  // ─── Étape 1 : Pappers ──────────────────────────────────────────────────

  if (!options.skipPappers) {
    try {
      logger.info(`Contact Pipeline [${hotelName}]: Pappers...`);
      const pappers = await rechercherEntreprise(db, hotelName, city);

      if (pappers.error) {
        steps.pappers = { status: 'error', error: pappers.error };
      } else {
        const inserted = insertPappersContacts(db, oppId, hotelName, pappers.siren, pappers.dirigeants);

        // Sauvegarder le SIREN et le site web sur l'opportunité
        if (pappers.siren || pappers.raw?.site_url) {
          const updates = [];
          const params = [];
          if (pappers.raw?.site_url && !opportunity.website) {
            updates.push('website = ?');
            params.push(pappers.raw.site_url);
          }
          if (updates.length > 0) {
            params.push(oppId);
            db.prepare(`UPDATE veille_opportunities SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
          }
        }

        logAttempt(db, {
          opportunityId: oppId,
          attemptType: 'pappers_lookup',
          status: pappers.dirigeants.length > 0 ? 'success' : 'no_results',
          payload: {
            siren: pappers.siren,
            denomination: pappers.denomination,
            dirigeants_found: pappers.dirigeants.length,
            inserted: inserted.length,
          },
          creditsUsed: 1,
        });

        steps.pappers = {
          status: 'ok',
          siren: pappers.siren,
          denomination: pappers.denomination,
          dirigeants_found: pappers.dirigeants.length,
          contacts_inserted: inserted.length,
        };
      }
    } catch (err) {
      logger.error(`Contact Pipeline Pappers [${hotelName}]: ${err.message}`);
      steps.pappers = { status: 'error', error: err.message };
    }

    // Pause entre APIs
    await new Promise(r => setTimeout(r, 500));
  }

  // ─── Étape 2 : LinkedIn ─────────────────────────────────────────────────

  if (!options.skipLinkedin) {
    try {
      logger.info(`Contact Pipeline [${hotelName}]: LinkedIn...`);
      const linkedin = await findLinkedInContacts(db, hotelName, city, oppId);

      steps.linkedin = {
        status: linkedin.error ? 'error' : 'ok',
        contacts_found: linkedin.contacts_found || 0,
        contacts_new: linkedin.contacts_new || 0,
        contacts_updated: linkedin.contacts_updated || 0,
      };
    } catch (err) {
      logger.error(`Contact Pipeline LinkedIn [${hotelName}]: ${err.message}`);
      steps.linkedin = { status: 'error', error: err.message };
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // ─── Étape 3-5 : Domaine + Patterns + ZeroBounce ───────────────────────

  if (!options.skipEmail) {
    try {
      logger.info(`Contact Pipeline [${hotelName}]: résolution emails...`);

      // Trouver le domaine une seule fois pour tous les contacts
      const domainResult = await findEmailDomain(db, {
        hotelName, city, groupName, googlePlaceId, opportunityId: oppId,
      });

      if (domainResult.domain) {
        // Mettre à jour tous les contacts sans domaine
        db.prepare('UPDATE veille_contacts SET domain = ? WHERE opportunity_id = ? AND domain IS NULL')
          .run(domainResult.domain, oppId);
      }

      // Charger tous les contacts de cette opportunité
      const contacts = db.prepare(`
        SELECT * FROM veille_contacts
        WHERE opportunity_id = ? AND email_status IN ('unverified', 'unknown')
        ORDER BY role_relevance DESC
      `).all(oppId);

      let emailsResolved = 0;
      let emailsValid = 0;

      for (const contact of contacts) {
        try {
          const result = await resolveEmail(db, contact, {
            opportunityId: oppId,
            hotelName,
            city,
            groupName,
            googlePlaceId,
          });

          if (result.email) emailsResolved++;
          if (result.status === 'valid') emailsValid++;

          // Rate limiting
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          logger.warn(`Contact Pipeline email [${contact.full_name}]: ${err.message}`);
        }
      }

      steps.email = {
        status: 'ok',
        domain: domainResult.domain,
        domain_method: domainResult.method,
        contacts_processed: contacts.length,
        emails_resolved: emailsResolved,
        emails_valid: emailsValid,
      };
    } catch (err) {
      logger.error(`Contact Pipeline email [${hotelName}]: ${err.message}`);
      steps.email = { status: 'error', error: err.message };
    }
  }

  // ─── Étape 6 : Scoring et sélection best_contact ───────────────────────

  const allContacts = db.prepare(`
    SELECT * FROM veille_contacts WHERE opportunity_id = ?
    ORDER BY role_relevance DESC, email_status ASC
  `).all(oppId);

  // Calculer le score composite de chaque contact
  let bestContact = null;
  let bestScore = -1;

  for (const c of allContacts) {
    const score = computeContactScore(c);
    if (score > bestScore) {
      bestScore = score;
      bestContact = c;
    }
  }

  // Mettre à jour best_contact_id sur l'opportunité
  if (bestContact) {
    db.prepare('UPDATE veille_opportunities SET best_contact_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(bestContact.id, oppId);
  }

  const contactsWithEmail = allContacts.filter(c => c.email && c.email_status !== 'invalid').length;

  logger.info(`Contact Pipeline [${hotelName}]: ${allContacts.length} contacts, ${contactsWithEmail} avec email, best=${bestContact?.full_name || 'aucun'}`);

  return {
    contacts_total: allContacts.length,
    contacts_with_email: contactsWithEmail,
    best_contact: bestContact ? {
      id: bestContact.id,
      full_name: bestContact.full_name,
      role: bestContact.role,
      email: bestContact.email,
      email_status: bestContact.email_status,
      score: bestScore,
    } : null,
    steps,
  };
}

// ─── Scoring contact ────────────────────────────────────────────────────────

/**
 * Score composite d'un contact (0-100).
 * Combine : pertinence du rôle, statut email, confiance ZeroBounce.
 */
function computeContactScore(contact) {
  let score = 0;

  // Pertinence du rôle : 0-40 pts
  score += Math.round((contact.role_relevance || 50) * 0.4);

  // Statut email : 0-40 pts
  switch (contact.email_status) {
    case 'valid': score += 40; break;
    case 'catch_all': score += 25; break;
    case 'unverified': score += 10; break;
    case 'unknown': score += 5; break;
    default: score += 0;
  }

  // LinkedIn présent : +10 pts
  if (contact.linkedin_url) score += 10;

  // Score ZeroBounce si disponible : 0-10 pts
  if (contact.email_score) {
    score += Math.round(parseFloat(contact.email_score) / 10);
  }

  return Math.min(100, score);
}

// ─── Batch sur toutes les opportunités éligibles ────────────────────────────

/**
 * Lance le pipeline contact sur toutes les opportunités avec
 * business_score >= seuil ET pas encore de contacts.
 *
 * @param {Object} db
 * @param {Object} options - { scoreThreshold, limit, skipPappers, skipLinkedin, skipEmail, forceRerun }
 */
async function runBatch(db, options = {}) {
  const threshold = options.scoreThreshold || DEFAULT_SCORE_THRESHOLD;
  const limit = options.limit || 20;
  let pipelineRunning = false;

  try {
    // Vérifier si un pipeline tourne déjà
    const row = db.prepare("SELECT valeur FROM config WHERE cle = 'contact_pipeline_running'").get();
    if (row?.valeur === '1') {
      logger.warn('Contact Pipeline: déjà en cours, skip');
      return { skipped: true };
    }
  } catch (_) { /* table config pas encore à jour */ }

  try {
    // Marquer comme en cours
    db.prepare("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('contact_pipeline_running', '1')").run();
    pipelineRunning = true;

    // Sélectionner les opportunités éligibles
    let query;
    if (options.forceRerun) {
      query = db.prepare(`
        SELECT * FROM veille_opportunities
        WHERE business_score >= ? AND hotel_name IS NOT NULL
        ORDER BY business_score DESC
        LIMIT ?
      `);
    } else {
      query = db.prepare(`
        SELECT o.* FROM veille_opportunities o
        WHERE o.business_score >= ? AND o.hotel_name IS NOT NULL
          AND o.id NOT IN (
            SELECT DISTINCT opportunity_id FROM veille_contacts WHERE opportunity_id IS NOT NULL
          )
        ORDER BY o.business_score DESC
        LIMIT ?
      `);
    }

    const opportunities = query.all(threshold, limit);

    if (opportunities.length === 0) {
      logger.info('Contact Pipeline: aucune opportunité éligible');
      return { processed: 0, total_contacts: 0, total_emails: 0 };
    }

    logger.info(`Contact Pipeline: ${opportunities.length} opportunité(s) à traiter (seuil score >= ${threshold})`);

    const results = [];
    let totalContacts = 0;
    let totalEmails = 0;

    for (const opp of opportunities) {
      try {
        const result = await runPipelineForOpportunity(db, opp, options);
        results.push({ opportunityId: opp.id, hotelName: opp.hotel_name, ...result });
        totalContacts += result.contacts_total;
        totalEmails += result.contacts_with_email;

        // Pause entre opportunités
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        logger.error(`Contact Pipeline [${opp.hotel_name}]: ${err.message}`);
        results.push({ opportunityId: opp.id, hotelName: opp.hotel_name, error: err.message });
      }
    }

    logger.info(`Contact Pipeline terminé: ${opportunities.length} opps, ${totalContacts} contacts, ${totalEmails} emails`);

    return {
      processed: opportunities.length,
      total_contacts: totalContacts,
      total_emails: totalEmails,
      results,
    };
  } finally {
    if (pipelineRunning) {
      try {
        db.prepare("INSERT OR REPLACE INTO config (cle, valeur) VALUES ('contact_pipeline_running', '0')").run();
      } catch (_) { /* ignore */ }
    }
  }
}

module.exports = {
  runPipelineForOpportunity,
  runBatch,
  computeContactScore,
};
