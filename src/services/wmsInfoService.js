/**
 * wmsInfoService.js — Client SOAP pour ws_order_info.wsdl
 * Deuxième endpoint WMS avec peut-être plus d'informations
 */

const logger = require('../config/logger');
const ENDPOINT = 'https://wms.endurancelogistique.fr/secure/ws_order_info.php';
const NAMESPACE = 'https://wms.endurancelogistique.fr/secure/ws_order_info.wsdl';

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
  // Extract all elements (with or without attributes)
  const matches = xml.matchAll(/<([a-z_]+)(?:\s[^>]*)?>([^<]*)<\/\1>/gi);
  for (const m of matches) {
    const key = m[1];
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
    throw new Error(`WMS Info HTTP ${res.status}: ${text.substring(0, 200)}`);
  }

  logger.debug(`WMS Info ${method} (${params.delivery_order || params.id}):`, text.substring(0, 500));

  return parseResponse(text);
}

// Endpoint de debug
async function debugCall(db, deliveryOrder, method = 'getOrderInfo') {
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
    endpoint: ENDPOINT,
    xmlRequest: body,
    xmlResponse: text,
    parsed: parseResponse(text),
  };
}

// Essayer différentes méthodes possibles
async function tryAllMethods(db, deliveryOrder) {
  const methods = [
    'getOrderInfo',
    'getInfo',
    'getOrder',
    'getDetails',
    'getTracking',
    'getStatus',
  ];

  const results = {};
  for (const method of methods) {
    try {
      results[method] = await callSoap(method, { id: 0, delivery_order: deliveryOrder }, db);
    } catch (e) {
      results[method] = { error: e.message };
    }
  }
  return results;
}

module.exports = {
  debugCall,
  tryAllMethods,
};
