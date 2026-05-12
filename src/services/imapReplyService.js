/**
 * imapReplyService.js — Polling IMAP pour détecter les réponses aux emails de séquence
 */

const Imap = require('imap');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

function parseAddress(header) {
  const match = header.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase().trim();
  return header.toLowerCase().trim();
}

function getImapConfig(db) {
  const keys = ['imap_host', 'imap_port', 'imap_user', 'imap_password', 'imap_secure'];
  const config = {};
  for (const key of keys) {
    const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get(key);
    if (!row || !row.valeur) return null;
    config[key] = row.valeur;
  }
  return config;
}

function checkImapReplies(db) {
  return new Promise((resolve) => {
    const config = getImapConfig(db);
    if (!config) {
      logger.debug('Config IMAP absente ou incomplète — polling ignoré');
      return resolve();
    }

    const imap = new Imap({
      user: config.imap_user,
      password: config.imap_password,
      host: config.imap_host,
      port: parseInt(config.imap_port, 10),
      tls: config.imap_secure === 'true' || config.imap_secure === '1',
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once('error', (err) => {
      logger.error('Erreur IMAP', { error: err.message });
      resolve();
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) {
          logger.error('Erreur ouverture INBOX', { error: err.message });
          imap.end();
          return resolve();
        }

        const since = new Date();
        since.setHours(since.getHours() - 24);
        const sinceStr = since.toISOString().slice(0, 10).replace(/-/g, '-');
        // IMAP date format: DD-Mon-YYYY
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const imapDate = `${since.getDate()}-${months[since.getMonth()]}-${since.getFullYear()}`;

        imap.search(['UNSEEN', ['SINCE', imapDate]], (err, uids) => {
          if (err) {
            logger.error('Erreur recherche IMAP', { error: err.message });
            imap.end();
            return resolve();
          }

          if (!uids || uids.length === 0) {
            imap.end();
            return resolve();
          }

          logger.info(`📩 Vérification IMAP... ${uids.length} email(s) non lu(s) trouvé(s)`);

          const fetch = imap.fetch(uids, { bodies: 'HEADER.FIELDS (FROM SUBJECT)', markSeen: true });
          const processed = [];

          fetch.on('message', (msg) => {
            let headerData = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { headerData += chunk.toString('utf8'); });
            });
            msg.once('end', () => {
              processed.push(headerData);
            });
          });

          fetch.once('end', () => {
            for (const header of processed) {
              try {
                const fromMatch = header.match(/^From:\s*(.+)$/mi);
                const subjectMatch = header.match(/^Subject:\s*(.+)$/mi);
                if (!fromMatch) continue;

                const emailAddr = parseAddress(fromMatch[1]);
                const subject = subjectMatch ? subjectMatch[1].trim() : '';

                const lead = db.prepare('SELECT * FROM leads WHERE LOWER(email) = ?').get(emailAddr);
                if (!lead) continue;

                if (lead.statut === 'Répondu') continue;

                db.transaction(() => {
                  db.prepare(`UPDATE leads SET statut = 'Répondu', score = MIN(100, score + 50), updated_at = datetime('now') WHERE id = ?`).run(lead.id);
                  db.prepare(`UPDATE inscriptions SET statut = 'terminé', prochain_envoi = NULL WHERE lead_id = ? AND statut = 'actif'`).run(lead.id);
                  db.prepare('INSERT INTO events (id, lead_id, type, meta) VALUES (?, ?, ?, ?)').run(
                    uuidv4(), lead.id, 'réponse',
                    JSON.stringify({ sujet: subject, recu_at: new Date().toISOString(), source: 'imap' })
                  );
                })();

                logger.info('📩 Réponse IMAP détectée', { email: lead.email, sujet: subject });
              } catch (e) {
                logger.error('Erreur traitement email IMAP', { error: e.message });
              }
            }
            imap.end();
            resolve();
          });

          fetch.once('error', (err) => {
            logger.error('Erreur fetch IMAP', { error: err.message });
            imap.end();
            resolve();
          });
        });
      });
    });

    imap.connect();
  });
}

module.exports = { checkImapReplies };
