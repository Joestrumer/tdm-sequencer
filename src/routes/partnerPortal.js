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
        },
      });
    } catch (e) {
      logger.error('Erreur login partenaire', { error: e.message });
      res.status(500).json({ erreur: 'Erreur serveur' });
    }
  });

  // ─── Routes protégées ─────────────────────────────────────────────────────
  router.use(partnerAuth);

  // ─── Profil ────────────────────────────────────────────────────────────────
  router.get('/profil', (req, res) => {
    try {
      const partner = db.prepare('SELECT id, nom, email, contact_nom, telephone, adresse FROM vf_partners WHERE id = ?').get(req.partner.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });
      res.json(partner);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Catalogue ─────────────────────────────────────────────────────────────
  router.get('/catalogue', (req, res) => {
    try {
      const partnerId = req.partner.id;
      const partner = db.prepare('SELECT nom, nom_normalise FROM vf_partners WHERE id = ?').get(partnerId);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      // Produits actifs
      const products = db.prepare('SELECT * FROM vf_catalog WHERE actif = 1').all();

      // Remises du partenaire (utilise nom_normalise comme client_name)
      const discounts = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ?').all(partner.nom_normalise);

      const catalogue = products.map(p => {
        const discount = discounts.find(d => normalizeRef(d.product_code) === normalizeRef(p.ref));
        const discount_pct = discount ? discount.discount_pct : 0;
        const prix_remise = p.prix_ht * (1 - discount_pct / 100);
        return {
          ref: p.ref,
          nom: p.nom,
          prix_ht: p.prix_ht,
          prix_remise: Math.round(prix_remise * 100) / 100,
          discount_pct,
          tva: p.tva,
        };
      });

      res.json(catalogue);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Créer commande ────────────────────────────────────────────────────────
  router.post('/commande', async (req, res) => {
    try {
      const { products, notes } = req.body;
      if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ erreur: 'Au moins un produit requis' });
      }

      const partnerId = req.partner.id;
      const partner = db.prepare('SELECT * FROM vf_partners WHERE id = ?').get(partnerId);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      // Récupérer catalogue et remises
      const catalog = {};
      for (const p of db.prepare('SELECT * FROM vf_catalog WHERE actif = 1').all()) {
        catalog[p.ref] = p;
      }
      const discounts = db.prepare('SELECT * FROM vf_client_discounts WHERE client_name = ?').all(partner.nom_normalise);

      // Calculer les produits avec prix remisés
      let totalHT = 0;
      const orderProducts = products.map(item => {
        const catEntry = catalog[item.ref];
        if (!catEntry) throw new Error(`Produit inconnu: ${item.ref}`);
        const qty = item.quantite || 1;
        const discount = discounts.find(d => normalizeRef(d.product_code) === normalizeRef(item.ref));
        const discount_pct = discount ? discount.discount_pct : 0;
        const prix_remise = catEntry.prix_ht * (1 - discount_pct / 100);
        const lineHT = Math.round(prix_remise * qty * 100) / 100;
        totalHT += lineHT;
        return {
          ref: item.ref,
          nom: catEntry.nom,
          quantite: qty,
          prix_ht: catEntry.prix_ht,
          prix_remise: Math.round(prix_remise * 100) / 100,
          discount_pct,
          total_ht: lineHT,
        };
      });

      const totalTTC = Math.round(totalHT * 1.2 * 100) / 100;
      totalHT = Math.round(totalHT * 100) / 100;

      const orderId = uuidv4();
      db.prepare(`
        INSERT INTO partner_orders (id, partner_id, products, notes, total_ht, total_ttc)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(orderId, partnerId, JSON.stringify(orderProducts), notes || null, totalHT, totalTTC);

      // Email notification admin
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: 'smtp-relay.brevo.com',
          port: 587,
          auth: {
            user: process.env.BREVO_SMTP_USER || 'hugo@terredemars.com',
            pass: process.env.BREVO_SMTP_KEY,
          },
        });

        const adminEmail = process.env.ADMIN_EMAIL || 'hugo@terredemars.com';
        const productRows = orderProducts.map(p =>
          `<tr><td style="padding:6px 12px;border:1px solid #e2e8f0">${p.ref}</td><td style="padding:6px 12px;border:1px solid #e2e8f0">${p.nom}</td><td style="padding:6px 12px;border:1px solid #e2e8f0;text-align:center">${p.quantite}</td><td style="padding:6px 12px;border:1px solid #e2e8f0;text-align:right">${p.prix_remise.toFixed(2)} &euro;</td><td style="padding:6px 12px;border:1px solid #e2e8f0;text-align:right">${p.total_ht.toFixed(2)} &euro;</td></tr>`
        ).join('');

        await transporter.sendMail({
          from: `"Terre de Mars" <${process.env.BREVO_SMTP_USER || 'hugo@terredemars.com'}>`,
          to: adminEmail,
          subject: `Nouvelle commande — ${partner.nom}`,
          html: `
            <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#0f172a">Nouvelle commande partenaire</h2>
              <p><strong>Partenaire :</strong> ${partner.nom}</p>
              ${partner.contact_nom ? `<p><strong>Contact :</strong> ${partner.contact_nom}</p>` : ''}
              ${partner.email ? `<p><strong>Email :</strong> ${partner.email}</p>` : ''}
              <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
                <thead><tr style="background:#f1f5f9">
                  <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Ref</th>
                  <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:left">Produit</th>
                  <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:center">Qté</th>
                  <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right">PU HT</th>
                  <th style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right">Total HT</th>
                </tr></thead>
                <tbody>${productRows}</tbody>
              </table>
              <p style="font-size:16px"><strong>Total HT : ${totalHT.toFixed(2)} &euro;</strong></p>
              <p style="font-size:16px"><strong>Total TTC : ${totalTTC.toFixed(2)} &euro;</strong></p>
              ${notes ? `<p><strong>Notes :</strong> ${notes}</p>` : ''}
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
              <p style="color:#94a3b8;font-size:12px">Connectez-vous au back-office pour traiter cette commande.</p>
            </div>
          `,
        });
        logger.info('Email notification commande envoyé', { orderId, partner: partner.nom });
      } catch (emailErr) {
        logger.warn('Erreur envoi email notification commande', { error: emailErr.message });
      }

      res.json({
        id: orderId,
        partner_id: partnerId,
        statut: 'en_attente',
        products: orderProducts,
        notes: notes || null,
        total_ht: totalHT,
        total_ttc: totalTTC,
      });
    } catch (e) {
      logger.error('Erreur création commande partenaire', { error: e.message });
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Historique commandes ──────────────────────────────────────────────────
  router.get('/commandes', (req, res) => {
    try {
      const orders = db.prepare(`
        SELECT * FROM partner_orders
        WHERE partner_id = ?
        ORDER BY created_at DESC
      `).all(req.partner.id);

      const result = orders.map(o => ({
        ...o,
        products: JSON.parse(o.products || '[]'),
      }));

      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
