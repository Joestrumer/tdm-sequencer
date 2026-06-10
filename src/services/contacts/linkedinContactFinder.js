/**
 * linkedinContactFinder.js — Recherche de contacts décideurs via Brave Search
 *
 * Stratégie : pas de scraping LinkedIn direct (ToS).
 * On utilise Brave Search avec site:linkedin.com/in pour trouver les profils
 * de décideurs liés à un hôtel, puis on extrait nom/rôle/URL depuis les
 * snippets de résultats de recherche.
 *
 * Déduplication Levenshtein avec les contacts Pappers existants.
 *
 * Dépendances : API Brave Search (existante), table config
 */

const { randomUUID } = require('crypto');
const logger = require('../../config/logger');
const { logAttempt } = require('./pappersService');
const { trackBraveCall } = require('../../utils/apiClient');

// ─── Config ─────────────────────────────────────────────────────────────────

function getBraveKey(db) {
  try {
    const row = db.prepare("SELECT valeur FROM config WHERE cle = 'brave_search_api_key'").get();
    return row?.valeur || process.env.BRAVE_SEARCH_API_KEY || '';
  } catch (_) {
    return process.env.BRAVE_SEARCH_API_KEY || '';
  }
}

// ─── Brave Search ───────────────────────────────────────────────────────────

async function searchBrave(apiKey, query, db = null) {
  const params = new URLSearchParams({
    q: query,
    count: '15',
    search_lang: 'fr',
    country: 'fr',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Brave API ${res.status}: ${body.substring(0, 200)}`);
    }

    trackBraveCall(db, 'linkedin_contacts');
    const data = await res.json();
    return data.web?.results || [];
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      logger.warn('LinkedIn Contact Finder: timeout Brave');
      return [];
    }
    throw err;
  }
}

// ─── Queries de recherche ───────────────────────────────────────────────────

function buildQueries(hotelName, city) {
  const queries = [];
  const hotel = hotelName.replace(/"/g, '');
  const loc = city ? ` ${city}` : '';

  // LinkedIn profiles
  queries.push(`site:linkedin.com/in "${hotel}"${loc} (directeur OR gérant OR DG OR "general manager" OR propriétaire)`);
  queries.push(`site:linkedin.com/in "${hotel}"${loc} (achat OR technique OR housekeeping OR "food and beverage" OR spa)`);

  // Site carrières hôtel (hors LinkedIn)
  queries.push(`"${hotel}"${loc} (directeur OR gérant OR "general manager") -site:linkedin.com -site:booking.com -site:tripadvisor.com`);

  return queries;
}

// ─── Extraction depuis les résultats Brave ──────────────────────────────────

const LINKEDIN_URL_RE = /linkedin\.com\/in\/([a-zA-Z0-9-]+)/;

// Patterns pour extraire le rôle depuis le titre LinkedIn (title ou description)
const ROLE_PATTERNS = [
  // "Jean Dupont - Directeur Général - Hôtel Le Grand Lyon | LinkedIn"
  /^([^-–|]+)\s*[-–|]\s*([^-–|]+)\s*[-–|]/,
  // "Jean Dupont — Directeur Général chez Hôtel Le Grand Lyon"
  /^([^—]+)\s*—\s*(.+?)(?:\s+chez\s+|\s+at\s+|\s*\|)/i,
];

const ROLE_KEYWORDS_MAP = {
  'directeur général': { role: 'Directeur Général', relevance: 85 },
  'general manager': { role: 'General Manager', relevance: 85 },
  'directeur technique': { role: 'Directeur Technique', relevance: 100 },
  'directeur des services techniques': { role: 'Directeur Technique', relevance: 100 },
  'directeur des achats': { role: 'Directeur des Achats', relevance: 95 },
  'responsable achats': { role: 'Responsable Achats', relevance: 90 },
  'acheteur': { role: 'Acheteur', relevance: 90 },
  'directeur f&b': { role: 'Directeur F&B', relevance: 90 },
  'food & beverage': { role: 'Directeur F&B', relevance: 90 },
  'food and beverage': { role: 'Directeur F&B', relevance: 90 },
  'responsable f&b': { role: 'Responsable F&B', relevance: 85 },
  'gouvernant': { role: 'Gouvernant Général', relevance: 90 },
  'gouvernante': { role: 'Gouvernante Générale', relevance: 90 },
  'housekeeping': { role: 'Housekeeping Manager', relevance: 90 },
  'executive housekeeper': { role: 'Executive Housekeeper', relevance: 90 },
  'spa manager': { role: 'Spa Manager', relevance: 80 },
  'directeur du spa': { role: 'Directeur Spa', relevance: 80 },
  'directeur': { role: 'Directeur', relevance: 75 },
  'gérant': { role: 'Gérant', relevance: 75 },
  'propriétaire': { role: 'Propriétaire', relevance: 60 },
  'pdg': { role: 'PDG', relevance: 85 },
  'président': { role: 'Président', relevance: 75 },
};

function extractContactFromResult(result) {
  const title = result.title || '';
  const desc = result.description || '';
  const url = result.url || '';

  // Vérifier que c'est un profil LinkedIn
  const linkedinMatch = url.match(LINKEDIN_URL_RE);
  const linkedinUrl = linkedinMatch ? `https://www.linkedin.com/in/${linkedinMatch[1]}` : null;

  let name = null;
  let roleText = null;

  // Essayer d'extraire nom et rôle depuis le titre
  for (const pattern of ROLE_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      name = match[1].trim();
      roleText = match[2].trim();
      break;
    }
  }

  // Fallback : si le titre est juste un nom (pas de séparateur)
  if (!name && title.length > 3 && title.length < 80) {
    name = title.split(/[-–|]/)[0].trim();
    // Chercher le rôle dans la description
    roleText = desc;
  }

  if (!name || name.length < 3) return null;

  // Nettoyer le nom (enlever "| LinkedIn", emojis, etc.)
  name = name
    .replace(/\|?\s*linkedin/gi, '')
    .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Détecter le rôle
  let role = null;
  let roleRelevance = 50;
  const textToSearch = `${roleText || ''} ${desc}`.toLowerCase();

  for (const [keyword, info] of Object.entries(ROLE_KEYWORDS_MAP)) {
    if (textToSearch.includes(keyword)) {
      role = info.role;
      roleRelevance = info.relevance;
      break;
    }
  }

  // Séparer prénom / nom (heuristique simple)
  const nameParts = name.split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  return {
    full_name: name,
    first_name: firstName,
    last_name: lastName,
    role,
    role_relevance: roleRelevance,
    linkedin_url: linkedinUrl,
    source_title: title,
    source_description: desc.substring(0, 300),
  };
}

// ─── Déduplication Levenshtein ──────────────────────────────────────────────

function levenshtein(a, b) {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const matrix = Array.from({ length: la + 1 }, (_, i) => {
    const row = new Array(lb + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= lb; j++) matrix[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[la][lb];
}

/**
 * Vérifie si un contact LinkedIn correspond à un contact Pappers existant.
 * Match si Levenshtein(nom1, nom2) <= 3 (tolérance accents/espaces).
 */
function isDuplicate(linkedinName, existingContacts) {
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const ln = norm(linkedinName);

  for (const c of existingContacts) {
    if (levenshtein(ln, norm(c.full_name)) <= 3) {
      return c; // Retourne le contact existant qui matche
    }
  }
  return null;
}

// ─── Recherche principale ───────────────────────────────────────────────────

/**
 * Recherche les contacts LinkedIn liés à un hôtel.
 * Déduplique avec les contacts Pappers existants (enrichit au lieu de dupliquer).
 *
 * @param {Object} db
 * @param {string} hotelName
 * @param {string} city
 * @param {string} opportunityId
 * @returns {Object} { contacts_found, contacts_updated, contacts_new }
 */
async function findLinkedInContacts(db, hotelName, city, opportunityId) {
  const apiKey = getBraveKey(db);
  if (!apiKey) {
    return { error: 'no_brave_key', contacts_found: 0 };
  }

  // Charger les contacts Pappers existants pour dédup
  const existingContacts = db.prepare(
    'SELECT id, full_name, linkedin_url FROM veille_contacts WHERE opportunity_id = ?'
  ).all(opportunityId);

  const queries = buildQueries(hotelName, city);
  const seenUrls = new Set();
  const allContacts = [];
  let updated = 0;
  let created = 0;

  for (const query of queries) {
    try {
      const results = await searchBrave(apiKey, query, db);

      for (const r of results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);

        const contact = extractContactFromResult(r);
        if (!contact) continue;
        if (!contact.role && !contact.linkedin_url) continue; // Pas assez d'info

        // Vérifier la duplication avec Pappers
        const dup = isDuplicate(contact.full_name, existingContacts);

        if (dup) {
          // Enrichir le contact existant avec l'URL LinkedIn
          if (contact.linkedin_url && !dup.linkedin_url) {
            db.prepare('UPDATE veille_contacts SET linkedin_url = ? WHERE id = ?')
              .run(contact.linkedin_url, dup.id);
            updated++;
          }
          // Enrichir le rôle si LinkedIn donne un rôle plus précis
          if (contact.role && contact.role_relevance > 50) {
            db.prepare('UPDATE veille_contacts SET role = ?, role_relevance = ? WHERE id = ? AND role_relevance < ?')
              .run(contact.role, contact.role_relevance, dup.id, contact.role_relevance);
          }
        } else {
          // Nouveau contact
          const id = randomUUID();
          try {
            db.prepare(`
              INSERT OR IGNORE INTO veille_contacts
                (id, opportunity_id, hotel_name, full_name, first_name, last_name,
                 role, role_relevance, linkedin_url, email_source, raw_payload, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'linkedin_scrape', ?, datetime('now'))
            `).run(
              id, opportunityId, hotelName,
              contact.full_name, contact.first_name, contact.last_name,
              contact.role, contact.role_relevance,
              contact.linkedin_url,
              JSON.stringify({
                source_title: contact.source_title,
                source_description: contact.source_description,
              })
            );
            created++;
            // Ajouter aux existants pour dédup intra-batch
            existingContacts.push({ id, full_name: contact.full_name, linkedin_url: contact.linkedin_url });
          } catch (err) {
            logger.warn(`LinkedIn insert contact: ${err.message}`);
          }
        }

        allContacts.push(contact);
      }

      // Rate limiting Brave
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      logger.warn(`LinkedIn Contact Finder: ${err.message}`);
    }
  }

  // Log l'attempt
  logAttempt(db, {
    opportunityId,
    attemptType: 'linkedin_scrape',
    status: allContacts.length > 0 ? 'success' : 'no_results',
    payload: { queries_run: queries.length, results_found: allContacts.length, created, updated },
    creditsUsed: 0, // Brave = inclus dans le plan
  });

  logger.info(`LinkedIn Contacts: ${hotelName} — ${allContacts.length} trouvé(s), ${created} nouveau(x), ${updated} enrichi(s)`);

  return {
    contacts_found: allContacts.length,
    contacts_new: created,
    contacts_updated: updated,
  };
}

module.exports = {
  findLinkedInContacts,
  extractContactFromResult,
  isDuplicate,
  levenshtein,
};
