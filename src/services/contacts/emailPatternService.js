/**
 * emailPatternService.js — Recherche de domaine email, génération de patterns, vérification ZeroBounce
 *
 * 3 étapes :
 * 1. Trouver le domaine email : Google Places websiteUri, Brave search, domaines chaînes connus
 * 2. Générer les 6 patterns email à partir du prénom+nom+domaine
 * 3. Vérifier en cascade via ZeroBounce (valid→stop, invalid→suivant)
 *
 * Chaque tentative est loguée dans veille_contact_attempts.
 *
 * Dépendances : API ZeroBounce, API Brave Search, table config
 */

const { randomUUID } = require('crypto');
const logger = require('../../config/logger');
const { logAttempt } = require('./pappersService');

// ─── Config ─────────────────────────────────────────────────────────────────

function getZeroBounceKey(db) {
  try {
    const row = db.prepare("SELECT valeur FROM config WHERE cle = 'zerobounce_api_key'").get();
    return row?.valeur || process.env.ZEROBOUNCE_API_KEY || '';
  } catch (_) {
    return process.env.ZEROBOUNCE_API_KEY || '';
  }
}

function getBraveKey(db) {
  try {
    const row = db.prepare("SELECT valeur FROM config WHERE cle = 'brave_search_api_key'").get();
    return row?.valeur || process.env.BRAVE_SEARCH_API_KEY || '';
  } catch (_) {
    return process.env.BRAVE_SEARCH_API_KEY || '';
  }
}

// ─── Domaines connus des chaînes hôtelières ─────────────────────────────────

const CHAIN_DOMAINS = {
  'accor': 'accor.com',
  'sofitel': 'accor.com',
  'pullman': 'accor.com',
  'novotel': 'accor.com',
  'mercure': 'accor.com',
  'ibis': 'accor.com',
  'mgallery': 'accor.com',
  'fairmont': 'accor.com',
  'raffles': 'accor.com',
  'swissotel': 'accor.com',
  'mövenpick': 'accor.com',
  'marriott': 'marriott.com',
  'ritz-carlton': 'ritzcarlton.com',
  'w hotel': 'whotels.com',
  'sheraton': 'sheraton.com',
  'westin': 'westin.com',
  'le méridien': 'lemeridien.com',
  'hyatt': 'hyatt.com',
  'park hyatt': 'hyatt.com',
  'andaz': 'hyatt.com',
  'hilton': 'hilton.com',
  'waldorf astoria': 'waldorfastoria.com',
  'conrad': 'conradhotels.com',
  'four seasons': 'fourseasons.com',
  'mandarin oriental': 'mandarinoriental.com',
  'peninsula': 'peninsula.com',
  'rosewood': 'rosewoodhotels.com',
  'aman': 'aman.com',
  'belmond': 'belmond.com',
  'kempinski': 'kempinski.com',
  'intercontinental': 'ihg.com',
  'ihg': 'ihg.com',
  'crowne plaza': 'ihg.com',
  'holiday inn': 'ihg.com',
  'best western': 'bestwestern.com',
  'barrière': 'groupebarriere.com',
  'lucien barrière': 'groupebarriere.com',
  'evok': 'evokhotels.com',
  'relais & châteaux': 'relaischateaux.com',
};

/**
 * Tente de trouver le domaine email d'un hôtel via chaîne connue.
 */
function findChainDomain(hotelName, groupName) {
  const search = `${hotelName} ${groupName || ''}`.toLowerCase();
  for (const [chain, domain] of Object.entries(CHAIN_DOMAINS)) {
    if (search.includes(chain)) return domain;
  }
  return null;
}

// ─── Étape 1 : Trouver le domaine email ─────────────────────────────────────

/**
 * Essaie de trouver le domaine email d'un hôtel via plusieurs sources.
 * Ordre : chaîne connue → Google Places website → Brave search
 */
async function findEmailDomain(db, { hotelName, city, groupName, googlePlaceId, opportunityId }) {
  // 1. Domaine de chaîne connu
  const chainDomain = findChainDomain(hotelName, groupName);
  if (chainDomain) {
    logAttempt(db, {
      opportunityId,
      attemptType: 'domain_chain_lookup',
      status: 'success',
      payload: { domain: chainDomain, method: 'chain_known' },
      creditsUsed: 0,
    });
    return { domain: chainDomain, method: 'chain_known' };
  }

  // 2. Google Places websiteUri (si on a le place_id)
  if (googlePlaceId) {
    try {
      const row = db.prepare(
        'SELECT website_uri FROM veille_google_snapshots WHERE hotel_place_id = ? ORDER BY snapshot_date DESC LIMIT 1'
      ).get(googlePlaceId);
      if (row?.website_uri) {
        const domain = extractDomain(row.website_uri);
        if (domain && !isBookingDomain(domain)) {
          logAttempt(db, {
            opportunityId,
            attemptType: 'domain_google_places',
            status: 'success',
            payload: { domain, website: row.website_uri },
            creditsUsed: 0,
          });
          return { domain, method: 'google_places' };
        }
      }
    } catch (_) { /* pas de snapshot */ }
  }

  // 3. Vérifier si l'opportunité a déjà un website
  if (opportunityId) {
    try {
      const opp = db.prepare('SELECT website FROM veille_opportunities WHERE id = ?').get(opportunityId);
      if (opp?.website) {
        const domain = extractDomain(opp.website);
        if (domain && !isBookingDomain(domain)) {
          return { domain, method: 'opportunity_website' };
        }
      }
    } catch (_) { /* ignore */ }
  }

  // 4. Brave Search pour trouver le site web
  const braveKey = getBraveKey(db);
  if (braveKey) {
    try {
      const query = `"${hotelName}" ${city || ''} site officiel -site:booking.com -site:tripadvisor.com -site:expedia.com -site:hotels.com`;
      const params = new URLSearchParams({
        q: query, count: '5', search_lang: 'fr', country: 'fr',
      });

      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': braveKey,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        const results = data.web?.results || [];

        for (const r of results) {
          const domain = extractDomain(r.url);
          if (domain && !isBookingDomain(domain) && !isGenericDomain(domain)) {
            logAttempt(db, {
              opportunityId,
              attemptType: 'domain_brave_search',
              status: 'success',
              payload: { domain, url: r.url, title: r.title },
              creditsUsed: 0,
            });
            return { domain, method: 'brave_search' };
          }
        }
      }
    } catch (err) {
      logger.warn(`Email domain Brave search: ${err.message}`);
    }
  }

  logAttempt(db, {
    opportunityId,
    attemptType: 'domain_search',
    status: 'not_found',
    payload: { hotelName, city },
    creditsUsed: 0,
  });

  return { domain: null, method: null };
}

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

const BOOKING_DOMAINS = [
  'booking.com', 'tripadvisor.com', 'tripadvisor.fr', 'expedia.com',
  'hotels.com', 'kayak.com', 'trivago.com', 'agoda.com',
  'google.com', 'facebook.com', 'instagram.com', 'linkedin.com',
  'twitter.com', 'youtube.com', 'pagesjaunes.fr',
];

function isBookingDomain(domain) {
  return BOOKING_DOMAINS.some(d => domain.includes(d));
}

const GENERIC_DOMAINS = [
  'wikipedia.org', 'wikidata.org', 'societe.com', 'pappers.fr',
  'verif.com', 'infogreffe.fr', 'bodacc.fr', 'sirene.fr',
];

function isGenericDomain(domain) {
  return GENERIC_DOMAINS.some(d => domain.includes(d));
}

// ─── Étape 2 : Générer les patterns email ───────────────────────────────────

/**
 * Génère les patterns email possibles pour un contact.
 * Retourne un tableau ordonné par probabilité décroissante.
 *
 * Si un pattern validé existe déjà pour ce domaine, il est prioritaire.
 */
function generateEmailPatterns(db, { firstName, lastName, domain }) {
  if (!firstName || !lastName || !domain) return [];

  const f = normalizeForEmail(firstName);
  const l = normalizeForEmail(lastName);
  if (!f || !l) return [];

  const fi = f[0]; // Initiale du prénom

  // Vérifier si un pattern validé existe déjà pour ce domaine
  let knownPattern = null;
  try {
    const row = db.prepare(`
      SELECT email_pattern FROM veille_contacts
      WHERE domain = ? AND email_status = 'valid' AND email_pattern IS NOT NULL
      LIMIT 1
    `).get(domain);
    knownPattern = row?.email_pattern || null;
  } catch (_) { /* table pas encore créée */ }

  const patterns = [
    { pattern: 'first.last', email: `${f}.${l}@${domain}` },
    { pattern: 'firstlast', email: `${f}${l}@${domain}` },
    { pattern: 'flast', email: `${fi}${l}@${domain}` },
    { pattern: 'first', email: `${f}@${domain}` },
    { pattern: 'first-last', email: `${f}-${l}@${domain}` },
    { pattern: 'last.first', email: `${l}.${f}@${domain}` },
  ];

  // Si un pattern est connu pour ce domaine, le mettre en premier
  if (knownPattern) {
    patterns.sort((a, b) => {
      if (a.pattern === knownPattern) return -1;
      if (b.pattern === knownPattern) return 1;
      return 0;
    });
  }

  return patterns;
}

/**
 * Normalise un nom pour la génération d'email :
 * - lowercase, suppression accents, remplacement espaces/tirets
 */
function normalizeForEmail(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Supprimer les accents
    .replace(/[^a-z0-9]/g, '')       // Garder seulement lettres et chiffres
    .trim();
}

// ─── Étape 3 : Vérification ZeroBounce ──────────────────────────────────────

/**
 * Vérifie un email via l'API ZeroBounce.
 * Retourne { status, sub_status, score, free_email, did_you_mean }
 *
 * Statuts possibles : valid, invalid, catch-all, unknown, spamtrap, abuse, do_not_mail
 */
async function verifyEmail(apiKey, email) {
  const params = new URLSearchParams({
    api_key: apiKey,
    email: email,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`https://api.zerobounce.net/v2/validate?${params}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ZeroBounce ${res.status}: ${body.substring(0, 200)}`);
    }

    const data = await res.json();
    return {
      status: data.status,          // valid, invalid, catch-all, unknown, etc.
      sub_status: data.sub_status,
      score: data.confidence_score || null,
      free_email: data.free_email || false,
      did_you_mean: data.did_you_mean || null,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return { status: 'error', sub_status: 'timeout' };
    }
    throw err;
  }
}

/**
 * Vérifie les crédits ZeroBounce restants.
 */
async function getZeroBounceCredits(apiKey) {
  try {
    const res = await fetch(`https://api.zerobounce.net/v2/getcredits?api_key=${apiKey}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { credits: -1 };
    const data = await res.json();
    return { credits: parseInt(data.Credits) || 0 };
  } catch (_) {
    return { credits: -1 };
  }
}

/**
 * Vérifie les patterns email en cascade pour un contact.
 * S'arrête dès qu'un pattern est validé.
 *
 * @param {Object} db
 * @param {string} contactId
 * @param {Array} patterns - [{ pattern, email }]
 * @param {string} opportunityId
 * @returns {Object} { email, pattern, status, score, attempts }
 */
async function verifyEmailCascade(db, contactId, patterns, opportunityId) {
  const zbKey = getZeroBounceKey(db);
  if (!zbKey) {
    logger.warn('ZeroBounce: clé API non configurée');
    // Sans ZeroBounce, on garde le premier pattern par défaut (non vérifié)
    if (patterns.length > 0) {
      return {
        email: patterns[0].email,
        pattern: patterns[0].pattern,
        status: 'unverified',
        score: null,
        attempts: 0,
      };
    }
    return { email: null, pattern: null, status: 'no_patterns', score: null, attempts: 0 };
  }

  let attempts = 0;
  let catchAllEmail = null;
  let catchAllPattern = null;

  for (const { pattern, email } of patterns) {
    attempts++;

    try {
      const result = await verifyEmail(zbKey, email);

      logAttempt(db, {
        contactId,
        opportunityId,
        attemptType: 'zerobounce_verify',
        status: result.status,
        payload: { email, pattern, ...result },
        creditsUsed: 1,
      });

      if (result.status === 'valid') {
        return { email, pattern, status: 'valid', score: result.score, attempts };
      }

      if (result.status === 'catch-all' && !catchAllEmail) {
        catchAllEmail = email;
        catchAllPattern = pattern;
        // Continuer pour essayer de trouver un valid, mais on garde le catch-all
        if (attempts >= 2) {
          // Après 2 tentatives catch-all, on s'arrête
          return { email: catchAllEmail, pattern: catchAllPattern, status: 'catch_all', score: result.score, attempts };
        }
        continue;
      }

      if (result.status === 'invalid') {
        continue; // Essayer le pattern suivant
      }

      // Pour unknown, spamtrap, abuse, do_not_mail : skip
      if (['spamtrap', 'abuse', 'do_not_mail'].includes(result.status)) {
        continue;
      }

      // unknown → on continue
      if (result.status === 'unknown') {
        if (!catchAllEmail) {
          catchAllEmail = email;
          catchAllPattern = pattern;
        }
        continue;
      }

      // Rate limiting ZeroBounce
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      logger.warn(`ZeroBounce verify ${email}: ${err.message}`);
      logAttempt(db, {
        contactId,
        opportunityId,
        attemptType: 'zerobounce_verify',
        status: 'error',
        payload: { email, pattern, error: err.message },
        creditsUsed: 1,
      });
    }
  }

  // Si on a un catch-all, le retourner
  if (catchAllEmail) {
    return { email: catchAllEmail, pattern: catchAllPattern, status: 'catch_all', score: null, attempts };
  }

  // Tous les patterns sont invalid → statut unknown
  return { email: null, pattern: null, status: 'unknown', score: null, attempts };
}

// ─── Fonction combinée : domaine + patterns + vérification ──────────────────

/**
 * Pipeline complet pour un contact :
 * 1. Trouver le domaine
 * 2. Générer les patterns
 * 3. Vérifier en cascade
 * 4. Mettre à jour le contact en base
 */
async function resolveEmail(db, contact, opportunityData) {
  const { id: contactId, first_name, last_name, domain: existingDomain } = contact;
  const { opportunityId, hotelName, city, groupName, googlePlaceId } = opportunityData;

  // Étape 1 : Domaine
  let domain = existingDomain;
  if (!domain) {
    const result = await findEmailDomain(db, { hotelName, city, groupName, googlePlaceId, opportunityId });
    domain = result.domain;
    if (domain) {
      db.prepare('UPDATE veille_contacts SET domain = ? WHERE id = ?').run(domain, contactId);
    }
  }

  if (!domain) {
    db.prepare("UPDATE veille_contacts SET email_status = 'unknown', enrichment_date = datetime('now') WHERE id = ?").run(contactId);
    return { email: null, status: 'no_domain', attempts: 0 };
  }

  // Étape 2 : Patterns
  const patterns = generateEmailPatterns(db, { firstName: first_name, lastName: last_name, domain });
  if (patterns.length === 0) {
    db.prepare("UPDATE veille_contacts SET email_status = 'unknown', enrichment_date = datetime('now') WHERE id = ?").run(contactId);
    return { email: null, status: 'no_patterns', attempts: 0 };
  }

  // Étape 3 : Vérification
  const result = await verifyEmailCascade(db, contactId, patterns, opportunityId);

  // Étape 4 : Mise à jour du contact
  db.prepare(`
    UPDATE veille_contacts SET
      email = ?, email_pattern = ?, email_status = ?, email_score = ?,
      domain = ?, enrichment_date = datetime('now'), last_verified_at = datetime('now')
    WHERE id = ?
  `).run(
    result.email, result.pattern, result.status, result.score,
    domain, contactId
  );

  return result;
}

module.exports = {
  findEmailDomain,
  generateEmailPatterns,
  verifyEmail,
  verifyEmailCascade,
  getZeroBounceCredits,
  resolveEmail,
  normalizeForEmail,
  extractDomain,
  findChainDomain,
  getZeroBounceKey,
};
