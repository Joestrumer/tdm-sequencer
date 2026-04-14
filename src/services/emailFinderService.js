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

  // Essayer plusieurs endpoints possibles (Lusha change souvent)
  const endpoints = [
    {
      url: 'https://api.lusha.com/person',
      body: { firstName: prenom, lastName: nom, company: entreprise },
    },
    {
      url: 'https://api.lusha.com/company/person',
      body: { person: { firstName: prenom, lastName: nom }, company: { name: entreprise } },
    },
    {
      url: 'https://api.lusha.com/v1/person',
      body: { firstName: prenom, lastName: nom, companyName: entreprise },
    },
  ];

  for (const endpoint of endpoints) {
    try {
      logger.info(`🔍 Lusha: tentative ${endpoint.url} pour "${prenom} ${nom}" @ ${entreprise}`);

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api_key': lushaApiKey,
        },
        body: JSON.stringify(endpoint.body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`⚠️ Lusha ${endpoint.url} HTTP ${response.status}: ${errorText.substring(0, 100)}`);
        continue; // Essayer le prochain endpoint
      }

      const data = await response.json();

      // Chercher l'email dans différentes structures de réponse possibles
      const email = data.email || data.emailAddress || data?.data?.email || data?.data?.[0]?.emailAddress;

      if (email) {
        logger.info(`✅ Lusha: email trouvé ${email} via ${endpoint.url}`);
        return {
          email,
          source: 'Lusha',
          confidence: 'high',
        };
      }

    } catch (err) {
      logger.warn(`⚠️ Erreur Lusha ${endpoint.url}: ${err.message}`);
      continue;
    }
  }

  logger.info(`ℹ️ Lusha: aucun email trouvé (tous endpoints testés)`);
  return null;
}

/**
 * Trouve un email via l'API Lemlist Enrich
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

    // API Lemlist Enrich - Documentation: https://developer.lemlist.com/
    const params = new URLSearchParams({
      findEmail: 'true',
      firstName: prenom,
      lastName: nom,
      companyDomain: domaine,
    });

    // Basic Auth avec format :apiKey (deux-points avant la clé)
    const auth = Buffer.from(':' + lemlistApiKey).toString('base64');

    const response = await fetch(`https://api.lemlist.com/api/enrich?${params}`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`⚠️ Lemlist HTTP ${response.status}: ${errorText.substring(0, 200)}`);
      return null;
    }

    const data = await response.json();

    // Lemlist Enrich retourne un enrichId - les résultats sont asynchrones
    // Pour une version synchrone simple, on attend un peu et on check directement
    if (data._id) {
      logger.info(`🔄 Lemlist: enrichissement lancé (ID: ${data._id})`);

      // Attendre 2 secondes pour que l'enrichissement se termine
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Récupérer le résultat
      const resultResponse = await fetch(`https://api.lemlist.com/api/enrich/${data._id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });

      if (resultResponse.ok) {
        const result = await resultResponse.json();
        if (result.email) {
          logger.info(`✅ Lemlist: email trouvé ${result.email}`);
          return {
            email: result.email,
            source: 'Lemlist',
            confidence: result.emailStatus === 'valid' ? 'high' : 'medium',
          };
        }
      }
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

  // 1. Lusha : Teste plusieurs endpoints possibles
  if (lushaApiKey && entreprise) {
    const resultatLusha = await trouverEmailLusha(prenom, nom, entreprise, lushaApiKey);
    if (resultatLusha) return resultatLusha;
  }

  // 2. Lemlist Enrich (asynchrone avec délai de 2s)
  if (lemlistApiKey && domaine) {
    const resultatLemlist = await trouverEmailLemlist(prenom, nom, domaine, lemlistApiKey);
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
