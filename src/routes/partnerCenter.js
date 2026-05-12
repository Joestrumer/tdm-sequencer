/**
 * partnerCenter.js — Partner Relationship Center
 * Dashboard, Partenaires, Segments, Campagnes, Programmes & Moments
 */
const { Router } = require('express');
const { randomUUID } = require('crypto');

module.exports = (db) => {
  const router = Router();

  // ═══════════════════════════════════════════════════════════════════════════
  //  OWNERS (HubSpot Company Owners)
  // ═══════════════════════════════════════════════════════════════════════════

  let ownersCache = null;
  let ownersCacheAt = 0;

  router.get('/owners', async (req, res) => {
    try {
      // Get distinct owner IDs from local DB
      const ownerIds = db.prepare("SELECT DISTINCT hubspot_owner_id FROM hubspot_partners WHERE hubspot_owner_id IS NOT NULL AND hubspot_owner_id != ''").all().map(r => r.hubspot_owner_id);
      if (ownerIds.length === 0) return res.json([]);

      // Cache owners from HubSpot API (15 min)
      if (!ownersCache || Date.now() - ownersCacheAt > 15 * 60 * 1000) {
        try {
          const hubspotService = require('../services/hubspotService');
          const allOwners = await hubspotService.fetchOwners();
          ownersCache = allOwners;
          ownersCacheAt = Date.now();
        } catch (_) {
          if (!ownersCache) ownersCache = [];
        }
      }

      const result = ownerIds.map(oid => {
        const owner = ownersCache.find(o => o.id === oid);
        return {
          id: oid,
          label: owner ? `${owner.firstName} ${owner.lastName}`.trim() || owner.email : oid,
          email: owner?.email || '',
        };
      }).sort((a, b) => a.label.localeCompare(b.label));

      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Helper: build owner filter clause
  function ownerFilter(req) {
    const ownerId = req.query.owner_id;
    if (!ownerId) return { ownerWhere: '', ownerParams: [] };
    return { ownerWhere: ' AND hp.hubspot_owner_id = ?', ownerParams: [ownerId] };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/dashboard', async (req, res) => {
    try {
      const { ownerWhere, ownerParams } = ownerFilter(req);
      const nb_partenaires = db.prepare(`SELECT COUNT(*) as n FROM hubspot_partners hp WHERE 1=1${ownerWhere}`).get(...ownerParams).n;
      const nb_contacts = db.prepare(`SELECT COUNT(*) as n FROM hubspot_partner_contacts c JOIN hubspot_partners hp ON hp.hubspot_company_id = c.hubspot_company_id WHERE 1=1${ownerWhere}`).get(...ownerParams).n;
      const points_eau = db.prepare(`SELECT COALESCE(SUM(capacite), 0) as n FROM hubspot_partners hp WHERE 1=1${ownerWhere}`).get(...ownerParams).n;

      // CA close won
      let ca_close_won = 0;
      try {
        const lastCached = db.prepare('SELECT MAX(cached_at) as t FROM hubspot_deals_cache').get()?.t;
        const cacheAge = lastCached ? (Date.now() - new Date(lastCached).getTime()) / 60000 : Infinity;
        if (cacheAge > 15) {
          try {
            const hubspotService = require('../services/hubspotService');
            const deals = await hubspotService.getClosedWonDeals();
            if (deals.length > 0) {
              const now = new Date().toISOString();
              db.prepare('DELETE FROM hubspot_deals_cache').run();
              const ins = db.prepare('INSERT INTO hubspot_deals_cache (hubspot_deal_id, hubspot_company_id, dealname, amount, closedate, dealstage, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
              for (const d of deals) ins.run(d.id, d.hubspot_company_id, d.dealname, d.amount, d.closedate, d.dealstage, now);
            }
          } catch (_) {}
        }
        ca_close_won = db.prepare('SELECT COALESCE(SUM(amount), 0) as ca FROM hubspot_deals_cache').get().ca;
      } catch (_) {}

      // Répartition business_type
      const par_business_type = db.prepare(`
        SELECT business_type, COUNT(*) as count, COALESCE(SUM(capacite), 0) as capacite_totale
        FROM hubspot_partners hp WHERE business_type IS NOT NULL AND business_type != ''${ownerWhere}
        GROUP BY business_type ORDER BY count DESC
      `).all(...ownerParams);

      // Alertes at-risk (pas de deal depuis 6+ mois)
      const at_risk = db.prepare(`
        SELECT hp.id, hp.name, hp.city, hp.business_type, hp.partner_since,
               MAX(d.closedate) as last_deal_date
        FROM hubspot_partners hp
        LEFT JOIN hubspot_deals_cache d ON d.hubspot_company_id = hp.hubspot_company_id
        WHERE 1=1${ownerWhere}
        GROUP BY hp.id
        HAVING last_deal_date IS NULL OR last_deal_date < datetime('now', '-6 months')
        ORDER BY last_deal_date ASC NULLS FIRST
        LIMIT 20
      `).all(...ownerParams);

      // Anniversaires 60j — calcul précis date/durée/jours restants
      const anniversaires = db.prepare(`
        WITH anniv AS (
          SELECT hp.id, hp.name, hp.city, hp.business_type, hp.partner_since,
            -- Mois et jour de partner_since
            CAST(strftime('%m', hp.partner_since) AS INTEGER) as ps_month,
            CAST(strftime('%d', hp.partner_since) AS INTEGER) as ps_day,
            CAST(strftime('%Y', 'now') AS INTEGER) as cur_year,
            CAST(strftime('%Y', hp.partner_since) AS INTEGER) as ps_year
          FROM hubspot_partners hp
          WHERE hp.partner_since IS NOT NULL AND hp.partner_since != ''${ownerWhere}
        )
        SELECT id, name, city, business_type, partner_since,
          CASE
            WHEN julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) >= julianday('now')
            THEN printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)
            ELSE printf('%04d-%02d-%02d', cur_year + 1, ps_month, ps_day)
          END as next_anniversary,
          CASE
            WHEN julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) >= julianday('now')
            THEN cur_year - ps_year
            ELSE cur_year + 1 - ps_year
          END as years_at_anniversary,
          CASE
            WHEN julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) >= julianday('now')
            THEN CAST(julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) - julianday('now') AS INTEGER)
            ELSE CAST(julianday(printf('%04d-%02d-%02d', cur_year + 1, ps_month, ps_day)) - julianday('now') AS INTEGER)
          END as days_until
        FROM anniv
        WHERE CASE
            WHEN julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) >= julianday('now')
            THEN CAST(julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) - julianday('now') AS INTEGER)
            ELSE CAST(julianday(printf('%04d-%02d-%02d', cur_year + 1, ps_month, ps_day)) - julianday('now') AS INTEGER)
          END <= 60
        ORDER BY CASE
            WHEN julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) >= julianday('now')
            THEN CAST(julianday(printf('%04d-%02d-%02d', cur_year, ps_month, ps_day)) - julianday('now') AS INTEGER)
            ELSE CAST(julianday(printf('%04d-%02d-%02d', cur_year + 1, ps_month, ps_day)) - julianday('now') AS INTEGER)
          END ASC
        LIMIT 20
      `).all(...ownerParams);

      // Config anniversaire active
      let anniversaryConfig = null;
      try {
        anniversaryConfig = db.prepare("SELECT * FROM partner_anniversary_config WHERE active = 1 LIMIT 1").get() || null;
      } catch (_) {}

      // Enrichir anniversaires avec excluded / email_sent_this_year / email_scheduled
      const currentYear = new Date().getFullYear();
      for (const a of anniversaires) {
        const excluded = db.prepare('SELECT 1 FROM partner_anniversary_exclusions WHERE partner_id = ?').get(a.id);
        a.excluded = !!excluded;
        const sent = db.prepare('SELECT 1 FROM partner_anniversary_logs WHERE partner_id = ? AND year = ?').get(a.id, currentYear);
        a.email_sent_this_year = !!sent;
        a.email_scheduled = !!(anniversaryConfig?.active && !a.excluded && !a.email_sent_this_year);
      }

      // Top partenaires CA
      const top_partenaires = db.prepare(`
        SELECT hp.id, hp.name, hp.business_type, hp.city,
               COALESCE(SUM(d.amount), 0) as ca_total, COUNT(d.id) as nb_deals
        FROM hubspot_partners hp
        LEFT JOIN hubspot_deals_cache d ON d.hubspot_company_id = hp.hubspot_company_id
        WHERE 1=1${ownerWhere}
        GROUP BY hp.id
        HAVING ca_total > 0
        ORDER BY ca_total DESC LIMIT 10
      `).all(...ownerParams);

      res.json({
        kpis: { nb_partenaires, nb_contacts, ca_close_won, points_eau },
        par_business_type,
        at_risk,
        anniversaires,
        anniversaryConfig,
        top_partenaires,
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PARTENAIRES
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/partners', (req, res) => {
    try {
      const { business_type, city, country, search, owner_id } = req.query;
      let sql = 'SELECT hp.*, (SELECT COUNT(*) FROM hubspot_partner_contacts c WHERE c.hubspot_company_id = hp.hubspot_company_id) as nb_contacts FROM hubspot_partners hp WHERE 1=1';
      const params = [];
      if (owner_id) { sql += ' AND hp.hubspot_owner_id = ?'; params.push(owner_id); }
      if (business_type) { sql += ' AND hp.business_type = ?'; params.push(business_type); }
      if (city) { sql += ' AND hp.city = ?'; params.push(city); }
      if (country) { sql += ' AND hp.country = ?'; params.push(country); }
      if (search) {
        sql += ' AND (hp.name LIKE ? OR hp.city LIKE ? OR hp.domain LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s);
      }
      sql += ' ORDER BY hp.name';
      res.json(db.prepare(sql).all(...params));
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/partners/:id', (req, res) => {
    try {
      const partner = db.prepare('SELECT * FROM hubspot_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      // Deals
      const deals = db.prepare('SELECT * FROM hubspot_deals_cache WHERE hubspot_company_id = ? ORDER BY closedate DESC').all(partner.hubspot_company_id);
      const ca_total = deals.reduce((s, d) => s + (d.amount || 0), 0);

      res.json({ ...partner, deals, ca_total });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/partners/:id/contacts', (req, res) => {
    try {
      const partner = db.prepare('SELECT * FROM hubspot_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });
      const contacts = db.prepare('SELECT * FROM hubspot_partner_contacts WHERE hubspot_company_id = ? ORDER BY lastname').all(partner.hubspot_company_id);

      // Enrichir chaque contact : segments du partenaire + listes de contacts
      const allSegments = db.prepare('SELECT * FROM partner_segments').all();
      const partnerSegments = [];
      for (const seg of allSegments) {
        const rules = db.prepare('SELECT * FROM partner_segment_rules WHERE segment_id = ? ORDER BY ordre').all(seg.id);
        const { where, params } = buildSegmentWhere(rules);
        const excluded = db.prepare('SELECT 1 FROM partner_segment_exclusions WHERE segment_id = ? AND hubspot_company_id = ?').get(seg.id, partner.hubspot_company_id);
        if (excluded) continue;
        const match = db.prepare(`SELECT 1 FROM hubspot_partners hp WHERE hp.hubspot_company_id = ? AND ${where}`).get(partner.hubspot_company_id, ...params);
        if (match) partnerSegments.push({ id: seg.id, name: seg.name });
      }

      const stmtLists = db.prepare(`
        SELECT l.id, l.name FROM partner_contact_list_members m
        JOIN partner_contact_lists l ON l.id = m.list_id
        WHERE m.contact_id = ?
      `);

      const enriched = contacts.map(c => ({
        ...c,
        segments: partnerSegments,
        lists: stmtLists.all(c.id),
      }));

      res.json(enriched);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Ajouter un contact à une liste
  router.post('/contact-lists/:id/add-member', (req, res) => {
    try {
      const { contact_id } = req.body;
      if (!contact_id) return res.status(400).json({ erreur: 'contact_id requis' });
      db.prepare('INSERT OR IGNORE INTO partner_contact_list_members (list_id, contact_id) VALUES (?, ?)').run(req.params.id, contact_id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.get('/partners/:id/timeline', (req, res) => {
    try {
      const partner = db.prepare('SELECT * FROM hubspot_partners WHERE id = ?').get(req.params.id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      // Deals
      const deals = db.prepare(`
        SELECT 'deal' as event_type, hubspot_deal_id as id, closedate as created_at, dealname as label, amount, dealstage
        FROM hubspot_deals_cache WHERE hubspot_company_id = ?
      `).all(partner.hubspot_company_id);

      // Communications (partner campaigns)
      const comms = db.prepare(`
        SELECT 'communication' as event_type, pcr.id, pcr.sent_at as created_at, pc.sujet as label, pc.nom as campaign_name
        FROM partner_campaign_recipients pcr
        JOIN partner_campaigns pc ON pc.id = pcr.campaign_id
        JOIN hubspot_partner_contacts hpc ON hpc.email = pcr.email
        WHERE hpc.hubspot_company_id = ? AND pcr.statut = 'envoyé'
      `).all(partner.hubspot_company_id);

      // Notes
      const notes = db.prepare(`
        SELECT 'note' as event_type, id, created_at, contenu as label, type, created_by
        FROM partner_notes WHERE partner_id = ?
      `).all(req.params.id);

      // Legacy comms
      const legacyComms = db.prepare(`
        SELECT 'communication' as event_type, id, created_at, sujet as label, type
        FROM partner_communications WHERE partner_id = ?
      `).all(req.params.id);

      const timeline = [...deals, ...comms, ...notes, ...legacyComms]
        .filter(e => e.created_at)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 50);

      res.json(timeline);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/partners/:id/notes', (req, res) => {
    try {
      const { contenu, type } = req.body;
      if (!contenu) return res.status(400).json({ erreur: 'contenu requis' });
      const id = randomUUID();
      db.prepare('INSERT INTO partner_notes (id, partner_id, type, contenu, created_by) VALUES (?, ?, ?, ?, ?)').run(
        id, req.params.id, type || 'note', contenu, req.user?.nom || 'system'
      );
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  SEGMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/segments', (req, res) => {
    try {
      const segments = db.prepare('SELECT * FROM partner_segments ORDER BY created_at DESC').all();
      // Enrichir avec le nombre de membres (résolution dynamique)
      const result = segments.map(s => {
        const rules = db.prepare('SELECT * FROM partner_segment_rules WHERE segment_id = ? ORDER BY ordre').all(s.id);
        const count = resolveSegmentCount(rules, s.id);
        return { ...s, rules, member_count: count };
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/segments', (req, res) => {
    try {
      const { name, description, rules } = req.body;
      if (!name) return res.status(400).json({ erreur: 'name requis' });
      const id = randomUUID();
      db.prepare('INSERT INTO partner_segments (id, name, description) VALUES (?, ?, ?)').run(id, name, description || null);
      if (rules?.length) {
        const ins = db.prepare('INSERT INTO partner_segment_rules (id, segment_id, field, operator, value, ordre) VALUES (?, ?, ?, ?, ?, ?)');
        rules.forEach((r, i) => ins.run(randomUUID(), id, r.field, r.operator, r.value, i));
      }
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.put('/segments/:id', (req, res) => {
    try {
      const seg = db.prepare('SELECT * FROM partner_segments WHERE id = ?').get(req.params.id);
      if (!seg) return res.status(404).json({ erreur: 'Segment introuvable' });
      const { name, description, rules } = req.body;
      db.prepare('UPDATE partner_segments SET name = ?, description = ? WHERE id = ?').run(name || seg.name, description ?? seg.description, req.params.id);
      if (rules) {
        db.prepare('DELETE FROM partner_segment_rules WHERE segment_id = ?').run(req.params.id);
        const ins = db.prepare('INSERT INTO partner_segment_rules (id, segment_id, field, operator, value, ordre) VALUES (?, ?, ?, ?, ?, ?)');
        rules.forEach((r, i) => ins.run(randomUUID(), req.params.id, r.field, r.operator, r.value, i));
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/segments/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM partner_segments WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/segments/:id/resolve', (req, res) => {
    try {
      const rules = db.prepare('SELECT * FROM partner_segment_rules WHERE segment_id = ? ORDER BY ordre').all(req.params.id);
      const partners = resolveSegment(rules, req.query.owner_id, req.params.id);
      res.json(partners);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Résoudre les contacts d'un segment
  router.get('/segments/:id/resolve-contacts', (req, res) => {
    try {
      const rules = db.prepare('SELECT * FROM partner_segment_rules WHERE segment_id = ? ORDER BY ordre').all(req.params.id);
      const partners = resolveSegment(rules, req.query.owner_id, req.params.id);
      const contacts = [];
      for (const p of partners) {
        const pContacts = db.prepare("SELECT * FROM hubspot_partner_contacts WHERE hubspot_company_id = ? AND email IS NOT NULL AND email != ''").all(p.hubspot_company_id);
        for (const c of pContacts) {
          contacts.push({ ...c, partner_name: p.name, partner_business_type: p.business_type, partner_hubspot_company_id: p.hubspot_company_id });
        }
      }
      res.json(contacts);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Exclure un partenaire d'un segment
  router.post('/segments/:id/exclude', (req, res) => {
    try {
      const { hubspot_company_id } = req.body;
      if (!hubspot_company_id) return res.status(400).json({ erreur: 'hubspot_company_id requis' });
      db.prepare('INSERT OR IGNORE INTO partner_segment_exclusions (segment_id, hubspot_company_id) VALUES (?, ?)').run(req.params.id, hubspot_company_id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  // Réintégrer un partenaire dans un segment
  router.delete('/segments/:id/exclude/:companyId', (req, res) => {
    try {
      db.prepare('DELETE FROM partner_segment_exclusions WHERE segment_id = ? AND hubspot_company_id = ?').run(req.params.id, req.params.companyId);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  // Résolution dynamique des segments
  function buildSegmentWhere(rules) {
    if (!rules || rules.length === 0) return { where: '1=1', params: [] };
    const conditions = [];
    const params = [];
    for (const rule of rules) {
      const field = sanitizeField(rule.field);
      if (!field) continue;
      switch (rule.operator) {
        case 'eq':
          conditions.push(`${field} = ?`); params.push(rule.value); break;
        case 'neq':
          conditions.push(`${field} != ?`); params.push(rule.value); break;
        case 'contains':
          conditions.push(`${field} LIKE ?`); params.push(`%${rule.value}%`); break;
        case 'gte':
          conditions.push(`CAST(${field} AS REAL) >= ?`); params.push(parseFloat(rule.value)); break;
        case 'lte':
          conditions.push(`CAST(${field} AS REAL) <= ?`); params.push(parseFloat(rule.value)); break;
        case 'in': {
          const vals = rule.value.split(',').map(v => v.trim());
          conditions.push(`${field} IN (${vals.map(() => '?').join(',')})`);
          params.push(...vals);
          break;
        }
        case 'between': {
          const [lo, hi] = rule.value.split(',').map(v => v.trim());
          conditions.push(`CAST(${field} AS REAL) BETWEEN ? AND ?`);
          params.push(parseFloat(lo), parseFloat(hi));
          break;
        }
      }
    }
    return { where: conditions.length > 0 ? conditions.join(' AND ') : '1=1', params };
  }

  const ALLOWED_FIELDS = {
    business_type: 'hp.business_type',
    city: 'hp.city',
    country: 'hp.country',
    capacite: 'hp.capacite',
    partner_since: 'hp.partner_since',
    name: 'hp.name',
    domain: 'hp.domain',
  };

  function sanitizeField(field) {
    return ALLOWED_FIELDS[field] || null;
  }

  function resolveSegment(rules, ownerId, segmentId) {
    const { where, params } = buildSegmentWhere(rules);
    let sql = `SELECT hp.*, (SELECT COUNT(*) FROM hubspot_partner_contacts c WHERE c.hubspot_company_id = hp.hubspot_company_id) as nb_contacts
      FROM hubspot_partners hp WHERE ${where}`;
    if (segmentId) { sql += ' AND hp.hubspot_company_id NOT IN (SELECT hubspot_company_id FROM partner_segment_exclusions WHERE segment_id = ?)'; params.push(segmentId); }
    if (ownerId) { sql += ' AND hp.hubspot_owner_id = ?'; params.push(ownerId); }
    sql += ' ORDER BY hp.name';
    return db.prepare(sql).all(...params);
  }

  function resolveSegmentCount(rules, segmentId) {
    const { where, params } = buildSegmentWhere(rules);
    let sql = `SELECT COUNT(*) as n FROM hubspot_partners hp WHERE ${where}`;
    if (segmentId) { sql += ' AND hp.hubspot_company_id NOT IN (SELECT hubspot_company_id FROM partner_segment_exclusions WHERE segment_id = ?)'; params.push(segmentId); }
    return db.prepare(sql).get(...params).n;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CAMPAGNES PARTENAIRES
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/campaigns', (req, res) => {
    try {
      const type = req.query.type || 'marketing';
      const campaigns = db.prepare("SELECT * FROM partner_campaigns WHERE COALESCE(type, 'marketing') = ? ORDER BY created_at DESC").all(type);
      // Enrichir avec stats événements
      const stmtEvents = db.prepare(`
        SELECT type, COUNT(*) as count FROM partner_campaign_events WHERE campaign_id = ? GROUP BY type
      `);
      const result = campaigns.map(c => {
        const events = stmtEvents.all(c.id);
        const opens = events.find(e => e.type === 'ouverture')?.count || 0;
        const clicks = events.find(e => e.type === 'clic')?.count || 0;
        return { ...c, stats: { opens, clicks, open_rate: c.sent_count > 0 ? Math.round(opens / c.sent_count * 100) : 0, click_rate: c.sent_count > 0 ? Math.round(clicks / c.sent_count * 100) : 0 } };
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/campaigns', (req, res) => {
    try {
      const { nom, sujet, corps_html, source_type, source_id, piece_jointe, type, business_type_filter, days_before } = req.body;
      if (!nom || !sujet) return res.status(400).json({ erreur: 'nom et sujet requis' });
      const id = randomUUID();
      const campaignType = type || 'marketing';
      const statut = campaignType === 'anniversaire' ? 'actif' : 'brouillon';
      db.prepare('INSERT INTO partner_campaigns (id, nom, sujet, corps_html, source_type, source_id, piece_jointe, type, business_type_filter, days_before, statut) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, nom, sujet, corps_html || '', source_type || null, source_id || null,
        piece_jointe ? JSON.stringify(piece_jointe) : null,
        campaignType, business_type_filter || null, days_before != null ? days_before : 0, statut
      );
      res.json(db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(id));
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.put('/campaigns/:id', (req, res) => {
    try {
      const c = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!c) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (c.statut !== 'brouillon') return res.status(400).json({ erreur: 'Campagne non modifiable' });
      const { nom, sujet, corps_html, source_type, source_id, piece_jointe, business_type_filter, days_before } = req.body;
      db.prepare('UPDATE partner_campaigns SET nom = ?, sujet = ?, corps_html = ?, source_type = ?, source_id = ?, piece_jointe = ?, business_type_filter = ?, days_before = ? WHERE id = ?').run(
        nom || c.nom, sujet || c.sujet, corps_html !== undefined ? corps_html : c.corps_html,
        source_type !== undefined ? source_type : c.source_type, source_id !== undefined ? source_id : c.source_id,
        piece_jointe !== undefined ? (piece_jointe ? JSON.stringify(piece_jointe) : null) : c.piece_jointe,
        business_type_filter !== undefined ? business_type_filter : c.business_type_filter,
        days_before != null ? days_before : c.days_before,
        req.params.id
      );
      res.json(db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id));
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/campaigns/:id', (req, res) => {
    try {
      const c = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!c) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (c.statut === 'en_cours') return res.status(400).json({ erreur: 'Impossible de supprimer une campagne en cours' });
      db.prepare('DELETE FROM partner_campaign_recipients WHERE campaign_id = ?').run(req.params.id);
      db.prepare('DELETE FROM partner_campaign_events WHERE campaign_id = ?').run(req.params.id);
      db.prepare('DELETE FROM partner_campaigns WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Preview destinataires (sans les ajouter)
  router.post('/campaigns/:id/recipients/preview', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });

      const { source_type, source_id } = req.body;
      let contactsToPreview = [];

      if (source_type === 'segment') {
        const rules = db.prepare('SELECT * FROM partner_segment_rules WHERE segment_id = ? ORDER BY ordre').all(source_id);
        const partners = resolveSegment(rules);
        for (const p of partners) {
          const pContacts = db.prepare("SELECT * FROM hubspot_partner_contacts WHERE hubspot_company_id = ? AND email IS NOT NULL AND email != ''").all(p.hubspot_company_id);
          for (const c of pContacts) {
            contactsToPreview.push({ contact_id: c.id, email: c.email, firstname: c.firstname, lastname: c.lastname, partner_name: p.name, jobtitle: c.jobtitle });
          }
        }
      } else if (source_type === 'contact_list') {
        const members = db.prepare(`
          SELECT c.*, p.name as partner_name FROM partner_contact_list_members m
          JOIN hubspot_partner_contacts c ON c.id = m.contact_id
          JOIN hubspot_partners p ON p.hubspot_company_id = c.hubspot_company_id
          WHERE m.list_id = ? AND c.email IS NOT NULL AND c.email != ''
        `).all(source_id);
        contactsToPreview = members.map(m => ({ contact_id: m.id, email: m.email, firstname: m.firstname, lastname: m.lastname, partner_name: m.partner_name, jobtitle: m.jobtitle }));
      } else {
        return res.status(400).json({ erreur: 'source_type requis (segment ou contact_list)' });
      }

      // Mark already_added
      const existing = new Set(db.prepare('SELECT email FROM partner_campaign_recipients WHERE campaign_id = ?').all(req.params.id).map(r => r.email.toLowerCase()));
      const result = contactsToPreview.map(c => ({
        ...c,
        already_added: existing.has((c.email || '').toLowerCase()),
      }));

      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Ajouter destinataires (depuis segment, liste ou manuel)
  router.post('/campaigns/:id/recipients', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'brouillon') return res.status(400).json({ erreur: 'Campagne non modifiable' });

      const { source_type, source_id, contacts, exclude_emails } = req.body;
      let contactsToAdd = [];

      if (source_type === 'segment') {
        const rules = db.prepare('SELECT * FROM partner_segment_rules WHERE segment_id = ? ORDER BY ordre').all(source_id);
        const partners = resolveSegment(rules);
        for (const p of partners) {
          const pContacts = db.prepare("SELECT * FROM hubspot_partner_contacts WHERE hubspot_company_id = ? AND email IS NOT NULL AND email != ''").all(p.hubspot_company_id);
          for (const c of pContacts) {
            contactsToAdd.push({ contact_id: c.id, email: c.email, firstname: c.firstname, lastname: c.lastname, partner_name: p.name });
          }
        }
      } else if (source_type === 'contact_list') {
        const members = db.prepare(`
          SELECT c.*, p.name as partner_name FROM partner_contact_list_members m
          JOIN hubspot_partner_contacts c ON c.id = m.contact_id
          JOIN hubspot_partners p ON p.hubspot_company_id = c.hubspot_company_id
          WHERE m.list_id = ? AND c.email IS NOT NULL AND c.email != ''
        `).all(source_id);
        contactsToAdd = members.map(m => ({ contact_id: m.id, email: m.email, firstname: m.firstname, lastname: m.lastname, partner_name: m.partner_name }));
      } else if (source_type === 'manual' && contacts) {
        contactsToAdd = contacts;
      } else {
        return res.status(400).json({ erreur: 'source_type invalide (segment, contact_list, manual)' });
      }

      // Dédupliquer + exclure
      const existing = new Set(db.prepare('SELECT email FROM partner_campaign_recipients WHERE campaign_id = ?').all(req.params.id).map(r => r.email.toLowerCase()));
      const excludeSet = new Set((exclude_emails || []).map(e => e.toLowerCase()));
      const ins = db.prepare('INSERT INTO partner_campaign_recipients (id, campaign_id, contact_id, email, firstname, lastname, partner_name, tracking_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      let added = 0, skipped = 0;
      db.transaction(() => {
        for (const c of contactsToAdd) {
          if (!c.email || existing.has(c.email.toLowerCase()) || excludeSet.has(c.email.toLowerCase())) { skipped++; continue; }
          ins.run(randomUUID(), req.params.id, c.contact_id || null, c.email, c.firstname || '', c.lastname || '', c.partner_name || '', randomUUID());
          existing.add(c.email.toLowerCase());
          added++;
        }
      })();

      const total = db.prepare('SELECT COUNT(*) as n FROM partner_campaign_recipients WHERE campaign_id = ?').get(req.params.id).n;
      db.prepare('UPDATE partner_campaigns SET total_recipients = ? WHERE id = ?').run(total, req.params.id);

      res.json({ added, skipped, total });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.get('/campaigns/:id/recipients', (req, res) => {
    try {
      const recipients = db.prepare('SELECT * FROM partner_campaign_recipients WHERE campaign_id = ? ORDER BY partner_name, lastname').all(req.params.id);
      res.json(recipients);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Prochains envois prévus pour une campagne anniversaire active
  router.get('/campaigns/:id/upcoming', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.type !== 'anniversaire') return res.json([]);

      const currentYear = new Date().getFullYear();
      const daysBefore = campaign.days_before != null ? campaign.days_before : 0;

      let btFilter = '';
      const params = [];
      if (campaign.business_type_filter) { btFilter = ' AND hp.business_type = ?'; params.push(campaign.business_type_filter); }

      // Trouver partenaires avec anniversaire dans les 90 prochains jours
      const partners = db.prepare(`
        SELECT hp.id, hp.name, hp.business_type, hp.hubspot_company_id, hp.partner_since,
          CAST(strftime('%Y', 'now') AS INTEGER) - CAST(strftime('%Y', hp.partner_since) AS INTEGER) as years_at_anniversary,
          CASE
            WHEN julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) >= julianday('now')
            THEN printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))
            ELSE printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER)+1, CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))
          END as anniversary_date
        FROM hubspot_partners hp
        WHERE hp.partner_since IS NOT NULL AND hp.partner_since != ''${btFilter}
          AND CASE
            WHEN julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) >= julianday('now')
            THEN CAST(julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) - julianday('now') AS INTEGER)
            ELSE CAST(julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER)+1, CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) - julianday('now') AS INTEGER)
          END <= 90
        ORDER BY anniversary_date
      `).all(...params);

      const upcoming = [];
      for (const p of partners) {
        const excluded = db.prepare('SELECT 1 FROM partner_anniversary_exclusions WHERE partner_id = ?').get(p.id);
        if (excluded) continue;
        const sent = db.prepare('SELECT 1 FROM partner_anniversary_logs WHERE partner_id = ? AND year = ? AND template_id = ?').get(p.id, currentYear, campaign.id);
        if (sent) continue;

        const contacts = db.prepare("SELECT email, firstname, lastname FROM hubspot_partner_contacts WHERE hubspot_company_id = ? AND email IS NOT NULL AND email != ''").all(p.hubspot_company_id);
        if (contacts.length === 0) continue;

        // Date d'envoi = anniversary_date - days_before
        const annivDate = new Date(p.anniversary_date + 'T00:00:00');
        const sendDate = new Date(annivDate.getTime() - daysBefore * 24 * 3600 * 1000);
        const sendDateStr = sendDate.toISOString().split('T')[0];

        for (const c of contacts) {
          upcoming.push({
            email: c.email,
            firstname: c.firstname,
            lastname: c.lastname,
            partner_name: p.name,
            anniversary_date: p.anniversary_date,
            send_date: sendDateStr,
            years: p.years_at_anniversary,
          });
        }
      }

      upcoming.sort((a, b) => a.send_date.localeCompare(b.send_date));
      res.json(upcoming);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Supprimer un destinataire
  router.delete('/campaigns/:id/recipients/:recipientId', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'brouillon') return res.status(400).json({ erreur: 'Campagne non modifiable' });
      db.prepare('DELETE FROM partner_campaign_recipients WHERE id = ? AND campaign_id = ?').run(req.params.recipientId, req.params.id);
      const total = db.prepare('SELECT COUNT(*) as n FROM partner_campaign_recipients WHERE campaign_id = ?').get(req.params.id).n;
      db.prepare('UPDATE partner_campaigns SET total_recipients = ? WHERE id = ?').run(total, req.params.id);
      res.json({ ok: true, total });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Dupliquer une campagne
  router.post('/campaigns/:id/duplicate', (req, res) => {
    try {
      const c = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!c) return res.status(404).json({ erreur: 'Campagne introuvable' });
      const newId = randomUUID();
      db.prepare('INSERT INTO partner_campaigns (id, nom, sujet, corps_html, source_type, source_id, piece_jointe) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        newId, c.nom + ' (copie)', c.sujet, c.corps_html, c.source_type, c.source_id, c.piece_jointe
      );
      res.json(db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(newId));
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Test send
  router.post('/campaigns/:id/test', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ erreur: 'email requis' });
      const campaign = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });

      const brevoService = require('../services/brevoService');
      const sujet = `[TEST] ${campaign.sujet}`;
      let html = substitutePartnerVars(campaign.corps_html || '', {
        prenom: 'Test', nom: 'Utilisateur', hotel: 'Hôtel Example', business_type: 'Luxe', partner_since: '2024-01-01', anniversaire_annees: 1,
      });
      const signature = brevoService.SIGNATURE_HUGO || '';
      if (signature) html += `<br/><br/>${signature}`;

      const emailPayload = {
        sender: brevoService.SENDER,
        to: [{ email, name: 'Test' }],
        subject: sujet,
        htmlContent: html,
        replyTo: { email: brevoService.SENDER.email, name: brevoService.SENDER.name },
      };

      if (campaign.piece_jointe) {
        try {
          const pj = typeof campaign.piece_jointe === 'string' ? JSON.parse(campaign.piece_jointe) : campaign.piece_jointe;
          if (pj?.data) emailPayload.attachment = [{ content: pj.data, name: pj.nom }];
        } catch (_) {}
      }

      await brevoService.brevoSendEmail(emailPayload);

      res.json({ ok: true, message: `Email test envoyé à ${email}` });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Envoi réel
  router.post('/campaigns/:id/send-now', async (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });
      if (campaign.statut !== 'brouillon' && campaign.statut !== 'programmée') return res.status(400).json({ erreur: 'Campagne non envoyable' });

      const recipients = db.prepare("SELECT * FROM partner_campaign_recipients WHERE campaign_id = ? AND statut = 'en_attente'").all(req.params.id);
      if (recipients.length === 0) return res.status(400).json({ erreur: 'Aucun destinataire' });

      db.prepare("UPDATE partner_campaigns SET statut = 'en_cours', started_at = datetime('now') WHERE id = ?").run(req.params.id);

      // Envoi asynchrone
      sendPartnerCampaign(campaign, recipients).catch(err => {
        console.error('Erreur envoi campagne partenaire:', err.message);
      });

      res.json({ ok: true, message: `Envoi lancé (${recipients.length} destinataires)` });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  async function sendPartnerCampaign(campaign, recipients) {
    const brevoService = require('../services/brevoService');
    let sentCount = 0, errorCount = 0;

    for (const r of recipients) {
      try {
        // Récupérer infos partenaire si possible
        let partnerData = { prenom: r.firstname, nom: r.lastname, hotel: r.partner_name, business_type: '', partner_since: '', anniversaire_annees: '' };
        if (r.contact_id) {
          const contact = db.prepare('SELECT c.*, p.business_type, p.partner_since, p.name as pname FROM hubspot_partner_contacts c JOIN hubspot_partners p ON p.hubspot_company_id = c.hubspot_company_id WHERE c.id = ?').get(r.contact_id);
          if (contact) {
            partnerData.business_type = contact.business_type || '';
            partnerData.partner_since = contact.partner_since || '';
            partnerData.hotel = contact.pname || r.partner_name;
            if (contact.partner_since) {
              const years = Math.floor((Date.now() - new Date(contact.partner_since).getTime()) / (365.25 * 24 * 3600 * 1000));
              partnerData.anniversaire_annees = years;
            }
          }
        }

        let html = substitutePartnerVars(campaign.corps_html || '', partnerData);
        const sujetFinal = substitutePartnerVars(campaign.sujet, partnerData);

        // Ajouter signature
        const signature = brevoService.SIGNATURE_HUGO || '';
        if (signature) {
          html += `<br/><br/>${signature}`;
        }

        const emailPayload = {
          sender: brevoService.SENDER,
          to: [{ email: r.email, name: `${r.firstname || ''} ${r.lastname || ''}`.trim() || r.partner_name }],
          subject: sujetFinal,
          htmlContent: html,
          replyTo: { email: brevoService.SENDER.email, name: brevoService.SENDER.name },
        };

        // Pièce jointe
        if (campaign.piece_jointe) {
          try {
            const pj = typeof campaign.piece_jointe === 'string' ? JSON.parse(campaign.piece_jointe) : campaign.piece_jointe;
            if (pj?.data) {
              emailPayload.attachment = [{ content: pj.data, name: pj.nom }];
            }
          } catch (_) {}
        }

        await brevoService.brevoSendEmail(emailPayload);

        db.prepare("UPDATE partner_campaign_recipients SET statut = 'envoyé', sent_at = datetime('now') WHERE id = ?").run(r.id);
        sentCount++;

        // Pause entre envois
        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));
      } catch (err) {
        db.prepare("UPDATE partner_campaign_recipients SET statut = 'erreur', error = ? WHERE id = ?").run(err.message, r.id);
        errorCount++;
      }
    }

    db.prepare("UPDATE partner_campaigns SET statut = 'terminée', completed_at = datetime('now'), sent_count = ?, error_count = ? WHERE id = ?").run(sentCount, errorCount, campaign.id);
  }

  function substitutePartnerVars(text, data) {
    if (!text) return '';
    return text
      .replace(/\{\{prenom\}\}/g, data.prenom || '')
      .replace(/\{\{nom\}\}/g, data.nom || '')
      .replace(/\{\{hotel\}\}/g, data.hotel || '')
      .replace(/\{\{business_type\}\}/g, data.business_type || '')
      .replace(/\{\{partner_since\}\}/g, data.partner_since || '')
      .replace(/\{\{anniversaire_annees\}\}/g, String(data.anniversaire_annees || ''));
  }

  router.get('/campaigns/:id/stats', (req, res) => {
    try {
      const campaign = db.prepare('SELECT * FROM partner_campaigns WHERE id = ?').get(req.params.id);
      if (!campaign) return res.status(404).json({ erreur: 'Campagne introuvable' });

      const breakdown = db.prepare('SELECT statut, COUNT(*) as count FROM partner_campaign_recipients WHERE campaign_id = ? GROUP BY statut').all(req.params.id);
      const events = db.prepare('SELECT type, COUNT(*) as count FROM partner_campaign_events WHERE campaign_id = ? GROUP BY type').all(req.params.id);

      res.json({
        ...campaign,
        recipient_breakdown: breakdown,
        events,
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PROGRAMMES AUTOMATIQUES
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/programs', (req, res) => {
    try {
      const programs = db.prepare('SELECT * FROM partner_auto_programs ORDER BY created_at DESC').all();
      const result = programs.map(p => {
        const milestones = db.prepare('SELECT * FROM partner_program_milestones WHERE program_id = ? ORDER BY ordre').all(p.id);
        const logs_count = db.prepare('SELECT COUNT(*) as n FROM partner_milestone_logs ml JOIN partner_program_milestones pm ON pm.id = ml.milestone_id WHERE pm.program_id = ?').get(p.id).n;
        return { ...p, milestones, logs_count };
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/programs', (req, res) => {
    try {
      const { nom, type, milestones } = req.body;
      if (!nom || !type) return res.status(400).json({ erreur: 'nom et type requis' });
      const id = randomUUID();
      db.prepare('INSERT INTO partner_auto_programs (id, nom, type) VALUES (?, ?, ?)').run(id, nom, type);
      if (milestones?.length) {
        const ins = db.prepare('INSERT INTO partner_program_milestones (id, program_id, trigger_type, trigger_value, sujet, corps_html, ordre) VALUES (?, ?, ?, ?, ?, ?, ?)');
        milestones.forEach((m, i) => ins.run(randomUUID(), id, m.trigger_type, m.trigger_value || null, m.sujet, m.corps_html || '', i));
      }
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.put('/programs/:id', (req, res) => {
    try {
      const prog = db.prepare('SELECT * FROM partner_auto_programs WHERE id = ?').get(req.params.id);
      if (!prog) return res.status(404).json({ erreur: 'Programme introuvable' });
      const { nom, type, actif } = req.body;
      db.prepare('UPDATE partner_auto_programs SET nom = ?, type = ?, actif = ? WHERE id = ?').run(
        nom || prog.nom, type || prog.type, actif !== undefined ? (actif ? 1 : 0) : prog.actif, req.params.id
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/programs/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM partner_auto_programs WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // Milestones CRUD
  router.post('/programs/:id/milestones', (req, res) => {
    try {
      const { trigger_type, trigger_value, sujet, corps_html } = req.body;
      if (!trigger_type || !sujet) return res.status(400).json({ erreur: 'trigger_type et sujet requis' });
      const maxOrdre = db.prepare('SELECT MAX(ordre) as m FROM partner_program_milestones WHERE program_id = ?').get(req.params.id).m || 0;
      const id = randomUUID();
      db.prepare('INSERT INTO partner_program_milestones (id, program_id, trigger_type, trigger_value, sujet, corps_html, ordre) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        id, req.params.id, trigger_type, trigger_value || null, sujet, corps_html || '', maxOrdre + 1
      );
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.put('/programs/milestones/:id', (req, res) => {
    try {
      const ms = db.prepare('SELECT * FROM partner_program_milestones WHERE id = ?').get(req.params.id);
      if (!ms) return res.status(404).json({ erreur: 'Milestone introuvable' });
      const { trigger_type, trigger_value, sujet, corps_html, ordre } = req.body;
      db.prepare('UPDATE partner_program_milestones SET trigger_type = ?, trigger_value = ?, sujet = ?, corps_html = ?, ordre = ? WHERE id = ?').run(
        trigger_type || ms.trigger_type, trigger_value !== undefined ? trigger_value : ms.trigger_value,
        sujet || ms.sujet, corps_html !== undefined ? corps_html : ms.corps_html,
        ordre !== undefined ? ordre : ms.ordre, req.params.id
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.delete('/programs/milestones/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM partner_program_milestones WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONTACT LISTS (migré depuis accountManagement)
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/contact-lists', (req, res) => {
    try {
      const lists = db.prepare(`
        SELECT l.*, COUNT(m.id) as member_count
        FROM partner_contact_lists l
        LEFT JOIN partner_contact_list_members m ON m.list_id = l.id
        GROUP BY l.id ORDER BY l.updated_at DESC
      `).all();
      res.json(lists);
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.post('/contact-lists', (req, res) => {
    try {
      const { name, description, contact_ids } = req.body;
      if (!name) return res.status(400).json({ erreur: 'name requis' });
      const id = randomUUID();
      db.prepare('INSERT INTO partner_contact_lists (id, name, description, created_by) VALUES (?, ?, ?, ?)').run(id, name, description || null, req.user?.nom || 'system');
      if (contact_ids?.length) {
        const ins = db.prepare('INSERT OR IGNORE INTO partner_contact_list_members (list_id, contact_id) VALUES (?, ?)');
        for (const cid of contact_ids) ins.run(id, cid);
      }
      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.get('/contact-lists/:id/members', (req, res) => {
    try {
      const members = db.prepare(`
        SELECT c.*, p.name as partner_name, p.business_type, p.partner_since, p.city as partner_city
        FROM partner_contact_list_members m
        JOIN hubspot_partner_contacts c ON c.id = m.contact_id
        JOIN hubspot_partners p ON p.hubspot_company_id = c.hubspot_company_id
        WHERE m.list_id = ? ORDER BY p.name, c.lastname
      `).all(req.params.id);
      res.json(members);
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.delete('/contact-lists/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM partner_contact_list_members WHERE list_id = ?').run(req.params.id);
      db.prepare('DELETE FROM partner_contact_lists WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  TEMPLATES PARTENAIRES
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/templates', (req, res) => {
    try {
      const templates = db.prepare('SELECT * FROM partner_email_templates ORDER BY categorie, nom').all();
      res.json(templates);
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.post('/templates', (req, res) => {
    try {
      const { nom, categorie, sujet, corps_html } = req.body;
      if (!nom || !sujet) return res.status(400).json({ erreur: 'nom et sujet requis' });
      const id = randomUUID();
      db.prepare('INSERT INTO partner_email_templates (id, nom, categorie, sujet, corps_html) VALUES (?, ?, ?, ?, ?)').run(id, nom, categorie || 'General', sujet, corps_html || '');
      res.json(db.prepare('SELECT * FROM partner_email_templates WHERE id = ?').get(id));
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.put('/templates/:id', (req, res) => {
    try {
      const t = db.prepare('SELECT * FROM partner_email_templates WHERE id = ?').get(req.params.id);
      if (!t) return res.status(404).json({ erreur: 'Template introuvable' });
      const { nom, categorie, sujet, corps_html } = req.body;
      db.prepare('UPDATE partner_email_templates SET nom = ?, categorie = ?, sujet = ?, corps_html = ? WHERE id = ?').run(
        nom || t.nom, categorie !== undefined ? categorie : t.categorie, sujet || t.sujet,
        corps_html !== undefined ? corps_html : t.corps_html, req.params.id
      );
      res.json(db.prepare('SELECT * FROM partner_email_templates WHERE id = ?').get(req.params.id));
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.delete('/templates/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM partner_email_templates WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ANNIVERSARY CONFIG & LOGS
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/anniversary-config', (req, res) => {
    try {
      const config = db.prepare('SELECT * FROM partner_anniversary_config LIMIT 1').get() || null;
      res.json(config);
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.put('/anniversary-config', (req, res) => {
    try {
      const { template_id, days_before, active } = req.body;
      const existing = db.prepare('SELECT * FROM partner_anniversary_config LIMIT 1').get();
      if (existing) {
        db.prepare('UPDATE partner_anniversary_config SET template_id = ?, days_before = ?, active = ? WHERE id = ?').run(
          template_id || existing.template_id, days_before !== undefined ? days_before : existing.days_before,
          active !== undefined ? (active ? 1 : 0) : existing.active, existing.id
        );
      } else {
        const id = randomUUID();
        db.prepare('INSERT INTO partner_anniversary_config (id, template_id, days_before, active) VALUES (?, ?, ?, ?)').run(
          id, template_id || null, days_before || 0, active ? 1 : 0
        );
      }
      res.json(db.prepare('SELECT * FROM partner_anniversary_config LIMIT 1').get());
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  // Exclure un partenaire des emails anniversaire
  router.post('/anniversary-exclude/:partnerId', (req, res) => {
    try {
      db.prepare('INSERT OR IGNORE INTO partner_anniversary_exclusions (partner_id) VALUES (?)').run(req.params.partnerId);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  // Réintégrer un partenaire dans les emails anniversaire
  router.delete('/anniversary-exclude/:partnerId', (req, res) => {
    try {
      db.prepare('DELETE FROM partner_anniversary_exclusions WHERE partner_id = ?').run(req.params.partnerId);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ANNIVERSARY RULES (par business_type)
  // ═══════════════════════════════════════════════════════════════════════════

  router.get('/anniversary-rules', (req, res) => {
    try {
      const rules = db.prepare('SELECT * FROM partner_anniversary_rules ORDER BY business_type').all();
      res.json(rules);
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.post('/anniversary-rules', (req, res) => {
    try {
      const { business_type, template_id } = req.body;
      if (!business_type) return res.status(400).json({ erreur: 'business_type requis' });
      const id = randomUUID();
      db.prepare(`INSERT INTO partner_anniversary_rules (id, business_type, template_id) VALUES (?, ?, ?)
        ON CONFLICT(business_type) DO UPDATE SET template_id = excluded.template_id`).run(id, business_type, template_id || null);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.delete('/anniversary-rules/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM partner_anniversary_rules WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  // Partenaires éligibles (60 prochains jours)
  router.get('/anniversary-eligible', (req, res) => {
    try {
      const currentYear = new Date().getFullYear();
      const { business_type } = req.query;
      let btFilter = '';
      const params = [];
      if (business_type) { btFilter = ' AND hp.business_type = ?'; params.push(business_type); }
      const partners = db.prepare(`
        SELECT hp.*,
          CASE
            WHEN julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) >= julianday('now')
            THEN printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))
            ELSE printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER)+1, CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))
          END as anniversary_date,
          CASE
            WHEN julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) >= julianday('now')
            THEN CAST(julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) - julianday('now') AS INTEGER)
            ELSE CAST(julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER)+1, CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) - julianday('now') AS INTEGER)
          END as days_until
        FROM hubspot_partners hp
        WHERE hp.partner_since IS NOT NULL AND hp.partner_since != ''${btFilter}
          AND CASE
            WHEN julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) >= julianday('now')
            THEN CAST(julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) - julianday('now') AS INTEGER)
            ELSE CAST(julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER)+1, CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) - julianday('now') AS INTEGER)
          END <= 60
        ORDER BY days_until
      `).all(...params);

      // Enrich with exclusion/sent status
      for (const p of partners) {
        const excl = db.prepare('SELECT 1 FROM partner_anniversary_exclusions WHERE partner_id = ?').get(p.id);
        p.excluded = !!excl;
        const sent = db.prepare('SELECT 1 FROM partner_anniversary_logs WHERE partner_id = ? AND year = ?').get(p.id, currentYear);
        p.already_sent = !!sent;
      }

      res.json(partners);
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  // Contacts des partenaires éligibles (preview pour campagne anniversaire)
  router.get('/anniversary-eligible/contacts', (req, res) => {
    try {
      const currentYear = new Date().getFullYear();
      const { business_type } = req.query;
      let btFilter = '';
      const params = [];
      if (business_type) { btFilter = ' AND hp.business_type = ?'; params.push(business_type); }

      const partners = db.prepare(`
        SELECT hp.id, hp.name, hp.business_type, hp.hubspot_company_id, hp.partner_since,
          CASE
            WHEN julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) >= julianday('now')
            THEN printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))
            ELSE printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER)+1, CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))
          END as anniversary_date
        FROM hubspot_partners hp
        WHERE hp.partner_since IS NOT NULL AND hp.partner_since != ''${btFilter}
          AND CASE
            WHEN julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) >= julianday('now')
            THEN CAST(julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER), CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) - julianday('now') AS INTEGER)
            ELSE CAST(julianday(printf('%04d-%02d-%02d', CAST(strftime('%Y','now') AS INTEGER)+1, CAST(strftime('%m',hp.partner_since) AS INTEGER), CAST(strftime('%d',hp.partner_since) AS INTEGER))) - julianday('now') AS INTEGER)
          END <= 60
        ORDER BY anniversary_date
      `).all(...params);

      const contacts = [];
      for (const p of partners) {
        // Vérifier exclusion
        const excluded = db.prepare('SELECT 1 FROM partner_anniversary_exclusions WHERE partner_id = ?').get(p.id);
        if (excluded) continue;
        // Vérifier pas déjà envoyé
        const sent = db.prepare('SELECT 1 FROM partner_anniversary_logs WHERE partner_id = ? AND year = ?').get(p.id, currentYear);
        if (sent) continue;

        const pContacts = db.prepare("SELECT * FROM hubspot_partner_contacts WHERE hubspot_company_id = ? AND email IS NOT NULL AND email != ''").all(p.hubspot_company_id);
        for (const c of pContacts) {
          contacts.push({ email: c.email, firstname: c.firstname, lastname: c.lastname, partner_name: p.name, business_type: p.business_type, anniversary_date: p.anniversary_date });
        }
      }
      res.json(contacts);
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  router.get('/anniversary-logs', (req, res) => {
    try {
      const logs = db.prepare(`
        SELECT l.*, hp.name as partner_name, pet.nom as template_name
        FROM partner_anniversary_logs l
        LEFT JOIN hubspot_partners hp ON hp.id = l.partner_id
        LEFT JOIN partner_email_templates pet ON pet.id = l.template_id
        ORDER BY l.sent_at DESC LIMIT 50
      `).all();
      res.json(logs);
    } catch (e) { res.status(500).json({ erreur: e.message }); }
  });

  return router;
};
