/**
 * wmsRefreshJob.js — Rafraîchissement automatique des statuts WMS + suivi livraison
 *
 * Toutes les 30 minutes :
 * 1. Interroge le WMS Endurance pour récupérer tracking + statut expédition
 * 2. Pour les colis expédiés avec tracking, interroge l'API La Poste
 *    pour détecter la livraison (Colissimo / Chronopost)
 * 3. Envoie automatiquement les notifications configurables (email + task HubSpot)
 */

const cron = require('node-cron');
const logger = require('../config/logger');
const wmsService = require('../services/wmsService');
const carrierTracking = require('../services/carrierTrackingService');
const { sendNotification, notifyPendingAll } = require('../services/shipmentNotificationService');

let db;

const JUNK = new Set(['unknown', 'undefined', 'null', 'n/a', '0', '']);
const clean = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  return JUNK.has(s.toLowerCase()) ? null : s;
};

// ─── Phase 1 : Refresh WMS Endurance (tracking + statut expédition) ─────────
async function refreshWMS() {
  const shipments = db.prepare(`
    SELECT * FROM shipments
    WHERE (wms_status_code IS NULL OR wms_status_code NOT IN ('9', '10'))
      AND (last_wms_check IS NULL OR last_wms_check < datetime('now', '-1 hour'))
    ORDER BY created_at DESC
    LIMIT 50
  `).all();

  if (shipments.length === 0) return 0;

  logger.info(`[WMS Refresh] ${shipments.length} envoi(s) à vérifier via Endurance`);

  let updated = 0;
  for (const shipment of shipments) {
    try {
      const wmsInfo = await wmsService.getFullInfo(db, shipment.order_ref);

      const status = clean(wmsInfo.status?.libelle_etat) || clean(wmsInfo.status?.code_etat);
      const statusCode = clean(wmsInfo.status?.code_etat);
      const trackingNumber = clean(wmsInfo.tracking?.tracking);
      const carrierName = clean(wmsInfo.tracking?.transporteur);

      db.prepare(`
        UPDATE shipments
        SET wms_status = COALESCE(?, wms_status),
            wms_status_code = COALESCE(?, wms_status_code),
            tracking_number = COALESCE(?, tracking_number),
            carrier_name = COALESCE(?, carrier_name),
            last_wms_check = datetime('now')
        WHERE id = ?
      `).run(status, statusCode, trackingNumber, carrierName, shipment.id);

      updated++;
    } catch (e) {
      db.prepare(`UPDATE shipments SET last_wms_check = datetime('now') WHERE id = ?`).run(shipment.id);
      logger.warn(`[WMS Refresh] Erreur ${shipment.order_ref}: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  return updated;
}

// ─── Phase 2 : Check livraison via transporteur (La Poste, UPS, etc.) ───────
async function checkDeliveries() {
  // Tous les colis avec tracking, non livrés/retournés, sans filtre sur last_wms_check
  const shipments = db.prepare(`
    SELECT * FROM shipments
    WHERE tracking_number IS NOT NULL
      AND (wms_status_code IS NULL OR wms_status_code NOT IN ('9', '10', 'RET'))
      AND delivered_at IS NULL
    ORDER BY created_at DESC
    LIMIT 30
  `).all();

  if (shipments.length === 0) return 0;

  logger.info(`[Carrier Tracking] ${shipments.length} colis à vérifier via La Poste`);

  let delivered = 0;
  let returned = 0;
  for (const shipment of shipments) {
    const result = await carrierTracking.updateShipmentDelivery(db, shipment);

    if (result?.type === 'delivered') {
      delivered++;
      logger.info(`[Carrier Tracking] ${shipment.order_ref} (${shipment.tracking_number}) → Livré`);
      try { await sendNotification(db, shipment, 'delivered'); } catch (notifErr) {
        logger.error(`[Auto Notify] Erreur pour ${shipment.client_name}:`, notifErr.message);
      }

    } else if (result?.type === 'pickup_point') {
      logger.info(`[Carrier Tracking] ${shipment.order_ref} (${shipment.tracking_number}) → Point de retrait`);
      try { await sendNotification(db, shipment, 'pickup'); } catch (notifErr) {
        logger.error(`[Pickup Notify] Erreur pour ${shipment.client_name}:`, notifErr.message);
      }

    } else if (result?.type === 'returned') {
      returned++;
      logger.info(`[Carrier Tracking] ${shipment.order_ref} (${shipment.tracking_number}) → Retour à l'expéditeur`);
      try { await sendNotification(db, shipment, 'returned'); } catch (notifErr) {
        logger.error(`[Return Notify] Erreur pour ${shipment.client_name}:`, notifErr.message);
      }

    } else if (result?.type === 'failed_delivery') {
      logger.info(`[Carrier Tracking] ${shipment.order_ref} (${shipment.tracking_number}) → Échec de livraison`);
      try { await sendNotification(db, shipment, 'failed'); } catch (notifErr) {
        logger.error(`[Failed Notify] Erreur pour ${shipment.client_name}:`, notifErr.message);
      }
    }

    // Pause 300ms pour respecter le rate limit La Poste
    await new Promise(r => setTimeout(r, 300));
  }

  if (delivered > 0) {
    logger.info(`[Carrier Tracking] ${delivered} colis marqué(s) comme livré(s)`);
  }
  if (returned > 0) {
    logger.info(`[Carrier Tracking] ${returned} colis en retour à l'expéditeur`);
  }

  return delivered;
}

// ─── Job principal ───────────────────────────────────────────────────────────
async function refreshPending() {
  try {
    const wmsUpdated = await refreshWMS();
    const deliveredCount = await checkDeliveries();
    const notified = await notifyPendingAll(db);

    if (wmsUpdated > 0 || deliveredCount > 0 || notified > 0) {
      logger.info(`[WMS Refresh] Bilan: ${wmsUpdated} WMS, ${deliveredCount} livraison(s), ${notified} notif(s) envoyée(s)`);
    }
  } catch (e) {
    logger.error('[WMS Refresh] Erreur globale:', e.message);
  }
}

function initialiser(database) {
  db = database;
  // Toutes les 30 minutes
  cron.schedule('*/30 * * * *', refreshPending);
  logger.info('[WMS Refresh] Job planifié toutes les 30 minutes');

  // Premier refresh 30s après le démarrage
  setTimeout(refreshPending, 30_000);
}

module.exports = { initialiser, refreshPending };
