-- Supprimer les anciens credentials de la DB locale
DELETE FROM config WHERE cle IN (
  'brevo_api_key',
  'brevo_smtp_key', 
  'hubspot_api_key',
  'vf_api_token',
  'zerobounce_api_key',
  'gsheets_credentials',
  'wms_user',
  'wms_password'
);
