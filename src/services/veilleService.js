/**
 * veilleService.js — Veille web hôtelière pour Terre de Mars
 *
 * Passe 2 — Correctifs :
 * - freshness Brave adaptée par catégorie source (pd/pw/pm)
 * - Mots-clés resserrés : suppression des termes trop génériques
 * - Scoring inchangé dans sa structure mais filtré plus haut (seuil >= 3 dans scheduler)
 *
 * Types de sources :
 * - brave_search : Recherche via API Brave Search (recommandé)
 * - html : Scraping HTML avec cheerio + sélecteurs CSS
 * - rss : Parse de flux RSS/Atom
 */

const cheerio = require('cheerio');
const logger = require('../config/logger');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Mots-clés par famille (pour scoring intelligent) ───────────────────────
// Passe 2 : retirés les termes trop génériques (lifestyle seul, spa seul, design, concept, développement, stratégie, plan)

const SIGNAUX_PRIORITE_A = [
  // Rénovation lourde / transformation
  'rénovation', 'rénové', 'rénove', 'réhabilitation', 'transformation',
  'repositionnement', 'montée en gamme', 'réouverture', 'rouvre',
  // Nomination de direction
  'nouveau directeur', 'nomination', 'nommé directeur', 'nouveau gm',
  'general manager', 'directeur général',
  // Indépendants / boutique (combinaisons spécifiques, pas de termes seuls)
  'boutique-hôtel', 'boutique hôtel', 'hôtel indépendant',
];

const SIGNAUX_PRIORITE_B = [
  // Ouverture / pré-ouverture
  'ouverture', 'inauguration', 'inaugure', 'pré-ouverture',
  // Conversion / branding
  'conversion', 'rebranding', 'sous enseigne', 'rejoint le groupe',
  'changement d\'enseigne',
  // Acquisition / cession
  'acquisition', 'cession', 'rachat', 'portefeuille hôtelier',
  // Montée en gamme ciblée
  'nouveau spa', 'spa hôtel', 'wellness', 'resort',
  'montée en gamme', 'aparthotel',
  'lifestyle hotel', 'lifestyle hôtel',
];

const SIGNAUX_PRIORITE_C = [
  // Corporate / groupe — uniquement combinés avec hôtelier
  'groupe hôtelier', 'pipeline hôtelier', 'résultats annuels',
];

// Mots-clés géographiques (bonus de score)
const GEO_FRANCE = [
  'paris', 'lyon', 'marseille', 'bordeaux', 'nice', 'côte d\'azur',
  'alpes', 'provence', 'bretagne', 'normandie',
  'ile-de-france', 'île-de-france', 'toulouse', 'nantes', 'strasbourg',
  'montpellier', 'cannes', 'saint-tropez', 'megève', 'courchevel',
  'val d\'isère', 'chamonix', 'biarritz', 'deauville',
];

// Segments haut de gamme (bonus)
const SEGMENTS_PREMIUM = [
  'palace', '5 étoiles', '5*', 'luxe', 'premium', 'haut de gamme',
  'relais & châteaux', 'leading hotels', 'small luxury',
];

// ─── Scoring intelligent (Priorité A / B / C) ──────────────────────────────

function scorerArticle(article) {
  const texte = `${article.titre} ${article.resume}`.toLowerCase();
  const titreLower = article.titre.toLowerCase();
  const trouves = [];
  let score = 0;
  let priorite = 'C';

  // Détection signaux Priorité A (score fort)
  let signalA = false;
  for (const mot of SIGNAUX_PRIORITE_A) {
    const motLower = mot.toLowerCase();
    if (texte.includes(motLower)) {
      trouves.push(mot);
      score += 3;
      if (titreLower.includes(motLower)) score += 2; // Bonus titre
      signalA = true;
    }
  }

  // Détection signaux Priorité B (score moyen)
  let signalB = false;
  for (const mot of SIGNAUX_PRIORITE_B) {
    const motLower = mot.toLowerCase();
    if (texte.includes(motLower)) {
      if (!trouves.includes(mot)) trouves.push(mot);
      score += 2;
      if (titreLower.includes(motLower)) score += 1;
      signalB = true;
    }
  }

  // Détection signaux Priorité C
  for (const mot of SIGNAUX_PRIORITE_C) {
    const motLower = mot.toLowerCase();
    if (texte.includes(motLower)) {
      if (!trouves.includes(mot)) trouves.push(mot);
      score += 1;
    }
  }

  // Bonus géographie France
  for (const geo of GEO_FRANCE) {
    if (texte.includes(geo.toLowerCase())) {
      score += 1;
      if (!trouves.includes(geo)) trouves.push(geo);
      break; // Un seul bonus géo
    }
  }

  // Bonus segment premium
  for (const seg of SEGMENTS_PREMIUM) {
    if (texte.includes(seg.toLowerCase())) {
      score += 1;
      if (!trouves.includes(seg)) trouves.push(seg);
      break;
    }
  }

  // Déterminer la priorité
  if (signalA) {
    priorite = 'A';
  } else if (signalB) {
    priorite = 'B';
  } else {
    priorite = 'C';
  }

  return {
    ...article,
    mots_cles_trouves: trouves,
    score_pertinence: score,
    priorite,
  };
}

function filtrerParMotsCles(articles, motsClesSource) {
  const scored = articles.map(a => scorerArticle(a));

  // Bonus mots-clés spécifiques de la source
  if (motsClesSource) {
    const mots = Array.isArray(motsClesSource) ? motsClesSource : (typeof motsClesSource === 'string' ? JSON.parse(motsClesSource) : []);
    for (const article of scored) {
      const texte = `${article.titre} ${article.resume}`.toLowerCase();
      for (const mot of mots) {
        const motLower = mot.toLowerCase();
        if (texte.includes(motLower) && !article.mots_cles_trouves.includes(mot)) {
          article.mots_cles_trouves.push(mot);
          article.score_pertinence += 1;
        }
      }
    }
  }

  return scored;
}

// ─── Brave Search API ──────────────────────────────────────────────────────

function getBraveApiKey(db) {
  try {
    const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get('brave_search_api_key');
    return row?.valeur || process.env.BRAVE_SEARCH_API_KEY || '';
  } catch (_) {
    return process.env.BRAVE_SEARCH_API_KEY || '';
  }
}

/**
 * Déterminer le paramètre freshness Brave selon la catégorie de la source.
 * - quotidien → pd (past day) : dernières 24h
 * - hebdo → pw (past week) : dernière semaine
 * - radar → pm (past month) : dernier mois
 */
function getFreshness(source) {
  const cat = (source.categorie || '').toLowerCase();
  if (cat === 'quotidien') return 'pd';
  if (cat === 'hebdo') return 'pw';
  return 'pm'; // radar ou défaut
}

async function scraperSourceBrave(source, db) {
  const apiKey = getBraveApiKey(db);
  if (!apiKey) throw new Error('Clé API Brave Search non configurée (Paramètres > brave_search_api_key)');

  const motsCles = typeof source.mots_cles === 'string' ? JSON.parse(source.mots_cles) : (source.mots_cles || []);

  let domain;
  try {
    domain = new URL(source.url).hostname.replace(/^www\./, '');
  } catch (_) {
    domain = source.url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }

  const freshness = getFreshness(source);
  const allArticles = [];
  const seenUrls = new Set();

  // Grouper mots-clés en requêtes de 3
  const groups = [];
  for (let i = 0; i < motsCles.length; i += 3) {
    groups.push(motsCles.slice(i, i + 3));
  }
  if (groups.length === 0) groups.push([source.nom]);

  for (const group of groups) {
    const query = `site:${domain} ${group.join(' OR ')}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const params = new URLSearchParams({
        q: query,
        count: '20',
        search_lang: 'fr',
        country: 'fr',
        freshness,
      });

      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Brave API ${res.status}: ${body.substring(0, 200)}`);
      }

      const data = await res.json();
      const results = data.web?.results || [];

      for (const r of results) {
        if (seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);

        let resume = r.description || '';
        if (resume.includes('<')) {
          const $desc = cheerio.load(resume);
          resume = $desc.text().trim();
        }
        if (resume.length > 500) resume = resume.substring(0, 497) + '...';

        allArticles.push({
          titre: r.title || '',
          url: r.url,
          resume,
          date_article: r.page_age || r.age || '',
        });
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.warn(`Veille: Brave Search timeout pour: ${query}`);
      } else {
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }

    // Rate limiting Brave : 1 req/sec sur plan gratuit
    await new Promise(r => setTimeout(r, 1200));
  }

  return allArticles;
}

// ─── HTML Scraping ─────────────────────────────────────────────────────────

async function scraperSourceHtml(source) {
  const selecteurs = typeof source.selecteurs === 'string' ? JSON.parse(source.selecteurs) : source.selecteurs;
  if (!selecteurs || !selecteurs.article) throw new Error('Sélecteurs CSS manquants pour source HTML');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let html;
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const $ = cheerio.load(html);
  const articles = [];

  const articleSelectors = selecteurs.article.split(',').map(s => s.trim());
  let $articles = $([]);
  for (const sel of articleSelectors) {
    const found = $(sel);
    if (found.length > 0) { $articles = found; break; }
  }
  if ($articles.length === 0) {
    for (const fb of ['article', '.article', '.post', '.news-item', '.views-row']) {
      const found = $(fb);
      if (found.length > 0) { $articles = found; break; }
    }
  }

  $articles.each((_, el) => {
    const $el = $(el);
    let titre = '';
    for (const sel of selecteurs.titre.split(',').map(s => s.trim())) {
      const found = $el.find(sel).first();
      if (found.length) { titre = found.text().trim(); break; }
    }
    if (!titre) titre = $el.find('h2, h3, h4').first().text().trim();
    if (!titre) return;

    let lien = '';
    for (const sel of selecteurs.lien.split(',').map(s => s.trim())) {
      const found = $el.find(sel).first();
      if (found.length) { lien = found.attr('href'); break; }
    }
    if (!lien) lien = $el.find('a').first().attr('href');
    if (!lien) return;

    if (lien.startsWith('/')) {
      const base = new URL(source.url);
      lien = `${base.protocol}//${base.host}${lien}`;
    } else if (!lien.startsWith('http')) {
      const base = new URL(source.url);
      lien = `${base.protocol}//${base.host}/${lien}`;
    }

    let resume = '';
    for (const sel of selecteurs.resume.split(',').map(s => s.trim())) {
      const found = $el.find(sel).first();
      if (found.length) { resume = found.text().trim(); break; }
    }
    if (!resume) resume = $el.find('p').first().text().trim();
    if (resume.length > 500) resume = resume.substring(0, 497) + '...';

    let dateArticle = '';
    for (const sel of selecteurs.date.split(',').map(s => s.trim())) {
      const found = $el.find(sel).first();
      if (found.length) { dateArticle = found.attr('datetime') || found.text().trim(); break; }
    }

    articles.push({ titre, url: lien, resume, date_article: dateArticle });
  });

  return articles;
}

// ─── RSS ───────────────────────────────────────────────────────────────────

async function scraperSourceRss(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let xml;
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/xml, text/xml' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const $ = cheerio.load(xml, { xmlMode: true });
  const articles = [];

  $('item').each((_, el) => {
    const $el = $(el);
    const titre = $el.find('title').text().trim();
    const url = $el.find('link').text().trim();
    if (!titre || !url) return;

    let resume = $el.find('description').text().trim();
    if (resume.includes('<')) {
      const $desc = cheerio.load(resume);
      resume = $desc.text().trim();
    }
    if (resume.length > 500) resume = resume.substring(0, 497) + '...';

    const dateArticle = $el.find('pubDate').text().trim();
    articles.push({ titre, url, resume, date_article: dateArticle });
  });

  return articles;
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

async function scraperSource(source, db) {
  if (source.type === 'brave_search') return scraperSourceBrave(source, db);
  if (source.type === 'rss') return scraperSourceRss(source);
  return scraperSourceHtml(source);
}

// ─── Sauvegarde ────────────────────────────────────────────────────────────

function sauvegarderArticles(db, sourceId, articles) {
  const { randomUUID } = require('crypto');
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO veille_articles (id, source_id, titre, url, resume, date_article, mots_cles_trouves, score_pertinence, priorite, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Mettre à jour last_seen_at pour les doublons URL
  const stmtUpdate = db.prepare(`
    UPDATE veille_articles SET last_seen_at = ? WHERE url = ?
  `);

  let inseres = 0;
  for (const a of articles) {
    const r = stmt.run(
      randomUUID(), sourceId, a.titre, a.url,
      a.resume || '', a.date_article || '',
      JSON.stringify(a.mots_cles_trouves || []),
      a.score_pertinence || 0,
      a.priorite || 'C',
      now, now
    );
    if (r.changes > 0) {
      inseres++;
    } else {
      // Article déjà connu : mettre à jour last_seen_at
      stmtUpdate.run(now, a.url);
    }
  }
  return inseres;
}

module.exports = {
  scraperSource,
  filtrerParMotsCles,
  sauvegarderArticles,
};
