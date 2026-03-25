/**
 * leads.js — Routes CRUD pour la gestion des leads
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const hubspot = require('../services/hubspotService');

module.exports = (db) => {

  // GET /api/leads — Liste tous les leads avec stats
  router.get('/', (req, res) => {
    try {
      const { statut, segment, search } = req.query;
      let query = `
        SELECT l.*,
          COALESCE(em.emails_envoyes, 0) as emails_envoyes,
          COALESCE(em.total_ouvertures, 0) as total_ouvertures,
          ia.sequence_active,
          ia.sequence_id_active,
          ia.etape_courante,
          ia.prochain_envoi,
          ia.inscription_id_active,
          ia.nb_etapes_sequence
        FROM leads l
        LEFT JOIN (
          SELECT lead_id, COUNT(*) as emails_envoyes, SUM(ouvertures) as total_ouvertures
          FROM emails GROUP BY lead_id
        ) em ON em.lead_id = l.id
        LEFT JOIN (
          SELECT i.lead_id, s.nom as sequence_active, s.id as sequence_id_active,
            i.etape_courante, i.prochain_envoi, i.id as inscription_id_active,
            (SELECT COUNT(*) FROM etapes WHERE sequence_id = i.sequence_id) as nb_etapes_sequence
          FROM inscriptions i
          JOIN sequences s ON i.sequence_id = s.id
          WHERE i.statut = 'actif'
          GROUP BY i.lead_id
        ) ia ON ia.lead_id = l.id
        WHERE 1=1
      `;
      const params = [];

      if (statut) { query += ' AND l.statut = ?'; params.push(statut); }
      if (segment) { query += ' AND l.segment = ?'; params.push(segment); }
      if (search) { query += ' AND (l.prenom LIKE ? OR l.nom LIKE ? OR l.hotel LIKE ? OR l.email LIKE ?)'; const s = `%${search}%`; params.push(s, s, s, s); }

      query += ' ORDER BY l.created_at DESC';
      const leads = db.prepare(query).all(...params);

      res.json({ leads, total: leads.length });
    } catch (err) {
      logger.error('GET /leads erreur', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // GET /api/leads/:id — Détail d'un lead avec historique
  router.get('/:id', (req, res) => {
    try {
      const lead = db.prepare(`
        SELECT l.*,
          (SELECT COUNT(*) FROM emails e WHERE e.lead_id = l.id) as emails_envoyes,
          (SELECT SUM(e.ouvertures) FROM emails e WHERE e.lead_id = l.id) as total_ouvertures,
          (SELECT s.nom FROM inscriptions i JOIN sequences s ON i.sequence_id = s.id WHERE i.lead_id = l.id AND i.statut = 'actif' LIMIT 1) as sequence_active,
          (SELECT s.id FROM inscriptions i JOIN sequences s ON i.sequence_id = s.id WHERE i.lead_id = l.id AND i.statut = 'actif' LIMIT 1) as sequence_id_active,
          (SELECT i.etape_courante FROM inscriptions i WHERE i.lead_id = l.id AND i.statut = 'actif' LIMIT 1) as etape_courante,
          (SELECT i.prochain_envoi FROM inscriptions i WHERE i.lead_id = l.id AND i.statut = 'actif' LIMIT 1) as prochain_envoi,
          (SELECT i.id FROM inscriptions i WHERE i.lead_id = l.id AND i.statut = 'actif' LIMIT 1) as inscription_id_active,
          (SELECT COUNT(*) FROM etapes et JOIN inscriptions i ON et.sequence_id = i.sequence_id WHERE i.lead_id = l.id AND i.statut = 'actif' LIMIT 1) as nb_etapes_sequence
        FROM leads l WHERE l.id = ?
      `).get(req.params.id);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });

      const emails = db.prepare(`
        SELECT e.*, et.ordre, et.sujet as sujet_etape, s.nom as sequence_nom
        FROM emails e
        JOIN etapes et ON e.etape_id = et.id
        JOIN inscriptions i ON e.inscription_id = i.id
        JOIN sequences s ON i.sequence_id = s.id
        WHERE e.lead_id = ? ORDER BY e.envoye_at DESC
      `).all(req.params.id);

      const events = db.prepare(`
        SELECT * FROM events WHERE lead_id = ? ORDER BY created_at DESC LIMIT 20
      `).all(req.params.id);

      res.json({ ...lead, emails, events, tags: JSON.parse(lead.tags || '[]') });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/leads — Créer un lead
  router.post('/', async (req, res) => {
    try {
      const { prenom, nom, email, hotel, ville, segment, tags, poste, langue, campaign, comment, company_hubspot_id } = req.body;
      if (!email || !hotel || !prenom) return res.status(400).json({ erreur: 'prenom, email et hotel sont requis' });

      // Normaliser tags : accepte string JSON ou tableau
      const tagsStr = typeof tags === 'string' ? tags : JSON.stringify(tags || []);

      const id = uuidv4();
      db.prepare(`
        INSERT INTO leads (id, prenom, nom, email, hotel, ville, segment, tags, poste, langue, campaign, comment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, prenom, nom || '', email, hotel, ville || '', segment || '5*', tagsStr, poste || null, langue || 'fr', campaign || null, comment || null);

      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);

      // Synchroniser dans HubSpot (avec company_hubspot_id si fourni)
      if (process.env.HUBSPOT_API_KEY) {
        const cfgSync = db.prepare("SELECT valeur FROM config WHERE cle = 'hs_sync_contact'").get();
        const syncEnabled = cfgSync ? cfgSync.valeur !== '0' && cfgSync.valeur !== 'false' : true;
        if (syncEnabled) {
          const leadAvecCompany = { ...lead, company_hubspot_id: company_hubspot_id || null };
          hubspot.syncContact(db, leadAvecCompany)
            .then(hubspotId => {
              if (hubspotId) logger.info('✅ Lead synchronisé HubSpot', { email, hubspotId });
            })
            .catch(err => logger.error('HubSpot sync lead échoué', { error: err.message }));
        }
      }

      logger.info('✅ Lead créé', { email, hotel });
      res.status(201).json(lead);
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ erreur: 'Cet email existe déjà' });
      res.status(500).json({ erreur: err.message });
    }
  });

  // PATCH /api/leads/:id — Mettre à jour un lead
  router.patch('/:id', (req, res) => {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
      if (!lead) return res.status(404).json({ erreur: 'Lead introuvable' });

      const { prenom, nom, email, hotel, ville, segment, tags, statut, score, poste, langue, campaign, comment } = req.body;
      db.prepare(`
        UPDATE leads SET
          prenom = COALESCE(?, prenom),
          nom = COALESCE(?, nom),
          email = COALESCE(?, email),
          hotel = COALESCE(?, hotel),
          ville = COALESCE(?, ville),
          segment = COALESCE(?, segment),
          tags = COALESCE(?, tags),
          statut = COALESCE(?, statut),
          score = COALESCE(?, score),
          poste = COALESCE(?, poste),
          langue = COALESCE(?, langue),
          campaign = COALESCE(?, campaign),
          comment = COALESCE(?, comment),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(prenom, nom, email, hotel, ville, segment, tags ? JSON.stringify(tags) : null, statut, score, poste, langue, campaign, comment, req.params.id);

      res.json(db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id));
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // DELETE /api/leads/:id — Supprimer un lead
  router.delete('/:id', (req, res) => {
    try {
      // Supprimer dans une transaction pour assurer la cohérence
      db.transaction(() => {
        // Supprimer les events liés (pas de CASCADE dans le schéma)
        db.prepare('DELETE FROM events WHERE lead_id = ?').run(req.params.id);

        // Supprimer les emails liés (pas de CASCADE dans le schéma)
        db.prepare('DELETE FROM emails WHERE lead_id = ?').run(req.params.id);

        // Les inscriptions ont CASCADE, mais on les supprime explicitement pour être sûr
        db.prepare('DELETE FROM inscriptions WHERE lead_id = ?').run(req.params.id);

        // Enfin supprimer le lead
        const result = db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
        if (!result.changes) throw new Error('Lead introuvable');
      })();

      res.json({ message: 'Lead supprimé' });
    } catch (err) {
      if (err.message === 'Lead introuvable') {
        return res.status(404).json({ erreur: err.message });
      }
      res.status(500).json({ erreur: err.message });
    }
  });

  // POST /api/leads/import — Import CSV (array de leads)
  router.post('/import', async (req, res) => {
    try {
      const { leads } = req.body;
      if (!Array.isArray(leads)) return res.status(400).json({ erreur: 'Fournir un tableau de leads' });

      let crees = 0, ignores = 0, erreurs = [];

      const inserer = db.prepare(`
        INSERT OR IGNORE INTO leads (id, prenom, nom, email, hotel, ville, segment, tags, poste, langue)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const importerTous = db.transaction((leads) => {
        for (const l of leads) {
          if (!l.email || !l.hotel) { ignores++; continue; }
          try {
            const result = inserer.run(uuidv4(), l.prenom || '', l.nom || '', l.email, l.hotel, l.ville || '', l.segment || '5*', JSON.stringify(l.tags || []), l.poste || null, l.langue || 'fr');
            if (result.changes) crees++;
            else ignores++;
          } catch (e) {
            erreurs.push({ email: l.email, erreur: e.message });
          }
        }
      });

      importerTous(leads);
      logger.info(`📥 Import CSV : ${crees} créés, ${ignores} ignorés`);
      res.json({ crees, ignores, erreurs, message: `${crees} leads importés avec succès` });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
