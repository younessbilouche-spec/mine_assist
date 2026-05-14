# Correction dashboard GMAO — 994F1 uniquement

## Ce qui a été changé

- `frontend/src/pages/GmaoDashboard.jsx` : dashboard GMAO filtré sur `994F-1` uniquement.
  - Suppression de la comparaison 994F-1 / 994F-2.
  - KPIs, évolution mensuelle, sources, taux /100h et lecture métier limités à 994F-1.
  - Appel API : `/gmao/stats?machine=994F-1`.

- `frontend/src/pages/GeoAnomalyDashboard.jsx` : dashboard géographique filtré sur `994F-1` uniquement.
  - Appel API : `/gmao/geo-anomalies?machine=994F-1`.
  - Le filtre machine est fixe sur 994F-1.

- `backend/app/api.py` : ajout du paramètre `machine` sur :
  - `/gmao/stats`
  - `/gmao/geo-anomalies`
  Par défaut, les deux endpoints travaillent maintenant sur `994F-1`.

- `backend/data/gmao/anomalies/994F1_export_31-12-2024_01-01-2026_23-02-2026.xlsx` : fichier anomalies 994F1 fourni, placé au bon endroit pour le backend.

## Vérifications réalisées

```bash
npm run build
npm run test -- --run
npm run lint
python -m py_compile backend/app/api.py
```

Résultats :

- Build frontend : OK
- Tests Vitest : OK, 6 tests passés
- Lint : OK, 0 erreur, seulement warnings React hooks déjà non bloquants
- Backend API import + endpoints testés : OK
  - `/gmao/stats?machine=994F-1` retourne 1373 événements, machine `994F-1` seulement
  - `/gmao/geo-anomalies?machine=994F-1` retourne 1343 points géolocalisés, machine `994F-1` seulement

## Application

Dézipper à la racine de `mine_assist` :

```bash
unzip mine_assist_gmao_994f1.zip -d mine_assist
```

Puis relancer backend + frontend.
