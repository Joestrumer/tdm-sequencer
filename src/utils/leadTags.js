/**
 * leadTags.js — Gestion des tags automatiques sur les leads
 */

/**
 * Ajoute ou met à jour un tag avec préfixe et date sur un lead.
 * Format : "Séquence: Relance Hôtels (03/04/2026)"
 *
 * @param {object} db - Instance better-sqlite3
 * @param {string} leadId - ID du lead
 * @param {string} prefix - Préfixe du tag (ex: "Séquence", "Email Marketing")
 * @param {string} value - Valeur du tag (ex: nom de la séquence ou campagne)
 */
function addOrUpdateTag(db, leadId, prefix, value) {
  const lead = db.prepare('SELECT tags FROM leads WHERE id = ?').get(leadId);
  if (!lead) return;

  let tags = [];
  try { tags = JSON.parse(lead.tags || '[]'); } catch (_) {}
  if (!Array.isArray(tags)) tags = [];

  // Supprimer les anciens tags avec le même préfixe + valeur (peu importe la date)
  const tagPrefix = `${prefix}: ${value}`;
  tags = tags.filter(t => !t.startsWith(tagPrefix));

  // Ajouter le nouveau tag avec la date du jour
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  tags.push(`${prefix}: ${value} (${dateStr})`);

  db.prepare('UPDATE leads SET tags = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(tags), leadId);
}

module.exports = { addOrUpdateTag };
