const { useState, useEffect, useRef, useMemo } = React;

// ─── API BACKEND (remplace les données démo) ──────────────────────────────────
const api = window.tdmApi;


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

function relTime(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// ─── MODALS ───────────────────────────────────────────────────────────────────

const ModalAddLead = ({ onClose, onAdd }) => {
  const [form, setForm] = useState({ prenom: "", nom: "", hotel: "", ville: "", email: "", segment: "5*", poste: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Recherche HubSpot
  const [queryCompany, setQueryCompany] = useState("");
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [contactsCompany, setContactsCompany] = useState([]);
  const [searchingHS, setSearchingHS] = useState(false);
  const searchTimer = useRef(null);

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
    setForm(f => ({ ...f, hotel: company.nom, ville: company.ville || f.ville }));
    // Charger les contacts liés
    try {
      const contacts = await api.get(`/hubspot/contacts-company/${company.id}`);
      setContactsCompany(Array.isArray(contacts) ? contacts : []);
    } catch(e) { setContactsCompany([]); }
  };

  const selectionnerContact = (contact) => {
    setForm(f => ({ ...f, prenom: contact.prenom, nom: contact.nom, email: contact.email, poste: contact.poste || "" }));
    setContactsCompany([]);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.email || !form.hotel) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        tags: JSON.stringify([form.segment]),
        company_hubspot_id: selectedCompany?.id || null,
      };
      const lead = await api.post('/leads', payload);
      onAdd(lead);
      onClose();
    } catch(e) { setErr("Erreur lors de l'ajout"); }
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
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
              <p className="text-xs font-medium text-orange-700 mb-2">Contacts existants — cliquer pour pré-remplir</p>
              <div className="space-y-1">
                {contactsCompany.map(c => (
                  <button key={c.hubspot_id} onClick={() => selectionnerContact(c)}
                    className="w-full text-left px-3 py-2 bg-white rounded-lg hover:bg-orange-50 transition-colors border border-orange-100">
                    <span className="text-sm font-medium text-slate-800">{c.prenom} {c.nom}</span>
                    <span className="text-xs text-slate-400 ml-2">{c.email}</span>
                    {c.poste && <span className="text-xs text-slate-400 ml-1">· {c.poste}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-400 mb-3">Ou remplir manuellement</p>
            <div className="grid grid-cols-2 gap-3">
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
            <div className="mt-3">
              <label className="text-xs font-medium text-slate-500 mb-1 block">Segment</label>
              <select value={form.segment} onChange={e => set("segment", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                {["5*","4*","Boutique","Retail","SPA","Concept Store"].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3 flex-shrink-0 border-t border-slate-100">
          {err && <span className="text-xs text-red-500 mr-auto">{err}</span>}
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">{saving ? "Ajout..." : "Ajouter"}</button>
        </div>
      </div>
    </div>
  );
};

const ModalLaunchSequence = ({ lead, sequences, onClose, onLaunch }) => {
  const [selected, setSelected] = useState(sequences[0]?.id);
  const [status, setStatus] = useState(null); // null | "loading" | "done" | "error"
  const [errMsg, setErrMsg] = useState("");

  const handleLaunch = async (sendNow) => {
    if (!selected) return;
    setStatus("loading");
    try {
      // 1. Inscrire le lead à la séquence
      await onLaunch(lead.id, selected);
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Lancer une séquence</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-sm text-slate-500 mb-4">Pour <span className="font-medium text-slate-800">{lead.prenom} {lead.nom}</span> — {lead.hotel}</p>
          <div className="space-y-2">
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
          {status === "done" && <p className="mt-3 text-xs text-emerald-600 font-medium">✓ Séquence lancée ! Email en cours d'envoi...</p>}
          {status === "error" && <p className="mt-3 text-xs text-red-500">✗ {errMsg}</p>}
        </div>
        <div className="px-6 py-4 bg-slate-50 flex flex-col gap-2 flex-shrink-0 border-t border-slate-100">
          <button
            disabled={status === "loading" || status === "done"}
            onClick={() => handleLaunch(true)}
            className="w-full py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {status === "loading" ? "⏳ Envoi en cours..." : "⚡ Envoyer le 1er email maintenant"}
          </button>
          <button
            disabled={status === "loading" || status === "done"}
            onClick={() => handleLaunch(false)}
            className="w-full py-2.5 text-sm font-medium bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            📅 Lancer la séquence (prochain créneau)
          </button>
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 text-center pt-1">Annuler</button>
        </div>
      </div>
    </div>
  );
};

// ─── Signature Hugo ─────────────────────────────────────────────────────────
// Texte pur : aucune image CDN (bloquées par Gmail/Outlook par défaut)
const SIGNATURE_HTML = `<br>
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
    📅 Prendre rendez-vous
  </a>
</td></tr>
</table>
`;
// Données de démo pour la prévisualisation
const DEMO_LEAD_PREVIEW = { prenom: "Sophie", nom: "Lefebvre", hotel: "Hôtel Le Bristol", ville: "Paris", segment: "5*" };

function substituerVarsPreview(texte, lead = DEMO_LEAD_PREVIEW) {
  return texte
    .replace(/\{\{prenom\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${lead.prenom}</span>`)
    .replace(/\{\{nom\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${lead.nom}</span>`)
    .replace(/\{\{hotel\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${lead.hotel}</span>`)
    .replace(/\{\{ville\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${lead.ville}</span>`)
    .replace(/\{\{segment\}\}/gi, `<span style="background:#fef9c3;padding:0 2px">${lead.segment}</span>`);
}

function texteVersHtmlPreview(texte) {
  return texte
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1a56db">$1</a>');
}

const ModalEmailEditor = ({ seq, onClose, onSave }) => {
  const [etapes, setEtapes] = useState(seq ? [...seq.etapes] : [{ jour: 0, sujet: "", corps: "" }]);
  const [nom, setNom] = useState(seq?.nom || "");
  const [segment, setSegment] = useState(seq?.segment || "5*");
  const [desabonnement, setDesabonnement] = useState(seq?.options?.desabonnement !== false);
  const [activeEtape, setActiveEtape] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [mode, setMode] = useState("edit"); // "edit" | "preview"
  const editorRef = useRef(null);
  const objetRef = useRef(null);
  const colorInputRef = useRef(null);
  const pjRef = useRef(null);
  const [pieceJointe, setPieceJointe] = useState(etapes[0]?.piece_jointe || null);

  // Sync pj dans l'étape courante
  const setPjEtape = (pj) => {
    setPieceJointe(pj);
    updateEtape(activeEtape, "piece_jointe", pj);
  };

  const chargerPj = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setPjEtape({ nom: file.name, taille: file.size, type: file.type, data: e.target.result.split(",")[1] });
    };
    reader.readAsDataURL(file);
  };

  const addEtape = () => {
    const lastJour = etapes[etapes.length - 1]?.jour ?? etapes[etapes.length - 1]?.jour_delai ?? 0;
    const nextJour = lastJour + 7;
    setEtapes(e => [...e, { jour: nextJour, jour_delai: nextJour, sujet: "", corps: "" }]);
  };
  const removeEtape = (i) => { if (etapes.length > 1) { setEtapes(e => e.filter((_, idx) => idx !== i)); setActiveEtape(Math.max(0, i-1)); }};
  const updateEtape = (i, k, v) => setEtapes(e => e.map((et, idx) => {
    if (idx !== i) return et;
    // Garder jour et jour_delai en sync (DB stocke jour_delai, UI utilise jour)
    const extra = k === 'jour' ? { jour_delai: v } : k === 'jour_delai' ? { jour: v } : {};
    return { ...et, [k]: v, ...extra };
  }));

  // Toolbar de mise en forme
  const fmt = (cmd, val) => { editorRef.current?.focus(); document.execCommand(cmd, false, val); syncCorps(); };
  const syncCorps = () => {
    if (editorRef.current) updateEtape(activeEtape, "corps_html", editorRef.current.innerHTML);
  };

  // Initialiser le contenu de l'éditeur quand on change d'étape
  useEffect(() => {
    if (editorRef.current && mode === "edit") {
      // Forcer <br> au lieu de <p> pour les retours à la ligne
      try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch {}
      const etape = etapes[activeEtape];
      editorRef.current.innerHTML = etape?.corps_html || (etape?.corps ? texteVersHtmlPreview(etape.corps) : "");
    }
  }, [activeEtape, mode]);

  // Insérer une variable à la position du curseur
  const insererVar = (v) => {
    editorRef.current?.focus();
    document.execCommand("insertText", false, v);
    syncCorps();
  };

  const handleSave = async () => {
    if (!nom.trim()) { setErrMsg("Donnez un nom à la séquence"); return; }
    if (etapes.length === 0) { setErrMsg("Ajoutez au moins un email"); return; }
    setSaving(true); setErrMsg("");
    try {
      const etapesFinales = etapes.map(e => ({
        ...e,
        jour_delai: e.jour_delai ?? e.jour ?? 0, // assurer les deux formes présentes
        corps: e.corps_html || e.corps || "",
      }));
      await onSave({ id: seq?.id || null, nom, segment, etapes: etapesFinales, leadsActifs: seq?.leadsActifs || 0, options: { desabonnement } });
      onClose();
    } catch(e) { setErrMsg("Erreur : " + (e.message || "impossible de sauvegarder")); }
    setSaving(false);
  };

  const etapeCourante = etapes[activeEtape] || {};
  // Retirer la signature du corps pour la preview (on l'affiche séparément)
  const corpsHtmlBrut = etapeCourante.corps_html || texteVersHtmlPreview(etapeCourante.corps || "");
  const corpsPreview = corpsHtmlBrut;

  const VARS = ["{{prenom}}", "{{hotel}}", "{{ville}}", "{{segment}}"];
  const TOOLBAR = [
    { cmd: "bold", label: "B", style: "font-bold" },
    { cmd: "italic", label: "I", style: "italic" },
    { cmd: "underline", label: "U", style: "underline" },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] md:max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-4 flex-shrink-0">
          <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom de la séquence..." className="flex-1 text-base font-semibold text-slate-900 focus:outline-none bg-transparent placeholder-slate-300" />
          <select value={segment} onChange={e => setSegment(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 focus:outline-none">
            {["5*","4*","Boutique","Retail","SPA","Concept Store"].map(s => <option key={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={desabonnement} onChange={e => setDesabonnement(e.target.checked)} className="rounded" />
            Lien désabonnement
          </label>
          {/* Tabs edit/preview */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setMode("edit")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === "edit" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>✏️ Éditer</button>
            <button onClick={() => setMode("preview")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${mode === "preview" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>👁 Préview</button>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Sidebar étapes */}
          <div className="md:w-44 border-b md:border-b-0 md:border-r border-slate-100 p-2 md:p-3 flex md:flex-col gap-1 flex-shrink-0 overflow-x-auto md:overflow-y-auto bg-slate-50/50">
            {etapes.map((e, i) => (
              <div key={i} className={`group flex items-center rounded-lg transition-colors ${activeEtape === i ? "bg-slate-900" : "hover:bg-slate-100"}`}>
                <button onClick={() => { syncCorps(); setActiveEtape(i); }} className="flex-1 text-left px-3 py-2.5">
                  <div className={`font-medium text-sm ${activeEtape === i ? "text-white" : "text-slate-700"}`}>Email {i + 1}</div>
                  <div className={`text-xs ${activeEtape === i ? "text-slate-300" : "text-slate-400"}`}>J+{e.jour || 0}</div>
                </button>
                {etapes.length > 1 && (
                  <button onClick={() => removeEtape(i)} className={`pr-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs ${activeEtape === i ? "text-slate-400 hover:text-red-300" : "text-slate-400 hover:text-red-500"}`}>✕</button>
                )}
              </div>
            ))}
            <button onClick={() => { syncCorps(); addEtape(); }} className="w-full px-3 py-2.5 rounded-lg text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors border border-dashed border-slate-200 mt-1 text-center">
              + Email
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
                      placeholder="Ex: Découvrez Terre de Mars — {{hotel}}"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                    />
                    <div className="flex gap-1 mt-1.5">
                      {VARS.map(v => (
                        <button key={v} type="button" onClick={() => {
                          const input = objetRef.current;
                          if (!input) return;
                          const pos = input.selectionStart;
                          const val = etapeCourante.sujet || "";
                          updateEtape(activeEtape, "sujet", val.slice(0, pos) + v + val.slice(pos));
                          setTimeout(() => input.setSelectionRange(pos + v.length, pos + v.length), 0);
                        }} className="px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs rounded font-mono transition-colors border border-amber-200">{v}</button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Toolbar */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-slate-50 border-b border-slate-200">
                    {/* Police et taille */}
                    <select onChange={e => { if (e.target.value) fmt("fontName", e.target.value); }} defaultValue="" className="h-7 text-xs border border-slate-200 rounded px-1 bg-white text-slate-600 focus:outline-none">
                      <option value="" disabled>Police</option>
                      <option value="Arial, sans-serif">Arial</option>
                      <option value="Helvetica, Arial, sans-serif">Helvetica</option>
                      <option value="Georgia, serif">Georgia</option>
                      <option value="Times New Roman, serif">Times</option>
                      <option value="Verdana, sans-serif">Verdana</option>
                      <option value="Trebuchet MS, sans-serif">Trebuchet</option>
                      <option value="Courier New, monospace">Courier</option>
                    </select>
                    <select onChange={e => { if (e.target.value) fmt("fontSize", e.target.value); }} defaultValue="" className="h-7 text-xs border border-slate-200 rounded px-1 bg-white text-slate-600 focus:outline-none w-14">
                      <option value="" disabled>Taille</option>
                      <option value="1">Petit</option>
                      <option value="2">Normal</option>
                      <option value="3">Moyen</option>
                      <option value="4">Grand</option>
                      <option value="5">Très grand</option>
                    </select>
                    <div className="w-px h-4 bg-slate-200 mx-0.5" />
                    {/* Formatage texte */}
                    {TOOLBAR.map(t => (
                      <button key={t.cmd} title={t.cmd} onMouseDown={e => { e.preventDefault(); fmt(t.cmd); }} className={`w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-slate-200 text-slate-600 ${t.style}`}>{t.label}</button>
                    ))}
                    <div className="w-px h-4 bg-slate-200 mx-0.5" />
                    {/* Listes */}
                    <button title="Liste à puces" onMouseDown={e => { e.preventDefault(); fmt("insertUnorderedList"); }} className="w-7 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-500 text-xs font-bold">• —</button>
                    <button title="Liste numérotée" onMouseDown={e => { e.preventDefault(); fmt("insertOrderedList"); }} className="w-7 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-500 text-xs font-bold">1.</button>
                    <div className="w-px h-4 bg-slate-200 mx-0.5" />
                    {/* Lien hypertexte */}
                    <button title="Ajouter un lien" onMouseDown={e => {
                      e.preventDefault();
                      const sel = window.getSelection();
                      const texteSelec = sel?.toString();
                      const url = prompt("URL du lien :", "https://");
                      if (!url) return;
                      if (texteSelec) {
                        // Remplacer la sélection par un lien souligné
                        document.execCommand("insertHTML", false, `<a href="${url}" style="color:#1a56db;text-decoration:underline">${texteSelec}</a>`);
                      } else {
                        const label = prompt("Texte du lien :", url) || url;
                        document.execCommand("insertHTML", false, `<a href="${url}" style="color:#1a56db;text-decoration:underline">${label}</a>`);
                      }
                      syncCorps();
                    }} className="px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-500 text-xs gap-1">
                      🔗 <span className="text-slate-400">Lien</span>
                    </button>
                    {/* Couleur du texte */}
                    <div className="relative flex items-center">
                      <button title="Couleur du texte" onMouseDown={e => { e.preventDefault(); colorInputRef.current?.click(); }} className="w-7 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-500 text-sm relative">
                        <span style={{ borderBottom: "3px solid #e11d48" }}>A</span>
                      </button>
                      <input ref={colorInputRef} type="color" defaultValue="#e11d48"
                        onChange={e => { editorRef.current?.focus(); document.execCommand("foreColor", false, e.target.value); syncCorps(); }}
                        className="absolute opacity-0 w-0 h-0 pointer-events-none"
                      />
                    </div>
                    <div className="w-px h-4 bg-slate-200 mx-0.5" />
                    {/* Variables corps */}
                    <span className="text-xs text-slate-400">Var :</span>
                    {VARS.map(v => (
                      <button key={v} onMouseDown={e => { e.preventDefault(); insererVar(v); }} className="px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs rounded font-mono transition-colors border border-amber-200">{v}</button>
                    ))}
                  </div>
                  {/* Éditeur contentEditable */}
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={syncCorps}
                    className="min-h-48 p-4 text-sm text-slate-800 focus:outline-none leading-relaxed"
                    style={{ fontFamily: "Arial, sans-serif" }}
                  />
                  {/* Pièce jointe */}
                  <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50">
                    {etapeCourante.piece_jointe ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs">📎</span>
                        <span className="text-xs font-medium text-slate-700">{etapeCourante.piece_jointe.nom}</span>
                        <span className="text-xs text-slate-400">({Math.round(etapeCourante.piece_jointe.taille / 1024)} ko)</span>
                        <button onClick={() => setPjEtape(null)} className="ml-auto text-xs text-red-400 hover:text-red-600">✕ Supprimer</button>
                      </div>
                    ) : (
                      <button onClick={() => pjRef.current?.click()} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors">
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
                    <div dangerouslySetInnerHTML={{ __html: SIGNATURE_HTML }} style={{ pointerEvents: "none", opacity: 0.7 }} />
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
                    <div className="mt-4 pt-4 border-t border-slate-100" dangerouslySetInnerHTML={{ __html: SIGNATURE_HTML }} />
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-3 text-center">Les variables surlignées en jaune seront remplacées par les vraies données du lead</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-slate-400">{etapes.length} email{etapes.length > 1 ? "s" : ""} · Signature Hugo incluse automatiquement</div>
          <div className="flex items-center gap-3">
            {errMsg && <span className="text-xs text-red-500">{errMsg}</span>}
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Annuler</button>
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">
              {saving ? "Sauvegarde..." : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── VUES ─────────────────────────────────────────────────────────────────────

const VueDashboard = ({ leads, activites, stats }) => {
  const kpis = stats?.kpis || {};
  const envoyes = kpis.emailsEnvoyes || 0;
  const tOuverture = kpis.tOuverture || 0;
  const tClic = kpis.tClic || 0;
  const tReponse = kpis.tReponse || 0;
  const convertis = kpis.convertis || 0;
  const leadsActifs = kpis.leadsActifs || 0;
  const chauds = stats?.leadsChauds || leads.filter(l => (l.total_ouvertures >= 3 || l.score >= 80) && l.statut === "En séquence");
  const perf7j = stats?.performance7j || [];
  const statsSeq = stats?.statsSequences || [];
  const maxEnvoyes = Math.max(...perf7j.map(d => d.envoyes || 0), 1);

  const actRecentes = stats?.activitesRecentes || activites || [];
  const ICONS = { ouverture: "👁", clic: "🔗", envoi: "📧", réponse: "💬", désabonnement: "🚫", bounce: "⚠️" };

  return (
    <div className="space-y-5">
      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Emails envoyés", value: envoyes, icon: "📧", color: "text-slate-800" },
          { label: "Taux ouverture", value: tOuverture + "%", icon: "👁", color: tOuverture >= 40 ? "text-emerald-600" : tOuverture >= 20 ? "text-amber-600" : "text-red-500" },
          { label: "Taux de clic", value: tClic + "%", icon: "🔗", color: "text-blue-600" },
          { label: "Taux de réponse", value: tReponse + "%", icon: "💬", color: tReponse >= 8 ? "text-emerald-600" : "text-amber-600" },
          { label: "En séquence", value: leadsActifs, icon: "⚡", color: "text-purple-600" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 p-4">
            <div className="text-xs text-slate-400 mb-1">{label}</div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-lg mt-1">{icon}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Courbe 7j ── */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Performance 7 derniers jours</h3>
          {perf7j.length === 0 ? (
            <div className="flex items-end justify-center gap-1 h-24 text-xs text-slate-300">Aucune donnée</div>
          ) : (
            <>
              <div className="flex items-end gap-2 h-24">
                {perf7j.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex flex-col justify-end gap-0.5" style={{height:"80px"}}>
                      <div className="w-full bg-slate-100 rounded-sm" style={{height: Math.max(2, (d.envoyes/maxEnvoyes)*70)+"px"}} title={`${d.envoyes} envoyés`} />
                      <div className="w-full bg-blue-400 rounded-sm" style={{height: Math.max(d.ouverts?2:0, ((d.ouverts||0)/maxEnvoyes)*70)+"px"}} title={`${d.ouverts||0} ouverts`} />
                    </div>
                    <span className="text-xs text-slate-400">{d.jour?.slice(5)}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-slate-400">
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-slate-200 rounded-sm inline-block"/>Envoyés</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-400 rounded-sm inline-block"/>Ouverts</span>
              </div>
            </>
          )}
        </div>

        {/* ── Activité récente ── */}
        <div className="bg-white rounded-xl border border-slate-100 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Activité récente</h3>
          <div className="space-y-2.5">
            {actRecentes.slice(0, 8).map((a, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-sm leading-none mt-0.5 flex-shrink-0">{ICONS[a.type] || "📌"}</span>
                <div className="min-w-0">
                  <p className="text-xs text-slate-700 leading-snug truncate">
                    <span className="font-medium">{a.prenom} {a.nom}</span>
                    {a.type === "ouverture" && " a ouvert"}
                    {a.type === "clic" && " a cliqué"}
                    {a.type === "envoi" && " — email envoyé"}
                    {a.type === "réponse" && " a répondu ✨"}
                    {a.type === "désabonnement" && " s'est désabonné"}
                  </p>
                  {a.sujet && <p className="text-xs text-slate-400 truncate italic">{a.sujet}</p>}
                  <p className="text-xs text-slate-300">{relTime(a.created_at)}</p>
                </div>
              </div>
            ))}
            {actRecentes.length === 0 && <p className="text-xs text-slate-300 italic">Aucune activité</p>}
          </div>
        </div>
      </div>

      {/* ── Performance par séquence ── */}
      {statsSeq.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Performance par séquence</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 text-xs text-slate-400 uppercase">
                <th className="text-left py-2 pr-4">Séquence</th>
                <th className="text-right py-2 px-3">Leads</th>
                <th className="text-right py-2 px-3">Emails</th>
                <th className="text-right py-2 px-3">Ouverture</th>
                <th className="text-right py-2 px-3">Actifs</th>
              </tr></thead>
              <tbody>
                {statsSeq.map((s, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-2 pr-4 font-medium text-slate-800">{s.nom}</td>
                    <td className="py-2 px-3 text-right text-slate-600">{s.total_leads}</td>
                    <td className="py-2 px-3 text-right text-slate-600">{s.emails_envoyes}</td>
                    <td className="py-2 px-3 text-right">
                      <span className={`font-semibold ${(s.taux_ouverture||0) >= 40 ? "text-emerald-600" : (s.taux_ouverture||0) >= 20 ? "text-amber-600" : "text-slate-400"}`}>
                        {Math.round(s.taux_ouverture||0)}%
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-blue-600 font-medium">{s.leads_actifs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Leads chauds ── */}
      {chauds.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span>🔥</span>
            <h3 className="text-sm font-semibold text-amber-800">Leads chauds — à relancer maintenant</h3>
            <span className="ml-auto text-xs text-amber-600 font-medium">{chauds.length} lead{chauds.length > 1 ? "s" : ""}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {chauds.slice(0, 8).map(l => (
              <div key={l.id} className="bg-white rounded-lg p-3 border border-amber-100 shadow-sm">
                <div className="font-medium text-slate-800 text-sm">{l.prenom} {l.nom}</div>
                <div className="text-xs text-slate-500 truncate">{l.hotel}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-xs text-amber-600">👁 {l.total_ouvertures} ouv.</span>
                  <span className="text-xs text-slate-400">Score {l.score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Modal édition lead ────────────────────────────────────────────────────
const ModalEditLead = ({ lead, onClose, onSave }) => {
  const [form, setForm] = useState({ prenom: lead.prenom||"", nom: lead.nom||"", email: lead.email||"", hotel: lead.hotel||"", ville: lead.ville||"", segment: lead.segment||"5*", statut: lead.statut||"Nouveau", poste: lead.poste||"" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-900">Modifier le lead</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 space-y-3 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            {[["Prénom","prenom"],["Nom","nom"]].map(([l,k]) => (
              <div key={k}><label className="text-xs text-slate-500 mb-1 block">{l}</label>
              <input value={form[k]} onChange={e => set(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" /></div>
            ))}
          </div>
          {[["Email","email"],["Établissement","hotel"],["Ville","ville"],["Poste / Fonction","poste"]].map(([l,k]) => (
            <div key={k}><label className="text-xs text-slate-500 mb-1 block">{l}</label>
            <input value={form[k]} onChange={e => set(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" /></div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">Segment</label>
            <select value={form.segment} onChange={e => set("segment", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              {["5*","4*","Boutique","Retail","SPA","Concept Store"].map(s => <option key={s}>{s}</option>)}
            </select></div>
            <div><label className="text-xs text-slate-500 mb-1 block">Statut</label>
            <select value={form.statut} onChange={e => set("statut", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              {Object.keys(STATUT_CONFIG).map(s => <option key={s}>{s}</option>)}
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
  const [selected, setSelected] = useState(sequences[0]?.id);
  const [status, setStatus] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const handleLaunch = async (sendNow) => {
    if (!selected) return;
    setStatus("loading");
    try {
      await onLaunch(selected, sendNow);
      setStatus("done");
      setTimeout(() => onClose(), 1200);
    } catch(e) { setStatus("error"); setErrMsg(e.message || "Erreur"); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Lancer une séquence</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <p className="text-sm text-slate-500 mb-4"><span className="font-semibold text-slate-800">{count} leads</span> seront inscrits à la séquence sélectionnée.</p>
          <div className="space-y-2">
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
          {status === "done" && <p className="mt-3 text-xs text-emerald-600 font-medium">✓ Séquence lancée pour {count} leads !</p>}
          {status === "error" && <p className="mt-3 text-xs text-red-500">✗ {errMsg}</p>}
        </div>
        <div className="px-6 py-4 bg-slate-50 flex flex-col gap-2 flex-shrink-0 border-t border-slate-100">
          <button disabled={status === "loading" || status === "done"} onClick={() => handleLaunch(true)} className="w-full py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">⚡ Envoyer le 1er email maintenant</button>
          <button disabled={status === "loading" || status === "done"} onClick={() => handleLaunch(false)} className="w-full py-2.5 text-sm font-medium bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 disabled:opacity-50">📅 Lancer (prochain créneau)</button>
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 text-center pt-1">Annuler</button>
        </div>
      </div>
    </div>
  );
};

const VueLeads = ({ leads, sequences, onAdd, onLaunch, onRefresh, showToast }) => {
  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState("Tous");
  const [filterSegment, setFilterSegment] = useState("Tous");
  const [filterVille, setFilterVille] = useState("Tous");
  const [sortBy, setSortBy] = useState("recent"); // "recent"|"score"|"nom"
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
  const [detailData, setDetailData] = useState(null);     // détail complet lead (emails + events)
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState('timeline'); // 'timeline' | 'emails' | 'hubspot'
  const csvRef = useRef(null);

  const leadsNorm = leads.map(l => ({
    ...l,
    tags: typeof l.tags === "string" ? (() => { try { return JSON.parse(l.tags || "[]"); } catch(e) { return []; } })() : (l.tags || []),
    ouvertures: l.total_ouvertures || l.ouvertures || 0,
    score: l.score || 50,
    sequence: l.sequence_active || l.sequence || "",
    etape: l.etape_courante || l.etape || 0,
    statut: l.statut || "Nouveau",
  }));

  const villes = ["Tous", ...Array.from(new Set(leadsNorm.map(l => l.ville).filter(Boolean))).sort()];
  const segments = ["Tous", ...Array.from(new Set(leadsNorm.map(l => l.segment).filter(Boolean))).sort()];
  const statuts = ["Tous", ...Object.keys(STATUT_CONFIG)];

  const filtered = leadsNorm.filter(l => {
    const matchSearch = `${l.prenom} ${l.nom} ${l.hotel} ${l.ville} ${l.email}`.toLowerCase().includes(search.toLowerCase());
    const matchStatut = filterStatut === "Tous" || l.statut === filterStatut;
    const matchSegment = filterSegment === "Tous" || l.segment === filterSegment;
    const matchVille = filterVille === "Tous" || l.ville === filterVille;
    return matchSearch && matchStatut && matchSegment && matchVille;
  }).sort((a, b) => {
    if (sortBy === "score") return (b.score||0) - (a.score||0);
    if (sortBy === "nom") return `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`);
    return 0; // recent = ordre API
  });

  const KANBAN_COLS = ["Nouveau", "En séquence", "Répondu", "Converti", "Désabonné"];

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
      };
    }).filter(l => l.email && l.hotel);
    try {
      const r = await api.post("/leads/import", { leads: toImport });
      setImportStatus(`✓ ${r.crees} importés`);
      if (onRefresh) onRefresh();
    } catch(e) { setImportStatus("✗ Erreur"); }
    setTimeout(() => setImportStatus(null), 4000);
    if (csvRef.current) csvRef.current.value = "";
  };

  // ── Actions lead ────────────────────────────────────────────────────────
  const supprimerLead = async (lead, e) => {
    if (e) e.stopPropagation();
    if (!confirm(`Supprimer ${lead.prenom} ${lead.nom} (${lead.hotel}) ?`)) return;
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
    await api.patch(`/leads/${lead.id}`, { statut });
    if (onRefresh) onRefresh();
  };

  // ── HubSpot détails ─────────────────────────────────────────────────────
  const chargerHubspot = async (lead) => {
    if (!lead.hubspot_id) return;
    setLoadingHs(true); setHsDetails(null);
    try {
      const [deals, notes] = await Promise.all([
        api.get(`/hubspot/deals/${lead.hubspot_id}`).catch(() => ({ deals: [] })),
        api.get(`/hubspot/notes/${lead.hubspot_id}`).catch(() => ({ notes: [] })),
      ]);
      setHsDetails({
        deals: deals.deals || deals || [],
        notes: notes.notes || notes || [],
      });
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
      {showAdd && <ModalAddLead onClose={() => setShowAdd(false)} onAdd={(l) => { onAdd(l); if(onRefresh) onRefresh(); }} />}
      {showLaunch && <ModalLaunchSequence lead={showLaunch} sequences={sequences} onClose={() => setShowLaunch(null)} onLaunch={onLaunch} />}
      {showBulkLaunch && <ModalBulkLaunch count={selectedIds.size} sequences={sequences} onClose={() => setShowBulkLaunch(false)} onLaunch={async (seqId, sendNow) => {
        const ids = Array.from(selectedIds);
        await api.post('/sequences/' + seqId + '/inscrire-batch', { lead_ids: ids });
        if (sendNow) await api.post('/sequences/trigger-now', { lead_ids: ids }).catch(() => {});
        setSelectedIds(new Set());
        if (onRefresh) onRefresh();
      }} />}
      {editLead && <ModalEditLead lead={editLead} onClose={() => setEditLead(null)} onSave={() => { setEditLead(null); if(onRefresh) onRefresh(); }} />}

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
          <div className="relative group">
            <button onClick={() => csvRef.current?.click()} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 whitespace-nowrap">
              {importStatus || "📥 Import CSV"}
            </button>
            <div className="absolute left-0 top-full mt-1 z-20 hidden group-hover:block w-72 bg-slate-900 text-white text-xs rounded-xl p-3 shadow-xl">
              <div className="font-semibold mb-1.5">Format CSV attendu</div>
              <div className="font-mono text-slate-300 text-xs leading-relaxed">prenom,nom,email,hotel,ville,segment</div>
              <div className="font-mono text-slate-400 text-xs mt-1">Hugo,Montiel,hugo@hotel.com,Le Bristol,Paris,5*</div>
              <div className="mt-2 text-slate-400">Séparateur <span className="text-white">,</span> ou <span className="text-white">;</span> · Encoding UTF-8</div>
              <div className="mt-1 text-slate-400">Segments : 5*, 4*, Boutique, Retail, SPA, Concept Store</div>
            </div>
          </div>
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={e => importerCSV(e.target.files?.[0])} />
          <button onClick={async () => {
            const r = await api.post("/hubspot/sync-all", {}).catch(() => null);
            if (r && onRefresh) onRefresh();
          }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 whitespace-nowrap">
            🔄 Sync HS
          </button>
          <button onClick={async () => {
            setTriggerStatus("sending");
            try { const r = await api.post("/sequences/trigger-now", {}); setTriggerStatus(r.erreur ? "error" : "done"); }
            catch(e) { setTriggerStatus("error"); }
            setTimeout(() => setTriggerStatus(null), 3000);
          }} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${triggerStatus === "sending" ? "bg-amber-50 border-amber-300 text-amber-700" : triggerStatus === "done" ? "bg-emerald-50 border-emerald-300 text-emerald-700" : triggerStatus === "error" ? "bg-red-50 border-red-300 text-red-600" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"}`}>
            {triggerStatus === "sending" ? "⟳ Envoi..." : triggerStatus === "done" ? "✓ Envoyé" : triggerStatus === "error" ? "✗ Erreur" : "⚡ Envoyer"}
          </button>
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
            <button onClick={async () => { if(!confirm('Supprimer ' + selectedIds.size + ' leads ?')) return; for(const id of selectedIds) await api.delete('/leads/' + id).catch(()=>{}); setSelectedIds(new Set()); if(onRefresh) onRefresh(); }} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600">✕ Supprimer</button>
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
                    <div className="text-xs text-slate-400 truncate">{lead.hotel} · {[lead.ville, lead.segment].filter(Boolean).join(" · ")}</div>
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
                    {lead.statut !== "Désabonné" && <button onClick={() => setShowLaunch(lead)} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xs bg-blue-600 text-white rounded-lg">▶</button>}
                    <button onClick={() => setEditLead(lead)} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xs border border-slate-200 text-slate-500 rounded-lg">✏️</button>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Aucun lead trouvé</div>}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60">
                <th className="px-3 py-3 w-8">
                  <input type="checkbox" className="rounded accent-blue-600" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={e => setSelectedIds(e.target.checked ? new Set(filtered.map(l => l.id)) : new Set())} />
                </th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Contact</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Établissement</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Séquence</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Engagement</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Statut</th>
                <th className="px-3 py-3 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, i) => {
                const cfg = STATUT_CONFIG[lead.statut] || STATUT_CONFIG["Nouveau"];
                return (
                <tr key={lead.id} className={`group border-b border-slate-50 border-l-2 transition-colors cursor-pointer ${selectedLead?.id === lead.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200 border-l-indigo-400" : selectedIds.has(lead.id) ? "bg-slate-100 border-l-transparent" : "hover:bg-slate-50/80 border-l-transparent hover:border-l-blue-400"} ${i === filtered.length-1 ? "border-b-0" : ""}`} onClick={() => ouvrirDetail(lead)}>
                  <td className="px-3 py-3 w-8" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="rounded accent-blue-600" checked={selectedIds.has(lead.id)} onChange={e => { const s = new Set(selectedIds); e.target.checked ? s.add(lead.id) : s.delete(lead.id); setSelectedIds(s); }} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${cfg.bg} ${cfg.text}`}>
                        {lead.prenom?.[0]}{lead.nom?.[0]}
                      </div>
                      <div>
                        <div className="font-medium text-slate-800 text-sm leading-tight">{lead.prenom} {lead.nom}
                          {lead.hubspot_id && <span title="Synchronisé HubSpot" className="ml-1 text-orange-300 text-xs">⬡</span>}
                        </div>
                        <div className="text-xs text-slate-400 leading-tight">{lead.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-sm text-slate-700 font-medium leading-tight">{lead.hotel}</div>
                    <div className="text-xs text-slate-400 leading-tight">{[lead.ville, lead.segment].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 py-3">
                    {lead.sequence
                      ? <div>
                          <span className="text-xs bg-blue-50 text-blue-600 font-medium px-2 py-0.5 rounded-full">Étape {(lead.etape||0)+1}</span>
                          <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[120px]">{lead.sequence}</div>
                        </div>
                      : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 w-28">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${lead.score >= 80 ? "bg-emerald-500" : lead.score >= 50 ? "bg-amber-400" : "bg-slate-300"}`} style={{width: lead.score + "%"}} />
                      </div>
                      <span className="text-xs font-medium text-slate-500 w-7 text-right">{lead.score}</span>
                    </div>
                    {lead.ouvertures > 0 && <div className="text-xs text-slate-400 mt-0.5">👁 {lead.ouvertures}</div>}
                  </td>
                  <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                    <select value={lead.statut} onChange={e => changerStatut(lead, e.target.value)}
                      className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none ${cfg.bg} ${cfg.text}`}>
                      {Object.keys(STATUT_CONFIG).map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                      {lead.statut !== "Désabonné" && (
                        <button onClick={() => setShowLaunch(lead)} title="Lancer séquence" className="px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap">▶</button>
                      )}
                      <button onClick={() => setEditLead(lead)} title="Modifier" className="px-2 py-1 text-xs border border-slate-200 text-slate-500 rounded-md hover:bg-slate-100">✏️</button>
                      <button onClick={(e) => supprimerLead(lead, e)} title="Supprimer" className="px-2 py-1 text-xs border border-red-100 text-red-400 rounded-md hover:bg-red-50">✕</button>
                    </div>
                  </td>
                </tr>
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

      {/* ── DETAIL LEAD ── */}
      {selectedLead && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">

          {/* ── Header ── */}
          <div className="flex flex-col md:flex-row md:items-start justify-between p-4 md:p-5 border-b border-slate-100 gap-3">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-base font-semibold text-slate-900">{selectedLead.prenom} {selectedLead.nom}</h3>
                <Badge statut={selectedLead.statut} />
                {selectedLead.hubspot_id && (
                  <a href={`https://app.hubspot.com/contacts/26199813/contact/${selectedLead.hubspot_id}`}
                    target="_blank"
                    className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full hover:bg-orange-100">
                    HubSpot ↗
                  </a>
                )}
              </div>
              <p className="text-sm text-slate-500 mt-0.5">{selectedLead.hotel} · {selectedLead.ville} · {selectedLead.segment}</p>
              <p className="text-xs text-slate-400 mt-0.5">{selectedLead.email}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
              <button onClick={() => setEditLead(selectedLead)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">✏️ Éditer</button>
              {selectedLead.sequence_active && (
                <button onClick={async () => {
                  if (!confirm(`Arrêter la séquence "${selectedLead.sequence_active}" pour ce lead ?`)) return;
                  try {
                    await api.post(`/sequences/stop-lead/${selectedLead.id}`);
                    showToast('Séquence arrêtée', 'success');
                    if (onRefresh) onRefresh();
                    setSelectedLead(null);
                  } catch (err) {
                    showToast(err.message || 'Erreur lors de l\'arrêt', 'error');
                  }
                }} className="px-3 py-1.5 text-xs border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-50">⏹️ Arrêter séquence</button>
              )}
              <button onClick={async () => {
                if (!confirm(`Bloquer ${selectedLead.email} et l'ajouter à la blocklist ?`)) return;
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
                          const diff = new Date(iso) - Date.now();
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
                              <span className={`text-xs font-semibold ${prochainEnvoi && new Date(prochainEnvoi) < Date.now() ? 'text-orange-600' : 'text-blue-700'}`}>
                                {prochainEnvoi
                                  ? `📅 ${new Date(prochainEnvoi).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} (${formatCountdown(prochainEnvoi)})`
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
                        return (
                          <div key={i} className="flex items-start gap-2.5 py-1.5 border-b border-slate-50 last:border-0">
                            <span className="text-sm flex-shrink-0 mt-0.5">{ICONS[ev.type] || '📌'}</span>
                            <div className="min-w-0 flex-1">
                              <span className="text-xs text-slate-700 capitalize">{ev.type}</span>
                              {meta?.sujet && <span className="text-xs text-slate-400 block truncate">{meta.sujet}</span>}
                              {meta?.url && <span className="text-xs text-slate-400 block truncate">{meta.url}</span>}
                            </div>
                            <span className="text-xs text-slate-400 flex-shrink-0 whitespace-nowrap">{relTime(ev.created_at)}</span>
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
                                  ? new Date(email.envoye_at).toLocaleDateString('fr-FR', {
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
                                  {new Date(email.premier_ouvert).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </span>
                              {email.dernier_ouvert && email.dernier_ouvert !== email.premier_ouvert && (
                                <span className="text-xs text-slate-400">
                                  Dernière : <span className="text-slate-600">
                                    {new Date(email.dernier_ouvert).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
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
                      <span className="text-xs text-slate-400">Contact #{selectedLead.hubspot_id}</span>
                      <button onClick={() => chargerHubspot(selectedLead)} className="text-xs text-orange-600 hover:underline">↻ Actualiser</button>
                    </div>
                    {loadingHs ? (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="w-3 h-3 border-2 border-slate-200 border-t-orange-400 rounded-full animate-spin" />
                        Chargement HubSpot...
                      </div>
                    ) : hsDetails ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                    ) : (
                      <p className="text-xs text-slate-400">Cliquez ↻ pour charger les données HubSpot</p>
                    )}
                  </div>
                ) : (
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center gap-3 text-center">
                    <p className="text-sm text-slate-400">Non synchronisé avec HubSpot</p>
                    <button onClick={async () => {
                      await api.post(`/hubspot/sync-lead/${selectedLead.id}`);
                      if (onRefresh) onRefresh();
                    }} className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600">
                      Synchroniser maintenant
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
};

const VueSequences = ({ sequences, onNew, onEdit, onRefresh, showToast }) => {
  const [testModal, setTestModal] = useState(null); // seq id
  const [testEmail, setTestEmail] = useState("");
  const [testLoading, setTestLoading] = useState(false);

  const supprimerSequence = async (seq) => {
    if (!confirm(`Supprimer la séquence "${seq.nom}" ? Cette action est irréversible.`)) return;
    try {
      await api.delete(`/sequences/${seq.id}`);
      showToast('Séquence supprimée', 'success');
      if (onRefresh) onRefresh();
    } catch (err) {
      showToast('Erreur: ' + (err.message || 'impossible de supprimer'), 'error');
    }
  };

  const envoyerTest = async (seqId) => {
    if (!testEmail.trim()) return;
    setTestLoading(true);
    const email = testEmail.trim();
    const seq = sequences.find(s => s.id === seqId);
    const nbEtapes = seq?.etapes?.length || 1;
    try {
      // Chercher ou créer le lead
      const search = await api.get(`/leads?search=${encodeURIComponent(email)}`);
      const existing = (Array.isArray(search) ? search : search.leads || []).find(l => l.email === email);
      let leadId;
      if (existing) {
        leadId = existing.id;
      } else {
        const created = await api.post('/leads', { email, prenom: 'Test', nom: 'Séquence', hotel: 'Test', segment: '5*' });
        leadId = created.id || created.lead?.id;
      }
      // Inscrire à la séquence
      await api.post(`/sequences/${seqId}/inscrire`, { lead_id: leadId });
      // Fermer le modal immédiatement
      setTestModal(null);
      setTestEmail("");
      setTestLoading(false);
      showToast(`Test lancé : ${nbEtapes} email(s) vers ${email}`, 'success');
      // Envoyer tous les emails en background avec 20s de délai
      for (let i = 0; i < nbEtapes; i++) {
        try {
          await api.post('/sequences/trigger-now', { lead_ids: [leadId] });
        } catch {}
        if (i < nbEtapes - 1) await new Promise(r => setTimeout(r, 20000));
      }
      return;
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
      {sequences.map(seq => (
        <div key={seq.id} className="bg-white rounded-xl border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <h3 className="text-sm font-semibold text-slate-800 truncate">{seq.nom}</h3>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full flex-shrink-0">{seq.segment}</span>
              <span className="text-xs text-slate-400 flex-shrink-0">{seq.leadsActifs} actifs</span>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => { setTestModal(seq.id); setTestEmail(""); }} className="px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                Tester
              </button>
              <button onClick={() => onEdit(seq)} className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                Modifier
              </button>
              <button onClick={() => supprimerSequence(seq)} className="px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                Supprimer
              </button>
            </div>
          </div>
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
      ))}
    </div>

    {/* Mini-modal test */}
    {testModal && (
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Tester la séquence</h3>
          <p className="text-xs text-slate-500 mb-3">L'email sera envoyé immédiatement à cette adresse.</p>
          <input value={testEmail} onChange={e => setTestEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && envoyerTest(testModal)} placeholder="email@test.com" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" autoFocus />
          <div className="flex justify-end gap-2">
            <button onClick={() => setTestModal(null)} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
            <button onClick={() => envoyerTest(testModal)} disabled={testLoading || !testEmail.trim()} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {testLoading ? "Envoi..." : "Envoyer le test"}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
  );
};

const VueHubspot = () => {
  const [connected, setConnected] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Charger la config au montage
  useEffect(() => {
    api.get('/health').then(h => {
      if (h.hubspot === 'configuré') setConnected(true);
    }).catch(() => {});
    api.get('/config').then(cfg => {
      if (cfg.hubspot_api_key_configured) setConnected(true);
    }).catch(() => {});
  }, []);

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
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Règles d'automatisation actives</h3>
          <div className="space-y-2 text-sm">
            {[
              "Email ouvert 2× → Lifecycle Stage: MQL",
              "Réponse reçue → Lifecycle Stage: SQL + Deal créé",
              "Lead converti → Deal pipeline «Nouveaux Clients»",
              "Désabonnement → Contact bloqué + tag HubSpot",
            ].map(r => (
              <div key={r} className="flex items-center gap-2 text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />{r}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Modal Qualification Lead ──────────────────────────────────────────────────
const ModalQualification = ({ email, onClose, onSuccess, sequences, showToast }) => {
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
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
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
                {["5*","4*","Boutique","Retail","SPA","Concept Store"].map(s => <option key={s}>{s}</option>)}
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
  const [validationHistory, setValidationHistory] = useState([]);

  // Modal qualification
  const [showQualificationModal, setShowQualificationModal] = useState(false);
  const [qualificationEmail, setQualificationEmail] = useState("");

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
    } catch(e) {}
  };

  // Charger config ZeroBounce au montage — via /health (variable Railway)
  useEffect(() => {
    api.get("/health").then(h => {
      if (h.zerobounce === 'configuré') {
        setZbConfigured(true);
        chargerCredits();
      }
    }).catch(() => {});
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
    </div>
  );
};

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
  const [includeShipping, setIncludeShipping] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [logGSheets, setLogGSheets] = useState(true);
  const [calculation, setCalculation] = useState(null);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

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
        const arrayBuf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map(item => item.str).join(' ') + '\n';
        }
        // Envoyer au backend pour parsing
        const res = await api.post('/factures/match-products', { text });
        if (res.erreur) { setError(res.erreur); return; }
        setMatchedProducts(res);
        setStep(2);
      }
    } catch (err) {
      setError('Erreur lecture fichier: ' + err.message);
    }
  };

  const handleManualSubmit = async () => {
    if (!manualText.trim()) return;
    setError(null);
    try {
      const res = await api.post('/factures/match-products', { text: manualText });
      if (res.erreur) { setError(res.erreur); return; }
      setMatchedProducts(res);
      setStep(2);
    } catch (err) {
      setError('Erreur: ' + err.message);
    }
  };

  const matchProducts = async (lines) => {
    try {
      const res = await api.post('/factures/match-products', { lignes: lines });
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
      window.open(url, '_blank');
      showToast('PDF ouvert', 'success');
    } catch (err) {
      showToast('Erreur PDF: ' + err.message, 'error');
    }
  };

  const downloadCSVAndEmail = async () => {
    try {
      const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
      const invoiceData = { ...result, products: calculation?.products || matchedProducts, orderNumber };
      const res = await fetch(window.location.origin + '/api/factures/csv-logisticien', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceData, client: selectedClient, shippingId }),
      });
      const blob = await res.blob();

      // Essayer File System Access API (Chrome) pour sauver dans un dossier
      let saved = false;
      if (window.showDirectoryPicker) {
        try {
          const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
          const fileName = `logisticien-${result?.number || 'facture'}.csv`;
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast(`CSV sauvé dans ${dirHandle.name}/${fileName}`, 'success');
          saved = true;
        } catch (fsErr) {
          if (fsErr.name !== 'AbortError') console.warn('File System Access fallback:', fsErr);
        }
      }

      // Fallback : download classique
      if (!saved) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `logisticien-${result?.number || 'facture'}.csv`; a.click();
        URL.revokeObjectURL(url);
        showToast('CSV téléchargé', 'success');
      }

      // Ouvrir mailto logisticien
      const clientName = selectedClient?.name || '';
      const invoiceNum = result?.number || '';
      const subject = encodeURIComponent(clientName);
      const body = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint le CSV pour la commande ${invoiceNum} (${clientName}).\n\nCordialement`);
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
        // Auto-sélection transporteur : IDF/Paris → Coursier Colis, sinon Chronopost 13H Instance
        const idfDepts = ['75', '77', '78', '91', '92', '93', '94', '95'];
        const zip = client.zip || client.post_code || '';
        const city = (client.city || '').toLowerCase();
        const isIDF = idfDepts.some(d => zip.startsWith(d)) || city.includes('paris');
        setShippingId(isIDF ? '101' : '1302');
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
              <div className="text-sm font-medium text-slate-800">{selectedClient.name}</div>
              <div className="text-xs text-slate-500">{selectedClient.street}, {selectedClient.city}</div>
            </div>
          )}

          {calculation && (
            <div className="space-y-2">
              {calculation.products?.map((p, i) => (
                <div key={i} className="flex justify-between text-sm py-1">
                  <span>{p.ref} — {p.nom} x{p.quantite || p.quantity}</span>
                  <span className="font-mono">{p.total_ht?.toFixed(2)}€ HT</span>
                </div>
              ))}
              {calculation.frais_port?.map((f, i) => (
                <div key={'fp'+i} className="flex justify-between text-sm py-1 text-slate-500">
                  <span>{f.nom}</span>
                  <span className="font-mono">{(f.prix_ht * f.quantite).toFixed(2)}€ HT</span>
                </div>
              ))}
              <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
                <span>Total HT</span>
                <span className="font-mono">{calculation.total_ht?.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600">
                <span>Total TTC</span>
                <span className="font-mono">{calculation.total_ttc?.toFixed(2)}€</span>
              </div>
            </div>
          )}

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
              <option value="1302">1302 - Chronopost 13H Instance Agence</option>
              <option value="101">101 - Coursier Colis (IDF/Paris)</option>
              <option value="300">300 - Colissimo Expert France</option>
              <option value="1300">1300 - Chronopost 13H</option>
              <option value="1301">1301 - Chronopost Classic (intl)</option>
              <option value="1304">1304 - Chronopost Express (intl)</option>
              <option value="301">301 - Colissimo Expert DOM</option>
              <option value="302">302 - Colissimo Expert International</option>
              <option value="600">600 - TNT Avant 13H France</option>
              <option value="1000">1000 - DHL</option>
              <option value="900">900 - UPS Inter Standard</option>
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
            <button onClick={createInvoice} disabled={processing}
              className="flex-1 py-3 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {processing ? 'En cours...' : `Créer la ${documentType === 'proforma' ? 'proforma' : 'facture'}`}
            </button>
            <button onClick={logOnly} disabled={processing}
              className="py-3 px-4 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap">
              {processing ? '...' : 'Logger uniquement'}
            </button>
          </div>
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
              <a href={`https://app.vosfactures.fr/invoices/${result.id}`} target="_blank" rel="noopener"
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                Voir sur VosFactures ↗
              </a>
            )}
            <button onClick={() => { setStep(1); setResult(null); setMatchedProducts([]); setSelectedClient(null); setCalculation(null); setError(null); setManualText(''); setOrderNumber(''); }}
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
  const searchTimer = useRef(null);

  const rechercher = (q) => {
    setQuery(q);
    setErreur('');
    clearTimeout(searchTimer.current);
    if (!q || q.length < 2) { setClients([]); return; }
    searchTimer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(window.location.origin + '/api/factures/clients?q=' + encodeURIComponent(q), {
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
      setLoading(false);
    }, 400);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Sélectionner un client</h3>
        <div className="flex items-center gap-3">
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
  const [shippingId, setShippingId] = useState('1302');

  const addOrder = (products) => {
    setOrders(prev => [...prev, { id: nextId, products, client: null }]);
    setNextId(n => n + 1);
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
        if (!row[0] || row[0] === 'Ref 500ml' || row[0] === 'TOTAL') continue;
        const ref = String(row[0]).trim();
        const qty = parseFloat(row[6]) || parseFloat(row[5]) || 0;
        const price = parseFloat(String(row[3] || '0').replace(/[€\s]/g, '').replace(',', '.')) || 0;
        if (ref && qty > 0) products.push({ ref, quantity: qty, priceHT: price });
      }
      if (products.length > 0) addOrder(products);
      else showToast('Aucun produit trouvé', 'error');
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
    } catch (err) {
      showToast('Erreur: ' + err.message, 'error');
    }
  };

  const removeOrder = (id) => setOrders(prev => prev.filter(o => o.id !== id));

  const setOrderClient = (orderId, client) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, client } : o));
  };

  const createAll = async () => {
    const ready = orders.filter(o => o.client);
    if (ready.length === 0) { showToast('Attribuez un client à au moins une commande', 'error'); return; }
    setProcessing(true);
    const allResults = [];
    for (const order of ready) {
      try {
        const calc = await api.post('/factures/calculate', { products: order.products, clientName: order.client.name });
        const inv = await api.post('/factures/invoices', {
          client: order.client,
          products: calc.products,
          fraisPort: calc.frais_port,
          documentType: 'vat',
        });
        allResults.push({ ok: true, orderId: order.id, ...inv });
      } catch (err) {
        allResults.push({ ok: false, orderId: order.id, erreur: err.message });
      }
    }
    setResults(allResults);
    setProcessing(false);
    showToast(`${allResults.filter(r => r.ok).length}/${allResults.length} factures créées`, 'success');
  };

  const downloadCSVBatch = async (r) => {
    try {
      const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
      const order = orders.find(o => o.id === r.orderId);
      const invoiceData = { ...r, products: order?.products || [] };
      const client = order?.client || {};
      const res2 = await fetch(window.location.origin + '/api/factures/csv-logisticien', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceData, client, shippingId }),
      });
      const blob = await res2.blob();

      let saved = false;
      if (window.showDirectoryPicker) {
        try {
          const dirHandle = await window.showDirectoryPicker({ id: 'endurance-imports', mode: 'readwrite', startIn: 'documents' });
          const fileName = `logisticien-${r.number || 'facture'}.csv`;
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast(`CSV sauvé dans ${dirHandle.name}/${fileName}`, 'success');
          saved = true;
        } catch (fsErr) {
          if (fsErr.name !== 'AbortError') console.warn('File System Access fallback:', fsErr);
        }
      }

      if (!saved) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `logisticien-${r.number || 'facture'}.csv`; a.click();
        URL.revokeObjectURL(url);
        showToast('CSV téléchargé', 'success');
      }

      const clientName = client.name || '';
      const subject = encodeURIComponent(clientName);
      const body = encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint le CSV pour la commande ${r.number || ''} (${clientName}).\n\nCordialement`);
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

        <div className="flex gap-2">
          <label className="px-4 py-2 bg-slate-100 text-slate-700 text-sm rounded-lg hover:bg-slate-200 cursor-pointer">
            + Fichier Excel
            <input type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
          </label>
        </div>

        <div className="flex gap-2">
          <textarea value={manualText} onChange={e => setManualText(e.target.value)}
            placeholder="Saisie manuelle (10x P008-5000...)" rows={2}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-none" />
          <button onClick={addManualOrder} disabled={!manualText.trim()}
            className="px-3 py-2 bg-slate-900 text-white text-sm rounded-lg disabled:opacity-40">+</button>
        </div>

        {orders.map(order => (
          <div key={order.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Commande #{order.id} ({order.products?.length || 0} produits)</span>
              <button onClick={() => removeOrder(order.id)} className="text-xs text-red-500 hover:text-red-700">Supprimer</button>
            </div>
            {order.client ? (
              <div className="text-xs text-emerald-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {order.client.name}
              </div>
            ) : (
              <FacturesClientSearch onSelect={(c) => setOrderClient(order.id, c)} onBack={() => {}} />
            )}
          </div>
        ))}

        {orders.length > 0 && (
          <>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Transporteur</label>
              <select value={shippingId} onChange={e => setShippingId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="1302">1302 - Chronopost 13H Instance Agence</option>
                <option value="101">101 - Coursier Colis (IDF/Paris)</option>
                <option value="300">300 - Colissimo Expert France</option>
                <option value="1300">1300 - Chronopost 13H</option>
                <option value="1301">1301 - Chronopost Classic (intl)</option>
                <option value="1304">1304 - Chronopost Express (intl)</option>
                <option value="301">301 - Colissimo Expert DOM</option>
                <option value="302">302 - Colissimo Expert International</option>
                <option value="600">600 - TNT Avant 13H France</option>
                <option value="1000">1000 - DHL</option>
                <option value="900">900 - UPS Inter Standard</option>
              </select>
            </div>
            <button onClick={createAll} disabled={processing || !orders.some(o => o.client)}
              className="w-full py-3 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-700 disabled:opacity-50">
              {processing ? 'Création...' : `Créer ${orders.filter(o => o.client).length} facture(s)`}
            </button>
          </>
        )}

        {results && (
          <div className="space-y-1">
            {results.map((r, i) => (
              <div key={i} className={`text-sm p-2 rounded-lg flex items-center justify-between ${r.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                <span>{r.ok ? `Facture ${r.number || r.id} créée` : `Erreur: ${r.erreur}`}</span>
                {r.ok && (
                  <button onClick={() => downloadCSVBatch(r)}
                    className="ml-2 px-2 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700">
                    CSV + Email
                  </button>
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

  useEffect(() => {
    api.get('/factures/produits').then(data => setCatalog(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

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
      });
      if (res.erreur) throw new Error(res.erreur);
      setResult(res);
      showToast('Proforma créée !', 'success');
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
      const blob = await res.blob();

      // Essayer sauvegarde directe dans le dossier Google Drive
      let saved = false;
      if (window.showDirectoryPicker) {
        try {
          const dirHandle = await window.showDirectoryPicker({ id: 'endurance-imports', mode: 'readwrite', startIn: 'documents' });
          const fileName = `logisticien-${result?.number || 'proforma'}.csv`;
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast(`CSV sauvé dans ${dirHandle.name}/${fileName}`, 'success');
          saved = true;
        } catch (fsErr) {
          if (fsErr.name !== 'AbortError') console.warn('File System Access fallback:', fsErr);
        }
      }

      if (!saved) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `logisticien-${result?.number || 'proforma'}.csv`; a.click();
        URL.revokeObjectURL(url);
        showToast('CSV téléchargé', 'success');
      }

      // Ouvrir mailto logisticien
      const subject = encodeURIComponent(clientName);
      const invoiceNum = result?.number || '';
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
              <option value="300">300 - Colissimo Expert France</option>
              <option value="101">101 - Coursier Colis (IDF/Paris)</option>
              <option value="1302">1302 - Chronopost 13H Instance Agence</option>
              <option value="1300">1300 - Chronopost 13H</option>
              <option value="1301">1301 - Chronopost Classic (intl)</option>
              <option value="1304">1304 - Chronopost Express (intl)</option>
              <option value="301">301 - Colissimo Expert DOM</option>
              <option value="302">302 - Colissimo Expert International</option>
              <option value="600">600 - TNT Avant 13H France</option>
              <option value="1000">1000 - DHL</option>
              <option value="900">900 - UPS Inter Standard</option>
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
                <a href={`https://app.vosfactures.fr/invoices/${result.id}`} target="_blank" rel="noopener"
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
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (!doc.id || !doc.sendEmail) continue;
      try {
        await api.post(`/factures/invoices/${doc.id}/send-reminder`, {});
        docs[i] = { ...doc, sent: true };
        sent++;
      } catch (err) {
        docs[i] = { ...doc, sendError: err.message };
      }
    }
    setDocs([...docs]);
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
            placeholder={"FV 2024/12/001\n1234567\nhttps://app.vosfactures.fr/invoices/123456"}
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
                            onChange={() => { docs[i].sendEmail = !docs[i].sendEmail; setDocs([...docs]); }} />
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

// ─── VUE PARAMETRES ───────────────────────────────────────────────────────────
const VueParametres = () => {
  const [brevoKey, setBrevoKey] = useState("");
  const [limites, setLimites] = useState({ maxParJour: 50, heureDebut: "08:00", heureFin: "18:00", joursActifs: ["lun", "mar", "mer", "jeu", "ven"], fuseau: "Europe/Paris", delaiEntreEmails: 2 });
  const [brevoConfigured, setBrevoConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const jours = [["lun","Lun"],["mar","Mar"],["mer","Mer"],["jeu","Jeu"],["ven","Ven"],["sam","Sam"],["dim","Dim"]];
  const toggleJour = j => setLimites(l => ({ ...l, joursActifs: l.joursActifs.includes(j) ? l.joursActifs.filter(x => x !== j) : [...l.joursActifs, j] }));

  // Charger la config existante
  useEffect(() => {
    // Vérifier via /health si Brevo est configuré (variable Railway)
    api.get('/health').then(h => {
      if (h.brevo === 'configuré') setBrevoConfigured(true);
    }).catch(() => {});
    // Charger les autres paramètres depuis la DB
    api.get('/config').then(cfg => {
      if (cfg.brevo_api_key_configured) setBrevoConfigured(true);
      if (cfg.max_emails_par_jour) setLimites(l => ({ ...l, maxParJour: +cfg.max_emails_par_jour }));
      if (cfg.heure_debut) setLimites(l => ({ ...l, heureDebut: cfg.heure_debut }));
      if (cfg.heure_fin) setLimites(l => ({ ...l, heureFin: cfg.heure_fin }));
      if (cfg.jours_actifs) setLimites(l => ({ ...l, joursActifs: cfg.jours_actifs.split(',') }));
      if (cfg.fuseau) setLimites(l => ({ ...l, fuseau: cfg.fuseau }));
      if (cfg.delai_entre_emails) setLimites(l => ({ ...l, delaiEntreEmails: +cfg.delai_entre_emails }));
    }).catch(() => {});
  }, []);

  const sauvegarder = async () => {
    setSaving(true);
    setMsg("");
    try {
      const payload = {
        max_emails_par_jour: String(limites.maxParJour),
        heure_debut: limites.heureDebut,
        heure_fin: limites.heureFin,
        jours_actifs: limites.joursActifs.join(','),
        fuseau: limites.fuseau,
        delai_entre_emails: String(limites.delaiEntreEmails),
      };
      if (brevoKey) {
        payload.brevo_api_key = brevoKey;
        setBrevoConfigured(true);
        setBrevoKey("");
      }
      await api.post('/config', payload);
      setMsg("✅ Paramètres sauvegardés");
    } catch(e) {
      setMsg("❌ Erreur lors de la sauvegarde");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Clé API Brevo</h3>
        <div className={`flex items-center gap-2 text-xs mb-2 ${brevoConfigured ? "text-emerald-600" : "text-slate-400"}`}>
          <span className={`w-2 h-2 rounded-full ${brevoConfigured ? "bg-emerald-500" : "bg-slate-300"}`} />
          {brevoConfigured ? "Clé Brevo configurée et sauvegardée" : "Aucune clé configurée"}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">{brevoConfigured ? "Nouvelle clé API (laisser vide pour conserver l'actuelle)" : "Clé API Brevo"}</label>
          <input type="password" value={brevoKey} onChange={e => setBrevoKey(e.target.value)} placeholder="xkeysib-xxxxxxxx..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          <p className="text-xs text-slate-400 mt-1">Trouvez votre clé dans Brevo → Mon compte → SMTP & API → Clés API</p>
        </div>
      </div>

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
      <button onClick={sauvegarder} disabled={saving} className="px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">
        {saving ? "Sauvegarde..." : "Enregistrer les paramètres"}
      </button>

      <VueHubspot />
      <VueVosFacturesConfig />
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
    }).catch(() => {});
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
    if (!confirm('Retirer cette entrée de la blocklist ?')) return;
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
                  <td className="px-6 py-4 text-sm text-slate-500">{new Date(entry.created_at).toLocaleDateString('fr-FR')}</td>
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
    </div>
  );
};

// ─── APP PRINCIPALE ───────────────────────────────────────────────────────────

function App() {
  const [vue, setVue] = useState("dashboard");
  const [leads, setLeads] = useState([]);
  const [sequences, setSequences] = useState([]);
  const [activites, setActivites] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editSeq, setEditSeq] = useState(null);
  const [showSeqEditor, setShowSeqEditor] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "info", visible: false });
  const toastTimer = useRef(null);

  const showToast = (message, type = "info") => {
    clearTimeout(toastTimer.current);
    setToast({ message, type, visible: true });
    toastTimer.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000);
  };

  // Charger les données au démarrage
  const charger = async () => {
    // Attendre que le token soit disponible (Babel charge async)
    const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
    if (!token) {
      // Réessayer dans 200ms si pas encore de token
      setTimeout(charger, 200);
      return;
    }
    setLoading(true);
    try {
      const [leadsData, seqData, statsData, seqStatsData] = await Promise.all([
        api.get('/leads'),
        api.get('/sequences'),
        api.get('/stats/dashboard'),
        api.get('/stats/sequences'),
      ]);
      setLeads(Array.isArray(leadsData) ? leadsData : (leadsData.leads || []));
      setSequences(Array.isArray(seqData) ? seqData : (seqData.sequences || []));
      statsData.statsSequences = seqStatsData?.stats || [];
      setStats(statsData);
      if (statsData?.activitesRecentes) setActivites(statsData.activitesRecentes);
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

  const launchSequence = async (leadId, seqId) => {
    const r = await api.post(`/sequences/${seqId}/inscrire`, { lead_id: leadId });
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

  const NAV = [
    { id: "dashboard", icon: "📊", label: "Dashboard" },
    { id: "leads", icon: "👥", label: "Leads" },
    { id: "sequences", icon: "📧", label: "Séquences" },
    { id: "factures", icon: "📄", label: "Factures" },
    { id: "blocklist", icon: "🚫", label: "Blocklist" },
    { id: "emails", icon: "✅", label: "Validation Email" },
    { id: "parametres", icon: "⚙️", label: "Paramètres" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { font-family: 'DM Sans', sans-serif; }
        .font-mono { font-family: 'DM Mono', monospace !important; }
        .line-clamp-1 { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
        [contenteditable] ul { list-style-type: disc; padding-left: 20px; margin: 8px 0; }
        [contenteditable] ol { list-style-type: decimal; padding-left: 20px; margin: 8px 0; }
        [contenteditable] li { margin: 2px 0; }
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
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ id, icon, label }) => (
            <button key={id} onClick={() => setVue(id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${vue === id ? "bg-slate-900 text-white font-medium" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
              <span className="text-base">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">J</div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-800 truncate">Joe</div>
              <div className="text-xs text-slate-400 truncate">Commercial</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom tab bar — mobile only */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-40 flex justify-around items-center px-1 py-1 safe-area-bottom">
        {NAV.map(({ id, icon, label }) => (
          <button key={id} onClick={() => setVue(id)} className={`flex flex-col items-center justify-center min-w-0 flex-1 py-2 rounded-lg transition-colors ${vue === id ? "text-slate-900" : "text-slate-400"}`}>
            <span className="text-lg leading-none">{icon}</span>
            {vue === id && <span className="text-[10px] font-medium mt-0.5 truncate max-w-full px-1">{label}</span>}
          </button>
        ))}
      </div>

      {/* Main */}
      <div className="md:ml-56 min-h-screen">
        <header className="bg-white border-b border-slate-100 shadow-sm px-4 py-3 md:px-8 md:py-4 flex items-center justify-between sticky top-0 z-30">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              {NAV.find(n => n.id === vue)?.label}
            </h1>
            <p className="text-xs text-slate-400">
              {vue === "dashboard" && `${leads.filter(l => l.statut === "En séquence").length} leads en séquence`}
              {vue === "leads" && `${leads.length} leads au total`}
              {vue === "sequences" && `${sequences.length} séquences actives`}
              {vue === "blocklist" && "Gestion des emails et domaines bloqués"}
              {vue === "emails" && "Vérification & nettoyage des adresses email"}
              {vue === "factures" && "Commandes, factures & relances VosFactures"}
              {vue === "parametres" && "Configuration Brevo & envoi"}
            </p>
          </div>
          {vue === "leads" && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
              Scheduler actif
            </div>
          )}
        </header>

        <main className="p-4 pb-24 md:p-8 md:pb-8">
          {loading && <div className="flex items-center gap-2 text-sm text-slate-400 mb-4"><span className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin inline-block" /> Chargement...</div>}
          {vue === "dashboard" && <VueDashboard leads={leads} activites={activites} stats={stats} />}
          {vue === "leads" && <VueLeads leads={leads} sequences={sequencesNorm} onAdd={addLead} onLaunch={launchSequence} onRefresh={charger} showToast={showToast} />}
          {vue === "sequences" && <VueSequences sequences={sequencesNorm} onNew={() => { setEditSeq(null); setShowSeqEditor(true); }} onEdit={seq => { setEditSeq(seq); setShowSeqEditor(true); }} onRefresh={charger} showToast={showToast} />}
          {vue === "factures" && <VueFactures showToast={showToast} />}
          {vue === "blocklist" && <VueBlocklist onRefresh={charger} showToast={showToast} />}
          {vue === "emails" && <VueValidationEmail leads={leads} sequences={sequences} onRefresh={charger} showToast={showToast} />}
          {vue === "parametres" && <VueParametres />}
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
