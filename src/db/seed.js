/**
 * seed.js — Données de démo pour tester sans vrai SMTP
 * Lance avec : npm run seed
 */

require('dotenv').config();
const db = require('./init');
const { v4: uuidv4 } = require('uuid');

console.log('🌱 Insertion des données de démo...');

// Nettoyer les tables dans l'ordre correct (foreign keys)
const tables = ['events', 'emails', 'inscriptions', 'etapes', 'sequences', 'leads', 'envoi_quota'];
for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();

// ─── SÉQUENCES ──────────────────────────────────────────────────────────────
const seq1Id = uuidv4();
const seq2Id = uuidv4();

db.prepare(`INSERT INTO sequences (id, nom, segment) VALUES (?, ?, ?)`).run(seq1Id, 'Prospection Hôtels 5*', '5*');
db.prepare(`INSERT INTO sequences (id, nom, segment) VALUES (?, ?, ?)`).run(seq2Id, 'Relance Retailers Premium', 'Retail');

// ─── ÉTAPES SÉQUENCE 1 ──────────────────────────────────────────────────────
const etapes1 = [
  { ordre: 1, jour_delai: 0, sujet: 'Découvrez Terre de Mars — cosmétiques naturels certifiés pour l\'hôtellerie de luxe', corps: `Bonjour {{prenom}},

Je me permets de vous contacter car {{hotel}} incarne exactement les valeurs que Terre de Mars défend : l'excellence, l'authenticité et le respect de l'environnement.

Terre de Mars est une marque française de cosmétiques naturels certifiée Ecocert Cosmos et PETA Vegan, présente dans plus de 400 établissements hôteliers premium.

Nos produits de soin rechargeables répondent aux enjeux RSE de l'hôtellerie de luxe tout en offrant une expérience client mémorable.

Seriez-vous disponible pour un échange de 20 minutes cette semaine ?

Bien cordialement,
Joe
Terre de Mars — terre-de-mars.com` },
  { ordre: 2, jour_delai: 3, sujet: 'Hôtel Barrière, Four Seasons... ils ont choisi Terre de Mars — et vous ?', corps: `Bonjour {{prenom}},

Faisant suite à mon message, je souhaitais partager quelques retours de nos partenaires hôteliers.

Le groupe Barrière et plusieurs Palace parisiens utilisent nos amenities depuis 2022 avec d'excellents retours clients — notamment sur la réduction des déchets plastiques (-73%) et la satisfaction des notes TripAdvisor.

Nos certifications Ecocert Cosmos, PETA et RSPO témoignent de notre engagement sans compromis.

Je serais ravi de vous envoyer un kit d'échantillons gratuit pour {{hotel}}.

Cordialement,
Joe` },
  { ordre: 3, jour_delai: 7, sujet: 'Kit d\'échantillons offert — spécialement pour {{hotel}}', corps: `Bonjour {{prenom}},

Je me permets de revenir vers vous avec une proposition concrète.

Nous proposons aux établissements sélectionnés un kit découverte complet (valeur 85€) incluant nos meilleures références en format hôtelier, accompagné d'une analyse personnalisée de la consommation.

Cette offre est valable pour {{hotel}} jusqu'à la fin du mois.

Il suffit de répondre à cet email pour que je prépare votre sélection.

Bien à vous,
Joe` },
  { ordre: 4, jour_delai: 14, sujet: 'Dernier contact — Terre de Mars × {{hotel}}', corps: `Bonjour {{prenom}},

Je ne veux pas vous importuner davantage, mais je tenais à vous laisser nos ressources avant de clore ce fil.

→ Catalogue digital : terre-de-mars.com/catalogue
→ Livre blanc RSE hôtelier : terre-de-mars.com/rse

Si la question se repose pour {{hotel}} dans les prochains mois, n'hésitez pas à me recontacter directement.

À bientôt peut-être,
Joe
Terre de Mars` },
];

const etapes2 = [
  { ordre: 1, jour_delai: 0, sujet: 'Terre de Mars chez {{hotel}} — une collaboration évidente', corps: `Bonjour {{prenom}},

Terre de Mars est aujourd'hui référencée au Bon Marché, chez Saks 5th Avenue et dans les plus beaux concept stores européens.

Notre univers — cosmétiques naturels certifiés, design épuré, packaging rechargeable — s'adresse parfaitement à une clientèle exigeante et écoresponsable.

Je serais ravi d'explorer une collaboration avec {{hotel}}.

Disponible pour un appel cette semaine ?

Cordialement,
Joe — Terre de Mars` },
  { ordre: 2, jour_delai: 5, sujet: 'Le Bon Marché : +34% de sell-through en 6 mois avec Terre de Mars', corps: `Bonjour {{prenom}},

Pour donner suite à mon précédent message, voici quelques chiffres concrets.

Depuis notre référencement au Bon Marché (2022), les performances ont dépassé nos projections initiales avec un taux de réachat de 67%.

Pour {{hotel}}, je pense qu'un assortiment de 8 à 12 références pourrait s'intégrer naturellement à votre offre beauté.

Je peux vous envoyer notre book retailer avec les conditions commerciales.

Bien cordialement,
Joe` },
  { ordre: 3, jour_delai: 10, sujet: 'Showroom Paris ou call découverte — à vous de choisir', corps: `Bonjour {{prenom}},

Dernière tentative de ma part — promis !

Nous organisons régulièrement des présentations dans notre showroom parisien (Marais) et des calls découverte de 30 minutes.

Lequel vous conviendrait le mieux ?

Joe
Terre de Mars — 07 XX XX XX XX` },
];

for (const e of etapes1) db.prepare(`INSERT INTO etapes (id, sequence_id, ordre, jour_delai, sujet, corps) VALUES (?, ?, ?, ?, ?, ?)`).run(uuidv4(), seq1Id, e.ordre, e.jour_delai, e.sujet, e.corps);
for (const e of etapes2) db.prepare(`INSERT INTO etapes (id, sequence_id, ordre, jour_delai, sujet, corps) VALUES (?, ?, ?, ?, ?, ?)`).run(uuidv4(), seq2Id, e.ordre, e.jour_delai, e.sujet, e.corps);

// ─── LEADS DE DÉMO ──────────────────────────────────────────────────────────
const leads = [
  { prenom: 'Sophie', nom: 'Lefebvre', email: 'demo.sophie@exemple.fr', hotel: 'Hôtel Le Bristol', ville: 'Paris', segment: '5*', tags: '["hôtel 5*","luxe","Paris"]', statut: 'En séquence', score: 85 },
  { prenom: 'Marc', nom: 'Dubois', email: 'demo.marc@exemple.fr', hotel: 'Château de Bagnols', ville: 'Lyon', segment: '5*', tags: '["hôtel 5*","château"]', statut: 'Répondu', score: 96 },
  { prenom: 'Claire', nom: 'Martin', email: 'demo.claire@exemple.fr', hotel: 'Le Bon Marché', ville: 'Paris', segment: 'Retail', tags: '["grand magasin","retail premium"]', statut: 'En séquence', score: 62 },
  { prenom: 'Thomas', nom: 'Bernard', email: 'demo.thomas@exemple.fr', hotel: 'Hôtel Barrière Deauville', ville: 'Deauville', segment: '5*', tags: '["hôtel 5*","SPA"]', statut: 'Nouveau', score: 70 },
  { prenom: 'Isabelle', nom: 'Rousseau', email: 'demo.isabelle@exemple.fr', hotel: 'Concept Store Merci', ville: 'Paris', segment: 'Retail', tags: '["concept store","retail"]', statut: 'Converti', score: 100 },
  { prenom: 'Antoine', nom: 'Moreau', email: 'demo.antoine@exemple.fr', hotel: 'Hôtel Negresco', ville: 'Nice', segment: '5*', tags: '["hôtel 5*","luxe","Côte d\'Azur"]', statut: 'En séquence', score: 78 },

  // ─── AUTOGRAPH COLLECTION HOTELS ────────────────────────────────────────────
  { prenom: 'Carine', nom: 'Kienlé', email: 'carine.kienle@maison-rouge.com', hotel: 'Maison Rouge Strasbourg Hotel & Spa, Autograph Collection', ville: 'Strasbourg', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'General Manager' },
  { prenom: 'Margaux', nom: 'Pellerin', email: 'margaux.pellerin@lacasernechanzy.com', hotel: 'La Caserne Chanzy Hôtel & Spa - Autograph Collection', ville: 'Reims', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'Responsable Marketing & Communication' },
  { prenom: 'Baptiste', nom: 'Collignon', email: 'baptiste.collignon@lacasernechanzy.com', hotel: 'La Caserne Chanzy Hôtel & Spa - Autograph Collection', ville: 'Reims', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'Directeur général' },
  { prenom: 'Léa', nom: 'Himbert', email: 'lea.himbert@lacasernechanzy.com', hotel: 'La Caserne Chanzy Hôtel & Spa - Autograph Collection', ville: 'Reims', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'Responsable Marketing et Communication' },
  { prenom: 'Céline', nom: 'Moulin', email: 'celine.moulin@hotelsparouen.com', hotel: 'Hôtel de Bourgtheroulde, Autograph Collection', ville: 'Rouen', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'Directrice générale' },
  { prenom: 'Jeremie', nom: 'Jaspart', email: 'jeremie.jaspart@gantoislille.com', hotel: 'Hermitage Gantois Autograph Collection', ville: 'Lille', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'Directeur d\'hébergement' },
  { prenom: 'Mathieu', nom: 'Van Welden', email: 'mathieu.vanwelden@sapphirehouseantwerp.com', hotel: 'Sapphire House Antwerp, Autograph Collection', ville: 'Antwerp', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'General Manager' },
  { prenom: 'Pierre', nom: 'Brochard', email: 'pierre.brochard@cardohotels.com', hotel: 'Cardo Brussels, Autograph Collection', ville: 'Brussels', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'General Manager' },
  { prenom: 'Lisa', nom: 'Steppacher', email: 'lisa.steppacher@schlosslieser.de', hotel: 'Schloss Lieser, Autograph Collection by Marriott', ville: 'Lieser', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'Executive Assistant to GM' },
  { prenom: 'Jessica', nom: 'Cullmann', email: 'jessica.cullmann@schlosslieser.de', hotel: 'Schloss Lieser, Autograph Collection by Marriott', ville: 'Lieser', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'Event Sales & Marketing Executive' },
  { prenom: 'Benedikt', nom: 'Theisen', email: 'benedikt.theisen@kameha.com', hotel: 'Kameha Grand Zurich, Autograph Collection', ville: 'Zürich', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'Managing Director' },
  { prenom: 'Ramzi', nom: 'Labidi', email: 'ramzi.labidi@arabella.com', hotel: 'Neues Schloss Privat Hotel Zürich, Autograph Collection', ville: 'Zürich', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'General Manager' },
  { prenom: 'Cyril', nom: 'Marcou', email: 'cyril.marcou@brhhh.com', hotel: 'Grand Hotel Suisse Majestic, Autograph Collection', ville: 'Montreux', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'General Manager' },
  { prenom: 'Steven', nom: 'Fennell', email: 'steven.fennell@marriott.com', hotel: 'The Hotel Lucerne, Autograph Collection', ville: 'Lucerne', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'General Manager' },
  { prenom: 'Bosko', nom: 'Grozdanic', email: 'bosko.grozdanic@marriott.com', hotel: 'The Hotel Lucerne / Renaissance Lucerne Hotel', ville: 'Lucerne', segment: '5*', tags: '["Autograph Collection","Marriott","5*"]', statut: 'Nouveau', score: 0, poste: 'Cluster General Manager' },
];

const leadIds = {};
for (const l of leads) {
  const id = uuidv4();
  leadIds[l.email] = id;
  db.prepare(`INSERT INTO leads (id, prenom, nom, email, hotel, ville, segment, tags, statut, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, l.prenom, l.nom, l.email, l.hotel, l.ville, l.segment, l.tags, l.statut, l.score);
}

// Créer quelques inscriptions de démo
const now = new Date();
const inscId1 = uuidv4();
db.prepare(`INSERT INTO inscriptions (id, lead_id, sequence_id, etape_courante, statut, prochain_envoi) VALUES (?, ?, ?, ?, ?, ?)`).run(
  inscId1, leadIds['demo.sophie@exemple.fr'], seq1Id, 2, 'actif',
  new Date(now.getTime() + 2 * 24 * 3600 * 1000).toISOString()
);

console.log(`✅ Données de démo insérées :
  - ${leads.length} leads (6 démo + 15 Autograph Collection)
  - 2 séquences (${etapes1.length + etapes2.length} étapes au total)
  - 1 inscription active`);
