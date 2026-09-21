/**
 * referenceData.js — CRUD catalogues, partenaires, remises, mappings
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('../config/logger');

module.exports = (db) => {
  const router = express.Router();

  // Transforme un lien Google Drive en URL image directe
  function transformGoogleDriveUrl(url) {
    if (!url) return url;
    // https://drive.google.com/file/d/FILE_ID/view...
    const fileMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (fileMatch) return `https://lh3.googleusercontent.com/d/${fileMatch[1]}`;
    // https://drive.google.com/open?id=FILE_ID
    const openMatch = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
    if (openMatch) return `https://lh3.googleusercontent.com/d/${openMatch[1]}`;
    // https://drive.google.com/uc?id=FILE_ID&...
    const ucMatch = url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/);
    if (ucMatch) return `https://lh3.googleusercontent.com/d/${ucMatch[1]}`;
    return url;
  }

  // ─── Catalogue ────────────────────────────────────────────────────────────

  router.get('/catalog', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM vf_catalog WHERE actif = 1 ORDER BY sort_order, ref').all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/catalog', (req, res) => {
    try {
      const { ref, vf_product_id, nom, prix_ht, tva, csv_ref, vf_ref, actif, image_url } = req.body;
      const cleanImageUrl = transformGoogleDriveUrl(image_url);
      db.prepare(`
        INSERT INTO vf_catalog (ref, vf_product_id, nom, prix_ht, tva, csv_ref, vf_ref, actif, image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ref) DO UPDATE SET
          vf_product_id = excluded.vf_product_id, nom = excluded.nom,
          prix_ht = excluded.prix_ht, tva = excluded.tva,
          csv_ref = excluded.csv_ref, vf_ref = excluded.vf_ref,
          actif = excluded.actif, image_url = excluded.image_url
      `).run(ref, vf_product_id || null, nom, prix_ht, tva || 20, csv_ref || null, vf_ref || null, actif ?? 1, cleanImageUrl || null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Mise à jour batch des catégories (drag & drop)
  router.patch('/catalog/batch-categorie', (req, res) => {
    try {
      const { updates } = req.body;
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ erreur: 'updates[] requis' });
      }
      const stmt = db.prepare('UPDATE vf_catalog SET categorie = ? WHERE ref = ?');
      const run = db.transaction((items) => {
        let count = 0;
        for (const { ref, categorie } of items) {
          const r = stmt.run(categorie || null, ref);
          count += r.changes;
        }
        return count;
      });
      const count = run(updates);
      res.json({ ok: true, updated: count });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Mise à jour de l'ordre des produits dans une catégorie (drag & drop)
  router.patch('/catalog/batch-order', (req, res) => {
    try {
      const { updates } = req.body;
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ erreur: 'updates[] requis' });
      }
      const stmt = db.prepare('UPDATE vf_catalog SET sort_order = ?, categorie = ? WHERE ref = ?');
      const run = db.transaction((items) => {
        for (const { ref, sort_order, categorie } of items) {
          stmt.run(sort_order, categorie || null, ref);
        }
      });
      run(updates);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Récupérer un produit VosFactures par ID (pour auto-remplir le nom)
  router.get('/catalog/vf-product/:id', async (req, res) => {
    try {
      const vfService = require('../services/vosfacturesService')(db);
      const data = await vfService.getAllProducts(false);
      const product = data.find(p => String(p.id) === String(req.params.id));
      if (!product) return res.status(404).json({ erreur: 'Produit VosFactures non trouvé' });
      res.json({ id: product.id, name: product.name, code: product.code });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Synchroniser les noms de tous les produits qui ont un vf_product_id
  router.post('/catalog/sync-vf-names', async (req, res) => {
    try {
      const vfService = require('../services/vosfacturesService')(db);
      const vfProducts = await vfService.getAllProducts(true);
      const vfMap = {};
      for (const p of vfProducts) vfMap[String(p.id)] = p.name;

      const catalogProducts = db.prepare('SELECT ref, vf_product_id, nom FROM vf_catalog WHERE vf_product_id IS NOT NULL AND vf_product_id != \'\'').all();
      const stmt = db.prepare('UPDATE vf_catalog SET nom = ? WHERE ref = ?');
      let updated = 0;
      const details = [];
      for (const p of catalogProducts) {
        const vfName = vfMap[String(p.vf_product_id)];
        if (vfName && vfName !== p.nom) {
          stmt.run(vfName, p.ref);
          details.push({ ref: p.ref, ancien: p.nom, nouveau: vfName });
          updated++;
        }
      }
      res.json({ ok: true, total: catalogProducts.length, updated, details });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Auto-matcher les produits du catalogue avec les produits VosFactures
  router.post('/catalog/auto-match-vf', async (req, res) => {
    try {
      const { dryRun, selections } = req.body || {};
      const vfService = require('../services/vosfacturesService')(db);
      const vfProducts = await vfService.getAllProducts(true);

      // Indexer les produits VF par code normalisé
      // Un même code peut avoir plusieurs produits VF (ex: P037 500ml vs P037-5000 5L)
      const vfByCode = {};
      for (const vf of vfProducts) {
        const code = (vf.code || '').trim().toUpperCase().replace(/\s+/g, '');
        if (!code) continue;
        if (!vfByCode[code]) vfByCode[code] = [];
        vfByCode[code].push(vf);
      }

      // Produits du catalogue sans vf_product_id
      const unmatched = db.prepare("SELECT ref, nom, prix_ht FROM vf_catalog WHERE actif = 1 AND (vf_product_id IS NULL OR vf_product_id = '')").all();

      const matches = [];
      const stmt = db.prepare('UPDATE vf_catalog SET vf_product_id = ?, nom = ? WHERE ref = ?');

      for (const p of unmatched) {
        const ref = p.ref.toUpperCase().replace(/\s+/g, '');
        const candidates = vfByCode[ref] || [];

        if (candidates.length === 0) {
          matches.push({ ref: p.ref, status: 'no_match', vf_id: null, vf_name: null, score: 0 });
          continue;
        }

        // Scorer chaque candidat
        const scored = candidates.map(vf => {
          let score = 0;
          // Score prix : plus le prix VF est proche du prix catalogue, mieux c'est
          const vfPrice = parseFloat(vf.price_net) || 0;
          const catPrice = p.prix_ht || 0;
          if (catPrice > 0 && vfPrice > 0) {
            const ratio = Math.min(vfPrice, catPrice) / Math.max(vfPrice, catPrice);
            score += ratio * 50; // max 50 points pour prix identique
          }
          // Score quantité vendue : plus il y a de quantité, plus c'est probablement le bon
          const qty = parseFloat(vf.quantity) || 0;
          score += Math.min(qty, 500) / 10; // max 50 points pour 500+ vendus
          return { vf, score };
        });

        // Trier par score décroissant
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];

        const matchInfo = {
          ref: p.ref,
          status: 'matched',
          vf_id: String(best.vf.id),
          vf_name: best.vf.name,
          vf_code: best.vf.code,
          vf_price: best.vf.price_net,
          cat_price: p.prix_ht,
          score: Math.round(best.score),
          alternatives: scored.length > 1 ? scored.slice(1).map(s => ({ id: s.vf.id, name: s.vf.name, price: s.vf.price_net, score: Math.round(s.score) })) : [],
        };
        matches.push(matchInfo);

      }

      // Mode application : on utilise les sélections du frontend
      if (!dryRun && Array.isArray(selections)) {
        // selections = [{ ref, vf_id, vf_name }]
        // Construire un index des produits VF par ID pour résoudre le nom
        const vfById = {};
        for (const vf of vfProducts) vfById[String(vf.id)] = vf;

        let applied = 0;
        for (const sel of selections) {
          const vf = vfById[String(sel.vf_id)];
          const name = vf ? vf.name : sel.vf_name;
          stmt.run(String(sel.vf_id), name, sel.ref);
          applied++;
        }
        return res.json({ ok: true, applied });
      }

      const matched = matches.filter(m => m.status === 'matched').length;
      const noMatch = matches.filter(m => m.status === 'no_match').length;
      res.json({ ok: true, total: unmatched.length, matched, noMatch, dryRun: true, matches });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.patch('/catalog/:ref', (req, res) => {
    try {
      const updates = [];
      const params = [];
      const allowedFields = ['nom', 'prix_ht', 'csv_ref', 'vf_ref', 'moq', 'categorie', 'tva', 'vf_product_id', 'image_url'];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = ?`);
          params.push(field === 'image_url' ? transformGoogleDriveUrl(req.body[field]) : req.body[field]);
        }
      }
      if (updates.length === 0) return res.status(400).json({ erreur: 'Aucun champ à mettre à jour' });
      params.push(req.params.ref);
      db.prepare(`UPDATE vf_catalog SET ${updates.join(', ')} WHERE ref = ?`).run(...params);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/catalog/:ref', (req, res) => {
    try {
      db.prepare('UPDATE vf_catalog SET actif = 0 WHERE ref = ?').run(req.params.ref);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Stats partenaire ────────────────────────────────────────────────────

  router.get('/partners/:id/stats', (req, res) => {
    try {
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total_commandes,
          SUM(CASE WHEN statut = 'validee' THEN 1 ELSE 0 END) as commandes_validees,
          SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) as commandes_en_attente,
          ROUND(SUM(CASE WHEN statut = 'validee' THEN total_ht ELSE 0 END), 2) as ca_total_ht,
          ROUND(SUM(CASE WHEN statut = 'validee' THEN total_ttc ELSE 0 END), 2) as ca_total_ttc,
          ROUND(AVG(CASE WHEN statut = 'validee' THEN total_ht END), 2) as panier_moyen_ht,
          MAX(created_at) as derniere_commande,
          MIN(created_at) as premiere_commande
        FROM partner_orders WHERE partner_id = ?
      `).get(req.params.id);
      res.json(stats || {});
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Partenaires ──────────────────────────────────────────────────────────

  router.get('/partners', (req, res) => {
    try {
      const { all } = req.query;
      const rows = all === '1'
        ? db.prepare('SELECT id, nom, nom_normalise, actif, email, contact_nom, telephone, adresse, shipping_id, vf_client_id, password_hash IS NOT NULL as has_password, password_plain, amenities, franco_seuil, frais_port, vf_display_name, is_canonical, livraison_prenom, livraison_nom, livraison_telephone, livraison_email, facturation_prenom, facturation_nom, facturation_telephone, facturation_email, promo_enabled, facturation_rue, facturation_code_postal, facturation_ville, facturation_pays, facturation_tva, facturation_entite_publique, facturation_portable, livraison_rue, livraison_code_postal, livraison_ville, livraison_pays, livraison_portable, is_master, master_id, frais_exonere, exonere_fp, exonere_fe, frais_expedition_ht FROM vf_partners ORDER BY nom').all()
        : db.prepare('SELECT id, nom, nom_normalise, actif, email, contact_nom, telephone, adresse, shipping_id, vf_client_id, password_hash IS NOT NULL as has_password, password_plain, amenities, franco_seuil, frais_port, vf_display_name, is_canonical, livraison_prenom, livraison_nom, livraison_telephone, livraison_email, facturation_prenom, facturation_nom, facturation_telephone, facturation_email, promo_enabled, facturation_rue, facturation_code_postal, facturation_ville, facturation_pays, facturation_tva, facturation_entite_publique, facturation_portable, livraison_rue, livraison_code_postal, livraison_ville, livraison_pays, livraison_portable, is_master, master_id FROM vf_partners WHERE actif = 1 ORDER BY nom').all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/partners', (req, res) => {
    try {
      const { nom, nom_normalise, is_canonical } = req.body;
      db.prepare(`
        INSERT INTO vf_partners (nom, nom_normalise, is_canonical)
        VALUES (?, ?, ?)
        ON CONFLICT(nom) DO UPDATE SET nom_normalise = excluded.nom_normalise, is_canonical = COALESCE(excluded.is_canonical, vf_partners.is_canonical)
      `).run(nom, nom_normalise || nom.toLowerCase(), is_canonical ? 1 : 0);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Mettre à jour les champs d'un partenaire
  router.patch('/partners/:id', async (req, res) => {
    try {
      const { email, contact_nom, telephone, adresse, shipping_id, actif } = req.body;
      const updates = [];
      const params = [];

      if (email !== undefined) { updates.push('email = ?'); params.push(email); }
      if (contact_nom !== undefined) { updates.push('contact_nom = ?'); params.push(contact_nom); }
      if (telephone !== undefined) { updates.push('telephone = ?'); params.push(telephone); }
      if (adresse !== undefined) { updates.push('adresse = ?'); params.push(adresse); }
      if (shipping_id !== undefined) { updates.push('shipping_id = ?'); params.push(shipping_id); }
      if (actif !== undefined) { updates.push('actif = ?'); params.push(actif ? 1 : 0); }
      if (req.body.amenities !== undefined) { updates.push('amenities = ?'); params.push(req.body.amenities); }
      if (req.body.franco_seuil !== undefined) { updates.push('franco_seuil = ?'); params.push(req.body.franco_seuil); }
      if (req.body.frais_port !== undefined) { updates.push('frais_port = ?'); params.push(req.body.frais_port); }
      if (req.body.frais_exonere !== undefined) { updates.push('frais_exonere = ?'); params.push(req.body.frais_exonere ? 1 : 0); }
      if (req.body.exonere_fp !== undefined) { updates.push('exonere_fp = ?'); params.push(req.body.exonere_fp ? 1 : 0); }
      if (req.body.exonere_fe !== undefined) { updates.push('exonere_fe = ?'); params.push(req.body.exonere_fe ? 1 : 0); }
      if (req.body.frais_expedition_ht !== undefined) { updates.push('frais_expedition_ht = ?'); params.push(req.body.frais_expedition_ht === null || req.body.frais_expedition_ht === '' ? null : parseFloat(req.body.frais_expedition_ht)); }
      if (req.body.promo_enabled !== undefined) { updates.push('promo_enabled = ?'); params.push(req.body.promo_enabled ? 1 : 0); }
      if (req.body.vf_display_name !== undefined) { updates.push('vf_display_name = ?'); params.push(req.body.vf_display_name || null); }
      if (req.body.is_canonical !== undefined) { updates.push('is_canonical = ?'); params.push(req.body.is_canonical ? 1 : 0); }
      if (req.body.is_master !== undefined) { updates.push('is_master = ?'); params.push(req.body.is_master ? 1 : 0); }
      for (const f of ['livraison_prenom','livraison_nom','livraison_telephone','livraison_email','facturation_prenom','facturation_nom','facturation_telephone','facturation_email','facturation_rue','facturation_code_postal','facturation_ville','facturation_pays','facturation_tva','facturation_entite_publique','facturation_portable','livraison_rue','livraison_code_postal','livraison_ville','livraison_pays','livraison_portable']) {
        if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] || null); }
      }

      if (updates.length === 0) return res.status(400).json({ erreur: 'Aucun champ à mettre à jour' });

      params.push(req.params.id);
      db.prepare(`UPDATE vf_partners SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      // Si vf_display_name est mis à jour, synchroniser vf_client_mappings
      if (req.body.vf_display_name) {
        const partner = db.prepare('SELECT nom FROM vf_partners WHERE id = ?').get(req.params.id);
        if (partner) {
          const existing = db.prepare('SELECT id FROM vf_client_mappings WHERE vf_name = ?').get(req.body.vf_display_name);
          if (existing) {
            db.prepare('UPDATE vf_client_mappings SET file_name = ? WHERE vf_name = ?').run(partner.nom, req.body.vf_display_name);
          } else {
            db.prepare('INSERT INTO vf_client_mappings (vf_name, file_name) VALUES (?, ?)').run(req.body.vf_display_name, partner.nom);
          }
        }
      }

      // Sync VosFactures si le partenaire a un vf_client_id et que des champs VF ont changé
      let vfSynced = false;
      const partnerForVf = db.prepare('SELECT vf_client_id FROM vf_partners WHERE id = ?').get(req.params.id);
      if (partnerForVf?.vf_client_id) {
        const vfData = {};
        if (email !== undefined) vfData.email = email || '';
        if (telephone !== undefined) vfData.phone = telephone || '';
        if (req.body.facturation_email !== undefined) vfData.email_for_reminders = req.body.facturation_email || '';
        if (req.body.facturation_rue !== undefined) vfData.street = req.body.facturation_rue || '';
        if (req.body.facturation_code_postal !== undefined) vfData.post_code = req.body.facturation_code_postal || '';
        if (req.body.facturation_ville !== undefined) vfData.city = req.body.facturation_ville || '';
        if (req.body.facturation_pays !== undefined) vfData.country = req.body.facturation_pays || '';
        if (req.body.facturation_tva !== undefined) vfData.tax_no = req.body.facturation_tva || '';
        if (req.body.facturation_portable !== undefined) vfData.mobile_phone = req.body.facturation_portable || '';

        // Sync adresse de livraison VF si des champs livraison changent
        const livFields = ['livraison_rue', 'livraison_code_postal', 'livraison_ville', 'livraison_pays'];
        if (livFields.some(f => req.body[f] !== undefined)) {
          const p = db.prepare('SELECT livraison_rue, livraison_code_postal, livraison_ville, livraison_pays, facturation_rue, facturation_code_postal, facturation_ville, facturation_pays FROM vf_partners WHERE id = ?').get(req.params.id);
          if (p) {
            const isDiff = p.livraison_rue !== p.facturation_rue || p.livraison_code_postal !== p.facturation_code_postal || p.livraison_ville !== p.facturation_ville || p.livraison_pays !== p.facturation_pays;
            if (isDiff && (p.livraison_rue || p.livraison_code_postal || p.livraison_ville)) {
              const lines = [];
              if (p.livraison_rue) lines.push(p.livraison_rue);
              if (p.livraison_code_postal || p.livraison_ville) lines.push([p.livraison_code_postal, p.livraison_ville].filter(Boolean).join(' '));
              if (p.livraison_pays) lines.push(p.livraison_pays);
              vfData.use_delivery_address = true;
              vfData.delivery_address = lines.join('\n');
            } else {
              vfData.use_delivery_address = false;
              vfData.delivery_address = '';
            }
          }
        }

        if (Object.keys(vfData).length > 0) {
          try {
            const vfService = require('../services/vosfacturesService')(db);
            await vfService.updateClient(partnerForVf.vf_client_id, vfData);
            vfSynced = true;
          } catch (vfErr) {
            const logger = require('../config/logger');
            logger.error('Erreur sync VF lors mise à jour partenaire', { error: vfErr.message, partnerId: req.params.id, vfData });
          }
        }
      }

      res.json({ ok: true, vfSynced });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Générer un mot de passe pour un partenaire
  router.post('/partners/:id/generate-password', async (req, res) => {
    try {
      const partner = db.prepare('SELECT id, nom, email FROM vf_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      const plainPassword = crypto.randomBytes(4).toString('hex'); // 8 caractères hex
      const hash = await bcrypt.hash(plainPassword, 10);

      db.prepare('UPDATE vf_partners SET password_hash = ?, password_plain = ? WHERE id = ?').run(hash, plainPassword, partner.id);

      // Envoyer l'email si demandé
      const { sendEmail } = req.body || {};
      let emailSent = false;
      if (sendEmail && partner.email) {
        try {
          const brevoService = require('../services/brevoService');

          // Substituer les variables du template
          const prenom = (partner.nom || '').split(/\s*[-–—(]/)[0].trim() || partner.nom;
          const escapedPrenom = (prenom || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const escapedCode = (plainPassword || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

          const htmlContent = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Votre espace partenaire Terre de Mars</title>
<style>@media only screen and (max-width:480px){.outer{padding:20px 10px!important}.pad{padding-left:24px!important;padding-right:24px!important}.title{font-size:30px!important;line-height:36px!important}.code{font-size:20px!important;letter-spacing:1px!important}.product{width:106px!important;height:auto!important}}a:focus{outline:2px solid #8E7A34;outline-offset:3px}</style>
<!--[if mso]><style>table,td,p,a{font-family:Arial,sans-serif!important}table{border-collapse:collapse}</style><![endif]-->
</head><body style="margin:0;padding:0;background:#F5F2E8;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none!important;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">Votre code personnel, vos essentiels et de nouvelles attentions pour vos h\u00f4tes.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F5F2E8;"><tr><td align="center" class="outer" style="padding:32px 16px 40px;">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
<tr><td align="center" style="padding:0 24px 26px;">
<img src="https://partenaire.terredemars.com/accueil-assets/logo.webp" width="260" height="74" alt="TERRE DE MARS" style="display:block;width:260px;max-width:100%;height:auto;border:0;color:#2F2A19;font-family:Georgia,serif;font-size:24px;">
<p style="margin:13px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:16px;letter-spacing:2.8px;color:#9B863C;text-transform:uppercase;">L\u2019espace partenaire \u00b7 L\u2019art de recevoir</p>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid #DED6B9;border-radius:14px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td class="pad" align="center" style="padding:34px 42px 24px;">
<h1 class="title" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:41px;font-weight:normal;color:#2F2A19;">Votre maison.<br><em>Notre signature.</em></h1>
<p style="margin:21px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:23px;color:#665B36;">Bonjour ${escapedPrenom},</p>
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:23px;color:#665B36;">Votre espace partenaire est pr\u00eat. Retrouvez vos essentiels \u00e0 vos tarifs partenaires et d\u00e9couvrez de nouvelles attentions pour vos h\u00f4tes.</p>
</td></tr>
<tr><td class="pad" style="padding:0 42px 20px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F4EA;border:1px solid #E5DEC6;border-radius:9px;"><tr><td align="center" style="padding:19px 12px;">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:16px;letter-spacing:1.7px;text-transform:uppercase;color:#8C7938;font-weight:bold;">Votre code d\u2019acc\u00e8s personnel</p>
<p class="code" style="margin:8px 0 0;font-family:'Courier New',monospace;font-size:23px;line-height:32px;letter-spacing:1px;color:#2F2A19;font-weight:bold;">${escapedCode}</p>
</td></tr></table>
</td></tr>
<tr><td class="pad" align="center" style="padding:0 42px 28px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td align="center" bgcolor="#8E7A34" style="border-radius:6px;mso-padding-alt:15px 23px;"><a href="https://partenaire.terredemars.com/" target="_blank" style="display:inline-block;padding:15px 23px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:bold;color:#ffffff;text-decoration:none;">Acc\u00e9der \u00e0 mon espace partenaire</a></td></tr></table>
<p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;color:#7D714A;">Saisissez votre code sur la page de connexion.<br>Conservez cet email pour retrouver votre acc\u00e8s.</p>
</td></tr>
<tr><td class="pad" style="padding:0 42px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td width="36" valign="top" style="padding:17px 0;border-bottom:1px solid #EEE8D5;font-family:Georgia,serif;font-size:17px;line-height:23px;color:#9B863C;">01</td><td valign="top" style="padding:17px 0;border-bottom:1px solid #EEE8D5;"><h3 style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#2F2A19;">Vos essentiels, simplement.</h3><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#665B36;">Retrouvez votre s\u00e9lection de produits en chambre, en recharges 5\u00a0L ou en flacons 500\u00a0ml. Choisissez vos formats, ajoutez vos cartons au panier et passez commande en ligne.</p></td></tr><tr><td width="36" valign="top" style="padding:17px 0;border-bottom:1px solid #EEE8D5;font-family:Georgia,serif;font-size:17px;line-height:23px;color:#9B863C;">02</td><td valign="top" style="padding:17px 0;border-bottom:1px solid #EEE8D5;"><h3 style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#2F2A19;">Votre signature olfactive.</h3><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#665B36;">D\u00e9couvrez les diffuseurs Intuition et R\u00e9v\u00e9lation, leurs recharges et la bougie Intuition pour vos chambres et espaces communs.</p></td></tr><tr><td width="36" valign="top" style="padding:17px 0;border-bottom:1px solid #EEE8D5;font-family:Georgia,serif;font-size:17px;line-height:23px;color:#9B863C;">03</td><td valign="top" style="padding:17px 0;border-bottom:1px solid #EEE8D5;"><h3 style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#2F2A19;">Votre quotidien, au m\u00eame endroit.</h3><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#665B36;">Acc\u00e9dez au <strong>catalogue complet</strong>, retrouvez vos <strong>commandes</strong>, consultez vos <strong>documents</strong> et g\u00e9rez vos coordonn\u00e9es dans <strong>Mon compte</strong>.</p></td></tr>
</table></td></tr>
<tr><td class="pad" style="padding:28px 42px 0;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F7F4EA;border:1px solid #E5DEC6;border-radius:9px;"><tr><td align="center" style="padding:25px 18px;">
<p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:16px;letter-spacing:1.8px;text-transform:uppercase;color:#8C7938;font-weight:bold;">Les attentions Terre de Mars</p>
<h2 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:32px;font-weight:normal;color:#2F2A19;">Un s\u00e9jour se termine.<br><em>Une attention reste.</em></h2>
<p style="margin:13px 0 17px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#665B36;">Un baume \u00e0 l\u00e8vres d\u00e9pos\u00e9 en chambre, un soin pour prolonger un moment au spa, un souvenir \u00e0 emporter\u2026</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="50%" align="center" valign="top"><img class="product" src="https://cdn.shopify.com/s/files/1/0955/1141/3001/files/P016_1.png" width="130" height="130" alt="Cr\u00e8me contour des yeux Terre de Mars" style="display:block;width:130px;max-width:100%;height:auto;border:0;"><p style="margin:8px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#665B36;">Cr\u00e8me contour des yeux</p></td><td width="50%" align="center" valign="top"><img class="product" src="https://cdn.shopify.com/s/files/1/0955/1141/3001/files/P012_1.png" width="130" height="130" alt="Baume l\u00e8vres C\u00e9leste Terre de Mars" style="display:block;width:130px;max-width:100%;height:auto;border:0;"><p style="margin:8px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:#665B36;">Baume l\u00e8vres C\u00e9leste</p></td></tr></table>
<p style="margin:19px 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#665B36;">Explorez la s\u00e9lection <strong>cadeaux VIP &amp; soins spa</strong> et imaginez vos coffrets avec papier de soie. Pour une s\u00e9lection adapt\u00e9e \u00e0 votre \u00e9tablissement, cliquez sur \u00ab\u00a0Pr\u00e9parer mes cadeaux\u00a0\u00bb dans votre espace.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td align="center" bgcolor="#8E7A34" style="border-radius:6px;mso-padding-alt:15px 23px;"><a href="https://partenaire.terredemars.com/" target="_blank" style="display:inline-block;padding:15px 23px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:bold;color:#ffffff;text-decoration:none;">D\u00e9couvrir les attentions VIP</a></td></tr></table>
</td></tr></table>
</td></tr>
<tr><td class="pad" style="padding:25px 42px 31px;">
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#665B36;">Une question sur une commande ou un projet cadeau\u00a0? Retrouvez votre interlocuteur d\u00e9di\u00e9 dans la rubrique <strong>Contact</strong>.</p>
<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:21px;color:#2F2A19;">Au plaisir de vous accompagner,<br><strong>L\u2019\u00e9quipe Terre de Mars</strong></p>
</td></tr>
</table></td></tr>
<tr><td align="center" style="padding:23px 18px 0;"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;color:#7D714A;">TERRE DE MARS \u00b7 L\u2019art du soin, le sens de l\u2019accueil.</p><p style="margin:7px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:16px;color:#7D714A;">Votre acc\u00e8s est personnel. Conservez votre code confidentiel.</p></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;

          const payload = {
            sender: brevoService.SENDER,
            to: [{ email: partner.email, name: partner.nom }],
            subject: 'Votre espace partenaire Terre de Mars vous attend',
            headers: { 'X-Mailin-Tag': 'portail-partenaire', 'X-Mailin-Track': '0', 'X-Mailin-TrackLinks': '0' },
            htmlContent,
            replyTo: { email: brevoService.SENDER.email, name: brevoService.SENDER.name },
          };
          await brevoService.brevoSendEmail(payload);
          emailSent = true;
        } catch (emailErr) {
          logger.error(`❌ Erreur envoi email mot de passe partenaire ${partner.nom}: ${emailErr.message}`);
          logger.error(emailErr.stack || emailErr);
        }
      }

      res.json({
        ok: true,
        password: plainPassword,
        emailSent,
        message: `Mot de passe généré pour ${partner.nom}.` + (emailSent ? ' Email envoyé.' : ' ⚠️ Email non envoyé.'),
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Voir le mot de passe en clair d'un partenaire (admin uniquement)
  router.get('/partners/:id/password', (req, res) => {
    try {
      const partner = db.prepare('SELECT id, nom, password_plain FROM vf_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });
      res.json({ ok: true, nom: partner.nom, password: partner.password_plain || null });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Révoquer l'accès portail d'un partenaire (supprimer le mot de passe)
  router.delete('/partners/:id/password', (req, res) => {
    try {
      const partner = db.prepare('SELECT id, nom FROM vf_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });
      db.prepare('UPDATE vf_partners SET password_hash = NULL, password_plain = NULL WHERE id = ?').run(req.params.id);
      res.json({ ok: true, nom: partner.nom });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/partners/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM vf_partners WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Sous-comptes (comptes maîtres multi-établissements) ───────────────

  router.get('/partners/:id/sub-accounts', (req, res) => {
    try {
      const master = db.prepare('SELECT id, is_master FROM vf_partners WHERE id = ?').get(req.params.id);
      if (!master) return res.status(404).json({ erreur: 'Partenaire introuvable' });
      if (!master.is_master) return res.status(400).json({ erreur: 'Ce partenaire n\'est pas un compte maître' });
      const rows = db.prepare('SELECT id, nom, email, contact_nom, actif, vf_client_id FROM vf_partners WHERE master_id = ?').all(req.params.id);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/partners/:id/sub-accounts', (req, res) => {
    try {
      const { subAccountId } = req.body;
      if (!subAccountId) return res.status(400).json({ erreur: 'subAccountId requis' });

      const master = db.prepare('SELECT id, is_master FROM vf_partners WHERE id = ?').get(req.params.id);
      if (!master) return res.status(404).json({ erreur: 'Compte maître introuvable' });
      if (!master.is_master) return res.status(400).json({ erreur: 'Ce partenaire n\'est pas un compte maître' });

      if (parseInt(subAccountId) === parseInt(req.params.id)) {
        return res.status(400).json({ erreur: 'Un compte ne peut pas être son propre sous-compte' });
      }

      const sub = db.prepare('SELECT id, nom, master_id FROM vf_partners WHERE id = ?').get(subAccountId);
      if (!sub) return res.status(404).json({ erreur: 'Sous-compte introuvable' });
      if (sub.master_id) return res.status(400).json({ erreur: `Ce partenaire est déjà rattaché à un autre compte maître (id=${sub.master_id})` });

      db.prepare('UPDATE vf_partners SET master_id = ? WHERE id = ?').run(req.params.id, subAccountId);
      res.json({ ok: true, message: `${sub.nom} rattaché au compte maître` });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/partners/:masterId/sub-accounts/:subId', (req, res) => {
    try {
      const sub = db.prepare('SELECT id, nom, master_id FROM vf_partners WHERE id = ? AND master_id = ?').get(req.params.subId, req.params.masterId);
      if (!sub) return res.status(404).json({ erreur: 'Sous-compte introuvable ou non rattaché à ce maître' });

      db.prepare('UPDATE vf_partners SET master_id = NULL WHERE id = ?').run(req.params.subId);
      res.json({ ok: true, message: `${sub.nom} détaché du compte maître` });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Remises par partenaire ──────────────────────────────────────────────

  router.get('/partners/:id/discounts', (req, res) => {
    try {
      const partner = db.prepare('SELECT nom FROM vf_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });
      const rows = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ? ORDER BY product_code').all(partner.nom);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/partners/:id/discounts', (req, res) => {
    try {
      const partner = db.prepare('SELECT nom FROM vf_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });
      const { product_code, discount_pct } = req.body;
      if (!product_code || discount_pct === undefined) return res.status(400).json({ erreur: 'product_code et discount_pct requis' });
      db.prepare(`
        INSERT INTO vf_client_discounts (client_name, product_code, discount_pct)
        VALUES (?, ?, ?)
        ON CONFLICT(client_name, product_code) DO UPDATE SET discount_pct = excluded.discount_pct
      `).run(partner.nom, product_code, discount_pct);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/partners/:id/discounts/:discountId', (req, res) => {
    try {
      db.prepare('DELETE FROM vf_client_discounts WHERE id = ?').run(req.params.discountId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Synchroniser les partenaires depuis VosFactures
  router.post('/partners/sync-vf', async (req, res) => {
    try {
      const vfService = require('../services/vosfacturesService')(db);
      const vfClients = await vfService.getAllClients(true);

      if (!vfClients || !vfClients.length) {
        return res.status(400).json({ erreur: 'Aucun client VosFactures trouvé' });
      }

      // Charger les mappings existants (vf_name → file_name)
      const mappings = db.prepare('SELECT * FROM vf_client_mappings').all();
      const mappingByVfName = {};
      for (const m of mappings) {
        if (m.vf_name) mappingByVfName[m.vf_name.toLowerCase()] = m;
      }

      // Charger les partenaires existants
      const existingPartners = db.prepare('SELECT * FROM vf_partners').all();
      const partnerByNom = {};
      const partnerByVfClientId = {};
      const partnerByEmail = {};
      for (const p of existingPartners) {
        partnerByNom[p.nom.toLowerCase()] = p;
        if (p.nom_normalise) partnerByNom[p.nom_normalise.toLowerCase()] = p;
        if (p.vf_client_id) partnerByVfClientId[String(p.vf_client_id)] = p;
        if (p.email) {
          const ek = p.email.toLowerCase();
          // Garder le premier match (éviter les doublons)
          if (!partnerByEmail[ek]) partnerByEmail[ek] = p;
        }
      }

      let updated = 0;
      let created = 0;
      let skipped = 0;

      const updateStmt = db.prepare(`
        UPDATE vf_partners SET
          email = COALESCE(?, email),
          contact_nom = COALESCE(?, contact_nom),
          telephone = COALESCE(?, telephone),
          adresse = COALESCE(?, adresse),
          vf_client_id = ?,
          vf_display_name = COALESCE(?, vf_display_name),
          facturation_rue = COALESCE(?, facturation_rue),
          facturation_code_postal = COALESCE(?, facturation_code_postal),
          facturation_ville = COALESCE(?, facturation_ville),
          facturation_pays = COALESCE(?, facturation_pays),
          facturation_tva = COALESCE(?, facturation_tva),
          facturation_entite_publique = COALESCE(?, facturation_entite_publique),
          facturation_portable = COALESCE(?, facturation_portable),
          facturation_email = COALESCE(?, facturation_email),
          livraison_rue = COALESCE(?, livraison_rue),
          livraison_code_postal = COALESCE(?, livraison_code_postal),
          livraison_ville = COALESCE(?, livraison_ville),
          livraison_pays = COALESCE(?, livraison_pays)
        WHERE id = ?
      `);

      const insertStmt = db.prepare(`
        INSERT INTO vf_partners (nom, nom_normalise, email, contact_nom, telephone, adresse, vf_client_id, facturation_rue, facturation_code_postal, facturation_ville, facturation_pays, facturation_tva, facturation_entite_publique, facturation_portable, facturation_email, livraison_rue, livraison_code_postal, livraison_ville, livraison_pays, actif)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(nom) DO UPDATE SET
          nom_normalise = excluded.nom_normalise,
          email = COALESCE(excluded.email, vf_partners.email),
          contact_nom = COALESCE(excluded.contact_nom, vf_partners.contact_nom),
          telephone = COALESCE(excluded.telephone, vf_partners.telephone),
          adresse = COALESCE(excluded.adresse, vf_partners.adresse),
          vf_client_id = COALESCE(excluded.vf_client_id, vf_partners.vf_client_id),
          actif = 1,
          facturation_rue = COALESCE(excluded.facturation_rue, vf_partners.facturation_rue),
          facturation_code_postal = COALESCE(excluded.facturation_code_postal, vf_partners.facturation_code_postal),
          facturation_ville = COALESCE(excluded.facturation_ville, vf_partners.facturation_ville),
          facturation_pays = COALESCE(excluded.facturation_pays, vf_partners.facturation_pays),
          facturation_tva = COALESCE(excluded.facturation_tva, vf_partners.facturation_tva),
          facturation_entite_publique = COALESCE(excluded.facturation_entite_publique, vf_partners.facturation_entite_publique),
          facturation_portable = COALESCE(excluded.facturation_portable, vf_partners.facturation_portable),
          facturation_email = COALESCE(excluded.facturation_email, vf_partners.facturation_email),
          livraison_rue = COALESCE(excluded.livraison_rue, vf_partners.livraison_rue),
          livraison_code_postal = COALESCE(excluded.livraison_code_postal, vf_partners.livraison_code_postal),
          livraison_ville = COALESCE(excluded.livraison_ville, vf_partners.livraison_ville),
          livraison_pays = COALESCE(excluded.livraison_pays, vf_partners.livraison_pays)
      `);

      // Aussi mettre à jour vf_client_id dans vf_client_mappings si manquant
      const updateMappingStmt = db.prepare(`
        UPDATE vf_client_mappings SET vf_client_id = ? WHERE vf_name = ? AND (vf_client_id IS NULL OR vf_client_id = '')
      `);

      for (const vfClient of vfClients) {
        const vfName = (vfClient.name || '').trim();
        if (!vfName) continue;

        const vfId = String(vfClient.id || '');
        const email = vfClient.email || null;
        const phone = vfClient.phone || null;
        const contactName = vfClient.shortcut || null;
        const street = vfClient.street || '';
        const city = vfClient.city || '';
        const postCode = vfClient.post_code || '';
        const country = vfClient.country || '';
        const taxNo = vfClient.tax_no || '';
        const mobile = vfClient.mobile_phone || '';
        const buyer = vfClient.buyer ? 1 : 0;
        const emailReminders = vfClient.email_for_reminders || '';
        const adresse = [street, postCode, city].filter(Boolean).join(', ') || null;

        // Adresse de livraison VF (texte libre, format "Nom\nRue\nCP Ville\nPays")
        const useDelivery = vfClient.use_delivery_address || false;
        const rawDelivery = (vfClient.delivery_address || '').trim();
        let livRue = '', livCp = '', livVille = '', livPays = '';
        if (useDelivery && rawDelivery) {
          const dLines = rawDelivery.split('\n').map(l => l.trim()).filter(Boolean);
          for (const line of dLines) {
            const cpMatch = line.match(/^(\d{4,5})\s+(.+)$/);
            if (cpMatch) { livCp = cpMatch[1]; livVille = cpMatch[2]; }
            else if (!livRue) { livRue = line; }
            else if (!livPays) { livPays = line; }
          }
        }

        // Mettre à jour le vf_client_id dans les mappings
        if (vfId) {
          updateMappingStmt.run(vfId, vfName);
        }

        // Trouver le partenaire local correspondant
        // 1. Match par vf_client_id (le plus fiable)
        let partner = vfId ? partnerByVfClientId[vfId] : null;

        // 2. Match direct par nom
        if (!partner) {
          partner = partnerByNom[vfName.toLowerCase()];
        }

        // 3. Match via vf_client_mappings (vf_name → file_name → partner.nom)
        if (!partner) {
          const mapping = mappingByVfName[vfName.toLowerCase()];
          if (mapping && mapping.file_name) {
            partner = partnerByNom[mapping.file_name.toLowerCase()];
          }
        }

        // 4. Match par email (utile pour les comptes portail créés manuellement)
        if (!partner && email) {
          partner = partnerByEmail[email.toLowerCase()] || null;
        }

        if (partner) {
          // Mettre à jour avec les données VF (seulement si le champ local est vide)
          updateStmt.run(
            email || null,
            contactName || null,
            phone || null,
            adresse || null,
            vfId,
            vfName,
            street || null,
            postCode || null,
            city || null,
            country || null,
            taxNo || null,
            buyer,
            mobile || null,
            emailReminders || null,
            livRue || null,
            livCp || null,
            livVille || null,
            livPays || null,
            partner.id
          );
          // Auto-sync vf_client_mappings : vf_name (nom VF brut) → file_name (nom canonique du partenaire)
          if (vfName && vfName.toLowerCase() !== partner.nom.toLowerCase()) {
            const existingMapping = db.prepare('SELECT id FROM vf_client_mappings WHERE vf_name = ?').get(vfName);
            if (existingMapping) {
              db.prepare('UPDATE vf_client_mappings SET file_name = ? WHERE vf_name = ?').run(partner.nom, vfName);
            } else {
              db.prepare('INSERT INTO vf_client_mappings (vf_name, file_name, vf_client_id) VALUES (?, ?, ?)').run(vfName, partner.nom, vfId || null);
            }
          }
          updated++;
        } else {
          // Créer un nouveau partenaire
          const nomNormalise = vfName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          insertStmt.run(vfName, nomNormalise, email, contactName, phone, adresse, vfId, street || null, postCode || null, city || null, country || null, taxNo || null, buyer, mobile || null, emailReminders || null, livRue || null, livCp || null, livVille || null, livPays || null);
          created++;
        }
      }

      // Post-sync : récupérer les champs manquants via appels individuels VF
      // Limité aux partenaires sans pays (le bulk peut ne pas retourner country)
      // Max 30 appels pour ne pas ralentir le sync
      const partnersMissingData = db.prepare(
        `SELECT id, vf_client_id, facturation_rue, facturation_code_postal, facturation_ville,
                facturation_pays, facturation_tva, facturation_portable, facturation_email
         FROM vf_partners
         WHERE vf_client_id IS NOT NULL AND facturation_pays IS NULL
         LIMIT 30`
      ).all();

      let enriched = 0;
      for (const p of partnersMissingData) {
        try {
          const fullClient = await vfService.getClient(p.vf_client_id);
          if (!fullClient) continue;
          const patches = {};
          if (!p.facturation_pays && fullClient.country) patches.facturation_pays = fullClient.country;
          if (!p.facturation_tva && fullClient.tax_no) patches.facturation_tva = fullClient.tax_no;
          if (!p.facturation_rue && fullClient.street) patches.facturation_rue = fullClient.street;
          if (!p.facturation_code_postal && fullClient.post_code) patches.facturation_code_postal = fullClient.post_code;
          if (!p.facturation_ville && fullClient.city) patches.facturation_ville = fullClient.city;
          if (!p.facturation_portable && fullClient.mobile_phone) patches.facturation_portable = fullClient.mobile_phone;
          if (!p.facturation_email && fullClient.email_for_reminders) patches.facturation_email = fullClient.email_for_reminders;
          if (Object.keys(patches).length > 0) {
            const sets = Object.keys(patches).map(k => `${k} = ?`).join(', ');
            db.prepare(`UPDATE vf_partners SET ${sets} WHERE id = ?`).run(...Object.values(patches), p.id);
            enriched++;
          }
        } catch (e) {
          logger.debug('VF enrichment failed', { partnerId: p.id, error: e.message });
        }
      }

      // Post-sync : récupérer les clients VF connus mais absents de la liste paginée
      // (l'API VF /clients.json ne retourne pas toujours tous les clients)
      const syncedIds = new Set(vfClients.map(c => String(c.id)));
      const missingPartners = db.prepare(
        'SELECT id, nom, vf_client_id FROM vf_partners WHERE vf_client_id IS NOT NULL AND actif = 1'
      ).all().filter(p => !syncedIds.has(String(p.vf_client_id)));

      let recovered = 0;
      for (const p of missingPartners) {
        try {
          const fullClient = await vfService.getClient(p.vf_client_id);
          if (!fullClient || !fullClient.name) continue;
          const vfName = fullClient.name.trim();
          const email = fullClient.email || null;
          const contactName = fullClient.shortcut || null;
          const phone = fullClient.phone || null;
          const street = fullClient.street || '';
          const postCode = fullClient.post_code || '';
          const city = fullClient.city || '';
          const country = fullClient.country || '';
          const taxNo = fullClient.tax_no || '';
          const mobile = fullClient.mobile_phone || '';
          const adresse = [street, postCode, city].filter(Boolean).join(', ') || null;
          db.prepare(`
            UPDATE vf_partners SET
              email = COALESCE(?, email), contact_nom = COALESCE(?, contact_nom),
              telephone = COALESCE(?, telephone), adresse = COALESCE(?, adresse),
              vf_display_name = COALESCE(?, vf_display_name),
              facturation_rue = COALESCE(?, facturation_rue),
              facturation_code_postal = COALESCE(?, facturation_code_postal),
              facturation_ville = COALESCE(?, facturation_ville),
              facturation_pays = COALESCE(?, facturation_pays),
              facturation_tva = COALESCE(?, facturation_tva),
              facturation_portable = COALESCE(?, facturation_portable)
            WHERE id = ?
          `).run(email, contactName, phone, adresse, vfName, street || null, postCode || null, city || null, country || null, taxNo || null, mobile || null, p.id);
          recovered++;
        } catch (_) {}
      }

      if (missingPartners.length > 0) {
        logger.info(`📇 Post-sync: ${missingPartners.length} clients VF absents de la liste paginée, ${recovered} récupérés via API unitaire`);
      }

      // Recharger pour retourner le total
      const total = db.prepare('SELECT COUNT(*) as n FROM vf_partners WHERE actif = 1').get().n;

      res.json({
        ok: true,
        vf_clients: vfClients.length,
        updated,
        created,
        enriched,
        recovered,
        missing_from_api: missingPartners.length,
        total_partenaires: total,
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Diagnostic VF client ─────────────────────────────────────────────────
  // Cherche pourquoi un client VF n'apparaît pas dans les partenaires
  router.get('/partners/lookup-vf/:vfClientId', async (req, res) => {
    try {
      const vfClientId = req.params.vfClientId;

      // 1. Chercher dans vf_partners par vf_client_id
      const localPartner = db.prepare('SELECT id, nom, actif, vf_client_id, vf_display_name FROM vf_partners WHERE vf_client_id = ?').get(vfClientId);

      // 2. Chercher dans vf_client_mappings
      const mappings = db.prepare('SELECT * FROM vf_client_mappings WHERE vf_client_id = ?').all(vfClientId);

      // 3. Récupérer le client depuis l'API VF
      let vfClient = null;
      try {
        const vfService = require('../services/vosfacturesService')(db);
        vfClient = await vfService.getClient(vfClientId);
      } catch (e) {
        vfClient = { error: e.message };
      }

      // 4. Si le client VF existe, chercher si un partenaire a le même nom
      let nameConflict = null;
      if (vfClient && vfClient.name) {
        nameConflict = db.prepare('SELECT id, nom, actif, vf_client_id FROM vf_partners WHERE LOWER(nom) = LOWER(?)').get(vfClient.name.trim());
      }

      res.json({
        vf_client_id: vfClientId,
        vf_client: vfClient ? { name: vfClient.name, email: vfClient.email, city: vfClient.city, shortcut: vfClient.shortcut } : null,
        local_partner: localPartner || null,
        mappings,
        name_conflict: nameConflict || null,
        diagnostic: !vfClient ? 'Client VF introuvable via API'
          : localPartner ? (localPartner.actif ? 'Partenaire existe et est actif' : 'Partenaire existe mais est INACTIF (actif=0)')
          : nameConflict ? `Nom "${vfClient.name}" déjà utilisé par partenaire #${nameConflict.id} (vf_client_id=${nameConflict.vf_client_id})`
          : 'Client VF non synchronisé — relancer la sync VF',
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Créer un partenaire directement depuis un client VF (par ID)
  router.post('/partners/create-from-vf', async (req, res) => {
    try {
      const { vf_client_id } = req.body;
      if (!vf_client_id) return res.status(400).json({ erreur: 'vf_client_id requis' });

      // Vérifier qu'il n'existe pas déjà
      const existing = db.prepare('SELECT id, nom FROM vf_partners WHERE vf_client_id = ?').get(String(vf_client_id));
      if (existing) return res.json({ ok: true, message: `Partenaire "${existing.nom}" existe déjà`, partner_id: existing.id });

      // Récupérer le client depuis l'API VF
      const vfService = require('../services/vosfacturesService')(db);
      const vfClient = await vfService.getClient(vf_client_id);
      if (!vfClient || !vfClient.name) return res.status(404).json({ erreur: 'Client VF introuvable' });

      const vfName = vfClient.name.trim();
      const email = vfClient.email || null;
      const contactName = vfClient.shortcut || null;
      const phone = vfClient.phone || null;
      const street = vfClient.street || '';
      const city = vfClient.city || '';
      const postCode = vfClient.post_code || '';
      const country = vfClient.country || '';
      const taxNo = vfClient.tax_no || '';
      const mobile = vfClient.mobile_phone || '';
      const buyer = vfClient.buyer ? 1 : 0;
      const adresse = [street, postCode, city].filter(Boolean).join(', ') || null;

      // Vérifier conflit de nom avec un partenaire qui a un vf_client_id DIFFÉRENT
      const nameConflict = db.prepare('SELECT id, nom, vf_client_id FROM vf_partners WHERE LOWER(nom) = LOWER(?)').get(vfName);
      let finalName = vfName;
      if (nameConflict && nameConflict.vf_client_id && nameConflict.vf_client_id !== String(vf_client_id)) {
        // Nom déjà pris par un autre partenaire VF — désambiguïser avec la ville ou l'ID VF
        finalName = city ? `${vfName} (${city})` : `${vfName} (VF#${vf_client_id})`;
        // Si même le nom désambiguïsé existe déjà, ajouter l'ID VF
        const stillConflict = db.prepare('SELECT id FROM vf_partners WHERE LOWER(nom) = LOWER(?)').get(finalName);
        if (stillConflict) {
          finalName = `${vfName} (VF#${vf_client_id})`;
        }
      }
      const nomNormalise = finalName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      db.prepare(`
        INSERT INTO vf_partners (nom, nom_normalise, email, contact_nom, telephone, adresse, vf_client_id, facturation_rue, facturation_code_postal, facturation_ville, facturation_pays, facturation_tva, facturation_entite_publique, facturation_portable, vf_display_name, actif)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(nom) DO UPDATE SET
          vf_client_id = excluded.vf_client_id,
          email = COALESCE(excluded.email, vf_partners.email),
          contact_nom = COALESCE(excluded.contact_nom, vf_partners.contact_nom),
          telephone = COALESCE(excluded.telephone, vf_partners.telephone),
          adresse = COALESCE(excluded.adresse, vf_partners.adresse),
          facturation_rue = COALESCE(excluded.facturation_rue, vf_partners.facturation_rue),
          facturation_code_postal = COALESCE(excluded.facturation_code_postal, vf_partners.facturation_code_postal),
          facturation_ville = COALESCE(excluded.facturation_ville, vf_partners.facturation_ville),
          facturation_pays = COALESCE(excluded.facturation_pays, vf_partners.facturation_pays),
          facturation_tva = COALESCE(excluded.facturation_tva, vf_partners.facturation_tva),
          vf_display_name = COALESCE(excluded.vf_display_name, vf_partners.vf_display_name),
          actif = 1
      `).run(finalName, nomNormalise, email, contactName, phone, adresse, String(vf_client_id), street || null, postCode || null, city || null, country || null, taxNo || null, buyer, mobile || null, vfName);

      // Aussi créer le mapping dans vf_client_mappings
      const existingMapping = db.prepare('SELECT id FROM vf_client_mappings WHERE vf_name = ?').get(vfName);
      if (existingMapping) {
        db.prepare('UPDATE vf_client_mappings SET file_name = ?, vf_client_id = ? WHERE vf_name = ?').run(finalName, String(vf_client_id), vfName);
      } else {
        db.prepare('INSERT INTO vf_client_mappings (vf_name, file_name, vf_client_id) VALUES (?, ?, ?)').run(vfName, finalName, String(vf_client_id));
      }

      const partner = db.prepare('SELECT id, nom FROM vf_partners WHERE vf_client_id = ?').get(String(vf_client_id));
      res.json({ ok: true, partner_id: partner?.id, nom: partner?.nom });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Lier un client VF à un partenaire existant ──────────────────────────
  router.post('/partners/:id/link-vf-client', async (req, res) => {
    try {
      const partnerId = req.params.id;
      const { vf_client_id } = req.body;
      if (!vf_client_id) return res.status(400).json({ erreur: 'vf_client_id requis' });

      const partner = db.prepare('SELECT id, nom FROM vf_partners WHERE id = ?').get(partnerId);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      // Récupérer le nom VF pour le mapping
      let vfName = null;
      try {
        const vfService = require('../services/vosfacturesService')(db);
        const vfClient = await vfService.getClient(vf_client_id);
        vfName = vfClient?.name?.trim() || null;
      } catch (_) {}

      // Créer le mapping VF → partenaire existant
      if (vfName) {
        const existingMapping = db.prepare('SELECT id FROM vf_client_mappings WHERE vf_name = ?').get(vfName);
        if (existingMapping) {
          db.prepare('UPDATE vf_client_mappings SET file_name = ?, vf_client_id = ? WHERE id = ?').run(partner.nom, String(vf_client_id), existingMapping.id);
        } else {
          db.prepare('INSERT INTO vf_client_mappings (vf_name, file_name, vf_client_id) VALUES (?, ?, ?)').run(vfName, partner.nom, String(vf_client_id));
        }
      }

      res.json({ ok: true, partner_id: partner.id, nom: partner.nom, vf_name: vfName, message: `Client VF #${vf_client_id} lié au partenaire "${partner.nom}"` });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Remises client ───────────────────────────────────────────────────────

  router.get('/discounts', (req, res) => {
    try {
      const { client } = req.query;
      if (client) {
        const rows = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ?').all(client);
        res.json(rows);
      } else {
        const rows = db.prepare('SELECT * FROM vf_client_discounts ORDER BY client_name, product_code').all();
        res.json(rows);
      }
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/discounts', (req, res) => {
    try {
      const { client_name, product_code, discount_pct } = req.body;
      db.prepare(`
        INSERT INTO vf_client_discounts (client_name, product_code, discount_pct)
        VALUES (?, ?, ?)
        ON CONFLICT(client_name, product_code) DO UPDATE SET discount_pct = excluded.discount_pct
      `).run(client_name, product_code, discount_pct);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/discounts/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM vf_client_discounts WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Client mappings ─────────────────────────────────────────────────────

  router.get('/client-mappings', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM vf_client_mappings ORDER BY vf_name').all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/client-mappings', (req, res) => {
    try {
      const { vf_name, file_name, vf_client_id, shipping_id, shipping_name } = req.body;
      const info = db.prepare(`
        INSERT INTO vf_client_mappings (vf_name, file_name, vf_client_id, shipping_id, shipping_name)
        VALUES (?, ?, ?, ?, ?)
      `).run(vf_name, file_name || null, vf_client_id || null, shipping_id || null, shipping_name || null);
      res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/client-mappings/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM vf_client_mappings WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Code mappings ────────────────────────────────────────────────────────

  router.get('/code-mappings', (req, res) => {
    try {
      const { type } = req.query;
      if (type) {
        const rows = db.prepare('SELECT * FROM vf_code_mappings WHERE type = ? ORDER BY code_source').all(type);
        res.json(rows);
      } else {
        const rows = db.prepare('SELECT * FROM vf_code_mappings ORDER BY type, code_source').all();
        res.json(rows);
      }
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/code-mappings', (req, res) => {
    try {
      const { code_source, type, code_cible, valeur } = req.body;
      db.prepare(`
        INSERT INTO vf_code_mappings (code_source, type, code_cible, valeur)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(code_source, type) DO UPDATE SET
          code_cible = excluded.code_cible, valeur = excluded.valeur
      `).run(code_source, type, code_cible || null, valeur || null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/code-mappings/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM vf_code_mappings WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Seed bulk ────────────────────────────────────────────────────────────

  router.post('/seed', (req, res) => {
    try {
      const { catalog, partners, discounts, client_mappings, code_mappings } = req.body;
      let counts = {};

      const seedOp = db.transaction(() => {
        if (catalog && Array.isArray(catalog)) {
          const stmt = db.prepare(`
            INSERT INTO vf_catalog (ref, vf_product_id, nom, prix_ht, tva, csv_ref, vf_ref, actif)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ref) DO UPDATE SET
              vf_product_id = excluded.vf_product_id, nom = excluded.nom,
              prix_ht = excluded.prix_ht, tva = excluded.tva,
              csv_ref = excluded.csv_ref, vf_ref = excluded.vf_ref,
              actif = excluded.actif
          `);
          for (const c of catalog) {
            stmt.run(c.ref, c.vf_product_id || null, c.nom, c.prix_ht, c.tva || 20, c.csv_ref || null, c.vf_ref || null, c.actif ?? 1);
          }
          counts.catalog = catalog.length;
        }

        if (partners && Array.isArray(partners)) {
          const stmt = db.prepare(`
            INSERT INTO vf_partners (nom, nom_normalise)
            VALUES (?, ?)
            ON CONFLICT(nom) DO UPDATE SET nom_normalise = excluded.nom_normalise
          `);
          for (const p of partners) {
            stmt.run(p.nom, p.nom_normalise || p.nom.toLowerCase());
          }
          counts.partners = partners.length;
        }

        if (discounts && Array.isArray(discounts)) {
          const stmt = db.prepare(`
            INSERT INTO vf_client_discounts (client_name, product_code, discount_pct)
            VALUES (?, ?, ?)
            ON CONFLICT(client_name, product_code) DO UPDATE SET discount_pct = excluded.discount_pct
          `);
          for (const d of discounts) {
            stmt.run(d.client_name, d.product_code, d.discount_pct);
          }
          counts.discounts = discounts.length;
        }

        if (client_mappings && Array.isArray(client_mappings)) {
          // Vider et réimporter
          db.prepare('DELETE FROM vf_client_mappings').run();
          const stmt = db.prepare(`
            INSERT INTO vf_client_mappings (vf_name, file_name, vf_client_id, shipping_id, shipping_name)
            VALUES (?, ?, ?, ?, ?)
          `);
          for (const m of client_mappings) {
            stmt.run(m.vf_name, m.file_name || null, m.vf_client_id || null, m.shipping_id || null, m.shipping_name || null);
          }
          counts.client_mappings = client_mappings.length;
        }

        if (code_mappings && Array.isArray(code_mappings)) {
          const stmt = db.prepare(`
            INSERT INTO vf_code_mappings (code_source, type, code_cible, valeur)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(code_source, type) DO UPDATE SET
              code_cible = excluded.code_cible, valeur = excluded.valeur
          `);
          for (const m of code_mappings) {
            stmt.run(m.code_source, m.type, m.code_cible || null, m.valeur || null);
          }
          counts.code_mappings = code_mappings.length;
        }
      });

      seedOp();
      res.json({ ok: true, counts });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Documents partenaires (CRUD admin) ──────────────────────────────────

  router.get('/partner-documents', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM partner_documents ORDER BY ordre, id').all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/partner-documents', (req, res) => {
    try {
      const { titre, url } = req.body;
      if (!titre || !url) return res.status(400).json({ erreur: 'titre et url requis' });
      const maxOrdre = db.prepare('SELECT COALESCE(MAX(ordre), -1) AS m FROM partner_documents').get().m;
      const info = db.prepare('INSERT INTO partner_documents (titre, url, ordre) VALUES (?, ?, ?)').run(titre, url, maxOrdre + 1);
      res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.patch('/partner-documents/reorder', (req, res) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) return res.status(400).json({ erreur: 'order doit être un tableau d\'ids' });
      const update = db.prepare('UPDATE partner_documents SET ordre = ? WHERE id = ?');
      db.transaction(() => {
        order.forEach((id, idx) => update.run(idx, id));
      })();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.patch('/partner-documents/:id', (req, res) => {
    try {
      const { titre, url } = req.body;
      if (!titre || !url) return res.status(400).json({ erreur: 'titre et url requis' });
      const info = db.prepare('UPDATE partner_documents SET titre = ?, url = ? WHERE id = ?').run(titre, url, req.params.id);
      if (info.changes === 0) return res.status(404).json({ erreur: 'Document introuvable' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/partner-documents/:id', (req, res) => {
    try {
      const info = db.prepare('DELETE FROM partner_documents WHERE id = ?').run(req.params.id);
      if (info.changes === 0) return res.status(404).json({ erreur: 'Document introuvable' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Demandes de modification profil partenaire (validation admin) ────────

  router.get('/partners/:id/profile-changes', (req, res) => {
    try {
      const row = db.prepare("SELECT * FROM partner_profile_changes WHERE partner_id = ? AND statut = 'en_attente' ORDER BY created_at DESC LIMIT 1").get(req.params.id);
      res.json(row || null);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/partners/:id/validate-profile-change', async (req, res) => {
    try {
      const partnerId = req.params.id;
      const row = db.prepare("SELECT * FROM partner_profile_changes WHERE partner_id = ? AND statut = 'en_attente' ORDER BY created_at DESC LIMIT 1").get(partnerId);
      if (!row) return res.status(404).json({ erreur: 'Aucune demande en attente' });

      const changes = JSON.parse(row.changes);
      const partner = db.prepare('SELECT * FROM vf_partners WHERE id = ?').get(partnerId);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      // Appliquer les changements en DB
      const updates = [];
      const values = [];
      for (const [key, { nouveau }] of Object.entries(changes)) {
        updates.push(`${key} = ?`);
        values.push(nouveau || null);
      }
      if (updates.length > 0) {
        values.push(partnerId);
        db.prepare(`UPDATE vf_partners SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }

      // Sync VosFactures si le partenaire a un vf_client_id
      if (partner.vf_client_id) {
        const vfData = {};
        if (changes.email) vfData.email = changes.email.nouveau || '';
        if (changes.telephone) vfData.phone = changes.telephone.nouveau || '';
        if (changes.facturation_email) vfData.email_for_reminders = changes.facturation_email.nouveau || '';
        if (changes.facturation_rue) vfData.street = changes.facturation_rue.nouveau || '';
        if (changes.facturation_code_postal) vfData.post_code = changes.facturation_code_postal.nouveau || '';
        if (changes.facturation_ville) vfData.city = changes.facturation_ville.nouveau || '';
        if (changes.facturation_pays) vfData.country = changes.facturation_pays.nouveau || '';
        if (changes.facturation_tva) vfData.tax_no = changes.facturation_tva.nouveau || '';
        if (changes.facturation_portable) vfData.mobile_phone = changes.facturation_portable.nouveau || '';

        // Sync adresse de livraison VF si des champs livraison changent
        const livFields = ['livraison_rue', 'livraison_code_postal', 'livraison_ville', 'livraison_pays'];
        if (livFields.some(f => changes[f])) {
          // Recalculer l'état final des champs après application des changements
          const finalPartner = { ...partner };
          for (const [key, { nouveau }] of Object.entries(changes)) {
            finalPartner[key] = nouveau || '';
          }
          const lRue = finalPartner.livraison_rue || '';
          const lCp = finalPartner.livraison_code_postal || '';
          const lVille = finalPartner.livraison_ville || '';
          const lPays = finalPartner.livraison_pays || '';
          const fRue = finalPartner.facturation_rue || '';
          const fCp = finalPartner.facturation_code_postal || '';
          const fVille = finalPartner.facturation_ville || '';
          const fPays = finalPartner.facturation_pays || '';
          const isDifferent = lRue !== fRue || lCp !== fCp || lVille !== fVille || lPays !== fPays;
          if (isDifferent && (lRue || lCp || lVille)) {
            // Construire le texte delivery_address (format VF : "Rue\nCP Ville\nPays")
            const lines = [];
            if (lRue) lines.push(lRue);
            if (lCp || lVille) lines.push([lCp, lVille].filter(Boolean).join(' '));
            if (lPays) lines.push(lPays);
            vfData.use_delivery_address = true;
            vfData.delivery_address = lines.join('\n');
          } else {
            // Adresses identiques → désactiver l'adresse de livraison séparée
            vfData.use_delivery_address = false;
            vfData.delivery_address = '';
          }
        }

        if (Object.keys(vfData).length > 0) {
          try {
            const vfService = require('../services/vosfacturesService')(db);
            await vfService.updateClient(partner.vf_client_id, vfData);
          } catch (vfErr) {
            const logger = require('../config/logger');
            logger.error('Erreur sync VF lors validation profil', { error: vfErr.message, partnerId, vfData });
          }
        }
      }

      // Marquer la demande comme validée
      db.prepare("UPDATE partner_profile_changes SET statut = 'validee', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?").run(req.user?.email || 'admin', row.id);

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/partners/:id/reject-profile-change', (req, res) => {
    try {
      const partnerId = req.params.id;
      const row = db.prepare("SELECT * FROM partner_profile_changes WHERE partner_id = ? AND statut = 'en_attente' ORDER BY created_at DESC LIMIT 1").get(partnerId);
      if (!row) return res.status(404).json({ erreur: 'Aucune demande en attente' });

      db.prepare("UPDATE partner_profile_changes SET statut = 'refusee', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ?").run(req.user?.email || 'admin', row.id);

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
