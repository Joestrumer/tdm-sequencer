/**
 * shipments.js — Routes API pour la gestion des envois
 */

const express = require('express');
const wmsService = require('../services/wmsService');

module.exports = (db) => {
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

      const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(result.lastInsertRowid);

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

      // Extraire les données pertinentes
      const status = wmsInfo.status?.libelle_etat || wmsInfo.status?.code_etat;
      const statusCode = wmsInfo.status?.code_etat;
      const trackingNumber = wmsInfo.tracking?.tracking;
      const carrierName = wmsInfo.tracking?.transporteur;

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
      // Récupérer les envois non livrés et vérifiés il y a plus de 1h
      const shipments = db.prepare(`
        SELECT * FROM shipments
        WHERE (wms_status IS NULL OR wms_status != 'livré')
          AND (last_wms_check IS NULL OR last_wms_check < datetime('now', '-1 hour'))
        ORDER BY created_at DESC
        LIMIT 50
      `).all();

      const results = [];
      for (const shipment of shipments) {
        try {
          const wmsInfo = await wmsService.getFullInfo(db, shipment.order_ref);
          const status = wmsInfo.status?.libelle_etat || wmsInfo.status?.code_etat;
          const statusCode = wmsInfo.status?.code_etat;
          const trackingNumber = wmsInfo.tracking?.tracking;
          const carrierName = wmsInfo.tracking?.transporteur;

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
