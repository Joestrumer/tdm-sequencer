/**
 * seedFactures.js — Import initial des données de référence factures
 * Extrait depuis outil-factures HTML standalone
 * Usage : node src/db/seedFactures.js
 */

require('dotenv').config();
const db = require('./init');

// ─── Catalogue Master ─────────────────────────────────────────────────────────

const masterCatalog = {
  'FP': { nom: 'FRAIS PREPARATION', prix_ht: 25.00, tva: 20, csv_ref: 'FP', vf_ref: 'FP' },
  'FE': { nom: 'FRAIS EXPEDITION', prix_ht: 80.00, tva: 20, csv_ref: 'FE', vf_ref: 'FE' },
  'P008': { nom: 'Gel nettoyant Corporel Reddition 500ml', prix_ht: 7.00, tva: 20 },
  'P019': { nom: 'Shampoing Reddition 500 ml', prix_ht: 7.00, tva: 20 },
  'P024': { nom: 'Après Shampoing Irrévérence 500ml', prix_ht: 10.00, tva: 20 },
  'P011': { nom: 'Lotion Corps et Mains Imminence 500ml', prix_ht: 10.00, tva: 20 },
  'P007': { nom: 'Gel Lavant Mains Insurrection 500 ml', prix_ht: 7.50, tva: 20 },
  'P008-5000': { nom: 'Gel nettoyant Corporel Reddition Recharge 5 L', prix_ht: 39.00, tva: 20 },
  'P019-5000': { nom: 'Shampoing Reddition Recharge 5 L', prix_ht: 39.00, tva: 20 },
  'P024-5000': { nom: 'Après Shampoing Irrévérence Recharge 5 L', prix_ht: 70.00, tva: 20 },
  'P011-5000': { nom: 'Lotion Corps et Mains Imminence Recharge 5 L', prix_ht: 70.00, tva: 20 },
  'P007-5000': { nom: 'Gel Lavant Mains Insurrection Recharge 5 L', prix_ht: 41.00, tva: 20 },
  'P010': { nom: 'Shampoing Irreverence 500 ml', prix_ht: 7.50, tva: 20 },
  'P010-5000': { nom: 'Shampoing Irreverence Recharge 5 L', prix_ht: 41.00, tva: 20 },
  'P014': { nom: 'Irreverence Gel Nettoyant Cheveux & Corps 500 ml', prix_ht: 7.50, tva: 20 },
  'P014-5000': { nom: 'Irreverence Gel Nettoyant Cheveux & Corps Recharge 5 L', prix_ht: 41.00, tva: 20 },
  'P034': { nom: 'Shampoing Elégance 500 ml', prix_ht: 7.50, tva: 20 },
  'P034-5000': { nom: 'Shampoing Elégance Recharge 5 L', prix_ht: 41.00, tva: 20 },
  'P035': { nom: 'Gel nettoyant Corporel Elégance 500ml', prix_ht: 7.50, tva: 20 },
  'P035-5000': { nom: 'Gel nettoyant Corporel Elégance Recharge 5 L', prix_ht: 41.00, tva: 20 },
  'P042': { nom: '042 Reddition 2 in 1 Revitalizing Shampoo - 500ml vide', prix_ht: 4.80, tva: 20, csv_ref: 'P042V', vf_ref: 'P042' },
  'P042V': { nom: '042 Reddition 2 in 1 Revitalizing Shampoo - 500ml vide', prix_ht: 4.80, tva: 20, csv_ref: 'P042V', vf_ref: 'P042' },
  'P040': { nom: 'h-040 FLACON VIDE Gel douche Shampoing 2 en 1 Elegance - 500ml', prix_ht: 1.00, tva: 20, csv_ref: 'P040V-SANS POMPE', vf_ref: 'P040' },
  'P040V-SANS POMPE': { nom: 'h-040 FLACON VIDE Gel douche Shampoing 2 en 1 Elegance - 500ml', prix_ht: 1.00, tva: 20, csv_ref: 'P040V-SANS POMPE', vf_ref: 'P040' },
  'P041-5000': { nom: 'Diffuseur Révélation Recharge 5 L', prix_ht: 200.00, tva: 20 },
  'P041': { nom: 'Diffuseur Révélation 200ml', prix_ht: 24.00, tva: 20 },
  'P041-500': { nom: 'Diffuseur Révélation 500ml', prix_ht: 48.00, tva: 20 },
  'COFFRETS': { nom: 'COFFRETS KRAFTS', prix_ht: 2.02, tva: 20, vfId: '223790875' },
  'SPRAY-VIDE': { nom: 'Spray vide', prix_ht: 0.50, tva: 20 },
  'P039': { nom: 'Diffuseur Intuition 200ml', prix_ht: 24.00, tva: 20 },
  'P039-500': { nom: 'Diffuseur Intuition 500ml', prix_ht: 48.00, tva: 20 },
  'P039-5000': { nom: 'Diffuseur Intuition Recharge 5L', prix_ht: 200.00, tva: 20 },
  'P039-200V': { nom: 'Diffuseur Intuition 200ml VIDE', prix_ht: 6.00, tva: 20 },
  'P039-3000V': { nom: 'Diffuseur 3L VIDE', prix_ht: 38.00, tva: 20 },
  'P039SPRAY-VIDE': { nom: 'Home Fragrance Spray 250ml VIDE', prix_ht: 4.00, tva: 20 },
  'P016': { nom: 'Variance Contour des Yeux', prix_ht: 0.95, tva: 20 },
  'P023': { nom: 'Gommage Crémeux Visage Céleste', prix_ht: 1.10, tva: 20 },
  'P012': { nom: 'Baume Lèvres Celeste 15ml', prix_ht: 1.45, tva: 20 },
  'P009': { nom: 'Masque Redemption Biocellulose', prix_ht: 1.90, tva: 20 },
  'P020': { nom: 'Velvet Masque Coton Cosmique', prix_ht: 1.90, tva: 20 },
  'P021-20': { nom: 'Eau Céleste 20ml', prix_ht: 1.80, tva: 20 },
  'P021': { nom: 'Eau Céleste 250ml', prix_ht: 4.00, tva: 20 },
  'P022': { nom: 'Pâte Gommante Café Renaissance 150ml', prix_ht: 9.60, tva: 20 },
  'P317-100': { nom: 'Gommage Résurgence 100g', prix_ht: 11.50, tva: 20 },
  'P005': { nom: 'Crème Visage Résilience', prix_ht: 12.60, tva: 20 },
  'P006': { nom: 'Crème Main & Corps Résilience 100ml', prix_ht: 17.60, tva: 20 },
  'P027': { nom: 'Sérum Visage Variance 30ml', prix_ht: 13.60, tva: 20 },
  'P003': { nom: 'Huile Visage Résonance 30ml', prix_ht: 13.60, tva: 20 },
  'P004': { nom: 'Huile de massage Resonance 100ml', prix_ht: 16.57, tva: 20 },
  'P5L': { nom: 'Accessoire 5L', prix_ht: 2.00, tva: 20 },
  'SPFS': { nom: 'Support Pompe Flacon Souple', prix_ht: 15.00, tva: 20 },
  'PFS': { nom: 'Pompe Flacon Souple', prix_ht: 9.00, tva: 20 },
  'PFD': { nom: 'Pompe Flacon Droite', prix_ht: 12.00, tva: 20 },
  'PFT': { nom: 'Pompe Flacon Transparente', prix_ht: 16.00, tva: 20 },
  'P004-500': { nom: 'Huile de massage Resonance 500ml', prix_ht: 31.00, tva: 20 },
  'P015': { nom: 'Bougie Intuition 190g', prix_ht: 24.00, tva: 20 },
  'P018': { nom: 'Gel Hydroalcoolique Rémanence 500ml', prix_ht: 10.00, tva: 20 },
  'P018-5000': { nom: 'Gel Hydroalcoolique Rémanence Recharge 5L', prix_ht: 55.00, tva: 20 },
  'P018-50': { nom: 'Gel Hydroalcoolique Rémanence 50ml', prix_ht: 0.90, tva: 20 },
  'P010-30': { nom: 'Shampoing Irrévérence 30ml', prix_ht: 0.65, tva: 20 },
  'P010-50': { nom: 'Shampoing Irrévérence 50ml', prix_ht: 0.85, tva: 20 },
  'P010-150': { nom: 'Shampoing Irrévérence 150ml', prix_ht: 2.00, tva: 20 },
  'P024-40': { nom: 'Après Shampoing Irrévérence 40ml', prix_ht: 1.10, tva: 20 },
  'P011-100': { nom: 'Lotion Corps et Mains Imminence 100ml', prix_ht: 1.20, tva: 20 },
  'P017-30': { nom: 'Savon Barre Reddition 30g', prix_ht: 0.70, tva: 20 },
  'P017': { nom: 'Pain de Savon Reddition 200g', prix_ht: 6.50, tva: 20 },
  'P038-30': { nom: 'Savon Barre Elégance 30g', prix_ht: 0.70, tva: 20 },
  'P008-150': { nom: 'Gel nettoyant Corporel Reddition 150ml', prix_ht: 1.00, tva: 20 },
  'P035-30': { nom: 'Gel nettoyant Corporel Elégance 30ml', prix_ht: 0.78, tva: 20 },
  'P008-30': { nom: 'Gel nettoyant Corporel Reddition 30ml', prix_ht: 0.78, tva: 20 },
  'P011-30': { nom: 'Lotion Corps et Mains Imminence 30ml', prix_ht: 1.20, tva: 20 },
  'P042-30': { nom: 'Gel Nettoyant Corps & Cheveux Reddition 30ml', prix_ht: 0.78, tva: 20 },
  'P007-30': { nom: 'Gel Lavant Mains Insurrection 30ml', prix_ht: 0.78, tva: 20 },
  'P014-100': { nom: 'Irreverence Gel Nettoyant Corps & Cheveux 100ml', prix_ht: 1.80, tva: 20 },
  'P042-5000': { nom: 'Reddition 2 in 1 Recharge 5L', prix_ht: 39.00, tva: 20 },
  'P037': { nom: 'Gel douche Shampoing 2 en 1 Elégance 500ml', prix_ht: 7.50, tva: 20 },
  'P037-5000': { nom: 'Gel douche Shampoing 2 en 1 Elégance Recharge 5 L', prix_ht: 41.00, tva: 20 },
};

// ─── Partenaires canoniques ───────────────────────────────────────────────────

const CANONICAL_PARTNER_NAMES = [
  "MyNestinn", "KYRIAD PRESTIGE PERPIGNAN", "Maison Eugenie", "Villa Panthéon",
  "ACCOR ALL Hearties 1", "Douglas Italy", "Hôtel de La Groirie", "Villa Beaumarchais",
  "ACCOR ALL Hearties 2", "ACCOR ALL Hearties 3", "ACCOR ALL Hearties 4",
  "AVIS website 1", "AVIS website 2", "Sofitel Paris Baltimore Tour Eiffel",
  "Nocibe reappro new products", "AVIS website 3", "1K Paris", "Coupon HELLOCSE",
  "AVIS website 4", "Pavillon de Montmartre", "Hôtel Korner Montparnasse",
  "Hôtel Korner Eiffel", "Hôtel Saint Marcel", "club employé", "AVIS website 5",
  "Life Hotels Bordeaux", "Escale Blanche", "Kraft Hotel", "Hello CSE - 17,5€",
  "Hotel Waldorf Trocadero", "Dream Hotel Opera (Théorème)",
  "Flacons vides entrepot SHURGARD SELF STORAGE ASNIERES",
  "Hôtel Korner Sorbonne (Diana)", "Better Beauty Box", "Monsieur Alfred",
  "Barry's Bootcamp Paris", "Hôtel Korner Opéra", "Hôtel Oré Saint Malo",
  "Hotel Claridge", "Hôtel Korner Etoile", "Hôtel Grand Cœur Latin",
  "Hôtel Le Renaissance", "Shooting photo Lancaster Mrs Dong Jihyun 11/02/24",
  "Hôtel La Balance", "Chateau des Arpentis", "Château de Sannes",
  "BAO Chambres d'hôtes", "Hôtel de Mougins", "Le Château de Cop Choux",
  "Holmes Place Austria", "le Beau Moulin", "Lodging Le Lac", "Domaine de Canaille",
  "Hôtel Restaurant des Iles", "Auberge Du Cabestan", "Hotel Le A",
  "Louvre Marsollier", "Hôtel Victoria Châtelet", "Sangha Hotels", "Hotel Nyx",
  "Hotel Marina Adelphia", "Le Château d'Argens", "Hôtel Le Parc",
  "Hotel Clairefontaine", "Hôtel La Résidence", "Domaine des Bidaudières",
  "Au Lion Rouge", "La Fraichette", "Le Saint Nicolas", "Les Chalets De La Clusaz",
  "My Ginger", "Stendhal", "Hotel Stanley", "Hôtel L'Ormaie", "Hôtel Moderniste",
  "Marcel Aymé", "Le Swann", "Arthur Rimbaud", "Daroco Bourse", "Daroco 16",
  "Daroco Soho", "Kyriad Prestige Residence & Spa Cabourg-Dives-sur-Mer",
  "Les chalets Covarel", "Alexandre Vialatte", "Gustave Flaubert",
  "Manoir des Douets Fleuris", "Snov.io Starter Monthly Subscription - October 2024",
  "Omar Dhiab", "Institut Corpo", "Yangon Excelsior Hotel",
  "Le Domaine du Pech Eternel",
  "Snov.io Starter Monthly Subscription - November 2024", "Château des Ayes",
  "Snov.io Starter 2025 Annual Subscription - Black Friday offer", "HOTEL 96",
  "Hôtel au Coq Dort Spa", "Chalet B", "IMMOBILIERE DU BOURGAGE",
  "La Maison Normande", "Pantoufle Hôtels", "La Source", "Relais de Saint-Preuil",
  "DS_Niel et Franklin", "DS_Defense et Lafayette", "DS_Victor Hugo", "DS_Boulogne",
  "DS_Parly 2", "DS_Lyon", "DS_Bordeaux", "Hôtel Boronali (Le Rodrigue)",
  "Escale Marine", "Chateauform", "Hotel de France", "Le Domaine de l'Ecorcerie",
  "Hôtel Abbaye du Golf", "Suite Balnéo Canet", "Carlton Hotel St. Moritz",
  "Les Rives Oceanik", "Causse Comtal", "Hôtel du golf lacanau (La Baignoire)",
  "Château de Blanat", "Casa del Capitan", "Globe et Cecil Hotel", "Jost Hotel Lille",
  "Chalets Uto", "Loire Valley Lodges", "Le Mas Vidau", "Les Relais Du Capitole",
  "The Central (Loewe)", "The Bradery", "Hôtel Elysées Bassano",
  "Conquer Your Day (Blanche)", "Mana Homes", "Le Swann (mariage)",
  "HILO Collection", "HK République", "Hôtel des Mines", "Jost Hotel Montpellier Gare",
  "Shd Invest Srl - Shams Demaret", "Hôtel le Portillo", "Hôtel Bourgogne & Montana",
  "Hôtel Provençal Bandol", "Hôtel Le Lyret", "Hôtel Le Faucigny",
  "Appart'Hôtel Le Génépy", "Hôtel des 2 Gares", "Plan B Chamonix",
  "Plan B Saint Gervais", "CAMPUS ENGIE", "Les Pins Blancs", "Chalet APY",
  "La Trêve", "Chamkeys Prestige", "DS_Reims", "Maison Montgrand", "Juliana Brussel",
];

// ─── Remises par client ───────────────────────────────────────────────────────

const clientDiscounts = {
  '1K Paris': { 'P007': 10, 'P014': 10, 'P014-5000': 10, 'P007-5000': 10, 'P011': 5, 'P011-5000': 5, 'NP007': 10, 'NP014': 10, 'NP014-5000': 10, 'NP007-5000': 10, 'NP011': 5, 'NP011-5000': 5 },
  'Villa Beaumarchais': { 'P007': 10, 'P014': 10, 'P014-5000': 10, 'P007-5000': 10, 'P011': 5, 'P011-5000': 5, 'NP007': 10, 'NP014': 10, 'NP014-5000': 10, 'NP007-5000': 10, 'NP011': 5, 'NP011-5000': 5 },
  'Villa Panthéon': { 'P007': 10, 'P014': 10, 'P014-5000': 10, 'P007-5000': 10, 'P011': 5, 'P011-5000': 5, 'NP007': 10, 'NP014': 10, 'NP014-5000': 10, 'NP007-5000': 10, 'NP011': 5, 'NP011-5000': 5 },
  'Maison Eugenie': { 'P007': 10, 'P014': 10, 'P014-5000': 10, 'P007-5000': 10, 'P011': 5, 'P011-5000': 5, 'NP007': 10, 'NP014': 10, 'NP014-5000': 10, 'NP007-5000': 10, 'NP011': 5, 'NP011-5000': 5 },
  'Kraft Hotel': { 'P007': 10, 'P014': 10, 'P014-5000': 10, 'P007-5000': 10, 'P011': 5, 'P011-5000': 5, 'NP007': 10, 'NP014': 10, 'NP014-5000': 10, 'NP007-5000': 10, 'NP011': 5, 'NP011-5000': 5 },
  'Hôtel Korner Opéra': { 'P014-5000': 20, 'P007-5000': 20, 'NP014-5000': 20, 'NP007-5000': 20 },
  'Hôtel Korner Eiffel': { 'P014-5000': 20, 'P007-5000': 20, 'NP014-5000': 20, 'NP007-5000': 20 },
  'Hôtel Korner Montparnasse': { 'P014-5000': 20, 'P007-5000': 20, 'NP014-5000': 20, 'NP007-5000': 20 },
  'Hôtel Victoria Châtelet': { 'P014-5000': 20, 'P007-5000': 20, 'NP014-5000': 20, 'NP007-5000': 20 },
  'Pavillon de Montmartre': { 'P014-5000': 20, 'P007-5000': 20, 'NP014-5000': 20, 'NP007-5000': 20 },
  'Hôtel Korner Sorbonne (Diana)': { 'P014-5000': 20, 'P007-5000': 20, 'NP014-5000': 20, 'NP007-5000': 20 },
  'Hôtel Korner Etoile': { 'P014-5000': 20, 'P007-5000': 20, 'NP014-5000': 20, 'NP007-5000': 20 },
  'Hôtel Saint Marcel': { 'P014-5000': 20, 'P007-5000': 20, 'NP014-5000': 20, 'NP007-5000': 20 },
  'Louvre Marsollier': { 'P014-5000': 20, 'P007-5000': 20, 'NP014-5000': 20, 'NP007-5000': 20 },
  'Hôtel Moderniste': { 'P014': 10, 'P024-5000': 10, 'P024': 10, 'P014-5000': 10, 'PFD': 10, 'NP014': 10, 'NP024-5000': 10, 'NP024': 10, 'NP014-5000': 10 },
  'Hôtel Elysées Bassano': { 'P008-5000': 4, 'P010-5000': 4, 'P007-5000': 4, 'P024-5000': 4, 'P011-5000': 4, 'NP008-5000': 4, 'NP010-5000': 4, 'NP007-5000': 4, 'NP024-5000': 4, 'NP011-5000': 4 },
  'Holmes Place Austria': { 'P007': 28.52, 'P008': 28.52, 'P011': 30, 'P008-5000': 37.94, 'NP007': 28.52, 'NP008': 28.52, 'NP011': 30, 'NP008-5000': 37.94 },
  "Barry's Bootcamp Paris": { 'P008-5000': 10, 'P010-5000': 10, 'P024-5000': 15, 'P011-5000': 15, 'P007-5000': 10, 'NP008-5000': 10, 'NP010-5000': 10, 'NP024-5000': 15, 'NP011-5000': 15, 'NP007-5000': 10 },
  'Hotel Claridge': { 'P008-5000': 4, 'P010-5000': 4, 'P007-5000': 4, 'P024-5000': 4, 'P011-5000': 4, 'NP008-5000': 4, 'NP010-5000': 4, 'NP007-5000': 4, 'NP024-5000': 4, 'NP011-5000': 4 },
  'Hotel Marina Adelphia': { 'P014-5000': 10, 'P024-5000': 5, 'NP014-5000': 10, 'NP024-5000': 5 },
  'Hotel de France': { 'P042V': 30, 'NP042-5000': 15 },
  'Jost Hotel Lille': { 'NP042-5000': 30 },
  'Jost Hotel Montpellier Gare': { 'NP042-5000': 30 },
  'Le Saint Nicolas': { 'P008-5000': 7, 'P019-5000': 7, 'P008': 7, 'P019': 7, 'NP008-5000': 7, 'NP019-5000': 7, 'NP008': 7, 'NP019': 7 },
  'Hôtel des 2 Gares': { 'P008-5000': 8, 'P019-5000': 8, 'PFD': 20, 'PFS': 20, 'NP008-5000': 8, 'NP019-5000': 8 },
  'Hôtel Le Lyret': { 'P008-5000': 8, 'P019-5000': 8, 'PFD': 20, 'PFS': 20, 'NP008-5000': 8, 'NP019-5000': 8 },
  'Hôtel Le Faucigny': { 'P008-5000': 8, 'P019-5000': 8, 'PFD': 20, 'PFS': 20, 'NP008-5000': 8, 'NP019-5000': 8 },
  "Appart'Hôtel Le Génépy": { 'P008-5000': 8, 'P019-5000': 8, 'PFD': 20, 'PFS': 20, 'NP008-5000': 8, 'NP019-5000': 8 },
  'Plan B Chamonix': { 'P008-5000': 8, 'P019-5000': 8, 'PFD': 20, 'PFS': 20, 'NP008-5000': 8, 'NP019-5000': 8 },
  'Plan B Saint Gervais': { 'P008-5000': 8, 'P019-5000': 8, 'PFD': 20, 'PFS': 20, 'NP008-5000': 8, 'NP019-5000': 8 },
  'Hôtel des Mines': { 'P041-5000': 5, 'SPRAY-VIDE': 5 },
  'Mana Homes': { 'P008-5000': 20, 'P019-5000': 20, 'PFD': 15, 'NP008-5000': 20, 'NP019-5000': 20 },
};

// ─── Mapping noms clients VF → fichier suivi ─────────────────────────────────

const clientNameMapping = {
  "MyNestinn": "MyNestinn",
  "KYRIAD PRESTIGE PERPIGNAN": "KYRIAD PRESTIGE PERPIGNAN",
  "Machefert Group - Villa Eugenie": "Maison Eugenie",
  "Villa Panthéon": "Villa Panthéon",
  "ACCOR ALL": "ACCOR ALL Hearties 1",
  "Douglas Italy": "Douglas Italy",
  "Hôtel de La Groirie": "Hôtel de La Groirie",
  "Villa Beaumarchais": "Villa Beaumarchais",
  "Sofitel Paris Baltimore Tour Eiffel": "Sofitel Paris Baltimore Tour Eiffel",
  "Nocibe": "Nocibe reappro new products",
  "1K - Machefert": "1K Paris",
  "Pavillon de Montmartre": "Pavillon de Montmartre",
  "Hôtel Korner Montparnasse": "Hôtel Korner Montparnasse",
  "Hôtel Korner Eiffel": "Hôtel Korner Eiffel",
  "Hôtel Saint Marcel": "Hôtel Saint Marcel",
  "Life Hotels Bordeaux": "Life Hotels Bordeaux",
  "Escale Blanche": "Escale Blanche",
  "Kraft Hotel": "Kraft Hotel",
  "Hotel Waldorf Trocadero": "Hotel Waldorf Trocadero",
  "Dream Hotel Opera": "Dream Hotel Opera (Théorème)",
  "Hôtel Korner Sorbonne": "Hôtel Korner Sorbonne (Diana)",
  "Better Beauty Box": "Better Beauty Box",
  "Monsieur Alfred": "Monsieur Alfred",
  "Barry's Bootcamp Paris": "Barry's Bootcamp Paris",
  "Hôtel Korner Opéra": "Hôtel Korner Opéra",
  "Hôtel Oré Saint Malo": "Hôtel Oré Saint Malo",
  "Hotel Claridge": "Hotel Claridge",
  "Hôtel Korner Etoile": "Hôtel Korner Etoile",
  "Hôtel Grand Cœur Latin": "Hôtel Grand Cœur Latin",
  "Hôtel Le Renaissance": "Hôtel Le Renaissance",
  "Hôtel La Balance": "Hôtel La Balance",
  "Chateau des Arpentis": "Chateau des Arpentis",
  "Château de Sannes": "Château de Sannes",
  "BAO Chambres d'hôtes": "BAO Chambres d'hôtes",
  "Hôtel de Mougins": "Hôtel de Mougins",
  "Château de Cop Choux": "Le Château de Cop Choux",
  "Lodging Le Lac": "Lodging Le Lac",
  "Domaine de Canaille": "Domaine de Canaille",
  "Hôtel Restaurant des Iles": "Hôtel Restaurant des ILes",
  "Auberge Du Cabestan": "Auberge Du Cabestan",
  "Louvre Marsollier": "Louvre Marsollier",
  "Hôtel Victoria Châtelet": "Hôtel Victoria Châtelet",
  "Sangha Hotels": "Sangha Hotels",
  "Hotel Nyx": "Hotel Nyx",
  "Hotel Marina Adelphi": "Hotel Marina Adelphi",
  "Le Château d'Argens": "Le Château d'Argens",
  "Hôtel Le Parc": "Hôtel Le Parc",
  "Hotel Clairefontaine": "Hotel Clairefontaine",
  "Hôtel La Résidence": "Hôtel La Résidence",
  "Domaine des Bidaudières": "Domaine des Bidaudières",
  "Au Lion Rouge": "Au Lion Rouge",
  "La Fraichette": "La Fraichette",
  "Le Saint Nicolas": "Le Saint Nicolas",
  "Les Chalets De La Clusaz": "Les Chalets De La Clusaz",
  "My Ginger": "My Ginger",
  "Stendhal": "Stendhal",
  "Hotel Stanley": "Hotel Stanley",
  "Hôtel L'Ormaie": "Hôtel L'Ormaie",
  "Hôtel Moderniste": "Hôtel Moderniste",
  "Marcel Aymé": "Marcel Aymé",
  "Le Swann": "Le Swann",
  "Arthur Rimbaud": "Arthur Rimbaud",
  "Daroco Bourse": "Daroco Bourse",
  "Daroco 16": "Daroco 16",
  "Daroco Soho": "Daroco Soho",
  "Kyriad Prestige Residence & Spa Cabourg": "Kyriad Prestige Residence & Spa Cabourg-Dives-sur-Mer",
  "Les chalets Covarel": "Les chalets Covarel",
  "Alexandre Vialatte": "Alexandre Vialatte",
  "Gustave Flaubert": "Gustave Flaubert",
  "Manoir des Douets Fleuris": "Manoir des Douets Fleuris",
  "Institut Corpo": "Institut Corpo",
  "Yangon Excelsior Hotel": "Yangon Excelsior Hotel",
  "Le Domaine du Pech Eternel": "Le Domaine du Pech Eternel",
  "Château des Ayes": "Château des Ayes",
  "HOTEL 96": "HOTEL 96",
  "Hôtel au Coq Dort Spa": "Hôtel au Coq Dort Spa",
  "Chalet B": "Chalet B",
  "La Maison Normande": "La Maison Normande",
  "Pantoufle Hôtels": "Pantoufle Hôtels",
  "La Source": "La Source",
  "Relais de Saint-Preuil": "Relais de Saint-Preuil",
  "DS Café": "DS_Niel et Franklin",
  "Hôtel Boronali": "Hôtel Boronali (Le Rodrigue)",
  "Escale Marine": "Escale Marine",
  "Chateauform Hotel de France": "Chateauform Hotel de France",
  "Le Domaine de l'Ecorcerie": "Le Domaine de l'Ecorcerie",
  "Hôtel Abbaye du Golf": "Hôtel Abbaye du Golf",
  "Suite Balnéo Canet": "Suite Balnéo Canet",
  "Carlton Hotel St. Moritz": "Carlton Hotel St. Moritz",
  "Les Rives Oceanik": "Les Rives Oceanik",
  "Causse Comtal": "Causse Comtal",
  "Hôtel du golf lacanau": "Hôtel du golf lacanau (La Baignoire)",
  "Château de Blanat": "Château de Blanat",
  "Casa del Capitan": "Casa del Capitan",
  "Globe et Cecil Hotel": "Globe et Cecil Hotel",
  "Jost Hotel Lille": "Jost Hotel Lille",
  "Chalets Uto": "Chalets Uto",
  "Loire Valley Lodges": "Loire Valley Lodges",
  "Le Mas Vidau": "Le Mas Vidau",
  "Les Relais Du Capitole": "Les Relais Du Capitole",
  "Loewe Sarl": "The Central (Loewe)",
  "The Bradery": "The Bradery",
  "Hôtel Elysées Bassano": "Hôtel Elysées Bassano",
  "Conquer Your Day": "Conquer Your Day (Blanche)",
  "Mana Homes": "Mana Homes",
  "HILO Collection": "HILO Collection",
  "HK République": "HK République",
  "Hôtel des Mines": "Hôtel des Mines",
  "Jost Hotel Montpellier Gare": "Jost Hotel Montpellier Gare",
  "Shd Invest Srl": "Shd Invest Srl - Shams Demaret",
  "Hôtel le Portillo": "Hôtel le Portillo",
  "Hôtel Bourgogne & Montana": "Hôtel Bourgogne & Montana",
  "Hôtel Provençal Bandol": "Hôtel Provençal Bandol",
  "Hôtel Le Lyret": "Hôtel Le Lyret",
  "Hôtel Le Faucigny": "Hôtel Le Faucigny",
  "Appart'Hôtel Le Génépy": "Appart'Hôtel Le Génépy",
  "Hôtel des 2 Gares": "Hôtel des 2 Gares",
  "Plan B Chamonix": "Plan B Chamonix",
  "Plan B Saint Gervais": "Plan B Saint Gervais",
  "CAMPUS ENGIE": "CAMPUS ENGIE",
  "Les Pins Blancs": "Les Pins Blancs",
  "Chalet APY": "Chalet APY",
  "La Trêve": "La Trêve",
  "Chamkeys Prestige": "Chamkeys Prestige",
  "Maison Montgrand": "Maison Montgrand",
  "Juliana Brussel": "Juliana Brussel",
};

// ─── Client IDs connus ────────────────────────────────────────────────────────

const knownClientIds = {
  "Hilo Collection - Clery - Hélène WEISS": "196576411",
  "HILO Collection": "196576411",
  "SAS HILO": "193145449",
  "1K - Machefert": "112513649",
  "Barry's Bootcamp Paris": "131149479",
  "Auberge du Cabestan - Attn : Eric": "145519766",
  "POLLET IMMOBILIER 2022 - Chalet Caribou": "155144319",
  "Chateau de Cop Choux": "116447938",
  "Château de Sannes - MLGT Holding": "136087687",
  "Château de Blanat - Jerome simeon": "189668650",
  "CHATEAUFORM France – CAMPUS ENGIE": "211294381",
  "Conquer Your Day": "189526185",
  "Domaine de Biar - Stéphane SERRES": "207317649",
  "Escale Marine - Delphine Gaudin": "167992881",
  "Suite Balnéo Canet - Erik Mullie": "179695087",
  "Globe et Cecil Hotel": "180342544",
  "GROUPE FRANCK PUTELAT - attn : Aurore": "149178374",
  "Hotel Théorème Paris": "125549920",
  "Claridge": "135352961",
  "Nouvelle société hotel Bellman - claridge": "135357372",
  "Appart'Hôtel Le Génépy": "213629620",
  "Chalet B - SCI Ballovitch": "177724123",
  "Boost studio": "186785035",
  "Carlton Hotel St. Moritz - Stephanie Lehnort": "186477990",
  "Châteauform' de Nointel": "186611518",
  "Château de Ronqueux": "186552974",
};

// ─── Code mappings ────────────────────────────────────────────────────────────

const codeMapping = {
  'P039-200': 'P039-200V',
  'P041-200': 'P039-200V',
  'P021-20': 'P021-20',
};

const productNameMapping = {
  'P008-7.00': 'H-008 Gel nettoyant Corporel Reddition / Reddition Body Cleanser - 500ml',
  'P008-5000-39.00': 'H-008 Gel nettoyant Corporel Reddition / Body Cleanser - 5L',
  'P007-7.00': 'H-007 Gel Lavant Mains Insurrection / Insurrection Hand Wash - 500ml',
  'P007-7.50': 'N-007 Gel Lavant Mains Insurrection / Insurrection Hand Wash - 500ml...',
  'P007-5000-39.00': 'H-007 Gel Lavant Mains Insurrection / Hand Wash - 5L',
  'P007-5000-41.00': 'N-007 Gel Lavant Mains Insurrection / Hand Wash - 5L...',
  'P010-7.00': 'H-010 Shampoing Nourrissant Irrévérence / Nourishing Shampoo - 500ml',
  'P010-7.50': 'N-010 Shampoing Nourrissant Irrévérence / Nourishing Shampoo - 500ml...',
  'P010-5000-39.00': 'H-010 Shampoing Nourrissant Irrévérence / Nourishing Shampoo - 5L',
  'P010-5000-41.00': 'N-010 Shampoing Nourrissant Irrévérence / Nourishing Shampoo - 5L...',
  'P011-10.00': 'H-011 Lotion Corps et Mains Imminence / Body and Hands Lotion - 500ml',
  'P011-5000-70.00': 'H-011 Lotion Corps et Mains Imminence / Body and Hands Lotion - 5L',
  'P014-7.50': 'N-014 Gel Lavant Corps et Cheveux Irrévérence 500ml...',
  'P014-5000-41.00': 'N-014 Gel Lavant Corps et Cheveux Irrévérence 5L',
  'P019-7.00': 'H-019 Shampoing Reddition',
  'P019-5000-39.00': 'H-019 Shampoing Reddition / Shampoo - 5L',
  'P024-10.00': 'H-024 Après Shampoing Irréverence / Irréverence Conditioner - 500ml',
  'P024-5000-70.00': 'H-024 Après Shampoing Irréverence / Irrévérence Conditioner - 5Litres',
  'P034-7.00': '034 ELEGANCE SHAMPOING NOURRISSANT/ NOURISHING SHAMPOO 500ML',
  'P034-7.50': 'N-034 ELEGANCE SHAMPOING NOURRISSANT/ NOURISHING SHAMPOO 500ML...',
  'P034-5000-39.00': '034 ELEGANCE SHAMPOING NOURRISSANT/ NOURISHING SHAMPOO 5 LITERS',
  'P034-5000-41.00': 'N-034 ELEGANCE SHAMPOING NOURRISSANT/ NOURISHING SHAMPOO 5 LITERS...',
  'P035-7.00': '035 ELEGANCE GEL CORPOREL / BODY CLEANSER 500ML',
  'P035-7.50': 'N-035 ELEGANCE GEL / CLEANSER 500ML...',
  'P035-5000-39.00': '035 ELEGANCE GEL CORPOREL / BODY CLEANSER 5 LITERS',
  'P035-5000-41.00': 'N-035 ELEGANCE GEL / CLEANSER 5 LITERS...',
  'P037-5000-41.00': '037 Gel douche Shampoing 2 en 1 Elégance Recharge 5 L',
  'P037-5000-39.00': '037 Gel douche Shampoing 2 en 1 Elégance Recharge 5 L',
  'P037-5000-70.00': '037 Gel douche Shampoing 2 en 1 Elégance Recharge 5 L',
  'P039-200-24.00': 'H-039 Intuition Diffuseur 200ml + 5 stick',
  'P039-5000-200.00': 'H-039 Diffuseur Intuition 5 Litres',
  'P041-200-24.00': 'H-039 Intuition Diffuseur 200ml + 5 stick',
  'P041-500-48.00': 'H-041 Diffuseur Revelation 500ml + 5 bâtonnets',
  'P041-5000-200.00': 'H-041 Diffuseur Revelation 5 Litres',
  'FP-25.00': 'FRAIS PREPARATION',
  'FE-80.00': 'FRAIS EXPEDITION',
};

const productIdMapping = {
  'P007-7.00': '38581788', 'P007-7.50': '1115236746',
  'P007-5000-39.00': '38581707', 'P007-5000-41.00': '1115236570',
  'P007-30-0.78': '17326799903',
  'P008-7.00': '38581911', 'P008-5000-39.00': '38581825',
  'P008-30-0.78': '107029944', 'P008-150-1.20': '38573859',
  'P010-7.00': '38581977', 'P010-7.50': '1115237318',
  'P010-5000-39.00': '38582081', 'P010-5000-41.00': '1115237357',
  'P010-30-0.78': '110162997', 'P010-50-1.02': '112246149',
  'P010-150-2.00': '38573965',
  'P011-10.00': '38582015', 'P011-5000-70.00': '38582038',
  'P011-30-1.20': '107029967', 'P011-100-1.20': '42263304',
  'P014-7.50': '1115237823', 'P014-5000-41.00': '1115237767',
  'P014-100-1.80': '220021652',
  'P019-7.00': '17325523651', 'P019-5000-39.00': '108653262',
  'P024-10.00': '114600174', 'P024-5000-70.00': '114600703',
  'P024-40-1.10': '114934364',
  'P034-7.00': '108668030', 'P034-7.50': '1115237456',
  'P034-5000-39.00': '108668031', 'P034-5000-41.00': '1115237491',
  'P035-7.00': '108668032', 'P035-7.50': '1115237223',
  'P035-5000-39.00': '108668033', 'P035-5000-41.00': '1115237147',
  'P035-30-0.78': '210085090527',
  'P037-5000-41.00': '108668037', 'P037-5000-39.00': '108668037', 'P037-5000-70.00': '108668037',
  'P042-5000-39.00': '1117518210', 'P042-30-0.78': '1117738019',
  'P017-30-0.70': '105488250', 'P017-7.80': '107029956',
  'P038-30-0.84': '222631512',
  'P016-1.14': '44937652', 'P023-1.10': '117560595',
  'P012-1.45': '1119930029', 'P009-1.90': '41933355',
  'P020-1.90': '117566541',
  'P021-20-1.80': '210083574396', 'P021-4.80': '107943115',
  'P022-11.52': '1094206325', 'P317-100-13.80': '220191126',
  'P005-15.12': '38573459', 'P006-21.12': '38573492',
  'P027-16.32': '1112514636', 'P003-16.32': '38573204',
  'P004-16.57': '38573396', 'P004-500-31.00': '222631511',
  'P039SPRAY-VIDE-4.00': '8719076284878',
  'P039-200V-6.00': '1119068321', 'P039-3000V-38.00': '8719085771736',
  'P039-24.00': '110852284', 'P039-500-48.00': '8719076284880',
  'P039-5000-200.00': '1102917720',
  'P041-24.00': '1120883429', 'P041-500-48.00': '1120926142',
  'P041-5000-200.00': '1120883363',
  'P015-28.80': '107064024',
  'P018-10.00': '103691212', 'P018-5000-55.00': '114309732',
  'P018-50-0.90': '112182816',
  'FP-25.00': '8719085866480', 'FE-80.00': '47317391',
  'COFFRETS-2.02': '223790875',
};

const forcedPricesTTC = {
  'P016': '1.14', 'P021': '4.80', 'P022': '11.52', 'P317-100': '13.80',
  'P005': '15.12', 'P006': '21.12', 'P027': '16.32', 'P003': '16.32',
  'P004': '19.88', 'P004-500': '37.20', 'P015': '28.80',
  'P010-30': '0.78', 'P010-50': '1.02', 'P010-150': '2.40',
  'P017': '7.80', 'P038-30': '0.84', 'P008-150': '1.20',
};

const shippingNames = {
  '1': 'Enlevement Colis', '2': 'Enlevement Palette',
  '101': 'Coursier Colis', '102': 'Coursier Palettes', '103': 'Affretement',
  '200': 'Affranchissement',
  '300': 'Colissimo Expert France', '301': 'Colissimo Expert DOM',
  '302': 'Colissimo Expert International', '303': 'SO Colissimo Avec Signature',
  '304': 'SO Colissimo Sans Signature', '306': 'SO Colissimo Bureau de Poste',
  '307': 'SO Colissimo Cityssimo', '308': 'SO Colissimo ACP',
  '309': 'SO Colissimo A2P', '311': 'SO Colissimo CDI',
  '312': 'Colissimo Access France',
  '600': 'TNT Avant 13H France', '601': 'TNT Relais Colis France',
  '900': 'UPS Inter Standard', '901': 'UPS Inter Express',
  '902': 'UPS Inter Express Saver', '903': 'UPS Express Plus', '904': 'UPS Expedited',
  '4': 'Lettre Suivie', '1100': 'GEODIS', '1000': 'DHL',
  '1300': 'Chronopost 13H', '1301': 'Chronopost Classic - intl',
  '1302': 'Chronopost 13H Instance Agence', '1303': 'Chronopost Relais 13H',
  '1304': 'Chronopost Express - intl',
};

// ─── SEED ─────────────────────────────────────────────────────────────────────

console.log('🌱 Seed des données factures...');

const seedAll = db.transaction(() => {
  // 1. Catalogue
  const catStmt = db.prepare(`
    INSERT INTO vf_catalog (ref, vf_product_id, nom, prix_ht, tva, csv_ref, vf_ref, actif)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(ref) DO UPDATE SET
      vf_product_id = excluded.vf_product_id, nom = excluded.nom,
      prix_ht = excluded.prix_ht, tva = excluded.tva,
      csv_ref = excluded.csv_ref, vf_ref = excluded.vf_ref
  `);
  let catCount = 0;
  for (const [ref, entry] of Object.entries(masterCatalog)) {
    catStmt.run(ref, entry.vfId || null, entry.nom, entry.prix_ht, entry.tva || 20, entry.csv_ref || null, entry.vf_ref || null);
    catCount++;
  }
  console.log(`  ✅ Catalogue : ${catCount} produits`);

  // 2. Partenaires
  const partStmt = db.prepare(`
    INSERT INTO vf_partners (nom, nom_normalise)
    VALUES (?, ?)
    ON CONFLICT(nom) DO UPDATE SET nom_normalise = excluded.nom_normalise
  `);
  const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  let partCount = 0;
  for (const name of CANONICAL_PARTNER_NAMES) {
    partStmt.run(name, norm(name));
    partCount++;
  }
  console.log(`  ✅ Partenaires : ${partCount} noms`);

  // 3. Remises client
  const discStmt = db.prepare(`
    INSERT INTO vf_client_discounts (client_name, product_code, discount_pct)
    VALUES (?, ?, ?)
    ON CONFLICT(client_name, product_code) DO UPDATE SET discount_pct = excluded.discount_pct
  `);
  let discCount = 0;
  for (const [clientName, discounts] of Object.entries(clientDiscounts)) {
    for (const [productCode, pct] of Object.entries(discounts)) {
      discStmt.run(clientName, productCode, pct);
      discCount++;
    }
  }
  console.log(`  ✅ Remises : ${discCount} entrées`);

  // 4. Client mappings
  db.prepare('DELETE FROM vf_client_mappings').run();
  const mapStmt = db.prepare(`
    INSERT INTO vf_client_mappings (vf_name, file_name, vf_client_id)
    VALUES (?, ?, ?)
  `);
  let mapCount = 0;
  // Client name mappings
  for (const [vfName, fileName] of Object.entries(clientNameMapping)) {
    const clientId = knownClientIds[vfName] || null;
    mapStmt.run(vfName, fileName, clientId);
    mapCount++;
  }
  // Known client IDs pas encore dans les mappings
  for (const [name, id] of Object.entries(knownClientIds)) {
    if (!clientNameMapping[name]) {
      mapStmt.run(name, null, String(id));
      mapCount++;
    }
  }
  console.log(`  ✅ Client mappings : ${mapCount} entrées`);

  // 5. Code mappings (types multiples)
  const codeStmt = db.prepare(`
    INSERT INTO vf_code_mappings (code_source, type, code_cible, valeur)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(code_source, type) DO UPDATE SET
      code_cible = excluded.code_cible, valeur = excluded.valeur
  `);
  let codeCount = 0;

  // code_alias
  for (const [src, dest] of Object.entries(codeMapping)) {
    codeStmt.run(src, 'code_alias', dest, null);
    codeCount++;
  }

  // product_id
  for (const [key, id] of Object.entries(productIdMapping)) {
    codeStmt.run(key, 'product_id', null, String(id));
    codeCount++;
  }

  // product_name
  for (const [key, name] of Object.entries(productNameMapping)) {
    codeStmt.run(key, 'product_name', null, name);
    codeCount++;
  }

  // forced_price
  for (const [ref, price] of Object.entries(forcedPricesTTC)) {
    codeStmt.run(ref, 'forced_price', null, String(price));
    codeCount++;
  }

  // shipping_names — stocker comme mappings aussi
  for (const [id, name] of Object.entries(shippingNames)) {
    codeStmt.run(id, 'shipping_name', null, name);
    codeCount++;
  }

  console.log(`  ✅ Code mappings : ${codeCount} entrées`);

  // 6. Config Google Sheets (si pas déjà configuré)
  const configStmt = db.prepare(`
    INSERT INTO config (cle, valeur) VALUES (?, ?)
    ON CONFLICT(cle) DO NOTHING
  `);

  configStmt.run('gsheets_spreadsheet_id', '1K9N8nHAokQ65p9qTvOqHGIoeErSi_QsVofmuR0cfu5E');
  configStmt.run('gsheets_sheet_name', 'Log sold');

  // Credentials GSheets : env var prioritaire, sinon fallback embedded (base64)
  const gsheetsCredsJson = process.env.GSHEETS_CREDENTIALS
    || Buffer.from('eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6Im91dGlsLWZhY3R1cmVzLXRkbSIsInByaXZhdGVfa2V5X2lkIjoiZDZjMTFkZDhhZmFmODc0MzExOWVkMDZjNGYzYjZjNjhkOGU4OGRiYSIsInByaXZhdGVfa2V5IjoiLS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tXG5NSUlFdmdJQkFEQU5CZ2txaGtpRzl3MEJBUUVGQUFTQ0JLZ3dnZ1NrQWdFQUFvSUJBUURHMVVWa0s0ZXNPUnVZXG5EdHQ4MUxubDMydkdVb1NnOTJrL2UxaUZOeDRwRWFMNHN0ZWh1clN2VUdqbzE0Rll5VWhYYUtZNm9uMHRwR3dlXG5xLzBEUllKOGpZTGtYSXFKSm9yN29wMU1Yb2dLRThoWFY5SSs3ZUNJYmNueW1icXN4NkhoU2hic3NRdzloM0JhXG5Fa0lNMno2V05kV0Z1UUhNMFNpaklvS2lSaVJvLzEweExmVnlpVGxEQ0xOWDJzeXhldURBQU4rSU5Jektja2pPXG5ONWxJOUlLb1dJcXlzSTRBZ2VqUzBOS2s2dXJjUEJaKzlNRmZmZ3FzbXRSd2g5TUxXRERaQkROMGFZK2I3dk4wXG5JZ1Z0NVZzZUN0SXZ2UDNDVklKRjRBWTV3Tlg3b3pwK3pMc0xxcUQ3RS9VRS82ME1NMFh3bXBCOWlkSTU2emx3XG41TXQydWdIcEFnTUJBQUVDZ2dFQUN4d3pxbXM4UTRWVlkyUEJJL0tIQ0s0NVNIV243NDZqbE9hQmhjQVVzVnJJXG43bmlmeit1czJQYjNSYnQxQU04T2VjUGhOZm1LWVJpRTZobldJMjZvNGVqT1haQkdOVyt2Nkd1bnVuSzF5MHBiXG5zWFc0eThkaStueVlBalJRMkFLM3F1MEc1dWJsdGpKeE5yYzZkWmx5bjlZV1BraWVMeUdvMGFUR0ErZERkWkpsXG42cTBBSFZwaXF3bjZoTXhOVUl1WElIM2xwSGJpZnMxdkEwQlhVSlU1cFFJMld3V0ozcmVMeTF1dktPMEszekpNXG52YzJJVDZicmlmVlNtcSsvVldQMmlDZTcyRldFK3NGMG1SbU5vaFlPcVcvaS9XeERJN2ZraStNYUNTcWNaM3RTXG5NN3RYVnZiN2l6MEIvWVRJdDJ4QUVlWXkwNE54OXdMUTVUN0JqYXZFdVFLQmdRRC83U01JaHFzK0lZMGNMdEc1XG5oMVo1disvWWNmWWVSNW5xc3pvWDRiR3BVYnRjOVVXWjhKeXYwTVk1ai9JOTczelNiMDNSc3BRME1ldU9iMHYwXG5Cdi9wclRYaTI3MVlpM3ZOZVVCTUhSWU00MkZMK0s3Q3VTVGZsWFhoVmpHUXdGQjgwQ1VTWVZmZjZBTzFyY0k0XG5MSGlSaXM2VitHRitwQzA1MGpTUGhRZlcwd0tCZ1FERzQrMFcreEpvN040TStDN1JITyszRzYyY1BsVnZGNXpSXG4wdVFvMWhpYjhZbko5MDd0bk41NTBZL3gwa1FNcms3Y0NEa0l3bHZYME9QTjUxZjQ4V0VYZkhYUDltU0owS29BXG5NUHF6REpvZnROSlIrUWZDaEc0ZExvMCtMVEpTN1ZOMlRhZmRFd1dLaUF5cWlxTTVsQVd1UEVEUUNXY2p2STVVXG5FRDN6TmZrRzB3S0JnUURkbjh5VHlKTW9kY09PSVZsSzBkRm9FM2V2TjFrTDliTnJWSk85Tkp3MlpXbmNZU1pKXG4zZHpDUUFnNHR0ZnZIS0k2VlZyTmVsanZMait2azkveFRkSjEyS0p1ZHgzc1BMWVVSS2tTZ0tta3RZOS9TN2FEXG5OL09manYyTENxcFhrTUxpb3hsSFpuYkRsbGNJRUpXOU1YMmpnOUhNZTFCcWErQWlUMDltN2F2Uk13S0JnRG1tXG5EeTYrRDVRQ05FcW1GVXZmaTB3VDVicUlCdE53a0svdzVObEJWVmkrSmlZNFhOUmF4OUdmZ0kyaldMNGtPQTluXG5Bc0ViTk92VlRISitQKzJVYVlRWk96elFPa3dJQTM2U3M5ZjZLeUpOa3pqWGFmeGp6bGIvQzBtZWFCdkpWb3ZQXG43bndSNjJWQUVndk1xNHNnOEpTVU9tVVNsS2F6SEw0WkJ4dmI1UmFwQW9HQkFKK2txS2xQa0JOdHl5ZzhsU3puXG55TWV6azZLa3dKUktIdG80UzJnV1NJVHFTMTRtU3ZUWnFDY2VOY2NURXg4Vm9leW1XSEhIRWpITTQ2RWZZZ3d0XG5NVWNycFI2bGZQeHFaMjdhWUFENXg1cE8rWXVJNUExWU5jaHA5T2NxRDNtWEJ1a0hlUGlvWE91U0hFYzZtclFPXG5hWUxidjNVUWJEZEhPTmVJZmlKSlg0WGdcbi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS1cbiIsImNsaWVudF9lbWFpbCI6Im91dGlsLWZhY3R1cmVzLWJvdEBvdXRpbC1mYWN0dXJlcy10ZG0uaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLCJjbGllbnRfaWQiOiIxMDQ3NTc2MzMyNTY3NTMzMTUxOTUiLCJhdXRoX3VyaSI6Imh0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbS9vL29hdXRoMi9hdXRoIiwidG9rZW5fdXJpIjoiaHR0cHM6Ly9vYXV0aDIuZ29vZ2xlYXBpcy5jb20vdG9rZW4iLCJhdXRoX3Byb3ZpZGVyX3g1MDlfY2VydF91cmwiOiJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9vYXV0aDIvdjEvY2VydHMiLCJjbGllbnRfeDUwOV9jZXJ0X3VybCI6Imh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL3JvYm90L3YxL21ldGFkYXRhL3g1MDkvb3V0aWwtZmFjdHVyZXMtYm90JTQwb3V0aWwtZmFjdHVyZXMtdGRtLmlhbS5nc2VydmljZWFjY291bnQuY29tIiwidW5pdmVyc2VfZG9tYWluIjoiZ29vZ2xlYXBpcy5jb20ifQ==', 'base64').toString('utf-8');
  if (gsheetsCredsJson) {
    // Valider que c'est du JSON valide avec les champs requis avant stockage
    try {
      const parsed = JSON.parse(gsheetsCredsJson);
      if (!parsed.private_key || !parsed.client_email) {
        console.error('  ❌ Credentials GSheets invalides: champs private_key ou client_email manquants');
      } else {
        db.prepare(`INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`).run(gsheetsCredsJson);
        console.log('  ✅ Config Google Sheets seedée (credentials validées)');
      }
    } catch (parseErr) {
      console.error('  ❌ Credentials GSheets: JSON invalide -', parseErr.message);
    }
  }
});

seedAll();
console.log('🌱 Seed terminé !');
process.exit(0);
