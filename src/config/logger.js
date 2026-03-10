/**
 * logger.js — Logger centralisé avec Winston
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logsDir = './logs';
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Console colorisée en développement
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const extras = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `[${timestamp}] ${level}: ${message}${extras}`;
        })
      )
    }),
    // Fichier pour tous les logs
    new winston.transports.File({ filename: path.join(logsDir, 'app.log'), maxsize: 5_000_000, maxFiles: 3 }),
    // Fichier dédié aux erreurs
    new winston.transports.File({ filename: path.join(logsDir, 'errors.log'), level: 'error', maxsize: 5_000_000, maxFiles: 3 }),
  ],
});

module.exports = logger;
