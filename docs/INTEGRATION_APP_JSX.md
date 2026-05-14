# Intégration Sprint 3 dans `App.jsx` (state-based, **PAS de react-router-dom**)

> Ton `App.jsx` utilise `activeTab` / `setActiveTab` (state). Aucun routeur
> nécessaire. Voici les diffs exacts à appliquer pour activer les nouveautés.

## 0. Vérifier que `main.jsx` est bien la version Sprint 3

Le fichier `frontend/src/main.jsx` du ZIP **remplace l'existant**. Il
ajoute juste `<I18nProvider>` et `<ThemeProvider>` autour de `<App />`,
**sans** `BrowserRouter`.

```jsx
// frontend/src/main.jsx (déjà dans le ZIP)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/theme.css'
import App from './App.jsx'
import { ThemeProvider } from './components/ThemeProvider'
import { I18nProvider } from './i18n'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
)
```

⚠️ **Ne PAS lancer** `npm install react-router-dom` — ce n'est pas nécessaire.

---

## 1. Imports à ajouter en haut de `App.jsx`

Dans la zone des imports (autour de la ligne 1-25), ajoute :

```jsx
// Sprint 3 — composants nouveaux
import CommandPalette from './components/CommandPalette'
import NotificationsBell from './components/NotificationsDrawer'
import { ThemeToggle } from './components/ThemeProvider'
import { LangSelector, useT } from './i18n'
import ArretsHeatmap from './components/ArretsHeatmap'

// Sprint 3 — pages nouvelles
import ExplicabilityPage from './pages/ExplicabilityPage'
import MultiEngineComparison from './pages/MultiEngineComparison'
```

---

## 2. Mapping `path` ↔ `activeTab` (constante module-level, hors composant)

Juste après les imports, ajoute (avant `function App()`) :

```jsx
/**
 * Mapping des chemins "URL-like" utilisés par la CommandPalette
 * vers les clés internes activeTab de App.jsx.
 *
 * Ajoute/modifie ici quand tu crées de nouveaux onglets.
 */
const PATH_TO_TAB = {
  '/dashboard':       'maintenance_360',
  '/maintenance_360': 'maintenance_360',
  '/executive':       'executive_report',
  '/report':          'executive_report',

  '/gmao':            'gmao',
  '/anomalies':       'anomaly',
  '/anomaly':         'anomaly',
  '/geolocalisation': 'geo',
  '/geo':             'geo',
  '/oil-analysis':    'oil',
  '/oil':             'oil',
  '/capteurs':        'capteurs',
  '/sensors':         'capteurs',

  '/prediction':      'prediction',
  '/predict':         'prediction',
  '/alertes':         'alertes',
  '/alerts':          'alertes',

  '/files':           'ocp_files',
  '/uploads':         'ocp_files',
  '/health':          'ocp_sante',
  '/sante':           'ocp_sante',
  '/defauts':         'ocp_defaut',
  '/troubleshooting': 'ocp_troubleshooting',

  '/history':         'history',
  '/historique':      'history',

  '/ask':             'ask',
  '/diagnose':        'diagnose',

  // Sprint 3
  '/explainability':  'explainability',
  '/explain':         'explainability',
  '/compare':         'compare',
  '/comparaison':     'compare',
}
```

---

## 3. Ajouter la palette + cloche + langue + thème dans le JSX

### 3a. Palette globale Ctrl+K (à mettre **dans le return**, en TOP-LEVEL, avant ton `<DashboardShell>`)

```jsx
return (
  <>
    {/* Sprint 3 — palette globale (active partout) */}
    <CommandPalette
      onNavigate={(path) => {
        const tab = PATH_TO_TAB[path]
        if (tab) setActiveTab(tab)
      }}
    />

    <PhosphateBg/>
    <DashboardShell ...>
      {/* … ton JSX existant … */}
    </DashboardShell>
  </>
)
```

### 3b. Cloche notifications + langue + thème dans la nav

Ouvre ton bloc `<nav style={S.nav}>` (autour de la ligne 1100-1130).
Ajoute **à droite** (après le dernier bouton/lien existant) :

```jsx
<div style={{
  display: 'flex', alignItems: 'center', gap: 6,
  marginLeft: 'auto', paddingRight: 8,
}}>
  <NotificationsBell apiUrl={API} pollMs={30000} />
  <LangSelector />
  <ThemeToggle />
</div>
```

> Le `apiUrl={API}` réutilise ta constante `API` importée depuis `./config`.

---

## 4. Ajouter les nouvelles pages dans le switch `activeTab`

Cherche ton bloc autour de la ligne 1162-1170 :
```jsx
{activeTab === "maintenance_360" && <MaintenanceExecutiveDashboard ... />}
{activeTab === "executive_report" && <ExecutiveReportPage ... />}
{activeTab==="ask"      && <AskPage ... />}
// …
```

Et ajoute juste avant le `</...>` de fermeture :

```jsx
{activeTab === "explainability" && <ExplicabilityPage />}
{activeTab === "compare"        && <MultiEngineComparison />}
```

---

## 5. (Bonus) Ajouter la heatmap dans la page Historique

Ouvre `frontend/src/pages/MaintenanceHistoryDashboard.jsx`.
En haut, ajoute l'import :

```jsx
import ArretsHeatmap from '../components/ArretsHeatmap'
```

Puis dans le JSX, juste après la ligne des KPIs (ou au début du return,
avant les graphiques), insère :

```jsx
<ArretsHeatmap
  arrets={list || data?.list || []}
  year={new Date().getFullYear()}
/>
```

> Le composant accepte `[{ date_debut: ISO, ... }, ...]` ou `[{ date: ISO, ... }, ...]`.

---

## 6. (Bonus) Utiliser i18n dans ton composant

```jsx
import { useT, useLang } from '../i18n'

function MyComponent() {
  const t = useT()
  const { lang } = useLang()
  return (
    <div>
      <h1>{t('page.dashboard')}</h1>
      <p>{t('common.refresh')}</p>
      <span>Langue: {lang}</span>
    </div>
  )
}
```

Si une clé n'existe pas, `t()` renvoie le **fallback FR** (puis la clé brute
si même la fallback manque). **Aucun crash** si un composant n'est pas
encore traduit.

---

## 7. (Bonus) CSS variables pour dark mode global

Dans `frontend/src/index.css` ou `frontend/src/styles/theme.css`, ajoute
en bas du fichier :

```css
/* Sprint 3 — dark mode CSS variables (gérées par ThemeProvider) */
body {
  background: var(--bg, #F5F0E1);
  color: var(--fg, #3A3025);
  transition: background-color 0.2s ease, color 0.2s ease;
}
```

Les composants Sprint 3 utilisent **directement** `var(--bg)`, `var(--fg)`,
`var(--accent)`, `var(--bg-card)`, `var(--border)` avec des fallbacks
hardcodés → le dark mode "juste marche", aucun risque de page cassée.

---

## 8. Tester

```bash
cd frontend
npm run dev
```

Tu devrais voir :
- En haut à droite : 🔔 cloche (NotificationsBell), 🌐 langue, 🌓 toggle thème
- **Ctrl+K** : ouvre la palette de commandes
- Clic sur un résultat → change `activeTab`
- Toggle thème → bascule sand ↔ dark, persiste après refresh
- Sélecteur langue → bascule FR / EN / AR (RTL pour AR)

---

## TL;DR diff `App.jsx` (les 3 changements minimum)

```diff
+import CommandPalette from './components/CommandPalette'
+import NotificationsBell from './components/NotificationsDrawer'
+import { ThemeToggle } from './components/ThemeProvider'
+import { LangSelector } from './i18n'
+import ExplicabilityPage from './pages/ExplicabilityPage'
+import MultiEngineComparison from './pages/MultiEngineComparison'

+const PATH_TO_TAB = { /* … voir section 2 … */ }

 function App() {
   const [activeTab, setActiveTab] = useState("maintenance_360")
   // … reste inchangé …

   return (
+    <>
+      <CommandPalette onNavigate={(p) => {
+        const tab = PATH_TO_TAB[p]
+        if (tab) setActiveTab(tab)
+      }} />
       <PhosphateBg/>
       <DashboardShell …>
         {/* … */}
+        {activeTab === "explainability" && <ExplicabilityPage />}
+        {activeTab === "compare"        && <MultiEngineComparison />}
       </DashboardShell>
+    </>
   )
 }
```

C'est tout. Pas de `react-router-dom`. Pas de breaking change.
