-- Script SQL pour mettre à jour les secrets dans la DB Railway
-- À exécuter via Railway CLI ou interface DB

-- VosFactures
INSERT INTO config (cle, valeur) VALUES ('vf_api_token', 'VOTRE_NOUVEAU_TOKEN')
ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur;

-- Brevo (optionnel si vous voulez les stocker en DB plutôt qu'en env var)
INSERT INTO config (cle, valeur) VALUES ('brevo_api_key', 'VOTRE_NOUVEAU_KEY')
ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur;

-- HubSpot
INSERT INTO config (cle, valeur) VALUES ('hubspot_api_key', 'VOTRE_NOUVEAU_KEY')
ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur;

-- Google Sheets (déjà fait normalement)
-- INSERT INTO config (cle, valeur) VALUES ('gsheets_credentials', '{"type":"service_account",...}')
-- ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur;

