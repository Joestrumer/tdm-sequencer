/**
 * veilleService.js — Scraping et filtrage d'articles hôteliers
 *
 * Types de sources supportés :
 * - brave_search : Recherche via API Brave Search (recommandé, contourne Cloudflare)
 * - html : Scraping HTML avec cheerio + sélecteurs CSS
 * - rss : Parse de flux RSS/Atom
 */

const cheerio = require('cheerio');
const logger = require('../config/logger');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MOTS_CLES_DEFAUT = [
  'rénovation', 'ouverture', 'nouveau', 'inauguration', 'repositionnement',
  'transformation', 'chantier', 'travaux', 'réhabilitation', 'palace',
  'boutique hotel', 'resort', 'spa', '5 étoiles', 'luxe', 'hôtel',
  'inaugure', 'ouvre', 'rénove', 'projet', 'construction'
];

// ─── Brave Search API ──────────────────────────────────────────────────────

/**
 * Récupérer la clé Brave depuis la config DB
 */
function getBraveApiKey(db) {
  try {
    const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get('brave_search_api_key');
    return row?.valeur || process.env.BRAVE_SEARCH_API_KEY || '';
  } catch (_) {
    return process.env.BRAVE_SEARCH_API_KEY || '';
  }
}

/**
 * Rechercher via Brave Search API
 * La source.url contient le domaine à cibler (ex: hospitality-on.com)
 * Les mots-clés sont utilisés pour construire la requête
 */
async function scraperSourceBrave(source, db) {
  const apiKey = getBraveApiKey(db);
  if (!apiKey) throw new Error('Clé API Brave Search non configurée (Paramètres > brave_search_api_key)');

  const motsCles = typeof source.mots_cles === 'string' ? JSON.parse(source.mots_cles) : (source.mots_cles || []);

  // Extraire le domaine de l'URL source
  let domain;
  try {
    domain = new URL(source.url).hostname.replace(/^www\./, '');
  } catch (_) {
    domain = source.url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }

  // Construire les requêtes : une par groupe de mots-clés pour plus de couverture
  const allArticles = [];
  const seenUrls = new Set();

  // Grouper les mots-clés en requêtes de 3-4 mots max pour des résultats variés
  const groups = [];
  for (let i = 0; i < motsCles.length; i += 3) {
    groups.push(motsCles.slice(i, i + 3));
  }
  // Si aucun mot-clé, une seule requête avec le nom de la source
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
        freshness: 'pm',  // dernier mois
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

        // Nettoyer le HTML des descriptions Brave
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
        logger.warn(`🔍 Brave Search timeout pour: ${query}`);
      } else {
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }

    // Pause entre les requêtes (rate limiting Brave : 1 req/sec sur plan gratuit)
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
    const fallbacks = ['article', '.article', '.post', '.news-item', '.views-row', '[class*="article"]', '[class*="news"]'];
    for (const fb of fallbacks) {
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

// ─── Filtrage et scoring ───────────────────────────────────────────────────

function filtrerParMotsCles(articles, motsCles) {
  const mots = Array.isArray(motsCles) ? motsCles : (typeof motsCles === 'string' ? JSON.parse(motsCles) : MOTS_CLES_DEFAUT);
  if (!mots || mots.length === 0) return articles.map(a => ({ ...a, mots_cles_trouves: [], score_pertinence: 1 }));

  return articles.map(article => {
    const texte = `${article.titre} ${article.resume}`.toLowerCase();
    const trouves = [];

    for (const mot of mots) {
      const motLower = mot.toLowerCase();
      const regex = new RegExp(motLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      if (texte.match(regex)) trouves.push(mot);
    }

    let score = trouves.length;
    const titreLower = article.titre.toLowerCase();
    for (const mot of trouves) {
      if (titreLower.includes(mot.toLowerCase())) score += 1;
    }

    return { ...article, mots_cles_trouves: trouves, score_pertinence: score };
  });
}

// ─── Sauvegarde ────────────────────────────────────────────────────────────

function sauvegarderArticles(db, sourceId, articles) {
  const { randomUUID } = require('crypto');
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO veille_articles (id, source_id, titre, url, resume, date_article, mots_cles_trouves, score_pertinence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inseres = 0;
  for (const a of articles) {
    const r = stmt.run(
      randomUUID(), sourceId, a.titre, a.url,
      a.resume || '', a.date_article || '',
      JSON.stringify(a.mots_cles_trouves || []),
      a.score_pertinence || 0
    );
    if (r.changes > 0) inseres++;
  }
  return inseres;
}

module.exports = {
  scraperSource,
  filtrerParMotsCles,
  sauvegarderArticles,
  MOTS_CLES_DEFAUT,
};
