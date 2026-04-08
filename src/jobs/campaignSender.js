/**
 * campaignSender.js — Job d'envoi massif pour campagnes email marketing
 *
 * - Cron toutes les 30 secondes
 * - Mutex pour éviter les envois concurrents
 * - Rate limiting ~15 emails/sec (65ms entre chaque)
 * - Batch de 50 recipients à la fois
 */

const cron = require('node-cron');
const logger = require('../config/logger');
const { envoyerEmailCampagne } = require('../services/brevoService');
const { addOrUpdateTag } = require('../utils/leadTags');

let db;
let sending = false;

const BATCH_SIZE = 50;
const DELAY_BETWEEN_EMAILS_MS = 65; // ~15/sec

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Heure locale (Europe/Paris) ────────────────────────────────────────────
function nowParis() {
  const fuseau = process.env.FUSEAU || 'Europe/Paris';
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: fuseau }));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── Activer les campagnes programmées ────────────────────────────────────────
function activerCampagnesProgrammees() {
  const now = nowParis();
  const campagnes = db.prepare(`
    SELECT id, nom FROM campaigns WHERE statut = 'programmée' AND scheduled_at <= ?
  `).all(now);

  for (const c of campagnes) {
    db.prepare(`UPDATE campaigns SET statut = 'en_cours', started_at = datetime('now') WHERE id = ?`).run(c.id);
    logger.info(`🚀 Campagne programmée activée : ${c.nom} (${c.id})`);
  }

  return campagnes.length;
}

// ─── Traiter un batch de recipients ──────────────────────────────────────────
async function traiterBatch(campaign) {
  const recipients = db.prepare(`
    SELECT * FROM campaign_recipients
    WHERE campaign_id = ? AND statut = 'en_attente'
    ORDER BY rowid
    LIMIT ?
  `).all(campaign.id, BATCH_SIZE);

  if (recipients.length === 0) return 0;

  let sentCount = 0;
  let errorCount = 0;

  for (const recipient of recipients) {
    // Vérifier si la campagne a été annulée
    const fresh = db.prepare('SELECT statut FROM campaigns WHERE id = ?').get(campaign.id);
    if (!fresh || fresh.statut === 'annulée') {
      logger.info(`⏹️  Campagne ${campaign.id} annulée, arrêt du batch`);
      break;
    }

    // Construire un objet lead (réel ou reconstitué depuis CSV)
    let lead;
    if (recipient.lead_id) {
      lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(recipient.lead_id);
      if (!lead) {
        db.prepare(`UPDATE campaign_recipients SET statut = 'erreur', error = 'Lead introuvable' WHERE id = ?`).run(recipient.id);
        errorCount++;
        continue;
      }
    } else {
      // Recipient CSV sans lead_id
      lead = {
        id: null,
        email: recipient.email,
        prenom: recipient.prenom || '',
        nom: recipient.nom || '',
        hotel: recipient.hotel || '',
        ville: recipient.ville || '',
        segment: recipient.segment || '',
        unsubscribed: 0,
      };
      // Vérifier si l'email est désabonné dans les leads
      const existingLead = db.prepare('SELECT id, unsubscribed FROM leads WHERE email = ?').get(recipient.email);
      if (existingLead?.unsubscribed) {
        lead.unsubscribed = 1;
      }
    }

    try {
      let options = {};
      try { if (campaign.options) options = JSON.parse(campaign.options); } catch(_) {}

      let pieceJointe = null;
      try { if (campaign.piece_jointe) pieceJointe = JSON.parse(campaign.piece_jointe); } catch(_) {}

      await envoyerEmailCampagne(db, {
        lead,
        sujet: campaign.sujet,
        corpsHtml: campaign.corps_html,
        campaignId: campaign.id,
        recipientId: recipient.id,
        options,
        pieceJointe,
      });

      sentCount++;
      // Mettre à jour les compteurs de la campagne
      db.prepare(`UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?`).run(campaign.id);

      // Si le recipient a un lead_id, mettre à jour statut + tag
      if (recipient.lead_id) {
        try {
          const currentLead = db.prepare('SELECT statut FROM leads WHERE id = ?').get(recipient.lead_id);
          if (currentLead && (currentLead.statut === 'Nouveau' || currentLead.statut === 'Fin de séquence')) {
            db.prepare(`UPDATE leads SET statut = 'Email Marketing Sent', updated_at = datetime('now') WHERE id = ?`).run(recipient.lead_id);
          }
          addOrUpdateTag(db, recipient.lead_id, 'Email Marketing', campaign.nom);
        } catch (tagErr) {
          logger.warn('Erreur mise à jour tag/statut lead', { leadId: recipient.lead_id, error: tagErr.message });
        }
      }
    } catch (err) {
      errorCount++;
      db.prepare(`UPDATE campaign_recipients SET statut = 'erreur', error = ? WHERE id = ?`).run(
        err.message.slice(0, 500), recipient.id
      );
      db.prepare(`UPDATE campaigns SET error_count = error_count + 1 WHERE id = ?`).run(campaign.id);
      logger.warn(`❌ Erreur envoi campagne recipient`, { campaignId: campaign.id, email: recipient.email, error: err.message });
    }

    // Rate limiting
    await sleep(DELAY_BETWEEN_EMAILS_MS);
  }

  return sentCount + errorCount;
}

// ─── Vérifier si une campagne est terminée ───────────────────────────────────
function verifierFinCampagne(campaignId) {
  const remaining = db.prepare(`
    SELECT COUNT(*) as n FROM campaign_recipients WHERE campaign_id = ? AND statut = 'en_attente'
  `).get(campaignId);

  if (remaining.n === 0) {
    db.prepare(`UPDATE campaigns SET statut = 'terminée', completed_at = datetime('now') WHERE id = ? AND statut = 'en_cours'`).run(campaignId);
    const stats = db.prepare('SELECT nom, sent_count, error_count, total_recipients FROM campaigns WHERE id = ?').get(campaignId);
    logger.info(`✅ Campagne terminée : ${stats.nom} — ${stats.sent_count} envoyés, ${stats.error_count} erreurs sur ${stats.total_recipients}`);
  }
}

// ─── Boucle principale ──────────────────────────────────────────────────────
async function tick() {
  if (sending) return;
  sending = true;

  try {
    // 1. Activer les campagnes programmées
    activerCampagnesProgrammees();

    // 2. Traiter les campagnes en cours
    const campagnesEnCours = db.prepare(`SELECT * FROM campaigns WHERE statut = 'en_cours'`).all();

    for (const campaign of campagnesEnCours) {
      const processed = await traiterBatch(campaign);
      if (processed > 0) {
        logger.info(`📬 Campagne "${campaign.nom}" : ${processed} recipients traités`);
      }
      verifierFinCampagne(campaign.id);
    }
  } catch (err) {
    logger.error('❌ Erreur campaignSender tick', { error: err.message });
  } finally {
    sending = false;
  }
}

// ─── Lancer une campagne immédiatement ──────────────────────────────────────
function lancerCampagne(campaignId) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new Error('Campagne introuvable');
  if (campaign.statut !== 'brouillon' && campaign.statut !== 'programmée') {
    throw new Error(`Impossible de lancer une campagne avec le statut "${campaign.statut}"`);
  }

  const recipientCount = db.prepare('SELECT COUNT(*) as n FROM campaign_recipients WHERE campaign_id = ?').get(campaignId).n;
  if (recipientCount === 0) throw new Error('Aucun destinataire dans cette campagne');

  db.prepare(`UPDATE campaigns SET statut = 'en_cours', started_at = datetime('now'), total_recipients = ? WHERE id = ?`).run(recipientCount, campaignId);
  logger.info(`🚀 Campagne lancée : ${campaign.nom} (${recipientCount} destinataires)`);

  // Déclencher un tick immédiat
  setImmediate(tick);
}

// ─── Initialisation ─────────────────────────────────────────────────────────
function initialiser(database) {
  db = database;

  // Cron toutes les 30 secondes
  cron.schedule('*/30 * * * * *', tick);
  logger.info('📅 Campaign sender initialisé (toutes les 30s)');
}

module.exports = { initialiser, lancerCampagne };
