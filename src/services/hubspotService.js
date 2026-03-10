/**
 * hubspotService.js — Intégration HubSpot CRM API v3
 *
 * Fonctionnalités :
 *  - Créer / mettre à jour un contact
 *  - Logger les emails envoyés dans la timeline HubSpot
 *  - Créer un Deal si le lead répond
 *  - Mettre à jour le lifecycle stage (Lead → MQL → SQL)
 *  - Retry automatique sur les erreurs 429/5xx
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

const HUBSPOT_BASE = 'https://api.hubapi.com';
const API_KEY = process.env.HUBSPOT_API_KEY;

// ─── Fetch avec retry et gestion des rate limits ─────────────────────────────
async function hubspotFetch(path, options = {}, tentative = 1) {
  if (!API_KEY) {
    logger.debug('HubSpot désactivé (pas de clé API configurée)');
    return null;
  }

  const url = `${HUBSPOT_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Rate limit HubSpot : 100 req/10s — attendre et réessayer
  if (res.status === 429 && tentative <= 3) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '10') * 1000;
    logger.warn(`HubSpot rate limit, retry dans ${retryAfter}ms (tentative ${tentative}/3)`);
    await new Promise(r => setTimeout(r, retryAfter));
    return hubspotFetch(path, options, tentative + 1);
  }

  // Erreurs serveur : retry avec backoff
  if (res.status >= 500 && tentative <= 3) {
    const delai = 2000 * tentative;
    logger.warn(`HubSpot erreur ${res.status}, retry dans ${delai}ms (tentative ${tentative}/3)`);
    await new Promise(r => setTimeout(r, delai));
    return hubspotFetch(path, options, tentative + 1);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot API ${res.status}: ${body}`);
  }

  return res.status === 204 ? null : res.json();
}

// ─── Logger le résultat dans la table hubspot_logs ───────────────────────────
function logHubspot(db, type, action, leadId, hubspotId, payload, erreur = null) {
  try {
    db.prepare(`
      INSERT INTO hubspot_logs (id, type, action, lead_id, hubspot_id, payload, erreur)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), type, action, leadId, hubspotId, JSON.stringify(payload), erreur);
  } catch (e) {
    logger.error('Erreur log HubSpot', { error: e.message });
  }
}

// ─── Créer ou mettre à jour un contact HubSpot ───────────────────────────────
async function syncContact(db, lead) {
  if (!API_KEY) return null;

  try {
    const payload = {
      properties: {
        email: lead.email,
        firstname: lead.prenom,
        lastname: lead.nom,
        company: lead.hotel,
        city: lead.ville,
        // Propriété custom : segment Terre de Mars
        tdm_segment: lead.segment,
      }
    };

    let hubspotId = lead.hubspot_id;

    if (hubspotId) {
      // Mise à jour
      await hubspotFetch(`/crm/v3/objects/contacts/${hubspotId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      logHubspot(db, 'contact', 'update', lead.id, hubspotId, payload);
    } else {
      // Création
      const res = await hubspotFetch('/crm/v3/objects/contacts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      hubspotId = res?.id;

      // Sauvegarder l'ID HubSpot dans la base locale
      db.prepare('UPDATE leads SET hubspot_id = ? WHERE id = ?').run(hubspotId, lead.id);
      logHubspot(db, 'contact', 'create', lead.id, hubspotId, payload);
    }

    logger.info('✅ HubSpot contact synchronisé', { email: lead.email, hubspotId });
    return hubspotId;
  } catch (err) {
    logger.error('❌ HubSpot syncContact échoué', { email: lead.email, error: err.message });
    logHubspot(db, 'contact', 'error', lead.id, null, {}, err.message);
    return null;
  }
}

// ─── Logger un email dans la timeline HubSpot ────────────────────────────────
async function logEmailTimeline(db, lead, emailData) {
  if (!API_KEY || !lead.hubspot_id) return;

  try {
    const eventTypeId = '1'; // ID de type d'événement timeline (à créer dans HubSpot ou utiliser engagement)

    // Utiliser l'API Engagements pour logger l'email
    const engagement = {
      engagement: {
        active: true,
        type: 'EMAIL',
        timestamp: Date.now(),
      },
      associations: {
        contactIds: [parseInt(lead.hubspot_id)],
      },
      metadata: {
        from: { email: process.env.BREVO_SENDER_EMAIL, firstName: 'Joe', lastName: 'Terre de Mars' },
        to: [{ email: lead.email }],
        subject: emailData.sujet,
        status: 'SENT',
        html: `Email de séquence envoyé via Terre de Mars Sequencer`,
      }
    };

    await hubspotFetch('/engagements/v1/engagements', {
      method: 'POST',
      body: JSON.stringify(engagement),
    });

    logHubspot(db, 'engagement', 'create', lead.id, lead.hubspot_id, { type: 'EMAIL', sujet: emailData.sujet });
    logger.info('📝 HubSpot engagement email loggé', { email: lead.email });
  } catch (err) {
    logger.error('❌ HubSpot logEmailTimeline échoué', { error: err.message });
    logHubspot(db, 'engagement', 'error', lead.id, lead.hubspot_id, {}, err.message);
  }
}

// ─── Mettre à jour le lifecycle stage ────────────────────────────────────────
async function mettreAJourLifecycle(db, lead, stage) {
  // Stages valides : 'lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer'
  if (!API_KEY || !lead.hubspot_id) return;

  const stageMap = {
    'lead': 'lead',
    'MQL': 'marketingqualifiedlead',
    'SQL': 'salesqualifiedlead',
    'Converti': 'customer',
  };

  const hsStage = stageMap[stage] || stage;

  try {
    await hubspotFetch(`/crm/v3/objects/contacts/${lead.hubspot_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { lifecyclestage: hsStage } }),
    });
    logHubspot(db, 'lifecycle', 'update', lead.id, lead.hubspot_id, { stage: hsStage });
    logger.info(`🏷️  HubSpot lifecycle mis à jour : ${stage}`, { email: lead.email });
  } catch (err) {
    logger.error('❌ HubSpot lifecycle update échoué', { error: err.message });
    logHubspot(db, 'lifecycle', 'error', lead.id, lead.hubspot_id, { stage }, err.message);
  }
}

// ─── Créer un Deal HubSpot si le lead répond ─────────────────────────────────
async function creerDeal(db, lead) {
  if (!API_KEY) return null;

  try {
    // S'assurer que le contact est synchronisé
    let hubspotId = lead.hubspot_id;
    if (!hubspotId) hubspotId = await syncContact(db, lead);

    const deal = {
      properties: {
        dealname: `${lead.hotel} — Terre de Mars`,
        dealstage: 'appointmentscheduled', // Adapter selon votre pipeline HubSpot
        pipeline: 'default',
        amount: '',
        closedate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), // +30 jours
        hubspot_owner_id: '',
        description: `Lead généré via séquence email automatique. Segment: ${lead.segment}. Ville: ${lead.ville}.`,
      }
    };

    const res = await hubspotFetch('/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify(deal),
    });

    const dealId = res?.id;

    // Associer le deal au contact
    if (dealId && hubspotId) {
      await hubspotFetch(`/crm/v3/associations/deals/contacts/batch/create`, {
        method: 'POST',
        body: JSON.stringify({
          inputs: [{ from: { id: dealId }, to: { id: hubspotId }, type: 'deal_to_contact' }]
        }),
      });
    }

    logHubspot(db, 'deal', 'create', lead.id, dealId, deal.properties);
    logger.info('💼 HubSpot Deal créé', { hotel: lead.hotel, dealId });

    // Mettre le lead en SQL
    await mettreAJourLifecycle(db, { ...lead, hubspot_id: hubspotId }, 'SQL');

    return dealId;
  } catch (err) {
    logger.error('❌ HubSpot creerDeal échoué', { error: err.message });
    logHubspot(db, 'deal', 'error', lead.id, null, {}, err.message);
    return null;
  }
}

// ─── Vérifier la connexion HubSpot ───────────────────────────────────────────
async function verifierConnexion() {
  if (!API_KEY) return { connecte: false, raison: 'Clé API non configurée' };
  try {
    const res = await hubspotFetch('/crm/v3/objects/contacts?limit=1');
    return { connecte: true, portailId: process.env.HUBSPOT_PORTAL_ID };
  } catch (err) {
    return { connecte: false, raison: err.message };
  }
}

module.exports = {
  syncContact,
  logEmailTimeline,
  mettreAJourLifecycle,
  creerDeal,
  verifierConnexion,
};
