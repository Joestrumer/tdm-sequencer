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

    const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z-]/g, '');
    const p = normalize(prenom).replace(/-/g, ''); // prénom sans tirets : jeanpierre
    const n = normalize(nom).replace(/-/g, '');     // nom sans tirets : dupont
    const pRaw = normalize(prenom); // prénom avec tirets : jean-pierre
    const nRaw = normalize(nom);     // nom avec tirets : le-goff

    const pi = p.charAt(0);  // initiale prénom
    const ni = n.charAt(0);  // initiale nom
    const d = domaine.trim().replace(/^@/, '');

    // Parties du nom composé (ex: "Le Goff" → ["le","goff"], "Schmitz" → ["schmitz"])
    const nomParts = nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[\s-]+/).filter(Boolean).map(s => s.replace(/[^a-z]/g, ''));
    const secondNom = nomParts.length > 1 ? nomParts[nomParts.length - 1] : null;
    const si = secondNom ? secondNom.charAt(0) : null;

    // Troncatures du nom (3, 4, 5 lettres + initiale)
    const nTrunc = [];
    if (n.length > 1) nTrunc.push(n.substring(0, 1));
    if (n.length > 3) nTrunc.push(n.substring(0, 3));
    if (n.length > 4) nTrunc.push(n.substring(0, 4));
    if (n.length > 5) nTrunc.push(n.substring(0, 5));
    if (n.length > 6) nTrunc.push(n.substring(0, 6));

    // Troncatures du prénom (4 lettres)
    const pTrunc4 = p.length > 4 ? p.substring(0, 4) : null;

    // Générer tous les patterns (priorité décroissante)
    const raw = [
      // ── Priorité haute : patterns classiques ──
      `${p}.${n}@${d}`,               // jean.dupont@
      `${pi}.${n}@${d}`,              // j.dupont@
      `${p}@${d}`,                     // jean@
      `${pi}${n}@${d}`,               // jdupont@
      `${p}${n}@${d}`,                // jeandupont@
      `${n}@${d}`,                     // dupont@
      `${p}-${n}@${d}`,               // jean-dupont@
      `${p}_${n}@${d}`,               // jean_dupont@
      `${n}.${p}@${d}`,               // dupont.jean@
      `${p}.${ni}@${d}`,              // jean.d@
      `${pi}.${ni}@${d}`,             // j.d@

      // ── Troncatures du nom : prenom.nom[1-6]@ ──
      ...nTrunc.map(t => `${p}.${t}@${d}`),     // jean.s@, jean.sch@, jean.schm@, jean.schmi@, jean.schmit@
      ...nTrunc.map(t => `${pi}.${t}@${d}`),     // j.s@, j.sch@, j.schm@, ...
      ...nTrunc.map(t => `${p}${t}@${d}`),       // jeans@, jeansch@, jeanschm@, ...
      ...nTrunc.map(t => `${pi}${t}@${d}`),      // js@, jsch@, jschm@, ...

      // ── Variantes inversées et composites ──
      `${n}${p}@${d}`,                // dupontjean@
      `${p}${ni}@${d}`,               // jeand@
      `${n}-${p}@${d}`,               // dupont-jean@
      `${n}_${p}@${d}`,               // dupont_jean@

      // ── Prenom tronqué + nom ──
      ...(pTrunc4 ? [
        `${pTrunc4}.${n}@${d}`,        // jean.dupont@ (si prénom long → gust.schmitz@)
        `${pTrunc4}${n}@${d}`,         // gustschmitz@
        `${pTrunc4}.${ni}@${d}`,       // gust.s@
      ] : []),

      // ── Combinaisons prenom4 + nom4 (startups/tech) ──
      ...(pTrunc4 && n.length > 4 ? [
        `${pTrunc4}${n.substring(0, 4)}@${d}`, // gustschm@
      ] : []),

      // ── Nom composé : prenom.secondnom@, prenom.nom-compose@ ──
      ...(secondNom ? [
        `${p}.${secondNom}@${d}`,       // jean.goff@
        `${pi}.${secondNom}@${d}`,      // j.goff@
        `${p}.${nomParts.join('')}@${d}`,  // jean.legoff@ (tout collé)
        `${p}.${nRaw}@${d}`,           // jean.le-goff@ (avec tiret original)
        `${p}${secondNom}@${d}`,        // jeangoff@
        `${pi}${secondNom}@${d}`,       // jgoff@
        ...(secondNom.length > 3 ? [
          `${p}.${secondNom.substring(0, 3)}@${d}`,  // jean.gof@
          `${p}.${secondNom.substring(0, 4)}@${d}`,  // jean.goff@ (déjà couvert si 4 lettres)
        ] : []),
      ] : []),

      // ── Prénom composé : jeanpierre → jean-pierre, jp ──
      ...(pRaw.includes('-') ? [
        `${pRaw}.${n}@${d}`,           // jean-pierre.dupont@
        `${pRaw}${n}@${d}`,            // jean-pierredupont@
        // Initiales du prénom composé
        `${pRaw.split('-').map(s => s[0]).join('')}${n}@${d}`,   // jpdupont@
        `${pRaw.split('-').map(s => s[0]).join('')}.${n}@${d}`,  // jp.dupont@
        `${pRaw.split('-')[0]}.${n}@${d}`,  // jean.dupont@ (déjà couvert normalement)
      ] : []),

      // ── Emails génériques ──
      `contact@${d}`,
      `info@${d}`,
      `reservation@${d}`,
      `reservations@${d}`,
      `booking@${d}`,
      `reception@${d}`,
      `direction@${d}`,
      `hotel@${d}`,
      `accueil@${d}`,
    ];

    // Dédupliquer en gardant l'ordre de priorité, filtrer les patterns invalides
    const seen = new Set();
    const patterns = [];
    for (const email of raw) {
      if (!email || email.startsWith('.') || email.includes('..') || email.startsWith('@')) continue;
      const lower = email.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        patterns.push(lower);
      }
    }

    const results = [];
    let creditsUsed = 0;
    let foundValid = false;

    // Séparer patterns personnels et génériques
    const genericEmails = ['contact@', 'info@', 'reservation@', 'reservations@', 'booking@', 'reception@', 'direction@', 'hotel@', 'accueil@'];
    const isGeneric = (email) => genericEmails.some(g => email.startsWith(g));

    for (const email of patterns) {
      // Si on a trouvé un valid personnel, skip les génériques
      if (foundValid && isGeneric(email)) continue;

      try {
        const r = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${key}&email=${encodeURIComponent(email)}&ip_address=`);
        if (!r.ok) throw new Error(`ZeroBounce HTTP ${r.status}`);
        const data = await r.json();
        creditsUsed++;
        results.push({ email, status: data.status, sub_status: data.sub_status, quality_score: data.quality_score, free_email: data.free_email, mx_found: data.mx_found });
        if (data.status === 'valid' && !isGeneric(email)) foundValid = true;
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (e) {
        results.push({ email, status: 'error', sub_status: e.message });
      }
    }

    // Trier : valid en premier, puis catch_all, puis le reste
    const statusOrder = { valid: 0, catch_all: 1, unknown: 2, do_not_mail: 3, spamtrap: 4, invalid: 5, error: 6 };
    results.sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));

    res.json({ patterns: results, total: patterns.length, credits_used: creditsUsed, prenom: p, nom: n, domaine: d });
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
