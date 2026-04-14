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
 * Valide qu'un nom est bien un nom de personne (pas une entreprise)
 * @returns {boolean} true si le nom semble valide
 */
function estNomValide(nom, nomHotel = '') {
  if (!nom || nom.length < 3) return false;

  const nomLower = nom.toLowerCase();
  const hotelLower = nomHotel.toLowerCase();

  // Mots-clés d'entreprise à rejeter
  const motsEntreprise = [
    'hotel', 'château', 'chateau', 'resort', 'spa', 'palace', 'domaine',
    'residence', 'résidence', 'lodge', 'inn', 'suites', 'golf', 'club',
    'camping', 'village', 'recrutement', 'careers', 'rh', 'vigiers',
    'management', 'group', 'groupe', 'hospitality', 'international'
  ];

  // Rejeter si contient un mot-clé d'entreprise
  for (const mot of motsEntreprise) {
    if (nomLower.includes(mot)) {
      logger.warn(`❌ Rejeté (entreprise): "${nom}" contient "${mot}"`);
      return false;
    }
  }

  // Rejeter si trop similaire au nom de l'hôtel
  if (hotelLower && nomLower.includes(hotelLower.substring(0, 10))) {
    logger.warn(`❌ Rejeté (nom d'hôtel): "${nom}"`);
    return false;
  }

  // Rejeter si contient des caractères mal encodés
  if (nom.includes('%') || nom.includes('&#')) {
    logger.warn(`❌ Rejeté (encodage): "${nom}"`);
    return false;
  }

  // Rejeter si contient des chiffres (IDs LinkedIn)
  if (/\d{5,}/.test(nom)) {
    logger.warn(`❌ Rejeté (ID numérique): "${nom}"`);
    return false;
  }

  // Doit contenir au moins 2 parties (prénom + nom)
  const parties = nom.trim().split(/\s+/);
  if (parties.length < 2) {
    logger.warn(`❌ Rejeté (pas de nom complet): "${nom}"`);
    return false;
  }

  // Valider que chaque partie commence par une majuscule
  for (const partie of parties) {
    if (partie.length > 0 && !/^[A-ZÀ-Ú]/.test(partie)) {
      logger.warn(`❌ Rejeté (pas de majuscule): "${nom}"`);
      return false;
    }
  }

  logger.info(`✅ Nom valide: "${nom}"`);
  return true;
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
async function rechercherContactsBrave(nomHotel, fonction = 'Directeur', apiKey, commune = null) {
  const nomNormalise = nomHotel.replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  const communePart = commune ? ` ${commune}` : '';
  // Enlever "linkedin" du texte, mais garder site:linkedin.com/in/ pour filtrer les résultats
  const query = `${nomNormalise}${communePart} ${fonction} site:linkedin.com/in/`;

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
        let titre = result.title || '';
        let description = result.description || '';
        const url = result.url || '';

        if (!url.includes('linkedin.com/in/')) continue;

        // Décoder les HTML entities (&#x27; → ', &amp; → &, etc.)
        titre = titre.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
        description = description.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

        const texte = titre + ' ' + description; // Pour la détection de fonction et pertinence

        // Extraire le nom depuis l'URL LinkedIn en PRIORITÉ (plus fiable)
        let nomExtrait = null;
        const urlMatch = url.match(/linkedin\.com\/in\/([^/?]+)/);
        if (urlMatch && urlMatch[1]) {
          const slug = urlMatch[1]
            .replace(/-\w{8,}$/, '')  // Enlever l'ID à la fin (ex: -1ab5731a)
            .replace(/%C3%A9/g, 'e')   // Décoder URL encoding
            .replace(/%C3%A8/g, 'e')
            .replace(/%C3%AA/g, 'e')
            .replace(/%C3%A0/g, 'a')
            .replace(/%20/g, '-');

          const parts = slug.split('-').filter(p => p.length > 0 && !/^\d+$/.test(p)); // Enlever seulement parties vides ou purement numériques
          if (parts.length >= 1) {
            // Prendre max 3 parties (prénom + nom + éventuel nom composé)
            const nameParts = parts.slice(0, 3);
            nomExtrait = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
            logger.info(`📝 Nom extrait de l'URL: ${nomExtrait} (depuis ${slug})`);
          }
        }

        // Si pas de nom depuis URL, essayer depuis le texte
        if (!nomExtrait) {
          const patterns = [
            // "Vito Santoro - Directeur"
            /([A-ZÀ-Ú][a-zà-ú]+(?:[-\s][A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—]\s*(?:Directeur|Director|Manager)/i,
            // Au début du titre
            /^([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-|]/,
            // "View Vito Santoro" ou "Connect Vito Santoro"
            /(?:View|Connect)\s+<strong>([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})<\/strong>/,
            /(?:View|Connect)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})\s*'/,
          ];

          for (const pattern of patterns) {
            const match = texte.match(pattern);
            if (match && match[1]) {
              nomExtrait = match[1].replace(/<\/?strong>/g, '').trim();
              break;
            }
          }
        }

        if (!nomExtrait) {
          logger.warn(`⚠️ Impossible d'extraire le nom de: "${titre}"`);
          continue;
        }

        // Valider que le nom est bien un nom de personne (pas une entreprise)
        if (!estNomValide(nomExtrait, nomHotel)) {
          continue; // Skip ce contact
        }

        // Détecter la fonction depuis le titre/description (plus fiable que le paramètre de recherche)
        let fonctionDetectee = null;
        const texteNormalise = texte.toLowerCase();

        // Chercher dans l'ordre de priorité
        for (const poste of POSTES_CIBLES) {
          const posteNorm = poste.toLowerCase();
          // Vérifier que le poste est mentionné avec un séparateur (pas au milieu d'un mot)
          const regex = new RegExp(`\\b${posteNorm}\\b`, 'i');
          if (regex.test(texteNormalise)) {
            fonctionDetectee = poste;
            logger.info(`  → Fonction détectée: ${poste}`);
            break;
          }
        }

        // Si aucune fonction détectée, utiliser celle de la recherche
        if (!fonctionDetectee) {
          fonctionDetectee = fonction;
          logger.warn(`  → Aucune fonction détectée dans le texte, utilisation par défaut: ${fonction}`);
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
async function rechercherContactsGoogle(nomHotel, fonction = 'Directeur', commune = null) {
  // Enlever les guillemets pour être moins strict, normaliser les apostrophes
  const nomNormalise = nomHotel.replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  const communePart = commune ? ` ${commune}` : '';
  const query = `${nomNormalise}${communePart} ${fonction} linkedin`;
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

      // Valider que le nom est bien un nom de personne
      if (!estNomValide(nomExtrait, nomHotel)) {
        return; // Skip ce contact
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
 * Recherche via Pappers.fr (API gratuite pour données entreprises françaises)
 */
async function rechercherContactsPappers(nomHotel, commune = null, pappersApiKey = null) {
  if (!pappersApiKey) {
    logger.info('⏭️ Pas de clé Pappers API, skip');
    return [];
  }

  try {
    const query = commune ? `${nomHotel} ${commune}` : nomHotel;
    const url = `https://api.pappers.fr/v2/recherche?api_token=${pappersApiKey}&q=${encodeURIComponent(query)}&par_page=5`;

    logger.info(`🔍 Recherche Pappers API: "${query}"`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Pappers API HTTP ${response.status}`);
    }

    const data = await response.json();
    const contacts = [];

    if (data.resultats && data.resultats.length > 0) {
      for (const entreprise of data.resultats.slice(0, 3)) {
        // Extraire les dirigeants
        if (entreprise.representants && entreprise.representants.length > 0) {
          for (const rep of entreprise.representants) {
            if (rep.nom_complet) {
              contacts.push({
                nom_complet: rep.nom_complet,
                fonction: rep.qualite || 'Dirigeant',
                linkedin_url: null,
                snippet: `${entreprise.nom_entreprise} - ${entreprise.siege?.ville || ''}`,
                pertinence: 'haute', // Pappers est très fiable
                source: 'Pappers API',
              });
            }
          }
        }
      }
    }

    logger.info(`✅ ${contacts.length} contact(s) trouvé(s) via Pappers API`);
    return contacts;

  } catch (err) {
    logger.error(`❌ Erreur Pappers API: ${err.message}`);
    return [];
  }
}

/**
 * Recherche via societe.com (scraping Brave/Google avec site:societe.com)
 */
async function rechercherContactsSociete(nomHotel, fonction = 'Dirigeant', braveApiKey = null, commune = null) {
  const nomNormalise = nomHotel.replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  const communePart = commune ? ` ${commune}` : '';
  const query = `${nomNormalise}${communePart} dirigeant site:societe.com`;

  const useBrave = !!braveApiKey;
  logger.info(`🔍 Recherche Societe.com (${useBrave ? 'Brave' : 'Google'}): "${query}"`);

  try {
    if (useBrave) {
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': braveApiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Brave API HTTP ${response.status}`);
      }

      const data = await response.json();
      const contacts = [];

      if (data.web && data.web.results) {
        for (const result of data.web.results) {
          const titre = (result.title || '').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
          const description = (result.description || '').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
          const url = result.url || '';

          if (!url.includes('societe.com')) continue;

          const texte = titre + ' ' + description;

          // Patterns pour extraire nom et fonction depuis societe.com
          // Format : "Prénom NOM - Président | Société XYZ"
          const patterns = [
            /([A-ZÀ-Ú][a-zà-ú]+\s+[A-ZÀ-Ú][A-Z\s]+)\s*[-–—]\s*(Président|Directeur|Gérant|PDG|DG|Directeur général)/i,
            /([A-ZÀ-Ú][a-zà-ú]+\s+[A-ZÀ-Ú][A-Z]+),?\s+(Président|Directeur|Gérant|PDG|DG)/i,
          ];

          let nomExtrait = null;
          let fonctionDetectee = fonction;

          for (const pattern of patterns) {
            const match = texte.match(pattern);
            if (match && match[1]) {
              nomExtrait = match[1].trim();
              fonctionDetectee = match[2] || fonction;
              logger.info(`📝 Societe.com: ${nomExtrait} - ${fonctionDetectee}`);
              break;
            }
          }

          if (!nomExtrait) {
            logger.warn(`⚠️ Impossible d'extraire le nom de Societe.com: "${titre}"`);
            continue;
          }

          // Valider que le nom est bien un nom de personne
          if (!estNomValide(nomExtrait, nomHotel)) {
            continue;
          }

          contacts.push({
            nom_complet: normaliserNom(nomExtrait),
            fonction: fonctionDetectee,
            linkedin_url: url,
            snippet: description.substring(0, 200),
            pertinence: 'haute',
            source: 'Societe.com',
          });
        }
      }

      logger.info(`✅ ${contacts.length} contact(s) trouvé(s) via Societe.com`);
      return contacts;

    } else {
      logger.info(`ℹ️ Societe.com scraping via Google non implémenté (utiliser Brave API recommandé)`);
      return [];
    }

  } catch (err) {
    logger.error(`❌ Erreur Societe.com: ${err.message}`);
    return [];
  }
}

/**
 * Recherche via scraping Pappers.fr (Google/Brave avec site:pappers.fr)
 */
async function rechercherContactsPappersScraping(nomHotel, fonction = 'Directeur', braveApiKey = null, commune = null) {
  const nomNormalise = nomHotel.replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
  const communePart = commune ? ` ${commune}` : '';
  const query = `${nomNormalise}${communePart} ${fonction} site:pappers.fr`;

  const useBrave = !!braveApiKey;
  logger.info(`🔍 Recherche Pappers scraping (${useBrave ? 'Brave' : 'Google'}): "${query}"`);

  try {
    let html = '';

    if (useBrave) {
      // Utiliser Brave Search API
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': braveApiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Brave API HTTP ${response.status}`);
      }

      const data = await response.json();
      const contacts = [];

      if (data.web && data.web.results) {
        for (const result of data.web.results) {
          const titre = (result.title || '').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
          const description = (result.description || '').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
          const url = result.url || '';

          if (!url.includes('pappers.fr')) continue;

          const texte = titre + ' ' + description;

          // Extraire nom et fonction depuis le texte Pappers
          // Format typique : "Prénom NOM - Président - Société XYZ"
          const patterns = [
            /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3})\s*[-–—]\s*(Président|Directeur|Gérant|PDG|DG)/i,
            /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,3}),\s*(Président|Directeur|Gérant|PDG|DG)/i,
          ];

          let nomExtrait = null;
          let fonctionDetectee = null;

          for (const pattern of patterns) {
            const match = texte.match(pattern);
            if (match && match[1]) {
              nomExtrait = match[1].trim();
              fonctionDetectee = match[2] || fonction;
              logger.info(`📝 Pappers: ${nomExtrait} - ${fonctionDetectee}`);
              break;
            }
          }

          if (!nomExtrait) {
            logger.warn(`⚠️ Impossible d'extraire le nom de Pappers: "${titre}"`);
            continue;
          }

          // Valider que le nom est bien un nom de personne
          if (!estNomValide(nomExtrait, nomHotel)) {
            continue; // Skip ce contact
          }

          contacts.push({
            nom_complet: normaliserNom(nomExtrait),
            fonction: fonctionDetectee,
            linkedin_url: url,
            snippet: description.substring(0, 200),
            pertinence: 'haute',
            source: 'Pappers scraping',
          });
        }
      }

      logger.info(`✅ ${contacts.length} contact(s) trouvé(s) via Pappers scraping (Brave)`);
      return contacts;

    } else {
      // Google scraping (fallback)
      logger.info(`ℹ️ Pappers scraping via Google non implémenté (utiliser Brave API recommandé)`);
      return [];
    }

  } catch (err) {
    logger.error(`❌ Erreur Pappers scraping: ${err.message}`);
    return [];
  }
}

/**
 * Recherche complète pour un hôtel : essaie plusieurs fonctions
 */
async function rechercherContactsHotel(nomHotel, braveApiKey = null, commune = null, pappersApiKey = null) {
  const fonctionsPrioritaires = ['Directeur', 'Directeur Général', 'Président', 'Gérant', 'DG'];

  const tousContacts = [];

  // 1. D'ABORD chercher dans Pappers API (données officielles françaises)
  if (pappersApiKey) {
    try {
      const contactsPappers = await rechercherContactsPappers(nomHotel, commune, pappersApiKey);
      if (contactsPappers.length > 0) {
        logger.info(`📊 Pappers API: ${contactsPappers.length} contact(s) trouvé(s)`);
        tousContacts.push(...contactsPappers);
      }
    } catch (err) {
      logger.error(`❌ Erreur Pappers API: ${err.message}`);
    }
  }

  // 2. Chercher sur Societe.com (scraping) - dirigeants officiels
  const useBrave = !!braveApiKey;
  if (useBrave) {
    try {
      const contactsSociete = await rechercherContactsSociete(nomHotel, 'Dirigeant', braveApiKey, commune);
      if (contactsSociete.length > 0) {
        logger.info(`📊 Societe.com: ${contactsSociete.length} contact(s) trouvé(s)`);
        tousContacts.push(...contactsSociete);
      }
    } catch (err) {
      logger.error(`❌ Erreur Societe.com: ${err.message}`);
    }
  }

  // 3. Chercher sur Pappers.fr (scraping) en complément
  if (useBrave) {
    try {
      const contactsPappersScraping = await rechercherContactsPappersScraping(nomHotel, 'Directeur', braveApiKey, commune);
      if (contactsPappersScraping.length > 0) {
        logger.info(`📊 Pappers scraping: ${contactsPappersScraping.length} contact(s) trouvé(s)`);
        tousContacts.push(...contactsPappersScraping);
      }
    } catch (err) {
      logger.error(`❌ Erreur Pappers scraping: ${err.message}`);
    }
  }

  // 4. ENSUITE chercher sur LinkedIn en complément
  const searchMethod = useBrave ? 'Brave API' : 'Google scraping';
  logger.info(`📡 Méthode de recherche LinkedIn: ${searchMethod}`);

  for (const fonction of fonctionsPrioritaires) {
    try {
      logger.info(`🔎 Essai LinkedIn: ${nomHotel}${commune ? ' (' + commune + ')' : ''} + ${fonction}`);

      const contacts = useBrave
        ? await rechercherContactsBrave(nomHotel, fonction, braveApiKey, commune)
        : await rechercherContactsGoogle(nomHotel, fonction, commune);

      tousContacts.push(...contacts);

      // Si on a trouvé au moins 1 contact, on arrête (pour économiser les crédits ZB)
      if (contacts.length >= 1) {
        logger.info(`✅ ${contacts.length} contact(s) trouvé(s), arrêt de la recherche LinkedIn`);
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

  // Filtrer uniquement les décideurs (titres de direction)
  const titresDecideurs = [
    'directeur', 'directrice', 'dg', 'pdg', 'ceo', 'directeur général',
    'directrice générale', 'directeur adjoint', 'directrice adjointe',
    'directeur des opérations', 'directrice des opérations',
    'directeur marketing', 'directrice marketing',
    'revenue manager', 'general manager', 'gérant', 'gérante',
    'responsable', 'manager', 'propriétaire', 'dirigeant', 'dirigeante'
  ];

  const decideurs = unique.filter(contact => {
    const fonctionLower = contact.fonction.toLowerCase();
    return titresDecideurs.some(titre => fonctionLower.includes(titre));
  });

  logger.info(`🎯 ${decideurs.length} décideur(s) sur ${unique.length} contact(s)`);

  return decideurs.slice(0, 5); // Max 5 décideurs
}

/**
 * Teste les patterns d'email avec ZeroBounce
 * @param {string} prenom
 * @param {string} nom
 * @param {string} domaine
 * @param {string} zbKey
 * @param {string|null} patternMemoire - Pattern mémorisé qui a marché pour un contact précédent
 * @returns {Promise<{email: string, status: string, quality_score: number, pattern: string}|null>}
 */
async function trouverEmailAvecZeroBounce(prenom, nom, domaine, zbKey, patternMemoire = null) {
  if (!zbKey) {
    logger.error('❌ Clé ZeroBounce non configurée');
    throw new Error('Clé ZeroBounce non configurée');
  }

  logger.info(`🔍 ZeroBounce: recherche email pour "${prenom}" "${nom}" @ ${domaine}`);

  const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z-]/g, '');
  const p = normalize(prenom).replace(/-/g, ''); // prénom sans tirets
  const n = normalize(nom).replace(/-/g, '');     // nom sans tirets
  const pRaw = normalize(prenom); // prénom avec tirets
  const nRaw = normalize(nom);     // nom avec tirets
  const pi = p.charAt(0);  // initiale prénom
  const ni = n.charAt(0);  // initiale nom
  const d = domaine.trim().replace(/^@/, '');

  // Parties du nom composé
  const nomParts = nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[\s-]+/).filter(Boolean).map(s => s.replace(/[^a-z]/g, ''));
  const secondNom = nomParts.length > 1 ? nomParts[nomParts.length - 1] : null;

  // Troncatures du nom
  const nTrunc = [];
  if (n.length > 1) nTrunc.push(n.substring(0, 1));
  if (n.length > 3) nTrunc.push(n.substring(0, 3));
  if (n.length > 4) nTrunc.push(n.substring(0, 4));
  if (n.length > 5) nTrunc.push(n.substring(0, 5));
  if (n.length > 6) nTrunc.push(n.substring(0, 6));

  // Troncature du prénom
  const pTrunc4 = p.length > 4 ? p.substring(0, 4) : null;

  // Générer patterns optimisés (TOP 15 les plus probables)
  const patternTemplates = [
    // ── Top 15 patterns les plus fréquents en hôtellerie ──
    { template: `${p}.${n}@${d}`, type: 'prenom.nom' },           // #1 le plus courant
    { template: `${pi}.${n}@${d}`, type: 'p.nom' },               // #2 très courant
    { template: `${p}@${d}`, type: 'prenom' },                     // #3 petites structures
    { template: `${pi}${n}@${d}`, type: 'pnom' },                 // #4 format compact
    { template: `${p}${n}@${d}`, type: 'prenomnom' },             // #5 sans séparateur
    { template: `${p}-${n}@${d}`, type: 'prenom-nom' },           // #6 tiret
    { template: `${p}_${n}@${d}`, type: 'prenom_nom' },           // #7 underscore
    { template: `${n}.${p}@${d}`, type: 'nom.prenom' },           // #8 inversé
    { template: `${p}.${ni}@${d}`, type: 'prenom.n' },            // #9 initiale nom
    { template: `${pi}.${ni}@${d}`, type: 'p.n' },                // #10 double initiale

    // ── Nom composé (si applicable) ──
    ...(secondNom ? [
      { template: `${p}.${secondNom}@${d}`, type: 'prenom.nom2' },
      { template: `${pi}.${secondNom}@${d}`, type: 'p.nom2' },
    ] : []),

    // ── Emails génériques direction ──
    { template: `direction@${d}`, type: 'direction' },
    { template: `contact@${d}`, type: 'contact' },
    { template: `info@${d}`, type: 'info' },
  ];

  // Dédupliquer
  const seen = new Set();
  const patterns = [];
  for (const item of patternTemplates) {
    const email = item.template;
    if (!email || email.startsWith('.') || email.includes('..') || email.startsWith('@')) continue;
    const lower = email.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      patterns.push({ email: lower, type: item.type });
    }
  }

  // Si un pattern a marché avant, le tester EN PREMIER
  let patternsToTest = patterns;
  if (patternMemoire) {
    const memoIndex = patterns.findIndex(p => p.type === patternMemoire);
    if (memoIndex > -1) {
      const [memoPattern] = patterns.splice(memoIndex, 1);
      patternsToTest = [memoPattern, ...patterns];
      logger.info(`🎯 Test pattern mémorisé en premier: ${memoPattern.type} (${memoPattern.email})`);
    }
  }

  // Tester les patterns
  logger.info(`📋 Test de ${patternsToTest.length} pattern(s)...`);

  for (const { email, type } of patternsToTest) {
    try {
      logger.debug(`  Testing: ${email}`);
      const r = await fetch(`https://api.zerobounce.net/v2/validate?api_key=${zbKey}&email=${encodeURIComponent(email)}&ip_address=`);
      if (!r.ok) continue;

      const data = await r.json();

      if (data.status === 'valid') {
        logger.info(`✅ Email trouvé: ${email} (pattern: ${type})`);
        return { email, status: 'valid', quality_score: data.quality_score, pattern: type };
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
  rechercherContactsPappers,
  rechercherContactsSociete,
  rechercherContactsPappersScraping,
  rechercherContactsHotel,
  trouverEmailAvecZeroBounce,
  extraireNomPrenom,
  POSTES_CIBLES,
};
