const { useState, useEffect, useRef, useMemo } = React;

// ─── API BACKEND (remplace les données démo) ──────────────────────────────────
const api = window.tdmApi;


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
  const [form, setForm] = useState({ prenom: "", nom: "", hotel: "", ville: "", email: "", segment: "5*" });
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
    setForm(f => ({ ...f, prenom: contact.prenom, nom: contact.nom, email: contact.email }));
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
            {[["hotel","Établissement"],["ville","Ville"],["email","Email"]].map(([k,l]) => (
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
      // 2. Si "envoyer maintenant" → forcer le scheduler sur ce lead uniquement
      if (sendNow) {
        const r = await api.post('/sequences/trigger-now', { lead_ids: [lead.id] });
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
          {status === "done" && <p className="mt-3 text-xs text-emerald-600 font-medium">✓ Séquence lancée !</p>}
          {status === "error" && <p className="mt-3 text-xs text-red-500">✗ {errMsg}</p>}
        </div>
        <div className="px-6 py-4 bg-slate-50 flex flex-col gap-2 flex-shrink-0 border-t border-slate-100">
          <button
            disabled={status === "loading" || status === "done"}
            onClick={() => handleLaunch(true)}
            className="w-full py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            ⚡ Envoyer le 1er email maintenant
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">

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

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar étapes */}
          <div className="w-44 border-r border-slate-100 p-3 space-y-1 flex-shrink-0 overflow-y-auto bg-slate-50/50">
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
  const [form, setForm] = useState({ prenom: lead.prenom||"", nom: lead.nom||"", email: lead.email||"", hotel: lead.hotel||"", ville: lead.ville||"", segment: lead.segment||"5*", statut: lead.statut||"Nouveau" });
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
          {[["Email","email"],["Établissement","hotel"],["Ville","ville"]].map(([l,k]) => (
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

const VueLeads = ({ leads, sequences, onAdd, onLaunch, onRefresh }) => {
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
  const supprimerLead = async (lead) => {
    if (!confirm(`Supprimer ${lead.prenom} ${lead.nom} (${lead.hotel}) ?`)) return;
    await api.delete(`/leads/${lead.id}`);
    if (selectedLead?.id === lead.id) setSelectedLead(null);
    if (onRefresh) onRefresh();
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
      <div className="flex flex-wrap gap-2 items-center bg-white rounded-2xl border border-slate-100 px-4 py-3">
        <div className="flex gap-1 flex-wrap">
          {statuts.map(s => (
            <button key={s} onClick={() => setFilterStatut(s)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterStatut === s ? "bg-slate-900 text-white" : "bg-slate-50 border border-slate-200 text-slate-600 hover:border-slate-300"}`}>{s}</button>
          ))}
        </div>
        <div className="w-px h-4 bg-slate-200 mx-1 hidden sm:block" />
        <select value={filterSegment} onChange={e => setFilterSegment(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-600 focus:outline-none bg-white">
          {segments.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={filterVille} onChange={e => setFilterVille(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-600 focus:outline-none bg-white">
          {villes.map(v => <option key={v}>{v}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-600 focus:outline-none bg-white">
          <option value="recent">Plus récents</option>
          <option value="score">Score ↓</option>
          <option value="nom">Nom A→Z</option>
        </select>
        <span className="ml-auto text-xs text-slate-400">{filtered.length} lead{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* ── Barre actions ── */}
      <div className="flex gap-2 items-center justify-between">
        <div className="flex gap-2">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setVueMode("liste")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${vueMode === "liste" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>☰ Liste</button>
            <button onClick={() => setVueMode("kanban")} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${vueMode === "kanban" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>⬛ Kanban</button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..." className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white" />
        </div>
        <div className="flex gap-2">
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
          <div className="flex items-center gap-3 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm">
            <span className="font-medium">{selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} sélectionné{selectedIds.size > 1 ? "s" : ""}</span>
            <button onClick={() => setShowBulkLaunch(true)} className="px-3 py-1 bg-white text-blue-700 rounded-lg text-xs font-semibold hover:bg-blue-50">▶ Lancer une séquence</button>
            <button onClick={async () => { if(!confirm('Supprimer ' + selectedIds.size + ' leads ?')) return; for(const id of selectedIds) await api.delete('/leads/' + id).catch(()=>{}); setSelectedIds(new Set()); if(onRefresh) onRefresh(); }} className="px-3 py-1 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600">✕ Supprimer</button>
            <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-blue-200 hover:text-white text-xs">Annuler</button>
          </div>
        )}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
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
                <tr key={lead.id} className={`group border-b border-slate-50 transition-colors cursor-pointer ${selectedLead?.id === lead.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : selectedIds.has(lead.id) ? "bg-slate-100" : "hover:bg-slate-50/80"} ${i === filtered.length-1 ? "border-0" : ""}`} onClick={() => ouvrirDetail(lead)}>
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
                      <button onClick={() => supprimerLead(lead)} title="Supprimer" className="px-2 py-1 text-xs border border-red-100 text-red-400 rounded-md hover:bg-red-50">✕</button>
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
        <div className="flex gap-3 overflow-x-auto pb-4">
          {KANBAN_COLS.map(col => {
            const colLeads = filtered.filter(l => l.statut === col);
            const cfg = STATUT_CONFIG[col] || STATUT_CONFIG["Nouveau"];
            return (
              <div key={col} className="flex-shrink-0 w-60">
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl mb-2 ${cfg.bg}`}>
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  <span className={`text-xs font-semibold ${cfg.text}`}>{col}</span>
                  <span className={`ml-auto text-xs font-bold ${cfg.text} opacity-60`}>{colLeads.length}</span>
                </div>
                <div className="space-y-2 min-h-16">
                  {colLeads.map(lead => (
                    <div key={lead.id} className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => ouvrirDetail(lead).catch(e => console.error("Erreur détail:", e))}>
                      <div className="font-medium text-slate-800 text-sm">{lead.prenom} {lead.nom}</div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">{lead.hotel}</div>
                      <div className="text-xs text-slate-400">{lead.ville}{lead.segment ? <span className="ml-1">· {lead.segment}</span> : ""}</div>
                      {lead.sequence && <div className="text-xs text-blue-600 mt-1 truncate">📧 Email {(lead.etape||0)+1}</div>}
                      <div className="flex items-center justify-between mt-2">
                        <ScoreBar score={lead.score} />
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {lead.statut !== "Désabonné" && <button onClick={() => setShowLaunch(lead)} className="text-xs text-blue-500 hover:text-blue-700 px-1" title="Lancer séquence">▶</button>}
                          <button onClick={() => setEditLead(lead)} className="text-xs text-slate-400 hover:text-slate-600 px-1">✏️</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {colLeads.length === 0 && <div className="text-center py-6 text-xs text-slate-300 border-2 border-dashed border-slate-100 rounded-xl">Vide</div>}
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
          <div className="flex items-start justify-between p-5 border-b border-slate-100">
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
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => setEditLead(selectedLead)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">✏️ Éditer</button>
              <button onClick={() => supprimerLead(selectedLead)} className="px-3 py-1.5 text-xs border border-red-100 text-red-400 rounded-lg hover:bg-red-50">Supprimer</button>
              <button onClick={() => { setSelectedLead(null); setDetailData(null); }} className="text-slate-400 hover:text-slate-600 text-xl ml-1">×</button>
            </div>
          </div>

          {/* ── KPIs rapides ── */}
          <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/50">
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

const VueSequences = ({ sequences, onNew, onEdit }) => (
  <div className="space-y-4">
    <div className="flex justify-end">
      <button onClick={onNew} className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors">
        + Nouvelle séquence
      </button>
    </div>
    <div className="grid gap-4">
      {sequences.map(seq => (
        <div key={seq.id} className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-800">{seq.nom}</h3>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">Segment {seq.segment}</span>
                <span className="text-xs text-slate-400">{seq.leadsActifs} leads actifs</span>
              </div>
            </div>
            <button onClick={() => onEdit(seq)} className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
              Modifier
            </button>
          </div>
          <div className="flex items-center gap-0">
            {seq.etapes.map((etape, i) => (
              <div key={i} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{i + 1}</div>
                  <div className="text-xs text-slate-400 mt-1 text-center w-20 truncate" title={etape.sujet}>J+{etape.jour}</div>
                </div>
                {i < seq.etapes.length - 1 && (
                  <div className="w-12 h-px bg-slate-200 mx-1 mb-4" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {seq.etapes.map((etape, i) => (
              <div key={i} className="flex gap-3 items-start bg-slate-50 rounded-xl p-3">
                <span className="text-xs font-bold text-slate-400 w-10 flex-shrink-0 mt-0.5">J+{etape.jour}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{etape.sujet || "(sans objet)"}</div>
                  <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{(etape.corps_html ? etape.corps_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : etape.corps?.split("\n")[0]) || "(vide)"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

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

const VueValidationEmail = ({ leads, onRefresh }) => {
  const [zbKey, setZbKey] = useState("");
  const [zbConfigured, setZbConfigured] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState("");
  const [credits, setCredits] = useState(null);

  // Validation unitaire
  const [singleEmail, setSingleEmail] = useState("");
  const [singleResult, setSingleResult] = useState(null);
  const [singleLoading, setSingleLoading] = useState(false);

  // Validation bulk
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
    } catch(e) { setSingleResult({ error: e.message }); }
    setSingleLoading(false);
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
          </div>

          {/* ── Validation bulk ── */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Validation en masse</h3>
                <p className="text-xs text-slate-400 mt-0.5">{leadsNorm.length} leads au total · {leadsNorm.filter(l => !l.statut_email).length} non vérifiés</p>
              </div>
              {bulkResults.length > 0 && (
                <div className="flex gap-2 text-xs">
                  {["valid","invalid","catch_all","unknown"].map(s => stats[s] ? (
                    <span key={s} className={`px-2 py-1 rounded-full font-medium ${ZB_STATUS_CONFIG[s]?.bg} ${ZB_STATUS_CONFIG[s]?.text}`}>{stats[s]} {ZB_STATUS_CONFIG[s]?.label}</span>
                  ) : null)}
                </div>
              )}
            </div>

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
                  ▶ Lancer la validation
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
                </div>
              )}
              {bulkErreur && <span className="text-xs text-red-500">{bulkErreur}</span>}
            </div>

            {bulkResults.length > 0 && (
              <>
                <div className="flex gap-1 flex-wrap mb-3">
                  {STATUTS_BULK.map(s => (
                    <button key={s} onClick={() => setFilterBulk(s)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterBulk === s ? "bg-slate-900 text-white" : "bg-slate-50 border border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                      {s === "tous" ? `Tous (${bulkResults.length})` : `${ZB_STATUS_CONFIG[s]?.label || s}${stats[s] ? ` (${stats[s]})` : ""}`}
                    </button>
                  ))}
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
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
    </div>
  );
};

const VueParametres = () => {
  const [brevoKey, setBrevoKey] = useState("");
  const [limites, setLimites] = useState({ maxParJour: 50, heureDebut: "08:00", heureFin: "18:00", joursActifs: ["lun", "mar", "mer", "jeu", "ven"] });
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
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Maximum d'emails par jour</label>
          <input type="number" value={limites.maxParJour} onChange={e => setLimites(l => ({ ...l, maxParJour: +e.target.value }))} className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
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
      </div>

      {msg && <p className="text-sm text-emerald-600 font-medium">{msg}</p>}
      <button onClick={sauvegarder} disabled={saving} className="px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50">
        {saving ? "Sauvegarde..." : "Enregistrer les paramètres"}
      </button>
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
    { id: "hubspot", icon: "🔗", label: "HubSpot" },
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
      `}</style>

      {showSeqEditor && <ModalEmailEditor seq={editSeq} onClose={() => { setShowSeqEditor(false); setEditSeq(null); }} onSave={saveSeq} />}

      {/* Sidebar */}
      <div className="fixed left-0 top-0 h-full w-56 bg-white border-r border-slate-100 flex flex-col z-40">
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

      {/* Main */}
      <div className="ml-56 min-h-screen">
        <header className="bg-white border-b border-slate-100 px-8 py-4 flex items-center justify-between sticky top-0 z-30">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              {NAV.find(n => n.id === vue)?.label}
            </h1>
            <p className="text-xs text-slate-400">
              {vue === "dashboard" && `${leads.filter(l => l.statut === "En séquence").length} leads en séquence`}
              {vue === "leads" && `${leads.length} leads au total`}
              {vue === "sequences" && `${sequences.length} séquences actives`}
              {vue === "hubspot" && "Intégration CRM bidirectionnelle"}
              {vue === "emails" && "Vérification & nettoyage des adresses email"}
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

        <main className="p-8">
          {loading && <div className="flex items-center gap-2 text-sm text-slate-400 mb-4"><span className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin inline-block" /> Chargement...</div>}
          {vue === "dashboard" && <VueDashboard leads={leads} activites={activites} stats={stats} />}
          {vue === "leads" && <VueLeads leads={leads} sequences={sequencesNorm} onAdd={addLead} onLaunch={launchSequence} onRefresh={charger} />}
          {vue === "sequences" && <VueSequences sequences={sequencesNorm} onNew={() => { setEditSeq(null); setShowSeqEditor(true); }} onEdit={seq => { setEditSeq(seq); setShowSeqEditor(true); }} />}
          {vue === "hubspot" && <VueHubspot />}
          {vue === "emails" && <VueValidationEmail leads={leads} onRefresh={charger} />}
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
