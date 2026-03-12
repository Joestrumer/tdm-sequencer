require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const logger = require('./config/logger');

const db = require('./db/init.js');
const scheduler = require('./jobs/sequenceScheduler');
scheduler.initialiser(db);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Santé AVANT auth
// Route diagnostic Brevo (pas d'auth requise)
app.get('/api/test-brevo', async (req, res) => {
  const key = process.env.BREVO_API_KEY;
  if (!key) return res.json({ ok: false, erreur: 'BREVO_API_KEY non définie' });
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 8000);
    const r = await fetch('https://api.brevo.com/v3/senders', {
      headers: { 'api-key': key, 'accept': 'application/json' },
      signal: controller.signal,
    });
    const data = await r.json();
    if (r.ok) res.json({ ok: true, status: r.status, senders: data.senders?.length });
    else res.json({ ok: false, status: r.status, detail: JSON.stringify(data) });
  } catch(e) {
    res.json({ ok: false, erreur: e.name === 'AbortError' ? 'TIMEOUT — Railway bloque api.brevo.com ?' : e.message });
  }
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
});