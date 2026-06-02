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
const { envoyerEmail, estDansLaFenetreEnvoi, substituerVariables, getConfigVal, parseHeurMinute, estBloque } = require('../services/brevoService');
const hubspot = require('../services/hubspotService');
const { addOrUpdateTag } = require('../utils/leadTags');
const { checkImapReplies } = require('../services/imapReplyService');

let db; // Injecté par initialiser()

// ─── Helper : vérifier si une action HubSpot est activée ─────────────────────
function isHsEnabled(seqOptions, configKey, database) {
  const d = database || db;
  if (seqOptions && seqOptions[configKey] !== undefined) return !!seqOptions[configKey];
  const cfg = d.prepare("SELECT valeur FROM config WHERE cle = ?").get(configKey);
  return cfg ? cfg.valeur !== '0' && cfg.valeur !== 'false' : true;
}

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
  const rawDebut = db ? getConfigVal(db, 'heure_debut', 'SEND_HOUR_START', '8') : (process.env.SEND_HOUR_START || '8');
  const rawFin = db ? getConfigVal(db, 'heure_fin', 'SEND_HOUR_END', '18') : (process.env.SEND_HOUR_END || '18');
  const [hD, mD] = parseHeurMinute(rawDebut, 8, 0);
  const [hF, mF] = parseHeurMinute(rawFin, 18, 0);
  const debutMin = hD * 60 + mD;
  const finMin = hF * 60 + mF;
  const plageMin = Math.max(finMin - debutMin, 60); // plage en minutes

  const rawJours = db ? getConfigVal(db, 'jours_actifs', 'ACTIVE_DAYS', '1,2,3,4,5') : (process.env.ACTIVE_DAYS || '1,2,3,4,5');
  const jourMap = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 0 };
  const joursActifs = rawJours.split(',').map(j => jourMap[j.trim()] !== undefined ? jourMap[j.trim()] : Number(j));

  const now = maintenant_paris();
  let date = new Date(now.getTime());
  date.setDate(date.getDate() + joursDelai);

  // Avancer au prochain jour ouvré si nécessaire
  let tentatives = 0;
  while (!joursActifs.includes(date.getDay()) && tentatives < 7) {
    date.setDate(date.getDate() + 1);
    tentatives++;
  }

  // Heure de début + variation aléatoire dans la plage, mais max 120 min après le début
  const randomMin = Math.floor(Math.random() * Math.min(plageMin, 120));
  const totalMin = debutMin + randomMin;
  date.setHours(Math.floor(totalMin / 60), totalMin % 60, 0, 0);

  // Si l'heure calculée est déjà passée et qu'on est encore dans la fenêtre d'envoi
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (date <= now && joursActifs.includes(now.getDay()) && nowMin >= debutMin && nowMin < finMin) {
    date = new Date(now.getTime());
    date.setMinutes(date.getMinutes() + 2 + Math.floor(Math.random() * 3));
  }
  // Si l'heure est passée et qu'on est hors fenêtre, programmer au prochain jour ouvré
  else if (date <= now) {
    date = new Date(now.getTime());
    date.setDate(date.getDate() + 1);
    tentatives = 0;
    while (!joursActifs.includes(date.getDay()) && tentatives < 7) {
      date.setDate(date.getDate() + 1);
      tentatives++;
    }
    const randomMin2 = Math.floor(Math.random() * Math.min(plageMin, 120));
    const totalMin2 = debutMin + randomMin2;
    date.setHours(Math.floor(totalMin2 / 60), totalMin2 % 60, 0, 0);
  }

  return formatSQLite(date);
}

// ─── Calcul de la prochaine date d'envoi OPTIMALE ───────────────────────────
function prochaineDateEnvoiOptimale(joursDelai) {
  // Toggle : si désactivé, fallback sur la version standard
  const toggle = db ? getConfigVal(db, 'envoi_optimal', 'SEND_OPTIMAL', '1') : '1';
  if (toggle === '0') return prochaineDateEnvoi(joursDelai);

  // Vérifier qu'il y a assez de données (min 50 emails sur 30j)
  const countEmails = db.prepare(`
    SELECT COUNT(*) as n FROM emails WHERE envoye_at >= datetime('now', '-30 days') AND statut != 'erreur'
  `).get().n;
  if (countEmails < 50) return prochaineDateEnvoi(joursDelai);

  // Offset Paris pour ajuster les heures UTC
  const offsetParis = (() => {
    const now = new Date();
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const paris = new Date(now.toLocaleString('en-US', { timeZone: process.env.FUSEAU || 'Europe/Paris' }));
    return Math.round((paris - utc) / 3600000);
  })();
  const tzAdjust = `+${offsetParis} hours`;

  // Trouver les 3 meilleures heures par taux d'ouverture (min 5 emails par slot)
  const bestSlots = db.prepare(`
    SELECT CAST(strftime('%H', datetime(envoye_at, ?)) AS INTEGER) as heure,
           COUNT(*) as envoyes,
           SUM(CASE WHEN ouvertures > 0 THEN 1 ELSE 0 END) as ouverts
    FROM emails
    WHERE envoye_at >= datetime('now', '-30 days') AND statut != 'erreur'
    GROUP BY heure
    HAVING envoyes >= 5
    ORDER BY CAST(ouverts AS REAL) / envoyes DESC
    LIMIT 3
  `).all(tzAdjust);

  if (!bestSlots.length) return prochaineDateEnvoi(joursDelai);

  // Fenêtre d'envoi config
  const rawDebut = getConfigVal(db, 'heure_debut', 'SEND_HOUR_START', '8');
  const rawFin = getConfigVal(db, 'heure_fin', 'SEND_HOUR_END', '18');
  const [hD] = parseHeurMinute(rawDebut, 8, 0);
  const [hF] = parseHeurMinute(rawFin, 18, 0);

  // Filtrer les heures dans la fenêtre d'envoi
  const validSlots = bestSlots.filter(s => s.heure >= hD && s.heure < hF);
  if (!validSlots.length) return prochaineDateEnvoi(joursDelai);

  const bestHeure = validSlots[0].heure;

  // Jours actifs
  const rawJours = getConfigVal(db, 'jours_actifs', 'ACTIVE_DAYS', '1,2,3,4,5');
  const jourMap = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 0 };
  const joursActifs = rawJours.split(',').map(j => jourMap[j.trim()] !== undefined ? jourMap[j.trim()] : Number(j));

  // Construire la date : joursDelai + skip jours inactifs + heure optimale
  const now = maintenant_paris();
  let date = new Date(now.getTime());
  date.setDate(date.getDate() + joursDelai);

  // Avancer au prochain jour actif si nécessaire
  let tentatives = 0;
  while (!joursActifs.includes(date.getDay()) && tentatives < 7) {
    date.setDate(date.getDate() + 1);
    tentatives++;
  }

  // Heure optimale + offset aléatoire 0-30 min pour variation naturelle
  const randomOffset = Math.floor(Math.random() * 31);
  date.setHours(bestHeure, randomOffset, 0, 0);

  // Si la date est déjà passée, avancer au prochain jour actif
  if (date <= now) {
    date.setDate(date.getDate() + 1);
    tentatives = 0;
    while (!joursActifs.includes(date.getDay()) && tentatives < 7) {
      date.setDate(date.getDate() + 1);
      tentatives++;
    }
    date.setHours(bestHeure, Math.floor(Math.random() * 31), 0, 0);
  }

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

      // Vérifier si le lead a répondu ou été converti — sinon → "Fin de séquence"
      const currentLead = db.prepare(`SELECT statut FROM leads WHERE id = ?`).get(lead.id);
      const preservedStatuses = ['Répondu', 'Converti', 'Désabonné', 'Closed Lost', 'Échantillon envoyé'];
      if (!preservedStatuses.includes(currentLead?.statut)) {
        db.prepare(`UPDATE leads SET statut='Fin de séquence', updated_at=datetime('now') WHERE id=?`).run(lead.id);
        logger.info(`📭 Lead ${lead.email} mis en statut "Fin de séquence" (aucune réponse/conversion)`);
      } else {
        logger.info(`📭 Lead ${lead.email} garde son statut "${currentLead.statut}" (séquence terminée)`);
      }
    })();
    logger.info(`📭 Séquence terminée pour ${lead.email}`);

    if (process.env.HUBSPOT_API_KEY) {
      const seq = db.prepare('SELECT nom, options FROM sequences WHERE id = ?').get(inscription.sequence_id);
      const seqOptions = seq?.options ? JSON.parse(seq.options) : {};
      if (isHsEnabled(seqOptions, 'hs_task_fin_sequence')) {
        await hubspot.creerTaskFinSequence(db, lead, seq?.nom || 'Séquence').catch(e => logger.warn('HubSpot task fin séquence échouée', { error: e.message }));
      }
    }
  } else {
    const prochainEtape = etapesParsed[prochainIndex];
    const prochainDate  = prochaineDateEnvoiOptimale(prochainEtape.jour_delai);
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
  // Re-vérifier que l'inscription est toujours active (protection contre race condition)
  const freshInscription = db.prepare('SELECT statut FROM inscriptions WHERE id = ?').get(inscription.id);
  if (!freshInscription || freshInscription.statut !== 'actif') return;

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(inscription.lead_id);
  if (!lead || lead.unsubscribed || lead.statut === 'Désabonné') {
    db.prepare(`UPDATE inscriptions SET statut='terminé' WHERE id=?`).run(inscription.id);
    return;
  }

  // Vérifier la blocklist (email ou domaine bloqué)
  if (lead.email && estBloque(db, lead.email)) {
    db.prepare(`UPDATE inscriptions SET statut='terminé' WHERE id=?`).run(inscription.id);
    logger.warn(`⛔ Inscription ${inscription.id} terminée (blocklist)`, { email: lead.email });
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
      const seq = db.prepare('SELECT options FROM sequences WHERE id = ?').get(inscription.sequence_id);
      const seqOptions = seq?.options ? JSON.parse(seq.options) : {};
      if (isHsEnabled(seqOptions, 'hs_log_email')) {
        await hubspot.logEmailTimeline(db, lead, {
          sujet: substituerVariables(etape.sujet, lead),
          corps: substituerVariables(etape.corps_html || etape.corps, lead),
        }).catch(e => logger.warn('HubSpot logEmailTimeline échoué', { error: e.message, leadId: lead.id }));
      }
      if (index === 0 && isHsEnabled(seqOptions, 'hs_lifecycle')) {
        await hubspot.mettreAJourLifecycle(db, lead, 'lead').catch(e => logger.warn('HubSpot lifecycle update échoué', { error: e.message, leadId: lead.id }));
      }
    }

    await avancerInscription(inscription, etapesParsed, lead);
  } catch (err) {
    logger.error(`❌ Erreur envoi email pour ${lead.email}`, { error: err.message });

    if (err.message.includes('Quota journalier')) throw new Error('QUOTA_ATTEINT');

    // Erreurs permanentes → terminer l'inscription (ne pas retenter indéfiniment)
    const permanent = err.message.includes('Email invalide') || err.message.includes('blocklist') || err.message.includes('désabonné');
    if (permanent) {
      db.prepare(`UPDATE inscriptions SET statut='terminé' WHERE id=?`).run(inscription.id);
      logger.warn(`⛔ Inscription ${inscription.id} terminée (erreur permanente)`, { email: lead.email, reason: err.message });
    }

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
  if (!estDansLaFenetreEnvoi(db)) {
    logger.debug("⏰ Hors fenêtre d'envoi");
    return;
  }

  const nowParis = formatSQLite(maintenant_paris());
  logger.info(`🔄 Vérification des séquences... (heure Paris: ${nowParis})`);

  // Utiliser datetime() pour normaliser les formats (T vs espace) des anciennes données
  const inscriptions = db.prepare(`
    SELECT i.* FROM inscriptions i
    JOIN sequences s ON s.id = i.sequence_id
    WHERE i.statut = 'actif'
      AND i.prochain_envoi IS NOT NULL
      AND datetime(i.prochain_envoi) <= datetime(?)
    ORDER BY COALESCE(s.priorite, 3) ASC, i.prochain_envoi ASC
    LIMIT 20
  `).all(nowParis);

  if (!inscriptions.length) { logger.debug('Aucun email à envoyer'); return; }
  logger.info(`📬 ${inscriptions.length} email(s) à traiter`);

  // Lire le délai une seule fois avant la boucle
  const delaiConfig = db.prepare("SELECT valeur FROM config WHERE cle = 'delai_entre_emails'").get();
  const delaiBase = (delaiConfig ? parseFloat(delaiConfig.valeur) : 2) * 1000;

  for (const inscription of inscriptions) {
    try {
      await traiterInscription(inscription);
      await new Promise(r => setTimeout(r, delaiBase + Math.random() * 500));
    } catch (err) {
      if (err.message === 'QUOTA_ATTEINT') break;
    }
  }
}

// ─── Inscrire un lead à une séquence ─────────────────────────────────────────
function inscrireLead(leadId, sequenceId, scheduledAt) {
  const premiereEtape = db.prepare(`SELECT * FROM etapes WHERE sequence_id = ? ORDER BY ordre ASC LIMIT 1`).get(sequenceId);
  if (!premiereEtape) throw new Error('Séquence vide ou introuvable');

  // Respecter le jour_delai de la première étape
  // En dev : toujours 1 minute pour tester rapidement
  let prochainEnvoi;
  if (scheduledAt) {
    prochainEnvoi = formatSQLite(new Date(scheduledAt));
  } else if (process.env.NODE_ENV === 'development') {
    const devDate = maintenant_paris();
    devDate.setMinutes(devDate.getMinutes() + 1);
    prochainEnvoi = formatSQLite(devDate);
  } else {
    prochainEnvoi = prochaineDateEnvoiOptimale(premiereEtape.jour_delai || 0);
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

  // Tag automatique avec le nom de la séquence
  try {
    const seq = db.prepare('SELECT nom FROM sequences WHERE id = ?').get(sequenceId);
    if (seq) addOrUpdateTag(db, leadId, 'Séquence', seq.nom);
  } catch (e) { logger.warn('Erreur ajout tag séquence', { error: e.message }); }

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

  cron.schedule('*/5 * * * *', async () => {
    try {
      logger.info('📩 Vérification IMAP...');
      await checkImapReplies(db);
    } catch (err) {
      logger.error('Erreur polling IMAP', { error: err.message });
    }
  });

  logger.info('⏱️  Scheduler initialisé — vérification toutes les 15 minutes');
  setTimeout(() => lancerVerification().catch(err => logger.error('Erreur scheduler init', { error: err.message })), 5000);
}

module.exports = {
  initialiser,
  inscrireLead,
  traiterInscriptionDirect,
  prochaineDateEnvoi,
  prochaineDateEnvoiOptimale,
  lancerVerification,
};
