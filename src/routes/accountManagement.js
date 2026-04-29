/**
 * accountManagement.js — Account Management partenaires
 * Dashboard, alertes, communications, programmes, notes
 */
const { Router } = require('express');
const { randomUUID } = require('crypto');

module.exports = (db) => {
  const router = Router();

  // ─── Dashboard KPIs ─────────────────────────────────────────────────────────
  router.get('/dashboard', (req, res) => {
    try {
      // CA total et nb commandes
      const caStats = db.prepare(`
        SELECT COALESCE(SUM(total_ht), 0) as ca_total,
               COUNT(*) as nb_commandes,
               COALESCE(AVG(total_ht), 0) as panier_moyen
        FROM partner_orders WHERE statut != 'annule'
      `).get();

      // Partenaires actifs (au moins 1 commande)
      const partenairesActifs = db.prepare(`
        SELECT COUNT(DISTINCT partner_id) as n FROM partner_orders WHERE statut != 'annule'
      `).get().n;

      // Partenaires total
      const partenairesTotal = db.prepare(`SELECT COUNT(*) as n FROM vf_partners WHERE actif = 1`).get().n;

      // Config alerte
      const alertConfig = db.prepare('SELECT seuil_jours FROM partner_alert_config WHERE actif = 1 LIMIT 1').get();
      const seuil = alertConfig?.seuil_jours || 60;

      // Partenaires à risque (dernière commande > seuil jours)
      const aRisque = db.prepare(`
        SELECT COUNT(*) as n FROM vf_partners
        WHERE actif = 1 AND derniere_commande_at IS NOT NULL
        AND derniere_commande_at < datetime('now', '-' || ? || ' days')
      `).get(seuil).n;

      // Top 10 partenaires par CA
      const topPartenaires = db.prepare(`
        SELECT p.id, p.nom, p.programme_tier,
               COALESCE(SUM(o.total_ht), 0) as ca_total,
               COUNT(o.id) as nb_commandes,
               MAX(o.created_at) as derniere_commande
        FROM vf_partners p
        LEFT JOIN partner_orders o ON o.partner_id = p.id AND o.statut != 'annule'
        WHERE p.actif = 1
        GROUP BY p.id
        HAVING nb_commandes > 0
        ORDER BY ca_total DESC
        LIMIT 10
      `).all();

      // Tendance CA mensuel (12 derniers mois)
      const tendanceCA = db.prepare(`
        SELECT strftime('%Y-%m', created_at) as mois,
               COALESCE(SUM(total_ht), 0) as ca
        FROM partner_orders
        WHERE statut != 'annule' AND created_at >= datetime('now', '-12 months')
        GROUP BY mois ORDER BY mois
      `).all();

      // HubSpot Partners KPIs
      let hubspotKpis = { nb_partenaires: 0, points_eau: 0, ca_close_won: 0, par_business_type: [] };
      try {
        hubspotKpis.nb_partenaires = db.prepare('SELECT COUNT(*) as n FROM hubspot_partners').get().n;
        hubspotKpis.points_eau = db.prepare('SELECT COALESCE(SUM(capacite), 0) as n FROM hubspot_partners').get().n;
        hubspotKpis.par_business_type = db.prepare(`
          SELECT business_type, COUNT(*) as count, COALESCE(SUM(capacite), 0) as capacite_totale
          FROM hubspot_partners WHERE business_type IS NOT NULL AND business_type != ''
          GROUP BY business_type ORDER BY count DESC
        `).all();

        // Deals close won : rafraîchir le cache si >15min
        const lastCached = db.prepare('SELECT MAX(cached_at) as t FROM hubspot_deals_cache').get()?.t;
        const cacheAge = lastCached ? (Date.now() - new Date(lastCached).getTime()) / 60000 : Infinity;
        if (cacheAge > 15) {
          try {
            const hubspotService = require('../services/hubspotService');
            const deals = await hubspotService.getClosedWonDeals();
            if (deals.length > 0) {
              const now = new Date().toISOString();
              db.prepare('DELETE FROM hubspot_deals_cache').run();
              const ins = db.prepare(`INSERT INTO hubspot_deals_cache (hubspot_deal_id, hubspot_company_id, dealname, amount, closedate, dealstage, cached_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
              for (const d of deals) {
                ins.run(d.id, d.hubspot_company_id, d.dealname, d.amount, d.closedate, d.dealstage, now);
              }
            }
          } catch (e) { /* ignore cache refresh errors */ }
        }
        hubspotKpis.ca_close_won = db.prepare('SELECT COALESCE(SUM(amount), 0) as ca FROM hubspot_deals_cache').get().ca;
      } catch (_) { /* tables may not exist yet */ }

      res.json({
        kpis: {
          ca_total: caStats.ca_total,
          nb_commandes: caStats.nb_commandes,
          panier_moyen: caStats.panier_moyen,
          partenaires_actifs: partenairesActifs,
          partenaires_total: partenairesTotal,
          a_risque: aRisque,
        },
        hubspot_kpis: hubspotKpis,
        top_partenaires: topPartenaires,
        tendance_ca: tendanceCA,
        seuil_jours: seuil,
      });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Stats partenaire individuel ────────────────────────────────────────────
  router.get('/partners/:id/stats', (req, res) => {
    try {
      const { id } = req.params;
      const partner = db.prepare('SELECT * FROM vf_partners WHERE id = ?').get(id);
      if (!partner) return res.status(404).json({ erreur: 'Partenaire introuvable' });

      const stats = db.prepare(`
        SELECT COALESCE(SUM(total_ht), 0) as ca_total,
               COUNT(*) as nb_commandes,
               COALESCE(AVG(total_ht), 0) as panier_moyen,
               MIN(created_at) as premiere_commande,
               MAX(created_at) as derniere_commande
        FROM partner_orders WHERE partner_id = ? AND statut != 'annule'
      `).get(id);

      // Fréquence moyenne (jours entre commandes)
      const commandes = db.prepare(`
        SELECT created_at FROM partner_orders WHERE partner_id = ? AND statut != 'annule' ORDER BY created_at
      `).all(id);

      let frequence_jours = null;
      if (commandes.length >= 2) {
        const diffs = [];
        for (let i = 1; i < commandes.length; i++) {
          const d1 = new Date(commandes[i - 1].created_at);
          const d2 = new Date(commandes[i].created_at);
          diffs.push((d2 - d1) / (1000 * 60 * 60 * 24));
        }
        frequence_jours = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
      }

      // Programme actif
      const program = db.prepare(`
        SELECT * FROM partner_programs WHERE partner_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(id);

      res.json({ partner, stats: { ...stats, frequence_jours }, program });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Timeline partenaire (commandes + comms + notes) ────────────────────────
  router.get('/partners/:id/timeline', (req, res) => {
    try {
      const { id } = req.params;

      const commandes = db.prepare(`
        SELECT 'commande' as event_type, id, created_at, total_ht as montant, statut, products
        FROM partner_orders WHERE partner_id = ? ORDER BY created_at DESC LIMIT 50
      `).all(id);

      const comms = db.prepare(`
        SELECT 'communication' as event_type, id, created_at, sujet, type
        FROM partner_communications WHERE partner_id = ? ORDER BY created_at DESC LIMIT 50
      `).all(id);

      const notes = db.prepare(`
        SELECT 'note' as event_type, id, created_at, contenu, type, created_by
        FROM partner_notes WHERE partner_id = ? ORDER BY created_at DESC LIMIT 50
      `).all(id);

      // Fusionner et trier par date
      const timeline = [...commandes, ...comms, ...notes]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 50);

      res.json(timeline);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Alertes : partenaires inactifs ─────────────────────────────────────────
  router.get('/alerts', (req, res) => {
    try {
      const config = db.prepare('SELECT seuil_jours FROM partner_alert_config WHERE actif = 1 LIMIT 1').get();
      const seuil = config?.seuil_jours || 60;

      const alertes = db.prepare(`
        SELECT p.id, p.nom, p.email, p.contact_nom, p.programme_tier, p.derniere_commande_at,
               CAST(julianday('now') - julianday(p.derniere_commande_at) AS INTEGER) as jours_inactif
        FROM vf_partners p
        WHERE p.actif = 1 AND p.derniere_commande_at IS NOT NULL
        AND p.derniere_commande_at < datetime('now', '-' || ? || ' days')
        ORDER BY jours_inactif DESC
      `).all(seuil);

      res.json({ seuil_jours: seuil, alertes });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Config alertes ─────────────────────────────────────────────────────────
  router.post('/alerts/config', (req, res) => {
    try {
      const { seuil_jours } = req.body;
      if (!seuil_jours || seuil_jours < 1) return res.status(400).json({ erreur: 'seuil_jours requis (>= 1)' });

      const existing = db.prepare('SELECT id FROM partner_alert_config LIMIT 1').get();
      if (existing) {
        db.prepare('UPDATE partner_alert_config SET seuil_jours = ? WHERE id = ?').run(seuil_jours, existing.id);
      } else {
        db.prepare('INSERT INTO partner_alert_config (seuil_jours, actif) VALUES (?, 1)').run(seuil_jours);
      }
      res.json({ ok: true, seuil_jours });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Communications : envoi email groupé ────────────────────────────────────
  router.post('/communications/send', async (req, res) => {
    try {
      const { partner_ids, sujet, corps_html, template_id } = req.body;
      if (!partner_ids?.length || !sujet || !corps_html) {
        return res.status(400).json({ erreur: 'partner_ids, sujet et corps_html requis' });
      }

      const batchId = randomUUID();
      const results = [];
      const brevoService = require('../services/brevoService');

      for (const partnerId of partner_ids) {
        const partner = db.prepare('SELECT * FROM vf_partners WHERE id = ?').get(partnerId);
        if (!partner?.email) {
          results.push({ partner_id: partnerId, statut: 'skip', raison: 'pas d\'email' });
          continue;
        }

        // Substituer les variables partenaire
        let sujetFinal = sujet
          .replace(/\{\{nom_partenaire\}\}/g, partner.nom || '')
          .replace(/\{\{contact_nom\}\}/g, partner.contact_nom || '')
          .replace(/\{\{derniere_commande\}\}/g, partner.derniere_commande_at || 'N/A')
          .replace(/\{\{programme_tier\}\}/g, partner.programme_tier || 'standard');

        let corpsFinal = corps_html
          .replace(/\{\{nom_partenaire\}\}/g, partner.nom || '')
          .replace(/\{\{contact_nom\}\}/g, partner.contact_nom || '')
          .replace(/\{\{derniere_commande\}\}/g, partner.derniere_commande_at || 'N/A')
          .replace(/\{\{programme_tier\}\}/g, partner.programme_tier || 'standard');

        // Calculer CA total pour la variable
        const caTotal = db.prepare(`
          SELECT COALESCE(SUM(total_ht), 0) as ca FROM partner_orders WHERE partner_id = ? AND statut != 'annule'
        `).get(partnerId).ca;
        sujetFinal = sujetFinal.replace(/\{\{ca_total\}\}/g, caTotal.toFixed(2));
        corpsFinal = corpsFinal.replace(/\{\{ca_total\}\}/g, caTotal.toFixed(2));

        try {
          // Envoyer via Brevo
          const payload = {
            sender: brevoService.SENDER,
            to: [{ email: partner.email, name: partner.contact_nom || partner.nom }],
            subject: sujetFinal,
            htmlContent: corpsFinal,
            replyTo: { email: brevoService.SENDER.email, name: brevoService.SENDER.name },
          };

          let brevoMessageId = null;
          if (process.env.BREVO_API_KEY) {
            const result = await brevoService.brevoSendEmail(payload);
            brevoMessageId = result?.messageId || null;
          } else {
            brevoMessageId = `demo-${Date.now()}`;
          }

          // Enregistrer la communication
          const commId = randomUUID();
          db.prepare(`
            INSERT INTO partner_communications (id, partner_id, type, sujet, corps_html, template_id, brevo_message_id, batch_id, created_by)
            VALUES (?, ?, 'email', ?, ?, ?, ?, ?, ?)
          `).run(commId, partnerId, sujetFinal, corpsFinal, template_id || null, brevoMessageId, batchId, req.user?.nom || 'system');

          results.push({ partner_id: partnerId, statut: 'envoyé', comm_id: commId });
        } catch (sendErr) {
          results.push({ partner_id: partnerId, statut: 'erreur', raison: sendErr.message });
        }
      }

      res.json({ ok: true, batch_id: batchId, results });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Historique communications partenaire ───────────────────────────────────
  router.get('/communications/:partnerId', (req, res) => {
    try {
      const comms = db.prepare(`
        SELECT * FROM partner_communications WHERE partner_id = ? ORDER BY created_at DESC LIMIT 100
      `).all(req.params.partnerId);
      res.json(comms);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Programmes : CRUD ──────────────────────────────────────────────────────
  router.get('/programs', (req, res) => {
    try {
      const programs = db.prepare(`
        SELECT pp.*, p.nom as partner_nom, p.email as partner_email, p.contact_nom
        FROM partner_programs pp
        JOIN vf_partners p ON p.id = pp.partner_id
        ORDER BY pp.created_at DESC
      `).all();
      res.json(programs);
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.post('/programs', (req, res) => {
    try {
      const { partner_id, tier, label, engagement_volume, engagement_notes, contreparties, date_debut, date_revision, notes } = req.body;
      if (!partner_id || !tier) return res.status(400).json({ erreur: 'partner_id et tier requis' });

      const id = randomUUID();
      db.prepare(`
        INSERT INTO partner_programs (id, partner_id, tier, label, engagement_volume, engagement_notes, contreparties, date_debut, date_revision, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, partner_id, tier, label || null, engagement_volume || null, engagement_notes || null,
        typeof contreparties === 'object' ? JSON.stringify(contreparties) : contreparties || null,
        date_debut || null, date_revision || null, notes || null);

      // Mettre à jour le tier du partenaire
      db.prepare('UPDATE vf_partners SET programme_tier = ? WHERE id = ?').run(tier, partner_id);

      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  router.put('/programs/:id', (req, res) => {
    try {
      const { tier, label, engagement_volume, engagement_notes, contreparties, date_debut, date_revision, notes } = req.body;
      const program = db.prepare('SELECT * FROM partner_programs WHERE id = ?').get(req.params.id);
      if (!program) return res.status(404).json({ erreur: 'Programme introuvable' });

      db.prepare(`
        UPDATE partner_programs SET tier = ?, label = ?, engagement_volume = ?, engagement_notes = ?,
        contreparties = ?, date_debut = ?, date_revision = ?, notes = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(
        tier || program.tier, label ?? program.label, engagement_volume ?? program.engagement_volume,
        engagement_notes ?? program.engagement_notes,
        typeof contreparties === 'object' ? JSON.stringify(contreparties) : contreparties ?? program.contreparties,
        date_debut ?? program.date_debut, date_revision ?? program.date_revision,
        notes ?? program.notes, req.params.id
      );

      // Mettre à jour le tier du partenaire
      if (tier) {
        db.prepare('UPDATE vf_partners SET programme_tier = ? WHERE id = ?').run(tier, program.partner_id);
      }

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  // ─── Notes partenaire ───────────────────────────────────────────────────────
  router.post('/notes', (req, res) => {
    try {
      const { partner_id, contenu, type } = req.body;
      if (!partner_id || !contenu) return res.status(400).json({ erreur: 'partner_id et contenu requis' });

      const id = randomUUID();
      db.prepare(`
        INSERT INTO partner_notes (id, partner_id, type, contenu, created_by) VALUES (?, ?, ?, ?, ?)
      `).run(id, partner_id, type || 'note', contenu, req.user?.nom || 'system');

      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ erreur: e.message });
    }
  });

  return router;
};
