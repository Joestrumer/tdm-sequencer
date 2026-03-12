const { useState, useEffect, useRef } = React;

// ─── API BACKEND (remplace les données démo) ──────────────────────────────────
const api = window.tdmApi;


// ─── DONNÉES DE DÉMO ─────────────────────────────────────────────────────────

const DEMO_LEADS = [
  { id: 1, prenom: "Sophie", nom: "Lefebvre", hotel: "Hôtel Le Bristol", ville: "Paris", email: "s.lefebvre@bristol.fr", segment: "5*", tags: ["hôtel 5*", "luxe", "Paris"], statut: "En séquence", sequence: "Prospection 5*", etape: 2, ouvertures: 3, dernierContact: "2024-01-15", score: 85 },
  { id: 2, prenom: "Marc", nom: "Dubois", hotel: "Château de Bagnols", ville: "Lyon", email: "m.dubois@bagnols.com", segment: "5*", tags: ["hôtel 5*", "château"], statut: "Répondu", sequence: "Prospection 5*", etape: 2, ouvertures: 5, dernierContact: "2024-01-14", score: 96 },
  { id: 3, prenom: "Claire", nom: "Martin", hotel: "Le Bon Marché", ville: "Paris", email: "c.martin@lebonmarche.fr", segment: "Retail", tags: ["grand magasin", "retail premium"], statut: "En séquence", sequence: "Relance Retailers", etape: 1, ouvertures: 2, dernierContact: "2024-01-13", score: 62 },
  { id: 4, prenom: "Thomas", nom: "Bernard", hotel: "Hôtel Barrière Deauville", ville: "Deauville", email: "t.bernard@barriere.fr", segment: "5*", tags: ["hôtel 5*", "SPA"], statut: "Nouveau", sequence: null, etape: 0, ouvertures: 0, dernierContact: null, score: 70 },
  { id: 5, prenom: "Isabelle", nom: "Rousseau", hotel: "Concept Store Merci", ville: "Paris", email: "i.rousseau@merci.fr", segment: "Retail", tags: ["concept store", "retail"], statut: "Converti", sequence: "Relance Retailers", etape: 3, ouvertures: 8, dernierContact: "2024-01-10", score: 100 },
  { id: 6, prenom: "Antoine", nom: "Moreau", hotel: "Hôtel Negresco", ville: "Nice", email: "a.moreau@negresco.com", segment: "5*", tags: ["hôtel 5*", "luxe", "Côte d'Azur"], statut: "En séquence", sequence: "Prospection 5*", etape: 3, ouvertures: 4, dernierContact: "2024-01-12", score: 78 },
  { id: 7, prenom: "Lucie", nom: "Fontaine", hotel: "Spa Sisley Paris", ville: "Paris", email: "l.fontaine@sisley-spa.fr", segment: "SPA", tags: ["SPA", "luxe"], statut: "Désabonné", sequence: null, etape: 0, ouvertures: 1, dernierContact: "2024-01-05", score: 0 },
  { id: 8, prenom: "Pierre", nom: "Garnier", hotel: "Hôtel du Cap Eden Roc", ville: "Antibes", email: "p.garnier@edenroc.fr", segment: "5*", tags: ["hôtel 5*", "luxe", "MICE"], statut: "En séquence", sequence: "Prospection 5*", etape: 1, ouvertures: 1, dernierContact: "2024-01-16", score: 55 },
];

const DEMO_SEQUENCES = [
  {
    id: 1, nom: "Prospection Hôtels 5*", segment: "5*", leadsActifs: 24, etapes: [
      { jour: 0, sujet: "Découvrez Terre de Mars — cosmétiques naturels certifiés pour l'hôtellerie de luxe", corps: "Bonjour {{prenom}},\n\nJe me permets de vous contacter car {{hotel}} incarne exactement les valeurs que Terre de Mars défend : l'excellence, l'authenticité et le respect de l'environnement.\n\nTerre de Mars est une marque française de cosmétiques naturels certifiée Ecocert Cosmos et PETA Vegan, présente dans plus de 400 établissements hôteliers premium.\n\nNos produits de soin rechargeables répondent aux enjeux RSE de l'hôtellerie de luxe tout en offrant une expérience client mémorable.\n\nSeriez-vous disponible pour un échange de 20 minutes cette semaine ?\n\nBien cordialement,\nJoe\nTerre de Mars" },
      { jour: 3, sujet: "Hôtel Barrière, Four Seasons... ils ont choisi Terre de Mars — et vous ?", corps: "Bonjour {{prenom}},\n\nFaisant suite à mon message, je souhaitais partager quelques retours de nos partenaires hôteliers.\n\nLe groupe Barrière et plusieurs Palace parisiens utilisent nos amenities depuis 2022 avec d'excellents retours clients — notamment sur la réduction des déchets plastiques (-73%) et la satisfaction des notes TripAdvisor.\n\nNos certifications Ecocert Cosmos, PETA et RSPO témoignent de notre engagement sans compromis.\n\nJe serais ravi de vous envoyer un kit d'échantillons gratuit pour {{hotel}}.\n\nCordialement,\nJoe" },
      { jour: 7, sujet: "Kit d'échantillons offert — spécialement pour {{hotel}}", corps: "Bonjour {{prenom}},\n\nJe me permets de revenir vers vous avec une proposition concrète.\n\nNous proposons aux établissements sélectionnés un kit découverte complet (valeur 85€) incluant nos meilleures références en format hôtelier, accompagné d'une analyse personnalisée de la consommation.\n\nCette offre est valable pour {{hotel}} jusqu'à la fin du mois.\n\nIl suffit de répondre à cet email pour que je prépare votre sélection.\n\nBien à vous,\nJoe" },
      { jour: 14, sujet: "Dernier contact — Terre de Mars × {{hotel}}", corps: "Bonjour {{prenom}},\n\nJe ne veux pas vous importuner davantage, mais je tenais à vous laisser nos ressources avant de clore ce fil.\n\n→ Catalogue digital : terre-de-mars.com/catalogue\n→ Livre blanc RSE hôtelier : terre-de-mars.com/rse\n\nSi la question se repose pour {{hotel}} dans les prochains mois, n'hésitez pas à me recontacter directement.\n\nÀ bientôt peut-être,\nJoe\nTerre de Mars" },
    ]
  },
  {
    id: 2, nom: "Relance Retailers Premium", segment: "Retail", leadsActifs: 11, etapes: [
      { jour: 0, sujet: "Terre de Mars chez {{hotel}} — une collaboration évidente", corps: "Bonjour {{prenom}},\n\nTerre de Mars est aujourd'hui référencée au Bon Marché, chez Saks 5th Avenue et dans les plus beaux concept stores européens.\n\nNotre univers — cosmétiques naturels certifiés, design épuré, packaging rechargeable — s'adresse parfaitement à une clientèle exigeante et écoresponsable.\n\nJe serais ravi d'explorer une collaboration avec {{hotel}}.\n\nDisponible pour un appel cette semaine ?\n\nCordialement,\nJoe — Terre de Mars" },
      { jour: 5, sujet: "Le Bon Marché : +34% de sell-through en 6 mois avec Terre de Mars", corps: "Bonjour {{prenom}},\n\nPour donner suite à mon précédent message, voici quelques chiffres concrets.\n\nDepuis notre référencement au Bon Marché (2022), les performances ont dépassé nos projections initiales avec un taux de réachat de 67% et une clientèle internationale fortement sensible à nos certifications.\n\nPour {{hotel}}, je pense qu'un assortiment de 8 à 12 références pourrait s'intégrer naturellement à votre offre beauté.\n\nJe peux vous envoyer notre book retailer avec les conditions commerciales.\n\nBien cordialement,\nJoe" },
      { jour: 10, sujet: "Showroom Paris ou call découverte — à vous de choisir", corps: "Bonjour {{prenom}},\n\nDernière tentative de ma part — promis !\n\nNous organisons régulièrement des présentations dans notre showroom parisien (Marais) et des calls découverte de 30 minutes pour les acheteurs qui souhaitent aller à l'essentiel.\n\nLequel vous conviendrait le mieux ?\n\nJoe\nTerre de Mars — 07 XX XX XX XX" },
    ]
  },
];

const DEMO_ACTIVITES = [
  { id: 1, type: "ouverture", lead: "Sophie Lefebvre", action: "a ouvert l'email #2", temps: "il y a 2h", icon: "👁" },
  { id: 2, type: "reponse", lead: "Marc Dubois", action: "a répondu à votre séquence", temps: "il y a 4h", icon: "💬" },
  { id: 3, type: "clic", lead: "Antoine Moreau", action: "a cliqué sur le catalogue", temps: "il y a 6h", icon: "🔗" },
  { id: 4, type: "ouverture", lead: "Pierre Garnier", action: "a ouvert l'email #1 (3x)", temps: "il y a 8h", icon: "🔥" },
  { id: 5, type: "envoye", lead: "Claire Martin", action: "Email #2 envoyé", temps: "ce matin", icon: "📤" },
  { id: 6, type: "converti", lead: "Isabelle Rousseau", action: "Deal créé dans HubSpot", temps: "hier", icon: "🎯" },
];

const CHART_DATA = [
  { jour: "Lun", envoyes: 12, ouverts: 7, reponses: 2 },
  { jour: "Mar", envoyes: 18, ouverts: 11, reponses: 3 },
  { jour: "Mer", envoyes: 15, ouverts: 8, reponses: 1 },
  { jour: "Jeu", envoyes: 22, ouverts: 14, reponses: 4 },
  { jour: "Ven", envoyes: 19, ouverts: 12, reponses: 5 },
  { jour: "Sam", envoyes: 6, ouverts: 4, reponses: 1 },
  { jour: "Dim", envoyes: 3, ouverts: 2, reponses: 0 },
];

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

const MiniChart = ({ data }) => {
  const max = Math.max(...data.map(d => d.envoyes));
  const w = 320, h = 80, pad = 4;
  const points = (key, color) => {
    const pts = data.map((d, i) => {
      const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
      const y = h - pad - (d[key] / max) * (h - 2 * pad);
      return `${x},${y}`;
    }).join(" ");
    return <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 80 }}>
      <defs>
        <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {points("envoyes", "#94a3b8")}
      {points("ouverts", "#3b82f6")}
      {points("reponses", "#10b981")}
    </svg>
  );
};

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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Ajouter un lead</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
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
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
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
        <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3">
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
      // 2. Si "envoyer maintenant" → forcer le scheduler
      if (sendNow) {
        const r = await api.post('/sequences/trigger-now', {});
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Lancer une séquence</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6">
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
        <div className="px-6 py-4 bg-slate-50 flex flex-col gap-2">
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

// ─── Signature Hugo (HTML complet) ───────────────────────────────────────────
const SIGNATURE_HTML = `<br><br><table cellpadding="0" cellspacing="0" border="0" style="vertical-align:-webkit-baseline-middle;font-size:small;font-family:Arial"><tbody><tr><td><h2 style="margin:0;font-size:16px;font-family:Arial;color:#000;font-weight:600">Hugo Montiel</h2><p style="margin:0;color:#000;font-size:12px;line-height:20px">Sales Director</p><p style="margin:0;font-weight:500;color:#000;font-size:12px;line-height:20px">Terre De Mars</p></td><td width="15"></td><td width="1" style="width:1px;border-left:1px solid #aa8d3e"></td><td width="15"></td><td><table cellpadding="0" cellspacing="0" border="0"><tbody><tr style="height:25px"><td width="30"><span style="display:inline-block;background:#aa8d3e"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/phone-icon-dark-2x.png" width="13" style="display:block"></span></td><td><a href="tel:+33685820335" style="text-decoration:none;color:#000;font-size:12px">+33685820335</a></td></tr><tr style="height:25px"><td width="30"><span style="display:inline-block;background:#aa8d3e"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/email-icon-dark-2x.png" width="13" style="display:block"></span></td><td><a href="mailto:hugo@terredemars.com" style="text-decoration:none;color:#000;font-size:12px">hugo@terredemars.com</a></td></tr><tr style="height:25px"><td width="30"><span style="display:inline-block;background:#aa8d3e"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/link-icon-dark-2x.png" width="13" style="display:block"></span></td><td><a href="https://www.terredemars.com/" style="text-decoration:none;color:#000;font-size:12px">terredemars.com</a></td></tr><tr style="height:25px"><td width="30"><span style="display:inline-block;background:#aa8d3e"><img src="https://cdn2.hubspot.net/hubfs/53/tools/email-signature-generator/icons/address-icon-dark-2x.png" width="13" style="display:block"></span></td><td><span style="font-size:12px;color:#000">2 Rue de Vienne, 75008 Paris</span></td></tr></tbody></table></td></tr></tbody></table><br><table cellpadding="0" cellspacing="0" border="0" style="width:100%"><tbody><tr><td><img src="https://26199813.fs1.hubspotusercontent-eu1.net/hubfs/26199813/Screenshot%202023-01-17%20at%2012.55.44.png" width="130" style="display:block"></td><td style="text-align:right"><a href="https://calendly.com/hugo-montiel/meeting-terre-de-mars" style="border:6px 12px solid #aa8d3e;background:#aa8d3e;color:#fff;font-weight:700;text-decoration:none;padding:8px 16px;border-radius:3px;font-size:12px">Prendre rendez-vous</a></td></tr></tbody></table>`;

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

  const addEtape = () => setEtapes(e => [...e, { jour: (e[e.length-1]?.jour || 0) + 7, sujet: "", corps: "" }]);
  const removeEtape = (i) => { if (etapes.length > 1) { setEtapes(e => e.filter((_, idx) => idx !== i)); setActiveEtape(Math.max(0, i-1)); }};
  const updateEtape = (i, k, v) => setEtapes(e => e.map((et, idx) => idx === i ? { ...et, [k]: v } : et));

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
  const envoyes = stats?.emails_envoyes_total || leads.filter(l => l.etape > 0).length * 4;
  const tOuverture = stats?.taux_ouverture || Math.round((leads.filter(l => l.ouvertures > 0).length / Math.max(leads.length, 1)) * 100);
  const tReponse = stats?.taux_reponse || Math.round((leads.filter(l => l.statut === "Répondu" || l.statut === "Converti").length / Math.max(leads.length, 1)) * 100);
  const convertis = stats?.leads_convertis || leads.filter(l => l.statut === "Converti").length;
  const chauds = leads.filter(l => (l.ouvertures >= 3 || l.score >= 80) && l.statut === "En séquence");

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Emails envoyés", value: envoyes, sub: "ce mois", color: "text-slate-900" },
          { label: "Taux d'ouverture", value: `${tOuverture}%`, sub: "↑ +4% vs semaine dernière", color: "text-blue-600" },
          { label: "Taux de réponse", value: `${tReponse}%`, sub: "industrie : ~8%", color: "text-emerald-600" },
          { label: "Conversions", value: convertis, sub: "ce mois", color: "text-amber-600" },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">{label}</div>
            <div className={`text-3xl font-bold ${color} mb-1`}>{value}</div>
            <div className="text-xs text-slate-400">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-800">Performance 7 derniers jours</h3>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-300 inline-block rounded" />Envoyés</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block rounded" />Ouverts</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block rounded" />Réponses</span>
            </div>
          </div>
          <MiniChart data={CHART_DATA} />
          <div className="flex justify-between mt-2">
            {CHART_DATA.map(d => <span key={d.jour} className="text-xs text-slate-400">{d.jour}</span>)}
          </div>
        </div>

        {/* Activité récente */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-4">Activité récente</h3>
          <div className="space-y-3">
            {activites.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-start gap-2.5">
                <span className="text-base leading-none mt-0.5">{a.icon}</span>
                <div className="min-w-0">
                  <p className="text-xs text-slate-700 leading-snug">
                    <span className="font-medium">{a.lead}</span> {a.action}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{a.temps}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Leads chauds */}
      {chauds.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span>🔥</span>
            <h3 className="text-sm font-semibold text-amber-800">Leads chauds — à contacter maintenant</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {chauds.map(l => (
              <div key={l.id} className="bg-white rounded-xl p-3 border border-amber-100">
                <div className="font-medium text-slate-800 text-sm">{l.prenom} {l.nom}</div>
                <div className="text-xs text-slate-500">{l.hotel}</div>
                <div className="text-xs text-amber-600 mt-1">👁 {l.ouvertures} ouvertures · Pas de réponse</div>
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Modifier le lead</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="p-6 space-y-3">
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
        <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Annuler</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50">{saving ? "Sauvegarde..." : "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
};

// ─── VueLeads ──────────────────────────────────────────────────────────────
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
  const [hsDetails, setHsDetails] = useState(null);
  const [loadingHs, setLoadingHs] = useState(false);
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

  const ouvrirDetail = (lead) => {
    setSelectedLead(selectedLead?.id === lead.id ? null : lead);
    setHsDetails(null);
    if (lead.hubspot_id) chargerHubspot(lead);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {showAdd && <ModalAddLead onClose={() => setShowAdd(false)} onAdd={(l) => { onAdd(l); if(onRefresh) onRefresh(); }} />}
      {showLaunch && <ModalLaunchSequence lead={showLaunch} sequences={sequences} onClose={() => setShowLaunch(null)} onLaunch={onLaunch} />}
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
          <button onClick={() => csvRef.current?.click()} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 whitespace-nowrap">
            {importStatus || "📥 Import CSV"}
          </button>
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
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                {["Lead", "Établissement", "Séquence", "Score", "Statut", ""].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead, i) => (
                <tr key={lead.id} className={`group border-b border-slate-50 hover:bg-blue-50/30 transition-colors ${i === filtered.length-1 ? "border-0" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800 text-sm">{lead.prenom} {lead.nom}</div>
                    <div className="text-xs text-slate-400">{lead.email}</div>
                    {lead.hubspot_id && <span className="text-xs text-orange-500">● HS</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-slate-700">{lead.hotel}</div>
                    <div className="text-xs text-slate-400">{lead.ville}{lead.segment ? <span className="ml-1 text-slate-300">· {lead.segment}</span> : ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    {lead.sequence
                      ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md">Email {(lead.etape||0)+1}</span>
                      : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 w-24"><ScoreBar score={lead.score} /></td>
                  <td className="px-4 py-3">
                    <select value={lead.statut} onChange={e => changerStatut(lead, e.target.value)}
                      className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none cursor-pointer">
                      {Object.keys(STATUT_CONFIG).map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {lead.statut === "Nouveau" && (
                        <button onClick={() => setShowLaunch(lead)} title="Lancer séquence" className="px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700">▶</button>
                      )}
                      <button onClick={() => ouvrirDetail(lead)} title="Détail" className="px-2 py-1 text-xs border border-slate-200 text-slate-600 rounded-md hover:bg-slate-50">👁</button>
                      <button onClick={() => setEditLead(lead)} title="Modifier" className="px-2 py-1 text-xs border border-slate-200 text-slate-600 rounded-md hover:bg-slate-50">✏️</button>
                      <button onClick={() => supprimerLead(lead)} title="Supprimer" className="px-2 py-1 text-xs border border-red-100 text-red-400 rounded-md hover:bg-red-50">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Aucun lead trouvé</div>}
        </div>
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
                    <div key={lead.id} className="bg-white rounded-xl border border-slate-100 p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => ouvrirDetail(lead)}>
                      <div className="font-medium text-slate-800 text-sm">{lead.prenom} {lead.nom}</div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">{lead.hotel}</div>
                      <div className="text-xs text-slate-400">{lead.ville}{lead.segment ? <span className="ml-1">· {lead.segment}</span> : ""}</div>
                      {lead.sequence && <div className="text-xs text-blue-600 mt-1 truncate">📧 Email {(lead.etape||0)+1}</div>}
                      <div className="flex items-center justify-between mt-2">
                        <ScoreBar score={lead.score} />
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {lead.statut === "Nouveau" && <button onClick={() => setShowLaunch(lead)} className="text-xs text-blue-500 hover:text-blue-700 px-1">▶</button>}
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
          <div className="flex items-start justify-between p-5 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-base font-semibold text-slate-900">{selectedLead.prenom} {selectedLead.nom}</h3>
                <Badge statut={selectedLead.statut} />
                {selectedLead.hubspot_id && (
                  <a href={`https://app.hubspot.com/contacts/26199813/contact/${selectedLead.hubspot_id}`} target="_blank" className="text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full hover:bg-orange-100">HubSpot ↗</a>
                )}
              </div>
              <p className="text-sm text-slate-500 mt-0.5">{selectedLead.hotel} · {selectedLead.ville} · {selectedLead.segment}</p>
              <p className="text-xs text-slate-400 mt-0.5">{selectedLead.email}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => setEditLead(selectedLead)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-50">✏️ Éditer</button>
              <button onClick={() => supprimerLead(selectedLead)} className="px-3 py-1.5 text-xs border border-red-100 text-red-400 rounded-lg hover:bg-red-50">Supprimer</button>
              <button onClick={() => setSelectedLead(null)} className="text-slate-400 hover:text-slate-600 text-xl ml-1">×</button>
            </div>
          </div>

          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Gauche — infos & stats */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[["Ouvertures", selectedLead.ouvertures||0], ["Score", selectedLead.score||50], ["Étape", selectedLead.etape > 0 ? `Email ${selectedLead.etape}` : "—"], ["Séquence", selectedLead.sequence||"—"]].map(([k,v]) => (
                  <div key={k} className="bg-slate-50 rounded-xl p-3">
                    <div className="text-xs text-slate-400 mb-1">{k}</div>
                    <div className="text-sm font-medium text-slate-800">{v}</div>
                  </div>
                ))}
              </div>
              {selectedLead.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedLead.tags.map(t => <span key={t} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{t}</span>)}
                </div>
              )}
              {selectedLead.statut === "Nouveau" && (
                <button onClick={() => setShowLaunch(selectedLead)} className="w-full py-2 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors">▶ Lancer une séquence</button>
              )}
            </div>

            {/* Droite — HubSpot */}
            <div>
              {selectedLead.hubspot_id ? (
                <div className="border border-orange-100 rounded-xl p-4 bg-orange-50/30 h-full">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-slate-800">HubSpot CRM</span>
                    <button onClick={() => chargerHubspot(selectedLead)} className="text-xs text-orange-600 hover:underline">↻ Actualiser</button>
                  </div>
                  {loadingHs ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400"><span className="w-3 h-3 border-2 border-slate-200 border-t-orange-400 rounded-full animate-spin" /> Chargement HubSpot...</div>
                  ) : hsDetails ? (
                    <div className="space-y-4">
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Deals ({hsDetails.deals?.length||0})</div>
                        {!hsDetails.deals?.length
                          ? <p className="text-xs text-slate-300 italic">Aucun deal</p>
                          : hsDetails.deals.map((d, i) => (
                            <div key={i} className="bg-white rounded-lg p-2 mb-1.5 border border-orange-100">
                              <div className="text-xs font-medium text-slate-800">{d.properties?.dealname || d.nom || "Deal"}</div>
                              <div className="flex gap-2 text-xs text-slate-400 mt-0.5">
                                <span>{d.properties?.dealstage || d.stage || ""}</span>
                                {(d.properties?.amount || d.montant) && <span className="text-emerald-600 font-medium">{d.properties?.amount || d.montant}€</span>}
                              </div>
                            </div>
                          ))
                        }
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Notes ({hsDetails.notes?.length||0})</div>
                        {!hsDetails.notes?.length
                          ? <p className="text-xs text-slate-300 italic">Aucune note</p>
                          : hsDetails.notes.slice(0, 4).map((n, i) => (
                            <div key={i} className="bg-white rounded-lg p-2 mb-1.5 border border-orange-100">
                              <div className="text-xs text-slate-600 line-clamp-2">{n.properties?.hs_note_body || n.corps || n.body || ""}</div>
                              <div className="text-xs text-slate-400 mt-0.5">{n.properties?.hs_lastmodifieddate ? new Date(n.properties.hs_lastmodifieddate).toLocaleDateString("fr-FR") : (n.date||"")}</div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  ) : <p className="text-xs text-slate-400">Cliquez ↻ pour charger</p>}
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center gap-2 h-full text-center">
                  <p className="text-xs text-slate-400">Non synchronisé avec HubSpot</p>
                  <button onClick={async () => {
                    await api.post(`/hubspot/sync-lead/${selectedLead.id}`);
                    if (onRefresh) onRefresh();
                  }} className="px-3 py-1.5 text-xs bg-orange-500 text-white rounded-lg hover:bg-orange-600">Synchroniser maintenant</button>
                </div>
              )}
            </div>
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
                  <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{etape.corps?.split("\n")[0]}</div>
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

    setBulkLoading(true); setBulkResults([]); setBulkProgress(0);
    setBulkTotal(toVerify.length); setBulkErreur("");

    const results = [];
    for (let i = 0; i < toVerify.length; i++) {
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
    chargerCredits();
    if (onRefresh) onRefresh();
  };

  const stopBulk = () => setBulkLoading(false);

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
      const [leadsData, seqData, statsData] = await Promise.all([
        api.get('/leads'),
        api.get('/sequences'),
        api.get('/stats/dashboard'),
      ]);
      setLeads(Array.isArray(leadsData) ? leadsData : (leadsData.leads || []));
      setSequences(Array.isArray(seqData) ? seqData : (seqData.sequences || []));
      setStats(statsData);
      if (statsData?.activites_recentes) setActivites(statsData.activites_recentes);
    } catch(e) { console.error("Erreur chargement:", e); }
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);

  // Normaliser les séquences depuis l'API (jour_delai → jour)
  const sequencesNorm = sequences.map(s => ({
    ...s,
    leadsActifs: s.leads_actifs || s.leadsActifs || 0,
    etapes: (s.etapes || []).map(e => ({ ...e, jour: e.jour_delai ?? e.jour ?? 0 }))
  }));

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
