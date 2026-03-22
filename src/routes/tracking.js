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
          JSON.stringify({ userAgent: req.get('User-Agent'), ip: req.ip })
        );

        // Récupérer le nombre total d'ouvertures pour ce lead
        const totalOuvertures = db.prepare('SELECT SUM(ouvertures) as total FROM emails WHERE lead_id = ?').get(email.lead_id)?.total || 0;

        // Mettre à jour le score du lead (max 95 pour ouvertures seules)
        const nouveauScore = Math.min(95, 50 + totalOuvertures * 10);
        db.prepare('UPDATE leads SET score = MAX(score, ?), updated_at = datetime(\'now\') WHERE id = ?').run(nouveauScore, email.lead_id);

        // Règle HubSpot : 2+ ouvertures → MQL
        if (totalOuvertures >= 2 && process.env.HUBSPOT_API_KEY) {
          const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(email.lead_id);
          if (lead) {
            await hubspot.mettreAJourLifecycle(db, lead, 'MQL').catch(e => logger.warn('HubSpot MQL update échoué', { error: e.message, leadId: lead.id }));
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
    const destinationUrl = url ? decodeURIComponent(url) : 'https://terre-de-mars.com';

    // Redirection immédiate
    res.redirect(302, destinationUrl);

    // Tracking asynchrone
    setImmediate(async () => {
      try {
        const { trackingId } = req.params;
        const email = db.prepare('SELECT * FROM emails WHERE tracking_id = ?').get(trackingId);
        if (!email) return;

        db.prepare('UPDATE emails SET clics = clics + 1, statut = \'cliqué\' WHERE tracking_id = ?').run(trackingId);
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

  // GET /api/tracking/unsubscribe/:leadId — Page de désabonnement RGPD
  router.get('/unsubscribe/:leadId', async (req, res) => {
    try {
      const { leadId } = req.params;
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);

      if (!lead) {
        return res.status(404).send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>Lien invalide</h2></body></html>');
      }

      // Désabonner le lead
      db.prepare('UPDATE leads SET unsubscribed = 1, statut = \'Désabonné\', updated_at = datetime(\'now\') WHERE id = ?').run(leadId);

      // Arrêter toutes les inscriptions actives
      db.prepare(`UPDATE inscriptions SET statut = 'terminé' WHERE lead_id = ? AND statut = 'actif'`).run(leadId);

      // Enregistrer l'événement
      db.prepare('INSERT INTO events (id, lead_id, type) VALUES (?, ?, ?)').run(uuidv4(), leadId, 'désabonnement');

      // Notifier HubSpot
      if (process.env.HUBSPOT_API_KEY && lead.hubspot_id) {
        hubspot.mettreAJourLifecycle(db, lead, 'lead').catch(e => logger.warn('HubSpot lifecycle update échoué (désabonnement)', { error: e.message, leadId: lead.id }));
      }

      logger.info(`🚫 Désabonnement : ${lead.email}`);

      // Page de confirmation
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
    <p>Votre adresse <strong>${lead.email}</strong> ne recevra plus d'emails de notre part.<br><br>Conformément au RGPD, cette demande est prise en compte immédiatement.</p>
  </div>
</body>
</html>`);
    } catch (err) {
      logger.error('Erreur désabonnement', { error: err.message });
      res.status(500).send('Erreur lors du désabonnement');
    }
  });

  // POST /api/tracking/reply — Détection de réponse (webhook Brevo inbound ou polling)
  // Brevo inbound : configurer https://tdm-sequencer-production.up.railway.app/api/tracking/reply
  router.post('/reply', express.json(), async (req, res) => {
    res.sendStatus(200);
    setImmediate(async () => {
      try {
        const body = req.body;
        // Support format Brevo inbound email
        const fromEmail = body.from || body.sender || body.From;
        const subject = body.subject || body.Subject || '';
        const rawHeaders = body.headers || '';

        if (!fromEmail) return;

        // Chercher le lead par email expéditeur
        const lead = db.prepare('SELECT * FROM leads WHERE email = ?').get(
          typeof fromEmail === 'object' ? fromEmail.address || fromEmail.email : fromEmail
        );
        if (!lead) {
          logger.debug('Reply reçu mais lead inconnu', { from: fromEmail });
          return;
        }

        // Marquer lead comme Répondu + stopper séquence
        db.prepare(`UPDATE leads SET statut = 'Répondu', score = MIN(100, score + 50), updated_at = datetime('now') WHERE id = ?`).run(lead.id);
        db.prepare(`UPDATE inscriptions SET statut = 'répondu', prochain_envoi = NULL WHERE lead_id = ? AND statut = 'actif'`).run(lead.id);

        // Enregistrer l'événement
        db.prepare('INSERT INTO events (id, lead_id, type, meta) VALUES (?, ?, ?, ?)').run(
          uuidv4(), lead.id, 'réponse',
          JSON.stringify({ sujet: subject, recu_at: new Date().toISOString() })
        );

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

          if (event.event === 'hard_bounce' || event.event === 'soft_bounce') {
            // Marquer comme bounced
            db.prepare('UPDATE emails SET statut = ? WHERE brevo_message_id = ?').run('bounced', event['message-id']);
            db.prepare('UPDATE leads SET score = 0, updated_at = datetime(\'now\') WHERE email = ?').run(event.email);
          }

          if (event.event === 'unsubscribe') {
            db.prepare('UPDATE leads SET unsubscribed = 1, statut = \'Désabonné\' WHERE email = ?').run(event.email);
            db.prepare(`UPDATE inscriptions SET statut = 'terminé' WHERE lead_id = (SELECT id FROM leads WHERE email = ?)`).run(event.email);
          }

          if (event.event === 'opened') {
            const email = db.prepare(`SELECT e.* FROM emails e JOIN leads l ON e.lead_id = l.id WHERE l.email = ? ORDER BY e.envoye_at DESC LIMIT 1`).get(event.email);
            if (email) {
              db.prepare('UPDATE emails SET ouvertures = ouvertures + 1, statut = \'ouvert\' WHERE id = ?').run(email.id);
            }
          }
        }
      } catch (err) {
        logger.error('Erreur webhook Brevo', { error: err.message });
      }
    });
  });

  return router;
};
