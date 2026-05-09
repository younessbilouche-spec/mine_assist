// ─────────────────────────────────────────────────────────────────────────────
// src/config/index.js
//
// PROBLÈME ACTUEL : API_URL et C={} sont dupliqués dans chaque page :
//   App.jsx, MonitoringDashboard.jsx, AnomalyDashboard.jsx, GmaoDashboard.jsx…
//
// SOLUTION : un seul fichier — importer dans chaque page avec :
//   import { API, C, SEUILS_CAPTEURS } from "../config"
// ─────────────────────────────────────────────────────────────────────────────

// URL de base — définie dans le fichier .env.local (jamais hardcodée)
// Créer .env.local à la racine du projet frontend :
//   VITE_API_URL=http://127.0.0.1:8000
export const API = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000"

// ── Thème OCP — source unique de vérité ──────────────────────────────────────
// Remplace les dizaines de `const C = { bg: "#F5F0E8", ... }` répétés
export const C = {
  bg:         "#F5F0E8",
  bgCard:     "rgba(255,253,248,0.92)",
  bgSidebar:  "rgba(248,244,236,0.97)",
  border:     "#D4C9B0",
  green:      "#00843D",
  greenLt:    "#00A84F",
  greenDark:  "#005C2B",
  greenPale:  "#E8F5EE",
  orange:     "#C4760A",
  orangePale: "#FDF3E3",
  sand:       "#C9A84C",
  sandPale:   "#F7F0DC",
  text:       "#2A2A1E",
  textMid:    "#5A5240",
  textMuted:  "#8A7D60",
  textLight:  "#B0A080",
  danger:     "#C0392B",
  dangerPale: "#FDECEA",
  ok:         "#00843D",
}

// ── Seuils capteurs 994F — partagés entre MonitoringDashboard et AnomalyDashboard
// Actuellement les labels sont redéfinis dans chaque page
export const SEUILS_CAPTEURS = {
  "Température liquide refroidissement": { max: 107, unite: "°C",    label: "Temp. Liq. Refroid."     },
  "Température échappement Droit":       { max: 600, unite: "°C",    label: "Temp. Échap. Droit"      },
  "Température échappement gauche":      { max: 600, unite: "°C",    label: "Temp. Échap. Gauche"     },
  "Température sortie convertisseur":    { max: 129, unite: "°C",    label: "Temp. Sort. Convert."    },
  "Pression huile moteur":               { min: 200, max: 550, unite: "kPa",   label: "Press. Huile Moteur"    },
  "Régime moteur":                       { max: 2100, unite: "tr/min", label: "Régime Moteur"          },
}

// Labels courts des 6 paramètres ML (même ordre que train_anomaly.py PARAMETRES_CIBLES)
export const PREDICT_LABELS = [
  { key: "Température liquide refroidissement", label: "Temp. liquide refroid.", unite: "°C"     },
  { key: "Température échappement Droit",       label: "Temp. échappement Droit", unite: "°C"   },
  { key: "Température échappement gauche",      label: "Temp. échappement gauche", unite: "°C"  },
  { key: "Température sortie convertisseur",    label: "Temp. sortie convertisseur", unite: "°C"},
  { key: "Pression huile moteur",               label: "Pression huile moteur", unite: "kPa"    },
  { key: "Régime moteur",                       label: "Régime moteur", unite: "Tr/min"         },
]

// Stockage local — historique RAG/diagnostic
export const STORAGE_KEY     = "mineassist_history"
export const MAX_HISTORY_ITEMS = 50
