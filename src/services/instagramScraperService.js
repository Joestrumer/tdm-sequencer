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

// ─── Proxy Instagram (optionnel) ────────────────────────────────────────────
// Configurer INSTAGRAM_PROXY dans .env pour router les requêtes IG via un proxy résidentiel
// Format: http://user:pass@host:port ou socks5://user:pass@host:port
let igProxyDispatcher = null;
if (process.env.INSTAGRAM_PROXY) {
  try {
    const { ProxyAgent } = require('undici');
    igProxyDispatcher = new ProxyAgent(process.env.INSTAGRAM_PROXY);
    const masked = process.env.INSTAGRAM_PROXY.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
    logger.info(`🌐 IG Proxy configuré: ${masked}`);
  } catch (err) {
    logger.warn(`⚠️ IG Proxy non disponible: ${err.message}`);
  }
}

// ─── Configuration IG API ───────────────────────────────────────────────────

// Approche Instagrapi : API privée mobile (i.instagram.com) — plus fiable, autre pool de serveurs
const IG_PRIVATE_BASE = 'https://i.instagram.com/api/v1';
// Approche Instaloader : API web GraphQL (www.instagram.com) — fallback
const IG_WEB_BASE = 'https://www.instagram.com';
const IG_FOLLOWEES_QUERY_HASH = '58712303d941c6855d4e888c5f0cd22f';
const IG_FOLLOWERS_QUERY_HASH = 'c76146de99bb02f6415203be841dd25a';

// User-Agents
const IG_MOBILE_UA = 'Instagram 428.0.0.47.67 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 961145276)';
const IG_WEB_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const DEFAULT_DELAY_MS = 8000;
const JITTER_MAX_MS = 5000;

// ─── Classification business par bio ────────────────────────────────────────

const BUSINESS_KEYWORDS = {
  conciergerie: ['conciergerie', 'concierge', 'gestion locative', 'location courte durée', 'location courte duree', 'property management', 'airbnb management', 'gestion airbnb', 'airbnb & booking', 'rental management', 'gestion locative courte', 'conciergerie airbnb', 'conciergerie de luxe', 'concierge de luxe', 'conciergerie privée', 'conciergerie événementielle'],
  hotel: ['hotel', 'hôtel', 'resort', 'lodge', 'boutique hotel', 'palace', 'auberge', 'gîte', 'chambre d\'hôte', 'maison d\'hôte', 'relais', 'château hotel'],
  restaurant: ['restaurant', 'bistrot', 'brasserie', 'gastronomie', 'chef', 'traiteur', 'cuisine', 'table'],
  sport: ['gym', 'fitness', 'crossfit', 'musculation', 'salle de sport', 'coaching sportif', 'personal training', 'club de sport', 'sports club', 'club privé', 'club sportif', 'studio sport', 'studio fitness', 'bootcamp', 'workout', 'training studio', 'sport club'],
  spa: ['spa', 'massage', 'hammam', 'sauna'],
  hospitality: ['hospitality', 'hôtellerie', 'tourisme', 'travel', 'voyage', 'hébergement'],
  retail: ['boutique', 'concept store', 'shop', 'e-shop', 'mode', 'fashion'],
  bar: ['bar', 'cocktail', 'wine bar', 'rooftop', 'lounge'],
  event: ['événement', 'event', 'mariage', 'wedding', 'réception', 'séminaire', 'traiteur'],
};

// ─── Mapping catégories Instagram → type interne ────────────────────────────

const IG_CATEGORY_MAP = {
  // Conciergerie / Property Management
  'janitorial service': 'conciergerie', 'property management company': 'conciergerie',
  'property management': 'conciergerie', 'real estate service': 'conciergerie',
  'real estate agent': 'conciergerie', 'home service': 'conciergerie',
  'cleaning service': 'conciergerie',
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
  'private members club': 'sport', 'sports & recreation venue': 'sport',
  // Sport — catégories IG en français
  'salle de sport / centre de remise en forme': 'sport', 'salle de sport': 'sport',
  'club de sport': 'sport', 'club sportif': 'sport',
  'entraîneur personnel': 'sport', 'studio de yoga': 'sport',
  'centre de remise en forme': 'sport', 'terrain de golf': 'sport',
  'santé/beauté': 'sport', 'health/beauty': 'sport',
  // Spa
  'spa': 'spa', 'massage service': 'spa', 'health spa': 'spa',
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
  'sporting goods store': 'retail', "magasin d'articles de sport": 'retail',
};

// Catégories IG génériques qui ne renseignent pas sur le type de business
// → ignorer et fallback sur l'analyse bio/username
const IG_GENERIC_CATEGORIES = new Set([
  'pro', 'professional', 'product/service', 'local business',
  'brand', 'creator', 'reel creator', 'digital creator',
  'content creator', 'video creator', 'entrepreneur',
  'personal blog', 'community', 'interest',
  'monument', 'landmark', 'public figure',
  'nonprofit organization', 'government organization',
  'media/news company', 'just for fun',
]);

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
  // mid = machine ID, token base64url stable par device (28 chars)
  mid: Buffer.from(randomUUID().replace(/-/g, '').slice(0, 21), 'hex').toString('base64url'),
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
 * Aligné sur instagrapi v2.14+ (https://github.com/subzeroid/instagrapi)
 */
function privateHeaders(credentials) {
  const dsUserId = extractUserId(credentials.sessionId);
  const now = Date.now() / 1000;

  return {
    'User-Agent': IG_MOBILE_UA,
    'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}; ds_user_id=${dsUserId}; mid=${DEVICE.mid}`,
    'X-CSRFToken': credentials.csrfToken,
    // App ID mobile (567067343352427) — PAS l'ID web (936619743392459)
    'X-IG-App-ID': '567067343352427',
    'X-IG-Device-ID': DEVICE.uuid,
    'X-IG-Family-Device-ID': DEVICE.phoneId,
    'X-IG-Android-ID': DEVICE.androidDeviceId,
    'X-IG-Connection-Type': 'WIFI',
    'X-IG-Capabilities': '3brTv10=',
    'X-IG-App-Locale': 'en_US',
    'X-IG-Device-Locale': 'en_US',
    'X-IG-Mapped-Locale': 'en_US',
    'X-IG-WWW-Claim': '0',
    // Bloks version ID — obligatoire pour app version 428.0.0.47.67
    'X-Bloks-Version-Id': '7189b949425f9bf80ea8bd880cf5a3080b292d9b1c4b38a18d112f7c4b71e7a8',
    'X-Bloks-Is-Layout-RTL': 'false',
    'X-Bloks-Is-Panorama-Enabled': 'true',
    // Pigeon (analytics)
    'X-Pigeon-Rawclienttime': now.toFixed(3),
    'X-Pigeon-Session-Id': `UFS-${randomUUID()}-1`,
    // Bandwidth (randomisé pour ressembler à un vrai device)
    'X-IG-Bandwidth-Speed-KBPS': (Math.random() * 500 + 2500).toFixed(3),
    'X-IG-Bandwidth-TotalBytes-B': String(Math.floor(Math.random() * 85000000 + 5000000)),
    'X-IG-Bandwidth-TotalTime-MS': String(Math.floor(Math.random() * 7000 + 2000)),
    // Timezone
    'X-IG-Timezone-Offset': String(-new Date().getTimezoneOffset() * 60),
    // SALT IDs (randomisé par requête, range instagrapi)
    'X-IG-SALT-IDS': String(Math.floor(Math.random() * 100000 + 1061162222)),
    // FB / Tigon engine
    'X-FB-HTTP-Engine': 'Tigon/MNS/TCP',
    'X-FB-Client-IP': 'True',
    'X-FB-Server-Cluster': 'True',
    'X-Tigon-Is-Retry': 'False',
    // Zero balance (transport layer)
    'X-Zero-Balance': 'INIT',
    'X-Zero-Eh': '',
    'X-Zero-State': 'unknown',
    'Zero-HTTP-Network-Interface': 'wifi',
    // Navigation chain (fingerprint app)
    'X-IG-Nav-Chain': '9MV:self_profile:2:main_profile:1589462283:8',
    // Priorité requête
    'Priority': 'u=3',
    // User identification
    'IG-INTENDED-USER-ID': dsUserId || '0',
    'IG-U-DS-USER-ID': dsUserId || '',
    // App startup
    'X-IG-App-Startup-Country': 'FR',
    'Accept-Language': 'en-US',
    'Accept-Encoding': 'gzip, deflate',
    'Host': 'i.instagram.com',
    'Connection': 'keep-alive',
    'Accept': '*/*',
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

      const fetchOpts = { headers, signal: controller.signal };
      if (igProxyDispatcher) fetchOpts.dispatcher = igProxyDispatcher;
      const res = await fetch(url, fetchOpts);
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

      const json = await res.json();

      // Détecter login_required / challenge_required dans les réponses 200
      // Instagram peut renvoyer un 200 avec un message d'erreur dans le body
      if (json?.message === 'login_required' || json?.status === 'fail' && json?.message?.includes?.('login_required')) {
        throw new Error('IG_LOGIN_REQUIRED: Session expirée — Instagram demande une reconnexion.');
      }
      if (json?.message === 'challenge_required' || json?.challenge) {
        throw new Error('IG_CHALLENGE_REQUIRED: Instagram demande une vérification (challenge). Reconnectez-vous sur Instagram et reconfigurez vos cookies.');
      }
      if (json?.message === 'checkpoint_required') {
        throw new Error('IG_CHECKPOINT: Instagram a bloqué le compte temporairement. Reconnectez-vous manuellement.');
      }
      if (json?.require_login || json?.authenticated === false) {
        throw new Error('IG_LOGIN_REQUIRED: Session invalide — reconfigurer les credentials.');
      }
      // Détecter status: "fail" — distinguer soft-block IP du fail générique
      if (json?.status === 'fail') {
        const msg = json.message || '';
        // "something went wrong" = soft-block IP (Instagram masque le 429 en erreur serveur)
        if (msg.includes('sorry') || msg.includes('went wrong') || msg.includes('try again')) {
          throw new Error(`IG_SOFT_BLOCKED: IP soft-bloquée par Instagram — ${msg}`);
        }
        throw new Error(`IG_API_FAIL: ${msg || 'Erreur inconnue'} (status=fail)`);
      }

      return json;
    } catch (err) {
      if (err.message.includes('IG_LOGIN_REQUIRED')) throw err;
      if (err.message.includes('IG_CHALLENGE')) throw err;
      if (err.message.includes('IG_CHECKPOINT')) throw err;
      if (err.message.includes('IG_API_FAIL')) throw err;
      if (err.message.includes('IG_SOFT_BLOCKED')) throw err;
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
  // Helper pour normaliser un user privé
  const normalizePrivateUser = (user) => ({
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
    phone_number: user.public_phone_number || user.contact_phone_number || null,
    address_street: user.address_street || null,
  });

  let lastPrivateError = null;

  // Approche 1 : API privée mobile — /users/{username}/usernameinfo/ (endpoint principal instagrapi)
  try {
    const url = `${IG_PRIVATE_BASE}/users/${encodeURIComponent(username)}/usernameinfo/`;
    const data = await igFetch(url, privateHeaders(credentials));
    const user = data?.user;
    if (user) {
      logger.info(`📱 IG profil @${username} via API privée (usernameinfo) OK`);
      return normalizePrivateUser(user);
    }
    logger.warn(`⚠️ IG API privée @${username} usernameinfo — 200 mais pas de user. status: ${data?.status}, message: ${data?.message}`);
  } catch (err) {
    lastPrivateError = err;
    logger.warn(`⚠️ IG API privée @${username} usernameinfo échoué: ${err.message}`);
  }

  // Approche 2 : API privée mobile — /users/web_profile_info/ (endpoint alternatif instagrapi)
  // Même host (i.instagram.com), endpoint différent → peut contourner un block ciblé sur usernameinfo
  try {
    const url = `${IG_PRIVATE_BASE}/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const data = await igFetch(url, privateHeaders(credentials));
    // Réponse au format web: data.data.user ou data.user
    const user = data?.data?.user || data?.user;
    if (user) {
      logger.info(`📱 IG profil @${username} via API privée (web_profile_info) OK`);
      return normalizePrivateUser(user);
    }
    logger.warn(`⚠️ IG API privée @${username} web_profile_info — 200 mais pas de user. status: ${data?.status}`);
  } catch (err) {
    logger.warn(`⚠️ IG API privée @${username} web_profile_info échoué: ${err.message}`);
    // Si les 2 endpoints privés échouent en soft-block → ne pas fallback web (même IP)
    if (lastPrivateError?.message?.includes('IG_SOFT_BLOCKED') && err.message.includes('IG_SOFT_BLOCKED')) {
      throw err; // Les 2 endpoints privés soft-bloqués, ça ne sert à rien d'essayer le web
    }
    if (err.message.includes('IG_SPAM_DETECTED') || err.message.includes('IG_RATE_LIMITED')) {
      throw err;
    }
  }

  // Approche 3 : API web (www.instagram.com) — dernier recours
  try {
    const url = `${IG_WEB_BASE}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const data = await igFetch(url, webHeaders(credentials, 'api'));
    const user = data?.data?.user;
    if (user) {
      logger.info(`🌐 IG profil @${username} via API web OK`);
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
        phone_number: user.business_phone_number || user.public_phone_number || user.contact_phone_number || null,
        address_street: user.address_street || user.business_address_json?.street_address || null,
      };
    }
  } catch (err) {
    logger.warn(`⚠️ IG API web @${username} échoué: ${err.message}`);
  }

  // Tout a échoué — remonter l'erreur la plus pertinente
  if (lastPrivateError) throw lastPrivateError;
  throw new Error(`Profil Instagram @${username} non trouvé (tous les endpoints échoués)`);
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
    const params = new URLSearchParams({
      count: '200',
      rank_token: `${extractUserId(credentials.sessionId)}_${DEVICE.uuid}`,
      search_surface: 'follow_list_page',
      query: '',
      enable_groups: 'true',
    });
    if (maxId) params.set('max_id', maxId);
    let url = `${IG_PRIVATE_BASE}/friendships/${userId}/following/?${params}`;

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

/**
 * Récupère la liste paginée des "followers"
 * Même pattern que fetchFollowingList mais endpoint /followers/
 */
async function fetchFollowersList(userId, credentials, maxAccounts = 500) {
  try {
    return await fetchFollowersPrivate(userId, credentials, maxAccounts);
  } catch (err) {
    logger.warn(`⚠️ IG followers API privée échoué: ${err.message}, tentative GraphQL...`);
    return await fetchFollowersGraphQL(userId, credentials, maxAccounts);
  }
}

/**
 * Followers via API privée mobile
 */
async function fetchFollowersPrivate(userId, credentials, maxAccounts) {
  const followers = [];
  let maxId = '';

  while (followers.length < maxAccounts) {
    const params = new URLSearchParams({
      count: '200',
      rank_token: `${extractUserId(credentials.sessionId)}_${DEVICE.uuid}`,
      search_surface: 'follow_list_page',
      query: '',
      enable_groups: 'true',
    });
    if (maxId) params.set('max_id', maxId);
    let url = `${IG_PRIVATE_BASE}/friendships/${userId}/followers/?${params}`;

    const data = await igFetch(url, privateHeaders(credentials));

    if (data.users && data.users.length > 0) {
      for (const user of data.users) {
        if (followers.length >= maxAccounts) break;
        followers.push({
          username: user.username,
          user_id: user.pk?.toString() || user.id?.toString(),
          full_name: user.full_name,
          is_private: user.is_private ? 1 : 0,
        });
      }
    }

    if (!data.next_max_id) break;
    maxId = data.next_max_id;

    if (followers.length < maxAccounts) {
      await jitteredDelay();
    }
  }

  logger.info(`📱 IG followers via API privée: ${followers.length} comptes`);
  return followers;
}

/**
 * Followers via GraphQL web (fallback)
 */
async function fetchFollowersGraphQL(userId, credentials, maxAccounts) {
  const followers = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore && followers.length < maxAccounts) {
    const variables = { id: String(userId), first: 50 };
    if (cursor) variables.after = cursor;

    const url = `${IG_WEB_BASE}/graphql/query/?query_hash=${IG_FOLLOWERS_QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
    const data = await igFetch(url, webHeaders(credentials, 'graphql'));

    const edges = data?.data?.user?.edge_followed_by?.edges;
    if (edges && edges.length > 0) {
      for (const edge of edges) {
        if (followers.length >= maxAccounts) break;
        followers.push({
          username: edge.node.username,
          user_id: edge.node.id?.toString(),
          full_name: edge.node.full_name,
          is_private: edge.node.is_private ? 1 : 0,
        });
      }
    }

    const pageInfo = data?.data?.user?.edge_followed_by?.page_info;
    hasMore = pageInfo?.has_next_page || false;
    cursor = pageInfo?.end_cursor;

    if (hasMore && followers.length < maxAccounts) {
      await jitteredDelay();
    }
  }

  logger.info(`🌐 IG followers via GraphQL: ${followers.length} comptes`);
  return followers;
}

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Vérifie si un mot-clé est présent comme mot entier dans le texte
 * Utilise \b word boundaries pour éviter les faux positifs
 * (ex: "spa" ne doit pas matcher "space" ou "spaces")
 * Accepte le pluriel en 's' (ex: "spas", "hotels")
 */
function keywordMatch(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}s?\\b`, 'i').test(text);
}

/**
 * Classifie le type business d'un compte depuis sa bio, catégorie IG et username
 * Priorité : catégorie IG spécifique → mots-clés bio+username (avec scoring)
 * Les catégories IG génériques (PRO, Product/service, etc.) sont ignorées.
 * @param {string} bio - Biographie du compte
 * @param {string} category - Catégorie IG du compte
 * @param {string} [username] - Username Instagram (optionnel, pour analyse)
 */
function classifyBusiness(bio, category, username) {
  // 1. Priorité : catégorie IG directe (si spécifique, pas générique)
  if (category) {
    const normalized = category.toLowerCase().trim();
    // Ignorer les catégories génériques
    if (!IG_GENERIC_CATEGORIES.has(normalized)) {
      for (const [igCat, type] of Object.entries(IG_CATEGORY_MAP)) {
        if (normalized.includes(igCat) || igCat.includes(normalized)) {
          return type;
        }
      }
    }
  }

  // 2. Fallback : analyse mots-clés bio + username (avec word boundaries)
  // Inclure le username (underscores → espaces) pour détecter "conciergerie", "hotel", etc.
  const usernameNormalized = (username || '').replace(/[._]/g, ' ');
  const text = `${usernameNormalized} ${bio || ''} ${category || ''}`.toLowerCase();
  const matches = {};

  for (const [type, keywords] of Object.entries(BUSINESS_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (keywordMatch(text, keyword)) {
        score++;
      }
    }
    if (score > 0) matches[type] = score;
  }

  if (Object.keys(matches).length === 0) return null;

  // Si plusieurs types matchent, conciergerie l'emporte si présent
  // (car les bios de conciergeries mentionnent souvent hotel/restaurant/voyage comme services)
  if (matches.conciergerie && Object.keys(matches).length > 1) {
    return 'conciergerie';
  }

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
 * Détecte si une bio Instagram est rédigée en français via des indicateurs lexicaux.
 * Retourne 'fr' si la bio est probablement en français, null sinon.
 * Seuil conservateur : au moins 2 indicateurs pour éviter les faux positifs.
 */
function detectBioLanguage(bio) {
  if (!bio || bio.length < 10) return null;
  const lower = bio.toLowerCase();

  // Mots français courants dans les bios business IG
  const frenchIndicators = [
    /\bbienvenue\b/, /\bréservation[s]?\b/, /\bréservez\b/,
    /\bnotre\b/, /\bnos\b/, /\bnous\b/, /\bvotre\b/, /\bvous\b/,
    /\bouvert[e]?\b/, /\bfermé[e]?\b/, /\bhoraires?\b/,
    /\bdécouvrez\b/, /\bprofitez\b/, /\bcontactez\b/, /\bappelez\b/,
    /\bservices?\b/, /\bprestations?\b/,
    /\bdepuis\b/, /\bchez\b/,
    /\bsur rendez[- ]?vous\b/,
    /\bdu lundi\b|\bau vendredi\b|\bsamedi\b|\bdimanche\b/,
    /\béquipe\b/, /\bpassionné[es]?\b/,
    /\bmaison\b/, /\bboutique\b/,
    /\blivraison\b/, /\bcommandez\b/,
    /\bcoaching\b.*\bpersonnal/,
    /\baccompagnement\b/, /\bbien[- ]?être\b/,
    /\bsoin[s]?\b/, /\bbeauté\b/, /\bcoiffure\b/,
    /\btraiteur\b/, /\bévénement[s]?\b/,
    /\bgérant[e]?\b/, /\bfondateur\b|\bfondatrice\b/,
  ];

  // Compter les indicateurs matchés
  let frenchScore = 0;
  for (const pattern of frenchIndicators) {
    if (pattern.test(lower)) frenchScore++;
  }

  // Bonus : caractères accentués typiquement français (é, è, ê, ë, ç, à, ù, ô, î, û)
  const accentCount = (lower.match(/[éèêëçàùôîûœæ]/g) || []).length;
  if (accentCount >= 2) frenchScore++;
  if (accentCount >= 5) frenchScore++;

  return frenchScore >= 2 ? 'fr' : null;
}

/**
 * Détecte le pays depuis plusieurs sources (par priorité décroissante) :
 * 1. address_street (parsing direct du texte d'adresse)
 * 2. city_name (champ business IG)
 * 3. phone_country_code (champ business IG)
 * 4. TLD du site web
 * 5. Patterns dans la bio
 * 6. Détection de langue dans la bio (français → France)
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

  // 6. Fallback : détection de langue dans la bio
  if (bio) {
    const lang = detectBioLanguage(bio);
    if (lang === 'fr') return 'France';
  }

  return null;
}

/**
 * Extrait les mots-clés matchés dans la bio
 */
function extractBioKeywords(bio, category, username) {
  const usernameNormalized = (username || '').replace(/[._]/g, ' ');
  const text = `${usernameNormalized} ${bio || ''} ${category || ''}`.toLowerCase();
  const found = [];

  for (const [type, keywords] of Object.entries(BUSINESS_KEYWORDS)) {
    for (const keyword of keywords) {
      if (keywordMatch(text, keyword)) {
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
 * Supporte la reprise : si des comptes existent déjà, skip le fetch following
 * et reprend le traitement des comptes non encore traités.
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

    // Dispatch vers le mode recherche par catégorie
    const scrapeMode = job.scrape_mode || 'following';
    if (scrapeMode === 'category_search') {
      activeJobs.delete(jobId); // processCategorySearchJob gère son propre activeJobs
      return await processCategorySearchJob(db, jobId);
    }

    let filterKeywords = [];
    try { filterKeywords = JSON.parse(job.filter_keywords || '[]'); } catch { /* ignore */ }

    // Vérifier si des comptes existent déjà (reprise d'un job interrompu)
    const existingAccounts = db.prepare(
      'SELECT COUNT(*) as count FROM instagram_scraped_accounts WHERE job_id = ?'
    ).get(jobId);

    let following;

    if (existingAccounts.count > 0) {
      // ── Mode reprise : des comptes existent déjà, on skip le fetch following ──
      logger.info(`📱 IG Job ${jobId}: reprise — ${existingAccounts.count} comptes existants, skip fetch following`);

      // Charger les comptes à traiter depuis la DB
      following = db.prepare(`
        SELECT instagram_username as username, instagram_user_id as user_id,
               full_name, is_private, scraping_status
        FROM instagram_scraped_accounts
        WHERE job_id = ?
        ORDER BY id ASC
      `).all(jobId);

      // Mettre à jour le total si nécessaire
      if (!job.total_following) {
        db.prepare('UPDATE instagram_scrape_jobs SET total_following = ? WHERE id = ?').run(following.length, jobId);
      }
    } else {
      // ── Mode normal : premier lancement ──

      // Étape 0 : Warm-up — requête sur le propre profil pour "réveiller" la session
      // (identique à ce que fait instagrapi avant toute action)
      try {
        const dsUserId = extractUserId(credentials.sessionId);
        if (dsUserId) {
          await igFetch(`${IG_PRIVATE_BASE}/users/${dsUserId}/info/`, privateHeaders(credentials));
          logger.info(`📱 IG warm-up session OK (user_id=${dsUserId})`);
          await sleep(2000 + Math.random() * 3000); // Pause naturelle entre warm-up et scraping
        }
      } catch (warmupErr) {
        logger.warn(`⚠️ IG warm-up échoué: ${warmupErr.message} — tentative de scraping quand même`);
      }

      // Étape 1 : Récupérer le profil source
      db.prepare("UPDATE instagram_scrape_jobs SET status = 'fetching_profile', updated_at = datetime('now') WHERE id = ?").run(jobId);

      const profile = await fetchUserProfile(job.instagram_username, credentials);

      db.prepare(`
        UPDATE instagram_scrape_jobs
        SET instagram_user_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(profile.user_id, jobId);

      await jitteredDelay();

      // Étape 2 : Récupérer la liste following ou followers
      const scrapeMode = job.scrape_mode || 'following';
      db.prepare(`UPDATE instagram_scrape_jobs SET status = 'fetching_${scrapeMode === 'followers' ? 'followers' : 'following'}', updated_at = datetime('now') WHERE id = ?`).run(jobId);

      const maxAccounts = options.max_accounts || 500;
      following = scrapeMode === 'followers'
        ? await fetchFollowersList(profile.user_id, credentials, maxAccounts)
        : await fetchFollowingList(profile.user_id, credentials, maxAccounts);

      db.prepare(`
        UPDATE instagram_scrape_jobs
        SET total_following = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(following.length, jobId);

      logger.info(`📱 IG Job ${jobId}: ${following.length} ${scrapeMode} récupérés pour @${job.instagram_username}`);

      // Insérer les comptes
      const insertAccount = db.prepare(`
        INSERT OR IGNORE INTO instagram_scraped_accounts
          (job_id, instagram_username, instagram_user_id, full_name, is_private, scraping_status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `);

      for (const user of following) {
        insertAccount.run(jobId, user.username, user.user_id, user.full_name, user.is_private);
      }
    }

    // Étape 3 : Traiter chaque compte
    db.prepare("UPDATE instagram_scrape_jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(jobId);

    // Compter les déjà traités pour la reprise
    const alreadyDone = db.prepare(
      "SELECT COUNT(*) as count FROM instagram_scraped_accounts WHERE job_id = ? AND scraping_status IN ('done', 'skipped', 'error')"
    ).get(jobId);
    let processed = alreadyDone.count;
    const alreadyEmails = db.prepare(
      "SELECT COUNT(*) as count FROM instagram_scraped_accounts WHERE job_id = ? AND best_email IS NOT NULL"
    ).get(jobId);
    let emailsFound = alreadyEmails.count;

    const skipPrivate = options.skip_private !== false; // Par défaut : skip les privés

    if (processed > 0) {
      logger.info(`📱 IG Job ${jobId}: reprise à ${processed}/${following.length} (${emailsFound} emails)`);
      db.prepare("UPDATE instagram_scrape_jobs SET processed = ?, emails_found = ?, updated_at = datetime('now') WHERE id = ?")
        .run(processed, emailsFound, jobId);
    }

    for (const user of following) {
      // En mode reprise, sauter les comptes déjà traités
      if (user.scraping_status && user.scraping_status !== 'pending') {
        continue;
      }
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
          if (err.message.includes('IG_SPAM_DETECTED') || err.message.includes('IG_RATE_LIMITED') || err.message.includes('IG_SOFT_BLOCKED')) {
            logger.warn(`🚫 IG Job ${jobId}: auto-pause — ${err.message}`);
            const pauseMsg = err.message.includes('SPAM')
              ? 'Session flaggée spam par Instagram. Attendez 15-30 min puis reprenez.'
              : err.message.includes('SOFT_BLOCKED')
              ? 'IP soft-bloquée par Instagram ("something went wrong"). Attendez 1-2h ou changez d\'IP.'
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
        const businessType = classifyBusiness(accountProfile.bio, accountProfile.category, user.username);
        const bioKeywords = extractBioKeywords(accountProfile.bio, accountProfile.category, user.username);
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
                  business_type = ?, bio_keywords = ?, country = ?, city_name = ?, phone_country_code = ?, phone_number = ?, address_street = ?,
                  scraping_status = 'skipped', scraping_error = 'Ne correspond pas aux filtres'
              WHERE job_id = ? AND instagram_username = ?
            `).run(
              accountProfile.bio, accountProfile.external_url, accountProfile.business_email,
              accountProfile.category, accountProfile.is_business, accountProfile.is_private,
              accountProfile.follower_count, accountProfile.following_count,
              businessType, JSON.stringify(bioKeywords), country,
              accountProfile.city_name || null, accountProfile.phone_country_code || null, accountProfile.phone_number || null, accountProfile.address_street || null,
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
              country = ?, city_name = ?, phone_country_code = ?, phone_number = ?, address_street = ?, scraping_status = 'done'
          WHERE job_id = ? AND instagram_username = ?
        `).run(
          accountProfile.full_name, accountProfile.bio, accountProfile.external_url, accountProfile.external_url,
          accountProfile.business_email, accountProfile.category, accountProfile.is_business, accountProfile.is_private,
          accountProfile.follower_count, accountProfile.following_count,
          businessType, JSON.stringify(bioKeywords),
          bestEmailResult?.email || null, bestEmailResult?.source || null, bestEmailResult?.confidence || null,
          country, accountProfile.city_name || null, accountProfile.phone_country_code || null, accountProfile.phone_number || null, accountProfile.address_street || null,
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

// ─── Recherche par catégorie business ────────────────────────────────────────

const SEARCH_CITIES = {
  'France': [
    'Paris', 'Lyon', 'Marseille', 'Toulouse', 'Bordeaux', 'Nice', 'Nantes', 'Lille',
    'Strasbourg', 'Montpellier', 'Rennes', 'Grenoble', 'Toulon', 'Dijon', 'Angers',
    'Aix-en-Provence', 'Brest', 'Tours', 'Rouen', 'Caen', 'Nancy', 'Reims', 'Cannes',
    'Biarritz', 'Annecy', 'Chamonix', 'La Rochelle', 'Saint-Malo', 'Ajaccio', 'Colmar',
    'Perpignan', 'Metz', 'Clermont-Ferrand', 'Limoges', 'Amiens', 'Pau', 'Bayonne',
    'Chambéry', 'Saint-Étienne', 'Le Mans', 'Avignon', 'Valence', 'Poitiers', 'Besançon',
    'Orléans', 'La Baule', 'Deauville', 'Megève', 'Courchevel', 'Saint-Tropez',
  ],
  'Italie': [
    'Milano', 'Roma', 'Firenze', 'Torino', 'Napoli', 'Bologna', 'Venezia', 'Verona',
    'Como', 'Amalfi', 'Positano', 'Capri', 'Palermo', 'Catania', 'Genova', 'Bari',
    'Perugia', 'Siena', 'Lucca', 'Rimini', 'Bergamo', 'Parma', 'Modena', 'Trieste',
    'Sorrento',
  ],
  'Espagne': [
    'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Malaga', 'Bilbao', 'Ibiza',
    'Marbella', 'Granada', 'San Sebastián', 'Palma de Mallorca', 'Alicante',
    'Zaragoza', 'Córdoba', 'Cádiz', 'Tenerife', 'Las Palmas', 'Salamanca',
    'Toledo', 'Santander',
  ],
  'Royaume-Uni': [
    'London', 'Manchester', 'Edinburgh', 'Bristol', 'Bath', 'Brighton', 'Liverpool',
    'Birmingham', 'Leeds', 'Glasgow', 'Oxford', 'Cambridge', 'York', 'Nottingham',
    'Cardiff', 'Belfast', 'Aberdeen',
  ],
  'Allemagne': [
    'Berlin', 'München', 'Hamburg', 'Frankfurt', 'Köln', 'Düsseldorf', 'Stuttgart',
    'Dresden', 'Leipzig', 'Hannover', 'Nürnberg', 'Bremen', 'Heidelberg',
    'Freiburg', 'Baden-Baden',
  ],
};

const CATEGORY_SEARCH_TERMS = {
  'Club de sport': ['Club de sport', 'Salle de sport', 'Fitness club', 'Gym premium', 'Sports club', 'Club privé sport', 'Fitness studio', 'Crossfit box'],
  'Hotel': ['Hotel', 'Boutique hotel', 'Hotel de luxe', 'Palace'],
  'Service de conciergerie': ['Conciergerie', 'Property management', 'Gestion locative', 'Conciergerie Airbnb'],
  'Restaurant': ['Restaurant', 'Restaurant gastronomique', 'Bistrot', 'Brasserie'],
  'Spa': ['Spa', 'Centre de bien-être', 'Spa de luxe'],
  'Bar': ['Bar', 'Cocktail bar', 'Bar à cocktails'],
};

// Mots-clés d'exclusion par catégorie — comptes à ignorer (magasins, associations, etc.)
const CATEGORY_EXCLUDE_KEYWORDS = {
  'Club de sport': ['magasin', 'boutique', 'vente', 'compétition', 'babygym', 'baby gym', 'association sportive', 'ligue', 'fédération', 'comité', 'articles de sport', 'matériel', 'équipement', 'nutrition sportive', 'compléments'],
  'Hotel': [],
  'Service de conciergerie': [],
  'Restaurant': ['livraison', 'uber eats', 'deliveroo'],
  'Spa': [],
  'Bar': [],
};

/**
 * Recherche d'utilisateurs Instagram via l'API search
 * Utilise /api/v1/users/search/ avec pagination
 */
async function searchUsers(query, credentials, maxResults = 150) {
  const results = [];
  const seenIds = new Set();
  const maxPages = 3;

  for (let page = 0; page < maxPages && results.length < maxResults; page++) {
    const params = new URLSearchParams({
      q: query,
      count: '50',
      search_surface: 'user_search_page',
    });
    if (page > 0) {
      params.set('page', String(page));
      params.set('rank_token', `0.${Date.now()}`);
    }

    const url = `${IG_PRIVATE_BASE}/users/search/?${params.toString()}`;

    try {
      const data = await igFetch(url, privateHeaders(credentials));
      const users = data?.users || [];

      if (users.length === 0) break;

      for (const user of users) {
        const userId = user.pk?.toString() || user.id?.toString();
        if (seenIds.has(userId)) continue;
        seenIds.add(userId);

        results.push({
          username: user.username,
          user_id: userId,
          full_name: user.full_name || '',
          is_private: user.is_private ? 1 : 0,
          is_business: user.is_business ? 1 : 0,
          category: user.category || user.category_name || null,
          bio: user.biography || '',
          follower_count: user.follower_count || 0,
        });

        if (results.length >= maxResults) break;
      }

      if (!data.has_more && page > 0) break;
    } catch (err) {
      logger.warn(`⚠️ IG search "${query}" page ${page} échoué: ${err.message}`);
      if (err.message.includes('IG_SPAM_DETECTED') || err.message.includes('IG_RATE_LIMITED') || err.message.includes('IG_SOFT_BLOCKED')) throw err;
      break;
    }

    if (page < maxPages - 1 && results.length < maxResults) {
      await jitteredDelay();
    }
  }

  logger.info(`🔍 IG search "${query}": ${results.length} résultats`);
  return results;
}

/**
 * Traite un job de recherche par catégorie business
 * Itère ville par ville dans le pays choisi, avec dédup cross-jobs
 */
async function processCategorySearchJob(db, jobId) {
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

    const category = job.search_category;
    const country = job.search_country;
    const maxAccounts = options.max_accounts || 500;
    const minFollowers = options.min_followers || 0;

    const cities = SEARCH_CITIES[country];
    if (!cities || cities.length === 0) {
      throw new Error(`Pays "${country}" non supporté pour la recherche par catégorie`);
    }

    const searchTerms = CATEGORY_SEARCH_TERMS[category];
    if (!searchTerms || searchTerms.length === 0) {
      throw new Error(`Catégorie "${category}" non supportée`);
    }

    const excludeKeywords = (CATEGORY_EXCLUDE_KEYWORDS[category] || []).map(k => k.toLowerCase());

    // Charger la progression existante (reprise)
    let progress = { cities_completed: [], current_city: null, new_accounts_found: 0, duplicates_skipped: 0 };
    try { progress = JSON.parse(job.search_progress || '{}'); } catch { /* ignore */ }
    if (!progress.cities_completed) progress.cities_completed = [];
    if (!progress.new_accounts_found) progress.new_accounts_found = 0;
    if (!progress.duplicates_skipped) progress.duplicates_skipped = 0;

    // Construire le set global de dédup (tous les usernames déjà scrappés)
    const existingUsernames = new Set(
      db.prepare('SELECT DISTINCT instagram_username FROM instagram_scraped_accounts').all()
        .map(r => r.instagram_username)
    );

    // Passer en status searching
    db.prepare("UPDATE instagram_scrape_jobs SET status = 'searching', updated_at = datetime('now') WHERE id = ?").run(jobId);

    let newAccountsFound = progress.new_accounts_found;
    let duplicatesSkipped = progress.duplicates_skipped;

    for (const city of cities) {
      // Skip villes déjà complétées
      if (progress.cities_completed.includes(city)) continue;

      // Check pause/cancel
      const currentState = activeJobs.get(jobId);
      if (currentState?.cancelled) {
        db.prepare("UPDATE instagram_scrape_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(jobId);
        logger.info(`🔍 IG Category Job ${jobId}: annulé`);
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

      // Mettre à jour la progression
      progress.current_city = city;
      db.prepare("UPDATE instagram_scrape_jobs SET search_progress = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(progress), jobId);

      for (const term of searchTerms) {
        if (newAccountsFound >= maxAccounts) break;

        const query = `${term} ${city}`;
        let searchResults;

        try {
          searchResults = await searchUsers(query, credentials);
        } catch (err) {
          // Auto-pause sur spam/rate-limit
          if (err.message.includes('IG_SPAM_DETECTED') || err.message.includes('IG_RATE_LIMITED') || err.message.includes('IG_SOFT_BLOCKED')) {
            logger.warn(`🚫 IG Category Job ${jobId}: auto-pause — ${err.message}`);
            const pauseMsg = err.message.includes('SPAM')
              ? 'Session flaggée spam par Instagram. Attendez 15-30 min puis reprenez.'
              : err.message.includes('SOFT_BLOCKED')
              ? 'IP soft-bloquée par Instagram ("something went wrong"). Attendez 1-2h ou changez d\'IP.'
              : 'Trop de rate limits. Attendez quelques minutes puis reprenez.';
            db.prepare("UPDATE instagram_scrape_jobs SET status = 'paused', error_message = ?, search_progress = ?, updated_at = datetime('now') WHERE id = ?")
              .run(pauseMsg, JSON.stringify(progress), jobId);
            const state = activeJobs.get(jobId);
            if (state) state.paused = true;
            while (activeJobs.get(jobId)?.paused) {
              await sleep(5000);
              if (activeJobs.get(jobId)?.cancelled) return;
            }
            db.prepare("UPDATE instagram_scrape_jobs SET status = 'searching', error_message = NULL, updated_at = datetime('now') WHERE id = ?").run(jobId);
            await sleep(10000);
            // Re-tenter cette recherche
            try {
              searchResults = await searchUsers(query, credentials);
            } catch (err2) {
              logger.warn(`⚠️ IG search "${query}" re-essai échoué: ${err2.message}`);
              continue;
            }
          } else {
            logger.warn(`⚠️ IG search "${query}" échoué: ${err.message}`);
            continue;
          }
        }

        for (const user of searchResults) {
          if (newAccountsFound >= maxAccounts) break;

          // Dédup : skip si déjà connu
          if (existingUsernames.has(user.username)) {
            duplicatesSkipped++;
            continue;
          }

          // Marquer comme connu pour éviter les doublons intra-job
          existingUsernames.add(user.username);

          // Pré-filtre sur les données du search (avant le fetch profil coûteux)
          // 1. Filtre followers minimum
          if (minFollowers > 0 && user.follower_count > 0 && user.follower_count < minFollowers) {
            duplicatesSkipped++;
            continue;
          }

          // 2. Filtre exclusion par mots-clés (bio du search result)
          if (excludeKeywords.length > 0) {
            const searchText = `${user.bio || ''} ${user.full_name || ''} ${user.category || ''}`.toLowerCase();
            if (excludeKeywords.some(kw => searchText.includes(kw))) {
              duplicatesSkipped++;
              continue;
            }
          }

          try {
            // Récupérer le profil complet
            await jitteredDelay(4000);
            let accountProfile;
            try {
              accountProfile = await fetchUserProfile(user.username, credentials);
            } catch (err) {
              if (err.message.includes('IG_SPAM_DETECTED') || err.message.includes('IG_RATE_LIMITED') || err.message.includes('IG_SOFT_BLOCKED')) {
                logger.warn(`🚫 IG Category Job ${jobId}: auto-pause (profil) — ${err.message}`);
                const pauseMsg = err.message.includes('SPAM')
                  ? 'Session flaggée spam par Instagram. Attendez 15-30 min puis reprenez.'
                  : err.message.includes('SOFT_BLOCKED')
                  ? 'IP soft-bloquée par Instagram ("something went wrong"). Attendez 1-2h ou changez d\'IP.'
                  : 'Trop de rate limits. Attendez quelques minutes puis reprenez.';
                db.prepare("UPDATE instagram_scrape_jobs SET status = 'paused', error_message = ?, search_progress = ?, updated_at = datetime('now') WHERE id = ?")
                  .run(pauseMsg, JSON.stringify(progress), jobId);
                const state = activeJobs.get(jobId);
                if (state) state.paused = true;
                while (activeJobs.get(jobId)?.paused) {
                  await sleep(5000);
                  if (activeJobs.get(jobId)?.cancelled) return;
                }
                db.prepare("UPDATE instagram_scrape_jobs SET status = 'searching', error_message = NULL, updated_at = datetime('now') WHERE id = ?").run(jobId);
                await sleep(10000);
                try {
                  accountProfile = await fetchUserProfile(user.username, credentials);
                } catch (err2) {
                  logger.warn(`⚠️ Profil @${user.username} re-essai échoué: ${err2.message}`);
                  continue;
                }
              } else {
                logger.warn(`⚠️ Profil @${user.username} inaccessible: ${err.message}`);
                continue;
              }
            }

            // Résoudre les link-in-bio
            if (isLinkInBio(accountProfile.external_url)) {
              try {
                const realUrl = await resolveRealWebsite(accountProfile.external_url);
                if (realUrl) accountProfile.external_url = realUrl;
              } catch { /* on garde le linkinbio */ }
            }

            // Post-filtre profil complet : followers + exclusion
            if (minFollowers > 0 && accountProfile.follower_count > 0 && accountProfile.follower_count < minFollowers) {
              duplicatesSkipped++;
              progress.duplicates_skipped = duplicatesSkipped;
              continue;
            }
            if (excludeKeywords.length > 0) {
              const fullText = `${accountProfile.bio || ''} ${accountProfile.full_name || ''} ${accountProfile.category || ''}`.toLowerCase();
              if (excludeKeywords.some(kw => fullText.includes(kw))) {
                duplicatesSkipped++;
                progress.duplicates_skipped = duplicatesSkipped;
                continue;
              }
            }

            // Classification + détection pays
            const businessType = classifyBusiness(accountProfile.bio, accountProfile.category, accountProfile.username);
            const bioKeywords = extractBioKeywords(accountProfile.bio, accountProfile.category, accountProfile.username);
            const detectedCountry = detectCountry(accountProfile.external_url, accountProfile.bio, accountProfile.city_name, accountProfile.phone_country_code, accountProfile.address_street);

            // Email : IG business email + scraping site web si pas d'email IG
            let scrapedEmails = [];
            if (!accountProfile.business_email && accountProfile.external_url && !isLinkInBio(accountProfile.external_url)) {
              try {
                const websiteResult = await findEmailsFromWebsite(accountProfile.external_url);
                scrapedEmails = websiteResult.emails || [];
                // Récupérer le téléphone du site si pas de téléphone IG
                if (!accountProfile.phone_number && websiteResult.phones?.length > 0) {
                  accountProfile.phone_number = websiteResult.phones[0];
                }
              } catch (err) {
                logger.warn(`⚠️ Erreur scraping site ${accountProfile.external_url}: ${err.message}`);
              }
            }
            const bestEmailResult = pickBestEmail(accountProfile.business_email, scrapedEmails);

            // Insérer dans la DB
            db.prepare(`
              INSERT OR IGNORE INTO instagram_scraped_accounts
                (job_id, instagram_username, instagram_user_id, full_name, bio, website, external_url,
                 business_email, category, is_business, is_private, follower_count, following_count,
                 business_type, bio_keywords, best_email, email_source, email_confidence,
                 scraped_emails, country, city_name, phone_country_code, phone_number, address_street, scraping_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done')
            `).run(
              jobId, accountProfile.username, accountProfile.user_id,
              accountProfile.full_name, accountProfile.bio,
              accountProfile.external_url, accountProfile.external_url,
              accountProfile.business_email, accountProfile.category,
              accountProfile.is_business, accountProfile.is_private,
              accountProfile.follower_count, accountProfile.following_count,
              businessType, JSON.stringify(bioKeywords),
              bestEmailResult?.email || null, bestEmailResult?.source || null, bestEmailResult?.confidence || null,
              scrapedEmails.length > 0 ? JSON.stringify(scrapedEmails) : null,
              detectedCountry, accountProfile.city_name || null,
              accountProfile.phone_country_code || null, accountProfile.phone_number || null, accountProfile.address_street || null
            );

            // Vérifier doublons lead
            if (bestEmailResult?.email) {
              const dup = checkDuplicates(db, { best_email: bestEmailResult.email, external_url: accountProfile.external_url });
              if (dup.duplicate) {
                db.prepare("UPDATE instagram_scraped_accounts SET existing_lead_email = ? WHERE job_id = ? AND instagram_username = ?")
                  .run(dup.existing_email || 'duplicate', jobId, accountProfile.username);
              }
            }

            newAccountsFound++;
            progress.new_accounts_found = newAccountsFound;
            progress.duplicates_skipped = duplicatesSkipped;

            // Mettre à jour les compteurs du job
            db.prepare("UPDATE instagram_scrape_jobs SET processed = ?, emails_found = (SELECT COUNT(*) FROM instagram_scraped_accounts WHERE job_id = ? AND best_email IS NOT NULL), total_following = ?, search_progress = ?, updated_at = datetime('now') WHERE id = ?")
              .run(newAccountsFound, jobId, maxAccounts, JSON.stringify(progress), jobId);

          } catch (err) {
            logger.warn(`⚠️ Erreur traitement @${user.username} (category search): ${err.message}`);
          }
        }

        if (newAccountsFound >= maxAccounts) break;

        // Délai entre les recherches
        await jitteredDelay(3000);
      }

      // Marquer la ville comme complétée
      progress.cities_completed.push(city);
      progress.current_city = null;
      progress.new_accounts_found = newAccountsFound;
      progress.duplicates_skipped = duplicatesSkipped;
      db.prepare("UPDATE instagram_scrape_jobs SET search_progress = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(progress), jobId);

      if (newAccountsFound >= maxAccounts) break;
    }

    // Job terminé
    const emailsFound = db.prepare("SELECT COUNT(*) as count FROM instagram_scraped_accounts WHERE job_id = ? AND best_email IS NOT NULL").get(jobId).count;
    db.prepare(`
      UPDATE instagram_scrape_jobs
      SET status = 'completed', processed = ?, emails_found = ?, total_following = ?,
          search_progress = ?, updated_at = datetime('now'), completed_at = datetime('now')
      WHERE id = ?
    `).run(newAccountsFound, emailsFound, maxAccounts, JSON.stringify(progress), jobId);

    logger.info(`✅ IG Category Job ${jobId} terminé: ${newAccountsFound} comptes trouvés, ${duplicatesSkipped} doublons ignorés`);

  } catch (err) {
    logger.error(`❌ IG Category Job ${jobId} erreur:`, err.message);
    db.prepare("UPDATE instagram_scrape_jobs SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?")
      .run(err.message, jobId);
  } finally {
    activeJobs.delete(jobId);
  }
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
  privateHeaders,
  webHeaders,
  getProxyDispatcher: () => igProxyDispatcher,
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
  searchUsers,
  processCategorySearchJob,
  SEARCH_CITIES,
  CATEGORY_SEARCH_TERMS,
  CATEGORY_EXCLUDE_KEYWORDS,
};
