/**
 * pappersService.js — Recherche de sociétés et dirigeants via l'API Pappers
 *
 * Fonctionnalités :
 * - Recherche par nom commercial + ville → SIREN, forme juridique, adresse
 * - Récupération des dirigeants actuels (président, gérant, DG) avec date de prise de fonction
 * - Détection SCI propriétaire si exploitation distincte
 *
 * API : https://api.pappers.fr/v2/
 * Quota gratuit : 100 req/jour
 * Coût pro : ~50€/mois pour 1000 req/jour
 *
 * Dépendances : table config (clé pappers_api_key) + env PAPPERS_API_KEY
 */

const { randomUUID } = require('crypto');
const logger = require('../../config/logger');

// ─── Config ─────────────────────────────────────────────────────────────────

function getApiKey(db) {
  try {
    const row = db.prepare("SELECT valeur FROM config WHERE cle = 'pappers_api_key'").get();
    return row?.valeur || process.env.PAPPERS_API_KEY || '';
  } catch (_) {
    return process.env.PAPPERS_API_KEY || '';
  }
}

// ─── Appel API Pappers ──────────────────────────────────────────────────────

async function pappersGet(apiKey, endpoint, params = {}) {
  const url = new URL(`https://api.pappers.fr/v2/${endpoint}`);
  url.searchParams.set('api_token', apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 429) {
        logger.warn('Pappers: quota journalier dépassé');
        return { error: 'quota_exceeded', status: 429 };
      }
      throw new Error(`Pappers API ${res.status}: ${body.substring(0, 200)}`);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      logger.warn('Pappers: timeout');
      return { error: 'timeout' };
    }
    throw err;
  }
}

// ─── Recherche entreprise par nom + ville ───────────────────────────────────

/**
 * Recherche une entreprise par nom commercial et ville.
 * Retourne le SIREN, la dénomination, l'adresse et les dirigeants.
 *
 * @param {Object} db
 * @param {string} hotelName - Nom commercial de l'hôtel
 * @param {string} city - Ville
 * @returns {Object} { siren, denomination, adresse, dirigeants[], raw }
 */
async function rechercherEntreprise(db, hotelName, city) {
  const apiKey = getApiKey(db);
  if (!apiKey) {
    return { error: 'no_api_key', dirigeants: [] };
  }

  // Recherche textuelle
  const query = city ? `${hotelName} ${city}` : hotelName;
  const data = await pappersGet(apiKey, 'recherche', {
    q: query,
    code_naf: '5510Z', // Hôtels et hébergement similaire
    par_page: 5,
  });

  if (data.error) return { ...data, dirigeants: [] };

  const resultats = data.resultats || [];
  if (resultats.length === 0) {
    // Retry sans code NAF (l'hôtel peut être sous un NAF différent)
    const data2 = await pappersGet(apiKey, 'recherche', {
      q: query,
      par_page: 5,
    });
    if (data2.error) return { ...data2, dirigeants: [] };
    const resultats2 = data2.resultats || [];
    if (resultats2.length === 0) {
      return { error: 'not_found', dirigeants: [] };
    }
    return processResultats(resultats2, hotelName, city);
  }

  return processResultats(resultats, hotelName, city);
}

function processResultats(resultats, hotelName, city) {
  // Prendre le meilleur match (le premier est le plus pertinent côté Pappers)
  const best = resultats[0];
  const siren = best.siren;
  const denomination = best.nom_entreprise || best.denomination || '';
  const adresse = [
    best.siege?.adresse_ligne_1,
    best.siege?.code_postal,
    best.siege?.ville,
  ].filter(Boolean).join(', ');

  // Extraire les dirigeants
  const dirigeants = (best.representants || []).map(r => ({
    full_name: [r.prenom, r.nom].filter(Boolean).join(' '),
    first_name: r.prenom || '',
    last_name: r.nom || '',
    role: normalizeRole(r.qualite || ''),
    role_raw: r.qualite || '',
    role_relevance: scoreRole(r.qualite || ''),
    date_prise_poste: r.date_prise_de_poste || null,
  })).filter(d => d.full_name.length > 2);

  return {
    siren,
    denomination,
    adresse,
    code_naf: best.code_naf,
    forme_juridique: best.forme_juridique,
    dirigeants,
    raw: best,
  };
}

// ─── Récupération détaillée par SIREN ───────────────────────────────────────

/**
 * Récupère les détails complets d'une entreprise par SIREN,
 * incluant les bénéficiaires effectifs.
 */
async function getEntrepriseBySiren(db, siren) {
  const apiKey = getApiKey(db);
  if (!apiKey) return { error: 'no_api_key' };

  const data = await pappersGet(apiKey, 'entreprise', { siren });
  if (data.error) return data;

  const dirigeants = (data.representants || []).map(r => ({
    full_name: [r.prenom, r.nom].filter(Boolean).join(' '),
    first_name: r.prenom || '',
    last_name: r.nom || '',
    role: normalizeRole(r.qualite || ''),
    role_raw: r.qualite || '',
    role_relevance: scoreRole(r.qualite || ''),
    date_prise_poste: r.date_prise_de_poste || null,
  })).filter(d => d.full_name.length > 2);

  // Bénéficiaires effectifs (propriétaires réels)
  const beneficiaires = (data.beneficiaires_effectifs || []).map(b => ({
    full_name: [b.prenom, b.nom].filter(Boolean).join(' '),
    first_name: b.prenom || '',
    last_name: b.nom || '',
    role: 'Bénéficiaire effectif',
    role_raw: 'Bénéficiaire effectif',
    role_relevance: 60,
    pourcentage: b.pourcentage_parts || null,
  })).filter(d => d.full_name.length > 2);

  return {
    siren: data.siren,
    denomination: data.nom_entreprise || data.denomination || '',
    adresse: [
      data.siege?.adresse_ligne_1,
      data.siege?.code_postal,
      data.siege?.ville,
    ].filter(Boolean).join(', '),
    code_naf: data.code_naf,
    forme_juridique: data.forme_juridique,
    site_web: data.site_url || null,
    dirigeants,
    beneficiaires,
    raw: data,
  };
}

// ─── Normalisation et scoring des rôles ─────────────────────────────────────

const ROLE_MAP = {
  'président': 'Président',
  'presidente': 'Présidente',
  'président du conseil d\'administration': 'Président',
  'président-directeur général': 'PDG',
  'directeur général': 'Directeur Général',
  'gérant': 'Gérant',
  'gerante': 'Gérante',
  'co-gérant': 'Co-Gérant',
  'administrateur': 'Administrateur',
  'directeur': 'Directeur',
  'directeur technique': 'Directeur Technique',
  'directeur des achats': 'Directeur des Achats',
  'commissaire aux comptes titulaire': 'CAC',
  'commissaire aux comptes': 'CAC',
  'liquidateur': 'Liquidateur',
};

function normalizeRole(qualite) {
  const lower = (qualite || '').toLowerCase().trim();
  return ROLE_MAP[lower] || qualite;
}

/**
 * Score de pertinence du rôle pour notre offre amenity (0-100).
 * Basé sur la matrice du plan Phase 2.
 */
function scoreRole(qualite) {
  const lower = (qualite || '').toLowerCase();

  // Directeur technique / services techniques = décideur direct amenities
  if (/directe?u?r?\s*(des\s+)?service[s]?\s+technique/i.test(lower) ||
      /directe?u?r?\s+technique/i.test(lower)) return 100;

  // Directeur des achats / Acheteur
  if (/achat|acheteu/i.test(lower)) return 95;

  // F&B / Housekeeping
  if (/f\s*&?\s*b|food|beverage|housekeep|gouvernant/i.test(lower)) return 90;

  // DG / General Manager / PDG
  if (/directeur\s+g[ée]n[ée]ral|pdg|pr[ée]sident.?directeur|general\s+manager/i.test(lower)) return 85;
  if (/directeur/i.test(lower) && !/commercial|revenue|financ/i.test(lower)) return 80;

  // Spa Manager
  if (/spa/i.test(lower)) return 80;

  // Gérant / Président (peut être opérationnel)
  if (/g[ée]rant|pr[ée]sident/i.test(lower)) return 75;

  // Propriétaire / Bénéficiaire
  if (/propri[ée]taire|b[ée]n[ée]ficiaire/i.test(lower)) return 60;

  // Administrateur
  if (/administrateur/i.test(lower)) return 50;

  // Revenue / Commercial = rarement impliqué dans amenities
  if (/commercial|revenue|financ/i.test(lower)) return 40;

  // CAC / Commissaire = pas pertinent
  if (/commissaire|liquidat/i.test(lower)) return 10;

  return 50; // Par défaut
}

// ─── Insertion en base ──────────────────────────────────────────────────────

/**
 * Insère les contacts trouvés par Pappers en base.
 * Déduplique par full_name + opportunity_id.
 */
function insertPappersContacts(db, opportunityId, hotelName, siren, dirigeants) {
  const inserted = [];

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO veille_contacts
      (id, opportunity_id, hotel_name, full_name, first_name, last_name,
       role, role_relevance, email_source, siren, enrichment_date, raw_payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pappers', ?, datetime('now'), ?, datetime('now'))
  `);

  const checkStmt = db.prepare(`
    SELECT id FROM veille_contacts
    WHERE opportunity_id = ? AND full_name = ?
  `);

  for (const d of dirigeants) {
    // Skip les CAC et liquidateurs
    if (d.role_relevance <= 10) continue;

    // Dédup
    const existing = checkStmt.get(opportunityId, d.full_name);
    if (existing) continue;

    const id = randomUUID();
    try {
      insertStmt.run(
        id, opportunityId, hotelName,
        d.full_name, d.first_name, d.last_name,
        d.role, d.role_relevance,
        siren,
        JSON.stringify({ role_raw: d.role_raw, date_prise_poste: d.date_prise_poste })
      );
      inserted.push({ id, full_name: d.full_name, role: d.role, role_relevance: d.role_relevance });
    } catch (err) {
      logger.warn(`Pappers insert contact: ${err.message}`);
    }
  }

  return inserted;
}

/**
 * Log une tentative d'enrichissement.
 */
function logAttempt(db, { contactId, opportunityId, attemptType, status, payload, creditsUsed = 1 }) {
  try {
    db.prepare(`
      INSERT INTO veille_contact_attempts (id, contact_id, opportunity_id, attempt_type, status, payload, credits_used)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), contactId || null, opportunityId || null,
      attemptType, status,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      creditsUsed
    );
  } catch (err) {
    logger.warn(`Log attempt: ${err.message}`);
  }
}

module.exports = {
  rechercherEntreprise,
  getEntrepriseBySiren,
  insertPappersContacts,
  logAttempt,
  scoreRole,
  normalizeRole,
  getApiKey,
};
