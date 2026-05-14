# Rapport d'audit des Dashboards — MineAssist OCP

## Audit complet effectué

J'ai analysé chacun des 19 dashboards/pages de votre application, croisé avec les endpoints backend, et identifié les problèmes.

---

## ✅ Dashboards en bon état (10/19)

| Page | Statut | Endpoint backend | Notes |
|------|--------|------------------|-------|
| **PredictionPage** | ✅ Refait v4 | `/pred/rul/*` | Connecté à XGBoost + RF |
| **AnomalyDashboard** | ✅ OK | `/gmao/anomaly-results` + `/gmao/predict-anomaly` | Isolation Forest |
| **GeoAnomalyDashboard** | ✅ OK | `/gmao/geo-anomalies` | Carte des anomalies |
| **GmaoDashboard** | ✅ OK | `/gmao/stats` | KPIs maintenance |
| **OilAnalysisDashboard** | ✅ OK | `/oil/*` | 5 endpoints OK |
| **MaintenanceExecutiveDashboard** | ✅ OK | 5 endpoints | Vue 360° |
| **CapteursPage** | ✅ Wrapper | (orchestre 3 sous-pages) | — |
| **OcpFilesPage** | ✅ OK | `/pred/upload` | — |
| **OcpHealthPage** | ✅ OK | `/pred/health` | — |
| **OcpDefautPage** | ✅ OK | `/pred/defaut` | — |

---

## 🐛 Bugs corrigés dans ce patch

### 1. AlertesPage.jsx — `RulGauge` plantait

**Avant** :
```jsx
function RulGauge({ label, value }) {
  const danger = threshold != null && v >= threshold  // ❌ threshold undefined
}
```

**Après** :
```jsx
function RulGauge({ label, value, threshold = 0.5 }) {  // ✅ valeur par défaut
  const danger = threshold != null && v >= threshold
}
const LstmGauge = RulGauge  // ✅ alias compat avec le code existant
```

**Impact** : la page Alertes plantait au montage avec `ReferenceError: threshold is not defined`. Maintenant elle charge.

---

### 2. Endpoints `/gmao/timeseries` et `/gmao/timeseries/multi` — 404

**Cause** : ces endpoints existaient dans `api29_04.py` (archivé) mais avaient été oubliés lors de la migration vers `api.py`. Le `MonitoringDashboard` et `EvolutionChart` les appelaient en vain.

**Action** : restaurés dans `api.py` (153 lignes ajoutées, fonction `gmao_timeseries` + `gmao_timeseries_multi` + import `Query`).

**Impact** : les courbes temporelles des capteurs vont enfin s'afficher dans :
- MonitoringDashboard (mode "historique")
- EvolutionChart (mode "évolution")

---

### 3. Backend — robustesse `/ask` et `/diagnose`

(Modifications déjà appliquées dans le patch précédent)

- Logs détaillés `[ASK]` à chaque étape
- Gestion explicite des erreurs OpenRouter (401, 402, 429, timeout)
- Images PDF désormais opt-in (case à cocher ou mots-clés détectés)
- Prompts système enrichis avec contexte OCP Benguerir

---

## 📊 Recommandations d'amélioration

### À court terme (faisable rapidement)

1. **AlertesPage** : ajouter un état "loading" pendant le chargement des alertes (sinon écran vide)
2. **GmaoDashboard** : afficher un message clair si `criticality_rate` est null pour toutes les machines
3. **OilAnalysisDashboard** : 1115 lignes, à scinder en sous-composants pour la maintenabilité

### À moyen terme

4. **MonitoringDashboard** : utiliser `/gmao/timeseries/multi` (1 appel) au lieu de N appels parallèles à `/gmao/timeseries` (gain de perf 3-5×)
5. **PredictionPage** : ajouter un cache local des dernières prédictions (évite de recalculer si on revient sur la page)
6. **GeoAnomalyDashboard** : clusteriser les marqueurs si > 100 points (sinon la carte rame)

### À long terme

7. **WebSocket** pour le live des capteurs au lieu du polling (latence ÷ 10)
8. **PWA** pour usage offline sur tablette terrain
9. **Notifications push** pour les alertes critiques (RED) sans avoir l'app ouverte
10. **Mode sombre** (palette mineurs/nuit) pour usage en cabine

---

## 🚀 Pour déployer ce patch

```bash
# 1. Extraire le ZIP à la racine du projet
# 2. Redémarrer le backend
cd backend
venv\Scripts\activate
uvicorn app.api:app --reload

# 3. Redémarrer le frontend (rien à faire si Vite tourne déjà)
cd frontend
npm run dev
```

Vous devriez voir dans les logs uvicorn :
```
[OK] Modèles XGBoost + RandomForest chargés.
INFO:     Application startup complete.
```

Et dans le navigateur :
- **AlertesPage** ne crash plus au chargement
- **MonitoringDashboard** affiche les courbes temporelles
- **EvolutionChart** affiche l'évolution multi-paramètres
- **PredictionPage** v4 toujours fonctionnelle
- **/ask** beaucoup plus précis et structuré
