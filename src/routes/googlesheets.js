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

      // Grouper par facture (chaque ligne = 1 produit, on doit grouper par Invoice)
      const invoicesMap = new Map();
      const data = result.data || [];

      let totalLinesProcessed = 0;
      let linesSkippedNoInvoice = 0;
      let linesSkippedYear = 0;

      for (const row of data) {
        totalLinesProcessed++;

        const invoiceNumber = (row['Invoice'] || '').trim();
        const clientName = (row['Hotel name'] || '').trim();
        const factureYear = String(row['facture year'] || '').trim();
        const factureMonth = String(row['facture month'] || '').trim();
        const montantHT = parseFloat(row['Prix Total HT'] || 0);
        const montantTTC = parseFloat(row['Prix Total TTC'] || 0);

        if (!invoiceNumber) {
          linesSkippedNoInvoice++;
          continue;
        }

        // Filtrer par année si demandé
        if (year && factureYear && factureYear != year) {
          linesSkippedYear++;
          continue;
        }

        // Grouper par numéro de facture
        if (!invoicesMap.has(invoiceNumber)) {
          invoicesMap.set(invoiceNumber, {
            number: invoiceNumber,
            client: clientName,
            year: factureYear,
            month: factureMonth,
            totalHT: 0,
            totalTTC: 0,
            productCount: 0,
          });
        }

        const invoice = invoicesMap.get(invoiceNumber);
        invoice.totalHT += montantHT;
        invoice.totalTTC += montantTTC;
        invoice.productCount++;
      }

      console.log(`📊 Traitement: ${totalLinesProcessed} lignes, ${linesSkippedNoInvoice} sans Invoice, ${linesSkippedYear} filtrées par année`);
      console.log(`📊 ${invoicesMap.size} factures uniques trouvées`);

      // Calculer les statistiques
      const stats = {
        total: {
          invoices: invoicesMap.size,
          ca_ht: 0,
          ca_ttc: 0,
        },
        byMonth: {},
        byClient: {},
        topClients: [],
        recentInvoices: [],
      };

      for (const [_, invoice] of invoicesMap) {
        stats.total.ca_ht += invoice.totalHT;
        stats.total.ca_ttc += invoice.totalTTC;

        // Par mois
        if (invoice.year && invoice.month) {
          const monthKey = `${invoice.year}-${String(invoice.month).padStart(2, '0')}`;
          if (!stats.byMonth[monthKey]) {
            stats.byMonth[monthKey] = { ca_ht: 0, ca_ttc: 0, count: 0 };
          }
          stats.byMonth[monthKey].ca_ht += invoice.totalHT;
          stats.byMonth[monthKey].ca_ttc += invoice.totalTTC;
          stats.byMonth[monthKey].count++;
        }

        // Par client
        if (invoice.client) {
          if (!stats.byClient[invoice.client]) {
            stats.byClient[invoice.client] = { ca_ht: 0, ca_ttc: 0, count: 0 };
          }
          stats.byClient[invoice.client].ca_ht += invoice.totalHT;
          stats.byClient[invoice.client].ca_ttc += invoice.totalTTC;
          stats.byClient[invoice.client].count++;
        }

        // Factures récentes
        if (stats.recentInvoices.length < 10) {
          stats.recentInvoices.push({
            number: invoice.number,
            client: invoice.client,
            date: invoice.year && invoice.month ? `${invoice.month}/${invoice.year}` : '',
            amount_ht: invoice.totalHT,
            amount_ttc: invoice.totalTTC,
          });
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

  // Détails d'un client spécifique
  router.get('/analytics/client/:clientName', async (req, res) => {
    try {
      const { clientName } = req.params;
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

      const data = result.data || [];
      const clientInvoices = new Map();
      const productStats = {};

      for (const row of data) {
        const rowClient = (row['Hotel name'] || '').trim();
        if (rowClient.toLowerCase() !== clientName.toLowerCase()) continue;

        const invoiceNumber = (row['Invoice'] || '').trim();
        const factureYear = String(row['facture year'] || '').trim();
        const factureMonth = String(row['facture month'] || '').trim();
        const productRef = (row['Ref'] || '').trim();
        const productName = (row['Produit'] || '').trim();
        const quantity = parseFloat(row['Nb Items'] || 0);
        const montantHT = parseFloat(row['Prix Total HT'] || 0);
        const montantTTC = parseFloat(row['Prix Total TTC'] || 0);

        if (!invoiceNumber) continue;
        if (year && factureYear && factureYear != year) continue;

        // Grouper par facture
        if (!clientInvoices.has(invoiceNumber)) {
          clientInvoices.set(invoiceNumber, {
            number: invoiceNumber,
            year: factureYear,
            month: factureMonth,
            totalHT: 0,
            totalTTC: 0,
            products: [],
          });
        }

        const invoice = clientInvoices.get(invoiceNumber);
        invoice.totalHT += montantHT;
        invoice.totalTTC += montantTTC;
        invoice.products.push({
          ref: productRef,
          name: productName,
          quantity,
          amountHT: montantHT,
          amountTTC: montantTTC,
        });

        // Stats produits
        if (productRef) {
          if (!productStats[productRef]) {
            productStats[productRef] = {
              ref: productRef,
              name: productName,
              totalQuantity: 0,
              totalHT: 0,
              totalTTC: 0,
              invoiceCount: new Set(),
            };
          }
          productStats[productRef].totalQuantity += quantity;
          productStats[productRef].totalHT += montantHT;
          productStats[productRef].totalTTC += montantTTC;
          productStats[productRef].invoiceCount.add(invoiceNumber);
        }
      }

      // Convertir les stats produits
      const topProducts = Object.values(productStats)
        .map(p => ({
          ref: p.ref,
          name: p.name,
          totalQuantity: p.totalQuantity,
          totalHT: Math.round(p.totalHT * 100) / 100,
          totalTTC: Math.round(p.totalTTC * 100) / 100,
          invoiceCount: p.invoiceCount.size,
        }))
        .sort((a, b) => b.totalHT - a.totalHT);

      // Stats globales
      let totalHT = 0;
      let totalTTC = 0;
      const invoices = Array.from(clientInvoices.values());

      for (const inv of invoices) {
        totalHT += inv.totalHT;
        totalTTC += inv.totalTTC;
      }

      res.json({
        clientName,
        total: {
          invoices: clientInvoices.size,
          ca_ht: Math.round(totalHT * 100) / 100,
          ca_ttc: Math.round(totalTTC * 100) / 100,
        },
        topProducts,
        invoices: invoices.map(i => ({
          number: i.number,
          date: i.year && i.month ? `${i.month}/${i.year}` : '',
          totalHT: Math.round(i.totalHT * 100) / 100,
          totalTTC: Math.round(i.totalTTC * 100) / 100,
          productCount: i.products.length,
        })),
      });
    } catch (e) {
      console.error('Erreur analytics client:', e);
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
