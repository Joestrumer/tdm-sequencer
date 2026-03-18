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
  const [form, setForm] = useState({ prenom: "", nom: "", hotel: "", ville: "", email: "", segment: "5*", poste: "", langue: "fr" });
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
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">Segment</label>
                <select value={form.segment} onChange={e => set("segment", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
                  {["5*","4*","Boutique","Retail","SPA","Concept Store"].map(s => <option key={s}>{s}</option>)}
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
  const [testEmail, setTestEmail] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testInProgress, setTestInProgress] = useState(false);
  const [mode, setMode] = useState("edit");
  const objetRef = useRef(null);
  const pjRef = useRef(null);
  const [pieceJointe, setPieceJointe] = useState(etapes[0]?.piece_jointe || null);

  // Tiptap editor setup
  const { useEditor, EditorContent } = window.TiptapReact || {};
  const { StarterKit, Underline, TextStyle, Color, TextAlign, Link, Placeholder } = window.TiptapExtensions || {};

  const editor = useEditor && StarterKit ? useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: true,
        orderedList: true,
        hardBreak: true,
        paragraph: true,
        bold: true,
        italic: true,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color.configure({ types: ['textStyle'] }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right'],
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          style: 'color: #1a56db; text-decoration: underline;'
        },
      }),
      Placeholder.configure({
        placeholder: 'Écrivez votre email ici... Utilisez la toolbar pour formater.'
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      updateEtape(activeEtape, 'content_json', JSON.stringify(json));
      updateEtape(activeEtape, 'corps_html', editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-64 p-4',
        style: 'font-family: Helvetica, Arial, sans-serif; font-size: 14px;'
      },
    },
  }) : null;

  // Sync pj dans l'étape courante
  const setPjEtape = (pj) => {
    setPieceJointe(pj);
    updateEtape(activeEtape, "piece_jointe", pj);
  };

  const chargerPj = (file) => {
    if (!file) return;
    if (file.size > 5000000) {
      alert("❌ Fichier trop volumineux (max 5 MB)");
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
      if (!confirm("La séquence doit être sauvegardée avant de pouvoir tester un email. Sauvegarder maintenant ?")) {
        setShowTestModal(false);
        return;
      }
      await handleSave();
      setShowTestModal(false);
      alert("✅ Séquence sauvegardée. Veuillez rouvrir et cliquer à nouveau sur 'Tester cet email'");
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
    alert(`⏳ Envoi du test en cours vers ${emailToSend}...`);

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

          alert(`✅ Test envoyé avec succès à ${emailToSend}`);
        } else {
          throw new Error("Inscription non trouvée");
        }
      } catch(err) {
        console.error(err);
        alert('❌ Erreur : ' + (err.message || 'impossible d\'envoyer le test'));
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
  const updateEtape = (i, k, v) => setEtapes(e => e.map((et, idx) => {
    if (idx !== i) return et;
    // Garder jour et jour_delai en sync (DB stocke jour_delai, UI utilise jour)
    const extra = k === 'jour' ? { jour_delai: v } : k === 'jour_delai' ? { jour: v } : {};
    return { ...et, [k]: v, ...extra };
  }));

  // Insérer une variable à la position du curseur (adapté pour Tiptap)
  const insererVar = (v) => {
    if (editor) {
      editor.chain().focus().insertContent(v).run();
    }
  };

  // Initialiser le contenu de l'éditeur quand on change d'étape
  useEffect(() => {
    if (editor && mode === "edit") {
      const etape = etapes[activeEtape];
      // Charger depuis content_json si disponible, sinon depuis corps_html
      if (etape?.content_json) {
        try {
          const json = JSON.parse(etape.content_json);
          editor.commands.setContent(json);
        } catch {
          editor.commands.setContent(etape.corps_html || '');
        }
      } else {
        editor.commands.setContent(etape?.corps_html || '');
      }
      setPieceJointe(etape?.piece_jointe || null);
    }
  }, [editor, activeEtape, mode]);

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

        // Log si pièce jointe présente
        if (e.piece_jointe) {
          console.log(`📎 Étape ${i+1} a une pièce jointe:`, {
            nom: e.piece_jointe.nom,
            taille: e.piece_jointe.taille,
            hasData: !!e.piece_jointe.data
          });
        }

        return etape;
      });

      console.log('💾 Sauvegarde séquence:', { nom, nbEtapes: etapesFinales.length });
      await onSave({ id: seq?.id || null, nom, segment, etapes: etapesFinales, leadsActifs: seq?.leadsActifs || 0, options: { desabonnement } });
      onClose();
    } catch(e) { setErrMsg("Erreur : " + (e.message || "impossible de sauvegarder")); }
    setSaving(false);
  };

  const etapeCourante = etapes[activeEtape] || {};
  // Le corps pour la preview - détecter et enlever duplication
  let corpsPreview = etapeCourante.corps_html || texteVersHtmlPreview(etapeCourante.corps || "");

  // Si le contenu semble dupliqué (même texte apparaît deux fois), prendre seulement la première moitié
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = corpsPreview;
  const textContent = tempDiv.textContent || '';
  const halfLength = Math.floor(textContent.length / 2);
  const firstHalf = textContent.substring(0, halfLength);
  const secondHalf = textContent.substring(halfLength);

  // Si les deux moitiés sont très similaires (80%+), c'est probablement une duplication
  if (firstHalf.length > 50 && secondHalf.includes(firstHalf.substring(0, 50))) {
    // Prendre seulement la première moitié du HTML
    const allNodes = Array.from(tempDiv.childNodes);
    const midPoint = Math.floor(allNodes.length / 2);
    tempDiv.innerHTML = '';
    allNodes.slice(0, midPoint).forEach(node => tempDiv.appendChild(node.cloneNode(true)));
    corpsPreview = tempDiv.innerHTML;
  }

  const VARS = ["{{prenom}}", "{{hotel}}", "{{ville}}", "{{segment}}"];

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
          <div className="md:w-52 border-b md:border-b-0 md:border-r border-slate-100 p-2 md:p-3 flex md:flex-col gap-1.5 flex-shrink-0 overflow-x-auto md:overflow-y-auto bg-slate-50/50">
            {etapes.map((e, i) => (
              <div key={i} className={`group rounded-lg transition-all ${activeEtape === i ? "bg-gradient-to-br from-slate-900 to-slate-800 shadow-lg" : "hover:bg-white hover:shadow-sm"}`}>
                <button onClick={() => setActiveEtape(i)} className="w-full text-left px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold text-sm ${activeEtape === i ? "text-white" : "text-slate-800"}`}>Email {i + 1}</span>
                    {etapes.length > 1 && (
                      <button onClick={(ev) => { ev.stopPropagation(); removeEtape(i); }} className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs w-5 h-5 rounded flex items-center justify-center ${activeEtape === i ? "text-slate-400 hover:text-red-300 hover:bg-white/10" : "text-slate-400 hover:text-red-500 hover:bg-red-50"}`}>✕</button>
                    )}
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

                {/* Toolbar Tiptap */}
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  {editor && (
                    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-gradient-to-b from-slate-50 to-white border-b border-slate-200">
                      {/* Formatage texte */}
                      <button
                        type="button"
                        title="Gras"
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        className={`w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-slate-200 text-slate-600 font-bold transition-colors ${editor.isActive('bold') ? 'bg-slate-200' : ''}`}
                      >
                        B
                      </button>
                      <button
                        type="button"
                        title="Italique"
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        className={`w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-slate-200 text-slate-600 italic transition-colors ${editor.isActive('italic') ? 'bg-slate-200' : ''}`}
                      >
                        I
                      </button>
                      <button
                        type="button"
                        title="Souligné"
                        onClick={() => editor.chain().focus().toggleUnderline().run()}
                        className={`w-7 h-7 rounded flex items-center justify-center text-sm hover:bg-slate-200 text-slate-600 underline transition-colors ${editor.isActive('underline') ? 'bg-slate-200' : ''}`}
                      >
                        U
                      </button>
                      <div className="w-px h-4 bg-slate-200 mx-0.5" />
                      {/* Titres */}
                      <button
                        type="button"
                        title="Titre 1"
                        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                        className={`px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-600 text-xs font-bold transition-colors ${editor.isActive('heading', { level: 1 }) ? 'bg-slate-200' : ''}`}
                      >
                        H1
                      </button>
                      <button
                        type="button"
                        title="Titre 2"
                        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        className={`px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-600 text-xs font-bold transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-slate-200' : ''}`}
                      >
                        H2
                      </button>
                      <div className="w-px h-4 bg-slate-200 mx-0.5" />
                      {/* Listes */}
                      <button
                        type="button"
                        title="Liste à puces"
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        className={`px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-600 text-xs transition-colors ${editor.isActive('bulletList') ? 'bg-slate-200' : ''}`}
                      >
                        •
                      </button>
                      <button
                        type="button"
                        title="Liste numérotée"
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        className={`px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-600 text-xs transition-colors ${editor.isActive('orderedList') ? 'bg-slate-200' : ''}`}
                      >
                        1.
                      </button>
                      <div className="w-px h-4 bg-slate-200 mx-0.5" />
                      {/* Alignement */}
                      <button
                        type="button"
                        title="Aligner à gauche"
                        onClick={() => editor.chain().focus().setTextAlign('left').run()}
                        className={`px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-600 text-xs transition-colors ${editor.isActive({ textAlign: 'left' }) ? 'bg-slate-200' : ''}`}
                      >
                        ⬅
                      </button>
                      <button
                        type="button"
                        title="Centrer"
                        onClick={() => editor.chain().focus().setTextAlign('center').run()}
                        className={`px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-600 text-xs transition-colors ${editor.isActive({ textAlign: 'center' }) ? 'bg-slate-200' : ''}`}
                      >
                        ↔
                      </button>
                      <button
                        type="button"
                        title="Aligner à droite"
                        onClick={() => editor.chain().focus().setTextAlign('right').run()}
                        className={`px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-600 text-xs transition-colors ${editor.isActive({ textAlign: 'right' }) ? 'bg-slate-200' : ''}`}
                      >
                        ➡
                      </button>
                      <div className="w-px h-4 bg-slate-200 mx-0.5" />
                      {/* Lien hypertexte */}
                      <button
                        type="button"
                        title="Ajouter un lien"
                        onClick={() => {
                          const url = prompt("URL du lien :", "https://");
                          if (url && url.trim()) {
                            editor.chain().focus().setLink({ href: url }).run();
                          }
                        }}
                        className={`px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-slate-500 text-xs transition-colors ${editor.isActive('link') ? 'bg-slate-200' : ''}`}
                      >
                        🔗
                      </button>
                      {editor.isActive('link') && (
                        <button
                          type="button"
                          title="Retirer le lien"
                          onClick={() => editor.chain().focus().unsetLink().run()}
                          className="px-2 h-7 rounded flex items-center justify-center hover:bg-slate-200 text-red-500 text-xs transition-colors"
                        >
                          ✕
                        </button>
                      )}
                      <div className="w-px h-4 bg-slate-200 mx-0.5" />
                      {/* Variables corps */}
                      <span className="text-xs text-slate-400">Variables :</span>
                      {VARS.map(v => (
                        <button
                          type="button"
                          key={v}
                          onClick={() => insererVar(v)}
                          className="px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs rounded font-mono transition-colors border border-amber-200"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Éditeur Tiptap */}
                  <EditorContent
                    editor={editor}
                    className="min-h-64 max-h-96 overflow-y-auto text-slate-800 bg-white border-t border-slate-100"
                  />
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

      {/* Modal de test pour un email spécifique */}
      {showTestModal && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
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
  const [form, setForm] = useState({ prenom: lead.prenom||"", nom: lead.nom||"", email: lead.email||"", hotel: lead.hotel||"", ville: lead.ville||"", segment: lead.segment||"5*", statut: lead.statut||"Nouveau", poste: lead.poste||"", langue: lead.langue||"fr" });
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
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs text-slate-500 mb-1 block">Segment</label>
            <select value={form.segment} onChange={e => set("segment", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              {["5*","4*","Boutique","Retail","SPA","Concept Store"].map(s => <option key={s}>{s}</option>)}
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
  const [filterLangue, setFilterLangue] = useState("Tous");
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
  const [detailData, setDetailData] = useState(null);     // détail complet lead (emails + events)
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailTab, setDetailTab] = useState('timeline'); // 'timeline' | 'emails' | 'hubspot'
  const [showTooltip, setShowTooltip] = useState(null);   // "csv" | "sync" | "envoyer" | null
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
  const langues = ["Tous", ...Array.from(new Set(leadsNorm.map(l => l.langue).filter(Boolean))).sort()];
  const statuts = ["Tous", ...Object.keys(STATUT_CONFIG)];

  const handleColumnSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
    setSortBy(null); // Désactiver le tri par dropdown
  };

  const filtered = leadsNorm.filter(l => {
    const matchSearch = `${l.prenom} ${l.nom} ${l.hotel} ${l.ville} ${l.email}`.toLowerCase().includes(search.toLowerCase());
    const matchStatut = filterStatut === "Tous" || l.statut === filterStatut;
    const matchSegment = filterSegment === "Tous" || l.segment === filterSegment;
    const matchVille = filterVille === "Tous" || l.ville === filterVille;
    const matchLangue = filterLangue === "Tous" || l.langue === filterLangue;
    return matchSearch && matchStatut && matchSegment && matchVille && matchLangue;
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
      }

      const comparison = typeof aVal === "number" ? aVal - bVal : aVal.localeCompare(bVal);
      return sortDirection === "asc" ? comparison : -comparison;
    }
    // Tri par dropdown (ancien système)
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
        poste: obj.poste || obj.position || obj.title || obj.job || "",
        langue: obj.langue || obj.language || obj.lang || "fr",
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
          <select value={filterLangue} onChange={e => setFilterLangue(e.target.value)} className="border border-slate-200 rounded-lg px-2.5 py-1.5 md:py-1 text-xs text-slate-600 focus:outline-none bg-white">
            {langues.map(l => <option key={l} value={l}>{l === "Tous" ? "Toutes langues" : l === "fr" ? "🇫🇷 FR" : l === "en" ? "🇬🇧 EN" : l === "de" ? "🇩🇪 DE" : l === "es" ? "🇪🇸 ES" : l === "it" ? "🇮🇹 IT" : l}</option>)}
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
          <div className="flex items-center gap-1">
            <button onClick={() => csvRef.current?.click()} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 whitespace-nowrap">
              {importStatus || "📥 Import CSV"}
            </button>
            <button
              title="Format CSV : prenom,nom,email,hotel,ville,segment,poste,langue&#10;Requis: email, hotel, prenom"
              className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 text-xs flex items-center justify-center font-bold"
            >
              ℹ️
            </button>
          </div>
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={e => importerCSV(e.target.files?.[0])} />
          <div className="flex items-center gap-1">
            <button onClick={async () => {
              const r = await api.post("/hubspot/sync-all", {}).catch(() => null);
              if (r && onRefresh) onRefresh();
            }} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 whitespace-nowrap">
              🔄 Sync HS
            </button>
            <button
              title="Synchroniser tous les leads avec HubSpot"
              className="w-5 h-5 rounded-full bg-orange-100 text-orange-500 hover:bg-orange-200 text-xs flex items-center justify-center font-bold"
            >
              ℹ️
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={async () => {
              if (!confirm('Forcer l\'envoi immédiat des emails en attente ?\n\nCela enverra tous les emails planifiés pour aujourd\'hui.')) return;
              setTriggerStatus("sending");
              try { const r = await api.post("/sequences/trigger-now", {}); setTriggerStatus(r.erreur ? "error" : "done"); }
              catch(e) { setTriggerStatus("error"); }
              setTimeout(() => setTriggerStatus(null), 3000);
            }} className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${triggerStatus === "sending" ? "bg-amber-50 border-amber-300 text-amber-700" : triggerStatus === "done" ? "bg-emerald-50 border-emerald-300 text-emerald-700" : triggerStatus === "error" ? "bg-red-50 border-red-300 text-red-600" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              {triggerStatus === "sending" ? "⟳ Envoi..." : triggerStatus === "done" ? "✓ Envoyé" : triggerStatus === "error" ? "✗ Erreur" : "⚡ Envoyer"}
            </button>
            <button
              title="⚠️ Force l'envoi immédiat des emails planifiés aujourd'hui (bypass fenêtre horaire)"
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
                    <div className="text-xs text-slate-400 truncate">{lead.hotel} · {[lead.ville, lead.segment, lead.langue ? (lead.langue === 'fr' ? '🇫🇷' : lead.langue === 'en' ? '🇬🇧' : lead.langue === 'de' ? '🇩🇪' : lead.langue === 'es' ? '🇪🇸' : lead.langue === 'it' ? '🇮🇹' : lead.langue) : null].filter(Boolean).join(" · ")}</div>
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
                <th className="px-2 py-2 w-8">
                  <input type="checkbox" className="rounded accent-blue-600" checked={selectedIds.size === filtered.length && filtered.length > 0} onChange={e => setSelectedIds(e.target.checked ? new Set(filtered.map(l => l.id)) : new Set())} />
                </th>
                <th onClick={() => handleColumnSort("nom")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none">
                  Contact {sortColumn === "nom" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleColumnSort("hotel")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none">
                  Établissement {sortColumn === "hotel" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleColumnSort("langue")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide w-12 cursor-pointer hover:text-slate-700 select-none">
                  Langue {sortColumn === "langue" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Séquence</th>
                <th onClick={() => handleColumnSort("score")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide w-20 cursor-pointer hover:text-slate-700 select-none">
                  Engagement {sortColumn === "score" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleColumnSort("statut")} className="text-left px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-700 select-none">
                  Statut {sortColumn === "statut" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th className="px-2 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, i) => {
                const cfg = STATUT_CONFIG[lead.statut] || STATUT_CONFIG["Nouveau"];
                return (
                <React.Fragment key={lead.id}>
                <tr className={`group border-b border-slate-50 border-l-2 transition-colors cursor-pointer ${selectedLead?.id === lead.id ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200 border-l-indigo-400" : selectedIds.has(lead.id) ? "bg-slate-100 border-l-transparent" : "hover:bg-slate-50/80 border-l-transparent hover:border-l-blue-400"} ${i === filtered.length-1 ? "border-b-0" : ""}`} onClick={() => ouvrirDetail(lead)}>
                  <td className="px-2 py-1.5 w-8" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="rounded accent-blue-600" checked={selectedIds.has(lead.id)} onChange={e => { const s = new Set(selectedIds); e.target.checked ? s.add(lead.id) : s.delete(lead.id); setSelectedIds(s); }} />
                  </td>
                  <td className="px-2 py-1.5">
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
                  <td className="px-2 py-1.5">
                    <div className="text-xs text-slate-700 font-medium leading-tight truncate">{lead.hotel} · {[lead.ville, lead.segment].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-2 py-1.5 w-12 text-center">
                    <span className="text-xs">{lead.langue === 'fr' ? '🇫🇷' : lead.langue === 'en' ? '🇬🇧' : lead.langue === 'de' ? '🇩🇪' : lead.langue === 'es' ? '🇪🇸' : lead.langue === 'it' ? '🇮🇹' : lead.langue || '—'}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    {lead.sequence
                      ? <div className="text-[10px] text-blue-600 font-medium truncate max-w-[100px]">E{(lead.etape||0)+1} · {lead.sequence}</div>
                      : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1.5 w-20">
                    <div className="flex items-center gap-1">
                      <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${lead.score >= 80 ? "bg-emerald-500" : lead.score >= 50 ? "bg-amber-400" : "bg-slate-300"}`} style={{width: lead.score + "%"}} />
                      </div>
                      <span className="text-[10px] font-medium text-slate-500 w-6 text-right">{lead.score}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                    <select value={lead.statut} onChange={e => changerStatut(lead, e.target.value)}
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none ${cfg.bg} ${cfg.text}`}>
                      {Object.keys(STATUT_CONFIG).map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                      {lead.statut !== "Désabonné" && (
                        <button onClick={() => setShowLaunch(lead)} title="Lancer séquence" className="px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap">▶</button>
                      )}
                      <button onClick={() => setEditLead(lead)} title="Modifier" className="px-2 py-1 text-xs border border-slate-200 text-slate-500 rounded-md hover:bg-slate-100">✏️</button>
                      <button onClick={(e) => supprimerLead(lead, e)} title="Supprimer" className="px-2 py-1 text-xs border border-red-100 text-red-400 rounded-md hover:bg-red-50">✕</button>
                    </div>
                  </td>
                </tr>
                {/* Panneau de détails inline */}
                {selectedLead?.id === lead.id && (
                  <tr>
                    <td colSpan="8" className="p-0 bg-gradient-to-b from-blue-50/50 to-transparent">
                      <div className="p-4 border-t-2 border-blue-400">
                        <div className="flex justify-end mb-2">
                          <button onClick={() => { setSelectedLead(null); setDetailData(null); }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                          <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                            <div className="text-xs text-slate-400">Score</div>
                            <div className="text-lg font-bold text-slate-800">{lead.score || 50}</div>
                          </div>
                          <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                            <div className="text-xs text-slate-400">Ouvertures</div>
                            <div className="text-lg font-bold text-slate-800">{lead.total_ouvertures || 0}</div>
                          </div>
                          <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                            <div className="text-xs text-slate-400">Emails</div>
                            <div className="text-lg font-bold text-slate-800">{lead.emails_envoyes || 0}</div>
                          </div>
                          <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                            <div className="text-xs text-slate-400">Langue</div>
                            <div className="text-lg font-bold text-slate-800">{lead.langue === 'fr' ? '🇫🇷' : lead.langue === 'en' ? '🇬🇧' : lead.langue === 'de' ? '🇩🇪' : lead.langue === 'es' ? '🇪🇸' : lead.langue === 'it' ? '🇮🇹' : '—'}</div>
                          </div>
                        </div>

                        {lead.sequence_active && (
                          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-xs font-semibold text-blue-800 mb-0.5">Séquence en cours</div>
                                <div className="text-sm text-blue-600">{lead.sequence_active}</div>
                                <div className="text-xs text-slate-500 mt-1">Étape {(lead.etape_courante || 0) + 1}</div>
                              </div>
                              {lead.prochain_envoi && (
                                <div className="text-xs text-right">
                                  <div className="text-slate-500">Prochain envoi</div>
                                  <div className="font-medium text-blue-700">{new Date(lead.prochain_envoi).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => setEditLead(lead)} className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg hover:bg-slate-50">✏️ Éditer</button>
                          {!lead.sequence_active && lead.statut !== "Désabonné" && (
                            <button onClick={() => setShowLaunch(lead)} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">▶ Lancer séquence</button>
                          )}
                          {lead.sequence_active && (
                            <button onClick={async () => {
                              if (!confirm('Arrêter la séquence pour ce lead ?')) return;
                              try {
                                await api.post(`/sequences/stop-lead/${lead.id}`);
                                showToast('Séquence arrêtée', 'success');
                                if (onRefresh) onRefresh();
                                setSelectedLead(null);
                              } catch (err) {
                                showToast(err.message || 'Erreur', 'error');
                              }
                            }} className="px-3 py-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-100">⏹️ Arrêter</button>
                          )}
                          {lead.hubspot_id && (
                            <a href={`https://app.hubspot.com/contacts/26199813/contact/${lead.hubspot_id}`} target="_blank" className="px-3 py-1.5 text-xs bg-orange-50 border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-100">HubSpot ↗</a>
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

  // Chart instances
  const monthlyChartInstance = useRef(null);
  const topClientsChartInstance = useRef(null);
  const clientMonthlyChartInstance = useRef(null);
  const comparisonChartInstance = useRef(null);

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

  // Create years comparison chart
  useEffect(() => {
    if (!comparisonChartRef.current || !yearsComparison || viewMode !== 'comparison') return;

    if (comparisonChartInstance.current) {
      comparisonChartInstance.current.destroy();
    }

    const filteredYears = (yearsComparison.years || []).filter(y => selectedYears.includes(y.year));

    // Create cumulative monthly data
    const allMonths = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    const datasets = filteredYears.map((yearData, idx) => {
      const colors = [
        'rgb(59, 130, 246)',
        'rgb(16, 185, 129)',
        'rgb(147, 51, 234)',
        'rgb(249, 115, 22)',
        'rgb(236, 72, 153)'
      ];

      let cumulative = 0;
      const cumulativeData = allMonths.map(month => {
        const key = `${yearData.year}-${month}`;
        const monthData = yearData.byMonth?.[key];
        cumulative += monthData?.ca_ht || 0;
        return cumulative;
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
                        <td className="px-6 py-3 text-sm text-slate-500">{inv.date}</td>
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
            <h3 className="text-sm font-semibold text-slate-800 mb-4">Sélectionner les années à comparer</h3>
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
    { id: "tracking", label: "Tracking", icon: "🚚" },
    { id: "envois", label: "Envois", icon: "📮" },
    { id: "analytics", label: "Analytics", icon: "📊" },
    { id: "analytics-sheet", label: "Analytics Excel", icon: "📈" },
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
      {tab === "tracking" && <FacturesTracking showToast={showToast} />}
      {tab === "envois" && <FacturesShipments showToast={showToast} />}
      {tab === "analytics" && <FacturesAnalytics showToast={showToast} />}
      {tab === "analytics-sheet" && <AnalyticsSpreadsheet showToast={showToast} />}
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

  if (!products.length) {
    throw new Error("Aucun produit détecté dans le PDF. Si c'est un PDF scanné (image), il faut l'Excel ou un PDF texte.");
  }

  return { products };
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
  const [useCurrentPrices, setUseCurrentPrices] = useState(false);
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
        showToast('Parsing PDF position-based en cours...', 'info');
        console.log('📄 Parsing PDF avec logique position-based (X/Y)');

        const data = await parsePdfOrder(file);
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

  const downloadCSVAndEmail = async (isSample = false) => {
    try {
      const token = sessionStorage.getItem('tdm_token') || window.AUTH_TOKEN || '';
      const invoiceData = { ...result, products: calculation?.products || matchedProducts, orderNumber };
      const res = await fetch(window.location.origin + '/api/factures/csv-logisticien', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceData, client: selectedClient, shippingId }),
      });
      const blob = await res.blob();
      const fileName = `logisticien-${result?.number || 'facture'}.csv`;

      // Essayer File System Access API avec mémorisation du dossier
      let saved = false;
      if (window.showDirectoryPicker) {
        try {
          // Essayer de récupérer le handle sauvegardé
          let dirHandle = null;
          const savedHandleName = localStorage.getItem('csvDirHandleName');

          if (savedHandleName && window.savedCSVDirHandle) {
            try {
              // Vérifier les permissions
              const permission = await window.savedCSVDirHandle.queryPermission({ mode: 'readwrite' });
              if (permission === 'granted' || await window.savedCSVDirHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
                dirHandle = window.savedCSVDirHandle;
                console.log('📁 Réutilisation du dossier:', savedHandleName);
              }
            } catch (e) {
              console.log('📁 Handle sauvegardé invalide, demande nouveau dossier');
            }
          }

          // Si pas de handle valide, demander à l'utilisateur
          if (!dirHandle) {
            dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            window.savedCSVDirHandle = dirHandle;
            localStorage.setItem('csvDirHandleName', dirHandle.name);
            console.log('📁 Nouveau dossier mémorisé:', dirHandle.name);
          }

          // Sauvegarder le fichier
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast(`✅ CSV sauvé: ${dirHandle.name}/${fileName}`, 'success');
          saved = true;
        } catch (fsErr) {
          if (fsErr.name !== 'AbortError') {
            console.warn('File System Access fallback:', fsErr);
            delete window.savedCSVDirHandle;
            localStorage.removeItem('csvDirHandleName');
          }
        }
      }

      // Fallback : download classique
      if (!saved) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
        showToast('CSV téléchargé', 'success');
      }

      // Ouvrir mailto logisticien avec bon objet
      const clientName = selectedClient?.name || '';
      const invoiceNum = orderNumber || result?.number || '';
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
                        products: calculation.products.map(p => ({ ...p, prix_ht: undefined, priceHT: undefined })),
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {calculation.products?.map((p, i) => {
                      const qty = p.quantite || p.quantity || 1;
                      const unitPrice = (p.total_ht || 0) / qty;
                      const discount = p.discount || 0;
                      return (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-900">{p.ref}</div>
                            <div className="text-xs text-slate-500">{p.nom}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-700">{qty}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-700">{unitPrice.toFixed(2)}€</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-500">{discount > 0 ? `-${discount}%` : '—'}</td>
                          <td className="px-3 py-2 text-right font-mono font-medium text-slate-900">{(p.total_ht || 0).toFixed(2)}€</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {calculation.frais_port?.map((f, i) => (
                <div key={'fp'+i} className="flex items-center justify-between text-sm py-1 text-slate-500">
                  <span className="flex-1">{f.nom}</span>
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.01" min="0" value={f.prix_ht}
                      onChange={e => {
                        const newFrais = [...calculation.frais_port];
                        newFrais[i] = { ...newFrais[i], prix_ht: parseFloat(e.target.value) || 0 };
                        setCalculation({ ...calculation, frais_port: newFrais });
                      }}
                      className="w-20 border border-slate-200 rounded px-2 py-0.5 text-sm text-right font-mono" />
                    <span className="text-xs">€ HT</span>
                    <button onClick={() => {
                      const newFrais = calculation.frais_port.filter((_, idx) => idx !== i);
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
      const blob = await res.blob();
      const fileName = `logisticien-${result?.number || 'proforma'}.csv`;

      // Essayer File System Access API avec mémorisation du dossier
      let saved = false;
      if (window.showDirectoryPicker) {
        try {
          // Essayer de récupérer le handle sauvegardé
          let dirHandle = null;
          const savedHandleName = localStorage.getItem('csvDirHandleName');

          if (savedHandleName && window.savedCSVDirHandle) {
            try {
              const permission = await window.savedCSVDirHandle.queryPermission({ mode: 'readwrite' });
              if (permission === 'granted' || await window.savedCSVDirHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
                dirHandle = window.savedCSVDirHandle;
                console.log('📁 Réutilisation du dossier:', savedHandleName);
              }
            } catch (e) {
              console.log('📁 Handle sauvegardé invalide, demande nouveau dossier');
            }
          }

          // Si pas de handle valide, demander à l'utilisateur
          if (!dirHandle) {
            dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            window.savedCSVDirHandle = dirHandle;
            localStorage.setItem('csvDirHandleName', dirHandle.name);
            console.log('📁 Nouveau dossier mémorisé:', dirHandle.name);
          }

          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          showToast(`✅ CSV sauvé: ${dirHandle.name}/${fileName}`, 'success');
          saved = true;
        } catch (fsErr) {
          if (fsErr.name !== 'AbortError') {
            console.warn('File System Access fallback:', fsErr);
            delete window.savedCSVDirHandle;
            localStorage.removeItem('csvDirHandleName');
          }
        }
      }

      if (!saved) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        URL.revokeObjectURL(url);
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

// ─── Modal Ajout Manuel d'Envoi ──────────────────────────────────────────────
const ModalAddShipment = ({ isOpen, onClose, onAdded, showToast }) => {
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
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
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
    if (!confirm('Supprimer cet envoi ?')) return;
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
                    <td className="px-4 py-3 text-xs text-slate-500">{new Date(s.created_at).toLocaleDateString('fr-FR')}</td>
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
