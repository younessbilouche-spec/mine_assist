/**
 * ThemeProvider.jsx — Sprint 3 (mai 2026)
 * ========================================
 * 
 * Système de thème léger (sans dépendance externe) :
 *   - 2 thèmes : "sand" (par défaut, beige industriel) | "dark" (fond #1a1a1a)
 *   - Variables CSS injectées sur <html data-theme="...">
 *   - Persistance localStorage
 *   - Hook useTheme() exposé pour les composants
 * 
 * Branchement (dans main.jsx ou App.jsx) :
 *   <ThemeProvider>
 *     <App />
 *   </ThemeProvider>
 * 
 * Utilisation dans un composant :
 *   const { theme, toggleTheme } = useTheme()
 *   <button onClick={toggleTheme}>{theme === 'dark' ? '🌙' : '☀️'}</button>
 */

import React, { createContext, useContext, useEffect, useState, useMemo } from 'react'

const ThemeContext = createContext({ theme: 'sand', toggleTheme: () => {} })

const THEMES = {
  sand: {
    '--bg':           '#F5F0E1',
    '--bg-card':      '#FBF7E9',
    '--bg-panel':     '#EFE9D8',
    '--bg-elevated':  '#FFFFFF',
    '--fg':           '#3A3025',
    '--fg-muted':     '#6B5E45',
    '--fg-subtle':    '#9C8C70',
    '--border':       '#D4C9B0',
    '--border-strong':'#A89678',
    '--accent':       '#B8842B',
    '--accent-fg':    '#FFFFFF',
    '--success':      '#3F8F3F',
    '--warn':         '#E58E26',
    '--danger':       '#C0392B',
    '--info':         '#2A6FB8',
  },
  dark: {
    '--bg':           '#1A1A1A',
    '--bg-card':      '#262626',
    '--bg-panel':     '#1F1F1F',
    '--bg-elevated':  '#2E2E2E',
    '--fg':           '#F0E8D4',
    '--fg-muted':     '#B8B0A0',
    '--fg-subtle':    '#7A7060',
    '--border':       '#3A3A3A',
    '--border-strong':'#5A5040',
    '--accent':       '#E2A24A',
    '--accent-fg':    '#1A1A1A',
    '--success':      '#5BB85B',
    '--warn':         '#F5A53A',
    '--danger':       '#E55844',
    '--info':         '#4A9DDB',
  },
}

function applyTheme(theme) {
  const vars = THEMES[theme] || THEMES.sand
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.setAttribute('data-theme', theme)
  // Couleur de fond globale
  document.body.style.backgroundColor = vars['--bg']
  document.body.style.color = vars['--fg']
  document.body.style.transition = 'background-color 0.25s ease, color 0.25s ease'
}

export function ThemeProvider({ children, defaultTheme = 'sand' }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('mineassist_theme')
      if (saved === 'sand' || saved === 'dark') return saved
    } catch (_) {}
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark'
    }
    return defaultTheme
  })

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem('mineassist_theme', theme) } catch (_) {}
  }, [theme])

  const value = useMemo(() => ({
    theme,
    setTheme,
    toggleTheme: () => setTheme(t => t === 'dark' ? 'sand' : 'dark'),
  }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

/**
 * ThemeToggle — bouton à placer dans la topbar.
 * Discret, accessible, sans label texte (icône seule).
 */
export function ThemeToggle({ size = 36 }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      onClick={toggleTheme}
      title={isDark ? 'Passer en thème clair' : 'Passer en thème sombre'}
      aria-label="Changer de thème"
      style={{
        width: size, height: size,
        background: 'transparent',
        border: '1px solid var(--border, #D4C9B0)',
        borderRadius: 6,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--fg, #3A3025)',
        fontSize: Math.round(size * 0.45),
        transition: 'all 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {isDark ? '☀' : '☾'}
    </button>
  )
}
