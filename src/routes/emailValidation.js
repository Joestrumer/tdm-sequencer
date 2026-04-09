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

  // POST /api/email-validation/find — Body: { prenom, nom, domaine }
  // Génère tous les patterns d'email et les teste via ZeroBounce
  router.post('/find', async (req, res) => {
    const key = getKey();
    if (!key) return res.status(400).json({ erreur: 'Clé ZeroBounce non configurée' });

    const { prenom, nom, domaine } = req.body;
    if (!prenom || !nom || !domaine) return res.status(400).json({ erreur: 'prenom, nom et domaine requis' });

    const p = prenom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
    const n = nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
    const pi = p.charAt(0); // première lettre prénom
    const ni = n.charAt(0); // première lettre nom
    const d = domaine.trim().replace(/^@/, '');

    // Générer tous les patterns courants
    const patterns = [
      ...new Set([
        `${p}@${d}`,                     // jean@
        `${n}@${d}`,                     // dupont@
        `${p}.${n}@${d}`,               // jean.dupont@
        `${n}.${p}@${d}`,               // dupont.jean@
        `${p}${n}@${d}`,                // jeandupont@
        `${n}${p}@${d}`,                // dupontjean@
        `${pi}${n}@${d}`,               // jdupont@
        `${pi}.${n}@${d}`,              // j.dupont@
        `${p}${ni}@${d}`,               // jeand@
        `${p}.${ni}@${d}`,              // jean.d@
        `${pi}${ni}@${d}`,              // jd@
        `${p}-${n}@${d}`,               // jean-dupont@
        `${n}-${p}@${d}`,               // dupont-jean@
        `${p}_${n}@${d}`,               // jean_dupont@
        `${n}_${p}@${d}`,               // dupont_jean@
        `${pi}${n[0] || ''}@${d}`,      // jd@ (déjà couvert)
        `${p}${n.substring(0, 2)}@${d}`, // jeandu@
        `contact@${d}`,
        `info@${d}`,
        `reservation@${d}`,
        `reservations@${d}`,
        `booking@${d}`,
        `reception@${d}`,
        `direction@${d}`,
        `hotel@${d}`,
        `accueil@${d}`,
      ])
    ];

    const results = [];
    for (const email of patterns) {
      try {
        const r = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${key}&email=${encodeURIComponent(email)}&ip_address=`);
        if (!r.ok) throw new Error(`ZeroBounce HTTP ${r.status}`);
        const data = await r.json();
        results.push({ email, status: data.status, sub_status: data.sub_status, quality_score: data.quality_score, free_email: data.free_email, mx_found: data.mx_found });
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        results.push({ email, status: 'error', sub_status: e.message });
      }
    }

    // Trier : valid en premier, puis catch_all, puis le reste
    const statusOrder = { valid: 0, catch_all: 1, unknown: 2, do_not_mail: 3, spamtrap: 4, invalid: 5, error: 6 };
    results.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));

    res.json({ patterns: results, total: patterns.length, prenom: p, nom: n, domaine: d });
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
