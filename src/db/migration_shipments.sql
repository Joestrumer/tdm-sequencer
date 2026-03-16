-- Table pour stocker tous les envois (commandes + échantillons)
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Type d'envoi
  type TEXT NOT NULL CHECK(type IN ('commande', 'echantillon')), -- commande ou échantillon
  
  -- Références
  order_ref TEXT NOT NULL, -- Référence WMS (ex: P4476)
  invoice_id TEXT, -- ID facture VosFactures (si commande)
  invoice_number TEXT, -- Numéro facture (si commande)
  
  -- Client
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_address TEXT,
  client_city TEXT,
  client_country TEXT DEFAULT 'FR',
  
  -- Expédition
  shipping_id TEXT NOT NULL, -- ID transporteur (ex: 1302)
  shipping_name TEXT, -- Nom transporteur (ex: Chronopost 13H)
  
  -- Montants (pour CA)
  montant_ht REAL DEFAULT 0,
  montant_ttc REAL DEFAULT 0,
  
  -- Tracking WMS
  wms_status TEXT, -- Statut WMS (expédié, livré, etc.)
  wms_status_code TEXT, -- Code statut
  tracking_number TEXT, -- Numéro de suivi
  carrier_name TEXT, -- Nom transporteur depuis WMS
  
  -- Dates
  created_at TEXT DEFAULT (datetime('now')),
  shipped_at TEXT, -- Date expédition réelle
  delivered_at TEXT, -- Date livraison
  last_wms_check TEXT, -- Dernière vérification WMS
  
  -- Métadonnées
  notes TEXT,
  meta TEXT -- JSON pour infos supplémentaires
);

-- Index pour recherches rapides
CREATE INDEX IF NOT EXISTS idx_shipments_type ON shipments(type);
CREATE INDEX IF NOT EXISTS idx_shipments_order_ref ON shipments(order_ref);
CREATE INDEX IF NOT EXISTS idx_shipments_invoice_number ON shipments(invoice_number);
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_client ON shipments(client_name);
