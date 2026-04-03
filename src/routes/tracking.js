/**
 * tracking.js — Routes de tracking email (pixel ouverture, clic, désabonnement)
 * Ces routes sont PUBLIQUES (pas d'auth requise)
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const hubspot = require('../services/hubspotService');

// Pixel 1×1 transparent GIF
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Échappement HTML pour prévenir XSS
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = (db) => {

  // GET /api/tracking/open/:trackingId — Pixel de suivi d'ouverture
  router.get('/open/:trackingId', (req, res) => {
    // Répondre immédiatement avec le pixel pour ne pas ralentir l'affichage
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(PIXEL_GIF);

    // Traitement asynchrone en arrière-plan
    setImmediate(async () => {
      try {
        const { trackingId } = req.params;
        const email = db.prepare('SELECT * FROM emails WHERE tracking_id = ?').get(trackingId);
        if (!email) return;

        const now = new Date().toISOString();

        // Incrémenter le compteur d'ouvertures
        db.prepare(`
          UPDATE emails SET
            ouvertures = ouvertures + 1,
            statut = CASE WHEN statut = 'envoyé' THEN 'ouvert' ELSE statut END,
            premier_ouvert = COALESCE(premier_ouvert, ?),
            dernier_ouvert = ?
          WHERE tracking_id = ?
        `).run(now, now, trackingId);

        // Enregistrer l'événement
        db.prepare('INSERT INTO events (id, email_id, lead_id, type, meta) VALUES (?, ?, ?, ?, ?)').run(
          uuidv4(), email.id, email.lead_id, 'ouverture',
          JSON.stringify({ userAgent: req.get('User-Agent') })
        );

        // Récupérer le nombre total d'ouvertures pour ce lead
        const totalOuvertures = db.prepare('SELECT SUM(ouvertures) as total FROM emails WHERE lead_id = ?').get(email.lead_id)?.total || 0;

        // Mettre à jour le score du lead (max 95 pour ouvertures seules)
        const nouveauScore = Math.min(95, 50 + totalOuvertures * 10);
        db.prepare('UPDATE leads SET score = MAX(score, ?), updated_at = datetime(\'now\') WHERE id = ?').run(nouveauScore, email.lead_id);

        // Règle HubSpot : 2+ ouvertures → MQL
        if (totalOuvertures >= 2 && process.env.HUBSPOT_API_KEY) {
          const cfgLifecycle = db.prepare("SELECT valeur FROM config WHERE cle = 'hs_lifecycle'").get();
          const lifecycleEnabled = cfgLifecycle ? cfgLifecycle.valeur !== '0' && cfgLifecycle.valeur !== 'false' : true;
          if (lifecycleEnabled) {
            const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(email.lead_id);
            if (lead) {
              await hubspot.mettreAJourLifecycle(db, lead, 'MQL').catch(e => logger.warn('HubSpot MQL update échoué', { error: e.message, leadId: lead.id }));
            }
          }
        }

        logger.debug(`👁  Ouverture trackée : email ${email.id}, total: ${totalOuvertures}`);
      } catch (err) {
        logger.error('Erreur tracking ouverture', { error: err.message });
      }
    });
  });

  // GET /api/tracking/click/:trackingId — Redirection avec tracking de clic
  router.get('/click/:trackingId', (req, res) => {
    const { url } = req.query;
    let destinationUrl = 'https://www.terredemars.com';

    // Valider que l'URL de destination est bien une URL HTTP(S) absolue
    if (url) {
      try {
        const decoded = decodeURIComponent(url);
        const parsed = new URL(decoded);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          destinationUrl = decoded;
        }
      } catch (e) {
        // URL invalide → redirection par défaut
      }
    }

    // Redirection immédiate
    res.redirect(302, destinationUrl);

    // Tracking asynchrone
    setImmediate(async () => {
      try {
        const { trackingId } = req.params;
        const email = db.prepare('SELECT * FROM emails WHERE tracking_id = ?').get(trackingId);
        if (!email) return;

        // Ne pas écraser un statut bounced ou erreur
        db.prepare(`
          UPDATE emails SET clics = clics + 1,
            statut = CASE WHEN statut IN ('envoyé', 'ouvert') THEN 'cliqué' ELSE statut END
          WHERE tracking_id = ?
        `).run(trackingId);

        db.prepare('INSERT INTO events (id, email_id, lead_id, type, meta) VALUES (?, ?, ?, ?, ?)').run(
          uuidv4(), email.id, email.lead_id, 'clic',
          JSON.stringify({ url: destinationUrl })
        );

        // Augmenter le score (clic = signal fort)
        db.prepare('UPDATE leads SET score = MIN(100, score + 15), updated_at = datetime(\'now\') WHERE id = ?').run(email.lead_id);

        logger.debug(`🔗 Clic tracké : ${destinationUrl}`);
      } catch (err) {
        logger.error('Erreur tracking clic', { error: err.message });
      }
    });
  });

  // Désabonnement — accepte GET (lien email) et POST (List-Unsubscribe-Post)
  function handleUnsubscribe(req, res) {
    try {
      const { leadId } = req.params;

      // Désabonnement pour recipients CSV (sans lead_id) — format csv:trackingId
      if (leadId.startsWith('csv:')) {
        const trackingId = leadId.slice(4);
        const email_row = db.prepare('SELECT * FROM emails WHERE tracking_id = ?').get(trackingId);
        if (!email_row) return res.status(404).send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>Lien invalide</h2></body></html>');
        // Trouver l'email du recipient
        const recipient = email_row.campaign_recipient_id
          ? db.prepare('SELECT email FROM campaign_recipients WHERE id = ?').get(email_row.campaign_recipient_id)
          : null;
        const emailAddr = recipient?.email || '';
        if (emailAddr) {
          // Ajouter à la blocklist
          try {
            db.prepare('INSERT INTO email_blocklist (id, type, value, raison) VALUES (?, ?, ?, ?)').run(
              uuidv4(), 'email', emailAddr.toLowerCase(), 'Désabonnement campagne marketing'
            );
          } catch (_) { /* déjà en blocklist */ }
          // Si le lead existe, le marquer aussi
          const existingLead = db.prepare('SELECT id FROM leads WHERE email = ?').get(emailAddr);
          if (existingLead) {
            db.prepare('UPDATE leads SET unsubscribed = 1, statut = \'Désabonné\', updated_at = datetime(\'now\') WHERE id = ?').run(existingLead.id);
          }
          logger.info(`🚫 Désabonnement campagne CSV : ${emailAddr}`);
        }
        return sendUnsubPage(res, { email: emailAddr || 'votre adresse' });
      }

      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);

      if (!lead) {
        return res.status(404).send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>Lien invalide</h2></body></html>');
      }

      // Déjà désabonné ? Afficher la page sans re-traiter
      if (lead.unsubscribed) {
        return sendUnsubPage(res, lead);
      }

      // Transaction atomique pour cohérence
      db.transaction(() => {
        db.prepare('UPDATE leads SET unsubscribed = 1, statut = \'Désabonné\', updated_at = datetime(\'now\') WHERE id = ?').run(leadId);
        db.prepare(`UPDATE inscriptions SET statut = 'terminé', prochain_envoi = NULL WHERE lead_id = ? AND statut = 'actif'`).run(leadId);
        db.prepare('INSERT INTO events (id, lead_id, type) VALUES (?, ?, ?)').run(uuidv4(), leadId, 'désabonnement');
      })();

      // Notifier HubSpot
      if (process.env.HUBSPOT_API_KEY && lead.hubspot_id) {
        hubspot.mettreAJourLifecycle(db, lead, 'lead').catch(e => logger.warn('HubSpot lifecycle update échoué (désabonnement)', { error: e.message, leadId: lead.id }));
      }

      logger.info(`🚫 Désabonnement : ${lead.email}`);
      sendUnsubPage(res, lead);
    } catch (err) {
      logger.error('Erreur désabonnement', { error: err.message });
      res.status(500).send('Erreur lors du désabonnement');
    }
  }

  function sendUnsubPage(res, lead) {
    const safeEmail = escapeHtml(lead.email);
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Désabonnement — Terre de Mars</title>
  <style>
    body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8f8f8; }
    .card { background: white; border-radius: 12px; padding: 48px; max-width: 440px; text-align: center; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
    h1 { font-size: 20px; color: #1a1a1a; margin-bottom: 12px; }
    p { color: #666; line-height: 1.6; font-size: 15px; }
    .logo { font-size: 13px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #1a1a1a; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Terre de Mars</div>
    <h1>Vous avez bien été désabonné</h1>
    <p>Votre adresse <strong>${safeEmail}</strong> ne recevra plus d'emails de notre part.<br><br>Conformément au RGPD, cette demande est prise en compte immédiatement.</p>
  </div>
</body>
</html>`);
  }

  router.get('/unsubscribe/:leadId', handleUnsubscribe);
  router.post('/unsubscribe/:leadId', handleUnsubscribe);

  // POST /api/tracking/reply — Détection de réponse (webhook Brevo inbound ou polling)
  router.post('/reply', express.json(), async (req, res) => {
    res.sendStatus(200);
    setImmediate(async () => {
      try {
        const body = req.body;
        const fromEmail = body.from || body.sender || body.From;
        const subject = body.subject || body.Subject || '';

        if (!fromEmail) return;

        // Normaliser l'email en lowercase pour matcher
        const emailAddr = (typeof fromEmail === 'object' ? fromEmail.address || fromEmail.email : fromEmail).toLowerCase().trim();

        const lead = db.prepare('SELECT * FROM leads WHERE LOWER(email) = ?').get(emailAddr);
        if (!lead) {
          logger.debug('Reply reçu mais lead inconnu', { from: emailAddr });
          return;
        }

        // Marquer lead comme Répondu + stopper séquence (transaction)
        db.transaction(() => {
          db.prepare(`UPDATE leads SET statut = 'Répondu', score = MIN(100, score + 50), updated_at = datetime('now') WHERE id = ?`).run(lead.id);
          db.prepare(`UPDATE inscriptions SET statut = 'terminé', prochain_envoi = NULL WHERE lead_id = ? AND statut = 'actif'`).run(lead.id);
          db.prepare('INSERT INTO events (id, lead_id, type, meta) VALUES (?, ?, ?, ?)').run(
            uuidv4(), lead.id, 'réponse',
            JSON.stringify({ sujet: subject, recu_at: new Date().toISOString() })
          );
        })();

        // Notifier HubSpot
        if (process.env.HUBSPOT_API_KEY && lead.hubspot_id) {
          await hubspot.mettreAJourLifecycle(db, lead, 'MQL').catch(e => logger.warn('HubSpot MQL update échoué (reply)', { error: e.message, leadId: lead.id }));
        }

        logger.info('📩 Réponse détectée — lead passé en Répondu', { email: lead.email, sujet: subject });
      } catch(err) {
        logger.error('Erreur webhook reply', { error: err.message });
      }
    });
  });

  // POST /api/tracking/webhook/brevo — Webhooks Brevo (bounces, spam, etc.)
  router.post('/webhook/brevo', express.json(), (req, res) => {
    res.sendStatus(200); // Répondre vite à Brevo

    setImmediate(() => {
      try {
        const events = Array.isArray(req.body) ? req.body : [req.body];
        for (const event of events) {
          logger.info('Webhook Brevo reçu', { event: event.event, email: event.email });

          if (event.event === 'hard_bounce') {
            db.prepare('UPDATE emails SET statut = ? WHERE brevo_message_id = ?').run('bounced', event['message-id']);
            db.prepare('UPDATE leads SET score = 0, statut_email = \'hard_bounce\', updated_at = datetime(\'now\') WHERE email = ?').run(event.email);
          }

          if (event.event === 'soft_bounce') {
            // Soft bounce = temporaire, réduire le score mais ne pas mettre à 0
            db.prepare('UPDATE emails SET statut = ? WHERE brevo_message_id = ?').run('soft_bounce', event['message-id']);
            db.prepare('UPDATE leads SET score = MAX(0, score - 20), statut_email = \'soft_bounce\', updated_at = datetime(\'now\') WHERE email = ?').run(event.email);
          }

          if (event.event === 'unsubscribe') {
            db.transaction(() => {
              db.prepare('UPDATE leads SET unsubscribed = 1, statut = \'Désabonné\', updated_at = datetime(\'now\') WHERE email = ?').run(event.email);
              db.prepare(`UPDATE inscriptions SET statut = 'terminé', prochain_envoi = NULL WHERE lead_id = (SELECT id FROM leads WHERE email = ?) AND statut = 'actif'`).run(event.email);
            })();
          }

          // Ignorer 'opened' du webhook — déjà tracké par le pixel
          // Évite le double comptage des ouvertures
        }
      } catch (err) {
        logger.error('Erreur webhook Brevo', { error: err.message });
      }
    });
  });

  return router;
};
