/**
 * instagramScraperService.js — Service de scraping Instagram via API privée
 *
 * Récupère la liste "following" d'un compte Instagram, puis pour chaque :
 * - Profil complet (bio, site web, catégorie business)
 * - Classification automatique du type business
 * - Scraping du site web pour trouver emails
 * - Détection des doublons avec les leads existants
 */

const logger = require('../config/logger');
const { findEmailsFromWebsite } = require('./mapsEmailFinder');
const { extractEmails } = require('./hotelScraperService');

// ─── Configuration IG API ───────────────────────────────────────────────────

// Approche Instagrapi : API privée mobile (i.instagram.com) — plus fiable, autre pool de serveurs
const IG_PRIVATE_BASE = 'https://i.instagram.com/api/v1';
// Approche Instaloader : API web GraphQL (www.instagram.com) — fallback
const IG_WEB_BASE = 'https://www.instagram.com';
const IG_FOLLOWEES_QUERY_HASH = '58712303d941c6855d4e888c5f0cd22f';

// User-Agents
const IG_MOBILE_UA = 'Instagram 428.0.0.47.67 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 961145276)';
const IG_WEB_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const DEFAULT_DELAY_MS = 8000;
const JITTER_MAX_MS = 5000;

// ─── Classification business par bio ────────────────────────────────────────

const BUSINESS_KEYWORDS = {
  hotel: ['hotel', 'hôtel', 'resort', 'lodge', 'boutique hotel', 'palace', 'auberge', 'gîte', 'chambre d\'hôte', 'maison d\'hôte', 'relais', 'château hotel'],
  restaurant: ['restaurant', 'bistrot', 'brasserie', 'gastronomie', 'chef', 'traiteur', 'cuisine', 'table'],
  sport: ['gym', 'fitness', 'crossfit', 'musculation', 'salle de sport', 'coaching sportif', 'personal training', 'club de sport'],
  spa: ['spa', 'bien-être', 'wellness', 'massage', 'soin', 'détente', 'hammam', 'sauna'],
  hospitality: ['hospitality', 'hôtellerie', 'tourisme', 'travel', 'voyage', 'conciergerie', 'hébergement'],
  retail: ['boutique', 'concept store', 'shop', 'e-shop', 'mode', 'fashion'],
  bar: ['bar', 'cocktail', 'wine bar', 'rooftop', 'lounge'],
  event: ['événement', 'event', 'mariage', 'wedding', 'réception', 'séminaire', 'traiteur'],
};

// ─── Mapping catégories Instagram → type interne ────────────────────────────

const IG_CATEGORY_MAP = {
  // Hotel
  'hotel': 'hotel', 'hotel & lodging': 'hotel', 'resort': 'hotel',
  'bed and breakfast': 'hotel', 'lodge': 'hotel', 'hostel': 'hotel',
  'vacation home rental': 'hotel', 'inn': 'hotel',
  // Restaurant
  'restaurant': 'restaurant', 'fast food restaurant': 'restaurant',
  'café': 'restaurant', 'coffee shop': 'restaurant', 'bakery': 'restaurant',
  'food & beverage': 'restaurant', 'caterer': 'restaurant',
  // Sport / Fitness (avant spa pour éviter que "gym" ou "fitness" match spa)
  'gym/physical fitness center': 'sport', 'gym': 'sport', 'fitness': 'sport',
  'sports': 'sport', 'sport': 'sport', 'sports & recreation': 'sport',
  'athletic & sport': 'sport', 'fitness model': 'sport',
  'personal trainer': 'sport', 'coach sportif': 'sport',
  'yoga studio': 'sport', 'martial arts school': 'sport',
  'sports club': 'sport', 'recreation center': 'sport',
  'swimming pool': 'sport', 'tennis court': 'sport', 'golf course': 'sport',
  // Spa
  'spa': 'spa', 'beauty salon': 'spa', 'beauty, cosmetic & personal care': 'spa',
  'massage service': 'spa', 'health/beauty': 'spa',
  // Bar
  'bar': 'bar', 'lounge': 'bar', 'wine bar': 'bar', 'pub': 'bar',
  'nightclub': 'bar', 'wine/spirits': 'bar',
  // Event
  'event planner': 'event', 'wedding planning service': 'event',
  'party entertainment service': 'event',
  // Hospitality
  'travel agency': 'hospitality', 'tour guide': 'hospitality',
  'travel company': 'hospitality', 'tourist information center': 'hospitality',
  // Retail
  'shopping & retail': 'retail', 'clothing store': 'retail',
  'boutique store': 'retail', 'jewelry/watches': 'retail',
};

// ─── Détection pays ─────────────────────────────────────────────────────────

const TLD_COUNTRY_MAP = {
  '.co.uk': 'Royaume-Uni',
  '.fr': 'France', '.es': 'Espagne', '.it': 'Italie', '.de': 'Allemagne',
  '.pt': 'Portugal', '.uk': 'Royaume-Uni',
  '.be': 'Belgique', '.ch': 'Suisse', '.nl': 'Pays-Bas', '.at': 'Autriche',
  '.gr': 'Grèce', '.hr': 'Croatie', '.ma': 'Maroc', '.tn': 'Tunisie',
  '.sn': 'Sénégal', '.re': 'La Réunion', '.mu': 'Maurice', '.mg': 'Madagascar',
  '.mc': 'Monaco', '.lu': 'Luxembourg', '.ie': 'Irlande', '.pl': 'Pologne',
  '.cz': 'Tchéquie', '.se': 'Suède', '.no': 'Norvège', '.dk': 'Danemark',
  '.fi': 'Finlande', '.ro': 'Roumanie', '.bg': 'Bulgarie', '.tr': 'Turquie',
  '.jp': 'Japon', '.cn': 'Chine', '.br': 'Brésil', '.mx': 'Mexique',
  '.ar': 'Argentine', '.us': 'États-Unis', '.ca': 'Canada', '.au': 'Australie',
};

const BIO_COUNTRY_PATTERNS = [
  { pattern: /\bfrance\b/i, country: 'France' },
  { pattern: /\bespagne\b|\bspain\b|\bespaña\b/i, country: 'Espagne' },
  { pattern: /\bitalie\b|\bitaly\b|\bitalia\b/i, country: 'Italie' },
  { pattern: /\bmaroc\b|\bmorocco\b/i, country: 'Maroc' },
  { pattern: /\bportugal\b/i, country: 'Portugal' },
  { pattern: /\bsuisse\b|\bswitzerland\b/i, country: 'Suisse' },
  { pattern: /\bbelgique\b|\bbelgium\b/i, country: 'Belgique' },
  { pattern: /\bgrèce\b|\bgreece\b/i, country: 'Grèce' },
  { pattern: /\bparis\b/i, country: 'France' },
  { pattern: /\bmarseille\b|\blyon\b|\bbordeaux\b|\bnice\b|\btoulouse\b|\bstrasbourg\b|\bnantes\b|\bmontpellier\b|\blille\b/i, country: 'France' },
  { pattern: /\bbarcelona?\b|\bmadrid\b|\bsevilla?\b|\bmalaga\b|\bibiza\b|\bmajorca\b|\bmallorca\b/i, country: 'Espagne' },
  { pattern: /\broma?\b|\bmilano?\b|\bfirenze\b|\bvenezia?\b|\bnaples?\b|\bnapoli\b/i, country: 'Italie' },
  { pattern: /\blondon\b|\bmanchester\b|\bedinburgh\b/i, country: 'Royaume-Uni' },
  { pattern: /\bmarrakech\b|\bcasablanca\b|\bfès\b|\btanger\b|\bessaouira\b|\bagadir\b/i, country: 'Maroc' },
  { pattern: /\blisbonne?\b|\blisbon\b|\bporto\b|\bfaro\b|\balgarve\b/i, country: 'Portugal' },
  { pattern: /\bgenève\b|\bgeneva\b|\bzürich\b|\bzurich\b|\blausanne\b/i, country: 'Suisse' },
  { pattern: /\bbruxelles\b|\bbrussels\b/i, country: 'Belgique' },
  { pattern: /\bathens?\b|\bathènes?\b|\bsantorini\b|\bmykonos\b|\bcrète\b|\bcrete\b/i, country: 'Grèce' },
  { pattern: /\bdubrovnik\b|\bsplit\b|\bzagreb\b/i, country: 'Croatie' },
  { pattern: /\bbali\b/i, country: 'Indonésie' },
  { pattern: /\bmaldives\b/i, country: 'Maldives' },
  { pattern: /\bdubai\b|\babu dhabi\b/i, country: 'Émirats arabes unis' },
];

// ─── Mapping city_name (IG business) → pays ─────────────────────────────────

const CITY_COUNTRY_MAP = {
  // France
  'paris': 'France', 'marseille': 'France', 'lyon': 'France', 'bordeaux': 'France',
  'nice': 'France', 'toulouse': 'France', 'strasbourg': 'France', 'nantes': 'France',
  'montpellier': 'France', 'lille': 'France', 'rennes': 'France', 'grenoble': 'France',
  'cannes': 'France', 'saint-tropez': 'France', 'biarritz': 'France', 'aix-en-provence': 'France',
  'avignon': 'France', 'annecy': 'France', 'chamonix': 'France', 'deauville': 'France',
  'courchevel': 'France', 'megève': 'France', 'saint-malo': 'France', 'antibes': 'France',
  // Espagne
  'barcelona': 'Espagne', 'madrid': 'Espagne', 'sevilla': 'Espagne', 'malaga': 'Espagne',
  'ibiza': 'Espagne', 'mallorca': 'Espagne', 'valencia': 'Espagne', 'marbella': 'Espagne',
  'granada': 'Espagne', 'bilbao': 'Espagne', 'san sebastián': 'Espagne',
  // Italie
  'roma': 'Italie', 'rome': 'Italie', 'milano': 'Italie', 'milan': 'Italie',
  'firenze': 'Italie', 'florence': 'Italie', 'venezia': 'Italie', 'venice': 'Italie',
  'napoli': 'Italie', 'naples': 'Italie', 'torino': 'Italie', 'turin': 'Italie',
  'amalfi': 'Italie', 'positano': 'Italie', 'capri': 'Italie', 'como': 'Italie',
  // Royaume-Uni
  'london': 'Royaume-Uni', 'manchester': 'Royaume-Uni', 'edinburgh': 'Royaume-Uni',
  'birmingham': 'Royaume-Uni', 'liverpool': 'Royaume-Uni', 'bath': 'Royaume-Uni',
  // Portugal
  'lisbon': 'Portugal', 'lisboa': 'Portugal', 'porto': 'Portugal', 'faro': 'Portugal',
  'algarve': 'Portugal', 'cascais': 'Portugal', 'sintra': 'Portugal',
  // Allemagne
  'berlin': 'Allemagne', 'munich': 'Allemagne', 'münchen': 'Allemagne',
  'hamburg': 'Allemagne', 'frankfurt': 'Allemagne', 'düsseldorf': 'Allemagne',
  // Suisse
  'genève': 'Suisse', 'geneva': 'Suisse', 'zürich': 'Suisse', 'zurich': 'Suisse',
  'lausanne': 'Suisse', 'bern': 'Suisse', 'lucerne': 'Suisse', 'montreux': 'Suisse',
  'gstaad': 'Suisse', 'zermatt': 'Suisse', 'st. moritz': 'Suisse',
  // Belgique
  'bruxelles': 'Belgique', 'brussels': 'Belgique', 'bruges': 'Belgique', 'gand': 'Belgique', 'ghent': 'Belgique',
  // Pays-Bas
  'amsterdam': 'Pays-Bas', 'rotterdam': 'Pays-Bas', 'la haye': 'Pays-Bas', 'the hague': 'Pays-Bas',
  // Grèce
  'athens': 'Grèce', 'athènes': 'Grèce', 'santorini': 'Grèce', 'mykonos': 'Grèce', 'crete': 'Grèce',
  // Maroc
  'marrakech': 'Maroc', 'casablanca': 'Maroc', 'fès': 'Maroc', 'tanger': 'Maroc',
  'essaouira': 'Maroc', 'agadir': 'Maroc', 'rabat': 'Maroc',
  // Croatie
  'dubrovnik': 'Croatie', 'split': 'Croatie', 'zagreb': 'Croatie',
  // Turquie
  'istanbul': 'Turquie', 'bodrum': 'Turquie', 'antalya': 'Turquie',
  // Émirats
  'dubai': 'Émirats arabes unis', 'abu dhabi': 'Émirats arabes unis',
  // Danemark
  'copenhagen': 'Danemark', 'copenhague': 'Danemark', 'københavn': 'Danemark', 'aarhus': 'Danemark',
  // Suède
  'stockholm': 'Suède', 'gothenburg': 'Suède', 'malmö': 'Suède', 'göteborg': 'Suède',
  // Norvège
  'oslo': 'Norvège', 'bergen': 'Norvège', 'tromsø': 'Norvège',
  // Finlande
  'helsinki': 'Finlande', 'tampere': 'Finlande', 'turku': 'Finlande', 'espoo': 'Finlande',
  // Autriche
  'vienna': 'Autriche', 'wien': 'Autriche', 'salzburg': 'Autriche', 'innsbruck': 'Autriche',
  // Pologne
  'warsaw': 'Pologne', 'varsovie': 'Pologne', 'krakow': 'Pologne', 'cracovie': 'Pologne', 'gdansk': 'Pologne',
  // Tchéquie
  'prague': 'Tchéquie', 'praha': 'Tchéquie', 'brno': 'Tchéquie',
  // Hongrie
  'budapest': 'Hongrie',
  // Irlande
  'dublin': 'Irlande', 'cork': 'Irlande',
  // Roumanie
  'bucharest': 'Roumanie', 'bucarest': 'Roumanie',
  // Autres
  'new york': 'États-Unis', 'los angeles': 'États-Unis', 'miami': 'États-Unis',
  'tokyo': 'Japon', 'bali': 'Indonésie', 'bangkok': 'Thaïlande', 'singapour': 'Singapour',
  'singapore': 'Singapour', 'hong kong': 'Hong Kong', 'sydney': 'Australie',
  'melbourne': 'Australie', 'montréal': 'Canada', 'toronto': 'Canada',
};

// ─── Mapping phone country code → pays ─────────────────────────────────────

const PHONE_COUNTRY_CODE_MAP = {
  '+33': 'France', '+34': 'Espagne', '+39': 'Italie', '+44': 'Royaume-Uni',
  '+351': 'Portugal', '+49': 'Allemagne', '+41': 'Suisse', '+32': 'Belgique',
  '+31': 'Pays-Bas', '+30': 'Grèce', '+385': 'Croatie', '+212': 'Maroc',
  '+216': 'Tunisie', '+221': 'Sénégal', '+377': 'Monaco', '+352': 'Luxembourg',
  '+353': 'Irlande', '+48': 'Pologne', '+420': 'Tchéquie', '+46': 'Suède',
  '+47': 'Norvège', '+45': 'Danemark', '+358': 'Finlande', '+40': 'Roumanie',
  '+359': 'Bulgarie', '+90': 'Turquie', '+81': 'Japon', '+86': 'Chine',
  '+55': 'Brésil', '+52': 'Mexique', '+54': 'Argentine', '+1': 'États-Unis',
  '+61': 'Australie', '+971': 'Émirats arabes unis', '+66': 'Thaïlande',
  '+62': 'Indonésie', '+65': 'Singapour',
};

// ─── Détection link-in-bio (pas de vrais sites web) ─────────────────────────

const LINKINBIO_DOMAINS = [
  'linkin.bio', 'linktr.ee', 'linktree.com', 'bio.link', 'lnk.bio',
  'tap.bio', 'campsite.bio', 'beacons.ai', 'stan.store', 'hoo.be',
  'solo.to', 'bio.site', 'milkshake.app', 'carrd.co', 'withkoji.com',
  'snipfeed.co', 'linkpop.com', 'flowpage.com', 'direct.me', 'allmylinks.com',
  'contactinbio.com', 'shorby.com', 'shor.by', 'msha.ke',
];

/**
 * Vérifie si une URL est un service link-in-bio (pas un vrai site web)
 */
function isLinkInBio(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.toLowerCase();
    return LINKINBIO_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

/**
 * Tente de résoudre un lien link-in-bio pour trouver le vrai site web.
 * Scrape la page et extrait le premier lien externe qui n'est pas un réseau social.
 */
async function resolveRealWebsite(linkInBioUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(linkInBioUrl.startsWith('http') ? linkInBioUrl : 'https://' + linkInBioUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();

    // Extraire tous les liens href
    const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
    const links = [];
    let match;
    while ((match = hrefRegex.exec(html)) !== null) {
      links.push(match[1]);
    }

    // Domaines à ignorer (réseaux sociaux + link-in-bio eux-mêmes)
    const ignoreDomains = [
      'instagram.com', 'facebook.com', 'fb.com', 'twitter.com', 'x.com',
      'tiktok.com', 'youtube.com', 'linkedin.com', 'pinterest.com',
      'wa.me', 'whatsapp.com', 'telegram.org', 't.me',
      'open.spotify.com', 'music.apple.com', 'soundcloud.com',
      'apps.apple.com', 'play.google.com',
      ...LINKINBIO_DOMAINS,
    ];

    for (const link of links) {
      try {
        const hostname = new URL(link).hostname.toLowerCase();
        const isIgnored = ignoreDomains.some(d => hostname === d || hostname === 'www.' + d || hostname.endsWith('.' + d));
        if (!isIgnored && hostname.includes('.')) {
          return link;
        }
      } catch { /* URL invalide */ }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── État interne des jobs actifs ────────────────────────────────────────────

const activeJobs = new Map(); // jobId → { paused: boolean, cancelled: boolean }

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jitteredDelay(baseMs = DEFAULT_DELAY_MS) {
  const jitter = Math.random() * JITTER_MAX_MS;
  return sleep(baseMs + jitter);
}

/**
 * Extrait le username depuis une URL Instagram
 */
function extractUsername(url) {
  if (!url) return null;
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/?/);
  return match ? match[1] : url.replace(/^@/, '');
}

/**
 * Extrait le ds_user_id depuis un sessionid (format: userId%3Atoken%3A...)
 */
function extractUserId(sessionId) {
  if (!sessionId) return null;
  // Le sessionid est soit URL-encoded (userId%3A...) soit décodé (userId:...)
  const decoded = decodeURIComponent(sessionId);
  const parts = decoded.split(':');
  return parts[0] || null;
}

/**
 * Construit le header Authorization Bearer (approche Instagrapi)
 */
function buildBearerToken(sessionId) {
  const dsUserId = extractUserId(sessionId);
  if (!dsUserId) return null;
  const payload = JSON.stringify({ ds_user_id: dsUserId, sessionid: sessionId });
  const b64 = Buffer.from(payload).toString('base64');
  return `Bearer IGT:2:${b64}`;
}

/**
 * Génère un UUID v4 simple
 */
function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Device IDs persistés pour la session (générés une fois)
const DEVICE = {
  uuid: randomUUID(),
  phoneId: randomUUID(),
  androidDeviceId: 'android-' + Math.random().toString(36).substring(2, 18),
  advertisingId: randomUUID(),
};

// ─── Credentials ────────────────────────────────────────────────────────────

/**
 * Récupère les credentials Instagram depuis la config DB ou les env vars
 */
function getCredentials(db) {
  const sessionId = db.prepare("SELECT valeur FROM config WHERE cle = 'ig_session_id'").get()?.valeur
    || process.env.INSTAGRAM_SESSION_ID || null;
  const csrfToken = db.prepare("SELECT valeur FROM config WHERE cle = 'ig_csrf_token'").get()?.valeur
    || process.env.INSTAGRAM_CSRF_TOKEN || null;

  return { sessionId, csrfToken };
}

/**
 * Vérifie si les credentials IG sont configurées
 */
function hasCredentials(db) {
  const { sessionId, csrfToken } = getCredentials(db);
  return !!(sessionId && csrfToken);
}

// ─── IG API Fetch ───────────────────────────────────────────────────────────

/**
 * Construit les headers pour l'API privée mobile via i.instagram.com
 * Auth via Cookie (pas Bearer token — le Bearer nécessite un vrai login mobile)
 */
function privateHeaders(credentials) {
  const dsUserId = extractUserId(credentials.sessionId);

  return {
    'User-Agent': IG_MOBILE_UA,
    'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}; ds_user_id=${dsUserId}`,
    'X-CSRFToken': credentials.csrfToken,
    'X-IG-App-ID': '936619743392459',
    'X-IG-Device-ID': DEVICE.uuid,
    'X-IG-Family-Device-ID': DEVICE.phoneId,
    'X-IG-Android-ID': DEVICE.androidDeviceId,
    'X-IG-Connection-Type': 'WIFI',
    'X-IG-Capabilities': '3brTv10=',
    'X-IG-App-Locale': 'en_US',
    'X-IG-Device-Locale': 'en_US',
    'X-IG-WWW-Claim': '0',
    'X-Pigeon-Rawclienttime': String(Date.now() / 1000),
    'X-Pigeon-Session-Id': `UFS-${randomUUID()}-1`,
    'X-FB-HTTP-Engine': 'Tigon/MNS/TCP',
    'X-FB-Client-IP': 'True',
    'X-FB-Server-Cluster': 'True',
    'IG-INTENDED-USER-ID': dsUserId || '0',
    'Accept-Language': 'en-US',
    'Accept-Encoding': 'gzip, deflate',
    'Host': 'i.instagram.com',
    'Connection': 'keep-alive',
    'Accept': '*/*',
    // Sec-Fetch-* headers — requis par la couche sécurité IG (sinon 400 "SecFetch Policy violation")
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  };
}

/**
 * Construit les headers pour l'API web (Instaloader-style)
 * Headers minimaux pour GraphQL, headers complets pour API REST
 */
function webHeaders(credentials, mode = 'api') {
  if (mode === 'graphql') {
    // Instaloader utilise des headers MINIMAUX pour les requêtes GraphQL
    return {
      'User-Agent': IG_WEB_UA,
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate',
      'Accept-Language': 'en-US,en;q=0.8',
      'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}`,
    };
  }
  // Headers complets pour les endpoints API REST (web_profile_info etc.)
  return {
    'User-Agent': IG_WEB_UA,
    'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}; ig_pr=1; ig_vw=1920; ig_cb=1`,
    'X-CSRFToken': credentials.csrfToken,
    'X-Instagram-AJAX': '1',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': 'https://www.instagram.com',
    'Referer': 'https://www.instagram.com/',
    'Host': 'www.instagram.com',
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en;q=0.8',
    'Connection': 'keep-alive',
  };
}

/**
 * Fetch générique avec retry et rate limit handling
 */
async function igFetch(url, headers, retries = 3) {
  let rateLimitHits = 0;
  const maxRateLimitRetries = 5;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 429) {
        rateLimitHits++;
        if (rateLimitHits > maxRateLimitRetries) {
          throw new Error('IG_RATE_LIMITED: trop de rate limits (429). Session probablement bloquée temporairement.');
        }
        const retryAfter = res.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : 60000 * rateLimitHits;
        logger.warn(`⚠️ IG API 429 (${rateLimitHits}/${maxRateLimitRetries}), pause ${delay / 1000}s — ${url.split('?')[0]}`);
        await sleep(delay);
        attempt--;
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error('Session Instagram expirée ou invalide. Veuillez reconfigurer vos credentials.');
      }

      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }

        // Détecter feedback_required / is_spam → session brûlée, ne pas réessayer
        if (body.includes('feedback_required') || body.includes('"is_spam":true')) {
          logger.warn(`🚫 IG session flaggée spam — ${url.split('?')[0]}`);
          throw new Error('IG_SPAM_DETECTED: Instagram a détecté un comportement automatisé. Pause nécessaire (15-30 min).');
        }

        logger.warn(`⚠️ IG API ${res.status} — ${url.split('?')[0]} — ${body.slice(0, 200)}`);
        throw new Error(`IG API ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    } catch (err) {
      if (err.message.includes('IG_SPAM_DETECTED')) throw err;
      if (err.message.includes('IG_RATE_LIMITED')) throw err;
      if (err.message.includes('rate limit') || err.message.includes('429')) throw err;
      if (err.message.includes('expirée')) throw err;
      if (err.name === 'AbortError') {
        logger.warn(`⚠️ IG timeout (tentative ${attempt + 1}/${retries})`);
      } else if (attempt < retries - 1) {
        const delay = 2000 * Math.pow(2, attempt) + Math.random() * 2000;
        logger.warn(`⚠️ IG erreur (tentative ${attempt + 1}/${retries}): ${err.message}`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw new Error('IG API: toutes les tentatives échouées');
}

// ─── Fetchers IG ────────────────────────────────────────────────────────────

/**
 * Récupère le profil via l'API privée mobile (i.instagram.com)
 * Fallback sur l'API web si la private échoue
 */
async function fetchUserProfile(username, credentials) {
  // Approche 1 : API privée mobile (Instagrapi-style)
  try {
    const url = `${IG_PRIVATE_BASE}/users/${encodeURIComponent(username)}/usernameinfo/`;
    const data = await igFetch(url, privateHeaders(credentials));
    const user = data?.user;
    if (user) {
      logger.info(`📱 IG profil @${username} via API privée OK`);
      return {
        user_id: user.pk?.toString() || user.id?.toString(),
        username: user.username,
        full_name: user.full_name,
        bio: user.biography,
        external_url: user.external_url,
        business_email: user.public_email || user.business_email,
        category: user.category || user.category_name,
        is_business: user.is_business ? 1 : 0,
        is_private: user.is_private ? 1 : 0,
        follower_count: user.follower_count,
        following_count: user.following_count,
        city_name: user.city_name || null,
        phone_country_code: user.public_phone_country_code ? `+${user.public_phone_country_code}` : null,
        address_street: user.address_street || null,
      };
    }
  } catch (err) {
    logger.warn(`⚠️ IG API privée @${username} échoué: ${err.message}, tentative API web...`);
  }

  // Approche 2 : API web (Instaloader-style)
  const url = `${IG_WEB_BASE}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const data = await igFetch(url, webHeaders(credentials, 'api'));
  const user = data?.data?.user;
  if (!user) throw new Error(`Profil Instagram @${username} non trouvé`);

  return {
    user_id: user.id || user.pk,
    username: user.username,
    full_name: user.full_name,
    bio: user.biography,
    external_url: user.external_url,
    business_email: user.business_email || user.public_email,
    category: user.category_name || user.category,
    is_business: user.is_business_account || user.is_professional_account ? 1 : 0,
    is_private: user.is_private ? 1 : 0,
    follower_count: user.edge_followed_by?.count || user.follower_count,
    following_count: user.edge_follow?.count || user.following_count,
    city_name: user.city_name || user.business_address_json?.city_name || null,
    phone_country_code: user.public_phone_country_code ? `+${user.public_phone_country_code}` : null,
    address_street: user.address_street || user.business_address_json?.street_address || null,
  };
}

/**
 * Récupère la liste paginée des "following"
 * Approche 1 : API privée mobile (200 par page, plus rapide)
 * Approche 2 : GraphQL web (50 par page, fallback)
 */
async function fetchFollowingList(userId, credentials, maxAccounts = 500) {
  // Tenter d'abord l'API privée mobile
  try {
    return await fetchFollowingPrivate(userId, credentials, maxAccounts);
  } catch (err) {
    logger.warn(`⚠️ IG following API privée échoué: ${err.message}, tentative GraphQL...`);
    return await fetchFollowingGraphQL(userId, credentials, maxAccounts);
  }
}

/**
 * Following via API privée mobile (Instagrapi-style)
 */
async function fetchFollowingPrivate(userId, credentials, maxAccounts) {
  const following = [];
  let maxId = '';

  while (following.length < maxAccounts) {
    let url = `${IG_PRIVATE_BASE}/friendships/${userId}/following/?count=200&search_surface=follow_list_page`;
    if (maxId) url += `&max_id=${maxId}`;

    const data = await igFetch(url, privateHeaders(credentials));

    if (data.users && data.users.length > 0) {
      for (const user of data.users) {
        if (following.length >= maxAccounts) break;
        following.push({
          username: user.username,
          user_id: user.pk?.toString() || user.id?.toString(),
          full_name: user.full_name,
          is_private: user.is_private ? 1 : 0,
        });
      }
    }

    if (!data.next_max_id) break;
    maxId = data.next_max_id;

    if (following.length < maxAccounts) {
      await jitteredDelay();
    }
  }

  logger.info(`📱 IG following via API privée: ${following.length} comptes`);
  return following;
}

/**
 * Following via GraphQL web (Instaloader-style, fallback)
 */
async function fetchFollowingGraphQL(userId, credentials, maxAccounts) {
  const following = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore && following.length < maxAccounts) {
    const variables = { id: String(userId), first: 50 };
    if (cursor) variables.after = cursor;

    const url = `${IG_WEB_BASE}/graphql/query/?query_hash=${IG_FOLLOWEES_QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
    const data = await igFetch(url, webHeaders(credentials, 'graphql'));

    const edges = data?.data?.user?.edge_follow?.edges;
    if (edges && edges.length > 0) {
      for (const edge of edges) {
        if (following.length >= maxAccounts) break;
        following.push({
          username: edge.node.username,
          user_id: edge.node.id?.toString(),
          full_name: edge.node.full_name,
          is_private: edge.node.is_private ? 1 : 0,
        });
      }
    }

    const pageInfo = data?.data?.user?.edge_follow?.page_info;
    hasMore = pageInfo?.has_next_page || false;
    cursor = pageInfo?.end_cursor;

    if (hasMore && following.length < maxAccounts) {
      await jitteredDelay();
    }
  }

  logger.info(`🌐 IG following via GraphQL: ${following.length} comptes`);
  return following;
}

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Classifie le type business d'un compte depuis sa bio et catégorie IG
 * Priorité : catégorie IG directe → fallback mots-clés bio
 */
function classifyBusiness(bio, category) {
  // 1. Priorité : catégorie IG directe (plus fiable)
  if (category) {
    const normalized = category.toLowerCase().trim();
    for (const [igCat, type] of Object.entries(IG_CATEGORY_MAP)) {
      if (normalized.includes(igCat) || igCat.includes(normalized)) {
        return type;
      }
    }
  }

  // 2. Fallback : analyse mots-clés bio
  const text = `${bio || ''} ${category || ''}`.toLowerCase();
  const matches = {};

  for (const [type, keywords] of Object.entries(BUSINESS_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    if (score > 0) matches[type] = score;
  }

  if (Object.keys(matches).length === 0) return null;

  // Retourner le type avec le plus de matches
  return Object.entries(matches).sort((a, b) => b[1] - a[1])[0][0];
}

// Mapping pays (noms) → pays normalisé pour parsing d'adresses
const ADDRESS_COUNTRY_NAMES = {
  'france': 'France', 'spain': 'Espagne', 'espagne': 'Espagne', 'españa': 'Espagne',
  'italy': 'Italie', 'italie': 'Italie', 'italia': 'Italie',
  'united kingdom': 'Royaume-Uni', 'uk': 'Royaume-Uni', 'england': 'Royaume-Uni',
  'portugal': 'Portugal', 'germany': 'Allemagne', 'allemagne': 'Allemagne', 'deutschland': 'Allemagne',
  'switzerland': 'Suisse', 'suisse': 'Suisse', 'schweiz': 'Suisse',
  'belgium': 'Belgique', 'belgique': 'Belgique', 'nederland': 'Pays-Bas', 'netherlands': 'Pays-Bas',
  'greece': 'Grèce', 'grèce': 'Grèce', 'croatia': 'Croatie', 'croatie': 'Croatie',
  'morocco': 'Maroc', 'maroc': 'Maroc', 'tunisia': 'Tunisie', 'tunisie': 'Tunisie',
  'senegal': 'Sénégal', 'sénégal': 'Sénégal',
  'turkey': 'Turquie', 'turquie': 'Turquie', 'türkiye': 'Turquie',
  'united states': 'États-Unis', 'usa': 'États-Unis', 'us': 'États-Unis',
  'canada': 'Canada', 'australia': 'Australie', 'japan': 'Japon', 'japon': 'Japon',
  'indonesia': 'Indonésie', 'indonésie': 'Indonésie',
  'thailand': 'Thaïlande', 'thaïlande': 'Thaïlande',
  'united arab emirates': 'Émirats arabes unis', 'uae': 'Émirats arabes unis',
  'singapore': 'Singapour', 'singapour': 'Singapour',
  'mexico': 'Mexique', 'mexique': 'Mexique', 'brazil': 'Brésil', 'brésil': 'Brésil',
  'argentina': 'Argentine', 'argentine': 'Argentine',
  'monaco': 'Monaco', 'luxembourg': 'Luxembourg', 'ireland': 'Irlande', 'irlande': 'Irlande',
  'poland': 'Pologne', 'pologne': 'Pologne', 'sweden': 'Suède', 'suède': 'Suède',
  'norway': 'Norvège', 'norvège': 'Norvège', 'denmark': 'Danemark', 'danemark': 'Danemark',
  'finland': 'Finlande', 'finlande': 'Finlande', 'suomi': 'Finlande',
  'austria': 'Autriche', 'autriche': 'Autriche', 'österreich': 'Autriche',
  'czech republic': 'Tchéquie', 'czechia': 'Tchéquie',
  'romania': 'Roumanie', 'roumanie': 'Roumanie', 'bulgaria': 'Bulgarie', 'bulgarie': 'Bulgarie',
  'hungary': 'Hongrie', 'hongrie': 'Hongrie', 'magyarország': 'Hongrie',
  'maldives': 'Maldives', 'hong kong': 'Hong Kong',
  'china': 'Chine', 'chine': 'Chine', 'india': 'Inde', 'inde': 'Inde',
  'south africa': 'Afrique du Sud', 'afrique du sud': 'Afrique du Sud',
  'colombia': 'Colombie', 'colombie': 'Colombie', 'peru': 'Pérou', 'pérou': 'Pérou',
  'chile': 'Chili', 'chili': 'Chili',
};

// Codes postaux → pays (premiers chiffres/format)
const POSTAL_CODE_COUNTRY = [
  { regex: /\b\d{5}\b/, prefixes: { '75': 'France', '13': 'France', '69': 'France', '33': 'France', '06': 'France', '34': 'France', '31': 'France', '67': 'France', '44': 'France', '59': 'France', '78': 'France', '92': 'France', '93': 'France', '94': 'France', '77': 'France', '91': 'France', '95': 'France', '83': 'France', '64': 'France', '74': 'France', '73': 'France', '14': 'France', '35': 'France', '56': 'France', '29': 'France', '76': 'France', '68': 'France', '57': 'France', '54': 'France', '51': 'France', '21': 'France', '63': 'France', '42': 'France', '38': 'France', '01': 'France', '26': 'France', '30': 'France', '11': 'France', '66': 'France', '65': 'France', '40': 'France', '24': 'France', '17': 'France', '16': 'France', '86': 'France', '87': 'France', '37': 'France', '45': 'France', '41': 'France', '18': 'France', '36': 'France', '10': 'France', '52': 'France', '55': 'France', '88': 'France', '90': 'France', '25': 'France', '39': 'France', '71': 'France', '58': 'France', '89': 'France', '03': 'France', '15': 'France', '43': 'France', '07': 'France', '84': 'France', '04': 'France', '05': 'France', '48': 'France', '12': 'France', '46': 'France', '82': 'France', '81': 'France', '32': 'France', '47': 'France', '19': 'France', '23': 'France', '79': 'France', '85': 'France', '49': 'France', '53': 'France', '72': 'France', '61': 'France', '27': 'France', '28': 'France', '60': 'France', '02': 'France', '80': 'France', '62': 'France', '50': 'France', '22': 'France', '97': 'France' } },
];

/**
 * Détecte le pays depuis plusieurs sources (par priorité décroissante) :
 * 1. address_street (parsing direct du texte d'adresse)
 * 2. city_name (champ business IG)
 * 3. phone_country_code (champ business IG)
 * 4. TLD du site web
 * 5. Patterns dans la bio
 */
function detectCountry(externalUrl, bio, cityName, phoneCountryCode, addressStreet) {
  // 1. Priorité : address_street — parsing direct (contient souvent le pays en clair)
  if (addressStreet) {
    const addrLower = addressStreet.toLowerCase().trim();
    // Chercher un nom de pays dans l'adresse
    for (const [name, country] of Object.entries(ADDRESS_COUNTRY_NAMES)) {
      // Match comme mot entier dans l'adresse (séparé par virgules, espaces, début/fin)
      const regex = new RegExp(`(?:^|[,\\s])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[,\\s]|\\d|$)`, 'i');
      if (regex.test(addrLower)) return country;
    }
    // Chercher une ville connue dans l'adresse
    for (const [city, country] of Object.entries(CITY_COUNTRY_MAP)) {
      const regex = new RegExp(`(?:^|[,\\s])${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[,\\s]|\\d|$)`, 'i');
      if (regex.test(addrLower)) return country;
    }
    // Tenter via code postal français (5 chiffres, préfixe département)
    const postalMatch = addrLower.match(/\b(\d{5})\b/);
    if (postalMatch) {
      const prefix = postalMatch[1].slice(0, 2);
      if (POSTAL_CODE_COUNTRY[0].prefixes[prefix]) {
        return POSTAL_CODE_COUNTRY[0].prefixes[prefix];
      }
    }
  }

  // 2. city_name depuis le profil business IG
  if (cityName) {
    const normalized = cityName.toLowerCase().trim();
    if (CITY_COUNTRY_MAP[normalized]) return CITY_COUNTRY_MAP[normalized];
    // Essayer une correspondance partielle (ex: "Paris, France" → chercher "paris")
    for (const [city, country] of Object.entries(CITY_COUNTRY_MAP)) {
      if (normalized.includes(city)) return country;
    }
  }

  // 3. Phone country code
  if (phoneCountryCode) {
    const code = phoneCountryCode.startsWith('+') ? phoneCountryCode : `+${phoneCountryCode}`;
    // Trier par longueur décroissante pour matcher +351 avant +3
    for (const [prefix, country] of Object.entries(PHONE_COUNTRY_CODE_MAP).sort((a, b) => b[0].length - a[0].length)) {
      if (code.startsWith(prefix)) return country;
    }
  }

  // 4. TLD du site web
  if (externalUrl) {
    try {
      const hostname = new URL(externalUrl.startsWith('http') ? externalUrl : 'https://' + externalUrl).hostname.toLowerCase();
      // Vérifier TLD composés d'abord (.co.uk) puis simples
      for (const [tld, country] of Object.entries(TLD_COUNTRY_MAP).sort((a, b) => b[0].length - a[0].length)) {
        if (hostname.endsWith(tld)) return country;
      }
    } catch { /* URL invalide */ }
  }

  // 5. Fallback : patterns dans la bio
  if (bio) {
    for (const { pattern, country } of BIO_COUNTRY_PATTERNS) {
      if (pattern.test(bio)) return country;
    }
  }

  return null;
}

/**
 * Extrait les mots-clés matchés dans la bio
 */
function extractBioKeywords(bio, category) {
  const text = `${bio || ''} ${category || ''}`.toLowerCase();
  const found = [];

  for (const [type, keywords] of Object.entries(BUSINESS_KEYWORDS)) {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        found.push(keyword);
      }
    }
  }

  return found;
}

// ─── Scraping site web ──────────────────────────────────────────────────────

/**
 * Scrape le site web d'un compte pour trouver des emails
 */
async function scrapeAccountWebsite(account) {
  const website = account.external_url || account.website;
  if (!website) return { emails: [], socials: {} };

  try {
    const result = await findEmailsFromWebsite(website);
    return result;
  } catch (err) {
    logger.warn(`⚠️ Erreur scraping site ${website}: ${err.message}`);
    return { emails: [], socials: {} };
  }
}

/**
 * Choisit le meilleur email parmi les résultats
 */
function pickBestEmail(businessEmail, scrapedEmails) {
  // L'email business IG a la priorité maximale
  if (businessEmail) {
    return { email: businessEmail, source: 'instagram_business', confidence: 'high' };
  }

  if (!scrapedEmails || scrapedEmails.length === 0) return null;

  // Trier par confiance
  const sorted = [...scrapedEmails].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.confidence] || 3) - (order[b.confidence] || 3);
  });

  return { email: sorted[0].email, source: sorted[0].source, confidence: sorted[0].confidence };
}

// ─── Détection doublons ────────────────────────────────────────────────────

/**
 * Vérifie si un compte existe déjà comme lead ou dans d'autres tables
 */
function checkDuplicates(db, account) {
  const email = account.best_email;
  const website = account.external_url || account.website;

  // Vérifier par email dans leads
  if (email) {
    const existingLead = db.prepare('SELECT id, email FROM leads WHERE email = ?').get(email);
    if (existingLead) {
      return { duplicate: true, source: 'lead', existing_email: existingLead.email };
    }
  }

  // Vérifier par domaine du site web dans hotels_france
  if (website) {
    try {
      const domain = new URL(website.startsWith('http') ? website : 'https://' + website).hostname.replace(/^www\./, '');
      const existingHotel = db.prepare("SELECT id, site_internet FROM hotels_france WHERE site_internet LIKE ?").get(`%${domain}%`);
      if (existingHotel) {
        return { duplicate: true, source: 'hotels_france', existing_email: null };
      }
    } catch { /* ignore invalid URL */ }
  }

  return { duplicate: false };
}

// ─── Orchestrateur de job ───────────────────────────────────────────────────

/**
 * Traite un job Instagram complet en arrière-plan
 */
async function processJob(db, jobId) {
  const jobState = { paused: false, cancelled: false };
  activeJobs.set(jobId, jobState);

  try {
    const job = db.prepare('SELECT * FROM instagram_scrape_jobs WHERE id = ?').get(jobId);
    if (!job) throw new Error(`Job ${jobId} non trouvé`);

    const credentials = getCredentials(db);
    if (!credentials.sessionId || !credentials.csrfToken) {
      throw new Error('Credentials Instagram non configurées');
    }

    let options = {};
    try { options = JSON.parse(job.options || '{}'); } catch { /* ignore */ }

    let filterKeywords = [];
    try { filterKeywords = JSON.parse(job.filter_keywords || '[]'); } catch { /* ignore */ }

    // Étape 1 : Récupérer le profil source
    db.prepare("UPDATE instagram_scrape_jobs SET status = 'fetching_profile', updated_at = datetime('now') WHERE id = ?").run(jobId);

    const profile = await fetchUserProfile(job.instagram_username, credentials);

    db.prepare(`
      UPDATE instagram_scrape_jobs
      SET instagram_user_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(profile.user_id, jobId);

    await jitteredDelay();

    // Étape 2 : Récupérer la liste following
    db.prepare("UPDATE instagram_scrape_jobs SET status = 'fetching_following', updated_at = datetime('now') WHERE id = ?").run(jobId);

    const maxAccounts = options.max_accounts || 500;
    const following = await fetchFollowingList(profile.user_id, credentials, maxAccounts);

    db.prepare(`
      UPDATE instagram_scrape_jobs
      SET total_following = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(following.length, jobId);

    logger.info(`📱 IG Job ${jobId}: ${following.length} following récupérés pour @${job.instagram_username}`);

    // Étape 3 : Insérer les comptes et récupérer les profils détaillés
    db.prepare("UPDATE instagram_scrape_jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(jobId);

    const insertAccount = db.prepare(`
      INSERT OR IGNORE INTO instagram_scraped_accounts
        (job_id, instagram_username, instagram_user_id, full_name, is_private, scraping_status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `);

    for (const user of following) {
      insertAccount.run(jobId, user.username, user.user_id, user.full_name, user.is_private);
    }

    // Traiter chaque compte
    let processed = 0;
    let emailsFound = 0;
    const skipPrivate = options.skip_private !== false; // Par défaut : skip les privés

    for (const user of following) {
      // Vérifier pause/cancel
      const currentState = activeJobs.get(jobId);
      if (currentState?.cancelled) {
        db.prepare("UPDATE instagram_scrape_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(jobId);
        logger.info(`📱 IG Job ${jobId}: annulé`);
        return;
      }

      while (currentState?.paused) {
        await sleep(2000);
        const refreshedState = activeJobs.get(jobId);
        if (!refreshedState?.paused) break;
        if (refreshedState?.cancelled) {
          db.prepare("UPDATE instagram_scrape_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(jobId);
          return;
        }
      }

      // Skip si privé et option activée
      if (skipPrivate && user.is_private) {
        db.prepare(`
          UPDATE instagram_scraped_accounts
          SET scraping_status = 'skipped', scraping_error = 'Compte privé'
          WHERE job_id = ? AND instagram_username = ?
        `).run(jobId, user.username);
        processed++;
        db.prepare("UPDATE instagram_scrape_jobs SET processed = ?, updated_at = datetime('now') WHERE id = ?").run(processed, jobId);
        continue;
      }

      // Réutiliser les données d'un job précédent si ce compte a déjà été scrapé
      const previousAccount = db.prepare(`
        SELECT * FROM instagram_scraped_accounts
        WHERE instagram_username = ? AND job_id != ? AND scraping_status = 'done'
        ORDER BY created_at DESC LIMIT 1
      `).get(user.username, jobId);

      if (previousAccount) {
        db.prepare(`
          UPDATE instagram_scraped_accounts
          SET full_name = ?, bio = ?, website = ?, external_url = ?,
              business_email = ?, category = ?, is_business = ?, is_private = ?,
              follower_count = ?, following_count = ?,
              business_type = ?, bio_keywords = ?,
              best_email = ?, email_source = ?, email_confidence = ?,
              scraped_emails = ?, social_links = ?, linkedin_contacts = ?,
              existing_lead_email = ?, country = ?, scraping_status = 'done'
          WHERE job_id = ? AND instagram_username = ?
        `).run(
          previousAccount.full_name, previousAccount.bio, previousAccount.website, previousAccount.external_url,
          previousAccount.business_email, previousAccount.category, previousAccount.is_business, previousAccount.is_private,
          previousAccount.follower_count, previousAccount.following_count,
          previousAccount.business_type, previousAccount.bio_keywords,
          previousAccount.best_email, previousAccount.email_source, previousAccount.email_confidence,
          previousAccount.scraped_emails, previousAccount.social_links, previousAccount.linkedin_contacts,
          previousAccount.existing_lead_email, previousAccount.country || detectCountry(previousAccount.external_url, previousAccount.bio, previousAccount.city_name, previousAccount.phone_country_code, previousAccount.address_street),
          jobId, user.username
        );
        if (previousAccount.best_email) emailsFound++;
        processed++;
        db.prepare("UPDATE instagram_scrape_jobs SET processed = ?, emails_found = ?, updated_at = datetime('now') WHERE id = ?").run(processed, emailsFound, jobId);
        continue;
      }

      try {
        // Récupérer le profil détaillé
        await jitteredDelay();
        let accountProfile;
        try {
          accountProfile = await fetchUserProfile(user.username, credentials);
        } catch (err) {
          // Spam détecté ou rate limit épuisé → auto-pause le job
          if (err.message.includes('IG_SPAM_DETECTED') || err.message.includes('IG_RATE_LIMITED')) {
            logger.warn(`🚫 IG Job ${jobId}: auto-pause — ${err.message}`);
            const pauseMsg = err.message.includes('SPAM')
              ? 'Session flaggée spam par Instagram. Attendez 15-30 min puis reprenez.'
              : 'Trop de rate limits. Attendez quelques minutes puis reprenez.';
            db.prepare(`
              UPDATE instagram_scrape_jobs
              SET status = 'paused', error_message = ?, updated_at = datetime('now')
              WHERE id = ?
            `).run(pauseMsg, jobId);
            const state = activeJobs.get(jobId);
            if (state) state.paused = true;
            // Attendre que l'utilisateur reprenne manuellement
            while (activeJobs.get(jobId)?.paused) {
              await sleep(5000);
              if (activeJobs.get(jobId)?.cancelled) return;
            }
            // Reset l'erreur au retour
            db.prepare("UPDATE instagram_scrape_jobs SET status = 'processing', error_message = NULL, updated_at = datetime('now') WHERE id = ?").run(jobId);
            // Re-tenter ce compte après la pause
            await sleep(10000); // Cooldown supplémentaire de 10s après reprise
            try {
              accountProfile = await fetchUserProfile(user.username, credentials);
            } catch (err2) {
              db.prepare(`
                UPDATE instagram_scraped_accounts
                SET scraping_status = 'error', scraping_error = ?
                WHERE job_id = ? AND instagram_username = ?
              `).run(err2.message, jobId, user.username);
              processed++;
              db.prepare("UPDATE instagram_scrape_jobs SET processed = ?, updated_at = datetime('now') WHERE id = ?").run(processed, jobId);
              continue;
            }
          } else {
            // Profil inaccessible — on skip
            db.prepare(`
              UPDATE instagram_scraped_accounts
              SET scraping_status = 'error', scraping_error = ?
              WHERE job_id = ? AND instagram_username = ?
            `).run(err.message, jobId, user.username);
            processed++;
            db.prepare("UPDATE instagram_scrape_jobs SET processed = ?, updated_at = datetime('now') WHERE id = ?").run(processed, jobId);
            continue;
          }
        }

        // Résoudre les link-in-bio pour trouver le vrai site web
        if (isLinkInBio(accountProfile.external_url)) {
          try {
            const realUrl = await resolveRealWebsite(accountProfile.external_url);
            if (realUrl) {
              logger.info(`🔗 @${user.username}: résolu ${accountProfile.external_url} → ${realUrl}`);
              accountProfile.external_url = realUrl;
            }
          } catch { /* on garde le linkinbio si la résolution échoue */ }
        }

        // Classification business + détection pays
        const businessType = classifyBusiness(accountProfile.bio, accountProfile.category);
        const bioKeywords = extractBioKeywords(accountProfile.bio, accountProfile.category);
        const country = detectCountry(accountProfile.external_url, accountProfile.bio, accountProfile.city_name, accountProfile.phone_country_code, accountProfile.address_street);

        // Filtrage par mots-clés si configuré
        if (filterKeywords.length > 0 && !businessType) {
          const matchesFilter = filterKeywords.some(kw =>
            (accountProfile.bio || '').toLowerCase().includes(kw.toLowerCase()) ||
            (accountProfile.category || '').toLowerCase().includes(kw.toLowerCase())
          );
          if (!matchesFilter) {
            db.prepare(`
              UPDATE instagram_scraped_accounts
              SET bio = ?, external_url = ?, business_email = ?, category = ?,
                  is_business = ?, is_private = ?, follower_count = ?, following_count = ?,
                  business_type = ?, bio_keywords = ?, country = ?, city_name = ?, phone_country_code = ?, address_street = ?,
                  scraping_status = 'skipped', scraping_error = 'Ne correspond pas aux filtres'
              WHERE job_id = ? AND instagram_username = ?
            `).run(
              accountProfile.bio, accountProfile.external_url, accountProfile.business_email,
              accountProfile.category, accountProfile.is_business, accountProfile.is_private,
              accountProfile.follower_count, accountProfile.following_count,
              businessType, JSON.stringify(bioKeywords), country,
              accountProfile.city_name || null, accountProfile.phone_country_code || null, accountProfile.address_street || null,
              jobId, user.username
            );
            processed++;
            db.prepare("UPDATE instagram_scrape_jobs SET processed = ?, updated_at = datetime('now') WHERE id = ?").run(processed, jobId);
            continue;
          }
        }

        // Déterminer le meilleur email directement (business email IG)
        const bestEmailResult = pickBestEmail(accountProfile.business_email, []);

        // Mettre à jour le compte
        db.prepare(`
          UPDATE instagram_scraped_accounts
          SET full_name = ?, bio = ?, website = ?, external_url = ?,
              business_email = ?, category = ?, is_business = ?, is_private = ?,
              follower_count = ?, following_count = ?,
              business_type = ?, bio_keywords = ?,
              best_email = ?, email_source = ?, email_confidence = ?,
              country = ?, city_name = ?, phone_country_code = ?, address_street = ?, scraping_status = 'done'
          WHERE job_id = ? AND instagram_username = ?
        `).run(
          accountProfile.full_name, accountProfile.bio, accountProfile.external_url, accountProfile.external_url,
          accountProfile.business_email, accountProfile.category, accountProfile.is_business, accountProfile.is_private,
          accountProfile.follower_count, accountProfile.following_count,
          businessType, JSON.stringify(bioKeywords),
          bestEmailResult?.email || null, bestEmailResult?.source || null, bestEmailResult?.confidence || null,
          country, accountProfile.city_name || null, accountProfile.phone_country_code || null, accountProfile.address_street || null,
          jobId, user.username
        );

        if (bestEmailResult?.email) emailsFound++;

        // Vérifier les doublons
        if (bestEmailResult?.email) {
          const dup = checkDuplicates(db, { best_email: bestEmailResult.email, external_url: accountProfile.external_url });
          if (dup.duplicate) {
            db.prepare(`
              UPDATE instagram_scraped_accounts
              SET existing_lead_email = ?
              WHERE job_id = ? AND instagram_username = ?
            `).run(dup.existing_email || 'duplicate', jobId, user.username);
          }
        }

      } catch (err) {
        logger.warn(`⚠️ Erreur traitement @${user.username}: ${err.message}`);
        db.prepare(`
          UPDATE instagram_scraped_accounts
          SET scraping_status = 'error', scraping_error = ?
          WHERE job_id = ? AND instagram_username = ?
        `).run(err.message, jobId, user.username);
      }

      processed++;
      db.prepare(`
        UPDATE instagram_scrape_jobs
        SET processed = ?, emails_found = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(processed, emailsFound, jobId);
    }

    // Job terminé
    db.prepare(`
      UPDATE instagram_scrape_jobs
      SET status = 'completed', processed = ?, emails_found = ?,
          updated_at = datetime('now'), completed_at = datetime('now')
      WHERE id = ?
    `).run(processed, emailsFound, jobId);

    logger.info(`✅ IG Job ${jobId} terminé: ${processed} traités, ${emailsFound} emails trouvés`);

  } catch (err) {
    logger.error(`❌ IG Job ${jobId} erreur:`, err.message);
    db.prepare(`
      UPDATE instagram_scrape_jobs
      SET status = 'error', error_message = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(err.message, jobId);
  } finally {
    activeJobs.delete(jobId);
  }
}

/**
 * Scrape les sites web pour un lot de comptes (appelé unitairement ou en batch)
 */
async function scrapeWebsitesBatch(db, accountIds) {
  const results = { success: 0, errors: 0, emails_found: 0 };

  for (const accountId of accountIds) {
    const account = db.prepare('SELECT * FROM instagram_scraped_accounts WHERE id = ?').get(accountId);
    if (!account) continue;

    let website = account.external_url || account.website;
    if (!website) {
      results.errors++;
      continue;
    }

    try {
      db.prepare("UPDATE instagram_scraped_accounts SET scraping_status = 'scraping_website' WHERE id = ?").run(accountId);

      // Résoudre les link-in-bio
      if (isLinkInBio(website)) {
        const realUrl = await resolveRealWebsite(website);
        if (realUrl) {
          logger.info(`🔗 Résolu ${website} → ${realUrl}`);
          website = realUrl;
          db.prepare('UPDATE instagram_scraped_accounts SET external_url = ? WHERE id = ?').run(realUrl, accountId);
          account.external_url = realUrl;
        }
      }

      const { emails, socials } = await scrapeAccountWebsite(account);

      // Combiner avec email business existant
      const bestResult = pickBestEmail(account.business_email, emails);

      db.prepare(`
        UPDATE instagram_scraped_accounts
        SET scraped_emails = ?, social_links = ?,
            best_email = COALESCE(?, best_email),
            email_source = COALESCE(?, email_source),
            email_confidence = COALESCE(?, email_confidence),
            scraping_status = 'done'
        WHERE id = ?
      `).run(
        JSON.stringify(emails), JSON.stringify(socials),
        bestResult?.email, bestResult?.source, bestResult?.confidence,
        accountId
      );

      if (bestResult?.email) results.emails_found++;
      results.success++;

      // Mettre à jour le compteur emails du job
      if (bestResult?.email && account.job_id) {
        db.prepare(`
          UPDATE instagram_scrape_jobs
          SET emails_found = (
            SELECT COUNT(*) FROM instagram_scraped_accounts
            WHERE job_id = ? AND best_email IS NOT NULL
          ), updated_at = datetime('now')
          WHERE id = ?
        `).run(account.job_id, account.job_id);
      }

      // Vérifier doublons
      if (bestResult?.email) {
        const dup = checkDuplicates(db, { best_email: bestResult.email, external_url: website });
        if (dup.duplicate) {
          db.prepare("UPDATE instagram_scraped_accounts SET existing_lead_email = ? WHERE id = ?")
            .run(dup.existing_email || 'duplicate', accountId);
        }
      }

    } catch (err) {
      logger.warn(`⚠️ Erreur scraping website pour account ${accountId}: ${err.message}`);
      db.prepare("UPDATE instagram_scraped_accounts SET scraping_status = 'error', scraping_error = ? WHERE id = ?")
        .run(err.message, accountId);
      results.errors++;
    }

    // Petit délai entre les scrapes
    await sleep(800);
  }

  return results;
}

// ─── Pause / Resume / Cancel ────────────────────────────────────────────────

function pauseJob(jobId) {
  const state = activeJobs.get(jobId);
  if (state) {
    state.paused = true;
    return true;
  }
  return false;
}

function resumeJob(jobId) {
  const state = activeJobs.get(jobId);
  if (state) {
    state.paused = false;
    return true;
  }
  return false;
}

function cancelJob(jobId) {
  const state = activeJobs.get(jobId);
  if (state) {
    state.cancelled = true;
    return true;
  }
  return false;
}

function isJobActive(jobId) {
  return activeJobs.has(jobId);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  getCredentials,
  hasCredentials,
  extractUsername,
  igFetch,
  fetchUserProfile,
  fetchFollowingList,
  classifyBusiness,
  detectCountry,
  extractBioKeywords,
  scrapeAccountWebsite,
  scrapeWebsitesBatch,
  pickBestEmail,
  checkDuplicates,
  processJob,
  pauseJob,
  resumeJob,
  cancelJob,
  isJobActive,
  isLinkInBio,
  resolveRealWebsite,
  BUSINESS_KEYWORDS,
};
