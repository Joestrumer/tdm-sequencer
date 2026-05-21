/**
 * carrierTrackingService.js — Suivi colis via endpoint interne La Poste
 *
 * Endpoint : https://www.laposte.fr/ssu/sun/back/suivi-unifie/{tracking}?lang=fr
 * Fonctionne pour Colissimo + Chronopost, sans clé API.
 *
 * Réponse clé :
 * - shipment.isFinal   → true quand le colis est livré
 * - shipment.deliveryDate → date de livraison
 * - shipment.event[0]  → dernier événement (code DI1 = livré, ET1 = transit, etc.)
 */

const logger = require('../config/logger');

const SSU_URL = 'https://www.laposte.fr/ssu/sun/back/suivi-unifie';

/**
 * Interroge La Poste pour un numéro de tracking (Colissimo ou Chronopost)
 * @returns {{ isFinal, delivered, product, status, statusCode, date, deliveryDate }} | null
 */
async function checkDelivery(db, trackingNumber) {
  if (!trackingNumber) return null;

  const res = await fetch(`${SSU_URL}/${encodeURIComponent(trackingNumber)}?lang=fr`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    if (res.status === 404 || res.status === 400) return null;
    throw new Error(`La Poste SSU HTTP ${res.status}`);
  }

  const data = await res.json();
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || entry.returnCode !== 200) return null;

  const shipment = entry.shipment;
  if (!shipment) return null;

  const lastEvent = shipment.event?.[0];
  const isFinal = !!shipment.isFinal;
  // Codes livraison : DI1 (livré domicile), DI2 (livré voisin), AG1 (point retrait)
  const deliveredCodes = ['DI1', 'DI2', 'AG1'];
  const delivered = isFinal || deliveredCodes.includes(lastEvent?.code);

  return {
    isFinal,
    delivered,
    product: shipment.product || null,
    statusCode: lastEvent?.code || null,
    status: lastEvent?.label || (isFinal ? 'Livré' : null),
    date: lastEvent?.date || null,
    deliveryDate: shipment.deliveryDate || null,
  };
}

/**
 * Met à jour le statut livraison d'un shipment dans la DB
 * @returns {boolean} true si marqué comme livré
 */
async function updateShipmentDelivery(db, shipment) {
  if (!shipment.tracking_number) return false;

  try {
    const result = await checkDelivery(db, shipment.tracking_number);
    if (!result) return false;

    if (result.delivered) {
      db.prepare(`
        UPDATE shipments
        SET wms_status = ?, wms_status_code = '9', delivered_at = ?,
            carrier_name = COALESCE(carrier_name, ?),
            last_wms_check = datetime('now')
        WHERE id = ?
      `).run(
        result.status || 'Livré',
        result.deliveryDate || result.date,
        result.product,
        shipment.id
      );
      return true;
    }

    // Pas encore livré mais on a un statut → mettre à jour si plus informatif
    if (result.status && (!shipment.wms_status || shipment.wms_status === 'Non vérifié')) {
      db.prepare(`
        UPDATE shipments
        SET wms_status = ?, carrier_name = COALESCE(carrier_name, ?),
            last_wms_check = datetime('now')
        WHERE id = ?
      `).run(result.status, result.product, shipment.id);
    }

    return false;
  } catch (e) {
    logger.warn(`[Carrier Tracking] Erreur ${shipment.tracking_number}: ${e.message}`);
    return false;
  }
}

module.exports = {
  checkDelivery,
  updateShipmentDelivery,
};
