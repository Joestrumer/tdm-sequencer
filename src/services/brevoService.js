/**
 * brevoService.js — Intégration complète de l'API Brevo (ex-SendinBlue)
 *
 * Fonctionnalités :
 *  - Envoi d'emails transactionnels via l'API Brevo v3
 *  - Injection du pixel de tracking d'ouverture
 *  - Injection des liens trackés (clic)
 *  - Lien de désabonnement RGPD automatique
 *  - Retry automatique (3 tentatives) avec backoff exponentiel
 *  - Respect du quota journalier
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

// ─── Envoi Brevo via fetch natif (pas de SDK) ────────────────────────────────
async function brevoSendEmail(payload) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo API ${res.status}: ${err}`);
  }
  return res.json();
}

const SENDER = {
  email: process.env.BREVO_SENDER_EMAIL || 'joe@terre-de-mars.com',
  name: process.env.BREVO_SENDER_NAME || 'Joe — Terre de Mars',
};

const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3001';

// ─── Substitution des variables dynamiques ───────────────────────────────────
function substituerVariables(texte, lead) {
  return texte
    .replace(/\{\{prenom\}\}/gi, lead.prenom || '')
    .replace(/\{\{nom\}\}/gi, lead.nom || '')
    .replace(/\{\{hotel\}\}/gi, lead.hotel || '')
    .replace(/\{\{ville\}\}/gi, lead.ville || '')
    .replace(/\{\{segment\}\}/gi, lead.segment || '');
}

// ─── Signature HTML Hugo Montiel ─────────────────────────────────────────────
const SIGNATURE_HUGO = `
<table cellpadding="0" cellspacing="0" border="0" style="vertical-align: -webkit-baseline-middle; font-size: small; font-family: Arial;"><tbody><tr><td style="vertical-align: middle;"><table cellpadding="0" cellspacing="0" border="0" style="vertical-align: -webkit-baseline-middle; font-size: small; font-family: Arial;"><tbody><tr><td><h2 style="margin: 0px; font-size: 16px; font-family: Arial; color: rgb(0, 0, 0); font-weight: 600;"><span>Hugo</span><span>&nbsp;</span><span>Montiel</span></h2><p style="margin: 0px; color: rgb(0, 0, 0); font-size: 12px; line-height: 20px;"><span>Sales Director</span></p><div style="margin: 0px; font-weight: 500; color: rgb(0, 0, 0); font-size: 12px; line-height: 20px;"><span>Terre De Mars</span></div></td><td width="15" aria-label="Vertical Spacer"><div style="width: 15px;"></div></td><td width="1" aria-label="Divider" style="width: 1px; height: auto; border-bottom: none; border-left: 1px solid rgb(170, 141, 62);"></td><td width="15" aria-label="Vertical Spacer"><div style="width: 15px;"></div></td><td><table cellpadding="0" cellspacing="0" border="0" style="vertical-align: -webkit-baseline-middle; font-size: small; font-family: Arial;"><tbody><tr style="vertical-align: middle; height: 25px;"><td width="30" style="vertical-align: middle;"><table cellpadding="0" cellspacing="0" border="0" style="vertical-align: -webkit-baseline-middle; font-size: small; font-family: Arial; width: 30px;"><tbody><tr><td style="vertical-align: bottom;"><span style="display: inline-block; background-color: rgb(170, 141, 62);"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/phone-icon-dark-2x.png" alt="mobilePhone" width="13" style="display: block; background-image: linear-gradient(rgb(170, 141, 62), rgb(170, 141, 62));"></span></td></tr></tbody></table></td><td style="padding: 0px; color: rgb(0, 0, 0);"><a href="tel:+33685820335" style="text-decoration: none; color: rgb(0, 0, 0); font-size: 12px;"><span>+33685820335</span></a></td></tr><tr style="vertical-align: middle; height: 25px;"><td width="30" style="vertical-align: middle;"><table cellpadding="0" cellspacing="0" border="0" style="vertical-align: -webkit-baseline-middle; font-size: small; font-family: Arial; width: 30px;"><tbody><tr><td style="vertical-align: bottom;"><span style="display: inline-block; background-color: rgb(170, 141, 62);"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/email-icon-dark-2x.png" alt="emailAddress" width="13" style="display: block; background-image: linear-gradient(rgb(170, 141, 62), rgb(170, 141, 62));"></span></td></tr></tbody></table></td><td style="padding: 0px; color: rgb(0, 0, 0);"><a href="mailto:hugo@terredemars.com" style="text-decoration: none; color: rgb(0, 0, 0); font-size: 12px;"><span>hugo@terredemars.com</span></a></td></tr><tr style="vertical-align: middle; height: 25px;"><td width="30" style="vertical-align: middle;"><table cellpadding="0" cellspacing="0" border="0" style="vertical-align: -webkit-baseline-middle; font-size: small; font-family: Arial; width: 30px;"><tbody><tr><td style="vertical-align: bottom;"><span style="display: inline-block; background-color: rgb(170, 141, 62);"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/link-icon-dark-2x.png" alt="website" width="13" style="display: block; background-image: linear-gradient(rgb(170, 141, 62), rgb(170, 141, 62));"></span></td></tr></tbody></table></td><td style="padding: 0px; color: rgb(0, 0, 0);"><a href="https://www.terredemars.com/" style="text-decoration: none; color: rgb(0, 0, 0); font-size: 12px;"><span>https://www.terredemars.com/</span></a></td></tr><tr style="vertical-align: middle; height: 25px;"><td width="30" style="vertical-align: middle;"><table cellpadding="0" cellspacing="0" border="0" style="vertical-align: -webkit-baseline-middle; font-size: small; font-family: Arial; width: 30px;"><tbody><tr><td style="vertical-align: bottom;"><span style="display:inline-block; background-color: rgb(170, 141, 62);"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/address-icon-dark-2x.png" alt="address" width="13" style="display: block; background-image: linear-gradient(rgb(170, 141, 62), rgb(170, 141, 62));"></span></td></tr></tbody></table></td><td style="padding: 0px; color: rgb(0, 0, 0);"><span style="font-size: 12px; color: rgb(0, 0, 0);"><span>2 Rue de Vienne, 75008 Paris</span></span></td></tr></tbody></table></td></tr></tbody></table></td></tr><tr><td height="30" aria-label="Horizontal Spacer"></td></tr><tr><td width="auto" aria-label="Divider" style="width: 100%; height: 1px; border-bottom: 1px solid rgb(170, 141, 62); border-left: none; display: block;"></td></tr><tr><td height="30" aria-label="Horizontal Spacer"></td></tr><tr><td><table cellpadding="0" cellspacing="0" border="0" style="vertical-align: -webkit-baseline-middle; font-size: small; font-family: Arial; width: 100%;"><tbody><tr><td style="vertical-align: top;"><img src="https://26199813.fs1.hubspotusercontent-eu1.net/hubfs/26199813/Screenshot%202023-01-17%20at%2012.55.44.png" role="presentation" width="130" style="max-width: 130px; display: block;"></td><td style="text-align: right; vertical-align: top;"><div><a href="https://www.linkedin.com/company/terre-de-mars-maison-de-cosmetique-naturelle/" style="display: inline-block; padding: 0px; background-color: rgb(0, 0, 0); border-radius: 50%;"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/linkedin-icon-dark-2x.png" alt="linkedin" width="24" loading="lazy" style="background-color: rgb(0, 0, 0); max-width: 135px; display: block; border-radius: inherit;"></a><span style="display: inline-block; width: 5px;"></span><a href="https://www.facebook.com/terredemarsparis/" style="display: inline-block; padding: 0px; background-color: rgb(0, 0, 0); border-radius: 50%;"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/facebook-icon-dark-2x.png" alt="facebook" width="24" loading="lazy" style="background-color: rgb(0, 0, 0); max-width: 135px; display: block; border-radius: inherit;"></a><span style="display: inline-block; width: 5px;"></span><a href="https://www.instagram.com/terredemars/" style="display: inline-block; padding: 0px; background-color: rgb(0, 0, 0); border-radius: 50%;"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/instagram-icon-dark-2x.png" alt="instagram" width="24" loading="lazy" style="background-color: rgb(0, 0, 0); max-width: 135px; display: block; border-radius: inherit;"></a></div></td></tr></tbody></table></td></tr><tr><td><table cellpadding="0" cellspacing="0" border="0" style="vertical-align: -webkit-baseline-middle; font-size: small; font-family: Arial; width: 100%;"><tbody><tr><td></td><td style="text-align: right;"><span style="display: block; text-align: right;"><a data-cy="custom-cta-button" target="_blank" rel="noopener noreferrer" href="https://calendly.com/hugo-montiel/meeting-terre-de-mars"><span style="border-width: 6px 12px; border-style: solid; border-color: rgb(170, 141, 62); display: inline-block; background-color: rgb(170, 141, 62); color: rgb(255, 255, 255); font-weight: 700; text-decoration: none; text-align: center; line-height: 40px; font-size: 12px; border-radius: 3px;">Prendre rendez-vous</span></a></span></td></tr></tbody></table></td></tr></tbody></table>
`;

// ─── Conversion texte brut → HTML propre ─────────────────────────────────────
function texteVersHtml(texte, trackingId, lead, estHtml = false) {
  const unsubUrl = `${PUBLIC_URL}/api/tracking/unsubscribe/${lead.id}?t=${trackingId}`;
  const pixelUrl = `${PUBLIC_URL}/api/tracking/open/${trackingId}`;

  let html;
  if (estHtml) {
    // Déjà en HTML — juste tracker les liens existants
    html = texte.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
      if (url.includes('/api/tracking')) return match; // déjà tracké
      const trackedUrl = `${PUBLIC_URL}/api/tracking/click/${trackingId}?url=${encodeURIComponent(url)}`;
      return `href="${trackedUrl}"`;
    });
  } else {
    html = texte
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+)/g, (url) => {
        const trackedUrl = `${PUBLIC_URL}/api/tracking/click/${trackingId}?url=${encodeURIComponent(url)}`;
        return `<a href="${trackedUrl}" style="color:#1a1a2e;">${url}</a>`;
      });
  }

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title></title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.6; color: #2d2d2d; margin: 0; padding: 0; background: #f8f8f8; }
    .wrapper { max-width: 600px; margin: 30px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .body { padding: 36px 40px 24px; }
    .signature-wrapper { padding: 0 40px 24px; }
    .footer { padding: 16px 40px; background: #f4f4f4; border-top: 1px solid #eee; font-size: 11px; color: #aaa; text-align: center; }
    .footer a { color: #aaa; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="wrapper">

    <!-- Corps du message -->
    <div class="body">
      ${html}
    </div>

    <!-- Séparateur avant signature -->
    <div style="margin: 0 40px; border-top: 1px solid #e8e0cc;"></div>

    <!-- Signature Hugo Montiel -->
    <div class="signature-wrapper" style="padding-top: 20px;">
      ${SIGNATURE_HUGO}
    </div>

    <!-- Footer RGPD discret -->
    <div class="footer">
      Vous recevez cet email car vous avez été identifié comme contact potentiel de Terre de Mars.
      &nbsp;·&nbsp;
      <a href="${unsubUrl}">Se désabonner</a>
    </div>

  </div>
  <!-- Pixel de tracking ouverture -->
  <img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body>
</html>`;
}

// ─── Vérification du quota journalier ────────────────────────────────────────
function verifierQuotaJournalier(db) {
  const today = new Date().toISOString().split('T')[0];
  const maxParJour = parseInt(process.env.MAX_EMAILS_PER_DAY) || 50;

  const row = db.prepare('SELECT count FROM envoi_quota WHERE date_jour = ?').get(today);
  const count = row?.count || 0;

  if (count >= maxParJour) {
    throw new Error(`Quota journalier atteint : ${count}/${maxParJour} emails envoyés aujourd'hui`);
  }

  return { count, maxParJour, today };
}

// ─── Incrémenter le quota journalier ─────────────────────────────────────────
function incrementerQuota(db, today) {
  db.prepare(`
    INSERT INTO envoi_quota (date_jour, count) VALUES (?, 1)
    ON CONFLICT(date_jour) DO UPDATE SET count = count + 1
  `).run(today);
}

// ─── Retry avec backoff exponentiel ──────────────────────────────────────────
async function avecRetry(fn, maxTentatives = 3, delaiMs = 1000) {
  let derniereErreur;
  for (let i = 0; i < maxTentatives; i++) {
    try {
      return await fn();
    } catch (err) {
      derniereErreur = err;
      // Ne pas retenter sur les erreurs 4xx (problème de config)
      if (err.status && err.status >= 400 && err.status < 500) throw err;
      if (i < maxTentatives - 1) {
        const delai = delaiMs * Math.pow(2, i);
        logger.warn(`Tentative ${i + 1}/${maxTentatives} échouée, retry dans ${delai}ms`, { erreur: err.message });
        await new Promise(r => setTimeout(r, delai));
      }
    }
  }
  throw derniereErreur;
}

// ─── Envoi principal ─────────────────────────────────────────────────────────
async function envoyerEmail(db, { lead, etape, inscriptionId }) {
  // 1. Vérifier quota
  const { today } = verifierQuotaJournalier(db);

  // 2. Vérifier que le lead n'est pas désabonné
  if (lead.unsubscribed) {
    throw new Error(`Lead désabonné : ${lead.email}`);
  }

  // 3. Substituer les variables
  const sujet = substituerVariables(etape.sujet, lead);
  const corpsTexte = substituerVariables(etape.corps, lead);

  // 4. Générer un ID de tracking unique
  const trackingId = uuidv4();

  // 5. Construire le HTML (corps_html si éditeur riche, sinon conversion texte)
  const corpsHtml = etape.corps_html
    ? texteVersHtml(etape.corps_html, trackingId, lead, true)
    : texteVersHtml(corpsTexte, trackingId, lead, false);

  // 6. Préparer le payload Brevo
  const payload = {
    sender: SENDER,
    to: [{ email: lead.email, name: `${lead.prenom} ${lead.nom}`.trim() }],
    subject: sujet,
    htmlContent: corpsHtml,
    textContent: corpsTexte,
    replyTo: { email: SENDER.email, name: SENDER.name },
    headers: {
      'X-Mailer': 'Terre-de-Mars-Sequencer/1.0',
      'List-Unsubscribe': `<${PUBLIC_URL}/api/tracking/unsubscribe/${lead.id}?t=${trackingId}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };

  // Pièce jointe si présente
  if (etape.piece_jointe?.data) {
    payload.attachment = [{
      content: etape.piece_jointe.data,
      name: etape.piece_jointe.nom,
    }];
  }

  // 7. Envoyer via fetch natif
  let brevoMessageId = null;
  if (process.env.BREVO_API_KEY) {
    const result = await avecRetry(() => brevoSendEmail(payload));
    brevoMessageId = result?.messageId || null;
    logger.info(`✉️  Email envoyé via Brevo`, { to: lead.email, messageId: brevoMessageId });
  } else {
    logger.info(`📧 [MODE DÉMO] Email simulé pour ${lead.email} : "${sujet}"`);
    brevoMessageId = `demo-${Date.now()}`;
  }

  // 8. Enregistrer l'email en base
  const emailId = uuidv4();
  db.prepare(`
    INSERT INTO emails (id, inscription_id, lead_id, etape_id, sujet, brevo_message_id, tracking_id, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'envoyé')
  `).run(emailId, inscriptionId, lead.id, etape.id, sujet, brevoMessageId, trackingId);

  // 9. Enregistrer l'événement
  db.prepare(`INSERT INTO events (id, email_id, lead_id, type) VALUES (?, ?, ?, 'envoi')`).run(uuidv4(), emailId, lead.id);

  // 10. Mettre à jour le quota
  incrementerQuota(db, today);

  return { emailId, trackingId, brevoMessageId };
}

// ─── Vérifier si on est dans la fenêtre d'envoi ──────────────────────────────
function estDansLaFenetreEnvoi() {
  const now = new Date();
  const heure = now.getHours();
  const jourSemaine = now.getDay(); // 0=dim, 1=lun, ..., 6=sam

  const heureDebut = parseInt(process.env.SEND_HOUR_START) || 8;
  const heureFin = parseInt(process.env.SEND_HOUR_END) || 18;
  const joursActifs = (process.env.ACTIVE_DAYS || '1,2,3,4,5').split(',').map(Number);

  return heure >= heureDebut && heure < heureFin && joursActifs.includes(jourSemaine);
}

// ─── Quota restant aujourd'hui ───────────────────────────────────────────────
function getQuotaRestant(db) {
  const today = new Date().toISOString().split('T')[0];
  const maxParJour = parseInt(process.env.MAX_EMAILS_PER_DAY) || 50;
  const row = db.prepare('SELECT count FROM envoi_quota WHERE date_jour = ?').get(today);
  return { envoyes: row?.count || 0, max: maxParJour, restant: maxParJour - (row?.count || 0) };
}

module.exports = {
  envoyerEmail,
  estDansLaFenetreEnvoi,
  getQuotaRestant,
  substituerVariables,
};
