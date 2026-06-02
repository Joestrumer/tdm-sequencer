/**
 * anniversaryScheduler.js — Envoi automatique d'emails d'anniversaire partenaires
 * Cron quotidien à 9h : cherche les campagnes anniversaire actives, trouve les partenaires éligibles, envoie
 */
const cron = require('node-cron');
const { randomUUID } = require('crypto');
const logger = require('../config/logger');
const { substituteVars } = require('../utils/partnerVars');

let _db = null;

function initialiser(db) {
  _db = db;
  cron.schedule('0 9 * * *', () => traiterAnniversaires());
  logger.info('🎉 Anniversary scheduler initialisé (quotidien 9h)');
}

async function traiterAnniversaires() {
  if (!_db) return;

  // Vérifier si le système est actif (config globale)
  let globalConfig;
  try {
    globalConfig = _db.prepare("SELECT * FROM partner_anniversary_config WHERE active = 1 LIMIT 1").get();
  } catch (_) { return; }
  if (!globalConfig) return;

  // Charger toutes les campagnes anniversaire actives (statut != 'brouillon')
  let campaigns = [];
  try {
    campaigns = _db.prepare("SELECT * FROM partner_campaigns WHERE COALESCE(type, 'marketing') = 'anniversaire' AND statut != 'brouillon'").all();
  } catch (_) {
    // Fallback: utiliser l'ancien système avec template_id de la config
    if (globalConfig.template_id) {
      const tpl = _db.prepare('SELECT * FROM partner_email_templates WHERE id = ?').get(globalConfig.template_id);
      if (tpl) {
        campaigns = [{ id: 'legacy', nom: 'Legacy', sujet: tpl.sujet, corps_html: tpl.corps_html, business_type_filter: null, days_before: globalConfig.days_before || 0 }];
      }
    }
  }

  if (campaigns.length === 0) return;

  const currentYear = new Date().getFullYear();
  const brevoService = require('../services/brevoService');
  let totalSent = 0;

  for (const campaign of campaigns) {
    const daysBefore = campaign.days_before != null ? campaign.days_before : (globalConfig.days_before || 0);

    // Trouver partenaires dont anniversaire = dans days_before jours
    // Comparaison directe mois/jour (plus fiable que julianday, gère les années bissextiles)
    let query = `
      SELECT hp.*,
        CAST(strftime('%Y', 'now') AS INTEGER) - CAST(strftime('%Y', hp.partner_since) AS INTEGER) as years_at_anniversary
      FROM hubspot_partners hp
      WHERE hp.partner_since IS NOT NULL AND hp.partner_since != ''
        AND ABS(
          CAST(julianday(strftime('%Y', 'now') || strftime('-%m-%d', hp.partner_since)) AS INTEGER)
          - CAST(julianday(date('now', '+' || ? || ' days')) AS INTEGER)
        ) <= 0
    `;
    const params = [daysBefore];

    // Filtrer par business_type si défini
    if (campaign.business_type_filter) {
      query += ' AND hp.business_type = ?';
      params.push(campaign.business_type_filter);
    }

    const partners = _db.prepare(query).all(...params);
    if (partners.length === 0) continue;

    for (const partner of partners) {
      try {
        // Vérifier exclusion
        const excluded = _db.prepare('SELECT 1 FROM partner_anniversary_exclusions WHERE partner_id = ?').get(partner.id);
        if (excluded) continue;

        // Vérifier pas déjà envoyé cette année (pour cette campagne)
        const alreadySent = _db.prepare(
          'SELECT id FROM partner_anniversary_logs WHERE partner_id = ? AND year = ? AND template_id = ?'
        ).get(partner.id, currentYear, campaign.id);
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

          const sujet = substituteVars(campaign.sujet, data);
          let html = substituteVars(campaign.corps_html || '', data);
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
              randomUUID(), partner.id, contact.email, campaign.id, currentYear
            );
            totalSent++;

            // Incrémenter le compteur de la campagne
            try { _db.prepare('UPDATE partner_campaigns SET sent_count = sent_count + 1 WHERE id = ?').run(campaign.id); } catch (_) {}

            await new Promise(r => setTimeout(r, 2000));
          } catch (sendErr) {
            logger.error(`🎉 Anniversary [${campaign.nom}]: erreur envoi → ${contact.email}`, { error: sendErr.message });
          }
        }
      } catch (err) {
        logger.error(`🎉 Anniversary [${campaign.nom}]: erreur partenaire ${partner.name}`, { error: err.message });
      }
    }
  }

  if (totalSent > 0) logger.info(`🎉 ${totalSent} email(s) anniversaire envoyé(s)`);
}

module.exports = { initialiser };
