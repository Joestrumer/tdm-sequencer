/**
 * Migration pour créer la table shipments
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/sequencer.db');
const db = new Database(DB_PATH);

console.log('📦 Migration : Création table shipments...');

// Lire le fichier SQL
const sqlPath = path.join(__dirname, 'migration_shipments.sql');
const sql = fs.readFileSync(sqlPath, 'utf-8');

// Exécuter toutes les commandes
const statements = sql.split(';').filter(s => s.trim());
for (const stmt of statements) {
  if (stmt.trim()) {
    db.exec(stmt);
  }
}

console.log('✅ Table shipments créée avec succès !');

// Vérifier
const count = db.prepare('SELECT COUNT(*) as count FROM shipments').get();
console.log(`📊 Envois dans la base : ${count.count}`);

db.close();
