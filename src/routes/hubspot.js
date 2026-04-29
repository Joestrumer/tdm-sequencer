/**
 * hubspot.js — Routes HubSpot (webhook entrant + actions manuelles)
 */

const express  = require('express');
const router   = express.Router();
const logger   = require('../config/logger');
const hubspot  = require('../services/hubspotService');

module.exports = (db) => {

  // POST /api/hubspot/webhook — Webhook HubSpot (contact modifié)
  router.post('/webhook', express.json(), (req, res) => {
    res.sendStatus(200);
    setImmediate(async () => {
      try {
        const events = Array.isArray(req.body) ? req.body : [req.body];
        for (const event of events) {
          logger.info('Webhook HubSpot reçu', { type: event.subscriptionType, objectId: event.objectId });

          if (event.subscriptionType === 'contact.propertyChange') {
            const lead = db.prepare('SELECT * FROM leads WHERE hubspot_id = ?').get(String(event.objectId));
            if (!lead) continue;

            const FIELDS = { email: 'email', firstname: 'prenom', company: 'hotel' };
            const col = FIELDS[event.propertyName];
            if (col) {
              db.prepare(`UPDATE leads SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(event.propertyValue, lead.id);
            }
          }
        }
      } catch (err) {
        logger.error('Erreur webhook HubSpot', { error: err.message });
      }
    });
  });

  // POST /api/hubspot/sync-lead/:id
  router.post('/sync-lead/:id', async (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });
      const hubspotId = await hubspot.syncContact(db, lead);
      res.json({ message: 'Lead synchronisé', hubspotId });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/hubspot/sync-all — Sync bidirectionnelle
  router.post('/sync-all', async (req, res) => {
    try {
      const API_KEY = process.env.HUBSPOT_API_KEY;

      // 1. Pousser les leads locaux sans hubspot_id
      const leadsASyncer = db.prepare('SELECT * FROM leads WHERE hubspot_id IS NULL AND unsubscribed = 0').all();
      for (const lead of leadsASyncer) {
        await hubspot.syncContact(db, lead).catch(() => {});
        await new Promise(r => setTimeout(r, 150));
      }

      // 2. Pull depuis HubSpot pour les leads déjà liés (infos contact uniquement, PAS le statut)
      if (API_KEY) {
        const leadsLies = db.prepare('SELECT * FROM leads WHERE hubspot_id IS NOT NULL').all();

        for (const lead of leadsLies) {
          try {
            const resp = await fetch(
              `https://api.hubapi.com/crm/v3/objects/contacts/${lead.hubspot_id}?properties=email,firstname,lastname,company,city`,
              { headers: { Authorization: `Bearer ${API_KEY}` } }
            );
            if (!resp.ok) continue;
            const { properties: p } = await resp.json();

            // Mettre à jour seulement les infos contact, jamais le statut
            // Le statut est géré par la logique métier locale (séquences, réponses, etc.)
            db.prepare(`
              UPDATE leads SET
                prenom = COALESCE(NULLIF(?, ''), prenom),
                nom    = COALESCE(NULLIF(?, ''), nom),
                hotel  = COALESCE(NULLIF(?, ''), hotel),
                ville  = COALESCE(NULLIF(?, ''), ville),
                updated_at = datetime('now')
              WHERE id = ?
            `).run(
              p.firstname || '', p.lastname || '', p.company || '', p.city || '',
              lead.id
            );
          } catch (_) { /* continuer */ }
          await new Promise(r => setTimeout(r, 100));
        }
      }

      const totalLies = db.prepare('SELECT COUNT(*) as c FROM leads WHERE hubspot_id IS NOT NULL').get().c;
      res.json({ message: `Sync terminée — ${leadsASyncer.length} nouveaux, ${totalLies} mis à jour` });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/hubspot/creer-deal/:leadId
  router.post('/creer-deal/:leadId', async (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });
      const dealId = await hubspot.creerDeal(db, lead);
      db.prepare(`UPDATE leads SET statut = 'Converti', updated_at = datetime('now') WHERE id = ?`).run(lead.id);
      res.json({ message: 'Deal créé', dealId });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/hubspot/recherche-companies?q=
  router.get('/recherche-companies', async (req, res) => {
    try {
      const results = await hubspot.rechercherCompanies(req.query.q || '');
      res.json(results);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // GET /api/hubspot/contacts-company/:companyId
  router.get('/contacts-company/:companyId', async (req, res) => {
    try {
      const contacts = await hubspot.contactsDeCompany(req.params.companyId);
      res.json(contacts);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // POST /api/hubspot/fix-statuts — Corriger les statuts écrasés par sync-all
  router.post('/fix-statuts', (req, res) => {
    try {
      // 1. Leads avec inscription active → "En séquence"
      const r1 = db.prepare(`
        UPDATE leads SET statut = 'En séquence', updated_at = datetime('now')
        WHERE id IN (
          SELECT DISTINCT l.id FROM leads l
          JOIN inscriptions i ON i.lead_id = l.id
          WHERE i.statut = 'actif' AND l.statut = 'Répondu'
        )
      `).run();

      // 2. Leads "Répondu" sans event réponse, avec inscription terminée → "Fin de séquence"
      const r2 = db.prepare(`
        UPDATE leads SET statut = 'Fin de séquence', updated_at = datetime('now')
        WHERE statut = 'Répondu'
          AND hubspot_id IS NOT NULL
          AND id NOT IN (SELECT DISTINCT lead_id FROM events WHERE type IN ('ouverture', 'clic'))
          AND id NOT IN (SELECT DISTINCT lead_id FROM inscriptions WHERE statut = 'actif')
          AND id IN (SELECT DISTINCT lead_id FROM inscriptions WHERE statut = 'terminé')
      `).run();

      // 3. Leads "Répondu" sans aucune interaction ni inscription → "Nouveau"
      const r3 = db.prepare(`
        UPDATE leads SET statut = 'Nouveau', updated_at = datetime('now')
        WHERE statut = 'Répondu'
          AND hubspot_id IS NOT NULL
          AND id NOT IN (SELECT DISTINCT lead_id FROM events WHERE type IN ('ouverture', 'clic'))
          AND id NOT IN (SELECT DISTINCT lead_id FROM inscriptions WHERE statut = 'actif')
          AND id NOT IN (SELECT DISTINCT lead_id FROM inscriptions WHERE statut = 'terminé')
      `).run();

      const stats = db.prepare(`SELECT statut, COUNT(*) as c FROM leads WHERE hubspot_id IS NOT NULL GROUP BY statut`).all();
      res.json({
        message: 'Statuts corrigés',
        corrections: {
          enSequence: r1.changes,
          finSequence: r2.changes,
          nouveau: r3.changes,
        },
        repartition: stats,
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/hubspot/logs/:leadId — Historique sync d'un lead
  router.get('/logs/:leadId', (req, res) => {
    try {
      const logs = db.prepare('SELECT * FROM hubspot_logs WHERE lead_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.leadId);
      res.json(logs);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/hubspot/force-lifecycle/:leadId — Forcer un lifecycle stage
  router.post('/force-lifecycle/:leadId', async (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });
      if (!lead.hubspot_id) return res.status(400).json({ erreur: 'Lead non synchronisé avec HubSpot' });
      const { stage } = req.body;
      if (!stage) return res.status(400).json({ erreur: 'Stage requis' });
      await hubspot.mettreAJourLifecycle(db, lead, stage);
      res.json({ message: `Lifecycle mis à jour → ${stage}` });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/hubspot/status
  router.get('/status', async (req, res) => {
    const status = await hubspot.verifierConnexion();
    res.json(status);
  });

  // GET /api/hubspot/deals/:hubspotContactId
  router.get('/deals/:hubspotContactId', async (req, res) => {
    try {
      const deals = await hubspot.getDealsForContact(req.params.hubspotContactId);
      res.json({ deals });
    } catch (err) {
      logger.error('GET /hubspot/deals erreur', { error: err.message });
      res.json({ deals: [] });
    }
  });

  // GET /api/hubspot/notes/:hubspotContactId
  router.get('/notes/:hubspotContactId', async (req, res) => {
    try {
      const notes = await hubspot.getNotesForContact(req.params.hubspotContactId);
      res.json({ notes });
    } catch (err) {
      logger.error('GET /hubspot/notes erreur', { error: err.message });
      res.json({ notes: [] });
    }
  });

  // POST /api/hubspot/sync-partners — Sync companies Partner + contacts → tables locales
  router.post('/sync-partners', async (req, res) => {
    try {
      // 1. Fetch toutes les companies Partner depuis HubSpot
      const companies = await hubspot.rechercherPartnerCompanies();
      if (!companies.length) return res.json({ message: 'Aucun partenaire trouvé', partners: 0, contacts: 0 });

      const now = new Date().toISOString();
      const upsertPartner = db.prepare(`
        INSERT INTO hubspot_partners (hubspot_company_id, name, domain, business_type, capacite, city, postal_code, country, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(hubspot_company_id) DO UPDATE SET
          name = excluded.name, domain = excluded.domain, business_type = excluded.business_type,
          capacite = excluded.capacite, city = excluded.city, postal_code = excluded.postal_code,
          country = excluded.country, synced_at = excluded.synced_at
      `);

      const upsertContact = db.prepare(`
        INSERT INTO hubspot_partner_contacts (hubspot_contact_id, hubspot_company_id, firstname, lastname, email, jobtitle, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(hubspot_contact_id) DO UPDATE SET
          hubspot_company_id = excluded.hubspot_company_id, firstname = excluded.firstname,
          lastname = excluded.lastname, email = excluded.email, jobtitle = excluded.jobtitle,
          synced_at = excluded.synced_at
      `);

      let totalContacts = 0;
      for (const c of companies) {
        upsertPartner.run(c.id, c.name, c.domain, c.business_type, c.capacite, c.city, c.postal_code, c.country, now);

        // Fetch contacts de cette company
        try {
          const contacts = await hubspot.contactsDeCompany(c.id);
          for (const ct of contacts) {
            upsertContact.run(ct.hubspot_id, c.id, ct.prenom, ct.nom, ct.email, ct.poste, now);
            totalContacts++;
          }
        } catch (_) { /* continue */ }
        await new Promise(r => setTimeout(r, 100));
      }

      logger.info('Sync partenaires HubSpot terminée', { partners: companies.length, contacts: totalContacts });
      res.json({ message: 'Sync terminée', partners: companies.length, contacts: totalContacts });
    } catch (err) {
      logger.error('POST /hubspot/sync-partners erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/hubspot/partners — Liste partenaires depuis table locale (avec contact principal)
  router.get('/partners', (req, res) => {
    try {
      const { business_type, city, country } = req.query;
      let sql = 'SELECT * FROM hubspot_partners WHERE 1=1';
      const params = [];
      if (business_type) { sql += ' AND business_type = ?'; params.push(business_type); }
      if (city) { sql += ' AND city LIKE ?'; params.push(`%${city}%`); }
      if (country) { sql += ' AND country LIKE ?'; params.push(`%${country}%`); }
      sql += ' ORDER BY name';
      const partners = db.prepare(sql).all(...params);

      // Enrichir avec le contact principal de chaque partenaire
      const stmtContact = db.prepare('SELECT * FROM hubspot_partner_contacts WHERE hubspot_company_id = ? LIMIT 1');
      const enriched = partners.map(p => {
        const contact = stmtContact.get(p.hubspot_company_id);
        return {
          ...p,
          contact_firstname: contact?.firstname || '',
          contact_lastname: contact?.lastname || '',
          contact_email: contact?.email || '',
          contact_jobtitle: contact?.jobtitle || '',
        };
      });
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/hubspot/partners/:id/contacts — Contacts d'un partenaire
  router.get('/partners/:id/contacts', (req, res) => {
    try {
      const partner = db.prepare('SELECT * FROM hubspot_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });
      const contacts = db.prepare('SELECT * FROM hubspot_partner_contacts WHERE hubspot_company_id = ? ORDER BY lastname, firstname').all(partner.hubspot_company_id);
      res.json(contacts);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
