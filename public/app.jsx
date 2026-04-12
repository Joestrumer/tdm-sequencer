const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── API BACKEND (remplace les données démo) ──────────────────────────────────
const api = window.tdmApi;

// ─── CONSTANTES PARTAGÉES ─────────────────────────────────────────────────────
const SEGMENTS_DEFAULT = ["5*","4*","Boutique","Retail","SPA","Concept Store"];

// Cache global des segments dynamiques (chargé par App, utilisé partout)
let _segmentsCache = SEGMENTS_DEFAULT;
function getSegments() { return _segmentsCache; }
const LANGUES_MAP = { fr: "🇫🇷", en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", it: "🇮🇹" };
const langueToFlag = (l) => LANGUES_MAP[l] || l;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function parseTags(tags) {
  if (Array.isArray(tags)) return tags;
  try { return JSON.parse(tags || "[]"); } catch(e) { return []; }
}

// ─── FILE SYSTEM ACCESS API HELPER ─────────────────────────────────────────────
async function saveFileWithPicker(blob, fileName) {
  if (!window.showDirectoryPicker) return false;
  try {
    let dirHandle = null;
    const savedHandleName = localStorage.getItem('csvDirHandleName');
    if (savedHandleName && window.savedCSVDirHandle) {
      try {
        const permission = await window.savedCSVDirHandle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted' || await window.savedCSVDirHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
          dirHandle = window.savedCSVDirHandle;
        }
      } catch (e) { /* handle invalide */ }
    }
    if (!dirHandle) {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      window.savedCSVDirHandle = dirHandle;
      localStorage.setItem('csvDirHandleName', dirHandle.name);
    }
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return dirHandle.name;
  } catch (fsErr) {
    if (fsErr.name !== 'AbortError') {
      console.warn('File System Access fallback:', fsErr);
      delete window.savedCSVDirHandle;
      localStorage.removeItem('csvDirHandleName');
    }
    return false;
  }
}

function downloadFallback(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}

// ─── CONFIRM DIALOG ─────────────────────────────────────────────────────────
const ConfirmDialog = ({ title, message, onConfirm, onCancel, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) => {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60]" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-900 mb-2">{title || 'Confirmation'}</h3>
        <p className="text-sm text-slate-600 mb-6 whitespace-pre-line">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">{cancelLabel}</button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-700'}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};

function useConfirmDialog() {
  const [state, setState] = useState(null);
  const confirm = useCallback((message, options = {}) => {
    return new Promise(resolve => {
      setState({ message, ...options, resolve });
    });
  }, []);
  const dialog = state ? (
    <ConfirmDialog
      title={state.title} message={state.message}
      confirmLabel={state.confirmLabel} cancelLabel={state.cancelLabel} danger={state.danger}
      onConfirm={() => { state.resolve(true); setState(null); }}
      onCancel={() => { state.resolve(false); setState(null); }}
    />
  ) : null;
  return { confirm, dialog };
}

// ─── HOOKS UTILITAIRES ──────────────────────────────────────────────────────────
function useEscapeClose(onClose) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', handler); document.body.style.overflow = ''; };
  }, [onClose]);
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
const Toast = ({ toast, onDismiss }) => {
  if (!toast || !toast.visible) return null;
  const colors = {
    success: "bg-emerald-600",
    error: "bg-red-600",
    info: "bg-slate-800",
  };
  return (
    <div className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium flex items-center gap-2 animate-fade-in ${colors[toast.type] || colors.info}`}>
      {toast.type === "success" && <span>✓</span>}
      {toast.type === "error" && <span>✗</span>}
      <span>{toast.message}</span>
      <button onClick={onDismiss} className="ml-2 text-white/60 hover:text-white">×</button>
    </div>
  );
};

// ─── COMPOSANTS UI ────────────────────────────────────────────────────────────

const STATUT_CONFIG = {
  "Nouveau": { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
  "En séquence": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  "Répondu": { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  "Converti": { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  "Fin de séquence": { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500" },
  "Closed Lost": { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
  "Email Marketing Sent": { bg: "bg-indigo-50", text: "text-indigo-700", dot: "bg-indigo-500" },
  "Désabonné": { bg: "bg-red-50", text: "text-red-600", dot: "bg-red-400" },
};

const Badge = ({ statut }) => {
  const cfg = STATUT_CONFIG[statut] || STATUT_CONFIG["Nouveau"];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {statut}
    </span>
  );
};

const ScoreBar = ({ score }) => {
  const color = score >= 80 ? "#10b981" : score >= 50 ? "#f59e0b" : "#94a3b8";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-slate-500">{score}</span>
    </div>
  );
};


// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Les dates de la DB sont stockées soit en UTC (datetime('now') → "2026-04-09 14:30:00")
// soit en heure locale Paris (prochain_envoi, scheduled_at → "2026-04-09 16:30:00").
// Sans suffixe "Z", le navigateur interprète comme heure locale — incorrect pour les dates UTC.
// parseUTC() ajoute le "Z" manquant pour que le navigateur les convertisse correctement
// dans le fuseau horaire de l'utilisateur.
function parseUTC(iso) {
  if (!iso) return null;
  const s = iso.trim();
  // Si déjà ISO avec Z ou +offset, ne pas modifier
  if (/[Zz]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  // Remplacer l'espace par T si nécessaire et ajouter Z
  return new Date(s.replace(' ', 'T') + 'Z');
}

// Pour les dates stockées en heure Paris (prochain_envoi, scheduled_at)
// Ces dates sont "naïves" (sans timezone) mais représentent l'heure de Paris.
// On les convertit en instant UTC correct pour que le navigateur les affiche
// correctement dans le fuseau local de l'utilisateur.
function parseParis(iso) {
  if (!iso) return null;
  const s = iso.trim().replace(' ', 'T');
  const naive = new Date(s); // interprété comme heure locale du navigateur
  if (isNaN(naive)) return null;
  // Comparer l'heure locale du navigateur avec l'heure Paris pour cette date
  const localStr = naive.toLocaleString('sv-SE');
  const parisStr = naive.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
  if (localStr === parisStr) return naive; // navigateur déjà en heure Paris
  // Calculer l'offset entre local et Paris et compenser
  const localDate = new Date(localStr.replace(' ', 'T'));
  const parisDate = new Date(parisStr.replace(' ', 'T'));
  const offsetMs = localDate.getTime() - parisDate.getTime();
  return new Date(naive.getTime() + offsetMs);
}

function relTime(iso) {
  if (!iso) return "—";
  const d = parseUTC(iso);
  if (!d || isNaN(d)) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const dd = Math.floor(h / 24);
  if (dd < 7) return `il y a ${dd}j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ─── MODALS ───────────────────────────────────────────────────────────────────

const ModalAddLead = ({ onClose, onAdd, campaigns = [], sequences = [] }) => {
  useEscapeClose(onClose);
  const [form, setForm] = useState({ prenom: "", nom: "", hotel: "", ville: "", email: "", segment: "5*", poste: "", langue: "fr", campaign: "", comment: "", source: "", civilite: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [showCampaignDropdown, setShowCampaignDropdown] = useState(false);
  const campaignRef = useRef(null);
  const [sequenceId, setSequenceId] = useState('');
  const [taskRelance, setTaskRelance] = useState(0);

  // Recherche HubSpot
  const [queryCompany, setQueryCompany] = useState("");
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [contactsCompany, setContactsCompany] = useState([]);
  const [searchingHS, setSearchingHS] = useState(false);
  const searchTimer = useRef(null);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [batchResult, setBatchResult] = useState(null);

  const rechercherCompany = (q) => {
    setQueryCompany(q);
    clearTimeout(searchTimer.current);
    if (!q || q.length < 2) { setCompanies([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchingHS(true);
      try {
        const res = await api.get(`/hubspot/recherche-companies?q=${encodeURIComponent(q)}`);
        setCompanies(Array.isArray(res) ? res : []);
      } catch(e) { setCompanies([]); }
      setSearchingHS(false);
    }, 400);
  };

  const selectionnerCompany = async (company) => {
    setSelectedCompany(company);
    setCompanies([]);
    setQueryCompany(company.nom);
    setSelectedContacts([]);
    setBatchResult(null);
    setForm(f => ({ ...f, hotel: company.nom, ville: company.ville || f.ville }));
    // Charger les contacts liés
    try {
      const contacts = await api.get(`/hubspot/contacts-company/${company.id}`);
      setContactsCompany(Array.isArray(contacts) ? contacts : []);
    } catch(e) { setContactsCompany([]); }
  };

  const toggleContact = (contact) => {
    setSelectedContacts(prev => {
      const exists = prev.find(c => c.email === contact.email);
      if (exists) return prev.filter(c => c.email !== contact.email);
      return [...prev, contact];
    });
  };

  const toggleAllContacts = () => {
    if (selectedContacts.length === contactsCompany.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts([...contactsCompany]);
    }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setBatchResult(null);
    try {
      if (selectedContacts.length > 0) {
        // Mode batch : ajouter tous les contacts sélectionnés
        const leads = selectedContacts.map(c => ({
          prenom: c.prenom,
          nom: c.nom || '',
          email: c.email,
          hotel: form.hotel || selectedCompany?.nom || '',
          ville: form.ville || '',
          segment: form.segment,
          poste: c.poste || '',
          langue: form.langue,
          campaign: form.campaign,
          comment: form.comment,
        }));
        const result = await api.post('/leads/batch', { leads, company_hubspot_id: selectedCompany?.id || null });
        setBatchResult(result);
        if (result.crees && result.crees.length > 0) {
          result.crees.forEach(l => onAdd(l));
          if (sequenceId) {
            api.post(`/sequences/${sequenceId}/inscrire-batch`, {
              lead_ids: result.crees.map(l => l.id),
              task_relance_mois: taskRelance
            }).catch(e => console.warn('Erreur inscription batch séquence:', e));
          }
        }
        // Si tout a été créé sans erreur, fermer après un délai
        if ((!result.doublons || result.doublons.length === 0) && (!result.erreurs || result.erreurs.length === 0)) {
          setTimeout(() => onClose(), 1200);
        }
      } else {
        // Mode unitaire classique
        if (!form.email || !form.hotel) { setSaving(false); return; }
        const payload = {
          ...form,
          tags: JSON.stringify([form.segment]),
          company_hubspot_id: selectedCompany?.id || null,
        };
        const lead = await api.post('/leads', payload);
        onAdd(lead);
        if (sequenceId) {
          api.post(`/sequences/${sequenceId}/inscrire`, {
            lead_id: lead.id,
            task_relance_mois: taskRelance
          }).catch(e => console.warn('Erreur inscription séquence:', e));
        }
        onClose();
      }
    } catch(e) { setErr(e.message || "Erreur lors de l'ajout"); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Ajouter un lead</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Recherche HubSpot */}
          <div className="relative">
            <label className="text-xs font-medium text-slate-500 mb-1 block">Rechercher un établissement dans HubSpot</label>
            <input
              value={queryCompany}
              onChange={e => rechercherCompany(e.target.value)}
              placeholder="Barrière, Negresco, Le Bon Marché..."
              className="w-full border border-orange-200 bg-orange-50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300/40 focus:border-orange-400"
            />
            {searchingHS && <span className="absolute right-3 top-8 text-xs text-slate-400">⟳</span>}
            {companies.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {companies.map(c => (
                  <button key={c.id} onClick={() => selectionnerCompany(c)}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                    <div className="text-sm font-medium text-slate-800">{c.nom}</div>
                    <div className="text-xs text-slate-400">{c.domaine} {c.ville ? `· ${c.ville}` : ""}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Contacts liés à la company */}
          {contactsCompany.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-orange-700">
                  {contactsCompany.length} contact{contactsCompany.length > 1 ? 's' : ''} trouvé{contactsCompany.length > 1 ? 's' : ''}
                  {selectedContacts.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-orange-200 text-orange-800 rounded-full text-[10px] font-semibold">{selectedContacts.length} sélectionné{selectedContacts.length > 1 ? 's' : ''}</span>}
                </p>
                <button type="button" onClick={toggleAllContacts}
                  className="text-[11px] font-medium text-orange-600 hover:text-orange-800 transition-colors">
                  {selectedContacts.length === contactsCompany.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>
              </div>
              <div className="space-y-1">
                {contactsCompany.map(c => {
                  const isSelected = selectedContacts.some(sc => sc.email === c.email);
                  return (
                    <button key={c.hubspot_id} onClick={() => toggleContact(c)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors border flex items-center gap-2 ${isSelected ? 'bg-orange-100 border-orange-300' : 'bg-white border-orange-100 hover:bg-orange-50'}`}>
                      <span className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-slate-800">{c.prenom} {c.nom}</span>
                        <span className="text-xs text-slate-400 ml-2">{c.email}</span>
                        {c.poste && <span className="text-xs text-slate-400 ml-1">· {c.poste}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Résultat batch */}
          {batchResult && (
            <div className="rounded-xl p-3 border text-sm space-y-1">
              {batchResult.crees?.length > 0 && <p className="text-emerald-700">{batchResult.crees.length} lead{batchResult.crees.length > 1 ? 's' : ''} créé{batchResult.crees.length > 1 ? 's' : ''}</p>}
              {batchResult.doublons?.length > 0 && <p className="text-amber-600">{batchResult.doublons.length} doublon{batchResult.doublons.length > 1 ? 's' : ''} ignoré{batchResult.doublons.length > 1 ? 's' : ''} : {batchResult.doublons.map(d => d.email).join(', ')}</p>}
              {batchResult.erreurs?.length > 0 && <p className="text-red-600">{batchResult.erreurs.length} erreur{batchResult.erreurs.length > 1 ? 's' : ''} : {batchResult.erreurs.map(e => e.email).join(', ')}</p>}
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-400 mb-3">Ou remplir manuellement</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Civilité</label>
                <select value={form.civilite} onChange={e => set("civilite", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  <option value="">—</option>
                  {["M.", "Mme", "Dr", "Pr", "Maître"].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {[["prenom","Prénom"],["nom","Nom"]].map(([k,l]) => (
                <div key={k}>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">{l}</label>
                  <input value={form[k]} onChange={e => set(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                </div>
              ))}
            </div>
            {[["hotel","Établissement"],["ville","Ville"],["email","Email"],["poste","Poste / Fonction"]].map(([k,l]) => (
              <div key={k} className="mt-3">
                <label className="text-xs font-medium text-slate-500 mb-1 block">{l}</label>
                <input type={k === "email" ? "email" : "text"} value={form[k]} onChange={e => set(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
            ))}
            <div className="mt-3 relative" ref={campaignRef}>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Campaign</label>
              <input
                value={form.campaign}
                onChange={e => { set("campaign", e.target.value); setShowCampaignDropdown(true); }}
                onFocus={() => setShowCampaignDropdown(true)}
                onBlur={() => setTimeout(() => setShowCampaignDropdown(false), 200)}
                placeholder="Sélectionner ou saisir une campagne..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
              {showCampaignDropdown && (() => {
                const allOptions = [...new Set([...campaigns, ...sequences.map(s => s.nom)])].sort();
                const filtered = allOptions.filter(o => !form.campaign || o.toLowerCase().includes(form.campaign.toLowerCase()));
                if (filtered.length === 0) return null;
                return (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filtered.map(opt => (
                      <button key={opt} type="button" onClick={() => { set("campaign", opt); setShowCampaignDropdown(false); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 truncate">
                        {opt}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium text-slate-500 mb-1 block">Source</label>
              <input
                list="source-suggestions"
                value={form.source}
                onChange={e => set("source", e.target.value)}
                placeholder="Sélectionner ou saisir..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
              <datalist id="source-suggestions">
                {["Site web", "LinkedIn", "HubSpot", "Import CSV", "Salon", "Recommandation", "Partenaire"].map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium text-slate-500 mb-1 block">Commentaire</label>
              <textarea
                value={form.comment}
                onChange={e => set("comment", e.target.value)}
                placeholder="Notes, contexte, remarques..."
                rows={3}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Segment</label>
                <select value={form.segment} onChange={e => set("segment", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  {getSegments().map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Langue</label>
                <select value={form.langue} onChange={e => set("langue", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  <option value="fr">🇫🇷 Français</option>
                  <option value="en">🇬🇧 English</option>
                  <option value="de">🇩🇪 Deutsch</option>
                  <option value="es">🇪🇸 Español</option>
                  <option value="it">🇮🇹 Italiano</option>
                </select>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Lancer dans une séquence</label>
              <select value={sequenceId} onChange={e => setSequenceId(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                <option value="">Aucune</option>
                {sequences.map(s => <option key={s.id} value={s.id}>{s.nom}</option>)}
              </select>
            </div>
            {sequenceId && (
              <div className="mt-3">
                <label className="text-xs font-medium text-slate-500 mb-1 block">Task de relance HubSpot</label>
                <select value={taskRelance} onChange={e => setTaskRelance(Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  <option value={0}>Aucune</option>
                  <option value={3}>3 mois</option>
                  <option value={6}>6 mois</option>
                  <option value={9}>9 mois</option>
                  <option value={12}>12 mois</option>
                </select>
              </div>
            )}
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3 flex-shrink-0 border-t border-slate-100">
          {err && <span className="text-xs text-red-500 mr-auto">{err}</span>}
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">
            {saving ? "Ajout..." : selectedContacts.length > 0 ? `Ajouter ${selectedContacts.length} contact${selectedContacts.length > 1 ? 's' : ''}` : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ModalLaunchSequence = ({ lead, sequences, onClose, onLaunch }) => {
  useEscapeClose(onClose);
  const [selected, setSelected] = useState(sequences[0]?.id);
  const [taskRelance, setTaskRelance] = useState(0);
  const [status, setStatus] = useState(null); // null | "loading" | "done" | "error"
  const [errMsg, setErrMsg] = useState("");

  const handleLaunch = async (sendNow) => {
    if (!selected) return;
    setStatus("loading");
    try {
      // 1. Inscrire le lead à la séquence
      await onLaunch(lead.id, selected, taskRelance);
      // 2. Si "envoyer maintenant" → forcer le scheduler sur ce lead uniquement (en arrière-plan)
      if (sendNow) {
        const r = await api.post('/sequences/trigger-now', { lead_ids: [lead.id], async: true });
        if (r?.erreur) throw new Error(r.erreur);
      }
      setStatus("done");
      setTimeout(() => onClose(), 1200);
    } catch(e) {
      setStatus("error");
      setErrMsg(e.message || "Erreur inconnue");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Lancer une séquence</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-sm text-slate-500 mb-4">Pour <span className="font-medium text-slate-800">{lead.prenom} {lead.nom}</span> — {lead.hotel}</p>
          <div className="space-y-2">
            {sequences.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Aucune séquence disponible. Créez-en une d'abord.</p>}
            {sequences.map(seq => (
              <label key={seq.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${selected === seq.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
                <input type="radio" name="seq" value={seq.id} checked={selected === seq.id} onChange={() => setSelected(seq.id)} className="accent-blue-600" />
                <div>
                  <div className="text-sm font-medium text-slate-800">{seq.nom}</div>
                  <div className="text-xs text-slate-400">{seq.etapes?.length || 0} emails · Segment {seq.segment}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Task de relance HubSpot</label>
            <select value={taskRelance} onChange={e => setTaskRelance(Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 bg-white">
              <option value={0}>Pas de relance</option>
              <option value={3}>Dans 3 mois</option>
              <option value={6}>Dans 6 mois</option>
              <option value={9}>Dans 9 mois</option>
              <option value={12}>Dans 12 mois</option>
            </select>
          </div>
          {status === "done" && <p className="mt-3 text-xs text-emerald-600 font-medium">✓ Séquence lancée ! Email en cours d'envoi...</p>}
          {status === "error" && <p className="mt-3 text-xs text-red-500">✗ {errMsg}</p>}
        </div>
        <div className="px-6 py-4 bg-slate-50 flex flex-col gap-2 flex-shrink-0 border-t border-slate-100">
          <button
            disabled={!selected || status === "loading" || status === "done"}
            onClick={() => handleLaunch(true)}
            className="w-full py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {status === "loading" ? "⏳ Envoi en cours..." : "⚡ Envoyer le 1er email maintenant"}
          </button>
          <button
            disabled={!selected || status === "loading" || status === "done"}
            onClick={() => handleLaunch(false)}
            className="w-full py-2.5 text-sm font-medium bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📅 Lancer la séquence (prochain créneau)
          </button>
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 text-center pt-1">Annuler</button>
        </div>
      </div>
    </div>
  );
};

// ─── Signature email (chargée dynamiquement depuis la config) ────────────────
// Fallback hardcodé utilisé avant le chargement de l'API
const SIGNATURE_HTML_DEFAULT = `<br>
<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;">
<tr>
  <td style="padding-right:14px;border-right:2px solid #aa8d3e;vertical-align:top;line-height:1.6;">
    <strong style="font-size:14px;">Hugo Montiel</strong><br>
    <span style="color:#555;font-size:12px;">Sales Director — Terre de Mars</span>
  </td>
  <td style="padding-left:14px;vertical-align:top;font-size:12px;line-height:1.8;">
    <a href="tel:+33685820335" style="color:#444;text-decoration:none;">+33 6 85 82 03 35</a><br>
    <a href="mailto:hugo@terredemars.com" style="color:#aa8d3e;text-decoration:none;">hugo@terredemars.com</a><br>
    <a href="https://www.terredemars.com" style="color:#aa8d3e;text-decoration:none;">www.terredemars.com</a><br>
    <span style="color:#888;">2 Rue de Vienne, 75008 Paris</span>
  </td>
</tr>
<tr><td colspan="2" style="padding-top:10px;">
  <a href="https://calendly.com/hugo-montiel/meeting-terre-de-mars"
     style="display:inline-block;background:#aa8d3e;color:#fff;font-size:11px;font-weight:700;text-decoration:none;padding:6px 14px;border-radius:3px;">
    Prendre rendez-vous
  </a>
</td></tr>
</table>
`;
// Variable mutable : mise à jour au chargement depuis /config/signature
let _signatureHtmlCache = SIGNATURE_HTML_DEFAULT;
// Charger la signature depuis la DB au démarrage
(function loadSignature() {
  api.get('/config/signature').then(data => {
    if (data?.signature) _signatureHtmlCache = data.signature;
  }).catch(() => {});
})();
// Getter pour accéder à la signature courante
function getSignatureHtml() { return _signatureHtmlCache; }
// Forcer un rechargement (appelé après sauvegarde dans VueCompteEmail)
function reloadSignature() {
  return api.get('/config/signature').then(data => {
    if (data?.signature) _signatureHtmlCache = data.signature;
    return _signatureHtmlCache;
  }).catch(() => _signatureHtmlCache);
}
// Données de démo pour la prévisualisation
const DEMO_LEAD_PREVIEW = { prenom: "Sophie", nom: "Lefebvre", hotel: "Hôtel Le Bristol", ville: "Paris", segment: "5*", civilite: "Mme" };

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function substituerVarsPreview(texte, lead = DEMO_LEAD_PREVIEW) {
  return texte
    .replace(/\{\{prenom\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${escapeHtml(lead.prenom)}</span>`)
    .replace(/\{\{nom\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${escapeHtml(lead.nom)}</span>`)
    .replace(/\{\{hotel\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${escapeHtml(lead.hotel)}</span>`)
    .replace(/\{\{etablissement\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${escapeHtml(lead.hotel)}</span>`)
    .replace(/\{\{ville\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${escapeHtml(lead.ville)}</span>`)
    .replace(/\{\{segment\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${escapeHtml(lead.segment)}</span>`);
}

function texteVersHtmlPreview(texte) {
  return texte
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1a56db">$1</a>');
}

const ModalEmailEditor = ({ seq, onClose, onSave }) => {
  useEscapeClose(onClose);
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [etapes, setEtapes] = useState(seq ? [...seq.etapes] : [{ jour: 0, sujet: "", corps: "" }]);
  const [nom, setNom] = useState(seq?.nom || "");
  const [segment, setSegment] = useState(seq?.segment || "5*");
  const [desabonnement, setDesabonnement] = useState(seq?.options?.desabonnement !== false);
  const [bcc, setBcc] = useState(seq?.options?.bcc || "");
  // HubSpot options par séquence (undefined = hérite du global)
  const [hsLogEmail, setHsLogEmail] = useState(seq?.options?.hs_log_email);
  const [hsLifecycle, setHsLifecycle] = useState(seq?.options?.hs_lifecycle);
  const [hsTaskFin, setHsTaskFin] = useState(seq?.options?.hs_task_fin_sequence);
  const [showHsOptions, setShowHsOptions] = useState(false);
  const [activeEtape, setActiveEtape] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testInProgress, setTestInProgress] = useState(false);
  const [mode, setMode] = useState("edit");
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [templates, setTemplates] = useState([]);
  const objetRef = useRef(null);
  const pjRef = useRef(null);
  const [pieceJointe, setPieceJointe] = useState(etapes[0]?.piece_jointe || null);

  // TinyMCE editor setup
  const editorRef = useRef(null);
  const tinymceRef = useRef(null);
  const activeEtapeRef = useRef(activeEtape);

  // Sync pj dans l'étape courante
  const setPjEtape = (pj) => {
    setPieceJointe(pj);
    updateEtape(activeEtape, "piece_jointe", pj);
  };

  // Charger les templates
  const loadTemplates = async () => {
    try {
      const res = await api.get('/email-templates');
      setTemplates(res.templates || []);
    } catch (err) {
      console.error('Erreur chargement templates:', err);
    }
  };

  // Appliquer un template
  const applyTemplate = (template) => {
    updateEtape(activeEtape, 'sujet', template.sujet);
    updateEtape(activeEtape, 'corps_html', template.corps_html || '');

    // Recharger le contenu dans TinyMCE
    if (tinymceRef.current) {
      tinymceRef.current.setContent(template.corps_html || '');
    }

    setShowTemplateSelector(false);
  };

  // Charger templates au montage
  useEffect(() => {
    loadTemplates();
  }, []);

  const chargerPj = (file) => {
    if (!file) return;
    if (file.size > 5000000) {
      window.showToast?.("Fichier trop volumineux (max 5 MB)", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setPjEtape({ nom: file.name, taille: file.size, type: file.type, data: e.target.result.split(",")[1] });
    };
    reader.readAsDataURL(file);
  };

  const envoyerTestEmail = async () => {
    if (!testEmail.trim() || testInProgress) return;

    // Si la séquence n'est pas encore sauvegardée, sauvegarder d'abord
    if (!seq?.id) {
      if (!await confirmDialog("La séquence doit être sauvegardée avant de pouvoir tester un email. Sauvegarder maintenant ?", { confirmLabel: 'Sauvegarder' })) {
        setShowTestModal(false);
        return;
      }
      await handleSave();
      setShowTestModal(false);
      window.showToast?.("Séquence sauvegardée. Rouvrez pour tester l'email.", "success");
      return;
    }

    const emailToSend = testEmail.trim();
    const etapeIndex = activeEtape;

    // Verrou pour empêcher double clic
    setTestInProgress(true);

    // Fermer le modal immédiatement et lancer en background
    setShowTestModal(false);
    setTestEmail("");
    setTestLoading(false);

    // Toast de confirmation
    window.showToast?.(`Envoi du test vers ${emailToSend}...`, "info");

    // Lancer l'envoi en background
    (async () => {
      try {
        // Créer ou trouver le lead de test
        const search = await api.get(`/leads?search=${encodeURIComponent(emailToSend)}`);
        const existing = (Array.isArray(search) ? search : search.leads || []).find(l => l.email === emailToSend);
        let leadId;
        if (existing) {
          leadId = existing.id;
        } else {
          const created = await api.post('/leads', { email: emailToSend, prenom: 'Test', nom: 'Email', hotel: 'Test Hotel', segment: '5*' });
          leadId = created.id || created.lead?.id;
        }

        // D'abord, supprimer toute inscription existante pour ce lead
        const existingInscriptions = await api.get(`/sequences/${seq.id}/inscriptions`);
        const oldInscription = existingInscriptions.inscriptions?.find(i => i.lead_id === leadId);
        if (oldInscription) {
          await api.delete(`/sequences/inscriptions/${oldInscription.id}`);
        }

        // Créer une nouvelle inscription à la séquence
        await api.post(`/sequences/${seq.id}/inscrire`, { lead_id: leadId });

        // Attendre un peu pour que l'inscription soit bien créée
        await new Promise(r => setTimeout(r, 500));

        // Récupérer la nouvelle inscription
        const db = await api.get(`/sequences/${seq.id}/inscriptions`);
        const inscription = db.inscriptions?.find(i => i.lead_id === leadId);

        if (inscription) {
          // Mettre à jour l'étape courante pour pointer vers l'email qu'on veut tester
          await api.patch(`/sequences/inscriptions/${inscription.id}`, {
            etape_courante: etapeIndex,
            prochain_envoi: new Date().toISOString()
          });

          // Attendre un peu pour que la mise à jour soit bien appliquée
          await new Promise(r => setTimeout(r, 300));

          // Envoyer SEULEMENT cet email (nouvel endpoint dédié)
          await api.post('/sequences/test-email', { inscription_id: inscription.id });

          window.showToast?.(`Test envoyé à ${emailToSend}`, "success");
        } else {
          throw new Error("Inscription non trouvée");
        }
      } catch(err) {
        console.error(err);
        window.showToast?.('Erreur : ' + (err.message || "impossible d'envoyer le test"), "error");
      } finally {
        // Libérer le verrou après 3 secondes pour permettre un nouveau test
        setTimeout(() => setTestInProgress(false), 3000);
      }
    })();
  };

  const addEtape = () => {
    const lastJour = etapes[etapes.length - 1]?.jour ?? etapes[etapes.length - 1]?.jour_delai ?? 0;
    const nextJour = lastJour + 7;
    setEtapes(e => [...e, { jour: nextJour, jour_delai: nextJour, sujet: "", corps: "" }]);
  };
  const removeEtape = (i) => { if (etapes.length > 1) { setEtapes(e => e.filter((_, idx) => idx !== i)); setActiveEtape(Math.max(0, i-1)); }};
  const moveEtape = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= etapes.length) return;
    setEtapes(e => { const arr = [...e]; [arr[i], arr[j]] = [arr[j], arr[i]]; return arr; });
    setActiveEtape(j);
  };
  const updateEtape = (i, k, v) => setEtapes(e => e.map((et, idx) => {
    if (idx !== i) return et;
    // Garder jour et jour_delai en sync (DB stocke jour_delai, UI utilise jour)
    const extra = k === 'jour' ? { jour_delai: v } : k === 'jour_delai' ? { jour: v } : {};
    return { ...et, [k]: v, ...extra };
  }));

  // Ref stable pour updateEtape (évite closure stale dans le listener TinyMCE)
  const updateEtapeRef = useRef(updateEtape);
  updateEtapeRef.current = updateEtape;

  // Insérer une variable à la position du curseur dans TinyMCE
  const insererVar = (v) => {
    if (tinymceRef.current) {
      tinymceRef.current.insertContent(v);
    }
  };

  // Sync activeEtape ref
  useEffect(() => {
    activeEtapeRef.current = activeEtape;
  }, [activeEtape]);

  // Initialiser TinyMCE editor
  useEffect(() => {
    if (!editorRef.current || tinymceRef.current) return;

    const containerId = 'tinymce-email-editor-' + Date.now();
    editorRef.current.id = containerId;

    tinymce.init({
      selector: '#' + containerId,
      plugins: 'lists link image table code fullscreen',
      toolbar: 'fontfamily fontsize | bold italic underline | blocks | bullist numlist | alignleft aligncenter alignright | link image table | forecolor | removeformat | fullscreen code',
      font_family_formats: 'Arial=Arial,Helvetica,sans-serif; Helvetica=Helvetica,Arial,sans-serif; Verdana=Verdana,Geneva,sans-serif; Georgia=Georgia,serif; Times New Roman=Times New Roman,Times,serif; Courier New=Courier New,monospace; Trebuchet MS=Trebuchet MS,sans-serif; Tahoma=Tahoma,Geneva,sans-serif',
      font_size_formats: '10px 12px 14px 16px 18px 20px 24px 28px 32px',
      menubar: false,
      height: 350,
      content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
      branding: false,
      promotion: false,
      placeholder: 'Écrivez votre email ici...',
      license_key: 'gpl',
      setup: (editor) => {
        editor.on('init', () => {
          tinymceRef.current = editor;
          // Charger le contenu initial
          const etape = etapes[activeEtapeRef.current];
          if (etape?.corps_html) {
            editor.setContent(etape.corps_html);
          }
        });
        const syncContent = () => {
          const html = editor.getContent();
          updateEtapeRef.current(activeEtapeRef.current, 'corps_html', html);
        };
        editor.on('input change keyup', syncContent);
        editor.on('ExecCommand', syncContent);
        editor.on('NodeChange', syncContent);
      }
    });

    return () => {
      if (tinymceRef.current) {
        tinymceRef.current.remove();
        tinymceRef.current = null;
      }
    };
  }, []);

  // Charger le contenu quand on change d'étape
  useEffect(() => {
    if (!tinymceRef.current || mode !== "edit") return;

    const etape = etapes[activeEtape];

    if (etape?.corps_html) {
      tinymceRef.current.setContent(etape.corps_html);
    } else {
      tinymceRef.current.setContent('');
    }

    setPieceJointe(etape?.piece_jointe || null);
  }, [activeEtape, mode]);

  const handleSave = async () => {
    if (!nom.trim()) { setErrMsg("Donnez un nom à la séquence"); return; }
    if (etapes.length === 0) { setErrMsg("Ajoutez au moins un email"); return; }

    setSaving(true); setErrMsg("");
    try {
      const etapesFinales = etapes.map((e, i) => {
        const etape = {
          ...e,
          jour_delai: e.jour_delai ?? e.jour ?? 0,
          corps: e.corps_html || e.corps || "",
        };

        return etape;
      });

      const options = { desabonnement, bcc: bcc.trim() || undefined };
      if (hsLogEmail !== undefined) options.hs_log_email = hsLogEmail;
      if (hsLifecycle !== undefined) options.hs_lifecycle = hsLifecycle;
      if (hsTaskFin !== undefined) options.hs_task_fin_sequence = hsTaskFin;
      await onSave({ id: seq?.id || null, nom, segment, etapes: etapesFinales, leadsActifs: seq?.leadsActifs || 0, options });
      onClose();
    } catch(e) { setErrMsg("Erreur : " + (e.message || "impossible de sauvegarder")); }
    setSaving(false);
  };

  const etapeCourante = etapes[activeEtape] || {};

  // Le corps pour la preview - mémoïsé pour éviter createElement à chaque render
  const corpsPreview = useMemo(() => {
    let html = etapeCourante.corps_html || texteVersHtmlPreview(etapeCourante.corps || "");
    // Détecter et enlever duplication
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const text = tempDiv.textContent || '';
    const half = Math.floor(text.length / 2);
    if (half > 50 && text.substring(half).includes(text.substring(0, 50))) {
      const allNodes = Array.from(tempDiv.childNodes);
      const mid = Math.floor(allNodes.length / 2);
      tempDiv.innerHTML = '';
      allNodes.slice(0, mid).forEach(n => tempDiv.appendChild(n.cloneNode(true)));
      html = tempDiv.innerHTML;
    }
    return html;
  }, [etapeCourante.corps_html, etapeCourante.corps]);

  const VARS = ["{{civilite}}", "{{prenom}}", "{{nom}}", "{{etablissement}}", "{{ville}}", "{{segment}}"];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] md:max-w-4xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-4 flex-shrink-0">
          <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom de la séquence..." className="flex-1 text-base font-semibold text-slate-900 focus:outline-none bg-transparent placeholder-slate-300" />
          <select value={segment} onChange={e => setSegment(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 focus:outline-none">
            {getSegments().map(s => <option key={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={desabonnement} onChange={e => setDesabonnement(e.target.checked)} className="rounded" />
            Désabo
          </label>
          <input type="email" value={bcc} onChange={e => setBcc(e.target.value)} placeholder="BCC (optionnel)" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400 w-40" title="Adresse email en copie cachée pour tous les envois de cette séquence" />
          {/* HubSpot options */}
          <div className="relative">
            <button onClick={() => setShowHsOptions(!showHsOptions)} className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${showHsOptions ? 'bg-orange-50 border-orange-200 text-orange-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`} title="Options HubSpot">
              🔗 HS
            </button>
            {showHsOptions && (
              <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-slate-200 p-4 z-50 w-72" onClick={e => e.stopPropagation()}>
                <div className="text-xs font-semibold text-slate-800 mb-3">Options HubSpot</div>
                <div className="space-y-2.5">
                  {[
                    { key: 'hs_log_email', label: 'Logger les envois', val: hsLogEmail, set: setHsLogEmail },
                    { key: 'hs_lifecycle', label: 'Mettre à jour lifecycle', val: hsLifecycle, set: setHsLifecycle },
                    { key: 'hs_task_fin_sequence', label: 'Tâche fin de séquence', val: hsTaskFin, set: setHsTaskFin },
                  ].map(({ key, label, val, set }) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-xs text-slate-600">{label}</span>
                      <div className="flex items-center gap-1.5">
                        {val === undefined && <span className="text-xs text-slate-400 italic">global</span>}
                        <button onClick={() => set(val === undefined ? true : val ? false : undefined)}
                          className={`relative w-9 h-[18px] rounded-full transition-colors flex-shrink-0 ${val === undefined ? 'bg-slate-200' : val ? 'bg-emerald-500' : 'bg-red-300'}`}>
                          <span className={`absolute top-[1px] w-4 h-4 bg-white rounded-full shadow transition-transform ${val === undefined ? 'translate-x-[9px]' : val ? 'translate-x-[19px]' : 'translate-x-[1px]'}`} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-3 leading-snug">Cliquez pour alterner : activé → désactivé → global (hérite de la config)</p>
              </div>
            )}
          </div>
          {/* Tabs edit/preview */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setMode("edit")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === "edit" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>✏️ Éditer</button>
            <button onClick={() => setMode("preview")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === "preview" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>👁 Préview</button>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Sidebar étapes */}
          <div className="md:w-52 border-b md:border-b-0 md:border-r border-slate-100 p-2 md:p-3 flex md:flex-col gap-1.5 flex-shrink-0 overflow-x-auto md:overflow-y-auto bg-slate-50/50">
            {etapes.map((e, i) => (
              <div key={i} className={`group rounded-lg transition-all ${activeEtape === i ? "bg-gradient-to-br from-slate-900 to-slate-800 shadow-lg" : "hover:bg-white hover:shadow-sm"}`}>
                <button onClick={() => setActiveEtape(i)} className="w-full text-left px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold text-sm ${activeEtape === i ? "text-white" : "text-slate-800"}`}>Email {i + 1}</span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {i > 0 && (
                        <button onClick={(ev) => { ev.stopPropagation(); moveEtape(i, -1); }} className={`text-xs w-5 h-5 rounded flex items-center justify-center ${activeEtape === i ? "text-slate-400 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`}>↑</button>
                      )}
                      {i < etapes.length - 1 && (
                        <button onClick={(ev) => { ev.stopPropagation(); moveEtape(i, 1); }} className={`text-xs w-5 h-5 rounded flex items-center justify-center ${activeEtape === i ? "text-slate-400 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`}>↓</button>
                      )}
                      {etapes.length > 1 && (
                        <button onClick={(ev) => { ev.stopPropagation(); removeEtape(i); }} className={`text-xs w-5 h-5 rounded flex items-center justify-center ${activeEtape === i ? "text-slate-400 hover:text-red-300 hover:bg-white/10" : "text-slate-400 hover:text-red-500 hover:bg-red-50"}`}>✕</button>
                      )}
                    </div>
                  </div>
                  <div className={`text-xs ${activeEtape === i ? "text-slate-300" : "text-slate-500"}`}>
                    <span className="font-medium">J+{e.jour || 0}</span> · {e.sujet ? e.sujet.substring(0, 25) + (e.sujet.length > 25 ? '...' : '') : 'Sans objet'}
                  </div>
                  {e.piece_jointe && <div className={`text-xs mt-1 ${activeEtape === i ? "text-amber-300" : "text-amber-600"}`}>📎 Pièce jointe</div>}
                </button>
                {seq?.id && (
                  <button
                    onClick={() => { if (!testInProgress) { setActiveEtape(i); setShowTestModal(true); } }}
                    disabled={testInProgress}
                    className={`w-full px-3 py-1.5 text-xs font-medium transition-colors border-t disabled:opacity-50 disabled:cursor-not-allowed ${activeEtape === i ? "border-slate-700 text-blue-300 hover:bg-white/10" : "border-slate-100 text-blue-600 hover:bg-blue-50"}`}
                  >
                    {testInProgress ? "⏳ Envoi..." : "⚡ Tester cet email"}
                  </button>
                )}
              </div>
            ))}
            <button onClick={addEtape} className="w-full px-3 py-3 rounded-lg text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-700 hover:shadow-sm transition-all border-2 border-dashed border-slate-200 hover:border-slate-300 mt-1">
              + Ajouter un email
            </button>
          </div>

          {/* Zone principale */}
          <div className="flex-1 overflow-y-auto">
            {mode === "edit" ? (
              <div className="p-5 space-y-4">
                {/* Délai + Objet */}
                <div className="flex gap-4 items-end">
                  <div className="w-32 flex-shrink-0">
                    <label className="text-xs font-medium text-slate-500 mb-1 block">Délai</label>
                    <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-2 bg-white">
                      <span className="text-xs text-slate-400">J+</span>
                      <input type="number" min="0" value={etapeCourante.jour || 0} onChange={e => updateEtape(activeEtape, "jour", +e.target.value)} className="w-10 text-sm font-medium text-slate-800 focus:outline-none bg-transparent" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-medium text-slate-500 mb-1 block">Objet de l'email</label>
                    <input
                      ref={objetRef}
                      value={etapeCourante.sujet || ""}
                      onChange={e => updateEtape(activeEtape, "sujet", e.target.value)}
                      placeholder="Ex: Découvrez Terre de Mars — {{etablissement}}"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                    />
                    <div className="flex items-center gap-0.5 mt-1">
                      {VARS.map(v => (
                        <button key={v} type="button" onClick={() => {
                          const input = objetRef.current;
                          if (!input) return;
                          const pos = input.selectionStart;
                          const val = etapeCourante.sujet || "";
                          updateEtape(activeEtape, "sujet", val.slice(0, pos) + v + val.slice(pos));
                          setTimeout(() => input.setSelectionRange(pos + v.length, pos + v.length), 0);
                        }} className="px-1 py-px bg-amber-50 hover:bg-amber-100 text-amber-700 text-[10px] rounded font-mono transition-colors border border-amber-200 leading-tight">{v.replace(/\{\{|\}\}/g, '')}</button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowTemplateSelector(true)}
                        className="ml-auto px-2 py-px bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] rounded font-medium transition-colors border border-blue-200 leading-tight"
                      >
                        📝 Template
                      </button>
                    </div>
                  </div>
                </div>

                {/* TinyMCE Editor */}
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div ref={editorRef} className="bg-white"></div>
                  <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50/30 flex items-center gap-1">
                    <span className="text-xs text-slate-400 mr-1">Variables :</span>
                    {VARS.map(v => (
                      <button key={v} type="button" onClick={() => {
                        if (tinymceRef.current) {
                          tinymceRef.current.insertContent(v);
                        }
                      }} className="px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs rounded font-mono transition-colors border border-amber-200">{v}</button>
                    ))}
                  </div>
                  {/* Pièce jointe */}
                  <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
                    {etapeCourante.piece_jointe ? (
                      <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <span className="text-base">📎</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-slate-700 truncate">{etapeCourante.piece_jointe.nom || 'Fichier'}</div>
                          <div className="text-xs text-slate-400">
                            {etapeCourante.piece_jointe.taille ? `${Math.round(etapeCourante.piece_jointe.taille / 1024)} ko` : 'Taille inconnue'}
                          </div>
                        </div>
                        <button onClick={() => setPjEtape(null)} className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 hover:bg-red-50 rounded transition-colors">
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => pjRef.current?.click()} className="w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors py-2 rounded-lg border border-dashed border-slate-200">
                        <span>📎</span> Ajouter une pièce jointe
                      </button>
                    )}
                    <input ref={pjRef} type="file" className="hidden" onChange={e => chargerPj(e.target.files?.[0])} />
                  </div>
                  {/* Signature en bas, non éditable */}
                  <div className="px-4 pb-4 pt-2 border-t border-slate-100">
                    <div className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
                      <span className="w-4 h-px bg-slate-200 inline-block" />
                      Signature automatique
                      <span className="w-4 h-px bg-slate-200 inline-block" />
                    </div>
                    <div dangerouslySetInnerHTML={{ __html: getSignatureHtml() }} style={{ pointerEvents: "none", opacity: 0.7 }} />
                  </div>
                </div>
              </div>
            ) : (
              /* MODE PREVIEW */
              <div className="p-5">
                <div className="bg-slate-50 rounded-xl p-4 mb-4 border border-slate-200">
                  <div className="text-xs text-slate-400 mb-1">Objet</div>
                  <div className="text-sm font-medium text-slate-800" dangerouslySetInnerHTML={{ __html: substituerVarsPreview(etapeCourante.sujet || "") }} />
                </div>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center gap-2">
                    <span className="text-xs text-slate-500">De :</span>
                    <span className="text-xs font-medium text-slate-700">Hugo Montiel &lt;hugo@terredemars.com&gt;</span>
                    <span className="ml-auto text-xs text-slate-400">À : Sophie Lefebvre &lt;sophie@bristol.fr&gt;</span>
                  </div>
                  <div className="p-6">
                    <div
                      className="text-sm leading-relaxed text-slate-800"
                      style={{ fontFamily: "Arial, sans-serif" }}
                      dangerouslySetInnerHTML={{ __html: substituerVarsPreview(corpsPreview) }}
                    />
                    <div className="mt-4 pt-4 border-t border-slate-100" dangerouslySetInnerHTML={{ __html: getSignatureHtml() }} />
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-3 text-center">Les variables surlignées en jaune seront remplacées par les vraies données du lead</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-slate-400">{etapes.length} email{etapes.length > 1 ? "s" : ""} · Signature incluse automatiquement</div>
          <div className="flex items-center gap-3">
            {errMsg && <span className="text-xs text-red-500">{errMsg}</span>}
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">
              {saving ? "Sauvegarde..." : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>

      {/* Modal de test pour un email spécifique */}
      {showTestModal && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={e => e.stopPropagation()}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-2">Tester l'email {activeEtape + 1}</h3>
            <p className="text-xs text-slate-500 mb-4">Cet email sera envoyé immédiatement à l'adresse indiquée.</p>
            <input
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && envoyerTestEmail()}
              placeholder="email@test.com"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowTestModal(false); setTestEmail(""); }} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
                Annuler
              </button>
              <button onClick={envoyerTestEmail} disabled={testLoading || !testEmail.trim()} className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {testLoading ? "Envoi..." : "⚡ Envoyer le test"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal sélection template */}
      {showTemplateSelector && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={e => e.stopPropagation()}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <h3 className="text-base font-semibold text-slate-900">Choisir un template</h3>
              <button onClick={() => setShowTemplateSelector(false)} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {templates.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-3">📝</div>
                  <p className="text-sm text-slate-500">Aucun template disponible</p>
                  <p className="text-xs text-slate-400 mt-1">Créez-en un dans l'onglet Templates</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {templates.map(template => (
                    <div
                      key={template.id}
                      onClick={() => applyTemplate(template)}
                      className="bg-white rounded-lg border border-slate-200 p-4 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {template.nom}
                        </h4>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">
                          {template.categorie}
                        </span>
                      </div>

                      <div className="mb-3">
                        <div className="text-xs text-slate-500 mb-0.5">Sujet :</div>
                        <div className="text-xs text-slate-700 font-medium line-clamp-1">
                          {template.sujet}
                        </div>
                      </div>

                      {template.tags && template.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {template.tags.slice(0, 3).map((tag, i) => (
                            <span key={i} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-xs rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end flex-shrink-0">
              <button
                onClick={() => setShowTemplateSelector(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialogEl}
    </div>
  );
};

// ─── VUES ─────────────────────────────────────────────────────────────────────

const VueDashboard = ({ showToast }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dashboard');
      setData(res);
    } catch (err) {
      showToast?.('Erreur chargement dashboard: ' + err.message, 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(() => { if (!document.hidden) loadDashboard(); }, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Chargement du dashboard...</p>
        </div>
      </div>
    );
  }

  const { stats, prochainsEnvois, quota, activite, erreurs, topSequences } = data;
  const ICONS = { envoi: "📧", ouverture: "👁", clic: "🔗", desabonnement: "🚫" };

  const quotaPct = (quota.utilise / quota.max) * 100;
  const quotaColor = quotaPct >= 90 ? 'bg-red-500' : quotaPct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border border-blue-200 p-4">
          <div className="text-xs font-medium text-blue-600 mb-1 uppercase tracking-wide">Leads Actifs</div>
          <div className="text-2xl font-bold text-blue-900">{stats.leadsActifs}</div>
          <div className="text-sm text-blue-700 mt-1">Disponibles</div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border border-purple-200 p-4">
          <div className="text-xs font-medium text-purple-600 mb-1 uppercase tracking-wide">En Séquence</div>
          <div className="text-2xl font-bold text-purple-900">{stats.leadsEnSequence}</div>
          <div className="text-sm text-purple-700 mt-1">Inscrits actifs</div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl border border-emerald-200 p-4">
          <div className="text-xs font-medium text-emerald-600 mb-1 uppercase tracking-wide">Cette Semaine</div>
          <div className="text-2xl font-bold text-emerald-900">{stats.emailsSemaine}</div>
          <div className="text-sm text-emerald-700 mt-1">Emails envoyés</div>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl border border-amber-200 p-4">
          <div className="text-xs font-medium text-amber-600 mb-1 uppercase tracking-wide">Taux Ouverture</div>
          <div className={`text-2xl font-bold ${stats.tauxOuverture >= 40 ? 'text-emerald-600' : stats.tauxOuverture >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
            {Math.round(stats.tauxOuverture)}%
          </div>
          <div className="text-sm text-amber-700 mt-1">30 derniers jours</div>
        </div>

        <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-600 mb-1 uppercase tracking-wide">Séquences</div>
          <div className="text-2xl font-bold text-slate-900">{stats.sequencesActives}</div>
          <div className="text-sm text-slate-700 mt-1">Actives</div>
        </div>
      </div>

      {/* Quota du jour */}
      <div className="bg-white rounded-xl border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-800">Quota d'envoi du jour</h3>
          <span className="text-xs text-slate-500">{quota.utilise} / {quota.max} emails</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
          <div className={`h-full ${quotaColor} transition-all duration-300`} style={{ width: `${Math.min(quotaPct, 100)}%` }} />
        </div>
        {quotaPct >= 90 && (
          <p className="text-xs text-red-600 mt-2">⚠️ Quota presque atteint ! Les envois seront limités.</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Prochains envois */}
        <div className="bg-white rounded-xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-800">Prochains envois</h3>
            <button onClick={loadDashboard} className="text-xs text-blue-600 hover:text-blue-700">
              🔄 Actualiser
            </button>
          </div>
          <div className="space-y-2.5 max-h-80 overflow-y-auto">
            {prochainsEnvois.map((envoi, i) => {
              const prochainDate = parseParis(envoi.prochain_envoi);
              const isPast = prochainDate < new Date();
              return (
                <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg ${isPast ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-900 truncate">
                      {envoi.prenom} {envoi.nom}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{envoi.hotel}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {envoi.sequence_nom} · Étape {envoi.etape_courante + 1}/{envoi.nb_etapes}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-xs font-medium ${isPast ? 'text-amber-600' : 'text-slate-600'}`}>
                      {prochainDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </div>
                    <div className="text-xs text-slate-400">
                      {prochainDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
            {prochainsEnvois.length === 0 && (
              <p className="text-xs text-slate-300 italic text-center py-4">Aucun envoi planifié</p>
            )}
          </div>
        </div>

        {/* Activité récente */}
        <div className="bg-white rounded-xl border border-slate-100 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Activité récente</h3>
          <div className="space-y-2.5 max-h-80 overflow-y-auto">
            {activite.map((a, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-sm leading-none mt-0.5 flex-shrink-0">{ICONS[a.type] || "📌"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-700 leading-snug truncate">
                    <span className="font-medium">{a.prenom} {a.nom}</span>
                    {a.type === "envoi" && " — email envoyé"}
                    {a.type === "ouverture" && " a ouvert"}
                    {a.type === "clic" && " a cliqué"}
                    {a.type === "desabonnement" && " s'est désabonné"}
                  </p>
                  {a.sujet && <p className="text-xs text-slate-400 truncate italic">{a.sujet}</p>}
                  <p className="text-xs text-slate-300">{relTime(a.created_at)}</p>
                </div>
              </div>
            ))}
            {activite.length === 0 && <p className="text-xs text-slate-300 italic text-center py-4">Aucune activité</p>}
          </div>
        </div>
      </div>

      {/* Top séquences */}
      {topSequences.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Top séquences actives</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-400 uppercase">
                  <th className="text-left py-2 pr-4">Séquence</th>
                  <th className="text-right py-2 px-3">Inscrits</th>
                  <th className="text-right py-2 px-3">Emails</th>
                  <th className="text-right py-2 px-3">Ouvertures</th>
                  <th className="text-right py-2 px-3">Taux</th>
                </tr>
              </thead>
              <tbody>
                {topSequences.map((s, i) => {
                  const tauxOuv = s.total_emails > 0 ? (s.total_ouvertures / s.total_emails) * 100 : 0;
                  return (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2 pr-4 font-medium text-slate-800">{s.nom}</td>
                      <td className="py-2 px-3 text-right text-blue-600 font-medium">{s.inscrits_actifs}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{s.total_emails}</td>
                      <td className="py-2 px-3 text-right text-slate-600">{s.total_ouvertures}</td>
                      <td className="py-2 px-3 text-right">
                        <span className={`font-semibold ${tauxOuv >= 40 ? 'text-emerald-600' : tauxOuv >= 20 ? 'text-amber-600' : 'text-slate-400'}`}>
                          {Math.round(tauxOuv)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Erreurs récentes */}
      {erreurs.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-red-800 mb-3">⚠️ Erreurs récentes (7 derniers jours)</h3>
          <div className="space-y-2">
            {erreurs.map((err, i) => (
              <div key={i} className="bg-white rounded-lg p-3 border border-red-100">
                <div className="text-xs font-medium text-slate-900">{err.sujet}</div>
                <div className="text-xs text-red-600 mt-1">{err.erreur}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {parseUTC(err.envoye_at).toLocaleString('fr-FR')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── DASHBOARD MARKETING ──────────────────────────────────────────────────────
const VueDashboardMarketing = ({ showToast }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dashboard/marketing');
      setData(res);
    } catch (err) {
      showToast?.('Erreur chargement dashboard marketing: ' + err.message, 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => { if (!document.hidden) loadData(); }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Chargement du dashboard marketing...</p>
        </div>
      </div>
    );
  }

  const { stats, topCampagnes, campagnesEnCours } = data;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl border border-indigo-200 p-4">
          <div className="text-xs font-medium text-indigo-600 mb-1 uppercase tracking-wide">Campagnes Terminées</div>
          <div className="text-2xl font-bold text-indigo-900">{stats.campaignesTerminees}</div>
          <div className="text-sm text-indigo-700 mt-1">Total</div>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border border-blue-200 p-4">
          <div className="text-xs font-medium text-blue-600 mb-1 uppercase tracking-wide">En Cours</div>
          <div className="text-2xl font-bold text-blue-900">{stats.campaignesEnCours}</div>
          <div className="text-sm text-blue-700 mt-1">Actives</div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl border border-emerald-200 p-4">
          <div className="text-xs font-medium text-emerald-600 mb-1 uppercase tracking-wide">Emails 30j</div>
          <div className="text-2xl font-bold text-emerald-900">{stats.emailsMarketing30j}</div>
          <div className="text-sm text-emerald-700 mt-1">Marketing envoyés</div>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl border border-amber-200 p-4">
          <div className="text-xs font-medium text-amber-600 mb-1 uppercase tracking-wide">Taux Ouverture</div>
          <div className={`text-2xl font-bold ${stats.tauxOuverture >= 40 ? 'text-emerald-600' : stats.tauxOuverture >= 20 ? 'text-amber-600' : 'text-red-600'}`}>
            {stats.tauxOuverture}%
          </div>
          <div className="text-sm text-amber-700 mt-1">30 derniers jours</div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border border-purple-200 p-4">
          <div className="text-xs font-medium text-purple-600 mb-1 uppercase tracking-wide">Taux Clic</div>
          <div className={`text-2xl font-bold ${stats.tauxClic >= 10 ? 'text-emerald-600' : stats.tauxClic >= 3 ? 'text-amber-600' : 'text-red-600'}`}>
            {stats.tauxClic}%
          </div>
          <div className="text-sm text-purple-700 mt-1">30 derniers jours</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Campagnes en cours */}
        {campagnesEnCours.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Campagnes en cours</h3>
              <button onClick={loadData} className="text-xs text-blue-600 hover:text-blue-700">Actualiser</button>
            </div>
            <div className="space-y-3">
              {campagnesEnCours.map(c => (
                <div key={c.id} className="bg-slate-50 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-medium text-slate-800">{c.nom}</span>
                    <span className="text-[10px] text-slate-400">{c.sent_count}/{c.total_recipients}</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all duration-300 rounded-full" style={{ width: `${c.progression}%` }} />
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">{c.progression}% terminé</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top campagnes */}
        <div className={`bg-white rounded-xl border border-slate-100 p-5 ${campagnesEnCours.length === 0 ? 'lg:col-span-2' : ''}`}>
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Dernières campagnes terminées</h3>
          {topCampagnes.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Aucune campagne terminée</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left py-2 px-2 font-medium">Campagne</th>
                    <th className="text-left py-2 px-2 font-medium">Date</th>
                    <th className="text-right py-2 px-2 font-medium">Envoyés</th>
                    <th className="text-right py-2 px-2 font-medium">Ouvertures</th>
                    <th className="text-right py-2 px-2 font-medium">Clics</th>
                  </tr>
                </thead>
                <tbody>
                  {topCampagnes.map(c => (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="py-2 px-2 font-medium text-slate-800 truncate max-w-[200px]">{c.nom}</td>
                      <td className="py-2 px-2 text-slate-500">{c.completed_at ? parseUTC(c.completed_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—'}</td>
                      <td className="py-2 px-2 text-right text-slate-700">{c.sent_count}</td>
                      <td className="py-2 px-2 text-right">
                        <span className={`font-medium ${c.open_rate >= 40 ? 'text-emerald-600' : c.open_rate >= 20 ? 'text-amber-600' : 'text-slate-500'}`}>{c.open_rate}%</span>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className={`font-medium ${c.click_rate >= 10 ? 'text-emerald-600' : c.click_rate >= 3 ? 'text-amber-600' : 'text-slate-500'}`}>{c.click_rate}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Modal édition lead ────────────────────────────────────────────────────
const ModalEditLead = ({ lead, onClose, onSave, campaigns = [], sequences = [] }) => {
  useEscapeClose(onClose);
  const [form, setForm] = useState({ prenom: lead.prenom||"", nom: lead.nom||"", email: lead.email||"", hotel: lead.hotel||"", ville: lead.ville||"", segment: lead.segment||"5*", statut: lead.statut||"Nouveau", poste: lead.poste||"", langue: lead.langue||"fr", campaign: lead.campaign||"", comment: lead.comment||"", source: lead.source||"", civilite: lead.civilite||"" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [showCampaignDropdown, setShowCampaignDropdown] = useState(false);
  const campaignRef = useRef(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const handleSave = async () => {
    if (!form.email || !form.hotel) { setErr("Email et établissement requis"); return; }
    setSaving(true);
    try {
      await api.patch(`/leads/${lead.id}`, form);
      onSave();
    } catch(e) { setErr(e.message); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-900">Modifier le lead</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 space-y-3 overflow-y-auto flex-1">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">Civilité</label>
            <select value={form.civilite} onChange={e => set("civilite", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
              <option value="">—</option>
              {["M.", "Mme", "Dr", "Pr", "Maître"].map(c => <option key={c} value={c}>{c}</option>)}
            </select></div>
            {[["Prénom","prenom"],["Nom","nom"]].map(([l,k]) => (
              <div key={k}><label className="text-xs text-slate-500 mb-1 block">{l}</label>
              <input value={form[k]} onChange={e => set(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" /></div>
            ))}
          </div>
          {[["Email","email"],["Établissement","hotel"],["Ville","ville"],["Poste / Fonction","poste"]].map(([l,k]) => (
            <div key={k}><label className="text-xs text-slate-500 mb-1 block">{l}</label>
            <input value={form[k]} onChange={e => set(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" /></div>
          ))}
          <div className="relative" ref={campaignRef}>
            <label className="text-xs text-slate-500 mb-1 block">Campaign</label>
            <input
              value={form.campaign}
              onChange={e => { set("campaign", e.target.value); setShowCampaignDropdown(true); }}
              onFocus={() => setShowCampaignDropdown(true)}
              placeholder="Sélectionner ou saisir une campagne..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
            {showCampaignDropdown && (() => {
              const allOptions = [...new Set([...campaigns, ...sequences.map(s => s.nom)])].sort();
              const filtered = allOptions.filter(o => !form.campaign || o.toLowerCase().includes(form.campaign.toLowerCase()));
              if (filtered.length === 0) return null;
              return (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filtered.map(opt => (
                    <button key={opt} type="button" onClick={() => { set("campaign", opt); setShowCampaignDropdown(false); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 truncate">
                      {opt}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Source</label>
            <input
              list="source-suggestions-edit"
              value={form.source}
              onChange={e => set("source", e.target.value)}
              placeholder="Sélectionner ou saisir..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
            <datalist id="source-suggestions-edit">
              {["Site web", "LinkedIn", "HubSpot", "Import CSV", "Salon", "Recommandation", "Partenaire"].map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Commentaire</label>
            <textarea
              value={form.comment}
              onChange={e => set("comment", e.target.value)}
              placeholder="Notes, contexte, remarques..."
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">Segment</label>
            <select value={form.segment} onChange={e => set("segment", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              {getSegments().map(s => <option key={s}>{s}</option>)}
            </select></div>
            <div><label className="text-xs text-slate-500 mb-1 block">Statut</label>
            <select value={form.statut} onChange={e => set("statut", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              {Object.keys(STATUT_CONFIG).map(s => <option key={s}>{s}</option>)}
            </select></div>
            <div><label className="text-xs text-slate-500 mb-1 block">Langue</label>
            <select value={form.langue} onChange={e => set("langue", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="fr">🇫🇷 FR</option>
              <option value="en">🇬🇧 EN</option>
              <option value="de">🇩🇪 DE</option>
              <option value="es">🇪🇸 ES</option>
              <option value="it">🇮🇹 IT</option>
            </select></div>
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3 flex-shrink-0 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Annuler</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50">{saving ? "Sauvegarde..." : "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
};

// ─── Modal bulk (lancer séquence sur plusieurs leads) ───────────────────────
const ModalBulkLaunch = ({ count, sequences, onClose, onLaunch }) => {
  useEscapeClose(onClose);
  const [selected, setSelected] = useState(sequences[0]?.id);
  const [taskRelance, setTaskRelance] = useState(0);
  const [status, setStatus] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const handleLaunch = async (sendNow) => {
    if (!selected) return;
    setStatus("loading");
    try {
      await onLaunch(selected, sendNow, taskRelance);
      setStatus("done");
      setTimeout(() => onClose(), 1200);
    } catch(e) { setStatus("error"); setErrMsg(e.message || "Erreur"); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Lancer une séquence</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-sm text-slate-500 mb-4"><span className="font-semibold text-slate-800">{count} leads</span> seront inscrits à la séquence sélectionnée.</p>
          <div className="space-y-2">
            {sequences.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Aucune séquence disponible. Créez-en une d'abord.</p>}
            {sequences.map(seq => (
              <label key={seq.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${selected === seq.id ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
                <input type="radio" name="bseq" value={seq.id} checked={selected === seq.id} onChange={() => setSelected(seq.id)} className="accent-blue-600" />
                <div>
                  <div className="text-sm font-medium text-slate-800">{seq.nom}</div>
                  <div className="text-xs text-slate-400">{seq.etapes?.length || 0} emails · {seq.segment}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Task de relance HubSpot</label>
            <select value={taskRelance} onChange={e => setTaskRelance(Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 bg-white">
              <option value={0}>Pas de relance</option>
              <option value={3}>Dans 3 mois</option>
              <option value={6}>Dans 6 mois</option>
              <option value={9}>Dans 9 mois</option>
              <option value={12}>Dans 12 mois</option>
            </select>
          </div>
          {status === "done" && <p className="mt-3 text-xs text-emerald-600 font-medium">✓ Séquence lancée pour {count} leads !</p>}
          {status === "error" && <p className="mt-3 text-xs text-red-500">✗ {errMsg}</p>}
        </div>
        <div className="px-6 py-4 bg-slate-50 flex flex-col gap-2 flex-shrink-0 border-t border-slate-100">
          <button disabled={!selected || status === "loading" || status === "done"} onClick={() => handleLaunch(true)} className="w-full py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">⚡ Envoyer le 1er email maintenant</button>
          <button disabled={!selected || status === "loading" || status === "done"} onClick={() => handleLaunch(false)} className="w-full py-2.5 text-sm font-medium bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">📅 Lancer (prochain créneau)</button>
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 text-center pt-1">Annuler</button>
        </div>
      </div>
    </div>
  );
};

const VueLeads = ({ leads, sequences, onAdd, onLaunch, onRefresh, showToast }) => {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState("Tous");
  const [filterSegment, setFilterSegment] = useState("Tous");
  const [filterVille, setFilterVille] = useState("Tous");
  const [filterLangue, setFilterLangue] = useState("Tous");
  const [filterCampaign, setFilterCampaign] = useState("Tous");
  const [filterTag, setFilterTag] = useState("Tous");
  const [filterSource, setFilterSource] = useState("Tous");
  const [sortBy, setSortBy] = useState("recent"); // "recent"|"score"|"nom"
  const [sortColumn, setSortColumn] = useState(null); // colonne active pour tri
  const [sortDirection, setSortDirection] = useState("asc"); // "asc"|"desc"
  const [vueMode, setVueMode] = useState("liste"); // "liste"|"kanban"
  const [selectedLead, setSelectedLead] = useState(null);
  const [editLead, setEditLead] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showLaunch, setShowLaunch] = useState(null);
  const [triggerStatus, setTriggerStatus] = useState(null);
  const [importStatus, setImportStatus] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkLaunch, setShowBulkLaunch] = useState(false);
  const [hsDetails, setHsDetails] = useState(null);
  const [loadingHs, setLoadingHs] = useState(false);
  const [hsLeadLogs, setHsLeadLogs] = useState([]);
  const [detailData, setDetailData] = useState(null);     // détail complet lead (emails + events)
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState('timeline'); // 'timeline' | 'emails' | 'hubspot'
  const [showTooltip, setShowTooltip] = useState(null);   // "csv" | "sync" | "trigger" | null
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const csvRef = useRef(null);

  const toggleTooltip = (key, e) => {
    if (showTooltip === key) { setShowTooltip(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ top: rect.bottom + 6, left: Math.max(8, rect.left - 100) });
    setShowTooltip(key);
  };

  // Fermer le popover au clic en dehors
  useEffect(() => {
    if (!showTooltip) return;
    const close = (e) => {
      if (!e.target.closest('[data-info-popup]') && !e.target.closest('[data-info-popover]')) setShowTooltip(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showTooltip]);

  // État pour les largeurs de colonnes redimensionnables
  const [columnWidths, setColumnWidths] = useState(() => {
    const saved = localStorage.getItem('leadTableColumnWidths');
    const defaults = {
      checkbox: 32,
      contact: 200,
      hotel: 200,
      langue: 60,
      campaign: 130,
      sequence: 110,
      source: 100,
      tags: 120,
      infos: 50,
      statut: 120,
      actions: 130
    };
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaults, ...parsed };
    }
    return defaults;
  });
  const resizeRef = useRef({ isResizing: false, column: null, startX: 0, startWidth: 0 });

  // Sauvegarder les largeurs dans localStorage
  useEffect(() => {
    localStorage.setItem('leadTableColumnWidths', JSON.stringify(columnWidths));
  }, [columnWidths]);

  // Gestionnaire de début de redimensionnement
  const handleResizeStart = (e, column) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      isResizing: true,
      column,
      startX: e.clientX,
      startWidth: columnWidths[column]
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // Gestionnaire de mouvement
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!resizeRef.current.isResizing) return;
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.max(50, resizeRef.current.startWidth + delta);
      setColumnWidths(prev => ({
        ...prev,
        [resizeRef.current.column]: newWidth
      }));
    };

    const handleMouseUp = () => {
      if (resizeRef.current.isResizing) {
        resizeRef.current.isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── Helpers extraits ────────────────────────────────────────────────
  const arreterSequence = async (lead) => {
    if (!await confirmDialog(`Arrêter la séquence pour ${lead.prenom} ${lead.nom} ?`, { danger: true, confirmLabel: 'Arrêter' })) return;
    try {
      await api.post(`/sequences/stop-lead/${lead.id}`);
      showToast('Séquence arrêtée', 'success');
      if (onRefresh) onRefresh();
      if (selectedLead?.id === lead.id) setSelectedLead(null);
    } catch(e) { showToast(e.message || 'Erreur', 'error'); }
  };

  const leadsNorm = useMemo(() => leads.map(l => ({
    ...l,
    tags: parseTags(l.tags),
    ouvertures: l.total_ouvertures || l.ouvertures || 0,
    score: l.score || 50,
    sequence: l.sequence_active || l.sequence || "",
    etape: l.etape_courante || l.etape || 0,
    statut: l.statut || "Nouveau",
  })), [leads]);

  const villes = useMemo(() => ["Tous", ...Array.from(new Set(leadsNorm.map(l => l.ville).filter(Boolean))).sort()], [leadsNorm]);
  const segments = useMemo(() => ["Tous", ...Array.from(new Set(leadsNorm.map(l => l.segment).filter(Boolean))).sort()], [leadsNorm]);
  const langues = useMemo(() => ["Tous", ...Array.from(new Set(leadsNorm.map(l => l.langue).filter(Boolean))).sort()], [leadsNorm]);
  const campaigns = useMemo(() => ["Tous", ...Array.from(new Set(leadsNorm.map(l => l.campaign).filter(Boolean))).sort()], [leadsNorm]);
  const sources = useMemo(() => ["Tous", ...Array.from(new Set(leadsNorm.map(l => l.source).filter(Boolean))).sort()], [leadsNorm]);
  const statuts = ["Tous", ...Object.keys(STATUT_CONFIG)];
  const allTags = useMemo(() => {
    const tagSet = new Set();
    leadsNorm.forEach(l => (l.tags || []).forEach(t => {
      // Extraire le préfixe (ex: "Séquence: xxx (date)" -> "Séquence")
      const prefix = t.split(':')[0]?.trim();
      if (prefix) tagSet.add(prefix);
    }));
    return ["Tous", ...Array.from(tagSet).sort()];
  }, [leadsNorm]);

  const handleColumnSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    setSortBy(null); // Désactiver le tri par dropdown
  };

  const filtered = useMemo(() => leadsNorm.filter(l => {
    const matchSearch = `${l.prenom} ${l.nom} ${l.hotel} ${l.ville} ${l.email} ${l.campaign||""} ${l.source||""} ${l.statut||""} ${l.civilite||""} ${l.poste||""}`.toLowerCase().includes(search.toLowerCase());
    const matchStatut = filterStatut === "Tous" || l.statut === filterStatut;
    const matchSegment = filterSegment === "Tous" || l.segment === filterSegment;
    const matchVille = filterVille === "Tous" || l.ville === filterVille;
    const matchLangue = filterLangue === "Tous" || l.langue === filterLangue;
    const matchCampaign = filterCampaign === "Tous" || l.campaign === filterCampaign;
    const matchTag = filterTag === "Tous" || (l.tags || []).some(t => t.startsWith(filterTag + ':'));
    const matchSource = filterSource === "Tous" || l.source === filterSource;
    return matchSearch && matchStatut && matchSegment && matchVille && matchLangue && matchCampaign && matchTag && matchSource;
  }).sort((a, b) => {
    // Tri par colonne (prioritaire)
    if (sortColumn) {
      let aVal, bVal;
      if (sortColumn === "nom") {
        aVal = `${a.nom} ${a.prenom}`.toLowerCase();
        bVal = `${b.nom} ${b.prenom}`.toLowerCase();
      } else if (sortColumn === "hotel") {
        aVal = (a.hotel || "").toLowerCase();
        bVal = (b.hotel || "").toLowerCase();
      } else if (sortColumn === "ville") {
        aVal = (a.ville || "").toLowerCase();
        bVal = (b.ville || "").toLowerCase();
      } else if (sortColumn === "langue") {
        aVal = (a.langue || "").toLowerCase();
        bVal = (b.langue || "").toLowerCase();
      } else if (sortColumn === "score") {
        aVal = a.score || 0;
        bVal = b.score || 0;
      } else if (sortColumn === "statut") {
        aVal = (a.statut || "").toLowerCase();
        bVal = (b.statut || "").toLowerCase();
      } else if (sortColumn === "campaign") {
        aVal = (a.campaign || "").toLowerCase();
        bVal = (b.campaign || "").toLowerCase();
      } else if (sortColumn === "sequence") {
        aVal = (a.sequence_active || a.sequence || "").toLowerCase();
        bVal = (b.sequence_active || b.sequence || "").toLowerCase();
      } else if (sortColumn === "source") {
        aVal = (a.source || "").toLowerCase();
        bVal = (b.source || "").toLowerCase();
      }

      const comparison = typeof aVal === "number" ? aVal - bVal : aVal.localeCompare(bVal);
      return sortDirection === "asc" ? comparison : -comparison;
    }
    // Tri par dropdown (ancien système)
    if (sortBy === "score") return (b.score||0) - (a.score||0);
    if (sortBy === "nom") return `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`);
    return 0; // recent = ordre API
  }), [leadsNorm, search, filterStatut, filterSegment, filterVille, filterLangue, filterCampaign, filterTag, filterSource, sortColumn, sortDirection, sortBy]);

  const KANBAN_COLS = useMemo(() => ["Nouveau", "En séquence", "Répondu", "Converti", "Fin de séquence", "Closed Lost", "Désabonné"], []);

  // ── Import CSV ──────────────────────────────────────────────────────────
  const importerCSV = async (file) => {
    if (!file) return;
    setImportStatus("⟳ Import...");
    const text = await file.text();
    const lines = text.trim().split(/\r?\n/);
    const sep = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
    const toImport = lines.slice(1).map(line => {
      const vals = line.split(sep).map(v => v.trim().replace(/"/g, ""));
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
      return {
        prenom: obj.prenom || obj.firstname || obj["prenom"] || "",
        nom: obj.nom || obj.lastname || obj["nom"] || "",
        email: obj.email || "",
        hotel: obj.hotel || obj.company || obj.etablissement || obj["etablissement"] || obj.societe || "",
        ville: obj.ville || obj.city || "",
        segment: obj.segment || "5*",
        poste: obj.poste || obj.position || obj.title || obj.job || "",
        langue: obj.langue || obj.language || obj.lang || "fr",
        civilite: obj.civilite || obj.salutation || "",
        source: obj.source || "Import CSV",
      };
    }).filter(l => l.email && l.hotel);
    try {
      const r = await api.post("/leads/import", { leads: toImport });
      setImportStatus(`✓ ${r.crees} importés`);
      showToast(`${r.crees} lead(s) importés, ${r.ignores || 0} ignoré(s)`, 'success');
      if (onRefresh) onRefresh();
    } catch(e) { setImportStatus("✗ Erreur"); showToast('Erreur import CSV', 'error'); }
    setTimeout(() => setImportStatus(null), 4000);
    if (csvRef.current) csvRef.current.value = "";
  };

  // ── Actions lead ────────────────────────────────────────────────────────
  const supprimerLead = async (lead, e) => {
    if (e) e.stopPropagation();
    if (!await confirmDialog(`Supprimer ${lead.prenom} ${lead.nom} (${lead.hotel}) ?`, { danger: true, confirmLabel: 'Supprimer' })) return;
    try {
      const result = await api.delete(`/leads/${lead.id}`);
      if (result?.erreur) {
        showToast(`Erreur : ${result.erreur}`, "error");
        return;
      }
      if (selectedLead?.id === lead.id) setSelectedLead(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Erreur suppression lead:', err);
      showToast(`Impossible de supprimer le lead : ${err.message}`, "error");
    }
  };

  const changerStatut = async (lead, statut) => {
    try {
      await api.patch(`/leads/${lead.id}`, { statut });
      showToast(`Statut mis à jour : ${statut}`, "success");
      if (onRefresh) onRefresh();
    } catch(e) { showToast(`Erreur changement statut : ${e.message}`, "error"); }
  };

  // ── HubSpot détails ─────────────────────────────────────────────────────
  const chargerHubspot = async (lead) => {
    if (!lead.hubspot_id) return;
    setLoadingHs(true); setHsDetails(null); setHsLeadLogs([]);
    try {
      const [deals, notes, logs] = await Promise.all([
        api.get(`/hubspot/deals/${lead.hubspot_id}`).catch(() => ({ deals: [] })),
        api.get(`/hubspot/notes/${lead.hubspot_id}`).catch(() => ({ notes: [] })),
        api.get(`/hubspot/logs/${lead.id}`).catch(() => []),
      ]);
      setHsDetails({
        deals: deals.deals || deals || [],
        notes: notes.notes || notes || [],
      });
      setHsLeadLogs(Array.isArray(logs) ? logs : []);
    } catch(e) { setHsDetails({ deals: [], notes: [] }); }
    setLoadingHs(false);
  };

  const ouvrirDetail = async (lead) => {
    if (selectedLead?.id === lead.id) { setSelectedLead(null); setDetailData(null); return; }
    setSelectedLead(lead);
    setHsDetails(null);
    setDetailData(null);
    setDetailTab('timeline');
    // Charger le détail complet depuis l'API (emails + events)
    setLoadingDetail(true);
    try {
      const data = await api.get(`/leads/${lead.id}`);
      setDetailData(data);
    } catch(e) { console.error('Erreur détail lead', e); }
    setLoadingDetail(false);
    if (lead.hubspot_id) chargerHubspot(lead);
  };

  // Auto-charger HubSpot si on clique sur l'onglet et que les données ne sont pas encore là
  useEffect(() => {
    if (detailTab === 'hubspot' && selectedLead?.hubspot_id && !hsDetails && !loadingHs) {
      chargerHubspot(selectedLead);
    }
  }, [detailTab]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {showAdd && <ModalAddLead onClose={() => setShowAdd(false)} onAdd={(l) => { onAdd(l); if(onRefresh) onRefresh(); }} campaigns={campaigns.filter(c => c !== "Tous")} sequences={sequences} />}
      {showLaunch && <ModalLaunchSequence lead={showLaunch} sequences={sequences} onClose={() => setShowLaunch(null)} onLaunch={onLaunch} />}
      {showBulkLaunch && <ModalBulkLaunch count={selectedIds.size} sequences={sequences} onClose={() => setShowBulkLaunch(false)} onLaunch={async (seqId, sendNow, taskRelance) => {
        const ids = Array.from(selectedIds);
        await api.post('/sequences/' + seqId + '/inscrire-batch', { lead_ids: ids, task_relance_mois: taskRelance || 0 });
        if (sendNow) await api.post('/sequences/trigger-now', { lead_ids: ids }).catch(e => console.error(e));
        showToast(`${ids.length} lead(s) inscrits à la séquence`, 'success');
        setSelectedIds(new Set());
        if (onRefresh) onRefresh();
      }} />}
      {editLead && <ModalEditLead lead={editLead} onClose={() => setEditLead(null)} onSave={() => { setEditLead(null); if(onRefresh) onRefresh(); }} campaigns={campaigns.filter(c => c !== "Tous")} sequences={sequences} />}

      {/* ── Filtres ── */}
      <div className="flex flex-col md:flex-row flex-wrap gap-2 md:items-center bg-white rounded-2xl border border-slate-100 px-4 py-3">
        <div className="flex gap-1 flex-wrap">
          {statuts.map(s => (
            <button key={s} onClick={() => setFilterStatut(s)} className={`px-2.5 py-1.5 md:py-1 rounded-lg text-xs font-medium transition-colors ${filterStatut === s ? "bg-slate-900 text-white" : "bg-slate-50 border border-slate-200 text-slate-600 hover:border-slate-300"}`}>{s}</button>
          ))}
        </div>
        <div className="w-px h-4 bg-slate-200 mx-1 hidden md:block" />
        <div className="flex gap-2 flex-wrap">
          <select value={filterSegment} onChange={e => setFilterSegment(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1.5 md:py-1 text-xs text-slate-600 focus:outline-none bg-white">
            {segments.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={filterVille} onChange={e => setFilterVille(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1.5 md:py-1 text-xs text-slate-600 focus:outline-none bg-white">
            {villes.map(v => <option key={v}>{v}</option>)}
          </select>
          <select value={filterLangue} onChange={e => setFilterLangue(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1.5 md:py-1 text-xs text-slate-600 focus:outline-none bg-white">
            {langues.map(l => <option key={l} value={l}>{l === "Tous" ? "Toutes langues" : `${langueToFlag(l)} ${l.toUpperCase()}`}</option>)}
          </select>
          <select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1.5 md:py-1 text-xs text-slate-600 focus:outline-none bg-white">
            <option value="Tous">Toutes campaigns</option>
            {campaigns.filter(c => c !== "Tous").map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {allTags.length > 1 && (
            <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1.5 md:py-1 text-xs text-slate-600 focus:outline-none bg-white">
              {allTags.map(t => <option key={t} value={t}>{t === "Tous" ? "Tous tags" : t}</option>)}
            </select>
          )}
          {sources.length > 1 && (
            <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1.5 md:py-1 text-xs text-slate-600 focus:outline-none bg-white">
              {sources.map(s => <option key={s} value={s}>{s === "Tous" ? "Toutes sources" : s}</option>)}
            </select>
          )}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1.5 md:py-1 text-xs text-slate-600 focus:outline-none bg-white">
            <option value="recent">Plus récents</option>
            <option value="score">Score ↓</option>
            <option value="nom">Nom A→Z</option>
          </select>
        </div>
        <span className="md:ml-auto text-xs text-slate-400">{filtered.length} lead{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* ── Barre actions ── */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
        <div className="flex gap-2 items-center">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setVueMode("liste")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${vueMode === "liste" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>☰ Liste</button>
            <button onClick={() => setVueMode("kanban")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${vueMode === "kanban" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>⬛ Kanban</button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..." className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-full md:w-44 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white" />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <div className="flex items-center gap-1" data-info-popup>
            <button onClick={() => csvRef.current?.click()} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 whitespace-nowrap">
              {importStatus || "📥 Import CSV"}
            </button>
            <button
              onClick={(e) => toggleTooltip('csv', e)}
              className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 text-xs flex items-center justify-center font-bold"
            >
              ℹ️
            </button>
          </div>
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={e => importerCSV(e.target.files?.[0])} />
          <div className="flex items-center gap-1" data-info-popup>
            <button onClick={async () => {
              const r = await api.post("/hubspot/sync-all", {}).catch(() => null);
              if (r) { showToast('Sync HubSpot terminée', 'success'); if (onRefresh) onRefresh(); }
              else showToast('Erreur sync HubSpot', 'error');
            }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 whitespace-nowrap">
              🔄 Sync HS
            </button>
            <button
              onClick={(e) => toggleTooltip('sync', e)}
              className="w-5 h-5 rounded-full bg-orange-100 text-orange-500 hover:bg-orange-200 text-xs flex items-center justify-center font-bold"
            >
              ℹ️
            </button>
          </div>
          <div className="flex items-center gap-1" data-info-popup>
            <button onClick={async () => {
              if (!await confirmDialog("Forcer l'envoi immédiat des emails en attente ?\n\nCela enverra tous les emails planifiés pour aujourd'hui.", { danger: true, confirmLabel: 'Forcer l\'envoi' })) return;
              setTriggerStatus("sending");
              try { const r = await api.post("/sequences/trigger-now", {}); setTriggerStatus(r.erreur ? "error" : "done"); }
              catch(e) { setTriggerStatus("error"); }
              setTimeout(() => setTriggerStatus(null), 3000);
            }} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${triggerStatus === "sending" ? "bg-amber-50 border-amber-300 text-amber-700" : triggerStatus === "done" ? "bg-emerald-50 border-emerald-300 text-emerald-700" : triggerStatus === "error" ? "bg-red-50 border-red-300 text-red-600" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              {triggerStatus === "sending" ? "⟳ Envoi..." : triggerStatus === "done" ? "✓ Envoyé" : triggerStatus === "error" ? "✗ Erreur" : "⚡ Envoyer"}
            </button>
            <button
              onClick={(e) => toggleTooltip('trigger', e)}
              className="w-5 h-5 rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 text-xs flex items-center justify-center font-bold"
            >
              ℹ️
            </button>
          </div>
          <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap">+ Ajouter</button>
        </div>
      </div>

      {/* ── VUE LISTE ── */}
      {vueMode === "liste" && (
        <>
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 md:gap-3 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm">
            <span className="font-medium">{selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} sélectionné{selectedIds.size > 1 ? "s" : ""}</span>
            <button onClick={() => setShowBulkLaunch(true)} className="px-3 py-1.5 bg-white text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-50">▶ Lancer</button>
            <button onClick={async () => { if(!await confirmDialog(`Arrêter les séquences de ${selectedIds.size} lead(s) ?`, { danger: true, confirmLabel: 'Arrêter' })) return; try { await api.post('/sequences/stop-batch', { lead_ids: Array.from(selectedIds) }); showToast('Séquences arrêtées','success'); setSelectedIds(new Set()); if(onRefresh) onRefresh(); } catch(e) { showToast('Erreur','error'); } }} className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-semibold hover:bg-orange-600">⏹ Arrêter</button>
            <button onClick={async () => { const ids = Array.from(selectedIds); if(!await confirmDialog('Supprimer ' + ids.length + ' leads ?', { danger: true, confirmLabel: 'Supprimer' })) return; let errCount = 0; for(const id of ids) { try { await api.delete('/leads/' + id); } catch(err) { errCount++; } } setSelectedIds(new Set()); if(onRefresh) onRefresh(); showToast(errCount ? `${ids.length - errCount} supprimé(s), ${errCount} erreur(s)` : `${ids.length} lead(s) supprimé(s)`, errCount ? 'error' : 'success'); }} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600 disabled:opacity-50">✕ Supprimer</button>
            <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-blue-200 hover:text-white text-xs">Annuler</button>
          </div>
        )}
        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {filtered.map(lead => {
            const cfg = STATUT_CONFIG[lead.statut] || STATUT_CONFIG["Nouveau"];
            return (
              <div key={lead.id} className={`bg-white rounded-xl border border-slate-100 p-3 cursor-pointer transition-colors ${selectedLead?.id === lead.id ? "ring-1 ring-indigo-200 bg-indigo-50" : "active:bg-slate-50"}`} onClick={() => ouvrirDetail(lead)}>
                <div className="flex items-center gap-2.5">
                  <input type="checkbox" className="rounded accent-blue-600 flex-shrink-0" checked={selectedIds.has(lead.id)} onChange={e => { e.stopPropagation(); const s = new Set(selectedIds); e.target.checked ? s.add(lead.id) : s.delete(lead.id); setSelectedIds(s); }} onClick={e => e.stopPropagation()} />
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                    {lead.prenom?.[0]}{lead.nom?.[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-800 text-sm truncate">{lead.prenom} {lead.nom}
                      {lead.hubspot_id && <span className="ml-1 text-orange-300 text-xs">⬡</span>}
                    </div>
                    <div className="text-xs text-slate-400 truncate">{lead.hotel} · {[lead.ville, lead.segment, lead.langue ? langueToFlag(lead.langue) : null].filter(Boolean).join(" · ")}</div>
                  </div>
                  <Badge statut={lead.statut} />
                </div>
                <div className="flex items-center justify-between mt-2 pl-[42px]">
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    {lead.sequence && <span className="bg-blue-50 text-blue-600 font-medium px-2 py-0.5 rounded-full">E{(lead.etape||0)+1}</span>}
                    <span>Score {lead.score}</span>
                    {lead.ouvertures > 0 && <span>👁 {lead.ouvertures}</span>}
                  </div>
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    {lead.statut !== "Désabonné" && !lead.sequence_active && <button onClick={() => setShowLaunch(lead)} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xs bg-blue-600 text-white rounded-lg">▶</button>}
                    {lead.sequence_active && <button onClick={() => arreterSequence(lead)} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xs bg-red-500 text-white rounded-lg">⏹</button>}
                    <button onClick={() => setEditLead(lead)} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xs border border-slate-200 text-slate-500 rounded-lg">✏️</button>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Aucun lead trouvé</div>}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-2xl border border-slate-100 overflow-hidden overflow-x-auto">
          <table className="w-full" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="px-2 py-2 relative" style={{ width: columnWidths.checkbox + 'px' }}>
                  <input type="checkbox" className="rounded accent-blue-600" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={e => setSelectedIds(e.target.checked ? new Set(filtered.map(l => l.id)) : new Set())} />
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors group" onMouseDown={e => handleResizeStart(e, 'checkbox')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th onClick={() => handleColumnSort("nom")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none relative" style={{ width: columnWidths.contact + 'px' }}>
                  Contact {sortColumn === "nom" && (sortDirection === "asc" ? "↑" : "↓")}
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'contact')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th onClick={() => handleColumnSort("hotel")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none relative" style={{ width: columnWidths.hotel + 'px' }}>
                  Établissement {sortColumn === "hotel" && (sortDirection === "asc" ? "↑" : "↓")}
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'hotel')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th onClick={() => handleColumnSort("langue")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none relative" style={{ width: columnWidths.langue + 'px' }}>
                  Langue {sortColumn === "langue" && (sortDirection === "asc" ? "↑" : "↓")}
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'langue')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th onClick={() => handleColumnSort("campaign")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none relative" style={{ width: columnWidths.campaign + 'px' }}>
                  Campaign {sortColumn === "campaign" && (sortDirection === "asc" ? "↑" : "↓")}
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'campaign')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th onClick={() => handleColumnSort("sequence")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none relative" style={{ width: columnWidths.sequence + 'px' }}>
                  Séquence {sortColumn === "sequence" && (sortDirection === "asc" ? "↑" : "↓")}
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'sequence')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th className="text-center px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide relative" style={{ width: (columnWidths.infos || 50) + 'px' }}>
                  Infos
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'infos')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th onClick={() => handleColumnSort("statut")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none relative" style={{ width: columnWidths.statut + 'px' }}>
                  Statut {sortColumn === "statut" && (sortDirection === "asc" ? "↑" : "↓")}
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'statut')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide relative" style={{ width: (columnWidths.tags || 120) + 'px' }}>
                  Tags
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'tags')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th onClick={() => handleColumnSort("source")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none relative" style={{ width: (columnWidths.source || 100) + 'px' }}>
                  Source {sortColumn === "source" && (sortDirection === "asc" ? "↑" : "↓")}
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'source')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
                <th className="px-2 py-2 relative" style={{ width: columnWidths.actions + 'px' }}>
                  <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 transition-colors" onMouseDown={e => handleResizeStart(e, 'actions')}>
                    <div className="absolute right-0 top-0 h-full w-3 -translate-x-1"></div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, i) => {
                const cfg = STATUT_CONFIG[lead.statut] || STATUT_CONFIG["Nouveau"];
                return (
                <React.Fragment key={lead.id}>
                <tr className={`group border-b border-slate-50 border-l-2 transition-colors cursor-pointer ${selectedLead?.id === lead.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200 border-l-indigo-400" : selectedIds.has(lead.id) ? "bg-slate-100 border-l-transparent" : "hover:bg-slate-50/80 border-l-transparent hover:border-l-blue-400"} ${i === filtered.length-1 ? "border-b-0" : ""}`} onClick={() => ouvrirDetail(lead)}>
                  <td className="px-2 py-1.5" style={{ width: columnWidths.checkbox + 'px' }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="rounded accent-blue-600" checked={selectedIds.has(lead.id)} onChange={e => { const s = new Set(selectedIds); e.target.checked ? s.add(lead.id) : s.delete(lead.id); setSelectedIds(s); }} />
                  </td>
                  <td className="px-2 py-1.5 overflow-hidden" style={{ width: columnWidths.contact + 'px' }}>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                        {lead.prenom?.[0]}{lead.nom?.[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 text-xs leading-tight truncate">{lead.prenom} {lead.nom}
                          {lead.hubspot_id && <span title="Synchronisé HubSpot" className="ml-1 text-orange-300 text-[10px]">⬡</span>}
                        </div>
                        <div className="text-[10px] text-slate-400 leading-tight truncate">{lead.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 overflow-hidden" style={{ width: columnWidths.hotel + 'px' }}>
                    <div className="text-xs text-slate-700 font-medium leading-tight truncate">{lead.hotel} · {[lead.ville, lead.segment].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-2 py-1.5 text-center overflow-hidden" style={{ width: columnWidths.langue + 'px' }}>
                    <span className="text-xs">{langueToFlag(lead.langue) || '—'}</span>
                  </td>
                  <td className="px-2 py-1.5 overflow-hidden" style={{ width: columnWidths.campaign + 'px' }}>
                    <span className="text-xs text-slate-600 truncate block">{lead.campaign || '—'}</span>
                  </td>
                  <td className="px-2 py-1.5 overflow-hidden" style={{ width: columnWidths.sequence + 'px' }}>
                    {lead.sequence
                      ? <div className="text-[10px] text-blue-600 font-medium truncate">E{(lead.etape||0)+1} · {lead.sequence}</div>
                      : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center overflow-hidden" style={{ width: (columnWidths.infos || 50) + 'px' }}>
                    {lead.last_event_type && (() => {
                      const icons = { ouverture: '👁', clic: '🔗', envoi: '📧', réponse: '💬', désabonnement: '🚫' };
                      const diff = Date.now() - parseUTC(lead.last_event_at).getTime();
                      const fresh = diff < 24 * 3600000;
                      return <span title={`${lead.last_event_type} — ${relTime(lead.last_event_at)}`} className={`text-sm ${fresh ? 'opacity-100' : 'opacity-40'}`}>{icons[lead.last_event_type] || '📌'}</span>;
                    })()}
                  </td>
                  <td className="px-2 py-1.5 overflow-hidden" style={{ width: columnWidths.statut + 'px' }} onClick={e => e.stopPropagation()}>
                    <select value={lead.statut} onChange={e => changerStatut(lead, e.target.value)}
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none ${cfg.bg} ${cfg.text}`}>
                      {Object.keys(STATUT_CONFIG).map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 overflow-hidden" style={{ width: (columnWidths.tags || 120) + 'px' }}>
                    {lead.tags && lead.tags.length > 0 ? (
                      <div className="flex gap-0.5 flex-wrap">
                        {lead.tags.slice(0, 2).map((tag, ti) => (
                          <span key={ti} className={`inline-block px-1 py-0 rounded text-[9px] font-medium truncate max-w-[100px] ${tag.startsWith('Séquence') ? 'bg-blue-50 text-blue-500' : tag.startsWith('Email Marketing') ? 'bg-indigo-50 text-indigo-500' : 'bg-slate-50 text-slate-400'}`} title={tag}>{tag}</span>
                        ))}
                        {lead.tags.length > 2 && <span className="text-[9px] text-slate-400">+{lead.tags.length - 2}</span>}
                      </div>
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1.5 overflow-hidden" style={{ width: (columnWidths.source || 100) + 'px' }}>
                    <span className="text-xs text-slate-600 truncate block">{lead.source || '—'}</span>
                  </td>
                  <td className="px-2 py-1.5 overflow-hidden" style={{ width: columnWidths.actions + 'px' }} onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end">
                      {lead.statut !== "Désabonné" && !lead.sequence_active && (
                        <button onClick={() => setShowLaunch(lead)} title="Lancer séquence" className="px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap">▶</button>
                      )}
                      {lead.sequence_active && (
                        <button onClick={() => arreterSequence(lead)} title="Arrêter séquence" className="px-2 py-1 text-xs bg-red-500 text-white rounded-md hover:bg-red-600 whitespace-nowrap">⏹</button>
                      )}
                      <button onClick={() => setEditLead(lead)} title="Modifier" className="px-2 py-1 text-xs border border-slate-200 text-slate-500 rounded-md hover:bg-slate-100">✏️</button>
                      <button onClick={(e) => supprimerLead(lead, e)} title="Supprimer" className="px-2 py-1 text-xs border border-red-100 text-red-400 rounded-md hover:bg-red-50">✕</button>
                    </div>
                  </td>
                </tr>
                {/* Panneau de détails inline (même contenu que kanban) */}
                {selectedLead?.id === lead.id && (
                  <tr>
                    <td colSpan="11" className="p-0">
                      <div className="bg-white border-t-2 border-blue-400 overflow-hidden">

                        {/* Header */}
                        <div className="flex items-center justify-end p-4 border-b border-slate-100 gap-2 flex-wrap">
                          <button onClick={() => setEditLead(selectedLead)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">✏️ Éditer</button>
                          {selectedLead.sequence_active && (
                            <button onClick={() => arreterSequence(selectedLead)} className="px-3 py-1.5 text-xs border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50">⏹️ Arrêter séquence</button>
                          )}
                          <button onClick={async () => {
                            if (!await confirmDialog(`Bloquer ${selectedLead.email} et l'ajouter à la blocklist ?`, { danger: true, confirmLabel: 'Bloquer' })) return;
                            try {
                              await api.post(`/blocklist/from-lead/${selectedLead.id}`, { raison: `Lead ${selectedLead.prenom} ${selectedLead.nom}` });
                              showToast('Lead ajouté à la blocklist', 'success');
                              setSelectedLead(null);
                              if (onRefresh) onRefresh();
                            } catch (err) {
                              showToast(err.message || 'Erreur lors du blocage', 'error');
                            }
                          }} className="px-3 py-1.5 text-xs border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50">🚫 Bloquer</button>
                          <button onClick={(e) => supprimerLead(selectedLead, e)} className="px-3 py-1.5 text-xs border border-red-100 text-red-400 rounded-lg hover:bg-red-50">Supprimer</button>
                          <button onClick={() => { setSelectedLead(null); setDetailData(null); }} className="text-slate-400 hover:text-slate-600 text-xl ml-1">×</button>
                        </div>

                        {/* KPIs */}
                        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/50">
                          {[
                            ["Score engagement", selectedLead.score || 50],
                            ["Ouvertures", selectedLead.total_ouvertures || 0],
                            ["Emails envoyés", selectedLead.emails_envoyes || 0],
                            ["Clics", detailData?.emails?.reduce((s, e) => s + (e.clics || 0), 0) ?? "—"],
                          ].map(([k, v]) => (
                            <div key={k} className="px-4 py-3 text-center">
                              <div className="text-xl font-bold text-slate-800">{v}</div>
                              <div className="text-xs text-slate-400 mt-0.5">{k}</div>
                            </div>
                          ))}
                        </div>

                        {/* Onglets */}
                        <div className="flex border-b border-slate-100 px-5 pt-3">
                          {[
                            { id: 'timeline', label: '📅 Séquence' },
                            { id: 'emails',   label: `📧 Emails${detailData?.emails?.length ? ' (' + detailData.emails.length + ')' : ''}` },
                            { id: 'hubspot',  label: '🔗 HubSpot' },
                          ].map(tab => (
                            <button key={tab.id} onClick={() => setDetailTab(tab.id)}
                              className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors mr-1
                                ${detailTab === tab.id
                                  ? 'border-slate-900 text-slate-900'
                                  : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        <div className="p-5">
                          {/* Onglet Séquence */}
                          {detailTab === 'timeline' && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                              <div className="space-y-4">
                                {selectedLead.sequence_active || selectedLead.sequence ? (
                                  <div className="border border-blue-100 rounded-xl p-4 bg-blue-50/30">
                                    <div className="flex items-center justify-between mb-3">
                                      <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Séquence en cours</span>
                                      <span className="text-xs font-medium text-blue-600 truncate ml-2 max-w-[140px]">
                                        {selectedLead.sequence_active || selectedLead.sequence}
                                      </span>
                                    </div>
                                    {(() => {
                                      const seq = sequences.find(s => s.id === (selectedLead.sequence_id_active || selectedLead.sequence_id));
                                      const etapeCourante = selectedLead.etape_courante ?? selectedLead.etape ?? 0;
                                      const prochainEnvoi = selectedLead.prochain_envoi;
                                      const nbEtapes = seq?.etapes?.length || selectedLead.nb_etapes_sequence || 0;
                                      const formatCountdown = (iso) => {
                                        if (!iso) return '—';
                                        const diff = parseParis(iso) - Date.now();
                                        if (diff < 0) return 'Imminent';
                                        const d = Math.floor(diff / 86400000);
                                        const h = Math.floor((diff % 86400000) / 3600000);
                                        return d > 0 ? `dans ${d}j ${h}h` : h > 0 ? `dans ${h}h` : 'Très bientôt';
                                      };
                                      return (
                                        <div className="space-y-2">
                                          {seq ? (
                                            <div className="flex items-center gap-1 flex-wrap">
                                              {seq.etapes.map((e, i) => (
                                                <div key={i} className="flex items-center gap-1">
                                                  <div
                                                    title={`J+${e.jour || e.jour_delai || 0} — ${e.sujet}`}
                                                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                                                      ${i < etapeCourante
                                                        ? 'bg-emerald-500 border-emerald-500 text-white'
                                                        : i === etapeCourante
                                                        ? 'bg-blue-600 border-blue-600 text-white ring-2 ring-blue-200'
                                                        : 'bg-white border-slate-200 text-slate-400'}`}>
                                                    {i < etapeCourante ? '✓' : i + 1}
                                                  </div>
                                                  {i < seq.etapes.length - 1 && (
                                                    <div className={`w-5 h-0.5 ${i < etapeCourante ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <div className="text-xs text-blue-600">Étape {etapeCourante + 1} / {nbEtapes || '?'}</div>
                                          )}
                                          <div className="flex items-center justify-between bg-white rounded-lg p-2.5 border border-blue-100 mt-2">
                                            <span className="text-xs text-slate-500">Prochain email</span>
                                            <span className={`text-xs font-semibold ${prochainEnvoi && parseParis(prochainEnvoi) < Date.now() ? 'text-orange-600' : 'text-blue-700'}`}>
                                              {prochainEnvoi
                                                ? `📅 ${parseParis(prochainEnvoi).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${formatCountdown(prochainEnvoi)})`
                                                : '—'}
                                            </span>
                                          </div>
                                          {seq && etapeCourante < seq.etapes.length && (
                                            <div className="bg-white rounded-lg p-2.5 border border-blue-100">
                                              <div className="text-xs text-slate-400 mb-0.5">Prochain objet</div>
                                              <div className="text-xs font-medium text-slate-700 truncate">
                                                {seq.etapes[etapeCourante]?.sujet || '—'}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                ) : (
                                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center">
                                    <p className="text-xs text-slate-400 mb-3">Aucune séquence en cours</p>
                                    {selectedLead.statut !== 'Désabonné' && (
                                      <button onClick={() => setShowLaunch(selectedLead)}
                                        className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                                        {selectedLead.sequence_active ? '↻ Changer de séquence' : '▶ Lancer une séquence'}
                                      </button>
                                    )}
                                  </div>
                                )}
                                {selectedLead.tags?.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {selectedLead.tags.map(t => (
                                      <span key={t} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{t}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Activité récente</div>
                                {loadingDetail ? (
                                  <div className="flex items-center gap-2 text-xs text-slate-400">
                                    <span className="w-3 h-3 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
                                    Chargement...
                                  </div>
                                ) : detailData?.events?.length ? (
                                  <div className="space-y-1">
                                    {detailData.events.slice(0, 10).map((ev, i) => {
                                      const ICONS = { ouverture: '👁', clic: '🔗', envoi: '📧', réponse: '💬', désabonnement: '🚫', bounce: '⚠️' };
                                      let meta = null;
                                      try { meta = ev.meta ? JSON.parse(ev.meta) : null; } catch (_) {}
                                      const desc = {
                                        ouverture: 'a ouvert',
                                        clic: 'a cliqué',
                                        envoi: 'email envoyé',
                                        réponse: 'a répondu',
                                        désabonnement: 's\'est désabonné',
                                        bounce: 'bounce détecté',
                                      };
                                      return (
                                        <div key={i} className="flex items-start gap-2.5 py-2 border-b border-slate-50 last:border-0">
                                          <span className="text-sm flex-shrink-0 mt-0.5">{ICONS[ev.type] || '📌'}</span>
                                          <div className="min-w-0 flex-1">
                                            <div className="text-xs text-slate-700">
                                              <span className="font-medium">{selectedLead.prenom} {selectedLead.nom}</span>
                                              <span className="text-slate-500"> {desc[ev.type] || ev.type}</span>
                                            </div>
                                            {meta?.sujet && <div className="text-xs text-slate-400 truncate mt-0.5">{meta.sujet}</div>}
                                            {meta?.url && <div className="text-xs text-slate-400 truncate mt-0.5">{meta.url}</div>}
                                          </div>
                                          <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
                                            {parseUTC(ev.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-300 italic">Aucune activité enregistrée</p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Onglet Emails */}
                          {detailTab === 'emails' && (
                            <div>
                              {loadingDetail ? (
                                <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
                                  <span className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
                                  Chargement de l'historique...
                                </div>
                              ) : !detailData?.emails?.length ? (
                                <div className="text-center py-12 text-slate-400">
                                  <div className="text-4xl mb-3">📭</div>
                                  <p className="text-sm font-medium">Aucun email envoyé pour ce lead</p>
                                  <p className="text-xs mt-1 text-slate-300">Lancez une séquence pour commencer</p>
                                </div>
                              ) : (
                                <div className="space-y-3">
                                  {detailData.emails.map((email, i) => {
                                    const STATUT_EMAIL = {
                                      'envoyé':  { bg: 'bg-slate-100',  text: 'text-slate-600',  label: 'Envoyé' },
                                      'ouvert':  { bg: 'bg-blue-50',   text: 'text-blue-700',   label: 'Ouvert' },
                                      'cliqué':  { bg: 'bg-purple-50', text: 'text-purple-700', label: 'Cliqué' },
                                      'bounced': { bg: 'bg-red-50',    text: 'text-red-600',    label: 'Bounced' },
                                      'erreur':  { bg: 'bg-red-50',    text: 'text-red-500',    label: 'Erreur' },
                                    };
                                    const cfg = STATUT_EMAIL[email.statut] || STATUT_EMAIL['envoyé'];
                                    return (
                                      <div key={email.id || i} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                        <div className="flex items-start gap-3">
                                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                                            {email.ordre || i + 1}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{cfg.label}</span>
                                              {email.sequence_nom && <span className="text-xs text-slate-400">— {email.sequence_nom}</span>}
                                            </div>
                                            <p className="text-sm font-medium text-slate-800 truncate">{email.sujet}</p>
                                            <p className="text-xs text-slate-400 mt-0.5">
                                              {email.envoye_at ? parseUTC(email.envoye_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                                            </p>
                                          </div>
                                          <div className="flex gap-3 flex-shrink-0">
                                            <div className="text-center">
                                              <div className={`text-sm font-bold ${email.ouvertures > 0 ? 'text-blue-600' : 'text-slate-300'}`}>{email.ouvertures || 0}</div>
                                              <div className="text-xs text-slate-400">ouv.</div>
                                            </div>
                                            <div className="text-center">
                                              <div className={`text-sm font-bold ${email.clics > 0 ? 'text-purple-600' : 'text-slate-300'}`}>{email.clics || 0}</div>
                                              <div className="text-xs text-slate-400">clics</div>
                                            </div>
                                          </div>
                                        </div>
                                        {email.premier_ouvert && (
                                          <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-0.5">
                                            <span className="text-xs text-slate-400">
                                              1ère ouverture : <span className="text-slate-600">{parseUTC(email.premier_ouvert).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                            </span>
                                            {email.dernier_ouvert && email.dernier_ouvert !== email.premier_ouvert && (
                                              <span className="text-xs text-slate-400">
                                                Dernière : <span className="text-slate-600">{parseUTC(email.dernier_ouvert).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                              </span>
                                            )}
                                          </div>
                                        )}
                                        {email.erreur && <p className="mt-2 text-xs text-red-500 bg-red-50 rounded px-2 py-1 italic">{email.erreur}</p>}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Onglet HubSpot */}
                          {detailTab === 'hubspot' && (
                            <div>
                              {selectedLead.hubspot_id ? (
                                <div>
                                  <div className="flex items-center justify-between mb-4">
                                    <div>
                                      <span className="text-xs text-slate-400">Contact #{selectedLead.hubspot_id}</span>
                                      {hsLeadLogs.length > 0 && (
                                        <span className="text-xs text-slate-400 ml-3">
                                          Dernier sync : {(() => {
                                            const diff = Date.now() - parseUTC(hsLeadLogs[0].created_at).getTime();
                                            const mins = Math.floor(diff / 60000);
                                            if (mins < 1) return 'à l\'instant';
                                            if (mins < 60) return `il y a ${mins}min`;
                                            const h = Math.floor(mins / 60);
                                            if (h < 24) return `il y a ${h}h`;
                                            return `il y a ${Math.floor(h / 24)}j`;
                                          })()}
                                        </span>
                                      )}
                                    </div>
                                    <button onClick={() => chargerHubspot(selectedLead)} className="text-xs text-orange-600 hover:underline">↻ Actualiser</button>
                                  </div>
                                  {hsLeadLogs.length > 0 && (
                                    <div className="mb-4">
                                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Historique synchronisation</div>
                                      <div className="space-y-1 max-h-40 overflow-y-auto">
                                        {hsLeadLogs.slice(0, 10).map((log, i) => (
                                          <div key={log.id || i} className="flex items-center gap-2 py-1.5 border-b border-slate-50 last:border-0">
                                            <span className="text-xs flex-shrink-0">{({contact:'👤',email:'✉️',deal:'💰',task:'📋',lifecycle:'🔄'})[log.type] || '⚡'}</span>
                                            <span className="text-xs text-slate-600 flex-1 truncate">{log.action || log.type}</span>
                                            {log.erreur && <span className="text-xs text-red-500 truncate max-w-[120px]">{log.erreur}</span>}
                                            <span className="text-xs text-slate-400 flex-shrink-0">{parseUTC(log.created_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {loadingHs ? (
                                    <div className="flex items-center gap-2 text-xs text-slate-400">
                                      <span className="w-3 h-3 border-2 border-slate-200 border-t-orange-400 rounded-full animate-spin" />
                                      Chargement HubSpot...
                                    </div>
                                  ) : hsDetails ? (
                                    <div>
                                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                                        <div>
                                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Deals ({hsDetails.deals?.length || 0})</div>
                                          {!hsDetails.deals?.length ? (
                                            <p className="text-xs text-slate-300 italic">Aucun deal</p>
                                          ) : hsDetails.deals.map((d, i) => (
                                            <div key={i} className="bg-orange-50 rounded-lg p-3 mb-2 border border-orange-100">
                                              <div className="text-sm font-medium text-slate-800">{d.properties?.dealname || 'Deal'}</div>
                                              <div className="flex gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                                                <span>{d.properties?.dealstage || ''}</span>
                                                {d.properties?.amount && <span className="text-emerald-600 font-semibold">{d.properties.amount}€</span>}
                                                {d.properties?.closedate && <span>{new Date(d.properties.closedate).toLocaleDateString('fr-FR')}</span>}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                        <div>
                                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Notes ({hsDetails.notes?.length || 0})</div>
                                          {!hsDetails.notes?.length ? (
                                            <p className="text-xs text-slate-300 italic">Aucune note</p>
                                          ) : hsDetails.notes.slice(0, 5).map((n, i) => (
                                            <div key={i} className="bg-orange-50 rounded-lg p-3 mb-2 border border-orange-100">
                                              <p className="text-xs text-slate-700 line-clamp-3">{n.properties?.hs_note_body || ''}</p>
                                              <p className="text-xs text-slate-400 mt-1">{n.properties?.hs_lastmodifieddate ? new Date(n.properties.hs_lastmodifieddate).toLocaleDateString('fr-FR') : ''}</p>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                      <div className="border-t border-slate-100 pt-4 space-y-3">
                                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions manuelles</div>
                                        <div className="flex flex-wrap gap-2">
                                          <div className="flex items-center gap-1.5">
                                            <select id="hs-lifecycle-select-inline" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600">
                                              <option value="lead">Lead</option>
                                              <option value="marketingqualifiedlead">MQL</option>
                                              <option value="salesqualifiedlead">SQL</option>
                                              <option value="opportunity">Opportunity</option>
                                              <option value="customer">Customer</option>
                                            </select>
                                            <button onClick={async (e) => {
                                              const btn = e.currentTarget; btn.disabled = true;
                                              const stage = document.getElementById('hs-lifecycle-select-inline').value;
                                              try {
                                                await api.post(`/hubspot/force-lifecycle/${selectedLead.id}`, { stage });
                                                showToast(`Lifecycle → ${stage}`, 'success');
                                                chargerHubspot(selectedLead);
                                              } catch(err) { showToast('Erreur : ' + err.message, 'error'); }
                                              btn.disabled = false;
                                            }} className="px-3 py-1.5 text-xs bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
                                              Forcer lifecycle
                                            </button>
                                          </div>
                                          {!hsDetails.deals?.length && (
                                            <button onClick={async (e) => {
                                              const btn = e.currentTarget; btn.disabled = true;
                                              try {
                                                await api.post(`/hubspot/creer-deal/${selectedLead.id}`);
                                                showToast('Deal créé', 'success');
                                                chargerHubspot(selectedLead);
                                                if (onRefresh) onRefresh();
                                              } catch(err) { showToast('Erreur : ' + err.message, 'error'); }
                                              btn.disabled = false;
                                            }} className="px-3 py-1.5 text-xs bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50">
                                              Créer un deal
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-xs text-slate-400">Cliquez ↻ pour charger les données HubSpot</p>
                                  )}
                                </div>
                              ) : (
                                <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center gap-3 text-center">
                                  <p className="text-sm text-slate-400">Non synchronisé avec HubSpot</p>
                                  <button onClick={async (e) => {
                                    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Synchronisation...';
                                    try {
                                      await api.post(`/hubspot/sync-lead/${selectedLead.id}`);
                                      showToast('Lead synchronisé avec HubSpot', 'success');
                                      if (onRefresh) onRefresh();
                                    } catch(err) { showToast('Erreur sync HubSpot : ' + err.message, 'error'); }
                                    btn.disabled = false; btn.textContent = 'Synchroniser maintenant';
                                  }} className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
                                    Synchroniser maintenant
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Aucun lead trouvé</div>}
        </div>
        </>
      )}

      {/* ── VUE KANBAN ── */}
      {vueMode === "kanban" && (
        <div className="flex gap-2 overflow-x-auto pb-4 snap-x snap-mandatory md:snap-none">
          {KANBAN_COLS.map(col => {
            const colLeads = filtered.filter(l => l.statut === col);
            const cfg = STATUT_CONFIG[col] || STATUT_CONFIG["Nouveau"];
            return (
              <div key={col} className="flex-shrink-0 w-[75vw] md:w-48 snap-start">
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg mb-2 ${cfg.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  <span className={`text-xs font-semibold ${cfg.text}`}>{col}</span>
                  <span className={`ml-auto text-xs font-bold ${cfg.text} opacity-60`}>{colLeads.length}</span>
                </div>
                <div className="space-y-1 min-h-8 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {colLeads.map(lead => {
                    const scoreColor = lead.score >= 80 ? "bg-emerald-500" : lead.score >= 50 ? "bg-amber-400" : "bg-slate-300";
                    return (
                    <div key={lead.id} className="group bg-white rounded-md border border-slate-100 px-2 py-1 hover:bg-slate-50 transition-colors cursor-pointer flex items-center gap-1.5" onClick={() => ouvrirDetail(lead).catch(e => console.error("Erreur détail:", e))}>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${scoreColor}`} title={`Score: ${lead.score}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-slate-800 truncate leading-tight">{lead.prenom} {lead.nom}{lead.sequence ? <span className="text-blue-500 ml-1">E{(lead.etape||0)+1}</span> : ""}</div>
                        <div className="text-[10px] text-slate-400 truncate leading-tight">{lead.hotel}</div>
                      </div>
                      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setEditLead(lead)} className="text-[10px] text-slate-400 hover:text-slate-600">✏️</button>
                      </div>
                    </div>
                    );
                  })}
                  {colLeads.length === 0 && <div className="text-center py-3 text-[10px] text-slate-300 border border-dashed border-slate-100 rounded-md">Vide</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── DETAIL LEAD (uniquement en vue kanban) ── */}
      {selectedLead && vueMode === "kanban" && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">

          {/* ── Header ── */}
          <div className="flex items-center justify-end p-4 md:p-5 border-b border-slate-100 gap-2 flex-wrap">
              <button onClick={() => setEditLead(selectedLead)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">✏️ Éditer</button>
              {selectedLead.sequence_active && (
                <button onClick={() => arreterSequence(selectedLead)} className="px-3 py-1.5 text-xs border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50">⏹️ Arrêter séquence</button>
              )}
              <button onClick={async () => {
                if (!await confirmDialog(`Bloquer ${selectedLead.email} et l'ajouter à la blocklist ?`, { danger: true, confirmLabel: 'Bloquer' })) return;
                try {
                  await api.post(`/blocklist/from-lead/${selectedLead.id}`, { raison: `Lead ${selectedLead.prenom} ${selectedLead.nom}` });
                  showToast('Lead ajouté à la blocklist', 'success');
                  setSelectedLead(null);
                  if (onRefresh) onRefresh();
                } catch (err) {
                  showToast(err.message || 'Erreur lors du blocage', 'error');
                }
              }} className="px-3 py-1.5 text-xs border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50">🚫 Bloquer</button>
              <button onClick={(e) => supprimerLead(selectedLead, e)} className="px-3 py-1.5 text-xs border border-red-100 text-red-400 rounded-lg hover:bg-red-50">Supprimer</button>
              <button onClick={() => { setSelectedLead(null); setDetailData(null); }} className="text-slate-400 hover:text-slate-600 text-xl ml-1">×</button>
          </div>

          {/* ── KPIs rapides ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/50">
            {[
              ["Score engagement", selectedLead.score || 50],
              ["Ouvertures", selectedLead.total_ouvertures || 0],
              ["Emails envoyés", selectedLead.emails_envoyes || 0],
              ["Clics", detailData?.emails?.reduce((s, e) => s + (e.clics || 0), 0) ?? "—"],
            ].map(([k, v]) => (
              <div key={k} className="px-4 py-3 text-center">
                <div className="text-xl font-bold text-slate-800">{v}</div>
                <div className="text-xs text-slate-400 mt-0.5">{k}</div>
              </div>
            ))}
          </div>

          {/* ── Onglets ── */}
          <div className="flex border-b border-slate-100 px-5 pt-3">
            {[
              { id: 'timeline', label: '📅 Séquence' },
              { id: 'emails',   label: `📧 Emails${detailData?.emails?.length ? ' (' + detailData.emails.length + ')' : ''}` },
              { id: 'hubspot',  label: '🔗 HubSpot' },
            ].map(tab => (
              <button key={tab.id} onClick={() => setDetailTab(tab.id)}
                className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors mr-1
                  ${detailTab === tab.id
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-5">

            {/* ══ ONGLET SÉQUENCE ══ */}
            {detailTab === 'timeline' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Gauche — séquence en cours + tags + bouton lancer */}
                <div className="space-y-4">
                  {selectedLead.sequence_active || selectedLead.sequence ? (
                    <div className="border border-blue-100 rounded-xl p-4 bg-blue-50/30">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Séquence en cours</span>
                        <span className="text-xs font-medium text-blue-600 truncate ml-2 max-w-[140px]">
                          {selectedLead.sequence_active || selectedLead.sequence}
                        </span>
                      </div>
                      {(() => {
                        const seq = sequences.find(s => s.id === (selectedLead.sequence_id_active || selectedLead.sequence_id));
                        const etapeCourante = selectedLead.etape_courante ?? selectedLead.etape ?? 0;
                        const prochainEnvoi = selectedLead.prochain_envoi;
                        const nbEtapes = seq?.etapes?.length || selectedLead.nb_etapes_sequence || 0;
                        const formatCountdown = (iso) => {
                          if (!iso) return '—';
                          const diff = parseParis(iso) - Date.now();
                          if (diff < 0) return 'Imminent';
                          const d = Math.floor(diff / 86400000);
                          const h = Math.floor((diff % 86400000) / 3600000);
                          return d > 0 ? `dans ${d}j ${h}h` : h > 0 ? `dans ${h}h` : 'Très bientôt';
                        };
                        return (
                          <div className="space-y-2">
                            {seq ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                {seq.etapes.map((e, i) => (
                                  <div key={i} className="flex items-center gap-1">
                                    <div
                                      title={`J+${e.jour || e.jour_delai || 0} — ${e.sujet}`}
                                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                                        ${i < etapeCourante
                                          ? 'bg-emerald-500 border-emerald-500 text-white'
                                          : i === etapeCourante
                                          ? 'bg-blue-600 border-blue-600 text-white ring-2 ring-blue-200'
                                          : 'bg-white border-slate-200 text-slate-400'}`}>
                                      {i < etapeCourante ? '✓' : i + 1}
                                    </div>
                                    {i < seq.etapes.length - 1 && (
                                      <div className={`w-5 h-0.5 ${i < etapeCourante ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-blue-600">Étape {etapeCourante + 1} / {nbEtapes || '?'}</div>
                            )}
                            <div className="flex items-center justify-between bg-white rounded-lg p-2.5 border border-blue-100 mt-2">
                              <span className="text-xs text-slate-500">Prochain email</span>
                              <span className={`text-xs font-semibold ${prochainEnvoi && parseParis(prochainEnvoi) < Date.now() ? 'text-orange-600' : 'text-blue-700'}`}>
                                {prochainEnvoi
                                  ? `📅 ${parseParis(prochainEnvoi).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${formatCountdown(prochainEnvoi)})`
                                  : '—'}
                              </span>
                            </div>
                            {seq && etapeCourante < seq.etapes.length && (
                              <div className="bg-white rounded-lg p-2.5 border border-blue-100">
                                <div className="text-xs text-slate-400 mb-0.5">Prochain objet</div>
                                <div className="text-xs font-medium text-slate-700 truncate">
                                  {seq.etapes[etapeCourante]?.sujet || '—'}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center">
                      <p className="text-xs text-slate-400 mb-3">Aucune séquence en cours</p>
                      {selectedLead.statut !== 'Désabonné' && (
                        <button onClick={() => setShowLaunch(selectedLead)}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                          {selectedLead.sequence_active
                            ? '↻ Changer de séquence'
                            : '▶ Lancer une séquence'}
                        </button>
                      )}
                    </div>
                  )}

                  {selectedLead.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLead.tags.map(t => (
                        <span key={t} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{t}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Droite — activité récente (events) */}
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Activité récente</div>
                  {loadingDetail ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="w-3 h-3 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
                      Chargement...
                    </div>
                  ) : detailData?.events?.length ? (
                    <div className="space-y-1">
                      {detailData.events.slice(0, 10).map((ev, i) => {
                        const ICONS = { ouverture: '👁', clic: '🔗', envoi: '📧', réponse: '💬', désabonnement: '🚫', bounce: '⚠️' };
                        let meta = null;
                        try { meta = ev.meta ? JSON.parse(ev.meta) : null; } catch (_) {}
                        const desc = {
                          ouverture: 'a ouvert',
                          clic: 'a cliqué',
                          envoi: 'email envoyé',
                          réponse: 'a répondu',
                          désabonnement: 's\'est désabonné',
                          bounce: 'bounce détecté',
                        };
                        return (
                          <div key={i} className="flex items-start gap-2.5 py-2 border-b border-slate-50 last:border-0">
                            <span className="text-sm flex-shrink-0 mt-0.5">{ICONS[ev.type] || '📌'}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs text-slate-700">
                                <span className="font-medium">{selectedLead.prenom} {selectedLead.nom}</span>
                                <span className="text-slate-500"> {desc[ev.type] || ev.type}</span>
                              </div>
                              {meta?.sujet && <div className="text-xs text-slate-400 truncate mt-0.5">{meta.sujet}</div>}
                              {meta?.url && <div className="text-xs text-slate-400 truncate mt-0.5">{meta.url}</div>}
                            </div>
                            <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">
                              {parseUTC(ev.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-300 italic">Aucune activité enregistrée</p>
                  )}
                </div>

              </div>
            )}

            {/* ══ ONGLET EMAILS ══ */}
            {detailTab === 'emails' && (
              <div>
                {loadingDetail ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
                    <span className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
                    Chargement de l'historique...
                  </div>
                ) : !detailData?.emails?.length ? (
                  <div className="text-center py-12 text-slate-400">
                    <div className="text-4xl mb-3">📭</div>
                    <p className="text-sm font-medium">Aucun email envoyé pour ce lead</p>
                    <p className="text-xs mt-1 text-slate-300">Lancez une séquence pour commencer</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {detailData.emails.map((email, i) => {
                      const STATUT_EMAIL = {
                        'envoyé':  { bg: 'bg-slate-100',  text: 'text-slate-600',  dot: 'bg-slate-400',  label: 'Envoyé' },
                        'ouvert':  { bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500',   label: 'Ouvert' },
                        'cliqué':  { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500', label: 'Cliqué' },
                        'bounced': { bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-500',    label: 'Bounced' },
                        'erreur':  { bg: 'bg-red-50',    text: 'text-red-500',    dot: 'bg-red-400',    label: 'Erreur' },
                      };
                      const cfg = STATUT_EMAIL[email.statut] || STATUT_EMAIL['envoyé'];
                      return (
                        <div key={email.id || i} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                          <div className="flex items-start gap-3">
                            {/* Numéro + statut */}
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                              {email.ordre || i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>
                                  {cfg.label}
                                </span>
                                {email.sequence_nom && (
                                  <span className="text-xs text-slate-400">— {email.sequence_nom}</span>
                                )}
                              </div>
                              <p className="text-sm font-medium text-slate-800 truncate">{email.sujet}</p>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {email.envoye_at
                                  ? parseUTC(email.envoye_at).toLocaleDateString('fr-FR', {
                                      weekday: 'short', day: 'numeric', month: 'short',
                                      year: 'numeric', hour: '2-digit', minute: '2-digit'
                                    })
                                  : '—'}
                              </p>
                            </div>
                            {/* Stats ouvertures + clics */}
                            <div className="flex gap-3 flex-shrink-0">
                              <div className="text-center">
                                <div className={`text-sm font-bold ${email.ouvertures > 0 ? 'text-blue-600' : 'text-slate-300'}`}>
                                  {email.ouvertures || 0}
                                </div>
                                <div className="text-xs text-slate-400">ouv.</div>
                              </div>
                              <div className="text-center">
                                <div className={`text-sm font-bold ${email.clics > 0 ? 'text-purple-600' : 'text-slate-300'}`}>
                                  {email.clics || 0}
                                </div>
                                <div className="text-xs text-slate-400">clics</div>
                              </div>
                            </div>
                          </div>
                          {/* Dates ouverture */}
                          {email.premier_ouvert && (
                            <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-0.5">
                              <span className="text-xs text-slate-400">
                                1ère ouverture : <span className="text-slate-600">
                                  {parseUTC(email.premier_ouvert).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </span>
                              {email.dernier_ouvert && email.dernier_ouvert !== email.premier_ouvert && (
                                <span className="text-xs text-slate-400">
                                  Dernière : <span className="text-slate-600">
                                    {parseUTC(email.dernier_ouvert).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </span>
                              )}
                            </div>
                          )}
                          {email.erreur && (
                            <p className="mt-2 text-xs text-red-500 bg-red-50 rounded px-2 py-1 italic">{email.erreur}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ══ ONGLET HUBSPOT ══ */}
            {detailTab === 'hubspot' && (
              <div>
                {selectedLead.hubspot_id ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <span className="text-xs text-slate-400">Contact #{selectedLead.hubspot_id}</span>
                        {hsLeadLogs.length > 0 && (
                          <span className="text-xs text-slate-400 ml-3">
                            Dernier sync : {(() => {
                              const diff = Date.now() - parseUTC(hsLeadLogs[0].created_at).getTime();
                              const mins = Math.floor(diff / 60000);
                              if (mins < 1) return 'à l\'instant';
                              if (mins < 60) return `il y a ${mins}min`;
                              const h = Math.floor(mins / 60);
                              if (h < 24) return `il y a ${h}h`;
                              return `il y a ${Math.floor(h / 24)}j`;
                            })()}
                          </span>
                        )}
                      </div>
                      <button onClick={() => chargerHubspot(selectedLead)} className="text-xs text-orange-600 hover:underline">↻ Actualiser</button>
                    </div>

                    {/* Historique synchronisation */}
                    {hsLeadLogs.length > 0 && (
                      <div className="mb-4">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Historique synchronisation</div>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {hsLeadLogs.slice(0, 10).map((log, i) => (
                            <div key={log.id || i} className="flex items-center gap-2 py-1.5 border-b border-slate-50 last:border-0">
                              <span className="text-xs flex-shrink-0">{({contact:'👤',email:'✉️',deal:'💰',task:'📋',lifecycle:'🔄'})[log.type] || '⚡'}</span>
                              <span className="text-xs text-slate-600 flex-1 truncate">{log.action || log.type}</span>
                              {log.erreur && <span className="text-xs text-red-500 truncate max-w-[120px]">{log.erreur}</span>}
                              <span className="text-xs text-slate-400 flex-shrink-0">{parseUTC(log.created_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {loadingHs ? (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="w-3 h-3 border-2 border-slate-200 border-t-orange-400 rounded-full animate-spin" />
                        Chargement HubSpot...
                      </div>
                    ) : hsDetails ? (
                      <div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                          <div>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                              Deals ({hsDetails.deals?.length || 0})
                            </div>
                            {!hsDetails.deals?.length ? (
                              <p className="text-xs text-slate-300 italic">Aucun deal</p>
                            ) : hsDetails.deals.map((d, i) => (
                              <div key={i} className="bg-orange-50 rounded-lg p-3 mb-2 border border-orange-100">
                                <div className="text-sm font-medium text-slate-800">{d.properties?.dealname || 'Deal'}</div>
                                <div className="flex gap-3 text-xs text-slate-500 mt-1 flex-wrap">
                                  <span>{d.properties?.dealstage || ''}</span>
                                  {d.properties?.amount && <span className="text-emerald-600 font-semibold">{d.properties.amount}€</span>}
                                  {d.properties?.closedate && <span>{new Date(d.properties.closedate).toLocaleDateString('fr-FR')}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                              Notes ({hsDetails.notes?.length || 0})
                            </div>
                            {!hsDetails.notes?.length ? (
                              <p className="text-xs text-slate-300 italic">Aucune note</p>
                            ) : hsDetails.notes.slice(0, 5).map((n, i) => (
                              <div key={i} className="bg-orange-50 rounded-lg p-3 mb-2 border border-orange-100">
                                <p className="text-xs text-slate-700 line-clamp-3">{n.properties?.hs_note_body || ''}</p>
                                <p className="text-xs text-slate-400 mt-1">
                                  {n.properties?.hs_lastmodifieddate
                                    ? new Date(n.properties.hs_lastmodifieddate).toLocaleDateString('fr-FR')
                                    : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Actions manuelles */}
                        <div className="border-t border-slate-100 pt-4 space-y-3">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions manuelles</div>
                          <div className="flex flex-wrap gap-2">
                            <div className="flex items-center gap-1.5">
                              <select id="hs-lifecycle-select" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600">
                                <option value="lead">Lead</option>
                                <option value="marketingqualifiedlead">MQL</option>
                                <option value="salesqualifiedlead">SQL</option>
                                <option value="opportunity">Opportunity</option>
                                <option value="customer">Customer</option>
                              </select>
                              <button onClick={async (e) => {
                                const btn = e.currentTarget; btn.disabled = true;
                                const stage = document.getElementById('hs-lifecycle-select').value;
                                try {
                                  await api.post(`/hubspot/force-lifecycle/${selectedLead.id}`, { stage });
                                  showToast(`Lifecycle → ${stage}`, 'success');
                                  chargerHubspot(selectedLead);
                                } catch(err) { showToast('Erreur : ' + err.message, 'error'); }
                                btn.disabled = false;
                              }} className="px-3 py-1.5 text-xs bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
                                Forcer lifecycle
                              </button>
                            </div>
                            {!hsDetails.deals?.length && (
                              <button onClick={async (e) => {
                                const btn = e.currentTarget; btn.disabled = true;
                                try {
                                  await api.post(`/hubspot/creer-deal/${selectedLead.id}`);
                                  showToast('Deal créé', 'success');
                                  chargerHubspot(selectedLead);
                                  if (onRefresh) onRefresh();
                                } catch(err) { showToast('Erreur : ' + err.message, 'error'); }
                                btn.disabled = false;
                              }} className="px-3 py-1.5 text-xs bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50">
                                Créer un deal
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Cliquez ↻ pour charger les données HubSpot</p>
                    )}
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center gap-3 text-center">
                    <p className="text-sm text-slate-400">Non synchronisé avec HubSpot</p>
                    <button onClick={async (e) => {
                      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Synchronisation...';
                      try {
                        await api.post(`/hubspot/sync-lead/${selectedLead.id}`);
                        showToast('Lead synchronisé avec HubSpot', 'success');
                        if (onRefresh) onRefresh();
                      } catch(err) { showToast('Erreur sync HubSpot : ' + err.message, 'error'); }
                      btn.disabled = false; btn.textContent = 'Synchroniser maintenant';
                    }} className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
                      Synchroniser maintenant
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
      {/* Popover ℹ️ en position fixe (hors overflow) */}
      {showTooltip && (
        <div data-info-popover style={{ position: 'fixed', top: tooltipPos.top, left: tooltipPos.left, zIndex: 9999 }}
          className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2.5 shadow-xl max-w-xs animate-in fade-in">
          {showTooltip === 'csv' && (<>
            <p className="font-semibold mb-1">Format CSV :</p>
            <p className="text-slate-300">civilite, prenom, nom, email, hotel, ville, segment, poste, langue, source</p>
            <p className="text-slate-300 mt-1.5">Requis : <span className="text-white font-semibold">email, hotel, prenom</span></p>
          </>)}
          {showTooltip === 'sync' && (
            <p>Synchroniser tous les leads avec HubSpot (contacts + entreprises)</p>
          )}
          {showTooltip === 'trigger' && (
            <p>Force l'envoi immédiat des emails planifiés (bypass fenêtre horaire)</p>
          )}
        </div>
      )}
      {confirmDialogEl}
    </div>
  );
};

const VueSequences = ({ sequences, onNew, onEdit, onRefresh, showToast }) => {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [testModal, setTestModal] = useState(null); // seq id
  const [testEmail, setTestEmail] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [expandedSeqs, setExpandedSeqs] = useState(new Set());

  const toggleSeq = (id) => {
    setExpandedSeqs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const supprimerSequence = async (seq) => {
    if (!await confirmDialog(`Supprimer la séquence "${seq.nom}" ? Cette action est irréversible.`, { danger: true, confirmLabel: 'Supprimer' })) return;
    try {
      await api.delete(`/sequences/${seq.id}`);
      showToast('Séquence supprimée', 'success');
      if (onRefresh) onRefresh();
    } catch (err) {
      showToast('Erreur: ' + (err.message || 'impossible de supprimer'), 'error');
    }
  };

  const dupliquerSequence = async (seq) => {
    try {
      const res = await api.post(`/sequences/${seq.id}/duplicate`);
      showToast(`Séquence "${res.nom}" créée`, 'success');
      if (onRefresh) onRefresh();
    } catch (err) {
      showToast('Erreur duplication : ' + err.message, 'error');
    }
  };

  const envoyerTest = async (seqId) => {
    if (!testEmail.trim()) return;
    setTestLoading(true);
    const email = testEmail.trim();
    const seq = sequences.find(s => s.id === seqId);
    const nbEtapes = seq?.etapes?.length || 1;
    try {
      // Appeler l'endpoint de test complet qui envoie TOUS les emails immédiatement
      await api.post(`/sequences/${seqId}/test-complete`, { test_email: email });

      // Fermer le modal immédiatement
      setTestModal(null);
      setTestEmail("");
      setTestLoading(false);

      showToast(`⚡ Test lancé : ${nbEtapes} email(s) en cours d'envoi vers ${email}`, 'success');

      // Les emails sont envoyés en arrière-plan (2-3 sec entre chaque)
      setTimeout(() => {
        showToast(`✅ Les ${nbEtapes} emails devraient être arrivés à ${email}`, 'success');
      }, nbEtapes * 3000 + 2000);
    } catch (err) {
      showToast(err.message || 'Erreur lors du test', 'error');
    }
    setTestLoading(false);
  };

  return (
  <div className="space-y-4">
    <div className="flex justify-end">
      <button onClick={onNew} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors">
        + Nouvelle séquence
      </button>
    </div>
    <div className="grid gap-3">
      {sequences.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">Aucune séquence. Créez-en une pour commencer.</div>
      )}
      {sequences.map(seq => {
        const isExpanded = expandedSeqs.has(seq.id);
        return (
        <div key={seq.id} className="bg-white rounded-xl border border-slate-100">
          <div className={`flex items-center justify-between p-4 cursor-pointer select-none hover:bg-slate-50/50 transition-colors ${isExpanded ? '' : 'rounded-xl'}`} onClick={() => toggleSeq(seq.id)}>
            <div className="flex items-center gap-3 min-w-0">
              <span className={`text-slate-400 text-xs transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
              <h3 className="text-sm font-semibold text-slate-800 truncate">{seq.nom}</h3>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full flex-shrink-0">{seq.segment}</span>
              <span className="text-xs text-slate-400 flex-shrink-0">{seq.leadsActifs} actifs</span>
              <span className="text-xs text-slate-400 flex-shrink-0">{seq.etapes?.length || 0} étape{(seq.etapes?.length || 0) !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
              <button onClick={() => { setTestModal(seq.id); setTestEmail(""); }} className="px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                Tester
              </button>
              <button onClick={() => onEdit(seq)} className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                Modifier
              </button>
              <button onClick={() => dupliquerSequence(seq)} className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                Dupliquer
              </button>
              <button onClick={() => supprimerSequence(seq)} className="px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                Supprimer
              </button>
            </div>
          </div>
          {isExpanded && (
          <div className="px-4 pb-4">
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-3 py-1.5 text-[11px] font-medium text-slate-400 uppercase w-8">#</th>
                    <th className="text-left px-3 py-1.5 text-[11px] font-medium text-slate-400 uppercase w-16">Délai</th>
                    <th className="text-left px-3 py-1.5 text-[11px] font-medium text-slate-400 uppercase">Objet</th>
                    <th className="text-left px-3 py-1.5 text-[11px] font-medium text-slate-400 uppercase hidden md:table-cell">Aperçu</th>
                  </tr>
                </thead>
                <tbody>
                  {seq.etapes.map((etape, i) => (
                    <tr key={i} className="border-t border-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-400">{i + 1}</td>
                      <td className="px-3 py-2 text-slate-500">J+{etape.jour}</td>
                      <td className="px-3 py-2 font-medium text-slate-800 truncate max-w-[200px]">{etape.sujet || "(sans objet)"}</td>
                      <td className="px-3 py-2 text-slate-400 truncate max-w-[300px] hidden md:table-cell">{(etape.corps_html ? etape.corps_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : etape.corps?.split("\n")[0]) || "(vide)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
        );
      })}
    </div>

    {/* Mini-modal test */}
    {testModal && (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Tester la séquence complète</h3>
          <p className="text-xs text-slate-500 mb-3">
            <strong>Tous les emails</strong> de la séquence seront envoyés immédiatement à cette adresse (2-3 sec entre chaque).
          </p>
          <input value={testEmail} onChange={e => setTestEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && envoyerTest(testModal)} placeholder="email@test.com" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" autoFocus />
          <div className="flex justify-end gap-2">
            <button onClick={() => setTestModal(null)} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
            <button onClick={() => envoyerTest(testModal)} disabled={testLoading || !testEmail.trim()} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {testLoading ? "Envoi..." : "⚡ Tester la séquence"}
            </button>
          </div>
        </div>
      </div>
    )}
    {confirmDialogEl}
  </div>
  );
};

const VueHubspot = () => {
  const [connected, setConnected] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Toggles HubSpot
  const HS_TOGGLES = [
    { key: 'hs_sync_contact', label: 'Synchroniser les contacts', desc: 'Créer/mettre à jour le contact HubSpot à la création d\'un lead' },
    { key: 'hs_log_email', label: 'Logger les emails envoyés', desc: 'Enregistrer chaque email envoyé dans le timeline du contact' },
    { key: 'hs_lifecycle', label: 'Mettre à jour le lifecycle stage', desc: 'Passer automatiquement les contacts en MQL/SQL selon l\'engagement' },
    { key: 'hs_task_fin_sequence', label: 'Créer une tâche fin de séquence', desc: 'Créer une tâche de suivi quand un lead termine une séquence' },
    { key: 'hs_deal_conversion', label: 'Créer un deal à la conversion', desc: 'Créer automatiquement un deal quand un lead est converti' },
  ];
  const [toggles, setToggles] = useState({});
  const [hsLogs, setHsLogs] = useState([]);
  const [hsLogsTotal, setHsLogsTotal] = useState(0);
  const [hsLogsOffset, setHsLogsOffset] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const chargerLogs = async (offset = 0, append = false) => {
    setLoadingLogs(true);
    try {
      const res = await api.get(`/stats/hubspot?offset=${offset}&limit=30`);
      if (append) setHsLogs(prev => [...prev, ...(res.logsRecents || [])]);
      else setHsLogs(res.logsRecents || []);
      setHsLogsTotal(res.totalLogs || 0);
      setHsLogsOffset(offset + (res.logsRecents?.length || 0));
    } catch(e) { console.error(e); }
    setLoadingLogs(false);
  };

  // Charger la config au montage
  useEffect(() => {
    api.get('/health').then(h => {
      if (h.hubspot === 'configuré') setConnected(true);
    }).catch(e => console.error(e));
    api.get('/config').then(cfg => {
      if (cfg.hubspot_api_key_configured) setConnected(true);
      // Charger les toggles depuis la config
      const t = {};
      HS_TOGGLES.forEach(({ key }) => {
        t[key] = cfg[key] !== '0' && cfg[key] !== 'false';
      });
      setToggles(t);
    }).catch(e => console.error(e));
    chargerLogs();
  }, []);

  const toggleHs = async (key) => {
    const newVal = !toggles[key];
    setToggles(prev => ({ ...prev, [key]: newVal }));
    try {
      await api.post('/config', { [key]: newVal ? '1' : '0' });
    } catch(e) {
      setToggles(prev => ({ ...prev, [key]: !newVal }));
    }
  };

  const sauvegarder = async () => {
    if (!apiKey) return;
    setSaving(true);
    setMsg("");
    try {
      await api.post('/config', { hubspot_api_key: apiKey });
      setConnected(true);
      setMsg("✅ Clé HubSpot sauvegardée");
      setApiKey("");
    } catch(e) {
      setMsg("❌ Erreur lors de la sauvegarde");
    }
    setSaving(false);
  };

  const deconnecter = async () => {
    await api.post('/config', { hubspot_api_key: '' });
    setConnected(false);
    setMsg("");
  };

  const hsLogIcon = (type) => {
    const icons = { contact: '👤', email: '✉️', deal: '💰', task: '📋', lifecycle: '🔄' };
    return icons[type] || '⚡';
  };

  const hsLogDescription = (log) => {
    const nom = log.lead_prenom || log.lead_email?.split('@')[0] || '';
    const hotel = log.lead_hotel ? ` (${log.lead_hotel})` : '';
    const labels = {
      'contact:create': `Contact créé pour ${nom}${hotel}`,
      'contact:update': `Contact mis à jour — ${nom}${hotel}`,
      'contact:error': `Erreur sync contact — ${nom}${hotel}`,
      'deal:create': `Deal créé pour ${nom}${hotel}`,
      'task:create': `Tâche créée pour ${nom}${hotel}`,
      'email:log': `Email loggé pour ${nom}${hotel}`,
      'lifecycle:update': `Lifecycle mis à jour — ${nom}${hotel}`,
    };
    return labels[`${log.type}:${log.action}`] || `${log.type} ${log.action} — ${nom}${hotel}`;
  };

  const formatDateLog = (date) => {
    if (!date) return '';
    return parseUTC(date).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className={`rounded-2xl border p-5 ${connected ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-100"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${connected ? "bg-emerald-100" : "bg-slate-100"}`}>🔗</div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">HubSpot CRM</h3>
              <p className={`text-xs ${connected ? "text-emerald-600" : "text-slate-400"}`}>{connected ? "Connecté · Clé API sauvegardée" : "Non connecté"}</p>
            </div>
          </div>
          {connected && (
            <button onClick={deconnecter} className="px-4 py-2 text-sm font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
              Déconnecter
            </button>
          )}
        </div>
      </div>

      {!connected && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">Configuration API</h3>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Clé API HubSpot (Private App Token)</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="pat-eu1-xxxxxxxx-xxxx-..." className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            <p className="text-xs text-slate-400 mt-1.5">Créez une Private App dans HubSpot → Settings → Integrations → Private Apps</p>
          </div>
          {msg && <p className="text-xs text-emerald-600">{msg}</p>}
          <button onClick={sauvegarder} disabled={saving || !apiKey} className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-40">
            {saving ? "Sauvegarde..." : "Sauvegarder la clé"}
          </button>
        </div>
      )}

      {connected && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Actions automatiques</h3>
          <div className="space-y-3">
            {HS_TOGGLES.map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex-1 mr-4">
                  <div className="text-sm text-slate-700 font-medium">{label}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{desc}</div>
                </div>
                <button onClick={() => toggleHs(key)}
                  className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${toggles[key] ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${toggles[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {connected && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-800">Activité récente</h3>
            <button onClick={() => chargerLogs(0)} className="text-xs text-orange-600 hover:underline">↻ Actualiser</button>
          </div>
          {hsLogs.length === 0 && !loadingLogs ? (
            <p className="text-xs text-slate-400 italic">Aucune activité HubSpot enregistrée</p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {hsLogs.map((log, i) => (
                <div key={log.id || i} className="flex items-start gap-2.5 py-2 border-b border-slate-50 last:border-0">
                  <span className="text-sm flex-shrink-0 mt-0.5">{hsLogIcon(log.type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-700">{hsLogDescription(log)}</div>
                    {log.erreur && <div className="text-xs text-red-500 mt-0.5">{log.erreur}</div>}
                  </div>
                  <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">{formatDateLog(log.created_at)}</span>
                </div>
              ))}
            </div>
          )}
          {loadingLogs && <div className="text-xs text-slate-400 text-center py-2">Chargement...</div>}
          {hsLogsOffset < hsLogsTotal && !loadingLogs && (
            <button onClick={() => chargerLogs(hsLogsOffset, true)} className="w-full mt-2 py-2 text-xs text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
              Voir plus ({hsLogsTotal - hsLogsOffset} restants)
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Modal Qualification Lead ──────────────────────────────────────────────────
const ModalQualification = ({ email, onClose, onSuccess, sequences, showToast }) => {
  useEscapeClose(onClose);
  const [form, setForm] = useState({
    email,
    prenom: '',
    nom: '',
    hotel: '',
    ville: '',
    segment: '5*',
    poste: '',
    company_hubspot_id: null,
    create_deal: false,
    deal_amount: 0,
    deal_name: '',
    create_task: true,
    task_subject: '',
    sequence_id: sequences[0]?.id || null
  });
  const [companies, setCompanies] = useState([]);
  const [queryCompany, setQueryCompany] = useState('');
  const [searchingHS, setSearchingHS] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const searchTimer = useRef(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const rechercherCompany = (q) => {
    setQueryCompany(q);
    clearTimeout(searchTimer.current);
    if (!q || q.length < 2) { setCompanies([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearchingHS(true);
      try {
        const res = await api.get(`/hubspot/recherche-companies?q=${encodeURIComponent(q)}`);
        setCompanies(Array.isArray(res) ? res : []);
      } catch(e) { setCompanies([]); }
      setSearchingHS(false);
    }, 400);
  };

  const selectionnerCompany = (company) => {
    set('company_hubspot_id', company.id);
    set('hotel', company.nom);
    set('ville', company.ville || '');
    set('deal_name', `Deal - ${company.nom}`);
    setCompanies([]);
    setQueryCompany(company.nom);
  };

  const handleSubmit = async () => {
    if (!form.prenom || !form.hotel) {
      setError('Prénom et établissement requis');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const result = await api.post('/qualification/create-and-launch', form);

      if (result.errors && result.errors.length > 0) {
        setError(`Lead créé mais : ${result.errors.join(', ')}`);
      }

      if (showToast) showToast(`Lead qualifié : ${result.lead?.email}${result.sequence ? ` — séquence lancée` : ''}`, 'success');

      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Erreur lors de la qualification');
    }

    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Qualifier le lead</h3>
            <p className="text-xs text-slate-500 mt-1">Créer lead → HubSpot → Séquence</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Recherche HubSpot Company */}
          <div className="relative">
            <label className="text-xs font-medium text-slate-600 mb-2 block">Rechercher établissement (HubSpot)</label>
            <input
              value={queryCompany}
              onChange={e => rechercherCompany(e.target.value)}
              placeholder="Nom de l'hôtel, restaurant..."
              className="w-full border border-orange-200 bg-orange-50 rounded-lg px-3 py-2 text-sm"
            />
            {searchingHS && <span className="absolute right-3 top-9 text-xs text-slate-400">⟳</span>}
            {companies.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {companies.map(c => (
                  <button key={c.id} onClick={() => selectionnerCompany(c)}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                    <div className="text-sm font-medium text-slate-800">{c.nom}</div>
                    <div className="text-xs text-slate-400">{c.domaine} {c.ville ? `· ${c.ville}` : ""}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Informations lead */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-600 mb-3">Informations du lead</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Prénom *</label>
                <input value={form.prenom} onChange={e => set('prenom', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Nom</label>
                <input value={form.nom} onChange={e => set('nom', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs text-slate-500 mb-1 block">Email</label>
              <input value={form.email} disabled className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Établissement *</label>
                <input value={form.hotel} onChange={e => set('hotel', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Ville</label>
                <input value={form.ville} onChange={e => set('ville', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs text-slate-500 mb-1 block">Poste / Fonction</label>
              <input value={form.poste} onChange={e => set('poste', e.target.value)} placeholder="Directeur, Spa Manager..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="mt-3">
              <label className="text-xs text-slate-500 mb-1 block">Segment</label>
              <select value={form.segment} onChange={e => set('segment', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                {getSegments().map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* HubSpot Deal */}
          <div className="border-t border-slate-100 pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.create_deal} onChange={e => set('create_deal', e.target.checked)} className="rounded accent-blue-600" />
              <span className="text-xs font-medium text-slate-600">Créer un deal dans HubSpot</span>
            </label>
            {form.create_deal && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Nom du deal</label>
                  <input value={form.deal_name} onChange={e => set('deal_name', e.target.value)} placeholder="Deal - Hotel X" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Montant (€)</label>
                  <input type="number" value={form.deal_amount} onChange={e => set('deal_amount', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            )}
          </div>

          {/* HubSpot Task */}
          <div className="border-t border-slate-100 pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.create_task} onChange={e => set('create_task', e.target.checked)} className="rounded accent-blue-600" />
              <span className="text-xs font-medium text-slate-600">Créer une tâche dans HubSpot</span>
            </label>
            {form.create_task && (
              <div className="mt-3">
                <label className="text-xs text-slate-500 mb-1 block">Sujet de la tâche</label>
                <input value={form.task_subject} onChange={e => set('task_subject', e.target.value)} placeholder={`Contacter ${form.prenom || '...'}`} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            )}
          </div>

          {/* Séquence */}
          <div className="border-t border-slate-100 pt-4">
            <label className="text-xs font-medium text-slate-600 mb-2 block">Lancer dans une séquence (optionnel)</label>
            <select value={form.sequence_id || ''} onChange={e => set('sequence_id', e.target.value || null)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <option value="">Aucune séquence</option>
              {sequences.map(seq => (
                <option key={seq.id} value={seq.id}>{seq.nom} ({seq.etapes?.length || 0} emails)</option>
              ))}
            </select>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{error}</div>}
        </div>

        <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3 flex-shrink-0 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
          <button onClick={handleSubmit} disabled={saving} className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50">
            {saving ? "Qualification..." : "✅ Qualifier le lead"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── VUE VALIDATION EMAIL ─────────────────────────────────────────────────────

const ZB_STATUS_CONFIG = {
  valid:       { label: "Valide",       bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", desc: "Adresse vérifiée et réelle" },
  invalid:     { label: "Invalide",     bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500",     desc: "Adresse inexistante ou rejetée" },
  catch_all:   { label: "Catch-all",    bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-400",   desc: "Domaine accepte tout, non vérifiable" },
  unknown:     { label: "Inconnu",      bg: "bg-slate-50",   text: "text-slate-500",   dot: "bg-slate-300",   desc: "Temporairement non vérifiable" },
  spamtrap:    { label: "Spam trap",    bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-600",     desc: "Piège à spam — ne pas contacter" },
  abuse:       { label: "Abuse",        bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-600",     desc: "Compte abusif" },
  do_not_mail: { label: "Do not mail",  bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500",     desc: "À ne pas contacter" },
};

const ZbBadge = ({ status }) => {
  const cfg = ZB_STATUS_CONFIG[status] || ZB_STATUS_CONFIG["unknown"];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
};

const VueValidationEmail = ({ leads, sequences, onRefresh, showToast }) => {
  const [zbKey, setZbKey] = useState("");
  const [zbConfigured, setZbConfigured] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState("");
  const [credits, setCredits] = useState(null);

  // Validation unitaire
  const [singleEmail, setSingleEmail] = useState("");
  const [singleResult, setSingleResult] = useState(null);
  const [singleLoading, setSingleLoading] = useState(false);
  const [validationHistory, setValidationHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('validationHistory') || '[]'); } catch { return []; }
  });

  // Modal qualification
  const [showQualificationModal, setShowQualificationModal] = useState(false);
  const [qualificationEmail, setQualificationEmail] = useState("");

  // Email Finder
  const [finderPrenom, setFinderPrenom] = useState('');
  const [finderNom, setFinderNom] = useState('');
  const [finderDomaine, setFinderDomaine] = useState('');
  const [finderResults, setFinderResults] = useState(null);
  const [finderLoading, setFinderLoading] = useState(false);

  // Validation bulk
  const [bulkSource, setBulkSource] = useState("leads"); // "leads" | "brut"
  const [bulkRawText, setBulkRawText] = useState("");
  const [bulkMode, setBulkMode] = useState("tous"); // "tous" | "non_verifies"
  const [bulkResults, setBulkResults] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkErreur, setBulkErreur] = useState("");
  const [filterBulk, setFilterBulk] = useState("tous");
  const bulkAbortRef = useRef(false);

  const leadsNorm = leads.map(l => ({ ...l, statut_email: l.statut_email || null }));

  const chargerCredits = async () => {
    try {
      const r = await api.get("/email-validation/credits");
      if (r.Credits !== undefined) setCredits(r.Credits);
    } catch(e) { showToast?.("Erreur chargement crédits ZeroBounce", "error"); }
  };

  // Persister l'historique de validation dans localStorage
  useEffect(() => {
    try { localStorage.setItem('validationHistory', JSON.stringify(validationHistory)); } catch {}
  }, [validationHistory]);

  // Charger config ZeroBounce au montage — via /health (variable Railway)
  useEffect(() => {
    api.get("/health").then(h => {
      if (h.zerobounce === 'configuré') {
        setZbConfigured(true);
        chargerCredits();
      }
    }).catch(e => console.error(e));
  }, []);

  const sauvegarderCle = async () => {
    if (!zbKey.trim()) return;
    setSavingKey(true); setKeyMsg("");
    try {
      await api.post("/config", { zerobounce_api_key: zbKey });
      setZbConfigured(true); setZbKey("");
      setKeyMsg("✅ Clé ZeroBounce sauvegardée");
      chargerCredits();
    } catch(e) { setKeyMsg("❌ Erreur"); }
    setSavingKey(false);
  };

  // Validation d'un seul email
  const validerSingle = async () => {
    if (!singleEmail.trim()) return;
    setSingleLoading(true); setSingleResult(null);
    try {
      const r = await api.post("/email-validation/single", { email: singleEmail.trim() });
      setSingleResult(r);
      if (!r.error) {
        setValidationHistory(h => [{ email: singleEmail.trim(), ...r, heure: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }, ...h].slice(0, 50));
      }
    } catch(e) { setSingleResult({ error: e.message }); }
    setSingleLoading(false);
  };

  const ouvrirQualification = () => {
    setQualificationEmail(singleEmail.trim());
    setShowQualificationModal(true);
  };

  // Email Finder
  const lancerFinder = async () => {
    if (!finderPrenom.trim() || !finderNom.trim() || !finderDomaine.trim()) return;
    setFinderLoading(true);
    setFinderResults(null);
    try {
      const r = await api.post('/email-validation/find', {
        prenom: finderPrenom.trim(),
        nom: finderNom.trim(),
        domaine: finderDomaine.trim().replace(/^@/, ''),
      });
      setFinderResults(r);
      chargerCredits();
    } catch (e) {
      setFinderResults({ error: e.message });
    }
    setFinderLoading(false);
  };

  // Validation bulk
  const validerBulk = async () => {
    const toVerify = bulkMode === "non_verifies"
      ? leadsNorm.filter(l => !l.statut_email)
      : leadsNorm;
    if (!toVerify.length) { setBulkErreur("Aucun lead à vérifier"); return; }

    bulkAbortRef.current = false;
    setBulkLoading(true); setBulkResults([]); setBulkProgress(0);
    setBulkTotal(toVerify.length); setBulkErreur("");

    const results = [];
    for (let i = 0; i < toVerify.length; i++) {
      if (bulkAbortRef.current) break; // arrêt propre dès le prochain cycle
      try {
        const r = await api.post("/email-validation/single", { email: toVerify[i].email, lead_id: toVerify[i].id });
        results.push({ ...toVerify[i], zb: r });
      } catch(e) {
        results.push({ ...toVerify[i], zb: { status: "unknown", error: e.message } });
      }
      setBulkProgress(i + 1);
      setBulkResults([...results]);
      await new Promise(r => setTimeout(r, 250)); // rate limit ZeroBounce
    }
    setBulkLoading(false);
    if (!bulkAbortRef.current) {
      chargerCredits();
      if (onRefresh) onRefresh();
    }
  };

  const stopBulk = () => { bulkAbortRef.current = true; setBulkLoading(false); };

  // Validation bulk emails bruts
  const validerBulkBrut = async () => {
    const emails = [...new Set(bulkRawText.split(/[\n,;]+/).map(e => e.trim()).filter(e => e && e.includes('@')))];
    if (!emails.length) { setBulkErreur("Aucun email valide trouvé"); return; }

    bulkAbortRef.current = false;
    setBulkLoading(true); setBulkResults([]); setBulkProgress(0);
    setBulkTotal(emails.length); setBulkErreur("");

    const results = [];
    for (let i = 0; i < emails.length; i++) {
      if (bulkAbortRef.current) break;
      try {
        const r = await api.post("/email-validation/single", { email: emails[i] });
        results.push({ id: `brut-${i}`, email: emails[i], prenom: '', nom: '', hotel: '', zb: r });
      } catch(e) {
        results.push({ id: `brut-${i}`, email: emails[i], prenom: '', nom: '', hotel: '', zb: { status: "unknown", error: e.message } });
      }
      setBulkProgress(i + 1);
      setBulkResults([...results]);
      await new Promise(r => setTimeout(r, 250));
    }
    setBulkLoading(false);
    if (!bulkAbortRef.current) chargerCredits();
  };

  const STATUTS_BULK = ["tous", "valid", "invalid", "catch_all", "unknown", "spamtrap", "do_not_mail"];
  const resultsFiltres = filterBulk === "tous" ? bulkResults : bulkResults.filter(r => r.zb?.status === filterBulk);

  const stats = bulkResults.reduce((acc, r) => {
    const s = r.zb?.status || "unknown";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Config clé API ── */}
      <div className={`rounded-2xl border p-5 ${zbConfigured ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-100"}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${zbConfigured ? "bg-emerald-100" : "bg-slate-100"}`}>✉️</div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">ZeroBounce</h3>
              <p className={`text-xs ${zbConfigured ? "text-emerald-600" : "text-slate-400"}`}>
                {zbConfigured ? `Connecté${credits !== null ? ` · ${credits.toLocaleString()} crédits restants` : ""}` : "Clé API requise"}
              </p>
            </div>
          </div>
          {zbConfigured && (
            <button onClick={chargerCredits} className="text-xs text-emerald-600 hover:underline">↻ Actualiser crédits</button>
          )}
        </div>
        {!zbConfigured && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            Ajouter <code className="font-mono bg-amber-100 px-1 rounded">ZEROBOUNCE_API_KEY</code> dans les variables Railway pour activer la validation.
          </div>
        )}
      </div>

      {zbConfigured && (
        <>
          {/* ── Validation unitaire ── */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Vérification rapide</h3>
            <div className="flex gap-2">
              <input value={singleEmail} onChange={e => setSingleEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && validerSingle()} placeholder="test@domaine.com" className="flex-1 border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              <button onClick={validerSingle} disabled={singleLoading || !singleEmail.trim()} className="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap">
                {singleLoading ? <span className="flex items-center gap-2"><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Vérification...</span> : "Vérifier"}
              </button>
            </div>

            {singleResult && !singleResult.error && (
              <div className="mt-4 bg-slate-50 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><div className="text-xs text-slate-400 mb-1">Statut</div><ZbBadge status={singleResult.status} /></div>
                <div><div className="text-xs text-slate-400 mb-1">Score qualité</div><div className="text-sm font-semibold text-slate-800">{singleResult.quality_score ?? "—"}<span className="text-xs text-slate-400 font-normal"> / 10</span></div></div>
                <div><div className="text-xs text-slate-400 mb-1">Domaine</div><div className="text-sm font-medium text-slate-700">{singleResult.domain || "—"}</div></div>
                <div><div className="text-xs text-slate-400 mb-1">MX valide</div><div className={`text-sm font-medium ${singleResult.mx_found === "true" || singleResult.mx_found === true ? "text-emerald-600" : "text-red-500"}`}>{singleResult.mx_found === "true" || singleResult.mx_found === true ? "✓ Oui" : "✗ Non"}</div></div>
                <div><div className="text-xs text-slate-400 mb-1">Free email</div><div className="text-sm font-medium text-slate-700">{singleResult.free_email === "true" || singleResult.free_email === true ? "Oui" : "Non"}</div></div>
                <div><div className="text-xs text-slate-400 mb-1">Rôle</div><div className="text-sm font-medium text-slate-700">{singleResult.is_role_based ? "Oui (info@, etc.)" : "Non"}</div></div>
                <div className="col-span-2"><div className="text-xs text-slate-400 mb-1">Sous-statut</div><div className="text-sm text-slate-600">{singleResult.sub_status || "—"}</div></div>
                {(ZB_STATUS_CONFIG[singleResult.status]) && (
                  <div className="col-span-4 text-xs text-slate-400 italic">{ZB_STATUS_CONFIG[singleResult.status].desc}</div>
                )}
              </div>
            )}
            {singleResult?.error && <p className="mt-3 text-xs text-red-500">✗ {singleResult.error}</p>}
            {singleResult && !singleResult.error && singleResult.status !== 'spamtrap' && singleResult.status !== 'invalid' && (
              <button onClick={ouvrirQualification} className={`mt-3 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                singleResult.status === 'valid' || singleResult.status === 'catch_all'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-amber-500 hover:bg-amber-600 text-white'
              }`}>
                Qualifier ce lead
              </button>
            )}

            {/* Historique des validations unitaires */}
            {validationHistory.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-slate-500">Historique ({validationHistory.length})</h4>
                  <button onClick={() => setValidationHistory([])} className="text-xs text-slate-400 hover:text-slate-600">Effacer</button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full text-xs min-w-[400px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-3 py-1.5 text-[11px] font-medium text-slate-400">Email</th>
                        <th className="text-left px-3 py-1.5 text-[11px] font-medium text-slate-400">Statut</th>
                        <th className="text-left px-3 py-1.5 text-[11px] font-medium text-slate-400">Score</th>
                        <th className="text-left px-3 py-1.5 text-[11px] font-medium text-slate-400">Heure</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validationHistory.map((h, i) => (
                        <tr key={i} className="border-t border-slate-50">
                          <td className="px-3 py-1.5 font-mono text-slate-700">{h.email}</td>
                          <td className="px-3 py-1.5"><ZbBadge status={h.status} /></td>
                          <td className="px-3 py-1.5 text-slate-500">{h.quality_score ?? "—"}</td>
                          <td className="px-3 py-1.5 text-slate-400">{h.heure}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Email Finder ── */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Email Finder</h3>
            <p className="text-xs text-slate-400 mb-4">Trouvez l'email d'un contact en testant tous les patterns possibles (prénom.nom@, nom.prénom@, initiale+nom@, etc.)</p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Prénom</label>
                <input type="text" value={finderPrenom} onChange={e => setFinderPrenom(e.target.value)} placeholder="Jean" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Nom</label>
                <input type="text" value={finderNom} onChange={e => setFinderNom(e.target.value)} placeholder="Dupont" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Domaine</label>
                <input type="text" value={finderDomaine} onChange={e => setFinderDomaine(e.target.value)} onKeyDown={e => e.key === 'Enter' && lancerFinder()} placeholder="hotel-paris.com" className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
            </div>
            <button onClick={lancerFinder} disabled={finderLoading || !finderPrenom.trim() || !finderNom.trim() || !finderDomaine.trim()} className="px-5 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50">
              {finderLoading ? (
                <span className="flex items-center gap-2"><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Recherche en cours...</span>
              ) : 'Trouver l\'email'}
            </button>

            {finderResults && !finderResults.error && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-500">{finderResults.credits_used || finderResults.patterns.length} crédits utilisés pour <span className="font-medium">{finderResults.prenom} {finderResults.nom}</span> @ {finderResults.domaine}</span>
                  {(() => {
                    const valid = finderResults.patterns.filter(p => p.status === 'valid');
                    return valid.length > 0 && <span className="text-xs font-semibold text-emerald-600">{valid.length} email{valid.length > 1 ? 's' : ''} trouvé{valid.length > 1 ? 's' : ''} !</span>;
                  })()}
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Email</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Statut</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Score</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-slate-400">Sous-statut</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-slate-400">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finderResults.patterns.map((p, i) => (
                        <tr key={i} className={`border-b border-slate-50 ${p.status === 'valid' ? 'bg-emerald-50/50' : p.status === 'catch_all' ? 'bg-amber-50/30' : ''}`}>
                          <td className="px-4 py-2 font-mono text-xs text-slate-700">{p.email}</td>
                          <td className="px-4 py-2"><ZbBadge status={p.status} /></td>
                          <td className="px-4 py-2 text-xs text-slate-500">{p.quality_score ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-slate-400">{p.sub_status || '—'}</td>
                          <td className="px-4 py-2 text-right">
                            {(p.status === 'valid' || p.status === 'catch_all') && (
                              <button onClick={() => { setSingleEmail(p.email); setQualificationEmail(p.email); setShowQualificationModal(true); }} className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium">
                                Qualifier
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {finderResults?.error && <p className="mt-3 text-xs text-red-500">{finderResults.error}</p>}
          </div>

          {/* ── Validation bulk ── */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Validation en masse</h3>
                <p className="text-xs text-slate-400 mt-0.5">{bulkSource === "leads" ? `${leadsNorm.length} leads au total · ${leadsNorm.filter(l => !l.statut_email).length} non vérifiés` : "Coller des emails bruts"}</p>
              </div>
              {bulkResults.length > 0 && (
                <div className="flex gap-2 text-xs">
                  {["valid","invalid","catch_all","unknown"].map(s => stats[s] ? (
                    <span key={s} className={`px-2 py-1 rounded-full font-medium ${ZB_STATUS_CONFIG[s]?.bg} ${ZB_STATUS_CONFIG[s]?.text}`}>{stats[s]} {ZB_STATUS_CONFIG[s]?.label}</span>
                  ) : null)}
                </div>
              )}
            </div>

            {/* Source toggle */}
            <div className="flex flex-wrap gap-3 items-center mb-4">
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => { setBulkSource("leads"); setBulkResults([]); }} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${bulkSource === "leads" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
                  Leads existants
                </button>
                <button onClick={() => { setBulkSource("brut"); setBulkResults([]); }} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${bulkSource === "brut" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
                  Coller des emails
                </button>
              </div>
            </div>

            {/* Mode leads */}
            {bulkSource === "leads" && (
            <div className="flex flex-wrap gap-3 items-center mb-4">
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setBulkMode("non_verifies")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${bulkMode === "non_verifies" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
                  Non vérifiés ({leadsNorm.filter(l => !l.statut_email).length})
                </button>
                <button onClick={() => setBulkMode("tous")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${bulkMode === "tous" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
                  Tous ({leadsNorm.length})
                </button>
              </div>
              {!bulkLoading ? (
                <button onClick={validerBulk} disabled={!leadsNorm.length} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50">
                  Lancer la validation
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="w-4 h-4 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
                    {bulkProgress} / {bulkTotal}
                  </div>
                  <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-slate-700 rounded-full transition-all" style={{ width: `${bulkTotal ? (bulkProgress/bulkTotal)*100 : 0}%` }} />
                  </div>
                  <button onClick={stopBulk} className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Arrêter</button>
                </div>
              )}
              {bulkErreur && <span className="text-xs text-red-500">{bulkErreur}</span>}
            </div>
            )}

            {/* Mode emails bruts */}
            {bulkSource === "brut" && (
            <div className="mb-4 space-y-3">
              <textarea value={bulkRawText} onChange={e => setBulkRawText(e.target.value)} rows={4} placeholder="Collez des emails (un par ligne, ou séparés par virgule / point-virgule)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              <div className="flex items-center gap-3">
                {!bulkLoading ? (
                  <button onClick={validerBulkBrut} disabled={!bulkRawText.trim()} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50">
                    Lancer la validation
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="w-4 h-4 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
                      {bulkProgress} / {bulkTotal}
                    </div>
                    <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-700 rounded-full transition-all" style={{ width: `${bulkTotal ? (bulkProgress/bulkTotal)*100 : 0}%` }} />
                    </div>
                    <button onClick={stopBulk} className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">Arrêter</button>
                  </div>
                )}
                {bulkErreur && <span className="text-xs text-red-500">{bulkErreur}</span>}
              </div>
            </div>
            )}

            {bulkResults.length > 0 && (
              <>
                <div className="flex gap-1 flex-wrap mb-3">
                  {STATUTS_BULK.map(s => (
                    <button key={s} onClick={() => setFilterBulk(s)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterBulk === s ? "bg-slate-900 text-white" : "bg-slate-50 border border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                      {s === "tous" ? `Tous (${bulkResults.length})` : `${ZB_STATUS_CONFIG[s]?.label || s}${stats[s] ? ` (${stats[s]})` : ""}`}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-100">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        {["Lead", "Email", "Statut", "Score", "Sous-statut", "Domaine"].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {resultsFiltres.map((r, i) => (
                        <tr key={r.id} className={`border-b border-slate-50 ${i % 2 === 0 ? "" : "bg-slate-50/30"}`}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-800 text-xs">{r.prenom} {r.nom}</div>
                            <div className="text-xs text-slate-400">{r.hotel}</div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600 font-mono">{r.email}</td>
                          <td className="px-4 py-2.5"><ZbBadge status={r.zb?.status || "unknown"} /></td>
                          <td className="px-4 py-2.5">
                            {r.zb?.quality_score != null ? (
                              <div className="flex items-center gap-1.5">
                                <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${r.zb.quality_score >= 7 ? "bg-emerald-500" : r.zb.quality_score >= 4 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${r.zb.quality_score * 10}%` }} />
                                </div>
                                <span className="text-xs text-slate-500">{r.zb.quality_score}</span>
                              </div>
                            ) : <span className="text-xs text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{r.zb?.sub_status || "—"}</td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{r.zb?.domain || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {resultsFiltres.length === 0 && <div className="text-center py-8 text-xs text-slate-400">Aucun résultat pour ce filtre</div>}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Modal Qualification */}
      {showQualificationModal && (
        <ModalQualification
          email={qualificationEmail}
          sequences={sequences || []}
          showToast={showToast}
          onClose={() => setShowQualificationModal(false)}
          onSuccess={() => {
            setShowQualificationModal(false);
            setSingleEmail("");
            setSingleResult(null);
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </div>
  );
};

// ─── Factures Analytics (Dashboard CA) ────────────────────────────────────────
const FacturesAnalytics = ({ showToast }) => {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/factures/analytics?year=${year}&limit=1000`);
      setAnalytics(data);
    } catch (err) {
      showToast('Erreur chargement analytics: ' + err.message, 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAnalytics();
  }, [year]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Chargement des analytics...</p>
        </div>
      </div>
    );
  }

  if (!analytics) return null;

  const monthsData = Object.entries(analytics.byMonth || {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12); // 12 derniers mois

  return (
    <div className="space-y-6">
      {/* Filtres */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Année :</label>
          <select value={year} onChange={e => setYear(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
            <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>
            <option value={new Date().getFullYear() - 1}>{new Date().getFullYear() - 1}</option>
            <option value={new Date().getFullYear() - 2}>{new Date().getFullYear() - 2}</option>
            <option value="">Toutes les années</option>
          </select>
          <button onClick={loadAnalytics}
            className="ml-auto px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800">
            🔄 Rafraîchir
          </button>
        </div>
      </div>

      {/* Stats principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
          <div className="text-xs font-medium text-blue-600 mb-2 uppercase tracking-wide">Chiffre d'Affaires HT</div>
          <div className="text-3xl font-bold text-blue-900">{analytics.total.ca_ht.toLocaleString('fr-FR')}€</div>
          <div className="text-sm text-blue-700 mt-2">{analytics.total.invoices} factures</div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-6 border border-emerald-200">
          <div className="text-xs font-medium text-emerald-600 mb-2 uppercase tracking-wide">Chiffre d'Affaires TTC</div>
          <div className="text-3xl font-bold text-emerald-900">{analytics.total.ca_ttc.toLocaleString('fr-FR')}€</div>
          <div className="text-sm text-emerald-700 mt-2">TVA: {(analytics.total.ca_ttc - analytics.total.ca_ht).toLocaleString('fr-FR')}€</div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
          <div className="text-xs font-medium text-purple-600 mb-2 uppercase tracking-wide">Facture Moyenne</div>
          <div className="text-3xl font-bold text-purple-900">
            {analytics.total.invoices > 0 ? Math.round(analytics.total.ca_ht / analytics.total.invoices).toLocaleString('fr-FR') : 0}€
          </div>
          <div className="text-sm text-purple-700 mt-2">HT par facture</div>
        </div>
      </div>

      {/* CA par mois */}
      <div className="bg-white rounded-xl border border-slate-100 p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Évolution mensuelle</h3>
        <div className="space-y-2">
          {monthsData.map(([month, data]) => {
            const maxCA = Math.max(...monthsData.map(([, d]) => d.ca_ht));
            const widthPercent = (data.ca_ht / maxCA) * 100;
            return (
              <div key={month} className="flex items-center gap-3">
                <div className="text-xs font-mono text-slate-500 w-20">{month}</div>
                <div className="flex-1 bg-slate-100 rounded-full h-8 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full flex items-center px-3"
                    style={{ width: `${widthPercent}%` }}
                  >
                    {widthPercent > 15 && (
                      <span className="text-xs font-medium text-white">
                        {data.ca_ht.toLocaleString('fr-FR')}€
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-500 w-16 text-right">{data.count} fact.</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top clients */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Top 10 Clients</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">#</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Client</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">CA HT</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">CA TTC</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Factures</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Panier moyen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analytics.topClients.map((client, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-6 py-3 text-sm font-medium text-slate-500">{i + 1}</td>
                  <td className="px-6 py-3 text-sm font-medium text-slate-900">{client.name}</td>
                  <td className="px-6 py-3 text-sm text-right font-medium text-slate-900">
                    {client.ca_ht.toLocaleString('fr-FR')}€
                  </td>
                  <td className="px-6 py-3 text-sm text-right text-slate-600">
                    {client.ca_ttc.toLocaleString('fr-FR')}€
                  </td>
                  <td className="px-6 py-3 text-sm text-right text-slate-600">{client.count}</td>
                  <td className="px-6 py-3 text-sm text-right text-slate-600">
                    {Math.round(client.ca_ht / client.count).toLocaleString('fr-FR')}€
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Factures récentes */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">Dernières factures</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Numéro</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Client</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Date</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Montant HT</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Montant TTC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analytics.recentInvoices.map((inv, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-6 py-3 text-sm font-medium text-slate-900">{inv.number}</td>
                  <td className="px-6 py-3 text-sm text-slate-700">{inv.client}</td>
                  <td className="px-6 py-3 text-sm text-slate-500">
                    {new Date(inv.date).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-6 py-3 text-sm text-right font-medium text-slate-900">
                    {inv.amount_ht.toLocaleString('fr-FR')}€
                  </td>
                  <td className="px-6 py-3 text-sm text-right text-slate-600">
                    {inv.amount_ttc.toLocaleString('fr-FR')}€
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Analytics Spreadsheet (Dashboard Commercial Professionnel) ──────────────
const AnalyticsSpreadsheet = ({ showToast }) => {
  // State management
  const [viewMode, setViewMode] = useState('global'); // 'global' | 'client' | 'comparison'
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  // Client search state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientDetails, setClientDetails] = useState(null);

  // Years comparison state
  const [yearsComparison, setYearsComparison] = useState(null);
  const [selectedYears, setSelectedYears] = useState([new Date().getFullYear(), new Date().getFullYear() - 1]);

  // Chart refs
  const monthlyChartRef = useRef(null);
  const topClientsChartRef = useRef(null);
  const clientMonthlyChartRef = useRef(null);
  const comparisonChartRef = useRef(null);
  const commissionsChartRef = useRef(null);

  // Chart instances
  const monthlyChartInstance = useRef(null);
  const topClientsChartInstance = useRef(null);
  const clientMonthlyChartInstance = useRef(null);
  const comparisonChartInstance = useRef(null);
  const commissionsChartInstance = useRef(null);

  // Load global analytics
  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/gsheets/analytics?year=${year}`);
      setAnalytics(data);
    } catch (err) {
      showToast('Erreur chargement analytics: ' + err.message, 'error');
    }
    setLoading(false);
  };

  // Load client details
  const loadClientDetails = async (clientName) => {
    setLoading(true);
    try {
      const data = await api.get(`/gsheets/analytics/client/${encodeURIComponent(clientName)}?year=${year}`);
      setClientDetails(data);
      setSelectedClient(clientName);
    } catch (err) {
      showToast('Erreur chargement client: ' + err.message, 'error');
    }
    setLoading(false);
  };

  // Load years comparison
  const loadYearsComparison = async () => {
    setLoading(true);
    try {
      const data = await api.get('/gsheets/analytics/years-comparison');
      setYearsComparison(data);
    } catch (err) {
      showToast('Erreur chargement comparaison: ' + err.message, 'error');
    }
    setLoading(false);
  };

  // Initial load
  useEffect(() => {
    loadAnalytics();
    loadYearsComparison();
  }, [year]);

  // Cleanup charts on unmount
  useEffect(() => {
    return () => {
      if (monthlyChartInstance.current) monthlyChartInstance.current.destroy();
      if (topClientsChartInstance.current) topClientsChartInstance.current.destroy();
      if (clientMonthlyChartInstance.current) clientMonthlyChartInstance.current.destroy();
      if (comparisonChartInstance.current) comparisonChartInstance.current.destroy();
      if (commissionsChartInstance.current) commissionsChartInstance.current.destroy();
    };
  }, []);

  // Create monthly evolution chart
  useEffect(() => {
    if (!monthlyChartRef.current || !analytics || viewMode !== 'global') return;

    if (monthlyChartInstance.current) {
      monthlyChartInstance.current.destroy();
    }

    const monthsData = Object.entries(analytics.byMonth || {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12);

    const ctx = monthlyChartRef.current.getContext('2d');
    monthlyChartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: monthsData.map(([month]) => month),
        datasets: [{
          label: 'CA HT',
          data: monthsData.map(([, data]) => data.ca_ht),
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.y.toLocaleString('fr-FR')}€`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => `${value.toLocaleString('fr-FR')}€`
            }
          }
        }
      }
    });
  }, [analytics, viewMode]);

  // Create top clients chart
  useEffect(() => {
    if (!topClientsChartRef.current || !analytics || viewMode !== 'global') return;

    if (topClientsChartInstance.current) {
      topClientsChartInstance.current.destroy();
    }

    const topClients = (analytics.topClients || []).slice(0, 10);

    const ctx = topClientsChartRef.current.getContext('2d');
    topClientsChartInstance.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: topClients.map(c => c.name.length > 20 ? c.name.substring(0, 20) + '...' : c.name),
        datasets: [{
          label: 'CA HT',
          data: topClients.map(c => c.ca_ht),
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.x.toLocaleString('fr-FR')}€`
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              callback: (value) => `${value.toLocaleString('fr-FR')}€`
            }
          }
        }
      }
    });
  }, [analytics, viewMode]);

  // Create client monthly chart
  useEffect(() => {
    if (!clientMonthlyChartRef.current || !clientDetails || viewMode !== 'client') return;

    if (clientMonthlyChartInstance.current) {
      clientMonthlyChartInstance.current.destroy();
    }

    // Extract monthly data from client invoices
    const monthlyData = {};
    (clientDetails.invoices || []).forEach(inv => {
      const month = inv.date ? inv.date.substring(0, 7) : 'Unknown';
      if (!monthlyData[month]) monthlyData[month] = 0;
      monthlyData[month] += inv.totalHT || 0;
    });

    const sortedMonths = Object.entries(monthlyData).sort((a, b) => a[0].localeCompare(b[0]));

    const ctx = clientMonthlyChartRef.current.getContext('2d');
    clientMonthlyChartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sortedMonths.map(([month]) => month),
        datasets: [{
          label: 'CA HT mensuel',
          data: sortedMonths.map(([, amount]) => amount),
          borderColor: 'rgb(147, 51, 234)',
          backgroundColor: 'rgba(147, 51, 234, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.y.toLocaleString('fr-FR')}€`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => `${value.toLocaleString('fr-FR')}€`
            }
          }
        }
      }
    });
  }, [clientDetails, viewMode]);

  // Create commissions chart
  useEffect(() => {
    if (!commissionsChartRef.current || !analytics || viewMode !== 'commissions') return;

    if (commissionsChartInstance.current) {
      commissionsChartInstance.current.destroy();
    }

    const monthsData = Object.entries(analytics.byMonth || {})
      .sort((a, b) => a[0].localeCompare(b[0]));

    const ctx = commissionsChartRef.current.getContext('2d');
    commissionsChartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: monthsData.map(([month]) => {
          const date = new Date(month + '-01');
          return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short' });
        }),
        datasets: [
          {
            label: 'Commission Brute (15%)',
            data: monthsData.map(([, data]) => (data.ca_ht || 0) * 0.15),
            borderColor: 'rgb(59, 130, 246)',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
            fill: true,
            yAxisID: 'y'
          },
          {
            label: 'Taxes (23.04%)',
            data: monthsData.map(([, data]) => (data.ca_ht || 0) * 0.15 * 0.2304),
            borderColor: 'rgb(239, 68, 68)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            tension: 0.4,
            fill: true,
            yAxisID: 'y'
          },
          {
            label: 'Commission Nette',
            data: monthsData.map(([, data]) => (data.ca_ht || 0) * 0.15 * 0.7696),
            borderColor: 'rgb(16, 185, 129)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.4,
            fill: true,
            borderWidth: 3,
            yAxisID: 'y'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top'
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || '';
                const value = Math.round(context.parsed.y).toLocaleString('fr-FR');
                return `${label}: ${value}€`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => `${value.toLocaleString('fr-FR')}€`
            }
          }
        }
      }
    });
    return () => { if (commissionsChartInstance.current) { commissionsChartInstance.current.destroy(); commissionsChartInstance.current = null; } };
  }, [analytics, viewMode]);

  // Create years comparison chart
  useEffect(() => {
    if (!comparisonChartRef.current || !yearsComparison || viewMode !== 'comparison') return;

    if (comparisonChartInstance.current) {
      comparisonChartInstance.current.destroy();
    }

    const filteredYears = (yearsComparison.years || []).filter(y => selectedYears.includes(y.year));

    // Create cumulative monthly data
    const allMonths = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12

    const datasets = filteredYears.map((yearData, idx) => {
      const colors = [
        'rgb(59, 130, 246)',
        'rgb(16, 185, 129)',
        'rgb(147, 51, 234)',
        'rgb(249, 115, 22)',
        'rgb(236, 72, 153)'
      ];

      const isCurrentYear = parseInt(yearData.year) === currentYear;

      const cumulativeData = allMonths.map((month, monthIdx) => {
        // Pour l'année en cours, ne pas afficher les mois futurs
        if (isCurrentYear && (monthIdx + 1) > currentMonth) {
          return null;
        }
        const monthData = yearData.byMonth?.[month];
        return monthData?.cumulative_ht || 0;
      });

      return {
        label: `${yearData.year}`,
        data: cumulativeData,
        borderColor: colors[idx % colors.length],
        backgroundColor: 'transparent',
        tension: 0.4
      };
    });

    const ctx = comparisonChartRef.current.getContext('2d');
    comparisonChartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: allMonths.map(m => `Mois ${parseInt(m)}`),
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top'
          },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString('fr-FR')}€`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => `${value.toLocaleString('fr-FR')}€`
            }
          }
        }
      }
    });
    return () => { if (comparisonChartInstance.current) { comparisonChartInstance.current.destroy(); comparisonChartInstance.current = null; } };
  }, [yearsComparison, selectedYears, viewMode]);

  // Calculate YTD and comparison
  const calculateYTD = () => {
    if (!analytics?.byMonth) return { current: 0, previous: 0, growth: 0 };

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    let currentYTD = 0;
    let previousYTD = 0;

    Object.entries(analytics.byMonth).forEach(([month, data]) => {
      const [y, m] = month.split('-').map(Number);
      if (y === currentYear && m <= currentMonth) {
        currentYTD += data.ca_ht;
      }
      if (y === currentYear - 1 && m <= currentMonth) {
        previousYTD += data.ca_ht;
      }
    });

    const growth = previousYTD > 0 ? ((currentYTD - previousYTD) / previousYTD * 100) : 0;

    return { current: currentYTD, previous: previousYTD, growth };
  };

  // Filtered clients for search
  const filteredClients = searchTerm.length > 0
    ? (analytics?.allClients || []).filter(c =>
        c.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : [];

  // Calculate growth for client
  const calculateClientGrowth = () => {
    if (!clientDetails?.invoices || clientDetails.invoices.length < 2) return 0;

    const sortedInvoices = [...clientDetails.invoices].sort((a, b) => a.date.localeCompare(b.date));
    const midpoint = Math.floor(sortedInvoices.length / 2);

    const firstHalf = sortedInvoices.slice(0, midpoint).reduce((sum, inv) => sum + inv.totalHT, 0);
    const secondHalf = sortedInvoices.slice(midpoint).reduce((sum, inv) => sum + inv.totalHT, 0);

    return firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf * 100) : 0;
  };

  // Simple linear regression forecast
  const calculateForecast = (yearData) => {
    if (!yearData?.byMonth) return 0;

    const months = Object.entries(yearData.byMonth)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, data], idx) => ({ x: idx, y: data.ca_ht }));

    if (months.length < 3) return 0;

    const n = months.length;
    const sumX = months.reduce((sum, p) => sum + p.x, 0);
    const sumY = months.reduce((sum, p) => sum + p.y, 0);
    const sumXY = months.reduce((sum, p) => sum + p.x * p.y, 0);
    const sumX2 = months.reduce((sum, p) => sum + p.x * p.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Forecast next 3 months
    const nextMonths = [n, n + 1, n + 2];
    const forecast = nextMonths.reduce((sum, x) => sum + (slope * x + intercept), 0);

    return forecast;
  };

  // Available years for comparison
  const availableYears = yearsComparison?.years?.map(y => y.year) || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Chargement des analytics depuis Google Sheets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with tabs */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('global')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'global'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Vue Globale
            </button>
            <button
              onClick={() => setViewMode('client')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'client'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Recherche Client
            </button>
            <button
              onClick={() => setViewMode('comparison')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'comparison'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Comparaison Années
            </button>
            <button
              onClick={() => setViewMode('commissions')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'commissions'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Commissions
            </button>
          </div>
          <div className="flex items-center gap-3">
            {viewMode === 'global' && (
              <>
                <label className="text-sm font-medium text-slate-700">Année:</label>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                >
                  {[0, 1, 2, 3].map(offset => {
                    const y = new Date().getFullYear() - offset;
                    return <option key={y} value={y}>{y}</option>;
                  })}
                </select>
                <button
                  onClick={loadAnalytics}
                  className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800"
                >
                  Rafraîchir
                </button>
              </>
            )}
            <div className="text-xs text-emerald-600 font-medium">
              Source: Google Sheets "log sold"
            </div>
          </div>
        </div>
      </div>

      {/* Vue Globale */}
      {viewMode === 'global' && analytics && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
              <div className="text-xs font-medium text-blue-600 mb-2 uppercase tracking-wide">CA HT Total</div>
              <div className="text-3xl font-bold text-blue-900">
                {(analytics.total?.ca_ht || 0).toLocaleString('fr-FR')}€
              </div>
              <div className="text-sm text-blue-700 mt-2">
                YTD: {calculateYTD().current.toLocaleString('fr-FR')}€
              </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-6 border border-emerald-200">
              <div className="text-xs font-medium text-emerald-600 mb-2 uppercase tracking-wide">CA TTC Total</div>
              <div className="text-3xl font-bold text-emerald-900">
                {(analytics.total?.ca_ttc || 0).toLocaleString('fr-FR')}€
              </div>
              <div className="text-sm text-emerald-700 mt-2">
                TVA: {((analytics.total?.ca_ttc || 0) - (analytics.total?.ca_ht || 0)).toLocaleString('fr-FR')}€
              </div>
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-6 border border-amber-200">
              <div className="text-xs font-medium text-amber-600 mb-2 uppercase tracking-wide">Commission</div>
              <div className="text-3xl font-bold text-amber-900">
                {(analytics.total?.commission || 0).toLocaleString('fr-FR')}€
              </div>
              <div className="text-sm text-amber-700 mt-2">
                {analytics.total?.ca_ht > 0 ? ((analytics.total.commission / analytics.total.ca_ht) * 100).toFixed(1) : 0}% du CA
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
              <div className="text-xs font-medium text-purple-600 mb-2 uppercase tracking-wide">Nb Factures</div>
              <div className="text-3xl font-bold text-purple-900">
                {analytics.total?.invoices || 0}
              </div>
              <div className="text-sm text-purple-700 mt-2">
                {calculateYTD().growth > 0 ? '+' : ''}{calculateYTD().growth.toFixed(1)}% vs N-1
              </div>
            </div>

            <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-xl p-6 border border-pink-200">
              <div className="text-xs font-medium text-pink-600 mb-2 uppercase tracking-wide">Panier Moyen</div>
              <div className="text-3xl font-bold text-pink-900">
                {analytics.total?.invoices > 0
                  ? Math.round(analytics.total.ca_ht / analytics.total.invoices).toLocaleString('fr-FR')
                  : 0}€
              </div>
              <div className="text-sm text-pink-700 mt-2">HT par facture</div>
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly evolution */}
            <div className="bg-white rounded-xl border border-slate-100 p-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">Évolution mensuelle du CA</h3>
              <div className="h-64">
                <canvas ref={monthlyChartRef}></canvas>
              </div>
            </div>

            {/* Top 10 clients */}
            <div className="bg-white rounded-xl border border-slate-100 p-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">Top 10 Clients</h3>
              <div className="h-64">
                <canvas ref={topClientsChartRef}></canvas>
              </div>
            </div>
          </div>

          {/* Recent invoices */}
          {analytics.recentInvoices && analytics.recentInvoices.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800">Dernières factures</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Numéro</th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Client</th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Date</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Montant HT</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Montant TTC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.recentInvoices.slice(0, 10).map((inv, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-6 py-3 text-sm font-medium text-slate-900">{inv.number}</td>
                        <td className="px-6 py-3 text-sm text-slate-700">{inv.client}</td>
                        <td className="px-6 py-3 text-sm text-slate-500">
                          {new Date(inv.date).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="px-6 py-3 text-sm text-right font-medium text-slate-900">
                          {(inv.amount_ht || 0).toLocaleString('fr-FR')}€
                        </td>
                        <td className="px-6 py-3 text-sm text-right text-slate-600">
                          {(inv.amount_ttc || 0).toLocaleString('fr-FR')}€
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vue Recherche Client */}
      {viewMode === 'client' && (
        <div className="space-y-6">
          {!selectedClient ? (
            <div className="bg-white rounded-xl border border-slate-100 p-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">Rechercher un client</h3>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Tapez le nom du client..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {filteredClients.length > 0 && (
                  <div className="absolute z-10 w-full mt-2 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {filteredClients.map((client, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setSearchTerm(client);
                          loadClientDetails(client);
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-blue-50 text-sm transition-colors"
                      >
                        {client}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {searchTerm && filteredClients.length === 0 && (
                <p className="text-sm text-slate-500 mt-2">Aucun client trouvé</p>
              )}
            </div>
          ) : clientDetails ? (
            <div className="space-y-6">
              {/* Header */}
              <div className="bg-white rounded-xl border border-slate-100 p-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setSelectedClient(null);
                      setClientDetails(null);
                      setSearchTerm('');
                    }}
                    className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200"
                  >
                    Retour
                  </button>
                  <h2 className="text-lg font-semibold text-slate-900">{selectedClient}</h2>
                </div>
              </div>

              {/* KPIs Client */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
                  <div className="text-xs font-medium text-blue-600 mb-2 uppercase tracking-wide">CA Total HT</div>
                  <div className="text-3xl font-bold text-blue-900">
                    {(clientDetails.total?.ca_ht || 0).toLocaleString('fr-FR')}€
                  </div>
                  <div className="text-sm text-blue-700 mt-2">
                    {clientDetails.total?.invoices || 0} factures
                  </div>
                </div>

                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-6 border border-emerald-200">
                  <div className="text-xs font-medium text-emerald-600 mb-2 uppercase tracking-wide">CA Total TTC</div>
                  <div className="text-3xl font-bold text-emerald-900">
                    {(clientDetails.total?.ca_ttc || 0).toLocaleString('fr-FR')}€
                  </div>
                </div>

                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-6 border border-amber-200">
                  <div className="text-xs font-medium text-amber-600 mb-2 uppercase tracking-wide">Commission</div>
                  <div className="text-3xl font-bold text-amber-900">
                    {(clientDetails.total?.commission || 0).toLocaleString('fr-FR')}€
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
                  <div className="text-xs font-medium text-purple-600 mb-2 uppercase tracking-wide">Panier Moyen</div>
                  <div className="text-3xl font-bold text-purple-900">
                    {clientDetails.total?.invoices > 0
                      ? Math.round(clientDetails.total.ca_ht / clientDetails.total.invoices).toLocaleString('fr-FR')
                      : 0}€
                  </div>
                  <div className="text-sm text-purple-700 mt-2">
                    Tendance: {calculateClientGrowth() > 0 ? '+' : ''}{calculateClientGrowth().toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Client monthly chart */}
              <div className="bg-white rounded-xl border border-slate-100 p-6">
                <h3 className="text-sm font-semibold text-slate-800 mb-4">Évolution mensuelle du CA client</h3>
                <div className="h-64">
                  <canvas ref={clientMonthlyChartRef}></canvas>
                </div>
              </div>

              {/* Top products */}
              {clientDetails.topProducts && clientDetails.topProducts.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <div className="p-6 border-b border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-800">Produits consommés</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Référence</th>
                          <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Produit</th>
                          <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Quantité</th>
                          <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">CA HT</th>
                          <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Factures</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {clientDetails.topProducts.map((p, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-6 py-3 text-sm font-mono text-slate-700">{p.ref}</td>
                            <td className="px-6 py-3 text-sm text-slate-900">{p.name}</td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600">{p.totalQuantity}</td>
                            <td className="px-6 py-3 text-sm text-right font-medium text-slate-900">
                              {(p.totalHT || 0).toLocaleString('fr-FR')}€
                            </td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600">{p.invoiceCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Invoices history */}
              {clientDetails.invoices && clientDetails.invoices.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                  <div className="p-6 border-b border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-800">Historique factures</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Numéro</th>
                          <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Date</th>
                          <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Produits</th>
                          <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Montant HT</th>
                          <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Montant TTC</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {clientDetails.invoices.map((inv, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-6 py-3 text-sm font-medium text-slate-900">{inv.number}</td>
                            <td className="px-6 py-3 text-sm text-slate-500">{inv.date}</td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600">{inv.productCount}</td>
                            <td className="px-6 py-3 text-sm text-right font-medium text-slate-900">
                              {(inv.totalHT || 0).toLocaleString('fr-FR')}€
                            </td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600">
                              {(inv.totalTTC || 0).toLocaleString('fr-FR')}€
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Vue Comparaison Années */}
      {viewMode === 'comparison' && yearsComparison && (
        <div className="space-y-6">
          {/* Year selection */}
          <div className="bg-white rounded-xl border border-slate-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-800">Sélectionner les années à comparer</h3>
              <button
                onClick={() => {
                  if (selectedYears.length === availableYears.length) {
                    setSelectedYears([]);
                  } else {
                    setSelectedYears([...availableYears]);
                  }
                }}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                {selectedYears.length === availableYears.length ? 'Tout désélectionner' : 'Tout sélectionner'}
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              {availableYears.map(year => (
                <label key={year} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedYears.includes(year)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedYears([...selectedYears, year]);
                      } else {
                        setSelectedYears(selectedYears.filter(y => y !== year));
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-slate-700">{year}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Comparison chart */}
          {selectedYears.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 p-6">
              <h3 className="text-sm font-semibold text-slate-800 mb-4">Évolution cumulative par année</h3>
              <div className="h-80">
                <canvas ref={comparisonChartRef}></canvas>
              </div>
            </div>
          )}

          {/* Comparison table */}
          {selectedYears.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-800">Tableau comparatif</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Année</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">CA HT</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Commission</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Nb Factures</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Croissance</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Prévision 3 mois</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {yearsComparison.years
                      .filter(y => selectedYears.includes(y.year))
                      .sort((a, b) => b.year - a.year)
                      .map((yearData, idx, arr) => {
                        const prevYear = arr[idx + 1];
                        const growth = prevYear
                          ? ((yearData.total_ht - prevYear.total_ht) / prevYear.total_ht * 100)
                          : 0;
                        const forecast = calculateForecast(yearData);

                        return (
                          <tr key={yearData.year} className="hover:bg-slate-50">
                            <td className="px-6 py-3 text-sm font-medium text-slate-900">{yearData.year}</td>
                            <td className="px-6 py-3 text-sm text-right font-medium text-slate-900">
                              {(yearData.total_ht || 0).toLocaleString('fr-FR')}€
                            </td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600">
                              {(yearData.total_commission || 0).toLocaleString('fr-FR')}€
                            </td>
                            <td className="px-6 py-3 text-sm text-right text-slate-600">
                              {yearData.invoices || 0}
                            </td>
                            <td className={`px-6 py-3 text-sm text-right font-medium ${
                              growth > 0 ? 'text-emerald-600' : growth < 0 ? 'text-red-600' : 'text-slate-600'
                            }`}>
                              {prevYear ? `${growth > 0 ? '+' : ''}${growth.toFixed(1)}%` : '-'}
                            </td>
                            <td className="px-6 py-3 text-sm text-right text-blue-600 font-medium">
                              {forecast > 0 ? `${Math.round(forecast).toLocaleString('fr-FR')}€` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vue Commissions */}
      {viewMode === 'commissions' && analytics && (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
              <div className="text-xs font-medium text-blue-600 mb-2 uppercase tracking-wide">Commission Brute</div>
              <div className="text-3xl font-bold text-blue-900">
                {Math.round((analytics.total?.ca_ht || 0) * 0.15).toLocaleString('fr-FR')}€
              </div>
              <div className="text-sm text-blue-700 mt-2">15% du CA HT</div>
            </div>

            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-6 border border-red-200">
              <div className="text-xs font-medium text-red-600 mb-2 uppercase tracking-wide">Taxes Totales</div>
              <div className="text-3xl font-bold text-red-900">
                {Math.round((analytics.total?.ca_ht || 0) * 0.15 * 0.2304).toLocaleString('fr-FR')}€
              </div>
              <div className="text-sm text-red-700 mt-2">23.04% de la commission</div>
            </div>

            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-6 border border-emerald-200">
              <div className="text-xs font-medium text-emerald-600 mb-2 uppercase tracking-wide">Commission Nette</div>
              <div className="text-3xl font-bold text-emerald-900">
                {Math.round((analytics.total?.ca_ht || 0) * 0.15 * 0.7696).toLocaleString('fr-FR')}€
              </div>
              <div className="text-sm text-emerald-700 mt-2">Après taxes</div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
              <div className="text-xs font-medium text-purple-600 mb-2 uppercase tracking-wide">Taux Effectif</div>
              <div className="text-3xl font-bold text-purple-900">11.54%</div>
              <div className="text-sm text-purple-700 mt-2">Du CA HT (net)</div>
            </div>
          </div>

          {/* Graphique évolution mensuelle */}
          <div className="bg-white rounded-xl border border-slate-100 p-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Évolution mensuelle des commissions</h3>
            <div className="h-80">
              <canvas ref={commissionsChartRef}></canvas>
            </div>
          </div>

          {/* Tableau mensuel détaillé */}
          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800">Détail mensuel</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Mois</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">CA HT</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Commission Brute (15%)</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Taxes (23.04%)</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Commission Nette</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(analytics.byMonth || {})
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([month, data]) => {
                      const caHT = data.ca_ht || 0;
                      const commBrute = caHT * 0.15;
                      const taxes = commBrute * 0.2304;
                      const commNette = commBrute - taxes;

                      return (
                        <tr key={month} className="hover:bg-slate-50">
                          <td className="px-6 py-3 text-sm font-medium text-slate-900">
                            {new Date(month + '-01').toLocaleDateString('fr-FR', { year: 'numeric', month: 'long' })}
                          </td>
                          <td className="px-6 py-3 text-sm text-right text-slate-700">
                            {Math.round(caHT).toLocaleString('fr-FR')}€
                          </td>
                          <td className="px-6 py-3 text-sm text-right font-medium text-blue-600">
                            {Math.round(commBrute).toLocaleString('fr-FR')}€
                          </td>
                          <td className="px-6 py-3 text-sm text-right text-red-600">
                            -{Math.round(taxes).toLocaleString('fr-FR')}€
                          </td>
                          <td className="px-6 py-3 text-sm text-right font-bold text-emerald-600">
                            {Math.round(commNette).toLocaleString('fr-FR')}€
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-6 py-3 text-sm font-bold text-slate-900">TOTAL</td>
                    <td className="px-6 py-3 text-sm text-right font-bold text-slate-900">
                      {Math.round(analytics.total?.ca_ht || 0).toLocaleString('fr-FR')}€
                    </td>
                    <td className="px-6 py-3 text-sm text-right font-bold text-blue-600">
                      {Math.round((analytics.total?.ca_ht || 0) * 0.15).toLocaleString('fr-FR')}€
                    </td>
                    <td className="px-6 py-3 text-sm text-right font-bold text-red-600">
                      -{Math.round((analytics.total?.ca_ht || 0) * 0.15 * 0.2304).toLocaleString('fr-FR')}€
                    </td>
                    <td className="px-6 py-3 text-sm text-right font-bold text-emerald-600">
                      {Math.round((analytics.total?.ca_ht || 0) * 0.15 * 0.7696).toLocaleString('fr-FR')}€
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Détail des taxes */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Détail des taxes appliquées</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">CSG</div>
                <div className="font-semibold text-slate-900">21.20%</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">CRDS</div>
                <div className="font-semibold text-slate-900">1.70%</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Formation Pro</div>
                <div className="font-semibold text-slate-900">0.10%</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">CFP</div>
                <div className="font-semibold text-slate-900">0.04%</div>
              </div>
              <div className="col-span-2 md:col-span-4 pt-2 border-t border-slate-300">
                <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Taxes</div>
                <div className="font-bold text-slate-900 text-lg">23.04%</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Vue Factures ─────────────────────────────────────────────────────────────
const VueFactures = ({ showToast }) => {
  const [tab, setTab] = useState("commande");
  const [vfStatus, setVfStatus] = useState(null);
  const [gsheetsStatus, setGsheetsStatus] = useState(null);

  useEffect(() => {
    api.get('/factures/status').then(setVfStatus).catch(() => setVfStatus({ ok: false }));
    api.get('/gsheets/status').then(setGsheetsStatus).catch(() => setGsheetsStatus({ ok: false }));
  }, []);

  const tabs = [
    { id: "commande", label: "Commande", icon: "📋" },
    { id: "batch", label: "Batch", icon: "📦" },
    { id: "echantillons", label: "Échantillons", icon: "🎁" },
    { id: "relances", label: "Relances", icon: "📨" },
    { id: "envois", label: "Envois", icon: "📮" },
  ];

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center gap-4 text-xs">
        <div className={`flex items-center gap-1.5 ${vfStatus?.ok ? 'text-emerald-600' : 'text-slate-400'}`}>
          <span className={`w-2 h-2 rounded-full ${vfStatus?.ok ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          VosFactures {vfStatus?.ok ? 'connecté' : 'non connecté'}
        </div>
        <div className={`flex items-center gap-1.5 ${gsheetsStatus?.ok ? 'text-emerald-600' : 'text-slate-400'}`}>
          <span className={`w-2 h-2 rounded-full ${gsheetsStatus?.ok ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          Google Sheets {gsheetsStatus?.ok ? 'connecté' : 'non connecté'}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "commande" && <FacturesSingle showToast={showToast} />}
      {tab === "batch" && <FacturesBatch showToast={showToast} />}
      {tab === "echantillons" && <FacturesSamples showToast={showToast} />}
      {tab === "relances" && <FacturesReminders showToast={showToast} />}
      {tab === "envois" && <FacturesShipments showToast={showToast} />}
    </div>
  );
};

// ─── PDF Parsing Helpers (position-based) ────────────────────────────────────
const _parseFloatFR = (v) => {
  const s = (v ?? '').toString()
    .replace(/\u00A0/g, ' ')
    .replace(/[€\s]/g, '')
    .replace(/[^\d,\.\-]/g, '')
    .replace(/,/g, '.')
    .trim();
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
};

const _splitRefPriceToken = (token) => {
  const t = (token ?? '').toString().replace(/\s/g, '').trim();
  const idx = t.lastIndexOf('-');
  if (idx < 0) return { ref: t, price: NaN };
  const ref = t.slice(0, idx);
  const price = _parseFloatFR(t.slice(idx + 1));
  return { ref, price };
};

const _guessDiscountFromPdfRow = (items) => {
  const percentItems = (items || [])
    .map(it => ({ ...it, s: (it.str || '').toString().trim() }))
    .filter(it => /^\d+(?:[.,]\d+)?%$/.test(it.s));
  if (percentItems.length === 0) return 0;
  percentItems.sort((a, b) => (b.x - a.x));
  const p = _parseFloatFR(percentItems[0].s.replace('%', ''));
  return (isNaN(p) || p < 0) ? 0 : p;
};

const _guessQtyFromPdfRow = (rowText, rowItems, colHints) => {
  if (!rowItems || rowItems.length === 0) return NaN;

  try {
    const t = String(rowText || '');
    const m = t.match(/\b(\d{1,4})\b\s*\(\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*\)\s*€\)*\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*€\s*(\d+)(?:\s+(\d+))?/);
    if (m) {
      const qty1 = parseInt(m[4], 10);
      const qty2 = (m[5] != null) ? parseInt(m[5], 10) : null;
      if (Number.isFinite(qty2)) return qty2;
      if (Number.isFinite(qty1)) return qty1;
    }
  } catch (e) { }

  const isDecimalFragment = (items, i) => {
    const cur = String(items[i]?.str || '').trim();
    if (!/^\d+$/.test(cur)) return false;
    const prev = String(items[i - 1]?.str || '').trim();
    const next = String(items[i + 1]?.str || '').trim();
    if (next === ',' || next === '.' || /^[.,]$/.test(next) || /^[.,]\d+$/.test(next)) return true;
    if (prev === ',' || prev === '.' || /^[.,]$/.test(prev) || /^[.,]\d+$/.test(prev) || /[.,]$/.test(prev)) return true;
    if (/[.,]$/.test(cur) && /^\d+$/.test(next)) return true;
    if (/^\d{1,2}$/.test(cur) && (prev === ',' || prev === '.' || /[.,]$/.test(prev) || /^[.,]\d+$/.test(prev))) return true;
    return false;
  };

  const numTokens = [];
  for (let i = 0; i < rowItems.length; i++) {
    const tok = String(rowItems[i]?.str || '').trim();
    if (!/^\d+$/.test(tok)) continue;
    if (isDecimalFragment(rowItems, i)) continue;
    const refTokenMatch = (colHints && colHints.refTokenRe && colHints.refTokenRe.test(tok)) || false;
    if (refTokenMatch) continue;
    const v = parseInt(tok, 10);
    if (Number.isNaN(v)) continue;
    if (v < 0 || v > 50000) continue;
    numTokens.push({ x: rowItems[i].x, n: v });
  }

  if (colHints && typeof colHints.qtyX === 'number' && numTokens.length > 0) {
    let best = null;
    let bestDx = Infinity;
    for (const t of numTokens) {
      const dx = Math.abs(t.x - colHints.qtyX);
      if (dx < bestDx) { bestDx = dx; best = t; }
    }
    if (best) return best.n;
  }

  const safeText = String(rowText || '').replace(/\b\d+\s*[.,]\s*\d+\b/g, ' ');
  const ints = [];
  safeText.replace(/\b\d+\b/g, (m, idx) => {
    const n = parseInt(m, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 50000) ints.push({ idx, n });
    return m;
  });

  if (ints.length > 0) {
    for (let i = ints.length - 1; i >= 0; i--) {
      if (ints[i].n > 0) return ints[i].n;
    }
    return ints[ints.length - 1].n;
  }

  if (numTokens.length > 0) {
    const sorted = numTokens.slice().sort((a, b) => a.n - b.n);
    const plausible = sorted.find(t => t.n >= 2) || sorted[0];
    return plausible ? plausible.n : NaN;
  }
  return NaN;
};

const _guessUnitPriceFromPdfRow = (items, ref, colHints, quantity) => {
  if (!items || items.length === 0) return NaN;

  const qty = Number(quantity);
  const hasQty = Number.isFinite(qty) && qty > 0;

  const refNorm = (ref ?? '').toString().replace(/\s/g, '').trim().toUpperCase();
  let refX = NaN;
  for (const it of items) {
    const s = (it?.str ?? '').toString().replace(/\s/g, '').trim().toUpperCase();
    if (s === refNorm) { refX = it.x; break; }
  }

  const floats = [];
  const refRe = /^(?:P\d{3}[A-Z0-9]{0,10}(?:-[A-Za-z0-9]{1,12}){0,4}|SPFS|PFS|PFD|PFT|P5L|FP|FE)$/i;

  for (const it of items) {
    const raw = (it?.str ?? '').toString();
    if (!raw) continue;
    const sTrim = raw.trim();
    if (!sTrim) continue;
    if (/^\d+(?:[.,]\d+)?%$/.test(sTrim)) continue;

    const sCompact = sTrim.replace(/\s/g, '');
    if (refRe.test(sCompact)) continue;

    const m = sCompact.match(/-?\d+(?:[.,]\d{1,2})/);
    if (!m) continue;

    const v = _parseFloatFR(m[0]);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (v > 10000) continue;

    floats.push({ x: it.x, v });
  }

  if (floats.length === 0) return NaN;

  let candidates = floats;
  if (Number.isFinite(refX)) {
    const right = floats.filter(f => f.x > (refX - 2));
    if (right.length > 0) candidates = right;
  }

  const nearly = (a, b, eps = 0.03) => Math.abs(Number(a) - Number(b)) <= eps;

  if (hasQty && qty > 1) {
    const vals = [...new Set(candidates.map(c => c.v).filter(Number.isFinite))].sort((a, b) => a - b);
    for (const u of vals) {
      for (const t of vals) {
        if (t <= u) continue;
        if (nearly(t, u * qty)) {
          return u;
        }
      }
    }
  }

  if (colHints && typeof colHints.priceHTX === 'number' && Number.isFinite(colHints.priceHTX)) {
    let best = candidates[0];
    let bestDx = Math.abs(best.x - colHints.priceHTX);
    for (const c of candidates) {
      const dx = Math.abs(c.x - colHints.priceHTX);
      if (dx < bestDx) { bestDx = dx; best = c; }
    }

    if (best && Number.isFinite(best.v)) {
      if (hasQty && qty > 1) {
        const unitGuess = best.v / qty;
        const hasUnitCandidate = candidates.some(c => nearly(c.v, unitGuess));
        if (hasUnitCandidate) return unitGuess;
      }
      return best.v;
    }
  }

  const small = candidates.filter(c => c.v <= 500);
  if (small.length > 0) {
    small.sort((a, b) => a.v - b.v);
    return small[0].v;
  }

  candidates.sort((a, b) => a.v - b.v);
  return candidates[0].v;
};

const inferPdfColHints = (rows) => {
  try {
    const headers = [];
    for (const r of (rows || [])) {
      const t = (r && r.text ? r.text : '').toString();
      const items = (r && r.items) ? r.items : [];
      const y = (r && Number.isFinite(r.y)) ? r.y : (items && items[0] ? items[0].y : null);

      const tt = t.toLowerCase();
      const looksLikeHeader = (
        tt.includes('ref') ||
        (tt.includes('prix') && tt.includes('unit')) ||
        (tt.includes('nb') && tt.includes('unit'))
      );
      if (!looksLikeHeader) continue;

      const qtyItem = items.find(x => /D'?unit/i.test((x.str || ''))) || items.find(x => /unit/i.test((x.str || '')));
      const htItem  = items.find(x => /^HT$/i.test(((x.str || '')).trim())) || items.find(x => /\bHT\b/i.test((x.str || '')));

      const qtyX = (qtyItem && Number.isFinite(qtyItem.x)) ? qtyItem.x : null;
      const priceHTX = (htItem && Number.isFinite(htItem.x)) ? htItem.x : null;

      if (qtyX !== null || priceHTX !== null) {
        headers.push({ y, qtyX, priceHTX });
      }
    }

    headers.sort((a, b) => (Number(a.y || 0) - Number(b.y || 0)));

    const first = headers[0] || {};
    return {
      headers,
      qtyX: Number.isFinite(first.qtyX) ? first.qtyX : null,
      priceHTX: Number.isFinite(first.priceHTX) ? first.priceHTX : null,
      qtyTolX: 55,
      priceTolX: 80
    };
  } catch (_) {}
  return null;
};

const pickPdfColHints = (colHints, rowY) => {
  if (!colHints) return null;
  const headers = colHints.headers || [];
  if (!headers.length || !Number.isFinite(rowY)) return colHints;

  let chosen = null;
  for (const h of headers) {
    if (!Number.isFinite(h.y)) continue;
    if (h.y <= rowY) chosen = h;
    else break;
  }
  if (!chosen) chosen = headers[0];

  return {
    qtyX: Number.isFinite(chosen.qtyX) ? chosen.qtyX : colHints.qtyX,
    priceHTX: Number.isFinite(chosen.priceHTX) ? chosen.priceHTX : colHints.priceHTX,
    qtyTolX: colHints.qtyTolX,
    priceTolX: colHints.priceTolX,
    headers
  };
};

const _parsePdfRowToProduct = (row, colHints) => {
  const text = (row && row.text) ? row.text : '';
  const items = (row && row.items) ? row.items : [];
  if (!text || text.length < 2) return null;
  if (/^(total|totaux)\b/i.test(text)) return null;
  if (/^(ref\b|menu\b)/i.test(text)) return null;

  const tokenRe = /^(?:(?:P\d{3}[A-Z0-9]{0,10}(?:-[A-Za-z0-9]{1,12}){0,4}|SPFS|PFS|PFD|PFT|P5L|FP|FE))-\d+(?:[.,]\d{1,2})$/;
  const baseRe  = /^(?:P\d{3}[A-Z0-9]{0,10}(?:-[A-Za-z0-9]{1,12}){0,4}|SPFS|PFS|PFD|PFT|P5L|FP|FE)$/;

  let token = null;
  for (const it of items) {
    const s = (it.str || '').toString().replace(/\s/g, '').trim();
    if (tokenRe.test(s)) { token = s; break; }
  }

  const quantity = _guessQtyFromPdfRow(text, items, colHints);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  let ref = '';
  let priceHT = NaN;

  if (token) {
    const sp = _splitRefPriceToken(token);
    ref = sp.ref;
    priceHT = sp.price;
    const altUnit = _guessUnitPriceFromPdfRow(items, ref, colHints, quantity);
    if (Number.isFinite(altUnit) && altUnit > 0) priceHT = altUnit;
  } else {
    let base = null;
    for (const it of items) {
      const s = (it.str || '').toString().replace(/\s/g, '').trim();
      if (baseRe.test(s)) { base = s; break; }
    }
    if (!base) return null;
    ref = base;
    priceHT = _guessUnitPriceFromPdfRow(items, ref, colHints, quantity);
  }

  if (!ref || !Number.isFinite(priceHT) || priceHT <= 0) return null;

  const discount = _guessDiscountFromPdfRow(items) || 0;

  return { ref, quantity, priceHT, discount };
};

const parsePdfOrder = async (file) => {
  if (!file) throw new Error('Aucun fichier PDF');
  if (!window.pdfjsLib) {
    throw new Error('Lecture PDF indisponible (PDF.js non chargé). Vérifiez votre connexion internet ou utilisez le fichier Excel.');
  }

  const ab = await file.arrayBuffer();
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  } catch (e) {
    throw new Error('Impossible de lire ce PDF.');
  }

  const rows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const items = (content.items || [])
      .map(it => ({
        str: (it.str || '').toString().trim(),
        x: (it.transform && it.transform.length >= 6) ? it.transform[4] : 0,
        y: (it.transform && it.transform.length >= 6) ? it.transform[5] : 0
      }))
      .filter(it => it.str);

    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));

    const tol = 1.2;
    let current = null;
    const pageRows = [];
    for (const it of items) {
      if (!current || Math.abs(it.y - current.y) > tol) {
        if (current) pageRows.push(current);
        current = { y: it.y, items: [] };
      }
      current.items.push(it);
    }
    if (current) pageRows.push(current);

    for (const r of pageRows) {
      r.items.sort((a, b) => a.x - b.x);
      const text = r.items.map(t => t.str).join(' ').replace(/\s+/g, ' ').trim();
      rows.push({ text, items: r.items, y: r.y });
    }
  }

  const colHints = inferPdfColHints(rows);

  const map = new Map();
  for (const row of rows) {
    const rowHints = pickPdfColHints(colHints, row.y);
    const prod = _parsePdfRowToProduct(row, rowHints);
    if (!prod) continue;
    const k = `${prod.ref}__${prod.priceHT.toFixed(2)}__${(prod.discount || 0).toFixed(2)}`;
    if (map.has(k)) {
      map.get(k).quantity += prod.quantity;
    } else {
      map.set(k, prod);
    }
  }

  const products = Array.from(map.values())
    .filter(p => p && p.quantity > 0 && Number.isFinite(p.priceHT) && p.priceHT > 0);

  // Extraire le texte complet pour détecter un numéro de facture VF
  const fullText = rows.map(r => r.text).join('\n');

  if (!products.length) {
    // Chercher un numéro de facture VosFactures dans le texte (ex: "FV 2024/01/7184", "Facture FV 2024/123", "N° FV 2024/7184")
    const vfMatch = fullText.match(/\bFV\s*[\d/]+/i);
    if (vfMatch) {
      return { products: [], vfInvoiceNumber: vfMatch[0].replace(/\s+/g, ' ').trim() };
    }
    throw new Error("Aucun produit détecté dans le PDF. Si c'est une facture VosFactures, utilisez l'import par numéro ci-dessous. Si c'est un PDF scanné (image), il faut l'Excel ou un PDF texte.");
  }

  return { products };
};

// ─── Factures Helpers ─────────────────────────────────────────────────────────
const getShippingIdForClient = (client, deliveryAddr = '') => {
  const idfDepts = ['75', '77', '78', '91', '92', '93', '94', '95'];
  // Si adresse de livraison disponible, l'utiliser pour déterminer le transporteur
  let zip = client?.zip || client?.post_code || '';
  let city = (client?.city || '').toLowerCase();
  if (deliveryAddr) {
    const cpMatch = deliveryAddr.match(/(\d{4,5})\s/);
    if (cpMatch) zip = cpMatch[1];
    const cityMatch = deliveryAddr.match(/\d{4,5}\s+(.+)/);
    if (cityMatch) city = cityMatch[1].toLowerCase();
  }
  const isIDF = idfDepts.some(d => zip.startsWith(d)) || city.includes('paris');
  return isIDF ? '101' : '1302';
};

const DEFAULT_FRANCO_SEUIL = 800;

const SHIPPING_OPTIONS = [
  { value: '1', label: '1 - Enlevement Colis' },
  { value: '2', label: '2 - Enlevement Palette' },
  { value: '4', label: '4 - Lettre Suivie' },
  { value: '101', label: '101 - Coursier Colis' },
  { value: '102', label: '102 - Coursier Palettes' },
  { value: '103', label: '103 - Affretement' },
  { value: '200', label: '200 - Affranchissement' },
  { value: '300', label: '300 - Colissimo Expert France' },
  { value: '301', label: '301 - Colissimo Expert DOM' },
  { value: '302', label: '302 - Colissimo Expert International' },
  { value: '303', label: '303 - SO Colissimo Avec Signature' },
  { value: '304', label: '304 - SO Colissimo Sans Signature' },
  { value: '306', label: '306 - SO Colissimo Bureau de Poste' },
  { value: '307', label: '307 - SO Colissimo Cityssimo' },
  { value: '308', label: '308 - SO Colissimo ACP' },
  { value: '309', label: '309 - SO Colissimo A2P' },
  { value: '311', label: '311 - SO Colissimo CDI' },
  { value: '312', label: '312 - Colissimo Access France' },
  { value: '600', label: '600 - TNT Avant 13H France' },
  { value: '601', label: '601 - TNT Relais Colis France' },
  { value: '900', label: '900 - UPS Inter Standard' },
  { value: '901', label: '901 - UPS Inter Express' },
  { value: '902', label: '902 - UPS Inter Express Saver' },
  { value: '903', label: '903 - UPS Express Plus' },
  { value: '904', label: '904 - UPS Expedited' },
  { value: '1000', label: '1000 - DHL' },
  { value: '1100', label: '1100 - GEODIS' },
  { value: '1300', label: '1300 - Chronopost 13H' },
  { value: '1301', label: '1301 - Chronopost Classic - intl' },
  { value: '1302', label: '1302 - Chronopost 13H Instance Agence' },
  { value: '1303', label: '1303 - Chronopost Relais 13H' },
  { value: '1304', label: '1304 - Chronopost Express - intl' },
];

// ─── Factures Single (Step Wizard) ────────────────────────────────────────────
const FacturesSingle = ({ showToast }) => {
  const [step, setStep] = useState(1); // 1=upload, 2=match, 3=client, 4=review, 5=done
  const [rawLines, setRawLines] = useState([]);
  const [matchedProducts, setMatchedProducts] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [documentType, setDocumentType] = useState('vat');
  const [orderNumber, setOrderNumber] = useState('');
  const [manualText, setManualText] = useState('');
  const [shippingId, setShippingId] = useState('1302');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const includeShipping = true; // Toujours inclure les frais de port
  const [sendEmail, setSendEmail] = useState(true);
  const [logGSheets, setLogGSheets] = useState(true);
  const [useCurrentPrices, setUseCurrentPrices] = useState(false);
  const [calculation, setCalculation] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [importInvoiceId, setImportInvoiceId] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [addProductSearch, setAddProductSearch] = useState('');

  useEffect(() => {
    api.get('/reference/catalog').then(data => { if (Array.isArray(data)) setCatalog(data.filter(c => c.actif)); }).catch(e => console.error(e));
  }, []);

  const handleImportInvoice = async () => {
    const idOrNumber = importInvoiceId.trim();
    if (!idOrNumber) return;
    setImportLoading(true);
    setError(null);
    try {
      // Toujours rechercher par numéro d'abord (même si c'est un nombre, car l'ID interne VF est différent du numéro affiché)
      let invoiceId = null;
      const results = await api.get('/factures/invoices/search?number=' + encodeURIComponent(idOrNumber));
      const list = Array.isArray(results) ? results : [];
      if (list.length > 0) {
        invoiceId = list[0].id;
      } else if (/^\d+$/.test(idOrNumber)) {
        // Fallback: essayer comme ID direct VF
        invoiceId = idOrNumber;
      } else {
        setError('Aucune facture trouvée pour "' + idOrNumber + '"');
        setImportLoading(false);
        return;
      }
      const data = await api.get('/factures/invoices/' + invoiceId + '/products');
      if (data.erreur) { setError(data.erreur); setImportLoading(false); return; }
      if (!data.products || data.products.length === 0) { setError('Aucun produit trouvé dans cette facture'); setImportLoading(false); return; }
      setMatchedProducts(data.products);
      if (data.client) {
        setSelectedClient(data.client);
        setOrderNumber(data.invoiceNumber || '');
        setDeliveryAddress(data.delivery_address || '');
        // Calculer directement et aller au step 4
        const calcRes = await api.post('/factures/calculate', { products: data.products, clientName: data.client.name, includeShipping });
        setCalculation(calcRes);
        setShippingId(getShippingIdForClient(data.client, data.delivery_address || ''));
        setStep(4);
        showToast('Facture importée — ' + data.products.length + ' produit(s)', 'success');
      } else {
        setStep(3);
        showToast('Facture importée — sélectionnez un client', 'success');
      }
    } catch (err) {
      setError('Erreur import: ' + err.message);
    }
    setImportLoading(false);
  };

  // Step 1: Upload / Saisie manuelle
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    try {
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const data = new Uint8Array(await file.arrayBuffer());
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const products = [];
        for (const row of json) {
          if (!row[0] || row[0] === 'Ref 500ml' || row[0] === 'Menu Déroulant' || row[0] === 'TOTAL') continue;
          const rawRef = String(row[0] || '').trim();
          const qtyUnits = parseFloat(row[6]) || 0;
          const qtyCartons = parseFloat(row[5]) || 0;
          const quantity = qtyUnits > 0 ? qtyUnits : qtyCartons;
          let priceHT = parseFloat(String(row[3] || '0').replace(/[€\s]/g, '').replace(',', '.')) || 0;
          const discountStr = row[9] ? String(row[9]).trim() : '';
          let discount = 0;
          if (discountStr && discountStr !== '-') {
            discount = parseFloat(discountStr.replace('%', '').replace(',', '.')) || 0;
            if (discount > 0 && discount < 1) discount *= 100;
          }
          if (rawRef && quantity > 0) products.push({ ref: rawRef, quantity, priceHT, discount });
        }

        if (products.length === 0) { setError('Aucun produit trouvé dans le fichier'); return; }
        setRawLines(products);
        matchProducts(products);
      } else if (file.name.endsWith('.pdf')) {
        showToast('Parsing PDF en cours...', 'info');
        console.log('📄 Parsing PDF avec logique position-based (X/Y)');

        const data = await parsePdfOrder(file);

        // Si c'est une facture VosFactures détectée, lancer l'import automatique
        if (data.vfInvoiceNumber) {
          console.log('📄 Facture VF détectée dans le PDF:', data.vfInvoiceNumber);
          showToast('Facture VF détectée : ' + data.vfInvoiceNumber + ' — import en cours...', 'info');
          setImportInvoiceId(data.vfInvoiceNumber);
          // Lancer l'import automatiquement
          setImportLoading(true);
          try {
            const results = await api.get('/factures/invoices/search?number=' + encodeURIComponent(data.vfInvoiceNumber));
            const list = Array.isArray(results) ? results : [];
            if (list.length === 0) { setError('Facture VF "' + data.vfInvoiceNumber + '" détectée dans le PDF mais non trouvée sur VosFactures'); setImportLoading(false); return; }
            const invoiceId = list[0].id;
            const importData = await api.get('/factures/invoices/' + invoiceId + '/products');
            if (importData.erreur) { setError(importData.erreur); setImportLoading(false); return; }
            if (!importData.products || importData.products.length === 0) { setError('Aucun produit trouvé dans la facture VF'); setImportLoading(false); return; }
            setMatchedProducts(importData.products);
            if (importData.client) {
              setSelectedClient(importData.client);
              setOrderNumber(importData.invoiceNumber || '');
              setDeliveryAddress(importData.delivery_address || '');
              const calcRes = await api.post('/factures/calculate', { products: importData.products, clientName: importData.client.name, includeShipping });
              setCalculation(calcRes);
              setShippingId(getShippingIdForClient(importData.client, importData.delivery_address || ''));
              setStep(4);
              showToast('Facture VF importée — ' + importData.products.length + ' produit(s)', 'success');
            } else {
              setStep(3);
              showToast('Facture VF importée — sélectionnez un client', 'success');
            }
          } catch (importErr) {
            setError('Erreur import facture VF: ' + importErr.message);
          }
          setImportLoading(false);
          return;
        }

        console.log(`📄 parsePdfOrder: ${data.products.length} produit(s) détecté(s)`);

        if (data.products.length === 0) {
          setError('Aucun produit trouvé dans le PDF');
          return;
        }

        // Afficher les produits détectés pour debug
        data.products.forEach((p, i) => {
          console.log(`  ${i+1}. ${p.ref} - Qty: ${p.quantity}, Prix HT: ${p.priceHT.toFixed(2)}€, Remise: ${p.discount}%`);
        });

        setRawLines(data.products);
        matchProducts(data.products);
      }
    } catch (err) {
      setError('Erreur lecture fichier: ' + err.message);
    }
  };

  const handleManualSubmit = async () => {
    if (!manualText.trim()) return;
    setError(null);
    try {
      const res = await api.post('/factures/match-products', { text: manualText, useCurrentPrices });
      if (res.erreur) { setError(res.erreur); return; }
      setMatchedProducts(res);
      setStep(2);
    } catch (err) {
      setError('Erreur: ' + err.message);
    }
  };

  const matchProducts = async (lines) => {
    try {
      const res = await api.post('/factures/match-products', { lignes: lines, useCurrentPrices });
      if (res.erreur) { setError(res.erreur); return; }
      setMatchedProducts(res);
      setStep(2);
    } catch (err) {
      setError('Erreur matching: ' + err.message);
    }
  };

  // Step 3: Calculate
  const doCalculation = async (client) => {
    try {
      const res = await api.post('/factures/calculate', {
        products: matchedProducts,
        clientName: client?.name,
        includeShipping,
      });
      setCalculation(res);
    } catch (err) {
      showToast('Erreur calcul: ' + err.message, 'error');
    }
  };

  // Step 4: Create
  const createInvoice = async () => {
    setProcessing(true);
    setError(null);
    try {
      const res = await api.post('/factures/invoices', {
        client: selectedClient,
        products: calculation?.products || matchedProducts,
        fraisPort: calculation?.frais_port || [],
        documentType,
        orderNumber,
        sendEmail,
        logGSheets,
      });
      if (res.erreur) throw new Error(res.erreur);
      setResult(res);
      setStep(5);
      showToast('Facture créée avec succès !', 'success');
      if (sendEmail && res.email_error) {
        showToast('Attention : email non envoyé — ' + res.email_error, 'error');
      }
      // Ajouter automatiquement à la table shipments
      try {
        await api.post('/shipments', {
          type: 'commande',
          order_ref: orderNumber || res.number || `CMD-${Date.now()}`,
          invoice_id: res.id,
          invoice_number: res.number,
          client_name: selectedClient?.name || '',
          client_email: selectedClient?.email || '',
          client_address: selectedClient?.street || '',
          client_city: selectedClient?.city || '',
          client_country: selectedClient?.country || 'FR',
          shipping_id: shippingId,
          montant_ht: res.price_net || 0,
          montant_ttc: res.price_gross || 0,
          notes: `Commande ${orderNumber || ''}`.trim(),
        });
      } catch (shipErr) {
        console.warn('Erreur ajout shipment:', shipErr);
      }
      // Enchaîner CSV + email logisticien automatiquement
      setProcessing(false);
      try { await downloadCSVAndEmail(false, res); } catch (csvErr) {
        showToast('Erreur CSV logisticien: ' + csvErr.message, 'error');
      }
      return;
    } catch (err) {
      setError(err.message);
      showToast('Erreur: ' + err.message, 'error');
    }
    setProcessing(false);
  };

  // Log only (Google Sheets sans facture)
  const logOnly = async () => {
    setProcessing(true);
    setError(null);
    try {
      const res = await api.post('/factures/log-only', {
        client: selectedClient,
        products: calculation?.products || matchedProducts,
        fraisPort: calculation?.frais_port || [],
        orderNumber,
      });
      if (res.erreur) throw new Error(res.erreur);
      setResult({ logOnly: true, ...res });
      setStep(5);
      showToast(`Log Google Sheets OK (${res.writtenLines} lignes, partenaire: ${res.partnerName})`, 'success');
    } catch (err) {
      setError(err.message);
      showToast('Erreur log GSheets: ' + err.message, 'error');
    }
    setProcessing(false);
  };

  const downloadPDF = async () => {
    try {
      const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
      const res = await fetch(window.location.origin + '/api/factures/invoices/' + result.id + '/pdf', {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!res.ok) throw new Error('Erreur PDF: ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // Téléchargement automatique avec le bon nom
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-invoice-${result.number || result.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('PDF téléchargé', 'success');
    } catch (err) {
      showToast('Erreur PDF: ' + err.message, 'error');
    }
  };

  const downloadCSVAndEmail = async (isSample = false, resultOverride = null) => {
    try {
      const r = resultOverride || result;
      const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
      const invoiceData = { ...(r || {}), number: r?.number || orderNumber, products: calculation?.products || matchedProducts, orderNumber };
      const res = await fetch(window.location.origin + '/api/factures/csv-logisticien', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceData, client: selectedClient, shippingId, deliveryAddress }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.erreur || 'Erreur CSV: ' + res.status);
      }
      const blob = await res.blob();
      const fileName = `logisticien-${r?.number || orderNumber || 'facture'}.csv`;

      const dirName = await saveFileWithPicker(blob, fileName);
      if (dirName) {
        showToast(`CSV sauvé: ${dirName}/${fileName}`, 'success');
      } else {
        downloadFallback(blob, fileName);
        showToast('CSV téléchargé', 'success');
      }

      // Ouvrir mailto logisticien avec bon objet
      const clientName = selectedClient?.name || '';
      const invoiceNum = orderNumber || r?.number || '';
      const subjectPrefix = isSample ? 'Échantillons' : 'Commande';
      const subject = encodeURIComponent(`${subjectPrefix} : ${clientName} ${invoiceNum}`);
      const body = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint le CSV pour la ${isSample ? 'demande d\'échantillons' : 'commande'} ${invoiceNum} (${clientName}).\n\nCordialement`);
      const cc = encodeURIComponent('poulad@terredemars.com,alexandre@terredemars.com');
      window.open(`mailto:service.client@endurancelogistique.fr?cc=${cc}&subject=${subject}&body=${body}`, '_self');
    } catch (err) {
      showToast('Erreur CSV: ' + err.message, 'error');
    }
  };

  const steps = [
    { n: 1, label: 'Upload' }, { n: 2, label: 'Match' },
    { n: 3, label: 'Client' }, { n: 4, label: 'Review' }, { n: 5, label: 'Terminé' },
  ];

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <React.Fragment key={s.n}>
            {i > 0 && <div className={`h-px flex-1 ${step >= s.n ? 'bg-slate-900' : 'bg-slate-200'}`} />}
            <div className={`flex items-center gap-1.5 text-xs font-medium ${step >= s.n ? 'text-slate-900' : 'text-slate-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === s.n ? 'bg-slate-900 text-white' : step > s.n ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>{step > s.n ? '✓' : s.n}</span>
              <span className="hidden md:inline">{s.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-800">Importer un bon de commande</h3>
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-slate-400 transition-colors cursor-pointer"
               onClick={() => document.getElementById('file-upload-input')?.click()}>
            <div className="text-3xl mb-2">📁</div>
            <p className="text-sm text-slate-600 font-medium">Glisser un fichier Excel ou PDF ici</p>
            <p className="text-xs text-slate-400 mt-1">ou cliquer pour sélectionner</p>
            <input id="file-upload-input" type="file" accept=".xlsx,.xls,.pdf" onChange={handleFile} className="hidden" />
          </div>

          <div className="text-center text-xs text-slate-400 font-medium">— ou saisie manuelle —</div>
          <textarea value={manualText} onChange={e => setManualText(e.target.value)}
            placeholder={"Collez une commande email ici...\nEx: 10x P008-5000\n4x P007\n2 P011-5000"}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono h-32 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          <button onClick={handleManualSubmit} disabled={!manualText.trim()}
            className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-40 transition-colors">
            Analyser la commande
          </button>

          <div className="text-center text-xs text-slate-400 font-medium">— ou importer une facture existante —</div>
          <div className="flex gap-2">
            <input type="text" value={importInvoiceId} onChange={e => setImportInvoiceId(e.target.value)}
              placeholder="N° facture (ex: FV 2024/123) ou ID"
              onKeyDown={e => e.key === 'Enter' && handleImportInvoice()}
              className="flex-1 border border-slate-200 rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            <button onClick={handleImportInvoice} disabled={!importInvoiceId.trim() || importLoading}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap">
              {importLoading ? 'Import...' : 'Importer'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Match */}
      {step === 2 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">{matchedProducts.length} produit(s) reconnu(s)</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setStep(1)} className="text-xs text-slate-500 hover:text-slate-700">← Retour</button>
              <button onClick={() => setStep(3)} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700">
                Continuer →
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-100">
                  <th className="text-left py-2 px-2">Réf</th>
                  <th className="text-left py-2 px-2">Produit</th>
                  <th className="text-right py-2 px-2">Prix HT</th>
                  <th className="text-right py-2 px-2">Qté</th>
                  <th className="text-right py-2 px-2">Remise</th>
                  <th className="text-center py-2 px-2">Confiance</th>
                </tr>
              </thead>
              <tbody>
                {matchedProducts.map((p, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 px-2 font-mono text-xs">{p.ref}</td>
                    <td className="py-2 px-2">{p.nom}</td>
                    <td className="py-2 px-2 text-right font-mono">{(p.prix_ht || 0).toFixed(2)}€</td>
                    <td className="py-2 px-2 text-right">{p.quantite}</td>
                    <td className="py-2 px-2 text-right">{p.discount ? `${p.discount}%` : '—'}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${p.confiance === 'exact' ? 'bg-emerald-500' : p.confiance === 'fuzzy' ? 'bg-amber-400' : 'bg-red-400'}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 3: Client */}
      {step === 3 && <FacturesClientSearch onSelect={(client) => {
        setSelectedClient(client);
        doCalculation(client);
        setShippingId(getShippingIdForClient(client));
        setStep(4);
      }} onBack={() => setStep(2)} onModifySaisie={() => setStep(1)} />}

      {/* Step 4: Review */}
      {step === 4 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Récapitulatif</h3>
            <div className="flex items-center gap-3">
              <button onClick={() => setStep(1)} className="text-xs text-slate-500 hover:text-slate-700">Modifier la saisie</button>
              <button onClick={() => setStep(3)} className="text-xs text-slate-500 hover:text-slate-700">Changer de client</button>
            </div>
          </div>

          {selectedClient && (
            <div className="bg-slate-50 rounded-xl p-3">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">Facturation</div>
                  <div className="text-sm font-medium text-slate-800">{selectedClient.name}</div>
                  <div className="text-xs text-slate-500">{selectedClient.street}, {selectedClient.zip} {selectedClient.city}</div>
                </div>
                {deliveryAddress && (
                  <div className="flex-1 border-l border-slate-200 pl-4">
                    <div className="text-[10px] font-medium text-blue-500 uppercase tracking-wide mb-0.5">Livraison</div>
                    {deliveryAddress.split('\n').map((line, i) => (
                      <div key={i} className={`text-xs ${i === 0 ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{line}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {calculation && (() => {
            const productsHT = calculation.products?.reduce((s, p) => s + (p.total_ht || 0), 0) || 0;
            const fraisHT = (calculation.frais_port || []).reduce((s, f) => s + f.prix_ht * f.quantite, 0);
            const totalHT = productsHT + fraisHT;
            const productsTTC = calculation.products?.reduce((s, p) => s + (p.total_ttc || 0), 0) || 0;
            const fraisTTC = (calculation.frais_port || []).reduce((s, f) => s + f.prix_ht * f.quantite * 1.2, 0);
            const totalTTC = productsTTC + fraisTTC;
            return (
            <div className="space-y-3">
              {/* Option recalcul avec prix actuels */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-900">Les prix vous semblent incorrects ?</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Si les prix du fichier sont anciens, recalculez avec les prix actuels du catalogue
                    </p>
                  </div>
                  <button onClick={async () => {
                    try {
                      const res = await api.post('/factures/calculate', {
                        products: calculation.products.map(p => ({ ref: p.ref, quantite: p.quantite || p.quantity, discount: p.discount, tva: p.tva })),
                        clientName: selectedClient?.name,
                        includeShipping,
                      });
                      setCalculation(res);
                      showToast('Prix recalculés avec le catalogue actuel', 'success');
                    } catch (err) {
                      showToast('Erreur recalcul: ' + err.message, 'error');
                    }
                  }}
                    className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 whitespace-nowrap">
                    Recalculer avec prix actuels
                  </button>
                </div>
              </div>

              {/* Tableau produits avec prix unitaires */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500">Produit</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Qté</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">P.U. HT</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Remise</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500">Total HT</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {calculation.products?.map((p, i) => {
                      const qty = p.quantite || p.quantity || 1;
                      const discount = p.discount || 0;
                      const unitPrice = p.prix_ht || ((p.total_ht || 0) / qty / (1 - discount / 100) || 0);
                      const recalcLine = (newQty, newDiscount, newPrice) => {
                        const q = newQty ?? qty;
                        const d = newDiscount ?? discount;
                        const pu = newPrice ?? (p.prix_ht || unitPrice);
                        const tva = p.tva || 20;
                        const lineHT = pu * (1 - d / 100) * q;
                        return { quantite: q, discount: d, prix_ht: pu, total_ht: Math.round(lineHT * 100) / 100, total_ttc: Math.round(lineHT * (1 + tva / 100) * 100) / 100 };
                      };
                      return (
                        <tr key={`${p.ref}_${i}`} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-900">{p.ref}</div>
                            <div className="text-xs text-slate-500">{p.nom}</div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" min="1" value={qty}
                              onChange={e => {
                                const newQty = Math.max(1, parseInt(e.target.value) || 1);
                                const newProducts = [...calculation.products];
                                newProducts[i] = { ...newProducts[i], ...recalcLine(newQty, null, null) };
                                setCalculation({ ...calculation, products: newProducts });
                              }}
                              className="w-16 border border-slate-200 rounded px-1 py-0.5 text-sm text-right font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-700">{unitPrice.toFixed(2)}€</td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center">
                              <input type="number" step="0.5" min="0" max="100"
                                value={discount || ''}
                                placeholder="0"
                                onChange={e => {
                                  const val = e.target.value;
                                  const newDiscount = val === '' ? 0 : Math.min(100, Math.max(0, parseFloat(val) || 0));
                                  const newProducts = [...calculation.products];
                                  newProducts[i] = { ...newProducts[i], ...recalcLine(null, newDiscount, null) };
                                  setCalculation({ ...calculation, products: newProducts });
                                }}
                                className="w-16 border border-slate-200 rounded px-1 py-0.5 text-sm text-right font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                              <span className="text-xs text-slate-400 ml-0.5">%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-slate-900">{(p.total_ht || 0).toFixed(2)}€</td>
                          <td className="px-2 py-2 text-center">
                            <button onClick={() => {
                              const newProducts = calculation.products.filter((_, idx) => idx !== i);
                              setCalculation({ ...calculation, products: newProducts });
                            }} className="text-red-400 hover:text-red-600 text-sm" title="Supprimer">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Ajout de produit */}
              <div className="relative">
                <div className="flex gap-2">
                  <input type="text" value={addProductSearch} onChange={e => setAddProductSearch(e.target.value)}
                    placeholder="Ajouter un produit (ref ou nom)..."
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                  {addProductSearch && (
                    <button onClick={() => setAddProductSearch('')} className="text-xs text-slate-400 hover:text-slate-600 px-2">✕</button>
                  )}
                </div>
                {addProductSearch.length >= 2 && (() => {
                  const q = addProductSearch.toLowerCase();
                  const matches = catalog.filter(c =>
                    c.ref.toLowerCase().includes(q) || (c.nom || '').toLowerCase().includes(q)
                  ).slice(0, 8);
                  if (!matches.length) return null;
                  return (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {matches.map(c => (
                        <button key={c.ref} onClick={() => {
                          const tva = c.tva || 20;
                          const lineHT = c.prix_ht || 0;
                          const newProduct = {
                            ref: c.ref, nom: c.nom, quantite: 1, prix_ht: c.prix_ht || 0, discount: 0, tva,
                            total_ht: Math.round(lineHT * 100) / 100,
                            total_ttc: Math.round(lineHT * (1 + tva / 100) * 100) / 100,
                          };
                          setCalculation({ ...calculation, products: [...(calculation.products || []), newProduct] });
                          setAddProductSearch('');
                          showToast(`${c.ref} ajouté`, 'success');
                        }} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0">
                          <div>
                            <span className="text-sm font-medium text-slate-900">{c.ref}</span>
                            <span className="text-xs text-slate-500 ml-2">{c.nom}</span>
                          </div>
                          <span className="text-xs font-mono text-slate-600">{(c.prix_ht || 0).toFixed(2)}€</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {calculation.frais_port?.map((f, i) => (
                <div key={'fp'+i} className="flex items-center justify-between text-sm py-1 text-slate-500">
                  <span className="flex-1">{f.nom}</span>
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.01" min="0" value={f.prix_ht}
                      onChange={e => {
                        const newFrais = [...(calculation.frais_port || [])];
                        newFrais[i] = { ...newFrais[i], prix_ht: parseFloat(e.target.value) || 0 };
                        setCalculation({ ...calculation, frais_port: newFrais });
                      }}
                      className="w-20 border border-slate-200 rounded px-2 py-0.5 text-sm text-right font-mono" />
                    <span className="text-xs">€ HT</span>
                    <button onClick={() => {
                      const newFrais = (calculation.frais_port || []).filter((_, idx) => idx !== i);
                      setCalculation({ ...calculation, frais_port: newFrais });
                    }} className="ml-1 text-red-400 hover:text-red-600 text-xs" title="Supprimer">✕</button>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={() => {
                  const newFrais = [...(calculation.frais_port || []), { ref: 'FP', nom: 'FRAIS PREPARATION', prix_ht: 25, quantite: 1, tva: 20 }];
                  setCalculation({ ...calculation, frais_port: newFrais });
                }} className="text-xs text-blue-600 hover:text-blue-800">+ Frais préparation</button>
                <button onClick={() => {
                  const newFrais = [...(calculation.frais_port || []), { ref: 'FE', nom: 'FRAIS EXPEDITION', prix_ht: 80, quantite: 1, tva: 20 }];
                  setCalculation({ ...calculation, frais_port: newFrais });
                }} className="text-xs text-blue-600 hover:text-blue-800">+ Frais expédition</button>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
                <span>Total HT</span>
                <span className="font-mono">{totalHT.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600">
                <span>Total TTC</span>
                <span className="font-mono">{totalTTC.toFixed(2)}€</span>
              </div>
            </div>
            );
          })()}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Type de document</label>
              <select value={documentType} onChange={e => setDocumentType(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <option value="vat">Facture</option>
                <option value="proforma">Proforma</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">N° commande (optionnel)</label>
              <input value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Transporteur</label>
            <select value={shippingId} onChange={e => setShippingId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              {SHIPPING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} className="rounded" />
              Envoyer par email
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={logGSheets} onChange={e => setLogGSheets(e.target.checked)} className="rounded" />
              Logger dans Google Sheets
            </label>
          </div>

          <div className="flex gap-2">
            <button onClick={createInvoice} disabled={processing || !selectedClient || !calculation?.products?.length}
              className="flex-1 py-3 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {processing ? 'En cours...' : `Créer la ${documentType === 'proforma' ? 'proforma' : 'facture'} et envoyer au logisticien`}
            </button>
            <button onClick={logOnly} disabled={processing || !selectedClient || !calculation?.products?.length}
              className="py-3 px-4 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap">
              {processing ? '...' : 'Logger uniquement'}
            </button>
          </div>
          {orderNumber && (
            <button onClick={() => downloadCSVAndEmail()} disabled={!selectedClient || !shippingId}
              className="w-full py-3 bg-amber-600 text-white text-sm font-medium rounded-xl hover:bg-amber-700 disabled:opacity-50 transition-colors">
              CSV + Email Logisticien (sans créer de facture)
            </button>
          )}
        </div>
      )}

      {/* Step 5: Done */}
      {step === 5 && result && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4 text-center">
          <div className="text-4xl">✅</div>
          {result.logOnly ? (
            <>
              <h3 className="text-lg font-semibold text-slate-800">Log Google Sheets OK</h3>
              <p className="text-sm text-slate-500">
                {result.writtenLines} ligne(s) ajoutée(s) — Partenaire: {result.partnerName}
                {result.startRow && <span className="text-xs text-slate-400"> (lignes {result.startRow}-{result.endRow})</span>}
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold text-slate-800">Facture créée !</h3>
              <p className="text-sm text-slate-500">N° {result.number || result.id}</p>
            </>
          )}

          <div className="flex flex-wrap gap-2 justify-center">
            {result.id && !result.logOnly && (
              <button onClick={downloadPDF} className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-700">
                Télécharger PDF
              </button>
            )}
            {!result.logOnly && (
              <button onClick={downloadCSVAndEmail} className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
                CSV + Email Logisticien
              </button>
            )}
            {result.id && !result.logOnly && (
              <a href={`https://terredemars.vosfactures.fr/invoices/${result.id}`} target="_blank" rel="noopener"
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                Voir sur VosFactures ↗
              </a>
            )}
            <button onClick={() => { setStep(1); setResult(null); setMatchedProducts([]); setSelectedClient(null); setCalculation(null); setError(null); setManualText(''); setOrderNumber(''); setDeliveryAddress(''); }}
              className="px-4 py-2 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200">
              Nouvelle commande
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Client Search sub-component ──────────────────────────────────────────────
const FacturesClientSearch = ({ onSelect, onBack, onModifySaisie }) => {
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const searchTimer = useRef(null);
  const abortRef = useRef(null);

  const rechercher = (q, forceRefresh = false) => {
    setQuery(q);
    setErreur('');
    clearTimeout(searchTimer.current);
    if (abortRef.current) abortRef.current.abort();
    if (!q || q.length < 2) { setClients([]); return; }
    searchTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const refreshParam = forceRefresh ? '&refresh=true' : '';
        const res = await fetch(window.location.origin + '/api/factures/clients?q=' + encodeURIComponent(q) + refreshParam, {
          headers: { 'Authorization': 'Bearer ' + (sessionStorage.getItem('tdm_token') || '') },
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          setErreur(data.erreur || 'Erreur ' + res.status);
          setClients([]);
        } else {
          setClients(Array.isArray(data) ? data : []);
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        setErreur('Erreur réseau: ' + e.message); setClients([]);
      }
      setLoading(false);
    }, 400);
  };

  const forceRefresh = async () => {
    if (!query || query.length < 2) return;
    setRefreshing(true);
    setErreur('');
    try {
      const res = await fetch(window.location.origin + '/api/factures/clients?q=' + encodeURIComponent(query) + '&refresh=true', {
        headers: { 'Authorization': 'Bearer ' + (sessionStorage.getItem('tdm_token') || '') }
      });
      const data = await res.json();
      if (!res.ok) {
        setErreur(data.erreur || 'Erreur ' + res.status);
        setClients([]);
      } else {
        setClients(Array.isArray(data) ? data : []);
      }
    } catch (e) { setErreur('Erreur réseau: ' + e.message); setClients([]); }
    setRefreshing(false);
  };

  // Cleanup timer et abort controller au démontage
  useEffect(() => {
    return () => { clearTimeout(searchTimer.current); if (abortRef.current) abortRef.current.abort(); };
  }, []);

  // Escape pour fermer
  React.useEffect(() => {
    const handleEscape = (e) => { if (e.key === 'Escape') onBack?.(); };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onBack]);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Sélectionner un client</h3>
        <div className="flex items-center gap-3">
          {query.length >= 2 && (
            <button
              onClick={forceRefresh}
              disabled={refreshing}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {refreshing ? '⏳ Actualisation...' : '🔄 Actualiser'}
            </button>
          )}
          {onModifySaisie && <button onClick={onModifySaisie} className="text-xs text-slate-500 hover:text-slate-700">Modifier la saisie</button>}
          <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-700">← Retour</button>
        </div>
      </div>
      <input value={query} onChange={e => rechercher(e.target.value)} placeholder="Rechercher un client VosFactures..."
        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" autoFocus />
      {loading && <p className="text-xs text-slate-400">Chargement des clients VosFactures...</p>}
      {erreur && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{erreur}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-y-auto">
        {clients.map(c => (
          <button key={c.id} onClick={() => onSelect(c)}
            className="text-left p-3 border border-slate-200 rounded-xl hover:border-slate-400 hover:bg-slate-50 transition-colors">
            <div className="text-sm font-medium text-slate-800">{c.name || c.shortcut}</div>
            {c.city && <div className="text-xs text-slate-400">{c.city}</div>}
          </button>
        ))}
      </div>
      {query.length >= 2 && !loading && !erreur && clients.length === 0 && (
        <p className="text-xs text-slate-400 text-center">Aucun client trouvé</p>
      )}
    </div>
  );
};

// ─── Factures Batch ───────────────────────────────────────────────────────────
const FacturesBatch = ({ showToast }) => {
  const [orders, setOrders] = useState([]);
  const [nextId, setNextId] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [manualText, setManualText] = useState('');
  const [importInvoiceId, setImportInvoiceId] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [documentType, setDocumentType] = useState('vat');
  const [sendEmail, setSendEmail] = useState(true);
  const [logGSheets, setLogGSheets] = useState(true);

  const addOrder = (products, client = null, orderNumber = '', deliveryAddr = '') => {
    const shippingId = client ? getShippingIdForClient(client, deliveryAddr) : '1302';
    setOrders(prev => [...prev, { id: nextId, products, client, calculation: null, shippingId, orderNumber, deliveryAddress: deliveryAddr, expanded: false }]);
    setNextId(n => n + 1);
    // Auto-calculate if client is already set
    if (client) {
      calculateOrder(nextId, products, client);
    }
  };

  const calculateOrder = async (orderId, products, client) => {
    try {
      const res = await api.post('/factures/calculate', { products, clientName: client?.name, includeShipping: true });
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, calculation: res } : o));
    } catch (err) {
      showToast('Erreur calcul commande #' + orderId + ': ' + err.message, 'error');
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const products = [];
      for (const row of json) {
        if (!row[0] || row[0] === 'Ref 500ml' || row[0] === 'Menu Déroulant' || row[0] === 'TOTAL') continue;
        const rawRef = String(row[0]).trim();
        const qtyUnits = parseFloat(row[6]) || 0;
        const qtyCartons = parseFloat(row[5]) || 0;
        const quantity = qtyUnits > 0 ? qtyUnits : qtyCartons;
        let priceHT = parseFloat(String(row[3] || '0').replace(/[€\s]/g, '').replace(',', '.')) || 0;
        const discountStr = row[9] ? String(row[9]).trim() : '';
        let discount = 0;
        if (discountStr && discountStr !== '-') {
          discount = parseFloat(discountStr.replace('%', '').replace(',', '.')) || 0;
          if (discount > 0 && discount < 1) discount *= 100;
        }
        if (rawRef && quantity > 0) products.push({ ref: rawRef, quantity, priceHT, discount });
      }
      if (products.length > 0) {
        // Match products via API like Single does
        try {
          const matched = await api.post('/factures/match-products', { lignes: products });
          if (matched.erreur) { showToast(matched.erreur, 'error'); return; }
          addOrder(matched);
          showToast(matched.length + ' produit(s) ajoutés', 'success');
        } catch (matchErr) {
          showToast('Erreur matching: ' + matchErr.message, 'error');
        }
      } else {
        showToast('Aucun produit trouvé', 'error');
      }
    } catch (err) {
      showToast('Erreur: ' + err.message, 'error');
    }
    e.target.value = '';
  };

  const addManualOrder = async () => {
    if (!manualText.trim()) return;
    try {
      const res = await api.post('/factures/match-products', { text: manualText });
      if (res.erreur) { showToast(res.erreur, 'error'); return; }
      addOrder(res);
      setManualText('');
      showToast(res.length + ' produit(s) ajoutés', 'success');
    } catch (err) {
      showToast('Erreur: ' + err.message, 'error');
    }
  };

  const handleImportInvoice = async () => {
    const idOrNumber = importInvoiceId.trim();
    if (!idOrNumber) return;
    setImportLoading(true);
    try {
      let invoiceId = null;
      const results = await api.get('/factures/invoices/search?number=' + encodeURIComponent(idOrNumber));
      const list = Array.isArray(results) ? results : [];
      if (list.length > 0) {
        invoiceId = list[0].id;
      } else if (/^\d+$/.test(idOrNumber)) {
        invoiceId = idOrNumber;
      } else {
        showToast('Aucune facture trouvée pour "' + idOrNumber + '"', 'error');
        setImportLoading(false);
        return;
      }
      const data = await api.get('/factures/invoices/' + invoiceId + '/products');
      if (data.erreur) { showToast(data.erreur, 'error'); setImportLoading(false); return; }
      if (!data.products || data.products.length === 0) { showToast('Aucun produit trouvé dans cette facture', 'error'); setImportLoading(false); return; }
      addOrder(data.products, data.client || null, data.invoiceNumber || '', data.delivery_address || '');
      setImportInvoiceId('');
      showToast('Facture importée — ' + data.products.length + ' produit(s)', 'success');
    } catch (err) {
      showToast('Erreur import: ' + err.message, 'error');
    }
    setImportLoading(false);
  };

  const removeOrder = (id) => setOrders(prev => prev.filter(o => o.id !== id));

  const toggleExpanded = (id) => setOrders(prev => prev.map(o => o.id === id ? { ...o, expanded: !o.expanded } : o));

  const setOrderClient = async (orderId, client) => {
    const order = orders.find(o => o.id === orderId);
    const shippingId = getShippingIdForClient(client, order?.deliveryAddress || '');
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, client, shippingId } : o));
    if (order) {
      calculateOrder(orderId, order.products, client);
    }
  };

  const updateOrderField = (orderId, field, value) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, [field]: value } : o));
  };

  const updateOrderDiscount = (orderId, productIndex, newDiscount) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId || !o.calculation?.products) return o;
      const newProducts = [...o.calculation.products];
      const p = newProducts[productIndex];
      const qty = p.quantite || p.quantity || 1;
      const priceHT = p.prix_ht || ((p.total_ht || 0) / qty / (1 - (p.discount || 0) / 100) || 0);
      const tva = p.tva || 20;
      const lineHT = priceHT * (1 - newDiscount / 100) * qty;
      newProducts[productIndex] = { ...p, discount: newDiscount, total_ht: Math.round(lineHT * 100) / 100, total_ttc: Math.round(lineHT * (1 + tva / 100) * 100) / 100 };
      return { ...o, calculation: { ...o.calculation, products: newProducts } };
    }));
  };

  const updateOrderFraisPort = (orderId, fraisIndex, field, value) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId || !o.calculation) return o;
      const newFrais = [...(o.calculation.frais_port || [])];
      newFrais[fraisIndex] = { ...newFrais[fraisIndex], [field]: value };
      return { ...o, calculation: { ...o.calculation, frais_port: newFrais } };
    }));
  };

  const removeOrderFrais = (orderId, fraisIndex) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId || !o.calculation) return o;
      const newFrais = (o.calculation.frais_port || []).filter((_, idx) => idx !== fraisIndex);
      return { ...o, calculation: { ...o.calculation, frais_port: newFrais } };
    }));
  };

  const addOrderFrais = (orderId, type) => {
    const frais = type === 'FP'
      ? { ref: 'FP', nom: 'FRAIS PREPARATION', prix_ht: 25, quantite: 1, tva: 20 }
      : { ref: 'FE', nom: 'FRAIS EXPEDITION', prix_ht: 80, quantite: 1, tva: 20 };
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId || !o.calculation) return o;
      return { ...o, calculation: { ...o.calculation, frais_port: [...(o.calculation.frais_port || []), frais] } };
    }));
  };

  const recalculateOrder = async (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order?.calculation?.products || !order.client) return;
    try {
      const res = await api.post('/factures/calculate', {
        products: order.calculation.products.map(p => ({ ref: p.ref, quantite: p.quantite || p.quantity, discount: p.discount, tva: p.tva })),
        clientName: order.client.name,
        includeShipping: true,
      });
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, calculation: res } : o));
      showToast('Prix recalculés pour commande #' + orderId, 'success');
    } catch (err) {
      showToast('Erreur recalcul: ' + err.message, 'error');
    }
  };

  const readyOrders = orders.filter(o => o.client && o.calculation?.products?.length);

  const createAll = async () => {
    if (readyOrders.length === 0) { showToast('Aucune commande prête (client + produits requis)', 'error'); return; }
    setProcessing(true);
    const allResults = [];
    for (const order of readyOrders) {
      try {
        const inv = await api.post('/factures/invoices', {
          client: order.client,
          products: order.calculation.products,
          fraisPort: order.calculation.frais_port || [],
          documentType,
          orderNumber: order.orderNumber || '',
          sendEmail,
          logGSheets,
        });
        if (inv.erreur) throw new Error(inv.erreur);
        allResults.push({ ok: true, orderId: order.id, ...inv });
        // Ajouter automatiquement à la table shipments
        try {
          await api.post('/shipments', {
            type: 'commande',
            order_ref: order.orderNumber || inv.number || `CMD-${Date.now()}`,
            invoice_id: inv.id,
            invoice_number: inv.number,
            client_name: order.client?.name || '',
            client_email: order.client?.email || '',
            client_address: order.client?.street || '',
            client_city: order.client?.city || '',
            client_country: order.client?.country || 'FR',
            shipping_id: order.shippingId || '1302',
            montant_ht: inv.price_net || 0,
            montant_ttc: inv.price_gross || 0,
            notes: `Commande batch ${order.orderNumber || ''}`.trim(),
          });
        } catch (shipErr) {
          console.warn('Erreur ajout shipment:', shipErr);
        }
      } catch (err) {
        allResults.push({ ok: false, orderId: order.id, erreur: err.message });
      }
    }
    setResults(allResults);
    setProcessing(false);
    const okCount = allResults.filter(r => r.ok).length;
    const emailErrors = allResults.filter(r => r.ok && r.email_error);
    showToast(`${okCount}/${allResults.length} facture(s) créée(s)`, okCount > 0 ? 'success' : 'error');
    if (emailErrors.length > 0) {
      showToast(`${emailErrors.length} email(s) non envoyé(s)`, 'error');
    }
  };

  const logOnlyAll = async () => {
    if (readyOrders.length === 0) { showToast('Aucune commande prête (client + produits requis)', 'error'); return; }
    setProcessing(true);
    const allResults = [];
    for (const order of readyOrders) {
      try {
        const res = await api.post('/factures/log-only', {
          client: order.client,
          products: order.calculation.products,
          fraisPort: order.calculation.frais_port || [],
          orderNumber: order.orderNumber || '',
        });
        if (res.erreur) throw new Error(res.erreur);
        allResults.push({ ok: true, orderId: order.id, logOnly: true, ...res });
      } catch (err) {
        allResults.push({ ok: false, orderId: order.id, erreur: err.message });
      }
    }
    setResults(allResults);
    setProcessing(false);
    const okCount = allResults.filter(r => r.ok).length;
    showToast(`${okCount}/${allResults.length} commande(s) loggée(s) dans Google Sheets`, okCount > 0 ? 'success' : 'error');
  };

  const downloadCSVBatch = async (r) => {
    try {
      const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
      const order = orders.find(o => o.id === r.orderId);
      const invoiceData = { ...r, products: order?.calculation?.products || order?.products || [], orderNumber: order?.orderNumber || '' };
      const client = order?.client || {};
      const orderShippingId = order?.shippingId || '1302';
      const orderDeliveryAddress = order?.deliveryAddress || '';
      const res2 = await fetch(window.location.origin + '/api/factures/csv-logisticien', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceData, client, shippingId: orderShippingId, deliveryAddress: orderDeliveryAddress }),
      });
      if (!res2.ok) {
        const errData = await res2.json().catch(() => ({}));
        throw new Error(errData.erreur || 'Erreur CSV: ' + res2.status);
      }
      const blob = await res2.blob();
      const fileName = `logisticien-${r.number || 'facture'}.csv`;

      const dirName = await saveFileWithPicker(blob, fileName);
      if (dirName) {
        showToast(`CSV sauvé: ${dirName}/${fileName}`, 'success');
      } else {
        downloadFallback(blob, fileName);
        showToast('CSV téléchargé', 'success');
      }

      const clientName = client.name || '';
      const invoiceNum = order?.orderNumber || r.number || '';
      const subject = encodeURIComponent(`Commande : ${clientName} ${invoiceNum}`);
      const body = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint le CSV pour la commande ${invoiceNum} (${clientName}).\n\nCordialement`);
      const cc = encodeURIComponent('poulad@terredemars.com,alexandre@terredemars.com');
      window.open(`mailto:service.client@endurancelogistique.fr?cc=${cc}&subject=${subject}&body=${body}`, '_self');
    } catch (err) {
      showToast('Erreur CSV: ' + err.message, 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Commandes batch ({orders.length})</h3>

        {/* Inputs : Excel + Manuel + Import VF */}
        <div className="flex gap-2">
          <label className="px-4 py-2 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200 cursor-pointer">
            + Fichier Excel
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
          </label>
        </div>

        <div className="flex gap-2">
          <textarea value={manualText} onChange={e => setManualText(e.target.value)}
            placeholder="Saisie manuelle (10x P008-5000...)" rows={2}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-y min-h-[2.5rem]" />
          <button onClick={addManualOrder} disabled={!manualText.trim()}
            className="px-3 py-2 bg-slate-900 text-white text-sm rounded-lg disabled:opacity-40">+</button>
        </div>

        <div className="flex gap-2">
          <input type="text" value={importInvoiceId} onChange={e => setImportInvoiceId(e.target.value)}
            placeholder="Importer facture VF (n° ou ID)"
            onKeyDown={e => e.key === 'Enter' && handleImportInvoice()}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          <button onClick={handleImportInvoice} disabled={!importInvoiceId.trim() || importLoading}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap">
            {importLoading ? 'Import...' : 'Importer'}
          </button>
        </div>

        {/* Orders list with expandable review */}
        {orders.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">Ajoutez des commandes via Excel, saisie manuelle ou import facture VF.</div>
        )}
        {orders.map(order => {
          const calc = order.calculation;
          const productsHT = calc?.products?.reduce((s, p) => s + (p.total_ht || 0), 0) || 0;
          const fraisHT = (calc?.frais_port || []).reduce((s, f) => s + f.prix_ht * f.quantite, 0);
          const totalHT = productsHT + fraisHT;
          const productsTTC = calc?.products?.reduce((s, p) => s + (p.total_ttc || 0), 0) || 0;
          const fraisTTC = (calc?.frais_port || []).reduce((s, f) => s + f.prix_ht * f.quantite * 1.2, 0);
          const totalTTC = productsTTC + fraisTTC;

          return (
            <div key={order.id} className="border border-slate-200 rounded-xl overflow-hidden">
              {/* Order header */}
              <div className="p-3 flex items-center justify-between cursor-pointer hover:bg-slate-50" onClick={() => toggleExpanded(order.id)}>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{order.expanded ? '▼' : '▶'}</span>
                  <span className="text-sm font-medium">#{order.id} — {order.products?.length || calc?.products?.length || 0} produit(s)</span>
                  {order.client && (
                    <span className="text-xs text-emerald-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {order.client.name}
                    </span>
                  )}
                  {calc && <span className="text-xs font-mono text-slate-500">{totalHT.toFixed(2)}€ HT</span>}
                </div>
                <button onClick={e => { e.stopPropagation(); removeOrder(order.id); }} className="text-xs text-red-500 hover:text-red-700">Supprimer</button>
              </div>

              {/* Client selection if not set */}
              {!order.client && (
                <div className="px-3 pb-3">
                  <FacturesClientSearch onSelect={(c) => setOrderClient(order.id, c)} onBack={() => {}} />
                </div>
              )}

              {/* Expanded review panel */}
              {order.expanded && (
                <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                  {order.client && (
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-slate-700">
                        <span className="font-medium">{order.client.name}</span>
                        {order.client.city && <span className="text-xs text-slate-400 ml-2">{order.client.city}</span>}
                      </div>
                      <button onClick={() => setOrderClient(order.id, null)} className="text-xs text-slate-500 hover:text-slate-700">Changer client</button>
                    </div>
                  )}

                  {/* Recalculate button */}
                  {order.client && calc && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center justify-between">
                      <span className="text-xs text-amber-700">Prix incorrects ?</span>
                      <button onClick={() => recalculateOrder(order.id)}
                        className="px-2 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700">
                        Recalculer prix actuels
                      </button>
                    </div>
                  )}

                  {/* Products table */}
                  {calc?.products?.length > 0 && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="text-left px-3 py-1.5 text-xs font-semibold text-slate-500">Produit</th>
                            <th className="text-right px-3 py-1.5 text-xs font-semibold text-slate-500">Qté</th>
                            <th className="text-right px-3 py-1.5 text-xs font-semibold text-slate-500">P.U. HT</th>
                            <th className="text-right px-3 py-1.5 text-xs font-semibold text-slate-500">Remise</th>
                            <th className="text-right px-3 py-1.5 text-xs font-semibold text-slate-500">Total HT</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {calc.products.map((p, i) => {
                            const qty = p.quantite || p.quantity || 1;
                            const discount = p.discount || 0;
                            const unitPrice = p.prix_ht || ((p.total_ht || 0) / qty / (1 - discount / 100) || 0);
                            return (
                              <tr key={`${p.ref}_${i}`} className="hover:bg-slate-50">
                                <td className="px-3 py-1.5">
                                  <div className="font-medium text-slate-900 text-xs">{p.ref}</div>
                                  <div className="text-xs text-slate-400">{p.nom}</div>
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs">{qty}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs">{unitPrice.toFixed(2)}€</td>
                                <td className="px-3 py-1.5 text-right">
                                  <div className="inline-flex items-center">
                                    <input type="number" step="0.5" min="0" max="100"
                                      value={discount || ''}
                                      placeholder="0"
                                      onChange={e => {
                                        const val = e.target.value;
                                        const nd = val === '' ? 0 : Math.min(100, Math.max(0, parseFloat(val) || 0));
                                        updateOrderDiscount(order.id, i, nd);
                                      }}
                                      className="w-14 border border-slate-200 rounded px-1 py-0.5 text-xs text-right font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                                    <span className="text-xs text-slate-400 ml-0.5">%</span>
                                  </div>
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs font-medium">{(p.total_ht || 0).toFixed(2)}€</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Frais de port */}
                  {calc?.frais_port?.map((f, i) => (
                    <div key={'fp'+i} className="flex items-center justify-between text-sm py-1 text-slate-500">
                      <span className="flex-1 text-xs">{f.nom}</span>
                      <div className="flex items-center gap-1">
                        <input type="number" step="0.01" min="0" value={f.prix_ht}
                          onChange={e => updateOrderFraisPort(order.id, i, 'prix_ht', parseFloat(e.target.value) || 0)}
                          className="w-20 border border-slate-200 rounded px-2 py-0.5 text-xs text-right font-mono" />
                        <span className="text-xs">€ HT</span>
                        <button onClick={() => removeOrderFrais(order.id, i)} className="ml-1 text-red-400 hover:text-red-600 text-xs" title="Supprimer">✕</button>
                      </div>
                    </div>
                  ))}
                  {calc && (
                    <div className="flex gap-2">
                      <button onClick={() => addOrderFrais(order.id, 'FP')} className="text-xs text-blue-600 hover:text-blue-800">+ Frais préparation</button>
                      <button onClick={() => addOrderFrais(order.id, 'FE')} className="text-xs text-blue-600 hover:text-blue-800">+ Frais expédition</button>
                    </div>
                  )}

                  {/* Totals */}
                  {calc && (
                    <div className="space-y-1">
                      <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold text-sm">
                        <span>Total HT</span>
                        <span className="font-mono">{totalHT.toFixed(2)}€</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Total TTC</span>
                        <span className="font-mono">{totalTTC.toFixed(2)}€</span>
                      </div>
                    </div>
                  )}

                  {/* Order number + Shipping */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1 block">N° commande</label>
                      <input value={order.orderNumber} onChange={e => updateOrderField(order.id, 'orderNumber', e.target.value)}
                        placeholder="Optionnel"
                        className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500 mb-1 block">Transporteur</label>
                      <select value={order.shippingId} onChange={e => updateOrderField(order.id, 'shippingId', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white">
                        {SHIPPING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Global options + action buttons */}
        {orders.length > 0 && (
          <>
            <div className="border-t border-slate-200 pt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">Type de document</label>
                  <select value={documentType} onChange={e => setDocumentType(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <option value="vat">Facture</option>
                    <option value="proforma">Proforma</option>
                  </select>
                </div>
                <div className="flex items-end gap-4 pb-1">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} className="rounded" />
                    Email
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={logGSheets} onChange={e => setLogGSheets(e.target.checked)} className="rounded" />
                    GSheets
                  </label>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={createAll} disabled={processing || readyOrders.length === 0}
                className="flex-1 py-3 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-700 disabled:opacity-50 transition-colors">
                {processing ? 'Création...' : `Créer ${readyOrders.length} ${documentType === 'proforma' ? 'proforma(s)' : 'facture(s)'}`}
              </button>
              <button onClick={logOnlyAll} disabled={processing || readyOrders.length === 0}
                className="py-3 px-4 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap">
                {processing ? '...' : 'Logger uniquement'}
              </button>
            </div>
          </>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-1">
            {results.map((r, i) => (
              <div key={i} className={`text-sm p-2 rounded-lg ${r.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                <div className="flex items-center justify-between">
                  <span>
                    {r.ok
                      ? (r.logOnly
                        ? `Log OK — ${r.writtenLines || 0} ligne(s) (${r.partnerName || ''})`
                        : `Facture ${r.number || r.id} créée`)
                      : `Erreur: ${r.erreur}`}
                  </span>
                  <div className="flex items-center gap-1">
                    {r.ok && !r.logOnly && r.id && (
                      <a href={`https://terredemars.vosfactures.fr/invoices/${r.id}`} target="_blank" rel="noopener"
                        className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">
                        VF ↗
                      </a>
                    )}
                    {r.ok && !r.logOnly && (
                      <button onClick={() => downloadCSVBatch(r)}
                        className="px-2 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700">
                        CSV + Email
                      </button>
                    )}
                  </div>
                </div>
                {r.ok && r.email_error && (
                  <div className="text-xs text-amber-600 mt-1">Email non envoyé : {r.email_error}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Factures Échantillons ────────────────────────────────────────────────────
const FacturesSamples = ({ showToast }) => {
  const [catalog, setCatalog] = useState([]);
  const [products, setProducts] = useState([
    { ref: 'P035-30', quantity: 1 }, { ref: 'P011-30', quantity: 1 },
    { ref: 'P008-30', quantity: 1 }, { ref: 'P007-30', quantity: 1 },
    { ref: 'P042-30', quantity: 1 }, { ref: 'P010-30', quantity: 1 },
  ]);
  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientCity, setClientCity] = useState('');
  const [clientZip, setClientZip] = useState('');
  const [clientCountry, setClientCountry] = useState('FR');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [searchRef, setSearchRef] = useState('');
  const [shippingId, setShippingId] = useState('300');
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState([]);
  const [searchingClient, setSearchingClient] = useState(false);
  const clientSearchTimer = useRef(null);
  const clientAbortRef = useRef(null);

  useEffect(() => {
    api.get('/factures/produits').then(data => setCatalog(Array.isArray(data) ? data : [])).catch(e => console.error(e));
  }, []);

  const rechercherClient = (q) => {
    setClientSearch(q);
    clearTimeout(clientSearchTimer.current);
    if (clientAbortRef.current) clientAbortRef.current.abort();
    if (!q || q.length < 2) { setClientResults([]); return; }
    clientSearchTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      clientAbortRef.current = controller;
      setSearchingClient(true);
      try {
        const data = await api.get('/factures/clients?q=' + encodeURIComponent(q));
        if (!controller.signal.aborted) setClientResults(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!controller.signal.aborted) setClientResults([]);
      }
      if (!controller.signal.aborted) setSearchingClient(false);
    }, 400);
  };

  const selectClient = (c) => {
    setClientName(c.name || '');
    setClientEmail(c.email || '');
    setClientAddress(c.street || '');
    setClientCity(c.city || '');
    setClientZip(c.post_code || '');
    setClientCountry(c.country || 'FR');
    setClientPhone(c.phone || '');
    setClientSearch('');
    setClientResults([]);
  };

  const addProduct = (ref) => {
    const existing = products.find(p => p.ref === ref);
    if (existing) setProducts(products.map(p => p.ref === ref ? { ...p, quantity: p.quantity + 1 } : p));
    else setProducts([...products, { ref, quantity: 1 }]);
    setSearchRef('');
  };

  const updateQty = (ref, qty) => {
    if (qty <= 0) setProducts(products.filter(p => p.ref !== ref));
    else setProducts(products.map(p => p.ref === ref ? { ...p, quantity: qty } : p));
  };

  const createProforma = async () => {
    if (!clientName.trim() || products.length === 0) {
      showToast('Nom du destinataire et produits requis', 'error'); return;
    }
    setProcessing(true);
    try {
      const res = await api.post('/factures/invoices', {
        client: { name: clientName, street: clientAddress, city: clientCity, zip: clientZip, country: clientCountry, email: clientEmail, phone: clientPhone },
        products: products.map(p => {
          const cat = catalog.find(c => c.ref === p.ref);
          return { ref: p.ref, quantite: p.quantity, prix_ht: cat?.prix_ht || 0, nom: cat?.nom || p.ref, tva: 20 };
        }),
        fraisPort: [{ ref: 'FP', nom: 'FRAIS PREPARATION', prix_ht: 25, quantite: 1, tva: 20 }],
        documentType: 'proforma',
        logGSheets: false,
      });
      if (res.erreur) throw new Error(res.erreur);
      setResult(res);
      showToast('Proforma créée !', 'success');

      // Ajouter automatiquement à la table shipments
      try {
        await api.post('/shipments', {
          type: 'echantillon',
          order_ref: res.number || `ECH-${Date.now()}`,
          invoice_id: res.id,
          invoice_number: res.number,
          client_name: clientName,
          client_email: clientEmail || '',
          client_address: clientAddress || '',
          client_city: clientCity || '',
          client_country: clientCountry || 'FR',
          shipping_id: shippingId,
          shipping_name: '', // Sera rempli si nécessaire
          montant_ht: res.price_net || 0,
          montant_ttc: res.price_gross || 0,
          notes: 'Proforma échantillon',
        });
      } catch (shipErr) {
        console.warn('Erreur ajout shipment:', shipErr);
        // Ne pas bloquer si l'ajout échoue
      }
    } catch (err) {
      showToast('Erreur: ' + err.message, 'error');
    }
    setProcessing(false);
  };

  const filteredCatalog = searchRef
    ? catalog.filter(c => c.ref.toLowerCase().includes(searchRef.toLowerCase()) || c.nom.toLowerCase().includes(searchRef.toLowerCase()))
    : [];

  const downloadCSVAndEmailSamples = async () => {
    if (!result) return;
    try {
      const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
      const invoiceData = {
        ...result,
        products: products.map(p => {
          const cat = catalog.find(c => c.ref === p.ref);
          return { ref: p.ref, quantite: p.quantity, prix_ht: cat?.prix_ht || 0, nom: cat?.nom || p.ref, tva: 20 };
        }),
      };
      const client = { name: clientName, street: clientAddress, city: clientCity, zip: clientZip, country: clientCountry, email: clientEmail, phone: clientPhone };
      const res = await fetch(window.location.origin + '/api/factures/csv-logisticien', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceData, client, shippingId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.erreur || 'Erreur CSV: ' + res.status);
      }
      const blob = await res.blob();
      const fileName = `logisticien-${result?.number || 'proforma'}.csv`;

      const dirName = await saveFileWithPicker(blob, fileName);
      if (dirName) {
        showToast(`CSV sauvé: ${dirName}/${fileName}`, 'success');
      } else {
        downloadFallback(blob, fileName);
        showToast('CSV téléchargé', 'success');
      }

      // Ouvrir mailto logisticien avec bon objet pour échantillons
      const invoiceNum = result?.number || '';
      const subject = encodeURIComponent(`Échantillons : ${clientName} ${invoiceNum}`);
      const body = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint le CSV pour la demande d'échantillons ${invoiceNum} (${clientName}).\n\nCordialement`);
      const cc = encodeURIComponent('poulad@terredemars.com,alexandre@terredemars.com');
      window.open(`mailto:service.client@endurancelogistique.fr?cc=${cc}&subject=${subject}&body=${body}`, '_self');
    } catch (err) {
      showToast('Erreur CSV: ' + err.message, 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Échantillons — Proforma + CSV</h3>

        {/* Products picker */}
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Produits</label>
          <div className="space-y-1">
            {products.map(p => {
              const cat = catalog.find(c => c.ref === p.ref);
              return (
                <div key={p.ref} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs w-20">{p.ref}</span>
                  <span className="flex-1 text-slate-600 text-xs truncate">{cat?.nom || '...'}</span>
                  <input type="number" min={0} value={p.quantity} onChange={e => updateQty(p.ref, parseInt(e.target.value) || 0)}
                    className="w-16 border border-slate-200 rounded px-2 py-1 text-sm text-center" />
                </div>
              );
            })}
          </div>
          <div className="mt-2 relative">
            <input value={searchRef} onChange={e => setSearchRef(e.target.value)}
              placeholder="Ajouter un produit (code ou nom)..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            {filteredCatalog.length > 0 && (
              <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg mt-1 max-h-40 overflow-y-auto shadow-lg">
                {filteredCatalog.slice(0, 10).map(c => (
                  <button key={c.ref} onClick={() => addProduct(c.ref)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{c.ref}</span>
                    <span className="truncate">{c.nom}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Client search */}
        <div className="relative">
          <label className="text-xs font-medium text-slate-500 mb-1 block">Rechercher un client VosFactures</label>
          <input value={clientSearch} onChange={e => rechercherClient(e.target.value)}
            placeholder="Nom, email ou ville..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          {searchingClient && <div className="absolute right-3 top-8 text-xs text-slate-400">Recherche...</div>}
          {clientResults.length > 0 && (
            <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg mt-1 max-h-48 overflow-y-auto shadow-lg">
              {clientResults.slice(0, 10).map(c => (
                <button key={c.id} onClick={() => selectClient(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  <span className="font-medium">{c.name}</span>
                  {c.city && <span className="text-slate-400 ml-2">{c.city}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Recipient */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Nom destinataire *</label>
            <input value={clientName} onChange={e => setClientName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Email</label>
            <input value={clientEmail} onChange={e => setClientEmail(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-slate-500 mb-1 block">Adresse (rue)</label>
            <textarea value={clientAddress} onChange={e => setClientAddress(e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Ville</label>
            <input value={clientCity} onChange={e => setClientCity(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Code postal</label>
            <input value={clientZip} onChange={e => setClientZip(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Pays</label>
            <input value={clientCountry} onChange={e => setClientCountry(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Téléphone</label>
            <input value={clientPhone} onChange={e => setClientPhone(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-slate-500 mb-1 block">Transporteur</label>
            <select value={shippingId} onChange={e => setShippingId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              {SHIPPING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <button onClick={createProforma} disabled={processing || !clientName.trim()}
          className="w-full py-3 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-700 disabled:opacity-50">
          {processing ? 'Création...' : 'Créer proforma échantillons'}
        </button>

        {result && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center space-y-2">
            <p className="text-sm font-medium text-emerald-700">Proforma N° {result.number || result.id} créée !</p>
            <div className="flex gap-2 justify-center flex-wrap">
              {result.id && (
                <a href={`https://terredemars.vosfactures.fr/invoices/${result.id}`} target="_blank" rel="noopener"
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg">Voir ↗</a>
              )}
              <button onClick={downloadCSVAndEmailSamples}
                className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700">
                CSV + Email Logisticien
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Factures Relances ────────────────────────────────────────────────────────
const FacturesReminders = ({ showToast }) => {
  const [input, setInput] = useState('');
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const resolveDocuments = async () => {
    if (!input.trim()) return;
    setLoading(true);
    const items = input.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    const resolved = [];

    for (const item of items) {
      try {
        // Essayer comme numéro de facture
        let num = item.replace(/.*\/invoices\//, '').replace(/\.json.*/, '').replace(/[^\w-]/g, '');
        let data;

        if (/^\d+$/.test(num)) {
          // C'est un ID numérique
          data = await api.get(`/factures/invoices/${num}`);
        } else {
          // Chercher par numéro
          const results = await api.get(`/factures/invoices/search?number=${encodeURIComponent(num)}`);
          data = Array.isArray(results) ? results[0] : results;
        }

        if (data && data.id) {
          resolved.push({ ...data, sendEmail: true, status: data.payment_to ? 'impayé' : 'ok' });
        } else {
          resolved.push({ input: item, erreur: 'Document non trouvé' });
        }
      } catch (err) {
        resolved.push({ input: item, erreur: err.message });
      }
    }
    setDocs(resolved);
    setLoading(false);
  };

  const sendReminders = async () => {
    setSending(true);
    let sent = 0;
    let updated = [...docs];
    for (let i = 0; i < updated.length; i++) {
      const doc = updated[i];
      if (!doc.id || !doc.sendEmail) continue;
      try {
        await api.post(`/factures/invoices/${doc.id}/send-reminder`, {});
        updated[i] = { ...doc, sent: true };
        sent++;
      } catch (err) {
        updated[i] = { ...doc, sendError: err.message };
      }
    }
    setDocs(updated);
    setSending(false);
    showToast(`${sent} relance(s) envoyée(s)`, 'success');
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Relances de paiement</h3>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Numéros de facture, URLs ou IDs VosFactures</label>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            placeholder={"FV 2024/12/001\n1234567\nhttps://terredemars.vosfactures.fr/invoices/123456"}
            rows={4} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono resize-y" />
        </div>
        <button onClick={resolveDocuments} disabled={loading || !input.trim()}
          className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg disabled:opacity-40">
          {loading ? 'Résolution...' : 'Résoudre les documents'}
        </button>

        {docs.length > 0 && (
          <div className="space-y-2">
            {docs.map((doc, i) => (
              <div key={i} className={`p-3 rounded-xl border ${doc.erreur ? 'border-red-200 bg-red-50' : doc.sent ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'}`}>
                {doc.erreur ? (
                  <div className="text-sm text-red-700">{doc.input}: {doc.erreur}</div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{doc.number || doc.id}</div>
                      <div className="text-xs text-slate-500">{doc.buyer_name} — {doc.price_gross}€</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {doc.sent && <span className="text-xs text-emerald-600 font-medium">Envoyé ✓</span>}
                      {doc.sendError && <span className="text-xs text-red-600">{doc.sendError}</span>}
                      {!doc.sent && (
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={doc.sendEmail}
                            onChange={() => setDocs(prev => prev.map((d, idx) => idx === i ? { ...d, sendEmail: !d.sendEmail } : d))} />
                          Relancer
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            <button onClick={sendReminders} disabled={sending || !docs.some(d => d.id && d.sendEmail && !d.sent)}
              className="w-full py-3 bg-amber-600 text-white text-sm font-medium rounded-xl hover:bg-amber-700 disabled:opacity-50">
              {sending ? 'Envoi...' : `Envoyer ${docs.filter(d => d.id && d.sendEmail && !d.sent).length} relance(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Modal Ajout Manuel d'Envoi ──────────────────────────────────────────────
const ModalAddShipment = ({ isOpen, onClose, onAdded, showToast }) => {
  useEscapeClose(onClose);
  const [type, setType] = useState('echantillon');
  const [orderRef, setOrderRef] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientCity, setClientCity] = useState('');
  const [clientCountry, setClientCountry] = useState('FR');
  const [shippingId, setShippingId] = useState('300');
  const [montantHT, setMontantHT] = useState('0');
  const [montantTTC, setMontantTTC] = useState('0');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!orderRef.trim() || !clientName.trim()) {
      showToast('Référence commande et nom client requis', 'error');
      return;
    }

    setSaving(true);
    try {
      await api.post('/shipments', {
        type,
        order_ref: orderRef,
        invoice_number: invoiceNumber || null,
        client_name: clientName,
        client_email: clientEmail || '',
        client_address: clientAddress || '',
        client_city: clientCity || '',
        client_country: clientCountry || 'FR',
        shipping_id: shippingId,
        montant_ht: parseFloat(montantHT) || 0,
        montant_ttc: parseFloat(montantTTC) || 0,
        notes: notes || '',
      });

      showToast('Envoi ajouté avec succès', 'success');
      onAdded();
      onClose();

      // Reset form
      setOrderRef('');
      setInvoiceNumber('');
      setClientName('');
      setClientEmail('');
      setClientAddress('');
      setClientCity('');
      setClientCountry('FR');
      setShippingId('300');
      setMontantHT('0');
      setMontantTTC('0');
      setNotes('');
    } catch (err) {
      showToast('Erreur: ' + err.message, 'error');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-900">Ajouter un envoi</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Type d'envoi *</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="echantillon">🎁 Échantillon</option>
              <option value="commande">📦 Commande</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Référence commande *</label>
              <input value={orderRef} onChange={e => setOrderRef(e.target.value)}
                placeholder="Ex: ECH001, P4456..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">N° facture</label>
              <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="Optionnel"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Nom client *</label>
            <input value={clientName} onChange={e => setClientName(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Email client</label>
              <input value={clientEmail} onChange={e => setClientEmail(e.target.value)}
                type="email"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Ville</label>
              <input value={clientCity} onChange={e => setClientCity(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Adresse</label>
            <input value={clientAddress} onChange={e => setClientAddress(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Pays</label>
              <input value={clientCountry} onChange={e => setClientCountry(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Transporteur</label>
              <select value={shippingId} onChange={e => setShippingId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="1">1 - Enlevement Colis</option>
                <option value="2">2 - Enlevement Palette</option>
                <option value="4">4 - Lettre Suivie</option>
                <option value="101">101 - Coursier Colis</option>
                <option value="102">102 - Coursier Palettes</option>
                <option value="103">103 - Affretement</option>
                <option value="200">200 - Affranchissement</option>
                <option value="300">300 - Colissimo Expert France</option>
                <option value="301">301 - Colissimo Expert DOM</option>
                <option value="302">302 - Colissimo Expert International</option>
                <option value="303">303 - SO Colissimo Avec Signature</option>
                <option value="304">304 - SO Colissimo Sans Signature</option>
                <option value="306">306 - SO Colissimo Bureau de Poste</option>
                <option value="307">307 - SO Colissimo Cityssimo</option>
                <option value="308">308 - SO Colissimo ACP</option>
                <option value="309">309 - SO Colissimo A2P</option>
                <option value="311">311 - SO Colissimo CDI</option>
                <option value="312">312 - Colissimo Access France</option>
                <option value="600">600 - TNT Avant 13H France</option>
                <option value="601">601 - TNT Relais Colis France</option>
                <option value="900">900 - UPS Inter Standard</option>
                <option value="901">901 - UPS Inter Express</option>
                <option value="902">902 - UPS Inter Express Saver</option>
                <option value="903">903 - UPS Express Plus</option>
                <option value="904">904 - UPS Expedited</option>
                <option value="1000">1000 - DHL</option>
                <option value="1100">1100 - GEODIS</option>
                <option value="1300">1300 - Chronopost 13H</option>
                <option value="1301">1301 - Chronopost Classic - intl</option>
                <option value="1302">1302 - Chronopost 13H Instance Agence</option>
                <option value="1303">1303 - Chronopost Relais 13H</option>
                <option value="1304">1304 - Chronopost Express - intl</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Montant HT (€)</label>
              <input value={montantHT} onChange={e => setMontantHT(e.target.value)}
                type="number" step="0.01"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Montant TTC (€)</label>
              <input value={montantTTC} onChange={e => setMontantTTC(e.target.value)}
                type="number" step="0.01"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">
            Annuler
          </button>
          <button onClick={handleSubmit} disabled={saving || !orderRef.trim() || !clientName.trim()}
            className="px-6 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50">
            {saving ? 'Ajout...' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Factures Envois (Dashboard tous les envois) ──────────────────────────────
const FacturesShipments = ({ showToast }) => {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [shipments, setShipments] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // all, commande, echantillon
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const loadShipments = async () => {
    setLoading(true);
    try {
      const params = filter !== 'all' ? `?type=${filter}` : '';
      const data = await api.get(`/shipments${params}`);
      setShipments(data.shipments || []);
    } catch (err) {
      showToast('Erreur chargement envois: ' + err.message, 'error');
    }
    setLoading(false);
  };

  const loadStats = async () => {
    try {
      const data = await api.get('/shipments/stats');
      setStats(data);
    } catch (err) {
      console.error('Erreur stats:', err);
    }
  };

  useEffect(() => {
    loadShipments();
    loadStats();
  }, [filter]);

  const refreshWMS = async (id) => {
    try {
      await api.post(`/shipments/${id}/refresh-wms`, {});
      showToast('Statut WMS mis à jour', 'success');
      loadShipments();
    } catch (err) {
      showToast('Erreur refresh WMS: ' + err.message, 'error');
    }
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const data = await api.post('/shipments/refresh-all', {});
      showToast(`${data.updated} envoi(s) mis à jour`, 'success');
      loadShipments();
      loadStats();
    } catch (err) {
      showToast('Erreur refresh: ' + err.message, 'error');
    }
    setRefreshing(false);
  };

  const deleteShipment = async (id) => {
    if (!await confirmDialog('Supprimer cet envoi ?', { danger: true, confirmLabel: 'Supprimer' })) return;
    try {
      await api.delete(`/shipments/${id}`);
      showToast('Envoi supprimé', 'success');
      loadShipments();
      loadStats();
    } catch (err) {
      showToast('Erreur suppression: ' + err.message, 'error');
    }
  };

  const trackingUrl = (transporteur, numero) => {
    if (!numero) return null;
    const t = (transporteur || '').toLowerCase();
    if (t.includes('chronopost')) return `https://www.chronopost.fr/tracking-no-powerful/tracking/suivi?listeNumerosLT=${numero}`;
    if (t.includes('colissimo')) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${numero}`;
    if (t.includes('ups')) return `https://www.ups.com/track?tracknum=${numero}`;
    if (t.includes('dhl')) return `https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=${numero}`;
    if (t.includes('tnt') || t.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${numero}`;
    return null;
  };

  const filtered = shipments.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.order_ref?.toLowerCase().includes(q) ||
      s.client_name?.toLowerCase().includes(q) ||
      s.invoice_number?.toLowerCase().includes(q) ||
      s.tracking_number?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
            <div className="text-xs font-medium text-blue-600 mb-1">Commandes</div>
            <div className="text-2xl font-bold text-blue-900">{stats.commandes.total}</div>
            <div className="text-xs text-blue-700 mt-1">CA: {stats.commandes.ca_ht.toFixed(2)}€ HT</div>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4 border border-emerald-200">
            <div className="text-xs font-medium text-emerald-600 mb-1">Échantillons</div>
            <div className="text-2xl font-bold text-emerald-900">{stats.echantillons.total}</div>
            <div className="text-xs text-emerald-700 mt-1">CA: {stats.echantillons.ca_ht.toFixed(2)}€ HT</div>
          </div>
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 border border-slate-200">
            <div className="text-xs font-medium text-slate-600 mb-1">Total</div>
            <div className="text-2xl font-bold text-slate-900">{stats.total.envois}</div>
            <div className="text-xs text-slate-700 mt-1">CA: {stats.total.ca_ht.toFixed(2)}€ HT</div>
          </div>
        </div>
      )}

      {/* Filtres */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <button onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              Tous
            </button>
            <button onClick={() => setFilter('commande')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filter === 'commande' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}>
              Commandes
            </button>
            <button onClick={() => setFilter('echantillon')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filter === 'echantillon' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
              Échantillons
            </button>
          </div>

          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher (ref, client, facture, tracking)..."
            className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
          />

          <button onClick={() => setShowAddModal(true)}
            className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 flex items-center gap-1.5">
            ➕ Ajouter un envoi
          </button>

          <button onClick={refreshAll} disabled={refreshing}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5">
            {refreshing ? '⏳' : '🔄'} Rafraîchir tous
          </button>
        </div>
      </div>

      {/* Modal Ajout */}
      <ModalAddShipment
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={() => { loadShipments(); loadStats(); }}
        showToast={showToast}
      />

      {/* Liste des envois */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Aucun envoi trouvé</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Référence</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Transporteur</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Statut WMS</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tracking</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Montant</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Date</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${s.type === 'commande' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {s.type === 'commande' ? '📦 Commande' : '🎁 Échantillon'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-900">{s.order_ref}</div>
                      {s.invoice_number && <div className="text-xs text-slate-500">{s.invoice_number}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-900">{s.client_name}</div>
                      {s.client_city && <div className="text-xs text-slate-500">{s.client_city}, {s.client_country}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{s.shipping_name || `ID ${s.shipping_id}`}</td>
                    <td className="px-4 py-3">
                      {s.wms_status ? (
                        <span className="text-xs text-slate-700">{s.wms_status}</span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Non vérifié</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.tracking_number ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-700">{s.tracking_number}</span>
                          {trackingUrl(s.carrier_name, s.tracking_number) && (
                            <a href={trackingUrl(s.carrier_name, s.tracking_number)} target="_blank" rel="noopener"
                              className="text-blue-600 hover:text-blue-800 text-xs">🔗</a>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{s.montant_ht?.toFixed(2) || '0.00'}€</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{parseUTC(s.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => refreshWMS(s.id)}
                          className="text-xs text-blue-600 hover:text-blue-800" title="Rafraîchir WMS">
                          🔄
                        </button>
                        <button onClick={() => deleteShipment(s.id)}
                          className="text-xs text-red-600 hover:text-red-800" title="Supprimer">
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirmDialogEl}
    </div>
  );
};

// ─── Factures Tracking (WMS Endurance) ────────────────────────────────────────
const FacturesTracking = ({ showToast }) => {
  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const trackOrders = async () => {
    const refs = searchInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (!refs.length) { showToast('Entrez au moins un n° de commande', 'error'); return; }
    setLoading(true);
    try {
      if (refs.length === 1) {
        const data = await api.get('/factures/wms/tracking/' + encodeURIComponent(refs[0]));
        setResults([data]);
      } else {
        const data = await api.post('/factures/wms/tracking-batch', { orderRefs: refs });
        setResults(data);
      }
    } catch (err) {
      showToast('Erreur tracking: ' + err.message, 'error');
    }
    setLoading(false);
  };

  const statusColor = (code) => {
    if (!code) return 'bg-slate-100 text-slate-600';
    const c = String(code).toLowerCase();
    if (c.includes('livr') || c === '9' || c === '10') return 'bg-emerald-100 text-emerald-700';
    if (c.includes('expedi') || c === '7' || c === '8') return 'bg-blue-100 text-blue-700';
    if (c.includes('prepar') || c === '3' || c === '4' || c === '5') return 'bg-amber-100 text-amber-700';
    if (c.includes('rupture') || c.includes('erreur')) return 'bg-red-100 text-red-700';
    return 'bg-slate-100 text-slate-600';
  };

  const trackingUrl = (transporteur, numero) => {
    if (!numero) return null;
    const t = (transporteur || '').toLowerCase();
    if (t.includes('chronopost')) return `https://www.chronopost.fr/tracking-no-powerful/tracking/suivi?listeNumerosLT=${numero}`;
    if (t.includes('colissimo')) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${numero}`;
    if (t.includes('ups')) return `https://www.ups.com/track?tracknum=${numero}`;
    if (t.includes('dhl')) return `https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=${numero}`;
    if (t.includes('tnt') || t.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${numero}`;
    if (t.includes('coursier')) return null;
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Tracking WMS Endurance Logistique</h3>

        <div className="flex gap-2">
          <textarea value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="N° de commande (un par ligne ou séparés par virgule)..."
            rows={2} className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-none" />
          <button onClick={trackOrders} disabled={loading || !searchInput.trim()}
            className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-40 self-end">
            {loading ? '...' : 'Suivre'}
          </button>
        </div>

        {results.length > 0 && (
          <div className="space-y-3">
            {results.map((r, i) => (
              <div key={i} className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-medium text-slate-800">{r.delivery_order}</span>
                  {r.status?.code_etat && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.status.code_etat)}`}>
                      {r.status.libelle_etat || `Code ${r.status.code_etat}`}
                    </span>
                  )}
                  {r.error && <span className="text-xs text-red-500">{r.error}</span>}
                </div>

                {r.tracking && !r.tracking.error && (r.tracking.tracking || r.tracking.transporteur) && (
                  <div className="bg-blue-50 rounded-lg p-3 space-y-1">
                    <div className="text-xs text-blue-600 font-medium">Suivi</div>
                    {r.tracking.transporteur && (
                      <div className="text-sm text-slate-700">Transporteur : <span className="font-medium">{r.tracking.transporteur}</span></div>
                    )}
                    {r.tracking.tracking && (
                      <div className="text-sm text-slate-700 flex items-center gap-2">
                        <span>N° suivi : <span className="font-mono font-medium">{r.tracking.tracking}</span></span>
                        {trackingUrl(r.tracking.transporteur, r.tracking.tracking) && (
                          <a href={trackingUrl(r.tracking.transporteur, r.tracking.tracking)} target="_blank" rel="noopener"
                            className="text-blue-600 hover:text-blue-800 text-xs underline">Suivre le colis</a>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {r.historique && !r.historique.error && (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-xs text-slate-500 font-medium mb-1">Historique</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {r.historique.date_creation && <><span className="text-slate-500">Création</span><span className="font-mono">{r.historique.date_creation}</span></>}
                      {r.historique.date_integration && <><span className="text-slate-500">Intégration</span><span className="font-mono">{r.historique.date_integration}</span></>}
                      {r.historique.date_validation && <><span className="text-slate-500">Validation</span><span className="font-mono">{r.historique.date_validation}</span></>}
                      {r.historique.date_enlevement_transporteur && <><span className="text-slate-500">Enlèvement</span><span className="font-mono">{r.historique.date_enlevement_transporteur}</span></>}
                    </div>
                  </div>
                )}

                {r.rupture && !r.rupture.error && r.rupture.retour && (
                  <div className="bg-red-50 rounded-lg p-3">
                    <div className="text-xs text-red-600 font-medium">Rupture</div>
                    <div className="text-sm text-red-700">{r.rupture.retour}</div>
                    {r.rupture.cause && <div className="text-xs text-red-500 mt-1">Cause : {r.rupture.cause}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── VUE PARAMETRES ───────────────────────────────────────────────────────────
// ─── Composant Compte Email (SMTP, IMAP, Signature) ─────────────────────────
const VueCompteEmail = () => {
  const [brevoKey, setBrevoKey] = useState("");
  const [brevoConfigured, setBrevoConfigured] = useState(false);
  const [smtp, setSmtp] = useState({ host: 'smtp-relay.brevo.com', port: '587', user: '', password: '', secure: false });
  const [imap, setImap] = useState({ host: '', port: '993', user: '', password: '', secure: true });
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [imapConfigured, setImapConfigured] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [signatureMode, setSignatureMode] = useState('html');
  const [signatureDefault, setSignatureDefault] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/health').then(h => {
      if (h.brevo === 'configuré') setBrevoConfigured(true);
    }).catch(() => {});
    api.get('/config').then(cfg => {
      if (cfg.brevo_api_key_configured) setBrevoConfigured(true);
      if (cfg.smtp_host) setSmtp(s => ({ ...s, host: cfg.smtp_host }));
      if (cfg.smtp_port) setSmtp(s => ({ ...s, port: cfg.smtp_port }));
      if (cfg.smtp_user) setSmtp(s => ({ ...s, user: cfg.smtp_user }));
      if (cfg.smtp_secure) setSmtp(s => ({ ...s, secure: cfg.smtp_secure === 'true' }));
      if (cfg.smtp_password_configured) setSmtpConfigured(true);
      if (cfg.imap_host) setImap(s => ({ ...s, host: cfg.imap_host }));
      if (cfg.imap_port) setImap(s => ({ ...s, port: cfg.imap_port }));
      if (cfg.imap_user) setImap(s => ({ ...s, user: cfg.imap_user }));
      if (cfg.imap_secure) setImap(s => ({ ...s, secure: cfg.imap_secure === 'true' }));
      if (cfg.imap_password_configured) setImapConfigured(true);
    }).catch(() => {});
    api.get('/config/signature').then(data => {
      setSignatureHtml(data.signature || '');
      setSignatureDefault(data.signature || '');
      if (data.is_default) setSignatureDefault(data.signature);
    }).catch(() => {});
  }, []);

  const sauvegarder = async () => {
    setSaving(true); setMsg('');
    try {
      const payload = {};
      if (brevoKey) { payload.brevo_api_key = brevoKey; setBrevoConfigured(true); setBrevoKey(''); }
      if (smtp.host) payload.smtp_host = smtp.host;
      if (smtp.port) payload.smtp_port = smtp.port;
      if (smtp.user) payload.smtp_user = smtp.user;
      if (smtp.password) { payload.smtp_password = smtp.password; setSmtpConfigured(true); setSmtp(s => ({ ...s, password: '' })); }
      payload.smtp_secure = String(smtp.secure);
      if (imap.host) payload.imap_host = imap.host;
      if (imap.port) payload.imap_port = imap.port;
      if (imap.user) payload.imap_user = imap.user;
      if (imap.password) { payload.imap_password = imap.password; setImapConfigured(true); setImap(s => ({ ...s, password: '' })); }
      payload.imap_secure = String(imap.secure);
      // En mode texte, convertir en HTML basique
      payload.email_signature_html = signatureMode === 'texte'
        ? signatureHtml.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
        : signatureHtml;
      await api.post('/config', payload);
      await reloadSignature();
      setMsg('Paramètres email sauvegardés');
    } catch (e) {
      setMsg('Erreur: ' + (e.message || 'Erreur inconnue'));
    }
    setSaving(false);
  };

  const resetSignature = async () => {
    try {
      await api.post('/config', { email_signature_html: '' });
      const sig = await reloadSignature();
      setSignatureHtml(sig);
      setMsg('Signature réinitialisée par défaut');
    } catch (e) { setMsg('Erreur: ' + e.message); }
  };

  const inputCls = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400";

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Clé API Brevo */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Clé API Brevo</h3>
        <div className={`flex items-center gap-2 text-xs mb-2 ${brevoConfigured ? "text-emerald-600" : "text-slate-400"}`}>
          <span className={`w-2 h-2 rounded-full ${brevoConfigured ? "bg-emerald-500" : "bg-slate-300"}`} />
          {brevoConfigured ? "Clé Brevo configurée et sauvegardée" : "Aucune clé configurée"}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">{brevoConfigured ? "Nouvelle clé API (laisser vide pour conserver l'actuelle)" : "Clé API Brevo"}</label>
          <input type="password" value={brevoKey} onChange={e => setBrevoKey(e.target.value)} placeholder="xkeysib-xxxxxxxx..." className={inputCls + " font-mono"} />
          <p className="text-xs text-slate-400 mt-1">Trouvez votre clé dans Brevo &rarr; Mon compte &rarr; SMTP & API &rarr; Clés API</p>
        </div>
      </div>

      {/* SMTP sortant */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">SMTP sortant</h3>
          <div className={`flex items-center gap-1.5 text-xs ${smtpConfigured ? "text-emerald-600" : "text-slate-400"}`}>
            <span className={`w-2 h-2 rounded-full ${smtpConfigured ? "bg-emerald-500" : "bg-slate-300"}`} />
            {smtpConfigured ? "Configuré" : "Non configuré"}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Hôte SMTP</label>
            <input value={smtp.host} onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))} placeholder="smtp-relay.brevo.com" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Port</label>
            <input value={smtp.port} onChange={e => setSmtp(s => ({ ...s, port: e.target.value }))} placeholder="587" className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Utilisateur</label>
            <input value={smtp.user} onChange={e => setSmtp(s => ({ ...s, user: e.target.value }))} placeholder="hugo@terredemars.com" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Mot de passe</label>
            <input type="password" value={smtp.password} onChange={e => setSmtp(s => ({ ...s, password: e.target.value }))} placeholder={smtpConfigured ? "Laisser vide pour conserver" : "Mot de passe SMTP"} className={inputCls} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={smtp.secure} onChange={e => setSmtp(s => ({ ...s, secure: e.target.checked }))} className="rounded border-slate-300" />
          Connexion SSL/TLS
        </label>
      </div>

      {/* IMAP lecture */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">IMAP (lecture des réponses)</h3>
          <div className={`flex items-center gap-1.5 text-xs ${imapConfigured ? "text-emerald-600" : "text-slate-400"}`}>
            <span className={`w-2 h-2 rounded-full ${imapConfigured ? "bg-emerald-500" : "bg-slate-300"}`} />
            {imapConfigured ? "Configuré" : "Non configuré"}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Hôte IMAP</label>
            <input value={imap.host} onChange={e => setImap(s => ({ ...s, host: e.target.value }))} placeholder="imap.gmail.com" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Port</label>
            <input value={imap.port} onChange={e => setImap(s => ({ ...s, port: e.target.value }))} placeholder="993" className={inputCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Utilisateur</label>
            <input value={imap.user} onChange={e => setImap(s => ({ ...s, user: e.target.value }))} placeholder="hugo@terredemars.com" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Mot de passe</label>
            <input type="password" value={imap.password} onChange={e => setImap(s => ({ ...s, password: e.target.value }))} placeholder={imapConfigured ? "Laisser vide pour conserver" : "Mot de passe IMAP"} className={inputCls} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={imap.secure} onChange={e => setImap(s => ({ ...s, secure: e.target.checked }))} className="rounded border-slate-300" />
          Connexion SSL/TLS
        </label>
      </div>

      {/* Signature email */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Signature email</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setSignatureMode('html')} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${signatureMode === 'html' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>HTML</button>
            <button onClick={() => setSignatureMode('texte')} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${signatureMode === 'texte' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>Texte</button>
          </div>
        </div>
        <textarea
          value={signatureHtml}
          onChange={e => setSignatureHtml(e.target.value)}
          rows={signatureMode === 'html' ? 12 : 6}
          placeholder={signatureMode === 'html' ? '<table cellpadding="0">...</table>' : 'Hugo Montiel\nSales Director\nTerre de Mars'}
          className={inputCls + " font-mono text-xs resize-y"}
        />
        <div className="flex items-center gap-2">
          <button onClick={resetSignature} className="px-3 py-1.5 text-xs border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-50 transition-colors">
            Réinitialiser par défaut
          </button>
        </div>
        {signatureHtml && (
          <div>
            <label className="text-xs font-medium text-slate-500 mb-2 block">Aperçu</label>
            <div className="border border-slate-200 rounded-lg p-4 bg-white" dangerouslySetInnerHTML={{
              __html: signatureMode === 'texte' ? signatureHtml.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') : signatureHtml
            }} />
          </div>
        )}
      </div>

      {msg && <p className={`text-sm font-medium ${msg.startsWith('Erreur') ? 'text-red-600' : 'text-emerald-600'}`}>{msg}</p>}
      <button onClick={sauvegarder} disabled={saving} className="px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">
        {saving ? "Sauvegarde..." : "Enregistrer les paramètres email"}
      </button>
    </div>
  );
};

const VueProduitsCatalog = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingRef, setEditingRef] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const charger = async () => {
    setLoading(true);
    try {
      const data = await api.get('/reference/catalog');
      if (Array.isArray(data)) setProducts(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(p => p.ref.toLowerCase().includes(q) || (p.nom || '').toLowerCase().includes(q) || (p.categorie || '').toLowerCase().includes(q) || (p.csv_ref || '').toLowerCase().includes(q));
  }, [products, search]);

  const startEdit = (p) => {
    setEditingRef(p.ref);
    setEditForm({ nom: p.nom || '', prix_ht: p.prix_ht ?? '', csv_ref: p.csv_ref || '', vf_ref: p.vf_ref || '', moq: p.moq ?? 1, categorie: p.categorie || '' });
  };

  const cancelEdit = () => { setEditingRef(null); setEditForm({}); };

  const saveEdit = async () => {
    if (!editingRef) return;
    setSaving(true);
    try {
      await api.patch(`/reference/catalog/${encodeURIComponent(editingRef)}`, {
        nom: editForm.nom,
        prix_ht: parseFloat(editForm.prix_ht) || 0,
        csv_ref: editForm.csv_ref || null,
        vf_ref: editForm.vf_ref || null,
        moq: parseInt(editForm.moq) || 1,
        categorie: editForm.categorie || null,
      });
      setEditingRef(null);
      charger();
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher par ref, nom, catégorie..."
          className="flex-1 max-w-md border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
        />
        <span className="text-xs text-slate-400">{filtered.length} produit{filtered.length > 1 ? 's' : ''}</span>
      </div>
      {loading ? (
        <div className="text-xs text-slate-400 py-4">Chargement...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs text-slate-400 font-medium px-4 py-3">Ref</th>
                  <th className="text-left text-xs text-slate-400 font-medium px-4 py-3">Nom</th>
                  <th className="text-right text-xs text-slate-400 font-medium px-4 py-3">Prix HT</th>
                  <th className="text-left text-xs text-slate-400 font-medium px-4 py-3">CSV Ref</th>
                  <th className="text-left text-xs text-slate-400 font-medium px-4 py-3">VF Ref</th>
                  <th className="text-right text-xs text-slate-400 font-medium px-4 py-3">MOQ</th>
                  <th className="text-left text-xs text-slate-400 font-medium px-4 py-3">Catégorie</th>
                  <th className="text-right text-xs text-slate-400 font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.ref} className="border-b border-slate-50 hover:bg-slate-50/50">
                    {editingRef === p.ref ? (
                      <>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{p.ref}</td>
                        <td className="px-4 py-2"><input type="text" value={editForm.nom} onChange={e => setEditForm(f => ({ ...f, nom: e.target.value }))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></td>
                        <td className="px-4 py-2"><input type="number" step="0.01" value={editForm.prix_ht} onChange={e => setEditForm(f => ({ ...f, prix_ht: e.target.value }))} className="w-20 border border-slate-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400" /></td>
                        <td className="px-4 py-2"><input type="text" value={editForm.csv_ref} onChange={e => setEditForm(f => ({ ...f, csv_ref: e.target.value }))} className="w-24 border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></td>
                        <td className="px-4 py-2"><input type="text" value={editForm.vf_ref} onChange={e => setEditForm(f => ({ ...f, vf_ref: e.target.value }))} className="w-24 border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></td>
                        <td className="px-4 py-2"><input type="number" value={editForm.moq} onChange={e => setEditForm(f => ({ ...f, moq: e.target.value }))} className="w-16 border border-slate-200 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-400" /></td>
                        <td className="px-4 py-2"><input type="text" value={editForm.categorie} onChange={e => setEditForm(f => ({ ...f, categorie: e.target.value }))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" /></td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex gap-1 justify-end">
                            <button onClick={saveEdit} disabled={saving} className="text-[11px] px-2 py-1 rounded bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50">{saving ? '...' : 'OK'}</button>
                            <button onClick={cancelEdit} className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">Annuler</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{p.ref}</td>
                        <td className="px-4 py-2 text-slate-800">{p.nom}</td>
                        <td className="px-4 py-2 text-right text-slate-700">{p.prix_ht != null ? Number(p.prix_ht).toFixed(2) + ' \u20AC' : '—'}</td>
                        <td className="px-4 py-2 text-slate-500 font-mono text-xs">{p.csv_ref || '—'}</td>
                        <td className="px-4 py-2 text-slate-500 font-mono text-xs">{p.vf_ref || '—'}</td>
                        <td className="px-4 py-2 text-right text-slate-700">{p.moq ?? 1}</td>
                        <td className="px-4 py-2 text-slate-500 text-xs">{p.categorie || '—'}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => startEdit(p)} className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">Modifier</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-400">Aucun produit{search ? ' trouvé' : ''}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const VueParametres = () => {
  const [sousOnglet, setSousOnglet] = useState('envoi');
  const [limites, setLimites] = useState({ maxParJour: 50, heureDebut: "08:00", heureFin: "18:00", joursActifs: ["lun", "mar", "mer", "jeu", "ven"], fuseau: "Europe/Paris", delaiEntreEmails: 2 });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const jours = [["lun","Lun"],["mar","Mar"],["mer","Mer"],["jeu","Jeu"],["ven","Ven"],["sam","Sam"],["dim","Dim"]];
  const toggleJour = j => setLimites(l => ({ ...l, joursActifs: l.joursActifs.includes(j) ? l.joursActifs.filter(x => x !== j) : [...l.joursActifs, j] }));

  const [hasProducts, setHasProducts] = useState(false);

  useEffect(() => {
    api.get('/reference/catalog').then(data => {
      if (Array.isArray(data) && data.length > 0) setHasProducts(true);
    }).catch(() => {});
  }, []);

  const onglets = [
    { id: 'envoi', label: 'Envoi' },
    { id: 'compte', label: 'Compte Email' },
    { id: 'integrations', label: 'Intégrations' },
    { id: 'segments', label: 'Segments' },
    ...(hasProducts ? [{ id: 'produits', label: 'Produits' }] : []),
  ];

  useEffect(() => {
    api.get('/config').then(cfg => {
      if (cfg.max_emails_par_jour) setLimites(l => ({ ...l, maxParJour: +cfg.max_emails_par_jour }));
      if (cfg.heure_debut) setLimites(l => ({ ...l, heureDebut: cfg.heure_debut }));
      if (cfg.heure_fin) setLimites(l => ({ ...l, heureFin: cfg.heure_fin }));
      if (cfg.jours_actifs) setLimites(l => ({ ...l, joursActifs: cfg.jours_actifs.split(',') }));
      if (cfg.fuseau) setLimites(l => ({ ...l, fuseau: cfg.fuseau }));
      if (cfg.delai_entre_emails) setLimites(l => ({ ...l, delaiEntreEmails: +cfg.delai_entre_emails }));
    }).catch(e => console.error(e));
  }, []);

  const sauvegarderEnvoi = async () => {
    setSaving(true); setMsg("");
    try {
      await api.post('/config', {
        max_emails_par_jour: String(limites.maxParJour),
        heure_debut: limites.heureDebut,
        heure_fin: limites.heureFin,
        jours_actifs: limites.joursActifs.join(','),
        fuseau: limites.fuseau,
        delai_entre_emails: String(limites.delaiEntreEmails),
      });
      setMsg("Paramètres d'envoi sauvegardés");
    } catch(e) { setMsg("Erreur lors de la sauvegarde"); }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      {/* Navigation sous-onglets */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 max-w-2xl">
        {onglets.map(o => (
          <button key={o.id} onClick={() => setSousOnglet(o.id)} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${sousOnglet === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {o.label}
          </button>
        ))}
      </div>

      {/* Sous-onglet Envoi */}
      {sousOnglet === 'envoi' && (
        <div className="space-y-4 max-w-2xl">
          <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-800">Limites d'envoi</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Maximum d'emails par jour</label>
                <input type="number" value={limites.maxParJour} onChange={e => setLimites(l => ({ ...l, maxParJour: +e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Délai entre chaque email (secondes)</label>
                <input type="number" min="1" max="300" value={limites.delaiEntreEmails} onChange={e => setLimites(l => ({ ...l, delaiEntreEmails: +e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                <p className="text-xs text-slate-400 mt-1">Temps d'attente entre chaque envoi (1-300s, défaut: 2s)</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[["heureDebut","Heure de début"],["heureFin","Heure de fin"]].map(([k,l]) => (
                <div key={k}>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">{l}</label>
                  <input type="time" value={limites[k]} onChange={e => setLimites(lim => ({ ...lim, [k]: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-2 block">Jours d'envoi actifs</label>
              <div className="flex gap-2">
                {jours.map(([k, l]) => (
                  <button key={k} onClick={() => toggleJour(k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${limites.joursActifs.includes(k) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Fuseau horaire</label>
              <select value={limites.fuseau} onChange={e => setLimites(l => ({ ...l, fuseau: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                {["Europe/Paris","Europe/London","Europe/Berlin","Europe/Madrid","Europe/Rome","Europe/Zurich","Europe/Brussels","America/New_York","America/Chicago","America/Los_Angeles","Asia/Dubai","Asia/Tokyo","Asia/Shanghai","Pacific/Auckland"].map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>
          {msg && <p className="text-sm text-emerald-600 font-medium">{msg}</p>}
          <button onClick={sauvegarderEnvoi} disabled={saving} className="px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">
            {saving ? "Sauvegarde..." : "Enregistrer les paramètres"}
          </button>
        </div>
      )}

      {/* Sous-onglet Compte Email */}
      {sousOnglet === 'compte' && <VueCompteEmail />}

      {/* Sous-onglet Intégrations */}
      {sousOnglet === 'integrations' && (
        <div className="space-y-4 max-w-2xl">
          <VueApiExterne />
          <VueBraveSearchConfig />
          <VueGooglePlacesConfig />
          <VueHubspot />
          <VueVosFacturesConfig />
        </div>
      )}

      {/* Sous-onglet Segments */}
      {sousOnglet === 'segments' && (
        <div className="max-w-2xl">
          <VueSegmentsConfig />
        </div>
      )}

      {/* Sous-onglet Produits */}
      {sousOnglet === 'produits' && <VueProduitsCatalog />}
    </div>
  );
};

// ─── Config Segments dynamiques ──────────────────────────────────────────────
const VueSegmentsConfig = () => {
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({ nom: '', couleur: '#64748b', ordre: 0 });
  const [newForm, setNewForm] = useState({ nom: '', couleur: '#64748b', ordre: 0 });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const charger = async () => {
    setLoading(true);
    try {
      const data = await api.get('/segments');
      setSegments(Array.isArray(data) ? data : []);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);

  const creer = async () => {
    if (!newForm.nom.trim()) return;
    setSaving(true); setMsg('');
    try {
      const res = await api.post('/segments', newForm);
      if (res?.erreur) { setMsg(res.erreur); } else {
        setNewForm({ nom: '', couleur: '#64748b', ordre: 0 });
        charger();
        _segmentsCache = [..._segmentsCache, newForm.nom.trim()];
        setMsg('Segment créé');
      }
    } catch (e) { setMsg('Erreur'); }
    setSaving(false);
  };

  const modifier = async (id) => {
    setSaving(true); setMsg('');
    try {
      const res = await api.put('/segments/' + id, editForm);
      if (res?.erreur) { setMsg(res.erreur); } else {
        setEditId(null);
        charger();
        api.get('/segments').then(data => { if (Array.isArray(data)) _segmentsCache = data.map(s => s.nom); });
        setMsg('Segment modifié');
      }
    } catch (e) { setMsg('Erreur'); }
    setSaving(false);
  };

  const supprimer = async (id) => {
    if (!window.confirm('Supprimer ce segment ?')) return;
    try {
      const res = await api.delete('/segments/' + id);
      if (res?.erreur) { setMsg(res.erreur); } else {
        charger();
        api.get('/segments').then(data => { if (Array.isArray(data)) _segmentsCache = data.map(s => s.nom); });
        setMsg('Segment supprimé');
      }
    } catch (e) { setMsg(e.message || 'Erreur'); }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-slate-800">Segments</h3>
      <p className="text-xs text-slate-400">Gérez les segments de leads (5*, Boutique, SPA, etc.)</p>

      {loading ? <div className="text-xs text-slate-400">Chargement...</div> : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left py-2 px-1 font-medium">Nom</th>
              <th className="text-left py-2 px-1 font-medium">Couleur</th>
              <th className="text-right py-2 px-1 font-medium">Ordre</th>
              <th className="text-right py-2 px-1 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {segments.map(s => (
              <tr key={s.id} className="border-b border-slate-50">
                {editId === s.id ? (
                  <>
                    <td className="py-1.5 px-1"><input value={editForm.nom} onChange={e => setEditForm(f => ({ ...f, nom: e.target.value }))} className="w-full border border-slate-200 rounded px-2 py-1 text-xs" /></td>
                    <td className="py-1.5 px-1"><input type="color" value={editForm.couleur} onChange={e => setEditForm(f => ({ ...f, couleur: e.target.value }))} className="w-8 h-6 border border-slate-200 rounded cursor-pointer" /></td>
                    <td className="py-1.5 px-1"><input type="number" value={editForm.ordre} onChange={e => setEditForm(f => ({ ...f, ordre: +e.target.value }))} className="w-16 border border-slate-200 rounded px-2 py-1 text-xs text-right" /></td>
                    <td className="py-1.5 px-1 text-right space-x-1">
                      <button onClick={() => modifier(s.id)} disabled={saving} className="px-2 py-1 bg-emerald-600 text-white rounded text-[10px]">OK</button>
                      <button onClick={() => setEditId(null)} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px]">Annuler</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-1.5 px-1 font-medium text-slate-800">{s.nom}</td>
                    <td className="py-1.5 px-1"><span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: s.couleur }} /></td>
                    <td className="py-1.5 px-1 text-right text-slate-500">{s.ordre}</td>
                    <td className="py-1.5 px-1 text-right space-x-1">
                      <button onClick={() => { setEditId(s.id); setEditForm({ nom: s.nom, couleur: s.couleur, ordre: s.ordre }); }} className="px-2 py-1 border border-slate-200 text-slate-500 rounded text-[10px] hover:bg-slate-50">Modifier</button>
                      <button onClick={() => supprimer(s.id)} className="px-2 py-1 border border-red-100 text-red-400 rounded text-[10px] hover:bg-red-50">Suppr</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {/* Nouvelle ligne */}
            <tr className="border-t border-slate-200">
              <td className="py-1.5 px-1"><input value={newForm.nom} onChange={e => setNewForm(f => ({ ...f, nom: e.target.value }))} placeholder="Nouveau segment..." className="w-full border border-slate-200 rounded px-2 py-1 text-xs" /></td>
              <td className="py-1.5 px-1"><input type="color" value={newForm.couleur} onChange={e => setNewForm(f => ({ ...f, couleur: e.target.value }))} className="w-8 h-6 border border-slate-200 rounded cursor-pointer" /></td>
              <td className="py-1.5 px-1"><input type="number" value={newForm.ordre} onChange={e => setNewForm(f => ({ ...f, ordre: +e.target.value }))} className="w-16 border border-slate-200 rounded px-2 py-1 text-xs text-right" /></td>
              <td className="py-1.5 px-1 text-right">
                <button onClick={creer} disabled={saving || !newForm.nom.trim()} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] disabled:opacity-50">Ajouter</button>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {msg && <p className="text-xs text-emerald-600">{msg}</p>}
    </div>
  );
};

// ─── Config API Externe ───────────────────────────────────────────────────────
const VueBraveSearchConfig = () => {
  const [braveKey, setBraveKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    api.get('/config').then(cfg => {
      if (cfg.brave_search_api_key_configured) setConfigured(true);
    }).catch(() => {});
  }, []);

  const sauvegarder = async () => {
    if (!braveKey) return;
    setSaving(true); setMsg(''); setTestResult(null);
    try {
      await api.post('/config', { brave_search_api_key: braveKey });
      setConfigured(true);
      setBraveKey('');
      setMsg('Clé API Brave Search sauvegardée');
    } catch(e) { setMsg('Erreur'); }
    setSaving(false);
  };

  const tester = async () => {
    setTesting(true); setTestResult(null); setMsg('');
    try {
      const res = await api.get('/veille/test-brave');
      setTestResult(res);
    } catch(e) { setTestResult({ ok: false, erreur: e.message }); }
    setTesting(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Brave Search API</h3>
          <p className="text-xs text-slate-400 mt-0.5">Pour la veille web hôtelière (scraping d'articles)</p>
        </div>
        <div className={`flex items-center gap-1.5 text-xs ${configured ? "text-emerald-600" : "text-slate-400"}`}>
          <span className={`w-2 h-2 rounded-full ${configured ? "bg-emerald-500" : "bg-slate-300"}`} />
          {configured ? "Configurée" : "Non configurée"}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500 mb-1 block">Clé API Brave Search</label>
        <div className="flex gap-2">
          <input type={showKey ? "text" : "password"} value={braveKey} onChange={e => setBraveKey(e.target.value)}
            placeholder={configured ? "Nouvelle clé (laisser vide pour conserver)" : "Coller votre clé API Brave"}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <button onClick={() => setShowKey(!showKey)} className="px-2 text-xs text-slate-400 hover:text-slate-600">{showKey ? '🙈' : '👁'}</button>
        </div>
        <p className="text-xs text-slate-400 mt-1">Obtenez une clé sur <a href="https://brave.com/search/api/" target="_blank" rel="noopener" className="text-blue-500 hover:underline">brave.com/search/api</a></p>
      </div>
      <div className="flex items-center gap-2">
        {braveKey && (
          <button onClick={sauvegarder} disabled={saving}
            className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50">
            {saving ? "Sauvegarde..." : "Enregistrer"}
          </button>
        )}
        {configured && (
          <button onClick={tester} disabled={testing}
            className="px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
            {testing ? (
              <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Test en cours...</>
            ) : 'Tester la connexion'}
          </button>
        )}
      </div>
      {msg && <p className="text-xs text-emerald-600 font-medium">{msg}</p>}
      {testResult && (
        <div className={`rounded-lg p-3 text-xs ${testResult.ok ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
          {testResult.ok ? (
            <div className="space-y-1">
              <p className="font-medium text-emerald-700">API Brave fonctionnelle — {testResult.resultats} résultat(s)</p>
              {testResult.exemples?.map((ex, i) => (
                <p key={i} className="text-emerald-600 truncate">• <a href={ex.url} target="_blank" rel="noopener" className="hover:underline">{ex.titre}</a></p>
              ))}
            </div>
          ) : (
            <p className="text-red-700 font-medium">{testResult.erreur || `Erreur HTTP ${testResult.status}`}</p>
          )}
        </div>
      )}
    </div>
  );
};

const VueGooglePlacesConfig = () => {
  const [gpKey, setGpKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    api.get('/config').then(cfg => {
      if (cfg.google_places_api_key_configured) setConfigured(true);
    }).catch(() => {});
  }, []);

  const sauvegarder = async () => {
    if (!gpKey) return;
    setSaving(true); setMsg(''); setTestResult(null);
    try {
      await api.post('/config', { google_places_api_key: gpKey });
      setConfigured(true);
      setGpKey('');
      setMsg('Cle API Google Places sauvegardee');
    } catch(e) { setMsg('Erreur'); }
    setSaving(false);
  };

  const tester = async () => {
    setTesting(true); setTestResult(null); setMsg('');
    try {
      const res = await api.get('/veille/test-google-places');
      setTestResult(res);
    } catch(e) { setTestResult({ ok: false, erreur: e.message }); }
    setTesting(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Google Places API</h3>
          <p className="text-xs text-slate-400 mt-0.5">Scanner les hotels temporairement fermes (signal renovation)</p>
        </div>
        <div className={`flex items-center gap-1.5 text-xs ${configured ? "text-emerald-600" : "text-slate-400"}`}>
          <span className={`w-2 h-2 rounded-full ${configured ? "bg-emerald-500" : "bg-slate-300"}`} />
          {configured ? "Configuree" : "Non configuree"}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500 mb-1 block">Cle API Google Places</label>
        <div className="flex gap-2">
          <input type={showKey ? "text" : "password"} value={gpKey} onChange={e => setGpKey(e.target.value)}
            placeholder={configured ? "Nouvelle cle (laisser vide pour conserver)" : "Coller votre cle API Google Places"}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <button onClick={() => setShowKey(!showKey)} className="px-2 text-xs text-slate-400 hover:text-slate-600">{showKey ? 'Masquer' : 'Afficher'}</button>
        </div>
        <p className="text-xs text-slate-400 mt-1">Activez l'API Places (New) dans la console Google Cloud</p>
      </div>
      <div className="flex items-center gap-2">
        {gpKey && (
          <button onClick={sauvegarder} disabled={saving}
            className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50">
            {saving ? "Sauvegarde..." : "Enregistrer"}
          </button>
        )}
        {configured && (
          <button onClick={tester} disabled={testing}
            className="px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
            {testing ? (
              <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Test en cours...</>
            ) : 'Tester la connexion'}
          </button>
        )}
      </div>
      {msg && <p className="text-xs text-emerald-600 font-medium">{msg}</p>}
      {testResult && (
        <div className={`rounded-lg p-3 text-xs ${testResult.ok ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
          {testResult.ok ? (
            <div className="space-y-1">
              <p className="font-medium text-emerald-700">API Google Places fonctionnelle — {testResult.resultats} resultat(s)</p>
              {testResult.exemples?.map((ex, i) => (
                <p key={i} className="text-emerald-600">- {ex.nom} ({ex.statut})</p>
              ))}
            </div>
          ) : (
            <p className="text-red-700 font-medium">{testResult.erreur || `Erreur HTTP ${testResult.status}`}</p>
          )}
        </div>
      )}
    </div>
  );
};

const VueApiExterne = () => {
  const [apiKey, setApiKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [currentKey, setCurrentKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/config').then(cfg => {
      if (cfg.external_api_key && cfg.external_api_key !== '') {
        setConfigured(true);
        setCurrentKey(cfg.external_api_key);
      }
    }).catch(e => console.error(e));
  }, []);

  const genererCle = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'tdm_';
    for (let i = 0; i < 32; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
    setApiKey(key);
  };

  const sauvegarderCle = async () => {
    if (!apiKey) return;
    setSaving(true); setMsg('');
    try {
      await api.post('/config', { external_api_key: apiKey });
      setConfigured(true);
      setCurrentKey(apiKey.substring(0, 8) + '••••••••');
      setApiKey('');
      setMsg('Clé API externe sauvegardée');
    } catch(e) { setMsg('Erreur'); }
    setSaving(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">API Externe</h3>
          <p className="text-xs text-slate-400 mt-0.5">Pour Make, Zapier, n8n ou tout outil externe</p>
        </div>
        <div className={`flex items-center gap-1.5 text-xs ${configured ? "text-emerald-600" : "text-slate-400"}`}>
          <span className={`w-2 h-2 rounded-full ${configured ? "bg-emerald-500" : "bg-slate-300"}`} />
          {configured ? "Configurée" : "Non configurée"}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-slate-500 mb-1 block">Clé API (X-API-Key)</label>
        <div className="flex gap-2">
          <input type={showKey ? "text" : "password"} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={configured ? "Nouvelle clé (laisser vide pour conserver)" : "Générer ou coller une clé"} className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
          <button onClick={() => setShowKey(!showKey)} className="px-2 text-xs text-slate-400 hover:text-slate-600">{showKey ? '🙈' : '👁'}</button>
          <button onClick={genererCle} className="px-3 py-2 text-xs bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">Générer</button>
        </div>
      </div>

      {apiKey && (
        <button onClick={sauvegarderCle} disabled={saving} className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-50">
          {saving ? "Sauvegarde..." : "Sauvegarder la clé"}
        </button>
      )}

      {msg && <p className="text-xs text-emerald-600">{msg}</p>}

      {configured && (
        <div className="bg-slate-50 rounded-xl p-4 text-xs text-slate-600 space-y-2">
          <div className="font-semibold text-slate-800">Endpoint</div>
          <code className="block bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-mono">POST /api/external/push-lead</code>
          <div className="font-semibold text-slate-800 mt-3">Exemple</div>
          <pre className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-mono overflow-x-auto whitespace-pre">{`curl -X POST https://votre-domaine/api/external/push-lead \\
  -H "X-API-Key: votre-cle" \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "sophie@hotel.com",
    "prenom": "Sophie",
    "hotel": "Le Bristol",
    "sequence_nom": "Luxe Welcome"
  }'`}</pre>
          <div className="font-semibold text-slate-800 mt-3">Champs acceptés</div>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            <span><strong>email</strong> (requis)</span>
            <span><strong>prenom</strong> (requis)</span>
            <span><strong>hotel</strong> (requis)</span>
            <span>nom, ville, segment</span>
            <span>poste, langue, campaign</span>
            <span>comment, tags[]</span>
            <span>sequence_id ou sequence_nom</span>
            <span>hubspot_sync (default: true)</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Config VosFactures & Google Sheets ───────────────────────────────────────
const VueVosFacturesConfig = () => {
  const [vfToken, setVfToken] = useState('');
  const [gsheetsJson, setGsheetsJson] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('Suivi');
  const [vfConfigured, setVfConfigured] = useState(false);
  const [gsConfigured, setGsConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/config').then(cfg => {
      if (cfg.vf_api_token_configured) setVfConfigured(true);
      if (cfg.gsheets_credentials_configured) setGsConfigured(true);
      if (cfg.gsheets_spreadsheet_id) setSpreadsheetId(cfg.gsheets_spreadsheet_id);
      if (cfg.gsheets_sheet_name) setSheetName(cfg.gsheets_sheet_name);
    }).catch(e => console.error(e));
  }, []);

  const sauvegarder = async () => {
    setSaving(true); setMsg('');
    try {
      const payload = {};
      if (vfToken) { payload.vf_api_token = vfToken; setVfConfigured(true); setVfToken(''); }
      if (gsheetsJson) { payload.gsheets_credentials = gsheetsJson; setGsConfigured(true); setGsheetsJson(''); }
      if (spreadsheetId) payload.gsheets_spreadsheet_id = spreadsheetId;
      if (sheetName) payload.gsheets_sheet_name = sheetName;
      if (Object.keys(payload).length > 0) {
        await api.post('/config', payload);
        setMsg('Paramètres VF/GSheets sauvegardés');
      }
    } catch (e) { setMsg('Erreur: ' + e.message); }
    setSaving(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4 mt-4">
      <h3 className="text-sm font-semibold text-slate-800">VosFactures & Google Sheets</h3>

      <div>
        <div className={`flex items-center gap-2 text-xs mb-2 ${vfConfigured ? 'text-emerald-600' : 'text-slate-400'}`}>
          <span className={`w-2 h-2 rounded-full ${vfConfigured ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          Token VosFactures {vfConfigured ? 'configuré' : 'non configuré'}
        </div>
        <input type="password" value={vfToken} onChange={e => setVfToken(e.target.value)}
          placeholder={vfConfigured ? "Nouveau token (laisser vide pour conserver)" : "Token API VosFactures"}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
      </div>

      <div>
        <div className={`flex items-center gap-2 text-xs mb-2 ${gsConfigured ? 'text-emerald-600' : 'text-slate-400'}`}>
          <span className={`w-2 h-2 rounded-full ${gsConfigured ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          Google Sheets {gsConfigured ? 'configuré' : 'non configuré'}
        </div>
        <textarea value={gsheetsJson} onChange={e => setGsheetsJson(e.target.value)}
          placeholder={gsConfigured ? "Nouveau JSON (laisser vide pour conserver)" : "Collez le JSON du service account Google..."}
          rows={3} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Spreadsheet ID</label>
          <input value={spreadsheetId} onChange={e => setSpreadsheetId(e.target.value)}
            placeholder="1ABC..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Nom de l'onglet</label>
          <input value={sheetName} onChange={e => setSheetName(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {msg && <p className={`text-sm font-medium ${msg.startsWith('Erreur') ? 'text-red-600' : 'text-emerald-600'}`}>{msg}</p>}
      <button onClick={sauvegarder} disabled={saving}
        className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50">
        {saving ? 'Sauvegarde...' : 'Enregistrer VF/GSheets'}
      </button>
    </div>
  );
};

// ─── Vue Blocklist ────────────────────────────────────────────────────────────
const VueBlocklist = ({ onRefresh, showToast }) => {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [blocklist, setBlocklist] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newEntry, setNewEntry] = useState({ type: 'email', value: '', raison: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkType, setBulkType] = useState("email");
  const [bulkRaison, setBulkRaison] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);

  useEffect(() => { chargerBlocklist(); }, []);

  const chargerBlocklist = async () => {
    setLoading(true);
    try {
      const data = await api.get('/blocklist');
      setBlocklist(data.blocklist || []);
    } catch (err) {
      console.error('Erreur chargement blocklist:', err);
    }
    setLoading(false);
  };

  const ajouterEntree = async () => {
    if (!newEntry.value.trim()) return;
    try {
      await api.post('/blocklist', newEntry);
      setNewEntry({ type: 'email', value: '', raison: '' });
      setShowAdd(false);
      chargerBlocklist();
    } catch (err) {
      showToast(err.message || 'Erreur lors de l\'ajout', 'error');
    }
  };

  const supprimerEntree = async (id) => {
    if (!await confirmDialog('Retirer cette entrée de la blocklist ?', { confirmLabel: 'Retirer' })) return;
    try {
      await api.delete(`/blocklist/${id}`);
      chargerBlocklist();
    } catch (err) {
      showToast(err.message || 'Erreur lors de la suppression', 'error');
    }
  };

  const toggleOverride = async (id, allowed) => {
    try {
      await api.patch(`/blocklist/${id}/override`, { allowed });
      chargerBlocklist();
    } catch (err) {
      showToast(err.message || 'Erreur lors de la modification', 'error');
    }
  };

  const importerEnMasse = async () => {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setBulkImporting(true);
    let ok = 0, erreurs = 0;
    for (const val of lines) {
      try {
        await api.post('/blocklist', { type: bulkType, value: val, raison: bulkRaison });
        ok++;
      } catch { erreurs++; }
    }
    showToast(`${ok} ajouté${ok > 1 ? 's' : ''}${erreurs ? `, ${erreurs} erreur${erreurs > 1 ? 's' : ''}` : ''}`, ok > 0 ? 'success' : 'error');
    setBulkImporting(false);
    setBulkText("");
    setBulkRaison("");
    setShowBulk(false);
    chargerBlocklist();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Liste d'exclusion d'emails</h2>
          <p className="text-sm text-slate-500 mt-1">Emails et domaines bloqués pour l'envoi automatique</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowBulk(!showBulk); setShowAdd(false); }} className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50">
            {showBulk ? 'Annuler' : 'Import en masse'}
          </button>
          <button onClick={() => { setShowAdd(!showAdd); setShowBulk(false); }} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700">
            {showAdd ? 'Annuler' : '+ Ajouter une entrée'}
          </button>
        </div>
      </div>

      {/* Formulaire d'ajout */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-2 block">Type</label>
              <select value={newEntry.type} onChange={e => setNewEntry({...newEntry, type: e.target.value})} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <option value="email">Email</option>
                <option value="domain">Domaine</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-2 block">
                {newEntry.type === 'email' ? 'Adresse email' : 'Domaine (ex: example.com)'}
              </label>
              <input value={newEntry.value} onChange={e => setNewEntry({...newEntry, value: e.target.value})} placeholder={newEntry.type === 'email' ? 'contact@example.com' : 'example.com'} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-2 block">Raison (optionnel)</label>
              <input value={newEntry.raison} onChange={e => setNewEntry({...newEntry, raison: e.target.value})} placeholder="Concurrent, spam, etc." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
            <button onClick={ajouterEntree} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700">Ajouter</button>
          </div>
        </div>
      )}

      {/* Import en masse */}
      {showBulk && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-600 mb-2 block">Type</label>
              <select value={bulkType} onChange={e => setBulkType(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <option value="email">Emails</option>
                <option value="domain">Domaines</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 mb-2 block">Raison (optionnel)</label>
              <input value={bulkRaison} onChange={e => setBulkRaison(e.target.value)} placeholder="Concurrent, spam, etc." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-2 block">Liste ({bulkText.split('\n').filter(l => l.trim()).length} entrées)</label>
            <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={6} placeholder="Collez une liste d'emails ou domaines (un par ligne)" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowBulk(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
            <button onClick={importerEnMasse} disabled={bulkImporting || !bulkText.trim()} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50">
              {bulkImporting ? "Import..." : "Importer"}
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Type</th>
              <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Valeur</th>
              <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Raison</th>
              <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Permission expresse</th>
              <th className="px-4 md:px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase">Ajouté le</th>
              <th className="px-4 md:px-6 py-3 text-right text-xs font-medium text-slate-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="px-6 py-8 text-center text-sm text-slate-400">Chargement...</td></tr>
            ) : blocklist.length === 0 ? (
              <tr><td colSpan="6" className="px-6 py-8 text-center text-sm text-slate-400">Aucune entrée dans la blocklist</td></tr>
            ) : (
              blocklist.map(entry => (
                <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${entry.type === 'email' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                      {entry.type === 'email' ? '📧 Email' : '🌐 Domaine'}
                    </span>
                  </td>
                  <td className="px-4 md:px-6 py-4 text-sm font-mono text-slate-900">{entry.value}</td>
                  <td className="px-6 py-4 text-sm text-slate-600">{entry.raison || '—'}</td>
                  <td className="px-6 py-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={entry.override_allowed === 1} onChange={e => toggleOverride(entry.id, e.target.checked)} className="rounded accent-emerald-600" />
                      <span className="text-xs text-slate-600">Autoriser malgré blocage</span>
                    </label>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{parseUTC(entry.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => supprimerEntree(entry.id)} className="px-3 py-1 text-xs border border-red-100 text-red-500 rounded-md hover:bg-red-50">Retirer</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-500">
        <p><strong>📛 Email bloqué :</strong> L'adresse exacte est refusée pour tous les envois</p>
        <p className="mt-1"><strong>🌐 Domaine bloqué :</strong> Tous les emails du domaine (ex: @example.com) sont refusés</p>
        <p className="mt-1"><strong>✅ Permission expresse :</strong> Permet l'envoi malgré le blocage (à activer manuellement)</p>
      </div>
      {confirmDialogEl}
    </div>
  );
};

// ─── VUE TEMPLATES ────────────────────────────────────────────────────────────
const VueTemplates = ({ showToast }) => {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState(['Tous']);
  const [filterCategorie, setFilterCategorie] = useState('Tous');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const res = await api.get('/email-templates?categorie=' + filterCategorie);
      setTemplates(res.templates || []);

      const catRes = await api.get('/email-templates/categories');
      setCategories(catRes.categories || ['Tous']);
    } catch (err) {
      showToast('Erreur chargement templates: ' + err.message, 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTemplates();
  }, [filterCategorie]);

  const deleteTemplate = async (id) => {
    if (!await confirmDialog('Supprimer ce template ?', { danger: true, confirmLabel: 'Supprimer' })) return;
    try {
      await api.delete('/email-templates/' + id);
      showToast('Template supprimé', 'success');
      loadTemplates();
    } catch (err) {
      showToast('Erreur: ' + err.message, 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={filterCategorie}
            onChange={e => setFilterCategorie(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none bg-white"
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="text-xs text-slate-400">{templates.length} template{templates.length > 1 ? 's' : ''}</span>
        </div>
        <button
          onClick={() => { setEditingTemplate(null); setShowModal(true); }}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
        >
          ➕ Nouveau template
        </button>
      </div>

      {/* Liste des templates */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500">Chargement...</p>
          </div>
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center">
          <div className="text-4xl mb-3">📝</div>
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Aucun template</h3>
          <p className="text-xs text-slate-500 mb-4">Créez votre premier template pour gagner du temps</p>
          <button
            onClick={() => { setEditingTemplate(null); setShowModal(true); }}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800"
          >
            Créer un template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(template => (
            <div key={template.id} className="bg-white rounded-xl border border-slate-100 p-5 hover:border-slate-200 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 truncate">{template.nom}</h3>
                  <span className="inline-block mt-1 px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-md">
                    {template.categorie}
                  </span>
                </div>
              </div>

              <div className="mb-4">
                <div className="text-xs text-slate-500 mb-1">Sujet :</div>
                <div className="text-xs text-slate-700 font-medium truncate">{template.sujet}</div>
              </div>

              {template.tags && template.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-4">
                  {template.tags.slice(0, 3).map((tag, i) => (
                    <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => { setEditingTemplate(template); setShowModal(true); }}
                  className="flex-1 px-3 py-1.5 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
                >
                  ✏️ Modifier
                </button>
                <button
                  onClick={() => deleteTemplate(template.id)}
                  className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors"
                >
                  🗑
                </button>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400">
                Créé le {parseUTC(template.created_at).toLocaleDateString('fr-FR')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal création/édition */}
      {showModal && (
        <ModalTemplateEditor
          template={editingTemplate}
          onClose={() => { setShowModal(false); setEditingTemplate(null); }}
          onSave={() => {
            setShowModal(false);
            setEditingTemplate(null);
            loadTemplates();
            showToast(editingTemplate ? 'Template mis à jour' : 'Template créé', 'success');
          }}
          showToast={showToast}
        />
      )}
      {confirmDialogEl}
    </div>
  );
};

// ─── Modal Template Editor ───────────────────────────────────────────────────
const ModalTemplateEditor = ({ template, onClose, onSave, showToast }) => {
  useEscapeClose(onClose);
  const [form, setForm] = useState({
    nom: template?.nom || '',
    categorie: template?.categorie || 'General',
    sujet: template?.sujet || '',
    corps_html: template?.corps_html || '',
    content_json: template?.content_json || '',
    tags: template?.tags || []
  });
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  const tinymceRef = useRef(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Initialize TinyMCE
  useEffect(() => {
    if (!editorRef.current || tinymceRef.current) return;

    const containerId = 'tinymce-template-editor-' + Date.now();
    editorRef.current.id = containerId;

    tinymce.init({
      selector: '#' + containerId,
      plugins: 'lists link image table code fullscreen',
      toolbar: 'fontfamily fontsize | bold italic underline | blocks | bullist numlist | alignleft aligncenter alignright | link image table | forecolor | removeformat | fullscreen code',
      font_family_formats: 'Arial=Arial,Helvetica,sans-serif; Helvetica=Helvetica,Arial,sans-serif; Verdana=Verdana,Geneva,sans-serif; Georgia=Georgia,serif; Times New Roman=Times New Roman,Times,serif; Courier New=Courier New,monospace; Trebuchet MS=Trebuchet MS,sans-serif; Tahoma=Tahoma,Geneva,sans-serif',
      font_size_formats: '10px 12px 14px 16px 18px 20px 24px 28px 32px',
      menubar: false,
      height: 350,
      content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
      branding: false,
      promotion: false,
      placeholder: 'Contenu de l\'email...',
      license_key: 'gpl',
      setup: (editor) => {
        editor.on('init', () => {
          tinymceRef.current = editor;
          if (form.corps_html) {
            editor.setContent(form.corps_html);
          }
        });
        const syncContent = () => {
          const html = editor.getContent();
          set('corps_html', html);
        };
        editor.on('input change keyup', syncContent);
        editor.on('ExecCommand', syncContent);
        editor.on('NodeChange', syncContent);
      }
    });

    return () => {
      if (tinymceRef.current) {
        tinymceRef.current.remove();
        tinymceRef.current = null;
      }
    };
  }, []);

  const handleSave = async () => {
    if (!form.nom || !form.sujet) {
      showToast('Nom et sujet requis', 'error');
      return;
    }

    setSaving(true);
    try {
      if (template) {
        await api.patch('/email-templates/' + template.id, form);
      } else {
        await api.post('/email-templates', form);
      }
      onSave();
    } catch (err) {
      showToast('Erreur: ' + err.message, 'error');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-900">
            {template ? 'Modifier le template' : 'Nouveau template'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Nom du template</label>
              <input
                value={form.nom}
                onChange={e => set('nom', e.target.value)}
                placeholder="Ex: Email de bienvenue"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Catégorie</label>
              <select
                value={form.categorie}
                onChange={e => set('categorie', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                <option value="General">General</option>
                <option value="Luxe">Luxe</option>
                <option value="Boutique">Boutique</option>
                <option value="Resort">Resort</option>
                <option value="SPA">SPA</option>
                <option value="Relance">Relance</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Sujet</label>
            <input
              value={form.sujet}
              onChange={e => set('sujet', e.target.value)}
              placeholder="Ex: Découvrez notre nouvelle collection"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Contenu</label>
            <div className="border border-slate-200 rounded-lg bg-white">
              <div ref={editorRef} />
              <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50/30 flex items-center gap-1">
                <span className="text-xs text-slate-400 mr-1">Variables :</span>
                {["{{civilite}}", "{{prenom}}", "{{nom}}", "{{etablissement}}", "{{ville}}", "{{segment}}"].map(v => (
                  <button key={v} type="button" onClick={() => {
                    if (tinymceRef.current) {
                      tinymceRef.current.insertContent(v);
                    }
                  }} className="px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs rounded font-mono transition-colors border border-amber-200">{v}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Enregistrement...' : template ? 'Mettre à jour' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── VUE CAMPAGNES EMAIL MARKETING ──────────────────────────────────────────
const VueCampagnes = ({ showToast, readOnly }) => {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtreStatut, setFiltreStatut] = useState('tous');
  const [showEditor, setShowEditor] = useState(false);
  const [editCampaign, setEditCampaign] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedStats, setExpandedStats] = useState(null);
  const [expandedRecipients, setExpandedRecipients] = useState(null);
  const [recipientPage, setRecipientPage] = useState(1);
  const [recipientFilter, setRecipientFilter] = useState('tous');
  const [recipientSearch, setRecipientSearch] = useState('');

  const charger = async () => {
    setLoading(true);
    try {
      const data = await api.get('/campaigns' + (filtreStatut !== 'tous' ? `?statut=${filtreStatut}` : ''));
      setCampaigns(Array.isArray(data) ? data : []);
    } catch (e) { showToast('Erreur chargement campagnes', 'error'); }
    setLoading(false);
  };

  useEffect(() => { charger(); }, [filtreStatut]);

  // Auto-refresh si campagne en cours
  useEffect(() => {
    const hasEnCours = campaigns.some(c => c.statut === 'en_cours');
    if (!hasEnCours) return;
    const iv = setInterval(charger, 5000);
    return () => clearInterval(iv);
  }, [campaigns]);

  const supprimer = async (c) => {
    if (!await confirmDialog(`Supprimer la campagne "${c.nom}" ?`)) return;
    await api.delete(`/campaigns/${c.id}`);
    showToast('Campagne supprimée');
    charger();
  };

  const annuler = async (c) => {
    if (!await confirmDialog(`Annuler la campagne "${c.nom}" ?`)) return;
    await api.post(`/campaigns/${c.id}/cancel`);
    showToast('Campagne annulée');
    charger();
  };

  const dupliquer = async (c) => {
    await api.post(`/campaigns/${c.id}/duplicate`);
    showToast('Campagne dupliquée');
    charger();
  };

  const loadRecipients = async (campaignId, page = 1, filter = 'tous', search = '') => {
    try {
      let url = `/campaigns/${campaignId}/recipients?limit=50&page=${page}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (filter && filter !== 'tous') url += `&filter=${filter}`;
      const rData = await api.get(url);
      setExpandedRecipients(rData);
    } catch (e) { /* ignore */ }
  };

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setRecipientPage(1);
    setRecipientFilter('tous');
    setRecipientSearch('');
    try {
      const [stats, rData] = await Promise.all([
        api.get(`/campaigns/${id}/stats`),
        api.get(`/campaigns/${id}/recipients?limit=50`),
      ]);
      setExpandedStats(stats);
      setExpandedRecipients(rData);
    } catch (e) { /* ignore */ }
  };

  const BADGES = {
    brouillon: 'bg-slate-100 text-slate-600',
    'programmée': 'bg-blue-50 text-blue-700',
    en_cours: 'bg-amber-50 text-amber-700',
    'terminée': 'bg-emerald-50 text-emerald-700',
    'annulée': 'bg-red-50 text-red-600',
  };

  return (
    <div>
      {confirmDialogEl}

      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-2">
          {['tous', 'brouillon', 'en_cours', 'terminée'].map(s => (
            <button key={s} onClick={() => setFiltreStatut(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filtreStatut === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {s === 'tous' ? 'Toutes' : s === 'brouillon' ? 'Brouillons' : s === 'en_cours' ? 'En cours' : 'Terminées'}
            </button>
          ))}
        </div>
        {!readOnly && (
          <button onClick={() => { setEditCampaign(null); setShowEditor(true); }} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700">
            + Nouvelle campagne
          </button>
        )}
      </div>

      {loading && <div className="text-sm text-slate-400">Chargement...</div>}

      <div className="space-y-3">
        {campaigns.map(c => (
          <div key={c.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => toggleExpand(c.id)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-slate-900">{c.nom}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BADGES[c.statut] || 'bg-slate-100 text-slate-600'}`}>{c.statut}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  {c.statut === 'en_cours' && (
                    <div className="flex items-center gap-2">
                      <div className="w-32 bg-slate-100 rounded-full h-2">
                        <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${c.total_recipients > 0 ? Math.round(c.sent_count / c.total_recipients * 100) : 0}%` }} />
                      </div>
                      <span className="text-xs">{c.sent_count}/{c.total_recipients}</span>
                    </div>
                  )}
                  {c.statut === 'terminée' && (
                    <div className="flex items-center gap-3 text-xs">
                      <span>{c.sent_count} envoyés</span>
                      <span className="text-emerald-600">{c.stats?.open_rate || 0}% ouverts</span>
                      <span className="text-blue-600">{c.stats?.click_rate || 0}% cliqués</span>
                    </div>
                  )}
                  {c.statut === 'brouillon' && <span className="text-xs">{c.total_recipients} destinataires</span>}
                  <span className="text-xs text-slate-400">{(c.scheduled_at ? parseParis(c.scheduled_at) : parseUTC(c.started_at || c.created_at)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <svg className={`w-4 h-4 transition-transform ${expandedId === c.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1">Objet : {c.sujet}</p>
            </div>

            {expandedId === c.id && (
              <div className="border-t border-slate-100 p-4 bg-slate-50">
                {/* Stats KPIs */}
                {expandedStats && (
                  <div className="grid grid-cols-5 gap-3 mb-4">
                    <div className="bg-white rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-800">{expandedStats.sent || 0}</div>
                      <div className="text-xs text-slate-500">Envoyés</div>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center cursor-pointer hover:ring-2 hover:ring-emerald-200" onClick={() => { setRecipientFilter(recipientFilter === 'opened' ? 'tous' : 'opened'); setRecipientPage(1); loadRecipients(c.id, 1, recipientFilter === 'opened' ? 'tous' : 'opened', recipientSearch); }}>
                      <div className="text-2xl font-bold text-emerald-600">{expandedStats.open_rate || 0}%</div>
                      <div className="text-xs text-slate-500">Ouverts ({expandedStats.opened || 0})</div>
                      <div className="text-[10px] text-slate-400">{expandedStats.total_opens || 0} ouvertures</div>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center cursor-pointer hover:ring-2 hover:ring-blue-200" onClick={() => { setRecipientFilter(recipientFilter === 'clicked' ? 'tous' : 'clicked'); setRecipientPage(1); loadRecipients(c.id, 1, recipientFilter === 'clicked' ? 'tous' : 'clicked', recipientSearch); }}>
                      <div className="text-2xl font-bold text-blue-600">{expandedStats.click_rate || 0}%</div>
                      <div className="text-xs text-slate-500">Cliqués ({expandedStats.clicked || 0})</div>
                      <div className="text-[10px] text-slate-400">{expandedStats.total_clicks || 0} clics</div>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center cursor-pointer hover:ring-2 hover:ring-red-200" onClick={() => { setRecipientFilter(recipientFilter === 'erreur' ? 'tous' : 'erreur'); setRecipientPage(1); loadRecipients(c.id, 1, recipientFilter === 'erreur' ? 'tous' : 'erreur', recipientSearch); }}>
                      <div className="text-2xl font-bold text-red-500">{expandedStats.errors || 0}</div>
                      <div className="text-xs text-slate-500">Erreurs</div>
                    </div>
                    <div className="bg-white rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-slate-400">{(expandedStats.sent || 0) - (expandedStats.opened || 0)}</div>
                      <div className="text-xs text-slate-500">Pas ouverts</div>
                    </div>
                  </div>
                )}

                {/* Filtres recipients */}
                <div className="flex items-center gap-2 mb-3">
                  <input value={recipientSearch} onChange={e => setRecipientSearch(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { setRecipientPage(1); loadRecipients(c.id, 1, recipientFilter, recipientSearch); } }}
                    placeholder="Rechercher email, nom..." className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs flex-1 max-w-xs" />
                  <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                    {[['tous','Tous'], ['opened','Ouverts'], ['clicked','Cliqués'], ['erreur','Erreurs'], ['not_opened','Pas ouverts']].map(([k, l]) => (
                      <button key={k} onClick={() => { setRecipientFilter(k); setRecipientPage(1); loadRecipients(c.id, 1, k, recipientSearch); }}
                        className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${recipientFilter === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
                    ))}
                  </div>
                </div>

                {/* Table recipients */}
                {expandedRecipients?.recipients?.length > 0 && (
                  <div className="bg-white rounded-lg overflow-hidden mb-4">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-slate-50 text-slate-500">
                        <th className="text-left p-2">Contact</th><th className="text-left p-2">Hôtel</th><th className="text-left p-2">Statut</th><th className="text-left p-2">Envoyé</th><th className="text-right p-2">Ouvertures</th><th className="text-right p-2">Clics</th>
                      </tr></thead>
                      <tbody>{expandedRecipients.recipients.map(r => (
                        <tr key={r.id} className={`border-t border-slate-50 ${(r.ouvertures || 0) > 0 ? 'bg-emerald-50/30' : ''} ${(r.clics || 0) > 0 ? 'bg-blue-50/30' : ''} ${r.statut === 'erreur' ? 'bg-red-50/30' : ''}`}>
                          <td className="p-2">
                            <div className="font-medium text-slate-800">{r.prenom} {r.nom}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{r.email}</div>
                          </td>
                          <td className="p-2 text-slate-600 truncate max-w-[120px]">{r.hotel || '—'}</td>
                          <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.statut === 'envoyé' ? 'bg-emerald-50 text-emerald-700' : r.statut === 'erreur' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}`}>{r.statut}</span></td>
                          <td className="p-2 text-slate-400">{r.sent_at ? parseUTC(r.sent_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                          <td className="p-2 text-right">{(r.ouvertures || 0) > 0 ? <span className="text-emerald-600 font-semibold">{r.ouvertures}</span> : <span className="text-slate-300">0</span>}</td>
                          <td className="p-2 text-right">{(r.clics || 0) > 0 ? <span className="text-blue-600 font-semibold">{r.clics}</span> : <span className="text-slate-300">0</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                    {/* Pagination */}
                    {expandedRecipients.pages > 1 && (
                      <div className="flex items-center justify-between p-2 border-t border-slate-100">
                        <span className="text-[10px] text-slate-400">{expandedRecipients.total} destinataires — page {expandedRecipients.page}/{expandedRecipients.pages}</span>
                        <div className="flex gap-1">
                          <button disabled={recipientPage <= 1} onClick={() => { const p = recipientPage - 1; setRecipientPage(p); loadRecipients(c.id, p, recipientFilter, recipientSearch); }}
                            className="px-2 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-30">Préc.</button>
                          <button disabled={recipientPage >= expandedRecipients.pages} onClick={() => { const p = recipientPage + 1; setRecipientPage(p); loadRecipients(c.id, p, recipientFilter, recipientSearch); }}
                            className="px-2 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-30">Suiv.</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {expandedRecipients?.recipients?.length === 0 && (
                  <div className="text-xs text-slate-400 text-center py-3 mb-4">Aucun destinataire {recipientFilter !== 'tous' ? 'pour ce filtre' : ''}</div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  {c.statut === 'brouillon' && !readOnly && (
                    <button onClick={(e) => { e.stopPropagation(); setEditCampaign(c); setShowEditor(true); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-white hover:bg-slate-700">Modifier</button>
                  )}
                  {!readOnly && (
                    <button onClick={(e) => { e.stopPropagation(); dupliquer(c); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200">Dupliquer</button>
                  )}
                  {(c.statut === 'en_cours' || c.statut === 'programmée') && !readOnly && (
                    <button onClick={(e) => { e.stopPropagation(); annuler(c); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100">Annuler</button>
                  )}
                  {(c.statut === 'brouillon' || c.statut === 'terminée' || c.statut === 'annulée') && !readOnly && (
                    <button onClick={(e) => { e.stopPropagation(); supprimer(c); }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100">Supprimer</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {!loading && campaigns.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <div className="text-4xl mb-3">📬</div>
            <p>Aucune campagne{filtreStatut !== 'tous' ? ` avec le statut "${filtreStatut}"` : ''}</p>
          </div>
        )}
      </div>

      {showEditor && <ModalCampaignEditor campaign={editCampaign} onClose={() => { setShowEditor(false); charger(); }} showToast={showToast} />}
    </div>
  );
};

// ─── MODAL CAMPAIGN EDITOR (Wizard 3 étapes) ───────────────────────────────
const ModalCampaignEditor = ({ campaign, onClose, showToast }) => {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [campaignId, setCampaignId] = useState(campaign?.id || null);

  // Étape 1: Contenu
  const [nom, setNom] = useState(campaign?.nom || '');
  const [sujet, setSujet] = useState(campaign?.sujet || '');
  const [corpsHtml, setCorpsHtml] = useState(campaign?.corps_html || '');
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(campaign?.template_id || '');
  const editorRef = useRef(null);
  const tinymceRef = useRef(null);
  const pjCampagneRef = useRef(null);

  // Pièce jointe
  const initPj = campaign?.piece_jointe ? (typeof campaign.piece_jointe === 'string' ? JSON.parse(campaign.piece_jointe) : campaign.piece_jointe) : null;
  const [pieceJointeCampagne, setPieceJointeCampagne] = useState(initPj);

  const chargerPjCampagne = (file) => {
    if (!file) return;
    if (file.size > 5000000) { showToast("Fichier trop volumineux (max 5 MB)", "error"); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      setPieceJointeCampagne({ nom: file.name, taille: file.size, type: file.type, data: e.target.result.split(",")[1] });
    };
    reader.readAsDataURL(file);
  };

  // Options campagne
  const campaignOptions = campaign?.options ? (typeof campaign.options === 'string' ? JSON.parse(campaign.options) : campaign.options) : {};
  const [showUnsub, setShowUnsub] = useState(campaignOptions.desabonnement !== false);
  const [unsubText, setUnsubText] = useState(campaignOptions.unsub_text || 'Vous recevez cet email en tant que contact professionnel de Terre de Mars.');
  const [unsubLinkText, setUnsubLinkText] = useState(campaignOptions.unsub_link_text || 'Se désabonner');

  // Étape 2: Destinataires
  const [recipientMode, setRecipientMode] = useState('filter');
  const [filterSegment, setFilterSegment] = useState('');
  const [filterLangue, setFilterLangue] = useState('');
  const [filterStatut, setFilterStatut] = useState([]);
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [recipientCount, setRecipientCount] = useState(campaign?.total_recipients || 0);
  const [csvData, setCsvData] = useState([]);
  const [csvPreview, setCsvPreview] = useState([]);
  const [csvMapping, setCsvMapping] = useState({ email: '', prenom: '', nom: '', hotel: '', ville: '' });
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [addingRecipients, setAddingRecipients] = useState(false);
  const [recipientPreview, setRecipientPreview] = useState([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [showAllRecipients, setShowAllRecipients] = useState(false);
  const [allRecipients, setAllRecipients] = useState([]);
  const [recipientPage, setRecipientPage] = useState(1);
  const [recipientPages, setRecipientPages] = useState(1);
  const [recipientBreakdown, setRecipientBreakdown] = useState({ leads: 0, csv: 0 });
  const [selectedRecipientIds, setSelectedRecipientIds] = useState(new Set());
  const [deletingRecipients, setDeletingRecipients] = useState(false);
  const [filterSource, setFilterSource] = useState('');
  const [previewLeads, setPreviewLeads] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const [previewNewCount, setPreviewNewCount] = useState(0);
  const [availableSources, setAvailableSources] = useState([]);

  // Étape 3: Envoi
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');

  // Charger les templates
  useEffect(() => {
    api.get('/email-templates').then(data => {
      if (Array.isArray(data)) setTemplates(data);
    }).catch(() => {});
  }, []);

  // Initialiser TinyMCE (réinitialise quand on revient au step 1)
  const corpsHtmlRef = useRef(corpsHtml);
  corpsHtmlRef.current = corpsHtml;

  useEffect(() => {
    if (step !== 1) return;
    if (!editorRef.current) return;

    // Petit délai pour laisser le DOM se remonter
    const timer = setTimeout(() => {
      if (!editorRef.current) return;
      const containerId = 'tinymce-campaign-editor-' + Date.now();
      editorRef.current.id = containerId;

      tinymce.init({
        selector: '#' + containerId,
        plugins: 'lists link image table code fullscreen',
        toolbar: 'fontfamily fontsize | bold italic underline | blocks | bullist numlist | alignleft aligncenter alignright | link image table | forecolor | removeformat | fullscreen code',
        font_family_formats: 'Arial=Arial,Helvetica,sans-serif; Helvetica=Helvetica,Arial,sans-serif; Verdana=Verdana,Geneva,sans-serif; Georgia=Georgia,serif; Times New Roman=Times New Roman,Times,serif',
        font_size_formats: '10px 12px 14px 16px 18px 20px 24px 28px 32px',
        menubar: false,
        height: 350,
        content_style: 'body { font-family: Arial, sans-serif; font-size: 14px; }',
        branding: false,
        promotion: false,
        placeholder: 'Contenu de votre campagne...',
        license_key: 'gpl',
        setup: (editor) => {
          editor.on('init', () => {
            tinymceRef.current = editor;
            if (corpsHtmlRef.current) editor.setContent(corpsHtmlRef.current);
          });
          editor.on('input change keyup ExecCommand NodeChange', () => {
            setCorpsHtml(editor.getContent());
          });
        }
      });
    }, 50);

    return () => {
      clearTimeout(timer);
      if (tinymceRef.current) { tinymceRef.current.remove(); tinymceRef.current = null; }
    };
  }, [step]);

  const insertVariable = (v) => {
    if (tinymceRef.current) tinymceRef.current.insertContent(v);
  };

  const [templatePreview, setTemplatePreview] = useState(null);

  const applyTemplate = (tplId) => {
    setSelectedTemplate(tplId);
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return;

    // Si le sujet existe déjà, demander confirmation
    if (sujet && tpl.sujet && sujet !== tpl.sujet) {
      if (!window.confirm(`Remplacer l'objet actuel "${sujet}" par "${tpl.sujet}" ?`)) {
        // Appliquer seulement le corps
        if (tpl.corps_html && tinymceRef.current) {
          tinymceRef.current.setContent(tpl.corps_html);
          setCorpsHtml(tpl.corps_html);
        }
        return;
      }
    }
    if (tpl.sujet) setSujet(tpl.sujet);
    if (tpl.corps_html && tinymceRef.current) {
      tinymceRef.current.setContent(tpl.corps_html);
      setCorpsHtml(tpl.corps_html);
    }
  };

  // Sauvegarder/créer la campagne (brouillon)
  const saveDraft = async () => {
    if (!nom.trim() || !sujet.trim()) { showToast('Nom et objet requis', 'error'); return null; }
    setSaving(true);
    try {
      // Sync TinyMCE content
      const html = tinymceRef.current ? tinymceRef.current.getContent() : corpsHtml;
      const options = {
        desabonnement: showUnsub,
        unsub_text: unsubText,
        unsub_link_text: unsubLinkText,
      };
      const body = { nom, sujet, corps_html: html, template_id: selectedTemplate || null, options, piece_jointe: pieceJointeCampagne || null };
      let result;
      if (campaignId) {
        result = await api.put(`/campaigns/${campaignId}`, body);
      } else {
        result = await api.post('/campaigns', body);
      }
      if (result?.id) {
        setCampaignId(result.id);
        return result.id;
      }
      if (result?.erreur) { showToast(result.erreur, 'error'); return null; }
      return campaignId;
    } catch (e) {
      showToast('Erreur sauvegarde', 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleNextStep = async () => {
    if (step === 1) {
      const id = await saveDraft();
      if (id) setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  // CSV parsing
  const handleCsvFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (json.length < 2) { showToast('Fichier vide', 'error'); return; }
        const headers = json[0].map(h => String(h || '').trim());
        setCsvHeaders(headers);
        const rows = json.slice(1).filter(r => r.some(c => c));
        setCsvData(rows);
        setCsvPreview(rows.slice(0, 5));
        // Auto-map
        const mapping = { email: '', prenom: '', nom: '', hotel: '', ville: '' };
        headers.forEach((h, i) => {
          const hl = h.toLowerCase();
          if (hl.includes('email') || hl.includes('mail')) mapping.email = String(i);
          else if (hl.includes('prenom') || hl.includes('prénom') || hl.includes('first')) mapping.prenom = String(i);
          else if (hl.includes('nom') || hl.includes('last') || hl.includes('name')) mapping.nom = String(i);
          else if (hl.includes('hotel') || hl.includes('hôtel') || hl.includes('établissement')) mapping.hotel = String(i);
          else if (hl.includes('ville') || hl.includes('city')) mapping.ville = String(i);
        });
        setCsvMapping(mapping);
      } catch (err) {
        showToast('Erreur lecture fichier : ' + err.message, 'error');
      }
    };
    reader.readAsBinaryString(file);
  };

  // Construire les filtres courants
  const buildFilters = () => {
    const filters = {};
    if (filterSegment) filters.segment = filterSegment;
    if (filterLangue) filters.langue = filterLangue;
    if (filterStatut.length > 0) filters.statut = filterStatut;
    if (filterCampaign) filters.campaign = filterCampaign;
    if (filterSource) filters.source = filterSource;
    if (filterSearch) filters.search = filterSearch;
    return filters;
  };

  // Charger les sources disponibles
  useEffect(() => {
    api.get('/leads?limit=0').then(data => {
      const srcs = [...new Set((data.leads || []).map(l => l.source).filter(Boolean))].sort();
      setAvailableSources(srcs);
    }).catch(() => {});
  }, []);

  // Prévisualiser les leads correspondants
  const previewMatchingLeads = async () => {
    if (!campaignId) return;
    setPreviewLoading(true);
    setPreviewLeads([]);
    setSelectedLeadIds(new Set());
    try {
      const result = await api.post(`/campaigns/${campaignId}/recipients/preview`, { filters: buildFilters() });
      const leads = result.leads || [];
      setPreviewLeads(leads);
      setPreviewNewCount(result.new_count || 0);
      // Auto-sélectionner les nouveaux (pas déjà ajoutés)
      setSelectedLeadIds(new Set(leads.filter(l => !l.already_added).map(l => l.id)));
    } catch (e) { showToast('Erreur recherche', 'error'); }
    setPreviewLoading(false);
  };

  // Ajouter recipients (sélectionnés ou tous)
  const addRecipients = async () => {
    if (!campaignId) return;
    setAddingRecipients(true);
    try {
      let body;
      if (recipientMode === 'filter') {
        const filters = buildFilters();
        // Si des leads sont sélectionnés dans le preview, envoyer leurs IDs
        if (selectedLeadIds.size > 0) {
          filters.lead_ids = Array.from(selectedLeadIds);
        }
        body = { mode: 'filter', filters };
      } else {
        if (!csvMapping.email) { showToast('Mappez la colonne email', 'error'); setAddingRecipients(false); return; }
        const recipients = csvData.map(row => ({
          email: row[parseInt(csvMapping.email)] || '',
          prenom: csvMapping.prenom ? (row[parseInt(csvMapping.prenom)] || '') : '',
          nom: csvMapping.nom ? (row[parseInt(csvMapping.nom)] || '') : '',
          hotel: csvMapping.hotel ? (row[parseInt(csvMapping.hotel)] || '') : '',
          ville: csvMapping.ville ? (row[parseInt(csvMapping.ville)] || '') : '',
        })).filter(r => r.email);
        body = { mode: 'csv', recipients };
      }
      const result = await api.post(`/campaigns/${campaignId}/recipients`, body);
      if (result?.erreur) { showToast(result.erreur, 'error'); }
      else {
        showToast(`${result.added} destinataire(s) ajouté(s)${result.skipped ? `, ${result.skipped} doublon(s)` : ''}`);
        setRecipientCount(result.total);
        setPreviewLeads([]);
        setSelectedLeadIds(new Set());
        // Charger preview
        loadRecipientPreview();
      }
    } catch (e) {
      showToast('Erreur ajout destinataires', 'error');
    }
    setAddingRecipients(false);
  };

  const loadRecipientPreview = async (search = '') => {
    if (!campaignId) return;
    try {
      const params = search ? `?limit=10&search=${encodeURIComponent(search)}` : '?limit=10';
      const res = await api.get(`/campaigns/${campaignId}/recipients${params}`);
      setRecipientPreview(res.recipients || []);
      // Breakdown
      const allRes = await api.get(`/campaigns/${campaignId}/recipients?limit=1`);
      const total = allRes.total || 0;
      const leadsCount = (res.recipients || []).filter(r => r.lead_id).length;
      setRecipientBreakdown({ leads: leadsCount, csv: (res.recipients || []).length - leadsCount });
    } catch (_) {}
  };

  const loadAllRecipients = async (page = 1, search = '') => {
    if (!campaignId) return;
    try {
      const params = `?page=${page}&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`;
      const res = await api.get(`/campaigns/${campaignId}/recipients${params}`);
      setAllRecipients(res.recipients || []);
      setRecipientPage(res.page || 1);
      setRecipientPages(res.pages || 1);
    } catch (_) {}
  };

  // Charger preview quand on arrive à l'étape 2
  useEffect(() => {
    if (step === 2 && campaignId && recipientCount > 0) loadRecipientPreview();
  }, [step, campaignId]);

  const clearRecipients = async () => {
    if (!campaignId) return;
    await api.delete(`/campaigns/${campaignId}/recipients`);
    setRecipientCount(0);
    setRecipientPreview([]);
    setShowAllRecipients(false);
    setSelectedRecipientIds(new Set());
    showToast('Destinataires supprimés');
  };

  const deleteOneRecipient = async (recipientId) => {
    if (!campaignId) return;
    try {
      const result = await api.delete(`/campaigns/${campaignId}/recipients/${recipientId}`);
      if (result?.ok) {
        setRecipientCount(result.total);
        setSelectedRecipientIds(prev => { const s = new Set(prev); s.delete(recipientId); return s; });
        loadRecipientPreview(recipientSearch);
        if (showAllRecipients) loadAllRecipients(recipientPage, recipientSearch);
      }
    } catch (e) { showToast('Erreur suppression', 'error'); }
  };

  const deleteBatchRecipients = async () => {
    if (!campaignId || selectedRecipientIds.size === 0) return;
    setDeletingRecipients(true);
    try {
      const result = await api.post(`/campaigns/${campaignId}/recipients/delete-batch`, { ids: Array.from(selectedRecipientIds) });
      if (result?.ok) {
        setRecipientCount(result.total);
        setSelectedRecipientIds(new Set());
        showToast(`${result.deleted} destinataire(s) supprime(s)`);
        loadRecipientPreview(recipientSearch);
        if (showAllRecipients) loadAllRecipients(recipientPage, recipientSearch);
      }
    } catch (e) { showToast('Erreur suppression batch', 'error'); }
    setDeletingRecipients(false);
  };

  // Test email
  const sendTest = async () => {
    if (!testEmail || !campaignId) return;
    setSendingTest(true);
    try {
      const result = await api.post(`/campaigns/${campaignId}/test`, { email: testEmail });
      if (result?.ok) showToast('Email test envoyé');
      else showToast(result?.erreur || 'Erreur', 'error');
    } catch (e) { showToast('Erreur envoi test', 'error'); }
    setSendingTest(false);
  };

  // Lancer / programmer
  const sendNow = async () => {
    if (!campaignId || recipientCount === 0) { showToast('Ajoutez des destinataires', 'error'); return; }
    const result = await api.post(`/campaigns/${campaignId}/send-now`);
    if (result?.ok) { showToast('Campagne lancée !'); onClose(); }
    else showToast(result?.erreur || 'Erreur', 'error');
  };

  const schedule = async () => {
    if (!scheduleDate) { showToast('Choisissez une date', 'error'); return; }
    const scheduled_at = `${scheduleDate}T${scheduleTime || '09:00'}:00`;
    const result = await api.post(`/campaigns/${campaignId}/schedule`, { scheduled_at });
    if (result?.ok) { showToast('Campagne programmée'); onClose(); }
    else showToast(result?.erreur || 'Erreur', 'error');
  };

  const STATUTS_DISPONIBLES = ['Nouveau', 'En séquence', 'Répondu', 'Converti', 'Fin de séquence', 'Closed Lost', 'Email Marketing Sent'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 p-5 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">{campaign ? 'Modifier la campagne' : 'Nouvelle campagne'}</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
          </div>
          {/* Steps indicator */}
          <div className="flex gap-2 mt-3">
            {['Contenu', 'Destinataires', 'Envoi'].map((label, i) => (
              <div key={i} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${step === i + 1 ? 'bg-slate-800 text-white' : step > i + 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold border" style={{ borderColor: 'currentColor' }}>{step > i + 1 ? '✓' : i + 1}</span>
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-5">
          {/* ÉTAPE 1: Contenu */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nom de la campagne</label>
                <input value={nom} onChange={e => setNom(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Ex: Newsletter Avril 2026" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Objet de l'email</label>
                <div className="flex gap-2">
                  <input value={sujet} onChange={e => setSujet(e.target.value)} className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Ex: Découvrez nos nouvelles collections" />
                </div>
                <div className="flex gap-1 mt-1">
                  {['{{prenom}}', '{{hotel}}', '{{ville}}'].map(v => (
                    <button key={v} onClick={() => setSujet(s => s + ' ' + v)} className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200">{v}</button>
                  ))}
                </div>
              </div>
              {templates.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Template (optionnel)</label>
                  <div className="flex gap-2">
                    <select value={selectedTemplate} onChange={e => { setTemplatePreview(null); applyTemplate(e.target.value); }} className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                      <option value="">— Aucun template —</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.nom} ({t.categorie})</option>)}
                    </select>
                    {selectedTemplate && (
                      <button type="button" onClick={() => setTemplatePreview(templatePreview ? null : templates.find(t => t.id === selectedTemplate))} className="px-3 py-2 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">
                        {templatePreview ? 'Fermer' : 'Aperçu'}
                      </button>
                    )}
                  </div>
                  {templatePreview && (
                    <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                      <div className="bg-slate-50 px-3 py-1.5 text-xs text-slate-500 border-b border-slate-200">Objet : {templatePreview.sujet || '—'}</div>
                      <div className="p-3 text-sm" dangerouslySetInnerHTML={{ __html: templatePreview.corps_html || '<em>Pas de contenu</em>' }} />
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Contenu</label>
                <div className="flex gap-1 mb-2">
                  {['{{civilite}}', '{{prenom}}', '{{nom}}', '{{hotel}}', '{{ville}}', '{{segment}}'].map(v => (
                    <button key={v} onClick={() => insertVariable(v)} className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">{v}</button>
                  ))}
                </div>
                <div ref={editorRef} />
              </div>

              {/* Pièce jointe */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500 border-b border-slate-200">Pièce jointe</div>
                <div className="p-3">
                  {pieceJointeCampagne ? (
                    <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-lg px-3 py-2">
                      <span className="text-base">📎</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-700 truncate">{pieceJointeCampagne.nom || 'Fichier'}</div>
                        <div className="text-xs text-slate-400">
                          {pieceJointeCampagne.taille ? `${Math.round(pieceJointeCampagne.taille / 1024)} ko` : 'Taille inconnue'}
                        </div>
                      </div>
                      <button onClick={() => setPieceJointeCampagne(null)} className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 hover:bg-red-50 rounded transition-colors">
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => pjCampagneRef.current?.click()} className="w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors py-2 rounded-lg border border-dashed border-slate-200">
                      <span>📎</span> Ajouter une pièce jointe
                    </button>
                  )}
                  <input ref={pjCampagneRef} type="file" className="hidden" onChange={e => { chargerPjCampagne(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
              </div>

              {/* Aperçu signature */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500 border-b border-slate-200">Signature (ajoutée automatiquement)</div>
                <div className="p-4" dangerouslySetInnerHTML={{ __html: getSignatureHtml() }} />
              </div>

              {/* Lien de désabonnement */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700">Lien de désabonnement</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">Affiché en bas de l'email (recommandé pour la conformité RGPD)</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUnsub(!showUnsub)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${showUnsub ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${showUnsub ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
                {showUnsub && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Texte avant le lien</label>
                      <input
                        value={unsubText}
                        onChange={e => setUnsubText(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                        placeholder="Vous recevez cet email en tant que..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Texte du lien</label>
                      <input
                        value={unsubLinkText}
                        onChange={e => setUnsubLinkText(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                        placeholder="Se désabonner"
                      />
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="text-[11px] text-slate-400 mb-1">Aperçu :</p>
                      <p className="text-[11px] text-slate-500 border-t border-slate-200 pt-2">
                        {unsubText} <a className="text-slate-500 underline cursor-default">{unsubLinkText}</a>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ÉTAPE 2: Destinataires */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex bg-slate-100 rounded-lg p-0.5">
                  <button onClick={() => setRecipientMode('filter')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${recipientMode === 'filter' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Leads existants</button>
                  <button onClick={() => setRecipientMode('csv')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${recipientMode === 'csv' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Import CSV</button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700">{recipientCount} destinataire(s)</span>
                  {recipientCount > 0 && <button onClick={clearRecipients} className="text-xs text-red-500 hover:text-red-700">Vider</button>}
                </div>
              </div>

              {recipientMode === 'filter' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Segment</label>
                      <select value={filterSegment} onChange={e => setFilterSegment(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                        <option value="">Tous</option>
                        {getSegments().map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Langue</label>
                      <select value={filterLangue} onChange={e => setFilterLangue(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                        <option value="">Toutes</option>
                        <option value="fr">Français</option>
                        <option value="en">Anglais</option>
                        <option value="es">Espagnol</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Source</label>
                      <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                        <option value="">Toutes</option>
                        {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Statut</label>
                    <div className="flex flex-wrap gap-1.5">
                      {STATUTS_DISPONIBLES.map(s => (
                        <button key={s} onClick={() => setFilterStatut(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                          className={`px-2 py-1 rounded-md text-xs font-medium border transition-colors ${filterStatut.includes(s) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>{s}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Recherche</label>
                    <input value={filterSearch} onChange={e => setFilterSearch(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nom, hôtel, email..." />
                  </div>
                  <button onClick={previewMatchingLeads} disabled={previewLoading} className="bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-500 disabled:opacity-50">
                    {previewLoading ? 'Recherche...' : 'Rechercher les leads'}
                  </button>

                  {/* Preview des leads trouvés */}
                  {previewLeads.length > 0 && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="bg-slate-50 px-3 py-2 flex items-center justify-between border-b border-slate-200">
                        <div className="text-xs text-slate-600">
                          <span className="font-semibold">{previewLeads.length}</span> lead(s) trouvé(s)
                          {previewNewCount < previewLeads.length && <span className="text-slate-400 ml-1">({previewLeads.length - previewNewCount} déjà ajouté(s))</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => {
                            const newIds = previewLeads.filter(l => !l.already_added).map(l => l.id);
                            setSelectedLeadIds(new Set(newIds));
                          }} className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">Tout sélectionner ({previewNewCount})</button>
                          {selectedLeadIds.size > 0 && (
                            <button onClick={() => setSelectedLeadIds(new Set())} className="text-[11px] text-slate-400 hover:text-slate-600">Tout désélectionner</button>
                          )}
                        </div>
                      </div>
                      <div className="max-h-60 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-white"><tr className="text-slate-400 border-b border-slate-100">
                            <th className="p-2 w-8"></th>
                            <th className="text-left p-2">Contact</th>
                            <th className="text-left p-2">Hôtel</th>
                            <th className="text-left p-2">Source</th>
                            <th className="text-left p-2">Statut</th>
                          </tr></thead>
                          <tbody>
                            {previewLeads.map(l => (
                              <tr key={l.id} className={`border-t border-slate-50 ${l.already_added ? 'opacity-40' : 'hover:bg-slate-50'}`}>
                                <td className="p-2">
                                  {l.already_added
                                    ? <span className="text-[10px] text-slate-400" title="Déjà ajouté">✓</span>
                                    : <input type="checkbox" className="rounded accent-blue-600" checked={selectedLeadIds.has(l.id)} onChange={e => {
                                        const s = new Set(selectedLeadIds);
                                        e.target.checked ? s.add(l.id) : s.delete(l.id);
                                        setSelectedLeadIds(s);
                                      }} />
                                  }
                                </td>
                                <td className="p-2">
                                  <div className="font-medium text-slate-700">{l.prenom} {l.nom}</div>
                                  <div className="text-[10px] text-slate-400">{l.email}</div>
                                </td>
                                <td className="p-2 truncate max-w-[120px]">{l.hotel || '—'}</td>
                                <td className="p-2">{l.source ? <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px]">{l.source}</span> : <span className="text-slate-300">—</span>}</td>
                                <td className="p-2"><span className="text-[10px]">{l.statut}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="bg-slate-50 px-3 py-2 border-t border-slate-200 flex items-center justify-between">
                        <span className="text-xs text-slate-500">{selectedLeadIds.size} sélectionné(s)</span>
                        <button onClick={addRecipients} disabled={addingRecipients || selectedLeadIds.size === 0} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-slate-700 disabled:opacity-50">
                          {addingRecipients ? 'Ajout...' : `Ajouter ${selectedLeadIds.size} destinataire(s)`}
                        </button>
                      </div>
                    </div>
                  )}
                  {previewLeads.length === 0 && !previewLoading && filterSearch && (
                    <p className="text-xs text-slate-400 text-center py-2">Cliquez sur "Rechercher les leads" pour voir les résultats</p>
                  )}
                </div>
              )}

              {recipientMode === 'csv' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Fichier CSV ou Excel</label>
                    <input type="file" accept=".csv,.xlsx,.xls" onChange={handleCsvFile} className="w-full text-sm" />
                  </div>

                  {csvHeaders.length > 0 && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        {Object.entries({ email: 'Email *', prenom: 'Prénom', nom: 'Nom', hotel: 'Hôtel', ville: 'Ville' }).map(([key, label]) => (
                          <div key={key}>
                            <label className="block text-xs text-slate-500 mb-1">{label}</label>
                            <select value={csvMapping[key]} onChange={e => setCsvMapping(m => ({ ...m, [key]: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                              <option value="">— Non mappé —</option>
                              {csvHeaders.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>

                      {csvPreview.length > 0 && (
                        <div className="bg-slate-50 rounded-lg p-3">
                          <div className="text-xs font-medium text-slate-500 mb-2">Aperçu ({csvData.length} lignes)</div>
                          <table className="w-full text-xs">
                            <thead><tr className="text-slate-400">{csvHeaders.map((h, i) => <th key={i} className="text-left p-1">{h}</th>)}</tr></thead>
                            <tbody>{csvPreview.map((row, ri) => (
                              <tr key={ri} className="border-t border-slate-100">{csvHeaders.map((_, ci) => <td key={ci} className="p-1 truncate max-w-[120px]">{row[ci]}</td>)}</tr>
                            ))}</tbody>
                          </table>
                        </div>
                      )}

                      <button onClick={addRecipients} disabled={addingRecipients || !csvMapping.email} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                        {addingRecipients ? 'Import en cours...' : `Importer ${csvData.length} destinataires`}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Prévisualisation des destinataires ajoutés */}
              {recipientCount > 0 && (
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-700">Destinataires ajoutés</h4>
                    <div className="flex items-center gap-2">
                      {selectedRecipientIds.size > 0 && (
                        <button onClick={deleteBatchRecipients} disabled={deletingRecipients} className="px-2 py-1 text-xs font-medium bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50">
                          {deletingRecipients ? '...' : `Supprimer (${selectedRecipientIds.size})`}
                        </button>
                      )}
                      <input
                        value={recipientSearch}
                        onChange={e => { setRecipientSearch(e.target.value); loadRecipientPreview(e.target.value); }}
                        placeholder="Rechercher..."
                        className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-40"
                      />
                    </div>
                  </div>
                  {recipientPreview.length > 0 && (
                    <div className="bg-slate-50 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead><tr className="bg-slate-100 text-slate-500">
                          <th className="p-2 w-8"><input type="checkbox" className="rounded accent-blue-600" checked={recipientPreview.length > 0 && recipientPreview.every(r => selectedRecipientIds.has(r.id))} onChange={e => { const s = new Set(selectedRecipientIds); recipientPreview.forEach(r => e.target.checked ? s.add(r.id) : s.delete(r.id)); setSelectedRecipientIds(s); }} /></th>
                          <th className="text-left p-2">Email</th><th className="text-left p-2">Prénom</th><th className="text-left p-2">Hôtel</th><th className="text-left p-2">Source</th><th className="p-2 w-8"></th>
                        </tr></thead>
                        <tbody>
                          {recipientPreview.map(r => (
                            <tr key={r.id} className="border-t border-slate-100 group">
                              <td className="p-2"><input type="checkbox" className="rounded accent-blue-600" checked={selectedRecipientIds.has(r.id)} onChange={e => { const s = new Set(selectedRecipientIds); e.target.checked ? s.add(r.id) : s.delete(r.id); setSelectedRecipientIds(s); }} /></td>
                              <td className="p-2 truncate max-w-[150px]">{r.email}</td>
                              <td className="p-2">{r.prenom || '—'}</td>
                              <td className="p-2 truncate max-w-[120px]">{r.hotel || '—'}</td>
                              <td className="p-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.lead_id ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>{r.lead_id ? 'Lead' : 'CSV'}</span></td>
                              <td className="p-2 text-center"><button onClick={() => deleteOneRecipient(r.id)} className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" title="Supprimer">✕</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {recipientCount > 10 && !showAllRecipients && (
                    <button onClick={() => { setShowAllRecipients(true); loadAllRecipients(1, recipientSearch); }} className="text-xs text-blue-600 hover:text-blue-800">
                      Voir tous les {recipientCount} destinataires
                    </button>
                  )}
                  {showAllRecipients && (
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead><tr className="bg-slate-50 text-slate-500">
                          <th className="p-2 w-8"><input type="checkbox" className="rounded accent-blue-600" checked={allRecipients.length > 0 && allRecipients.every(r => selectedRecipientIds.has(r.id))} onChange={e => { const s = new Set(selectedRecipientIds); allRecipients.forEach(r => e.target.checked ? s.add(r.id) : s.delete(r.id)); setSelectedRecipientIds(s); }} /></th>
                          <th className="text-left p-2">Email</th><th className="text-left p-2">Prénom</th><th className="text-left p-2">Nom</th><th className="text-left p-2">Hôtel</th><th className="text-left p-2">Statut</th><th className="p-2 w-8"></th>
                        </tr></thead>
                        <tbody>
                          {allRecipients.map(r => (
                            <tr key={r.id} className="border-t border-slate-100 group">
                              <td className="p-2"><input type="checkbox" className="rounded accent-blue-600" checked={selectedRecipientIds.has(r.id)} onChange={e => { const s = new Set(selectedRecipientIds); e.target.checked ? s.add(r.id) : s.delete(r.id); setSelectedRecipientIds(s); }} /></td>
                              <td className="p-2 truncate max-w-[150px]">{r.email}</td>
                              <td className="p-2">{r.prenom || '—'}</td>
                              <td className="p-2">{r.nom || '—'}</td>
                              <td className="p-2 truncate max-w-[120px]">{r.hotel || '—'}</td>
                              <td className="p-2">{r.statut}</td>
                              <td className="p-2 text-center"><button onClick={() => deleteOneRecipient(r.id)} className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity" title="Supprimer">✕</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {recipientPages > 1 && (
                        <div className="flex items-center justify-center gap-2 p-2 border-t border-slate-100">
                          <button onClick={() => loadAllRecipients(recipientPage - 1, recipientSearch)} disabled={recipientPage <= 1} className="px-2 py-1 text-xs border border-slate-200 rounded disabled:opacity-30">&laquo;</button>
                          <span className="text-xs text-slate-500">{recipientPage} / {recipientPages}</span>
                          <button onClick={() => loadAllRecipients(recipientPage + 1, recipientSearch)} disabled={recipientPage >= recipientPages} className="px-2 py-1 text-xs border border-slate-200 rounded disabled:opacity-30">&raquo;</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ÉTAPE 3: Envoi */}
          {step === 3 && (
            <div className="space-y-6">
              {/* Résumé */}
              <div className="bg-slate-50 rounded-xl p-4">
                <h3 className="font-semibold text-slate-800 mb-2">Résumé</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-slate-500">Campagne :</span> <span className="font-medium">{nom}</span></div>
                  <div><span className="text-slate-500">Objet :</span> <span className="font-medium">{sujet}</span></div>
                  <div><span className="text-slate-500">Destinataires :</span> <span className="font-medium">{recipientCount}</span></div>
                  {recipientCount > 1000 && <div><span className="text-slate-500">Durée estimée :</span> <span className="font-medium">~{Math.ceil(recipientCount / 15 / 60)} min</span></div>}
                </div>
              </div>

              {/* Test */}
              <div>
                <h3 className="font-semibold text-slate-800 mb-2">Envoyer un email test</h3>
                <div className="flex gap-2">
                  <input value={testEmail} onChange={e => setTestEmail(e.target.value)} className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="votre@email.com" />
                  <button onClick={sendTest} disabled={sendingTest || !testEmail} className="bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-500 disabled:opacity-50">
                    {sendingTest ? '...' : 'Envoyer test'}
                  </button>
                </div>
              </div>

              {/* Programmer */}
              <div>
                <h3 className="font-semibold text-slate-800 mb-2">Programmer l'envoi</h3>
                <div className="flex gap-2 items-end">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Date</label>
                    <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Heure</label>
                    <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <button onClick={schedule} disabled={!scheduleDate || recipientCount === 0} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-500 disabled:opacity-50">
                    Programmer
                  </button>
                </div>
              </div>

              {/* Envoyer maintenant */}
              <div className="border-t border-slate-200 pt-4">
                <button onClick={sendNow} disabled={recipientCount === 0} className="w-full bg-emerald-600 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-emerald-500 disabled:opacity-50 transition-colors">
                  Envoyer maintenant ({recipientCount} destinataires)
                </button>
                {recipientCount === 0 && <p className="text-xs text-red-500 mt-1 text-center">Ajoutez des destinataires avant d'envoyer</p>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 p-4 border-t border-slate-200 flex items-center justify-between">
          <div>
            {step > 1 && (
              <button onClick={() => setStep(step - 1)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">
                Retour
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Fermer</button>
            {step < 3 && (
              <button onClick={handleNextStep} disabled={saving || (step === 1 && (!nom.trim() || !sujet.trim()))} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                {saving ? 'Sauvegarde...' : 'Suivant'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── VUE COMMANDES PARTENAIRES ────────────────────────────────────────────────
const VueCommandes = ({ showToast }) => {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [commandes, setCommandes] = useState([]);
  const [counts, setCounts] = useState({ en_attente: 0, validee: 0, annulee: 0, total: 0 });
  const [filtre, setFiltre] = useState("tous");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [validating, setValidating] = useState(null);
  const [validateModal, setValidateModal] = useState(null);
  const [validateOptions, setValidateOptions] = useState({ documentType: 'vat', shippingId: '1', sendEmailVF: true, sendEmailPartner: true, logGSheets: true, generateCsv: true });
  const [downloadingCsv, setDownloadingCsv] = useState(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
  const [batchCsvModal, setBatchCsvModal] = useState(false);
  const [batchCsvShippingId, setBatchCsvShippingId] = useState('1');
  const [downloadingBatchCsv, setDownloadingBatchCsv] = useState(false);

  useEscapeClose(() => { if (!validating) setValidateModal(null); });

  const charger = async () => {
    setLoading(true);
    try {
      const [orders, c] = await Promise.all([
        api.get('/partner-orders' + (filtre !== 'tous' ? `?statut=${filtre}` : '')),
        api.get('/partner-orders/counts'),
      ]);
      if (Array.isArray(orders)) setCommandes(orders);
      if (c && !c.erreur) setCounts(c);
    } catch (e) {
      showToast('Erreur chargement commandes', 'error');
    }
    setLoading(false);
  };

  useEffect(() => { charger(); }, [filtre]);

  const openValidateModal = (commande) => {
    setValidateOptions({ documentType: 'vat', shippingId: '1', sendEmailVF: true, sendEmailPartner: true, logGSheets: true, generateCsv: true });
    setValidateModal(commande);
  };

  const validerCommande = async () => {
    if (!validateModal) return;
    const id = validateModal.id;
    const partnerNom = validateModal.partner_nom || '';
    const partnerEmail = validateModal.partner_email || '';
    setValidating(id);
    try {
      const res = await api.post(`/partner-orders/${id}/validate`, {
        documentType: validateOptions.documentType,
        shippingId: validateOptions.shippingId,
        sendEmail: validateOptions.sendEmailVF,
        logGSheets: validateOptions.logGSheets,
        generateCsv: validateOptions.generateCsv,
      });
      if (res.ok) {
        const invoiceNumber = res.vf_invoice_number || '';

        // 1. Télécharger CSV + mailto logisticien
        if (res.csv_base64) {
          const blob = new Blob([Uint8Array.from(atob(res.csv_base64), c => c.charCodeAt(0))], { type: 'text/csv;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `logisticien-${invoiceNumber || id}.csv`;
          a.click();
          URL.revokeObjectURL(url);

          // Mailto logisticien (seulement si CSV généré)
          const logSubject = encodeURIComponent(`Commande : ${partnerNom} ${invoiceNumber}`);
          const logBody = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint le CSV pour la commande ${invoiceNumber} (${partnerNom}).\n\nCordialement`);
          const logCc = encodeURIComponent('poulad@terredemars.com,alexandre@terredemars.com');
          window.open(`mailto:service.client@endurancelogistique.fr?cc=${logCc}&subject=${logSubject}&body=${logBody}`, '_blank');
        }

        // 2. Télécharger le PDF facture/proforma (délai pour laisser VF générer le PDF)
        if (res.vf_invoice_id) {
          setTimeout(async () => {
            try {
              const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
              const pdfRes = await fetch(`/api/partner-orders/${id}/pdf`, { headers: { 'Authorization': `Bearer ${token}` } });
              if (pdfRes.ok) {
                const pdfBlob = await pdfRes.blob();
                const pdfUrl = URL.createObjectURL(pdfBlob);
                const a = document.createElement('a');
                a.href = pdfUrl;
                a.download = `facture-${invoiceNumber || id}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(pdfUrl), 1000);
              }
            } catch (e) {
              showToast('Erreur téléchargement PDF', 'error');
            }
          }, 2000);
        }

        // 3. Mailto partenaire (après délai pour ne pas interférer avec le PDF)
        if (validateOptions.sendEmailPartner && partnerEmail) {
          setTimeout(() => {
            const partSubject = encodeURIComponent('Confirmation commande — Terre de Mars');
            const partBody = encodeURIComponent(`Bonjour,\n\nNous vous confirmons la bonne réception de votre commande n°${invoiceNumber}.\n\nVotre commande a été mise en préparation et sera expédiée dans les meilleurs délais.\n\nCordialement,\nTerre de Mars`);
            window.open(`mailto:${partnerEmail}?subject=${partSubject}&body=${partBody}`, '_blank');
          }, 2500);
        }

        showToast(res.message || `Commande validée — ${invoiceNumber}`, "success");
        setValidateModal(null);
        charger();
      } else {
        showToast(res.erreur || 'Erreur validation', "error");
      }
    } catch (e) {
      showToast('Erreur réseau', "error");
    }
    setValidating(null);
  };

  const annulerCommande = async (id) => {
    if (!await confirmDialog('Annuler cette commande ?', { danger: true, confirmLabel: 'Annuler la commande' })) return;
    try {
      const res = await api.post(`/partner-orders/${id}/cancel`);
      if (res.ok) {
        showToast('Commande annulée', "success");
        charger();
      } else {
        showToast(res.erreur || 'Erreur', "error");
      }
    } catch (e) {
      showToast('Erreur réseau', 'error');
    }
  };

  const [csvModal, setCsvModal] = useState(null);
  const [csvShippingId, setCsvShippingId] = useState('1');

  const downloadCsv = async (commande, shippingId) => {
    setDownloadingCsv(commande.id);
    setCsvModal(null);
    try {
      const response = await fetch(`/api/partner-orders/${commande.id}/csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || ''}` },
        body: JSON.stringify({ shippingId }),
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logisticien-${commande.vf_invoice_number || commande.id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('CSV téléchargé', 'success');
      } else {
        const err = await response.json();
        showToast(err.erreur || 'Erreur CSV', 'error');
      }
    } catch (e) {
      showToast('Erreur réseau', 'error');
    }
    setDownloadingCsv(null);
  };

  const openPdf = async (commande) => {
    try {
      const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
      const res = await fetch(`/api/partner-orders/${commande.id}/pdf`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `facture-${commande.vf_invoice_number || commande.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.erreur || 'Erreur PDF', 'error');
      }
    } catch (e) {
      showToast('Erreur réseau', 'error');
    }
  };

  const toggleOrderSelection = (id, e) => {
    if (e) e.stopPropagation();
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const validees = commandes.filter(c => c.statut === 'validee' && c.vf_invoice_id);
    if (selectedOrderIds.size === validees.length && validees.length > 0) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(validees.map(c => c.id)));
    }
  };

  const downloadBatchCsv = async (shippingId) => {
    setDownloadingBatchCsv(true);
    setBatchCsvModal(false);
    try {
      const response = await fetch('/api/partner-orders/batch-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || ''}` },
        body: JSON.stringify({ orderIds: [...selectedOrderIds], shippingId }),
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logisticien-batch-${selectedOrderIds.size}-commandes.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(`CSV groupé téléchargé (${selectedOrderIds.size} commandes)`, 'success');
        setSelectedOrderIds(new Set());
      } else {
        const err = await response.json();
        showToast(err.erreur || 'Erreur CSV groupé', 'error');
      }
    } catch (e) {
      showToast('Erreur réseau', 'error');
    }
    setDownloadingBatchCsv(false);
  };

  const statutConfig = {
    en_attente: { label: "En attente", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
    validee: { label: "Validée", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
    annulee: { label: "Annulée", bg: "bg-red-50", text: "text-red-600", dot: "bg-red-400" },
  };

  const filtres = [
    { id: "tous", label: "Tous", count: counts.total },
    { id: "en_attente", label: "En attente", count: counts.en_attente },
    { id: "validee", label: "Validées", count: counts.validee },
    { id: "annulee", label: "Annulées", count: counts.annulee },
  ];

  return (
    <div className="space-y-4">
      {/* Modal CSV transporteur */}
      {csvModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setCsvModal(null)}>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Télécharger CSV logisticien</h3>
              <p className="text-xs text-slate-500">{csvModal.partner_nom}</p>
            </div>
            <div className="px-6 py-4">
              <label className="text-xs font-medium text-slate-500 mb-1 block">Transporteur</label>
              <select value={csvShippingId} onChange={e => setCsvShippingId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                {SHIPPING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setCsvModal(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
              <button onClick={() => downloadCsv(csvModal, csvShippingId)} className="px-4 py-2 text-sm bg-slate-900 text-white rounded-xl hover:bg-slate-700">Télécharger</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal CSV groupé */}
      {batchCsvModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setBatchCsvModal(false)}>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">CSV groupé — {selectedOrderIds.size} commande{selectedOrderIds.size > 1 ? 's' : ''}</h3>
              <p className="text-xs text-slate-500">Un seul fichier CSV pour toutes les commandes sélectionnées</p>
            </div>
            <div className="px-6 py-4">
              <label className="text-xs font-medium text-slate-500 mb-1 block">Transporteur</label>
              <select value={batchCsvShippingId} onChange={e => setBatchCsvShippingId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                {SHIPPING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setBatchCsvModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
              <button onClick={() => downloadBatchCsv(batchCsvShippingId)} disabled={downloadingBatchCsv}
                className="px-4 py-2 text-sm bg-slate-900 text-white rounded-xl hover:bg-slate-700 disabled:opacity-50">
                {downloadingBatchCsv ? 'Téléchargement...' : 'Télécharger'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de validation */}
      {validateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !validating && setValidateModal(null)}>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex-shrink-0">
              <h3 className="text-lg font-semibold text-slate-900">Valider la commande</h3>
              <p className="text-sm text-slate-500">{validateModal.partner_nom}</p>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
              {/* Récap produits */}
              <div className="bg-slate-50 rounded-xl p-3">
                <div className="text-xs text-slate-500 mb-1">{validateModal.products?.length || 0} produit{(validateModal.products?.length || 0) > 1 ? 's' : ''} — {validateModal.total_ht?.toFixed(2)} &euro; HT</div>
                <div className="flex flex-wrap gap-1.5">
                  {(validateModal.products || []).map((p, i) => (
                    <span key={i} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-600 font-mono">{p.ref} x{p.quantite}</span>
                  ))}
                </div>
              </div>

              {/* Type de document */}
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Type de document</label>
                <select value={validateOptions.documentType} onChange={e => setValidateOptions(o => ({ ...o, documentType: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  <option value="vat">Facture</option>
                  <option value="proforma">Proforma</option>
                </select>
              </div>

              {/* Transporteur */}
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Transporteur</label>
                <select value={validateOptions.shippingId} onChange={e => setValidateOptions(o => ({ ...o, shippingId: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  {SHIPPING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {/* Checkboxes */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" checked={validateOptions.sendEmailVF} onChange={e => setValidateOptions(o => ({ ...o, sendEmailVF: e.target.checked }))} className="rounded" />
                  Envoyer email VF (facture)
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" checked={validateOptions.sendEmailPartner} onChange={e => setValidateOptions(o => ({ ...o, sendEmailPartner: e.target.checked }))} className="rounded" />
                  Envoyer email de confirmation au partenaire
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" checked={validateOptions.logGSheets} onChange={e => setValidateOptions(o => ({ ...o, logGSheets: e.target.checked }))} className="rounded" />
                  Logger Google Sheets
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" checked={validateOptions.generateCsv} onChange={e => setValidateOptions(o => ({ ...o, generateCsv: e.target.checked }))} className="rounded" />
                  Générer CSV et email logisticien
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setValidateModal(null)} disabled={validating} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">Annuler</button>
              <button onClick={validerCommande} disabled={validating} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {validating ? 'Validation...' : `Créer ${validateOptions.documentType === 'proforma' ? 'proforma' : 'facture'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filtres */}
      <div className="flex items-center gap-2 flex-wrap">
        {filtres.map(f => (
          <button key={f.id} onClick={() => setFiltre(f.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${filtre === f.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"}`}>
            {f.label}
            {f.count > 0 && <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${filtre === f.id ? "bg-white/20" : "bg-slate-100"}`}>{f.count}</span>}
          </button>
        ))}
        {commandes.some(c => c.statut === 'validee' && c.vf_invoice_id) && (
          <div className="flex items-center gap-2 ml-auto">
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
              <input type="checkbox"
                checked={(() => { const v = commandes.filter(c => c.statut === 'validee' && c.vf_invoice_id); return v.length > 0 && selectedOrderIds.size === v.length; })()}
                onChange={toggleSelectAll}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-500 w-3.5 h-3.5" />
              Tout sélectionner
            </label>
            {selectedOrderIds.size > 0 && (
              <button onClick={() => { setBatchCsvShippingId('1'); setBatchCsvModal(true); }} disabled={downloadingBatchCsv}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                CSV groupé ({selectedOrderIds.size})
              </button>
            )}
          </div>
        )}
      </div>

      {loading && <div className="flex items-center gap-2 text-sm text-slate-400"><span className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin inline-block" /> Chargement...</div>}

      {/* Tableau */}
      {!loading && commandes.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-sm text-slate-400">
          {filtre === 'en_attente' ? 'Aucune commande en attente de validation' : filtre === 'validee' ? 'Aucune commande validée' : filtre === 'annulee' ? 'Aucune commande annulée' : 'Aucune commande'}
        </div>
      )}

      <div className="space-y-3">
        {commandes.map(c => {
          const cfg = statutConfig[c.statut] || statutConfig.en_attente;
          const expanded = expandedId === c.id;
          return (
            <div key={c.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              <div className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => setExpandedId(expanded ? null : c.id)}>
                {c.statut === 'validee' && c.vf_invoice_id && (
                  <input type="checkbox" checked={selectedOrderIds.has(c.id)} onChange={(e) => toggleOrderSelection(c.id, e)} onClick={e => e.stopPropagation()}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-500 w-4 h-4 flex-shrink-0 cursor-pointer" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-slate-900">{c.partner_nom}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.bg} ${cfg.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">{parseUTC(c.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-900">{c.total_ht?.toFixed(2)} &euro; HT</div>
                  <div className="text-xs text-slate-400">{c.products?.length || 0} produit{(c.products?.length || 0) > 1 ? 's' : ''}</div>
                </div>
                <span className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>&#9660;</span>
              </div>

              {expanded && (
                <div className="border-t border-slate-100 p-4 bg-slate-50/50 animate-fade-in">
                  {/* Infos partenaire */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {c.partner_contact && <div><span className="text-xs text-slate-400 block">Contact</span><span className="text-sm text-slate-700">{c.partner_contact}</span></div>}
                    {c.partner_email && <div><span className="text-xs text-slate-400 block">Email</span><span className="text-sm text-slate-700">{c.partner_email}</span></div>}
                  </div>

                  {/* Tableau produits */}
                  <table className="w-full text-sm mb-4">
                    <thead><tr className="text-xs text-slate-400 border-b border-slate-200">
                      <th className="text-left py-2 font-medium">Ref</th>
                      <th className="text-left py-2 font-medium">Produit</th>
                      <th className="text-center py-2 font-medium">Qté</th>
                      <th className="text-right py-2 font-medium">PU HT</th>
                      <th className="text-right py-2 font-medium">Total HT</th>
                    </tr></thead>
                    <tbody>
                      {(c.products || []).map((p, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-2 font-mono text-xs text-slate-500">{p.ref}</td>
                          <td className="py-2 text-slate-700">{p.nom}</td>
                          <td className="py-2 text-center">{p.quantite}</td>
                          <td className="py-2 text-right">{p.prix_remise?.toFixed(2)} &euro;</td>
                          <td className="py-2 text-right font-medium">{p.total_ht?.toFixed(2)} &euro;</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {c.notes && <div className="text-xs text-slate-500 italic mb-3">Notes : "{c.notes}"</div>}

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-slate-900">{c.total_ht?.toFixed(2)} &euro; HT</span>
                      <span className="text-xs text-slate-400 ml-2">({c.total_ttc?.toFixed(2)} &euro; TTC)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.vf_invoice_number && <span className="text-xs text-emerald-600 font-medium">Facture n&deg;{c.vf_invoice_number}</span>}
                      {c.statut === 'validee' && c.vf_invoice_id && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); window.open(`https://terredemars.vosfactures.fr/invoices/${c.vf_invoice_id}`, '_blank'); }}
                            className="px-3 py-1.5 text-xs border border-violet-200 text-violet-600 rounded-lg hover:bg-violet-50 transition-colors">
                            VF
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setCsvShippingId(c.shipping_id || '1'); setCsvModal(c); }} disabled={downloadingCsv === c.id}
                            className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            {downloadingCsv === c.id ? 'CSV...' : 'CSV'}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); openPdf(c); }}
                            className="px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                            PDF
                          </button>
                        </>
                      )}
                      {c.statut === 'en_attente' && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); annulerCommande(c.id); }} className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">Annuler</button>
                          <button onClick={(e) => { e.stopPropagation(); openValidateModal(c); }} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors">
                            Valider la commande
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {confirmDialogEl}
    </div>
  );
};

// ─── VUE PARTENAIRES (onglet dédié) ──────────────────────────────────────────
const VuePartenaires = ({ showToast }) => {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editing, setEditing] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState("tous"); // "tous" | "portail"
  const [catalog, setCatalog] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [newDiscount, setNewDiscount] = useState({ product_code: '', discount_pct: '' });
  const [amenities, setAmenities] = useState({});

  const charger = async () => {
    setLoading(true);
    try {
      const data = await api.get('/reference/partners');
      if (Array.isArray(data)) setPartners(data);
    } catch (e) {
      showToast('Erreur chargement partenaires', 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    charger();
    api.get('/reference/catalog').then(data => { if (Array.isArray(data)) setCatalog(data); }).catch(e => console.error(e));
  }, []);

  const syncVF = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/reference/partners/sync-vf');
      if (res.ok) {
        showToast(`Sync VF : ${res.updated} mis à jour, ${res.created} créés (${res.vf_clients} clients VF)`, "success");
        charger();
      } else {
        showToast(res.erreur || 'Erreur sync VF', "error");
      }
    } catch (e) {
      showToast('Erreur réseau', "error");
    }
    setSyncing(false);
  };

  const filtered = useMemo(() => {
    let list = partners.filter(p => p.vf_client_id);
    if (tab === "portail") list = list.filter(p => p.has_password);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.nom.toLowerCase().includes(q) || (p.contact_nom || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q));
    }
    return list;
  }, [partners, search, tab]);

  const portalCount = useMemo(() => partners.filter(p => p.vf_client_id && p.has_password).length, [partners]);

  const selected = partners.find(p => p.id === selectedId);

  const selectPartner = (p) => {
    setSelectedId(p.id);
    setEditing(false);
    setShowPwd(false);
    setEditForm({ email: p.email || '', contact_nom: p.contact_nom || '', telephone: p.telephone || '', adresse: p.adresse || '', shipping_id: p.shipping_id || '', franco_seuil: p.franco_seuil ?? DEFAULT_FRANCO_SEUIL, frais_exonere: p.frais_exonere ?? 0, vf_display_name: p.vf_display_name || '' });
    // Charger amenities depuis le partenaire
    try {
      const am = p.amenities ? JSON.parse(p.amenities) : {};
      setAmenities(am);
    } catch (e) { setAmenities({}); }
    // Charger les remises
    setNewDiscount({ product_code: '', discount_pct: '' });
    api.get(`/reference/partners/${p.id}/discounts`).then(data => {
      if (Array.isArray(data)) setDiscounts(data);
      else setDiscounts([]);
    }).catch(() => setDiscounts([]));
  };

  const genererMotDePasse = async () => {
    if (!selected) return;
    try {
      const res = await api.post(`/reference/partners/${selected.id}/generate-password`);
      if (res.ok) {
        showToast('Mot de passe généré', "success");
        setShowPwd(true);
        charger();
      } else {
        showToast(res.erreur || 'Erreur', "error");
      }
    } catch (e) {
      showToast('Erreur réseau', "error");
    }
  };

  const sauvegarderEdition = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.patch(`/reference/partners/${selected.id}`, editForm);
      showToast('Partenaire mis à jour', "success");
      setEditing(false);
      charger();
    } catch (e) {
      showToast('Erreur', "error");
    }
    setSaving(false);
  };

  const toggleActif = async () => {
    if (!selected) return;
    try {
      await api.patch(`/reference/partners/${selected.id}`, { actif: !selected.actif });
      showToast(selected.actif ? 'Partenaire désactivé' : 'Partenaire activé', "success");
      charger();
    } catch (e) {
      showToast('Erreur réseau', 'error');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToast('Copié', "success");
  };

  // Refresh selected after charger
  useEffect(() => {
    if (selectedId && partners.length) {
      const p = partners.find(x => x.id === selectedId);
      if (p) {
        setEditForm(f => editing ? f : { email: p.email || '', contact_nom: p.contact_nom || '', telephone: p.telephone || '', adresse: p.adresse || '', shipping_id: p.shipping_id || '', franco_seuil: p.franco_seuil ?? DEFAULT_FRANCO_SEUIL, frais_exonere: p.frais_exonere ?? 0, vf_display_name: p.vf_display_name || '' });
        try { setAmenities(p.amenities ? JSON.parse(p.amenities) : {}); } catch (e) { setAmenities({}); }
      }
    }
  }, [partners, selectedId]);

  return (
    <div className="flex gap-6 max-w-5xl">
      {/* Liste gauche */}
      <div className="w-72 flex-shrink-0 space-y-3">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-0.5">
          <button onClick={() => { setTab("tous"); setSelectedId(null); }} className={`flex-1 text-xs font-medium py-2 rounded-lg transition-colors ${tab === "tous" ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            Tous ({partners.length})
          </button>
          <button onClick={() => { setTab("portail"); setSelectedId(null); }} className={`flex-1 text-xs font-medium py-2 rounded-lg transition-colors ${tab === "portail" ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            Accès portail ({portalCount})
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher..."
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
          />
          <button onClick={syncVF} disabled={syncing} className="px-3 py-2.5 rounded-xl text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100 transition-colors disabled:opacity-50 flex-shrink-0" title="Synchroniser noms et données depuis VosFactures">
            {syncing ? <span className="inline-block w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" /> : 'Sync VF'}
          </button>
        </div>
        {loading && <div className="text-xs text-slate-400 py-2">Chargement...</div>}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden max-h-[calc(100vh-220px)] overflow-y-auto">
          {filtered.map(p => (
            <button
              key={p.id}
              onClick={() => selectPartner(p)}
              className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors ${selectedId === p.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium truncate ${selectedId === p.id ? 'text-white' : 'text-slate-900'}`}>{p.nom}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {p.vf_client_id && <span className={`text-[9px] ${selectedId === p.id ? 'text-white/40' : 'text-slate-300'}`}>VF</span>}
                  {p.has_password ? (
                    <span className={`w-2 h-2 rounded-full ${selectedId === p.id ? 'bg-emerald-400' : 'bg-emerald-500'}`} title="Accès portail actif" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-slate-300" title="Pas d'accès" />
                  )}
                </div>
              </div>
              {(p.email || p.contact_nom) && <div className={`text-xs truncate mt-0.5 ${selectedId === p.id ? 'text-white/60' : 'text-slate-400'}`}>{p.contact_nom || p.email}</div>}
            </button>
          ))}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-slate-400">Aucun partenaire{search ? ' trouvé' : ''}</div>
          )}
        </div>
        <div className="text-xs text-slate-400">{filtered.length} partenaire{filtered.length > 1 ? 's' : ''} actif{filtered.length > 1 ? 's' : ''}</div>
      </div>

      {/* Détail droite */}
      <div className="flex-1 min-w-0">
        {!selected ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
            <div className="text-slate-300 text-4xl mb-3">&#128101;</div>
            <div className="text-sm text-slate-400">Sélectionnez un partenaire dans la liste pour gérer son accès au portail.</div>
            <a href="/partenaire" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors">
              Ouvrir le portail partenaire &rarr;
            </a>
            <button onClick={syncVF} disabled={syncing} className="mt-4 px-4 py-2 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100 transition-colors disabled:opacity-50">
              {syncing ? 'Synchronisation...' : 'Synchroniser depuis VosFactures'}
            </button>
          </div>
        ) : (
          <div className="space-y-4 animate-fade-in" key={selected.id}>
            {/* Header partenaire */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{selected.nom}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    {selected.vf_client_id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-mono">VF #{selected.vf_client_id}</span>}
                    <span className="text-xs text-slate-400">{selected.nom_normalise}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selected.has_password ? (
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 font-medium">Accès portail actif</span>
                  ) : (
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-400 font-medium">Pas d'accès portail</span>
                  )}
                  <button onClick={() => window.open('/partenaire', '_blank')} className="text-[11px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 font-medium transition-colors">
                    Ouvrir le portail &rarr;
                  </button>
                </div>
              </div>

              {/* Mot de passe */}
              <div className="bg-slate-50 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-600">Mot de passe portail</span>
                  <div className="flex items-center gap-2">
                    {selected.password_plain && (
                      <button onClick={() => setShowPwd(!showPwd)} className="text-[11px] px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">
                        {showPwd ? 'Masquer' : 'Afficher'}
                      </button>
                    )}
                    <button onClick={genererMotDePasse} className="text-[11px] px-2 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium">
                      {selected.has_password ? 'Régénérer' : 'Générer un mot de passe'}
                    </button>
                  </div>
                </div>
                {selected.password_plain && showPwd ? (
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-white px-3 py-2 rounded-lg border border-slate-200 text-slate-900 select-all">{selected.password_plain}</code>
                    <button onClick={() => copyToClipboard(selected.password_plain)} className="text-xs px-2.5 py-1.5 bg-slate-900 text-white rounded-lg hover:bg-slate-700">Copier</button>
                  </div>
                ) : selected.has_password && !showPwd ? (
                  <div className="text-xs text-slate-400">&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022; — cliquez "Afficher" pour voir le mot de passe</div>
                ) : (
                  <div className="text-xs text-slate-400">Aucun mot de passe défini. Cliquez "Générer" pour créer un accès.</div>
                )}
              </div>

              {/* Infos partenaire */}
              {!editing ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-600">Informations {selected.vf_client_id ? '(depuis VosFactures)' : ''}</span>
                    <button onClick={() => setEditing(true)} className="text-[11px] px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">Modifier</button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <div><span className="text-[10px] text-slate-400 block">Email</span><span className="text-sm text-slate-700">{selected.email || '—'}</span></div>
                    <div><span className="text-[10px] text-slate-400 block">Contact</span><span className="text-sm text-slate-700">{selected.contact_nom || '—'}</span></div>
                    <div><span className="text-[10px] text-slate-400 block">Téléphone</span><span className="text-sm text-slate-700">{selected.telephone || '—'}</span></div>
                    <div><span className="text-[10px] text-slate-400 block">Adresse</span><span className="text-sm text-slate-700">{selected.adresse || '—'}</span></div>
                    <div><span className="text-[10px] text-slate-400 block">Nom VosFactures</span><span className="text-sm text-slate-700">{selected.vf_display_name || '—'}</span></div>
                    <div><span className="text-[10px] text-slate-400 block">Shipping ID</span><span className="text-sm text-slate-700 font-mono">{selected.shipping_id || '—'}</span></div>
                    <div><span className="text-[10px] text-slate-400 block">Franco (seuil HT)</span><span className="text-sm text-slate-700">{(selected.franco_seuil ?? DEFAULT_FRANCO_SEUIL).toFixed(0)} &euro;</span></div>
                    <div><span className="text-[10px] text-slate-400 block">Frais FP/FE</span><span className="text-sm text-slate-700">{selected.frais_exonere ? 'Exonéré' : 'Standard (FP/FE)'}</span></div>
                  </div>
                </div>
              ) : (
                <div className="animate-fade-in">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-600">Modifier les informations</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Email</label>
                      <input type="email" value={editForm.email || ''} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Contact</label>
                      <input type="text" value={editForm.contact_nom || ''} onChange={e => setEditForm(f => ({ ...f, contact_nom: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Téléphone</label>
                      <input type="text" value={editForm.telephone || ''} onChange={e => setEditForm(f => ({ ...f, telephone: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Adresse</label>
                      <input type="text" value={editForm.adresse || ''} onChange={e => setEditForm(f => ({ ...f, adresse: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Nom VosFactures</label>
                      <input type="text" value={editForm.vf_display_name || ''} onChange={e => setEditForm(f => ({ ...f, vf_display_name: e.target.value }))} placeholder="Nom tel qu'affiché dans VosFactures" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Shipping ID</label>
                      <input type="text" value={editForm.shipping_id || ''} onChange={e => setEditForm(f => ({ ...f, shipping_id: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Franco (seuil HT &euro;)</label>
                      <input type="number" step="1" value={editForm.franco_seuil ?? DEFAULT_FRANCO_SEUIL} onChange={e => setEditForm(f => ({ ...f, franco_seuil: parseFloat(e.target.value) || 0 }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    </div>
                    <div className="flex items-center gap-2 pt-4">
                      <input type="checkbox" id="frais_exonere" checked={!!editForm.frais_exonere} onChange={e => setEditForm(f => ({ ...f, frais_exonere: e.target.checked ? 1 : 0 }))} className="rounded border-slate-300" />
                      <label htmlFor="frais_exonere" className="text-[10px] text-slate-400">Exonéré de frais (pas de FP/FE)</label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={sauvegarderEdition} disabled={saving} className="text-xs px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50">{saving ? 'Sauvegarde...' : 'Sauvegarder'}</button>
                    <button onClick={() => setEditing(false)} className="text-xs px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50">Annuler</button>
                  </div>
                </div>
              )}
            </div>

            {/* Produits amenities */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-600">Produits amenities (par gamme)</span>
              </div>
              {(() => {
                const AMENITY_TYPES = [
                  { key: 'gel_douche', label: 'Gel douche', gammes: [
                    { ref: 'P008', gamme: 'Verveine / Reddition' },
                    { ref: 'P035', gamme: 'Thé Blanc / Élégance' },
                  ]},
                  { key: 'shampoing', label: 'Shampoing', gammes: [
                    { ref: 'P019', gamme: 'Verveine / Reddition' },
                    { ref: 'P010', gamme: 'Cédrat / Irrévérence' },
                    { ref: 'P034', gamme: 'Thé Blanc / Élégance' },
                  ]},
                  { key: 'gel_corps_cheveux', label: 'Gel Corps & Cheveux', gammes: [
                    { ref: 'P042', gamme: 'Verveine / Reddition' },
                    { ref: 'P014', gamme: 'Cédrat / Irrévérence' },
                    { ref: 'P040', gamme: 'Thé Blanc / Élégance' },
                  ]},
                  { key: 'apres_shampoing', label: 'Après-shampoing', gammes: [
                    { ref: 'P024', gamme: 'Cédrat / Irrévérence' },
                    { ref: 'P037', gamme: 'Thé Blanc / Élégance' },
                  ]},
                  { key: 'lotion', label: 'Lotion Corps & Main', gammes: [
                    { ref: 'P036', gamme: 'Thé Blanc / Élégance' },
                    { ref: 'P011', gamme: 'Vétiver / Imminence' },
                  ]},
                  { key: 'savon_main', label: 'Savon Liquide Main', gammes: [
                    { ref: 'P007', gamme: 'Vétiver / Insurrection' },
                  ]},
                ];
                const saveAmenities = async (newAm) => {
                  setAmenities(newAm);
                  try {
                    await api.patch(`/reference/partners/${selected.id}`, { amenities: JSON.stringify(newAm) });
                    showToast('Amenities mis à jour', 'success');
                  } catch (e) { showToast('Erreur sauvegarde amenities', 'error'); }
                };
                return (
                  <div className="grid grid-cols-1 gap-2">
                    {AMENITY_TYPES.map(type => (
                      <div key={type.key} className="flex items-center gap-3">
                        <label className="text-xs text-slate-500 w-40 flex-shrink-0">{type.label}</label>
                        <select
                          value={amenities[type.key] || ''}
                          onChange={e => saveAmenities({ ...amenities, [type.key]: e.target.value || undefined })}
                          className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          <option value="">— Non défini —</option>
                          {type.gammes.map(g => <option key={g.ref} value={g.ref}>{g.ref} — {g.gamme}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Réductions */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-600">Réductions ({discounts.length})</span>
              </div>
              {discounts.length > 0 && (
                <table className="w-full text-xs mb-3">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-1.5 text-slate-400 font-medium">Ref</th>
                      <th className="text-left py-1.5 text-slate-400 font-medium">Produit</th>
                      <th className="text-right py-1.5 text-slate-400 font-medium">Remise %</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {discounts.map(d => {
                      const prod = catalog.find(c => c.ref === d.product_code);
                      return (
                        <tr key={d.id} className="border-b border-slate-50">
                          <td className="py-1.5 font-mono text-slate-700">{d.product_code}</td>
                          <td className="py-1.5 text-slate-600">{prod ? prod.nom : '—'}</td>
                          <td className="py-1.5 text-right text-emerald-600 font-medium">{d.discount_pct}%</td>
                          <td className="py-1.5 text-right">
                            <button onClick={async () => {
                              if (!await confirmDialog(`Supprimer la réduction ${d.product_code} (${d.discount_pct}%) ?`, { danger: true, confirmLabel: 'Supprimer' })) return;
                              try {
                                await api.delete(`/reference/partners/${selected.id}/discounts/${d.id}`);
                                setDiscounts(ds => ds.filter(x => x.id !== d.id));
                                showToast('Réduction supprimée', 'success');
                              } catch (e) {
                                showToast('Erreur suppression', 'error');
                              }
                            }} className="text-red-400 hover:text-red-600 text-[10px]">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className="flex items-center gap-2">
                <select
                  value={newDiscount.product_code}
                  onChange={e => setNewDiscount(d => ({ ...d, product_code: e.target.value }))}
                  className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">Sélectionner un produit...</option>
                  {catalog.filter(c => c.ref !== 'FP' && c.ref !== 'FE').map(c => <option key={c.ref} value={c.ref}>{c.ref} — {c.nom}</option>)}
                </select>
                <input
                  type="number"
                  value={newDiscount.discount_pct}
                  onChange={e => setNewDiscount(d => ({ ...d, discount_pct: e.target.value }))}
                  placeholder="%"
                  className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                  min="0" max="100" step="0.5"
                />
                <button
                  onClick={async () => {
                    if (!newDiscount.product_code || !newDiscount.discount_pct) return;
                    try {
                      const res = await api.post(`/reference/partners/${selected.id}/discounts`, {
                        product_code: newDiscount.product_code,
                        discount_pct: parseFloat(newDiscount.discount_pct),
                      });
                      if (res.ok) {
                        showToast('Réduction ajoutée', 'success');
                        setNewDiscount({ product_code: '', discount_pct: '' });
                        const data = await api.get(`/reference/partners/${selected.id}/discounts`);
                        if (Array.isArray(data)) setDiscounts(data);
                      } else {
                        showToast(res.erreur || 'Erreur', 'error');
                      }
                    } catch (e) {
                      showToast('Erreur réseau', 'error');
                    }
                  }}
                  disabled={!newDiscount.product_code || !newDiscount.discount_pct}
                  className="text-xs px-3 py-1.5 bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                >+</button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button onClick={toggleActif} className={`text-xs px-3 py-2 rounded-lg font-medium ${selected.actif ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                {selected.actif ? 'Désactiver ce partenaire' : 'Réactiver ce partenaire'}
              </button>
            </div>
          </div>
        )}
      </div>
      {confirmDialogEl}
    </div>
  );
};

// ─── MODAL PROFIL UTILISATEUR ─────────────────────────────────────────────────

const ModalProfile = ({ onClose, showToast }) => {
  useEscapeClose(onClose);
  const [currentUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('tdm_user') || 'null'); } catch { return null; }
  });
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [vfToken, setVfToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingVf, setTestingVf] = useState(false);

  const handleChangePassword = async () => {
    if (!oldPwd || !newPwd) return;
    if (newPwd !== confirmPwd) { showToast('Les mots de passe ne correspondent pas', 'error'); return; }
    if (newPwd.length < 6) { showToast('Mot de passe trop court (min 6 caractères)', 'error'); return; }
    setSaving(true);
    try {
      const res = await api.patch('/auth/profile', { old_password: oldPwd, new_password: newPwd });
      if (res.erreur) throw new Error(res.erreur);
      showToast('Mot de passe modifié', 'success');
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (e) { showToast(e.message, 'error'); }
    setSaving(false);
  };

  const handleSaveVfToken = async () => {
    setSaving(true);
    try {
      const res = await api.patch('/auth/profile', { vf_api_token: vfToken || null });
      if (res.erreur) throw new Error(res.erreur);
      showToast(vfToken ? 'Clé VosFactures enregistrée' : 'Clé VosFactures supprimée', 'success');
    } catch (e) { showToast(e.message, 'error'); }
    setSaving(false);
  };

  const handleTestVf = async () => {
    setTestingVf(true);
    try {
      const res = await api.get('/factures/status');
      if (res.ok) showToast('Connexion VosFactures OK', 'success');
      else showToast('Échec connexion : ' + (res.erreur || 'erreur'), 'error');
    } catch (e) { showToast(e.message, 'error'); }
    setTestingVf(false);
  };

  // Permissions lisibles
  const PERM_LABELS = {
    dashboard: 'Dashboard', portail: 'Portail', leads: 'Leads',
    campagnes: 'Campagnes', factures: 'Factures', emails: 'Validation Email', config: 'Configuration'
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex-shrink-0 p-6 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Mon Profil</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
          </div>
          <p className="text-sm text-slate-500 mt-1">{currentUser?.email} ({currentUser?.role === 'admin' ? 'Administrateur' : 'Membre'})</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Changer mot de passe */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Changer le mot de passe</h3>
            <div className="space-y-2">
              <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="Ancien mot de passe" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Nouveau mot de passe" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} placeholder="Confirmer le mot de passe" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              <button onClick={handleChangePassword} disabled={saving || !oldPwd || !newPwd} className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50">
                {saving ? 'Enregistrement...' : 'Modifier'}
              </button>
            </div>
          </div>

          {/* Clé VosFactures */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Clé API VosFactures</h3>
            <p className="text-xs text-slate-400 mb-2">Votre clé personnelle pour accéder à vos propres clients/factures.</p>
            <div className="flex gap-2">
              <input type="text" value={vfToken} onChange={e => setVfToken(e.target.value)} placeholder="Clé API VosFactures..." className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono" />
              <button onClick={handleSaveVfToken} disabled={saving} className="px-3 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50">
                Sauver
              </button>
            </div>
            <button onClick={handleTestVf} disabled={testingVf} className="mt-2 text-xs text-indigo-600 hover:text-indigo-800">
              {testingVf ? 'Test en cours...' : 'Tester la connexion'}
            </button>
          </div>

          {/* Permissions (lecture seule pour les membres) */}
          {currentUser?.role !== 'admin' && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Vos permissions</h3>
              <div className="space-y-1">
                {Object.entries(PERM_LABELS).map(([key, label]) => {
                  const perm = currentUser?.permissions?.[key];
                  return (
                    <div key={key} className="flex justify-between text-xs py-1">
                      <span className="text-slate-600">{label}</span>
                      <span className={perm === 'rw' ? 'text-emerald-600 font-medium' : perm === 'r' ? 'text-blue-600 font-medium' : 'text-slate-300'}>
                        {perm === 'rw' ? 'Lecture + Écriture' : perm === 'r' ? 'Lecture seule' : 'Aucun'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── VUE EQUIPE (admin only) ──────────────────────────────────────────────────

const PERM_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'portail', label: 'Portail' },
  { id: 'leads', label: 'Leads' },
  { id: 'campagnes', label: 'Campagnes' },
  { id: 'factures', label: 'Factures' },
  { id: 'emails', label: 'Valid. Email' },
  { id: 'config', label: 'Configuration' },
];

const VueEquipe = ({ showToast }) => {
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const currentUserId = (() => { try { return JSON.parse(sessionStorage.getItem('tdm_user') || '{}').id; } catch { return null; } })();

  const chargerUsers = async () => {
    setLoading(true);
    try {
      const data = await api.get('/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) { showToast('Erreur chargement utilisateurs', 'error'); }
    setLoading(false);
  };

  useEffect(() => { chargerUsers(); }, []);

  const toggleActif = async (user) => {
    try {
      await api.patch(`/users/${user.id}`, { actif: !user.actif });
      showToast(user.actif ? 'Utilisateur désactivé' : 'Utilisateur réactivé', 'success');
      chargerUsers();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const supprimerUser = async (user) => {
    if (!await confirmDialog(`Supprimer définitivement ${user.nom} (${user.email}) ?`, { danger: true, confirmLabel: 'Supprimer' })) return;
    try {
      const res = await api.delete(`/users/${user.id}`);
      if (res.erreur) throw new Error(res.erreur);
      showToast('Utilisateur supprimé', 'success');
      chargerUsers();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Gestion de l'équipe</h2>
          <p className="text-sm text-slate-500">{users.length} membre(s)</p>
        </div>
        <button onClick={() => { setEditUser(null); setShowModal(true); }} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors">
          + Nouveau membre
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400"><span className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" /> Chargement...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase">
                <th className="px-4 py-3 text-left font-medium">Utilisateur</th>
                <th className="px-4 py-3 text-left font-medium">Rôle</th>
                <th className="px-4 py-3 text-left font-medium">VF</th>
                <th className="px-4 py-3 text-left font-medium">Statut</th>
                <th className="px-4 py-3 text-left font-medium">Permissions</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className={`border-b border-slate-50 hover:bg-slate-50 ${!u.actif ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{u.nom}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                      {u.role === 'admin' ? 'Admin' : 'Membre'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${u.vf_api_token ? 'text-emerald-600' : 'text-slate-300'}`}>
                      {u.vf_api_token ? 'Configuré' : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActif(u)} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer ${u.actif ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.actif ? 'bg-emerald-500' : 'bg-red-400'}`} />
                      {u.actif ? 'Actif' : 'Inactif'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === 'admin' ? (
                      <span className="text-xs text-slate-400">Accès total</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {PERM_TABS.map(t => {
                          const p = u.permissions?.[t.id];
                          if (!p) return null;
                          return (
                            <span key={t.id} className={`text-[10px] px-1.5 py-0.5 rounded ${p === 'rw' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-600'}`}>
                              {t.label}{p === 'r' ? ' (R)' : ''}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => { setEditUser(u); setShowModal(true); }} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                      Modifier
                    </button>
                    {u.id !== currentUserId && (
                      <button onClick={() => supprimerUser(u)} className="text-xs text-red-500 hover:text-red-700 font-medium">
                        Supprimer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ModalEditUser
          user={editUser}
          onClose={() => { setShowModal(false); setEditUser(null); }}
          onSave={() => { setShowModal(false); setEditUser(null); chargerUsers(); }}
          showToast={showToast}
        />
      )}
      {confirmDialogEl}
    </div>
  );
};

// ─── MODAL CRÉATION / ÉDITION UTILISATEUR ────────────────────────────────────

const ModalEditUser = ({ user, onClose, onSave, showToast }) => {
  useEscapeClose(onClose);
  const isEdit = !!user;
  const [form, setForm] = useState({
    email: user?.email || '',
    nom: user?.nom || '',
    password: '',
    role: user?.role || 'member',
    permissions: user?.permissions || {},
    gsheets_spreadsheet_id: user?.gsheets_spreadsheet_id || '',
  });
  const [saving, setSaving] = useState(false);
  const [createdUser, setCreatedUser] = useState(null);
  const [sendingCreds, setSendingCreds] = useState(false);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setPerm = (tabId, val) => setForm(f => ({
    ...f,
    permissions: { ...f.permissions, [tabId]: val }
  }));

  const handleSave = async () => {
    if (!form.email || !form.nom) { showToast('Email et nom requis', 'error'); return; }
    if (!isEdit && !form.password) { showToast('Mot de passe requis', 'error'); return; }
    if (form.password && form.password.length < 6) { showToast('Mot de passe trop court (min 6)', 'error'); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (isEdit && !payload.password) delete payload.password;

      const res = isEdit
        ? await api.patch(`/users/${user.id}`, payload)
        : await api.post('/users', payload);

      if (res.erreur) throw new Error(res.erreur);
      if (isEdit) {
        showToast('Utilisateur modifié', 'success');
        onSave();
      } else {
        showToast('Utilisateur créé', 'success');
        setCreatedUser(res);
      }
    } catch (e) { showToast(e.message, 'error'); }
    setSaving(false);
  };

  const handleSendCredentials = async () => {
    if (!createdUser) return;
    setSendingCreds(true);
    try {
      const res = await api.post(`/users/${createdUser.id}/send-credentials`, { password: form.password });
      if (res.erreur) throw new Error(res.erreur);
      showToast('Identifiants envoyés par email', 'success');
      onSave();
    } catch (e) { showToast(e.message, 'error'); }
    setSendingCreds(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex-shrink-0 p-6 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">{isEdit ? 'Modifier le membre' : 'Nouveau membre'}</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
          </div>
        </div>

        {createdUser ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="text-center py-6">
              <div className="text-4xl mb-4">&#9989;</div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Membre créé avec succès</h3>
              <p className="text-sm text-slate-500 mb-6">{createdUser.nom} ({createdUser.email})</p>
              <div className="bg-slate-50 rounded-xl p-4 text-left mb-6">
                <div className="text-xs font-medium text-slate-600 mb-2">Identifiants de connexion</div>
                <div className="text-sm text-slate-700"><strong>Email :</strong> {createdUser.email}</div>
                <div className="text-sm text-slate-700"><strong>Mot de passe :</strong> {form.password}</div>
              </div>
              <div className="flex flex-col gap-3">
                <button onClick={handleSendCredentials} disabled={sendingCreds} className="w-full px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                  {sendingCreds ? 'Envoi en cours...' : 'Envoyer les identifiants par email'}
                </button>
                <button onClick={onSave} className="w-full px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">
                  Fermer sans envoyer
                </button>
              </div>
            </div>
          </div>
        ) : (<>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nom</label>
              <input value={form.nom} onChange={e => setField('nom', e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" placeholder="Prénom Nom" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" placeholder="email@exemple.com" disabled={isEdit} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{isEdit ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe'}</label>
              <input type="password" value={form.password} onChange={e => setField('password', e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" placeholder="Min. 6 caractères" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Rôle</label>
              <select value={form.role} onChange={e => setField('role', e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                <option value="member">Membre</option>
                <option value="admin">Administrateur</option>
              </select>
            </div>
          </div>

          {form.role === 'member' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">Permissions par onglet</label>
              <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                {PERM_TABS.map(tab => (
                  <div key={tab.id} className="flex items-center justify-between py-1">
                    <span className="text-sm text-slate-700">{tab.label}</span>
                    <div className="flex bg-white rounded-lg border border-slate-200 p-0.5">
                      {[
                        { val: false, label: 'Aucun' },
                        { val: 'r', label: 'Lecture' },
                        { val: 'rw', label: 'L+É' },
                      ].map(opt => (
                        <button
                          key={String(opt.val)}
                          onClick={() => setPerm(tab.id, opt.val)}
                          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${(form.permissions[tab.id] || false) === opt.val ? 'bg-slate-900 text-white font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Google Sheet ID (log ventes)</label>
            <input value={form.gsheets_spreadsheet_id} onChange={e => setField('gsheets_spreadsheet_id', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              placeholder="ID du spreadsheet Google (laisser vide = pas de log)" />
            <p className="text-[11px] text-slate-400 mt-1">Si vide, les ventes de ce membre ne seront pas loggées dans Google Sheets</p>
          </div>
        </div>

        <div className="flex-shrink-0 p-6 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Annuler</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50">
            {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer le membre'}
          </button>
        </div>
        </>)}
      </div>
    </div>
  );
};

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────

// Helper : trouver la première vue accessible pour un user
function getDefaultVue(user) {
  if (!user || user.role === 'admin') return 'dashboard';
  const perms = user.permissions || {};
  // Ordre de préférence pour la vue par défaut
  const vueMap = [
    ['dashboard', 'dashboard'], ['leads', 'leads'], ['campagnes', 'sequences'],
    ['factures', 'factures'], ['portail', 'commandes'],
    ['emails', 'emails'], ['config', 'parametres'],
  ];
  for (const [tabId, vueId] of vueMap) {
    if (perms[tabId] === 'r' || perms[tabId] === 'rw') return vueId;
  }
  return 'dashboard';
}

// ─── VueVeille — Veille web hôtelière Terre de Mars ─────────────────────────
// Onglets : Opportunités (principal) / Articles / Sources & Santé

const SIGNAL_LABELS = {
  renovation: { label: 'Rénovation', color: 'bg-red-100 text-red-700' },
  ouverture: { label: 'Ouverture', color: 'bg-emerald-100 text-emerald-700' },
  nomination: { label: 'Nomination', color: 'bg-purple-100 text-purple-700' },
  acquisition: { label: 'Acquisition', color: 'bg-blue-100 text-blue-700' },
  conversion: { label: 'Conversion', color: 'bg-amber-100 text-amber-700' },
  spa_wellness: { label: 'Spa/Wellness', color: 'bg-pink-100 text-pink-700' },
  fermeture_temp: { label: 'Fermeture temp.', color: 'bg-amber-100 text-amber-700' },
  boamp_travaux: { label: 'BOAMP Travaux', color: 'bg-indigo-100 text-indigo-700' },
  architecte: { label: 'Architecte', color: 'bg-teal-100 text-teal-700' },
  vente: { label: 'Vente', color: 'bg-orange-100 text-orange-700' },
  recrutement: { label: 'Recrutement', color: 'bg-cyan-100 text-cyan-700' },
  autre: { label: 'Autre', color: 'bg-slate-100 text-slate-600' },
};

const OPP_STATUSES = {
  new: { label: 'Nouvelle', color: 'bg-blue-100 text-blue-700' },
  qualified: { label: 'Qualifiée', color: 'bg-emerald-100 text-emerald-700' },
  contacted: { label: 'Contacté', color: 'bg-amber-100 text-amber-700' },
  won: { label: 'Gagnée', color: 'bg-green-100 text-green-700' },
  lost: { label: 'Perdue', color: 'bg-slate-100 text-slate-500' },
  archived: { label: 'Archivée', color: 'bg-slate-50 text-slate-400' },
};

const VueVeille = ({ showToast }) => {
  const [tab, setTab] = useState('opportunities');
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);

  // Opportunities state
  const [opportunities, setOpportunities] = useState([]);
  const [oppDashboard, setOppDashboard] = useState(null);
  const [oppTotal, setOppTotal] = useState(0);
  const [oppPages, setOppPages] = useState(0);
  const [oppPage, setOppPage] = useState(1);
  const [oppSignalFilter, setOppSignalFilter] = useState('');
  const [oppStrengthFilter, setOppStrengthFilter] = useState('');
  const [oppSearch, setOppSearch] = useState('');
  const [oppSearchDebounced, setOppSearchDebounced] = useState('');
  const [selectedOpp, setSelectedOpp] = useState(null);

  // Articles state
  const [articles, setArticles] = useState([]);
  const [stats, setStats] = useState(null);
  const [artTotal, setArtTotal] = useState(0);
  const [artPages, setArtPages] = useState(0);
  const [artPage, setArtPage] = useState(1);
  const [filtre, setFiltre] = useState('non-lus');
  const [prioFiltre, setPrioFiltre] = useState('');
  const [sourceFiltre, setSourceFiltre] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  // Sources state
  const [sources, setSources] = useState([]);
  const [sourceHealth, setSourceHealth] = useState(null);
  const [showSources, setShowSources] = useState(false);
  const [editSource, setEditSource] = useState(null);
  const [sourceForm, setSourceForm] = useState({ nom: '', url: '', type: 'brave_search', mots_cles: '' });
  const [recentRuns, setRecentRuns] = useState([]);

  useEffect(() => { const t = setTimeout(() => setSearchDebounced(search), 400); return () => clearTimeout(t); }, [search]);
  useEffect(() => { const t = setTimeout(() => setOppSearchDebounced(oppSearch), 400); return () => clearTimeout(t); }, [oppSearch]);

  // ─── Loaders ─────────────────────────────────────────────────────────────

  const loadOpportunities = async (p = 1) => {
    try {
      const params = new URLSearchParams({ page: p, limit: 20 });
      if (oppSignalFilter) params.set('signal_type', oppSignalFilter);
      if (oppStrengthFilter) params.set('signal_strength', oppStrengthFilter);
      if (oppSearchDebounced) params.set('search', oppSearchDebounced);
      const res = await api.get(`/veille/opportunities?${params}`);
      if (p === 1) setOpportunities(res.opportunities || []);
      else setOpportunities(prev => [...prev, ...(res.opportunities || [])]);
      setOppTotal(res.total || 0);
      setOppPages(res.pages || 0);
      setOppPage(p);
    } catch (_) {}
  };

  const loadOppDashboard = async () => { try { setOppDashboard(await api.get('/veille/opportunities/dashboard')); } catch (_) {} };

  const loadArticles = async (p = 1) => {
    try {
      const params = new URLSearchParams({ page: p, limit: 30 });
      if (filtre === 'non-lus') params.set('lu', '0');
      else if (filtre === 'favoris') params.set('favori', '1');
      else if (filtre === 'archived') params.set('archived', '1');
      if (prioFiltre) params.set('priorite', prioFiltre);
      if (sourceFiltre) params.set('source', sourceFiltre);
      if (searchDebounced) params.set('search', searchDebounced);
      const res = await api.get(`/veille/articles?${params}`);
      if (p === 1) setArticles(res.articles || []);
      else setArticles(prev => [...prev, ...(res.articles || [])]);
      setArtTotal(res.total || 0);
      setArtPages(res.pages || 0);
      setArtPage(p);
    } catch (_) {}
  };

  const loadStats = async () => { try { setStats(await api.get('/veille/articles/stats')); } catch (_) {} };
  const loadSources = async () => { try { setSources(await api.get('/veille/sources') || []); } catch (_) {} };
  const loadSourceHealth = async () => { try { setSourceHealth(await api.get('/veille/sources/health')); } catch (_) {} };
  const loadRecentRuns = async () => { try { setRecentRuns(await api.get('/veille/runs?limit=20') || []); } catch (_) {} };

  const charger = async () => {
    setLoading(true);
    await Promise.all([loadOpportunities(1), loadOppDashboard(), loadStats(), loadSources()]);
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);
  useEffect(() => { if (tab === 'articles') { loadArticles(1); } }, [filtre, prioFiltre, sourceFiltre, searchDebounced]);
  useEffect(() => { if (tab === 'opportunities') { loadOpportunities(1); } }, [oppSignalFilter, oppStrengthFilter, oppSearchDebounced]);
  useEffect(() => { if (tab === 'health') { loadSourceHealth(); loadRecentRuns(); } }, [tab]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleScrapeAll = async () => {
    setScraping(true);
    try {
      const res = await api.post('/veille/run-all');
      if (res.errors && res.errors > 0) {
        showToast?.(`Scraping : ${res.errors}/${res.total} source(s) en erreur. ${res.lastError || ''}`, 'error');
      } else {
        showToast?.(`Scraping terminé : ${res.nouveaux} nouvel(s) article(s)`, 'success');
      }
      await charger();
    } catch (err) { showToast?.('Erreur scraping: ' + (err.erreur || err.message), 'error'); }
    setScraping(false);
  };

  const handleEnrich = async () => {
    try {
      await api.post('/veille/enrich');
      showToast?.('Enrichissement lancé', 'success');
      setTimeout(() => { loadOpportunities(1); loadOppDashboard(); }, 5000);
    } catch (err) { showToast?.('Erreur: ' + err.message, 'error'); }
  };

  const [showScanFermetures, setShowScanFermetures] = useState(false);

  const handleOppStatus = async (oppId, status) => {
    try {
      await api.patch(`/veille/opportunities/${oppId}`, { status });
      setOpportunities(prev => prev.map(o => o.id === oppId ? { ...o, status } : o));
      if (selectedOpp?.id === oppId) setSelectedOpp(prev => ({ ...prev, status }));
      showToast?.('Statut mis à jour', 'success');
    } catch (err) { showToast?.('Erreur: ' + err.message, 'error'); }
  };

  const handleViewOpp = async (oppId) => {
    try {
      const opp = await api.get(`/veille/opportunities/${oppId}`);
      setSelectedOpp(opp);
    } catch (err) { showToast?.('Erreur: ' + err.message, 'error'); }
  };

  const toggleLu = async (a) => {
    try { await api.patch(`/veille/articles/${a.id}`, { lu: !a.lu }); setArticles(p => p.map(x => x.id === a.id ? { ...x, lu: x.lu ? 0 : 1 } : x)); loadStats(); } catch (_) {}
  };
  const toggleFavori = async (a) => {
    try { await api.patch(`/veille/articles/${a.id}`, { favori: !a.favori }); setArticles(p => p.map(x => x.id === a.id ? { ...x, favori: x.favori ? 0 : 1 } : x)); loadStats(); } catch (_) {}
  };
  const archiver = async (a) => {
    try { await api.patch(`/veille/articles/${a.id}`, { archived: true, lu: true }); setArticles(p => p.filter(x => x.id !== a.id)); loadStats(); } catch (_) {}
  };

  const saveSource = async () => {
    try {
      const payload = { ...sourceForm, mots_cles: sourceForm.mots_cles ? sourceForm.mots_cles.split(',').map(s => s.trim()).filter(Boolean) : [] };
      if (editSource?.id) { await api.patch(`/veille/sources/${editSource.id}`, payload); showToast?.('Source modifiée', 'success'); }
      else { await api.post('/veille/sources', payload); showToast?.('Source ajoutée', 'success'); }
      setEditSource(null); setSourceForm({ nom: '', url: '', type: 'brave_search', mots_cles: '' }); await loadSources();
    } catch (err) { showToast?.('Erreur: ' + err.message, 'error'); }
  };

  const deleteSource = async (id) => {
    if (!confirm('Supprimer cette source et tous ses articles ?')) return;
    try { await api.delete(`/veille/sources/${id}`); showToast?.('Source supprimée', 'success'); await charger(); } catch (err) { showToast?.('Erreur: ' + err.message, 'error'); }
  };

  const PRIO = {
    A: { label: 'A', color: 'bg-red-100 text-red-700 border-red-200' },
    B: { label: 'B', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    C: { label: 'C', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  };

  const healthColor = (h) => h === 'healthy' ? 'bg-emerald-500' : h === 'degraded' ? 'bg-amber-500' : h === 'failing' ? 'bg-red-500' : 'bg-slate-300';
  const catLabel = (cat) => cat === 'quotidien' ? { text: 'Quotidien', cls: 'bg-blue-50 text-blue-600' } : cat === 'hebdo' ? { text: '2-3x/sem', cls: 'bg-amber-50 text-amber-600' } : { text: 'Radar', cls: 'bg-slate-50 text-slate-500' };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-500">Chargement de la veille...</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* KPIs opportunités */}
      {oppDashboard && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl border border-red-200 p-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setTab('opportunities'); setOppStrengthFilter(oppStrengthFilter === 'A' ? '' : 'A'); }}>
            <div className="text-xs font-bold text-red-600 mb-0.5">PRIO A</div>
            <div className="text-2xl font-bold text-red-900">{oppDashboard.prioA || 0}</div>
            <div className="text-xs text-red-600 mt-0.5">Opportunités fortes</div>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl border border-amber-200 p-3 cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setTab('opportunities'); setOppStrengthFilter(oppStrengthFilter === 'B' ? '' : 'B'); }}>
            <div className="text-xs font-bold text-amber-600 mb-0.5">PRIO B</div>
            <div className="text-2xl font-bold text-amber-900">{oppDashboard.prioB || 0}</div>
            <div className="text-xs text-amber-600 mt-0.5">Angle crédible</div>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border border-blue-200 p-3">
            <div className="text-xs font-medium text-blue-600 mb-0.5">NOUVELLES</div>
            <div className="text-2xl font-bold text-blue-900">{oppDashboard.newCount || 0}</div>
            <div className="text-xs text-blue-600 mt-0.5">A qualifier</div>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border border-purple-200 p-3">
            <div className="text-xs font-medium text-purple-600 mb-0.5">MULTI-SOURCES</div>
            <div className="text-2xl font-bold text-purple-900">{oppDashboard.multiSource || 0}</div>
            <div className="text-xs text-purple-600 mt-0.5">Confirmées</div>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl border border-emerald-200 p-3">
            <div className="text-xs font-medium text-emerald-600 mb-0.5">ENRICHIS</div>
            <div className="text-2xl font-bold text-emerald-900">{oppDashboard.enrichment?.enriched || 0}</div>
            <div className="text-xs text-emerald-600 mt-0.5">{oppDashboard.enrichment?.pending || 0} en attente</div>
          </div>
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl border border-slate-200 p-3">
            <div className="text-xs font-medium text-slate-500 mb-0.5">TOTAL OPP</div>
            <div className="text-2xl font-bold text-slate-900">{oppDashboard.total || 0}</div>
            <div className="text-xs text-slate-500 mt-0.5">{sources.filter(s => s.actif).length} sources</div>
          </div>
        </div>
      )}

      {/* Onglets + Actions */}
      <div className="bg-white rounded-xl border border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            {[
              { id: 'opportunities', label: `Opportunités${oppDashboard ? ` (${oppDashboard.total || 0})` : ''}` },
              { id: 'articles', label: `Articles${stats ? ` (${stats.nonLus})` : ''}` },
              { id: 'health', label: 'Sources & Santé' },
            ].map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); if (t.id === 'articles' && articles.length === 0) loadArticles(1); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === t.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button onClick={handleEnrich} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">
            Enrichir
          </button>
          <button onClick={() => setShowScanFermetures(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 transition-colors">
            Scanner fermetures
          </button>
          <button onClick={handleScrapeAll} disabled={scraping}
            className="text-xs px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5">
            {scraping ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Scraping...</> : 'Scraper maintenant'}
          </button>
        </div>
      </div>

      {/* ─── Onglet Opportunités ─────────────────────────────────────────────── */}
      {tab === 'opportunities' && (
        <>
          {/* Filtres opportunités */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {['A', 'B', 'C'].map(s => (
                <button key={s} onClick={() => setOppStrengthFilter(oppStrengthFilter === s ? '' : s)}
                  className={`px-2 py-1 rounded text-xs font-bold transition-colors ${oppStrengthFilter === s ? PRIO[s].color + ' ring-1 ring-offset-1' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                  {s}
                </button>
              ))}
            </div>
            <select value={oppSignalFilter} onChange={e => setOppSignalFilter(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
              <option value="">Tous les signaux</option>
              {Object.entries(SIGNAL_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input type="text" placeholder="Rechercher hôtel, ville, groupe..." value={oppSearch} onChange={e => setOppSearch(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-64 focus:outline-none focus:ring-1 focus:ring-blue-300" />
          </div>

          {/* Détail opportunité sélectionnée */}
          {selectedOpp && (
            <div className="bg-white rounded-xl border border-blue-200 p-5 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded font-bold ${PRIO[selectedOpp.signal_strength]?.color || 'bg-slate-100'}`}>{selectedOpp.signal_strength}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${SIGNAL_LABELS[selectedOpp.signal_type]?.color || 'bg-slate-100'}`}>{SIGNAL_LABELS[selectedOpp.signal_type]?.label || selectedOpp.signal_type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${OPP_STATUSES[selectedOpp.status]?.color || 'bg-slate-100'}`}>{OPP_STATUSES[selectedOpp.status]?.label || selectedOpp.status}</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">{selectedOpp.hotel_name || 'Établissement inconnu'}</h3>
                  <p className="text-sm text-slate-500">{[selectedOpp.city, selectedOpp.region, selectedOpp.group_name ? `Groupe: ${selectedOpp.group_name}` : ''].filter(Boolean).join(' · ')}</p>
                </div>
                <button onClick={() => setSelectedOpp(null)} className="text-slate-400 hover:text-slate-600 p-1">✕</button>
              </div>

              <div className="grid grid-cols-4 gap-3 mb-3">
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-slate-900">{selectedOpp.business_score}</div>
                  <div className="text-xs text-slate-500">Score /100</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-slate-900">{selectedOpp.confidence_score}</div>
                  <div className="text-xs text-slate-500">Confiance</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-slate-900">{selectedOpp.source_count}</div>
                  <div className="text-xs text-slate-500">Sources</div>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-slate-900">{selectedOpp.project_date || '—'}</div>
                  <div className="text-xs text-slate-500">Date projet</div>
                </div>
              </div>

              {selectedOpp.recommended_angle && (
                <div className="bg-blue-50 rounded-lg p-3 mb-3">
                  <div className="text-xs font-semibold text-blue-700 mb-1">Angle commercial recommandé</div>
                  <p className="text-xs text-blue-800">{selectedOpp.recommended_angle}</p>
                </div>
              )}

              {/* Pipeline statut */}
              <div className="flex items-center gap-1 mb-3">
                <span className="text-xs text-slate-500 mr-2">Statut :</span>
                {['new', 'qualified', 'contacted', 'won', 'lost'].map(s => (
                  <button key={s} onClick={() => handleOppStatus(selectedOpp.id, s)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${selectedOpp.status === s ? OPP_STATUSES[s].color + ' ring-1 ring-offset-1' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                    {OPP_STATUSES[s].label}
                  </button>
                ))}
              </div>

              {/* Articles liés */}
              {selectedOpp.articles?.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-2">Articles liés ({selectedOpp.articles.length})</div>
                  <div className="space-y-1">
                    {selectedOpp.articles.map(a => (
                      <div key={a.id} className="flex items-center gap-2 bg-slate-50 rounded px-3 py-1.5">
                        <span className="text-xs text-slate-400">{a.source_nom}</span>
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex-1 truncate">{a.titre}</a>
                        <span className="text-xs text-slate-300">{new Date(a.created_at).toLocaleDateString('fr-FR')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Liste opportunités */}
          {opportunities.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 p-12 text-center">
              <div className="text-3xl mb-3">🎯</div>
              <p className="text-sm text-slate-500">Aucune opportunité détectée</p>
              <p className="text-xs text-slate-400 mt-1">Lancez un scraping puis un enrichissement pour détecter des opportunités</p>
            </div>
          ) : (
            <div className="space-y-2">
              {opportunities.map(opp => {
                const signal = SIGNAL_LABELS[opp.signal_type] || SIGNAL_LABELS.autre;
                const prio = PRIO[opp.signal_strength] || PRIO.C;
                return (
                  <div key={opp.id} onClick={() => handleViewOpp(opp.id)}
                    className={`bg-white rounded-xl border p-4 cursor-pointer hover:shadow-md transition-all ${opp.signal_strength === 'A' ? 'border-l-4 border-l-red-400' : opp.signal_strength === 'B' ? 'border-l-4 border-l-amber-400' : 'border-slate-100'}`}>
                    <div className="flex items-start gap-3">
                      <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${prio.color}`}>
                        {opp.business_score}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-slate-900">{opp.hotel_name || 'Établissement non identifié'}</span>
                          {opp.city && <span className="text-xs text-slate-400">{opp.city}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${signal.color}`}>{signal.label}</span>
                          {opp.group_name && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{opp.group_name}</span>}
                          <span className={`text-xs px-1.5 py-0.5 rounded ${OPP_STATUSES[opp.status]?.color || 'bg-slate-100'}`}>{OPP_STATUSES[opp.status]?.label || opp.status}</span>
                          {opp.project_date && <span className="text-xs text-slate-400">Projet {opp.project_date}</span>}
                        </div>
                        <div className="text-xs text-slate-400">
                          {opp.source_count} source{opp.source_count > 1 ? 's' : ''} · confiance {opp.confidence_score}/100
                          · détecté {new Date(opp.first_seen_at).toLocaleDateString('fr-FR')}
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex gap-1">
                        {opp.status === 'new' && (
                          <button onClick={e => { e.stopPropagation(); handleOppStatus(opp.id, 'qualified'); }}
                            className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100">Qualifier</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {oppPage < oppPages && (
                <div className="text-center py-4">
                  <button onClick={() => loadOpportunities(oppPage + 1)}
                    className="text-xs px-6 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">
                    Charger plus ({oppTotal - opportunities.length} restantes)
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── Onglet Articles ────────────────────────────────────────────────── */}
      {tab === 'articles' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {[{ id: 'non-lus', label: `Non lus${stats ? ` (${stats.nonLus})` : ''}` }, { id: 'favoris', label: 'Favoris' }, { id: 'tous', label: 'Tous' }, { id: 'archived', label: 'Archives' }].map(f => (
                <button key={f.id} onClick={() => { setFiltre(f.id); setPrioFiltre(''); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filtre === f.id && !prioFiltre ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {['A', 'B', 'C'].map(p => (
                <button key={p} onClick={() => { setPrioFiltre(prioFiltre === p ? '' : p); if (filtre !== 'tous') setFiltre('tous'); }}
                  className={`px-2 py-1 rounded text-xs font-bold transition-colors ${prioFiltre === p ? PRIO[p].color + ' ring-1 ring-offset-1' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>{p}</button>
              ))}
            </div>
            <select value={sourceFiltre} onChange={e => setSourceFiltre(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
              <option value="">Toutes les sources</option>
              {sources.map(s => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
            <input type="text" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-1 focus:ring-blue-300" />
          </div>

          {articles.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 p-12 text-center">
              <div className="text-3xl mb-3">🔍</div>
              <p className="text-sm text-slate-500">Aucun article trouvé</p>
            </div>
          ) : (
            <div className="space-y-2">
              {articles.map(article => {
                const prio = PRIO[article.priorite] || PRIO.C;
                return (
                  <div key={article.id} className={`bg-white rounded-xl border p-4 transition-all ${article.lu ? 'border-slate-100' : 'border-l-4 ' + (article.priorite === 'A' ? 'border-l-red-400 bg-red-50/20' : article.priorite === 'B' ? 'border-l-amber-400 bg-amber-50/20' : 'border-l-slate-300 bg-blue-50/20')}`}>
                    <div className="flex items-start gap-3">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${prio.color}`}>{prio.label}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {!article.lu && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                          <a href={article.url} target="_blank" rel="noopener noreferrer"
                            onClick={() => { if (!article.lu) { api.patch(`/veille/articles/${article.id}`, { lu: true }).then(() => { setArticles(p => p.map(x => x.id === article.id ? { ...x, lu: 1 } : x)); loadStats(); }).catch(() => {}); } }}
                            className={`text-sm font-semibold hover:text-blue-600 transition-colors ${article.lu ? 'text-slate-600' : 'text-slate-900'}`}>
                            {article.titre}
                          </a>
                        </div>
                        {article.resume && <p className="text-xs text-slate-500 line-clamp-2 mb-1.5">{article.resume}</p>}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-slate-400 font-medium">{article.source_nom}</span>
                          {article.date_article && <span className="text-xs text-slate-300">· {article.date_article}</span>}
                          <span className="text-xs text-slate-300">· Score {article.score_pertinence}</span>
                          {article.mots_cles_trouves?.slice(0, 4).map((mot, i) => (
                            <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{mot}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => toggleLu(article)} className={`p-1.5 rounded-lg transition-colors ${article.lu ? 'hover:bg-blue-50 text-slate-300' : 'bg-blue-100 text-blue-600'}`}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" />{article.lu && <path d="M8 12l3 3 5-5" />}</svg>
                        </button>
                        <button onClick={() => toggleFavori(article)} className={`p-1.5 rounded-lg transition-colors ${article.favori ? 'text-rose-500 bg-rose-50' : 'text-slate-300 hover:bg-slate-50'}`}>
                          <svg className="w-4 h-4" fill={article.favori ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
                        </button>
                        <button onClick={() => archiver(article)} className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-50 transition-colors">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {artPage < artPages && (
                <div className="text-center py-4">
                  <button onClick={() => loadArticles(artPage + 1)} className="text-xs px-6 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">Charger plus ({artTotal - articles.length} restants)</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── Onglet Sources & Santé ─────────────────────────────────────────── */}
      {tab === 'health' && (
        <div className="space-y-4">
          {/* Résumé santé */}
          {sourceHealth && (
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">{sourceHealth.summary.healthy}</div>
                <div className="text-xs text-emerald-600">Healthy</div>
              </div>
              <div className="bg-amber-50 rounded-xl border border-amber-200 p-3 text-center">
                <div className="text-2xl font-bold text-amber-700">{sourceHealth.summary.degraded}</div>
                <div className="text-xs text-amber-600">Degraded</div>
              </div>
              <div className="bg-red-50 rounded-xl border border-red-200 p-3 text-center">
                <div className="text-2xl font-bold text-red-700">{sourceHealth.summary.failing}</div>
                <div className="text-xs text-red-600">Failing</div>
              </div>
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 text-center">
                <div className="text-2xl font-bold text-slate-700">{sourceHealth.summary.unknown}</div>
                <div className="text-xs text-slate-500">Unknown</div>
              </div>
            </div>
          )}

          {/* Sources */}
          <div className="bg-white rounded-xl border border-slate-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">Sources ({sources.length})</h3>
              <button onClick={() => { setEditSource({}); setSourceForm({ nom: '', url: '', type: 'brave_search', mots_cles: '' }); }}
                className="text-xs px-3 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">+ Ajouter</button>
            </div>

            {editSource && (
              <div className="bg-slate-50 rounded-lg p-3 mb-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="Nom" value={sourceForm.nom} onChange={e => setSourceForm(p => ({ ...p, nom: e.target.value }))} className="text-xs border border-slate-200 rounded px-2 py-1.5" />
                  <input type="text" placeholder="URL du site" value={sourceForm.url} onChange={e => setSourceForm(p => ({ ...p, url: e.target.value }))} className="text-xs border border-slate-200 rounded px-2 py-1.5" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={sourceForm.type} onChange={e => setSourceForm(p => ({ ...p, type: e.target.value }))} className="text-xs border border-slate-200 rounded px-2 py-1.5">
                    <option value="brave_search">Brave Search</option><option value="html">HTML</option><option value="rss">RSS</option>
                  </select>
                  <input type="text" placeholder="Mots-clés (virgules)" value={sourceForm.mots_cles} onChange={e => setSourceForm(p => ({ ...p, mots_cles: e.target.value }))} className="text-xs border border-slate-200 rounded px-2 py-1.5" />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveSource} className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">{editSource.id ? 'Modifier' : 'Ajouter'}</button>
                  <button onClick={() => setEditSource(null)} className="text-xs px-3 py-1 rounded border border-slate-200 hover:bg-slate-100">Annuler</button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {sources.map(s => {
                const cat = catLabel(s.categorie);
                return (
                  <div key={s.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${healthColor(s.health_status)}`} title={s.health_status || 'unknown'} />
                        <span className="text-xs font-medium text-slate-800">{s.nom}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${cat.cls}`}>{cat.text}</span>
                        {s.error_count > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-600">{s.error_count} err</span>}
                      </div>
                      <div className="text-xs text-slate-400 ml-4 mt-0.5">
                        {s.article_count || 0} articles · {s.unread_count || 0} non lus
                        {s.last_run && ` · Dernier run: ${new Date(s.last_run).toLocaleString('fr-FR')}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                      <button onClick={async () => { setScraping(true); try { const r = await api.post(`/veille/sources/${s.id}/run`); showToast?.(`${r.nouveaux} article(s)`, 'success'); await charger(); } catch (err) { showToast?.('Erreur: ' + err.message, 'error'); } setScraping(false); }} disabled={scraping} className="text-xs px-2 py-1 rounded hover:bg-blue-50 text-blue-600 disabled:opacity-50">Scan</button>
                      <button onClick={() => { setEditSource(s); setSourceForm({ nom: s.nom, url: s.url, type: s.type, mots_cles: Array.isArray(s.mots_cles) ? s.mots_cles.join(', ') : '' }); }} className="text-xs px-2 py-1 rounded hover:bg-slate-200 text-slate-600">Modifier</button>
                      <button onClick={() => deleteSource(s.id)} className="text-xs px-2 py-1 rounded hover:bg-red-50 text-red-500">Suppr</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Derniers runs */}
          {recentRuns.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Derniers runs</h3>
              <div className="space-y-1">
                {recentRuns.map(run => (
                  <div key={run.id} className="flex items-center gap-3 bg-slate-50 rounded px-3 py-1.5 text-xs">
                    <span className={`w-2 h-2 rounded-full ${run.status === 'success' ? 'bg-emerald-500' : run.status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
                    <span className="text-slate-600 w-40 truncate">{run.source_nom}</span>
                    <span className="text-slate-400">{run.trigger_type}</span>
                    <span className="text-slate-400">{run.items_found || 0} trouvés</span>
                    <span className="text-slate-400">{run.items_inserted || 0} insérés</span>
                    <span className="text-slate-400">{run.duration_ms ? `${run.duration_ms}ms` : '—'}</span>
                    {run.error_message && <span className="text-red-500 truncate flex-1">{run.error_message.substring(0, 60)}</span>}
                    <span className="text-slate-300 ml-auto">{new Date(run.started_at).toLocaleString('fr-FR')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modale Scanner Fermetures Google Places */}
      {showScanFermetures && (
        <ModalScanFermetures
          onClose={() => { setShowScanFermetures(false); loadOpportunities(1); loadOppDashboard(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
};

// ─── ModalScanFermetures — Scanner Google Places ──────────────────────────────

const ModalScanFermetures = ({ onClose, showToast }) => {
  const [regions, setRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [customCity, setCustomCity] = useState('');
  const [hotelSearch, setHotelSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState(null);
  const [scanLog, setScanLog] = useState([]);

  useEffect(() => {
    api.get('/veille/scan-fermetures/regions').then(setRegions).catch(() => {});
  }, []);

  const scanVille = async (city) => {
    if (!city.trim()) return;
    setScanning(true);
    setResults(null);
    setScanLog([]);
    try {
      const res = await api.post('/veille/scan-fermetures', { city: city.trim() });
      if (res.ok !== false) {
        setResults(res);
        if (res.closed > 0) {
          showToast?.(`${res.closed} hotel(s) ferme(s) a ${city}`, 'success');
        }
      } else {
        showToast?.(res.erreur || 'Erreur', 'error');
      }
    } catch (err) {
      showToast?.('Erreur: ' + (err.erreur || err.message), 'error');
    }
    setScanning(false);
  };

  const searchHotel = async () => {
    if (!hotelSearch.trim()) return;
    setScanning(true);
    setResults(null);
    try {
      const res = await api.post('/veille/scan-fermetures/hotel', { name: hotelSearch.trim() });
      if (res.ok !== false && res.results) {
        setResults({
          city: hotelSearch.trim(),
          total: res.results.length,
          closed: res.results.filter(h => h.businessStatus === 'CLOSED_TEMPORARILY').length,
          queries: 1,
          hotels: res.results.map(h => ({ ...h, city: '' })),
          isHotelSearch: true,
        });
      } else {
        showToast?.(res.erreur || 'Aucun resultat', 'error');
      }
    } catch (err) {
      showToast?.('Erreur: ' + (err.erreur || err.message), 'error');
    }
    setScanning(false);
  };

  const scanRegion = async () => {
    if (!selectedRegion) return;
    const region = regions.find(r => r.name === selectedRegion);
    if (!region) return;

    setScanning(true);
    setResults(null);
    setScanLog([]);

    try {
      const res = await api.post('/veille/scan-fermetures', { region: selectedRegion });
      if (res.ok !== false) {
        setResults({ city: selectedRegion, total: 0, closed: res.found, hotels: [], regionResults: res.results });
        if (res.found > 0) {
          showToast?.(`${res.found} hotel(s) ferme(s) en ${selectedRegion}`, 'success');
        } else {
          showToast?.(`Aucun hotel ferme en ${selectedRegion}`, 'info');
        }
      } else {
        showToast?.(res.erreur || 'Erreur', 'error');
      }
    } catch (err) {
      showToast?.('Erreur: ' + (err.erreur || err.message), 'error');
    }
    setScanning(false);
  };

  const [leadsOffset, setLeadsOffset] = useState(0);

  const scanLeads = async (offset = 0) => {
    setScanning(true);
    if (offset === 0) setResults(null);
    try {
      const res = await api.post('/veille/scan-fermetures/leads', { limit: 30, offset });
      if (res.ok !== false) {
        const leadsResults = res.results.map(r => ({
          name: r.hotel + (r.ville ? ` (${r.ville})` : ''),
          address: r.match?.address || '',
          businessStatus: r.status === 'NOT_FOUND' ? 'NOT_FOUND' : (r.match?.businessStatus || r.status),
          rating: r.match?.rating || null,
          ratingCount: r.match?.ratingCount || 0,
          website: r.match?.website || null,
          placeId: r.match?.placeId || null,
          googleName: r.match?.name || null,
          city: r.ville || '',
        }));
        setResults(prev => ({
          city: 'Mes leads',
          total: prev ? prev.total + leadsResults.length : leadsResults.length,
          closed: (prev?.closed || 0) + res.closed,
          queries: res.checked,
          hotels: prev ? [...prev.hotels, ...leadsResults] : leadsResults,
          isLeadsScan: true,
          leadsTotal: res.total,
          hasMore: offset + res.checked < res.total,
        }));
        setLeadsOffset(offset + res.checked);
        if (res.closed > 0) {
          showToast?.(`${res.closed} hotel(s) ferme(s) detecte(s)`, 'success');
        }
      } else {
        showToast?.(res.erreur || 'Erreur', 'error');
      }
    } catch (err) {
      showToast?.('Erreur: ' + (err.erreur || err.message), 'error');
    }
    setScanning(false);
  };

  const statusColors = {
    OPERATIONAL: 'text-emerald-600 bg-emerald-50',
    CLOSED_TEMPORARILY: 'text-amber-700 bg-amber-50 font-semibold',
    CLOSED_PERMANENTLY: 'text-red-600 bg-red-50',
    NOT_FOUND: 'text-slate-400 bg-slate-50',
    ERROR: 'text-red-400 bg-red-50',
  };

  const statusLabels = {
    OPERATIONAL: 'Ouvert',
    CLOSED_TEMPORARILY: 'Ferme temporairement',
    CLOSED_PERMANENTLY: 'Ferme definitivement',
    NOT_FOUND: 'Non trouve',
    ERROR: 'Erreur',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Scanner Google Places</h3>
            <p className="text-xs text-slate-400 mt-0.5">Detecter les hotels temporairement fermes (signal renovation)</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>

        {/* Controles */}
        <div className="px-6 py-4 border-b border-slate-50 space-y-3 flex-shrink-0">
          {/* Scan par ville */}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Scanner une ville</label>
            <div className="flex gap-2">
              <input type="text" value={customCity} onChange={e => setCustomCity(e.target.value)}
                placeholder="Ex: Paris, Nice, Chamonix..."
                onKeyDown={e => e.key === 'Enter' && !scanning && scanVille(customCity)}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400" />
              <button onClick={() => scanVille(customCity)} disabled={scanning || !customCity.trim()}
                className="px-4 py-2 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap">
                {scanning ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Scan...</> : 'Scanner'}
              </button>
            </div>
          </div>

          {/* Recherche hotel specifique */}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Chercher un hotel par nom</label>
            <div className="flex gap-2">
              <input type="text" value={hotelSearch} onChange={e => setHotelSearch(e.target.value)}
                placeholder="Ex: Hotel d'Aubusson Paris, Le Meurice..."
                onKeyDown={e => e.key === 'Enter' && !scanning && searchHotel()}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              <button onClick={searchHotel} disabled={scanning || !hotelSearch.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap">
                {scanning ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> ...</> : 'Chercher'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">Verifie le statut Google (ouvert, ferme temp., ferme definitivement)</p>
          </div>

          <div className="border-t border-slate-100 pt-3" />

          {/* Scan par region */}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Ou scanner une region entiere</label>
            <div className="flex gap-2">
              <select value={selectedRegion} onChange={e => setSelectedRegion(e.target.value)}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20">
                <option value="">Choisir une region...</option>
                {regions.map(r => (
                  <option key={r.name} value={r.name}>{r.name} ({r.count} villes)</option>
                ))}
              </select>
              <button onClick={scanRegion} disabled={scanning || !selectedRegion}
                className="px-4 py-2 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap">
                {scanning ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Scan...</> : 'Scanner region'}
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3" />

          {/* Scanner les leads */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-xs font-medium text-slate-500 block">Scanner mes leads</label>
              <p className="text-xs text-slate-400">Verifie le statut Google de chaque hotel de votre base (30 par lot)</p>
            </div>
            <button onClick={() => scanLeads(0)} disabled={scanning}
              className="px-4 py-2 bg-slate-800 text-white text-xs font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap">
              {scanning ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Scan...</> : 'Scanner mes leads'}
            </button>
          </div>
        </div>

        {/* Resultats */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {scanning && !results && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-sm gap-2">
              <span className="w-5 h-5 border-2 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
              <p>Scan en cours...</p>
              <p className="text-xs">Recherche multi-requetes par quartier — peut prendre 10 a 30 secondes</p>
            </div>
          )}

          {results && !results.regionResults && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className="font-medium text-slate-700">{results.city}</span>
                {results.queries && <span className="text-slate-400">{results.queries} requete(s)</span>}
                <span className="text-slate-400">{results.total} hotel(s) uniques</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${results.closed > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {results.closed > 0 ? `${results.closed} ferme(s) temporairement` : 'Aucune fermeture'}
                </span>
              </div>

              {results.hotels && results.hotels.length > 0 && (
                <div className="space-y-1">
                  {/* Fermes en premier */}
                  {results.hotels
                    .sort((a, b) => {
                      if (a.businessStatus === 'CLOSED_TEMPORARILY' && b.businessStatus !== 'CLOSED_TEMPORARILY') return -1;
                      if (b.businessStatus === 'CLOSED_TEMPORARILY' && a.businessStatus !== 'CLOSED_TEMPORARILY') return 1;
                      return 0;
                    })
                    .map((h, i) => (
                    <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${h.businessStatus === 'CLOSED_TEMPORARILY' ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-50'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 truncate">{h.name}</div>
                        <div className="text-xs text-slate-400 truncate">{h.address}</div>
                      </div>
                      {h.rating && (
                        <span className="text-xs text-slate-500 flex-shrink-0">{h.rating} ({h.ratingCount})</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusColors[h.businessStatus] || 'text-slate-500 bg-slate-50'}`}>
                        {statusLabels[h.businessStatus] || h.businessStatus}
                      </span>
                      {h.website && (
                        <a href={h.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 text-xs flex-shrink-0">Site</a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Resultats par region */}
          {results && results.regionResults && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium text-slate-700">{results.city}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${results.closed > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {results.closed > 0 ? `${results.closed} hotel(s) ferme(s) au total` : 'Aucune fermeture detectee'}
                </span>
              </div>

              {results.regionResults.map((r, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-slate-600">{r.city}</span>
                    <span className="text-slate-400">{r.total} hotels</span>
                    {r.closed > 0 && <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">{r.closed} ferme(s)</span>}
                    {r.error && <span className="text-red-500">{r.error}</span>}
                  </div>
                  {r.hotels && r.hotels.length > 0 && r.hotels.map((h, j) => (
                    <div key={j} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm ml-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 truncate">{h.name}</div>
                        <div className="text-xs text-slate-400 truncate">{h.address}</div>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium flex-shrink-0">Ferme temp.</span>
                      {h.website && (
                        <a href={h.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 text-xs flex-shrink-0">Site</a>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Resultats scan leads */}
          {results && results.isLeadsScan && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className="font-medium text-slate-700">Scan leads</span>
                <span className="text-slate-400">{results.total} / {results.leadsTotal || '?'} verifies</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${results.closed > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {results.closed > 0 ? `${results.closed} ferme(s) temporairement` : 'Aucune fermeture'}
                </span>
              </div>

              <div className="space-y-1">
                {results.hotels
                  .sort((a, b) => {
                    if (a.businessStatus === 'CLOSED_TEMPORARILY' && b.businessStatus !== 'CLOSED_TEMPORARILY') return -1;
                    if (b.businessStatus === 'CLOSED_TEMPORARILY' && a.businessStatus !== 'CLOSED_TEMPORARILY') return 1;
                    if (a.businessStatus === 'CLOSED_PERMANENTLY' && b.businessStatus === 'OPERATIONAL') return -1;
                    return 0;
                  })
                  .map((h, i) => (
                  <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${h.businessStatus === 'CLOSED_TEMPORARILY' ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-50'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-800 truncate">{h.name}</div>
                      {h.googleName && h.googleName !== h.name.split(' (')[0] && (
                        <div className="text-xs text-blue-500 truncate">Google: {h.googleName}</div>
                      )}
                      <div className="text-xs text-slate-400 truncate">{h.address}</div>
                    </div>
                    {h.rating && (
                      <span className="text-xs text-slate-500 flex-shrink-0">{h.rating}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusColors[h.businessStatus] || 'text-slate-500 bg-slate-50'}`}>
                      {statusLabels[h.businessStatus] || h.businessStatus}
                    </span>
                  </div>
                ))}
              </div>

              {results.hasMore && !scanning && (
                <button onClick={() => scanLeads(leadsOffset)}
                  className="w-full py-2 text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded-lg hover:bg-blue-50">
                  Charger les 30 suivants ({results.leadsTotal - results.total} restants)
                </button>
              )}
              {scanning && results.total > 0 && (
                <div className="flex items-center justify-center py-3 text-slate-400 text-xs gap-2">
                  <span className="w-4 h-4 border-2 border-slate-200 border-t-amber-500 rounded-full animate-spin" />
                  Verification en cours...
                </div>
              )}
            </div>
          )}

          {!scanning && !results && (
            <div className="text-center py-12 text-slate-400 text-sm">
              <p>Choisissez une ville, un hotel ou scannez vos leads.</p>
              <p className="mt-1 text-xs">Le scan detecte les hotels avec statut "Temporarily Closed" sur Google — signal fort de renovation.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-slate-400">Les hotels fermes sont automatiquement ajoutes comme opportunites</p>
          <button onClick={onClose} className="px-4 py-2 text-xs text-slate-600 hover:text-slate-800">Fermer</button>
        </div>
      </div>
    </div>
  );
};

function App() {
  const initUser = (() => { try { return JSON.parse(sessionStorage.getItem('tdm_user') || 'null'); } catch { return null; } })();
  const [vue, setVue] = useState(getDefaultVue(initUser));
  const [leads, setLeads] = useState([]);
  const [sequences, setSequences] = useState([]);
  const [activites, setActivites] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editSeq, setEditSeq] = useState(null);
  const [showSeqEditor, setShowSeqEditor] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "info", visible: false });
  const toastTimer = useRef(null);

  // ─── Multi-user : contexte utilisateur ────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(initUser);
  const [showProfile, setShowProfile] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  function hasAccess(tabId) {
    if (!currentUser || isAdmin) return true;
    const perm = currentUser.permissions?.[tabId];
    return perm === 'r' || perm === 'rw';
  }

  function canWrite(tabId) {
    if (!currentUser || isAdmin) return true;
    return currentUser.permissions?.[tabId] === 'rw';
  }

  function handleLogout() {
    sessionStorage.removeItem('tdm_token');
    sessionStorage.removeItem('tdm_user');
    window.AUTH_TOKEN = '';
    window.location.reload();
  }

  const showToast = useCallback((message, type = "info") => {
    clearTimeout(toastTimer.current);
    setToast({ message, type, visible: true });
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000);
  }, []);

  // Exposer showToast globalement pour les composants sans prop
  useEffect(() => { window.showToast = showToast; }, [showToast]);

  // Charger les segments dynamiques
  useEffect(() => {
    api.get('/segments').then(data => {
      if (Array.isArray(data) && data.length > 0) {
        _segmentsCache = data.map(s => s.nom);
      }
    }).catch(() => {});
  }, []);

  // Charger les données au démarrage (résilient aux permissions)
  const chargerRetries = useRef(0);
  const charger = async () => {
    // Attendre que le token soit disponible (Babel charge async)
    const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
    if (!token) {
      if (chargerRetries.current < 25) { // Max 5 secondes (25 × 200ms)
        chargerRetries.current++;
        setTimeout(charger, 200);
      }
      return;
    }
    chargerRetries.current = 0;
    setLoading(true);

    // Helper : appel API silencieux (retourne null si 403/erreur)
    const safeFetch = (path) => api.get(path).catch(() => null);

    try {
      const promises = [];
      // Ne charger que les données accessibles
      promises.push(hasAccess('leads') ? safeFetch('/leads') : Promise.resolve(null));
      promises.push(hasAccess('campagnes') ? safeFetch('/sequences') : Promise.resolve(null));
      promises.push(hasAccess('dashboard') ? safeFetch('/stats/dashboard') : Promise.resolve(null));
      promises.push(hasAccess('dashboard') ? safeFetch('/stats/sequences') : Promise.resolve(null));

      const [leadsData, seqData, statsData, seqStatsData] = await Promise.all(promises);

      if (leadsData) setLeads(Array.isArray(leadsData) ? leadsData : (leadsData.leads || []));
      if (seqData) setSequences(Array.isArray(seqData) ? seqData : (seqData.sequences || []));
      if (statsData) {
        if (seqStatsData) statsData.statsSequences = seqStatsData?.stats || [];
        setStats(statsData);
        if (statsData?.activitesRecentes) setActivites(statsData.activitesRecentes);
      }
    } catch(e) { console.error("Erreur chargement:", e); }
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);

  // Normaliser les séquences (memoïsé pour éviter les recalculs)
  const sequencesNorm = useMemo(() => sequences.map(s => {
    let opts = {};
    if (s.options) {
      try { opts = typeof s.options === 'string' ? JSON.parse(s.options) : s.options; } catch(e) {}
    }
    return {
      ...s,
      options: opts,
      leadsActifs: s.leads_actifs || s.leadsActifs || 0,
      etapes: (s.etapes || []).map(e => ({ ...e, jour: e.jour_delai ?? e.jour ?? 0 }))
    };
  }), [sequences]);

  const addLead = (lead) => {
    setLeads(l => [lead, ...l]);
  };

  const launchSequence = async (leadId, seqId, taskRelanceMois) => {
    const r = await api.post(`/sequences/${seqId}/inscrire`, { lead_id: leadId, task_relance_mois: taskRelanceMois || 0 });
    if (r?.erreur) throw new Error(r.erreur);
    charger();
  };

  const saveSeq = async (seq) => {
    let res;
    if (seq.id) {
      res = await api.put(`/sequences/${seq.id}`, seq);
    } else {
      res = await api.post('/sequences', seq);
    }
    if (res?.erreur) throw new Error(res.erreur);
    charger();
  };

  const NAV_ALL = [
    { id: "dashboard-group", icon: "📊", label: "Dashboard", children: [
      { id: "dashboard", label: "Séquences" },
      { id: "dashboard-marketing", label: "Marketing" },
      { id: "dashboard-ventes", label: "Ventes" },
    ]},
    { id: "portail", icon: "📦", label: "Portail", children: [
      { id: "commandes", label: "Commandes" },
      { id: "partenaires", label: "Partenaires" },
    ]},
    { id: "leads", icon: "👥", label: "Leads" },
    { id: "campagnes", icon: "📨", label: "Campagnes", children: [
      { id: "sequences", label: "Séquences" },
      { id: "email-campaigns", label: "Email Marketing" },
      { id: "templates", label: "Templates" },
    ]},
    { id: "factures", icon: "📄", label: "Factures" },
    { id: "veille", icon: "🔍", label: "Veille" },
    { id: "emails", icon: "✉️", label: "Validation Email" },
    { id: "config", icon: "⚙️", label: "Configuration", children: [
      { id: "parametres", label: "Paramètres" },
      { id: "blocklist", label: "Blocklist" },
      ...(isAdmin ? [{ id: "equipe", label: "Équipe" }] : []),
    ]},
  ];

  // Helper permission mapping
  const getPermId = (id) => {
    if (id === 'equipe') return 'config';
    if (id === 'commandes' || id === 'partenaires') return 'portail';
    if (id === 'sequences' || id === 'templates' || id === 'email-campaigns') return 'campagnes';
    if (id === 'parametres' || id === 'blocklist') return 'config';
    if (id === 'dashboard' || id === 'dashboard-marketing' || id === 'dashboard-ventes') return 'dashboard';
    return id;
  };

  // Filtrer la NAV selon les permissions de l'utilisateur
  const NAV = NAV_ALL.filter(item => {
    if (item.children) return item.children.some(c => hasAccess(getPermId(c.id)));
    return hasAccess(item.id);
  }).map(item => {
    if (!item.children) return item;
    const filtered = item.children.filter(c => {
      if (c.id === 'equipe') return isAdmin;
      return hasAccess(getPermId(c.id));
    });
    return { ...item, children: filtered };
  });

  // Trouver le groupe parent actif et le label de la vue courante
  const activeGroup = NAV.find(n => n.children?.some(c => c.id === vue));
  const activeNav = NAV.find(n => n.id === vue) || activeGroup;
  const activeChild = activeGroup?.children?.find(c => c.id === vue);
  const isGroupActive = (item) => item.children ? item.children.some(c => c.id === vue) : item.id === vue;
  const headerLabel = activeChild?.label || activeNav?.label || '';

  // Mobile : aplatir les items pour la bottom bar (seulement les parents)
  const MOBILE_NAV = NAV.map(n => n.children ? { ...n, id: n.children[0].id } : n);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { font-family: 'DM Sans', sans-serif; }
        .font-mono { font-family: 'DM Mono', monospace !important; }
        .line-clamp-1 { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.2s ease-out; }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0px); }
        @media (max-width: 767px) {
          button, select, [type="checkbox"] { min-height: 36px; }
          .touch-target { min-height: 44px; min-width: 44px; }
        }
      `}</style>

      <Toast toast={toast} onDismiss={() => setToast(t => ({ ...t, visible: false }))} />

      {showSeqEditor && <ModalEmailEditor seq={editSeq} onClose={() => { setShowSeqEditor(false); setEditSeq(null); }} onSave={saveSeq} />}
      {showProfile && <ModalProfile onClose={() => setShowProfile(false)} showToast={showToast} />}

      {/* Sidebar — desktop only */}
      <div className="hidden md:flex fixed left-0 top-0 h-full w-56 bg-white border-r border-slate-100 flex-col z-40">
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white text-xs font-bold">TM</div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Terre de Mars</div>
              <div className="text-xs text-slate-400">Sales Automation</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = isGroupActive(item);
            if (!item.children) {
              return (
                <button key={item.id} onClick={() => setVue(item.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${active ? "bg-slate-900 text-white font-medium" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </button>
              );
            }
            return (
              <div key={item.id}>
                <button onClick={() => setVue(item.children[0].id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${active ? "bg-slate-900 text-white font-medium" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </button>
                {active && (
                  <div className="ml-8 mt-0.5 mb-1 space-y-0.5">
                    {item.children.map(child => (
                      <button key={child.id} onClick={() => setVue(child.id)} className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-all ${vue === child.id ? "text-slate-900 font-semibold bg-slate-100" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"}`}>
                        {child.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-100 space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
              {(currentUser?.nom || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-800 truncate">{currentUser?.nom || 'Utilisateur'}</div>
              <div className="text-xs text-slate-400 truncate">{isAdmin ? 'Admin' : 'Commercial'}</div>
            </div>
          </div>
          <div className="flex gap-1.5">
            {currentUser?.id !== '_legacy_admin' && (
              <button onClick={() => setShowProfile(true)} className="flex-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 px-2 py-1.5 rounded-lg transition-colors">
                Profil
              </button>
            )}
            <button onClick={handleLogout} className="flex-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors">
              Déconnexion
            </button>
          </div>
        </div>
      </div>

      {/* Bottom tab bar — mobile only */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 flex justify-around items-center px-1 py-1 safe-area-bottom">
        {MOBILE_NAV.map(({ id, icon, label }) => {
          const mActive = NAV.find(n => n.children?.some(c => c.id === id))
            ? NAV.find(n => n.children?.some(c => c.id === id)).children.some(c => c.id === vue)
            : vue === id;
          return (
            <button key={id} onClick={() => setVue(id)} className={`flex flex-col items-center justify-center min-w-0 flex-1 py-2 rounded-lg transition-colors ${mActive ? "text-slate-900" : "text-slate-400"}`}>
              <span className="text-lg leading-none">{icon}</span>
              {mActive && <span className="text-[10px] font-medium mt-0.5 truncate max-w-full px-1">{label}</span>}
            </button>
          );
        })}
      </div>

      {/* Main */}
      <div className="md:ml-56 min-h-screen">
        <header className="bg-white border-b border-slate-100 shadow-sm px-4 py-3 md:px-8 md:py-4 flex items-center justify-between sticky top-0 z-30">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-slate-900">{headerLabel}</h1>
              {activeGroup && (
                <span className="text-xs text-slate-300 font-normal">/ {activeGroup.label}</span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              {vue === "dashboard" && `${leads.filter(l => l.statut === "En séquence").length} leads en séquence`}
              {vue === "dashboard-marketing" && "KPIs et performances des campagnes email marketing"}
              {vue === "dashboard-ventes" && "Analytics CA, clients & commandes"}
              {vue === "commandes" && "Commandes partenaires en attente de validation"}
              {vue === "partenaires" && "Gestion des accès au portail partenaire"}
              {vue === "leads" && `${leads.length} leads au total`}
              {vue === "sequences" && `${sequences.length} séquences actives`}
              {vue === "templates" && "Bibliothèque de templates d'emails"}
              {vue === "email-campaigns" && "Campagnes email marketing one-shot"}
              {vue === "blocklist" && "Gestion des emails et domaines bloqués"}
              {vue === "emails" && "Vérification & nettoyage des adresses email"}
              {vue === "factures" && "Commandes, factures & relances VosFactures"}
              {vue === "parametres" && "Configuration Brevo & envoi"}
              {vue === "veille" && "Scraping et veille hôtelière"}
              {vue === "equipe" && "Gestion des utilisateurs et permissions"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Sous-onglets dans le header quand groupe actif */}
            {activeGroup && (
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                {activeGroup.children.map(child => (
                  <button key={child.id} onClick={() => setVue(child.id)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${vue === child.id ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                    {child.label}
                  </button>
                ))}
              </div>
            )}
            {vue === "leads" && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                Scheduler actif
              </div>
            )}
          </div>
        </header>

        <main className="p-4 pb-24 md:p-8 md:pb-8">
          {loading && <div className="flex items-center gap-2 text-sm text-slate-400 mb-4"><span className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin inline-block" /> Chargement...</div>}
          {vue === "dashboard" && <VueDashboard showToast={showToast} />}
          {vue === "dashboard-marketing" && <VueDashboardMarketing showToast={showToast} />}
          {vue === "dashboard-ventes" && <AnalyticsSpreadsheet showToast={showToast} />}
          {vue === "commandes" && <VueCommandes showToast={showToast} readOnly={!canWrite('portail')} />}
          {vue === "partenaires" && <VuePartenaires showToast={showToast} readOnly={!canWrite('portail')} />}
          {vue === "leads" && <VueLeads leads={leads} sequences={sequencesNorm} onAdd={addLead} onLaunch={launchSequence} onRefresh={charger} showToast={showToast} readOnly={!canWrite('leads')} />}
          {vue === "sequences" && <VueSequences sequences={sequencesNorm} onNew={() => { setEditSeq(null); setShowSeqEditor(true); }} onEdit={seq => { setEditSeq(seq); setShowSeqEditor(true); }} onRefresh={charger} showToast={showToast} readOnly={!canWrite('campagnes')} />}
          {vue === "templates" && <VueTemplates showToast={showToast} readOnly={!canWrite('campagnes')} />}
          {vue === "email-campaigns" && <VueCampagnes showToast={showToast} readOnly={!canWrite('campagnes')} />}
          {vue === "factures" && <VueFactures showToast={showToast} readOnly={!canWrite('factures')} />}
          {vue === "blocklist" && <VueBlocklist onRefresh={charger} showToast={showToast} readOnly={!canWrite('config')} />}
          {vue === "emails" && <VueValidationEmail leads={leads} sequences={sequences} onRefresh={charger} showToast={showToast} readOnly={!canWrite('emails')} />}
          {vue === "parametres" && <VueParametres readOnly={!canWrite('config')} />}
          {vue === "veille" && <VueVeille showToast={showToast} />}
          {vue === "equipe" && isAdmin && <VueEquipe showToast={showToast} />}
        </main>
      </div>
    </div>
  );
}

// ─── Montage React ────────────────────────────────────────────────────────────
function renderApp() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(App));
}

window._renderApp = renderApp;
if (window._appReady) renderApp();
