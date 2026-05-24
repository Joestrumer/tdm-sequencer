/**
 * mapsEmailFinder.js — Recherche d'emails business via scraping de sites web
 * et réseaux sociaux (Facebook, Instagram, LinkedIn, TikTok).
 *
 * Différent de emailFinderService.js (orienté personne/Lusha).
 * Ici : emails business via scraping du site web, réseaux sociaux et recherche Google.
 *
 * Ne throw jamais — retourne un résultat partiel en cas d'erreur.
 */

const { extractEmails } = require('./hotelScraperService');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CONTACT_PATHS = ['/', '/contact', '/about', '/nous-contacter', '/a-propos', '/contactez-nous', '/kontakt', '/impressum'];

const DELAY_MS = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch une URL avec timeout de 5s
 */
async function safeFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Extrait le domaine d'une URL
 */
function getDomain(url) {
  try {
    return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Extrait les liens vers les réseaux sociaux depuis du HTML
 */
function extractSocialLinks(html) {
  const socials = { instagram: null, facebook: null, linkedin: null, tiktok: null };

  // Regex pour chaque réseau
  const patterns = {
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)\/?/g,
    facebook: /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com)\/([a-zA-Z0-9_.]+)\/?/g,
    linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9_-]+)\/?/g,
    tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.]+)\/?/g,
  };

  // Profils à ignorer (pages génériques)
  const ignore = new Set([
    'share', 'sharer', 'login', 'signup', 'help', 'about', 'privacy',
    'policies', 'terms', 'legal', 'settings', 'intent', 'hashtag',
    'dialog', 'groups', 'events', 'pages', 'marketplace', 'watch',
    'stories', 'reels', 'explore', 'direct', 'accounts', 'p',
  ]);

  for (const [network, regex] of Object.entries(patterns)) {
    const matches = [...html.matchAll(regex)];
    for (const match of matches) {
      const username = match[1];
      if (username && !ignore.has(username.toLowerCase()) && username.length > 1) {
        socials[network] = match[0].replace(/\/$/, '');
        break; // Premier profil trouvé
      }
    }
  }

  return socials;
}

/**
 * Source 1 — Scraper les pages du site web (emails + liens sociaux)
 */
async function findEmailsFromWebsite(websiteUrl) {
  const results = [];
  const socials = { instagram: null, facebook: null, linkedin: null, tiktok: null };
  if (!websiteUrl) return { emails: results, socials };

  const baseUrl = websiteUrl.startsWith('http') ? websiteUrl : 'https://' + websiteUrl;
  const domain = getDomain(websiteUrl);

  for (const path of CONTACT_PATHS) {
    try {
      const url = new URL(path, baseUrl).toString();
      const html = await safeFetch(url);
      if (!html) continue;

      // Extraire emails
      const emails = extractEmails(html);
      for (const email of emails) {
        if (!results.find(r => r.email === email)) {
          const emailDomain = email.split('@')[1]?.replace(/^www\./, '') || '';
          const matchesSite = emailDomain === domain || domain.endsWith('.' + emailDomain) || emailDomain.endsWith('.' + domain);
          results.push({
            email,
            source: 'website',
            page: path,
            confidence: matchesSite ? 'high' : 'low',
          });
        }
      }

      // Extraire liens sociaux
      const pageSocials = extractSocialLinks(html);
      for (const [network, url] of Object.entries(pageSocials)) {
        if (url && !socials[network]) socials[network] = url;
      }

      await sleep(DELAY_MS);
    } catch {
      // Continuer avec la page suivante
    }
  }

  return { emails: results, socials };
}

/**
 * Source 2 — Google Search pour trouver un email
 */
async function findEmailsFromGoogle(name, city) {
  const results = [];
  if (!name) return results;

  try {
    const query = encodeURIComponent(`"${name}" "${city || ''}" email contact`);
    const url = `https://www.google.com/search?q=${query}&num=5&hl=fr`;
    const html = await safeFetch(url);
    if (!html) return results;

    const emails = extractEmails(html);
    for (const email of emails) {
      if (!results.find(r => r.email === email)) {
        results.push({
          email,
          source: 'google_search',
          confidence: 'medium',
        });
      }
    }
  } catch {
    // Ne throw jamais
  }

  return results;
}

/**
 * Source 3 — Recherche de profils sociaux via Google
 * Cherche les profils Instagram, Facebook, LinkedIn, TikTok
 */
async function findSocialProfiles(name, city) {
  const socials = { instagram: null, facebook: null, linkedin: null, tiktok: null };
  if (!name) return socials;

  const searches = [
    { network: 'instagram', site: 'instagram.com', regex: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)/g },
    { network: 'facebook', site: 'facebook.com', regex: /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com)\/([a-zA-Z0-9_.]+)/g },
    { network: 'linkedin', site: 'linkedin.com/company', regex: /https?:\/\/(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9_-]+)/g },
    { network: 'tiktok', site: 'tiktok.com', regex: /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.]+)/g },
  ];

  const ignore = new Set([
    'share', 'sharer', 'login', 'signup', 'help', 'about', 'privacy',
    'policies', 'terms', 'legal', 'settings', 'explore', 'p', 'reel',
    'stories', 'reels', 'direct', 'accounts', 'hashtag',
  ]);

  for (const { network, site, regex } of searches) {
    if (socials[network]) continue; // Déjà trouvé via le site web

    try {
      const query = encodeURIComponent(`"${name}" ${city || ''} site:${site}`);
      const url = `https://www.google.com/search?q=${query}&num=3&hl=fr`;
      const html = await safeFetch(url);
      if (!html) continue;

      const matches = [...html.matchAll(regex)];
      for (const match of matches) {
        const username = match[1];
        if (username && !ignore.has(username.toLowerCase()) && username.length > 1) {
          socials[network] = match[0].replace(/\/$/, '');
          break;
        }
      }

      await sleep(DELAY_MS);
    } catch {
      // Continuer avec le réseau suivant
    }
  }

  return socials;
}

/**
 * Source 4 — Scraper une page Facebook pour extraire l'email
 * Facebook affiche parfois l'email dans la section "À propos"
 */
async function findEmailFromFacebook(facebookUrl) {
  const results = [];
  if (!facebookUrl) return results;

  try {
    // Tester la page principale et /about
    const aboutUrl = facebookUrl.replace(/\/$/, '') + '/about';
    for (const url of [facebookUrl, aboutUrl]) {
      const html = await safeFetch(url);
      if (!html) continue;

      const emails = extractEmails(html);
      for (const email of emails) {
        if (!results.find(r => r.email === email)) {
          results.push({
            email,
            source: 'facebook',
            confidence: 'medium',
          });
        }
      }

      await sleep(DELAY_MS);
    }
  } catch {
    // Ne throw jamais
  }

  return results;
}

/**
 * Recherche email complète pour un prospect Maps
 * @param {Object} prospect - { name, website, city }
 * @returns {Promise<{email, source, confidence, all_emails, socials}>}
 */
async function findEmail(prospect) {
  const result = {
    email: null,
    source: null,
    confidence: null,
    all_emails: [],
    socials: { instagram: null, facebook: null, linkedin: null, tiktok: null },
  };

  try {
    // Source 1 : site web (emails + liens sociaux)
    if (prospect.website) {
      const websiteData = await findEmailsFromWebsite(prospect.website);
      result.all_emails.push(...websiteData.emails);
      // Copier les réseaux trouvés sur le site
      for (const [network, url] of Object.entries(websiteData.socials)) {
        if (url) result.socials[network] = url;
      }
    }

    // Source 2 : Google Search (email)
    if (result.all_emails.length === 0) {
      await sleep(DELAY_MS);
      const googleEmails = await findEmailsFromGoogle(prospect.name, prospect.city);
      result.all_emails.push(...googleEmails);
    }

    // Source 3 : Recherche profils sociaux via Google (compléter ceux non trouvés sur le site)
    const missingSocials = Object.values(result.socials).some(v => !v);
    if (missingSocials) {
      const googleSocials = await findSocialProfiles(prospect.name, prospect.city);
      for (const [network, url] of Object.entries(googleSocials)) {
        if (url && !result.socials[network]) result.socials[network] = url;
      }
    }

    // Source 4 : Scraper Facebook pour un email si on a trouvé un profil FB mais toujours pas d'email
    if (result.all_emails.length === 0 && result.socials.facebook) {
      await sleep(DELAY_MS);
      const fbEmails = await findEmailFromFacebook(result.socials.facebook);
      result.all_emails.push(...fbEmails);
    }

    // Sélectionner le meilleur email
    if (result.all_emails.length > 0) {
      const sorted = [...result.all_emails].sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.confidence] || 3) - (order[b.confidence] || 3);
      });
      result.email = sorted[0].email;
      result.source = sorted[0].source;
      result.confidence = sorted[0].confidence;
    }
  } catch {
    // Ne throw jamais
  }

  return result;
}

module.exports = { findEmail, findEmailsFromWebsite, findEmailsFromGoogle, findSocialProfiles, findEmailFromFacebook };
