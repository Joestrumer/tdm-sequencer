/**
 * emailValidation.js — Routes ZeroBounce
 */
const express = require('express');
const router  = express.Router();
const logger  = require('../config/logger');

module.exports = (db) => {

  const getKey = () =>
    process.env.ZEROBOUNCE_API_KEY ||
    db.prepare("SELECT valeur FROM config WHERE cle = 'zerobounce_api_key'").get()?.valeur ||
    null;

  // GET /api/email-validation/credits
  router.get('/credits', async (req, res) => {
    const key = getKey();
    if (!key) return res.status(400).json({ erreur: 'Clé ZeroBounce non configurée' });
    try {
      const r    = await fetch(`https://api.zerobounce.net/v2/getcredits?api_key=${key}`);
      const data = await r.json();
      res.json(data);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // POST /api/email-validation/single — Body: { email, lead_id? }
  router.post('/single', async (req, res) => {
    const key = getKey();
    if (!key) return res.status(400).json({ erreur: 'Clé ZeroBounce non configurée' });

    const { email, lead_id } = req.body;
    if (!email) return res.status(400).json({ erreur: 'email requis' });

    try {
      const r = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${key}&email=${encodeURIComponent(email)}&ip_address=`);
      if (!r.ok) throw new Error(`ZeroBounce HTTP ${r.status}`);
      const data = await r.json();

      if (lead_id) {
        db.prepare(`UPDATE leads SET statut_email=?, email_score=?, updated_at=datetime('now') WHERE id=?`)
          .run(data.status || 'unknown', data.quality_score || null, lead_id);
        logger.info('Email validé ZeroBounce', { email, status: data.status });
      }

      res.json(data);
    } catch (e) {
      logger.error('ZeroBounce erreur', { email, error: e.message });
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
