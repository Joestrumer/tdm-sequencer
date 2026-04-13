/**
 * hotelScraperService.js — Service de scraping pour extraire les contacts des sites d'hôtels
 */

const cheerio = require('cheerio');
const logger = require('../config/logger');

/**
 * Extrait les emails d'un texte avec regex
 */
function extractEmails(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = text.match(emailRegex) || [];

  // Filtrer les emails de tracking, analytics, etc.
  const blacklist = [
    'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
    'analytics', 'tracking', 'pixel', 'spam', 'abuse',
    'example.com', 'test.com', 'domain.com',
    '@sentry.', '@google-analytics.', '@facebook.', '@doubleclick.'
  ];

  return emails.filter(email => {
    const lower = email.toLowerCase();
    return !blacklist.some(term => lower.includes(term));
  });
}

/**
 * Extrait les noms de contact d'un texte
 * Cherche les patterns comme "Directeur: Jean Dupont" ou "Contact: Marie Martin"
 */
function extractContactNames(html, $) {
  const names = [];
  const text = $.text().toLowerCase();

  // Patterns de titres de fonction
  const titlePatterns = [
    /(?:directeur|directrice|gérant|gérante|responsable|manager|propriétaire|contact)[:\s-]+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})/gi,
    /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,2})[,\s-]+(?:directeur|directrice|gérant|gérante|responsable|manager|propriétaire)/gi,
  ];

  for (const pattern of titlePatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const name = match[1]?.trim();
      if (name && name.length > 3 && name.length < 50) {
        names.push(name);
      }
    }
  }

  return [...new Set(names)]; // Dédupliquer
}

/**
 * Parse le nom complet en prénom et nom
 */
function parseFullName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { prenom: parts[0], nom: '' };
  }
  if (parts.length === 2) {
    return { prenom: parts[0], nom: parts[1] };
  }
  // 3+ parties: premier mot = prénom, reste = nom
  return { prenom: parts[0], nom: parts.slice(1).join(' ') };
}

/**
 * Détermine la fonction/poste à partir du HTML
 */
function extractJobTitle(html) {
  const titles = [
    'Directeur', 'Directrice', 'Gérant', 'Gérante',
    'Responsable', 'Manager', 'Propriétaire', 'Directeur Général',
    'Directrice Générale', 'Responsable Hôtelier'
  ];

  const htmlLower = html.toLowerCase();

  for (const title of titles) {
    if (htmlLower.includes(title.toLowerCase())) {
      return title;
    }
  }

  return null;
}

/**
 * Scrape un site d'hôtel pour extraire les informations de contact
 * @param {string} url - URL du site à scraper
 * @returns {Promise<{email: string|null, nom: string|null, prenom: string|null, fonction: string|null}>}
 */
async function scrapeHotelWebsite(url) {
  if (!url || url.trim() === '') {
    throw new Error('URL manquante');
  }

  // Normaliser l'URL
  let normalizedUrl = url.trim();
  if (!normalizedUrl.match(/^https?:\/\//i)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  try {
    // Fetch avec timeout de 10 secondes
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TDM-Prospection/1.0; +https://terredemars.com)',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extraction des emails
    const emails = extractEmails(html);
    const primaryEmail = emails[0] || null;

    // Extraction des noms
    const names = extractContactNames(html, $);
    let contactNom = null;
    let contactPrenom = null;

    if (names.length > 0) {
      const parsed = parseFullName(names[0]);
      contactPrenom = parsed.prenom;
      contactNom = parsed.nom;
    }

    // Extraction de la fonction
    const fonction = extractJobTitle(html);

    return {
      email: primaryEmail,
      nom: contactNom,
      prenom: contactPrenom,
      fonction: fonction,
    };

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Timeout (10s)');
    }
    throw err;
  }
}

/**
 * Scrape un hôtel depuis la base de données et met à jour les résultats
 * @param {object} db - Instance de la base de données
 * @param {number} hotelId - ID de l'hôtel à scraper
 */
async function scrapeHotel(db, hotelId) {
  // Récupérer l'hôtel
  const hotel = db.prepare('SELECT * FROM hotels_france WHERE id = ?').get(hotelId);

  if (!hotel) {
    throw new Error('Hôtel non trouvé');
  }

  if (!hotel.site_internet) {
    // Marquer comme erreur si pas de site
    db.prepare(`
      UPDATE hotels_france
      SET scraping_status = 'error',
          scraping_error = 'Pas de site internet',
          scraping_date = datetime('now')
      WHERE id = ?
    `).run(hotelId);
    return { success: false, error: 'Pas de site internet' };
  }

  // Marquer comme en cours
  db.prepare(`
    UPDATE hotels_france
    SET scraping_status = 'processing',
        scraping_date = datetime('now')
    WHERE id = ?
  `).run(hotelId);

  try {
    const result = await scrapeHotelWebsite(hotel.site_internet);

    // Si aucun email trouvé, c'est une erreur partielle
    if (!result.email) {
      db.prepare(`
        UPDATE hotels_france
        SET scraping_status = 'error',
            scraping_error = 'Aucun email trouvé',
            scraping_date = datetime('now')
        WHERE id = ?
      `).run(hotelId);
      return { success: false, error: 'Aucun email trouvé' };
    }

    // Mettre à jour avec les résultats
    db.prepare(`
      UPDATE hotels_france
      SET contact_email = ?,
          contact_nom = ?,
          contact_prenom = ?,
          contact_fonction = ?,
          scraping_status = 'success',
          scraping_error = NULL,
          scraping_date = datetime('now')
      WHERE id = ?
    `).run(result.email, result.nom, result.prenom, result.fonction, hotelId);

    logger.info(`✅ Scraping réussi: ${hotel.nom_commercial} (${result.email})`);

    return { success: true, data: result };

  } catch (err) {
    logger.error(`❌ Erreur scraping ${hotel.nom_commercial}:`, err.message);

    db.prepare(`
      UPDATE hotels_france
      SET scraping_status = 'error',
          scraping_error = ?,
          scraping_date = datetime('now')
      WHERE id = ?
    `).run(err.message.slice(0, 255), hotelId);

    return { success: false, error: err.message };
  }
}

/**
 * Scrape plusieurs hôtels en batch
 * @param {object} db - Instance de la base de données
 * @param {number[]} hotelIds - Liste d'IDs d'hôtels à scraper
 * @param {function} onProgress - Callback appelé à chaque hôtel scrapé
 */
async function scrapeBatch(db, hotelIds, onProgress = null) {
  const results = {
    total: hotelIds.length,
    success: 0,
    errors: 0,
    details: [],
  };

  for (const hotelId of hotelIds) {
    const result = await scrapeHotel(db, hotelId);

    if (result.success) {
      results.success++;
    } else {
      results.errors++;
    }

    results.details.push({
      hotelId,
      success: result.success,
      error: result.error,
      data: result.data,
    });

    if (onProgress) {
      onProgress(results);
    }

    // Petit délai entre les requêtes pour ne pas surcharger
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

module.exports = {
  scrapeHotelWebsite,
  scrapeHotel,
  scrapeBatch,
  extractEmails,
  extractContactNames,
};
