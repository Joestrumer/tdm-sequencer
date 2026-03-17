/**
 * productMatchingService.js — Algorithmes de matching, prix, CSV, adresses
 * Porté depuis le HTML standalone factures.html
 */

// ─── Normalisation ────────────────────────────────────────────────────────────

function stripDiacritics(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeRef(raw) {
  if (!raw) return '';
  let r = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  const specials = new Set(['FP', 'FE', 'P5L', 'SPFS', 'PFS', 'PFD', 'PFT', 'COFFRETS']);
  if (specials.has(r)) return r;
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
        console.log(`⚠️ findVFProduct fallback: ${lookupKey} non trouvé, utilisation de ${fallbackEntry.code_source} → ${productId}`);
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
  // Par défaut : FP (25€ HT) toujours, FE (80€ HT) si total < seuil franco
  const frais = [];

  // Frais de préparation
  frais.push({
    ref: 'FP',
    nom: 'FRAIS PREPARATION',
    prix_ht: 25.00,
    quantite: 1,
    tva: 20,
  });

  // Frais d'expédition (sauf si franco de port)
  const francoSeuil = (clientRules && clientRules.francoSeuil) || 500;
  if (totalHT < francoSeuil) {
    frais.push({
      ref: 'FE',
      nom: 'FRAIS EXPEDITION',
      prix_ht: 80.00,
      quantite: 1,
      tva: 20,
    });
  }

  return frais;
}

// ─── CSV Logisticien ──────────────────────────────────────────────────────────

function genererCSVLogisticien(invoiceData, client, shippingNames, options = {}) {
  const lines = [];

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

  const products = invoiceData.products || [];
  for (const p of products) {
    if (p.ref === 'FP' || p.ref === 'FE') continue;

    const csvRef = p.csv_ref || p.ref;
    lines.push([
      invoiceData.number || '',                                          // Numéro de commande
      invoiceData.orderNumber || '',                                     // Réf. Commande
      csvRef,                                                            // référence de l article
      p.quantite || p.quantity || 0,                                     // quantité de l article
      client.recipient_name || client.name || '',                        // Nom livraison
      client.name || '',                                                 // Nom du client
      (client.street || client.address || '').replace(/;/g, ',').replace(/\n/g, ' '), // Adresse (rue)
      client.city || '',                                                 // Ville
      client.zip || client.post_code || '',                              // Code postal
      client.country || 'FR',                                            // Pays
      shippingId,                                                        // id du transporteur
      transporterName,                                                   // Nom du transporteur
      (invoiceData.notes || '').replace(/;/g, ','),                      // Commentaire de livraison
      client.email || '',                                                // Adresse mail
      client.phone || '',                                                // Téléphone 1
      '',                                                                // Téléphone 2
    ].join(';'));
  }

  // BOM UTF-8 pour Excel
  return '\uFEFF' + lines.join('\n');
}

// ─── Parsing adresse ──────────────────────────────────────────────────────────

function parseAdresseExpedition(adresse) {
  if (!adresse) return { street: '', city: '', zip: '', country: 'FR' };

  const lines = String(adresse).split('\n').map(l => l.trim()).filter(Boolean);

  let street = '';
  let city = '';
  let zip = '';
  let country = 'FR';

  if (lines.length >= 2) {
    street = lines.slice(0, -1).join(', ');
    const lastLine = lines[lines.length - 1];

    // Essayer de parser "75001 Paris" ou "Paris 75001"
    const matchZipCity = lastLine.match(/^(\d{4,5})\s+(.+)$/);
    const matchCityZip = lastLine.match(/^(.+?)\s+(\d{4,5})$/);

    if (matchZipCity) {
      zip = matchZipCity[1];
      city = matchZipCity[2];
    } else if (matchCityZip) {
      city = matchCityZip[1];
      zip = matchCityZip[2];
    } else {
      city = lastLine;
    }
  } else {
    street = lines[0] || '';
  }

  // Détecter le pays si c'est la dernière ligne
  const countryCodes = {
    'france': 'FR', 'italie': 'IT', 'italy': 'IT', 'suisse': 'CH',
    'switzerland': 'CH', 'belgique': 'BE', 'belgium': 'BE',
    'allemagne': 'DE', 'germany': 'DE', 'espagne': 'ES', 'spain': 'ES',
    'autriche': 'AT', 'austria': 'AT', 'luxembourg': 'LU',
    'pays-bas': 'NL', 'netherlands': 'NL', 'portugal': 'PT',
    'royaume-uni': 'GB', 'united kingdom': 'GB', 'uk': 'GB',
  };
  const lastWord = city.toLowerCase().trim();
  if (countryCodes[lastWord]) {
    country = countryCodes[lastWord];
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

  const localNormalizeRef = (ref, lineNorm) => {
    if (!ref) return null;
    let r = ref.toUpperCase().replace(/\s+/g, '').replace(/_/g, '-');
    if (r === 'P5L') return 'P5L';

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
  ];

  const lines = cleaned.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !/^bonjour\b/i.test(l) && !/^j['']esp[eè]re\b/i.test(l));

  const refPatterns = [
    /(\d+)\s*x\s*(P5L)/gi,
    /(P5L)\s*x\s*(\d+)/gi,
    /(\d+)\s+(P5L)\b/gi,
    /(P5L)\s+(\d+)\b/gi,
    /(\d+)\s*x\s*([Pp]\d{3}(?:-\d+)?)/g,
    /([Pp]\d{3}(?:-\d+)?)\s*x\s*(\d+)/g,
    /(\d+)\s+([Pp]\d{3}(?:-\d+)?)/g,
    /([Pp]\d{3}(?:-\d+)?)\s*:\s*(\d+)/g,
    /([Pp]\d{3}(?:-\d+)?)\s+(\d+)/g,
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
    const tabularMatch = line.match(/^([Pp]\d{3}(?:-\d+)?|P5L|[HhNn]\s*-?\s*\d{3})\s+(.+?)(\d{1,4})\s+[\(\[]?\s*[\d,\.]+\s*[\)\]]?\s*€/);
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
          console.log(`📋 Format tabulaire détecté: ${normalizedRef} x${quantity}`);
          return;
        }
      }
    }

    // Patterns standards (10x P008, P008 x 10, etc.)
    for (const pattern of refPatterns) {
      let match;
      while ((match = pattern.exec(line)) !== null) {
        let ref, quantity;
        if (String(match[1]).match(/^[PpHhNn]/)) {
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
