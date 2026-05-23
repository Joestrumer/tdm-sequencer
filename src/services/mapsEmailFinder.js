/**
 * mapsEmailFinder.js — Recherche d'emails business via scraping de sites web
 *
 * Différent de emailFinderService.js (orienté personne/Lusha).
 * Ici : emails business via scraping du site web et recherche Google.
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
 * Source 1 — Scraper les pages du site web
 */
async function findEmailsFromWebsite(websiteUrl) {
  const results = [];
  if (!websiteUrl) return results;

  const baseUrl = websiteUrl.startsWith('http') ? websiteUrl : 'https://' + websiteUrl;
  const domain = getDomain(websiteUrl);

  for (const path of CONTACT_PATHS) {
    try {
      const url = new URL(path, baseUrl).toString();
      const html = await safeFetch(url);
      if (!html) continue;

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

      await sleep(DELAY_MS);
    } catch {
      // Continuer avec la page suivante
    }
  }

  return results;
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
 * Recherche email complète pour un prospect Maps
 * @param {Object} prospect - { name, website, city }
 * @returns {Promise<{email: string|null, source: string, confidence: string, all_emails: Array}>}
 */
async function findEmail(prospect) {
  const result = {
    email: null,
    source: null,
    confidence: null,
    all_emails: [],
  };

  try {
    // Source 1 : site web
    if (prospect.website) {
      const websiteEmails = await findEmailsFromWebsite(prospect.website);
      result.all_emails.push(...websiteEmails);
    }

    // Source 2 : Google Search
    if (result.all_emails.length === 0) {
      await sleep(DELAY_MS);
      const googleEmails = await findEmailsFromGoogle(prospect.name, prospect.city);
      result.all_emails.push(...googleEmails);
    }

    // Sélectionner le meilleur email
    if (result.all_emails.length > 0) {
      // Préférer high confidence, puis medium, puis low
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

module.exports = { findEmail, findEmailsFromWebsite, findEmailsFromGoogle };
