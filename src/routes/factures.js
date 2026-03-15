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
      const { q, page } = req.query;
      if (!q) return res.json([]);
      const data = await vfService.rechercherClients(q, page || 1);
      res.json(data);
    } catch (e) {
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
      const { client, products, documentType, orderNumber, fraisPort, sendEmail, emailOpts } = req.body;

      const catalog = getCatalogMap();
      const productIdMappings = getCodeMappings('product_id');
      const productNameMappings = getCodeMappings('product_name');

      // Construire les positions de la facture
      const positions = [];
      const allProducts = [...(products || []), ...(fraisPort || [])];

      for (const p of allProducts) {
        const vfProduct = findVFProduct(p.ref, p.prix_ht, catalog, getCodeMappings('code_alias'), productIdMappings, productNameMappings);

        const position = {
          quantity: p.quantite || p.quantity || 1,
          total_price_gross: (p.prix_ht || 0) * (p.quantite || p.quantity || 1),
          tax: p.tva || 20,
          discount: (p.discount || 0).toString(),
        };

        if (vfProduct.productId) position.product_id = vfProduct.productId;
        if (vfProduct.productName) position.name = vfProduct.productName;
        else position.name = p.nom || p.name || vfProduct.ref;

        positions.push(position);
      }

      const invoiceData = {
        kind: documentType === 'proforma' ? 'proforma' : 'vat',
        number: null,
        buyer_name: client.name || '',
        buyer_tax_no: client.tax_no || '',
        buyer_post_code: client.post_code || '',
        buyer_city: client.city || '',
        buyer_street: client.street || '',
        buyer_country: client.country || 'FR',
        buyer_email: client.email || '',
        buyer_phone: client.phone || '',
        positions,
        oid: orderNumber || '',
      };

      if (client.id) invoiceData.client_id = client.id;

      const result = await vfService.creerFacture(invoiceData);

      // Logger dans la DB
      const montantHT = positions.reduce((s, p) => s + (p.total_price_gross || 0), 0);
      db.prepare(`
        INSERT INTO vf_invoice_logs (vf_invoice_id, vf_invoice_number, client_name, mode, montant_ht, montant_ttc, meta)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(result.id || ''),
        result.number || '',
        client.name || '',
        documentType || 'vat',
        montantHT,
        montantHT * 1.2,
        JSON.stringify({ orderNumber }),
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

  router.post('/csv-logisticien', (req, res) => {
    try {
      const { invoiceData, client } = req.body;
      const shippingNamesMap = getShippingNames();
      const csv = genererCSVLogisticien(invoiceData, client, shippingNamesMap);
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
      const sheetName = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Suivi';

      if (!spreadsheetId) {
        return res.status(400).json({ erreur: 'Spreadsheet ID non configuré' });
      }

      // Résoudre le nom partenaire
      const partners = getPartners();
      const canonName = partnerName || mapPartnerNameToCanon(invoiceData.client_name || '', partners);

      const result = await gsheetsService.logInvoice(spreadsheetId, sheetName, invoiceData, canonName);

      // Mettre à jour le log
      if (invoiceData.vf_invoice_id) {
        db.prepare('UPDATE vf_invoice_logs SET gsheet_logged = 1 WHERE vf_invoice_id = ?')
          .run(invoiceData.vf_invoice_id);
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
      res.json(getDiscountsForClient(client));
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
