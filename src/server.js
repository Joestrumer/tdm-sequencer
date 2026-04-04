require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const logger = require('./config/logger');

const db = require('./db/init.js');

// Auto-seed des données factures si manquantes ou incomplètes
try {
  const check = db.prepare("SELECT COUNT(*) as n FROM vf_code_mappings WHERE type = 'product_id' AND code_source = 'P037-5000-41.00'").get();
  const gsheetsCreds = db.prepare("SELECT valeur FROM config WHERE cle = 'gsheets_credentials'").get();
  let credsValid = false;
  if (gsheetsCreds?.valeur) {
    try {
      const parsed = JSON.parse(gsheetsCreds.valeur);
      credsValid = !!(parsed.private_key && parsed.client_email);
    } catch (_) {
      console.warn('⚠️ Credentials GSheets invalides (JSON parse fail), re-seed nécessaire');
    }
  }
  if (!check || check.n === 0 || !credsValid) {
    console.log('🌱 Données factures manquantes ou incomplètes, lancement du seed...');
    require('child_process').execSync('node src/db/seedFactures.js', {
      cwd: __dirname + '/..',
      stdio: 'inherit',
      env: { ...process.env, DB_PATH: process.env.DB_PATH },
    });
  } else {
    console.log('✅ Données factures déjà à jour');
  }
} catch (e) {
  console.error('⚠️ Erreur auto-seed factures:', e.message);
}

const scheduler = require('./jobs/sequenceScheduler');
scheduler.initialiser(db);

const backup = require('./jobs/backup');
backup.initialiser(db);

const campaignSender = require('./jobs/campaignSender');
campaignSender.initialiser(db);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Santé AVANT auth
app.get('/api/health', (req, res) => {
  res.json({
    statut: 'ok',
    port: PORT,
    brevo: process.env.BREVO_API_KEY ? 'configuré' : 'non configuré',
    hubspot: process.env.HUBSPOT_API_KEY ? 'configuré' : 'non configuré',
    zerobounce: process.env.ZEROBOUNCE_API_KEY ? 'configuré' : 'non configuré',
  });
});

// Auth middleware (JWT + fallback AUTH_SECRET)
const authMiddleware = require('./middleware/auth');
const { requireAccessAuto, requireAdmin } = require('./middleware/permissions');

// Route login PUBLIQUE (avant auth middleware)
const authRoutes = require('./routes/auth')(db);
app.post('/api/auth/login', (req, res, next) => {
  // Forward vers le routeur auth
  req.url = '/login';
  authRoutes(req, res, next);
});

// API externe (auth par X-API-Key, avant le middleware JWT)
app.use('/api/external', require('./routes/external')(db));

// Auth middleware global
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path.startsWith('/tracking')) return next();
  if (req.path.startsWith('/partenaire')) return next();
  if (req.path.startsWith('/external')) return next();
  if (req.path === '/auth/login') return next();
  authMiddleware(db)(req, res, next);
});

// Routes auth protégées (me, profile)
app.use('/api/auth', authRoutes);

// Routes protégées avec permissions par onglet
app.use('/api/users',       require('./routes/users')(db));
app.use('/api/dashboard',     requireAccessAuto('dashboard'), require('./routes/dashboard')(db));
app.use('/api/stats',         requireAccessAuto('ventes'), require('./routes/stats')(db));
app.use('/api/leads',         requireAccessAuto('leads'), require('./routes/leads')(db));
app.use('/api/hubspot',       requireAccessAuto('leads'), require('./routes/hubspot')(db));
app.use('/api/sequences',     requireAccessAuto('campagnes'), require('./routes/sequences')(db));
app.use('/api/email-templates', requireAccessAuto('campagnes'), require('./routes/emailTemplates')(db));
app.use('/api/campaigns', requireAccessAuto('campagnes'), require('./routes/campaigns')(db));
app.use('/api/factures',      requireAccessAuto('factures'), require('./routes/factures')(db));
app.use('/api/gsheets',       requireAccessAuto('factures'), require('./routes/googlesheets')(db));
app.use('/api/partner-orders', requireAccessAuto('portail'), require('./routes/partnerOrders')(db));
app.use('/api/reference',     requireAccessAuto('portail'), require('./routes/referenceData')(db));
app.use('/api/shipments',     requireAccessAuto('portail'), require('./routes/shipments')(db));
app.use('/api/email-validation', requireAccessAuto('emails'), require('./routes/emailValidation')(db));
app.use('/api/segments',      requireAccessAuto('config'), require('./routes/segments')(db));
app.use('/api/config',        requireAccessAuto('config'), require('./routes/config')(db));
app.use('/api/blocklist',     requireAccessAuto('config'), require('./routes/blocklist')(db));
app.use('/api/qualification', requireAccessAuto('leads'), require('./routes/qualification')(db));
app.use('/api/tracking',  require('./routes/tracking')(db));
app.use('/api/partenaire', require('./routes/partnerPortal')(db));

// Diagnostic Brevo (protégé par auth)
app.get('/api/test-brevo', async (req, res) => {
  const results = {};
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const r = await fetch('https://api.brevo.com/v3/senders', {
      headers: { 'api-key': process.env.BREVO_API_KEY || '', 'accept': 'application/json' },
      signal: controller.signal,
    });
    const data = await r.json();
    results.api_rest = r.ok ? { ok: true, senders: data.senders?.length } : { ok: false, status: r.status, detail: JSON.stringify(data).slice(0, 200) };
  } catch(e) {
    results.api_rest = { ok: false, erreur: e.name === 'AbortError' ? 'TIMEOUT 8s' : e.message };
  }
  if (process.env.BREVO_SMTP_KEY) {
    try {
      const nodemailer = require('nodemailer');
      for (const port of [587, 465, 2525]) {
        try {
          const t = nodemailer.createTransport({
            host: 'smtp-relay.brevo.com', port, secure: port === 465,
            auth: { user: process.env.BREVO_SMTP_USER || 'hugo@terredemars.com', pass: process.env.BREVO_SMTP_KEY },
            connectionTimeout: 6000, greetingTimeout: 6000,
          });
          await t.verify();
          results['smtp_' + port] = { ok: true };
          break;
        } catch(e) {
          results['smtp_' + port] = { ok: false, erreur: e.message.slice(0, 100) };
        }
      }
    } catch(e) {
      results.smtp = { ok: false, erreur: 'nodemailer non disponible: ' + e.message };
    }
  } else {
    results.smtp = { ok: false, erreur: 'BREVO_SMTP_KEY non définie' };
  }
  results.ip_sortante = req.headers['x-forwarded-for'] || 'inconnue';
  res.json(results);
});

// Backup manuel (admin uniquement)
app.post('/api/backup', requireAdmin, async (req, res) => {
  try {
    const data = backup.exporterDonnees(db);
    const localPath = backup.sauvegarderLocal(data);
    const github = await backup.pushGitHub(data);
    res.json({
      ok: true,
      local: localPath,
      github: github ? 'ok' : 'échoué (GITHUB_TOKEN manquant ?)',
      stats: data._meta.tables
    });
  } catch (e) {
    res.status(500).json({ ok: false, erreur: e.message });
  }
});

// Colonnes autorisées par table pour la restauration (whitelist anti-injection SQL)
const RESTORE_SCHEMA = {
  events: ['id', 'lead_id', 'email_id', 'type', 'meta', 'created_at'],
  emails: ['id', 'lead_id', 'inscription_id', 'etape_id', 'sujet', 'tracking_id', 'brevo_message_id', 'statut', 'ouvertures', 'clics', 'envoye_at', 'created_at'],
  inscriptions: ['id', 'lead_id', 'sequence_id', 'etape_courante', 'prochain_envoi', 'statut', 'created_at'],
  etapes: ['id', 'sequence_id', 'ordre', 'jour_delai', 'sujet', 'corps', 'corps_html', 'piece_jointe', 'created_at'],
  sequences: ['id', 'nom', 'segment', 'options', 'actif', 'created_at'],
  leads: ['id', 'prenom', 'nom', 'email', 'hotel', 'ville', 'segment', 'tags', 'poste', 'langue', 'campaign', 'comment', 'statut', 'score', 'hubspot_id', 'unsubscribed', 'statut_email', 'email_score', 'created_at', 'updated_at'],
  email_blocklist: ['id', 'type', 'value', 'raison', 'override_allowed', 'created_at'],
  email_templates: ['id', 'nom', 'sujet', 'corps_html', 'categorie', 'created_at', 'updated_at'],
  envoi_quota: ['date', 'count'],
};

// Restauration depuis un backup (admin uniquement)
app.post('/api/backup/restore', requireAdmin, (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !data._meta) return res.status(400).json({ erreur: 'Format de backup invalide' });

    const tables = Object.keys(RESTORE_SCHEMA);

    const restore = db.transaction(() => {
      for (const t of tables) {
        db.prepare(`DELETE FROM ${t}`).run();
      }
      for (const t of [...tables].reverse()) {
        if (!data[t] || data[t].length === 0) continue;
        const allowedCols = RESTORE_SCHEMA[t];
        const cols = Object.keys(data[t][0]).filter(c => allowedCols.includes(c));
        if (cols.length === 0) continue;
        const placeholders = cols.map(() => '?').join(', ');
        const stmt = db.prepare(`INSERT OR IGNORE INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`);
        for (const row of data[t]) {
          stmt.run(...cols.map(c => row[c]));
        }
      }
    });

    restore();
    res.json({
      ok: true,
      message: 'Restauration terminée',
      stats: Object.fromEntries(tables.map(t => [t, data[t]?.length || 0]))
    });
  } catch (e) {
    res.status(500).json({ ok: false, erreur: e.message });
  }
});

// Frontend statique
const publicPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  // Page portail partenaire (avant le catch-all)
  app.get('/partenaire', (req, res) => {
    res.sendFile(path.join(publicPath, 'partenaire.html'));
  });
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.json({ statut: 'ok' }));
}

// Erreurs
app.use((err, req, res, next) => {
  console.error('Erreur Express:', err.message);
  res.status(500).json({ erreur: 'Erreur interne' });
});

// ─── Checkpoint WAL périodique (toutes les 5 min) ────────────────────────────
const walCheckpoint = setInterval(() => {
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch (e) {
    logger.warn('WAL checkpoint échoué:', e.message);
  }
}, 5 * 60 * 1000);

// ─── Shutdown propre : checkpoint WAL avant arrêt ────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`${signal} reçu — arrêt propre...`);
  clearInterval(walCheckpoint);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    logger.info('✅ WAL checkpoint final effectué');
  } catch (e) {
    logger.warn('⚠️ WAL checkpoint final échoué:', e.message);
  }
  try {
    db.close();
    logger.info('✅ Base de données fermée');
  } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Serveur démarré sur 0.0.0.0:' + PORT);
  logger.info('🚀 Serveur démarré — http://localhost:' + PORT);
  logger.info('   Brevo  : ' + (process.env.BREVO_API_KEY ? '✅' : '⚠️  non configuré'));
  logger.info('   HubSpot: ' + (process.env.HUBSPOT_API_KEY ? '✅' : '➖ désactivé'));
  logger.info('   VF     : ' + (process.env.VF_API_TOKEN ? '✅' : '➖ désactivé'));
});