/**
 * googlesheets.js — Routes Google Sheets
 */

const express = require('express');
const logger = require('../config/logger');

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

      logger.debug(`📊 GSheets Analytics: ${result.totalRows} lignes lues`);
      logger.debug(`📊 Headers: ${result.headers.join(', ')}`);

      const data = result.data || [];

      // Première passe: identifier les factures de l'année demandée
      const validInvoices = new Set();
      if (year) {
        for (const row of data) {
          const invoiceNumber = (row['Invoice'] || '').trim();
          if (!invoiceNumber) continue;

          const dateFacturation = (row['Date facturation'] || '').trim();
          let invoiceYear = '';
          if (dateFacturation && dateFacturation.includes('/')) {
            const parts = dateFacturation.split('/');
            if (parts.length === 3) invoiceYear = parts[2];
          } else if (dateFacturation && dateFacturation.includes('-')) {
            const parts = dateFacturation.split('-');
            if (parts.length === 3 && parts[0].length === 4) invoiceYear = parts[0];
          }

          if (invoiceYear == year) {
            validInvoices.add(invoiceNumber);
          }
        }
        logger.debug(`📊 ${validInvoices.size} factures trouvées pour ${year}`);
      }

      // Deuxième passe: grouper par facture et inclure toutes les lignes des factures valides
      const invoicesMap = new Map();
      let totalLinesProcessed = 0;
      let linesSkippedNoInvoice = 0;
      let linesSkippedYear = 0;
      const sampleValues = [];

      for (const row of data) {
        totalLinesProcessed++;

        const invoiceNumber = (row['Invoice'] || '').trim();
        if (!invoiceNumber) {
          linesSkippedNoInvoice++;
          continue;
        }

        // Si filtre année actif, vérifier que la facture est dans la liste valide
        if (year && !validInvoices.has(invoiceNumber)) {
          linesSkippedYear++;
          continue;
        }

        const clientName = (row['Hotel name'] || '').trim();
        const dateFacturation = (row['Date facturation'] || '').trim();
        const montantHTRaw = row['Prix Total HT'] || '';
        const montantTTCRaw = row['Prix Total TTC'] || '';
        const commissionRaw = row['Commission SC'] || '';

        // Parser les montants (format européen: virgule = décimale, € = symbole)
        const parseEuroAmount = (str) => {
          if (!str) return 0;
          // Enlever €, espaces, puis remplacer virgule par point
          return parseFloat(String(str).replace(/€/g, '').replace(/\s/g, '').replace(',', '.')) || 0;
        };

        const montantHT = parseEuroAmount(montantHTRaw);
        const montantTTC = parseEuroAmount(montantTTCRaw);
        const commission = parseEuroAmount(commissionRaw);

        // Log quelques exemples
        if (sampleValues.length < 10) {
          sampleValues.push({
            invoice: invoiceNumber,
            htRaw: montantHTRaw,
            htParsed: montantHT,
            client: clientName
          });
        }

        // Extraire année et mois pour la première ligne de chaque facture
        let invoiceYear = '';
        let invoiceMonth = '';
        if (dateFacturation) {
          if (dateFacturation.includes('/')) {
            const parts = dateFacturation.split('/');
            if (parts.length === 3) {
              invoiceYear = parts[2];
              invoiceMonth = parts[1];
            }
          } else if (dateFacturation.includes('-')) {
            const parts = dateFacturation.split('-');
            if (parts.length === 3 && parts[0].length === 4) {
              invoiceYear = parts[0];
              invoiceMonth = parts[1];
            }
          }
        }

        // Lire Order # pour distinguer implantation (0) vs réappro (>=1)
        const orderNumber = parseInt(row['Order #'] || '0', 10);

        // Grouper par numéro de facture
        if (!invoicesMap.has(invoiceNumber)) {
          invoicesMap.set(invoiceNumber, {
            number: invoiceNumber,
            client: clientName,
            date: dateFacturation,
            year: invoiceYear,
            month: invoiceMonth,
            totalHT: 0,
            totalTTC: 0,
            totalCommission: 0,
            productCount: 0,
            orderNumber: orderNumber,
          });
        }

        const invoice = invoicesMap.get(invoiceNumber);
        invoice.totalHT += montantHT;
        invoice.totalTTC += montantTTC;
        invoice.totalCommission += commission;
        invoice.productCount++;
      }

      logger.debug(`📊 Traitement: ${totalLinesProcessed} lignes, ${linesSkippedNoInvoice} sans Invoice, ${linesSkippedYear} lignes exclues (factures autres années)`);
      logger.debug(`📊 Exemples de valeurs HT lues:`, sampleValues);
      logger.debug(`📊 ${invoicesMap.size} factures uniques trouvées`);
      const invoicesList = Array.from(invoicesMap.keys()).sort();
      logger.debug(`📊 Factures trouvées: ${invoicesList.join(', ')}`);

      // Log totaux de quelques factures
      const sampleInvoiceTotals = [];
      for (const [num, inv] of invoicesMap) {
        if (sampleInvoiceTotals.length < 5) {
          sampleInvoiceTotals.push({ num, totalHT: inv.totalHT, products: inv.productCount });
        }
      }
      logger.debug(`📊 Exemples de totaux factures:`, sampleInvoiceTotals);

      // Calculer les statistiques
      const stats = {
        total: {
          invoices: invoicesMap.size,
          ca_ht: 0,
          ca_ttc: 0,
          commission: 0,
          ca_ht_implantation: 0,
          ca_ht_reappro: 0,
          nb_implantations: 0,
          nb_reappros: 0,
        },
        byMonth: {},
        byClient: {},
        topClients: [],
        recentInvoices: [],
        allClients: new Set(),
      };

      for (const [_, invoice] of invoicesMap) {
        stats.total.ca_ht += invoice.totalHT;
        stats.total.ca_ttc += invoice.totalTTC;
        stats.total.commission += invoice.totalCommission;

        // Split implantation vs réappro
        if (invoice.orderNumber === 0) {
          stats.total.ca_ht_implantation += invoice.totalHT;
          stats.total.nb_implantations++;
        } else {
          stats.total.ca_ht_reappro += invoice.totalHT;
          stats.total.nb_reappros++;
        }

        if (invoice.client) {
          stats.allClients.add(invoice.client);
        }

        // Par mois
        if (invoice.year && invoice.month) {
          const monthKey = `${invoice.year}-${String(invoice.month).padStart(2, '0')}`;
          if (!stats.byMonth[monthKey]) {
            stats.byMonth[monthKey] = { ca_ht: 0, ca_ttc: 0, commission: 0, count: 0, ca_ht_implantation: 0, ca_ht_reappro: 0, nb_implantations: 0, nb_reappros: 0 };
          }
          stats.byMonth[monthKey].ca_ht += invoice.totalHT;
          stats.byMonth[monthKey].ca_ttc += invoice.totalTTC;
          stats.byMonth[monthKey].commission += invoice.totalCommission;
          stats.byMonth[monthKey].count++;

          if (invoice.orderNumber === 0) {
            stats.byMonth[monthKey].ca_ht_implantation += invoice.totalHT;
            stats.byMonth[monthKey].nb_implantations++;
          } else {
            stats.byMonth[monthKey].ca_ht_reappro += invoice.totalHT;
            stats.byMonth[monthKey].nb_reappros++;
          }
        }

        // Par client
        if (invoice.client) {
          if (!stats.byClient[invoice.client]) {
            stats.byClient[invoice.client] = { ca_ht: 0, ca_ttc: 0, commission: 0, count: 0 };
          }
          stats.byClient[invoice.client].ca_ht += invoice.totalHT;
          stats.byClient[invoice.client].ca_ttc += invoice.totalTTC;
          stats.byClient[invoice.client].commission += invoice.totalCommission;
          stats.byClient[invoice.client].count++;
        }

        // Factures récentes
        if (stats.recentInvoices.length < 10) {
          stats.recentInvoices.push({
            number: invoice.number,
            client: invoice.client,
            date: invoice.date || (invoice.year && invoice.month ? `${invoice.month}/${invoice.year}` : ''),
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
      stats.total.commission = Math.round(stats.total.commission * 100) / 100;
      stats.total.ca_ht_implantation = Math.round(stats.total.ca_ht_implantation * 100) / 100;
      stats.total.ca_ht_reappro = Math.round(stats.total.ca_ht_reappro * 100) / 100;

      // Convertir allClients en array trié
      stats.allClients = Array.from(stats.allClients).sort();

      logger.debug(`📊 Stats calculées: ${stats.total.invoices} factures, CA HT: ${stats.total.ca_ht}€, Commission: ${stats.total.commission}€`);

      res.json(stats);
    } catch (e) {
      logger.error('Erreur analytics GSheets:', e);
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

      // Première passe: identifier les factures de l'année demandée pour ce client
      const validInvoices = new Set();
      if (year) {
        for (const row of data) {
          const rowClient = (row['Hotel name'] || '').trim();
          if (rowClient.toLowerCase() !== clientName.toLowerCase()) continue;

          const invoiceNumber = (row['Invoice'] || '').trim();
          if (!invoiceNumber) continue;

          const dateFacturation = (row['Date facturation'] || '').trim();
          let invoiceYear = '';
          if (dateFacturation && dateFacturation.includes('/')) {
            const parts = dateFacturation.split('/');
            if (parts.length === 3) invoiceYear = parts[2];
          } else if (dateFacturation && dateFacturation.includes('-')) {
            const parts = dateFacturation.split('-');
            if (parts.length === 3 && parts[0].length === 4) invoiceYear = parts[0];
          }

          if (invoiceYear == year) {
            validInvoices.add(invoiceNumber);
          }
        }
      }

      // Deuxième passe: grouper toutes les lignes des factures valides
      const clientInvoices = new Map();
      const productStats = {};

      for (const row of data) {
        const rowClient = (row['Hotel name'] || '').trim();
        if (rowClient.toLowerCase() !== clientName.toLowerCase()) continue;

        const invoiceNumber = (row['Invoice'] || '').trim();
        if (!invoiceNumber) continue;

        // Si filtre année actif, vérifier que la facture est dans la liste valide
        if (year && !validInvoices.has(invoiceNumber)) continue;

        const dateFacturation = (row['Date facturation'] || '').trim();
        const productRef = (row['Ref'] || '').trim();
        const productName = (row['Produit'] || '').trim();
        const quantity = parseFloat(row['Nb Items'] || 0);

        // Parser les montants (format européen)
        const parseEuroAmount = (str) => {
          if (!str) return 0;
          return parseFloat(String(str).replace(/€/g, '').replace(/\s/g, '').replace(',', '.')) || 0;
        };

        const montantHT = parseEuroAmount(row['Prix Total HT']);
        const montantTTC = parseEuroAmount(row['Prix Total TTC']);
        const commission = parseEuroAmount(row['Commission SC']);

        // Grouper par facture
        if (!clientInvoices.has(invoiceNumber)) {
          clientInvoices.set(invoiceNumber, {
            number: invoiceNumber,
            date: dateFacturation,
            totalHT: 0,
            totalTTC: 0,
            totalCommission: 0,
            products: [],
          });
        }

        const invoice = clientInvoices.get(invoiceNumber);
        invoice.totalHT += montantHT;
        invoice.totalTTC += montantTTC;
        invoice.totalCommission += commission;
        invoice.products.push({
          ref: productRef,
          name: productName,
          quantity,
          amountHT: montantHT,
          amountTTC: montantTTC,
          commission,
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
      let totalCommission = 0;
      const invoices = Array.from(clientInvoices.values());

      for (const inv of invoices) {
        totalHT += inv.totalHT;
        totalTTC += inv.totalTTC;
        totalCommission += inv.totalCommission;
      }

      res.json({
        clientName,
        total: {
          invoices: clientInvoices.size,
          ca_ht: Math.round(totalHT * 100) / 100,
          ca_ttc: Math.round(totalTTC * 100) / 100,
          commission: Math.round(totalCommission * 100) / 100,
        },
        topProducts,
        invoices: invoices.map(i => ({
          number: i.number,
          date: i.date || '',
          totalHT: Math.round(i.totalHT * 100) / 100,
          totalTTC: Math.round(i.totalTTC * 100) / 100,
          totalCommission: Math.round(i.totalCommission * 100) / 100,
          productCount: i.products.length,
        })),
      });
    } catch (e) {
      logger.error('Erreur analytics client:', e);
      res.status(500).json({ erreur: e.message });
    }
  });

  // Comparaison multi-années pour forecast
  router.get('/analytics/years-comparison', async (req, res) => {
    try {
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
      const parseEuroAmount = (str) => {
        if (!str) return 0;
        return parseFloat(String(str).replace(/€/g, '').replace(/\s/g, '').replace(',', '.')) || 0;
      };

      // Grouper par année et mois
      const yearStats = {};

      // Première passe: identifier toutes les factures par année + stocker Order #
      const invoicesByYear = {};
      const invoiceOrderNumbers = {}; // invoiceNumber -> orderNumber
      for (const row of data) {
        const invoiceNumber = (row['Invoice'] || '').trim();
        if (!invoiceNumber) continue;

        // Stocker Order # pour chaque facture (première occurrence)
        if (!(invoiceNumber in invoiceOrderNumbers)) {
          invoiceOrderNumbers[invoiceNumber] = parseInt(row['Order #'] || '0', 10);
        }

        const dateFacturation = (row['Date facturation'] || '').trim();
        let invoiceYear = '';
        if (dateFacturation && dateFacturation.includes('/')) {
          const parts = dateFacturation.split('/');
          if (parts.length === 3) invoiceYear = parts[2];
        } else if (dateFacturation && dateFacturation.includes('-')) {
          const parts = dateFacturation.split('-');
          if (parts.length === 3 && parts[0].length === 4) invoiceYear = parts[0];
        }

        if (invoiceYear) {
          if (!invoicesByYear[invoiceYear]) {
            invoicesByYear[invoiceYear] = new Set();
          }
          invoicesByYear[invoiceYear].add(invoiceNumber);
        }
      }

      // Deuxième passe: calculer les stats
      for (const row of data) {
        const invoiceNumber = (row['Invoice'] || '').trim();
        if (!invoiceNumber) continue;

        const dateFacturation = (row['Date facturation'] || '').trim();
        let invoiceYear = '';
        let invoiceMonth = '';
        if (dateFacturation && dateFacturation.includes('/')) {
          const parts = dateFacturation.split('/');
          if (parts.length === 3) {
            invoiceYear = parts[2];
            invoiceMonth = parts[1];
          }
        } else if (dateFacturation && dateFacturation.includes('-')) {
          const parts = dateFacturation.split('-');
          if (parts.length === 3 && parts[0].length === 4) {
            invoiceYear = parts[0];
            invoiceMonth = parts[1];
          }
        }

        if (!invoiceYear) continue;

        // Vérifier que cette facture appartient bien à cette année
        if (!invoicesByYear[invoiceYear] || !invoicesByYear[invoiceYear].has(invoiceNumber)) continue;

        const montantHT = parseEuroAmount(row['Prix Total HT']);
        const commission = parseEuroAmount(row['Commission SC']);

        if (!yearStats[invoiceYear]) {
          yearStats[invoiceYear] = {
            year: invoiceYear,
            total_ht: 0,
            total_commission: 0,
            total_ht_implantation: 0,
            total_ht_reappro: 0,
            nb_implantations: 0,
            nb_reappros: 0,
            invoices: new Set(),
            byMonth: {},
          };
        }

        const orderNum = invoiceOrderNumbers[invoiceNumber] || 0;

        yearStats[invoiceYear].total_ht += montantHT;
        yearStats[invoiceYear].total_commission += commission;
        yearStats[invoiceYear].invoices.add(invoiceNumber);

        if (invoiceMonth) {
          const monthKey = String(invoiceMonth).padStart(2, '0');
          if (!yearStats[invoiceYear].byMonth[monthKey]) {
            yearStats[invoiceYear].byMonth[monthKey] = {
              ca_ht: 0,
              commission: 0,
              cumulative_ht: 0,
              cumulative_commission: 0,
              ca_ht_implantation: 0,
              ca_ht_reappro: 0,
              cumulative_ht_implantation: 0,
              cumulative_ht_reappro: 0,
            };
          }
          yearStats[invoiceYear].byMonth[monthKey].ca_ht += montantHT;
          yearStats[invoiceYear].byMonth[monthKey].commission += commission;

          if (orderNum === 0) {
            yearStats[invoiceYear].byMonth[monthKey].ca_ht_implantation += montantHT;
          } else {
            yearStats[invoiceYear].byMonth[monthKey].ca_ht_reappro += montantHT;
          }
        }
      }

      // Calculer nb_implantations/nb_reappros par année (basé sur factures uniques)
      for (const year in yearStats) {
        for (const invoiceNumber of yearStats[year].invoices) {
          const orderNum = invoiceOrderNumbers[invoiceNumber] || 0;
          if (orderNum === 0) {
            yearStats[year].nb_implantations++;
            yearStats[year].total_ht_implantation += 0; // déjà calculé ligne par ligne
          } else {
            yearStats[year].nb_reappros++;
          }
        }
        // Recalculer total_ht_implantation/reappro depuis byMonth (plus fiable)
        yearStats[year].total_ht_implantation = 0;
        yearStats[year].total_ht_reappro = 0;
        for (const monthKey in yearStats[year].byMonth) {
          yearStats[year].total_ht_implantation += yearStats[year].byMonth[monthKey].ca_ht_implantation || 0;
          yearStats[year].total_ht_reappro += yearStats[year].byMonth[monthKey].ca_ht_reappro || 0;
        }
      }

      // Calculer les cumulatifs par mois pour chaque année
      for (const year in yearStats) {
        let cumulativeHT = 0;
        let cumulativeCommission = 0;
        let cumulativeHTImplantation = 0;
        let cumulativeHTReappro = 0;
        for (let m = 1; m <= 12; m++) {
          const monthKey = String(m).padStart(2, '0');
          if (yearStats[year].byMonth[monthKey]) {
            cumulativeHT += yearStats[year].byMonth[monthKey].ca_ht;
            cumulativeCommission += yearStats[year].byMonth[monthKey].commission;
            cumulativeHTImplantation += yearStats[year].byMonth[monthKey].ca_ht_implantation || 0;
            cumulativeHTReappro += yearStats[year].byMonth[monthKey].ca_ht_reappro || 0;
            yearStats[year].byMonth[monthKey].cumulative_ht = Math.round(cumulativeHT * 100) / 100;
            yearStats[year].byMonth[monthKey].cumulative_commission = Math.round(cumulativeCommission * 100) / 100;
            yearStats[year].byMonth[monthKey].cumulative_ht_implantation = Math.round(cumulativeHTImplantation * 100) / 100;
            yearStats[year].byMonth[monthKey].cumulative_ht_reappro = Math.round(cumulativeHTReappro * 100) / 100;
          } else {
            yearStats[year].byMonth[monthKey] = {
              ca_ht: 0,
              commission: 0,
              cumulative_ht: Math.round(cumulativeHT * 100) / 100,
              cumulative_commission: Math.round(cumulativeCommission * 100) / 100,
              ca_ht_implantation: 0,
              ca_ht_reappro: 0,
              cumulative_ht_implantation: Math.round(cumulativeHTImplantation * 100) / 100,
              cumulative_ht_reappro: Math.round(cumulativeHTReappro * 100) / 100,
            };
          }
        }
      }

      // Formater la réponse
      const years = Object.values(yearStats).map(y => ({
        year: y.year,
        total_ht: Math.round(y.total_ht * 100) / 100,
        total_commission: Math.round(y.total_commission * 100) / 100,
        total_ht_implantation: Math.round(y.total_ht_implantation * 100) / 100,
        total_ht_reappro: Math.round(y.total_ht_reappro * 100) / 100,
        nb_implantations: y.nb_implantations,
        nb_reappros: y.nb_reappros,
        invoices: y.invoices.size,
        byMonth: y.byMonth,
      })).sort((a, b) => b.year - a.year);

      res.json({ years });
    } catch (e) {
      logger.error('Erreur comparaison années:', e);
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
