/**
 * wmsRefreshJob.js — Rafraîchissement automatique des statuts WMS + suivi livraison
 *
 * Toutes les 30 minutes :
 * 1. Interroge le WMS Endurance pour récupérer tracking + statut expédition
 * 2. Pour les colis expédiés avec tracking, interroge l'API La Poste
 *    pour détecter la livraison (Colissimo / Chronopost)
 */

const cron = require('node-cron');
const logger = require('../config/logger');
const wmsService = require('../services/wmsService');
const carrierTracking = require('../services/carrierTrackingService');

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
  // Tous les colis avec tracking, non livrés, sans filtre sur last_wms_check
  // (indépendant de la Phase 1 — on vérifie la livraison à chaque cycle)
  const shipments = db.prepare(`
    SELECT * FROM shipments
    WHERE tracking_number IS NOT NULL
      AND (wms_status_code IS NULL OR wms_status_code NOT IN ('9', '10'))
      AND delivered_at IS NULL
    ORDER BY created_at DESC
    LIMIT 30
  `).all();

  if (shipments.length === 0) return 0;

  logger.info(`[Carrier Tracking] ${shipments.length} colis à vérifier via La Poste`);

  let delivered = 0;
  for (const shipment of shipments) {
    const wasDelivered = await carrierTracking.updateShipmentDelivery(db, shipment);
    if (wasDelivered) {
      delivered++;
      logger.info(`[Carrier Tracking] ${shipment.order_ref} (${shipment.tracking_number}) → Livré`);
    }

    // Pause 300ms pour respecter le rate limit La Poste
    await new Promise(r => setTimeout(r, 300));
  }

  if (delivered > 0) {
    logger.info(`[Carrier Tracking] ${delivered} colis marqué(s) comme livré(s)`);
  }

  return delivered;
}

// ─── Job principal ───────────────────────────────────────────────────────────
async function refreshPending() {
  try {
    const wmsUpdated = await refreshWMS();
    const deliveredCount = await checkDeliveries();

    if (wmsUpdated > 0 || deliveredCount > 0) {
      logger.info(`[WMS Refresh] Bilan: ${wmsUpdated} WMS mis à jour, ${deliveredCount} livraison(s) détectée(s)`);
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
