// ─────────────────────────────────────────────────────────────────────────────
// src/pages/PredictionPage.jsx — REFONTE v3 ROBUSTE
// - Couleurs hex solides (pas de template literals ${color}XX qui peuvent etre
//   mal parses sur certains browsers)
// - Layouts en flexbox simple (pas de grid avec 320px/1fr complexe)
// - Fallbacks visibles si donnees manquantes
// - Mode debug ?debug=1 : affiche le JSON brut recu du backend
// - Tableau capteurs en <table> HTML standard
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Area, AreaChart,
} from 'recharts'
import { API } from '../config'

// ── Constantes ──────────────────────────────────────────────────────────────
const HORIZON_PROB_KEY = { 720: 'proba_1d', 5040: 'proba_1w', 10080: 'proba_2w' }
const HORIZON_LABEL    = { 720: '1 jour',   5040: '1 semaine', 10080: '2 semaines' }
const FORECAST_LABEL   = { 720: '1h36',     5040: '3h12',      10080: '4h48' }

// ── Mode debug : ?debug=1 dans l'URL ────────────────────────────────────────
const DEBUG = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('debug') === '1'

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtPct = v => v == null || isNaN(v) ? '—' : `${(v * 100).toFixed(1)}%`
const fmtNum = (v, d=1) => v == null || isNaN(v) ? '—' : Number(v).toFixed(d)

// ── Tooltip personnalise ────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #D4C9B0',
      borderRadius: 6, padding: '6px 10px', fontSize: 11,
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <div style={{ color: '#8A7D60', marginBottom: 3, fontSize: 10 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 700 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(3) : p.value}
        </div>
      ))}
    </div>
  )
}

// ── Hero : KPI geant + sparkline cote a cote en flex ────────────────────────
function HeroBanner({ proba, seuil, alerte, horizonLabel, points, probKey }) {
  const data = useMemo(
    () => points.map(p => ({ d: String(p.date || '').slice(5, 16), v: p[probKey] ?? null })),
    [points, probKey]
  )
  // Couleurs solides — pas de template literals avec alpha
  const color    = alerte ? '#C0392B' : '#00843D'
  const bgPale   = alerte ? '#FBEFEC' : '#EAF6EE'
  const bgGrad1  = alerte ? '#FCE9E5' : '#DCF1E2'
  const bgGrad2  = alerte ? '#F8DDD7' : '#C8E8D2'
  const borderC  = alerte ? '#E8B5AD' : '#A8D9B6'
  const title    = alerte ? 'PANNE PROBABLE' : 'SITUATION NORMALE'
  const subtitle = alerte
    ? 'Intervention recommandee — voir onglet Alertes'
    : 'Aucune action immediate requise'

  return (
    <div style={{
      background: bgPale,
      border: `1px solid ${borderC}`,
      borderRadius: 14,
      overflow: 'hidden',
      display: 'flex',           // ← FLEX (pas grid)
      flexWrap: 'wrap',           // pour mobile
      minHeight: 180,
    }}>
      {/* Bloc gauche : KPI geant — flex-basis 320px */}
      <div style={{
        flex: '0 0 320px',
        minWidth: 280,
        background: `linear-gradient(135deg, ${bgGrad1} 0%, ${bgGrad2} 100%)`,
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        borderRight: `1px solid ${borderC}`,
        boxSizing: 'border-box',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 2, color,
          textTransform: 'uppercase', marginBottom: 6,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          Probabilite de panne
        </div>
        <div style={{
          fontFamily: '"Rajdhani", system-ui, sans-serif',
          fontSize: 64, fontWeight: 900,
          color, lineHeight: 1, marginBottom: 4,
        }}>
          {fmtPct(proba)}
        </div>
        <div style={{
          fontFamily: '"Rajdhani", system-ui, sans-serif',
          fontSize: 18, fontWeight: 800, color, letterSpacing: 0.5,
        }}>
          {title}
        </div>
        <div style={{
          fontSize: 11, color: '#8A7D60', marginTop: 4,
          fontFamily: 'system-ui, sans-serif',
        }}>
          dans les {horizonLabel} suivants — seuil {fmtPct(seuil)}
        </div>
        <div style={{
          fontSize: 11, color: '#5A5240', marginTop: 8, fontStyle: 'italic',
          fontFamily: 'system-ui, sans-serif',
        }}>
          {subtitle}
        </div>
      </div>
      {/* Bloc droit : sparkline — flex 1 */}
      <div style={{
        flex: '1 1 400px', minWidth: 300,
        padding: '14px 18px 8px',
        boxSizing: 'border-box',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 10, color: '#8A7D60', letterSpacing: 1,
          textTransform: 'uppercase', fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
        }}>
          <span>Evolution probabilite</span>
          <span>{points.length} points · forecast {FORECAST_LABEL[probKey === 'proba_1d' ? 720 : probKey === 'proba_1w' ? 5040 : 10080]}</span>
        </div>
        <ResponsiveContainer width="100%" height={130}>
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="probGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor={color} stopOpacity={0.35}/>
                <stop offset="100%" stopColor={color} stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="d" tick={{ fill: '#B0A080', fontSize: 9 }}
                   axisLine={false} tickLine={false}
                   interval={Math.max(0, Math.floor(data.length/6))} />
            <YAxis domain={[0,1]} tick={{ fill: '#B0A080', fontSize: 9 }}
                   tickFormatter={v => `${(v*100).toFixed(0)}%`}
                   axisLine={false} tickLine={false} width={32} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={seuil} stroke="#C4760A" strokeDasharray="4 3"
              label={{ value: `seuil ${(seuil*100).toFixed(0)}%`, position: 'right',
                       fontSize: 9, fill: '#C4760A' }} />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2}
                  fill="url(#probGrad)" name="Probabilite" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Mini-sparkline pour ligne capteur ───────────────────────────────────────
function Sparkline({ values, color }) {
  if (!values || values.length === 0) return <div style={{ width: 100, height: 24 }} />
  const data = values.map((v, i) => ({ i, v }))
  return (
    <ResponsiveContainer width={120} height={28}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false}/>
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Drawer detail capteur (zoom courbe) ─────────────────────────────────────
function SensorDetail({ col, points, forecast, bounds, horizonVal, onClose }) {
  const cfg = bounds?.[col]
  if (!col) return null

  const histData = points.map(p => ({
    d: String(p.date || '').slice(5, 16),
    v: p[col] ?? null, p: null,
  }))
  const lastReal = histData.length > 0 ? histData[histData.length - 1].v : null
  const junction = histData.length > 0
    ? [{ d: histData[histData.length - 1].d, v: null, p: lastReal }]
    : []
  const forecastData = (forecast || []).map(p => ({
    d: String(p.date || '').slice(5, 16),
    v: null, p: p[col] ?? null,
  }))
  const data = [...histData, ...junction, ...forecastData]
  const splitIdx = histData.length

  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #D4C9B0',
      borderRadius: 12, padding: '16px 20px', marginTop: 16,
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 10,
      }}>
        <div>
          <div style={{
            fontSize: 10, color: '#00843D', fontWeight: 700,
            letterSpacing: 1.5, textTransform: 'uppercase',
            fontFamily: 'system-ui, sans-serif',
          }}>
            Detail capteur · prevision {HORIZON_LABEL[horizonVal]}
          </div>
          <div style={{
            fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 22,
            fontWeight: 800, color: '#2A2A1E',
          }}>
            {cfg?.label || col} <span style={{ fontSize: 13, color: '#8A7D60' }}>({cfg?.unit || ''})</span>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: '1px solid #D4C9B0', borderRadius: 6,
          padding: '4px 12px', cursor: 'pointer', color: '#5A5240', fontSize: 12,
        }}>
          ✕ Fermer
        </button>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#D4C9B0" />
          <XAxis dataKey="d" tick={{ fill: '#B0A080', fontSize: 10 }}
                 axisLine={false} tickLine={false}
                 interval={Math.max(0, Math.floor(data.length/6))} />
          <YAxis tick={{ fill: '#B0A080', fontSize: 10 }}
                 axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          {splitIdx < data.length && (
            <ReferenceLine x={data[splitIdx]?.d}
              stroke="#B0A080" strokeDasharray="4 3"
              label={{ value: '→ Futur', position: 'top', fontSize: 10, fill: '#8A7D60' }} />
          )}
          {cfg?.threshold_max != null && (
            <ReferenceLine y={cfg.threshold_max} stroke="#C0392B"
              strokeDasharray="6 3" strokeWidth={1.4}
              label={{ value: `MAX ${cfg.threshold_max} ${cfg.unit||''}`, position: 'insideTopRight',
                       fontSize: 10, fill: '#C0392B' }} />
          )}
          {cfg?.threshold_min != null && (
            <ReferenceLine y={cfg.threshold_min} stroke="#00843D"
              strokeDasharray="6 3" strokeWidth={1.4}
              label={{ value: `MIN ${cfg.threshold_min} ${cfg.unit||''}`, position: 'insideBottomRight',
                       fontSize: 10, fill: '#00843D' }} />
          )}
          <Line type="monotone" dataKey="v" stroke="#3B82F6" dot={false}
                strokeWidth={2} name="Reel" connectNulls />
          <Line type="monotone" dataKey="p" stroke="#C4760A" dot={false}
                strokeWidth={2} strokeDasharray="5 3" name="Prévision RUL" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Loader avec progression et timer ────────────────────────────────────────
function RulLoader({ elapsed, message }) {
  const ESTIMATED_S = 20
  const pct = Math.min(98, (elapsed / ESTIMATED_S) * 100)
  const overTime = elapsed > ESTIMATED_S + 10
  const barColor = overTime ? '#C0392B' : '#00843D'

  return (
    <div style={{ padding: '60px 24px', maxWidth: 540, margin: '0 auto', textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, margin: '0 auto 18px',
        border: '4px solid #E8F5EE', borderTopColor: '#00843D',
        borderRadius: '50%', animation: 'spin 1s linear infinite',
      }} />
      <div style={{
        fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 22, fontWeight: 700,
        color: '#005C2B', marginBottom: 8, letterSpacing: 0.5,
      }}>
        {message || 'Calcul XGBoost RUL en cours'}
      </div>
      <div style={{ fontSize: 13, color: '#8A7D60', marginBottom: 18 }}>
        {elapsed.toFixed(0)}s ecoulees
        {!overTime && elapsed > 0 && ` / ~${ESTIMATED_S}s estimees`}
      </div>
      <div style={{ height: 6, background: '#D4C9B0', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: barColor,
          transition: 'width 0.3s ease',
        }} />
      </div>
      <div style={{
        marginTop: 22, padding: '10px 14px',
        background: '#E8F5EE', border: '1px solid #00843D55',
        borderRadius: 8, textAlign: 'left',
        fontSize: 11.5, color: '#2A2A1E', lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 700, color: '#00843D', marginBottom: 3 }}>
          📊 Modèle XGBoost RUL en calcul
        </div>
        <div style={{ color: '#8A7D60' }}>
          Premier chargement : 15-25s pour 100k+ points.
          Les rafraichissements suivants seront <strong>quasi instantanes</strong>
          {' '}grace au cache backend.
        </div>
      </div>
      {overTime && (
        <div style={{
          marginTop: 14, padding: '10px 14px',
          background: '#FDECEA', border: '1px solid #C0392B55',
          borderRadius: 8, fontSize: 11.5, color: '#C0392B', textAlign: 'left',
        }}>
          ⚠ Le calcul prend plus de temps que prevu. Verifie que le backend
          tourne et que les modèles XGBoost sont chargés.
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Panneau de debug — affiche le JSON brut ─────────────────────────────────
function DebugPanel({ data, error, loading }) {
  if (!DEBUG) return null
  return (
    <div style={{
      background: '#FFF8E1', border: '2px solid #C4760A',
      borderRadius: 8, padding: 12, marginBottom: 16,
      fontSize: 11, fontFamily: 'monospace', color: '#2A2A1E',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#C4760A' }}>
        🐞 DEBUG MODE — donnees recues du backend
      </div>
      <div>Loading: {String(loading)}</div>
      <div>Error: {error || '(none)'}</div>
      <div>Data keys: {data ? Object.keys(data).join(', ') : '(no data)'}</div>
      {data && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', color: '#005C2B' }}>Voir JSON complet</summary>
          <pre style={{
            maxHeight: 300, overflow: 'auto',
            background: '#FFF', padding: 8, marginTop: 4, borderRadius: 4,
            fontSize: 10,
          }}>
{JSON.stringify(data, null, 2).slice(0, 3000)}
          </pre>
        </details>
      )}
    </div>
  )
}

// ── Page principale ─────────────────────────────────────────────────────────
export default function PredictionPage(props) {
  const apiFetch = props?.apiFetch || fetch

  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [elapsed,    setElapsed]    = useState(0)
  const [horizonVal, setHorizonVal] = useState(720)
  const [selected,   setSelected]   = useState(null)

  // Timer pendant le loading
  useEffect(() => {
    if (!loading) { setElapsed(0); return }
    const t0 = Date.now()
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 200)
    return () => clearInterval(id)
  }, [loading])

  useEffect(() => {
    if (!apiFetch) {
      setError("apiFetch n'est pas disponible (verifier useAuth ou prop)")
      setLoading(false)
      return
    }
    let aborted = false
    setLoading(true); setError(null)
    const ctrl = new AbortController()
    const tmo = setTimeout(() => ctrl.abort(), 90000)

    apiFetch(`${API}/pred/prediction`, { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(json => { if (!aborted) setData(json) })
      .catch(err => {
        if (aborted) return
        if (err.name === 'AbortError') {
          setError('Le calcul a depasse 90 secondes. Verifie le backend.')
        } else {
          setError(err.message)
        }
      })
      .finally(() => { if (!aborted) { setLoading(false); clearTimeout(tmo) } })

    return () => { aborted = true; ctrl.abort(); clearTimeout(tmo) }
  }, [apiFetch])

  if (loading) return (
    <div>
      <DebugPanel data={data} error={error} loading={loading} />
      <RulLoader elapsed={elapsed} />
    </div>
  )

  if (error) return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '20px 28px' }}>
      <DebugPanel data={data} error={error} loading={loading} />
      <div style={{
        background: '#FDECEA', border: '1px solid #C0392B55',
        borderRadius: 12, padding: 20, color: '#C0392B', maxWidth: 600, margin: '60px auto',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠ Erreur de prediction</div>
        <div style={{ fontSize: 13 }}>{error}</div>
        <div style={{ fontSize: 12, color: '#8A7D60', marginTop: 8 }}>
          Chargez un fichier via “OCP Fichiers”, vérifiez que le backend `/pred` est démarré, puis revenez ici.
        </div>
      </div>
    </div>
  )

  // Si pas de data malgre loading=false (defensive) : message visible
  if (!data) return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '20px 28px' }}>
      <DebugPanel data={data} error={error} loading={loading} />
      <div style={{
        background: '#FFF8E1', border: '1px solid #C4760A',
        borderRadius: 12, padding: 20, color: '#2A2A1E', maxWidth: 600, margin: '60px auto',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: '#C4760A' }}>
          ⚠ Aucune donnee recue du backend
        </div>
        <div style={{ fontSize: 13 }}>
          Le serveur a repondu mais l'objet est vide. Verifie que <code>/pred/prediction</code>
          renvoie bien un JSON.
        </div>
      </div>
    </div>
  )

  const points  = data?.points       || []
  const stats   = data?.statistiques || {}
  const seuil   = data?.seuil_decision ?? 0.5
  const info    = data?.model_info   || {}
  const probKey = HORIZON_PROB_KEY[horizonVal] ?? 'proba_2w'
  const proba   = points.length > 0 ? (points[points.length - 1][probKey] || 0) : 0
  const alerte  = proba >= seuil
  const horizon = HORIZON_LABEL[horizonVal] ?? '2 semaines'
  // forecast peut etre soit un array soit un objet { '720': [...], '5040': [...], '10080': [...] }
  const rawForecast = data?.forecast
  const forecast = Array.isArray(rawForecast)
    ? rawForecast
    : (rawForecast?.[String(horizonVal)] ?? [])
  const bounds = data?.bounds || data?.sensor_bounds || {}

  const SENSOR_COLS = data?.sensor_cols || [
    'Regime_moteur','Pression_huile','Temp_refroid',
    'Regime_conv','Temp_conv','Temp_huile_dir'
  ]

  return (
    <div style={{
      padding: '20px 28px',
      maxWidth: 1440,
      margin: '0 auto',
      color: '#2A2A1E',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: 12,
      boxSizing: 'border-box',
    }}>
      {/* ── DEBUG PANEL ─────────────────────────────────────────────────── */}
      <DebugPanel data={data} error={error} loading={loading} />

      {/* ── TOP BAR : titre + horizon + badge cache ────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 2,
            color: '#00843D', textTransform: 'uppercase',
          }}>
            Module 8 · Prédiction XGBoost RUL
          </div>
          <h2 style={{
            fontSize: 22, fontWeight: 800, color: '#2A2A1E', margin: '2px 0 0',
            fontFamily: '"Rajdhani", system-ui, sans-serif', letterSpacing: 0.5,
          }}>
            Probabilite de panne · CAT 994F
          </h2>
          {/* Badge cache / timing */}
          <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {data._cached ? (
              <span style={{
                fontSize: 9, padding: '2px 7px', borderRadius: 10,
                background: '#E8F5EE', color: '#005C2B',
                fontWeight: 700, letterSpacing: 0.5,
              }}>⚡ CACHE</span>
            ) : (
              <span style={{
                fontSize: 9, padding: '2px 7px', borderRadius: 10,
                background: '#F7F0DC', color: '#8C7012',
                fontWeight: 700, letterSpacing: 0.5,
              }}>📊 RUL CALCULÉ</span>
            )}
            {data._timing && (
              <span style={{ fontSize: 10, color: '#8A7D60' }}>
                load {data._timing.load_ms}ms · predict {data._timing.predict_ms}ms
              </span>
            )}
          </div>
        </div>
        {/* Horizon segmented control */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#FFFFFF', border: '1px solid #D4C9B0',
          borderRadius: 10, padding: 4,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#8A7D60',
            letterSpacing: 1, padding: '0 6px',
          }}>HORIZON</span>
          {[
            { label: '1 jour',     val: 720 },
            { label: '1 semaine',  val: 5040 },
            { label: '2 semaines', val: 10080 },
          ].map(opt => (
            <button key={opt.val} onClick={() => setHorizonVal(opt.val)}
              style={{
                background: horizonVal === opt.val ? '#00843D' : 'transparent',
                color:      horizonVal === opt.val ? '#FFFFFF' : '#5A5240',
                border: 'none', borderRadius: 6, padding: '6px 14px',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.15s',
                fontFamily: 'inherit',
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── LAYOUT PRINCIPAL : flex 2 colonnes ──────────────────────────── */}
      <div style={{
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}>
        {/* === COLONNE GAUCHE : flex 1, min 0 === */}
        <div style={{ flex: '1 1 700px', minWidth: 0, boxSizing: 'border-box' }}>
          {/* Hero banner */}
          <HeroBanner
            proba={proba} seuil={seuil} alerte={alerte}
            horizonLabel={horizon} points={points} probKey={probKey}
          />

          {/* === Tableau capteurs en <table> === */}
          <div style={{
            marginTop: 16,
            background: '#FFFFFF',
            border: '1px solid #D4C9B0',
            borderRadius: 12,
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
              tableLayout: 'fixed',
            }}>
              <thead>
                <tr style={{
                  background: '#E8F5EE',
                  borderBottom: '1px solid #D4C9B0',
                }}>
                  <th style={thStyle({ width: 8, padding: 0 })}></th>
                  <th style={thStyle({ width: 'auto', textAlign: 'left' })}>Capteur</th>
                  <th style={thStyle({ width: 90, textAlign: 'right' })}>Valeur</th>
                  <th style={thStyle({ width: 60, textAlign: 'right' })}>Seuil</th>
                  <th style={thStyle({ width: 130, textAlign: 'left' })}>Tendance</th>
                  <th style={thStyle({ width: '30%', textAlign: 'left' })}>Niveau · usage</th>
                </tr>
              </thead>
              <tbody>
                {SENSOR_COLS.map(col => (
                  <SensorRow key={col} col={col}
                    points={points} forecast={forecast} bounds={bounds}
                    onSelect={c => setSelected(c === selected ? null : c)}
                    selected={selected === col} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Detail capteur (zoom) */}
          {selected && (
            <SensorDetail col={selected} points={points} forecast={forecast}
              bounds={bounds} horizonVal={horizonVal}
              onClose={() => setSelected(null)} />
          )}
        </div>

        {/* === COLONNE DROITE : 320px fixe === */}
        <div style={{
          flex: '0 0 320px',
          maxWidth: 320,
          minWidth: 280,
          boxSizing: 'border-box',
        }}>
          {/* Stats fenetre */}
          <SidePanel title="Statistiques de la fenetre">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Metric label="Probabilite max"  value={fmtPct(stats.prob_max)}  highlight />
              <Metric label="Probabilite moy." value={fmtPct(stats.prob_mean)} />
              <Metric label="Pts en alerte"    value={stats.n_alertes ?? 0}    highlight />
              <Metric label="% temps alerte"   value={fmtPct(stats.pct_alertes)} />
            </div>
          </SidePanel>

          {/* Modele */}
          <SidePanel title="XGBoost RUL" style={{ marginTop: 12 }}>
            <ModelRow label="AUC test"      value={fmtPct(info.auc)} />
            <ModelRow label="F2 validation" value={fmtNum(info.f2_score, 3)} />
            <ModelRow label="Window"        value={`${info.window_size || '—'} pts`} />
            <ModelRow label="Features"      value={info.n_features || '—'} />
            <ModelRow label="Niveau anomalie" value={info.anomaly_level || '—'} />
          </SidePanel>

          {/* Comment lire */}
          <SidePanel title="Comment lire" style={{ marginTop: 12, background: '#E8F5EE' }}>
            <div style={{ fontSize: 11, color: '#2A2A1E', lineHeight: 1.6 }}>
              · <strong>Cliquez une ligne capteur</strong> pour zoomer sa courbe.<br/>
              · La <strong>tendance</strong> = 60 derniers points + prevision.<br/>
              · La <strong>barre</strong> = niveau d'usage par rapport au seuil OCP.
            </div>
          </SidePanel>
        </div>
      </div>
    </div>
  )
}

// ── Helpers de styling ─────────────────────────────────────────────────────
function thStyle(opts) {
  return {
    fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
    color: '#005C2B', textTransform: 'uppercase',
    padding: '10px 14px',
    textAlign: opts.textAlign || 'center',
    width: opts.width,
    ...opts,
  }
}

// ── Ligne tableau capteurs ──────────────────────────────────────────────────
function SensorRow({ col, points, forecast, bounds, onSelect, selected }) {
  const cfg = bounds?.[col]
  const last = points.length > 0 ? points[points.length - 1][col] : null
  const tMax = cfg?.threshold_max
  const tMin = cfg?.threshold_min
  const unit = cfg?.unit || ''
  const label = cfg?.label || col.replace(/_/g, ' ')

  let status = 'ok', pct = 0
  if (tMax != null && last != null) {
    pct = Math.min(100, (last / tMax) * 100)
    if (last >= tMax) status = 'danger'
    else if (last >= tMax * 0.9) status = 'warn'
  } else if (tMin != null && last != null) {
    pct = Math.min(100, ((tMin > 0 ? last/tMin : 1)) * 100)
    if (last <= tMin) status = 'danger'
    else if (last <= tMin * 1.1) status = 'warn'
  }
  const statusColor = status === 'danger' ? '#C0392B' : status === 'warn' ? '#C4760A' : '#00843D'

  const sparkVals = useMemo(() => {
    const hist = (Array.isArray(points) ? points : []).slice(-60).map(p => p[col]).filter(v => v != null)
    const fcArr = Array.isArray(forecast) ? forecast : []
    const fc = fcArr.slice(0, 30).map(p => p[col]).filter(v => v != null)
    return [...hist, ...fc]
  }, [points, forecast, col])

  return (
    <tr onClick={() => onSelect(col)} style={{
      background: selected ? '#E8F5EE' : '#FFFFFF',
      borderTop: '1px solid #D4C9B0',
      cursor: 'pointer',
      transition: 'background 0.15s',
    }}
    onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#FAF6EC' }}
    onMouseLeave={e => { if (!selected) e.currentTarget.style.background = '#FFFFFF' }}>
      {/* Status bar */}
      <td style={{ padding: 0, width: 8 }}>
        <div style={{ width: 4, height: 28, borderRadius: 2, background: statusColor, marginLeft: 4 }} />
      </td>
      {/* Label */}
      <td style={{ padding: '10px 14px' }}>
        <div style={{
          fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 14,
          fontWeight: 700, color: '#2A2A1E',
        }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: '#B0A080', fontWeight: 400, marginTop: 1 }}>
          {col}
        </div>
      </td>
      {/* Valeur */}
      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
        <div style={{
          fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 18,
          fontWeight: 800, color: statusColor, lineHeight: 1,
        }}>
          {fmtNum(last)}
        </div>
        <div style={{ fontSize: 9, color: '#B0A080', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {unit || '—'}
        </div>
      </td>
      {/* Seuil */}
      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, color: '#8A7D60' }}>
        {tMax != null ? (
          <span style={{ color: '#C0392B', fontWeight: 700 }}>≤ {tMax}</span>
        ) : tMin != null ? (
          <span style={{ color: '#00843D', fontWeight: 700 }}>≥ {tMin}</span>
        ) : (
          <span style={{ color: '#B0A080' }}>—</span>
        )}
      </td>
      {/* Sparkline */}
      <td style={{ padding: '10px 14px' }}>
        <Sparkline values={sparkVals} color={statusColor} />
      </td>
      {/* Barre progression */}
      <td style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            flex: 1, height: 6, background: '#D4C9B088', borderRadius: 99, overflow: 'hidden',
            minWidth: 60,
          }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: statusColor,
              borderRadius: 99, transition: 'width 0.5s',
            }}/>
          </div>
          <span style={{ fontSize: 10, color: '#8A7D60', minWidth: 32, textAlign: 'right' }}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </td>
    </tr>
  )
}

// ── SidePanel reusable ──────────────────────────────────────────────────────
function SidePanel({ title, children, style }) {
  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid #D4C9B0',
      borderRadius: 10,
      padding: '12px 14px',
      boxSizing: 'border-box',
      ...style,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
        color: '#005C2B', textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// ── Metric (KPI cell) ───────────────────────────────────────────────────────
function Metric({ label, value, highlight }) {
  return (
    <div style={{
      background: highlight ? '#FBEFEC' : '#F7F0DC',
      borderRadius: 6,
      padding: '8px 10px',
      boxSizing: 'border-box',
    }}>
      <div style={{
        fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 18,
        fontWeight: 800, color: highlight ? '#C0392B' : '#5A5240', lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 9, color: '#8A7D60', marginTop: 4,
        textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
      }}>
        {label}
      </div>
    </div>
  )
}

// ── ModelRow ─────────────────────────────────────────────────────────────────
function ModelRow({ label, value }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '6px 0',
      borderBottom: '1px dashed #D4C9B0',
      fontSize: 11,
    }}>
      <span style={{ color: '#5A5240' }}>{label}</span>
      <span style={{ fontWeight: 700, color: '#2A2A1E' }}>{value}</span>
    </div>
  )
}
