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
      const { lignes, text } = req.body;
      const catalog = getCatalogMap();
      const codeMappings = getCodeMappings('code_alias');

      let inputLines = lignes;
      if (!inputLines && text) {
        inputLines = parseOrderText(text);
      }

      if (!inputLines || !Array.isArray(inputLines) || inputLines.length === 0) {
        return res.status(400).json({ erreur: 'Aucune ligne produit fournie' });
      }

      const results = matcherProduits(inputLines, catalog, codeMappings);
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

  return router;
};
