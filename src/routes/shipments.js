/**
 * shipments.js — Routes API pour la gestion des envois
 */

const express = require('express');
const wmsService = require('../services/wmsService');
const carrierTracking = require('../services/carrierTrackingService');
const brevoService = require('../services/brevoService');
const hubspotService = require('../services/hubspotService');
const logger = require('../config/logger');

// ─── Helpers ────────────────────────────────────────────────────────────────
function buildTrackingUrl(carrier, trackingNumber) {
  if (!trackingNumber) return '#';
  const t = (carrier || '').toLowerCase();
  if (t.includes('chronopost')) return `https://www.chronopost.fr/tracking-no-powerful/tracking/suivi?listeNumerosLT=${trackingNumber}`;
  if (t.includes('colissimo')) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${trackingNumber}`;
  if (t.includes('ups')) return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  if (t.includes('dhl')) return `https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=${trackingNumber}`;
  if (t.includes('tnt') || t.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  return `https://www.laposte.fr/outils/suivre-vos-envois?code=${trackingNumber}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

  // ─── Envoyer email confirmation réception + task HubSpot ────────────────────
  router.patch('/:id/notify', async (req, res) => {
    try {
      const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(req.params.id);
      if (!shipment) return res.status(404).json({ erreur: 'Envoi non trouvé' });
      if (!shipment.delivered_at) return res.status(400).json({ erreur: 'Envoi non livré' });
      if (!shipment.client_email) return res.status(400).json({ erreur: 'Pas d\'email client' });
      if (shipment.type !== 'echantillon') return res.status(400).json({ erreur: 'Type doit être echantillon' });

      // 1. Construire l'email HTML
      const prenom = shipment.client_prenom || (shipment.client_name && shipment.client_name.includes(' - ') ? shipment.client_name.split(' - ')[1].trim().split(' ')[0] : '');
      const trackingLink = buildTrackingUrl(shipment.carrier_name, shipment.tracking_number);
      const signature = brevoService.getSignature(db);

      const htmlContent = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <p>Bonjour ${escapeHtml(prenom)},</p>
  <p>J'espère que vous allez bien.</p>
  <p>Le colis apparait comme livré. Pouvez-vous me confirmer l'avoir bien reçu ?</p>
  <p>On fait le point quand vous avez pu les tester mais n'hésitez pas si vous avez des questions d'ici là.</p>
  ${shipment.tracking_number ? `<p>Vous pouvez suivre votre colis ici : <a href="${trackingLink}">${escapeHtml(shipment.tracking_number)}</a></p>` : ''}
  <p>Bonne journée,</p>
  <div style="border-top:1px solid #e5e0d5;padding-top:12px;margin-top:16px;">
    ${signature}
  </div>
</div>`;

      // 2. Envoyer via Brevo
      await brevoService.brevoSendEmail({
        sender: brevoService.SENDER,
        to: [{ email: shipment.client_email, name: prenom || shipment.client_name }],
        bcc: [{ email: 'hugo@terredemars.com', name: 'Hugo Montiel' }],
        subject: 'Terre de Mars - Confirmation de réception de vos échantillons',
        htmlContent,
        replyTo: { email: 'hugo@terredemars.com', name: 'Hugo Montiel' },
      });

      // 3. Créer task HubSpot (optionnel — ne bloque pas l'email)
      try {
        if (process.env.HUBSPOT_API_KEY) {
          const deliveredDate = shipment.delivered_at ? new Date(shipment.delivered_at).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');

          // Chercher le contact par email
          const lead = db.prepare('SELECT hubspot_id FROM leads WHERE email = ? LIMIT 1').get(shipment.client_email);
          const contactId = lead?.hubspot_id ? parseInt(lead.hubspot_id) : null;

          // Chercher la company par domaine email
          const domaine = shipment.client_email.split('@')[1];
          const company = await hubspotService.trouverCompanyParDomaine(domaine);
          const companyId = company?.id ? parseInt(company.id) : null;

          // Calculer +5 jours ouvrés
          let taskDate = new Date();
          let businessDays = 0;
          while (businessDays < 5) {
            taskDate.setDate(taskDate.getDate() + 1);
            if (taskDate.getDay() !== 0 && taskDate.getDay() !== 6) businessDays++;
          }
          const taskTimestamp = taskDate.getTime();

          const associations = {};
          if (contactId) associations.contactIds = [contactId];
          if (companyId) associations.companyIds = [parseInt(companyId)];

          await hubspotService.hubspotFetch('/engagements/v1/engagements', {
            method: 'POST',
            body: JSON.stringify({
              engagement: {
                active: true,
                type: 'TASK',
                timestamp: taskTimestamp,
                ownerId: parseInt(hubspotService.HUGO_OWNER_ID),
              },
              associations,
              metadata: {
                subject: `retour echantillon (reçu le ${deliveredDate})`,
                body: `Relancer ${shipment.client_name} suite à la réception des échantillons.`,
                status: 'NOT_STARTED',
                priority: 'HIGH',
                taskType: 'TODO',
              }
            }),
          });
          logger.info('📋 HubSpot task "retour echantillon" créée', { email: shipment.client_email, taskDate: taskDate.toISOString().split('T')[0] });
        }
      } catch (hsErr) {
        logger.error('HubSpot task création échouée (non bloquant)', { error: hsErr.message, email: shipment.client_email });
      }

      // 4. Marquer comme notifié (client_notified_at = email client envoyé)
      db.prepare("UPDATE shipments SET client_notified_at = datetime('now') WHERE id = ?").run(req.params.id);

      res.json({ ok: true });
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
