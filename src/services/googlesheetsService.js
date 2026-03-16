/**
 * googlesheetsService.js — Google Sheets via googleapis
 * Format de log : une ligne par produit (colonnes B→F + Q)
 * Réplique la logique du HTML standalone
 */

const { google } = require('googleapis');

function getCredentials(db) {
  const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get('gsheets_credentials');
  if (!row?.valeur) return null;
  try {
    return JSON.parse(row.valeur);
  } catch {
    return null;
  }
}

function getAuth(db) {
  const creds = getCredentials(db);
  if (!creds) throw new Error('Credentials Google Sheets non configurés. Ajoutez la clé "gsheets_credentials" dans la table config avec le JSON du service account.');
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

    // Résoudre le nom canonique si nécessaire
    const mappedPartnerName = partnerName || resolveCanonicalClientName(db, invoiceData.clientName || '');
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
});
