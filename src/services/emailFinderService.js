/**
 * emailFinderService.js — Recherche d'emails via Lusha, Lemlist et ZeroBounce
 */

const logger = require('../config/logger');

/**
 * Trouve un email via l'API Lusha
 * @param {string} prenom
 * @param {string} nom
 * @param {string} entreprise - Nom de l'entreprise
 * @param {string} lushaApiKey
 * @returns {Promise<{email: string, source: string, confidence: string}|null>}
 */
async function trouverEmailLusha(prenom, nom, entreprise, lushaApiKey) {
  if (!lushaApiKey) return null;

  try {
    logger.info(`🔍 Lusha: recherche email pour "${prenom} ${nom}" @ ${entreprise}`);

    // API Lusha - Person Enrichment
    const response = await fetch('https://api.lusha.com/person', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api_key': lushaApiKey,
      },
      body: JSON.stringify({
        property: {
          firstName: prenom,
          lastName: nom,
          company: entreprise,
        },
      }),
    });

    if (!response.ok) {
      logger.warn(`⚠️ Lusha HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.data && data.data.emailAddress) {
      const email = data.data.emailAddress;
      logger.info(`✅ Lusha: email trouvé ${email}`);
      return {
        email,
        source: 'Lusha',
        confidence: data.data.accuracy || 'high',
      };
    }

    logger.info(`ℹ️ Lusha: aucun email trouvé`);
    return null;

  } catch (err) {
    logger.error(`❌ Erreur Lusha: ${err.message}`);
    return null;
  }
}

/**
 * Trouve un email via l'API Lemlist
 * @param {string} prenom
 * @param {string} nom
 * @param {string} entreprise
 * @param {string} lemlistApiKey
 * @returns {Promise<{email: string, source: string, confidence: string}|null>}
 */
async function trouverEmailLemlist(prenom, nom, entreprise, lemlistApiKey) {
  if (!lemlistApiKey) return null;

  try {
    logger.info(`🔍 Lemlist: recherche email pour "${prenom} ${nom}" @ ${entreprise}`);

    // API Lemlist - Email Finder
    const response = await fetch('https://api.lemlist.com/api/email-verifier', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lemlistApiKey}`,
      },
      body: JSON.stringify({
        firstName: prenom,
        lastName: nom,
        companyName: entreprise,
      }),
    });

    if (!response.ok) {
      logger.warn(`⚠️ Lemlist HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.email && data.status === 'valid') {
      logger.info(`✅ Lemlist: email trouvé ${data.email}`);
      return {
        email: data.email,
        source: 'Lemlist',
        confidence: data.confidence || 'medium',
      };
    }

    logger.info(`ℹ️ Lemlist: aucun email trouvé`);
    return null;

  } catch (err) {
    logger.error(`❌ Erreur Lemlist: ${err.message}`);
    return null;
  }
}

/**
 * Fonction principale de recherche d'email
 * Essaie dans l'ordre : Lusha → Lemlist → ZeroBounce patterns
 *
 * @param {object} params
 * @param {string} params.prenom
 * @param {string} params.nom
 * @param {string} params.entreprise - Nom de l'entreprise
 * @param {string} params.domaine - Domaine email (pour ZeroBounce fallback)
 * @param {string} params.lushaApiKey
 * @param {string} params.lemlistApiKey
 * @param {string} params.zerobounceApiKey
 * @param {string} params.patternMemoire - Pattern ZeroBounce mémorisé
 * @param {function} params.zbFallback - Fonction ZeroBounce fallback
 * @returns {Promise<{email: string, source: string, confidence: string, pattern?: string}|null>}
 */
async function trouverEmail({
  prenom,
  nom,
  entreprise,
  domaine,
  lushaApiKey = null,
  lemlistApiKey = null,
  zerobounceApiKey = null,
  patternMemoire = null,
  zbFallback = null,
}) {
  if (!prenom || !nom) {
    logger.warn(`⚠️ Prénom ou nom manquant`);
    return null;
  }

  // 1. Essayer Lusha en priorité
  if (lushaApiKey && entreprise) {
    const resultatLusha = await trouverEmailLusha(prenom, nom, entreprise, lushaApiKey);
    if (resultatLusha) return resultatLusha;
  }

  // 2. Fallback Lemlist
  if (lemlistApiKey && entreprise) {
    const resultatLemlist = await trouverEmailLemlist(prenom, nom, entreprise, lemlistApiKey);
    if (resultatLemlist) return resultatLemlist;
  }

  // 3. Dernier recours : ZeroBounce patterns
  if (zbFallback && zerobounceApiKey && domaine) {
    logger.info(`🔄 Fallback ZeroBounce patterns`);
    const resultatZB = await zbFallback(prenom, nom, domaine, zerobounceApiKey, patternMemoire);
    if (resultatZB) {
      return {
        ...resultatZB,
        source: 'ZeroBounce',
        confidence: resultatZB.quality_score > 8 ? 'high' : 'medium',
      };
    }
  }

  logger.warn(`❌ Aucun email trouvé pour ${prenom} ${nom}`);
  return null;
}

module.exports = {
  trouverEmailLusha,
  trouverEmailLemlist,
  trouverEmail,
};
