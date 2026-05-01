/**
 * anniversaryScheduler.js — Envoi automatique d'emails d'anniversaire partenaires
 * Cron quotidien à 9h : vérifie la config, trouve les partenaires éligibles, envoie
 */
const cron = require('node-cron');
const { randomUUID } = require('crypto');

let _db = null;

function initialiser(db) {
  _db = db;
  cron.schedule('0 9 * * *', () => traiterAnniversaires());
  console.log('🎉 Anniversary scheduler initialisé (quotidien 9h)');
}

async function traiterAnniversaires() {
  if (!_db) return;

  // Lire config active
  let config;
  try {
    config = _db.prepare("SELECT * FROM partner_anniversary_config WHERE active = 1 LIMIT 1").get();
  } catch (_) { return; }
  if (!config || !config.template_id) return;

  // Charger le template
  const template = _db.prepare('SELECT * FROM partner_email_templates WHERE id = ?').get(config.template_id);
  if (!template) {
    console.warn('🎉 Anniversary: template introuvable', config.template_id);
    return;
  }

  const daysBefore = config.days_before || 0;
  const currentYear = new Date().getFullYear();

  // Trouver partenaires dont anniversaire = dans days_before jours
  const partners = _db.prepare(`
    WITH anniv AS (
      SELECT hp.*,
        CAST(strftime('%m', hp.partner_since) AS INTEGER) as ps_month,
        CAST(strftime('%d', hp.partner_since) AS INTEGER) as ps_day,
        CAST(strftime('%Y', 'now') AS INTEGER) as cur_year,
        CAST(strftime('%Y', hp.partner_since) AS INTEGER) as ps_year
      FROM hubspot_partners hp
      WHERE hp.partner_since IS NOT NULL AND hp.partner_since != ''
    )
    SELECT *,
      CASE
        WHEN julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) >= julianday('now')
        THEN CAST(julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) - julianday('now') AS INTEGER)
        ELSE CAST(julianday(printf('%04d-%02d-%02d', cur_year + 1, ps_month, ps_day)) - julianday('now') AS INTEGER)
      END as days_until,
      CASE
        WHEN julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) >= julianday('now')
        THEN cur_year - ps_year
        ELSE cur_year + 1 - ps_year
      END as years_at_anniversary
    FROM anniv
    HAVING days_until = ?
  `).all(daysBefore);

  if (partners.length === 0) return;

  const brevoService = require('../services/brevoService');
  let totalSent = 0;

  for (const partner of partners) {
    try {
      // Vérifier pas déjà envoyé cette année
      const alreadySent = _db.prepare(
        'SELECT id FROM partner_anniversary_logs WHERE partner_id = ? AND year = ?'
      ).get(partner.id, currentYear);
      if (alreadySent) continue;

      // Trouver contacts
      const contacts = _db.prepare(`
        SELECT * FROM hubspot_partner_contacts
        WHERE hubspot_company_id = ? AND email IS NOT NULL AND email != ''
      `).all(partner.hubspot_company_id);
      if (contacts.length === 0) continue;

      for (const contact of contacts) {
        const data = {
          prenom: contact.firstname || '',
          nom: contact.lastname || '',
          hotel: partner.name,
          business_type: partner.business_type || '',
          partner_since: partner.partner_since || '',
          anniversaire_annees: partner.years_at_anniversary || 0,
        };

        const sujet = substituteVars(template.sujet, data);
        let html = substituteVars(template.corps_html || '', data);
        const signature = brevoService.SIGNATURE_HUGO || '';
        if (signature) html += `<br/><br/>${signature}`;

        try {
          await brevoService.brevoSendEmail({
            sender: brevoService.SENDER,
            to: [{ email: contact.email, name: `${contact.firstname || ''} ${contact.lastname || ''}`.trim() || partner.name }],
            subject: sujet,
            htmlContent: html,
            replyTo: { email: brevoService.SENDER.email, name: brevoService.SENDER.name },
          });

          _db.prepare('INSERT INTO partner_anniversary_logs (id, partner_id, contact_email, template_id, year) VALUES (?, ?, ?, ?, ?)').run(
            randomUUID(), partner.id, contact.email, config.template_id, currentYear
          );
          totalSent++;

          await new Promise(r => setTimeout(r, 2000));
        } catch (sendErr) {
          console.error(`🎉 Anniversary: erreur envoi → ${contact.email}:`, sendErr.message);
        }
      }
    } catch (err) {
      console.error(`🎉 Anniversary: erreur partenaire ${partner.name}:`, err.message);
    }
  }

  if (totalSent > 0) console.log(`🎉 ${totalSent} email(s) anniversaire envoyé(s)`);
}

function substituteVars(text, data) {
  if (!text) return '';
  return text
    .replace(/\{\{prenom\}\}/g, data.prenom || '')
    .replace(/\{\{nom\}\}/g, data.nom || '')
    .replace(/\{\{hotel\}\}/g, data.hotel || '')
    .replace(/\{\{business_type\}\}/g, data.business_type || '')
    .replace(/\{\{partner_since\}\}/g, data.partner_since || '')
    .replace(/\{\{anniversaire_annees\}\}/g, String(data.anniversaire_annees || ''));
}

module.exports = { initialiser };
