/**
 * vosfacturesService.js — Proxy VosFactures API
 */

const logger = require('../config/logger');
const VF_BASE_URL = process.env.VF_BASE_URL || 'https://terredemars.vosfactures.fr';

function getToken(db) {
  const row = db.prepare('SELECT valeur FROM config WHERE cle = ?').get('vf_api_token');
  const token = (row?.valeur || process.env.VF_API_TOKEN || '').trim();
  if (token) logger.debug(`🔑 VF token: ${token.substring(0, 6)}... (${token.length} chars)`);
  return token;
}

async function vfFetch(path, opts = {}, db) {
  const token = getToken(db);
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
        const wait = Math.pow(2, attempt) * 1000;
        logger.debug(`⏳ VF rate limit, retry ${attempt}/${maxRetries} dans ${wait}ms`);
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

// Cache mémoire
let productsCache = null;
let productsCacheTime = 0;
let clientsCache = null;
let clientsCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

module.exports = (db) => ({
  async testConnexion() {
    try {
      await vfFetch('/invoices.json?page=1&per_page=1', { timeout: 8000 }, db);
      return { ok: true };
    } catch (e) {
      return { ok: false, erreur: e.message };
    }
  },

  async getAllClients(forceRefresh = false) {
    if (!forceRefresh && clientsCache && Date.now() - clientsCacheTime < CACHE_TTL) {
      return clientsCache;
    }
    const allClients = [];
    for (let page = 1; page <= 10; page++) {
      const data = await vfFetch(`/clients.json?page=${page}&per_page=100`, {}, db);
      if (!Array.isArray(data) || data.length === 0) break;
      allClients.push(...data);
      if (data.length < 100) break;
    }
    allClients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    clientsCache = allClients;
    clientsCacheTime = Date.now();
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
    return vfFetch(`/clients/${id}.json`, {}, db);
  },

  async getAllProducts(forceRefresh = false) {
    if (!forceRefresh && productsCache && Date.now() - productsCacheTime < CACHE_TTL) {
      return productsCache;
    }

    const allProducts = [];
    let page = 1;
    while (true) {
      const data = await vfFetch(`/products.json?page=${page}&per_page=100`, {}, db);
      if (!Array.isArray(data) || data.length === 0) break;
      allProducts.push(...data);
      if (data.length < 100) break;
      page++;
    }
    productsCache = allProducts;
    productsCacheTime = Date.now();
    return allProducts;
  },

  async creerFacture(data) {
    return vfFetch('/invoices.json', {
      method: 'POST',
      body: { invoice: data },
    }, db);
  },

  async getFacture(id) {
    return vfFetch(`/invoices/${id}.json`, {}, db);
  },

  async rechercherFacture(number) {
    return vfFetch(`/invoices.json?number=${encodeURIComponent(number)}`, {}, db);
  },

  async envoyerEmail(id, opts = {}) {
    return vfFetch(`/invoices/${id}/send_by_email.json`, {
      method: 'POST',
      body: opts,
    }, db);
  },

  async envoyerRelance(id, opts = {}) {
    try {
      return await vfFetch(`/invoices/${id}/send_reminder.json`, {
        method: 'POST',
        body: opts,
      }, db);
    } catch (e) {
      // Fallback vers send_by_email si send_reminder n'est pas disponible
      logger.debug('⚠️ send_reminder indisponible, fallback send_by_email');
      return await vfFetch(`/invoices/${id}/send_by_email.json`, {
        method: 'POST',
        body: opts,
      }, db);
    }
  },
});
