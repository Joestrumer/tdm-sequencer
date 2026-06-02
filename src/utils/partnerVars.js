/**
 * partnerVars.js — Substitution de variables pour emails partenaires
 */

function substituteVars(text, data) {
  if (!text) return '';
  return text
    .replace(/\{\{prenom\}\}/g, data.prenom || '')
    .replace(/\{\{nom\}\}/g, data.nom || '')
    .replace(/\{\{hotel\}\}/g, data.hotel || '')
    .replace(/\{\{business_type\}\}/g, data.business_type || '')
    .replace(/\{\{partner_since\}\}/g, data.partner_since || '')
    .replace(/\{\{anniversaire_annees\}\}/g, String(data.anniversaire_annees || ''));
}

module.exports = { substituteVars };
