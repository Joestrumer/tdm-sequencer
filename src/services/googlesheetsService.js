/**
 * googlesheetsService.js — Google Sheets via googleapis
 * Format de log : une ligne par produit (colonnes B→F + Q)
 * Réplique la logique du HTML standalone
 */

const { google } = require('googleapis');
const logger = require('../config/logger');


function getCredentials(db) {
  // 1. Essayer depuis la DB
  const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get('gsheets_credentials');
  if (row?.valeur) {
    try {
      const parsed = JSON.parse(row.valeur);
      if (parsed.private_key && parsed.client_email) return parsed;
    } catch {}
  }

  // 2. Essayer depuis env var
  if (process.env.GSHEETS_CREDENTIALS) {
    try {
      const parsed = JSON.parse(process.env.GSHEETS_CREDENTIALS);
      if (parsed.private_key && parsed.client_email) {
        // Stocker en DB pour la prochaine fois
        db.prepare("INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
          .run(process.env.GSHEETS_CREDENTIALS);
        logger.debug('🔧 GSheets: credentials restaurées depuis env var');
        return parsed;
      }
    } catch {}
  }

  return null;
}

function getAuth(db) {
  const creds = getCredentials(db);
  if (!creds) throw new Error('Credentials Google Sheets non configurés et fallback échoué.');
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function resolveCanonicalClientName(db, vfName) {
  if (!vfName) return vfName;
  const mapping = db.prepare('SELECT file_name FROM vf_client_mappings WHERE vf_name = ?').get(vfName);
  return (mapping && mapping.file_name) || vfName;
}

/**
 * Mappe un nom client VosFactures vers un nom "canonique" (liste du spreadsheet)
 * Logique portée depuis l'ancien outil HTML (lignes 272-364)
 *
 * @param {string} vfName - Nom du client dans VosFactures
 * @param {string[]} canonList - Liste des noms canoniques depuis le spreadsheet (colonne "Hotel name")
 * @returns {string} - Nom canonique mappé ou nom VF original si pas de match
 */
function mapPartnerNameToCanon(vfName, canonList = []) {
  if (!vfName) return vfName;

  // Helpers de normalisation (définis en premier pour être utilisés partout)
  const stripDiacritics = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const norm = (s) => stripDiacritics(String(s || '').toLowerCase())
    .replace(/[''`]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[\-_/.,:;!?\\"|\\]+/g, ' ')
    .replace(/\b(hotel|hôtel)\b/g, 'hotel')
    .replace(/\s+/g, ' ')
    .trim();

  // Normaliser la liste canon et filtrer les doublons (préférer noms courts)
  let cleanCanonList = (Array.isArray(canonList) ? canonList : [])
    .map(n => String(n || '').trim())
    .filter(Boolean);

  // Supprimer les doublons: si "Le Swann" et "HOTEL LITTERAIRE LE SWANN", garder "Le Swann"
  const dedupeMap = new Map();
  for (const name of cleanCanonList) {
    const n = norm(name);
    if (!dedupeMap.has(n) || name.length < dedupeMap.get(n).length) {
      dedupeMap.set(n, name);
    }
  }
  cleanCanonList = Array.from(dedupeMap.values());

  const vfNorm = norm(vfName);

  // Aliases manuels (priorité la plus haute)
  const manualAliases = {
    'hotel litteraire le swann': 'Le Swann',
    'litteraire le swann': 'Le Swann',
    'swann litteraire': 'Le Swann',
    'groupe franck putelat attn aurore': 'Hôtel Le Parc',
    'groupe franck putelat': 'Hôtel Le Parc',
    'franck putelat': 'Hôtel Le Parc',
    'hotel le rodrigue boronali': 'Hôtel Boronali (Le Rodrigue)',
  };
  if (manualAliases[vfNorm]) {
    logger.debug(`🎯 Alias manuel: "${vfName}" → "${manualAliases[vfNorm]}"`);
    return manualAliases[vfNorm];
  }

  // Debug: afficher le nom normalisé pour faciliter le débogage
  logger.debug(`🔍 Mapping "${vfName}" → normalisé: "${vfNorm}"`);

  // Règle spéciale: hôtels Korner -> noms "HK ..." (nouveau format de suivi)
  if (vfNorm.includes('korner')) {
    const kornerRules = [
      {k: 'montmartre', v: 'HK MONTMARTRE'},
      {k: 'montparnasse', v: 'HK Montparnasse'},
      {k: 'eiffel', v: 'HK Eiffel'},
      {k: 'saint marcel', v: 'HK Saint Marcel'},
      {k: 'saintmarcel', v: 'HK Saint Marcel'},
      {k: 'sorbonne', v: 'HK Sorbonne'},
      {k: 'opera', v: 'HK OPERA'},
      {k: 'opéra', v: 'HK OPERA'},
      {k: 'etoile', v: 'HK Etoile'},
      {k: 'étoile', v: 'HK Etoile'},
      {k: 'louvre', v: 'HK LOUVRE'},
      {k: 'chatelet', v: 'HK CHÂTELET'},
      {k: 'châtelet', v: 'HK CHÂTELET'},
      {k: 'republique', v: 'HK République'},
      {k: 'république', v: 'HK République'},
    ];
    // Prendre le match le plus spécifique (clé la plus longue)
    let best = null;
    let bestLen = 0;
    for (const r of kornerRules) {
      if (vfNorm.includes(r.k) && r.k.length > bestLen) {
        best = r.v;
        bestLen = r.k.length;
      }
    }
    if (best) {
      logger.debug(`🏨 Korner mapping: "${vfName}" → "${best}"`);
      return best;
    }
  }

  // VF_NAME_ALIASES vide pour l'instant (peut être renseigné plus tard en DB si besoin)
  // if (vfNorm && VF_NAME_ALIASES && VF_NAME_ALIASES[vfNorm]) return VF_NAME_ALIASES[vfNorm];

  // 2) Match exact (normalisé)
  const canonByNorm = new Map(cleanCanonList.map(c => [norm(c), c]));
  if (canonByNorm.has(vfNorm)) {
    const matched = canonByNorm.get(vfNorm);
    logger.debug(`✅ Match exact: "${vfName}" → "${matched}"`);
    return matched;
  }

  // 3) Inclusion "contient" (prend le match le plus long)
  let best = null;
  let bestLen = 0;
  for (const c of cleanCanonList) {
    const cNorm = norm(c);
    if (!cNorm) continue;
    if (vfNorm.includes(cNorm)) {
      if (cNorm.length > bestLen) {
        best = c;
        bestLen = cNorm.length;
      }
    }
  }
  if (best) {
    logger.debug(`🔍 Match contient: "${vfName}" → "${best}" (longueur: ${bestLen})`);
    return best;
  }

  // 4) Overlap tokens (fallback)
  const vfTokens = new Set(vfNorm.split(' ').filter(Boolean));
  let bestScore = 0;
  let bestName = null;
  for (const c of cleanCanonList) {
    const cTokens = norm(c).split(' ').filter(Boolean);
    if (!cTokens.length) continue;
    let hit = 0;
    for (const t of cTokens) if (vfTokens.has(t)) hit++;
    const score = hit / Math.max(1, Math.min(cTokens.length, vfTokens.size));
    if (score > bestScore) {
      bestScore = score;
      bestName = c;
    }
  }
  // Seuil volontairement conservateur pour éviter les faux positifs
  if (bestName && bestScore >= 0.75) {
    logger.debug(`🎯 Match tokens: "${vfName}" → "${bestName}" (score: ${bestScore.toFixed(2)})`);
    return bestName;
  }

  // 5) Aucun match sûr -> renvoyer le VF brut
  logger.debug(`⚠️ Aucun match trouvé pour "${vfName}", utilisation du nom VF brut`);
  return String(vfName || '').trim();
}

/**
 * Détermine si un produit utilise les "nouveaux prix" (N-prefixed)
 */
function isNewPriceLine(ref, priceHT) {
  if (!ref || ref === 'FP' || ref === 'FE') return false;
  const price = parseFloat(priceHT || 0);
  if (!Number.isFinite(price)) return false;

  // Flacons 500ml à 7.5€ = nouveaux prix
  if ((ref.includes('P007') || ref.includes('P008') || ref.includes('P010') ||
       ref.includes('P014') || ref.includes('P034') || ref.includes('P035')) &&
      !ref.includes('-5000') &&
      price >= 7.4 && price <= 7.6) return true;

  // Bidons 5L à 41€ = nouveaux prix
  if (ref.includes('-5000') && price >= 40.5 && price <= 41.5) return true;

  return false;
}

/**
 * Construit la ref de log avec préfixe N si nouveaux prix
 */
function buildLogRef(ref, priceHT, csvRef) {
  const rawRef = String(ref || '').trim();
  if (!rawRef) return '';
  const baseRef = csvRef || rawRef;
  const isNew = isNewPriceLine(rawRef, priceHT);

  if (baseRef === 'FP' || baseRef === 'FE') return baseRef;
  if (isNew) {
    if (baseRef.startsWith('N-')) return 'N' + baseRef.substring(2);
    if (baseRef.startsWith('N')) return baseRef;
    return 'N' + baseRef;
  } else {
    if (baseRef.startsWith('N-')) return baseRef.substring(2);
    if (baseRef.startsWith('N') && (baseRef[1] === 'P' || (baseRef[1] >= '0' && baseRef[1] <= '9'))) return baseRef.substring(1);
    return baseRef;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = String(dateStr).split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
}

module.exports = (db) => ({
  async getSheetStatus(spreadsheetId) {
    try {
      const auth = getAuth(db);
      const sheets = google.sheets({ version: 'v4', auth });
      const res = await sheets.spreadsheets.get({ spreadsheetId });
      return {
        ok: true,
        title: res.data.properties.title,
        sheets: res.data.sheets.map(s => s.properties.title),
      };
    } catch (e) {
      return { ok: false, erreur: e.message };
    }
  },

  async getPartners(spreadsheetId, sheetName) {
    const auth = getAuth(db);
    const sheets = google.sheets({ version: 'v4', auth });
    const range = `${sheetName}!B:B`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = (res.data.values || []).map(r => r[0]).filter(Boolean);
    return [...new Set(values)];
  },

  /**
   * Log une facture dans Google Sheets — une ligne par produit
   * Colonnes : B=Hotel name, C=Order#, D=Invoice Number, E=Product Ref, F=Quantity, Q=Date facture
   *
   * @param {string} spreadsheetId
   * @param {string} sheetName
   * @param {object} invoiceData - { clientName, invoiceNumber, invoiceDate, products: [{ref, quantity, priceHT, csvRef}] }
   * @param {string} partnerName - nom canonique du partenaire (ou sera résolu via clientNameMapping)
   */
  async logInvoice(spreadsheetId, sheetName, invoiceData, partnerName) {
    const auth = getAuth(db);
    const sheets = google.sheets({ version: 'v4', auth });

    // 1) Lire les noms canoniques depuis la DB (vf_partners) — source de vérité fiable
    // On n'utilise PAS la colonne B du spreadsheet car elle peut contenir des noms VF non-canoniques
    let canonicalNames = [];
    try {
      const dbPartners = db.prepare('SELECT nom FROM vf_partners WHERE actif = 1').all();
      canonicalNames = dbPartners.map(p => p.nom).filter(Boolean);
      logger.debug(`📊 GSheets: ${canonicalNames.length} noms canoniques lus depuis vf_partners DB`);
    } catch (e) {
      logger.warn(`⚠️ Impossible de lire vf_partners: ${e.message}`);
      // Fallback : lire depuis le spreadsheet si la DB échoue
      try {
        const partnersResult = await this.getPartners(spreadsheetId, sheetName);
        canonicalNames = partnersResult || [];
        logger.debug(`📊 GSheets: fallback spreadsheet, ${canonicalNames.length} noms lus`);
      } catch (e2) {
        logger.warn(`⚠️ Impossible de lire les noms depuis le spreadsheet: ${e2.message}`);
      }
    }

    // 2) Résoudre le nom canonique via mapPartnerNameToCanon si partnerName non fourni
    let mappedPartnerName = partnerName;
    if (!mappedPartnerName) {
      const vfName = invoiceData.clientName || '';
      logger.debug(`📊 Résolution partner name: VF="${vfName}"`);

      // D'abord essayer le mapping DB (vf_client_mappings)
      const dbMapped = resolveCanonicalClientName(db, vfName);
      logger.debug(`📊 Mapping DB: "${vfName}" → "${dbMapped}"`);

      if (dbMapped && dbMapped !== vfName) {
        // Mapping explicite trouvé
        mappedPartnerName = dbMapped;
        logger.debug(`📊 Mapping DB trouvé: "${vfName}" → "${mappedPartnerName}"`);
      } else if (canonicalNames.length > 0) {
        // Pas de mapping DB, utiliser mapPartnerNameToCanon avec la liste canonique
        logger.debug(`📊 Pas de mapping DB, utilisation mapPartnerNameToCanon avec ${canonicalNames.length} noms`);
        mappedPartnerName = mapPartnerNameToCanon(vfName, canonicalNames);
      } else {
        // Aucune source de noms canoniques, utiliser le nom VF brut
        mappedPartnerName = vfName;
        logger.debug(`⚠️ Aucune source canonique disponible, utilisation nom VF brut`);
      }
    }

    logger.debug(`📊 GSheets logInvoice: partnerName="${partnerName}", clientName="${invoiceData.clientName}", mapped="${mappedPartnerName}"`);
    if (!mappedPartnerName) {
      return { ok: false, erreur: 'Impossible de résoudre le nom du partenaire', status: 'failed_mapping' };
    }

    // 1) Lire les colonnes B→D pour trouver la prochaine ligne vide et compter les commandes existantes
    const rangeRead = `${sheetName}!B:D`;
    const resRead = await sheets.spreadsheets.values.get({ spreadsheetId, range: rangeRead });
    const bdRows = resRead.data.values || [];

    const cleanCell = (v) => String(v ?? '').replace(/[\u00A0\u2000-\u200D\u202F\u205F\u3000\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // Trouver la dernière ligne non-vide en colonne B (en ignorant les formules)
    let lastDataRow = 1;
    for (let i = 1; i < bdRows.length; i++) {
      const b = cleanCell(bdRows[i]?.[0] || '');
      if (b && !b.startsWith('=')) lastDataRow = i + 1;
    }
    const nextRow = lastDataRow + 1;
    logger.debug(`📊 GSheets: ${bdRows.length} lignes lues, lastDataRow=${lastDataRow}, nextRow=${nextRow}`);

    // Calculer Order # : max Order # existant + 1 pour ce partenaire canonique
    // Logique métier: 0 = implantation, 1+ = réappro
    const targetNorm = norm(mappedPartnerName);
    let maxOrderNum = -1; // -1 signifie aucune commande existante

    for (let i = 1; i < bdRows.length; i++) {
      const b = cleanCell(bdRows[i]?.[0] || '');
      const c = cleanCell(bdRows[i]?.[1] || ''); // Colonne C = Order #
      if (!b || b.startsWith('=')) continue;

      // Si c'est le même partenaire canonique
      if (norm(b) === targetNorm) {
        // Lire Order # de cette ligne
        const orderNum = parseInt(c, 10);
        if (!isNaN(orderNum) && orderNum > maxOrderNum) {
          maxOrderNum = orderNum;
        }
      }
    }

    // Si aucune commande existante, c'est l'implantation (0), sinon max + 1
    const orderNumber = maxOrderNum === -1 ? 0 : maxOrderNum + 1;
    logger.debug(`📊 Order # calculé pour "${mappedPartnerName}": maxOrderNum=${maxOrderNum}, nouveau orderNumber=${orderNumber}`);

    // 2) Construire les lignes à écrire
    const products = Array.isArray(invoiceData.products) ? invoiceData.products : [];
    if (!products.length) {
      return { ok: false, erreur: 'Aucun produit à logger', status: 'failed_payload' };
    }

    const invoiceNumber = cleanCell(invoiceData.invoiceNumber || '');
    const invoiceDate = formatDate(invoiceData.invoiceDate || invoiceData.sell_date || new Date().toISOString().split('T')[0]);

    const valuesBF = [];
    const valuesQ = [];

    for (const p of products) {
      const ref = String(p.ref || '').trim();
      if (!ref) continue; // Skip lignes vides

      valuesBF.push([
        mappedPartnerName,                           // B: Hotel name
        String(orderNumber),                          // C: Order #
        invoiceNumber,                                // D: Invoice Number
        buildLogRef(ref, p.priceHT || p.prix_ht, p.csvRef || p.csv_ref), // E: Product Ref
        String(p.quantity || p.quantite || ''),        // F: Quantity
      ]);
      valuesQ.push([invoiceDate]);                    // Q: Date facture
    }

    if (!valuesBF.length) {
      return { ok: false, erreur: 'Aucune ligne produit à logger (tous FP/FE)', status: 'failed_payload' };
    }

    // 3) Écrire B→F et Q en batch (ne touche PAS A ni G-P qui ont des formules)
    const endRow = nextRow + valuesBF.length - 1;
    logger.debug(`📊 GSheets: écriture ${valuesBF.length} lignes, range B${nextRow}:F${endRow} + Q${nextRow}:Q${endRow}`);
    logger.debug(`📊 GSheets: première ligne = ${JSON.stringify(valuesBF[0])}, date = ${invoiceDate}`);

    const writeResult = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `${sheetName}!B${nextRow}:F${endRow}`,
            values: valuesBF,
          },
          {
            range: `${sheetName}!Q${nextRow}:Q${endRow}`,
            values: valuesQ,
          },
        ],
      },
    });

    logger.debug(`📊 GSheets: batchUpdate réponse: ${writeResult.data.totalUpdatedCells} cellules mises à jour`);

    return {
      ok: true,
      status: 'logged',
      writtenLines: valuesBF.length,
      startRow: nextRow,
      endRow,
      partnerName: mappedPartnerName,
      orderNumber,
      updatedCells: writeResult.data.totalUpdatedCells,
    };
  },

  /**
   * Lit toutes les données de l'onglet "log sold" pour générer des analytics CA
   * Structure attendue : colonnes avec headers en ligne 1
   */
  async getLogSoldData(spreadsheetId, sheetName = 'log sold') {
    const auth = getAuth(db);
    const sheets = google.sheets({ version: 'v4', auth });

    // Lire toutes les données de la feuille (jusqu'à colonne Z)
    const range = `${sheetName}!A:Z`;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = res.data.values || [];

    if (rows.length === 0) {
      return { ok: false, erreur: 'Onglet vide' };
    }

    // La première ligne contient les headers
    const headers = rows[0].map(h => String(h || '').trim());
    const data = [];

    // Parser les lignes suivantes
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = {};

      headers.forEach((header, idx) => {
        obj[header] = row[idx] || '';
      });

      // Ignorer les lignes vides
      if (Object.values(obj).some(v => v)) {
        data.push(obj);
      }
    }

    return {
      ok: true,
      headers,
      data,
      totalRows: data.length,
    };
  },
});
