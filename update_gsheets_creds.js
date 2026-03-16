// Script pour mettre à jour les credentials Google Sheets dans la DB
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'sequencer.db');
const db = new Database(dbPath);

console.log('📂 Base de données:', dbPath);
console.log('');
console.log('Collez le contenu JSON du fichier de credentials Google Cloud :');
console.log('(Puis appuyez sur Ctrl+D ou Cmd+D pour valider)');
console.log('');

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const credentials = JSON.parse(input.trim());
    
    if (!credentials.private_key || !credentials.client_email) {
      console.error('❌ JSON invalide - private_key ou client_email manquant');
      process.exit(1);
    }
    
    db.prepare(`
      INSERT INTO config (cle, valeur) 
      VALUES ('gsheets_credentials', ?) 
      ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur
    `).run(JSON.stringify(credentials));
    
    console.log('✅ Credentials mis à jour !');
    console.log('📧 Email:', credentials.client_email);
    
    db.close();
  } catch (err) {
    console.error('❌ Erreur:', err.message);
    process.exit(1);
  }
});
