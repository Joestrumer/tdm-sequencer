/**
 * partnerOrders.js — Routes admin pour gérer les commandes partenaires
 */

const express = require('express');
const {
  normalizeRef, findVFProduct, calculerRemise, calculerFraisPort, genererCSVLogisticien, parseAdresseExpedition,
} = require('../services/productMatchingService');
const logger = require('../config/logger');

module.exports = (db) => {
  const router = express.Router();
  const vfService = require('../services/vosfacturesService')(db);

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

  function resolveCanonicalClientName(vfName) {
    if (!vfName) return vfName;
    const mapping = db.prepare('SELECT file_name FROM vf_client_mappings WHERE vf_name = ?').get(vfName);
    return (mapping && mapping.file_name) || vfName;
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

  function repairGSheetsCredentials() {
    const credsRow = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_credentials'").get();
    let credsOk = false;
    try {
      const p = JSON.parse(credsRow?.valeur || '{}');
      credsOk = !!(p.private_key && p.client_email);
    } catch (e) {}
    if (!credsOk && process.env.GSHEETS_CREDENTIALS) {
      try {
        const envParsed = JSON.parse(process.env.GSHEETS_CREDENTIALS);
        if (envParsed.private_key && envParsed.client_email) {
          db.prepare("INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
            .run(process.env.GSHEETS_CREDENTIALS);
          return { ok: true, repaired: true };
        }
      } catch (e) {}
    }
    return { ok: credsOk, repaired: false };
  }

  const roundPrice = (n) => Math.round(n * 100) / 100;

  // ─── Liste commandes ──────────────────────────────────────────────────────
  router.get('/', (req, res) => {
    try {
      const { statut } = req.query;
      let sql = `
        SELECT po.*, vp.nom as partner_nom, vp.email as partner_email, vp.contact_nom as partner_contact
        FROM partner_orders po
        JOIN vf_partners vp ON vp.id = po.partner_id
      `;
      const params = [];
      if (statut) {
        sql += ' WHERE po.statut = ?';
        params.push(statut);
      }
      sql += ' ORDER BY po.created_at DESC';

      const orders = db.prepare(sql).all(...params);
      const result = orders.map(o => ({
        ...o,
        products: JSON.parse(o.products || '[]'),
      }));
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Compteurs par statut ─────────────────────────────────────────────────
  router.get('/counts', (req, res) => {
    try {
      const counts = db.prepare(`
        SELECT statut, COUNT(*) as count FROM partner_orders GROUP BY statut
      `).all();
      const result = { en_attente: 0, validee: 0, annulee: 0 };
      for (const c of counts) result[c.statut] = c.count;
      result.total = result.en_attente + result.validee + result.annulee;
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Détail commande ──────────────────────────────────────────────────────
  router.get('/:id', (req, res) => {
    try {
      const order = db.prepare(`
        SELECT po.*, vp.nom as partner_nom, vp.email as partner_email,
               vp.contact_nom as partner_contact, vp.telephone as partner_telephone,
               vp.adresse as partner_adresse, vp.shipping_id as partner_shipping_id
        FROM partner_orders po
        JOIN vf_partners vp ON vp.id = po.partner_id
        WHERE po.id = ?
      `).get(req.params.id);

      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });

      res.json({
        ...order,
        products: JSON.parse(order.products || '[]'),
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Valider commande ─────────────────────────────────────────────────────
  router.post('/:id/validate', async (req, res) => {
    try {
      const { documentType, shippingId, sendEmail = true, logGSheets = true, generateCsv = false } = req.body || {};

      const order = db.prepare(`
        SELECT po.*, vp.nom as partner_nom, vp.nom_normalise, vp.email as partner_email,
               vp.contact_nom as partner_contact, vp.shipping_id as partner_shipping_id,
               vp.adresse as partner_adresse, vp.telephone as partner_telephone
        FROM partner_orders po
        JOIN vf_partners vp ON vp.id = po.partner_id
        WHERE po.id = ?
      `).get(req.params.id);

      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });
      if (order.statut !== 'en_attente') return res.status(400).json({ erreur: 'Cette commande ne peut plus être validée' });

      const products = JSON.parse(order.products || '[]');
      const catalog = getCatalogMap();
      const productIdMappings = getCodeMappings('product_id');
      const productNameMappings = getCodeMappings('product_name');
      const codeMappings = getCodeMappings('code_alias');
      const forcedPrices = getCodeMappings('forced_price');

      // Résoudre le client VF
      const canonicalClientName = resolveCanonicalClientName(order.partner_nom) || order.nom_normalise;
      const discountsDb = getDiscountsForClient(canonicalClientName);

      // Construire les positions
      const positions = [];
      let hasDiscount = false;

      for (const p of products) {
        const ref = normalizeRef(p.ref);
        const catEntry = catalog[ref];
        const qty = p.quantite || 1;
        const taxRate = p.tva || catEntry?.tva || 20;
        const priceHT = p.prix_ht || catEntry?.prix_ht || 0;

        let discount = p.discount_pct || 0;
        if (!discount && canonicalClientName) {
          const discEntry = discountsDb.find(d => normalizeRef(d.product_code) === ref);
          discount = discEntry ? discEntry.discount_pct : 0;
        }
        if (discount > 0) hasDiscount = true;

        const vfProduct = findVFProduct(ref, priceHT, catalog, codeMappings, productIdMappings, productNameMappings);

        const forcedEntry = forcedPrices.find(f => normalizeRef(f.code_source) === ref);
        const forcedPriceTTC = forcedEntry ? parseFloat(forcedEntry.valeur) : null;

        let priceToUse = priceHT;
        if (forcedPriceTTC) {
          priceToUse = forcedPriceTTC / (1 + taxRate / 100);
        }

        const totalPriceNet = priceToUse * qty;
        const totalPriceGross = forcedPriceTTC
          ? (forcedPriceTTC * qty)
          : (totalPriceNet * (1 + taxRate / 100));

        const position = {
          name: vfProduct.productName || p.nom || vfProduct.ref,
          code: p.ref || vfProduct.vfRef || ref,
          tax: taxRate,
          quantity: qty,
          price_net: priceToUse.toFixed(2),
          total_price_gross: totalPriceGross.toFixed(2),
        };

        if (vfProduct.productId) position.product_id = vfProduct.productId;
        if (discount > 0) position.discount_percent = discount;

        positions.push(position);
      }

      // Résoudre le client VF pour la facture
      const clientMapping = db.prepare('SELECT * FROM vf_client_mappings WHERE file_name = ? OR vf_name = ?')
        .get(canonicalClientName, order.partner_nom);

      const today = new Date().toISOString().split('T')[0];
      const paymentTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const invoiceData = {
        kind: documentType || 'vat',
        number: null,
        sell_date: today,
        issue_date: today,
        payment_to: paymentTo,
        department_id: parseInt(process.env.VF_DEPARTMENT_ID) || 1553025,
        buyer_name: order.partner_nom,
        buyer_email: order.partner_email || '',
        show_discount: hasDiscount,
        discount_kind: hasDiscount ? 'percent_unit' : null,
        positions,
      };

      if (clientMapping?.vf_client_id) {
        invoiceData.client_id = clientMapping.vf_client_id;
      }

      // Créer la facture VF
      const result = await vfService.creerFacture(invoiceData);

      // Logger dans vf_invoice_logs
      db.prepare(`
        INSERT INTO vf_invoice_logs (vf_invoice_id, vf_invoice_number, client_name, mode, montant_ht, montant_ttc, meta)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(result.id || ''),
        result.number || '',
        order.partner_nom,
        'partner_order',
        order.total_ht,
        order.total_ttc,
        JSON.stringify({ orderId: order.id, canonicalClientName }),
      );

      // Mettre à jour la commande
      db.prepare(`
        UPDATE partner_orders
        SET statut = 'validee', vf_invoice_id = ?, vf_invoice_number = ?, validated_at = datetime('now')
        WHERE id = ?
      `).run(String(result.id || ''), result.number || '', order.id);

      // Email facture au partenaire
      if (sendEmail !== false && result.id && order.partner_email) {
        try {
          await vfService.envoyerEmail(result.id, {});
          db.prepare('UPDATE vf_invoice_logs SET email_sent = 1 WHERE vf_invoice_id = ?').run(String(result.id));
        } catch (emailErr) {
          logger.warn('Erreur envoi email facture partenaire', { error: emailErr.message });
        }
      }

      // Générer CSV logisticien
      let csv_base64 = null;
      if (generateCsv && shippingId) {
        try {
          const parsedAddr = parseAdresseExpedition(order.partner_adresse);
          const client = {
            name: order.partner_nom,
            recipient_name: order.partner_contact || order.partner_nom,
            street: parsedAddr.street,
            city: parsedAddr.city,
            zip: parsedAddr.zip,
            country: parsedAddr.country,
            email: order.partner_email || '',
            phone: order.partner_telephone || '',
          };
          const csvProducts = products.map(p => ({
            ref: p.ref,
            csv_ref: catalog[normalizeRef(p.ref)]?.csv_ref || p.ref,
            quantite: p.quantite || 1,
          }));
          const shippingNamesMap = getShippingNames();
          const csvContent = genererCSVLogisticien(
            { number: result.number || '', products: csvProducts, notes: order.notes || '' },
            client,
            shippingNamesMap,
            { shippingId }
          );
          csv_base64 = Buffer.from(csvContent, 'utf-8').toString('base64');
          db.prepare('UPDATE vf_invoice_logs SET csv_generated = 1 WHERE vf_invoice_id = ?').run(String(result.id));
        } catch (csvErr) {
          logger.warn('Erreur génération CSV commande partenaire', { error: csvErr.message });
        }
      }

      // Log Google Sheets
      if (logGSheets === false) {
        // Skip GSheets logging
      } else try {
        repairGSheetsCredentials();
        const gsheetsService = require('../services/googlesheetsService')(db);
        const spreadsheetId = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_spreadsheet_id'").get()?.valeur;
        const sheetName = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_sheet_name'").get()?.valeur || 'Log sold';

        if (spreadsheetId) {
          const gsProducts = products.map(p => ({
            ref: p.ref,
            quantity: p.quantite || 1,
            priceHT: p.prix_ht || catalog[normalizeRef(p.ref)]?.prix_ht || 0,
            csvRef: catalog[normalizeRef(p.ref)]?.csv_ref,
          }));

          const resolvedPartner = (canonicalClientName && canonicalClientName !== order.partner_nom) ? canonicalClientName : undefined;
          const gsResult = await gsheetsService.logInvoice(spreadsheetId, sheetName, {
            clientName: order.partner_nom,
            invoiceNumber: result.number || '',
            invoiceDate: today,
            products: gsProducts,
          }, resolvedPartner);

          if (gsResult.ok) {
            db.prepare('UPDATE vf_invoice_logs SET gsheet_logged = 1 WHERE vf_invoice_id = ?').run(String(result.id));
          }
        }
      } catch (gsErr) {
        logger.warn('Erreur log GSheets commande partenaire', { error: gsErr.message });
      }

      const response = {
        ok: true,
        order_id: order.id,
        vf_invoice_id: result.id,
        vf_invoice_number: result.number,
        message: `Commande validée — ${(documentType || 'vat') === 'proforma' ? 'proforma' : 'facture'} créée`,
      };
      if (csv_base64) response.csv_base64 = csv_base64;
      res.json(response);
    } catch (e) {
      logger.error('Erreur validation commande partenaire', { error: e.message, stack: e.stack });
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── CSV logisticien pour commande validée ───────────────────────────────
  router.post('/:id/csv', (req, res) => {
    try {
      const { shippingId } = req.body || {};
      if (!shippingId) return res.status(400).json({ erreur: 'shippingId requis' });

      const order = db.prepare(`
        SELECT po.*, vp.nom as partner_nom, vp.email as partner_email,
               vp.contact_nom as partner_contact, vp.adresse as partner_adresse,
               vp.telephone as partner_telephone
        FROM partner_orders po
        JOIN vf_partners vp ON vp.id = po.partner_id
        WHERE po.id = ?
      `).get(req.params.id);

      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });

      const products = JSON.parse(order.products || '[]');
      const catalog = getCatalogMap();
      const parsedAddr = parseAdresseExpedition(order.partner_adresse);
      const client = {
        name: order.partner_nom,
        recipient_name: order.partner_contact || order.partner_nom,
        street: parsedAddr.street,
        city: parsedAddr.city,
        zip: parsedAddr.zip,
        country: parsedAddr.country,
        email: order.partner_email || '',
        phone: order.partner_telephone || '',
      };
      const csvProducts = products.map(p => ({
        ref: p.ref,
        csv_ref: catalog[normalizeRef(p.ref)]?.csv_ref || p.ref,
        quantite: p.quantite || 1,
      }));
      const shippingNamesMap = getShippingNames();
      const csvContent = genererCSVLogisticien(
        { number: order.vf_invoice_number || '', products: csvProducts, notes: order.notes || '' },
        client,
        shippingNamesMap,
        { shippingId }
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="logisticien-${order.vf_invoice_number || order.id}.csv"`);
      res.send(csvContent);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── PDF pour commande validée (proxy via VF API) ───────────────────────────
  router.get('/:id/pdf', async (req, res) => {
    try {
      const order = db.prepare('SELECT vf_invoice_id, vf_invoice_number FROM partner_orders WHERE id = ?').get(req.params.id);
      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });
      if (!order.vf_invoice_id) return res.status(400).json({ erreur: 'Pas de facture associée' });

      const token = (db.prepare("SELECT valeur FROM config WHERE cle = 'vf_api_token'").get()?.valeur || process.env.VF_API_TOKEN || '').trim();
      if (!token) return res.status(500).json({ erreur: 'Token VosFactures non configuré' });

      const vfBase = process.env.VF_BASE_URL || 'https://terredemars.vosfactures.fr';
      const pdfUrl = `${vfBase}/invoices/${order.vf_invoice_id}.pdf?api_token=${token}`;
      const pdfRes = await fetch(pdfUrl);
      if (!pdfRes.ok) return res.status(pdfRes.status).json({ erreur: `VF PDF error: ${pdfRes.status}` });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="facture-${order.vf_invoice_number || order.vf_invoice_id}.pdf"`);
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Annuler commande ─────────────────────────────────────────────────────
  router.post('/:id/cancel', (req, res) => {
    try {
      const order = db.prepare('SELECT * FROM partner_orders WHERE id = ?').get(req.params.id);
      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });
      if (order.statut !== 'en_attente') return res.status(400).json({ erreur: 'Cette commande ne peut plus être annulée' });

      db.prepare("UPDATE partner_orders SET statut = 'annulee' WHERE id = ?").run(req.params.id);

      res.json({ ok: true, message: 'Commande annulée' });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
