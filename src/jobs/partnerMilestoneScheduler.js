/**
 * partnerMilestoneScheduler.js — Job quotidien pour les programmes automatiques partenaires
 * Vérifie anniversaires partner_since, envois de bienvenue, relances inactivité
 */
const cron = require('node-cron');
const { randomUUID } = require('crypto');
const logger = require('../config/logger');
const { substituteVars } = require('../utils/partnerVars');

let _db = null;

function initialiser(db) {
  _db = db;
  // Tous les jours à 9h
  cron.schedule('0 9 * * *', () => traiterMilestones());
  logger.info('🎂 Partner milestone scheduler initialisé (quotidien 9h)');
}

async function traiterMilestones() {
  if (!_db) return;

  const programs = _db.prepare("SELECT * FROM partner_auto_programs WHERE actif = 1").all();
  if (programs.length === 0) return;

  const brevoService = require('../services/brevoService');
  let totalSent = 0;

  for (const program of programs) {
    const milestones = _db.prepare('SELECT * FROM partner_program_milestones WHERE program_id = ? ORDER BY ordre').all(program.id);
    if (milestones.length === 0) continue;

    for (const milestone of milestones) {
      try {
        const partners = getEligiblePartners(program, milestone);

        for (const partner of partners) {
          // Vérifier pas déjà envoyé cette année (pour anniversaires)
          const alreadySent = _db.prepare(`
            SELECT id FROM partner_milestone_logs
            WHERE milestone_id = ? AND partner_id = ? AND sent_at >= datetime('now', '-11 months')
          `).get(milestone.id, partner.id);
          if (alreadySent) continue;

          // Trouver un contact à qui envoyer
          const contact = _db.prepare(`
            SELECT * FROM hubspot_partner_contacts
            WHERE hubspot_company_id = ? AND email IS NOT NULL AND email != ''
            ORDER BY id LIMIT 1
          `).get(partner.hubspot_company_id);
          if (!contact) continue;

          // Calculer variables
          const years = partner.partner_since
            ? Math.floor((Date.now() - new Date(partner.partner_since).getTime()) / (365.25 * 24 * 3600 * 1000))
            : 0;

          const data = {
            prenom: contact.firstname || '',
            nom: contact.lastname || '',
            hotel: partner.name,
            business_type: partner.business_type || '',
            partner_since: partner.partner_since || '',
            anniversaire_annees: years,
          };

          const sujet = substituteVars(milestone.sujet, data);
          const html = substituteVars(milestone.corps_html || '', data);

          try {
            await brevoService.brevoSendEmail({
              sender: brevoService.SENDER,
              to: [{ email: contact.email, name: `${contact.firstname || ''} ${contact.lastname || ''}`.trim() || partner.name }],
              subject: sujet,
              htmlContent: html,
              replyTo: { email: brevoService.SENDER.email, name: brevoService.SENDER.name },
            });

            _db.prepare('INSERT INTO partner_milestone_logs (id, milestone_id, partner_id, contact_id, statut) VALUES (?, ?, ?, ?, ?)').run(
              randomUUID(), milestone.id, partner.id, contact.id, 'envoyé'
            );
            totalSent++;

            // Pause entre envois
            await new Promise(r => setTimeout(r, 2000));
          } catch (sendErr) {
            _db.prepare('INSERT INTO partner_milestone_logs (id, milestone_id, partner_id, contact_id, statut) VALUES (?, ?, ?, ?, ?)').run(
              randomUUID(), milestone.id, partner.id, contact.id, 'erreur'
            );
            logger.error(`Erreur envoi milestone ${milestone.id} → ${contact.email}`, { error: sendErr.message });
          }
        }
      } catch (err) {
        logger.error(`Erreur traitement milestone ${milestone.id}`, { error: err.message });
      }
    }
  }

  if (totalSent > 0) logger.info(`🎂 ${totalSent} email(s) milestone envoyé(s)`);
}

function getEligiblePartners(program, milestone) {
  if (!_db) return [];

  if (milestone.trigger_type === 'partner_since_anniversary') {
    // Partenaires dont l'anniversaire est aujourd'hui (±1 jour) — comparaison mois/jour directe
    return _db.prepare(`
      SELECT * FROM hubspot_partners
      WHERE partner_since IS NOT NULL
      AND ABS(
        CAST(julianday(strftime('%Y', 'now') || strftime('-%m-%d', partner_since)) AS INTEGER)
        - CAST(julianday('now') AS INTEGER)
      ) <= 1
    `).all();
  }

  if (milestone.trigger_type === 'days_after_start') {
    // Partenaires dont partner_since date d'il y a exactement trigger_value jours (±1)
    const days = milestone.trigger_value || 30;
    return _db.prepare(`
      SELECT * FROM hubspot_partners
      WHERE partner_since IS NOT NULL
      AND ABS(CAST(julianday('now') - julianday(partner_since) AS INTEGER) - ?) <= 1
    `).all(days);
  }

  if (milestone.trigger_type === 'inactivity_days') {
    // Partenaires sans deal depuis trigger_value jours
    const days = milestone.trigger_value || 180;
    return _db.prepare(`
      SELECT hp.* FROM hubspot_partners hp
      LEFT JOIN hubspot_deals_cache d ON d.hubspot_company_id = hp.hubspot_company_id
      GROUP BY hp.id
      HAVING MAX(d.closedate) IS NULL OR MAX(d.closedate) < datetime('now', '-' || ? || ' days')
    `).all(days);
  }

  return [];
}

module.exports = { initialiser };
