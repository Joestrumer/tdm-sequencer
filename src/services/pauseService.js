/**
 * pauseService.js — Logique de gestion des periodes de pause
 */

const PAUSE_ACTIVE_SQL = `
  datetime(date_debut) <= datetime(?)
  AND (date_fin IS NULL OR datetime(date_fin) > datetime(?))
`;

/**
 * Retourne la pause globale en cours ou null
 */
function getPauseGlobaleActive(db, nowISO) {
  return db.prepare(`
    SELECT * FROM pause_periods
    WHERE type = 'global' AND ${PAUSE_ACTIVE_SQL}
    ORDER BY date_debut DESC LIMIT 1
  `).get(nowISO, nowISO) || null;
}

/**
 * Retourne la pause sequence en cours ou null
 */
function getPauseSequenceActive(db, sequenceId, nowISO) {
  return db.prepare(`
    SELECT * FROM pause_periods
    WHERE type = 'sequence' AND sequence_id = ? AND ${PAUSE_ACTIVE_SQL}
    ORDER BY date_debut DESC LIMIT 1
  `).get(sequenceId, nowISO, nowISO) || null;
}

/**
 * Verifie si une sequence est en pause (globale ou specifique)
 * Retourne { paused, reason, pause }
 */
function estEnPause(db, sequenceId, nowISO) {
  const pauseGlobale = getPauseGlobaleActive(db, nowISO);
  if (pauseGlobale) {
    return { paused: true, reason: pauseGlobale.raison || 'Pause globale', pause: pauseGlobale };
  }
  if (sequenceId) {
    const pauseSeq = getPauseSequenceActive(db, sequenceId, nowISO);
    if (pauseSeq) {
      return { paused: true, reason: pauseSeq.raison || 'Pause sequence', pause: pauseSeq };
    }
  }
  return { paused: false, reason: null, pause: null };
}

/**
 * Liste toutes les pauses actives
 */
function getPausesActives(db, nowISO) {
  return db.prepare(`
    SELECT p.*, s.nom as sequence_nom
    FROM pause_periods p
    LEFT JOIN sequences s ON s.id = p.sequence_id
    WHERE ${PAUSE_ACTIVE_SQL}
    ORDER BY date_debut DESC
  `).all(nowISO, nowISO);
}

/**
 * Liste toutes les pauses (historique)
 */
function getAllPauses(db) {
  return db.prepare(`
    SELECT p.*, s.nom as sequence_nom
    FROM pause_periods p
    LEFT JOIN sequences s ON s.id = p.sequence_id
    ORDER BY created_at DESC
  `).all();
}

/**
 * Compte les jours ouvres entre dateDebut et dateFin
 * joursActifs = array de numeros de jour (0=dim, 1=lun, ..., 6=sam)
 */
function compterJoursOuvres(dateDebut, dateFin, joursActifs) {
  const start = new Date(dateDebut);
  const end = new Date(dateFin);
  let count = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  while (cursor < endDay) {
    cursor.setDate(cursor.getDate() + 1);
    if (joursActifs.includes(cursor.getDay())) {
      count++;
    }
  }
  return count;
}

/**
 * Ajoute N jours ouvres a une date
 * Retourne la nouvelle date
 */
function ajouterJoursOuvres(dateDebut, nbJours, joursActifs) {
  const date = new Date(dateDebut);
  let remaining = nbJours;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (joursActifs.includes(date.getDay())) {
      remaining--;
    }
  }
  // Si on tombe sur un jour non actif, avancer au prochain jour actif
  let tentatives = 0;
  while (!joursActifs.includes(date.getDay()) && tentatives < 7) {
    date.setDate(date.getDate() + 1);
    tentatives++;
  }
  return date;
}

module.exports = {
  getPauseGlobaleActive,
  getPauseSequenceActive,
  estEnPause,
  getPausesActives,
  getAllPauses,
  compterJoursOuvres,
  ajouterJoursOuvres,
};
