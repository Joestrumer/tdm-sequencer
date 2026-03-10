/**
 * emailValidation.js — Routes ZeroBounce
 */
const express = require('express');
const router = express.Router();
const logger = require('../config/logger');

module.exports = (db) => {

  const getKey = () => {
    // Priorité : variable Railway > DB config
    if (process.env.ZEROBOUNCE_API_KEY) return process.env.ZEROBOUNCE_API_KEY;
    try {
      const row = db.prepare("SELECT valeur FROM config WHERE cle = 'zerobounce_api_key'").get();
      return row?.valeur || null;
    } catch(e) { return null; }
  };

  // GET /api/email-validation/credits
  router.get('/credits', async (req, res) => {
    const key = getKey();
    if (!key) return res.status(400).json({ error: 'Clé ZeroBounce non configurée' });
    try {
      const r = await fetch(`https://api.zerobounce.net/v2/getcredits?api_key=${key}`);
      const data = await r.json();
      res.json(data);
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/email-validation/single
  // Body: { email, lead_id? }
  router.post('/single', async (req, res) => {
    const key = getKey();
    if (!key) return res.status(400).json({ error: 'Clé ZeroBounce non configurée' });

    const { email, lead_id } = req.body;
    if (!email) return res.status(400).json({ error: 'email requis' });

    try {
      const url = `https://api.zerobounce.net/v2/validate?api_key=${key}&email=${encodeURIComponent(email)}&ip_address=`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ZeroBounce HTTP ${r.status}`);
      const data = await r.json();

      // Persister le résultat dans la DB si lead_id fourni
      if (lead_id) {
        try {
          // Ajouter colonne si elle n'existe pas
          db.prepare("ALTER TABLE leads ADD COLUMN statut_email TEXT").run();
        } catch(e) { /* colonne existe déjà */ }
        try {
          db.prepare("ALTER TABLE leads ADD COLUMN email_score REAL").run();
        } catch(e) {}
        db.prepare("UPDATE leads SET statut_email = ?, email_score = ?, updated_at = datetime('now') WHERE id = ?")
          .run(data.status || 'unknown', data.quality_score || null, lead_id);
        logger.info('Email validé ZeroBounce', { email, status: data.status, lead_id });
      }

      res.json(data);
    } catch(e) {
      logger.error('ZeroBounce erreur', { email, error: e.message });
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
