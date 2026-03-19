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

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Santé AVANT auth
// Route diagnostic Brevo (pas d'auth requise)
app.get('/api/test-brevo', async (req, res) => {
  const results = {};

  // Test 1 : API REST
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

  // Test 2 : SMTP via nodemailer (si clé dispo)
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

app.get('/api/health', (req, res) => {
  res.json({
    statut: 'ok',
    port: PORT,
    brevo: process.env.BREVO_API_KEY ? 'configuré' : 'non configuré',
    hubspot: process.env.HUBSPOT_API_KEY ? 'configuré' : 'non configuré',
    zerobounce: process.env.ZEROBOUNCE_API_KEY ? 'configuré' : 'non configuré',
  });
});

// Auth
const authMiddleware = require('./middleware/auth');
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path.startsWith('/tracking')) return next();
  authMiddleware(req, res, next);
});

// Routes
app.use('/api/leads',     require('./routes/leads')(db));
app.use('/api/email-validation', require('./routes/emailValidation')(db));
app.use('/api/sequences', require('./routes/sequences')(db));
app.use('/api/tracking',  require('./routes/tracking')(db));
app.use('/api/stats',     require('./routes/stats')(db));
app.use('/api/hubspot',   require('./routes/hubspot')(db));
app.use('/api/config',    require('./routes/config')(db));
app.use('/api/blocklist', require('./routes/blocklist')(db));
app.use('/api/qualification', require('./routes/qualification')(db));
app.use('/api/factures',      require('./routes/factures')(db));
app.use('/api/gsheets',       require('./routes/googlesheets')(db));
app.use('/api/reference',     require('./routes/referenceData')(db));
app.use('/api/shipments',     require('./routes/shipments')(db));
app.use('/api/dashboard',     require('./routes/dashboard')(db));
app.use('/api/email-templates', require('./routes/emailTemplates')(db));

// Frontend statique
const publicPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
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