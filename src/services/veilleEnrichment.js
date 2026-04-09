/**
 * veilleEnrichment.js — Enrichissement des articles de veille
 *
 * Pipeline :
 * 1. Fetch contenu complet de l'article
 * 2. Extraction d'entités par heuristiques déterministes (pas de LLM)
 * 3. Détection du signal_type
 * 4. Content hash pour dédup contenu
 *
 * Heuristiques pour extraction :
 * - hotel_name : patterns "Hôtel X", "Le X", "L'X" dans le titre
 * - city : lookup dans une liste de villes françaises
 * - group_name : lookup groupes hôteliers connus
 * - signal_type : mapping depuis les mots-clés détectés
 */

const cheerio = require('cheerio');
const crypto = require('crypto');
const logger = require('../config/logger');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Groupes hôteliers connus ───────────────────────────────────────────────

const GROUPES_HOTELIERS = [
  'Accor', 'Marriott', 'Hilton', 'IHG', 'Hyatt', 'Wyndham', 'Best Western',
  'Radisson', 'Melia', 'NH Hotels', 'Kempinski', 'Four Seasons', 'Mandarin Oriental',
  'Rosewood', 'Aman', 'Belmond', 'Dorchester Collection', 'Oetker Collection',
  'The Leading Hotels', 'Relais & Châteaux', 'Small Luxury Hotels',
  'Louvre Hotels', 'B&B Hotels', 'Logis', 'Châteaux & Hôtels Collection',
  'Evok Hotels', 'Sonder', 'Edgar Suites', 'Elegancia', 'Esprit de France',
  'Paris Inn Group', 'Groupe Barrière', 'Lucien Barrière',
  'Club Med', 'Pierre & Vacances', 'Center Parcs', 'Maranatha',
  'Financière Immobilière Bordelaise', 'FIB', 'Covivio', 'Primonial',
  'Valotel', 'Extendam', 'Catella', 'Keys REIM',
  'Minor Hotels', 'Anantara', 'Avani', 'NH Collection', 'Tivoli',
  'Banyan Tree', 'COMO Hotels', 'Ennismore', 'SBE', 'Mama Shelter',
  'citizenM', 'Motel One', 'Ruby Hotels', 'Generator', '25hours',
  'Soho House', 'The Hoxton', 'Hôtels Particuliers', 'MGallery',
];

// Normalisations pour matching
const GROUPES_NORM = GROUPES_HOTELIERS.map(g => ({
  original: g,
  lower: g.toLowerCase(),
  normalized: normalizeText(g),
}));

// ─── Villes françaises principales ──────────────────────────────────────────

const VILLES_FRANCE = [
  'Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Nice', 'Toulouse', 'Nantes',
  'Strasbourg', 'Montpellier', 'Lille', 'Rennes', 'Reims', 'Toulon',
  'Grenoble', 'Dijon', 'Angers', 'Nîmes', 'Aix-en-Provence', 'Perpignan',
  'Cannes', 'Saint-Tropez', 'Antibes', 'Monaco', 'Biarritz', 'Deauville',
  'La Rochelle', 'Avignon', 'Arles', 'Chamonix', 'Megève', 'Courchevel',
  'Méribel', 'Val d\'Isère', 'Morzine', 'Annecy', 'Aix-les-Bains',
  'Brest', 'Saint-Malo', 'Dinard', 'Quiberon', 'La Baule', 'Les Sables-d\'Olonne',
  'Ajaccio', 'Bastia', 'Bonifacio', 'Porto-Vecchio', 'Calvi',
  'Versailles', 'Fontainebleau', 'Chantilly',
  'Honfleur', 'Étretat', 'Cabourg', 'Trouville',
  'Saint-Jean-de-Luz', 'Hossegor', 'Arcachon', 'Cap Ferret',
  'Gordes', 'Luberon', 'Saint-Rémy-de-Provence', 'Les Baux-de-Provence',
  'Uzès', 'Carcassonne', 'Collioure',
];

const VILLES_NORM = VILLES_FRANCE.map(v => ({
  original: v,
  lower: v.toLowerCase(),
}));

// ─── Régions ────────────────────────────────────────────────────────────────

const VILLE_REGION = {
  'paris': 'Île-de-France', 'versailles': 'Île-de-France', 'fontainebleau': 'Île-de-France', 'chantilly': 'Île-de-France',
  'lyon': 'Auvergne-Rhône-Alpes', 'grenoble': 'Auvergne-Rhône-Alpes', 'annecy': 'Auvergne-Rhône-Alpes', 'chamonix': 'Auvergne-Rhône-Alpes',
  'megève': 'Auvergne-Rhône-Alpes', 'courchevel': 'Auvergne-Rhône-Alpes', 'méribel': 'Auvergne-Rhône-Alpes', 'val d\'isère': 'Auvergne-Rhône-Alpes',
  'morzine': 'Auvergne-Rhône-Alpes', 'aix-les-bains': 'Auvergne-Rhône-Alpes',
  'marseille': 'Provence-Alpes-Côte d\'Azur', 'nice': 'Provence-Alpes-Côte d\'Azur', 'cannes': 'Provence-Alpes-Côte d\'Azur',
  'saint-tropez': 'Provence-Alpes-Côte d\'Azur', 'antibes': 'Provence-Alpes-Côte d\'Azur', 'monaco': 'Provence-Alpes-Côte d\'Azur',
  'aix-en-provence': 'Provence-Alpes-Côte d\'Azur', 'avignon': 'Provence-Alpes-Côte d\'Azur', 'arles': 'Provence-Alpes-Côte d\'Azur',
  'toulon': 'Provence-Alpes-Côte d\'Azur', 'gordes': 'Provence-Alpes-Côte d\'Azur',
  'bordeaux': 'Nouvelle-Aquitaine', 'biarritz': 'Nouvelle-Aquitaine', 'la rochelle': 'Nouvelle-Aquitaine',
  'arcachon': 'Nouvelle-Aquitaine', 'cap ferret': 'Nouvelle-Aquitaine', 'hossegor': 'Nouvelle-Aquitaine',
  'saint-jean-de-luz': 'Nouvelle-Aquitaine',
  'toulouse': 'Occitanie', 'montpellier': 'Occitanie', 'nîmes': 'Occitanie', 'perpignan': 'Occitanie',
  'carcassonne': 'Occitanie', 'collioure': 'Occitanie', 'uzès': 'Occitanie',
  'nantes': 'Pays de la Loire', 'angers': 'Pays de la Loire', 'la baule': 'Pays de la Loire',
  'rennes': 'Bretagne', 'saint-malo': 'Bretagne', 'dinard': 'Bretagne', 'brest': 'Bretagne', 'quiberon': 'Bretagne',
  'strasbourg': 'Grand Est', 'reims': 'Grand Est', 'dijon': 'Bourgogne-Franche-Comté',
  'lille': 'Hauts-de-France',
  'deauville': 'Normandie', 'honfleur': 'Normandie', 'étretat': 'Normandie', 'cabourg': 'Normandie', 'trouville': 'Normandie',
  'ajaccio': 'Corse', 'bastia': 'Corse', 'bonifacio': 'Corse', 'porto-vecchio': 'Corse', 'calvi': 'Corse',
};

// ─── Types de signaux ───────────────────────────────────────────────────────

const SIGNAL_PATTERNS = [
  { type: 'renovation', subtype: 'lourde', patterns: ['rénovation', 'rénové', 'rénove', 'réhabilitation', 'travaux'] },
  { type: 'renovation', subtype: 'repositionnement', patterns: ['repositionnement', 'montée en gamme', 'transformation'] },
  { type: 'ouverture', subtype: 'reouverture', patterns: ['réouverture', 'rouvre', 'réouvre'] },
  { type: 'ouverture', subtype: 'pre_ouverture', patterns: ['pré-ouverture'] },
  { type: 'ouverture', subtype: 'inauguration', patterns: ['ouverture', 'inauguration', 'inaugure', 'ouvre ses portes'] },
  { type: 'nomination', subtype: 'direction', patterns: ['nouveau directeur', 'nomination', 'nommé directeur', 'nouveau gm', 'general manager', 'directeur général'] },
  { type: 'acquisition', subtype: 'cession', patterns: ['cession', 'rachat', 'acquisition'] },
  { type: 'acquisition', subtype: 'portefeuille', patterns: ['portefeuille hôtelier'] },
  { type: 'conversion', subtype: 'enseigne', patterns: ['conversion', 'rebranding', 'sous enseigne', 'changement d\'enseigne', 'rejoint le groupe'] },
  { type: 'spa_wellness', subtype: 'spa', patterns: ['nouveau spa', 'spa hôtel', 'wellness', 'bien-être'] },
];

// ─── Patterns hôtel dans le titre ───────────────────────────────────────────

const HOTEL_PATTERNS = [
  // "Hôtel Le Grand Paris" / "L'Hôtel de la Paix" / "Le Four Seasons George V"
  /(?:l[''']?|le |la |les )?(?:hôtel|hotel|palace|château|maison|domaine|villa|lodge|resort|relais|auberge|manoir)\s+(?:de |du |des |d[''']|le |la |l['''])?([A-ZÀ-Ü][a-zà-ü-]+(?:\s+[A-ZÀ-Ü&][a-zà-ü-]*)*)/gi,
  // "Four Seasons George V" / "Ritz Paris" / "Mandarin Oriental Paris"
  /(?:Four Seasons|Ritz|Mandarin Oriental|Rosewood|Aman|Belmond|Park Hyatt|Grand Hyatt|Waldorf Astoria|W |St\. Regis|Sofitel|Pullman|Novotel|MGallery)\s+([A-ZÀ-Ü][a-zà-ü-]+(?:\s+[A-ZÀ-Ü][a-zà-ü-]*)*)/g,
];

// ─── Utilitaires ────────────────────────────────────────────────────────────

function normalizeText(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentHash(text) {
  return crypto.createHash('sha256').update(normalizeText(text).substring(0, 2000)).digest('hex').substring(0, 16);
}

// ─── Fetch contenu complet ──────────────────────────────────────────────────

async function fetchFullContent(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!res.ok) {
      return { ok: false, status: res.status };
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Supprimer navigation, footer, sidebar, scripts
    $('nav, footer, aside, script, style, noscript, iframe, .sidebar, .menu, .nav, .footer, .header, .cookie, .ad, .pub').remove();

    // Essayer de trouver le contenu principal
    let content = '';
    for (const sel of ['article', '.article-content', '.post-content', '.entry-content', '.article-body', 'main', '[role="main"]', '.content']) {
      const found = $(sel);
      if (found.length && found.text().trim().length > 200) {
        content = found.text().trim();
        break;
      }
    }

    // Fallback : tout le body
    if (!content || content.length < 200) {
      content = $('body').text().trim();
    }

    // Nettoyer les espaces multiples
    content = content.replace(/\s+/g, ' ').trim();

    // Limiter à 5000 chars
    if (content.length > 5000) content = content.substring(0, 5000);

    return { ok: true, content, status: res.status };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, status: 0, error: 'timeout' };
    }
    return { ok: false, status: 0, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Extraction d'entités ───────────────────────────────────────────────────

function extractHotelName(titre, content) {
  const fullText = `${titre} ${(content || '').substring(0, 1000)}`;

  for (const pattern of HOTEL_PATTERNS) {
    const matches = [...fullText.matchAll(pattern)];
    if (matches.length > 0) {
      // Prendre le premier match, nettoyer
      let name = matches[0][0].trim();
      // Retirer les articles de début
      name = name.replace(/^(?:l[''']|le |la |les )/i, '').trim();
      if (name.length > 3 && name.length < 80) {
        return name;
      }
    }
  }

  // Fallback : chercher "Hôtel" + nom propre dans le titre
  const titleMatch = titre.match(/(?:hôtel|hotel|palace)\s+(.{3,40}?)(?:\s*[-–:,]|\s+(?:à|de|du|rénov|ouvre|inaug|accueill))/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  return null;
}

function extractCity(titre, content) {
  const fullText = `${titre} ${(content || '').substring(0, 2000)}`.toLowerCase();

  // Chercher d'abord dans le titre (plus fiable)
  const titreLower = titre.toLowerCase();
  for (const v of VILLES_NORM) {
    if (titreLower.includes(v.lower)) {
      return v.original;
    }
  }

  // Puis dans le contenu (première occurrence)
  for (const v of VILLES_NORM) {
    if (fullText.includes(v.lower)) {
      return v.original;
    }
  }

  return null;
}

function extractRegion(city) {
  if (!city) return null;
  return VILLE_REGION[city.toLowerCase()] || null;
}

function extractGroupName(titre, content) {
  const fullText = `${titre} ${(content || '').substring(0, 2000)}`.toLowerCase();

  for (const g of GROUPES_NORM) {
    if (fullText.includes(g.lower)) {
      return g.original;
    }
  }

  return null;
}

function detectSignalType(titre, content) {
  const fullText = `${titre} ${(content || '').substring(0, 2000)}`.toLowerCase();
  const titreLower = titre.toLowerCase();

  // Priorité aux signaux dans le titre
  for (const sp of SIGNAL_PATTERNS) {
    for (const p of sp.patterns) {
      if (titreLower.includes(p.toLowerCase())) {
        return { type: sp.type, subtype: sp.subtype };
      }
    }
  }

  // Puis dans le contenu
  for (const sp of SIGNAL_PATTERNS) {
    for (const p of sp.patterns) {
      if (fullText.includes(p.toLowerCase())) {
        return { type: sp.type, subtype: sp.subtype };
      }
    }
  }

  return { type: 'autre', subtype: null };
}

// ─── Extraction de date projet ──────────────────────────────────────────────

function extractProjectDate(titre, content) {
  const fullText = `${titre} ${(content || '').substring(0, 2000)}`;

  // Patterns : "ouverture 2026", "réouverture prévue en mars 2026", "fin des travaux 2027"
  const patterns = [
    /(?:ouverture|réouverture|inauguration|fin des travaux|livraison|achèvement)[\s\w]*?(\d{4})/i,
    /(?:prévue?|attendue?|planifiée?)[\s\w]*?(?:en\s+)?(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)?\s*(\d{4})/i,
    /(?:printemps|été|automne|hiver)\s+(\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      const year = parseInt(match[1]);
      if (year >= 2024 && year <= 2030) {
        return match[1];
      }
    }
  }

  return null;
}

// ─── Pipeline d'enrichissement d'un article ─────────────────────────────────

async function enrichArticle(db, article) {
  const result = {
    content_full: null,
    content_hash: null,
    hotel_name: null,
    city: null,
    group_name: null,
    signal_type: null,
    signal_subtype: null,
    project_date: null,
    region: null,
  };

  // 1. Fetch contenu complet
  const fetched = await fetchFullContent(article.url);
  if (fetched.ok && fetched.content) {
    result.content_full = fetched.content;
    result.content_hash = contentHash(fetched.content);
  }

  const content = result.content_full || article.resume || '';

  // 2. Extraction entités
  result.hotel_name = extractHotelName(article.titre, content);
  result.city = extractCity(article.titre, content);
  result.region = extractRegion(result.city);
  result.group_name = extractGroupName(article.titre, content);

  // 3. Signal type
  const signal = detectSignalType(article.titre, content);
  result.signal_type = signal.type;
  result.signal_subtype = signal.subtype;

  // 4. Date projet
  result.project_date = extractProjectDate(article.titre, content);

  // 5. Sauvegarder enrichissement
  try {
    db.prepare(`
      UPDATE veille_articles
      SET content_full = ?, content_hash = ?, enriched = 1,
          hotel_name = ?, city = ?, group_name = ?, signal_type = ?
      WHERE id = ?
    `).run(
      result.content_full, result.content_hash,
      result.hotel_name, result.city, result.group_name, result.signal_type,
      article.id
    );
  } catch (e) {
    logger.warn(`Veille enrichment: erreur sauvegarde article ${article.id} — ${e.message}`);
  }

  return result;
}

// ─── Enrichissement batch ───────────────────────────────────────────────────

async function enrichBatch(db, limit = 10) {
  // Articles non enrichis avec score >= 3 (pertinents)
  const articles = db.prepare(`
    SELECT id, titre, url, resume, score_pertinence, priorite, source_id
    FROM veille_articles
    WHERE enriched = 0 AND score_pertinence >= 3
    ORDER BY score_pertinence DESC, created_at DESC
    LIMIT ?
  `).all(limit);

  if (articles.length === 0) return { enriched: 0 };

  logger.info(`Veille enrichment: ${articles.length} article(s) à enrichir`);
  let enriched = 0;

  for (const article of articles) {
    try {
      await enrichArticle(db, article);
      enriched++;
      // Politesse : attendre entre les fetch
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      logger.warn(`Veille enrichment: erreur article ${article.id} — ${err.message}`);
      // Marquer comme enrichi pour ne pas reboucler
      try {
        db.prepare('UPDATE veille_articles SET enriched = 1 WHERE id = ?').run(article.id);
      } catch (_) {}
    }
  }

  logger.info(`Veille enrichment: ${enriched}/${articles.length} enrichi(s)`);
  return { enriched, total: articles.length };
}

module.exports = {
  enrichArticle,
  enrichBatch,
  fetchFullContent,
  extractHotelName,
  extractCity,
  extractRegion,
  extractGroupName,
  detectSignalType,
  extractProjectDate,
  normalizeText,
  contentHash,
};
