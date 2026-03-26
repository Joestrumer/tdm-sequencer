/**
 * wmsService.js — Client SOAP pour le WMS Endurance Logistique
 *
 * Opérations disponibles :
 * - getStatus(id, delivery_order) → code_etat, libelle_etat
 * - getTracking(id, delivery_order) → transporteur, tracking
 * - getRupture(id, delivery_order) → retour, cause
 * - getHistorique(id, delivery_order) → dates clés
 */

const logger = require('../config/logger');

const ENDPOINT = 'https://wms.endurancelogistique.fr/secure/ws_order.php';
const NAMESPACE = 'https://wms.endurancelogistique.fr/secure/ws_order.wsdl';

function getCredentials(db) {
  const user = db?.prepare?.("SELECT valeur FROM config WHERE cle = 'wms_user'")?.get()?.valeur
    || process.env.WMS_USER;
  const pass = db?.prepare?.("SELECT valeur FROM config WHERE cle = 'wms_password'")?.get()?.valeur
    || process.env.WMS_PASSWORD;
  if (!user || !pass) throw new Error('Identifiants WMS non configurés (config wms_user/wms_password ou env WMS_USER/WMS_PASSWORD)');
  return { user, pass };
}

function buildSoapEnvelope(method, params) {
  const paramsXml = Object.entries(params)
    .map(([k, v]) => `<${k} xsi:type="xsd:${typeof v === 'number' ? 'int' : 'string'}">${v}</${k}>`)
    .join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:tns="${NAMESPACE}">
  <soapenv:Body>
    <tns:${method}>
      ${paramsXml}
    </tns:${method}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function parseResponse(xml) {
  const result = {};
  // Extract all elements from the response body (with or without attributes)
  const matches = xml.matchAll(/<([a-z_]+)(?:\s[^>]*)?>([^<]*)<\/\1>/gi);
  for (const m of matches) {
    const key = m[1];
    // Skip SOAP envelope elements
    if (['faultcode', 'faultstring'].includes(key)) {
      throw new Error(`SOAP Fault: ${m[2]}`);
    }
    if (!['Body', 'Envelope', 'Header'].includes(key)) {
      result[key] = m[2];
    }
  }
  return result;
}

async function callSoap(method, params, db) {
  const { user, pass } = getCredentials(db);
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const body = buildSoapEnvelope(method, params);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `${NAMESPACE}#${method}`,
      'Authorization': `Basic ${auth}`,
    },
    body,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`WMS HTTP ${res.status}: ${text.substring(0, 200)}`);
  }

  // Log pour debug
  logger.debug(`WMS ${method} (${params.delivery_order}):`, text.substring(0, 500));

  return parseResponse(text);
}

// ─── API publique ────────────────────────────────────────────────────────────

async function getStatus(db, deliveryOrder) {
  return callSoap('getStatus', { id: 165, delivery_order: deliveryOrder }, db);
}

async function getTracking(db, deliveryOrder) {
  return callSoap('getTracking', { id: 165, delivery_order: deliveryOrder }, db);
}

async function getRupture(db, deliveryOrder) {
  return callSoap('getRupture', { id: 165, delivery_order: deliveryOrder }, db);
}

async function getHistorique(db, deliveryOrder) {
  return callSoap('getHistorique', { id: 165, delivery_order: deliveryOrder }, db);
}

// Récupérer toutes les infos d'une commande en un appel
async function getFullInfo(db, deliveryOrder) {
  const [status, tracking, rupture, historique] = await Promise.allSettled([
    getStatus(db, deliveryOrder),
    getTracking(db, deliveryOrder),
    getRupture(db, deliveryOrder),
    getHistorique(db, deliveryOrder),
  ]);

  return {
    delivery_order: deliveryOrder,
    status: status.status === 'fulfilled' ? status.value : { error: status.reason?.message },
    tracking: tracking.status === 'fulfilled' ? tracking.value : { error: tracking.reason?.message },
    rupture: rupture.status === 'fulfilled' ? rupture.value : { error: rupture.reason?.message },
    historique: historique.status === 'fulfilled' ? historique.value : { error: historique.reason?.message },
  };
}

// Endpoint de debug pour voir la réponse XML brute
async function debugCall(db, deliveryOrder, method = 'getStatus') {
  const { user, pass } = getCredentials(db);
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const body = buildSoapEnvelope(method, { id: 0, delivery_order: deliveryOrder });

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `${NAMESPACE}#${method}`,
      'Authorization': `Basic ${auth}`,
    },
    body,
  });

  const text = await res.text();

  return {
    ok: res.ok,
    status: res.status,
    xmlRequest: body,
    xmlResponse: text,
    parsed: parseResponse(text),
  };
}

module.exports = {
  getStatus,
  getTracking,
  getRupture,
  getHistorique,
  getFullInfo,
  debugCall,
};
