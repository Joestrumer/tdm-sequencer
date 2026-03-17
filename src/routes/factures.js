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

module.exports = (db) => {
  const router = express.Router();
  const vfService = require('../services/vosfacturesService')(db);

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
    const mapping = db.prepare('SELECT file_name FROM vf_client_mappings WHERE vf_name = ?').get(vfName);
    return (mapping && mapping.file_name) || vfName;
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

  function getPartners() {
    return db.prepare('SELECT * FROM vf_partners WHERE actif = 1').all();
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  router.get('/status', async (req, res) => {
    try {
      const result = await vfService.testConnexion();
      res.json(result);
    } catch (e) {
      res.json({ ok: false, erreur: e.message });
    }
  });

  // ─── Clients VF ─────────────────────────────────────────────────────────────

  router.get('/clients', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.json([]);
      const data = await vfService.rechercherClients(q);
      res.json(data);
    } catch (e) {
      console.error('Erreur recherche clients VF:', e.message);
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/clients/:id', async (req, res) => {
    try {
      const data = await vfService.getClient(req.params.id);
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
      const vfProducts = await vfService.getAllProducts(true);
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

      console.log(`🔍 Matching ${inputLines.length} produits, useCurrentPrices=${useCurrentPrices}`);

      const results = matcherProduits(inputLines, catalog, codeMappings);

      // Si useCurrentPrices = true, supprimer les prix extraits du fichier
      if (useCurrentPrices) {
        results.forEach(p => {
          delete p.prix_ht;
          delete p.priceHT;
          console.log(`💰 Prix supprimé pour ${p.ref}, utilisera le prix du catalogue`);
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
          prix_ht_after_discount: Math.round(priceAfterDiscount * 100) / 100,
          total_ht: Math.round(lineHT * 100) / 100,
          total_ttc: Math.round(lineTTC * 100) / 100,
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
        total_ht: Math.round(totalHT * 100) / 100,
        total_ttc: Math.round(totalTTC * 100) / 100,
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Créer facture ──────────────────────────────────────────────────────────

  router.post('/invoices', async (req, res) => {
    try {
      const { client, products, documentType, orderNumber, fraisPort, sendEmail, emailOpts, priceMode, logGSheets } = req.body;

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
        const lookupKey = `${ref}-${parseFloat(priceHT).toFixed(2)}`;
        console.log(`🔍 findVFProduct: ref=${p.ref} → normalized=${ref}, prix_ht=${priceHT}, lookupKey=${lookupKey}`);
        const vfProduct = findVFProduct(ref, priceHT, catalog, codeMappings, productIdMappings, productNameMappings);
        console.log(`   → productId=${vfProduct.productId}, productName=${vfProduct.productName}`);

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

      console.log('📤 Payload VF positions:', JSON.stringify(positions, null, 2));
      const result = await vfService.creerFacture(invoiceData);

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
        Math.round(montantHT * 100) / 100,
        Math.round(montantTTC * 100) / 100,
        JSON.stringify({ orderNumber, canonicalClientName }),
      );

      // Envoyer email si demandé
      if (sendEmail && result.id) {
        try {
          await vfService.envoyerEmail(result.id, emailOpts || {});
          db.prepare('UPDATE vf_invoice_logs SET email_sent = 1 WHERE vf_invoice_id = ?').run(String(result.id));
        } catch (emailErr) {
          console.error('⚠️ Erreur envoi email:', emailErr.message);
        }
      }

      // Log Google Sheets automatique si demandé
      if (logGSheets !== false) {
        try {
          // Vérifier/réparer credentials avant de tenter le log
          const credsRow = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_credentials'").get();
          let credsOk = false;
          try {
            const p = JSON.parse(credsRow?.valeur || '{}');
            credsOk = !!(p.private_key && p.client_email);
          } catch {}
          if (!credsOk && process.env.GSHEETS_CREDENTIALS) {
            try {
              const envParsed = JSON.parse(process.env.GSHEETS_CREDENTIALS);
              if (envParsed.private_key && envParsed.client_email) {
                db.prepare("INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
                  .run(process.env.GSHEETS_CREDENTIALS);
                console.log('🔧 Credentials GSheets réparées depuis env var avant log');
              }
            } catch {}
          }

          const gsheetsService = require('../services/googlesheetsService')(db);
          const spreadsheetId = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_spreadsheet_id'").get()?.valeur;
          const sheetName = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Log sold';

          console.log(`📊 GSheets: spreadsheetId=${spreadsheetId}, sheetName=${sheetName}, produits=${(products || []).length}`);

          if (spreadsheetId) {
            const gsProducts = (products || []).map(p => ({
              ref: p.ref,
              quantity: p.quantite || p.quantity || 1,
              priceHT: p.prix_ht || catalog[normalizeRef(p.ref)]?.prix_ht || 0,
              csvRef: catalog[normalizeRef(p.ref)]?.csv_ref,
            }));

            const gsResult = await gsheetsService.logInvoice(spreadsheetId, sheetName, {
              clientName: client.name,
              invoiceNumber: result.number || '',
              invoiceDate: new Date().toISOString().split('T')[0],
              products: gsProducts,
            }, canonicalClientName);

            console.log('📊 GSheets log:', JSON.stringify(gsResult));
            if (gsResult.ok) {
              db.prepare('UPDATE vf_invoice_logs SET gsheet_logged = 1 WHERE vf_invoice_id = ?').run(String(result.id));
            } else {
              console.error('📊 GSheets log échec:', JSON.stringify(gsResult));
            }
          } else {
            console.warn('📊 GSheets: pas de spreadsheetId configuré, skip');
          }
        } catch (gsErr) {
          console.error('⚠️ Erreur log GSheets:', gsErr.message, gsErr.stack?.split('\n').slice(0, 3).join(' '));
        }
      }

      res.json(result);
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
          // Réutiliser la logique de création unitaire
          const fakeRes = {
            json: (data) => data,
            status: () => ({ json: (data) => data }),
          };
          // Appeler directement le service
          const result = await vfService.creerFacture(order.invoiceData || order);
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
      const data = await vfService.rechercherFacture(number);
      res.json(data);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/invoices/:id', async (req, res) => {
    try {
      const data = await vfService.getFacture(req.params.id);
      res.json(data);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Email / Relance ────────────────────────────────────────────────────────

  router.post('/invoices/:id/send-email', async (req, res) => {
    try {
      const data = await vfService.envoyerEmail(req.params.id, req.body);
      res.json(data);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/invoices/:id/send-reminder', async (req, res) => {
    try {
      const data = await vfService.envoyerRelance(req.params.id, req.body);
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
      const { client, products, orderNumber } = req.body;
      if (!client || !products || !products.length) {
        return res.status(400).json({ erreur: 'Client et produits requis' });
      }

      // Vérifier/réparer credentials
      const credsRow = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_credentials'").get();
      let credsOk = false;
      try {
        const p = JSON.parse(credsRow?.valeur || '{}');
        credsOk = !!(p.private_key && p.client_email);
      } catch {}
      if (!credsOk && process.env.GSHEETS_CREDENTIALS) {
        try {
          const envParsed = JSON.parse(process.env.GSHEETS_CREDENTIALS);
          if (envParsed.private_key && envParsed.client_email) {
            db.prepare("INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
              .run(process.env.GSHEETS_CREDENTIALS);
            console.log('🔧 Credentials GSheets réparées depuis env var (log-only)');
          }
        } catch {}
      }

      const gsheetsService = require('../services/googlesheetsService')(db);
      const spreadsheetId = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_spreadsheet_id'").get()?.valeur;
      const sheetName = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Log sold';

      if (!spreadsheetId) {
        return res.status(400).json({ erreur: 'Spreadsheet ID non configuré' });
      }

      const catalog = getCatalogMap();
      const canonicalClientName = resolveCanonicalClientName(client.name);

      const gsProducts = products.map(p => ({
        ref: p.ref,
        quantity: p.quantite || p.quantity || 1,
        priceHT: p.prix_ht || catalog[normalizeRef(p.ref)]?.prix_ht || 0,
        csvRef: catalog[normalizeRef(p.ref)]?.csv_ref,
      }));

      console.log(`📊 Log-only: client="${client.name}", canonical="${canonicalClientName}", produits=${gsProducts.length}`);

      const gsResult = await gsheetsService.logInvoice(spreadsheetId, sheetName, {
        clientName: client.name,
        invoiceNumber: orderNumber || 'LOG-' + Date.now(),
        invoiceDate: new Date().toISOString().split('T')[0],
        products: gsProducts,
      }, canonicalClientName);

      console.log('📊 Log-only result:', JSON.stringify(gsResult));
      res.json(gsResult);
    } catch (e) {
      console.error('⚠️ Erreur log-only:', e.message, e.stack?.split('\n').slice(0, 3).join(' '));
      res.status(500).json({ erreur: e.message, status: 'failed_write' });
    }
  });

  // ─── CSV Logisticien ────────────────────────────────────────────────────────

  router.post('/csv-logisticien', (req, res) => {
    try {
      const { invoiceData, client, shippingId } = req.body;
      const shippingNamesMap = getShippingNames();
      const csv = genererCSVLogisticien(invoiceData, client, shippingNamesMap, { shippingId });
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

      // Lire config GSheets
      const spreadsheetId = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_spreadsheet_id'").get()?.valeur;
      const sheetName = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Log sold';

      if (!spreadsheetId) {
        return res.status(400).json({ erreur: 'Spreadsheet ID non configuré' });
      }

      // Résoudre le nom partenaire via clientNameMapping d'abord, puis fallback fuzzy
      let canonName = partnerName;
      if (!canonName) {
        const clientName = invoiceData.clientName || invoiceData.client_name || '';
        canonName = resolveCanonicalClientName(clientName);
        if (canonName === clientName) {
          // Fallback : essayer le fuzzy matching
          const partners = getPartners();
          canonName = mapPartnerNameToCanon(clientName, partners);
        }
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
      // 1. Vérifier credentials en DB
      const credsRow = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_credentials'").get();
      let credsValid = false;
      let credsInfo = 'absentes';
      if (credsRow?.valeur) {
        try {
          const parsed = JSON.parse(credsRow.valeur);
          if (parsed.private_key && parsed.client_email) {
            credsValid = true;
            credsInfo = `OK (${parsed.client_email})`;
          } else {
            credsInfo = 'JSON valide mais champs manquants';
          }
        } catch {
          credsInfo = 'JSON invalide en DB';
        }
      }

      // 2. Si credentials invalides, tenter réparation depuis env var
      if (!credsValid && process.env.GSHEETS_CREDENTIALS) {
        try {
          const envCreds = JSON.parse(process.env.GSHEETS_CREDENTIALS);
          if (envCreds.private_key && envCreds.client_email) {
            db.prepare("INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
              .run(process.env.GSHEETS_CREDENTIALS);
            credsValid = true;
            credsInfo = `Réparé depuis env (${envCreds.client_email})`;
            console.log('🔧 Credentials GSheets réparées depuis GSHEETS_CREDENTIALS env var');
          }
        } catch {
          credsInfo += ' + env var invalide aussi';
        }
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
      const page1 = await vfService.rechercherFacture('', { page: 1, per_page: 20 });
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

      console.log(`📊 Analytics: year=${year}, limit=${limit}`);

      // Récupérer toutes les factures via API VF (avec pagination)
      const allInvoices = [];
      let page = 1;
      const perPage = 100;
      const maxPages = 50; // Limiter à 50 pages max pour éviter boucle infinie

      while (page <= maxPages) {
        const invoices = await vfService.rechercherFacture('', { page, per_page: perPage });

        // Arrêter si plus aucune facture
        if (!invoices || invoices.length === 0) {
          console.log(`🛑 Page ${page}: Aucune facture, fin de pagination`);
          break;
        }

        console.log(`📄 Page ${page}: ${invoices.length} factures retournées par VF`);

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

        console.log(`✅ Page ${page}: ${validInvoices.length} factures valides (kind=vat, numéro chiffres uniquement)`);
        if (validInvoices.length > 0) {
          console.log(`   Exemples: ${validInvoices.slice(0, 3).map(i => `${i.number} (${i.issue_date})`).join(', ')}`);
        }

        allInvoices.push(...validInvoices);

        // Continuer à la page suivante
        page++;
      }

      console.log(`🎯 Total factures valides: ${allInvoices.length}`);

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
      console.error('Erreur analytics:', e);
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
