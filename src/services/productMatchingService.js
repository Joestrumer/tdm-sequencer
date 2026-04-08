/**
 * productMatchingService.js — Algorithmes de matching, prix, CSV, adresses
 * Porté depuis le HTML standalone factures.html
 */

const logger = require('../config/logger');

// ─── Normalisation ────────────────────────────────────────────────────────────

function stripDiacritics(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeRef(raw) {
  if (!raw) return '';
  let r = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  const specials = new Set(['FP', 'FE', 'P5L', 'SPFS', 'PFS', 'PFD', 'PFT', 'PFDS', 'PFSS', 'PFTS', 'COFFRETS', 'BAV', 'SPRAY-VIDE']);
  if (specials.has(r)) return r;
  if (r === 'P500ML') return 'P500ml';
  if (r === 'P300ML') return 'P300ML';
  if (r.startsWith('NP')) r = 'P' + r.slice(2);
  if (r.startsWith('H-') || r.startsWith('N-')) r = r.slice(2);
  if (/^[HN]\d{3}/.test(r)) r = r.slice(1);
  if (/^\d{3}($|[-A-Z0-9])/.test(r)) r = 'P' + r;
  return r;
}

function normaliserNom(s) {
  return stripDiacritics(String(s || '').toLowerCase())
    .replace(/[''`]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[-_/.,:;!?\\"|\\]+/g, ' ')
    .replace(/\b(hotel|hôtel)\b/g, 'hotel')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Matching produits ────────────────────────────────────────────────────────

function matcherProduits(lignes, catalog, codeMappings) {
  const results = [];

  for (const ligne of lignes) {
    const rawRef = ligne.ref;
    const ref = normalizeRef(rawRef);

    // Appliquer code_alias si existant
    let mappedRef = ref;
    if (codeMappings) {
      const alias = codeMappings.find(m => m.type === 'code_alias' && normalizeRef(m.code_source) === ref);
      if (alias) mappedRef = normalizeRef(alias.code_cible || alias.valeur);
    }

    // Chercher dans le catalogue
    const catalogEntry = catalog[mappedRef] || catalog[ref];

    if (catalogEntry) {
      results.push({
        ref: mappedRef,
        originalRef: rawRef,
        nom: catalogEntry.nom,
        prix_ht: ligne.priceHT || catalogEntry.prix_ht,
        quantite: ligne.quantity,
        discount: ligne.discount || 0,
        tva: catalogEntry.tva || 20,
        csv_ref: catalogEntry.csv_ref || mappedRef,
        vf_ref: catalogEntry.vf_ref || mappedRef,
        vf_product_id: catalogEntry.vf_product_id,
        confiance: 'exact',
      });
    } else {
      results.push({
        ref: mappedRef,
        originalRef: rawRef,
        nom: `Produit inconnu (${rawRef})`,
        prix_ht: ligne.priceHT || 0,
        quantite: ligne.quantity,
        discount: ligne.discount || 0,
        tva: 20,
        csv_ref: mappedRef,
        vf_ref: mappedRef,
        confiance: 'inconnu',
      });
    }
  }

  return results;
}

function findVFProduct(ref, price, catalog, codeMappings, productIdMapping, productNameMapping) {
  const refNorm = normalizeRef(ref);

  // Appliquer code alias
  let mappedRef = refNorm;
  if (codeMappings) {
    const alias = codeMappings.find(m => m.type === 'code_alias' && normalizeRef(m.code_source) === refNorm);
    if (alias) mappedRef = normalizeRef(alias.code_cible || alias.valeur);
  }

  // Clé de lookup: REF-PRIX
  const priceStr = price != null ? parseFloat(price).toFixed(2) : null;
  const lookupKey = priceStr ? `${mappedRef}-${priceStr}` : mappedRef;
  const hLookupKey = priceStr ? `H${mappedRef.slice(1)}-${priceStr}` : null;
  const legacyLookupKey = priceStr ? `${refNorm}-${priceStr}` : null;

  // Chercher product_name via DB
  let productName = null;
  if (productNameMapping) {
    const nameEntry = productNameMapping.find(m =>
      m.code_source === lookupKey ||
      (hLookupKey && m.code_source === hLookupKey) ||
      (legacyLookupKey && m.code_source === legacyLookupKey)
    );
    if (nameEntry) productName = nameEntry.valeur;
  }

  // Chercher product_id via DB
  let productId = null;
  if (productIdMapping) {
    const idEntry = productIdMapping.find(m =>
      m.code_source === lookupKey ||
      (hLookupKey && m.code_source === hLookupKey) ||
      (legacyLookupKey && m.code_source === legacyLookupKey)
    );
    if (idEntry) productId = idEntry.valeur;

    // Fallback : chercher par REF avec n'importe quel prix (prend le premier match)
    if (!productId) {
      const prefix = mappedRef + '-';
      const fallbackEntry = productIdMapping.find(m => m.code_source.startsWith(prefix));
      if (fallbackEntry) {
        productId = fallbackEntry.valeur;
        logger.debug(`⚠️ findVFProduct fallback: ${lookupKey} non trouvé, utilisation de ${fallbackEntry.code_source} → ${productId}`);
      }
    }
  }

  // Fallback product_name si pas trouvé non plus
  if (!productName && productNameMapping) {
    const prefix = mappedRef + '-';
    const fallbackName = productNameMapping.find(m => m.code_source.startsWith(prefix));
    if (fallbackName) productName = fallbackName.valeur;
  }

  // Fallback au catalogue
  const catalogEntry = catalog[mappedRef] || catalog[refNorm];

  return {
    ref: mappedRef,
    productId: productId || catalogEntry?.vf_product_id || null,
    productName: productName || catalogEntry?.nom || null,
    vfRef: catalogEntry?.vf_ref || mappedRef,
  };
}

// ─── Remises ──────────────────────────────────────────────────────────────────

function getDiscount(discounts, ref) {
  if (!discounts) return 0;
  const r = normalizeRef(ref);
  if (discounts[r] != null) return discounts[r];
  if (r.startsWith('P')) {
    const np = 'NP' + r.slice(1);
    if (discounts[np] != null) return discounts[np];
  }
  return 0;
}

function calculerRemise(clientName, productCode, discountsDb) {
  if (!discountsDb || !clientName) return 0;
  const ref = normalizeRef(productCode);
  const clientNorm = clientName.toLowerCase();

  for (const d of discountsDb) {
    if (d.client_name.toLowerCase() === clientNorm && normalizeRef(d.product_code) === ref) {
      return d.discount_pct;
    }
  }
  // Tolère NP
  if (ref.startsWith('P')) {
    const np = 'NP' + ref.slice(1);
    for (const d of discountsDb) {
      if (d.client_name.toLowerCase() === clientNorm && normalizeRef(d.product_code) === np) {
        return d.discount_pct;
      }
    }
  }
  return 0;
}

// ─── Frais de port ────────────────────────────────────────────────────────────

function calculerFraisPort(totalHT, clientRules) {
  // >= seuil franco → FP (préparation 25€), sinon FE (expédition 80€)
  const francoSeuil = (clientRules && clientRules.francoSeuil) || 800;

  if (totalHT >= francoSeuil) {
    return [{
      ref: 'FP',
      nom: 'FRAIS PREPARATION',
      prix_ht: 25.00,
      quantite: 1,
      tva: 20,
    }];
  }

  return [{
    ref: 'FE',
    nom: 'FRAIS EXPEDITION',
    prix_ht: 80.00,
    quantite: 1,
    tva: 20,
  }];
}

// ─── CSV Logisticien ──────────────────────────────────────────────────────────

function genererCSVLogisticien(invoiceData, client, shippingNames, options = {}) {
  const lines = [];
  // Sanitiser un champ CSV : retirer les ; et les sauts de ligne
  const clean = (val) => String(val || '').replace(/;/g, ',').replace(/[\n\r]+/g, ' ').trim();

  // Header 16 colonnes (format identique au HTML standalone)
  lines.push([
    'Numéro de commande', 'Réf. Commande', 'référence de l article', 'quantité de l article',
    'Nom livraison', 'Nom du client', 'Adresse (rue)', 'Ville', 'Code postal', 'Pays',
    'id du transporteur', 'Nom du transporteur', 'Commentaire de livraison',
    'Adresse mail', 'Téléphone 1', 'Téléphone 2',
  ].join(';'));

  const shippingId = options.shippingId || client.shipping_id || '';
  const transporterName = (shippingNames && shippingId)
    ? (shippingNames[shippingId] || '')
    : '';

  // Parser l'adresse de livraison si différente de la facturation
  // Format VosFactures delivery_address : texte libre, souvent "Nom\nRue\nCP Ville\nPays"
  let deliveryStreet = client.street || client.address || '';
  let deliveryCity = client.city || '';
  let deliveryZip = client.zip || client.post_code || '';
  let deliveryCountry = client.country || '';
  let deliveryName = client.recipient_name || client.name || '';

  const rawDelivery = (options.deliveryAddress || '').trim();
  if (rawDelivery) {
    const dLines = rawDelivery.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (dLines.length >= 2) {
      // Première ligne = nom, dernière(s) = adresse
      deliveryName = dLines[0];
      deliveryStreet = dLines.length >= 3 ? dLines[1] : '';
      // Chercher la ligne CP + Ville (format "75008 Paris" ou "FR-75008 Paris")
      const cpVilleLine = dLines.find(l => /\d{4,5}\s/.test(l)) || dLines[dLines.length - 1];
      const cpMatch = cpVilleLine.match(/(\d{4,5})\s+(.+)/);
      if (cpMatch) {
        deliveryZip = cpMatch[1];
        deliveryCity = cpMatch[2];
      } else if (dLines.length >= 3) {
        deliveryCity = dLines[dLines.length - 1];
      }
      // Pays si dernière ligne est un code pays ou nom de pays
      const lastLine = dLines[dLines.length - 1];
      if (/^[A-Z]{2}$/.test(lastLine) || /^(France|Belgique|Suisse|Luxembourg|Allemagne|Italie|Espagne)$/i.test(lastLine)) {
        deliveryCountry = lastLine;
      }
    } else if (dLines.length === 1) {
      // Adresse sur une seule ligne — mettre en rue
      deliveryStreet = dLines[0];
    }
  }

  const products = invoiceData.products || [];
  for (const p of products) {
    if (p.ref === 'FP' || p.ref === 'FE') continue;

    const csvRef = p.csv_ref || p.ref;
    lines.push([
      clean(invoiceData.number),                                         // Numéro de commande
      clean(invoiceData.orderNumber),                                    // Réf. Commande
      clean(csvRef),                                                     // référence de l article
      p.quantite || p.quantity || 0,                                     // quantité de l article
      clean(deliveryName),                                               // Nom livraison
      clean(client.name),                                                // Nom du client
      clean(deliveryStreet),                                             // Adresse (rue)
      clean(deliveryCity),                                               // Ville
      clean(deliveryZip),                                                // Code postal
      clean(deliveryCountry) || 'FR',                                    // Pays
      clean(shippingId),                                                 // id du transporteur
      clean(transporterName),                                            // Nom du transporteur
      clean(invoiceData.notes),                                          // Commentaire de livraison
      clean(client.email),                                               // Adresse mail
      clean(client.phone),                                               // Téléphone 1
      '',                                                                // Téléphone 2
    ].join(';'));
  }

  // BOM UTF-8 pour Excel
  return '\uFEFF' + lines.join('\n');
}

// ─── Parsing adresse ──────────────────────────────────────────────────────────

function parseAdresseExpedition(adresse, partnerName) {
  if (!adresse) return { street: '', city: '', zip: '', country: 'FR' };

  const raw = String(adresse).trim();

  const countryCodes = {
    'france': 'FR', 'italie': 'IT', 'italy': 'IT', 'suisse': 'CH',
    'switzerland': 'CH', 'belgique': 'BE', 'belgium': 'BE',
    'allemagne': 'DE', 'germany': 'DE', 'espagne': 'ES', 'spain': 'ES',
    'autriche': 'AT', 'austria': 'AT', 'luxembourg': 'LU',
    'pays-bas': 'NL', 'netherlands': 'NL', 'portugal': 'PT',
    'royaume-uni': 'GB', 'united kingdom': 'GB', 'uk': 'GB',
  };

  // Déterminer le séparateur : newlines ou virgules
  const hasNewlines = raw.includes('\n');
  let parts = hasNewlines
    ? raw.split('\n').map(l => l.trim()).filter(Boolean)
    : raw.split(',').map(l => l.trim()).filter(Boolean);

  // Retirer le nom du partenaire s'il apparaît en première ligne de l'adresse
  if (partnerName && parts.length > 1) {
    const nameNorm = partnerName.toLowerCase().replace(/\s+/g, ' ').trim();
    const firstNorm = parts[0].toLowerCase().replace(/\s+/g, ' ').trim();
    if (firstNorm === nameNorm || firstNorm.includes(nameNorm) || nameNorm.includes(firstNorm)) {
      parts = parts.slice(1);
    }
  }

  // Fonction utilitaire : extraire zip+ville d'une partie
  const extractZipCity = (part) => {
    // "78800" seul
    const pureZip = part.match(/^\s*(\d{4,5})\s*$/);
    if (pureZip) return { zip: pureZip[1], city: '' };
    // "78800 Houilles" (zip avant ville)
    const zipCity = part.match(/^\s*(\d{4,5})\s+(.+)$/);
    if (zipCity) return { zip: zipCity[1], city: zipCity[2].trim() };
    // "Houilles 78800" (ville avant zip)
    const cityZip = part.match(/^(.+?)\s+(\d{4,5})\s*$/);
    if (cityZip) return { zip: cityZip[2], city: cityZip[1].trim() };
    return null;
  };

  let street = '';
  let city = '';
  let zip = '';
  let country = 'FR';

  if (parts.length >= 3) {
    let streetParts = [];
    let foundZip = false;
    for (const part of parts) {
      if (!foundZip) {
        const zc = extractZipCity(part);
        if (zc) {
          zip = zc.zip;
          if (zc.city) city = zc.city;
          foundZip = true;
        } else {
          // Vérifier si le code postal est collé à la fin: "59 rue Bara 78800"
          const inlineZip = part.match(/^(.+?)\s+(\d{5})$/);
          if (inlineZip) {
            streetParts.push(inlineZip[1]);
            zip = inlineZip[2];
            foundZip = true;
          } else {
            streetParts.push(part);
          }
        }
      } else {
        const lower = part.toLowerCase().trim();
        if (countryCodes[lower]) {
          country = countryCodes[lower];
        } else if (!city) {
          city = part;
        }
      }
    }
    street = streetParts.join(', ');
  } else if (parts.length === 2) {
    // Essayer d'abord : parts[1] contient zip+ville ?
    const zc = extractZipCity(parts[1]);
    if (zc) {
      street = parts[0];
      zip = zc.zip;
      city = zc.city;
    } else {
      // Essayer : parts[0] contient zip+ville et parts[1] est la rue ?
      const zc0 = extractZipCity(parts[0]);
      if (zc0) {
        zip = zc0.zip;
        city = zc0.city;
        street = parts[1];
      } else {
        street = parts[0];
        city = parts[1];
      }
    }
  } else {
    // Une seule partie — essayer d'extraire code postal inline
    const singleLine = parts[0] || '';
    const inlineMatch = singleLine.match(/^(.+?),?\s+(\d{5}),?\s+(.+)$/);
    if (inlineMatch) {
      street = inlineMatch[1].replace(/,\s*$/, '');
      zip = inlineMatch[2];
      city = inlineMatch[3].replace(/,\s*$/, '');
    } else {
      street = singleLine;
    }
  }

  // Détecter pays dans city si applicable
  const cityLower = city.toLowerCase().trim();
  if (countryCodes[cityLower]) {
    country = countryCodes[cityLower];
    city = '';
  }

  return { street, city, zip, country };
}

// ─── Matching partenaire ──────────────────────────────────────────────────────

function mapPartnerNameToCanon(vfName, partners) {
  const canonList = (Array.isArray(partners) ? partners : [])
    .map(p => String(p.nom || p || '').trim())
    .filter(Boolean);

  const norm = normaliserNom;
  const vfNorm = norm(vfName);

  // Règle spéciale Korner
  if (vfNorm.includes('korner')) {
    const kornerRules = [
      { k: 'montmartre', v: 'HK MONTMARTRE' },
      { k: 'montparnasse', v: 'HK Montparnasse' },
      { k: 'eiffel', v: 'HK Eiffel' },
      { k: 'saint marcel', v: 'HK Saint Marcel' },
      { k: 'saintmarcel', v: 'HK Saint Marcel' },
      { k: 'sorbonne', v: 'HK Sorbonne' },
      { k: 'opera', v: 'HK OPERA' },
      { k: 'etoile', v: 'HK Etoile' },
      { k: 'louvre', v: 'HK LOUVRE' },
      { k: 'chatelet', v: 'HK CHÂTELET' },
      { k: 'republique', v: 'HK République' },
    ];
    let best = null;
    let bestLen = 0;
    for (const r of kornerRules) {
      if (vfNorm.includes(r.k) && r.k.length > bestLen) {
        best = r.v;
        bestLen = r.k.length;
      }
    }
    if (best) return best;
  }

  // Match exact normalisé
  const canonByNorm = new Map(canonList.map(c => [norm(c), c]));
  if (canonByNorm.has(vfNorm)) return canonByNorm.get(vfNorm);

  // Inclusion (prend le match le plus long)
  let best = null;
  let bestLen = 0;
  for (const c of canonList) {
    const cNorm = norm(c);
    if (!cNorm) continue;
    if (vfNorm.includes(cNorm) && cNorm.length > bestLen) {
      best = c;
      bestLen = cNorm.length;
    }
  }
  if (best) return best;

  // Overlap tokens
  const vfTokens = new Set(vfNorm.split(' ').filter(Boolean));
  let bestScore = 0;
  let bestName = null;
  for (const c of canonList) {
    const cTokens = norm(c).split(' ').filter(Boolean);
    if (!cTokens.length) continue;
    let hit = 0;
    for (const t of cTokens) if (vfTokens.has(t)) hit++;
    const score = hit / Math.max(1, Math.min(cTokens.length, vfTokens.size));
    if (score > bestScore) {
      bestScore = score;
      bestName = c;
    }
  }
  if (bestName && bestScore >= 0.75) return bestName;

  return String(vfName || '').trim();
}

// ─── Parsing saisie manuelle ──────────────────────────────────────────────────

function parseOrderText(text) {
  const products = [];
  const raw = String(text || '');

  const cleaned = raw
    .replace(/×/g, 'x')
    .replace(/[–—]/g, '-')
    .replace(/\t/g, ' ')
    .replace(/\r/g, '\n');

  const norm = (s) => stripDiacritics(String(s || '').toLowerCase())
    .replace(/[''`]/g, ' ')
    .replace(/[(){}\[\]]/g, ' ')
    .replace(/[/\\.,:;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const knownAccRefs = new Set(['PFS', 'PFD', 'PFT', 'SPFS', 'PFDS', 'PFSS', 'PFTS', 'P500ML', 'BAV', 'COFFRETS', 'SPRAY-VIDE']);

  const localNormalizeRef = (ref, lineNorm) => {
    if (!ref) return null;
    let r = ref.toUpperCase().replace(/\s+/g, '').replace(/_/g, '-');
    if (r === 'P5L') return 'P5L';
    if (knownAccRefs.has(r)) return r === 'P500ML' ? 'P500ml' : r;

    const hn = r.match(/^[HN]-?(\d{3})$/);
    if (hn) {
      const num = hn[1];
      const is5L = /(^| )5\s*l( |$)|\b5l\b|\b5\s*litre|\b5\s*litres\b/.test(lineNorm);
      return is5L ? `P${num}-5000` : `P${num}`;
    }

    const p = r.match(/^P(\d{3})(?:-(\d+))?$/);
    if (p) {
      const base = `P${p[1]}`;
      const hasSuffix = !!p[2];
      const is5L = /(^| )5\s*l( |$)|\b5l\b|\b5\s*litre|\b5\s*litres\b/.test(lineNorm);
      if (!hasSuffix && is5L) return `${base}-5000`;
      return r;
    }

    const p5 = r.match(/^P(\d{3})-?5L$/);
    if (p5) return `P${p5[1]}-5000`;

    return r;
  };

  const nameRules = [
    { re: /(?=.*reddition)(?=.*(gel|cleanser|nettoyant))(?=.*(corp|corps|body))(?=.*5\s*l)/, ref: 'P008-5000' },
    { re: /(?=.*reddition)(?=.*(gel|cleanser|nettoyant))(?=.*(corp|corps|body))/, ref: 'P008' },
    { re: /(?=.*(shampoing|shampoo))(?=.*(irrever|irr[eé]ver))(?=.*5\s*l)/, ref: 'P010-5000' },
    { re: /(?=.*(shampoing|shampoo))(?=.*(irrever|irr[eé]ver))/, ref: 'P010' },
    { re: /(?=.*insurrection)(?=.*(hand|mains|wash))(?=.*5\s*l)/, ref: 'P007-5000' },
    { re: /(?=.*insurrection)(?=.*(hand|mains|wash))/, ref: 'P007' },
    { re: /(?=.*(gel|wash|nettoyant|lavant))(?=.*(corps|corporel|body))(?=.*(cheveu|hair))(?=.*(irrever|irr[eé]ver))(?=.*5\s*l)/, ref: 'P014-5000' },
    { re: /(?=.*(gel|wash|nettoyant|lavant))(?=.*(corps|corporel|body))(?=.*(cheveu|hair))(?=.*(irrever|irr[eé]ver))/, ref: 'P014' },
    { re: /coffret/, ref: 'COFFRETS' },
    { re: /porte.?flacon.*triple/, ref: 'PFT' },
    { re: /porte.?flacon.*double/, ref: 'PFD' },
    { re: /porte.?flacon.*simple.*securi|porte.?flacon.*temperproof/, ref: 'SPFS' },
    { re: /porte.?flacon.*simple/, ref: 'PFS' },
  ];

  const lines = cleaned.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !/^bonjour\b/i.test(l) && !/^j['']esp[eè]re\b/i.test(l));

  // Refs accessoires reconnues (non-numériques)
  const accRefs = 'PFS|PFD|PFT|SPFS|PFDS|PFSS|PFTS|P500ml|BAV|COFFRETS|SPRAY-VIDE';
  const accPat = new RegExp(`(${accRefs})`, 'gi');

  const refPatterns = [
    // Accessoires: 2 x PFS, PFD x 3, 10 PFT, PFS 5, etc. (word boundary pour ne pas matcher PFS dans PFSS, etc.)
    new RegExp(`(\\d+)\\s*x\\s*(${accRefs})\\b`, 'gi'),
    new RegExp(`\\b(${accRefs})\\b\\s*x\\s*(\\d+)`, 'gi'),
    new RegExp(`(\\d+)\\s+(${accRefs})\\b`, 'gi'),
    new RegExp(`\\b(${accRefs})\\b\\s+(\\d+)(?!\\s*x)\\b`, 'gi'),
    new RegExp(`\\b(${accRefs})\\b\\s*:\\s*(\\d+)`, 'gi'),
    // P5L
    /(\d+)\s*x\s*(P5L)/gi,
    /(P5L)\s*x\s*(\d+)/gi,
    /(\d+)\s+(P5L)\b/gi,
    /(P5L)\s+(\d+)\b/gi,
    // Pxxx standard (word boundary pour ne pas matcher P500 dans P500ml)
    /(\d+)\s*x\s*([Pp]\d{3}(?:-\d+)?)\b/g,
    /([Pp]\d{3}(?:-\d+)?)\b\s*x\s*(\d+)/g,
    /(\d+)\s+([Pp]\d{3}(?:-\d+)?)\b/g,
    /([Pp]\d{3}(?:-\d+)?)\b\s*:\s*(\d+)/g,
    /([Pp]\d{3}(?:-\d+)?)\b\s+(\d+)(?!\s*[Ll])\b/g,
    // H/N refs
    /(\d+)\s*x\s*([HhNn]\s*-?\s*\d{3})/g,
    /([HhNn]\s*-?\s*\d{3})\s*x\s*(\d+)/g,
  ];

  const extractQty = (line) => {
    const m1 = line.match(/(?:^|\s)x\s*(\d+)\b/i);
    if (m1) return parseInt(m1[1], 10);
    const m2 = line.match(/\b(\d+)\s*x\b/i);
    if (m2) return parseInt(m2[1], 10);
    return null;
  };

  lines.forEach(rawLine => {
    const line = rawLine.replace(/^[-*•\u2022]+\s*/g, '').trim();
    const lineNorm = norm(line);

    let foundAny = false;

    // Format tabulaire: P039 Description... 12 ( 24,00)
    // Ligne commence par une référence, quantité plus loin
    const tabularMatch = line.match(new RegExp(`^([Pp]\\d{3}(?:-\\d+)?|P5L|${accRefs}|[HhNn]\\s*-?\\s*\\d{3})\\s+(.+?)(\\d{1,4})\\s+[\\(\\[]?\\s*[\\d,\\.]+\\s*[\\)\\]]?\\s*€`, 'i'));
    if (tabularMatch) {
      const ref = tabularMatch[1];
      const quantity = parseInt(tabularMatch[3], 10);
      if (quantity > 0 && quantity < 9999) {
        const normalizedRef = localNormalizeRef(ref, lineNorm);
        if (normalizedRef) {
          const existing = products.find(p => p.ref === normalizedRef);
          if (existing) existing.quantity += quantity;
          else products.push({ ref: normalizedRef, quantity });
          foundAny = true;
          logger.debug(`📋 Format tabulaire détecté: ${normalizedRef} x${quantity}`);
          return;
        }
      }
    }

    // Patterns standards (10x P008, P008 x 10, etc.)
    for (const pattern of refPatterns) {
      let match;
      while ((match = pattern.exec(line)) !== null) {
        let ref, quantity;
        if (isNaN(parseInt(match[1], 10))) {
          ref = match[1];
          quantity = parseInt(match[2], 10);
        } else {
          quantity = parseInt(match[1], 10);
          ref = match[2];
        }

        const normalizedRef = localNormalizeRef(ref, lineNorm);
        if (!normalizedRef || !quantity) continue;

        const existing = products.find(p => p.ref === normalizedRef);
        if (existing) existing.quantity += quantity;
        else products.push({ ref: normalizedRef, quantity });
        foundAny = true;
      }
    }
    if (foundAny) return;

    const qty = extractQty(line) || 0;
    if (!qty) return;

    let refFromName = null;
    for (const r of nameRules) {
      if (r.re.test(lineNorm)) { refFromName = r.ref; break; }
    }

    if (!refFromName) {
      const hn = lineNorm.match(/\b([hn])\s*-\s*(\d{3})\b/);
      if (hn) {
        const is5L = /\b5\s*l\b|\b5l\b|\b5\s*litre|\b5\s*litres\b/.test(lineNorm);
        refFromName = is5L ? `P${hn[2]}-5000` : `P${hn[2]}`;
      }
    }

    if (refFromName) {
      const existing = products.find(p => p.ref === refFromName);
      if (existing) existing.quantity += qty;
      else products.push({ ref: refFromName, quantity: qty });
    }
  });

  return products;
}

// ─── Inférence prix ───────────────────────────────────────────────────────────

function inferPriceFromMappings(ref, priceGrid, catalog) {
  const refNorm = normalizeRef(ref);
  const entry = catalog[refNorm];
  if (entry && entry.prix_ht) return entry.prix_ht;
  return 0;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  normalizeRef,
  normaliserNom,
  stripDiacritics,
  matcherProduits,
  findVFProduct,
  getDiscount,
  calculerRemise,
  calculerFraisPort,
  genererCSVLogisticien,
  parseAdresseExpedition,
  mapPartnerNameToCanon,
  parseOrderText,
  inferPriceFromMappings,
};
