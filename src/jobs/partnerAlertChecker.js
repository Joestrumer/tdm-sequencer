/**
 * partnerAlertChecker.js — Cron quotidien 8h : détecte les partenaires inactifs
 */
const cron = require('node-cron');
const { randomUUID } = require('crypto');

function initialiser(db) {
  // 1x/jour à 8h
  cron.schedule('0 8 * * *', () => {
    try {
      const config = db.prepare('SELECT seuil_jours FROM partner_alert_config WHERE actif = 1 LIMIT 1').get();
      if (!config) return;

      const seuil = config.seuil_jours;
      const today = new Date().toISOString().split('T')[0];

      const inactifs = db.prepare(`
        SELECT id, nom, derniere_commande_at,
               CAST(julianday('now') - julianday(derniere_commande_at) AS INTEGER) as jours_inactif
        FROM vf_partners
        WHERE actif = 1 AND derniere_commande_at IS NOT NULL
        AND derniere_commande_at < datetime('now', '-' || ? || ' days')
      `).all(seuil);

      let alertes = 0;
      for (const p of inactifs) {
        // Pas de doublon le même jour
        const existe = db.prepare(`
          SELECT id FROM partner_notes
          WHERE partner_id = ? AND type = 'alerte' AND created_at >= ?
        `).get(p.id, today);

        if (!existe) {
          db.prepare(`
            INSERT INTO partner_notes (id, partner_id, type, contenu, created_by)
            VALUES (?, ?, 'alerte', ?, 'system')
          `).run(randomUUID(), p.id, `Inactivité détectée : ${p.jours_inactif} jours sans commande (seuil: ${seuil}j)`);
          alertes++;
        }
      }

      if (alertes > 0) {
        console.log(`🔔 ${alertes} alerte(s) inactivité partenaire générée(s)`);
      }
    } catch (e) {
      console.error('❌ Erreur partnerAlertChecker:', e.message);
    }
  });

  console.log('🔔 Partner alert checker initialisé (8h quotidien)');
}

module.exports = { initialiser };
