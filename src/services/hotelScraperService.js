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

  // Filtrer les emails de tracking, analytics, placeholders, etc.
  const blacklist = [
    'noreply', 'no-reply', 'mailer-daemon', 'postmaster',
    'analytics', 'tracking', 'pixel', 'spam', 'abuse',
    'example.com', 'test.com', 'domain.com',
    '@sentry', '@google-analytics.', '@facebook.', '@doubleclick.',
  ];

  // Domaines à bloquer entièrement (tracking, placeholders, templates CMS)
  // Vérifie le domaine exact ET tous les sous-domaines (*.wixpress.com, *.sentry.io, etc.)
  const blockedDomains = new Set([
    'wixpress.com', 'sentry.io',
    'mysite.com', 'domaine.com', 'email.com', 'exemple.com',
    'yoursite.com', 'yourdomain.com', 'votresite.com', 'votrenom.com',
    'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
    'sharklasers.com', 'grr.la', 'guerrillamailblock.com',
    'hotmail.test', 'gmail.test', 'outlook.test',
    'wix.com', 'squarespace.com', 'weebly.com',
    'placeholder.com', 'sample.com', 'fake.com',
  ]);

  // Extensions de fichiers images/médias (faux positifs courants dans les attributs HTML src/href)
  const imageExtensions = /\.(jpg|jpeg|png|gif|svg|webp|bmp|ico|tiff|avif|mp4|mp3|pdf|zip|css|js|woff|woff2|ttf|eot)$/i;

  // TLDs valides courants (rejeter les TLD inexistants type .GZM, .XYZ aléatoire)
  const validTlds = /\.(com|fr|net|org|eu|co|io|info|biz|de|uk|es|it|be|ch|nl|at|pt|lu|ca|us|email|online|pro|hotel|travel|club|site|world|app|dev|tech|store|shop|xyz|me)$/i;

  return emails.filter(email => {
    const lower = email.toLowerCase();

    // Blacklist classique (sous-chaînes)
    if (blacklist.some(term => lower.includes(term))) return false;

    const domain = lower.split('@')[1] || '';
    const localPart = lower.split('@')[0];

    // Bloquer les domaines connus (tracking, placeholders) + tous les sous-domaines
    if (blockedDomains.has(domain)) return false;
    const domainParts = domain.split('.');
    for (let i = 1; i < domainParts.length - 1; i++) {
      if (blockedDomains.has(domainParts.slice(i).join('.'))) return false;
    }

    // Rejeter les local parts qui sont des hash hexadécimaux (ex: 605a7baede844d278b89dc95ae0a9123)
    if (/^[0-9a-f]{16,}$/i.test(localPart)) return false;

    // Rejeter les placeholders courants dans les templates
    if (['info@mysite', 'user@example', 'utilisateur@domaine', 'exemple@email', 'email@example', 'your@email', 'name@domain', 'nom@domaine', 'contact@example'].some(p => lower.startsWith(p))) return false;

    // Rejeter si ça ressemble à un nom de fichier image/média
    if (imageExtensions.test(lower)) return false;

    // Rejeter si le domaine a une extension de fichier image dans le chemin
    // Ex: photo@2x.png, cb@2x.25df64da.png
    if (/^\dx\b/i.test(domain)) return false; // @2x.xxx patterns (retina images)
    if (imageExtensions.test(domain)) return false;

    // Rejeter les domaines qui ressemblent à des dimensions d'image
    // Ex: @murielarie-3-1500x430.jpg, @lesley-Willimason-6-1024x683.jpg
    if (/\d+x\d+/i.test(domain)) return false;

    // Rejeter les TLD invalides / gibberish
    if (!validTlds.test(lower)) return false;

    // Rejeter les local parts trop courts (1 char) ou trop longs (>64)
    if (localPart.length < 2 || localPart.length > 64) return false;

    // Rejeter les domaines trop courts ou sans point
    if (domain.length < 4 || !domain.includes('.')) return false;

    // Rejeter les local parts avec que des caractères aléatoires (trop de consonnes consécutives)
    const originalLocal = email.split('@')[0];
    const consonants = originalLocal.replace(/[^bcdfghjklmnpqrstvwxzBCDFGHJKLMNPQRSTVWXZ]/g, '');
    if (consonants.length > 8 && consonants.length / originalLocal.length > 0.85) return false;

    return true;
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
    // Timeout de 20s pour éviter les blocages
    const result = await Promise.race([
      scrapeHotelWebsite(hotel.site_internet),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout scraping (20s)')), 20000)),
    ]);

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
  // Reset les hôtels bloqués en 'processing' depuis plus de 5 minutes
  try {
    db.prepare(`
      UPDATE hotels_france SET scraping_status = 'error', scraping_error = 'Timeout - reset automatique'
      WHERE scraping_status = 'processing' AND scraping_date < datetime('now', '-5 minutes')
    `).run();
  } catch (_) {}

  const results = {
    total: hotelIds.length,
    success: 0,
    errors: 0,
    details: [],
  };

  for (const hotelId of hotelIds) {
    let result;
    try {
      result = await scrapeHotel(db, hotelId);
    } catch (err) {
      // Catch-all pour ne jamais bloquer la boucle
      try {
        db.prepare(`UPDATE hotels_france SET scraping_status = 'error', scraping_error = ?, scraping_date = datetime('now') WHERE id = ?`).run((err.message || 'Erreur inconnue').slice(0, 255), hotelId);
      } catch (_) {}
      result = { success: false, error: err.message };
    }

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
