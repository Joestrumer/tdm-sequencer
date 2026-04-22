/**
 * backup.js — Sauvegarde automatique quotidienne de la base de données
 * Exporte les tables critiques en JSON et push sur GitHub
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

const BACKUP_DIR = path.resolve('./data/backups');
const GITHUB_REPO = 'Joestrumer/tdm-sequencer';
const BACKUP_BRANCH = 'backups';

// Tables critiques à sauvegarder
const TABLES = [
  'leads', 'sequences', 'etapes', 'inscriptions',
  'emails', 'events', 'email_blocklist', 'email_templates',
  'envoi_quota', 'config',
  'hotels_france', 'import_sources', 'imported_prospects', 'email_registry'
];

function exporterDonnees(db) {
  const data = {};
  for (const table of TABLES) {
    try {
      data[table] = db.prepare(`SELECT * FROM ${table}`).all();
    } catch (e) {
      logger.warn(`Backup: table ${table} inaccessible — ${e.message}`);
      data[table] = [];
    }
  }
  data._meta = {
    date: new Date().toISOString(),
    tables: Object.fromEntries(TABLES.map(t => [t, data[t].length]))
  };
  return data;
}

function sauvegarderLocal(data) {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const filePath = path.join(BACKUP_DIR, `backup-${date}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  logger.info(`✅ Backup local : ${filePath}`);

  // Garder seulement les 3 derniers backups locaux (les anciens sont sur GitHub)
  const fichiers = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
    .sort()
    .reverse();
  for (const f of fichiers.slice(3)) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    logger.info(`🗑️  Ancien backup supprimé : ${f}`);
  }

  return filePath;
}

async function pushGitHub(data) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    logger.warn('⚠️ GITHUB_TOKEN non défini — backup GitHub désactivé');
    return false;
  }

  const date = new Date().toISOString().split('T')[0];
  const fileName = `backups/backup-${date}.json`;
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

  try {
    // Vérifier si la branche backups existe, sinon la créer
    const branchRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/${BACKUP_BRANCH}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
    );

    if (!branchRes.ok) {
      // Récupérer le SHA du main pour créer la branche
      const mainRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
      );
      const mainData = await mainRes.json();

      await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ref: `refs/heads/${BACKUP_BRANCH}`, sha: mainData.object.sha })
      });
      logger.info(`✅ Branche '${BACKUP_BRANCH}' créée sur GitHub`);
    }

    // Vérifier si le fichier existe déjà (pour obtenir son SHA)
    let fileSha = null;
    const fileRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${fileName}?ref=${BACKUP_BRANCH}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (fileRes.ok) {
      const fileData = await fileRes.json();
      fileSha = fileData.sha;
    }

    // Créer/mettre à jour le fichier
    const body = {
      message: `Backup automatique ${date}`,
      content,
      branch: BACKUP_BRANCH,
    };
    if (fileSha) body.sha = fileSha;

    const putRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${fileName}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (putRes.ok) {
      logger.info(`✅ Backup GitHub : ${fileName} (branche ${BACKUP_BRANCH})`);
      return true;
    } else {
      const err = await putRes.json();
      logger.error(`❌ Backup GitHub échoué : ${err.message}`);
      return false;
    }
  } catch (e) {
    logger.error(`❌ Backup GitHub erreur : ${e.message}`);
    return false;
  }
}

function initialiser(db) {
  // Backup quotidien à 2h du matin
  cron.schedule('0 2 * * *', async () => {
    logger.info('🔄 Lancement du backup quotidien...');
    try {
      const data = exporterDonnees(db);
      sauvegarderLocal(data);
      await pushGitHub(data);

      const total = Object.values(data._meta.tables).reduce((a, b) => a + b, 0);
      logger.info(`✅ Backup terminé — ${total} enregistrements sauvegardés`);
    } catch (e) {
      logger.error(`❌ Backup échoué : ${e.message}`);
    }
  });

  logger.info('⏱️  Backup quotidien programmé à 02:00');
}

// Export pour utilisation manuelle via API
module.exports = { initialiser, exporterDonnees, sauvegarderLocal, pushGitHub };
