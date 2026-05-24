/**
 * wmsRefreshJob.js — Rafraîchissement automatique des statuts WMS + suivi livraison
 *
 * Toutes les 30 minutes :
 * 1. Interroge le WMS Endurance pour récupérer tracking + statut expédition
 * 2. Pour les colis expédiés avec tracking, interroge l'API La Poste
 *    pour détecter la livraison (Colissimo / Chronopost)
 * 3. Envoie automatiquement l'email client + task HubSpot quand un échantillon est livré
 */

const cron = require('node-cron');
const logger = require('../config/logger');
const wmsService = require('../services/wmsService');
const carrierTracking = require('../services/carrierTrackingService');
const brevoService = require('../services/brevoService');
const hubspotService = require('../services/hubspotService');

let db;

const JUNK = new Set(['unknown', 'undefined', 'null', 'n/a', '0', '']);
const clean = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  return JUNK.has(s.toLowerCase()) ? null : s;
};

// ─── Helpers ────────────────────────────────────────────────────────────────
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

// ─── Envoi automatique email client + task HubSpot ──────────────────────────
async function autoNotifyClient(shipment) {
  // Recharger le shipment pour avoir delivered_at à jour
  const fresh = db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipment.id);
  if (!fresh || fresh.type !== 'echantillon' || !fresh.client_email || !fresh.delivered_at) return;
  if (fresh.client_notified_at) return; // Déjà envoyé

  const prenom = fresh.client_prenom || (fresh.client_name && fresh.client_name.includes(' - ') ? fresh.client_name.split(' - ')[1].trim().split(' ')[0] : '');
  const trackingLink = buildTrackingUrl(fresh.carrier_name, fresh.tracking_number);
  const signature = brevoService.getSignature(db);

  const htmlContent = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <p>Bonjour ${escapeHtml(prenom)},</p>
  <p>J'espère que vous allez bien.</p>
  <p>Le colis apparait comme livré. Pouvez-vous me confirmer l'avoir bien reçu ?</p>
  <p>On fait le point quand vous avez pu les tester mais n'hésitez pas si vous avez des questions d'ici là.</p>
  ${fresh.tracking_number ? `<p>Vous pouvez suivre votre colis ici : <a href="${trackingLink}">${escapeHtml(fresh.tracking_number)}</a></p>` : ''}
  <p>Bonne journée,</p>
  <div style="border-top:1px solid #e5e0d5;padding-top:12px;margin-top:16px;">
    ${signature}
  </div>
</div>`;

  // Envoyer via Brevo (BCC Hugo)
  await brevoService.brevoSendEmail({
    sender: brevoService.SENDER,
    to: [{ email: fresh.client_email, name: prenom || fresh.client_name }],
    bcc: [{ email: 'hugo@terredemars.com', name: 'Hugo Montiel' }],
    subject: 'Terre de Mars - Confirmation de réception de vos échantillons',
    htmlContent,
    replyTo: { email: 'hugo@terredemars.com', name: 'Hugo Montiel' },
  });

  // Créer task HubSpot (optionnel)
  try {
    if (process.env.HUBSPOT_API_KEY) {
      const deliveredDate = new Date(fresh.delivered_at).toLocaleDateString('fr-FR');

      const lead = db.prepare('SELECT hubspot_id FROM leads WHERE email = ? LIMIT 1').get(fresh.client_email);
      const contactId = lead?.hubspot_id ? parseInt(lead.hubspot_id) : null;

      const domaine = fresh.client_email.split('@')[1];
      const company = await hubspotService.trouverCompanyParDomaine(domaine);
      const companyId = company?.id ? parseInt(company.id) : null;

      // +5 jours ouvrés
      let taskDate = new Date();
      let businessDays = 0;
      while (businessDays < 5) {
        taskDate.setDate(taskDate.getDate() + 1);
        if (taskDate.getDay() !== 0 && taskDate.getDay() !== 6) businessDays++;
      }

      const associations = {};
      if (contactId) associations.contactIds = [contactId];
      if (companyId) associations.companyIds = [parseInt(companyId)];

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
            subject: `retour echantillon (reçu le ${deliveredDate})`,
            body: `Relancer ${fresh.client_name} suite à la réception des échantillons.`,
            status: 'NOT_STARTED',
            priority: 'HIGH',
            taskType: 'TODO',
          }
        }),
      });
      logger.info('📋 HubSpot task "retour echantillon" créée', { email: fresh.client_email, taskDate: taskDate.toISOString().split('T')[0] });
    }
  } catch (hsErr) {
    logger.error('HubSpot task échouée (non bloquant)', { error: hsErr.message, email: fresh.client_email });
  }

  // Marquer comme notifié
  db.prepare("UPDATE shipments SET client_notified_at = datetime('now') WHERE id = ?").run(fresh.id);
  logger.info(`✉️ Email auto envoyé à ${fresh.client_email} (${fresh.client_name})`);
}

// ──��� Phase 1 : Refresh WMS Endurance (tracking + statut expédition) ─────────
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

      // Envoi automatique email client + task HubSpot
      try {
        await autoNotifyClient(shipment);
      } catch (notifErr) {
        logger.error(`[Auto Notify] Erreur pour ${shipment.client_name}:`, notifErr.message);
      }

    } else if (result?.type === 'returned') {
      returned++;
      logger.info(`[Carrier Tracking] ${shipment.order_ref} (${shipment.tracking_number}) → Retour à l'expéditeur`);
      // Envoyer notification à Hugo
      try {
        await brevoService.brevoSendEmail({
          sender: brevoService.SENDER,
          to: [{ email: 'hugo@terredemars.com', name: 'Hugo Montiel' }],
          subject: `⚠️ Retour à l'expéditeur : ${shipment.client_name} (${shipment.order_ref})`,
          htmlContent: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <p>Bonjour,</p>
  <p>Le colis suivant est en <strong style="color:#dc2626;">retour à l'expéditeur</strong> :</p>
  <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse; font-size:14px;">
    <tr><td style="background:#f5f5f5;font-weight:bold;">Client</td><td>${escapeHtml(shipment.client_name)}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Email</td><td>${shipment.client_email || '-'}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Ville</td><td>${escapeHtml(shipment.client_city || '-')}${shipment.client_country ? ', ' + escapeHtml(shipment.client_country) : ''}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Référence</td><td>${escapeHtml(shipment.order_ref)}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Tracking</td><td>${shipment.tracking_number || '-'}</td></tr>
    <tr><td style="background:#f5f5f5;font-weight:bold;">Type</td><td>${shipment.type}</td></tr>
  </table>
  <p style="margin-top:16px;color:#666;">Vérifier l'adresse et contacter le client si nécessaire.</p>
</div>`,
          replyTo: { email: brevoService.SENDER.email, name: brevoService.SENDER.name },
        });
      } catch (emailErr) {
        logger.error('[Carrier Tracking] Erreur envoi notif retour:', emailErr.message);
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

// ─── Job principal ────────────────────────────────────��──────────────────────
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
