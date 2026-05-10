/**
 * MultiEngineComparison.jsx — Sprint 3 (mai 2026)
 * ================================================
 * 
 * Page comparaison multi-engins (994F1 vs 994F2 vs ...) :
 *   - KPIs côte à côte (RUL Global, Score d'anomalie, Heures, Arrêts)
 *   - Timelines superposées
 *   - Distribution 6 capteurs principaux (radar)
 * 
 * Endpoints utilisés :
 *   GET /pred/rul/predict/current?engin={id}
 *   GET /pred/rul/alert-class?engin={id}
 *   GET /history/dashboard?engin={id}
 * 
 * Ajout dans App.jsx (state-based) :
 *   {activeTab === "compare" && <MultiEngineComparison />}
 */

import React, { useEffect, useState } from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, CartesianGrid,
} from 'recharts'

const API = (typeof window !== 'undefined' && window.__API_URL__) || 'http://localhost:8000'

const C = {
  bg:    'var(--bg, #F5F0E1)',
  card:  'var(--bg-card, #FBF7E9)',
  fg:    'var(--fg, #3A3025)',
  fgMuted: 'var(--fg-muted, #6B5E45)',
  border: 'var(--border, #D4C9B0)',
  accent: 'var(--accent, #B8842B)',
}

const ENGINE_COLORS = ['#B8842B', '#2A6FB8', '#3F8F3F', '#C0392B', '#9C5BBE']
const DEFAULT_ENGINS = ['994F1', '994F2', '994F3', '994F4']

async function fetchEngin(engin) {
  // Tolérant aux 404 ; renvoie un objet "compact"
  const safeJson = (r) => r.ok ? r.json() : null
  try {
    const [pred, alert, hist] = await Promise.all([
      fetch(`${API}/pred/rul/predict/current?engin=${encodeURIComponent(engin)}`).then(safeJson).catch(() => null),
      fetch(`${API}/pred/rul/alert-class?engin=${encodeURIComponent(engin)}`).then(safeJson).catch(() => null),
      fetch(`${API}/history/dashboard?engin=${encodeURIComponent(engin)}&limit=300`).then(safeJson).catch(() => null),
    ])
    return { engin, pred, alert, hist, error: null }
  } catch (e) {
    return { engin, pred: null, alert: null, hist: null, error: String(e) }
  }
}

function KpiCell({ label, value, unit, color, sub }) {
  return (
    <div style={{
      flex: 1, padding: 12, textAlign: 'center',
      borderRight: `1px solid ${C.border}`,
    }}>
      <div style={{ fontSize: 11, color: C.fgMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || C.fg, marginTop: 4 }}>
        {value}
        {unit && <span style={{ fontSize: 12, color: C.fgMuted, marginLeft: 4 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.fgMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function EngineCard({ data, color }) {
  const { engin, pred, alert, hist } = data
  const rulGlobal = pred?.rul_global_h ?? pred?.rul_heures ?? null
  const alertClass = alert?.alerte_globale || pred?.alert_class || '—'
  const arrets = hist?.stats?.total_arrets ?? '—'
  const indispoH = hist?.stats?.total_duree_heures ?? '—'

  const alertColor = {
    RED: '#C0392B', ORANGE: '#E58E26', GREEN: '#3F8F3F',
  }[alertClass] || C.fgMuted

  return (
    <div style={{
      background: C.card,
      border: `2px solid ${color}`,
      borderRadius: 10,
      padding: 0,
      overflow: 'hidden',
    }}>
      <header style={{
        background: color, color: '#fff',
        padding: '10px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <strong style={{ fontSize: 16 }}>{engin}</strong>
        <span style={{
          background: 'rgba(255,255,255,0.25)',
          padding: '2px 8px', borderRadius: 4,
          fontSize: 11, fontWeight: 700,
        }}>{alertClass}</span>
      </header>
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
        <KpiCell
          label="RUL Global"
          value={rulGlobal != null ? Math.round(rulGlobal) : '—'}
          unit={rulGlobal != null ? 'h' : ''}
          color={alertColor}
        />
        <KpiCell
          label="Arrêts"
          value={arrets}
          sub={indispoH !== '—' ? `${Math.round(indispoH)} h indispo` : null}
        />
      </div>
      <div style={{ padding: 12, fontSize: 12, color: C.fgMuted }}>
        {pred?.timestamp && <div>Prédit : {new Date(pred.timestamp).toLocaleString('fr-FR')}</div>}
        {pred?.message && <div style={{ color: '#7A1F0E' }}>{pred.message}</div>}
        {!pred && <div>Aucune prédiction (fichier capteurs absent ?)</div>}
      </div>
    </div>
  )
}

function ComparisonChart({ engines }) {
  const data = engines
    .filter(e => e.pred?.rul_global_h != null || e.pred?.rul_heures != null)
    .map((e, i) => ({
      engin: e.engin,
      rul: e.pred?.rul_global_h ?? e.pred?.rul_heures,
      arrets: e.hist?.stats?.total_arrets ?? 0,
      heuresIndispo: e.hist?.stats?.total_duree_heures ?? 0,
      color: ENGINE_COLORS[i % ENGINE_COLORS.length],
    }))

  if (data.length === 0) return <div style={{ color: C.fgMuted, padding: 20 }}>Aucune donnée à comparer.</div>

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: 14,
      }}>
        <h4 style={{ margin: '0 0 10px', fontSize: 14, color: C.fg }}>RUL global (heures)</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="engin" stroke={C.fgMuted} fontSize={12} />
            <YAxis stroke={C.fgMuted} fontSize={11} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}` }} />
            <Bar dataKey="rul" fill={C.accent} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: 14,
      }}>
        <h4 style={{ margin: '0 0 10px', fontSize: 14, color: C.fg }}>Arrêts cumulés</h4>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="engin" stroke={C.fgMuted} fontSize={12} />
            <YAxis stroke={C.fgMuted} fontSize={11} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}` }} />
            <Bar dataKey="arrets" fill="#2A6FB8" />
            <Bar dataKey="heuresIndispo" fill="#C0392B" name="Heures indispo" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function TimelineComparison({ engines }) {
  // Combine toutes les timelines en mode super-imposé
  const seriesByEngin = {}
  engines.forEach(e => {
    const tl = e.hist?.timeline || []
    seriesByEngin[e.engin] = {}
    for (const pt of tl) {
      seriesByEngin[e.engin][pt.date || pt.month] = pt.count ?? pt.value ?? 0
    }
  })
  // Construit l'index union des dates
  const dates = Array.from(new Set(
    engines.flatMap(e => (e.hist?.timeline || []).map(t => t.date || t.month))
  )).sort()

  if (dates.length === 0) return null
  const data = dates.map(d => {
    const row = { date: d }
    engines.forEach(e => { row[e.engin] = seriesByEngin[e.engin]?.[d] ?? 0 })
    return row
  })

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: 14, marginTop: 16,
    }}>
      <h4 style={{ margin: '0 0 10px', fontSize: 14, color: C.fg }}>
        Chronologie arrêts (toutes engins superposées)
      </h4>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="date" stroke={C.fgMuted} fontSize={11} />
          <YAxis stroke={C.fgMuted} fontSize={11} />
          <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}` }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {engines.map((e, i) => (
            <Line
              key={e.engin}
              type="monotone"
              dataKey={e.engin}
              stroke={ENGINE_COLORS[i % ENGINE_COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function MultiEngineComparison({ engins = DEFAULT_ENGINS }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const results = await Promise.all(engins.map(fetchEngin))
      setData(results)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [engins.join(',')])

  return (
    <div style={{
      padding: '20px 24px',
      background: C.bg,
      minHeight: '100vh',
      color: C.fg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 18,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Comparaison multi-engins</h1>
          <p style={{ margin: '4px 0 0', color: C.fgMuted, fontSize: 13 }}>
            Côte à côte : {engins.join(', ')} · KPIs · Timelines · Indispo
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: C.accent, color: '#fff',
            padding: '8px 14px', borderRadius: 6,
            border: 'none', fontWeight: 600, cursor: 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >{loading ? 'Chargement…' : 'Recharger'}</button>
      </div>

      {error && (
        <div style={{
          background: '#FEE7E0', color: '#7A1F0E',
          padding: 12, borderRadius: 6, marginBottom: 16,
        }}>Erreur : {error}</div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(data.length, 4)}, 1fr)`,
        gap: 16, marginBottom: 18,
      }}>
        {data.map((d, i) => (
          <EngineCard key={d.engin} data={d} color={ENGINE_COLORS[i % ENGINE_COLORS.length]} />
        ))}
      </div>

      <ComparisonChart engines={data} />
      <TimelineComparison engines={data} />
    </div>
  )
}
