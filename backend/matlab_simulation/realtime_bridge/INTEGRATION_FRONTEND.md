# Intégration de la page **Live Simulation** dans le frontend MineAssist

## 1. Copier le fichier
```
realtime_bridge/LiveSimulationDashboard.jsx
   → frontend/src/pages/LiveSimulationDashboard.jsx
```

## 2. Modifier `frontend/src/App.jsx`

### a) Ajouter l'import (en haut, avec les autres imports de pages)
```jsx
import LiveSimulationDashboard from "./pages/LiveSimulationDashboard"
```

### b) Ajouter l'onglet dans le tableau `TABS`
Localisez le `const TABS = [...]` (vers la ligne 929) et **ajoutez la dernière entrée** :
```jsx
const TABS = [
  { id:"ask",       icon:"💬", label:"Question libre",       shortLabel:"Q&R" },
  { id:"diagnose",  icon:"🔧", label:"Diagnostic",           shortLabel:"Diag" },
  { id:"gmao",      icon:"📊", label:"GMAO Analytics",       shortLabel:"GMAO" },
  { id:"geo",       icon:"📍", label:"Analyse géographique", shortLabel:"Géo" },
  { id:"monitor",   icon:"📡", label:"Monitoring capteurs",  shortLabel:"Capteurs" },
  { id:"evolution", icon:"📈", label:"Analyse temporelle",   shortLabel:"Évolution" },
  { id:"anomaly",   icon:"🤖", label:"Détection IA",         shortLabel:"IA" },
  { id:"oil",       icon:"🛢️", label:"Analyse huiles",       shortLabel:"Huiles" },
  { id:"live",      icon:"🟢", label:"Live MATLAB",          shortLabel:"Live" }, // ← nouveau
]
```

### c) Ajouter le rendu (vers la ligne 1112, à côté des autres `activeTab===...`)
```jsx
{activeTab==="gmao"      && <GmaoDashboard/>}
{activeTab === "geo"     && <GeoAnomalyDashboard />}
{activeTab === "monitor" && <MonitoringDashboard />}
{activeTab === "evolution" && <EvolutionChart />}
{activeTab === "anomaly" && <AnomalyDashboard />}
{activeTab === "oil"     && <OilAnalysisDashboard />}
{activeTab === "live"    && <LiveSimulationDashboard />}   {/* ← nouveau */}
```

## 3. (Optionnel) Donner les droits dans `useAuth`
Si votre `canAccess(tab.id)` filtre les onglets par rôle, ajoutez `"live"` aux rôles autorisés (admin / chef au minimum). Sinon, sautez cette étape.

## 4. Démarrer la chaîne complète

**Terminal 1 — Backend** (`backend/`)
```bash
uvicorn app.api:app --host 0.0.0.0 --port 8000 --reload
```
> Vérifier `http://127.0.0.1:8000/docs` → tag **Simulation MATLAB** présent.

**Terminal 2 — Frontend** (`frontend/`)
```bash
npm run dev
```

**Terminal 3 — Simulateur** (au choix)
```bash
# MATLAB R2024
>> live_capteurs_to_mineassist('fault','ventilo_hs','t_fault',60,'duration',600)

# OU Python
> python mineassist_live_simulator.py --fault ventilo_hs --t-fault 60 --duration 600 --speed 2
```

Puis dans le navigateur :
- Cliquer sur l'onglet **🟢 Live MATLAB**
- KPI cards qui se mettent à jour à 1 Hz
- Courbe T° eau / P. pompe / Régime moteur en évolution
- Tableau d'alertes qui grossit dès le franchissement des seuils

## 5. Captures conseillées pour le rapport (chap. 5)
1. **t = 30 s, état normal** : tous les KPI verts, courbe stable.
2. **t = 90 s, panne `ventilo_hs` injectée à t=60s** : T° eau commence à grimper, KPI passe orange.
3. **t = 200 s** : T° eau dépasse 95 °C, KPI rouge "● ALERTE", tableau d'alertes long.
4. **t = 400 s avec `fuite_hydraulique`** : P. pompe en rouge "min < seuil 15000 kPa".

Ces 4 captures couvrent parfaitement les sections "Validation chaîne capteurs → alertes" et "Démonstration scénarios de panne" du chapitre 5.
