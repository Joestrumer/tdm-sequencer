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

const IG_API_BASE = 'https://i.instagram.com/api/v1';
const IG_WEB_BASE = 'https://www.instagram.com/api/v1';
const IG_APP_ID = '936619743392459';
const IG_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_DELAY_MS = 2500; // Délai entre requêtes IG
const JITTER_MAX_MS = 1000;    // Jitter aléatoire ajouté au délai

// ─── Classification business par bio ────────────────────────────────────────

const BUSINESS_KEYWORDS = {
  hotel: ['hotel', 'hôtel', 'resort', 'lodge', 'boutique hotel', 'palace', 'auberge', 'gîte', 'chambre d\'hôte', 'maison d\'hôte', 'relais', 'château hotel'],
  restaurant: ['restaurant', 'bistrot', 'brasserie', 'gastronomie', 'chef', 'traiteur', 'cuisine', 'table'],
  spa: ['spa', 'bien-être', 'wellness', 'massage', 'soin', 'détente', 'hammam', 'sauna'],
  hospitality: ['hospitality', 'hôtellerie', 'tourisme', 'travel', 'voyage', 'conciergerie', 'hébergement'],
  retail: ['boutique', 'concept store', 'shop', 'e-shop', 'mode', 'fashion'],
  bar: ['bar', 'cocktail', 'wine bar', 'rooftop', 'lounge'],
  event: ['événement', 'event', 'mariage', 'wedding', 'réception', 'séminaire', 'traiteur'],
};

// ─── État interne des jobs actifs ───────────────────────────────────────────

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
 * Fetch l'API privée Instagram avec headers requis, retry et backoff
 */
async function igFetch(endpoint, credentials, retries = 3) {
  const url = endpoint.startsWith('http') ? endpoint : `${IG_API_BASE}${endpoint}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': IG_USER_AGENT,
          'Cookie': `sessionid=${credentials.sessionId}; csrftoken=${credentials.csrfToken}`,
          'X-CSRFToken': credentials.csrfToken,
          'X-IG-App-ID': IG_APP_ID,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        const delay = Math.min(5000 * Math.pow(2, attempt), 30000);
        logger.warn(`⚠️ IG API 429 rate limited, pause ${delay}ms`);
        await sleep(delay);
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error('Session Instagram expirée ou invalide. Veuillez reconfigurer vos credentials.');
      }

      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch { /* ignore */ }
        logger.warn(`⚠️ IG API ${res.status} ${res.statusText} - ${url} - ${body.slice(0, 200)}`);
        throw new Error(`IG API ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.warn(`⚠️ IG API timeout (tentative ${attempt + 1}/${retries})`);
      } else if (attempt < retries - 1) {
        const delay = 1000 * Math.pow(2, attempt) + Math.random() * 1000;
        logger.warn(`⚠️ IG API erreur (tentative ${attempt + 1}/${retries}): ${err.message}, retry dans ${Math.round(delay)}ms`);
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
 * Récupère le profil d'un utilisateur Instagram via l'API web
 */
async function fetchUserProfile(username, credentials) {
  const data = await igFetch(`${IG_WEB_BASE}/users/web_profile_info/?username=${encodeURIComponent(username)}`, credentials);
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
  };
}

/**
 * Récupère la liste paginée des "following" d'un utilisateur
 */
async function fetchFollowingList(userId, credentials, maxAccounts = 500) {
  const following = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore && following.length < maxAccounts) {
    let endpoint = `/friendships/${userId}/following/?count=50`;
    if (cursor) endpoint += `&max_id=${cursor}`;

    const data = await igFetch(endpoint, credentials);

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

    hasMore = data.next_max_id != null;
    cursor = data.next_max_id;

    if (hasMore && following.length < maxAccounts) {
      await jitteredDelay();
    }
  }

  return following;
}

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Classifie le type business d'un compte depuis sa bio et catégorie IG
 */
function classifyBusiness(bio, category) {
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

      try {
        // Récupérer le profil détaillé
        await jitteredDelay();
        let accountProfile;
        try {
          accountProfile = await fetchUserProfile(user.username, credentials);
        } catch (err) {
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

        // Classification business
        const businessType = classifyBusiness(accountProfile.bio, accountProfile.category);
        const bioKeywords = extractBioKeywords(accountProfile.bio, accountProfile.category);

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
                  business_type = ?, bio_keywords = ?,
                  scraping_status = 'skipped', scraping_error = 'Ne correspond pas aux filtres'
              WHERE job_id = ? AND instagram_username = ?
            `).run(
              accountProfile.bio, accountProfile.external_url, accountProfile.business_email,
              accountProfile.category, accountProfile.is_business, accountProfile.is_private,
              accountProfile.follower_count, accountProfile.following_count,
              businessType, JSON.stringify(bioKeywords),
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
              scraping_status = 'done'
          WHERE job_id = ? AND instagram_username = ?
        `).run(
          accountProfile.full_name, accountProfile.bio, accountProfile.external_url, accountProfile.external_url,
          accountProfile.business_email, accountProfile.category, accountProfile.is_business, accountProfile.is_private,
          accountProfile.follower_count, accountProfile.following_count,
          businessType, JSON.stringify(bioKeywords),
          bestEmailResult?.email || null, bestEmailResult?.source || null, bestEmailResult?.confidence || null,
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

    const website = account.external_url || account.website;
    if (!website) {
      results.errors++;
      continue;
    }

    try {
      db.prepare("UPDATE instagram_scraped_accounts SET scraping_status = 'scraping_website' WHERE id = ?").run(accountId);

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
  BUSINESS_KEYWORDS,
};
