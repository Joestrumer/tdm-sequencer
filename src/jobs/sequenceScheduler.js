/**
 * sequenceScheduler.js — Moteur de planification des séquences
 *
 * Tourne toutes les 15 minutes via node-cron.
 * Pour chaque inscription active, vérifie si un email doit être envoyé
 * et appelle brevoService pour l'envoi effectif.
 */

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { envoyerEmail, estDansLaFenetreEnvoi } = require('../services/brevoService');
const hubspot = require('../services/hubspotService');

let db; // Injecté au démarrage

// ─── Calculer la prochaine date d'envoi ──────────────────────────────────────
function prochaineDateEnvoi(joursDelai) {
  const heureDebut = parseInt(process.env.SEND_HOUR_START) || 8;
  const joursActifs = (process.env.ACTIVE_DAYS || '1,2,3,4,5').split(',').map(Number);

  let date = new Date();
  date.setDate(date.getDate() + joursDelai);

  // Ajuster au prochain jour ouvré si nécessaire
  let tentatives = 0;
  while (!joursActifs.includes(date.getDay()) && tentatives < 7) {
    date.setDate(date.getDate() + 1);
    tentatives++;
  }

  // Fixer l'heure à heureDebut + variation aléatoire (0-120 min) pour sembler naturel
  const minutesRandom = Math.floor(Math.random() * 120);
  date.setHours(heureDebut, minutesRandom, 0, 0);

  return date.toISOString();
}

// ─── Traiter une inscription : envoyer l'email si le moment est venu ─────────
async function traiterInscription(inscription) {
  const now = new Date();
  const prochainEnvoi = new Date(inscription.prochain_envoi);

  if (prochainEnvoi > now) return; // Pas encore l'heure

  // Récupérer le lead
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(inscription.lead_id);
  if (!lead || lead.unsubscribed || lead.statut === 'Désabonné') {
    db.prepare(`UPDATE inscriptions SET statut = 'terminé' WHERE id = ?`).run(inscription.id);
    return;
  }

  // Récupérer les étapes de la séquence dans l'ordre
  const etapes = db.prepare(`
    SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC
  `).all(inscription.sequence_id);

  if (etapes.length === 0) return;

  const indexCourant = inscription.etape_courante;
  if (indexCourant >= etapes.length) {
    // Séquence terminée
    db.prepare(`UPDATE inscriptions SET statut = 'terminé' WHERE id = ?`).run(inscription.id);
    logger.info(`✅ Séquence terminée pour lead ${lead.email}`);
    return;
  }

  const etape = etapes[indexCourant];

  try {
    // ── Envoyer l'email ──────────────────────────────────────────────────────
    const { emailId, trackingId } = await envoyerEmail(db, {
      lead,
      etape,
      inscriptionId: inscription.id,
    });

    // ── Logger dans HubSpot ──────────────────────────────────────────────────
    if (process.env.HUBSPOT_API_KEY) {
      await hubspot.logEmailTimeline(db, lead, { sujet: etape.sujet });
      // Premiere email → MQL si pas encore fait
      if (indexCourant === 0) {
        await hubspot.mettreAJourLifecycle(db, lead, 'lead');
      }
    }

    // ── Passer à l'étape suivante ────────────────────────────────────────────
    const prochainIndex = indexCourant + 1;
    if (prochainIndex >= etapes.length) {
      // C'était le dernier email
      db.prepare(`UPDATE inscriptions SET etape_courante = ?, statut = 'terminé', prochain_envoi = NULL WHERE id = ?`)
        .run(prochainIndex, inscription.id);
      logger.info(`📭 Dernière étape envoyée pour ${lead.email}`);

      // ── Créer task HubSpot J+7 ──────────────────────────────────────────────
      if (process.env.HUBSPOT_API_KEY) {
        const seq = db.prepare('SELECT nom FROM sequences WHERE id = ?').get(inscription.sequence_id);
        await hubspot.creerTaskFinSequence(db, lead, seq?.nom || 'Séquence');
      }
    } else {
      // Calculer la date du prochain email
      const prochainEtape = etapes[prochainIndex];
      const prochainDate = prochaineDateEnvoi(prochainEtape.jour_delai);
      db.prepare(`UPDATE inscriptions SET etape_courante = ?, prochain_envoi = ? WHERE id = ?`)
        .run(prochainIndex, prochainDate, inscription.id);
      logger.info(`📅 Prochain email planifié pour ${lead.email} : ${prochainDate}`);
    }

    // ── Mettre à jour le lead ────────────────────────────────────────────────
    db.prepare(`UPDATE leads SET statut = 'En séquence', updated_at = datetime('now') WHERE id = ?`).run(lead.id);

  } catch (err) {
    logger.error(`❌ Erreur envoi email pour ${lead.email}`, { error: err.message });

    // Si quota dépassé, arrêter le traitement pour aujourd'hui
    if (err.message.includes('Quota journalier')) {
      logger.warn('⏸️  Quota journalier atteint, le scheduler reprendra demain');
      throw new Error('QUOTA_ATTEINT');
    }

    // Sinon, enregistrer l'erreur sans bloquer les autres inscriptions
    const emailId = uuidv4();
    db.prepare(`
      INSERT INTO emails (id, inscription_id, lead_id, etape_id, sujet, statut, erreur)
      VALUES (?, ?, ?, ?, ?, 'erreur', ?)
    `).run(emailId, inscription.id, lead.id, etape.id, etape.sujet, err.message);
  }
}

// ─── Boucle principale du scheduler ──────────────────────────────────────────
async function lancerVerification() {
  if (!estDansLaFenetreEnvoi()) {
    logger.debug('⏰ Hors fenêtre d\'envoi, scheduler en pause');
    return;
  }

  logger.info('🔄 Vérification des séquences en cours...');

  const inscriptions = db.prepare(`
    SELECT * FROM inscriptions
    WHERE statut = 'actif'
      AND prochain_envoi IS NOT NULL
      AND prochain_envoi <= datetime('now')
    ORDER BY prochain_envoi ASC
    LIMIT 20
  `).all();

  if (inscriptions.length === 0) {
    logger.debug('Aucun email à envoyer pour le moment');
    return;
  }

  logger.info(`📬 ${inscriptions.length} email(s) à traiter`);

  for (const inscription of inscriptions) {
    try {
      await traiterInscription(inscription);
      // Petit délai entre les envois pour éviter les patterns spam
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
    } catch (err) {
      if (err.message === 'QUOTA_ATTEINT') break; // Arrêter si quota dépassé
    }
  }
}

// ─── Inscrire un lead à une séquence ─────────────────────────────────────────
function inscrireLead(leadId, sequenceId) {
  // Récupérer la première étape
  const premiereEtape = db.prepare(`
    SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC LIMIT 1
  `).get(sequenceId);

  if (!premiereEtape) throw new Error('Séquence vide ou introuvable');

  // Premier email : planifié dans 1 minute en mode démo, sinon J+0
  const prochainEnvoi = process.env.NODE_ENV === 'development'
    ? new Date(Date.now() + 60 * 1000).toISOString()
    : prochaineDateEnvoi(0);

  const id = uuidv4();
  db.prepare(`
    INSERT INTO inscriptions (id, lead_id, sequence_id, etape_courante, statut, prochain_envoi)
    VALUES (?, ?, ?, 0, 'actif', ?)
    ON CONFLICT(lead_id, sequence_id) DO UPDATE SET
      statut = 'actif',
      etape_courante = 0,
      prochain_envoi = excluded.prochain_envoi
  `).run(id, leadId, sequenceId, prochainEnvoi);

  // Mettre à jour le statut du lead
  const seq = db.prepare('SELECT nom FROM sequences WHERE id = ?').get(sequenceId);
  db.prepare(`UPDATE leads SET statut = 'En séquence', updated_at = datetime('now') WHERE id = ?`).run(leadId);

  logger.info(`🚀 Lead inscrit à la séquence`, { leadId, sequenceId, prochainEnvoi });
  return { id, prochainEnvoi };
}

// ─── Initialiser et démarrer le cron ─────────────────────────────────────────
function initialiser(database) {
  db = database;

  // Toutes les 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await lancerVerification();
    } catch (err) {
      logger.error('Erreur scheduler', { error: err.message });
    }
  });

  logger.info('⏱️  Scheduler initialisé — vérification toutes les 15 minutes');

  // Lancer une vérification immédiate au démarrage
  setTimeout(() => lancerVerification().catch(err => logger.error('Erreur scheduler init', { error: err.message })), 5000);
}

async function forcerEnvoi() {
  return lancerVerification(true);
}

module.exports = { initialiser, inscrireLead, prochaineDateEnvoi, lancerVerification, forcerEnvoi };
