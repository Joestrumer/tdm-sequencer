/**
 * partnerPortal.js — Routes API portail partenaire (login, catalogue, commande)
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const partnerAuth = require('../middleware/partnerAuth');
const { normalizeRef, calculerRemise } = require('../services/productMatchingService');
const logger = require('../config/logger');
const brevoService = require('../services/brevoService');

const DEFAULT_FRANCO_SEUIL = 800;

// Rate limiter simple : max 10 commandes par minute par partenaire
const orderRateMap = new Map();
function checkOrderRateLimit(partnerId) {
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const max = 10;
  let entries = orderRateMap.get(partnerId) || [];
  entries = entries.filter(t => t > now - windowMs);
  if (entries.length >= max) return false;
  entries.push(now);
  orderRateMap.set(partnerId, entries);
  // Nettoyage périodique des anciennes entrées
  if (orderRateMap.size > 500) {
    for (const [k, v] of orderRateMap) {
      if (v.every(t => t < now - windowMs)) orderRateMap.delete(k);
    }
  }
  return true;
}

// Helper : envoyer une notification admin pour une commande partenaire
function notifierAdminCommande({ partner, orderProducts, totalHT, totalHTWithFrais, totalTTC, fraisRef, fraisNom, fraisMontant, notes, orderId, sujet }) {
  setImmediate(async () => {
    try {
      const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const adminEmail = process.env.ADMIN_EMAIL || 'hugo@terredemars.com';
      const productRows = orderProducts.map(p =>
        `<tr><td style="padding:6px 12px;border:1px solid #e2e8f0">${esc(p.ref)}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${esc(p.nom)}</td><td style="padding:6px 12px;border:1px solid #e2e8f0;text-align:center">${p.quantite}</td><td style="padding:6px 12px;border:1px solid #e2e8f0;text-align:right">${p.prix_remise.toFixed(2)} &euro;</td><td style="padding:6px 12px;border:1px solid #e2e8f0;text-align:right">${p.total_ht.toFixed(2)} &euro;</td></tr>`
      ).join('');
      const emailHtml = `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0f172a">${esc(sujet)}</h2>
          <p><strong>Partenaire :</strong> ${esc(partner.nom)}</p>
          ${partner.contact_nom ? `<p><strong>Contact :</strong> ${esc(partner.contact_nom)}</p>` : ''}
          ${partner.email ? `<p><strong>Email :</strong> ${esc(partner.email)}</p>` : ''}
          <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
            <thead><tr style="background:#f1f5f9">
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Ref</th>
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Produit</th>
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center">Qt&eacute;</th>
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right">PU HT</th>
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right">Total HT</th>
            </tr></thead>
            <tbody>${productRows}</tbody>
          </table>
          ${totalHT != null ? `<p style="font-size:14px">Sous-total HT : ${totalHT.toFixed(2)} &euro;</p>` : ''}
          ${fraisRef ? `<p style="font-size:14px">${esc(fraisNom)} (${esc(fraisRef)}) : ${fraisMontant.toFixed(2)} &euro; HT</p>` : '<p style="font-size:14px;color:#16a34a">Exon&eacute;r&eacute; de frais</p>'}
          <p style="font-size:16px"><strong>Total HT : ${totalHTWithFrais.toFixed(2)} &euro;</strong></p>
          <p style="font-size:16px"><strong>Total TTC : ${totalTTC.toFixed(2)} &euro;</strong></p>
          ${notes ? `<p><strong>Notes :</strong> ${esc(notes)}</p>` : ''}
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
          <p style="color:#94a3b8;font-size:12px">Connectez-vous au back-office pour traiter cette commande.</p>
        </div>
      `;
      await brevoService.brevoSendEmail({
        sender: { name: 'Terre de Mars', email: process.env.BREVO_SMTP_USER || 'hugo@terredemars.com' },
        to: [{ email: adminEmail, name: 'Hugo' }],
        subject: `${sujet} — ${partner.nom}`,
        htmlContent: emailHtml,
      });
      logger.info('Email notification commande envoyé', { orderId, partner: partner.nom, type: sujet });
    } catch (emailErr) {
      logger.error('Erreur envoi email notification commande', { error: emailErr.message, stack: emailErr.stack, orderId, partner: partner.nom });
    }
  });
}

// Helper : notifier l'admin d'une demande de modification de profil partenaire
function notifierAdminModificationProfil({ partner, changes, db }) {
  setImmediate(async () => {
    try {
      const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const adminEmail = process.env.ADMIN_EMAIL || 'hugo@terredemars.com';

      const labelMap = {
        email: 'Email', contact_nom: 'Nom du contact', telephone: 'Téléphone', adresse: 'Adresse',
        livraison_prenom: 'Livraison — Prénom', livraison_nom: 'Livraison — Nom',
        livraison_telephone: 'Livraison — Téléphone', livraison_email: 'Livraison — Email',
        facturation_prenom: 'Facturation — Prénom', facturation_nom: 'Facturation — Nom',
        facturation_telephone: 'Facturation — Téléphone', facturation_email: 'Facturation — Email',
      };

      const rows = Object.entries(changes).map(([key, { ancien, nouveau }]) =>
        `<tr><td style="padding:6px 12px;border:1px solid #e2e8f0">${esc(labelMap[key] || key)}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${esc(ancien || '—')}</td><td style="padding:6px 12px;border:1px solid #e2e8f0;font-weight:600">${esc(nouveau || '—')}</td></tr>`
      ).join('');

      const emailHtml = `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0f172a">Modification profil — ${esc(partner.nom)}</h2>
          <p>Le partenaire <strong>${esc(partner.nom)}</strong> a demandé une modification de son profil.</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
            <thead><tr style="background:#f1f5f9">
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Champ</th>
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Ancienne valeur</th>
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Nouvelle valeur</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
          <p style="color:#94a3b8;font-size:12px">Connectez-vous au back-office pour valider ou refuser cette demande.</p>
        </div>
      `;
      await brevoService.brevoSendEmail({
        sender: { name: 'Terre de Mars', email: process.env.BREVO_SMTP_USER || 'hugo@terredemars.com' },
        to: [{ email: adminEmail, name: 'Hugo' }],
        subject: `Modification profil — ${partner.nom}`,
        htmlContent: emailHtml,
      });
      logger.info('Email notification modification profil envoyé', { partner: partner.nom });
    } catch (emailErr) {
      logger.error('Erreur envoi email notification modification profil', { error: emailErr.message, stack: emailErr.stack, partner: partner.nom });
    }
  });
}

module.exports = (db) => {
  const router = express.Router();

  // ─── Login (public) ───────────────────────────────────────────────────────
  router.post('/login', async (req, res) => {
    try {
      const { password } = req.body;
      if (!password) return res.status(400).json({ erreur: 'Mot de passe requis' });

      // Chercher parmi tous les partenaires actifs avec un password_hash
      const partners = db.prepare('SELECT * FROM vf_partners WHERE actif = 1 AND password_hash IS NOT NULL').all();

      let matched = null;
      for (const p of partners) {
        if (await bcrypt.compare(password, p.password_hash)) {
          matched = p;
          break;
        }
      }

      if (!matched) {
        return res.status(401).json({ erreur: 'Mot de passe incorrect' });
      }

      // Récupérer les prix FP/FE pour le calcul côté portail
      const fraisRows = db.prepare("SELECT ref, prix_ht FROM vf_catalog WHERE ref IN ('FP', 'FE')").all();
      const fraisMap = {};
      for (const r of fraisRows) fraisMap[r.ref] = r.prix_ht;

      // Compte maître : charger les sous-comptes et encoder dans le JWT
      if (matched.is_master === 1) {
        const subAccounts = db.prepare('SELECT id, nom, email, contact_nom FROM vf_partners WHERE master_id = ? AND actif = 1').all(matched.id);
        const subAccountIds = subAccounts.map(s => s.id);

        const token = jwt.sign(
          { partnerId: matched.id, partnerNom: matched.nom, isMaster: true, subAccountIds },
          partnerAuth.JWT_SECRET,
          { expiresIn: '7d' }
        );

        return res.json({
          token,
          isMaster: true,
          partenaire: {
            id: matched.id,
            nom: matched.nom,
            email: matched.email,
            contact_nom: matched.contact_nom,
            amenities: matched.amenities || null,
            franco_seuil: matched.franco_seuil ?? DEFAULT_FRANCO_SEUIL,
            frais_exonere: matched.frais_exonere ?? 0,
            exonere_fp: matched.exonere_fp ?? 0,
            exonere_fe: matched.exonere_fe ?? 0,
            fp_prix: fraisMap['FP'] || 0,
            fe_prix: (matched.frais_expedition_ht != null) ? matched.frais_expedition_ht : (fraisMap['FE'] || 0),
          },
          etablissements: subAccounts,
        });
      }

      const token = jwt.sign(
        { partnerId: matched.id, partnerNom: matched.nom },
        partnerAuth.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        token,
        partenaire: {
          id: matched.id,
          nom: matched.nom,
          email: matched.email,
          contact_nom: matched.contact_nom,
          amenities: matched.amenities || null,
          franco_seuil: matched.franco_seuil ?? DEFAULT_FRANCO_SEUIL,
          frais_exonere: matched.frais_exonere ?? 0,
          exonere_fp: matched.exonere_fp ?? 0,
          exonere_fe: matched.exonere_fe ?? 0,
          fp_prix: fraisMap['FP'] || 0,
          fe_prix: (matched.frais_expedition_ht != null) ? matched.frais_expedition_ht : (fraisMap['FE'] || 0),
        },
      });
    } catch (e) {
      logger.error('Erreur login partenaire', { error: e.message });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Routes protégées ─────────────────────────────────────────────────────
  router.use(partnerAuth);

  // ─── Guard : un master doit avoir sélectionné un établissement ──────────
  function requireEffectiveId(req, res, next) {
    if (req.partner.isMaster && !req.headers['x-acting-partner-id']) {
      return res.status(400).json({ erreur: 'Veuillez sélectionner un établissement' });
    }
    next();
  }

  // ─── Liste des établissements (master only) ─────────────────────────────
  router.get('/etablissements', (req, res) => {
    try {
      if (!req.partner.isMaster) {
        return res.status(403).json({ erreur: 'Réservé aux comptes maîtres' });
      }
      const subAccounts = db.prepare('SELECT id, nom, email, contact_nom FROM vf_partners WHERE master_id = ? AND actif = 1').all(req.partner.id);
      res.json(subAccounts);
    } catch (e) {
      logger.error('Erreur liste établissements', { error: e.message, partnerId: req.partner?.id });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Helper : résoudre remises et amenities depuis le master si applicable ──
  function getMasterDiscountsPartner(req) {
    if (req.partner.isMaster && req.headers['x-acting-partner-id']) {
      // Le master agit pour un sous-compte → utiliser les remises/amenities du master
      return db.prepare('SELECT nom, nom_normalise, promo_enabled, amenities FROM vf_partners WHERE id = ?').get(req.partner.id);
    }
    return null;
  }

  // ─── Profil ────────────────────────────────────────────────────────────────
  router.get('/profil', requireEffectiveId, (req, res) => {
    try {
      const partner = db.prepare('SELECT id, nom, email, contact_nom, telephone, adresse, amenities, franco_seuil, frais_exonere, exonere_fp, exonere_fe, frais_expedition_ht, livraison_prenom, livraison_nom, livraison_telephone, livraison_email, facturation_prenom, facturation_nom, facturation_telephone, facturation_email, facturation_rue, facturation_code_postal, facturation_ville, facturation_pays, facturation_tva, facturation_entite_publique, facturation_portable, livraison_rue, livraison_code_postal, livraison_ville, livraison_pays, livraison_portable FROM vf_partners WHERE id = ?').get(req.partner.effectiveId);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });
      // Si master agit pour un sous-compte, utiliser les amenities du master
      const masterPartner = getMasterDiscountsPartner(req);
      if (masterPartner && masterPartner.amenities) {
        partner.amenities = masterPartner.amenities;
      }
      // Ajouter les prix FP/FE pour le calcul côté portail (1 seule requête)
      const fraisRows = db.prepare("SELECT ref, prix_ht FROM vf_catalog WHERE ref IN ('FP', 'FE')").all();
      const fraisMap = {};
      for (const r of fraisRows) fraisMap[r.ref] = r.prix_ht;
      partner.fp_prix = fraisMap['FP'] || 0;
      partner.fe_prix = (partner.frais_expedition_ht != null) ? partner.frais_expedition_ht : (fraisMap['FE'] || 0);
      partner.exonere_fp = partner.exonere_fp ?? 0;
      partner.exonere_fe = partner.exonere_fe ?? 0;
      res.json(partner);
    } catch (e) {
      logger.error('Erreur profil partenaire', { error: e.message, partnerId: req.partner?.id });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Mise à jour profil (crée une demande de validation au lieu de modifier directement) ──
  router.patch('/profil', requireEffectiveId, (req, res) => {
    try {
      const allowed = ['email', 'contact_nom', 'telephone', 'adresse', 'livraison_prenom', 'livraison_nom', 'livraison_telephone', 'livraison_email', 'facturation_prenom', 'facturation_nom', 'facturation_telephone', 'facturation_email', 'facturation_rue', 'facturation_code_postal', 'facturation_ville', 'facturation_pays', 'facturation_tva', 'facturation_entite_publique', 'facturation_portable', 'livraison_rue', 'livraison_code_postal', 'livraison_ville', 'livraison_pays', 'livraison_portable'];
      const partner = db.prepare('SELECT * FROM vf_partners WHERE id = ?').get(req.partner.effectiveId);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      // Comparer chaque champ soumis avec la valeur actuelle
      const changes = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          const ancien = partner[key] || '';
          const nouveau = req.body[key] || '';
          if (ancien !== nouveau) {
            changes[key] = { ancien, nouveau };
          }
        }
      }

      if (Object.keys(changes).length === 0) {
        return res.json({ ok: true, message: 'Aucune modification' });
      }

      // Supprimer toute demande en_attente existante (remplacée par la nouvelle)
      db.prepare("DELETE FROM partner_profile_changes WHERE partner_id = ? AND statut = 'en_attente'").run(req.partner.effectiveId);

      // Insérer la nouvelle demande
      db.prepare('INSERT INTO partner_profile_changes (partner_id, changes) VALUES (?, ?)').run(req.partner.effectiveId, JSON.stringify(changes));

      // Notification admin (fire-and-forget)
      notifierAdminModificationProfil({ partner, changes, db });

      res.json({ ok: true, pending: true, message: 'Modifications soumises pour validation' });
    } catch (e) {
      logger.error('Erreur mise à jour profil', { error: e.message, partnerId: req.partner?.id });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Demande de modification en attente ────────────────────────────────────
  router.get('/profil/pending', requireEffectiveId, (req, res) => {
    try {
      const row = db.prepare("SELECT * FROM partner_profile_changes WHERE partner_id = ? AND statut = 'en_attente' ORDER BY created_at DESC LIMIT 1").get(req.partner.effectiveId);
      res.json(row || null);
    } catch (e) {
      logger.error('Erreur profil pending', { error: e.message, partnerId: req.partner?.id });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Catalogue ─────────────────────────────────────────────────────────────
  router.get('/catalogue', requireEffectiveId, (req, res) => {
    try {
      const partnerId = req.partner.effectiveId;
      const partner = db.prepare('SELECT nom, nom_normalise, promo_enabled FROM vf_partners WHERE id = ?').get(partnerId);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      // Si master agit pour un sous-compte, utiliser les remises/promos du master
      const masterPartner = getMasterDiscountsPartner(req);
      const discountSource = masterPartner || partner;

      // Produits actifs (exclure FP et FE)
      const products = db.prepare("SELECT * FROM vf_catalog WHERE actif = 1 AND ref NOT IN ('FP', 'FE') ORDER BY sort_order, ref").all();

      // Remises du partenaire (ou du master si applicable)
      let discounts = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ?').all(discountSource.nom);
      if (discounts.length === 0) {
        discounts = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ? COLLATE NOCASE').all(discountSource.nom_normalise);
      }

      // Promotions flash (désactivées si promo_enabled = 0 sur le partenaire/master)
      const partnerPromoEnabled = discountSource.promo_enabled ?? 1;
      const promoActiveRow = db.prepare("SELECT valeur FROM config WHERE cle = 'promo_active'").get();
      const promoActive = promoActiveRow?.valeur === '1' && partnerPromoEnabled === 1;
      const promoTitleRow = db.prepare("SELECT valeur FROM config WHERE cle = 'promo_title'").get();
      const promoTitle = promoTitleRow?.valeur || 'Promotions du moment';
      let promos = [];
      if (promoActive) {
        promos = db.prepare('SELECT * FROM partner_promotions').all();
      }

      const catalogue = products.map(p => {
        const discount = discounts.find(d => normalizeRef(d.product_code) === normalizeRef(p.ref));
        const discount_pct = discount ? discount.discount_pct : 0;
        const prix_remise = p.prix_ht * (1 - discount_pct / 100);
        const entry = {
          ref: p.ref,
          nom: p.nom,
          prix_ht: p.prix_ht,
          prix_remise: Math.round(prix_remise * 100) / 100,
          discount_pct,
          tva: p.tva,
          moq: p.moq || 1,
          categorie: p.categorie || null,
          image_url: p.image_url || null,
        };
        // Ajouter info promo si active
        if (promoActive) {
          const promo = promos.find(pr => normalizeRef(pr.ref) === normalizeRef(p.ref));
          if (promo) {
            entry.promo_pct = promo.discount_pct;
            entry.prix_promo = Math.round(entry.prix_remise * (1 - promo.discount_pct / 100) * 100) / 100;
          }
        }
        return entry;
      });

      res.json({ catalogue, promo_active: promoActive, promo_title: promoTitle });
    } catch (e) {
      logger.error('Erreur catalogue partenaire', { error: e.message, partnerId: req.partner?.id });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Créer commande ────────────────────────────────────────────────────────
  router.post('/commande', requireEffectiveId, async (req, res) => {
    try {
      const { products, notes } = req.body;
      if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ erreur: 'Au moins un produit requis' });
      }
      if (products.length > 200) {
        return res.status(400).json({ erreur: 'Maximum 200 produits par commande' });
      }
      // Rate limiting
      if (!checkOrderRateLimit(req.partner.effectiveId)) {
        return res.status(429).json({ erreur: 'Trop de commandes. Veuillez patienter une minute.' });
      }
      // Valider les quantités
      for (const p of products) {
        const qty = parseInt(p.quantite);
        if (!p.ref || typeof p.ref !== 'string') return res.status(400).json({ erreur: 'Référence produit manquante' });
        if (!qty || qty < 1 || qty > 99999) return res.status(400).json({ erreur: `Quantité invalide pour ${p.ref}: ${p.quantite}` });
      }

      const partnerId = req.partner.effectiveId;
      const partner = db.prepare('SELECT * FROM vf_partners WHERE id = ?').get(partnerId);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      // Si master agit pour un sous-compte, utiliser les remises/promos du master
      const masterPartner = getMasterDiscountsPartner(req);
      const discountSource = masterPartner || partner;

      // Récupérer catalogue et remises (exclure FP/FE)
      const catalog = {};
      for (const p of db.prepare("SELECT * FROM vf_catalog WHERE actif = 1 AND ref NOT IN ('FP', 'FE') ORDER BY sort_order, ref").all()) {
        catalog[p.ref] = p;
      }
      let discounts = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ?').all(discountSource.nom);
      if (discounts.length === 0) discounts = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ? COLLATE NOCASE').all(discountSource.nom_normalise);

      // Promotions flash (cumulables, désactivées si promo_enabled = 0 sur le master/partenaire)
      const partnerPromoEnabled = discountSource.promo_enabled ?? 1;
      const promoActiveRow = db.prepare("SELECT valeur FROM config WHERE cle = 'promo_active'").get();
      const promoActive = promoActiveRow?.valeur === '1' && partnerPromoEnabled === 1;
      let promos = [];
      if (promoActive) {
        promos = db.prepare('SELECT * FROM partner_promotions').all();
      }

      // Calculer les produits avec prix remisés + promo
      let totalHT = 0;
      let totalTVA = 0;
      const orderProducts = products.map(item => {
        const catEntry = catalog[item.ref];
        if (!catEntry) throw new Error(`Produit inconnu: ${item.ref}`);
        const qty = item.quantite || 1;
        const discount = discounts.find(d => normalizeRef(d.product_code) === normalizeRef(item.ref));
        const discount_pct = discount ? discount.discount_pct : 0;
        const prix_remise = catEntry.prix_ht * (1 - discount_pct / 100);
        // Promo flash cumulée
        const promo = promos.find(pr => normalizeRef(pr.ref) === normalizeRef(item.ref));
        const promo_pct = promo ? promo.discount_pct : 0;
        const prix_final = promo_pct > 0 ? prix_remise * (1 - promo_pct / 100) : prix_remise;
        const lineHT = Math.round(prix_final * qty * 100) / 100;
        const tva = catEntry.tva || 20;
        totalHT += lineHT;
        totalTVA += lineHT * (tva / 100);
        const result = {
          ref: item.ref,
          nom: catEntry.nom,
          quantite: qty,
          prix_ht: catEntry.prix_ht,
          prix_remise: Math.round(prix_final * 100) / 100,
          discount_pct,
          tva,
          total_ht: lineHT,
        };
        if (promo_pct > 0) result.promo_pct = promo_pct;
        return result;
      });

      totalHT = Math.round(totalHT * 100) / 100;

      // Frais FP/FE : exonérations séparées (exonere_fp / exonere_fe) + ancien flag global frais_exonere
      const francoSeuil = partner.franco_seuil ?? DEFAULT_FRANCO_SEUIL;
      const globalExonere = partner.frais_exonere ?? 0;
      const exonereFP = globalExonere || (partner.exonere_fp ?? 0);
      const exonereFE = globalExonere || (partner.exonere_fe ?? 0);
      let fraisRef = null;
      let fraisNom = '';
      let fraisMontant = 0;
      let fraisTvaRate = 20;
      {
        const fraisRows = db.prepare("SELECT ref, prix_ht, nom, tva FROM vf_catalog WHERE ref IN ('FP', 'FE')").all();
        const fraisMap = {};
        for (const r of fraisRows) fraisMap[r.ref] = r;
        if (totalHT >= francoSeuil) {
          if (!exonereFP) {
            fraisRef = 'FP'; fraisNom = fraisMap['FP']?.nom || 'Frais de préparation'; fraisMontant = fraisMap['FP']?.prix_ht || 0;
          }
        } else {
          if (!exonereFE) {
            fraisRef = 'FE'; fraisNom = fraisMap['FE']?.nom || "Frais d'expédition";
            fraisMontant = (partner.frais_expedition_ht != null) ? partner.frais_expedition_ht : (fraisMap['FE']?.prix_ht || 0);
          }
        }
        if (fraisRef) {
          fraisTvaRate = (fraisMap[fraisRef]?.tva) || 20;
          totalTVA += fraisMontant * (fraisTvaRate / 100);
        }
      }
      const totalHTWithFrais = Math.round((totalHT + fraisMontant) * 100) / 100;
      const totalTTC = Math.round((totalHTWithFrais + totalTVA) * 100) / 100;

      const orderId = uuidv4();
      db.prepare(`
        INSERT INTO partner_orders (id, partner_id, products, notes, total_ht, total_ttc, subtotal_ht, frais_ref, frais_montant, frais_tva)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderId, partnerId, JSON.stringify(orderProducts), notes || null, totalHTWithFrais, totalTTC, totalHT, fraisRef, fraisMontant, fraisRef ? fraisTvaRate : 0);

      // Répondre immédiatement au partenaire
      res.json({
        id: orderId,
        partner_id: partnerId,
        statut: 'en_attente',
        products: orderProducts,
        notes: notes || null,
        total_ht: totalHTWithFrais,
        total_ttc: totalTTC,
        subtotal_ht: totalHT,
        frais_ref: fraisRef,
        frais_montant: fraisMontant,
      });

      // Email notification admin (fire-and-forget)
      notifierAdminCommande({
        partner, orderProducts, totalHT, totalHTWithFrais, totalTTC,
        fraisRef, fraisNom, fraisMontant, notes, orderId,
        sujet: 'Nouvelle commande',
      });
    } catch (e) {
      logger.error('Erreur création commande partenaire', { error: e.message });
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Helper : récupérer une commande en vérifiant la propriété (master ou non) ──
  function getOrderForPartner(orderId, req) {
    if (req.partner.isMaster) {
      const allIds = [req.partner.id, ...req.partner.subAccountIds];
      const placeholders = allIds.map(() => '?').join(',');
      return db.prepare(`SELECT * FROM partner_orders WHERE id = ? AND partner_id IN (${placeholders})`).get(orderId, ...allIds);
    }
    return db.prepare('SELECT * FROM partner_orders WHERE id = ? AND partner_id = ?').get(orderId, req.partner.effectiveId);
  }

  // ─── Historique commandes ──────────────────────────────────────────────────
  router.get('/commandes', (req, res) => {
    try {
      // Master : toutes les commandes de tous les sous-comptes
      // Non-master : nécessite un effectiveId
      let orders;
      if (req.partner.isMaster) {
        const allIds = [req.partner.id, ...req.partner.subAccountIds];
        const placeholders = allIds.map(() => '?').join(',');
        orders = db.prepare(`
          SELECT po.*, vp.nom AS etablissement_nom
          FROM partner_orders po
          LEFT JOIN vf_partners vp ON po.partner_id = vp.id
          WHERE po.partner_id IN (${placeholders}) AND po.statut != 'annulee'
          ORDER BY po.created_at DESC
        `).all(...allIds);
      } else {
        if (!req.partner.effectiveId) {
          return res.status(400).json({ erreur: 'Veuillez sélectionner un établissement' });
        }
        orders = db.prepare(`
          SELECT * FROM partner_orders
          WHERE partner_id = ? AND statut != 'annulee'
          ORDER BY created_at DESC
        `).all(req.partner.effectiveId);
      }

      const result = orders.map(o => {
        let tracking_url = null;
        if (o.tracking_number) {
          const t = o.tracking_number.trim();
          if (/^1Z/i.test(t)) {
            tracking_url = `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`;
          } else {
            tracking_url = `https://www.laposte.fr/outils/suivre-vos-envois?code=${encodeURIComponent(t)}`;
          }
        }
        return {
          ...o,
          products: JSON.parse(o.products || '[]'),
          tracking_url,
        };
      });

      res.json(result);
    } catch (e) {
      logger.error('Erreur historique commandes', { error: e.message, partnerId: req.partner?.id });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Annuler une commande en attente (côté partenaire) ────────────────────
  router.delete('/commande/:id', requireEffectiveId, (req, res) => {
    try {
      const order = getOrderForPartner(req.params.id, req);
      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });
      if (order.statut !== 'en_attente') return res.status(400).json({ erreur: 'Seules les commandes en attente peuvent être annulées' });

      db.prepare("UPDATE partner_orders SET statut = 'annulee_client' WHERE id = ?").run(req.params.id);

      // Notification admin
      const partner = db.prepare('SELECT * FROM vf_partners WHERE id = ?').get(order.partner_id);
      const orderProducts = JSON.parse(order.products || '[]');
      notifierAdminCommande({
        partner: partner || { nom: 'Inconnu' },
        orderProducts,
        totalHT: null,
        totalHTWithFrais: order.total_ht || 0,
        totalTTC: order.total_ttc || 0,
        fraisRef: null, fraisNom: null, fraisMontant: 0,
        notes: order.notes, orderId: req.params.id,
        sujet: 'Annulation client',
      });

      res.json({ ok: true });
    } catch (e) {
      logger.error('Erreur annulation commande', { error: e.message, orderId: req.params.id });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Modifier une commande en attente ───────────────────────────────────────
  router.patch('/commande/:id', requireEffectiveId, (req, res) => {
    try {
      const order = getOrderForPartner(req.params.id, req);
      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });
      if (order.statut !== 'en_attente') return res.status(400).json({ erreur: 'Seules les commandes en attente peuvent être modifiées' });

      const { products, notes } = req.body;
      if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ erreur: 'Au moins un produit requis' });
      }

      const partnerId = order.partner_id;
      const partner = db.prepare('SELECT * FROM vf_partners WHERE id = ?').get(partnerId);

      // Si master agit pour un sous-compte, utiliser les remises/promos du master
      const masterPartner = getMasterDiscountsPartner(req);
      const discountSource = masterPartner || partner;

      const catalog = {};
      for (const p of db.prepare("SELECT * FROM vf_catalog WHERE actif = 1 AND ref NOT IN ('FP', 'FE') ORDER BY sort_order, ref").all()) {
        catalog[p.ref] = p;
      }
      let discounts = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ?').all(discountSource.nom);
      if (discounts.length === 0) discounts = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ? COLLATE NOCASE').all(discountSource.nom_normalise);

      // Promotions flash (cumulables, désactivées si promo_enabled = 0 sur le master/partenaire)
      const partnerPromoEnabled = discountSource.promo_enabled ?? 1;
      const promoActiveRow = db.prepare("SELECT valeur FROM config WHERE cle = 'promo_active'").get();
      const promoActive = promoActiveRow?.valeur === '1' && partnerPromoEnabled === 1;
      let promos = [];
      if (promoActive) {
        promos = db.prepare('SELECT * FROM partner_promotions').all();
      }

      let totalHT = 0;
      let totalTVA = 0;
      const orderProducts = products.map(item => {
        const catEntry = catalog[item.ref];
        if (!catEntry) throw new Error(`Produit inconnu: ${item.ref}`);
        const qty = item.quantite || 1;
        const discount = discounts.find(d => normalizeRef(d.product_code) === normalizeRef(item.ref));
        const discount_pct = discount ? discount.discount_pct : 0;
        const prix_remise = catEntry.prix_ht * (1 - discount_pct / 100);
        // Promo flash cumulée
        const promo = promos.find(pr => normalizeRef(pr.ref) === normalizeRef(item.ref));
        const promo_pct = promo ? promo.discount_pct : 0;
        const prix_final = promo_pct > 0 ? prix_remise * (1 - promo_pct / 100) : prix_remise;
        const lineHT = Math.round(prix_final * qty * 100) / 100;
        const tva = catEntry.tva || 20;
        totalHT += lineHT;
        totalTVA += lineHT * (tva / 100);
        const result = { ref: item.ref, nom: catEntry.nom, quantite: qty, prix_ht: catEntry.prix_ht, prix_remise: Math.round(prix_final * 100) / 100, discount_pct, tva, total_ht: lineHT };
        if (promo_pct > 0) result.promo_pct = promo_pct;
        return result;
      });

      totalHT = Math.round(totalHT * 100) / 100;
      const francoSeuil = partner.franco_seuil ?? DEFAULT_FRANCO_SEUIL;
      const exonere = partner.frais_exonere ?? 0;
      let fraisRef = null;
      let fraisNom = '';
      let fraisMontant = 0;
      let fraisTvaRate = 20;
      if (!exonere) {
        const fraisRows = db.prepare("SELECT ref, prix_ht, nom, tva FROM vf_catalog WHERE ref IN ('FP', 'FE')").all();
        const fraisMap = {};
        for (const r of fraisRows) fraisMap[r.ref] = r;
        if (totalHT >= francoSeuil) {
          fraisRef = 'FP'; fraisNom = fraisMap['FP']?.nom || 'Frais de préparation'; fraisMontant = fraisMap['FP']?.prix_ht || 0;
        } else {
          fraisRef = 'FE'; fraisNom = fraisMap['FE']?.nom || "Frais d'expédition"; fraisMontant = fraisMap['FE']?.prix_ht || 0;
        }
        fraisTvaRate = (fraisRef && fraisMap[fraisRef]?.tva) || 20;
        totalTVA += fraisMontant * (fraisTvaRate / 100);
      }
      const totalHTWithFrais = Math.round((totalHT + fraisMontant) * 100) / 100;
      const totalTTC = Math.round((totalHTWithFrais + totalTVA) * 100) / 100;

      db.prepare('UPDATE partner_orders SET products = ?, notes = ?, total_ht = ?, total_ttc = ?, subtotal_ht = ?, frais_ref = ?, frais_montant = ?, frais_tva = ? WHERE id = ?')
        .run(JSON.stringify(orderProducts), notes || null, totalHTWithFrais, totalTTC, totalHT, fraisRef, fraisMontant, fraisRef ? fraisTvaRate : 0, req.params.id);

      // Notification admin modification
      notifierAdminCommande({
        partner, orderProducts, totalHT, totalHTWithFrais, totalTTC,
        fraisRef, fraisNom, fraisMontant, notes, orderId: req.params.id,
        sujet: 'Commande modifiée',
      });

      res.json({ ok: true });
    } catch (e) {
      // Produit inconnu = erreur client, sinon erreur serveur
      const status = e.message?.startsWith('Produit inconnu') ? 400 : 500;
      if (status === 500) logger.error('Erreur modification commande', { error: e.message, orderId: req.params.id });
      res.status(status).json({ erreur: e.message });
    }
  });

  // ─── Télécharger facture PDF (côté partenaire) ────────────────────────────
  router.get('/commande/:id/pdf', async (req, res) => {
    try {
      const order = getOrderForPartner(req.params.id, req);
      if (!order) return res.status(404).json({ erreur: 'Commande introuvable' });
      if (!order.vf_invoice_id) return res.status(400).json({ erreur: 'Pas de facture associée' });

      const token = (db.prepare("SELECT valeur FROM config WHERE cle = 'vf_api_token'").get()?.valeur || process.env.VF_API_TOKEN || '').trim();
      if (!token) return res.status(500).json({ erreur: 'Token VosFactures non configuré' });

      const vfBase = process.env.VF_BASE_URL || 'https://terredemars.vosfactures.fr';
      const pdfUrl = `${vfBase}/invoices/${order.vf_invoice_id}.pdf?api_token=${token}`;
      const pdfRes = await fetch(pdfUrl);
      if (!pdfRes.ok) return res.status(pdfRes.status).json({ erreur: 'Facture indisponible' });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="facture-${order.vf_invoice_number || order.vf_invoice_id}.pdf"`);
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      res.send(buffer);
    } catch (e) {
      logger.error('Erreur PDF partenaire', { error: e.message, orderId: req.params.id });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Documents partenaires (lecture) ────────────────────────────────────
  router.get('/documents', partnerAuth, (req, res) => {
    try {
      const rows = db.prepare('SELECT id, titre, url FROM partner_documents ORDER BY ordre, id').all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Demande de devis ────────────────────────────────────────────────────
  router.post('/devis', requireEffectiveId, (req, res) => {
    try {
      const { products, message, cadeauxVIP } = req.body;
      const productList = Array.isArray(products) ? products : [];

      const partner = db.prepare('SELECT id, nom, email, contact_nom, telephone FROM vf_partners WHERE id = ?').get(req.partner.effectiveId);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

      const productTableHtml = productList.length > 0 ? (() => {
        const productRows = productList.map(p =>
          `<tr><td style="padding:6px 12px;border:1px solid #e2e8f0">${esc(p.ref)}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${esc(p.nom)}</td><td style="padding:6px 12px;border:1px solid #e2e8f0;text-align:center">${esc(String(p.quantite))}</td></tr>`
        ).join('');
        return `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
            <thead><tr style="background:#f1f5f9">
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Ref</th>
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Produit</th>
              <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center">Quantit&eacute;</th>
            </tr></thead>
            <tbody>${productRows}</tbody>
          </table>`;
      })() : '';

      const emailHtml = `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0f172a">Demande d'&eacute;chantillons</h2>
          <p><strong>Partenaire :</strong> ${esc(partner.nom)}</p>
          ${partner.contact_nom ? `<p><strong>Contact :</strong> ${esc(partner.contact_nom)}</p>` : ''}
          ${partner.email ? `<p><strong>Email :</strong> ${esc(partner.email)}</p>` : ''}
          ${partner.telephone ? `<p><strong>T\u00e9l\u00e9phone :</strong> ${esc(partner.telephone)}</p>` : ''}
          ${message && message.trim() ? `<p><strong>Message :</strong> ${esc(message)}</p>` : ''}
          ${cadeauxVIP ? '<p style="margin:12px 0;padding:8px 14px;background:#fef9c3;border-left:3px solid #ca8a04;font-size:13px"><strong>Souhaite aussi d\u00e9couvrir les cadeaux VIP</strong></p>' : ''}
          ${productTableHtml}
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
          <p style="color:#94a3b8;font-size:12px">Demande envoy&eacute;e depuis le portail partenaire.</p>
        </div>
      `;

      const adminEmail = process.env.ADMIN_EMAIL || 'hugo@terredemars.com';

      setImmediate(async () => {
        try {
          await brevoService.brevoSendEmail({
            sender: { name: 'Terre de Mars', email: process.env.BREVO_SMTP_USER || 'hugo@terredemars.com' },
            to: [{ email: adminEmail, name: 'Hugo' }],
            subject: `Demande d'\u00e9chantillons \u2014 ${partner.nom}`,
            htmlContent: emailHtml,
          });
          logger.info('Email demande de devis envoyé', { partner: partner.nom, products: productList.length });
        } catch (emailErr) {
          logger.error('Erreur envoi email demande de devis', { error: emailErr.message, stack: emailErr.stack, partner: partner.nom });
        }
      });

      res.json({ ok: true });
    } catch (e) {
      logger.error('Erreur demande de devis', { error: e.message, partnerId: req.partner?.id });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  return router;
};
