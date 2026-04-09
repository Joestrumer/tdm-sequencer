/**
 * veilleService.js — Scraping et filtrage d'articles hôteliers
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

/**
 * Scraper une source HTML
 */
async function scraperSourceHtml(source) {
  const selecteurs = typeof source.selecteurs === 'string' ? JSON.parse(source.selecteurs) : source.selecteurs;

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

  // Essayer chaque sélecteur d'article
  const articleSelectors = selecteurs.article.split(',').map(s => s.trim());
  let $articles = $([]);

  for (const sel of articleSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      $articles = found;
      break;
    }
  }

  // Fallback : chercher des patterns courants
  if ($articles.length === 0) {
    const fallbacks = ['article', '.article', '.post', '.news-item', '.views-row', '[class*="article"]', '[class*="news"]'];
    for (const fb of fallbacks) {
      const found = $(fb);
      if (found.length > 0) {
        $articles = found;
        break;
      }
    }
  }

  $articles.each((_, el) => {
    const $el = $(el);

    // Titre
    let titre = '';
    const titreSelectors = selecteurs.titre.split(',').map(s => s.trim());
    for (const sel of titreSelectors) {
      const found = $el.find(sel).first();
      if (found.length) { titre = found.text().trim(); break; }
    }
    if (!titre) titre = $el.find('h2, h3, h4').first().text().trim();
    if (!titre) return; // Skip articles sans titre

    // Lien
    let lien = '';
    const lienSelectors = selecteurs.lien.split(',').map(s => s.trim());
    for (const sel of lienSelectors) {
      const found = $el.find(sel).first();
      if (found.length) { lien = found.attr('href'); break; }
    }
    if (!lien) lien = $el.find('a').first().attr('href');
    if (!lien) return;

    // Résoudre URL relative
    if (lien.startsWith('/')) {
      const base = new URL(source.url);
      lien = `${base.protocol}//${base.host}${lien}`;
    } else if (!lien.startsWith('http')) {
      const base = new URL(source.url);
      lien = `${base.protocol}//${base.host}/${lien}`;
    }

    // Résumé
    let resume = '';
    const resumeSelectors = selecteurs.resume.split(',').map(s => s.trim());
    for (const sel of resumeSelectors) {
      const found = $el.find(sel).first();
      if (found.length) { resume = found.text().trim(); break; }
    }
    if (!resume) resume = $el.find('p').first().text().trim();
    if (resume.length > 500) resume = resume.substring(0, 497) + '...';

    // Date
    let dateArticle = '';
    const dateSelectors = selecteurs.date.split(',').map(s => s.trim());
    for (const sel of dateSelectors) {
      const found = $el.find(sel).first();
      if (found.length) {
        dateArticle = found.attr('datetime') || found.text().trim();
        break;
      }
    }

    articles.push({ titre, url: lien, resume, date_article: dateArticle });
  });

  return articles;
}

/**
 * Scraper une source RSS
 */
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
    // Nettoyer le HTML du résumé RSS
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

/**
 * Scraper une source (dispatch HTML ou RSS)
 */
async function scraperSource(source) {
  if (source.type === 'rss') {
    return scraperSourceRss(source);
  }
  return scraperSourceHtml(source);
}

/**
 * Filtrer et scorer les articles par mots-clés
 */
function filtrerParMotsCles(articles, motsCles) {
  const mots = Array.isArray(motsCles) ? motsCles : (typeof motsCles === 'string' ? JSON.parse(motsCles) : MOTS_CLES_DEFAUT);
  if (!mots || mots.length === 0) return articles.map(a => ({ ...a, mots_cles_trouves: [], score_pertinence: 1 }));

  return articles.map(article => {
    const texte = `${article.titre} ${article.resume}`.toLowerCase();
    const trouves = [];

    for (const mot of mots) {
      const motLower = mot.toLowerCase();
      // Compter les occurrences
      const regex = new RegExp(motLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = texte.match(regex);
      if (matches) {
        trouves.push(mot);
      }
    }

    // Score : nombre de mots-clés distincts trouvés, bonus si dans le titre
    let score = trouves.length;
    const titreLower = article.titre.toLowerCase();
    for (const mot of trouves) {
      if (titreLower.includes(mot.toLowerCase())) score += 1; // Bonus titre
    }

    return {
      ...article,
      mots_cles_trouves: trouves,
      score_pertinence: score,
    };
  });
}

/**
 * Sauvegarder les articles en base (déduplique par URL)
 */
function sauvegarderArticles(db, sourceId, articles) {
  const { randomUUID } = require('crypto');
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO veille_articles (id, source_id, titre, url, resume, date_article, mots_cles_trouves, score_pertinence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inseres = 0;
  for (const a of articles) {
    const r = stmt.run(
      randomUUID(),
      sourceId,
      a.titre,
      a.url,
      a.resume || '',
      a.date_article || '',
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
