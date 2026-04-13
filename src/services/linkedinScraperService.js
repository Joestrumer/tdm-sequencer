/**
 * linkedinScraperService.js — Recherche de contacts via Google + LinkedIn
 */

const cheerio = require('cheerio');
const logger = require('../config/logger');

/**
 * Titres de postes à rechercher (ordre de priorité)
 */
const POSTES_CIBLES = [
  'Directeur',
  'Directrice',
  'Directeur Général',
  'Directrice Générale',
  'DG',
  'Directeur adjoint',
  'Directrice adjointe',
  'Directeur des opérations',
  'Directrice des opérations',
  'Directeur marketing',
  'Directrice marketing',
  'Directeur RSE',
  'Directrice RSE',
  'Gouvernante générale',
  'Revenue Manager',
  'Responsable',
  'Manager',
  'Gérant',
  'Gérante',
];

/**
 * Nettoie et normalise un nom
 */
function normaliserNom(nom) {
  return nom
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(M\.|Mme|Mr|Mrs|Monsieur|Madame)\s+/i, '')
    .trim();
}

/**
 * Extrait le prénom et nom d'un nom complet
 */
function extraireNomPrenom(nomComplet) {
  const parts = normaliserNom(nomComplet).split(' ');
  if (parts.length === 1) {
    return { prenom: parts[0], nom: '' };
  }
  if (parts.length === 2) {
    return { prenom: parts[0], nom: parts[1] };
  }
  // 3+ parties : premier = prénom, reste = nom
  return { prenom: parts[0], nom: parts.slice(1).join(' ') };
}

/**
 * Recherche via Brave Search API (gratuite, 2000 requêtes/mois)
 */
async function rechercherContactsBrave(nomHotel, fonction = 'Directeur', apiKey) {
  const nomNormalise = nomHotel.replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  const query = `${nomNormalise} ${fonction} site:linkedin.com/in/`;

  logger.info(`🔍 Recherche Brave API: "${query}"`);

  try {
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Brave API HTTP ${response.status}`);
    }

    const data = await response.json();
    const contacts = [];

    if (data.web && data.web.results) {
      for (const result of data.web.results) {
        const titre = result.title || '';
        const description = result.description || '';
        const url = result.url || '';

        if (!url.includes('linkedin.com/in/')) continue;

        const texte = titre + ' ' + description;

        // Extraction du nom (même logique que Google)
        const patterns = [
          /([A-ZÀ-Ú][a-zà-ú]+(?:[-\s][A-ZÀ-Ú][a-zà-ú]+){1,3})\s*[-–—|]/,
          /^([A-ZÀ-Ú][a-zà-ú]+(?:[-\s][A-ZÀ-Ú][a-zà-ú]+){1,3})/,
        ];

        let nomExtrait = null;
        for (const pattern of patterns) {
          const match = texte.match(pattern);
          if (match && match[1]) {
            nomExtrait = match[1];
            break;
          }
        }

        // Extraction depuis URL si nécessaire
        if (!nomExtrait) {
          const urlMatch = url.match(/linkedin\.com\/in\/([^/]+)/);
          if (urlMatch && urlMatch[1]) {
            const slug = urlMatch[1].replace(/-\w{8,}$/, '');
            const parts = slug.split('-').filter(p => p.length > 1);
            if (parts.length >= 2) {
              nomExtrait = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
            }
          }
        }

        if (!nomExtrait) continue;

        // Détecter la fonction
        let fonctionDetectee = fonction;
        for (const poste of POSTES_CIBLES) {
          if (texte.toLowerCase().includes(poste.toLowerCase())) {
            fonctionDetectee = poste;
            break;
          }
        }

        const hotelMentioned = texte.toLowerCase().includes(nomHotel.toLowerCase().substring(0, 15));

        contacts.push({
          nom_complet: normaliserNom(nomExtrait),
          fonction: fonctionDetectee,
          linkedin_url: url,
          snippet: description.substring(0, 200),
          pertinence: hotelMentioned ? 'haute' : 'moyenne',
        });
      }
    }

    logger.info(`✅ ${contacts.length} contact(s) trouvé(s) via Brave API`);
    return contacts;

  } catch (err) {
    logger.error(`❌ Erreur Brave API: ${err.message}`);
    throw err;
  }
}

/**
 * Recherche Google pour trouver des contacts LinkedIn (fallback)
 */
async function rechercherContactsGoogle(nomHotel, fonction = 'Directeur') {
  // Enlever les guillemets pour être moins strict, normaliser les apostrophes
  const nomNormalise = nomHotel.replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  const query = `${nomNormalise} ${fonction} linkedin`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20`;

  logger.info(`🔍 Recherche Google: "${query}"`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com/',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      logger.error(`❌ Google HTTP ${response.status}: ${response.statusText}`);
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }

    const html = await response.text();

    // Vérifier si Google nous bloque avec un CAPTCHA
    if (html.includes('captcha') || html.includes('unusual traffic')) {
      logger.error('🚫 Google détecte un bot (CAPTCHA requis)');
      throw new Error('Google CAPTCHA - utilisez une API de recherche à la place');
    }

    // Log début du HTML pour debug
    logger.debug(`HTML reçu (premiers 500 chars): ${html.substring(0, 500)}`);

    const $ = cheerio.load(html);

    const contacts = [];

    // Parser tous les liens LinkedIn dans la page
    const linkedinUrls = new Set();
    $('a[href*="linkedin.com/in/"]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href && href.includes('linkedin.com/in/')) {
        // Nettoyer l'URL (enlever les paramètres Google)
        const cleanUrl = href.split('&')[0].replace('/url?q=', '');
        if (cleanUrl.startsWith('http')) {
          linkedinUrls.add(cleanUrl);
        }
      }
    });

    logger.info(`🔗 ${linkedinUrls.size} profils LinkedIn trouvés`);

    // Parser les résultats de recherche Google (plusieurs sélecteurs possibles)
    const resultSelectors = [
      'div.g',
      'div[data-sokoban-container]',
      'div.Gx5Zad',
      'div[jscontroller]',
      '.MjjYud',
    ];

    for (const selector of resultSelectors) {
      $(selector).each((i, elem) => {
        const $elem = $(elem);

        // Trouver le titre
        const titre = $elem.find('h3, h2, [role="heading"]').first().text();

        // Trouver le snippet/description
        const snippet = $elem.find('.VwiC3b, .yXK7lf, [data-sncf], .MjjYud, .IsZvec, .aCOpRe, span').filter(function() {
          const text = $(this).text();
          return text.length > 20 && text.length < 500;
        }).first().text();

        // Trouver le lien
        let lien = $elem.find('a[href*="linkedin.com/in/"]').first().attr('href');

        if (!lien) {
          // Chercher dans tous les liens de l'élément
          $elem.find('a').each((j, link) => {
            const href = $(link).attr('href');
            if (href && href.includes('linkedin.com/in/')) {
              lien = href;
              return false; // break
            }
          });
        }

        // Vérifier que c'est un profil LinkedIn
        if (!lien || !lien.includes('linkedin.com/in/')) {
          return;
        }

        // Nettoyer l'URL Google
        if (lien.startsWith('/url?q=')) {
          lien = decodeURIComponent(lien.replace('/url?q=', '').split('&')[0]);
        }

      // Extraire le nom du titre ou snippet
      const texte = titre + ' ' + snippet;

      // Patterns pour extraire le nom (plus permissifs)
      const patterns = [
        // "Prénom NOM - Fonction"
        /([A-ZÀ-Ú][a-zà-ú]+(?:[-\s][A-ZÀ-Ú][a-zà-ú]+){1,3})\s*[-–—]\s*(?:Directeur|Directrice|DG|Manager|Responsable|Gérant|Adjoint|Revenue)/i,
        // "Prénom NOM | LinkedIn"
        /([A-ZÀ-Ú][a-zà-ú]+(?:[-\s][A-ZÀ-Ú][a-zà-ú]+){1,3})\s*[|•·]\s*(?:LinkedIn|Profil)/i,
        // Début du titre (souvent le nom)
        /^([A-ZÀ-Ú][a-zà-ú]+(?:[-\s][A-ZÀ-Ú][a-zà-ú]+){1,3})/,
        // "Prénom NOM," (avec virgule)
        /([A-ZÀ-Ú][a-zà-ú]+(?:[-\s][A-ZÀ-Ú][a-zà-ú]+){1,3}),/,
        // Dans le snippet
        /(?:M\.|Mme)\s+([A-ZÀ-Ú][a-zà-ú]+(?:[-\s][A-ZÀ-Ú][a-zà-ú]+){1,3})/,
      ];

      let nomExtrait = null;
      for (const pattern of patterns) {
        const match = texte.match(pattern);
        if (match && match[1]) {
          nomExtrait = match[1];
          break;
        }
      }

      // Si pas de nom extrait, essayer d'extraire depuis l'URL LinkedIn
      if (!nomExtrait && lien) {
        const urlMatch = lien.match(/linkedin\.com\/in\/([^/]+)/);
        if (urlMatch && urlMatch[1]) {
          // Convertir l'URL slug en nom (ex: "franck-farneti-1ab5731a" → "Franck Farneti")
          const slug = urlMatch[1].replace(/-\w{8,}$/, ''); // Enlever l'ID à la fin
          const parts = slug.split('-').filter(p => p.length > 1);
          if (parts.length >= 2) {
            nomExtrait = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
            logger.info(`📝 Nom extrait de l'URL: ${nomExtrait}`);
          }
        }
      }

      if (!nomExtrait) {
        logger.warn(`⚠️ Impossible d'extraire le nom de: "${titre}"`);
        return;
      }

      // Détecter la fonction
      let fonctionDetectee = fonction;
      for (const poste of POSTES_CIBLES) {
        if (texte.toLowerCase().includes(poste.toLowerCase())) {
          fonctionDetectee = poste;
          break;
        }
      }

      // Vérifier que le nom de l'hôtel apparaît dans le contexte
      const hotelMentioned = texte.toLowerCase().includes(nomHotel.toLowerCase().substring(0, 15));

      contacts.push({
        nom_complet: normaliserNom(nomExtrait),
        fonction: fonctionDetectee,
        linkedin_url: lien,
        snippet: snippet.substring(0, 200),
        pertinence: hotelMentioned ? 'haute' : 'moyenne',
      });
    });
    } // Fin boucle sélecteurs

    // Dédupliquer par URL LinkedIn
    const seen = new Set();
    const unique = [];
    for (const contact of contacts) {
      if (!seen.has(contact.linkedin_url)) {
        seen.add(contact.linkedin_url);
        unique.push(contact);
      }
    }

    logger.info(`✅ ${unique.length} contact(s) unique(s) après parsing`);

    // Trier par pertinence (haute en premier)
    unique.sort((a, b) => {
      if (a.pertinence === 'haute' && b.pertinence !== 'haute') return -1;
      if (a.pertinence !== 'haute' && b.pertinence === 'haute') return 1;
      return 0;
    });

    return unique;

  } catch (err) {
    if (err.name === 'AbortError') {
      logger.error('⏱️ Timeout recherche Google (15s)');
      throw new Error('Timeout recherche Google (15s)');
    }
    logger.error(`❌ Erreur fetch Google: ${err.message}`, { stack: err.stack?.substring(0, 200) });
    throw err;
  }
}

/**
 * Recherche complète pour un hôtel : essaie plusieurs fonctions
 */
async function rechercherContactsHotel(nomHotel, braveApiKey = null) {
  const fonctionsPrioritaires = ['Directeur', 'Directeur Général Adjoint', 'DG', 'Revenue Manager'];

  const tousContacts = [];

  // Choisir la méthode de recherche
  const useBrave = !!braveApiKey;
  const searchMethod = useBrave ? 'Brave API' : 'Google scraping';
  logger.info(`📡 Méthode de recherche: ${searchMethod}`);

  for (const fonction of fonctionsPrioritaires) {
    try {
      logger.info(`🔎 Essai: ${nomHotel} + ${fonction}`);

      const contacts = useBrave
        ? await rechercherContactsBrave(nomHotel, fonction, braveApiKey)
        : await rechercherContactsGoogle(nomHotel, fonction);

      tousContacts.push(...contacts);

      // Si on a trouvé au moins 1 contact, on arrête (pour économiser les crédits ZB)
      if (contacts.length >= 1) {
        logger.info(`✅ ${contacts.length} contact(s) trouvé(s), arrêt de la recherche`);
        break;
      }

      // Délai entre recherches pour ne pas être bloqué
      await new Promise(resolve => setTimeout(resolve, 3000));

    } catch (err) {
      logger.error(`❌ Erreur recherche ${fonction} pour ${nomHotel}: ${err.message}`);

      // Si c'est un CAPTCHA, arrêter immédiatement
      if (err.message.includes('CAPTCHA') || err.message.includes('unusual traffic')) {
        logger.error('🚫 Google bloque les requêtes - arrêt de la recherche');
        break;
      }
    }
  }

  // Dédupliquer par nom
  const seen = new Set();
  const unique = [];
  for (const contact of tousContacts) {
    const key = contact.nom_complet.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(contact);
    }
  }

  return unique.slice(0, 5); // Max 5 contacts
}

/**
 * Teste les patterns d'email avec ZeroBounce
 */
async function trouverEmailAvecZeroBounce(prenom, nom, domaine, zbKey) {
  if (!zbKey) {
    throw new Error('Clé ZeroBounce non configurée');
  }

  // Utiliser la même logique que emailValidation.js
  const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z-]/g, '');
  const p = normalize(prenom).replace(/-/g, '');
  const n = normalize(nom).replace(/-/g, '');
  const pi = p.charAt(0);
  const d = domaine.trim().replace(/^@/, '');

  // Patterns prioritaires (top 20)
  const patterns = [
    `${p}.${n}@${d}`,
    `${pi}.${n}@${d}`,
    `${p}@${d}`,
    `${pi}${n}@${d}`,
    `${p}${n}@${d}`,
    `${n}@${d}`,
    `${p}-${n}@${d}`,
    `${p}_${n}@${d}`,
    `${n}.${p}@${d}`,
    `${p}.${n.charAt(0)}@${d}`,
  ].filter(Boolean);

  // Tester les patterns un par un
  for (const email of patterns) {
    try {
      const r = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${zbKey}&email=${encodeURIComponent(email)}&ip_address=`);
      if (!r.ok) continue;

      const data = await r.json();

      if (data.status === 'valid') {
        return { email, status: 'valid', quality_score: data.quality_score };
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (err) {
      logger.warn(`Erreur test email ${email}:`, err.message);
    }
  }

  return null;
}

module.exports = {
  rechercherContactsGoogle,
  rechercherContactsBrave,
  rechercherContactsHotel,
  trouverEmailAvecZeroBounce,
  extraireNomPrenom,
  POSTES_CIBLES,
};
