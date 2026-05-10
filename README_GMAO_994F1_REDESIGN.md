# Redesign dashboard GMAO 994F1 — version ingénieur

Cette version remplace le dashboard GMAO statistique par un dashboard de décision maintenance pour `994F-1`.

## Nouvelle logique

Le dashboard ne se contente plus de compter les anomalies. Il calcule un score de risque :

```text
score risque = poids gravité × occurrences
G1 = 1, G2 = 4, G3 = 9
```

L’objectif est de classer les défauts qui doivent être traités en priorité.

## Nouvelle structure frontend

Fichier : `frontend/src/pages/GmaoDashboard.jsx`

Sections ajoutées :

1. **Niveau de risque global 994F1**
   - Score risque total
   - Niveau : MAÎTRISÉ / ÉLEVÉ / CRITIQUE

2. **KPIs utiles maintenance**
   - Score risque
   - Événements
   - Occurrences
   - G2 + G3
   - Compteur heures engin

3. **Première décision maintenance**
   - Défaut prioritaire P1/P2/P3
   - Gravité
   - Source
   - Dernière date
   - Action recommandée

4. **Pareto des défauts à traiter**
   - Barres = score risque par défaut
   - Courbe = cumul Pareto %

5. **Tendance mensuelle du risque**
   - Évolution du score risque
   - G2/G3 dans le temps

6. **Sources dominantes du risque**
   - Classe les sous-systèmes par impact risque

7. **Derniers événements critiques / récurrents**
   - Liste opérationnelle récente

8. **Plan d’action priorisé**
   - Table P1/P2/P3 avec recommandations maintenance

## Backend modifié

Fichier : `backend/app/api.py`

Endpoint enrichi :

```text
GET /gmao/stats?machine=994F-1
```

Nouveaux champs retournés :

- `engineering_summary`
- `priority_risks`
- `monthly_risk`
- `source_risk`
- `recent_events`

Le endpoint reste compatible avec les anciens champs.

## Données incluses

Fichier ajouté :

```text
backend/data/gmao/anomalies/994F1_export_31-12-2024_01-01-2026_23-02-2026.xlsx
```

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
- Lint : OK, 0 erreur
- API GMAO testée : OK

Sur ton fichier 994F1 :

- 1373 événements
- 1343 points géolocalisés
- Score risque total : 165346
- Niveau : CRITIQUE
- Source dominante : Moteur

## Application

Dézipper à la racine du projet :

```bash
unzip mine_assist_gmao_994f1_redesign.zip -d mine_assist
```

Puis relancer backend + frontend.
