// ─────────────────────────────────────────────────────────────────────────────
// src/hooks/useTheme.js — Theme system avec CSS variables
//
// Plug-and-play :
//   1. Importer ThemeProvider dans App.jsx et wrapper l'app
//   2. Utiliser <ThemeToggle /> n'importe où dans la sidebar/header
//   3. Importer les couleurs via `import { C } from "./theme"` (au lieu de hardcoder)
//
// Le mode est persisté dans localStorage et respecte prefers-color-scheme au 1er chargement.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react"

const THEME_KEY = "mineassist_theme"
const ThemeContext = createContext(null)

// ── Tokens de couleur, mode clair (existant OCP) et mode sombre ──────────────
export const lightTokens = {
  bg:         "#F5F0E8",
  bgCard:     "rgba(255,253,248,0.92)",
  bgSidebar:  "rgba(248,244,236,0.97)",
  bgSoft:     "#FBF7EF",
  border:     "#D4C9B0",
  borderSoft: "#E8DEC9",
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
  red:        "#C0392B",
  redPale:    "#FDECEA",
  ok:         "#00843D",
  shadow:     "rgba(139,105,20,0.07)",
}

export const darkTokens = {
  bg:         "#0E1814",
  bgCard:     "rgba(26,40,33,0.92)",
  bgSidebar:  "rgba(20,32,26,0.97)",
  bgSoft:     "#1A2B22",
  border:     "#2D4035",
  borderSoft: "#1F2E25",
  green:      "#3FBD6A",
  greenLt:    "#5BD489",
  greenDark:  "#2A8F4E",
  greenPale:  "rgba(63,189,106,0.18)",
  orange:     "#E8923C",
  orangePale: "rgba(232,146,60,0.18)",
  sand:       "#D4B95E",
  sandPale:   "rgba(212,185,94,0.15)",
  text:       "#EAE0CC",
  textMid:    "#B8AC91",
  textMuted:  "#7E7560",
  textLight:  "#5C5443",
  danger:     "#E55A4A",
  dangerPale: "rgba(229,90,74,0.18)",
  red:        "#E55A4A",
  redPale:    "rgba(229,90,74,0.18)",
  ok:         "#3FBD6A",
  shadow:     "rgba(0,0,0,0.4)",
}

// ── Helper : applique les tokens en CSS variables sur :root ──────────────────
function applyTheme(tokens) {
  const root = document.documentElement
  Object.entries(tokens).forEach(([key, value]) => {
    root.style.setProperty(`--c-${key}`, value)
  })
  root.dataset.theme = tokens === darkTokens ? "dark" : "light"
}

// ─── Provider ───────────────────────────────────────────────────────────────
export function ThemeProvider({ children }) {
  // Détection initiale : localStorage > prefers-color-scheme > "light"
  const [mode, setMode] = useState(() => {
    if (typeof window === "undefined") return "light"
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === "light" || saved === "dark") return saved
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark"
    return "light"
  })

  const tokens = mode === "dark" ? darkTokens : lightTokens

  // Apply CSS vars + persist
  useEffect(() => {
    applyTheme(tokens)
    localStorage.setItem(THEME_KEY, mode)
  }, [mode, tokens])

  const toggle = useCallback(() => {
    setMode(m => (m === "light" ? "dark" : "light"))
  }, [])

  const value = useMemo(() => ({ mode, tokens, toggle, setMode }), [mode, tokens, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    // Fallback safe si pas de Provider — renvoie le clair
    return { mode: "light", tokens: lightTokens, toggle: () => {}, setMode: () => {} }
  }
  return ctx
}

/**
 * useC() — drop-in pour remplacer `import { C } from "../config"` :
 *   const C = useC()
 *   ...style={{ color: C.green }}
 * Les couleurs réagissent automatiquement au mode.
 */
export function useC() {
  return useTheme().tokens
}

// ─── Toggle component ────────────────────────────────────────────────────────
export function ThemeToggle({ style }) {
  const { mode, toggle } = useTheme()
  const C = useC()

  return (
    <button
      onClick={toggle}
      title={mode === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      aria-label="Toggle theme"
      style={{
        width: 40, height: 40,
        background: "transparent",
        border: `1.5px solid ${C.border}`,
        color: C.textMid,
        cursor: "pointer",
        fontSize: 18,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.2s ease",
        ...style,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = C.greenPale
        e.currentTarget.style.borderColor = C.green
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent"
        e.currentTarget.style.borderColor = C.border
      }}
    >
      {mode === "dark" ? "☀️" : "🌙"}
    </button>
  )
}
