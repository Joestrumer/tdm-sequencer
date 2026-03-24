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

// ─── Envoi Brevo via SMTP (nodemailer si dispo) ou API REST ─────────────────

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch(e) { throw new Error('nodemailer non disponible'); }
  // Essayer port 587, 465, puis 2525 selon ce que Railway autorise
  const smtpPort = parseInt(process.env.BREVO_SMTP_PORT) || 587;
  const smtpSecure = smtpPort === 465;
  _transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: process.env.BREVO_SMTP_USER || 'hugo@terredemars.com',
      pass: process.env.BREVO_SMTP_KEY,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return _transporter;
}

async function brevoSendEmail(payload) {
  // SMTP si BREVO_SMTP_KEY défini ET nodemailer disponible
  if (process.env.BREVO_SMTP_KEY) {
    try {
      const transporter = getTransporter();
      const mailOptions = {
        from: '"' + payload.sender.name + '" <' + payload.sender.email + '>',
        to: payload.to.map(t => '"' + (t.name || '') + '" <' + t.email + '>').join(', '),
        subject: payload.subject,
        html: payload.htmlContent,
        text: payload.textContent || '',
        replyTo: payload.replyTo ? '"' + payload.replyTo.name + '" <' + payload.replyTo.email + '>' : undefined,
        headers: payload.headers || {},
      };
      if (payload.bcc && payload.bcc.length) {
        mailOptions.bcc = payload.bcc.map(b => b.email).join(', ');
      }
      if (payload.attachment && payload.attachment.length) {
        mailOptions.attachments = payload.attachment.map(function(a) {
          return { filename: a.name, content: Buffer.from(a.content, 'base64') };
        });
      }
      const info = await transporter.sendMail(mailOptions);
      logger.info('Email envoyé via SMTP Brevo', { messageId: info.messageId });
      return { messageId: info.messageId };
    } catch(smtpErr) {
      logger.warn('SMTP echoue, fallback API REST', { erreur: smtpErr.message });
    }
  }

  // API REST Brevo (fallback ou par defaut)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s max
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error('Brevo API ' + res.status + ': ' + errText);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } catch(e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Brevo API timeout (>15s) — verifier IP whitelist ou connectivite Railway');
    throw e;
  }
}

// ─── Nettoyage HTML éditeur (supprime attributs Froala/isPasted) ─────────────
function nettoyerHtml(html) {
  if (!html) return html;
  return html
    .replace(/\s*fr-original-style="[^"]*"/g, '')
    .replace(/\s*fr-original-class="[^"]*"/g, '')
    .replace(/\s*id="isPasted"/g, '')
    .replace(/\s*data-fr-[^=\s]+="[^"]*"/g, '')
    // Nettoyer styles inline verbeux sur p/span pour garder uniquement font-size utile
    .replace(/<(p|div|span)([^>]*)\sstyle="[^"]*caret-color:[^"]*"([^>]*)>/g, (m, tag, before, after) => {
      // Garder uniquement font-size et font-family si présents
      const fs = m.match(/font-size:\s*([^;'"]+)/);
      const ff = m.match(/font-family:\s*([^;'"]+)/);
      const parts = [fs && `font-size:${fs[1]}`, ff && `font-family:${ff[1]}`].filter(Boolean);
      const style = parts.length ? ` style="${parts.join(';')}"` : '';
      return `<${tag}${style}>`;
    })
    // Convertir <div><br></div> (Chrome line breaks) en simple <br>
    .replace(/<div><br\s*\/?><\/div>/gi, '<br>')
    // Convertir <p><br></p> en <br>
    .replace(/<p><br\s*\/?><\/p>/gi, '<br>');
}

const SENDER = {
  email: process.env.BREVO_SENDER_EMAIL || 'hugo@terredemars.com',
  name: process.env.BREVO_SENDER_NAME || 'Hugo Montiel',
};

const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3001';

// ─── Substitution des variables dynamiques ───────────────────────────────────
function substituerVariables(texte, lead) {
  return texte
    .replace(/\{\{prenom\}\}/gi, lead.prenom || '')
    .replace(/\{\{nom\}\}/gi, lead.nom || '')
    .replace(/\{\{hotel\}\}/gi, lead.hotel || '')
    .replace(/\{\{etablissement\}\}/gi, lead.hotel || '')
    .replace(/\{\{ville\}\}/gi, lead.ville || '')
    .replace(/\{\{segment\}\}/gi, lead.segment || '');
}

// ─── Signature HTML Hugo Montiel ─────────────────────────────────────────────
const SIGNATURE_HUGO = `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;margin-top:4px;">
<tr>
  <td style="padding-right:16px;border-right:2px solid #aa8d3e;vertical-align:top;">
    <div style="font-weight:700;font-size:14px;color:#1a1a1a;">Hugo Montiel</div>
    <div style="color:#555;font-size:12px;line-height:1.5;">Sales Director</div>
    <div style="color:#555;font-size:12px;">Terre de Mars</div>
  </td>
  <td style="padding-left:16px;vertical-align:top;">
    <div style="font-size:12px;color:#444;line-height:1.8;">
      <a href="tel:+33685820335" style="color:#444;text-decoration:none;">+33 6 85 82 03 35</a><br>
      <a href="mailto:hugo@terredemars.com" style="color:#aa8d3e;text-decoration:none;">hugo@terredemars.com</a><br>
      <a href="https://www.terredemars.com" style="color:#aa8d3e;text-decoration:none;">www.terredemars.com</a><br>
      <span style="color:#888;">2 Rue de Vienne, 75008 Paris</span>
    </div>
  </td>
</tr>
<tr><td colspan="2" style="padding-top:10px;">
  <a href="https://calendly.com/hugo-montiel/meeting-terre-de-mars" style="display:inline-block;background:#aa8d3e;color:#fff;font-size:11px;font-weight:700;text-decoration:none;padding:6px 14px;border-radius:3px;">Prendre rendez-vous</a>
  &nbsp;
  <a href="https://www.linkedin.com/company/terre-de-mars-maison-de-cosmetique-naturelle/" style="color:#888;font-size:11px;text-decoration:none;">LinkedIn</a>
  &nbsp;·&nbsp;
  <a href="https://www.instagram.com/terredemars/" style="color:#888;font-size:11px;text-decoration:none;">Instagram</a>
</td></tr>
</table>
`;

// ─── Conversion texte brut → HTML propre ─────────────────────────────────────
function texteVersHtml(texte, trackingId, lead, estHtml = false, options = {}) {
  const unsubUrl = `${PUBLIC_URL}/api/tracking/unsubscribe/${lead.id}?t=${trackingId}`;
  const pixelUrl = `${PUBLIC_URL}/api/tracking/open/${trackingId}`;

  let html;
  if (estHtml) {
    // Nettoyer HTML éditeur puis tracker les liens
    const htmlClean = nettoyerHtml(texte);
    html = htmlClean.replace(/href="(https?:\/\/[^"]+)"/g, (match, url) => {
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

  // Désabonnement optionnel (activé par défaut si pas de paramètre)
  const showUnsub = options && options.desabonnement === false ? false : true;
  const unsubBlock = showUnsub
    ? `<p style="margin:32px 0 0;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px;">
        Vous recevez cet email en tant que contact professionnel de Terre de Mars.
        &nbsp;<a href="${unsubUrl}" style="color:#999;text-decoration:underline;">Se désabonner</a>
       </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<style>p{margin:0 0 2px 0}ul,ol{margin:4px 0;padding-left:20px}li{margin:2px 0;font-size:14px;line-height:1.45;color:#1a1a1a}a{color:#aa8d3e}div{line-height:1.45}</style>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1a1a1a;text-align:left;padding:16px 20px;max-width:680px;">
  <div style="text-align:left;">${html}</div>
  <div style="border-top:1px solid #e5e0d5;padding-top:12px;margin-top:16px;">
    ${SIGNATURE_HUGO}
  </div>
  ${unsubBlock}
</div>
<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />
</body></html>`;
}

// ─── Vérification du quota journalier ────────────────────────────────────────
function todayParis() {
  const fuseau = process.env.FUSEAU || 'Europe/Paris';
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: fuseau }));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function verifierQuotaJournalier(db) {
  const today = todayParis();
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

// ─── Vérifier blocklist ─────────────────────────────────────────────────────
function verifierBlocklist(db, email) {
  const emailLower = email.toLowerCase().trim();
  const domain = emailLower.split('@')[1];

  // Vérifier email exact
  const emailBlock = db.prepare('SELECT * FROM email_blocklist WHERE type = ? AND value = ?').get('email', emailLower);
  if (emailBlock && !emailBlock.override_allowed) {
    throw new Error(`Email bloqué par la blocklist : ${email} (raison: ${emailBlock.raison || 'non spécifiée'})`);
  }

  // Vérifier domaine
  const domainBlock = db.prepare('SELECT * FROM email_blocklist WHERE type = ? AND value = ?').get('domain', domain);
  if (domainBlock && !domainBlock.override_allowed) {
    throw new Error(`Domaine bloqué par la blocklist : ${domain} (raison: ${domainBlock.raison || 'non spécifiée'})`);
  }

  return true;
}

// ─── Envoi principal ─────────────────────────────────────────────────────────
async function envoyerEmail(db, { lead, etape, inscriptionId }) {
  // 1. Vérifier quota
  const { today } = verifierQuotaJournalier(db);

  // 2. Vérifier que le lead n'est pas désabonné
  if (lead.unsubscribed) {
    throw new Error(`Lead désabonné : ${lead.email}`);
  }

  // 3. Vérifier la blocklist
  verifierBlocklist(db, lead.email);

  // 4. Substituer les variables
  const sujet = substituerVariables(etape.sujet, lead);
  const corpsTexte = substituerVariables(etape.corps, lead);

  // 5. Générer un ID de tracking unique
  const trackingId = uuidv4();

  // 6. Construire le HTML (corps_html si éditeur riche, sinon conversion texte)
  // Récupérer le paramètre desabonnement depuis la séquence
  let seqOptions = {};
  try {
    const insc = db.prepare('SELECT s.options FROM inscriptions i JOIN sequences s ON i.sequence_id = s.id WHERE i.id = ?').get(inscriptionId);
    if (insc?.options) seqOptions = JSON.parse(insc.options);
  } catch(e) { logger.warn('Erreur lecture options séquence', { inscriptionId, error: e.message }); }

  const corpsHtml = etape.corps_html
    ? texteVersHtml(etape.corps_html, trackingId, lead, true, seqOptions)
    : texteVersHtml(corpsTexte, trackingId, lead, false, seqOptions);

  // 7. Préparer le payload Brevo
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

  // BCC si configuré dans les options de la séquence
  if (seqOptions.bcc) {
    payload.bcc = [{ email: seqOptions.bcc }];
  }

  // Pièce jointe si présente
  if (etape.piece_jointe?.data) {
    logger.info('📎 Pièce jointe détectée', {
      nom: etape.piece_jointe.nom,
      taille: etape.piece_jointe.taille,
      type: etape.piece_jointe.type,
      dataLength: etape.piece_jointe.data?.length || 0
    });
    payload.attachment = [{
      content: etape.piece_jointe.data,
      name: etape.piece_jointe.nom,
    }];
  } else {
    logger.debug('Pas de pièce jointe pour cet email', { etapeId: etape.id });
  }

  // 8. Envoyer via fetch natif
  let brevoMessageId = null;
  if (process.env.BREVO_API_KEY) {
    const result = await avecRetry(() => brevoSendEmail(payload));
    brevoMessageId = result?.messageId || null;
    logger.info(`✉️  Email envoyé via Brevo`, { to: lead.email, messageId: brevoMessageId });
  } else {
    logger.info(`📧 [MODE DÉMO] Email simulé pour ${lead.email} : "${sujet}"`);
    brevoMessageId = `demo-${Date.now()}`;
  }

  // 9. Enregistrer l'email en base
  const emailId = uuidv4();
  db.prepare(`
    INSERT INTO emails (id, inscription_id, lead_id, etape_id, sujet, brevo_message_id, tracking_id, statut)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'envoyé')
  `).run(emailId, inscriptionId, lead.id, etape.id, sujet, brevoMessageId, trackingId);

  // 10. Enregistrer l'événement
  db.prepare(`INSERT INTO events (id, email_id, lead_id, type) VALUES (?, ?, ?, 'envoi')`).run(uuidv4(), emailId, lead.id);

  // 11. Mettre à jour le quota
  incrementerQuota(db, today);

  return { emailId, trackingId, brevoMessageId };
}

// ─── Vérifier si on est dans la fenêtre d'envoi ──────────────────────────────
function estDansLaFenetreEnvoi() {
  const fuseau = process.env.FUSEAU || 'Europe/Paris';
  const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: fuseau }));
  const heure = nowLocal.getHours();
  const jourSemaine = nowLocal.getDay(); // 0=dim, 1=lun, ..., 6=sam

  const heureDebut = parseInt(process.env.SEND_HOUR_START) || 8;
  const heureFin = parseInt(process.env.SEND_HOUR_END) || 18;
  const joursActifs = (process.env.ACTIVE_DAYS || '1,2,3,4,5').split(',').map(Number);

  return heure >= heureDebut && heure < heureFin && joursActifs.includes(jourSemaine);
}

// ─── Quota restant aujourd'hui ───────────────────────────────────────────────
function getQuotaRestant(db) {
  const today = todayParis();
  const maxParJour = parseInt(process.env.MAX_EMAILS_PER_DAY) || 50;
  const row = db.prepare('SELECT count FROM envoi_quota WHERE date_jour = ?').get(today);
  return { envoyes: row?.count || 0, max: maxParJour, restant: maxParJour - (row?.count || 0) };
}

module.exports = {
  envoyerEmail,
  estDansLaFenetreEnvoi,
  getQuotaRestant,
  substituerVariables,
  brevoSendEmail,
};
