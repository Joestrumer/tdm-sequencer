/**
 * imapReplyService.js — Polling IMAP pour détecter les réponses aux emails de séquence
 */

const Imap = require('imap');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

const AUTO_REPLY_SUBJECTS = [
  /^(re:\s*)?(out of office|absence|automatic reply|auto[- ]?reply|autoreply)/i,
  /^(re:\s*)?(message automatique|réponse automatique|hors du bureau|en dehors du bureau)/i,
  /^(re:\s*)?(vacation|congé|indisponible|undeliverable|non remis|delivery|returned mail)/i,
  /^(re:\s*)?(mail delivery|failure notice|postmaster|mailer-daemon)/i,
];

function isAutoReply(headerData) {
  // Header Auto-Submitted (RFC 3834)
  const autoSubmitted = headerData.match(/^Auto-Submitted:\s*(.+)$/mi);
  if (autoSubmitted && autoSubmitted[1].trim().toLowerCase() !== 'no') return true;

  // Header X-Auto-Response-Suppress (Microsoft)
  if (/^X-Auto-Response-Suppress:/mi.test(headerData)) return true;

  // Header Precedence: bulk/auto_reply/junk
  const precedence = headerData.match(/^Precedence:\s*(.+)$/mi);
  if (precedence && /^(bulk|auto_reply|junk|list)$/i.test(precedence[1].trim())) return true;

  // Expéditeur mailer-daemon / postmaster / noreply
  const from = headerData.match(/^From:\s*(.+)$/mi);
  if (from && /mailer-daemon|postmaster|noreply|no-reply/i.test(from[1])) return true;

  // Sujet typique de réponse automatique
  const subject = headerData.match(/^Subject:\s*(.+)$/mi);
  if (subject && AUTO_REPLY_SUBJECTS.some(rx => rx.test(subject[1].trim()))) return true;

  return false;
}

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

          const fetch = imap.fetch(uids, { bodies: 'HEADER.FIELDS (FROM SUBJECT AUTO-SUBMITTED X-AUTO-RESPONSE-SUPPRESS PRECEDENCE)', markSeen: false });
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
            for (const headerData of processed) {
              try {
                const fromMatch = headerData.match(/^From:\s*(.+)$/mi);
                const subjectMatch = headerData.match(/^Subject:\s*(.+)$/mi);
                if (!fromMatch) continue;

                const emailAddr = parseAddress(fromMatch[1]);
                const subject = subjectMatch ? subjectMatch[1].trim() : '';

                if (isAutoReply(headerData)) {
                  logger.debug('📩 Réponse automatique ignorée', { from: emailAddr, sujet: subject });
                  continue;
                }

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
