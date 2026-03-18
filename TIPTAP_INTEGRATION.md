# Intégration Tiptap - Documentation

## Vue d'ensemble

L'éditeur email a été migré de `contentEditable` vers **Tiptap**, un éditeur riche moderne basé sur ProseMirror qui génère du JSON propre et structuré.

## Modifications apportées

### 1. Fichiers modifiés

#### `/public/index.html`
- Ajout du script Tiptap bundle : `<script src="/tiptap-bundle.js"></script>`
- Ajout des styles CSS pour l'éditeur Tiptap (`.ProseMirror`)
- Suppression des anciens styles `[contenteditable]`

#### `/public/app.jsx` - Composant `ModalEmailEditor`
- **Supprimé** : `corpsRef`, `fmt()`, `syncCorps()`
- **Ajouté** : Configuration de l'éditeur Tiptap avec extensions email-safe
- **Modifié** : Toolbar complète avec boutons actifs/inactifs
- **Modifié** : `insererVar()` adapté pour Tiptap
- **Modifié** : `useEffect` pour charger le contenu depuis `content_json` ou `corps_html`

#### `/src/tiptap-bundle.js` (nouveau)
- Bundle source pour Tiptap et ses extensions
- Expose `window.TiptapReact` et `window.TiptapExtensions`

#### `/public/tiptap-bundle.js` (généré)
- Bundle compilé par esbuild (842KB)
- Contient tous les modules Tiptap nécessaires

### 2. Extensions Tiptap utilisées

#### StarterKit (configuré)
- ✅ `heading` (niveaux 1, 2, 3)
- ✅ `bulletList` (listes à puces)
- ✅ `orderedList` (listes numérotées)
- ✅ `bold` (gras)
- ✅ `italic` (italique)
- ✅ `hardBreak` (saut de ligne)
- ✅ `paragraph` (paragraphes)
- ❌ `strike` (barré - désactivé pour email)
- ❌ `code` (code inline - désactivé)
- ❌ `codeBlock` (bloc de code - désactivé)
- ❌ `blockquote` (citation - désactivé)
- ❌ `horizontalRule` (séparateur - désactivé)

#### Extensions supplémentaires
- ✅ `Underline` - Soulignement
- ✅ `TextStyle` - Styles de texte
- ✅ `Color` - Couleur du texte
- ✅ `TextAlign` - Alignement (gauche, centre, droite)
- ✅ `Link` - Liens hypertextes
- ✅ `Placeholder` - Texte placeholder

### 3. Toolbar buttons

La toolbar affiche les boutons suivants :

1. **Formatage de base** : B (gras), I (italique), U (souligné)
2. **Titres** : H1, H2
3. **Listes** : • (puces), 1. (numérotée)
4. **Alignement** : ⬅ (gauche), ↔ (centre), ➡ (droite)
5. **Lien** : 🔗 (ajouter lien) + ✕ (retirer lien si actif)
6. **Variables** : `{{prenom}}`, `{{hotel}}`, `{{ville}}`, `{{segment}}`

Les boutons actifs ont un fond gris (`bg-slate-200`) pour indiquer l'état actuel.

### 4. Stockage des données

#### Format JSON (nouveau)
L'éditeur génère et stocke un JSON Tiptap dans `etape.content_json` :

```json
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "attrs": { "textAlign": "left" },
      "content": [
        { "type": "text", "text": "Bonjour " },
        { "type": "text", "marks": [{"type": "bold"}], "text": "{{prenom}}" }
      ]
    }
  ]
}
```

#### Rétrocompatibilité
- L'éditeur charge d'abord depuis `content_json` (si disponible)
- Sinon, il fallback vers `corps_html`
- L'éditeur sauvegarde toujours les deux formats :
  - `content_json` : JSON structuré pour Tiptap
  - `corps_html` : HTML pour compatibilité et envoi d'emails

### 5. Workflow de sauvegarde

1. L'utilisateur tape dans l'éditeur
2. `onUpdate` est déclenché automatiquement
3. Le JSON est généré : `editor.getJSON()`
4. Le HTML est généré : `editor.getHTML()`
5. Les deux sont sauvegardés dans l'étape via `updateEtape()`

### 6. Scripts npm

```bash
# Builder tout (DB + Tiptap)
npm run build

# Builder uniquement la DB
npm run build:db

# Builder uniquement Tiptap
npm run build:tiptap

# Dev : build + start
npm run dev

# Démarrer le serveur
npm start
```

## Installation / Déploiement

### Première installation
```bash
npm install
npm run build
npm start
```

### Après modification des extensions Tiptap
```bash
npm run build:tiptap
```

### Mise à jour des dépendances Tiptap
```bash
npm install @tiptap/react@latest @tiptap/starter-kit@latest # etc.
npm run build:tiptap
```

## Avantages de Tiptap

1. **JSON structuré** : Données propres et faciles à manipuler
2. **Email-safe** : Seules les fonctionnalités compatibles email sont activées
3. **Extensible** : Facile d'ajouter de nouvelles extensions
4. **Moderne** : Basé sur ProseMirror, framework robuste et performant
5. **Accessible** : Meilleure accessibilité que contentEditable brut
6. **Rétrocompatible** : Génère aussi du HTML pour les anciens emails

## Prochaines étapes (optionnel)

1. **Extensions custom email** : Créer des extensions pour boutons CTA, images, dividers
2. **Rendu email optimisé** : Convertir le JSON en HTML inline-styled email-safe
3. **Templates** : Créer des templates JSON pré-configurés
4. **Preview améliorée** : Utiliser le JSON pour une preview plus fidèle

## Dépannage

### Le bundle Tiptap ne se charge pas
- Vérifier que `/public/tiptap-bundle.js` existe (842KB)
- Reconstruire avec `npm run build:tiptap`
- Vérifier la console navigateur pour erreurs

### L'éditeur n'apparaît pas
- Ouvrir la console navigateur
- Vérifier que `window.TiptapReact` et `window.TiptapExtensions` sont définis
- Vérifier qu'il n'y a pas d'erreur React

### Erreur "Cannot read property 'useEditor' of undefined"
- Le bundle Tiptap n'est pas chargé avant le JSX
- S'assurer que `<script src="/tiptap-bundle.js"></script>` est avant `<script type="text/babel" src="/app.jsx"></script>`

## Architecture technique

```
┌─────────────────────────────────────────────────────────────┐
│                        index.html                           │
│  1. React (CDN)                                             │
│  2. Babel standalone (CDN)                                  │
│  3. /tiptap-bundle.js (local, généré par esbuild)           │
│  4. /app.jsx (JSX transpilé par Babel)                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   tiptap-bundle.js                          │
│  - @tiptap/react → window.TiptapReact                       │
│  - @tiptap/extensions → window.TiptapExtensions             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  ModalEmailEditor (React)                   │
│  - useEditor() → initialise l'éditeur                       │
│  - EditorContent → render l'éditeur                         │
│  - Toolbar → boutons de formatage                           │
│  - onUpdate → sauvegarde JSON + HTML                        │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      Stockage                               │
│  etape.content_json : JSON Tiptap                           │
│  etape.corps_html : HTML généré                             │
└─────────────────────────────────────────────────────────────┘
```

## Fichiers créés/modifiés

### Créés
- `/src/tiptap-bundle.js` - Source du bundle
- `/public/tiptap-bundle.js` - Bundle compilé
- `/TIPTAP_INTEGRATION.md` - Cette documentation

### Modifiés
- `/public/index.html` - Ajout du script Tiptap + styles
- `/public/app.jsx` - Remplacement de l'éditeur
- `/package.json` - Ajout des scripts build

### Dépendances ajoutées
- `@tiptap/react` (déjà présent)
- `@tiptap/starter-kit` (déjà présent)
- `@tiptap/extension-underline` (nouveau)
- `@tiptap/extension-text-style` (déjà présent)
- `@tiptap/extension-color` (déjà présent)
- `@tiptap/extension-text-align` (déjà présent)
- `@tiptap/extension-link` (déjà présent)
- `@tiptap/extension-placeholder` (déjà présent)
- `esbuild` (devDependency, nouveau)

---

**Date de création** : 2026-03-18
**Auteur** : Claude Code (Sonnet 4.5)
