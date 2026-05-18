/**
 * hubspotExport.js — Export d'opportunités veille vers HubSpot
 *
 * Crée/met à jour :
 * - Company HubSpot avec custom properties (tdm_business_score, tdm_signals_summary)
 * - Contacts HubSpot avec email vérifié et rôle
 * - Deal liée avec business score et angle commercial
 *
 * Utilise l'API HubSpot CRM v3 existante via le pattern hubspotFetch.
 *
 * Dépendances : env HUBSPOT_API_KEY
 */

const logger = require('../../config/logger');

// ─── Config ─────────────────────────────────────────────────────────────────

function getApiKey() {
  return process.env.HUBSPOT_API_KEY || '';
}

async function hubspotFetch(path, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const url = `https://api.hubapi.com${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HubSpot ${res.status}: ${body.substring(0, 300)}`);
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ─── Recherche Company existante ────────────────────────────────────────────

async function findCompanyByName(name) {
  if (!getApiKey() || !name) return null;

  try {
    const data = await hubspotFetch('/crm/v3/objects/companies/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: 'name',
            operator: 'CONTAINS_TOKEN',
            value: name,
          }],
        }],
        properties: ['name', 'domain', 'city', 'hs_object_id'],
        limit: 5,
      }),
    });
    return data?.results?.[0] || null;
  } catch (err) {
    logger.warn(`HubSpot findCompany: ${err.message}`);
    return null;
  }
}

// ─── Créer ou mettre à jour la Company ──────────────────────────────────────

async function upsertCompany(opportunity) {
  if (!getApiKey()) return null;

  // Chercher si la company existe déjà
  const existing = await findCompanyByName(opportunity.hotel_name);

  const properties = {
    name: opportunity.hotel_name,
    city: opportunity.city || '',
    industry: 'HOSPITALITY',
    tdm_business_score: String(opportunity.business_score || 0),
    tdm_signal_type: opportunity.signal_type || '',
    description: buildCompanyDescription(opportunity),
  };

  if (opportunity.website) {
    properties.domain = opportunity.website;
    properties.website = opportunity.website;
  }

  if (opportunity.stars) {
    properties.tdm_stars = opportunity.stars;
  }

  try {
    if (existing) {
      // Mettre à jour
      const data = await hubspotFetch(`/crm/v3/objects/companies/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
      return { id: data.id, created: false };
    } else {
      // Créer
      const data = await hubspotFetch('/crm/v3/objects/companies', {
        method: 'POST',
        body: JSON.stringify({ properties }),
      });
      return { id: data.id, created: true };
    }
  } catch (err) {
    logger.error(`HubSpot upsertCompany: ${err.message}`);
    throw err;
  }
}

function buildCompanyDescription(opp) {
  const lines = [];
  lines.push(`[TDM Veille] Score: ${opp.business_score}/100`);
  if (opp.signal_type) lines.push(`Signal dominant: ${opp.signal_type}`);
  if (opp.recommended_angle) lines.push(`Angle: ${opp.recommended_angle}`);
  if (opp.group_name) lines.push(`Groupe: ${opp.group_name}`);
  if (opp.region) lines.push(`Région: ${opp.region}`);
  return lines.join('\n');
}

// ─── Créer un Contact HubSpot ───────────────────────────────────────────────

async function createHubspotContact(contact, companyId) {
  if (!getApiKey()) return null;

  try {
    // Vérifier si le contact existe déjà par email
    if (contact.email) {
      try {
        const existing = await hubspotFetch(`/crm/v3/objects/contacts/${contact.email}?idProperty=email`);
        if (existing?.id) {
          // Associer à la company si pas déjà fait
          if (companyId) {
            await associateContactToCompany(existing.id, companyId).catch(() => {});
          }
          return { id: existing.id, created: false };
        }
      } catch (_) { /* pas trouvé, on crée */ }
    }

    const properties = {
      firstname: contact.first_name || '',
      lastname: contact.last_name || '',
      jobtitle: contact.role || '',
    };

    if (contact.email && contact.email_status !== 'invalid') {
      properties.email = contact.email;
    }

    if (contact.phone) {
      properties.phone = contact.phone;
    }

    if (contact.linkedin_url) {
      properties.hs_linkedin_url = contact.linkedin_url;
    }

    const data = await hubspotFetch('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties }),
    });

    // Associer à la company
    if (data?.id && companyId) {
      await associateContactToCompany(data.id, companyId).catch(() => {});
    }

    return { id: data.id, created: true };
  } catch (err) {
    logger.warn(`HubSpot createContact [${contact.full_name}]: ${err.message}`);
    return null;
  }
}

async function associateContactToCompany(contactId, companyId) {
  return hubspotFetch(`/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`, {
    method: 'PUT',
  });
}

// ─── Créer un Deal HubSpot ──────────────────────────────────────────────────

async function createDeal(opportunity, companyId) {
  if (!getApiKey()) return null;

  const signalLabel = getSignalLabel(opportunity.signal_type);

  const properties = {
    dealname: `[Veille] ${opportunity.hotel_name} — ${signalLabel}`,
    pipeline: 'default',
    dealstage: 'appointmentscheduled', // Premier stage du pipeline par défaut
    tdm_business_score: String(opportunity.business_score || 0),
    description: buildDealDescription(opportunity),
  };

  try {
    const data = await hubspotFetch('/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({ properties }),
    });

    // Associer à la company
    if (data?.id && companyId) {
      await hubspotFetch(`/crm/v3/objects/deals/${data.id}/associations/companies/${companyId}/deal_to_company`, {
        method: 'PUT',
      }).catch(() => {});
    }

    return { id: data.id, created: true };
  } catch (err) {
    logger.error(`HubSpot createDeal: ${err.message}`);
    throw err;
  }
}

function buildDealDescription(opp) {
  const lines = [];
  lines.push(`Score business: ${opp.business_score}/100`);
  if (opp.signal_type) lines.push(`Signal dominant: ${opp.signal_type}`);
  if (opp.recommended_angle) lines.push(`\nAngle commercial:\n${opp.recommended_angle}`);
  if (opp.source_count) lines.push(`\nSources: ${opp.source_count}`);
  if (opp.project_date) lines.push(`Date projet: ${opp.project_date}`);
  lines.push(`\n---\nExporté depuis TDM Veille le ${new Date().toLocaleDateString('fr-FR')}`);
  return lines.join('\n');
}

function getSignalLabel(signalType) {
  const labels = {
    'renovation': 'Rénovation',
    'press_renovation': 'Rénovation',
    'google_review_drop': 'Rénovation probable',
    'google_review_keyword': 'Travaux confirmés',
    'booking_unavailable_long': 'Fermeture longue',
    'permis_construire': 'Permis de construire',
    'boamp_marche': 'Marché public',
    'linkedin_preopening_job': 'Pré-ouverture',
    'bodacc_movement': 'Changement direction',
    'ouverture': 'Ouverture',
    'repositionnement': 'Repositionnement',
    'nomination': 'Nomination',
    'acquisition': 'Acquisition',
  };
  return labels[signalType] || signalType || 'Signal détecté';
}

// ─── Export complet d'une opportunité ───────────────────────────────────────

/**
 * Exporte une opportunité complète vers HubSpot :
 * Company + Contacts + Deal.
 *
 * @param {Object} db
 * @param {string} opportunityId
 * @returns {Object} { company, contacts[], deal }
 */
async function exportToHubspot(db, opportunityId) {
  if (!getApiKey()) {
    return { error: 'Clé API HubSpot non configurée' };
  }

  const opp = db.prepare('SELECT * FROM veille_opportunities WHERE id = ?').get(opportunityId);
  if (!opp) return { error: 'Opportunité introuvable' };

  const results = { company: null, contacts: [], deal: null };

  // 1. Company
  try {
    results.company = await upsertCompany(opp);

    // Sauvegarder l'ID HubSpot
    if (results.company?.id) {
      db.prepare("UPDATE veille_opportunities SET hubspot_company_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(results.company.id, opportunityId);
    }
  } catch (err) {
    logger.error(`HubSpot export company [${opp.hotel_name}]: ${err.message}`);
    results.companyError = err.message;
  }

  // 2. Contacts
  const contacts = db.prepare(`
    SELECT * FROM veille_contacts
    WHERE opportunity_id = ? AND email_status IN ('valid', 'catch_all', 'unverified')
    ORDER BY role_relevance DESC
  `).all(opportunityId);

  for (const contact of contacts) {
    try {
      const hsContact = await createHubspotContact(contact, results.company?.id);
      if (hsContact) {
        results.contacts.push({ contactId: contact.id, hubspotId: hsContact.id, created: hsContact.created });
      }
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      logger.warn(`HubSpot export contact [${contact.full_name}]: ${err.message}`);
    }
  }

  // 3. Deal
  try {
    results.deal = await createDeal(opp, results.company?.id);

    if (results.deal?.id) {
      db.prepare("UPDATE veille_opportunities SET hubspot_deal_id = ?, status = 'qualified', updated_at = datetime('now') WHERE id = ?")
        .run(results.deal.id, opportunityId);

      // Associer les contacts au deal
      for (const c of results.contacts) {
        if (c.hubspotId) {
          try {
            await hubspotFetch(`/crm/v3/objects/deals/${results.deal.id}/associations/contacts/${c.hubspotId}/deal_to_contact`, {
              method: 'PUT',
            });
          } catch (_) { /* ignore */ }
        }
      }
    }
  } catch (err) {
    logger.error(`HubSpot export deal [${opp.hotel_name}]: ${err.message}`);
    results.dealError = err.message;
  }

  logger.info(`HubSpot export [${opp.hotel_name}]: company=${results.company?.id || 'FAIL'}, contacts=${results.contacts.length}, deal=${results.deal?.id || 'FAIL'}`);

  return results;
}

module.exports = {
  exportToHubspot,
  upsertCompany,
  createHubspotContact,
  createDeal,
  findCompanyByName,
};
