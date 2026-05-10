/**
 * CommandPalette.jsx — Sprint 3 (mai 2026)
 * =========================================
 * 
 * Palette de commandes globale (raccourci Ctrl+K / Cmd+K) inspirée de
 * VS Code, Linear, Notion : navigation rapide entre les 24 pages,
 * recherche dans les capteurs, codes défaut, raccourcis vers actions.
 * 
 * Branchement (App.jsx) :
 *   <CommandPalette
 *     pages={navigationItems}     // [{path:'/dashboard', label:'Vue 360°', icon:'🏠'}]
 *     sensors={SENSORS_LIST}       // optionnel : liste capteurs
 *     onNavigate={p => navigate(p)}
 *   />
 * 
 * UX :
 *   - Ctrl+K (ou Cmd+K Mac) ouvre la palette
 *   - Tapez pour filtrer (matching fuzzy + tolérance accents)
 *   - Flèches ↑↓ pour naviguer
 *   - Entrée pour exécuter, Échap pour fermer
 *   - Click hors palette ferme aussi
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'

const DEFAULT_PAGES = [
  { path: '/dashboard',         label: 'Vue 360°',                  icon: '◉', group: 'Dashboard' },
  { path: '/gmao',              label: 'GMAO',                      icon: '◈', group: 'Dashboard' },
  { path: '/anomalies',         label: 'Anomalies',                 icon: '⚠', group: 'Surveillance' },
  { path: '/geolocalisation',   label: 'Géolocalisation',           icon: '◎', group: 'Surveillance' },
  { path: '/oil-analysis',      label: 'Analyse huile',             icon: '⬢', group: 'Surveillance' },
  { path: '/executive',         label: 'Vue exécutive',             icon: '★', group: 'Dashboard' },
  { path: '/rul',               label: 'RUL Engin',                 icon: '◇', group: 'Prédictif' },
  { path: '/prediction',        label: 'Prédiction',                icon: '◆', group: 'Prédictif' },
  { path: '/alertes',           label: 'Alertes',                   icon: '!', group: 'Surveillance' },
  { path: '/files',             label: 'Fichiers Capteurs',         icon: '↥', group: 'Données' },
  { path: '/health',            label: 'Santé OCP',                 icon: '+', group: 'Prédictif' },
  { path: '/defauts',           label: 'Défauts',                   icon: '✕', group: 'Surveillance' },
  { path: '/troubleshooting',   label: 'Diagnostic',                icon: '?', group: 'IA' },
  { path: '/history',           label: 'Historique',                icon: '⟲', group: 'Données' },
  { path: '/monitoring',        label: 'Monitoring',                icon: '~', group: 'Surveillance' },
  { path: '/simulation',        label: 'Live Simulation',           icon: '▶', group: 'Surveillance' },
  { path: '/capteurs',          label: 'Capteurs',                  icon: '◬', group: 'Données' },
  { path: '/ask',               label: 'Ask IA',                    icon: '✦', group: 'IA' },
  { path: '/explainability',    label: 'Explicabilité ML (SHAP)',   icon: '※', group: 'IA' },
  { path: '/compare',           label: 'Comparer engins',           icon: '↔', group: 'Dashboard' },
  { path: '/report',            label: 'Rapport exécutif',          icon: '⎙', group: 'Dashboard' },
]

// Normalise un texte pour matching (sans accent, lowercase)
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Score fuzzy simple : tous les caractères du query doivent apparaître dans l'ordre.
function fuzzyScore(query, target) {
  const q = norm(query)
  const t = norm(target)
  if (!q) return 1
  if (t.includes(q)) return 100 - Math.abs(t.length - q.length) // bonus exact
  let qi = 0, score = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += 1
      qi += 1
    }
  }
  return qi === q.length ? score : 0
}

export default function CommandPalette({
  pages = DEFAULT_PAGES,
  sensors = [],
  faultCodes = [],
  onNavigate,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)

  // Raccourci global Ctrl+K / Cmd+K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen(o => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Auto-focus input quand ouvert
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
    else { setQuery(''); setActiveIdx(0) }
  }, [open])

  // Items combinés (pages + capteurs + codes défaut)
  const allItems = useMemo(() => [
    ...pages.map(p => ({ ...p, type: 'page' })),
    ...sensors.map(s => ({
      path: `/capteurs?focus=${encodeURIComponent(s.code || s.id)}`,
      label: s.label || s.name || s.code,
      icon: '◬',
      group: 'Capteurs',
      meta: s.unit || '',
      type: 'sensor',
    })),
    ...faultCodes.map(c => ({
      path: `/troubleshooting?code=${encodeURIComponent(c.code || c)}`,
      label: c.label || `Code ${c.code || c}`,
      icon: '✕',
      group: 'Codes défaut',
      type: 'fault',
    })),
  ], [pages, sensors, faultCodes])

  // Filtered & scored
  const items = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 30)
    return allItems
      .map(it => ({ ...it, _score: fuzzyScore(query, it.label) + 0.2 * fuzzyScore(query, it.group || '') }))
      .filter(it => it._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 30)
  }, [allItems, query])

  const handleSelect = useCallback((item) => {
    if (!item) return
    setOpen(false)
    if (typeof onNavigate === 'function') onNavigate(item.path)
    else window.location.hash = '#' + item.path
  }, [onNavigate])

  // Navigation clavier
  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleSelect(items[activeIdx])
    }
  }

  if (!open) return null

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        animation: 'mineassist-fade 0.15s ease',
      }}
    >
      <style>{`
        @keyframes mineassist-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mineassist-slide { from { transform: translateY(-8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)',
          background: 'var(--bg-elevated, #FFFFFF)',
          color: 'var(--fg, #3A3025)',
          border: '1px solid var(--border, #D4C9B0)',
          borderRadius: 12,
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          animation: 'mineassist-slide 0.2s ease',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border, #D4C9B0)',
          gap: 10,
        }}>
          <span style={{ fontSize: 18, color: 'var(--fg-muted)' }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            onKeyDown={onInputKey}
            placeholder="Rechercher pages, capteurs, codes…"
            style={{
              flex: 1,
              border: 'none', outline: 'none', background: 'transparent',
              fontSize: 16,
              color: 'var(--fg, #3A3025)',
              fontFamily: 'inherit',
            }}
          />
          <kbd style={{
            border: '1px solid var(--border)',
            padding: '2px 6px', borderRadius: 4,
            fontSize: 11, color: 'var(--fg-muted)',
            fontFamily: 'monospace',
          }}>esc</kbd>
        </div>

        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {items.length === 0 ? (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              color: 'var(--fg-muted)', fontSize: 14,
            }}>
              Aucun résultat
            </div>
          ) : items.map((it, idx) => (
            <button
              key={it.path + idx}
              onClick={() => handleSelect(it)}
              onMouseEnter={() => setActiveIdx(idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%',
                padding: '10px 16px',
                background: activeIdx === idx ? 'var(--bg-panel, #EFE9D8)' : 'transparent',
                border: 'none',
                borderLeft: activeIdx === idx ? '3px solid var(--accent, #B8842B)' : '3px solid transparent',
                cursor: 'pointer',
                color: 'var(--fg)',
                fontSize: 14,
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              <span style={{
                width: 28, height: 28,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-panel)',
                borderRadius: 6,
                fontSize: 14, color: 'var(--accent)',
                fontWeight: 700,
              }}>{it.icon || '•'}</span>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{it.label}</span>
                {it.meta && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--fg-muted)' }}>{it.meta}</span>}
              </span>
              <span style={{
                fontSize: 11,
                color: 'var(--fg-subtle)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}>{it.group || it.type}</span>
            </button>
          ))}
        </div>

        <div style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--fg-subtle)',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span><kbd style={kbdStyle}>↑↓</kbd> naviguer · <kbd style={kbdStyle}>↵</kbd> ouvrir · <kbd style={kbdStyle}>esc</kbd> fermer</span>
          <span>{items.length} résultat{items.length > 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  )
}

const kbdStyle = {
  border: '1px solid var(--border)',
  padding: '1px 5px',
  borderRadius: 3,
  fontSize: 10,
  fontFamily: 'monospace',
  margin: '0 2px',
}
