# Intégration des pages frontend — Mine Assist OCP

## Fichiers fournis

| Fichier | Description | Route suggérée |
|---------|-------------|----------------|
| `MainDashboard.jsx` | Dashboard global flotte + KPIs + graphes analytiques | `/dashboard` |
| `EquipementRULPage.jsx` | Page détail équipement : RUL, capteurs, anomalies, prédiction | `/equipement/:id` |

## Installation (2 étapes)

### 1. Copier les fichiers
```
frontend/src/pages/MainDashboard.jsx       ← copier ici
frontend/src/pages/EquipementRULPage.jsx   ← copier ici
```

### 2. Ajouter dans votre router (App.jsx ou router.jsx)
```jsx
import MainDashboard    from './pages/MainDashboard'
import EquipementRULPage from './pages/EquipementRULPage'

// Dans vos routes :
{ path: '/dashboard',         element: <MainDashboard /> }
{ path: '/equipement/:id',    element: <EquipementRULPage /> }
```

## Connexion backend

Les deux pages utilisent `import { API } from '../config'` (déjà dans votre projet).

Endpoints consommés :
- `GET /pred/rul/predict/demo`   → démo prédiction (MainDashboard + EquipementRULPage)
- `GET /pred/rul/status`         → état des modèles ML (MainDashboard)
- `POST /pred/rul/predict`       → prédiction fichier Excel (EquipementRULPage, onglet "Prédiction")
- `GET /gmao/anomaly-results`    → résultats anomalies (extensible)

Si le backend est inaccessible, les deux pages affichent automatiquement des données mock
réalistes basées sur vos vraies métriques (MAE 21h, Recall 93.1%, 6 capteurs).

## Dépendances requises

```json
{
  "recharts": "^2.x",           // déjà dans votre projet
  "react": "^18.x"              // déjà dans votre projet
}
```

Aucune dépendance supplémentaire. Recharts est déjà utilisé dans PredictionPage.jsx.

## Navigation entre pages

Dans MainDashboard.jsx, le clic sur une carte équipement ouvre une modal.
Pour naviguer vers EquipementRULPage, modifiez le bouton "Voir page détail →" :

```jsx
import { useNavigate } from 'react-router-dom'

// Dans MainDashboard :
const navigate = useNavigate()

// Dans le bouton :
<button onClick={() => navigate(`/equipement/${selected.id}`)}>
  Voir page détail →
</button>
```

Dans EquipementRULPage, passez `onBack={() => navigate(-1)}` comme prop :
```jsx
<EquipementRULPage onBack={() => navigate(-1)} />
```

## Données réelles

Quand le backend est connecté, les données mock sont automatiquement remplacées
par les vraies prédictions. Aucune modification de code nécessaire.

Pour étendre la flotte (actuellement 6 équipements mock), modifiez la fonction
`generateFleetMock()` dans MainDashboard.jsx ou connectez votre endpoint GMAO.
