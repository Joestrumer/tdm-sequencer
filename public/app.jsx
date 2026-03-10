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
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.email || !form.hotel) return;
    setSaving(true);
    try {
      const lead = await api.post('/leads', { ...form, tags: JSON.stringify([form.segment]) });
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
          <div className="grid grid-cols-2 gap-3">
            {[["prenom","Prénom"],["nom","Nom"]].map(([k,l]) => (
              <div key={k}>
                <label className="text-xs font-medium text-slate-500 mb-1 block">{l}</label>
                <input value={form[k]} onChange={e => set(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
              </div>
            ))}
          </div>
          {[["hotel","Établissement"],["ville","Ville"],["email","Email"]].map(([k,l]) => (
            <div key={k}>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{l}</label>
              <input type={k === "email" ? "email" : "text"} value={form[k]} onChange={e => set(k, e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Segment</label>
            <select value={form.segment} onChange={e => set("segment", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
              {["5*","4*","Boutique","Retail","SPA","Concept Store"].map(s => <option key={s}>{s}</option>)}
            </select>
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
                  <div className="text-xs text-slate-400">{seq.etapes.length} emails · Segment {seq.segment}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Annuler</button>
          <button onClick={() => { onLaunch(lead.id, selected); onClose(); }} className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Lancer ▶</button>
        </div>
      </div>
    </div>
  );
};

const ModalEmailEditor = ({ seq, onClose, onSave }) => {
  const [etapes, setEtapes] = useState(seq ? [...seq.etapes] : [{ jour: 0, sujet: "", corps: "" }]);
  const [nom, setNom] = useState(seq?.nom || "");
  const [activeEtape, setActiveEtape] = useState(0);
  const addEtape = () => setEtapes([...etapes, { jour: (etapes[etapes.length - 1]?.jour || 0) + 7, sujet: "", corps: "" }]);
  const updateEtape = (i, k, v) => setEtapes(etapes.map((e, idx) => idx === i ? { ...e, [k]: v } : e));
  const VARS = ["{{prenom}}", "{{hotel}}", "{{ville}}", "{{segment}}"];
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom de la séquence..." className="text-base font-semibold text-slate-900 focus:outline-none border-b border-transparent focus:border-slate-300 transition-colors bg-transparent" />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-48 border-r border-slate-100 p-3 space-y-1 flex-shrink-0 overflow-y-auto">
            {etapes.map((e, i) => (
              <button key={i} onClick={() => setActiveEtape(i)} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${activeEtape === i ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                <div className="font-medium">Email {i + 1}</div>
                <div className={`text-xs ${activeEtape === i ? "text-slate-300" : "text-slate-400"}`}>J+{e.jour}</div>
              </button>
            ))}
            <button onClick={addEtape} className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors border border-dashed border-slate-200 mt-2">
              + Ajouter
            </button>
          </div>
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-slate-500 w-16 flex-shrink-0">Délai</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">J +</span>
                <input type="number" value={etapes[activeEtape]?.jour} onChange={e => updateEtape(activeEtape, "jour", +e.target.value)} className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
                <span className="text-sm text-slate-400">jours après le précédent</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Objet</label>
              <input value={etapes[activeEtape]?.sujet} onChange={e => updateEtape(activeEtape, "sujet", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" placeholder="Objet de l'email..." />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Corps de l'email</label>
              <textarea rows={10} value={etapes[activeEtape]?.corps} onChange={e => updateEtape(activeEtape, "corps", e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 font-mono leading-relaxed resize-none" />
            </div>
            <div className="flex flex-wrap gap-2">
              {VARS.map(v => (
                <button key={v} onClick={() => updateEtape(activeEtape, "corps", (etapes[activeEtape]?.corps || "") + v)} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs rounded-md font-mono transition-colors">
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Annuler</button>
          <button onClick={() => { onSave({ id: seq?.id || null, nom, etapes, segment: seq?.segment || "5*", leadsActifs: seq?.leadsActifs || 0 }); onClose(); }} className="px-5 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors">Enregistrer</button>
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

const VueLeads = ({ leads, sequences, onAdd, onLaunch }) => {
  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState("Tous");
  const [selectedLead, setSelectedLead] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showLaunch, setShowLaunch] = useState(null);

  const leadsNorm = leads.map(l => ({
    ...l,
    tags: typeof l.tags === "string" ? JSON.parse(l.tags || "[]") : (l.tags || []),
    ouvertures: l.ouvertures || 0,
    score: l.score || 50,
  }));
  const filtered = leadsNorm.filter(l => {
    const matchSearch = `${l.prenom} ${l.nom} ${l.hotel} ${l.ville}`.toLowerCase().includes(search.toLowerCase());
    const matchStatut = filterStatut === "Tous" || l.statut === filterStatut;
    return matchSearch && matchStatut;
  });

  const statuts = ["Tous", ...Object.keys(STATUT_CONFIG)];

  return (
    <div className="space-y-4">
      {showAdd && <ModalAddLead onClose={() => setShowAdd(false)} onAdd={onAdd} />}
      {showLaunch && <ModalLaunchSequence lead={showLaunch} sequences={sequences} onClose={() => setShowLaunch(null)} onLaunch={onLaunch} />}

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {statuts.map(s => (
            <button key={s} onClick={() => setFilterStatut(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterStatut === s ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher..." className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400" />
          <button onClick={() => setShowAdd(true)} className="px-4 py-1.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors whitespace-nowrap">+ Ajouter</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              {["Lead", "Établissement", "Séquence", "Étape", "Score", "Statut", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead, i) => (
              <tr key={lead.id} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i === filtered.length - 1 ? "border-0" : ""}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800 text-sm">{lead.prenom} {lead.nom}</div>
                  <div className="text-xs text-slate-400">{lead.email}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-slate-700">{lead.hotel}</div>
                  <div className="text-xs text-slate-400">{lead.ville}</div>
                </td>
                <td className="px-4 py-3">
                  {lead.sequence ? (
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md">{lead.sequence}</span>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {lead.etape > 0 ? `Email ${lead.etape}` : "—"}
                </td>
                <td className="px-4 py-3"><ScoreBar score={lead.score} /></td>
                <td className="px-4 py-3"><Badge statut={lead.statut} /></td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {lead.statut === "Nouveau" && (
                      <button onClick={() => setShowLaunch(lead)} className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
                        ▶ Lancer
                      </button>
                    )}
                    <button onClick={() => setSelectedLead(selectedLead?.id === lead.id ? null : lead)} className="px-2.5 py-1 text-xs border border-slate-200 text-slate-600 rounded-md hover:bg-slate-50 transition-colors">
                      Détail
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">Aucun lead trouvé</div>
        )}
      </div>

      {selectedLead && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">{selectedLead.prenom} {selectedLead.nom}</h3>
              <p className="text-sm text-slate-500">{selectedLead.hotel} · {selectedLead.ville}</p>
            </div>
            <button onClick={() => setSelectedLead(null)} className="text-slate-400 hover:text-slate-600">×</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {[["Email", selectedLead.email], ["Segment", selectedLead.segment], ["Ouvertures", selectedLead.ouvertures], ["Dernier contact", selectedLead.dernierContact || "Jamais"]].map(([k, v]) => (
              <div key={k} className="bg-slate-50 rounded-xl p-3">
                <div className="text-xs text-slate-400 mb-1">{k}</div>
                <div className="text-sm font-medium text-slate-800">{v}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedLead.tags.map(t => <span key={t} className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{t}</span>)}
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
      // Activités depuis les stats
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
    try {
      await api.post(`/sequences/${seqId}/inscrire`, { lead_id: leadId });
      charger(); // Recharger les données
    } catch(e) { console.error("Erreur lancement séquence:", e); }
  };

  const saveSeq = async (seq) => {
    try {
      if (seq.id) {
        await api.put(`/sequences/${seq.id}`, seq);
      } else {
        await api.post('/sequences', seq);
      }
      charger();
    } catch(e) { console.error("Erreur sauvegarde séquence:", e); }
  };

  const NAV = [
    { id: "dashboard", icon: "📊", label: "Dashboard" },
    { id: "leads", icon: "👥", label: "Leads" },
    { id: "sequences", icon: "📧", label: "Séquences" },
    { id: "hubspot", icon: "🔗", label: "HubSpot" },
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
          {vue === "leads" && <VueLeads leads={leads} sequences={sequencesNorm} onAdd={addLead} onLaunch={launchSequence} />}
          {vue === "sequences" && <VueSequences sequences={sequencesNorm} onNew={() => { setEditSeq(null); setShowSeqEditor(true); }} onEdit={seq => { setEditSeq(seq); setShowSeqEditor(true); }} />}
          {vue === "hubspot" && <VueHubspot />}
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
