/**
 * googlesheets.js — Routes Google Sheets
 */

const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  function getGsheetsService() {
    return require('../services/googlesheetsService')(db);
  }

  function getSpreadsheetId() {
    return db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_spreadsheet_id'").get()?.valeur;
  }

  function getSheetName() {
    return db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Suivi';
  }

  // Test connexion
  router.get('/status', async (req, res) => {
    try {
      const spreadsheetId = getSpreadsheetId();
      if (!spreadsheetId) {
        return res.json({ ok: false, erreur: 'Spreadsheet ID non configuré' });
      }
      const service = getGsheetsService();
      const result = await service.getSheetStatus(spreadsheetId);
      res.json(result);
    } catch (e) {
      res.json({ ok: false, erreur: e.message });
    }
  });

  // Liste partenaires du sheet
  router.get('/partners', async (req, res) => {
    try {
      const spreadsheetId = getSpreadsheetId();
      if (!spreadsheetId) {
        return res.status(400).json({ erreur: 'Spreadsheet ID non configuré' });
      }
      const service = getGsheetsService();
      const partners = await service.getPartners(spreadsheetId, getSheetName());
      res.json(partners);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Écrire une ligne
  router.post('/log-invoice', async (req, res) => {
    try {
      const spreadsheetId = getSpreadsheetId();
      if (!spreadsheetId) {
        return res.status(400).json({ erreur: 'Spreadsheet ID non configuré' });
      }
      const { invoiceData, partnerName } = req.body;
      const service = getGsheetsService();
      const result = await service.logInvoice(spreadsheetId, getSheetName(), invoiceData, partnerName);
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Analytics depuis onglet "log sold"
  router.get('/analytics', async (req, res) => {
    try {
      const { year } = req.query;
      const spreadsheetId = getSpreadsheetId();
      if (!spreadsheetId) {
        return res.status(400).json({ erreur: 'Spreadsheet ID non configuré' });
      }

      const service = getGsheetsService();
      const result = await service.getLogSoldData(spreadsheetId, 'log sold');

      if (!result.ok) {
        return res.status(500).json({ erreur: result.erreur });
      }

      console.log(`📊 GSheets Analytics: ${result.totalRows} lignes lues`);
      console.log(`📊 Headers: ${result.headers.join(', ')}`);

      // Calculer les statistiques
      const stats = {
        total: {
          invoices: 0,
          ca_ht: 0,
          ca_ttc: 0,
        },
        byMonth: {},
        byClient: {},
        topClients: [],
        recentInvoices: [],
      };

      // Parser les données
      const invoices = new Set();
      const data = result.data || [];

      for (const row of data) {
        // Chercher les colonnes pertinentes (adapter selon ton Excel)
        const invoiceNumber = row['Invoice Number'] || row['N° facture'] || row['Facture'] || '';
        const clientName = row['Hotel name'] || row['Client'] || row['Nom'] || '';
        const date = row['Date facture'] || row['Date'] || '';
        const montantHT = parseFloat(row['Montant HT'] || row['CA HT'] || row['Total HT'] || 0);
        const montantTTC = parseFloat(row['Montant TTC'] || row['CA TTC'] || row['Total TTC'] || 0);

        // Filtrer par année si demandé
        if (year && date) {
          const dateYear = date.includes('/')
            ? date.split('/')[2]
            : new Date(date).getFullYear();
          if (dateYear != year) continue;
        }

        // Ne compter qu'une fois chaque facture
        if (invoiceNumber && !invoices.has(invoiceNumber)) {
          invoices.add(invoiceNumber);
          stats.total.invoices++;
          stats.total.ca_ht += montantHT;
          stats.total.ca_ttc += montantTTC;

          // Par mois
          if (date) {
            let month;
            if (date.includes('/')) {
              const parts = date.split('/');
              month = `${parts[2]}-${parts[1].padStart(2, '0')}`;
            } else {
              month = date.substring(0, 7);
            }

            if (!stats.byMonth[month]) {
              stats.byMonth[month] = { ca_ht: 0, ca_ttc: 0, count: 0 };
            }
            stats.byMonth[month].ca_ht += montantHT;
            stats.byMonth[month].ca_ttc += montantTTC;
            stats.byMonth[month].count++;
          }

          // Par client
          if (clientName) {
            if (!stats.byClient[clientName]) {
              stats.byClient[clientName] = { ca_ht: 0, ca_ttc: 0, count: 0 };
            }
            stats.byClient[clientName].ca_ht += montantHT;
            stats.byClient[clientName].ca_ttc += montantTTC;
            stats.byClient[clientName].count++;
          }

          // Factures récentes
          if (stats.recentInvoices.length < 10) {
            stats.recentInvoices.push({
              number: invoiceNumber,
              client: clientName,
              date: date,
              amount_ht: montantHT,
              amount_ttc: montantTTC,
            });
          }
        }
      }

      // Top 10 clients
      stats.topClients = Object.entries(stats.byClient)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.ca_ht - a.ca_ht)
        .slice(0, 10);

      // Arrondir les montants
      stats.total.ca_ht = Math.round(stats.total.ca_ht * 100) / 100;
      stats.total.ca_ttc = Math.round(stats.total.ca_ttc * 100) / 100;

      console.log(`📊 Stats calculées: ${stats.total.invoices} factures, CA HT: ${stats.total.ca_ht}€`);

      res.json(stats);
    } catch (e) {
      console.error('Erreur analytics GSheets:', e);
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
