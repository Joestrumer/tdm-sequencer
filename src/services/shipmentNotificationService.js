/**
 * shipmentNotificationService.js — Service partagé de notifications échantillons
 *
 * Centralise la logique d'envoi d'emails automatiques pour les 4 statuts :
 * delivered, pickup, returned, failed
 *
 * Configurable via la table `config` (clés shipment_notif_*)
 */

const logger = require('../config/logger');
const brevoService = require('./brevoService');
const hubspotService = require('./hubspotService');

// ─── Constantes ──────────────────────────────────────────────────────────────

const NOTIFICATION_TYPES = ['delivered', 'pickup', 'returned', 'failed'];

const CONFIG_KEYS = {
  delivered: 'shipment_notif_delivered',
  pickup: 'shipment_notif_pickup',
  returned: 'shipment_notif_returned',
  failed: 'shipment_notif_failed',
};

const NOTIFIED_COLUMNS = {
  delivered: 'client_notified_at',
  pickup: 'pickup_notified_at',
  returned: 'returned_notified_at',
  failed: 'failed_notified_at',
};

const DATE_COLUMNS = {
  delivered: 'delivered_at',
  pickup: 'pickup_at',
  returned: 'returned_at',
  failed: 'failed_at',
};

const STATUS_CONDITIONS = {
  delivered: "delivered_at IS NOT NULL",
  pickup: "wms_status_code = 'PRP'",
  returned: "wms_status_code = 'RET'",
  failed: "wms_status_code = 'ECH'",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function extrairePrenom(shipment) {
  if (shipment.client_name && shipment.client_name.includes(' - ')) {
    const apres = shipment.client_name.split(' - ')[1].trim();
    const parts = apres.split(/\s+/);
    const prenom = parts.find(p => p !== p.toUpperCase()) || parts[0];
    if (prenom) return prenom.charAt(0).toUpperCase() + prenom.slice(1).toLowerCase();
  }
  return shipment.client_prenom || '';
}

function extraireHotel(clientName) {
  if (!clientName) return '';
  if (clientName.includes(' - ')) return clientName.split(' - ')[0].trim();
  return clientName;
}

function formatDateFR(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR');
  } catch {
    return dateStr;
  }
}

// ─── Defaults (reproduisent le comportement actuel) ──────────────────────────

const DEFAULTS = {
  delivered: {
    enabled: true,
    delay_days: 0,
    recipient: 'client',
    subject: 'Terre de Mars - Confirmation de réception de vos échantillons',
    body_html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <p>Bonjour {{prenom}},</p>
  <p>J'espère que vous allez bien.</p>
  <p>Le colis apparait comme livré. Pouvez-vous me confirmer l'avoir bien reçu ?</p>
  <p>On fait le point quand vous avez pu les tester mais n'hésitez pas si vous avez des questions d'ici là.</p>
  {{tracking_link}}
  <p>Bonne journée,</p>
</div>`,
    hubspot_task: true,
    hubspot_task_days: 5,
    hubspot_task_subject: 'retour echantillon (reçu le {{delivered_at}})',
    hubspot_task_body: 'Relancer {{client_name}} suite à la réception des échantillons.',
  },
  pickup: {
    enabled: true,
    delay_days: 0,
    recipient: 'client',
    subject: 'Terre de Mars - Votre colis vous attend en point de retrait',
    body_html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <p>Bonjour {{prenom}},</p>
  <p>J'espère que vous allez bien.</p>
  <p>Votre colis n'a pas pu vous être remis et <strong>vous attend dans votre point de retrait</strong>.</p>
  <p>Pensez à le récupérer rapidement pour éviter un retour à l'expéditeur.</p>
  {{tracking_link}}
  <p>N'hésitez pas si vous avez des questions.</p>
  <p>Bonne journée,</p>
</div>`,
    hubspot_task: true,
    hubspot_task_days: 5,
    hubspot_task_subject: 'point retrait echantillon - {{client_name}}',
    hubspot_task_body: 'Vérifier si {{client_name}} a récupéré le colis en point de retrait. Tracking: {{tracking_number}}',
  },
  returned: {
    enabled: true,
    delay_days: 0,
    recipient: 'interne',
    subject: '⚠️ Retour à l\'expéditeur : {{client_name}} ({{order_ref}})',
    body_html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <p>Bonjour,</p>
  <p>Le colis suivant est en <strong style="color:#dc2626;">retour à l'expéditeur</strong> :</p>
  {{shipment_table}}
  <p style="margin-top:16px;color:#666;">Vérifier l'adresse et contacter le client si nécessaire.</p>
</div>`,
    hubspot_task: false,
    hubspot_task_days: 5,
    hubspot_task_subject: '',
    hubspot_task_body: '',
  },
  failed: {
    enabled: false,
    delay_days: 0,
    recipient: 'interne',
    subject: '⚠️ Échec de livraison : {{client_name}} ({{order_ref}})',
    body_html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <p>Bonjour,</p>
  <p>Le colis suivant est en <strong style="color:#dc2626;">échec de livraison</strong> :</p>
  {{shipment_table}}
  <p style="margin-top:16px;color:#666;">Vérifier avec le transporteur et contacter le client si nécessaire.</p>
</div>`,
    hubspot_task: false,
    hubspot_task_days: 5,
    hubspot_task_subject: '',
    hubspot_task_body: '',
  },
};

// ─── Config ──────────────────────────────────────────────────────────────────

function getNotificationConfig(db, type) {
  if (!NOTIFICATION_TYPES.includes(type)) throw new Error(`Type de notification inconnu: ${type}`);
  const defaults = DEFAULTS[type];
  const key = CONFIG_KEYS[type];

  try {
    const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get(key);
    if (row?.valeur) {
      const saved = JSON.parse(row.valeur);
      return { ...defaults, ...saved };
    }
  } catch (e) {
    logger.warn(`Erreur lecture config ${key}:`, e.message);
  }

  return { ...defaults };
}

function getAllNotificationConfigs(db) {
  const configs = {};
  for (const type of NOTIFICATION_TYPES) {
    configs[type] = getNotificationConfig(db, type);
  }
  return configs;
}

function saveNotificationConfig(db, type, config) {
  if (!NOTIFICATION_TYPES.includes(type)) throw new Error(`Type de notification inconnu: ${type}`);
  const key = CONFIG_KEYS[type];
  db.prepare(`
    INSERT INTO config (cle, valeur, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(config));
}

// ─── Substitution de variables ───────────────────────────────────────────────

function substituteVariables(template, shipment, db) {
  if (!template) return '';

  const prenom = extrairePrenom(shipment);
  const hotel = extraireHotel(shipment.client_name);
  const trackingUrl = buildTrackingUrl(shipment.carrier_name, shipment.tracking_number);
  const trackingLinkHtml = shipment.tracking_number
    ? `<p>Vous pouvez suivre votre colis ici : <a href="${trackingUrl}">${escapeHtml(shipment.tracking_number)}</a></p>`
    : '';

  const shipmentTableHtml = `<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse; font-size:14px;">
    <tr><td style="background:#f5f5f5;font-weight:bold;">Client</td><td>${escapeHtml(shipment.client_name)}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Email</td><td>${shipment.client_email || '-'}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Ville</td><td>${escapeHtml(shipment.client_city || '-')}${shipment.client_country ? ', ' + escapeHtml(shipment.client_country) : ''}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Référence</td><td>${escapeHtml(shipment.order_ref)}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Tracking</td><td>${shipment.tracking_number || '-'}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Type</td><td>${shipment.type}</td></tr>
  </table>`;

  return template
    .replace(/\{\{prenom\}\}/gi, escapeHtml(prenom))
    .replace(/\{\{client_name\}\}/gi, escapeHtml(shipment.client_name || ''))
    .replace(/\{\{hotel\}\}/gi, escapeHtml(hotel))
    .replace(/\{\{client_email\}\}/gi, escapeHtml(shipment.client_email || ''))
    .replace(/\{\{client_city\}\}/gi, escapeHtml(shipment.client_city || ''))
    .replace(/\{\{client_country\}\}/gi, escapeHtml(shipment.client_country || ''))
    .replace(/\{\{order_ref\}\}/gi, escapeHtml(shipment.order_ref || ''))
    .replace(/\{\{tracking_number\}\}/gi, escapeHtml(shipment.tracking_number || ''))
    .replace(/\{\{tracking_link\}\}/gi, trackingLinkHtml)
    .replace(/\{\{shipment_table\}\}/gi, shipmentTableHtml)
    .replace(/\{\{delivered_at\}\}/gi, formatDateFR(shipment.delivered_at))
    .replace(/\{\{carrier_name\}\}/gi, escapeHtml(shipment.carrier_name || ''));
}

// ─── HubSpot task helper ─────────────────────────────────────────────────────

async function createHubSpotTask(db, shipment, config) {
  if (!process.env.HUBSPOT_API_KEY) return;
  if (!config.hubspot_task) return;

  try {
    const lead = db.prepare('SELECT hubspot_id FROM leads WHERE email = ? LIMIT 1').get(shipment.client_email);
    const contactId = lead?.hubspot_id ? parseInt(lead.hubspot_id) : null;

    const domaine = shipment.client_email?.split('@')[1];
    const company = domaine ? await hubspotService.trouverCompanyParDomaine(domaine) : null;
    const companyId = company?.id ? parseInt(company.id) : null;

    const days = config.hubspot_task_days || 5;
    let taskDate = new Date();
    let businessDays = 0;
    while (businessDays < days) {
      taskDate.setDate(taskDate.getDate() + 1);
      if (taskDate.getDay() !== 0 && taskDate.getDay() !== 6) businessDays++;
    }

    const associations = {};
    if (contactId) associations.contactIds = [contactId];
    if (companyId) associations.companyIds = [parseInt(companyId)];

    const taskSubject = substituteVariables(config.hubspot_task_subject || '', shipment, db);
    const taskBody = substituteVariables(config.hubspot_task_body || '', shipment, db);

    await hubspotService.hubspotFetch('/engagements/v1/engagements', {
      method: 'POST',
      body: JSON.stringify({
        engagement: {
          active: true,
          type: 'TASK',
          timestamp: taskDate.getTime(),
          ownerId: parseInt(hubspotService.HUGO_OWNER_ID),
        },
        associations,
        metadata: {
          subject: taskSubject,
          body: taskBody,
          status: 'NOT_STARTED',
          priority: 'HIGH',
          taskType: 'TODO',
        }
      }),
    });
    logger.info(`📋 HubSpot task créée`, { email: shipment.client_email, taskDate: taskDate.toISOString().split('T')[0] });
  } catch (hsErr) {
    logger.error('HubSpot task échouée (non bloquant)', { error: hsErr.message, email: shipment.client_email });
  }
}

// ─── Envoi de notification ───────────────────────────────────────────────────

/**
 * Envoie une notification pour un shipment donné.
 * Vérifie : enabled, délai, pas déjà notifié, construit l'email, envoie via Brevo,
 * crée la task HubSpot si configuré, marque *_notified_at.
 *
 * @returns {boolean} true si envoyé, false sinon
 */
async function sendNotification(db, shipment, notifType) {
  if (!NOTIFICATION_TYPES.includes(notifType)) {
    logger.warn(`[Notification] Type inconnu: ${notifType}`);
    return false;
  }

  // Recharger le shipment pour avoir les données à jour
  const fresh = db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipment.id);
  if (!fresh || fresh.type !== 'echantillon') return false;

  const config = getNotificationConfig(db, notifType);
  if (!config.enabled) return false;

  // Vérifier si déjà notifié
  const notifiedCol = NOTIFIED_COLUMNS[notifType];
  if (fresh[notifiedCol]) return false;

  // Vérifier le délai
  if (config.delay_days > 0) {
    const dateCol = DATE_COLUMNS[notifType];
    const statusDate = fresh[dateCol] ? new Date(fresh[dateCol]) : null;
    if (!statusDate) return false;
    const diffDays = Math.floor((Date.now() - statusDate.getTime()) / 86400000);
    if (diffDays < config.delay_days) return false;
  }

  // Vérifier qu'on a un destinataire
  if (config.recipient === 'client' && !fresh.client_email) return false;

  const prenom = extrairePrenom(fresh);
  const signature = brevoService.getSignature(db);

  // Construire sujet et corps avec substitution de variables
  const subject = substituteVariables(config.subject, fresh, db);
  let htmlContent = substituteVariables(config.body_html, fresh, db);

  // Ajouter la signature
  htmlContent += `\n<div style="border-top:1px solid #e5e0d5;padding-top:12px;margin-top:16px;">\n  ${signature}\n</div>`;

  // Envoyer
  const emailPayload = {
    sender: brevoService.SENDER,
    subject,
    htmlContent,
    replyTo: { email: 'hugo@terredemars.com', name: 'Hugo Montiel' },
  };

  if (config.recipient === 'client') {
    emailPayload.to = [{ email: fresh.client_email, name: prenom || fresh.client_name }];
    emailPayload.bcc = [{ email: 'hugo@terredemars.com', name: 'Hugo Montiel' }];
  } else {
    emailPayload.to = [{ email: 'hugo@terredemars.com', name: 'Hugo Montiel' }];
  }

  await brevoService.brevoSendEmail(emailPayload);

  // Task HubSpot
  if (config.hubspot_task && fresh.client_email) {
    await createHubSpotTask(db, fresh, config);
  }

  // Marquer comme notifié — NOTIFIED_COLUMNS[notifType] vient d'un objet hardcodé, safe pour SQL
  db.prepare(`UPDATE shipments SET ${notifiedCol} = datetime('now') WHERE id = ?`).run(fresh.id);

  const logEmoji = { delivered: '✉️', pickup: '📦', returned: '⚠️', failed: '❌' };
  logger.info(`${logEmoji[notifType] || '📧'} Notification "${notifType}" envoyée pour ${fresh.client_name} (${fresh.order_ref})`);

  return true;
}

// ─── Batch : notifier tous les envois en attente pour tous les types ─────────

async function notifyPendingAll(db) {
  let totalSent = 0;

  for (const type of NOTIFICATION_TYPES) {
    const config = getNotificationConfig(db, type);
    if (!config.enabled) continue;

    const notifiedCol = NOTIFIED_COLUMNS[type];
    const statusCond = STATUS_CONDITIONS[type];

    const clientFilter = config.recipient === 'client' ? 'AND client_email IS NOT NULL' : '';

    const pending = db.prepare(`
      SELECT * FROM shipments WHERE type = 'echantillon'
        AND ${statusCond}
        AND ${notifiedCol} IS NULL
        ${clientFilter}
      ORDER BY created_at ASC
      LIMIT 10
    `).all();

    for (const s of pending) {
      try {
        const sent = await sendNotification(db, s, type);
        if (sent) totalSent++;
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        logger.error(`[Notification] Erreur ${type} pour ${s.client_name}: ${err.message}`);
      }
    }
  }

  return totalSent;
}

module.exports = {
  NOTIFICATION_TYPES,
  CONFIG_KEYS,
  NOTIFIED_COLUMNS,
  DATE_COLUMNS,
  STATUS_CONDITIONS,
  DEFAULTS,
  buildTrackingUrl,
  escapeHtml,
  extrairePrenom,
  getNotificationConfig,
  getAllNotificationConfigs,
  saveNotificationConfig,
  substituteVariables,
  sendNotification,
  notifyPendingAll,
};
