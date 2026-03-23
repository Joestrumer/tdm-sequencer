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

// ─── Helpers date en heure Paris ─────────────────────────────────────────────
const pad2 = n => String(n).padStart(2, '0');

function maintenant_paris() {
  const fuseau = process.env.FUSEAU || 'Europe/Paris';
  return new Date(new Date().toLocaleString('en-US', { timeZone: fuseau }));
}

function formatSQLite(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

// ─── Calcul de la prochaine date d'envoi ──────────────────────────────────────
function prochaineDateEnvoi(joursDelai) {
  const heureDebut  = parseInt(process.env.SEND_HOUR_START) || 8;
  const joursActifs = (process.env.ACTIVE_DAYS || '1,2,3,4,5').split(',').map(Number);

  let date = maintenant_paris();
  date.setDate(date.getDate() + joursDelai);

  // Avancer au prochain jour ouvré si nécessaire
  let tentatives = 0;
  while (!joursActifs.includes(date.getDay()) && tentatives < 7) {
    date.setDate(date.getDate() + 1);
    tentatives++;
  }

  // Heure de début + variation aléatoire (0–120 min) pour paraître naturel
  date.setHours(heureDebut, Math.floor(Math.random() * 120), 0, 0);
  return formatSQLite(date);
}

// ─── Avancer l'inscription à l'étape suivante ─────────────────────────────────
async function avancerInscription(inscription, etapesParsed, lead) {
  const prochainIndex = inscription.etape_courante + 1;

  if (prochainIndex >= etapesParsed.length) {
    // Transaction pour garantir la cohérence inscription + lead
    db.transaction(() => {
      db.prepare(`UPDATE inscriptions SET etape_courante=?, statut='terminé', prochain_envoi=NULL WHERE id=?`)
        .run(prochainIndex, inscription.id);

      const hasResponse = db.prepare(`
        SELECT COUNT(*) as count FROM events
        WHERE lead_id = ? AND type IN ('réponse', 'clic')
      `).get(lead.id);

      if (hasResponse.count === 0) {
        db.prepare(`UPDATE leads SET statut='Fin de séquence', updated_at=datetime('now') WHERE id=?`).run(lead.id);
        logger.info(`📭 Lead ${lead.email} mis en statut "Fin de séquence" (aucune réponse)`);
      }
    })();
    logger.info(`📭 Séquence terminée pour ${lead.email}`);

    if (process.env.HUBSPOT_API_KEY) {
      const seq = db.prepare('SELECT nom FROM sequences WHERE id = ?').get(inscription.sequence_id);
      await hubspot.creerTaskFinSequence(db, lead, seq?.nom || 'Séquence').catch(e => logger.warn('HubSpot task fin séquence échouée', { error: e.message }));
    }
  } else {
    const prochainEtape = etapesParsed[prochainIndex];
    const prochainDate  = prochaineDateEnvoi(prochainEtape.jour_delai);
    db.transaction(() => {
      db.prepare(`UPDATE inscriptions SET etape_courante=?, prochain_envoi=? WHERE id=?`)
        .run(prochainIndex, prochainDate, inscription.id);
      db.prepare(`UPDATE leads SET statut='En séquence', updated_at=datetime('now') WHERE id=?`).run(lead.id);
    })();
    logger.info(`📅 Prochain email planifié : ${lead.email} → ${prochainDate}`);
  }
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

  // Parser les pièces jointes JSON
  const etapesParsed = etapes.map(e => {
    let pieceJointe = null;
    if (e.piece_jointe) {
      try {
        pieceJointe = JSON.parse(e.piece_jointe);
      } catch (err) {
        logger.warn('Erreur parsing piece_jointe dans scheduler', { etapeId: e.id });
      }
    }
    return { ...e, piece_jointe: pieceJointe };
  });

  const index = inscription.etape_courante;
  if (index >= etapesParsed.length) {
    db.prepare(`UPDATE inscriptions SET statut='terminé' WHERE id=?`).run(inscription.id);
    return;
  }

  const etape = etapesParsed[index];

  try {
    await envoyerEmail(db, { lead, etape, inscriptionId: inscription.id });

    if (process.env.HUBSPOT_API_KEY) {
      await hubspot.logEmailTimeline(db, lead, { sujet: etape.sujet }).catch(e => logger.warn('HubSpot logEmailTimeline échoué', { error: e.message, leadId: lead.id }));
      if (index === 0) await hubspot.mettreAJourLifecycle(db, lead, 'lead').catch(e => logger.warn('HubSpot lifecycle update échoué', { error: e.message, leadId: lead.id }));
    }

    await avancerInscription(inscription, etapesParsed, lead);
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
  // Comparer en heure Paris (prochain_envoi est stocké en heure Paris)
  const now = maintenant_paris();
  const prochainEnvoi = new Date(inscription.prochain_envoi.replace(' ', 'T'));
  if (prochainEnvoi > now) return; // Pas encore l'heure
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

  const nowParis = formatSQLite(maintenant_paris());
  logger.info(`🔄 Vérification des séquences... (heure Paris: ${nowParis})`);

  // Utiliser datetime() pour normaliser les formats (T vs espace) des anciennes données
  const inscriptions = db.prepare(`
    SELECT * FROM inscriptions
    WHERE statut = 'actif'
      AND prochain_envoi IS NOT NULL
      AND datetime(prochain_envoi) <= datetime(?)
    ORDER BY prochain_envoi ASC
    LIMIT 20
  `).all(nowParis);

  if (!inscriptions.length) { logger.debug('Aucun email à envoyer'); return; }
  logger.info(`📬 ${inscriptions.length} email(s) à traiter`);

  for (const inscription of inscriptions) {
    try {
      await traiterInscription(inscription);
      // Délai configurable entre chaque email (défaut 2s + jitter)
      const delaiConfig = db.prepare("SELECT valeur FROM config WHERE cle = 'delai_entre_emails'").get();
      const delaiMs = ((delaiConfig ? parseFloat(delaiConfig.valeur) : 2) * 1000) + Math.random() * 500;
      await new Promise(r => setTimeout(r, delaiMs));
    } catch (err) {
      if (err.message === 'QUOTA_ATTEINT') break;
    }
  }
}

// ─── Inscrire un lead à une séquence ─────────────────────────────────────────
function inscrireLead(leadId, sequenceId) {
  const premiereEtape = db.prepare(`SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC LIMIT 1`).get(sequenceId);
  if (!premiereEtape) throw new Error('Séquence vide ou introuvable');

  // Respecter le jour_delai de la première étape
  // En dev : toujours 1 minute pour tester rapidement
  let prochainEnvoi;
  if (process.env.NODE_ENV === 'development') {
    const devDate = maintenant_paris();
    devDate.setMinutes(devDate.getMinutes() + 1);
    prochainEnvoi = formatSQLite(devDate);
  } else {
    prochainEnvoi = prochaineDateEnvoi(premiereEtape.jour_delai || 0);
  }

  // Vérifier si une inscription active existe déjà pour éviter de reset etape_courante
  const existing = db.prepare(
    `SELECT id, statut FROM inscriptions WHERE lead_id = ? AND sequence_id = ?`
  ).get(leadId, sequenceId);

  if (existing && existing.statut === 'actif') {
    throw new Error('Ce lead est déjà inscrit et actif dans cette séquence');
  }

  const id = existing ? existing.id : uuidv4();
  if (existing) {
    // Réactiver une inscription terminée
    db.prepare(`UPDATE inscriptions SET statut = 'actif', etape_courante = 0, prochain_envoi = ? WHERE id = ?`)
      .run(prochainEnvoi, existing.id);
  } else {
    db.prepare(`INSERT INTO inscriptions (id, lead_id, sequence_id, etape_courante, statut, prochain_envoi) VALUES (?, ?, ?, 0, 'actif', ?)`)
      .run(id, leadId, sequenceId, prochainEnvoi);
  }

  db.prepare(`UPDATE leads SET statut='En séquence', updated_at=datetime('now') WHERE id=?`).run(leadId);
  logger.info('🚀 Lead inscrit à la séquence', { leadId, sequenceId, prochainEnvoi, delai: premiereEtape.jour_delai });
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
