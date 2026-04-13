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
 * Recherche Google pour trouver des contacts LinkedIn
 */
async function rechercherContactsGoogle(nomHotel, fonction = 'Directeur') {
  const query = `"${nomHotel}" ${fonction} site:linkedin.com`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const contacts = [];

    // Parser les résultats de recherche Google
    $('div.g, div[data-sokoban-container]').each((i, elem) => {
      const $elem = $(elem);
      const titre = $elem.find('h3').first().text();
      const snippet = $elem.find('.VwiC3b, .yXK7lf, [data-sncf], .MjjYud').first().text();
      const lien = $elem.find('a').first().attr('href');

      // Vérifier que c'est un profil LinkedIn
      if (!lien || !lien.includes('linkedin.com/in/')) {
        return;
      }

      // Extraire le nom du titre ou snippet
      // Format typique : "Prénom NOM - Fonction - Entreprise"
      const texte = titre + ' ' + snippet;

      // Patterns pour extraire le nom
      const patterns = [
        // "Prénom NOM - Directeur"
        /([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[-–—]\s*(?:Directeur|Directrice|DG|Manager|Responsable|Gérant)/i,
        // "Prénom NOM | LinkedIn"
        /([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+){1,2})\s*[|•]\s*LinkedIn/i,
        // Début du titre (souvent le nom)
        /^([A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+){1,2})/,
      ];

      let nomExtrait = null;
      for (const pattern of patterns) {
        const match = texte.match(pattern);
        if (match && match[1]) {
          nomExtrait = match[1];
          break;
        }
      }

      if (!nomExtrait) return;

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

    // Trier par pertinence (haute en premier)
    contacts.sort((a, b) => {
      if (a.pertinence === 'haute' && b.pertinence !== 'haute') return -1;
      if (a.pertinence !== 'haute' && b.pertinence === 'haute') return 1;
      return 0;
    });

    return contacts;

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Timeout recherche Google (15s)');
    }
    throw err;
  }
}

/**
 * Recherche complète pour un hôtel : essaie plusieurs fonctions
 */
async function rechercherContactsHotel(nomHotel) {
  const fonctionsPrioritaires = ['Directeur', 'Directeur Général', 'Revenue Manager', 'Responsable'];

  const tousContacts = [];

  for (const fonction of fonctionsPrioritaires) {
    try {
      const contacts = await rechercherContactsGoogle(nomHotel, fonction);
      tousContacts.push(...contacts);

      // Si on a trouvé au moins 2 contacts avec haute pertinence, on arrête
      const hautePertinence = contacts.filter(c => c.pertinence === 'haute');
      if (hautePertinence.length >= 2) {
        break;
      }

      // Délai entre recherches pour ne pas être bloqué
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (err) {
      logger.warn(`Erreur recherche ${fonction} pour ${nomHotel}:`, err.message);
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
  rechercherContactsHotel,
  trouverEmailAvecZeroBounce,
  extraireNomPrenom,
  POSTES_CIBLES,
};
