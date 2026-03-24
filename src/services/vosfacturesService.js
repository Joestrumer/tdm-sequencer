/**
 * vosfacturesService.js — Proxy VosFactures API (multi-user support)
 */

const logger = require('../config/logger');
const VF_BASE_URL = process.env.VF_BASE_URL || 'https://terredemars.vosfactures.fr';

function getToken(db, userToken) {
  if (userToken) return userToken;
  const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get('vf_api_token');
  const token = (row?.valeur || process.env.VF_API_TOKEN || '').trim();
  if (token) logger.debug(`🔑 VF token: ${token.substring(0, 6)}... (${token.length} chars)`);
  return token;
}

async function vfFetch(path, opts = {}, db, userToken) {
  const token = getToken(db, userToken);
  if (!token) throw new Error('Token VosFactures non configuré');

  const url = `${VF_BASE_URL}${path}${path.includes('?') ? '&' : '?'}api_token=${token}`;
  const maxRetries = opts.retries || 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.timeout || 15000);

      const res = await fetch(url, {
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 429 && attempt < maxRetries) {
        const wait = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        logger.debug(`⏳ VF rate limit, retry ${attempt}/${maxRetries} dans ${Math.round(wait)}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`VF API ${res.status}: ${text.slice(0, 500)}`);
      }

      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * attempt));
          continue;
        }
        throw new Error('VF API timeout après ' + maxRetries + ' tentatives');
      }
      if (attempt === maxRetries) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

// Cache mémoire par token (pour supporter multi-user)
const cacheByToken = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCache(userToken, db) {
  const key = userToken || getToken(db, null) || '_default';
  if (!cacheByToken.has(key)) {
    cacheByToken.set(key, { products: null, productsTime: 0, clients: null, clientsTime: 0 });
  }
  return cacheByToken.get(key);
}

module.exports = (db, userToken = null) => ({
  async testConnexion() {
    try {
      await vfFetch('/invoices.json?page=1&per_page=1', { timeout: 8000 }, db, userToken);
      return { ok: true };
    } catch (e) {
      return { ok: false, erreur: e.message };
    }
  },

  async getAllClients(forceRefresh = false) {
    const cache = getCache(userToken, db);
    if (!forceRefresh && cache.clients && Date.now() - cache.clientsTime < CACHE_TTL) {
      return cache.clients;
    }
    const allClients = [];
    let page = 1;
    while (true) {
      const data = await vfFetch(`/clients.json?page=${page}&per_page=100`, {}, db, userToken);
      if (!Array.isArray(data) || data.length === 0) break;
      allClients.push(...data);
      if (data.length < 100) break;
      page++;
    }
    allClients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    cache.clients = allClients;
    cache.clientsTime = Date.now();
    logger.debug(`📇 ${allClients.length} clients VF chargés en cache`);
    return allClients;
  },

  async rechercherClients(query) {
    const all = await this.getAllClients();
    if (!query || query.length < 2) return all.slice(0, 50);
    const term = query.toLowerCase();
    return all.filter(c =>
      (c.name || '').toLowerCase().includes(term) ||
      (c.shortcut || '').toLowerCase().includes(term) ||
      (c.city || '').toLowerCase().includes(term)
    ).slice(0, 30);
  },

  async getClient(id) {
    return vfFetch(`/clients/${id}.json`, {}, db, userToken);
  },

  async getAllProducts(forceRefresh = false) {
    const cache = getCache(userToken, db);
    if (!forceRefresh && cache.products && Date.now() - cache.productsTime < CACHE_TTL) {
      return cache.products;
    }

    const allProducts = [];
    let page = 1;
    while (true) {
      const data = await vfFetch(`/products.json?page=${page}&per_page=100`, {}, db, userToken);
      if (!Array.isArray(data) || data.length === 0) break;
      allProducts.push(...data);
      if (data.length < 100) break;
      page++;
    }
    cache.products = allProducts;
    cache.productsTime = Date.now();
    return allProducts;
  },

  async creerFacture(data) {
    return vfFetch('/invoices.json', {
      method: 'POST',
      body: { invoice: data },
    }, db, userToken);
  },

  async getFacture(id) {
    return vfFetch(`/invoices/${id}.json`, {}, db, userToken);
  },

  async rechercherFacture(number) {
    return vfFetch(`/invoices.json?number=${encodeURIComponent(number)}`, {}, db, userToken);
  },

  async envoyerEmail(id, opts = {}) {
    return vfFetch(`/invoices/${id}/send_by_email.json`, {
      method: 'POST',
      body: opts,
    }, db, userToken);
  },

  async envoyerRelance(id, opts = {}) {
    try {
      return await vfFetch(`/invoices/${id}/send_reminder.json`, {
        method: 'POST',
        body: opts,
      }, db, userToken);
    } catch (e) {
      logger.debug('⚠️ send_reminder indisponible, fallback send_by_email');
      return await vfFetch(`/invoices/${id}/send_by_email.json`, {
        method: 'POST',
        body: opts,
      }, db, userToken);
    }
  },
});
