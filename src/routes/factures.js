/**
 * factures.js — Routes API factures VosFactures (~15 endpoints)
 */

const express = require('express');
const {
  normalizeRef, matcherProduits, findVFProduct, getDiscount,
  calculerRemise, calculerFraisPort, genererCSVLogisticien,
  parseAdresseExpedition, mapPartnerNameToCanon, parseOrderText,
  inferPriceFromMappings,
} = require('../services/productMatchingService');
const logger = require('../config/logger');

module.exports = (db) => {
  const router = express.Router();
  const vfServiceFactory = require('../services/vosfacturesService');
  const vfService = vfServiceFactory(db); // default (config/env token)

  // Middleware : injecter le vfService adapté au user si token perso
  router.use((req, res, next) => {
    req.vfService = (req.user && req.user.vf_api_token)
      ? vfServiceFactory(db, req.user.vf_api_token)
      : vfService;
    next();
  });

  // Helpers pour lire les données de référence
  function getCatalogMap() {
    const rows = db.prepare('SELECT * FROM vf_catalog WHERE actif = 1').all();
    const map = {};
    for (const r of rows) map[r.ref] = r;
    return map;
  }

  function getCodeMappings(type) {
    if (type) return db.prepare('SELECT * FROM vf_code_mappings WHERE type = ?').all(type);
    return db.prepare('SELECT * FROM vf_code_mappings').all();
  }

  function getDiscountsForClient(clientName) {
    return db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ?').all(clientName);
  }

  function getClientMappings() {
    return db.prepare('SELECT * FROM vf_client_mappings').all();
  }

  function resolveCanonicalClientName(vfName) {
    if (!vfName) return vfName;
    const mapping = db.prepare('SELECT file_name, vf_client_id FROM vf_client_mappings WHERE vf_name = ?').get(vfName);
    if (mapping && mapping.file_name) return mapping.file_name;
    // Si file_name est null mais vf_client_id existe, chercher un autre mapping avec le même client_id qui a un file_name
    if (mapping && !mapping.file_name && mapping.vf_client_id) {
      const alt = db.prepare('SELECT file_name FROM vf_client_mappings WHERE vf_client_id = ? AND file_name IS NOT NULL LIMIT 1').get(mapping.vf_client_id);
      if (alt && alt.file_name) return alt.file_name;
    }
    // Essayer sans le nom de contact (ex: "Loire Valley Lodges - Anne Caroline FREY" → "Loire Valley Lodges")
    const dashIdx = vfName.indexOf(' - ');
    if (dashIdx > 0) {
      const stripped = vfName.substring(0, dashIdx).trim();
      const m2 = db.prepare('SELECT file_name, vf_client_id FROM vf_client_mappings WHERE vf_name = ?').get(stripped);
      if (m2 && m2.file_name) return m2.file_name;
      if (m2 && !m2.file_name && m2.vf_client_id) {
        const alt2 = db.prepare('SELECT file_name FROM vf_client_mappings WHERE vf_client_id = ? AND file_name IS NOT NULL LIMIT 1').get(m2.vf_client_id);
        if (alt2 && alt2.file_name) return alt2.file_name;
      }
    }
    return vfName;
  }

  function getForcedPrices() {
    return getCodeMappings('forced_price');
  }

  function getShippingNames() {
    const rows = db.prepare("SELECT code_source, valeur FROM vf_code_mappings WHERE type = 'shipping_name'").all();
    const map = {};
    for (const r of rows) map[r.code_source] = r.valeur;
    return map;
  }

  // Résoudre le spreadsheet GSheets selon le user connecté
  // - User avec gsheets_spreadsheet_id → son spreadsheet perso
  // - Admin sans gsheets_spreadsheet_id → spreadsheet global (config)
  // - Member sans gsheets_spreadsheet_id → null (pas de log)
  function getUserSpreadsheet(req) {
    if (req.user?.gsheets_spreadsheet_id) return req.user.gsheets_spreadsheet_id;
    if (req.user?.role === 'admin') return db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_spreadsheet_id'").get()?.valeur || null;
    return null;
  }

  function getPartners() {
    return db.prepare('SELECT * FROM vf_partners WHERE actif = 1').all();
  }

  const roundPrice = (n) => Math.round(n * 100) / 100;

  function repairGSheetsCredentials() {
    const credsRow = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_credentials'").get();
    let credsOk = false;
    try {
      const p = JSON.parse(credsRow?.valeur || '{}');
      credsOk = !!(p.private_key && p.client_email);
    } catch (e) {
      logger.warn('GSheets: credentials JSON invalide en DB', { error: e.message });
    }
    if (!credsOk && process.env.GSHEETS_CREDENTIALS) {
      try {
        const envParsed = JSON.parse(process.env.GSHEETS_CREDENTIALS);
        if (envParsed.private_key && envParsed.client_email) {
          db.prepare("INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
            .run(process.env.GSHEETS_CREDENTIALS);
          return { ok: true, email: envParsed.client_email, repaired: true };
        }
      } catch (e) {
        logger.warn('GSheets: env var GSHEETS_CREDENTIALS invalide', { error: e.message });
      }
    }
    return { ok: credsOk, repaired: false };
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  router.get('/status', async (req, res) => {
    try {
      const result = await req.vfService.testConnexion();
      res.json(result);
    } catch (e) {
      res.json({ ok: false, erreur: e.message });
    }
  });

  // ─── Clients VF ─────────────────────────────────────────────────────────────

  router.get('/clients', async (req, res) => {
    try {
      const { q, refresh } = req.query;
      if (!q) return res.json([]);
      // Si refresh=true, forcer le rechargement du cache
      if (refresh === 'true') {
        await req.vfService.getAllClients(true);
      }
      const data = await req.vfService.rechercherClients(q);
      res.json(data);
    } catch (e) {
      logger.error('Erreur recherche clients VF', { error: e.message });
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/clients/:id', async (req, res) => {
    try {
      const data = await req.vfService.getClient(req.params.id);
      res.json(data);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Produits ───────────────────────────────────────────────────────────────

  router.get('/produits', (req, res) => {
    try {
      const catalog = getCatalogMap();
      res.json(Object.values(catalog));
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/produits/sync', async (req, res) => {
    try {
      const vfProducts = await req.vfService.getAllProducts(true);
      res.json({ ok: true, count: vfProducts.length, products: vfProducts.slice(0, 10) });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Matching produits ──────────────────────────────────────────────────────

  router.post('/match-products', (req, res) => {
    try {
      const { lignes, text, useCurrentPrices } = req.body;
      const catalog = getCatalogMap();
      const codeMappings = getCodeMappings('code_alias');

      let inputLines = lignes;
      if (!inputLines && text) {
        inputLines = parseOrderText(text);
      }

      if (!inputLines || !Array.isArray(inputLines) || inputLines.length === 0) {
        return res.status(400).json({ erreur: 'Aucune ligne produit fournie' });
      }

      // Matching produits

      const results = matcherProduits(inputLines, catalog, codeMappings);

      // Si useCurrentPrices = true, supprimer les prix extraits du fichier
      if (useCurrentPrices) {
        results.forEach(p => {
          delete p.prix_ht;
          delete p.priceHT;
        });
      }

      res.json(results);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Calcul prix ────────────────────────────────────────────────────────────

  router.post('/calculate', (req, res) => {
    try {
      const { products, clientName, includeShipping } = req.body;
      if (!products || !Array.isArray(products)) {
        return res.status(400).json({ erreur: 'Produits requis' });
      }

      const catalog = getCatalogMap();
      const discountsDb = clientName ? getDiscountsForClient(clientName) : [];
      const forcedPrices = getCodeMappings('forced_price');

      let totalHT = 0;
      const calculatedProducts = products.map(p => {
        const ref = normalizeRef(p.ref);
        const catEntry = catalog[ref];
        let priceHT = p.prix_ht || catEntry?.prix_ht || 0;
        const qty = p.quantite || p.quantity || 1;
        const tva = p.tva || catEntry?.tva || 20;

        // Remise : d'abord celle du fichier Excel si présente, sinon DB
        let discount = p.discount || 0;
        if (!discount && clientName) {
          discount = calculerRemise(clientName, ref, discountsDb);
        }

        const priceAfterDiscount = priceHT * (1 - discount / 100);
        const lineHT = priceAfterDiscount * qty;
        const lineTTC = lineHT * (1 + tva / 100);
        totalHT += lineHT;

        // Prix forcé TTC
        const forcedEntry = forcedPrices.find(f => normalizeRef(f.code_source) === ref);
        const forcedPriceTTC = forcedEntry ? parseFloat(forcedEntry.valeur) : null;

        return {
          ...p,
          ref,
          prix_ht: priceHT,
          discount,
          prix_ht_after_discount: roundPrice(priceAfterDiscount),
          total_ht: roundPrice(lineHT),
          total_ttc: roundPrice(lineTTC),
          forced_price_ttc: forcedPriceTTC,
        };
      });

      // Frais de port
      let fraisPort = [];
      if (includeShipping !== false) {
        fraisPort = calculerFraisPort(totalHT);
        for (const f of fraisPort) {
          totalHT += f.prix_ht * f.quantite;
        }
      }

      const totalTTC = calculatedProducts.reduce((s, p) => s + p.total_ttc, 0)
        + fraisPort.reduce((s, f) => s + f.prix_ht * f.quantite * 1.2, 0);

      res.json({
        products: calculatedProducts,
        frais_port: fraisPort,
        total_ht: roundPrice(totalHT),
        total_ttc: roundPrice(totalTTC),
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Créer facture ──────────────────────────────────────────────────────────

  router.post('/invoices', async (req, res) => {
    try {
      const { client, products, documentType, orderNumber, fraisPort, sendEmail, emailOpts, logGSheets } = req.body;

      const catalog = getCatalogMap();
      const productIdMappings = getCodeMappings('product_id');
      const productNameMappings = getCodeMappings('product_name');
      const codeMappings = getCodeMappings('code_alias');
      const forcedPrices = getForcedPrices();

      // Résoudre le nom canonique du client pour les remises
      const canonicalClientName = resolveCanonicalClientName(client.name);
      const discountsDb = canonicalClientName ? getDiscountsForClient(canonicalClientName) : [];

      // Construire les positions de la facture (logique HTML)
      const positions = [];
      let hasDiscount = false;
      const allProducts = [...(products || [])];

      for (const p of allProducts) {
        const ref = normalizeRef(p.ref);
        const catEntry = catalog[ref];
        const qty = p.quantite || p.quantity || 1;
        const taxRate = p.tva || catEntry?.tva || 20;
        const priceHT = p.prix_ht || catEntry?.prix_ht || 0;

        // Résoudre la remise : d'abord celle passée explicitement, sinon DB
        let discount = p.discount || 0;
        if (!discount && canonicalClientName) {
          discount = calculerRemise(canonicalClientName, ref, discountsDb);
        }
        if (discount > 0) hasDiscount = true;

        // Résoudre le produit VF via la clé REF-PRIX (comme le HTML)
        const vfProduct = findVFProduct(ref, priceHT, catalog, codeMappings, productIdMappings, productNameMappings);

        // Prix forcé TTC
        const forcedEntry = forcedPrices.find(f => normalizeRef(f.code_source) === ref);
        const forcedPriceTTC = forcedEntry ? parseFloat(forcedEntry.valeur) : null;

        // Déterminer le prix HT à utiliser
        let priceToUse = priceHT;
        if (forcedPriceTTC) {
          priceToUse = forcedPriceTTC / (1 + taxRate / 100);
        }

        // Calcul du total_price_gross (TTC sans remise)
        const totalPriceNet = priceToUse * qty;
        const totalPriceGross = forcedPriceTTC
          ? (forcedPriceTTC * qty)
          : (totalPriceNet * (1 + taxRate / 100));

        // Construire la position (comme le HTML)
        const position = {
          product_id: vfProduct.productId || undefined,
          name: vfProduct.productName || p.nom || p.name || vfProduct.ref,
          code: p.ref || vfProduct.vfRef || ref,
          tax: taxRate,
          quantity: qty,
        };

        // Toujours envoyer price_net et total_price_gross (VF les exige)
        position.price_net = priceToUse.toFixed(2);
        position.total_price_gross = totalPriceGross.toFixed(2);

        // Remise en plus si applicable
        if (discount > 0) {
          position.discount_percent = discount;
        }

        // Nettoyer les undefined
        if (!position.product_id) delete position.product_id;

        positions.push(position);
      }

      // Frais de port (toujours avec price_net + total_price_gross)
      for (const f of (fraisPort || [])) {
        const ref = normalizeRef(f.ref);
        const qty = f.quantite || f.quantity || 1;
        const taxRate = f.tva || 20;
        const priceHT = f.prix_ht || 0;
        const gross = priceHT * qty * (1 + taxRate / 100);

        const vfProduct = findVFProduct(ref, priceHT, catalog, codeMappings, productIdMappings, productNameMappings);

        const position = {
          name: vfProduct.productName || f.nom || f.name || ref,
          code: f.ref || ref,
          price_net: Number(priceHT).toFixed(2),
          total_price_gross: Number(gross).toFixed(2),
          tax: taxRate,
          quantity: qty,
        };
        if (vfProduct.productId) position.product_id = vfProduct.productId;

        positions.push(position);
      }

      const today = new Date().toISOString().split('T')[0];
      const paymentTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const invoiceData = {
        kind: documentType === 'proforma' ? 'proforma' : 'vat',
        number: null,
        sell_date: today,
        issue_date: today,
        payment_to: paymentTo,
        department_id: parseInt(process.env.VF_DEPARTMENT_ID) || 1553025,
        buyer_name: client.name || '',
        buyer_tax_no: client.tax_no || '',
        buyer_post_code: client.post_code || '',
        buyer_city: client.city || '',
        buyer_street: client.street || '',
        buyer_country: client.country || 'FR',
        buyer_email: client.email || '',
        buyer_phone: client.phone || '',
        show_discount: hasDiscount,
        discount_kind: hasDiscount ? 'percent_unit' : null,
        positions,
        oid: orderNumber || '',
      };

      if (client.id) invoiceData.client_id = client.id;

      const result = await req.vfService.creerFacture(invoiceData);

      // Logger dans la DB
      const montantHT = (products || []).reduce((s, p) => {
        const ref = normalizeRef(p.ref);
        const catEntry = catalog[ref];
        const priceHT = p.prix_ht || catEntry?.prix_ht || 0;
        const qty = p.quantite || p.quantity || 1;
        const discount = p.discount || 0;
        return s + priceHT * (1 - discount / 100) * qty;
      }, 0);
      const montantTTC = montantHT * 1.2;
      db.prepare(`
        INSERT INTO vf_invoice_logs (vf_invoice_id, vf_invoice_number, client_name, mode, montant_ht, montant_ttc, meta)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(result.id || ''),
        result.number || '',
        client.name || '',
        documentType || 'vat',
        roundPrice(montantHT),
        roundPrice(montantTTC),
        JSON.stringify({ orderNumber, canonicalClientName }),
      );

      // Envoyer email si demandé
      let emailSent = false;
      if (sendEmail && result.id) {
        try {
          await req.vfService.envoyerEmail(result.id, emailOpts || {});
          db.prepare('UPDATE vf_invoice_logs SET email_sent = 1 WHERE vf_invoice_id = ?').run(String(result.id));
          emailSent = true;
        } catch (emailErr) {
          logger.warn('Erreur envoi email facture', { invoiceId: result.id, error: emailErr.message });
          result.email_error = emailErr.message;
        }
      }

      // Log Google Sheets automatique si demandé
      if (logGSheets !== false) {
        try {
          repairGSheetsCredentials();
          const gsheetsService = require('../services/googlesheetsService')(db);
          const spreadsheetId = getUserSpreadsheet(req);
          const sheetName = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Log sold';

          if (spreadsheetId) {
            const gsProducts = (products || []).map(p => ({
              ref: p.ref,
              quantity: p.quantite || p.quantity || 1,
              priceHT: p.prix_ht || catalog[normalizeRef(p.ref)]?.prix_ht || 0,
              csvRef: catalog[normalizeRef(p.ref)]?.csv_ref,
            }));

            // Ajouter frais de port (FP/FE) au log GSheets
            for (const f of (fraisPort || [])) {
              gsProducts.push({
                ref: f.ref,
                quantity: f.quantite || f.quantity || 1,
                priceHT: f.prix_ht,
              });
            }

            // Ne passer le nom canonique que s'il diffère du nom VF (mapping réel trouvé)
            // Sinon laisser logInvoice résoudre via mapPartnerNameToCanon avec les noms du spreadsheet
            const resolvedPartner = (canonicalClientName && canonicalClientName !== client.name) ? canonicalClientName : undefined;
            const gsResult = await gsheetsService.logInvoice(spreadsheetId, sheetName, {
              clientName: client.name,
              invoiceNumber: result.number || '',
              invoiceDate: new Date().toISOString().split('T')[0],
              products: gsProducts,
            }, resolvedPartner);

            if (gsResult.ok) {
              db.prepare('UPDATE vf_invoice_logs SET gsheet_logged = 1 WHERE vf_invoice_id = ?').run(String(result.id));
            }
          }
        } catch (gsErr) {
          logger.warn('Erreur log GSheets', { error: gsErr.message });
        }
      }

      res.json({ ...result, email_sent: emailSent });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Batch ──────────────────────────────────────────────────────────────────

  router.post('/invoices/batch', async (req, res) => {
    try {
      const { orders } = req.body;
      if (!orders || !Array.isArray(orders)) {
        return res.status(400).json({ erreur: 'Tableau orders requis' });
      }

      const results = [];
      for (const order of orders) {
        try {
          const result = await req.vfService.creerFacture(order.invoiceData || order);
          results.push({ ok: true, ...result });
        } catch (e) {
          results.push({ ok: false, erreur: e.message, order: order.id });
        }
      }

      res.json({ results, total: results.length, success: results.filter(r => r.ok).length });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Détail / Recherche ─────────────────────────────────────────────────────

  router.get('/invoices/search', async (req, res) => {
    try {
      const { number } = req.query;
      if (!number) return res.json([]);
      const data = await req.vfService.rechercherFacture(number);
      res.json(data);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/invoices/:id/products', async (req, res) => {
    try {
      let data;
      try {
        data = await req.vfService.getFacture(req.params.id);
      } catch (vfErr) {
        return res.status(404).json({ erreur: `Facture #${req.params.id} non trouvée sur VosFactures: ${vfErr.message}` });
      }
      if (!data || !data.positions) return res.status(404).json({ erreur: `Facture #${req.params.id} trouvée mais sans positions (lignes de produits)` });

      const catalogMap = getCatalogMap();
      const products = (data.positions || [])
        .filter(pos => {
          const code = (pos.code || pos.name || '').toUpperCase();
          return !code.startsWith('FP') && !code.startsWith('FE') && !code.includes('FRAIS');
        })
        .map(pos => {
          const ref = normalizeRef(pos.code || '');
          const catalog = catalogMap[ref];
          const qty = parseFloat(pos.quantity) || 1;
          // price_net = prix unitaire HT, total_price_gross = total TTC
          const unitPriceHT = parseFloat(pos.price_net) || 0;
          // Discount : VF utilise discount_percent (nombre) ou discount (texte comme "10%")
          let discount = 0;
          if (pos.discount_percent) {
            discount = parseFloat(pos.discount_percent) || 0;
          } else if (pos.discount && typeof pos.discount === 'string') {
            discount = parseFloat(pos.discount.replace('%', '').replace(',', '.')) || 0;
          }
          return {
            ref: ref || pos.name,
            nom: catalog?.nom || pos.name || '',
            quantite: qty,
            prix_ht: unitPriceHT,
            discount,
            tva: parseFloat(pos.tax) || 20,
            confiance: catalog ? 'exact' : 'import',
          };
        });

      const client = data.buyer_name ? {
        name: data.buyer_name,
        vf_id: data.client_id,
        street: data.buyer_street || '',
        city: data.buyer_city || '',
        zip: data.buyer_post_code || '',
        country: data.buyer_country || '',
        email: data.buyer_email || '',
        phone: data.buyer_phone || '',
      } : null;

      // Adresse de livraison (si différente de facturation)
      const delivery_address = data.delivery_address || '';
      const use_delivery_address = data.use_delivery_address;

      res.json({ products, client, invoiceNumber: data.number || data.id, delivery_address, use_delivery_address });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/invoices/:id', async (req, res) => {
    try {
      const data = await req.vfService.getFacture(req.params.id);
      res.json(data);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Email / Relance ────────────────────────────────────────────────────────

  router.post('/invoices/:id/send-email', async (req, res) => {
    try {
      const data = await req.vfService.envoyerEmail(req.params.id, req.body);
      res.json(data);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/invoices/:id/send-reminder', async (req, res) => {
    try {
      const data = await req.vfService.envoyerRelance(req.params.id, req.body);
      res.json(data);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── CSV Logisticien ────────────────────────────────────────────────────────

  // ─── PDF Proxy ──────────────────────────────────────────────────────────────

  router.get('/invoices/:id/pdf', async (req, res) => {
    try {
      const token = (db.prepare("SELECT valeur FROM config WHERE cle = 'vf_api_token'").get()?.valeur || process.env.VF_API_TOKEN || '').trim();
      if (!token) return res.status(500).json({ erreur: 'Token VosFactures non configuré' });

      const vfBase = process.env.VF_BASE_URL || 'https://terredemars.vosfactures.fr';
      const pdfUrl = `${vfBase}/invoices/${req.params.id}.pdf?api_token=${token}`;
      const pdfRes = await fetch(pdfUrl);
      if (!pdfRes.ok) return res.status(pdfRes.status).json({ erreur: `VF PDF error: ${pdfRes.status}` });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="facture-${req.params.id}.pdf"`);
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Log Only (GSheets sans créer de facture) ──────────────────────────────

  router.post('/log-only', async (req, res) => {
    try {
      const { client, products, fraisPort, orderNumber } = req.body;
      if (!client || !products || !products.length) {
        return res.status(400).json({ erreur: 'Client et produits requis' });
      }

      repairGSheetsCredentials();
      const gsheetsService = require('../services/googlesheetsService')(db);
      const spreadsheetId = getUserSpreadsheet(req);
      const sheetName = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Log sold';

      if (!spreadsheetId) {
        return res.status(400).json({ erreur: 'Spreadsheet ID non configuré pour votre compte' });
      }

      const catalog = getCatalogMap();

      const gsProducts = products.map(p => ({
        ref: p.ref,
        quantity: p.quantite || p.quantity || 1,
        priceHT: p.prix_ht || catalog[normalizeRef(p.ref)]?.prix_ht || 0,
        csvRef: catalog[normalizeRef(p.ref)]?.csv_ref,
      }));

      // Ajouter frais de port (FP/FE) au log GSheets
      for (const f of (fraisPort || [])) {
        gsProducts.push({
          ref: f.ref,
          quantity: f.quantite || f.quantity || 1,
          priceHT: f.prix_ht,
        });
      }

      // Ne pas passer partnerName, laisser logInvoice le résoudre avec mapPartnerNameToCanon
      const gsResult = await gsheetsService.logInvoice(spreadsheetId, sheetName, {
        clientName: client.name,
        invoiceNumber: orderNumber || 'LOG-' + Date.now(),
        invoiceDate: new Date().toISOString().split('T')[0],
        products: gsProducts,
      });

      res.json(gsResult);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── CSV Logisticien ────────────────────────────────────────────────────────

  router.post('/csv-logisticien', (req, res) => {
    try {
      const { invoiceData, client, shippingId, deliveryAddress } = req.body;
      const shippingNamesMap = getShippingNames();
      const csv = genererCSVLogisticien(invoiceData, client, shippingNamesMap, { shippingId, deliveryAddress });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="logisticien-${invoiceData.number || 'facture'}.csv"`);
      res.send(csv);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Log Google Sheets ──────────────────────────────────────────────────────

  router.post('/log-gsheets', async (req, res) => {
    try {
      const gsheetsService = require('../services/googlesheetsService')(db);
      const { invoiceData, partnerName } = req.body;

      // Lire config GSheets selon le user
      const spreadsheetId = getUserSpreadsheet(req);
      const sheetName = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Log sold';

      if (!spreadsheetId) {
        return res.status(400).json({ erreur: 'Spreadsheet ID non configuré pour votre compte' });
      }

      // Résoudre le nom partenaire via clientNameMapping d'abord
      // Si pas de mapping réel trouvé, laisser logInvoice résoudre avec les noms du spreadsheet
      let canonName = partnerName;
      if (!canonName) {
        const clientName = invoiceData.clientName || invoiceData.client_name || '';
        const dbMapped = resolveCanonicalClientName(clientName);
        canonName = (dbMapped && dbMapped !== clientName) ? dbMapped : undefined;
      }

      const result = await gsheetsService.logInvoice(spreadsheetId, sheetName, invoiceData, canonName);

      // Mettre à jour le log
      const vfInvoiceId = invoiceData.vf_invoice_id || invoiceData.vfInvoiceId;
      if (vfInvoiceId) {
        db.prepare('UPDATE vf_invoice_logs SET gsheet_logged = 1 WHERE vf_invoice_id = ?')
          .run(String(vfInvoiceId));
      }

      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Historique ─────────────────────────────────────────────────────────────

  router.get('/logs', (req, res) => {
    try {
      const { limit } = req.query;
      const rows = db.prepare('SELECT * FROM vf_invoice_logs ORDER BY created_at DESC LIMIT ?')
        .all(parseInt(limit) || 100);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Diagnostic GSheets ────────────────────────────────────────────────────

  router.get('/gsheets-status', async (req, res) => {
    try {
      // 1. Vérifier/réparer credentials
      const repairResult = repairGSheetsCredentials();
      let credsValid = repairResult.ok;
      let credsInfo = repairResult.ok
        ? (repairResult.repaired ? `Réparé depuis env (${repairResult.email})` : 'OK')
        : 'absentes';

      // 2. Enrichir credsInfo si OK
      if (credsValid && !repairResult.repaired) {
        try {
          const parsed = JSON.parse(db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_credentials'").get()?.valeur || '{}');
          if (parsed.client_email) credsInfo = `OK (${parsed.client_email})`;
        } catch {}
      }

      // 3. Vérifier config spreadsheet
      const spreadsheetId = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_spreadsheet_id'").get()?.valeur;
      const sheetName = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Log sold';

      // 4. Tester la connexion si credentials OK
      let connectionTest = null;
      if (credsValid && spreadsheetId) {
        try {
          const gsheetsService = require('../services/googlesheetsService')(db);
          connectionTest = await gsheetsService.getSheetStatus(spreadsheetId);
        } catch (e) {
          connectionTest = { ok: false, erreur: e.message };
        }
      }

      res.json({
        credentials: credsInfo,
        credsValid,
        spreadsheetId: spreadsheetId || 'NON CONFIGURÉ',
        sheetName,
        envVarPresent: !!process.env.GSHEETS_CREDENTIALS,
        connection: connectionTest,
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── DEBUG Analytics ─────────────────────────────────────────────────────────
  router.get('/analytics/debug', async (req, res) => {
    try {
      const page1 = await req.vfService.rechercherFacture('', { page: 1, per_page: 20 });
      const sample = page1.slice(0, 5).map(inv => ({
        id: inv.id,
        number: inv.number,
        kind: inv.kind,
        date: inv.issue_date,
        buyer: inv.buyer_name,
        ht: inv.price_net,
        ttc: inv.price_gross,
      }));

      res.json({
        total_returned: page1.length,
        sample_invoices: sample,
        kinds: [...new Set(page1.map(i => i.kind))],
        number_formats: page1.slice(0, 10).map(i => ({ number: i.number, kind: i.kind })),
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Analytics / Dashboard CA ───────────────────────────────────────────────

  router.get('/analytics', async (req, res) => {
    try {
      const { year, limit } = req.query;

      logger.info('Analytics request', { year, limit });

      // Récupérer toutes les factures via API VF (avec pagination)
      const allInvoices = [];
      let page = 1;
      const perPage = 100;
      const maxPages = 50; // Limiter à 50 pages max pour éviter boucle infinie

      while (page <= maxPages) {
        const invoices = await req.vfService.rechercherFacture('', { page, per_page: perPage });

        // Arrêter si plus aucune facture
        if (!invoices || invoices.length === 0) {
          logger.debug(`Analytics: page ${page} vide, fin de pagination`);
          break;
        }

        logger.debug(`Analytics: page ${page}, ${invoices.length} factures VF`);

        // Filtrer uniquement les vraies factures (kind=vat, pas proforma/devis)
        const validInvoices = invoices.filter(inv => {
          // Vérifier que c'est une vraie facture (kind=vat)
          // kind peut être: 'vat' (facture), 'proforma', 'estimate' (devis), etc.
          if (inv.kind !== 'vat') return false;

          // Les vraies factures ont un numéro uniquement composé de chiffres (ex: 7158)
          // Les proformas ont un préfixe (ex: P4478)
          const num = String(inv.number || '').trim();
          if (!/^\d+$/.test(num)) return false; // Exclure si contient des lettres

          // Si filtre par année, vérifier l'année
          if (year && inv.issue_date) {
            const invoiceYear = new Date(inv.issue_date).getFullYear();
            if (invoiceYear !== parseInt(year)) return false;
          }

          return true;
        });

        logger.debug(`Analytics: page ${page}, ${validInvoices.length} factures valides`);

        allInvoices.push(...validInvoices);

        // Continuer à la page suivante
        page++;
      }

      logger.info(`Analytics: ${allInvoices.length} factures valides récupérées`);

      // Calculer les statistiques
      const stats = {
        total: {
          invoices: allInvoices.length,
          ca_ht: 0,
          ca_ttc: 0,
        },
        byMonth: {},
        byClient: {},
        topClients: [],
        recentInvoices: allInvoices.slice(0, 10).map(inv => ({
          number: inv.number,
          client: inv.buyer_name,
          date: inv.issue_date,
          amount_ht: parseFloat(inv.price_net || 0),
          amount_ttc: parseFloat(inv.price_gross || 0),
        })),
      };

      // Parcourir les factures
      for (const inv of allInvoices) {
        const amountHT = parseFloat(inv.price_net || 0);
        const amountTTC = parseFloat(inv.price_gross || 0);

        // Total
        stats.total.ca_ht += amountHT;
        stats.total.ca_ttc += amountTTC;

        // Par mois
        const month = inv.issue_date?.substring(0, 7) || 'unknown'; // YYYY-MM
        if (!stats.byMonth[month]) {
          stats.byMonth[month] = { ca_ht: 0, ca_ttc: 0, count: 0 };
        }
        stats.byMonth[month].ca_ht += amountHT;
        stats.byMonth[month].ca_ttc += amountTTC;
        stats.byMonth[month].count += 1;

        // Par client
        const client = inv.buyer_name || 'Inconnu';
        if (!stats.byClient[client]) {
          stats.byClient[client] = { ca_ht: 0, ca_ttc: 0, count: 0 };
        }
        stats.byClient[client].ca_ht += amountHT;
        stats.byClient[client].ca_ttc += amountTTC;
        stats.byClient[client].count += 1;
      }

      // Top 10 clients
      stats.topClients = Object.entries(stats.byClient)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.ca_ht - a.ca_ht)
        .slice(0, 10);

      // Arrondir les montants
      stats.total.ca_ht = Math.round(stats.total.ca_ht * 100) / 100;
      stats.total.ca_ttc = Math.round(stats.total.ca_ttc * 100) / 100;

      res.json(stats);
    } catch (e) {
      logger.error('Erreur analytics', { error: e.message });
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Données auxiliaires ────────────────────────────────────────────────────

  router.get('/shipping-names', (req, res) => {
    try {
      res.json(getShippingNames());
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/client-discounts', (req, res) => {
    try {
      const { client } = req.query;
      if (!client) return res.json([]);
      // Résoudre le nom canonique avant de chercher les remises
      const canonName = resolveCanonicalClientName(client);
      res.json(getDiscountsForClient(canonName));
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── WMS Tracking ────────────────────────────────────────────────────────────

  const wmsService = require('../services/wmsService');

  router.get('/wms/tracking/:orderRef', async (req, res) => {
    try {
      const info = await wmsService.getFullInfo(db, req.params.orderRef);
      res.json(info);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/wms/tracking-batch', async (req, res) => {
    try {
      const { orderRefs } = req.body;
      if (!Array.isArray(orderRefs) || !orderRefs.length) {
        return res.status(400).json({ erreur: 'orderRefs requis (tableau)' });
      }
      const results = await Promise.allSettled(
        orderRefs.map(ref => wmsService.getFullInfo(db, ref))
      );
      res.json(results.map((r, i) => r.status === 'fulfilled' ? r.value : { delivery_order: orderRefs[i], error: r.reason?.message }));
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── DEBUG WMS : Voir la réponse XML brute ──────────────────────────────────
  router.get('/wms/debug/:orderRef', async (req, res) => {
    try {
      const result = await wmsService.debugCall(db, req.params.orderRef, req.query.method || 'getStatus');
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── DEBUG WMS INFO : Tester le 2ème WSDL ───────────────────────────────────
  const wmsInfoService = require('../services/wmsInfoService');

  router.get('/wms-info/debug/:orderRef', async (req, res) => {
    try {
      const result = await wmsInfoService.debugCall(db, req.params.orderRef, req.query.method || 'getOrderInfo');
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/wms-info/try-all/:orderRef', async (req, res) => {
    try {
      const result = await wmsInfoService.tryAllMethods(db, req.params.orderRef);
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── TEMPORAIRE : Forcer utilisation env var au lieu de DB ──────────────────
  router.post('/force-env-tokens', async (req, res) => {
    try {
      // Supprimer les tokens de la DB pour forcer l'utilisation des env vars
      db.prepare("DELETE FROM config WHERE cle = 'vf_api_token'").run();
      db.prepare("DELETE FROM config WHERE cle = 'brevo_api_key'").run();
      db.prepare("DELETE FROM config WHERE cle = 'hubspot_api_key'").run();
      db.prepare("DELETE FROM config WHERE cle = 'gsheets_credentials'").run();
      res.json({ ok: true, message: 'Tous les tokens supprimés de la DB, les env vars seront utilisées' });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Mettre à jour credentials Google Sheets directement via API ───────────
  router.post('/update-gsheets-creds', async (req, res) => {
    try {
      const { credentials } = req.body;
      if (!credentials) {
        return res.status(400).json({ erreur: 'Le champ credentials est requis (objet JSON complet)' });
      }

      // Vérifier que c'est un objet valide avec les champs requis
      if (!credentials.private_key || !credentials.client_email) {
        return res.status(400).json({ erreur: 'Credentials invalides : private_key et client_email requis' });
      }

      // Stocker en DB
      db.prepare("INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
        .run(JSON.stringify(credentials));

      res.json({
        ok: true,
        message: 'Credentials Google Sheets mis à jour',
        client_email: credentials.client_email
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
