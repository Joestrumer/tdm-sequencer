/**
 * server.js — Backend Express + serveur de l'UI React (mode Electron)
 *
 * En mode Electron :
 *  - Sert l'app React buildée depuis /frontend-dist
 *  - Expose l'API sur /api/*
 *  - Tout tourne sur le même port (3001)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const logger = require('./config/logger');

// ─── DB ───────────────────────────────────────────────────────────────────────
const db = require('./db/init.js');

// ─── Scheduler ────────────────────────────────────────────────────────────────
const scheduler = require('./jobs/sequenceScheduler');
scheduler.initialiser(db);

// ─── App Express ──────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  skip: (req) => req.path.startsWith('/api/tracking'),
});
app.use(limiter);

// ─── Auth (sauf tracking) ─────────────────────────────────────────────────────
const authMiddleware = require('./middleware/auth');
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/tracking')) return next();
  authMiddleware(req, res, next);
});

// ─── Routes API ───────────────────────────────────────────────────────────────
app.use('/api/leads',     require('./routes/leads')(db));
app.use('/api/sequences', require('./routes/sequences')(db));
app.use('/api/tracking',  require('./routes/tracking')(db));
app.use('/api/stats',     require('./routes/stats')(db));
app.use('/api/hubspot',   require('./routes/hubspot')(db));

// ─── Santé ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const { getQuotaRestant } = require('./services/brevoService');
  res.json({
    statut: 'ok',
    version: '1.0.0',
    brevo: process.env.BREVO_API_KEY ? 'configuré' : 'non configuré',
    hubspot: process.env.HUBSPOT_API_KEY ? 'configuré' : 'non configuré',
    quota: getQuotaRestant(db),
    scheduler: 'actif',
  });
});

// ─── Frontend — fichiers statiques dans /public ──────────────────────────────
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));
// Toutes les routes non-API → index.html (SPA)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ─── Erreurs ──────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Erreur non gérée', { error: err.message });
  res.status(500).json({ erreur: 'Erreur interne du serveur' });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '127.0.0.1', () => {
  logger.info(`🚀 Serveur démarré — http://localhost:${PORT}`);
  logger.info(`   Brevo  : ${process.env.BREVO_API_KEY ? '✅' : '⚠️  non configuré'}`);
  logger.info(`   HubSpot: ${process.env.HUBSPOT_API_KEY ? '✅' : '➖ désactivé'}`);
  logger.info(`   DB     : ${process.env.DB_PATH}`);
});

module.exports = server;
