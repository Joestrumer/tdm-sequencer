/**
 * carrierTrackingService.js — Suivi livraison multi-transporteur
 *
 * Dispatche automatiquement vers le bon handler selon le format du tracking :
 * - La Poste (Colissimo + Chronopost) → scraping endpoint SSU (sans clé API)
 * - UPS → API officielle (nécessite credentials developer.ups.com)
 * - DHL, FedEx → à ajouter si besoin
 *
 * Retour unifié : { delivered, product, status, statusCode, date, deliveryDate }
 */

const logger = require('../config/logger');

// ─── Détection du transporteur par format du tracking ───────────────────────
function detectCarrier(trackingNumber) {
  if (!trackingNumber) return null;
  const t = trackingNumber.trim().toUpperCase();
  // UPS : commence par 1Z
  if (/^1Z[A-Z0-9]{16}$/i.test(t)) return 'ups';
  // DHL Express : 10 chiffres ou commence par JD/JJD
  if (/^\d{10,11}$/.test(t) || /^J[DJ]/.test(t)) return 'dhl';
  // FedEx : 12-22 chiffres
  if (/^\d{12,22}$/.test(t)) return 'fedex';
  // La Poste (Colissimo/Chronopost) : tout le reste (FR, 9V, X, C, etc.)
  return 'laposte';
}

// ─── La Poste : Colissimo + Chronopost (scraping SSU, sans clé API) ─────────
const LAPOSTE_SSU = 'https://www.laposte.fr/ssu/sun/back/suivi-unifie';

async function checkLaPoste(trackingNumber) {
  const res = await fetch(`${LAPOSTE_SSU}/${encodeURIComponent(trackingNumber)}?lang=fr`, {
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
  const deliveredCodes = ['DI1', 'DI2', 'AG1'];
  const delivered = isFinal || deliveredCodes.includes(lastEvent?.code);

  return {
    delivered,
    product: shipment.product || 'colissimo',
    statusCode: lastEvent?.code || null,
    status: lastEvent?.label || (isFinal ? 'Livré' : null),
    date: lastEvent?.date || null,
    deliveryDate: shipment.deliveryDate || null,
  };
}

// ─── UPS : API officielle (nécessite credentials) ───────────────────────────
// Inscription gratuite : https://developer.ups.com
// Config : ups_client_id + ups_client_secret

let upsTokenCache = { token: null, expiresAt: 0 };

function getUPSCredentials(db) {
  const clientId = db?.prepare?.("SELECT valeur FROM config WHERE cle = 'ups_client_id'")?.get()?.valeur
    || process.env.UPS_CLIENT_ID;
  const clientSecret = db?.prepare?.("SELECT valeur FROM config WHERE cle = 'ups_client_secret'")?.get()?.valeur
    || process.env.UPS_CLIENT_SECRET;
  return (clientId && clientSecret) ? { clientId, clientSecret } : null;
}

async function getUPSToken(db) {
  if (upsTokenCache.token && Date.now() < upsTokenCache.expiresAt) {
    return upsTokenCache.token;
  }

  const creds = getUPSCredentials(db);
  if (!creds) return null;

  const res = await fetch('https://onlinetools.ups.com/security/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    logger.warn(`[UPS] OAuth erreur ${res.status}`);
    return null;
  }

  const data = await res.json();
  upsTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

async function checkUPS(db, trackingNumber) {
  const token = await getUPSToken(db);
  if (!token) return null;

  const res = await fetch(`https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(trackingNumber)}?locale=fr_FR&returnSignature=false`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'transId': `tdm-${Date.now()}`,
      'transactionSrc': 'tdm-sequencer',
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`UPS API HTTP ${res.status}`);
  }

  const data = await res.json();
  const pkg = data.trackResponse?.shipment?.[0]?.package?.[0];
  if (!pkg) return null;

  const activity = pkg.activity?.[0]; // Dernier événement
  if (!activity) return null;

  const statusType = activity.status?.type;
  // UPS status types: D = Delivered, I = In Transit, P = Pickup, X = Exception, M = Manifest
  const delivered = statusType === 'D';
  const deliveryDate = delivered && activity.date
    ? `${activity.date.substring(0,4)}-${activity.date.substring(4,6)}-${activity.date.substring(6,8)}`
    : null;

  return {
    delivered,
    product: 'ups',
    statusCode: statusType,
    status: activity.status?.description || (delivered ? 'Livré' : null),
    date: activity.date || null,
    deliveryDate,
  };
}

// ─── Dispatcher principal ───────────────────────────────────────────────────

/**
 * Vérifie le statut de livraison d'un colis auprès du bon transporteur
 * @returns {{ delivered, product, status, statusCode, date, deliveryDate }} | null
 */
async function checkDelivery(db, trackingNumber) {
  if (!trackingNumber) return null;

  const carrier = detectCarrier(trackingNumber);

  switch (carrier) {
    case 'laposte':
      return checkLaPoste(trackingNumber);
    case 'ups':
      return checkUPS(db, trackingNumber);
    // Futurs transporteurs :
    // case 'dhl': return checkDHL(db, trackingNumber);
    // case 'fedex': return checkFedEx(db, trackingNumber);
    default:
      return null;
  }
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
  detectCarrier,
  checkDelivery,
  updateShipmentDelivery,
};
