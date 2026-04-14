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

    // API Lusha - Enrichment (v2)
    // Documentation: https://www.lusha.com/docs/api/#enrichment
    const response = await fetch('https://api.lusha.com/enrichment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api_key': lushaApiKey,
      },
      body: JSON.stringify({
        data: [{
          property: 'person',
          firstName: prenom,
          lastName: nom,
          company: entreprise,
        }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`⚠️ Lusha HTTP ${response.status}: ${errorText}`);
      return null;
    }

    const data = await response.json();

    // Structure de réponse Lusha v2
    if (data && data.data && data.data[0] && data.data[0].emailAddress) {
      const email = data.data[0].emailAddress;
      logger.info(`✅ Lusha: email trouvé ${email}`);
      return {
        email,
        source: 'Lusha',
        confidence: data.data[0].accuracy || 'high',
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
 * @param {string} domaine - Domaine de l'entreprise (ex: hotel-example.com)
 * @param {string} lemlistApiKey
 * @returns {Promise<{email: string, source: string, confidence: string}|null>}
 */
async function trouverEmailLemlist(prenom, nom, domaine, lemlistApiKey) {
  if (!lemlistApiKey) return null;

  try {
    logger.info(`🔍 Lemlist: recherche email pour "${prenom} ${nom}" @ ${domaine}`);

    // API Lemlist - Email Finder
    // Documentation: https://developer.lemlist.com/#email-finder
    const params = new URLSearchParams({
      firstName: prenom,
      lastName: nom,
      domain: domaine,
    });

    const response = await fetch(`https://api.lemlist.com/api/email-finder?${params}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${lemlistApiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`⚠️ Lemlist HTTP ${response.status}: ${errorText}`);
      return null;
    }

    const data = await response.json();

    // Lemlist retourne { email, isValid, score }
    if (data.email && data.isValid) {
      logger.info(`✅ Lemlist: email trouvé ${data.email}`);
      return {
        email: data.email,
        source: 'Lemlist',
        confidence: data.score > 80 ? 'high' : 'medium',
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
 * @param {string} params.entreprise - Nom de l'entreprise (pour Lusha)
 * @param {string} params.domaine - Domaine email (pour Lemlist et ZeroBounce)
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

  // 1. Lusha : DÉSACTIVÉ temporairement (endpoint API non documenté)
  // TODO: Réactiver quand la documentation sera accessible
  // if (lushaApiKey && entreprise) {
  //   const resultatLusha = await trouverEmailLusha(prenom, nom, entreprise, lushaApiKey);
  //   if (resultatLusha) return resultatLusha;
  // }

  // 2. Lemlist : DÉSACTIVÉ temporairement (API asynchrone, nécessite 2 requêtes)
  // TODO: Implémenter le système asynchrone (enrich + fetch result)
  // if (lemlistApiKey && domaine) {
  //   const resultatLemlist = await trouverEmailLemlist(prenom, nom, domaine, lemlistApiKey);
  //   if (resultatLemlist) return resultatLemlist;
  // }

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
