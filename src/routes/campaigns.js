/**
 * campaigns.js — CRUD campagnes email marketing + destinataires + envoi + stats
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const { envoyerEmailCampagne, texteVersHtml, substituerVariables, verifierBlocklist, SENDER, PUBLIC_URL } = require('../services/brevoService');
const { lancerCampagne } = require('../jobs/campaignSender');

module.exports = (db) => {
  const router = express.Router();

  // ─── GET / — Liste des campagnes ────────────────────────────────────────────
  router.get('/', (req, res) => {
    try {
      const { statut } = req.query;
      let sql = 'SELECT * FROM campaigns';
      const params = [];
      if (statut && statut !== 'tous') {
        sql += ' WHERE statut = ?';
        params.push(statut);
      }
      sql += ' ORDER BY created_at DESC';
      const campaigns = db.prepare(sql).all(...params);

      // Enrichir avec stats d'ouverture/clic
      const stmtStats = db.prepare(`
        SELECT
          COUNT(DISTINCT e.id) as total_emails,
          SUM(CASE WHEN e.ouvertures > 0 THEN 1 ELSE 0 END) as opened,
          SUM(CASE WHEN e.clics > 0 THEN 1 ELSE 0 END) as clicked
        FROM emails e WHERE e.campaign_id = ?
      `);

      const result = campaigns.map(c => {
        const stats = stmtStats.get(c.id) || {};
        return {
          ...c,
          stats: {
            opened: stats.opened || 0,
            clicked: stats.clicked || 0,
            open_rate: c.sent_count > 0 ? Math.round((stats.opened || 0) / c.sent_count * 100) : 0,
            click_rate: c.sent_count > 0 ? Math.round((stats.clicked || 0) / c.sent_count * 100) : 0,
          }
        };
      });

      res.json(result);
    } catch (err) {
      logger.error('Erreur GET /campaigns', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── GET /:id — Détail campagne ─────────────────────────────────────────────
  router.get('/:id', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });

      const stats = db.prepare(`
        SELECT
          COUNT(DISTINCT e.id) as total_emails,
          SUM(CASE WHEN e.ouvertures > 0 THEN 1 ELSE 0 END) as opened,
          SUM(CASE WHEN e.clics > 0 THEN 1 ELSE 0 END) as clicked
        FROM emails e WHERE e.campaign_id = ?
      `).get(campaign.id) || {};

      const recipientStats = db.prepare(`
        SELECT statut, COUNT(*) as count FROM campaign_recipients WHERE campaign_id = ? GROUP BY statut
      `).all(campaign.id);

      res.json({
        ...campaign,
        stats: {
          opened: stats.opened || 0,
          clicked: stats.clicked || 0,
          open_rate: campaign.sent_count > 0 ? Math.round((stats.opened || 0) / campaign.sent_count * 100) : 0,
          click_rate: campaign.sent_count > 0 ? Math.round((stats.clicked || 0) / campaign.sent_count * 100) : 0,
        },
        recipient_stats: recipientStats,
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── POST / — Créer campagne ────────────────────────────────────────────────
  router.post('/', (req, res) => {
    try {
      const { nom, sujet, corps_html, template_id, options } = req.body;
      if (!nom || !sujet) return res.status(400).json({ erreur: 'Nom et sujet requis' });

      const id = uuidv4();
      db.prepare(`
        INSERT INTO campaigns (id, nom, sujet, corps_html, template_id, options)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, nom, sujet, corps_html || '', template_id || null, options ? JSON.stringify(options) : null);

      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
      res.status(201).json(campaign);
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── PUT /:id — Modifier campagne ──────────────────────────────────────────
  router.put('/:id', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'brouillon') return res.status(400).json({ erreur: 'Seules les campagnes brouillon peuvent être modifiées' });

      const { nom, sujet, corps_html, template_id, options } = req.body;
      db.prepare(`
        UPDATE campaigns SET nom = ?, sujet = ?, corps_html = ?, template_id = ?, options = ?
        WHERE id = ?
      `).run(
        nom || campaign.nom,
        sujet || campaign.sujet,
        corps_html !== undefined ? corps_html : campaign.corps_html,
        template_id !== undefined ? template_id : campaign.template_id,
        options ? JSON.stringify(options) : campaign.options,
        req.params.id
      );

      res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id));
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── DELETE /:id — Supprimer campagne ──────────────────────────────────────
  router.delete('/:id', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut === 'en_cours') return res.status(400).json({ erreur: 'Impossible de supprimer une campagne en cours' });

      db.prepare('DELETE FROM campaign_recipients WHERE campaign_id = ?').run(req.params.id);
      db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── POST /:id/recipients — Ajouter destinataires ─────────────────────────
  router.post('/:id/recipients', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'brouillon') return res.status(400).json({ erreur: 'Campagne non modifiable' });

      const { mode, filters, recipients } = req.body;
      let added = 0;
      let skipped = 0;

      // Emails déjà présents pour déduplication
      const existingEmails = new Set(
        db.prepare('SELECT email FROM campaign_recipients WHERE campaign_id = ?').all(req.params.id).map(r => r.email.toLowerCase())
      );

      const stmtInsert = db.prepare(`
        INSERT INTO campaign_recipients (id, campaign_id, lead_id, email, prenom, nom, hotel, ville, segment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      if (mode === 'filter') {
        // Mode leads existants
        let sql = 'SELECT * FROM leads WHERE unsubscribed = 0';
        const params = [];

        if (filters?.segment) {
          sql += ' AND segment = ?';
          params.push(filters.segment);
        }
        if (filters?.langue) {
          sql += ' AND langue = ?';
          params.push(filters.langue);
        }
        if (filters?.statut && filters.statut.length > 0) {
          sql += ` AND statut IN (${filters.statut.map(() => '?').join(',')})`;
          params.push(...filters.statut);
        }
        if (filters?.campaign) {
          sql += ' AND campaign = ?';
          params.push(filters.campaign);
        }
        if (filters?.source) {
          sql += ' AND source = ?';
          params.push(filters.source);
        }
        if (filters?.search) {
          sql += ' AND (prenom LIKE ? OR nom LIKE ? OR hotel LIKE ? OR email LIKE ? OR source LIKE ? OR statut LIKE ? OR civilite LIKE ? OR poste LIKE ?)';
          const s = `%${filters.search}%`;
          params.push(s, s, s, s, s, s, s, s);
        }

        const leads = db.prepare(sql).all(...params);

        // Si lead_ids fourni, ne prendre que ceux sélectionnés
        const selectedIds = filters?.lead_ids;
        const leadsToAdd = selectedIds && selectedIds.length > 0
          ? leads.filter(l => selectedIds.includes(l.id))
          : leads;

        const insertMany = db.transaction(() => {
          for (const lead of leadsToAdd) {
            if (existingEmails.has(lead.email.toLowerCase())) { skipped++; continue; }
            stmtInsert.run(uuidv4(), req.params.id, lead.id, lead.email, lead.prenom, lead.nom, lead.hotel, lead.ville, lead.segment);
            existingEmails.add(lead.email.toLowerCase());
            added++;
          }
        });
        insertMany();

      } else if (mode === 'csv') {
        // Mode CSV
        if (!recipients || !Array.isArray(recipients)) return res.status(400).json({ erreur: 'Recipients manquants' });

        const insertMany = db.transaction(() => {
          for (const r of recipients) {
            if (!r.email) continue;
            const email = r.email.toLowerCase().trim();
            if (existingEmails.has(email)) { skipped++; continue; }
            stmtInsert.run(uuidv4(), req.params.id, null, email, r.prenom || '', r.nom || '', r.hotel || '', r.ville || '', r.segment || '');
            existingEmails.add(email);
            added++;
          }
        });
        insertMany();
      } else {
        return res.status(400).json({ erreur: 'Mode invalide (filter ou csv)' });
      }

      // Mettre à jour le total
      const total = db.prepare('SELECT COUNT(*) as n FROM campaign_recipients WHERE campaign_id = ?').get(req.params.id).n;
      db.prepare('UPDATE campaigns SET total_recipients = ? WHERE id = ?').run(total, req.params.id);

      res.json({ added, skipped, total });
    } catch (err) {
      logger.error('Erreur POST recipients', { error: err.message });
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── POST /:id/recipients/preview — Prévisualiser les leads correspondants ─
  router.post('/:id/recipients/preview', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });

      const { filters } = req.body;
      let sql = 'SELECT id, prenom, nom, email, hotel, ville, segment, source, statut FROM leads WHERE unsubscribed = 0';
      const params = [];

      if (filters?.segment) { sql += ' AND segment = ?'; params.push(filters.segment); }
      if (filters?.langue) { sql += ' AND langue = ?'; params.push(filters.langue); }
      if (filters?.statut && filters.statut.length > 0) {
        sql += ` AND statut IN (${filters.statut.map(() => '?').join(',')})`;
        params.push(...filters.statut);
      }
      if (filters?.campaign) { sql += ' AND campaign = ?'; params.push(filters.campaign); }
      if (filters?.source) { sql += ' AND source = ?'; params.push(filters.source); }
      if (filters?.search) {
        sql += ' AND (prenom LIKE ? OR nom LIKE ? OR hotel LIKE ? OR email LIKE ? OR source LIKE ? OR statut LIKE ? OR civilite LIKE ? OR poste LIKE ?)';
        const s = `%${filters.search}%`;
        params.push(s, s, s, s, s, s, s, s);
      }

      sql += ' ORDER BY created_at DESC';
      const leads = db.prepare(sql).all(...params);

      // Exclure ceux déjà ajoutés
      const existingEmails = new Set(
        db.prepare('SELECT email FROM campaign_recipients WHERE campaign_id = ?').all(req.params.id).map(r => r.email.toLowerCase())
      );

      const available = leads.map(l => ({ ...l, already_added: existingEmails.has(l.email.toLowerCase()) }));

      res.json({ leads: available, total: available.length, new_count: available.filter(l => !l.already_added).length });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── GET /:id/recipients — Liste recipients ───────────────────────────────
  router.get('/:id/recipients', (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = (page - 1) * limit;
      const search = req.query.search ? req.query.search.trim() : '';
      const filter = req.query.filter || '';

      let whereClause = 'cr.campaign_id = ?';
      const params = [req.params.id];

      if (search) {
        whereClause += ' AND (cr.email LIKE ? OR cr.prenom LIKE ? OR cr.nom LIKE ? OR cr.hotel LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s, s);
      }

      // Filtres basés sur les stats email
      if (filter === 'opened') {
        whereClause += ' AND e.ouvertures > 0';
      } else if (filter === 'clicked') {
        whereClause += ' AND e.clics > 0';
      } else if (filter === 'erreur') {
        whereClause += " AND cr.statut = 'erreur'";
      } else if (filter === 'not_opened') {
        whereClause += " AND (e.ouvertures IS NULL OR e.ouvertures = 0) AND cr.statut = 'envoyé'";
      }

      const total = db.prepare(`
        SELECT COUNT(*) as n FROM campaign_recipients cr
        LEFT JOIN emails e ON e.campaign_recipient_id = cr.id
        WHERE ${whereClause}
      `).get(...params).n;

      const recipients = db.prepare(`
        SELECT cr.*, e.ouvertures, e.clics
        FROM campaign_recipients cr
        LEFT JOIN emails e ON e.campaign_recipient_id = cr.id
        WHERE ${whereClause}
        ORDER BY cr.rowid
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      res.json({ recipients, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── DELETE /:id/recipients/:recipientId — Supprimer un recipient individuel
  router.delete('/:id/recipients/:recipientId', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'brouillon') return res.status(400).json({ erreur: 'Campagne non modifiable' });

      const result = db.prepare('DELETE FROM campaign_recipients WHERE id = ? AND campaign_id = ?').run(req.params.recipientId, req.params.id);
      if (!result.changes) return res.status(404).json({ erreur: 'Destinataire introuvable' });

      const total = db.prepare('SELECT COUNT(*) as n FROM campaign_recipients WHERE campaign_id = ?').get(req.params.id).n;
      db.prepare('UPDATE campaigns SET total_recipients = ? WHERE id = ?').run(total, req.params.id);

      res.json({ ok: true, total });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── POST /:id/recipients/delete-batch — Supprimer plusieurs recipients ───
  router.post('/:id/recipients/delete-batch', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'brouillon') return res.status(400).json({ erreur: 'Campagne non modifiable' });

      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ erreur: 'Fournir un tableau d\'ids' });

      const stmtDel = db.prepare('DELETE FROM campaign_recipients WHERE id = ? AND campaign_id = ?');
      let deleted = 0;
      db.transaction(() => {
        for (const rid of ids) {
          const r = stmtDel.run(rid, req.params.id);
          deleted += r.changes;
        }
      })();

      const total = db.prepare('SELECT COUNT(*) as n FROM campaign_recipients WHERE campaign_id = ?').get(req.params.id).n;
      db.prepare('UPDATE campaigns SET total_recipients = ? WHERE id = ?').run(total, req.params.id);

      res.json({ ok: true, deleted, total });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── DELETE /:id/recipients — Vider recipients ────────────────────────────
  router.delete('/:id/recipients', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'brouillon') return res.status(400).json({ erreur: 'Campagne non modifiable' });

      db.prepare('DELETE FROM campaign_recipients WHERE campaign_id = ?').run(req.params.id);
      db.prepare('UPDATE campaigns SET total_recipients = 0 WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── POST /:id/send-now — Lancer immédiatement ────────────────────────────
  router.post('/:id/send-now', (req, res) => {
    try {
      lancerCampagne(req.params.id);
      res.json({ ok: true, message: 'Campagne lancée' });
    } catch (err) {
      res.status(400).json({ erreur: err.message });
    }
  });

  // ─── POST /:id/schedule — Programmer ──────────────────────────────────────
  router.post('/:id/schedule', (req, res) => {
    try {
      const { scheduled_at } = req.body;
      if (!scheduled_at) return res.status(400).json({ erreur: 'Date de programmation requise' });

      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'brouillon') return res.status(400).json({ erreur: 'Seules les campagnes brouillon peuvent être programmées' });

      const recipientCount = db.prepare('SELECT COUNT(*) as n FROM campaign_recipients WHERE campaign_id = ?').get(req.params.id).n;
      if (recipientCount === 0) return res.status(400).json({ erreur: 'Aucun destinataire' });

      db.prepare(`UPDATE campaigns SET statut = 'programmée', scheduled_at = ?, total_recipients = ? WHERE id = ?`).run(scheduled_at, recipientCount, req.params.id);
      res.json({ ok: true, scheduled_at });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── POST /:id/cancel — Annuler ──────────────────────────────────────────
  router.post('/:id/cancel', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'en_cours' && campaign.statut !== 'programmée') {
        return res.status(400).json({ erreur: 'Seules les campagnes en cours ou programmées peuvent être annulées' });
      }

      db.prepare(`UPDATE campaigns SET statut = 'annulée', completed_at = datetime('now') WHERE id = ?`).run(req.params.id);
      logger.info(`⏹️  Campagne annulée : ${campaign.nom}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── POST /:id/test — Envoyer test ───────────────────────────────────────
  router.post('/:id/test', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ erreur: 'Email requis' });

      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });

      const testLead = {
        id: null,
        email,
        prenom: 'Test',
        nom: 'Utilisateur',
        hotel: 'Hôtel Example',
        ville: 'Paris',
        segment: '5*',
        unsubscribed: 0,
      };

      // Envoyer sans enregistrer en base
      const { texteVersHtml: tvh, substituerVariables: sv, brevoSendEmail: bse, SENDER: sender } = require('../services/brevoService');
      const { v4: uuid } = require('uuid');
      const trackingId = uuid();
      const sujet = `[TEST] ${sv(campaign.sujet, testLead)}`;
      const html = tvh(sv(campaign.corps_html || '', testLead), trackingId, { ...testLead, id: 'test' }, true, {});

      if (process.env.BREVO_API_KEY) {
        await bse({
          sender,
          to: [{ email, name: 'Test' }],
          subject: sujet,
          htmlContent: html,
          replyTo: { email: sender.email, name: sender.name },
        });
      }

      res.json({ ok: true, message: `Email test envoyé à ${email}` });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── GET /:id/stats — Stats détaillées ────────────────────────────────────
  router.get('/:id/stats', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });

      const emailStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN ouvertures > 0 THEN 1 ELSE 0 END) as opened,
          SUM(CASE WHEN clics > 0 THEN 1 ELSE 0 END) as clicked,
          SUM(ouvertures) as total_opens,
          SUM(clics) as total_clicks
        FROM emails WHERE campaign_id = ?
      `).get(campaign.id) || {};

      const recipientBreakdown = db.prepare(`
        SELECT statut, COUNT(*) as count FROM campaign_recipients WHERE campaign_id = ? GROUP BY statut
      `).all(campaign.id);

      res.json({
        campaign_id: campaign.id,
        total_recipients: campaign.total_recipients,
        sent: campaign.sent_count,
        errors: campaign.error_count,
        opened: emailStats.opened || 0,
        clicked: emailStats.clicked || 0,
        total_opens: emailStats.total_opens || 0,
        total_clicks: emailStats.total_clicks || 0,
        open_rate: campaign.sent_count > 0 ? Math.round((emailStats.opened || 0) / campaign.sent_count * 100) : 0,
        click_rate: campaign.sent_count > 0 ? Math.round((emailStats.clicked || 0) / campaign.sent_count * 100) : 0,
        recipient_breakdown: recipientBreakdown,
      });
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  // ─── POST /:id/duplicate — Dupliquer campagne ────────────────────────────
  router.post('/:id/duplicate', (req, res) => {
    try {
      const original = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
      if (!original) return res.status(404).json({ erreur: 'Campagne introuvable' });

      const newId = uuidv4();
      db.prepare(`
        INSERT INTO campaigns (id, nom, sujet, corps_html, template_id, options)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(newId, `${original.nom} (copie)`, original.sujet, original.corps_html, original.template_id, original.options);

      res.status(201).json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(newId));
    } catch (err) {
      res.status(500).json({ erreur: err.message });
    }
  });

  return router;
};
