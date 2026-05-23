/**
 * websiteAnalyzer.js — Analyse l'âge et la modernité d'un site web
 *
 * Retourne { age_years, last_updated, is_old, method }
 * Ne throw jamais — retourne un résultat partiel en cas d'erreur.
 */

const CURRENT_YEAR = new Date().getFullYear();

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    return res;
  } catch (err) {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Méthode 1 : Copyright regex © YYYY
 */
function analyzeCopyright(html) {
  const matches = html.match(/©\s*(\d{4})/g);
  if (!matches || matches.length === 0) return null;

  // Prendre l'année la plus récente trouvée
  const years = matches.map(m => parseInt(m.match(/(\d{4})/)[1])).filter(y => y >= 2000 && y <= CURRENT_YEAR);
  if (years.length === 0) return null;

  const latestYear = Math.max(...years);
  const age = CURRENT_YEAR - latestYear;
  return { age_years: age, method: 'copyright', year: latestYear };
}

/**
 * Méthode 2 : Header HTTP Last-Modified
 */
function analyzeLastModified(headers) {
  const lastModified = headers.get('last-modified');
  if (!lastModified) return null;

  const date = new Date(lastModified);
  if (isNaN(date.getTime())) return null;

  const age = (Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return {
    age_years: Math.round(age * 10) / 10,
    last_updated: date.toISOString().split('T')[0],
    method: 'last-modified',
  };
}

/**
 * Méthode 3 : Meta generator — CMS et version
 */
function analyzeGenerator(html) {
  const match = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator["']/i);
  if (!match) return null;

  const generator = match[1].toLowerCase();

  // WordPress versions anciennes
  const wpMatch = generator.match(/wordpress\s+([\d.]+)/);
  if (wpMatch) {
    const version = parseFloat(wpMatch[1]);
    if (version < 5.0) return { is_old: true, method: 'cms', detail: `WordPress ${wpMatch[1]}` };
  }

  // Joomla anciennes versions
  const joomlaMatch = generator.match(/joomla!\s*([\d.]+)/);
  if (joomlaMatch) {
    const version = parseFloat(joomlaMatch[1]);
    if (version < 4.0) return { is_old: true, method: 'cms', detail: `Joomla ${joomlaMatch[1]}` };
  }

  // Drupal anciennes versions
  const drupalMatch = generator.match(/drupal\s*([\d.]+)/);
  if (drupalMatch) {
    const version = parseInt(drupalMatch[1]);
    if (version < 9) return { is_old: true, method: 'cms', detail: `Drupal ${drupalMatch[1]}` };
  }

  return { method: 'cms', detail: match[1] };
}

/**
 * Méthode 4 : Détection techno obsolète
 */
function analyzeObsoleteTech(html) {
  const issues = [];

  // Flash
  if (/<object[^>]+type=["']application\/x-shockwave-flash/i.test(html) ||
      /<embed[^>]+type=["']application\/x-shockwave-flash/i.test(html) ||
      /\.swf["']/i.test(html)) {
    issues.push('Flash');
  }

  // jQuery 1.x
  const jqMatch = html.match(/jquery[.-]?(1\.\d+)/i);
  if (jqMatch) {
    issues.push(`jQuery ${jqMatch[1]}`);
  }

  // IE conditional comments
  if (/<!--\[if\s+(lt\s+)?IE/i.test(html)) {
    issues.push('IE conditionals');
  }

  // Table-based layout (multiple nested tables)
  const tableCount = (html.match(/<table/gi) || []).length;
  const divCount = (html.match(/<div/gi) || []).length;
  if (tableCount > 5 && tableCount > divCount * 0.5) {
    issues.push('table layout');
  }

  // Framesets
  if (/<frameset/i.test(html)) {
    issues.push('frameset');
  }

  if (issues.length === 0) return null;
  return { is_old: true, method: 'obsolete_tech', detail: issues.join(', ') };
}

/**
 * Analyse complète d'un site web
 * @param {string} url - URL du site web
 * @returns {Promise<{age_years: number|null, last_updated: string|null, is_old: boolean, method: string}>}
 */
async function analyzeWebsite(url) {
  const result = {
    age_years: null,
    last_updated: null,
    is_old: false,
    method: 'none',
  };

  try {
    // Normaliser l'URL
    if (!url.startsWith('http')) url = 'https://' + url;

    const res = await safeFetch(url);
    if (!res || !res.ok) return result;

    // Analyser Last-Modified depuis les headers
    const lastMod = analyzeLastModified(res.headers);
    if (lastMod) {
      result.last_updated = lastMod.last_updated || result.last_updated;
    }

    const html = await res.text();

    // Copyright
    const copyright = analyzeCopyright(html);
    if (copyright) {
      result.age_years = copyright.age_years;
      result.method = 'copyright';
      if (copyright.age_years > 3) result.is_old = true;
    }

    // Last-Modified comme fallback pour l'âge
    if (result.age_years === null && lastMod) {
      result.age_years = lastMod.age_years;
      result.method = 'last-modified';
      result.last_updated = lastMod.last_updated;
    }

    // CMS / Generator
    const gen = analyzeGenerator(html);
    if (gen) {
      if (gen.is_old) {
        result.is_old = true;
        result.method = result.method !== 'none' ? result.method + '+cms' : 'cms';
      }
    }

    // Techno obsolète
    const obsolete = analyzeObsoleteTech(html);
    if (obsolete) {
      result.is_old = true;
      result.method = result.method !== 'none' ? result.method + '+obsolete' : 'obsolete_tech';
    }

  } catch (err) {
    // Ne throw jamais
  }

  return result;
}

module.exports = { analyzeWebsite };
