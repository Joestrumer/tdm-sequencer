/**
 * googlesheetsService.js — Google Sheets via googleapis
 * Format de log : une ligne par produit (colonnes B→F + Q)
 * Réplique la logique du HTML standalone
 */

const { google } = require('googleapis');

// Base64 embarqué des credentials service account (fallback si DB vide)
const EMBEDDED_CREDS_B64 = 'eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6Im91dGlsLWZhY3R1cmVzLXRkbSIsInByaXZhdGVfa2V5X2lkIjoiZDZjMTFkZDhhZmFmODc0MzExOWVkMDZjNGYzYjZjNjhkOGU4OGRiYSIsInByaXZhdGVfa2V5IjoiLS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tXG5NSUlFdmdJQkFEQU5CZ2txaGtpRzl3MEJBUUVGQUFTQ0JLZ3dnZ1NrQWdFQUFvSUJBUURHMVVWa0s0ZXNPUnVZXG5EdHQ4MUxubDMydkdVb1NnOTJrL2UxaUZOeDRwRWFMNHN0ZWh1clN2VUdqbzE0Rll5VWhYYUtZNm9uMHRwR3dlXG5xLzBEUllKOGpZTGtYSXFKSm9yN29wMU1Yb2dLRThoWFY5SSs3ZUNJYmNueW1icXN4NkhoU2hic3NRdzloM0JhXG5Fa0lNMno2V05kV0Z1UUhNMFNpaklvS2lSaVJvLzEweExmVnlpVGxEQ0xOWDJzeXhldURBQU4rSU5Jektja2pPXG5ONWxJOUlLb1dJcXlzSTRBZ2VqUzBOS2s2dXJjUEJaKzlNRmZmZ3FzbXRSd2g5TUxXRERaQkROMGFZK2I3dk4wXG5JZ1Z0NVZzZUN0SXZ2UDNDVklKRjRBWTV3Tlg3b3pwK3pMc0xxcUQ3RS9VRS82ME1NMFh3bXBCOWlkSTU2emx3XG41TXQydWdIcEFnTUJBQUVDZ2dFQUN4d3pxbXM4UTRWVlkyUEJJL0tIQ0s0NVNIV243NDZqbE9hQmhjQVVzVnJJXG43bmlmeit1czJQYjNSYnQxQU04T2VjUGhOZm1LWVJpRTZobldJMjZvNGVqT1haQkdOVyt2Nkd1bnVuSzF5MHBiXG5zWFc0eThkaStueVlBalJRMkFLM3F1MEc1dWJsdGpKeE5yYzZkWmx5bjlZV1BraWVMeUdvMGFUR0ErZERkWkpsXG42cTBBSFZwaXF3bjZoTXhOVUl1WElIM2xwSGJpZnMxdkEwQlhVSlU1cFFJMld3V0ozcmVMeTF1dktPMEszekpNXG52YzJJVDZicmlmVlNtcSsvVldQMmlDZTcyRldFK3NGMG1SbU5vaFlPcVcvaS9XeERJN2ZraStNYUNTcWNaM3RTXG5NN3RYVnZiN2l6MEIvWVRJdDJ4QUVlWXkwNE54OXdMUTVUN0JqYXZFdVFLQmdRRC83U01JaHFzK0lZMGNMdEc1XG5oMVo1disvWWNmWWVSNW5xc3pvWDRiR3BVYnRjOVVXWjhKeXYwTVk1ai9JOTczelNiMDNSc3BRME1ldU9iMHYwXG5Cdi9wclRYaTI3MVlpM3ZOZVVCTUhSWU00MkZMK0s3Q3VTVGZsWFhoVmpHUXdGQjgwQ1VTWVZmZjZBTzFyY0k0XG5MSGlSaXM2VitHRitwQzA1MGpTUGhRZlcwd0tCZ1FERzQrMFcreEpvN040TStDN1JITyszRzYyY1BsVnZGNXpSXG4wdVFvMWhpYjhZbko5MDd0bk41NTBZL3gwa1FNcms3Y0NEa0l3bHZYME9QTjUxZjQ4V0VYZkhYUDltU0owS29BXG5NUHF6REpvZnROSlIrUWZDaEc0ZExvMCtMVEpTN1ZOMlRhZmRFd1dLaUF5cWlxTTVsQVd1UEVEUUNXY2p2STVVXG5FRDN6TmZrRzB3S0JnUURkbjh5VHlKTW9kY09PSVZsSzBkRm9FM2V2TjFrTDliTnJWSk85Tkp3MlpXbmNZU1pKXG4zZHpDUUFnNHR0ZnZIS0k2VlZyTmVsanZMait2azkveFRkSjEyS0p1ZHgzc1BMWVVSS2tTZ0tta3RZOS9TN2FEXG5OL09manYyTENxcFhrTUxpb3hsSFpuYkRsbGNJRUpXOU1YMmpnOUhNZTFCcWErQWlUMDltN2F2Uk13S0JnRG1tXG5EeTYrRDVRQ05FcW1GVXZmaTB3VDVicUlCdE53a0svdzVObEJWVmkrSmlZNFhOUmF4OUdmZ0kyaldMNGtPQTluXG5Bc0ViTk92VlRISitQKzJVYVlRWk96elFPa3dJQTM2U3M5ZjZLeUpOa3pqWGFmeGp6bGIvQzBtZWFCdkpWb3ZQXG43bndSNjJWQUVndk1xNHNnOEpTVU9tVVNsS2F6SEw0WkJ4dmI1UmFwQW9HQkFKK2txS2xQa0JOdHl5ZzhsU3puXG55TWV6azZLa3dKUktIdG80UzJnV1NJVHFTMTRtU3ZUWnFDY2VOY2NURXg4Vm9leW1XSEhIRWpITTQ2RWZZZ3d0XG5NVWNycFI2bGZQeHFaMjdhWUFENXg1cE8rWXVJNUExWU5jaHA5T2NxRDNtWEJ1a0hlUGlvWE91U0hFYzZtclFPXG5hWUxidjNVUWJEZEhPTmVJZmlKSlg0WGdcbi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS1cbiIsImNsaWVudF9lbWFpbCI6Im91dGlsLWZhY3R1cmVzLWJvdEBvdXRpbC1mYWN0dXJlcy10ZG0uaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLCJjbGllbnRfaWQiOiIxMDQ3NTc2MzMyNTY3NTMzMTUxOTUiLCJhdXRoX3VyaSI6Imh0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbS9vL29hdXRoMi9hdXRoIiwidG9rZW5fdXJpIjoiaHR0cHM6Ly9vYXV0aDIuZ29vZ2xlYXBpcy5jb20vdG9rZW4iLCJhdXRoX3Byb3ZpZGVyX3g1MDlfY2VydF91cmwiOiJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9vYXV0aDIvdjEvY2VydHMiLCJjbGllbnRfeDUwOV9jZXJ0X3VybCI6Imh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL3JvYm90L3YxL21ldGFkYXRhL3g1MDkvb3V0aWwtZmFjdHVyZXMtYm90JTQwb3V0aWwtZmFjdHVyZXMtdGRtLmlhbS5nc2VydmljZWFjY291bnQuY29tIiwidW5pdmVyc2VfZG9tYWluIjoiZ29vZ2xlYXBpcy5jb20ifQ==';

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
        console.log('🔧 GSheets: credentials restaurées depuis env var');
        return parsed;
      }
    } catch {}
  }

  // 3. Fallback : décoder le base64 embarqué
  try {
    const json = Buffer.from(EMBEDDED_CREDS_B64, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (parsed.private_key && parsed.client_email) {
      // Stocker en DB pour la prochaine fois
      db.prepare("INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
        .run(json);
      console.log('🔧 GSheets: credentials restaurées depuis fallback embarqué');
      return parsed;
    }
  } catch {}

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

  // Helpers de normalisation
  const stripDiacritics = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const norm = (s) => stripDiacritics(String(s || '').toLowerCase())
    .replace(/[''`]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[\-_/.,:;!?\\"|\\]+/g, ' ')
    .replace(/\b(hotel|hôtel)\b/g, 'hotel')
    .replace(/\s+/g, ' ')
    .trim();

  const vfNorm = norm(vfName);

  // Aliases manuels (priorité la plus haute)
  const manualAliases = {
    'hotel litteraire swann': 'Le Swann',
    'swann litteraire': 'Le Swann',
  };
  if (manualAliases[vfNorm]) {
    console.log(`🎯 Alias manuel: "${vfName}" → "${manualAliases[vfNorm]}"`);
    return manualAliases[vfNorm];
  }

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
      console.log(`🏨 Korner mapping: "${vfName}" → "${best}"`);
      return best;
    }
  }

  // VF_NAME_ALIASES vide pour l'instant (peut être renseigné plus tard en DB si besoin)
  // if (vfNorm && VF_NAME_ALIASES && VF_NAME_ALIASES[vfNorm]) return VF_NAME_ALIASES[vfNorm];

  // 2) Match exact (normalisé)
  const canonByNorm = new Map(cleanCanonList.map(c => [norm(c), c]));
  if (canonByNorm.has(vfNorm)) {
    const matched = canonByNorm.get(vfNorm);
    console.log(`✅ Match exact: "${vfName}" → "${matched}"`);
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
    console.log(`🔍 Match contient: "${vfName}" → "${best}" (longueur: ${bestLen})`);
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
    console.log(`🎯 Match tokens: "${vfName}" → "${bestName}" (score: ${bestScore.toFixed(2)})`);
    return bestName;
  }

  // 5) Aucun match sûr -> renvoyer le VF brut
  console.log(`⚠️ Aucun match trouvé pour "${vfName}", utilisation du nom VF brut`);
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

    // 1) Lire les noms canoniques depuis le spreadsheet (colonne B "Hotel name")
    let canonicalNames = [];
    try {
      const partnersResult = await this.getPartners(spreadsheetId, sheetName);
      canonicalNames = partnersResult || [];
      console.log(`📊 GSheets: ${canonicalNames.length} noms canoniques lus depuis spreadsheet`);
    } catch (e) {
      console.warn(`⚠️ Impossible de lire les noms canoniques: ${e.message}`);
    }

    // 2) Résoudre le nom canonique via mapPartnerNameToCanon si partnerName non fourni
    let mappedPartnerName = partnerName;
    if (!mappedPartnerName) {
      const vfName = invoiceData.clientName || '';
      // D'abord essayer le mapping DB
      mappedPartnerName = resolveCanonicalClientName(db, vfName);
      // Si pas de mapping DB, utiliser mapPartnerNameToCanon avec la liste du spreadsheet
      if (mappedPartnerName === vfName && canonicalNames.length > 0) {
        mappedPartnerName = mapPartnerNameToCanon(vfName, canonicalNames);
      }
    }

    console.log(`📊 GSheets logInvoice: partnerName="${partnerName}", clientName="${invoiceData.clientName}", mapped="${mappedPartnerName}"`);
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
    console.log(`📊 GSheets: ${bdRows.length} lignes lues, lastDataRow=${lastDataRow}, nextRow=${nextRow}`);

    // Compter les factures distinctes de ce partenaire (pour le Order #)
    const existingInvoices = new Set();
    const targetNorm = norm(mappedPartnerName);
    for (let i = 1; i < bdRows.length; i++) {
      const b = cleanCell(bdRows[i]?.[0] || '');
      const d = cleanCell(bdRows[i]?.[2] || '');
      if (!b || b.startsWith('=') || !d || d.startsWith('=')) continue;
      if (norm(b) === targetNorm) {
        existingInvoices.add(d.toUpperCase());
      }
    }
    const orderNumber = existingInvoices.size;

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
      if (ref === 'FP' || ref === 'FE') continue; // Skip frais de port

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
    console.log(`📊 GSheets: écriture ${valuesBF.length} lignes, range B${nextRow}:F${endRow} + Q${nextRow}:Q${endRow}`);
    console.log(`📊 GSheets: première ligne = ${JSON.stringify(valuesBF[0])}, date = ${invoiceDate}`);

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

    console.log(`📊 GSheets: batchUpdate réponse: ${writeResult.data.totalUpdatedCells} cellules mises à jour`);

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
