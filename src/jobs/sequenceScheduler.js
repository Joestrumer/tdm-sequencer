/**
 * sequenceScheduler.js — Moteur de planification des séquences
 *
 * - Tourne toutes les 15 minutes via node-cron
 * - traiterInscription     : usage interne (respecte la fenêtre horaire)
 * - traiterInscriptionDirect : export pour trigger-now (bypass fenêtre)
 */

const cron    = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const logger  = require('../config/logger');
const { envoyerEmail, estDansLaFenetreEnvoi } = require('../services/brevoService');
const hubspot = require('../services/hubspotService');

let db; // Injecté par initialiser()

// ─── Calcul de la prochaine date d'envoi ──────────────────────────────────────
function prochaineDateEnvoi(joursDelai) {
  const heureDebut  = parseInt(process.env.SEND_HOUR_START) || 8;
  const joursActifs = (process.env.ACTIVE_DAYS || '1,2,3,4,5').split(',').map(Number);

  let date = new Date();
  date.setDate(date.getDate() + joursDelai);

  // Avancer au prochain jour ouvré si nécessaire
  let tentatives = 0;
  while (!joursActifs.includes(date.getDay()) && tentatives < 7) {
    date.setDate(date.getDate() + 1);
    tentatives++;
  }

  // Heure de début + variation aléatoire (0–120 min) pour paraître naturel
  date.setHours(heureDebut, Math.floor(Math.random() * 120), 0, 0);
  return date.toISOString();
}

// ─── Avancer l'inscription à l'étape suivante ─────────────────────────────────
async function avancerInscription(inscription, etapes, lead) {
  const prochainIndex = inscription.etape_courante + 1;

  if (prochainIndex >= etapes.length) {
    db.prepare(`UPDATE inscriptions SET etape_courante=?, statut='terminé', prochain_envoi=NULL WHERE id=?`)
      .run(prochainIndex, inscription.id);
    logger.info(`📭 Séquence terminée pour ${lead.email}`);

    if (process.env.HUBSPOT_API_KEY) {
      const seq = db.prepare('SELECT nom FROM sequences WHERE id = ?').get(inscription.sequence_id);
      await hubspot.creerTaskFinSequence(db, lead, seq?.nom || 'Séquence').catch(() => {});
    }
  } else {
    const prochainEtape = etapes[prochainIndex];
    const prochainDate  = prochaineDateEnvoi(prochainEtape.jour_delai);
    db.prepare(`UPDATE inscriptions SET etape_courante=?, prochain_envoi=? WHERE id=?`)
      .run(prochainIndex, prochainDate, inscription.id);
    logger.info(`📅 Prochain email planifié : ${lead.email} → ${prochainDate}`);
  }

  db.prepare(`UPDATE leads SET statut='En séquence', updated_at=datetime('now') WHERE id=?`).run(lead.id);
}

// ─── Traiter une inscription (noyau partagé) ──────────────────────────────────
async function _traiter(inscription) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(inscription.lead_id);
  if (!lead || lead.unsubscribed || lead.statut === 'Désabonné') {
    db.prepare(`UPDATE inscriptions SET statut='terminé' WHERE id=?`).run(inscription.id);
    return;
  }

  const etapes = db.prepare('SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC').all(inscription.sequence_id);
  if (!etapes.length) return;

  const index = inscription.etape_courante;
  if (index >= etapes.length) {
    db.prepare(`UPDATE inscriptions SET statut='terminé' WHERE id=?`).run(inscription.id);
    return;
  }

  const etape = etapes[index];

  try {
    await envoyerEmail(db, { lead, etape, inscriptionId: inscription.id });

    if (process.env.HUBSPOT_API_KEY) {
      await hubspot.logEmailTimeline(db, lead, { sujet: etape.sujet }).catch(() => {});
      if (index === 0) await hubspot.mettreAJourLifecycle(db, lead, 'lead').catch(() => {});
    }

    await avancerInscription(inscription, etapes, lead);
  } catch (err) {
    logger.error(`❌ Erreur envoi email pour ${lead.email}`, { error: err.message });

    if (err.message.includes('Quota journalier')) throw new Error('QUOTA_ATTEINT');

    // Enregistrer l'erreur sans bloquer les autres
    db.prepare(`INSERT INTO emails (id,inscription_id,lead_id,etape_id,sujet,statut,erreur) VALUES (?,?,?,?,?,'erreur',?)`)
      .run(uuidv4(), inscription.id, lead.id, etape.id, etape.sujet, err.message);
  }
}

// ─── Version planifiée : vérifie l'heure planifiée avant d'envoyer ────────────
async function traiterInscription(inscription) {
  const prochainEnvoi = new Date(inscription.prochain_envoi);
  if (prochainEnvoi > new Date()) return; // Pas encore l'heure
  return _traiter(inscription);
}

// ─── Version directe : bypass de la vérification d'heure (trigger-now) ───────
async function traiterInscriptionDirect(inscription) {
  return _traiter(inscription);
}

// ─── Boucle principale du scheduler ──────────────────────────────────────────
async function lancerVerification() {
  if (!estDansLaFenetreEnvoi()) {
    logger.debug("⏰ Hors fenêtre d'envoi");
    return;
  }

  logger.info('🔄 Vérification des séquences...');

  const inscriptions = db.prepare(`
    SELECT * FROM inscriptions
    WHERE statut = 'actif'
      AND prochain_envoi IS NOT NULL
      AND prochain_envoi <= datetime('now')
    ORDER BY prochain_envoi ASC
    LIMIT 20
  `).all();

  if (!inscriptions.length) { logger.debug('Aucun email à envoyer'); return; }
  logger.info(`📬 ${inscriptions.length} email(s) à traiter`);

  for (const inscription of inscriptions) {
    try {
      await traiterInscription(inscription);
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
    } catch (err) {
      if (err.message === 'QUOTA_ATTEINT') break;
    }
  }
}

// ─── Inscrire un lead à une séquence ─────────────────────────────────────────
function inscrireLead(leadId, sequenceId) {
  const premiereEtape = db.prepare(`SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC LIMIT 1`).get(sequenceId);
  if (!premiereEtape) throw new Error('Séquence vide ou introuvable');

  const prochainEnvoi = process.env.NODE_ENV === 'development'
    ? new Date(Date.now() + 60_000).toISOString()
    : prochaineDateEnvoi(0);

  const id = uuidv4();
  db.prepare(`
    INSERT INTO inscriptions (id, lead_id, sequence_id, etape_courante, statut, prochain_envoi)
    VALUES (?, ?, ?, 0, 'actif', ?)
    ON CONFLICT(lead_id, sequence_id) DO UPDATE SET
      statut = 'actif', etape_courante = 0, prochain_envoi = excluded.prochain_envoi
  `).run(id, leadId, sequenceId, prochainEnvoi);

  db.prepare(`UPDATE leads SET statut='En séquence', updated_at=datetime('now') WHERE id=?`).run(leadId);
  logger.info('🚀 Lead inscrit à la séquence', { leadId, sequenceId, prochainEnvoi });
  return { id, prochainEnvoi };
}

// ─── Initialiser le cron ──────────────────────────────────────────────────────
function initialiser(database) {
  db = database;

  cron.schedule('*/15 * * * *', async () => {
    try { await lancerVerification(); }
    catch (err) { logger.error('Erreur scheduler', { error: err.message }); }
  });

  logger.info('⏱️  Scheduler initialisé — vérification toutes les 15 minutes');
  setTimeout(() => lancerVerification().catch(err => logger.error('Erreur scheduler init', { error: err.message })), 5000);
}

module.exports = {
  initialiser,
  inscrireLead,
  traiterInscriptionDirect,
  prochaineDateEnvoi,
  lancerVerification,
};
