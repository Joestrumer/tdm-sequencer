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

// Set partagé de valeurs "junk" renvoyées par le WMS
const JUNK_SET = new Set(['unknown', 'undefined', 'null', 'n/a', '0', '']);
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
  // Extract all elements — support optional namespace prefix (ns1:field, tns:field, etc.)
  const matches = xml.matchAll(/<(?:[a-z0-9]+:)?([a-z_][a-z0-9_]*)(?:\s[^>]*)?>([^<]*)<\/(?:[a-z0-9]+:)?\1>/gi);
  for (const m of matches) {
    const key = m[1];
    const val = m[2]?.trim();
    // Skip SOAP envelope elements
    if (['faultcode', 'faultstring'].includes(key)) {
      throw new Error(`SOAP Fault: ${val}`);
    }
    if (!['Body', 'Envelope', 'Header'].includes(key)) {
      // Filtrer les valeurs vides, "unknown", et dates placeholder renvoyées par le WMS
      if (val && val.toLowerCase() !== 'unknown' && val !== '0' && val !== ''
          && !val.startsWith('0000-00-00')) {
        result[key] = val;
      }
    }
  }
  return result;
}

async function callSoap(method, params, db) {
  const { user, pass } = getCredentials(db);
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const headers = {
    'Content-Type': 'text/xml; charset=utf-8',
    'SOAPAction': `${NAMESPACE}#${method}`,
    'Authorization': `Basic ${auth}`,
  };

  const body = buildSoapEnvelope(method, params);
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body });
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`WMS HTTP ${res.status}: ${text.substring(0, 200)}`);
  }

  const parsed = parseResponse(text);
  logger.debug(`WMS ${method} (${params.delivery_order}): ${text.substring(0, 800)}`);

  return parsed;
}

/**
 * Dérive un statut lisible à partir des infos WMS quand getStatus() ne renvoie rien.
 * Parcourt les champs historique (dates-jalons) et tracking en priorité décroissante.
 */
function deriveStatusFromInfo(wmsInfo) {
  const h = wmsInfo.historique || {};
  const t = wmsInfo.tracking || {};

  const allFields = { ...h, ...t };
  const entries = Object.entries(allFields);

  // Priorité 1 : livraison
  if (entries.some(([k, v]) => v && /livr/i.test(k))) {
    return { status: 'Livré', statusCode: '9' };
  }

  // Priorité 2 : expédition / enlèvement
  if (entries.some(([k, v]) => v && /exped|enlev|envoi|depart/i.test(k))) {
    return { status: 'Expédié', statusCode: '7' };
  }

  // Priorité 3 : tracking number présent dans les données
  const trackingVal = t.tracking || t.numero_suivi || t.tracking_number;
  if (trackingVal && !JUNK_SET.has(String(trackingVal).toLowerCase())) {
    return { status: 'Expédié', statusCode: '7' };
  }

  // Priorité 4 : validation / impression documents
  if (entries.some(([k, v]) => v && /valid|impres/i.test(k))) {
    return { status: 'En préparation', statusCode: '4' };
  }

  // Priorité 5 : préparation / intégration
  if (entries.some(([k, v]) => v && /prepar|integr/i.test(k))) {
    return { status: 'En préparation', statusCode: '3' };
  }

  // Priorité 6 : création / réception
  if (entries.some(([k, v]) => v && /creat|recep|import/i.test(k))) {
    return { status: 'Réceptionné WMS', statusCode: '1' };
  }

  return null;
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

// Debug : essayer différents formats de référence pour trouver le bon
async function debugTryIds(db, deliveryOrder) {
  const { user, pass } = getCredentials(db);
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  // Formats de référence à tester
  const refsToTry = [
    deliveryOrder,
    `WE${deliveryOrder}`,
    `PS${deliveryOrder}`,
    `CMD${deliveryOrder}`,
    `P${deliveryOrder}`,
    `TDM${deliveryOrder}`,
    `BL${deliveryOrder}`,
    deliveryOrder.padStart(8, '0'),       // 00007453
    `WE${deliveryOrder.padStart(6, '0')}`, // WE007453
  ];

  const idsToTry = [0, 165];
  const methods = ['getStatus', 'getHistorique'];

  const results = {};

  for (const ref of refsToTry) {
    const refResults = {};
    let found = false;

    for (const id of idsToTry) {
      for (const method of methods) {
        const key = `id${id}_${method}`;
        try {
          const body = buildSoapEnvelope(method, { id, delivery_order: ref });
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
          const parsed = parseResponse(text);
          const hasData = Object.keys(parsed).length > 0;

          if (hasData) {
            refResults[key] = { hasData: true, parsed };
            found = true;
            logger.info(`[WMS Debug] TROUVÉ : ref="${ref}", id=${id}, ${method} → ${JSON.stringify(parsed)}`);
          }
        } catch (e) {
          refResults[key] = { error: e.message };
        }
      }
    }

    // N'inclure que les refs qui ont trouvé quelque chose, ou la ref originale
    if (found || ref === deliveryOrder) {
      results[ref] = found ? refResults : 'no data';
    }
  }

  // Aussi tester le 2ème endpoint (ws_order_info.php)
  const INFO_ENDPOINT = 'https://wms.endurancelogistique.fr/secure/ws_order_info.php';
  const INFO_NS = 'urn:order_info';
  try {
    for (const ref of [deliveryOrder, `WE${deliveryOrder}`, `P${deliveryOrder}`]) {
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:tns="${INFO_NS}">
  <soapenv:Body>
    <tns:getProducts>
      <id xsi:type="xsd:int">165</id>
      <delivery_order xsi:type="xsd:string">${ref}</delivery_order>
    </tns:getProducts>
  </soapenv:Body>
</soapenv:Envelope>`;
      const res = await fetch(INFO_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': `${INFO_NS}#getProducts`,
          'Authorization': `Basic ${auth}`,
        },
        body,
      });
      const text = await res.text();
      // Pour getProducts, ne pas filtrer les "unknown" — juste regarder s'il y a du contenu
      const hasContent = text.includes('<reference') || text.includes('<libelle');
      results[`info_${ref}`] = {
        hasContent,
        raw: text.substring(0, 500),
      };
      if (hasContent) {
        logger.info(`[WMS Debug] ws_order_info TROUVÉ : ref="${ref}" → ${text.substring(0, 300)}`);
      }
    }
  } catch (e) {
    results['info_error'] = e.message;
  }

  return { delivery_order: deliveryOrder, results };
}

module.exports = {
  getStatus,
  getTracking,
  getRupture,
  getHistorique,
  getFullInfo,
  debugCall,
  debugTryIds,
  deriveStatusFromInfo,
  JUNK_SET,
};
