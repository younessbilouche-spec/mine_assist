/**
 * RulPredictionWidget.jsx
 * Widget de prédiction RUL via XGBoost + RandomForest
 * S'intègre dans PredictionPage.jsx ou n'importe quelle page existante.
 *
 * Usage :
 *   import RulPredictionWidget from '../components/RulPredictionWidget'
 *   <RulPredictionWidget apiBase="http://localhost:8000/pred/rul" />
 */

import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

// ── Couleurs OCP ─────────────────────────────────────────────────────────────
const C = {
  green:     '#00843D',
  greenPale: '#EAF6EE',
  orange:    '#F59E0B',
  orangePale:'#FEF3C7',
  red:       '#DC2626',
  redPale:   '#FEE2E2',
  gray:      '#6B7280',
  border:    '#D4C9B0',
  text:      '#1F2937',
  bg:        '#FAFAF8',
}

const ALERT_CONFIG = {
  RED:     { color: C.red,    bg: C.redPale,    label: 'ALERTE CRITIQUE',   icon: '🔴', desc: 'Panne probable dans < 24h — intervention immédiate' },
  ORANGE:  { color: C.orange, bg: C.orangePale, label: 'SURVEILLANCE',      icon: '🟠', desc: 'Panne probable dans 24-72h — planifier maintenance' },
  GREEN:   { color: C.green,  bg: C.greenPale,  label: 'NORMAL',            icon: '🟢', desc: 'Aucune panne prévue dans les 72 prochaines heures' },
  UNKNOWN: { color: C.gray,   bg: '#F3F4F6',    label: 'NON DISPONIBLE',    icon: '⚪', desc: 'Données insuffisantes' },
}

const SUBSYSTEMS = [
  { key: 'global_grav2',  label: 'Global (grav. ≥ 2)', icon: '⚙️' },
  { key: 'moteur',        label: 'Moteur',             icon: '🔧' },
  { key: 'transmission',  label: 'Transmission',       icon: '⚡' },
  { key: 'hydraulique',   label: 'Hydraulique',        icon: '💧' },
]

const fmtH = h => h == null ? '—' : h < 48 ? `${h.toFixed(0)}h` : `${(h / 24).toFixed(1)}j`
const alertFromRul = h => h == null ? 'UNKNOWN' : h < 24 ? 'RED' : h < 72 ? 'ORANGE' : 'GREEN'

// ── Gauge circulaire SVG ─────────────────────────────────────────────────────
function RulGauge({ rul, maxRul = 168 }) {
  const pct = rul == null ? 0 : Math.min(1, rul / maxRul)
  const alert = alertFromRul(rul)
  const color = ALERT_CONFIG[alert].color
  const r = 52
  const circ = 2 * Math.PI * r
  const strokeDash = `${(pct * circ).toFixed(1)} ${circ.toFixed(1)}`

  return (
    <svg width={130} height={130} viewBox="0 0 130 130">
      <circle cx={65} cy={65} r={r} fill="none" stroke="#E5E7EB" strokeWidth={12} />
      <circle
        cx={65} cy={65} r={r}
        fill="none"
        stroke={color}
        strokeWidth={12}
        strokeDasharray={strokeDash}
        strokeLinecap="round"
        transform="rotate(-90 65 65)"
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x={65} y={58} textAnchor="middle" fontSize={20} fontWeight={800} fill={color}>
        {rul == null ? '—' : rul < 48 ? `${Math.round(rul)}h` : `${(rul / 24).toFixed(1)}j`}
      </text>
      <text x={65} y={76} textAnchor="middle" fontSize={10} fill={C.gray}>
        avant panne
      </text>
    </svg>
  )
}

// ── Barre de RUL par sous-système ────────────────────────────────────────────
function SubsystemBar({ label, icon, rul, maxRul = 168 }) {
  const pct = rul == null ? 0 : Math.min(100, (rul / maxRul) * 100)
  const alert = alertFromRul(rul)
  const color = ALERT_CONFIG[alert].color

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
          {icon} {label}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>
          {fmtH(rul)}
        </span>
      </div>
      <div style={{ height: 8, background: '#E5E7EB', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color,
          borderRadius: 4, transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  )
}

// ── Graphique historique RUL ─────────────────────────────────────────────────
function HistoryChart({ data }) {
  if (!data || data.length === 0) return null

  const chartData = data.map(p => ({
    ...p,
    rul_h: parseFloat(p.rul_h) || 0,
  }))

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: C.gray, marginBottom: 12, textTransform: 'uppercase' }}>
        Évolution du RUL
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="rulGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={C.green} stopOpacity={0.3} />
              <stop offset="95%" stopColor={C.green} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: C.gray }}
            tickFormatter={d => d ? d.slice(5, 10) : ''}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 9, fill: C.gray }} unit="h" width={36} />
          <Tooltip
            formatter={v => [`${v.toFixed(0)}h`, 'RUL']}
            labelFormatter={l => l}
            contentStyle={{ fontSize: 11, borderRadius: 6 }}
          />
          <ReferenceLine y={24}  stroke={C.red}    strokeDasharray="4 2" label={{ value: 'RED',    position: 'right', fontSize: 9, fill: C.red }} />
          <ReferenceLine y={72}  stroke={C.orange}  strokeDasharray="4 2" label={{ value: 'ORANGE', position: 'right', fontSize: 9, fill: C.orange }} />
          <Area
            type="monotone" dataKey="rul_h" name="RUL"
            stroke={C.green} strokeWidth={2}
            fill="url(#rulGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Composant principal ──────────────────────────────────────────────────────
export default function RulPredictionWidget({ apiBase = '/pred/rul' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [file, setFile] = useState(null)
  const [modelStatus, setModelStatus] = useState(null)

  // Charger le statut des modèles au démarrage
  useEffect(() => {
    fetch(`${apiBase}/status`)
      .then(r => r.json())
      .then(setModelStatus)
      .catch(() => {})

    // Charger la démo au démarrage
    fetch(`${apiBase}/predict/demo`)
      .then(r => r.json())
      .then(d => setData({ ...d, _demo: true }))
      .catch(() => {})
  }, [apiBase])

  const handleUpload = useCallback(async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch(`${apiBase}/predict`, { method: 'POST', body: form })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.detail || 'Erreur serveur')
      }
      const result = await r.json()
      setData(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [file, apiBase])

  const alert = data?.alerte_globale || 'UNKNOWN'
  const alertCfg = ALERT_CONFIG[alert] || ALERT_CONFIG.UNKNOWN
  const rulGlobal = data?.rul_heures?.global_grav2

  return (
    <div style={{ fontFamily: "'Rajdhani', system-ui, sans-serif", maxWidth: 900, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{
          background: C.green, color: '#fff', padding: '4px 14px',
          fontWeight: 800, fontSize: 14, letterSpacing: 3,
          clipPath: 'polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)',
        }}>
          RUL PREDICTION
        </div>
        <span style={{ fontSize: 13, color: C.gray }}>
          XGBoost + RandomForest — CAT 994F1 OCP Benguerir
        </span>
        {data?._demo && (
          <span style={{ fontSize: 11, color: C.orange, fontWeight: 700, background: C.orangePale, padding: '2px 8px', borderRadius: 4 }}>
            MODE DÉMO
          </span>
        )}
      </div>

      {/* ── Upload ── */}
      <div style={{
        background: '#fff', border: `1px solid ${C.border}`,
        borderRadius: 10, padding: 16, marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={e => setFile(e.target.files[0])}
          style={{ fontSize: 13, flex: 1, minWidth: 200 }}
        />
        <button
          onClick={handleUpload}
          disabled={!file || loading}
          style={{
            background: file && !loading ? C.green : C.border,
            color: '#fff', border: 'none', padding: '10px 24px',
            fontWeight: 700, fontSize: 13, letterSpacing: 2,
            cursor: file && !loading ? 'pointer' : 'not-allowed',
            clipPath: 'polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)',
          }}
        >
          {loading ? '⏳ Calcul...' : '▶ ANALYSER'}
        </button>
        {error && <span style={{ color: C.red, fontSize: 12 }}>⚠ {error}</span>}
      </div>

      {data && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>

          {/* ── Colonne gauche : alerte + gauge ── */}
          <div style={{ flex: '0 0 280px', minWidth: 260 }}>
            {/* Bandeau d'alerte */}
            <div style={{
              background: alertCfg.bg, border: `2px solid ${alertCfg.color}`,
              borderRadius: 12, padding: '20px 24px', textAlign: 'center', marginBottom: 16,
            }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{alertCfg.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: alertCfg.color, letterSpacing: 2 }}>
                {alertCfg.label}
              </div>
              <div style={{ fontSize: 11, color: C.gray, marginTop: 6 }}>
                {alertCfg.desc}
              </div>
            </div>

            {/* Gauge RUL global */}
            <div style={{
              background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
              padding: 16, textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: C.gray, marginBottom: 8, textTransform: 'uppercase' }}>
                RUL Global
              </div>
              <RulGauge rul={rulGlobal} />
            </div>

            {/* Isolation Forest */}
            {data.isolation_forest && (
              <div style={{
                background: '#fff', border: `1px solid ${C.border}`,
                borderRadius: 10, padding: 12, marginTop: 12,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gray, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
                  Détection non supervisée
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12 }}>Isolation Forest</span>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: data.isolation_forest.is_anomaly ? C.red : C.green,
                    background: data.isolation_forest.is_anomaly ? C.redPale : C.greenPale,
                    padding: '2px 8px', borderRadius: 4,
                  }}>
                    {data.isolation_forest.is_anomaly ? '⚠ Anomalie' : '✓ Normal'}
                  </span>
                </div>
                {data.isolation_forest.score != null && (
                  <div style={{ fontSize: 10, color: C.gray, marginTop: 4 }}>
                    Score: {data.isolation_forest.score.toFixed(3)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Colonne droite : sous-systèmes + classification ── */}
          <div style={{ flex: 1, minWidth: 280 }}>
            {/* RUL par sous-système */}
            <div style={{
              background: '#fff', border: `1px solid ${C.border}`,
              borderRadius: 10, padding: 20, marginBottom: 16,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: C.gray, marginBottom: 16, textTransform: 'uppercase' }}>
                RUL par sous-système
              </div>
              {SUBSYSTEMS.map(sub => (
                <SubsystemBar
                  key={sub.key}
                  label={sub.label}
                  icon={sub.icon}
                  rul={data.rul_heures?.[sub.key]}
                />
              ))}
            </div>

            {/* Probabilité d'alerte */}
            {data.alert_proba && Object.keys(data.alert_proba).length > 0 && (
              <div style={{
                background: '#fff', border: `1px solid ${C.border}`,
                borderRadius: 10, padding: 20,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: C.gray, marginBottom: 12, textTransform: 'uppercase' }}>
                  Probabilité par classe (RF)
                </div>
                {['RED', 'ORANGE', 'GREEN'].map(cls => {
                  const p = data.alert_proba[cls] || 0
                  const cfg = ALERT_CONFIG[cls]
                  return (
                    <div key={cls} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>
                          {cfg.icon} {cls}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>
                          {(p * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ height: 6, background: '#E5E7EB', borderRadius: 3 }}>
                        <div style={{ width: `${p * 100}%`, height: '100%', background: cfg.color, borderRadius: 3, transition: 'width 0.8s' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Graphique historique ── */}
      {data?.historique?.length > 0 && (
        <div style={{
          background: '#fff', border: `1px solid ${C.border}`,
          borderRadius: 10, padding: 20, marginTop: 20,
        }}>
          <HistoryChart data={data.historique} />
        </div>
      )}

      {/* ── Infos modèle ── */}
      {modelStatus && (
        <div style={{ fontSize: 10, color: C.gray, marginTop: 16, textAlign: 'center' }}>
          {modelStatus.nb_modeles} modèles chargés · Capteurs clés : {modelStatus.capteurs_cles?.join(', ')}
        </div>
      )}
    </div>
  )
}
