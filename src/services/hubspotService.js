/**
 * hubspotService.js — Intégration HubSpot CRM API v3
 * - Recherche companies par nom / domaine email
 * - Crée/met à jour contacts + association company
 * - Logue les emails dans la timeline
 * - Crée une task J+7 en fin de séquence (assignée à Hugo Montiel id:450706644)
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

const HUBSPOT_BASE = 'https://api.hubapi.com';
const HUGO_OWNER_ID = '450706644';

function getApiKey() {
  return process.env.HUBSPOT_API_KEY;
}

// ─── Fetch avec retry ─────────────────────────────────────────────────────────
async function hubspotFetch(path, options = {}, tentative = 1) {
  const API_KEY = getApiKey();
  if (!API_KEY) return null;

  const url = `${HUBSPOT_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (res.status === 429 && tentative <= 3) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '10') * 1000;
    await new Promise(r => setTimeout(r, retryAfter));
    return hubspotFetch(path, options, tentative + 1);
  }
  if (res.status >= 500 && tentative <= 3) {
    await new Promise(r => setTimeout(r, 2000 * tentative));
    return hubspotFetch(path, options, tentative + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

function logHubspot(db, type, action, leadId, hubspotId, payload, erreur = null) {
  try {
    db.prepare(`INSERT INTO hubspot_logs (id, type, action, lead_id, hubspot_id, payload, erreur)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), type, action, leadId, hubspotId, JSON.stringify(payload), erreur);
  } catch (e) {}
}

// ─── Rechercher des companies par nom ────────────────────────────────────────
async function rechercherCompanies(query) {
  if (!getApiKey() || !query) return [];
  try {
    const res = await hubspotFetch('/crm/v3/objects/companies/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: query }]
        }],
        properties: ['name', 'domain', 'city', 'phone'],
        limit: 10,
      }),
    });
    return (res?.results || []).map(c => ({
      id: c.id,
      nom: c.properties.name,
      domaine: c.properties.domain,
      ville: c.properties.city,
    }));
  } catch (err) {
    logger.error('HubSpot rechercherCompanies', { error: err.message });
    return [];
  }
}

// ─── Chercher une company par domaine email ───────────────────────────────────
async function trouverCompanyParDomaine(domaine) {
  if (!getApiKey() || !domaine) return null;
  try {
    const res = await hubspotFetch('/crm/v3/objects/companies/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: 'domain', operator: 'EQ', value: domaine }]
        }],
        properties: ['name', 'domain', 'city'],
        limit: 1,
      }),
    });
    const c = res?.results?.[0];
    return c ? { id: c.id, nom: c.properties.name, domaine: c.properties.domain } : null;
  } catch (err) {
    return null;
  }
}

// ─── Créer une company ────────────────────────────────────────────────────────
async function creerCompany(nom, domaine, ville) {
  try {
    const res = await hubspotFetch('/crm/v3/objects/companies', {
      method: 'POST',
      body: JSON.stringify({
        properties: { name: nom, domain: domaine || '', city: ville || '' }
      }),
    });
    return res?.id || null;
  } catch (err) {
    logger.error('HubSpot creerCompany', { error: err.message });
    return null;
  }
}

// ─── Contacts d'une company ───────────────────────────────────────────────────
async function contactsDeCompany(companyId) {
  if (!getApiKey() || !companyId) return [];
  try {
    const res = await hubspotFetch(
      `/crm/v3/objects/companies/${companyId}/associations/contacts`
    );
    const ids = (res?.results || []).map(r => r.id);
    if (!ids.length) return [];

    const details = await hubspotFetch('/crm/v3/objects/contacts/batch/read', {
      method: 'POST',
      body: JSON.stringify({
        inputs: ids.map(id => ({ id })),
        properties: ['firstname', 'lastname', 'email', 'jobtitle'],
      }),
    });
    return (details?.results || []).map(c => ({
      hubspot_id: c.id,
      prenom: c.properties.firstname || '',
      nom: c.properties.lastname || '',
      email: c.properties.email || '',
      poste: c.properties.jobtitle || '',
    }));
  } catch (err) {
    logger.error('HubSpot contactsDeCompany', { error: err.message });
    return [];
  }
}

// ─── Créer ou mettre à jour un contact + lier à la company ───────────────────
async function syncContact(db, lead) {
  if (!getApiKey()) return null;
  try {
    const payload = {
      properties: {
        email: lead.email,
        firstname: lead.prenom,
        lastname: lead.nom,
        company: lead.hotel,
        city: lead.ville,
        hubspot_owner_id: HUGO_OWNER_ID,
      }
    };

    let hubspotId = lead.hubspot_id;

    if (hubspotId) {
      await hubspotFetch(`/crm/v3/objects/contacts/${hubspotId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } else {
      // Tenter upsert par email
      try {
        const res = await hubspotFetch('/crm/v3/objects/contacts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        hubspotId = res?.id;
      } catch (err) {
        // Contact existe déjà — le retrouver par email
        if (err.message.includes('409') || err.message.includes('CONTACT_EXISTS')) {
          const search = await hubspotFetch('/crm/v3/objects/contacts/search', {
            method: 'POST',
            body: JSON.stringify({
              filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: lead.email }] }],
              limit: 1,
            }),
          });
          hubspotId = search?.results?.[0]?.id;
        } else throw err;
      }

      if (db && lead.id) {
        try { db.prepare('UPDATE leads SET hubspot_id = ? WHERE id = ?').run(hubspotId, lead.id); } catch(e) {}
      }
      logHubspot(db, 'contact', 'create', lead.id, hubspotId, payload);
    }

    // Lier à la company
    if (hubspotId) {
      const domaine = lead.email?.split('@')[1];
      let companyId = lead.company_hubspot_id;

      if (!companyId && domaine) {
        const company = await trouverCompanyParDomaine(domaine);
        if (company) {
          companyId = company.id;
        } else {
          companyId = await creerCompany(lead.hotel, domaine, lead.ville);
        }
      }

      if (companyId) {
        await hubspotFetch(`/crm/v3/associations/contacts/companies/batch/create`, {
          method: 'POST',
          body: JSON.stringify({
            inputs: [{ from: { id: hubspotId }, to: { id: companyId }, type: 'contact_to_company' }]
          }),
        }).catch(() => {});
      }
    }

    logger.info('✅ HubSpot contact sync', { email: lead.email, hubspotId });
    return hubspotId;
  } catch (err) {
    logger.error('❌ HubSpot syncContact ERREUR COMPLÈTE', { 
      error: err.message, 
      email: lead.email,
      hasApiKey: !!getApiKey(),
      apiKeyPrefix: getApiKey()?.slice(0, 10) + '...'
    });
    if (db) logHubspot(db, 'contact', 'error', lead.id, null, {}, err.message);
    return null;
  }
}

// ─── Logger un email dans la timeline HubSpot ────────────────────────────────
async function logEmailTimeline(db, lead, emailData) {
  if (!getApiKey() || !lead.hubspot_id) return;
  try {
    await hubspotFetch('/engagements/v1/engagements', {
      method: 'POST',
      body: JSON.stringify({
        engagement: { active: true, type: 'EMAIL', timestamp: Date.now(), ownerId: parseInt(HUGO_OWNER_ID) },
        associations: { contactIds: [parseInt(lead.hubspot_id)] },
        metadata: {
          from: { email: process.env.BREVO_SENDER_EMAIL || 'hugo@terredemars.com', firstName: 'Hugo', lastName: 'Montiel' },
          to: [{ email: lead.email }],
          subject: emailData.sujet,
          status: 'SENT',
          html: emailData.corps || '',
        }
      }),
    });
    logger.info('📝 HubSpot email loggé', { email: lead.email, sujet: emailData.sujet });
  } catch (err) {
    logger.error('❌ HubSpot logEmailTimeline', { error: err.message });
  }
}

// ─── Créer une task J+7 en fin de séquence ───────────────────────────────────
async function creerTaskFinSequence(db, lead, nomSequence) {
  if (!getApiKey()) return;
  try {
    const dateEcheance = Date.now() + 7 * 24 * 3600 * 1000; // J+7

    await hubspotFetch('/engagements/v1/engagements', {
      method: 'POST',
      body: JSON.stringify({
        engagement: {
          active: true,
          type: 'TASK',
          timestamp: Date.now(),
          ownerId: parseInt(HUGO_OWNER_ID),
        },
        associations: {
          contactIds: lead.hubspot_id ? [parseInt(lead.hubspot_id)] : [],
        },
        metadata: {
          subject: `Suivi — ${lead.prenom} ${lead.nom} · ${lead.hotel}`,
          body: `Séquence "${nomSequence}" terminée.\n\nAppeler ou relancer manuellement ${lead.prenom} ${lead.nom} (${lead.email}) de ${lead.hotel}.`,
          status: 'NOT_STARTED',
          taskType: 'CALL',
          reminders: [dateEcheance],
          completionDate: dateEcheance,
        }
      }),
    });
    logger.info('✅ HubSpot task créée J+7', { email: lead.email, sequence: nomSequence });
  } catch (err) {
    logger.error('❌ HubSpot creerTaskFinSequence', { error: err.message });
  }
}

// ─── Lifecycle stage ─────────────────────────────────────────────────────────
async function mettreAJourLifecycle(db, lead, stage) {
  if (!getApiKey() || !lead.hubspot_id) return;
  const stageMap = { 'lead': 'lead', 'MQL': 'marketingqualifiedlead', 'SQL': 'salesqualifiedlead', 'Converti': 'customer' };
  try {
    await hubspotFetch(`/crm/v3/objects/contacts/${lead.hubspot_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { lifecyclestage: stageMap[stage] || stage } }),
    });
  } catch (err) {
    logger.error('❌ HubSpot lifecycle', { error: err.message });
  }
}

// ─── Créer un Deal ────────────────────────────────────────────────────────────
async function creerDeal(db, lead) {
  if (!getApiKey()) return null;
  try {
    let hubspotId = lead.hubspot_id || await syncContact(db, lead);
    const res = await hubspotFetch('/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          dealname: `${lead.hotel} — Terre de Mars`,
          dealstage: 'appointmentscheduled',
          pipeline: 'default',
          hubspot_owner_id: HUGO_OWNER_ID,
          closedate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          description: `Lead généré via séquence. Segment: ${lead.segment}.`,
        }
      }),
    });
    const dealId = res?.id;
    if (dealId && hubspotId) {
      await hubspotFetch('/crm/v3/associations/deals/contacts/batch/create', {
        method: 'POST',
        body: JSON.stringify({
          inputs: [{ from: { id: dealId }, to: { id: hubspotId }, type: 'deal_to_contact' }]
        }),
      }).catch(() => {});
    }
    logHubspot(db, 'deal', 'create', lead.id, dealId, { hotel: lead.hotel });
    logger.info('💼 HubSpot Deal créé', { hotel: lead.hotel, dealId });
    return dealId;
  } catch (err) {
    logger.error('❌ HubSpot creerDeal', { error: err.message });
    return null;
  }
}

// ─── Vérifier la connexion ────────────────────────────────────────────────────
async function verifierConnexion() {
  if (!getApiKey()) return { connecte: false, raison: 'Clé API non configurée' };
  try {
    await hubspotFetch('/crm/v3/objects/contacts?limit=1');
    return { connecte: true };
  } catch (err) {
    return { connecte: false, raison: err.message };
  }
}

module.exports = {
  syncContact,
  logEmailTimeline,
  mettreAJourLifecycle,
  creerDeal,
  creerTaskFinSequence,
  verifierConnexion,
  rechercherCompanies,
  contactsDeCompany,
  trouverCompanyParDomaine,
};
