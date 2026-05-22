/**
 * shipments.js — Routes API pour la gestion des envois
 */

const express = require('express');
const wmsService = require('../services/wmsService');
const carrierTracking = require('../services/carrierTrackingService');

// Valeurs "unknown" à traiter comme NULL
const JUNK = new Set(['unknown', 'undefined', 'null', 'n/a', '0', '']);
const clean = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  return JUNK.has(s.toLowerCase()) ? null : s;
};

module.exports = (db) => {
  // Nettoyage des "unknown" existants au démarrage
  db.prepare(`UPDATE shipments SET wms_status = NULL, wms_status_code = NULL WHERE LOWER(wms_status) IN ('unknown', 'undefined', '0')`).run();
  db.prepare(`UPDATE shipments SET tracking_number = NULL WHERE LOWER(tracking_number) IN ('unknown', 'undefined', '0')`).run();
  db.prepare(`UPDATE shipments SET carrier_name = NULL WHERE LOWER(carrier_name) IN ('unknown', 'undefined', '0')`).run();
  // Réinitialiser last_wms_check des entrées nettoyées pour forcer un re-check
  db.prepare(`UPDATE shipments SET last_wms_check = NULL WHERE wms_status IS NULL AND last_wms_check IS NOT NULL`).run();

  const router = express.Router();

  // ─── Liste tous les envois ──────────────────────────────────────────────────
  router.get('/', (req, res) => {
    try {
      const { type, limit, offset } = req.query;
      let query = 'SELECT * FROM shipments';
      const params = [];

      if (type) {
        query += ' WHERE type = ?';
        params.push(type);
      }

      query += ' ORDER BY created_at DESC';

      if (limit) {
        query += ' LIMIT ?';
        params.push(parseInt(limit));
        if (offset) {
          query += ' OFFSET ?';
          params.push(parseInt(offset));
        }
      }

      const shipments = db.prepare(query).all(...params);
      const total = db.prepare(`SELECT COUNT(*) as count FROM shipments${type ? ' WHERE type = ?' : ''}`).get(...(type ? [type] : [])).count;

      res.json({ shipments, total });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Créer un nouvel envoi ──────────────────────────────────────────────────
  router.post('/', (req, res) => {
    try {
      const {
        type,
        order_ref,
        invoice_id,
        invoice_number,
        client_name,
        client_email,
        client_address,
        client_city,
        client_country,
        shipping_id,
        shipping_name,
        montant_ht,
        montant_ttc,
        notes,
        meta
      } = req.body;

      if (!type || !order_ref || !client_name || !shipping_id) {
        return res.status(400).json({ erreur: 'Champs requis : type, order_ref, client_name, shipping_id' });
      }

      if (!['commande', 'echantillon'].includes(type)) {
        return res.status(400).json({ erreur: 'Type doit être "commande" ou "echantillon"' });
      }

      const result = db.prepare(`
        INSERT INTO shipments (
          type, order_ref, invoice_id, invoice_number,
          client_name, client_email, client_address, client_city, client_country,
          shipping_id, shipping_name, montant_ht, montant_ttc, notes, meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        type, order_ref, invoice_id, invoice_number,
        client_name, client_email, client_address, client_city, client_country || 'FR',
        shipping_id, shipping_name, montant_ht || 0, montant_ttc || 0,
        notes, meta ? JSON.stringify(meta) : null
      );

      // Lookup lead par email → stocker prénom + mettre statut "Échantillon envoyé"
      if (type === 'echantillon' && client_email) {
        try {
          const lead = db.prepare("SELECT id, prenom, statut FROM leads WHERE email = ? LIMIT 1").get(client_email);
          if (lead) {
            if (lead.prenom) {
              db.prepare("UPDATE shipments SET client_prenom = ? WHERE id = ?").run(lead.prenom, result.lastInsertRowid);
            }
            const preserveStatuts = ['Converti', 'Désabonné', 'Closed Lost'];
            if (!preserveStatuts.includes(lead.statut)) {
              db.prepare("UPDATE leads SET statut = 'Échantillon envoyé', updated_at = datetime('now') WHERE id = ?").run(lead.id);
            }
          }
        } catch (_) {}
      }

      const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(result.lastInsertRowid);

      // Check WMS en arrière-plan (ne bloque pas la réponse)
      (async () => {
        try {
          const wmsInfo = await wmsService.getFullInfo(db, order_ref);
          const status = clean(wmsInfo.status?.libelle_etat) || clean(wmsInfo.status?.code_etat);
          const statusCode = clean(wmsInfo.status?.code_etat);
          const trackingNumber = clean(wmsInfo.tracking?.tracking);
          const carrierName = clean(wmsInfo.tracking?.transporteur);
          db.prepare(`
            UPDATE shipments
            SET wms_status = ?, wms_status_code = ?, tracking_number = ?,
                carrier_name = ?, last_wms_check = datetime('now')
            WHERE id = ?
          `).run(status, statusCode, trackingNumber, carrierName, result.lastInsertRowid);
        } catch (e) {
          // Pas bloquant — le cron rattrapera
        }
      })();

      res.json({ ok: true, shipment });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Mettre à jour le statut WMS d'un envoi ─────────────────────────────────
  router.post('/:id/refresh-wms', async (req, res) => {
    try {
      const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
      if (!shipment) {
        return res.status(404).json({ erreur: 'Envoi non trouvé' });
      }

      // Récupérer les infos WMS
      const wmsInfo = await wmsService.getFullInfo(db, shipment.order_ref);

      // Extraire les données pertinentes (filtrer "unknown")
      const status = clean(wmsInfo.status?.libelle_etat) || clean(wmsInfo.status?.code_etat);
      const statusCode = clean(wmsInfo.status?.code_etat);
      const trackingNumber = clean(wmsInfo.tracking?.tracking);
      const carrierName = clean(wmsInfo.tracking?.transporteur);

      // Mettre à jour la DB
      db.prepare(`
        UPDATE shipments
        SET wms_status = ?, wms_status_code = ?, tracking_number = ?,
            carrier_name = ?, last_wms_check = datetime('now')
        WHERE id = ?
      `).run(status, statusCode, trackingNumber, carrierName, req.params.id);

      const updated = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);

      res.json({ ok: true, shipment: updated, wmsInfo });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Rafraîchir tous les envois en attente ──────────────────────────────────
  router.post('/refresh-all', async (req, res) => {
    try {
      // Récupérer les envois non livrés (codes 9/10 = livré) et vérifiés il y a plus de 1h
      const shipments = db.prepare(`
        SELECT * FROM shipments
        WHERE (wms_status_code IS NULL OR wms_status_code NOT IN ('9', '10'))
          AND (last_wms_check IS NULL OR last_wms_check < datetime('now', '-1 hour'))
        ORDER BY created_at DESC
        LIMIT 50
      `).all();

      const results = [];
      for (const shipment of shipments) {
        try {
          const wmsInfo = await wmsService.getFullInfo(db, shipment.order_ref);
          const status = clean(wmsInfo.status?.libelle_etat) || clean(wmsInfo.status?.code_etat);
          const statusCode = clean(wmsInfo.status?.code_etat);
          const trackingNumber = clean(wmsInfo.tracking?.tracking);
          const carrierName = clean(wmsInfo.tracking?.transporteur);

          db.prepare(`
            UPDATE shipments
            SET wms_status = ?, wms_status_code = ?, tracking_number = ?,
                carrier_name = ?, last_wms_check = datetime('now')
            WHERE id = ?
          `).run(status, statusCode, trackingNumber, carrierName, shipment.id);

          results.push({ id: shipment.id, ok: true, status });
        } catch (e) {
          results.push({ id: shipment.id, ok: false, erreur: e.message });
        }
      }

      res.json({ ok: true, updated: results.length, results });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Statistiques CA ─────────────────────────────────────────────────────────
  router.get('/stats', (req, res) => {
    try {
      const stats = {
        commandes: {
          total: db.prepare('SELECT COUNT(*) as count FROM shipments WHERE type = ?').get('commande').count,
          ca_ht: db.prepare('SELECT SUM(montant_ht) as sum FROM shipments WHERE type = ?').get('commande').sum || 0,
          ca_ttc: db.prepare('SELECT SUM(montant_ttc) as sum FROM shipments WHERE type = ?').get('commande').sum || 0,
        },
        echantillons: {
          total: db.prepare('SELECT COUNT(*) as count FROM shipments WHERE type = ?').get('echantillon').count,
          ca_ht: db.prepare('SELECT SUM(montant_ht) as sum FROM shipments WHERE type = ?').get('echantillon').sum || 0,
          ca_ttc: db.prepare('SELECT SUM(montant_ttc) as sum FROM shipments WHERE type = ?').get('echantillon').sum || 0,
        },
        total: {
          envois: db.prepare('SELECT COUNT(*) as count FROM shipments').get().count,
          ca_ht: db.prepare('SELECT SUM(montant_ht) as sum FROM shipments').get().sum || 0,
          ca_ttc: db.prepare('SELECT SUM(montant_ttc) as sum FROM shipments').get().sum || 0,
        }
      };

      res.json(stats);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Test suivi La Poste ────────────────────────────────────────────────────
  router.get('/tracking-laposte/:trackingNumber', async (req, res) => {
    try {
      const result = await carrierTracking.checkDelivery(db, req.params.trackingNumber);
      if (!result) {
        return res.status(404).json({ erreur: 'Tracking inconnu ou pas encore pris en charge' });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Supprimer un envoi ──────────────────────────────────────────────────────
  router.delete('/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM shipments WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
