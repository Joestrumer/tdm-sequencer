/**
 * referenceData.js — CRUD catalogues, partenaires, remises, mappings
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

module.exports = (db) => {
  const router = express.Router();

  // ─── Catalogue ────────────────────────────────────────────────────────────

  router.get('/catalog', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM vf_catalog WHERE actif = 1 ORDER BY ref').all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/catalog', (req, res) => {
    try {
      const { ref, vf_product_id, nom, prix_ht, tva, csv_ref, vf_ref, actif } = req.body;
      db.prepare(`
        INSERT INTO vf_catalog (ref, vf_product_id, nom, prix_ht, tva, csv_ref, vf_ref, actif)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ref) DO UPDATE SET
          vf_product_id = excluded.vf_product_id, nom = excluded.nom,
          prix_ht = excluded.prix_ht, tva = excluded.tva,
          csv_ref = excluded.csv_ref, vf_ref = excluded.vf_ref,
          actif = excluded.actif
      `).run(ref, vf_product_id || null, nom, prix_ht, tva || 20, csv_ref || null, vf_ref || null, actif ?? 1);
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
      const allowedFields = ['nom', 'prix_ht', 'csv_ref', 'vf_ref', 'moq', 'categorie', 'tva', 'vf_product_id'];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates.push(`${field} = ?`);
          params.push(req.body[field]);
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
      db.prepare('DELETE FROM vf_catalog WHERE ref = ?').run(req.params.ref);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Partenaires ──────────────────────────────────────────────────────────

  router.get('/partners', (req, res) => {
    try {
      const { all } = req.query;
      const rows = all === '1'
        ? db.prepare('SELECT id, nom, nom_normalise, actif, email, contact_nom, telephone, adresse, shipping_id, vf_client_id, password_hash IS NOT NULL as has_password, password_plain, amenities, franco_seuil, frais_port, vf_display_name FROM vf_partners ORDER BY nom').all()
        : db.prepare('SELECT id, nom, nom_normalise, actif, email, contact_nom, telephone, adresse, shipping_id, vf_client_id, password_hash IS NOT NULL as has_password, password_plain, amenities, franco_seuil, frais_port, vf_display_name FROM vf_partners WHERE actif = 1 ORDER BY nom').all();
      res.json(rows);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/partners', (req, res) => {
    try {
      const { nom, nom_normalise } = req.body;
      db.prepare(`
        INSERT INTO vf_partners (nom, nom_normalise)
        VALUES (?, ?)
        ON CONFLICT(nom) DO UPDATE SET nom_normalise = excluded.nom_normalise
      `).run(nom, nom_normalise || nom.toLowerCase());
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Mettre à jour les champs d'un partenaire
  router.patch('/partners/:id', (req, res) => {
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
      if (req.body.vf_display_name !== undefined) { updates.push('vf_display_name = ?'); params.push(req.body.vf_display_name || null); }

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

      res.json({ ok: true });
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
          const portalUrl = (process.env.PUBLIC_URL || 'https://tdm-sequencer-production.up.railway.app') + '/partenaire';
          const payload = {
            sender: brevoService.SENDER,
            to: [{ email: partner.email, name: partner.nom }],
            subject: 'Terre de Mars — Votre accès portail partenaire',
            htmlContent: `
              <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px;">
                <div style="background: #1e293b; border-radius: 12px; padding: 32px; color: white;">
                  <h2 style="margin: 0 0 8px; font-size: 18px;">Terre de Mars</h2>
                  <p style="color: #94a3b8; margin: 0 0 24px; font-size: 14px;">Espace Partenaire</p>
                  <p style="font-size: 14px; line-height: 1.6; color: #e2e8f0;">Bonjour,</p>
                  <p style="font-size: 14px; line-height: 1.6; color: #e2e8f0;">Votre mot de passe pour accéder au portail partenaire Terre de Mars :</p>
                  <div style="background: #0f172a; border-radius: 8px; padding: 16px; margin: 16px 0; text-align: center;">
                    <code style="font-size: 20px; letter-spacing: 2px; color: #10b981;">${plainPassword}</code>
                  </div>
                  <p style="font-size: 14px; line-height: 1.6; color: #e2e8f0;">Accédez au portail :</p>
                  <a href="${portalUrl}" style="display: inline-block; background: #10b981; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; margin: 8px 0 16px;">Ouvrir le portail</a>
                  <p style="font-size: 12px; color: #64748b; margin-top: 24px;">Terre de Mars — Cosmétiques d'exception pour l'hôtellerie</p>
                </div>
              </div>`,
            replyTo: { email: brevoService.SENDER.email, name: brevoService.SENDER.name },
          };
          await brevoService.brevoSendEmail(payload);
          emailSent = true;
        } catch (emailErr) {
          console.error('Erreur envoi email mot de passe:', emailErr.message);
        }
      }

      res.json({
        ok: true,
        password: plainPassword,
        emailSent,
        message: `Mot de passe généré pour ${partner.nom}.` + (emailSent ? ' Email envoyé.' : ''),
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

  router.delete('/partners/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM vf_partners WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
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
      for (const p of existingPartners) {
        partnerByNom[p.nom.toLowerCase()] = p;
        if (p.nom_normalise) partnerByNom[p.nom_normalise.toLowerCase()] = p;
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
          vf_display_name = COALESCE(?, vf_display_name)
        WHERE id = ?
      `);

      const insertStmt = db.prepare(`
        INSERT INTO vf_partners (nom, nom_normalise, email, contact_nom, telephone, adresse, vf_client_id, actif)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(nom) DO UPDATE SET
          nom_normalise = excluded.nom_normalise,
          email = COALESCE(excluded.email, vf_partners.email),
          contact_nom = COALESCE(excluded.contact_nom, vf_partners.contact_nom),
          telephone = COALESCE(excluded.telephone, vf_partners.telephone),
          adresse = COALESCE(excluded.adresse, vf_partners.adresse),
          vf_client_id = COALESCE(excluded.vf_client_id, vf_partners.vf_client_id)
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
        const adresse = [street, postCode, city].filter(Boolean).join(', ') || null;

        // Mettre à jour le vf_client_id dans les mappings
        if (vfId) {
          updateMappingStmt.run(vfId, vfName);
        }

        // Trouver le partenaire local correspondant
        // 1. Match direct par nom
        let partner = partnerByNom[vfName.toLowerCase()];

        // 2. Match via vf_client_mappings (vf_name → file_name → partner.nom)
        if (!partner) {
          const mapping = mappingByVfName[vfName.toLowerCase()];
          if (mapping && mapping.file_name) {
            partner = partnerByNom[mapping.file_name.toLowerCase()];
          }
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
          insertStmt.run(vfName, nomNormalise, email, contactName, phone, adresse, vfId);
          created++;
        }
      }

      // Recharger pour retourner le total
      const total = db.prepare('SELECT COUNT(*) as n FROM vf_partners WHERE actif = 1').get().n;

      res.json({
        ok: true,
        vf_clients: vfClients.length,
        updated,
        created,
        total_partenaires: total,
      });
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

  return router;
};
