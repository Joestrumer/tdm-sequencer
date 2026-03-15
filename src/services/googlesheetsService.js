/**
 * googlesheetsService.js — Google Sheets via googleapis
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
  if (!creds) throw new Error('Credentials Google Sheets non configurés');
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
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

  async logInvoice(spreadsheetId, sheetName, invoiceData, partnerName) {
    const auth = getAuth(db);
    const sheets = google.sheets({ version: 'v4', auth });

    // Chercher la ligne du partenaire (colonne B)
    const rangeB = `${sheetName}!B:B`;
    const resB = await sheets.spreadsheets.values.get({ spreadsheetId, range: rangeB });
    const colB = (resB.data.values || []).map(r => r[0] || '');

    let rowIndex = -1;
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const targetNorm = norm(partnerName);

    for (let i = 0; i < colB.length; i++) {
      if (norm(colB[i]) === targetNorm) {
        rowIndex = i;
        break;
      }
    }

    if (rowIndex === -1) {
      // Partenaire non trouvé, ajouter à la fin
      rowIndex = colB.length;
    }

    // Déterminer la colonne en fonction du mois courant
    // Convention : C = Janvier, D = Février, ... N = Décembre
    const monthCol = String.fromCharCode(67 + new Date().getMonth()); // C=0(Jan), D=1(Feb)...

    const cellRange = `${sheetName}!${monthCol}${rowIndex + 1}`;

    // Lire la valeur actuelle
    let currentValue = 0;
    try {
      const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: cellRange });
      const val = existing.data.values?.[0]?.[0];
      if (val) currentValue = parseFloat(String(val).replace(/[^\d.,\-]/g, '').replace(',', '.')) || 0;
    } catch {}

    const newValue = currentValue + (invoiceData.montant_ht || 0);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: cellRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[newValue]] },
    });

    return {
      ok: true,
      row: rowIndex + 1,
      column: monthCol,
      partnerName,
      previousValue: currentValue,
      newValue,
    };
  },
});
