/**
 * ArretsHeatmap.jsx — Sprint 3 (mai 2026)
 * ========================================
 * 
 * Heatmap calendrier 12 mois × 7 jours, style GitHub contributions.
 * Chaque carré = 1 jour, intensité = nombre d'arrêts ce jour.
 * 
 * Branchement (MaintenanceHistoryDashboard.jsx) :
 *   <ArretsHeatmap arrets={dashboard.list} year={2025} />
 * 
 * Props :
 *   - arrets: [{ date_debut: ISO, type: string, duree: number }]
 *   - year: int (défaut: année courante)
 *   - onClickDay: (date, items) => void  (optionnel)
 */

import React, { useMemo, useState } from 'react'

const C = {
  border: 'var(--border, #D4C9B0)',
  fg: 'var(--fg, #3A3025)',
  fgMuted: 'var(--fg-muted, #6B5E45)',
  card: 'var(--bg-card, #FBF7E9)',
  // Échelle d'intensité (5 niveaux + vide)
  scale: ['#EFE9D8', '#E8C28A', '#D89F45', '#B8842B', '#8C5F18', '#5A3D08'],
}

const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']

function dayKey(d) {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

function buildGrid(arrets, year) {
  // index par jour
  const byDay = {}
  for (const a of arrets || []) {
    const dt = a?.date_debut || a?.date || a?.start_date
    if (!dt) continue
    let d
    try { d = new Date(dt) } catch (_) { continue }
    if (isNaN(d.getTime())) continue
    const k = dayKey(d)
    byDay[k] = (byDay[k] || []).concat(a)
  }

  // 53 semaines max × 7 jours
  const start = new Date(year, 0, 1)
  // Reculer jusqu'au dimanche précédent
  const startOffset = start.getDay() // 0 = dim
  start.setDate(start.getDate() - startOffset)

  const weeks = []
  for (let w = 0; w < 53; w++) {
    const week = []
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(start)
      d.setDate(start.getDate() + w * 7 + dow)
      const inYear = d.getFullYear() === year
      const k = dayKey(d)
      week.push({
        date: d, key: k, inYear,
        items: byDay[k] || [],
      })
    }
    weeks.push(week)
    if (start.getMonth() === 0 && weeks[w][6].date.getFullYear() > year) break
  }
  return weeks
}

function intensityFor(count, max) {
  if (count === 0) return 0
  if (max <= 1) return 1
  const r = count / max
  if (r > 0.8) return 5
  if (r > 0.5) return 4
  if (r > 0.3) return 3
  if (r > 0.1) return 2
  return 1
}

export default function ArretsHeatmap({ arrets = [], year, onClickDay }) {
  const yearN = year || new Date().getFullYear()
  const [hover, setHover] = useState(null)

  const grid = useMemo(() => buildGrid(arrets, yearN), [arrets, yearN])
  const max = useMemo(() => {
    let m = 0
    for (const week of grid) for (const d of week) m = Math.max(m, d.items.length)
    return m
  }, [grid])

  const total = useMemo(
    () => grid.reduce((s, w) => s + w.reduce((s2, d) => s2 + (d.inYear ? d.items.length : 0), 0), 0),
    [grid]
  )

  // Labels mois sur les semaines où le 1er du mois apparaît
  const monthLabels = useMemo(() => {
    const labels = []
    let lastMonth = -1
    grid.forEach((week, wi) => {
      const m = week[0].date.getMonth()
      if (m !== lastMonth && week[0].date.getDate() <= 7 && week[0].inYear) {
        labels.push({ month: m, week: wi })
        lastMonth = m
      }
    })
    return labels
  }, [grid])

  const cell = 12
  const gap = 2

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: 16,
      overflowX: 'auto',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 10,
      }}>
        <strong style={{ color: C.fg, fontSize: 14 }}>Activité {yearN}</strong>
        <span style={{ color: C.fgMuted, fontSize: 12 }}>
          {total} arrêts · max {max}/jour
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        {/* Mois labels */}
        <div style={{
          display: 'grid', gridTemplateColumns: `auto repeat(${grid.length}, ${cell}px)`,
          columnGap: gap, marginBottom: 4, marginLeft: 28,
        }}>
          {monthLabels.map(ml => (
            <div
              key={ml.month}
              style={{
                gridColumn: ml.week + 1,
                fontSize: 10, color: C.fgMuted,
              }}
            >{MONTHS_FR[ml.month]}</div>
          ))}
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: `28px repeat(${grid.length}, ${cell}px)`,
          gridTemplateRows: `repeat(7, ${cell}px)`,
          gap: gap,
        }}>
          {/* Labels jours (col 1) */}
          {[1, 3, 5].map(dow => (
            <div
              key={`label_${dow}`}
              style={{
                gridColumn: 1, gridRow: dow + 1,
                fontSize: 10, color: C.fgMuted,
                alignSelf: 'center',
              }}
            >{DAYS_FR[dow]}</div>
          ))}

          {grid.map((week, wi) => week.map((day, di) => {
            const lvl = day.inYear ? intensityFor(day.items.length, max) : 0
            return (
              <div
                key={`${wi}_${di}`}
                style={{
                  gridColumn: wi + 2, gridRow: di + 1,
                  width: cell, height: cell,
                  background: day.inYear ? C.scale[lvl] : 'transparent',
                  borderRadius: 2,
                  cursor: day.items.length ? 'pointer' : 'default',
                  border: lvl ? `0.5px solid rgba(0,0,0,0.05)` : 'none',
                }}
                onMouseEnter={() => setHover(day)}
                onMouseLeave={() => setHover(null)}
                onClick={() => day.items.length && onClickDay && onClickDay(day.date, day.items)}
              />
            )
          }))}
        </div>

        {/* Tooltip simple */}
        {hover && hover.items.length > 0 && (
          <div style={{
            position: 'absolute', top: -56, left: '50%', transform: 'translateX(-50%)',
            background: '#1a1a1a', color: '#fff',
            padding: '6px 10px', borderRadius: 6,
            fontSize: 11, whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}>
            <strong>{hover.items.length} arrêt{hover.items.length > 1 ? 's' : ''}</strong>
            <span style={{ opacity: 0.7, marginLeft: 6 }}>
              {hover.date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
            </span>
          </div>
        )}
      </div>

      {/* Légende */}
      <div style={{
        marginTop: 10,
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4,
        fontSize: 10, color: C.fgMuted,
      }}>
        <span>Moins</span>
        {C.scale.map((c, i) => (
          <div key={i} style={{
            width: cell, height: cell, background: c,
            borderRadius: 2, border: '0.5px solid rgba(0,0,0,0.05)',
          }} />
        ))}
        <span>Plus</span>
      </div>
    </div>
  )
}
