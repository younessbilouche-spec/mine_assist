# MineAssist — Patches Sprint 3 (mai 2026, version corrigée)

**Pack d'améliorations N°2** : explicabilité ML, observabilité, dark mode,
i18n, command palette, notifications, page comparaison multi-engins.

> ⚠️ **CORRECTION** : la précédente version du README mentionnait
> `react-router-dom` par erreur. Ton App.jsx utilise une **navigation
> par state** (`activeTab` / `setActiveTab`). **Ne lance PAS**
> `npm install react-router-dom`. Voir `INTEGRATION_APP_JSX.md` pour le
> détail.

> Ce ZIP suit le Sprint 1+2 (`mineassist_patches_sprint1_2.zip`). Il faut
> avoir intégré le précédent **avant** d'appliquer celui-ci, car certains
> fichiers s'appuient sur les routes ajoutées au Sprint 1+2 (`/pred/rul/predict/current`,
> `/pred/rul/alert-class`, `/history/dashboard`).

---

## 0. URGENT — fix prompt Ask "documentation non consultée"

**Problème** : le prompt Ask v2 livré au Sprint 1+2 disait au LLM
*« Réponds prudemment depuis tes connaissances générales en mentionnant que
la source est non documentée. »* — résultat : le LLM bailout systématiquement
même quand la question est légitime (ex : « procédure remplacement filtre
hydraulique »).

**Fix** : 3 niveaux dans ce sprint
1. **Prompt système** complètement réécrit (`improvements.py`) avec :
   - Interdiction absolue de dire « documentation non consultée »
   - Format structuré 5 sections obligatoire (Synthèse / Procédure /
     Outils / Sécurité / Sources)
   - **Base de connaissances CAT 994F embarquée** dans le prompt :
     8 procédures de réflexe (filtres, vidanges, courroie, pneus, etc.)
2. **Note "RAG vide"** réécrite : on ordonne au LLM d'utiliser la base
   embarquée au lieu de bailer.
3. **Retrieval RAG amélioré** (`rag_engine.py`) :
   - Top-K passé de 5 à 10
   - Seuil de distance assoupli (0.78 → 0.95)
   - **Query expansion** : « filtre hydraulique » → ajoute synonymes
     « hydraulic filter, filter element, élément filtrant, cartouche »
   - **Hybrid search** : agrège résultats sémantiques + lexicaux

→ Effets attendus :
- Plus de réponses « documentation non consultée »
- Procédures terrain structurées même quand le PDF n'est pas indexé
- Meilleur recall sur termes techniques précis

---

## 1. Liste des fichiers

### Backend — 4 nouveaux + 2 modifiés

| Fichier | Sprint | Action |
|---|---|---|
| `backend/app/improvements.py` | 1+2 (modifié) | Prompts réécrits, fix bail-out |
| `backend/app/rag_engine.py` | 1+2 (modifié) | Hybrid + query expansion |
| `backend/app/explain_router.py` | **3** | NEW — SHAP, drift, anomaly explain |
| `backend/app/metrics_router.py` | **3** | NEW — `/metrics` Prometheus |
| `backend/app/api.py` | (modifié) | Branche `explain_router` + `metrics_router` |
| `backend/tests/test_smoke.py` | **3** | NEW — 10 tests pytest |

### Frontend — 1 modifié + 7 nouveaux

| Fichier | Sprint | Description |
|---|---|---|
| `frontend/src/main.jsx` | **3 (modifié)** | Wrappe `<App>` avec `I18nProvider` + `ThemeProvider` (sans `react-router-dom`) |
| `frontend/src/components/ThemeProvider.jsx` | **3** | Dark mode + CSS vars |
| `frontend/src/i18n/index.jsx` | **3** | Provider + selector FR/EN/AR |
| `frontend/src/i18n/dict.js` | **3** | Dictionnaires 250 clés × 3 langues |
| `frontend/src/components/CommandPalette.jsx` | **3** | Ctrl+K palette de commandes |
| `frontend/src/components/NotificationsDrawer.jsx` | **3** | Cloche + drawer alertes |
| `frontend/src/components/ArretsHeatmap.jsx` | **3** | Heatmap calendrier 365 jours |
| `frontend/src/pages/ExplicabilityPage.jsx` | **3** | Page SHAP + drift + anomaly |
| `frontend/src/pages/MultiEngineComparison.jsx` | **3** | Comparaison 994F1/F2/F3/F4 |

---

## 2. Application des patches (3 commandes)

```bash
cd ~/mine_assist

# 1. Décompresser le ZIP par-dessus l'arborescence existante
unzip -o ~/Téléchargements/mineassist_patches_sprint3.zip

# 2. Vérifier que les nouveaux fichiers sont là
ls backend/app/explain_router.py backend/app/metrics_router.py
ls frontend/src/i18n/index.jsx frontend/src/components/CommandPalette.jsx

# 3. Commit + push
git add backend/ frontend/
git commit -F CHANGELOG_SPRINT3.md
git push origin main
```

→ **Aucun `npm install` requis**. Toutes les dépendances frontend Sprint 3
utilisent uniquement React 19 et Recharts (déjà dans ton `package.json`).

---

## 3. Branchement frontend (5 minutes) — voir aussi `INTEGRATION_APP_JSX.md`

### 3.1 — `main.jsx` est déjà mis à jour dans le ZIP

Le ZIP remplace `frontend/src/main.jsx` par la version Sprint 3 qui ajoute
`<I18nProvider>` et `<ThemeProvider>` autour de `<App />`. **Aucun import
`react-router-dom`** — ton App.jsx state-based fonctionne tel quel.

### 3.2 — Modifications à faire dans `App.jsx`

Voir le fichier dédié **`INTEGRATION_APP_JSX.md`** dans le ZIP qui contient :
- Les imports à ajouter en haut
- Le mapping `PATH_TO_TAB` (constante module-level)
- L'ajout de `<CommandPalette>` au top du return
- L'ajout de `<NotificationsBell>`, `<LangSelector>`, `<ThemeToggle>` dans la nav
- L'ajout de `{activeTab === "explainability" && <ExplicabilityPage />}` dans le switch
- L'ajout de `{activeTab === "compare" && <MultiEngineComparison />}` dans le switch

### 3.3 — (Optionnel) Heatmap dans le dashboard historique

Dans `frontend/src/pages/MaintenanceHistoryDashboard.jsx` :
```jsx
import ArretsHeatmap from '../components/ArretsHeatmap'

// Dans le JSX, après les KPIs :
<ArretsHeatmap arrets={list || data?.list || []} year={2025} />
```

### 3.4 — (Optionnel) Utiliser i18n

```jsx
import { useT } from '../i18n'

function MyComponent() {
  const t = useT()
  return <h1>{t('page.dashboard')}</h1>
}
```

### 3.5 — (Optionnel) CSS variables (dans `index.css` ou `theme.css`)

```css
body {
  background: var(--bg, #F5F0E1);
  color: var(--fg, #3A3025);
  transition: background-color 0.2s ease, color 0.2s ease;
}
```

---

## 4. Tests backend

```bash
cd backend
pip install pytest httpx
pytest tests/ -v
```

→ 10 tests fumée valident healthz, readyz, ask, history, feedback,
metrics, drift.

---

## 5. Endpoints Sprint 3 ajoutés

| Endpoint | Méthode | Description |
|---|---|---|
| `/pred/rul/explain` | POST | SHAP waterfall (Tree SHAP natif XGBoost) |
| `/pred/rul/anomaly/explain` | POST | Z-scores capteurs (Isolation Forest) |
| `/pred/rul/drift` | GET | PSI + KS-test vs distribution training |
| `/metrics` | GET | Prometheus text format |

---

## 6. Breaking changes — AUCUN

- Tous les endpoints existants restent fonctionnels
- Toutes les pages existantes restent fonctionnelles
- `main.jsx` ajoute juste 2 wrappers (rétrocompatible si tu les enlèves)
- Le ThemeProvider est rétrocompatible (variables CSS optionnelles)
- L'i18n a un fallback FR systématique → si un composant ne le branche
  pas, il continue de fonctionner
- **Pas de `react-router-dom`** : intégration 100% state-based via
  `activeTab` (comme ton App.jsx existant)

---

## 7. Statut Sprint 3

✅ Backend (5/5) — explain, drift, anomaly, metrics, tests  
✅ Frontend (8/8) — main.jsx, theme, i18n, palette, notifs, heatmap, explain page, compare page  
✅ Fix RAG bail-out — prompt + retrieval  

**Total Sprints 1+2+3 : 25 améliorations livrées.**

---

## 8. Que faire si le `npm run dev` plante ?

| Erreur | Cause | Fix |
|---|---|---|
| `Failed to resolve import "react-router-dom"` | Tu as un vieux `main.jsx` ou un import oublié | Vérifie que `frontend/src/main.jsx` est bien la version du ZIP |
| `Cannot find module './components/ThemeProvider'` | ZIP pas dézippé au bon endroit | `unzip -o ../mineassist_patches_sprint3.zip` depuis `mine_assist/` |
| Erreur i18n missing key | Une clé t() pas encore traduite | Pas grave : fallback FR automatique |
| Dark mode ne s'applique pas globalement | CSS variables pas utilisées | Section 3.5 (optionnelle) |
