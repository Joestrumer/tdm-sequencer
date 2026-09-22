/**
 * partnerOrders.js — Routes admin pour gérer les commandes partenaires
 */

const express = require('express');
const {
  normalizeRef, findVFProduct, calculerRemise, calculerFraisPort, genererCSVLogisticien, parseAdresseExpedition,
} = require('../services/productMatchingService');
const logger = require('../config/logger');
const hubspot = require('../services/hubspotService');

const DEFAULT_FRANCO_SEUIL = 800;

module.exports = (db) => {
  const router = express.Router();
  const vfServiceFactory = require('../services/vosfacturesService');
  const vfService = vfServiceFactory(db);

  // Middleware : injecter le vfService adapté au user si token perso
  router.use((req, res, next) => {
    req.vfService = (req.user && req.user.vf_api_token)
      ? vfServiceFactory(db, req.user.vf_api_token)
      : vfService;
    next();
  });

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

  function resolveCanonicalClientName(vfName, vfClientId) {
    if (!vfName && !vfClientId) return vfName;
    // Priorité 1 : lookup par vf_client_id (le plus fiable)
    if (vfClientId) {
      const partnerById = db.prepare('SELECT nom FROM vf_partners WHERE vf_client_id = ? AND actif = 1').get(String(vfClientId));
      if (partnerById && partnerById.nom) return partnerById.nom;
      const mappingById = db.prepare('SELECT file_name FROM vf_client_mappings WHERE vf_client_id = ? AND file_name IS NOT NULL LIMIT 1').get(String(vfClientId));
      if (mappingById && mappingById.file_name) return mappingById.file_name;
    }
    if (!vfName) return vfName;
    // Priorité 2 : lookup exact par vf_name
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
      const { statut, limit: qLimit, offset: qOffset } = req.query;
      let sql = `
        SELECT po.*, vp.nom as partner_nom, vp.email as partner_email, vp.contact_nom as partner_contact,
               vp.master_id, mp.email as master_email,
               vp.livraison_code_postal as partner_livraison_cp, vp.facturation_code_postal as partner_facturation_cp
        FROM partner_orders po
        JOIN vf_partners vp ON vp.id = po.partner_id
        LEFT JOIN vf_partners mp ON mp.id = vp.master_id
      `;
      const params = [];
      const conditions = [];
      if (statut) {
        if (statut === 'annulee') {
          conditions.push("po.statut IN ('annulee', 'annulee_client')");
        } else {
          conditions.push('po.statut = ?');
          params.push(statut);
        }
      }
      if (req.user.role !== 'admin') {
        conditions.push('po.validated_by = ?');
        params.push(req.user.id);
      }
      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY po.created_at DESC';

      // Pagination optionnelle
      const limit = Math.min(parseInt(qLimit) || 200, 500);
      const offset = parseInt(qOffset) || 0;
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);

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
      let countSql = 'SELECT statut, COUNT(*) as count FROM partner_orders';
      const countParams = [];
      if (req.user.role !== 'admin') {
        countSql += ' WHERE validated_by = ?';
        countParams.push(req.user.id);
      }
      countSql += ' GROUP BY statut';
      const counts = db.prepare(countSql).all(...countParams);
      const result = { en_attente: 0, validee: 0, annulee: 0, annulee_client: 0 };
      for (const c of counts) result[c.statut] = c.count;
      result.total = result.en_attente + result.validee + result.annulee + result.annulee_client;

      // Commandes en attente depuis > 3 jours
      let staleSql = "SELECT COUNT(*) as n FROM partner_orders WHERE statut = 'en_attente' AND created_at < datetime('now', '-3 days')";
      const staleParams = [];
      if (req.user.role !== 'admin') {
        staleSql += ' AND validated_by = ?';
        staleParams.push(req.user.id);
      }
      result.stale = db.prepare(staleSql).get(...staleParams).n;

      // Suivi expédition
      const roleFilter = req.user.role !== 'admin' ? ' AND validated_by = ?' : '';
      const roleParams = req.user.role !== 'admin' ? [req.user.id] : [];
      result.expedie = db.prepare(`SELECT COUNT(*) as n FROM partner_orders WHERE statut = 'validee' AND tracking_number IS NOT NULL AND delivered_at IS NULL${roleFilter}`).get(...roleParams).n;
      result.livre = db.prepare(`SELECT COUNT(*) as n FROM partner_orders WHERE statut = 'validee' AND delivered_at IS NOT NULL${roleFilter}`).get(...roleParams).n;

      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Promotions : liste ─────────────────────────────────────────────────────
  router.get('/promotions', (req, res) => {
    try {
      const promos = db.prepare('SELECT * FROM partner_promotions').all();
      res.json(promos);
    } catch (e) {
      logger.error('Erreur liste promotions', { error: e.message });
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Promotions : remplacement complet ────────────────────────────────────────
  router.post('/promotions', (req, res) => {
    try {
      const { items, promo_active, promo_title } = req.body;
      if (!Array.isArray(items)) return res.status(400).json({ erreur: 'items doit être un tableau' });

      // Validation
      const catalogMap = getCatalogMap();
      for (const item of items) {
        if (!item.ref || typeof item.ref !== 'string') {
          return res.status(400).json({ erreur: 'Chaque item doit avoir une ref' });
        }
        if (!catalogMap[item.ref]) {
          return res.status(400).json({ erreur: `Produit inconnu: ${item.ref}` });
        }
        const pct = parseFloat(item.discount_pct);
        if (isNaN(pct) || pct < 1 || pct > 99) {
          return res.status(400).json({ erreur: `discount_pct doit être entre 1 et 99 pour ${item.ref}` });
        }
      }

      // Remplacement complet dans une transaction (items + config)
      const upsert = db.prepare('INSERT INTO partner_promotions (ref, discount_pct) VALUES (?, ?) ON CONFLICT(ref) DO UPDATE SET discount_pct = excluded.discount_pct');
      const deleteAll = db.prepare('DELETE FROM partner_promotions');
      const upsertConfig = db.prepare("INSERT INTO config (cle, valeur, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, updated_at = excluded.updated_at");

      db.transaction(() => {
        deleteAll.run();
        for (const item of items) {
          upsert.run(item.ref, parseFloat(item.discount_pct));
        }
        // Sauvegarder config promo dans la même transaction
        if (promo_active !== undefined) {
          upsertConfig.run('promo_active', promo_active ? '1' : '0');
        }
        if (promo_title !== undefined) {
          upsertConfig.run('promo_title', String(promo_title));
        }
      })();

      res.json({ ok: true, count: items.length });
    } catch (e) {
      logger.error('Erreur sauvegarde promotions', { error: e.message });
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
      if (req.user.role !== 'admin' && order.validated_by !== req.user.id) {
        return res.status(403).json({ erreur: 'Accès non autorisé à cette commande' });
      }

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
      const { documentType, shippingId, sendEmail = true, logGSheets = true, generateCsv = false, createHubspotDeal = true, fraisOverride, discountOverride, productsOverride } = req.body || {};

      const order = db.prepare(`
        SELECT po.*, vp.nom as partner_nom, vp.nom_normalise, vp.email as partner_email,
               vp.contact_nom as partner_contact, vp.shipping_id as partner_shipping_id,
               vp.adresse as partner_adresse, vp.telephone as partner_telephone,
               vp.franco_seuil as partner_franco_seuil, vp.frais_port as partner_frais_port,
               vp.frais_exonere as partner_frais_exonere, vp.exonere_fp, vp.exonere_fe,
               vp.frais_expedition_ht as partner_frais_expedition_ht,
               vp.livraison_prenom, vp.livraison_nom, vp.livraison_telephone, vp.livraison_email,
               vp.vf_client_id as partner_vf_client_id
        FROM partner_orders po
        JOIN vf_partners vp ON vp.id = po.partner_id
        WHERE po.id = ?
      `).get(req.params.id);

      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });
      if (order.statut !== 'en_attente') return res.status(400).json({ erreur: 'Cette commande ne peut plus être validée' });

      const products = Array.isArray(productsOverride) && productsOverride.length > 0
        ? productsOverride
        : JSON.parse(order.products || '[]');
      // Validation des données avant création facture
      if (!products.length) return res.status(400).json({ erreur: 'Commande sans produits' });
      for (const p of products) {
        if (!p.ref) return res.status(400).json({ erreur: 'Produit sans référence' });
        if (!p.quantite || p.quantite < 1) return res.status(400).json({ erreur: `Quantité invalide pour ${p.ref}` });
      }
      if (order.total_ht < 0) return res.status(400).json({ erreur: 'Montant HT négatif' });

      const catalog = getCatalogMap();
      const productIdMappings = getCodeMappings('product_id');
      const productNameMappings = getCodeMappings('product_name');
      const codeMappings = getCodeMappings('code_alias');
      const forcedPrices = getCodeMappings('forced_price');

      // Résoudre le client VF
      const canonicalClientName = resolveCanonicalClientName(order.partner_nom, order.partner_vf_client_id) || order.nom_normalise;
      const discountsDb = getDiscountsForClient(canonicalClientName);
      // Pré-construire Map pour lookup O(1) au lieu de O(n) par produit
      const discountMap = new Map();
      for (const d of discountsDb) discountMap.set(normalizeRef(d.product_code), d.discount_pct);

      // Construire les positions
      const positions = [];
      let hasDiscount = false;

      for (const p of products) {
        const ref = normalizeRef(p.ref);
        const catEntry = catalog[ref];
        const qty = p.quantite || 1;
        const taxRate = p.tva || catEntry?.tva || 20;
        const priceHT = p.prix_ht || catEntry?.prix_ht || 0;

        let discount = (discountOverride != null && discountOverride >= 0) ? discountOverride : (p.discount_pct || 0);
        if (!discount && canonicalClientName) {
          discount = discountMap.get(ref) || 0;
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
          code: p.ref || vfProduct.vfRef || ref,
          tax: taxRate,
          quantity: qty,
          price_net: priceToUse.toFixed(2),
          total_price_gross: totalPriceGross.toFixed(2),
        };

        // Nom : laisser VF utiliser le nom du produit si product_id trouvé
        if (vfProduct.productId) {
          position.product_id = vfProduct.productId;
        } else {
          position.name = vfProduct.productName || p.nom || vfProduct.ref || ref;
        }
        if (discount > 0) position.discount_percent = discount;

        positions.push(position);
      }

      // Frais de port — override admin (tableau) ou logique portail partenaire
      const fraisPort = [];
      const globalExonere = order.partner_frais_exonere ?? 0;
      const exonereFP = globalExonere || (order.exonere_fp ?? 0);
      const exonereFE = globalExonere || (order.exonere_fe ?? 0);

      // fraisOverride: tableau [{ref, montant, tva, discount}] envoyé par l'admin
      // tableau vide = pas de frais, undefined = auto (logique portail)
      const fraisItems = [];

      if (Array.isArray(fraisOverride)) {
        // Override admin explicite — utiliser la liste telle quelle
        for (const f of fraisOverride) {
          if (f.ref && f.montant > 0) {
            fraisItems.push({ ref: f.ref, montant: f.montant, tva: f.tva || 20, discount: f.discount || 0 });
          }
        }
      } else {
        // Auto : même logique que le portail partenaire (partnerPortal.js POST /commande)
        const totalHTProducts = positions.reduce((s, p) => {
          const net = parseFloat(p.price_net);
          const disc = p.discount_percent || 0;
          return s + (net * (1 - disc / 100)) * p.quantity;
        }, 0);
        const francoSeuil = order.partner_franco_seuil || DEFAULT_FRANCO_SEUIL;
        const fpCatalog = catalog['FP'];
        const feCatalog = catalog['FE'];

        if (totalHTProducts >= francoSeuil) {
          if (!exonereFP) {
            fraisItems.push({ ref: 'FP', montant: fpCatalog?.prix_ht || 25, tva: 20, discount: 0 });
          }
        } else {
          if (!exonereFE) {
            const feMontant = (order.partner_frais_expedition_ht != null)
              ? order.partner_frais_expedition_ht
              : (feCatalog?.prix_ht || 80);
            fraisItems.push({ ref: 'FE', montant: feMontant, tva: 20, discount: 0 });
          }
        }
      }

      for (const fi of fraisItems) {
        // total_price_gross AVANT remise (comme pour les produits) — VF applique discount_percent
        const fpGross = roundPrice(fi.montant * (1 + fi.tva / 100));
        const vfProduct = findVFProduct(fi.ref, fi.montant, catalog, codeMappings, productIdMappings, productNameMappings);

        const fpPosition = {
          code: fi.ref,
          price_net: Number(fi.montant).toFixed(2),
          total_price_gross: Number(fpGross).toFixed(2),
          tax: fi.tva,
          quantity: 1,
        };
        // Nom : laisser VF utiliser le nom du produit si product_id trouvé
        if (vfProduct.productId) {
          fpPosition.product_id = vfProduct.productId;
        } else {
          fpPosition.name = vfProduct.productName || (fi.ref === 'FP' ? 'FRAIS DE PREPARATION' : "FRAIS D'EXPEDITION");
        }
        if (fi.discount > 0) fpPosition.discount_percent = fi.discount;
        positions.push(fpPosition);
        fraisPort.push({ ref: fi.ref, nom: fpPosition.name || (fi.ref === 'FP' ? 'FRAIS DE PREPARATION' : "FRAIS D'EXPEDITION"), prix_ht: fi.montant, quantite: 1, tva: fi.tva, discount: fi.discount || 0 });
      }

      // Résoudre le client VF pour la facture
      const clientMapping = db.prepare('SELECT * FROM vf_client_mappings WHERE file_name = ? OR vf_name = ?')
        .get(canonicalClientName, order.partner_nom);

      const today = new Date().toISOString().split('T')[0];
      const paymentTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Parser l'adresse du partenaire pour les champs VF
      const parsedAddr = parseAdresseExpedition(order.partner_adresse, order.partner_nom);

      const invoiceData = {
        kind: documentType || 'vat',
        number: null,
        sell_date: today,
        issue_date: today,
        payment_to: paymentTo,
        department_id: parseInt(process.env.VF_DEPARTMENT_ID) || 1553025,
        buyer_name: order.partner_nom,
        buyer_email: order.partner_email || '',
        buyer_street: parsedAddr.street || '',
        buyer_city: parsedAddr.city || '',
        buyer_post_code: parsedAddr.zip || '',
        buyer_country: parsedAddr.country || 'FR',
        buyer_phone: order.partner_telephone || '',
        show_discount: hasDiscount,
        discount_kind: hasDiscount ? 'percent_unit' : null,
        positions,
      };

      // Prioriser vf_partners.vf_client_id (source de vérité admin) sur vf_client_mappings
      const resolvedVfClientId = order.partner_vf_client_id || clientMapping?.vf_client_id;
      if (resolvedVfClientId) {
        invoiceData.client_id = resolvedVfClientId;
      }

      // Créer la facture VF
      let result;
      try {
        result = await req.vfService.creerFacture(invoiceData);
      } catch (vfErr) {
        logger.error('Échec création facture VF — commande reste en_attente', { orderId: order.id, partnerId: order.partner_id, error: vfErr.message });
        return res.status(502).json({ erreur: `Erreur VosFactures : ${vfErr.message}. La commande reste en attente.` });
      }

      if (!result || !result.id) {
        logger.error('Facture VF créée sans ID — commande reste en_attente', { orderId: order.id, result });
        return res.status(502).json({ erreur: 'VosFactures n\'a pas retourné d\'ID de facture. La commande reste en attente.' });
      }

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
        JSON.stringify({ orderId: order.id, canonicalClientName, validatedBy: req.user.id }),
      );

      // Mettre à jour la commande — sauvegarder les produits + frais (avec discount) dans products
      const updatedProducts = Array.isArray(productsOverride) && productsOverride.length > 0 ? [...productsOverride] : [...JSON.parse(order.products || '[]')];
      // Ajouter les frais comme lignes produit pour l'affichage futur
      for (const fi of fraisItems) {
        const netHT = fi.montant * (1 - (fi.discount || 0) / 100);
        updatedProducts.push({
          ref: fi.ref,
          nom: fi.ref === 'FP' ? 'FRAIS PREPARATION' : 'FRAIS EXPEDITION',
          quantite: 1, prix_ht: fi.montant, tva: fi.tva, discount_pct: fi.discount || 0,
          total_ht: Math.round(netHT * 100) / 100,
          total_ttc: Math.round(netHT * (1 + fi.tva / 100) * 100) / 100,
        });
      }
      // positions inclut déjà produits + frais
      const updatedTotalHT = positions.reduce((s, p) => {
        const net = parseFloat(p.price_net);
        const disc = p.discount_percent || 0;
        return s + (net * (1 - disc / 100)) * p.quantity;
      }, 0);
      db.prepare(`
        UPDATE partner_orders
        SET statut = 'validee', vf_invoice_id = ?, vf_invoice_number = ?, validated_at = datetime('now'), validated_by = ?,
            products = ?, total_ht = ?
        WHERE id = ?
      `).run(String(result.id || ''), result.number || '', req.user.id, JSON.stringify(updatedProducts), Math.round(updatedTotalHT * 100) / 100, order.id);

      // Audit trail
      db.prepare('INSERT INTO partner_orders_audit (order_id, user_id, action, after_data) VALUES (?, ?, ?, ?)')
        .run(order.id, req.user.id, 'validated', JSON.stringify({ vf_invoice_id: result.id, vf_invoice_number: result.number, documentType }));

      logger.info('Commande partenaire validée', {
        orderId: order.id, partnerId: order.partner_id, partnerNom: order.partner_nom,
        userId: req.user.id, vfInvoiceNumber: result.number, montantHT: order.total_ht,
        montantTTC: order.total_ttc, documentType: documentType || 'vat',
      });

      // Email facture au partenaire
      if (sendEmail !== false && result.id && order.partner_email) {
        try {
          await req.vfService.envoyerEmail(result.id, {});
          db.prepare('UPDATE vf_invoice_logs SET email_sent = 1 WHERE vf_invoice_id = ?').run(String(result.id));
        } catch (emailErr) {
          logger.warn('Erreur envoi email facture partenaire', { error: emailErr.message });
        }
      }

      // Générer CSV logisticien
      let csv_base64 = null;
      if (generateCsv && shippingId) {
        try {
          const parsedAddr = parseAdresseExpedition(order.partner_adresse, order.partner_nom);
          const livraisonNom = [order.livraison_prenom, order.livraison_nom].filter(Boolean).join(' ');
          const client = {
            name: order.partner_nom,
            recipient_name: livraisonNom || order.partner_contact || order.partner_nom,
            street: parsedAddr.street,
            city: parsedAddr.city,
            zip: parsedAddr.zip,
            country: parsedAddr.country,
            email: order.livraison_email || order.partner_email || '',
            phone: order.livraison_telephone || order.partner_telephone || '',
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
      let gsOrderNumber = null;
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

          // Ajouter frais de port (FP/FE) au log GSheets
          for (const f of fraisPort) {
            gsProducts.push({
              ref: f.ref,
              quantity: f.quantite || 1,
              priceHT: f.prix_ht,
            });
          }

          // Ne passer le nom canonique que s'il diffère du nom VF (mapping réel trouvé)
          // Sinon laisser logInvoice résoudre via mapPartnerNameToCanon avec les noms du spreadsheet
          const resolvedPartner = (canonicalClientName && canonicalClientName !== order.partner_nom) ? canonicalClientName : undefined;
          const gsResult = await gsheetsService.logInvoice(spreadsheetId, sheetName, {
            clientName: order.partner_nom,
            clientId: order.partner_vf_client_id,
            invoiceNumber: result.number || '',
            invoiceDate: today,
            products: gsProducts,
          }, resolvedPartner);

          if (gsResult.ok) {
            db.prepare('UPDATE vf_invoice_logs SET gsheet_logged = 1 WHERE vf_invoice_id = ?').run(String(result.id));
            gsOrderNumber = gsResult.orderNumber;
          }
        }
      } catch (gsErr) {
        logger.warn('Erreur log GSheets commande partenaire', { error: gsErr.message });
      }

      // Créer deal HubSpot si demandé
      let hubspot_deal_id = null;
      if (createHubspotDeal !== false) try {
        hubspot_deal_id = await hubspot.creerDealFromInvoice(db, {
          clientName: order.partner_nom,
          clientEmail: order.partner_email || '',
          vfClientName: order.partner_nom,
          vfClientId: clientMapping?.vf_client_id,
          montantHT: (parseFloat(order.total_ht) || 0) + fraisPort.reduce((s, f) => s + (f.prix_ht || 0) * (f.quantite || 1), 0),
          montantTTC: (parseFloat(order.total_ttc) || 0) + fraisPort.reduce((s, f) => s + (f.prix_ht || 0) * (f.quantite || 1) * 1.2, 0),
          orderNumber: gsOrderNumber != null ? String(gsOrderNumber) : '',
          invoiceNumber: result.number || '',
          closeDate: new Date().toISOString().split('T')[0],
        });
      } catch (hsErr) {
        logger.warn('Erreur deal HubSpot commande partenaire', { error: hsErr.message });
      }

      const response = {
        ok: true,
        order_id: order.id,
        vf_invoice_id: result.id,
        vf_invoice_number: result.number,
        hubspot_deal_id,
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
               vp.telephone as partner_telephone,
               vp.livraison_prenom, vp.livraison_nom, vp.livraison_telephone, vp.livraison_email
        FROM partner_orders po
        JOIN vf_partners vp ON vp.id = po.partner_id
        WHERE po.id = ?
      `).get(req.params.id);

      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });

      const products = JSON.parse(order.products || '[]');
      const catalog = getCatalogMap();
      const parsedAddr = parseAdresseExpedition(order.partner_adresse, order.partner_nom);
      const livraisonNom = [order.livraison_prenom, order.livraison_nom].filter(Boolean).join(' ');
      const client = {
        name: order.partner_nom,
        recipient_name: livraisonNom || order.partner_contact || order.partner_nom,
        street: parsedAddr.street,
        city: parsedAddr.city,
        zip: parsedAddr.zip,
        country: parsedAddr.country,
        email: order.livraison_email || order.partner_email || '',
        phone: order.livraison_telephone || order.partner_telephone || '',
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

  // ─── CSV groupé pour plusieurs commandes validées ───────────────────────────
  router.post('/batch-csv', (req, res) => {
    try {
      const { orderIds, shippingId } = req.body || {};
      if (!shippingId) return res.status(400).json({ erreur: 'shippingId requis' });
      if (!Array.isArray(orderIds) || orderIds.length === 0) return res.status(400).json({ erreur: 'orderIds requis (tableau non vide)' });

      const catalog = getCatalogMap();
      const shippingNamesMap = getShippingNames();
      const allLines = [];
      let headerLine = null;

      for (const orderId of orderIds) {
        const order = db.prepare(`
          SELECT po.*, vp.nom as partner_nom, vp.email as partner_email,
                 vp.contact_nom as partner_contact, vp.adresse as partner_adresse,
                 vp.telephone as partner_telephone,
                 vp.livraison_prenom, vp.livraison_nom, vp.livraison_telephone, vp.livraison_email
          FROM partner_orders po
          JOIN vf_partners vp ON vp.id = po.partner_id
          WHERE po.id = ? AND po.statut = 'validee'
        `).get(orderId);

        if (!order) continue;

        const products = JSON.parse(order.products || '[]');
        const parsedAddr = parseAdresseExpedition(order.partner_adresse, order.partner_nom);
        const livraisonNom = [order.livraison_prenom, order.livraison_nom].filter(Boolean).join(' ');
        const client = {
          name: order.partner_nom,
          recipient_name: livraisonNom || order.partner_contact || order.partner_nom,
          street: parsedAddr.street,
          city: parsedAddr.city,
          zip: parsedAddr.zip,
          country: parsedAddr.country,
          email: order.livraison_email || order.partner_email || '',
          phone: order.livraison_telephone || order.partner_telephone || '',
        };
        const csvProducts = products.map(p => ({
          ref: p.ref,
          csv_ref: catalog[normalizeRef(p.ref)]?.csv_ref || p.ref,
          quantite: p.quantite || 1,
        }));

        const csvContent = genererCSVLogisticien(
          { number: order.vf_invoice_number || '', products: csvProducts, notes: order.notes || '' },
          client,
          shippingNamesMap,
          { shippingId }
        );

        // Séparer header et lignes de données (enlever BOM)
        const raw = csvContent.replace(/^\uFEFF/, '');
        const lines = raw.split('\n');
        if (!headerLine && lines.length > 0) headerLine = lines[0];
        // Ajouter les lignes de données (skip header)
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim()) allLines.push(lines[i]);
        }
      }

      if (allLines.length === 0) return res.status(400).json({ erreur: 'Aucune donnée CSV générée' });

      const finalCsv = '\uFEFF' + headerLine + '\n' + allLines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="logisticien-batch-${orderIds.length}-commandes.csv"`);
      res.send(finalCsv);
    } catch (e) {
      logger.error('Erreur batch CSV', { error: e.message, stack: e.stack });
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Valider plusieurs commandes en lot ─────────────────────────────────
  router.post('/batch-validate', async (req, res) => {
    try {
      const { orderIds, options } = req.body;
      if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ erreur: 'Liste de commandes requise' });
      }

      const results = [];
      for (const id of orderIds) {
        try {
          const order = db.prepare(`
            SELECT po.*, vp.nom as partner_nom, vp.email as partner_email, vp.contact_nom as partner_contact,
                   vp.master_id,
                   mp.email as master_email, mp.nom as master_nom
            FROM partner_orders po
            JOIN vf_partners vp ON vp.id = po.partner_id
            LEFT JOIN vf_partners mp ON mp.id = vp.master_id
            WHERE po.id = ?
          `).get(id);
          if (!order) { results.push({ id, ok: false, erreur: 'Commande introuvable' }); continue; }
          if (order.statut !== 'en_attente') { results.push({ id, ok: false, erreur: 'Statut non en_attente' }); continue; }

          const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
          const token = req.headers.authorization;
          const validateRes = await fetch(`${baseUrl}/api/partner-orders/${id}/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify(options || {}),
          });
          const data = await validateRes.json();
          results.push({
            id, ok: validateRes.ok, ...data,
            partner_nom: order.partner_nom,
            partner_email: order.partner_email,
            master_id: order.master_id || null,
            master_email: order.master_email || null,
            master_nom: order.master_nom || null,
          });
        } catch (e) {
          results.push({ id, ok: false, erreur: e.message });
        }
      }

      const success = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok).length;
      res.json({ ok: true, results, summary: { success, failed, total: orderIds.length } });
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

  // ─── Modifier les produits d'une commande en attente ──────────────────────
  router.patch('/:id/products', (req, res) => {
    try {
      const order = db.prepare('SELECT * FROM partner_orders WHERE id = ?').get(req.params.id);
      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });
      if (order.statut !== 'en_attente') return res.status(400).json({ erreur: 'Seules les commandes en attente peuvent être modifiées' });

      const { products } = req.body;
      if (!Array.isArray(products)) return res.status(400).json({ erreur: 'products doit être un tableau' });

      // Audit trail — avant modification
      const beforeData = { products: JSON.parse(order.products || '[]'), total_ht: order.total_ht, total_ttc: order.total_ttc };

      // Recalculer les totaux
      let totalHT = 0;
      let totalTTC = 0;
      for (const p of products) {
        totalHT += p.total_ht || 0;
        totalTTC += p.total_ttc || 0;
      }
      totalHT = Math.round(totalHT * 100) / 100;
      totalTTC = Math.round(totalTTC * 100) / 100;

      db.prepare('UPDATE partner_orders SET products = ?, total_ht = ?, total_ttc = ? WHERE id = ?')
        .run(JSON.stringify(products), totalHT, totalTTC, req.params.id);

      // Audit trail — après modification
      db.prepare('INSERT INTO partner_orders_audit (order_id, user_id, action, before_data, after_data) VALUES (?, ?, ?, ?, ?)')
        .run(req.params.id, req.user?.id || null, 'products_modified', JSON.stringify(beforeData), JSON.stringify({ products, total_ht: totalHT, total_ttc: totalTTC }));

      const updated = db.prepare(`
        SELECT po.*, vp.nom as partner_nom, vp.email as partner_email, vp.contact_nom as partner_contact
        FROM partner_orders po
        JOIN vf_partners vp ON vp.id = po.partner_id
        WHERE po.id = ?
      `).get(req.params.id);

      res.json({ ...updated, products: JSON.parse(updated.products || '[]') });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Mettre à jour le suivi expédition ────────────────────────────────────
  router.patch('/:id/tracking', (req, res) => {
    try {
      const order = db.prepare('SELECT * FROM partner_orders WHERE id = ?').get(req.params.id);
      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });
      if (order.statut !== 'validee') return res.status(400).json({ erreur: 'Seules les commandes validées peuvent avoir un suivi' });

      const { tracking_number, carrier_name } = req.body;
      const trackingClean = (tracking_number || '').trim() || null;
      const carrierClean = (carrier_name || '').trim() || null;

      // Auto-détecter le transporteur si non fourni
      let carrier = carrierClean;
      if (trackingClean && !carrier) {
        const carrierTracking = require('../services/carrierTrackingService');
        if (carrierTracking.detectCarrier) {
          carrier = carrierTracking.detectCarrier(trackingClean);
        }
      }

      const shippedAt = trackingClean && !order.shipped_at ? new Date().toISOString() : order.shipped_at;

      db.prepare(`
        UPDATE partner_orders
        SET tracking_number = ?, carrier_name = ?, shipped_at = COALESCE(?, shipped_at)
        WHERE id = ?
      `).run(trackingClean, carrier, shippedAt, req.params.id);

      // Audit trail
      db.prepare('INSERT INTO partner_orders_audit (order_id, user_id, action, before_data, after_data) VALUES (?, ?, ?, ?, ?)')
        .run(req.params.id, req.user?.id || null, 'tracking_updated',
          JSON.stringify({ tracking_number: order.tracking_number, carrier_name: order.carrier_name }),
          JSON.stringify({ tracking_number: trackingClean, carrier_name: carrier }));

      const updated = db.prepare('SELECT * FROM partner_orders WHERE id = ?').get(req.params.id);
      res.json({ ok: true, order: { ...updated, products: JSON.parse(updated.products || '[]') } });
    } catch (e) {
      logger.error('Erreur mise à jour tracking', { error: e.message, orderId: req.params.id });
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

      // Audit trail
      db.prepare('INSERT INTO partner_orders_audit (order_id, user_id, action) VALUES (?, ?, ?)')
        .run(req.params.id, req.user?.id || null, 'cancelled_admin');

      res.json({ ok: true, message: 'Commande annulée' });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Supprimer définitivement une commande (admin) ───────────────────────
  router.delete('/:id', (req, res) => {
    try {
      const order = db.prepare('SELECT * FROM partner_orders WHERE id = ?').get(req.params.id);
      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });

      // Audit trail avant suppression
      db.prepare('INSERT INTO partner_orders_audit (order_id, user_id, action) VALUES (?, ?, ?)')
        .run(req.params.id, req.user?.id || null, 'deleted_admin');

      db.prepare('DELETE FROM partner_orders WHERE id = ?').run(req.params.id);

      res.json({ ok: true, message: 'Commande supprimée' });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
