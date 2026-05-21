/**
 * wmsRefreshJob.js — Rafraîchissement automatique des statuts WMS (Endurance Logistique)
 *
 * Toutes les 30 minutes, vérifie les envois non livrés et met à jour :
 * - wms_status / wms_status_code
 * - tracking_number / carrier_name
 */

const cron = require('node-cron');
const logger = require('../config/logger');
const wmsService = require('../services/wmsService');

let db;

const JUNK = new Set(['unknown', 'undefined', 'null', 'n/a', '0', '']);
const clean = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  return JUNK.has(s.toLowerCase()) ? null : s;
};

async function refreshPending() {
  try {
    // Envois non livrés (codes 9/10 = livré) et non vérifiés depuis 1h+
    const shipments = db.prepare(`
      SELECT * FROM shipments
      WHERE (wms_status_code IS NULL OR wms_status_code NOT IN ('9', '10'))
        AND (last_wms_check IS NULL OR last_wms_check < datetime('now', '-1 hour'))
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    if (shipments.length === 0) return;

    logger.info(`[WMS Refresh] ${shipments.length} envoi(s) à vérifier`);

    let updated = 0;
    let errors = 0;

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

        updated++;
      } catch (e) {
        errors++;
        // Marquer comme vérifié même en cas d'erreur pour ne pas spammer l'API
        db.prepare(`UPDATE shipments SET last_wms_check = datetime('now') WHERE id = ?`).run(shipment.id);
        logger.warn(`[WMS Refresh] Erreur ${shipment.order_ref}: ${e.message}`);
      }

      // Pause 500ms entre chaque appel pour ne pas surcharger l'API
      await new Promise(r => setTimeout(r, 500));
    }

    logger.info(`[WMS Refresh] Terminé: ${updated} mis à jour, ${errors} erreur(s)`);
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
