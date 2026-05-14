feat(sprint3): explicabilité ML + observabilité + dark mode + i18n + UX polish

CRITICAL FIX (RAG):
- Ask v2 ne dit plus "documentation non consultée" sur questions terrain
- Prompt système v3 avec base de connaissances CAT 994F embarquée
  (8 procédures de réflexe : filtres, vidanges, courroie, pneus...)
- Retrieval RAG : top_k 5→10, distance 0.78→0.95, query expansion
  (synonymes FR/EN/AR), hybrid sémantique + lexical

BACKEND (5):
- POST /pred/rul/explain — Tree SHAP natif XGBoost (pred_contribs=True)
  waterfall 12 features avec contributions signées
- POST /pred/rul/anomaly/explain — z-scores capteurs vs distribution training
  via Isolation Forest, top contributeurs
- GET /pred/rul/drift — détection dérive PSI + Kolmogorov-Smirnov par feature
- GET /metrics — Prometheus text format (counters HTTP, latency p50/p95/p99,
  uptime, modèles chargés, feedback)
- 10 tests pytest smoke pour CI (healthz, readyz, ask, history, feedback,
  metrics, drift)

FRONTEND (7):
- ThemeProvider + ThemeToggle : dark mode global avec CSS variables,
  persistance localStorage, prefers-color-scheme detection
- I18nProvider + LangSelector : système custom FR/EN/AR léger
  (~250 clés × 3 langues, RTL auto pour l'arabe)
- CommandPalette : raccourci Ctrl+K, navigation 21+ pages, recherche
  capteurs/codes défaut, fuzzy matching avec accents
- NotificationsBell + drawer : polling 30s sur /pred/rul/alert-class +
  /pred/rul/drift, badge compteur, mute/unmute, persistance "vu"
- ExplicabilityPage : page complète SHAP waterfall + anomaly contributors
  + drift table, recharge à la demande
- ArretsHeatmap : calendrier 12 mois × 7 jours style GitHub, intensité
  selon nombre d'arrêts/jour, tooltip hover, click pour drill-down
- MultiEngineComparison : page comparaison 994F1/F2/F3/F4 côte-à-côte
  (KPIs, charts barres, timelines superposées)

PROMPT SYSTÈME (v3):
- Format de réponse imposé : 5 sections (Synthèse, Procédure, Outils,
  Sécurité, Sources) avec étapes numérotées
- Refus explicite de "documentation non consultée"
- "(à valider sur SIS / VIMS)" pour valeurs exactes inconnues
- 8 procédures CAT 994F embarquées (~1500 tokens chacune en FR)

CHANGEMENTS RÉTROCOMPATIBLES:
- Tous les endpoints existants conservés
- Toutes les pages existantes conservées
- Variables CSS optionnelles (fallback couleurs en dur)
- I18n fallback FR si clé manquante
- Aucune dépendance externe ajoutée (zéro npm install)

CO-AUTHORED-BY: Devin (Cognition AI)
