/**
 * deliveryNotifier.js — Notification email quand un échantillon est livré
 * Cron quotidien à 9h : cherche les échantillons livrés non notifiés, envoie un email récapitulatif à Hugo
 */
const cron = require('node-cron');

let _db = null;

function initialiser(db) {
  _db = db;
  cron.schedule('0 9 * * *', () => traiterLivraisonsEchantillons());
  // Premier run 60s après démarrage (rattraper les livraisons manquées)
  setTimeout(() => traiterLivraisonsEchantillons(), 60 * 1000);
  console.log('📬 Delivery notifier initialisé (quotidien 9h + run initial 60s)');
}

async function traiterLivraisonsEchantillons() {
  if (!_db) return;

  let shipments = [];
  try {
    shipments = _db.prepare(`
      SELECT * FROM shipments
      WHERE type = 'echantillon'
        AND delivered_at IS NOT NULL
        AND delivery_notified_at IS NULL
        AND date(delivered_at) < date('now')
      ORDER BY delivered_at DESC
    `).all();
  } catch (err) {
    console.error('📬 Delivery notifier: erreur requête:', err.message);
    return;
  }

  if (shipments.length === 0) return;

  const brevoService = require('../services/brevoService');
  let totalSent = 0;

  for (const shipment of shipments) {
    try {
      const trackingLink = buildTrackingUrl(shipment.carrier_name, shipment.tracking_number);
      const deliveredDate = shipment.delivered_at ? new Date(shipment.delivered_at).toLocaleDateString('fr-FR') : 'N/A';

      const htmlContent = `
        <p>Bonjour,</p>
        <p>Un échantillon a été détecté comme <strong>livré</strong> :</p>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse; font-family:Arial,sans-serif; font-size:14px;">
          <tr><td style="background:#f5f5f5;font-weight:bold;">Client</td><td>${escapeHtml(shipment.client_name)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Ville</td><td>${escapeHtml(shipment.client_city || '-')}${shipment.client_country ? ', ' + escapeHtml(shipment.client_country) : ''}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Référence</td><td>${escapeHtml(shipment.order_ref)}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Numéro de suivi</td><td>${shipment.tracking_number ? `<a href="${trackingLink}">${escapeHtml(shipment.tracking_number)}</a>` : '-'}</td></tr>
          <tr><td style="background:#f5f5f5;font-weight:bold;">Date de livraison</td><td>${deliveredDate}</td></tr>
        </table>
        <p style="margin-top:16px;color:#666;font-size:12px;">Pensez à envoyer un email de confirmation au prospect depuis l'onglet Envois.</p>
      `;

      await brevoService.brevoSendEmail({
        sender: brevoService.SENDER,
        to: [{ email: 'hugo@terredemars.com', name: 'Hugo Montiel' }],
        subject: `Échantillon livré : ${shipment.client_name} (${shipment.order_ref})`,
        htmlContent,
        replyTo: { email: brevoService.SENDER.email, name: brevoService.SENDER.name },
      });

      _db.prepare("UPDATE shipments SET delivery_notified_at = datetime('now') WHERE id = ?").run(shipment.id);
      totalSent++;

      // Petit délai entre envois
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`📬 Delivery notifier: erreur envoi pour ${shipment.client_name} (${shipment.order_ref}):`, err.message);
    }
  }

  if (totalSent > 0) console.log(`📬 ${totalSent} notification(s) de livraison envoyée(s)`);
}

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

module.exports = { initialiser };
