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
        ? db.prepare('SELECT id, nom, nom_normalise, actif, email, contact_nom, telephone, adresse, shipping_id, password_hash IS NOT NULL as has_password, password_plain FROM vf_partners ORDER BY nom').all()
        : db.prepare('SELECT id, nom, nom_normalise, actif, email, contact_nom, telephone, adresse, shipping_id, password_hash IS NOT NULL as has_password, password_plain FROM vf_partners WHERE actif = 1 ORDER BY nom').all();
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

      if (updates.length === 0) return res.status(400).json({ erreur: 'Aucun champ à mettre à jour' });

      params.push(req.params.id);
      db.prepare(`UPDATE vf_partners SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Générer un mot de passe pour un partenaire
  router.post('/partners/:id/generate-password', async (req, res) => {
    try {
      const partner = db.prepare('SELECT id, nom FROM vf_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      const plainPassword = crypto.randomBytes(4).toString('hex'); // 8 caractères hex
      const hash = await bcrypt.hash(plainPassword, 10);

      db.prepare('UPDATE vf_partners SET password_hash = ?, password_plain = ? WHERE id = ?').run(hash, plainPassword, partner.id);

      res.json({
        ok: true,
        password: plainPassword,
        message: `Mot de passe généré pour ${partner.nom}. Copiez-le maintenant, il ne sera plus affiché.`,
      });
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
