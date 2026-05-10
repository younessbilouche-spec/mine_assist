/**
 * i18n/index.jsx — Sprint 3 (mai 2026)
 * =====================================
 * 
 * Système i18n minimaliste pour MineAssist (FR / EN / AR).
 * - Pas de dépendance externe (pas de react-intl, pas de i18next)
 * - 600 lignes total dictionnaire FR + EN + AR
 * - Hook useT() : returns t("key") translator
 * - Auto-détection langue navigateur au premier load
 * - Persistance localStorage
 * - Direction RTL automatique pour l'arabe (document.dir)
 * 
 * Branchement (main.jsx) :
 *   <I18nProvider>
 *     <ThemeProvider>
 *       <App />
 *     </ThemeProvider>
 *   </I18nProvider>
 * 
 * Usage dans composant :
 *   const t = useT()
 *   <h1>{t('nav.dashboard')}</h1>
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { DICT } from './dict'

const I18nContext = createContext({
  lang: 'fr',
  setLang: () => {},
  t: (k) => k,
})

const SUPPORTED = ['fr', 'en', 'ar']

function detectInitialLang() {
  try {
    const saved = localStorage.getItem('mineassist_lang')
    if (SUPPORTED.includes(saved)) return saved
  } catch (_) {}
  if (typeof navigator !== 'undefined' && navigator.language) {
    const code = navigator.language.slice(0, 2).toLowerCase()
    if (SUPPORTED.includes(code)) return code
  }
  return 'fr'
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(detectInitialLang)

  useEffect(() => {
    try { localStorage.setItem('mineassist_lang', lang) } catch (_) {}
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    }
  }, [lang])

  const t = useMemo(() => {
    const dict = DICT[lang] || DICT.fr
    const fallback = DICT.fr
    return (key, params) => {
      let val = dict[key] || fallback[key] || key
      if (params && typeof val === 'string') {
        for (const [k, v] of Object.entries(params)) {
          val = val.replaceAll(`{${k}}`, String(v))
        }
      }
      return val
    }
  }, [lang])

  const value = useMemo(() => ({ lang, setLang, t }), [lang, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT() {
  return useContext(I18nContext).t
}

export function useLang() {
  return useContext(I18nContext)
}

/**
 * LangSelector — bouton dropdown FR / EN / AR pour la topbar.
 */
export function LangSelector() {
  const { lang, setLang } = useLang()
  const opts = [
    { code: 'fr', label: 'FR', full: 'Français' },
    { code: 'en', label: 'EN', full: 'English' },
    { code: 'ar', label: 'AR', full: 'العربية' },
  ]
  const [open, setOpen] = useState(false)
  const cur = opts.find(o => o.code === lang) || opts[0]
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Langue"
        style={{
          background: 'transparent',
          border: '1px solid var(--border, #D4C9B0)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.5,
          cursor: 'pointer',
          color: 'var(--fg, #3A3025)',
        }}
      >
        {cur.label} ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0,
          background: 'var(--bg-elevated, #FFFFFF)',
          border: '1px solid var(--border, #D4C9B0)',
          borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          minWidth: 130,
          zIndex: 1000,
          overflow: 'hidden',
        }}>
          {opts.map(o => (
            <button
              key={o.code}
              onClick={() => { setLang(o.code); setOpen(false) }}
              style={{
                display: 'block', width: '100%',
                padding: '8px 12px',
                background: o.code === lang ? 'var(--bg-panel)' : 'transparent',
                border: 'none', textAlign: 'left',
                fontSize: 13, color: 'var(--fg)',
                cursor: 'pointer',
              }}
            >
              <strong style={{ marginRight: 8 }}>{o.label}</strong> {o.full}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
