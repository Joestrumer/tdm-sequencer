/**
 * carrierTrackingService.js — Suivi colis via API La Poste (Colissimo + Chronopost)
 *
 * API Suivi v2 : https://developer.laposte.fr/products/suivi/2
 * Clé gratuite à obtenir sur developer.laposte.fr
 *
 * Codes événements livraison :
 * - DR1 / DR2 = Distribué (livré)
 * - AG1 = Disponible en point retrait
 * - DI1 / DI2 = Distribué à un voisin / gardien
 * - ET1-ET4 = En transit
 * - PC1/PC2 = Pris en charge
 */

const logger = require('../config/logger');

const LAPOSTE_API = 'https://api.laposte.fr/suivi/v2/idships';

// Codes événement qui indiquent une livraison réussie
const DELIVERED_CODES = new Set(['DR1', 'DR2', 'DI1', 'DI2', 'AG1']);
// Codes qui indiquent un problème
const PROBLEM_CODES = new Set(['ND1', 'RE1', 'RE2', 'AR1', 'AR2']);

function getApiKey(db) {
  const fromDb = db?.prepare?.("SELECT valeur FROM config WHERE cle = 'laposte_suivi_key'")?.get()?.valeur;
  return fromDb || process.env.LAPOSTE_SUIVI_KEY || null;
}

/**
 * Interroge l'API La Poste Suivi pour un numéro de tracking
 * @returns {{ delivered: boolean, status: string, statusDetail: string, lastEvent: string, deliveredAt: string|null }} | null
 */
async function checkDelivery(db, trackingNumber) {
  const apiKey = getApiKey(db);
  if (!apiKey) return null;
  if (!trackingNumber) return null;

  const res = await fetch(`${LAPOSTE_API}/${encodeURIComponent(trackingNumber)}?lang=fr_FR`, {
    headers: {
      'Accept': 'application/json',
      'X-Okapi-Key': apiKey,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null; // Tracking inconnu
    if (res.status === 401 || res.status === 403) {
      logger.warn('[La Poste Suivi] Clé API invalide ou expirée');
      return null;
    }
    throw new Error(`La Poste API HTTP ${res.status}`);
  }

  const data = await res.json();
  const shipment = data.shipment;
  if (!shipment) return null;

  // Dernier événement
  const lastEvent = shipment.event?.[0]; // Events triés du plus récent au plus ancien
  if (!lastEvent) return null;

  const eventCode = lastEvent.code || '';
  const delivered = DELIVERED_CODES.has(eventCode);
  const problem = PROBLEM_CODES.has(eventCode);

  return {
    delivered,
    problem,
    eventCode,
    status: lastEvent.label || '',
    statusDetail: lastEvent.status || '',
    date: lastEvent.date || null,
    deliveredAt: delivered ? lastEvent.date : null,
    carrier: shipment.product?.label || null,
  };
}

/**
 * Met à jour le statut livraison d'un shipment dans la DB
 * @returns {boolean} true si le statut a été mis à jour
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
            last_wms_check = datetime('now')
        WHERE id = ?
      `).run(result.status || 'Livré', result.deliveredAt, shipment.id);
      return true;
    }

    // Mettre à jour le statut textuel si on a un événement plus récent
    if (result.status && !shipment.wms_status) {
      db.prepare(`
        UPDATE shipments SET wms_status = ?, last_wms_check = datetime('now') WHERE id = ?
      `).run(result.status, shipment.id);
    }

    return false;
  } catch (e) {
    logger.warn(`[La Poste Suivi] Erreur ${shipment.tracking_number}: ${e.message}`);
    return false;
  }
}

module.exports = {
  checkDelivery,
  updateShipmentDelivery,
  getApiKey,
};
