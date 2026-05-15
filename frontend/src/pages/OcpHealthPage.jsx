import { useState, useEffect } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { API } from '../config'

// ─── Helpers couleur ─────────────────────────────────────────────────────────
function scoreToColor(score) {
  if (score >= 90) return '#22c55e'
  if (score >= 75) return '#84cc16'
  if (score >= 55) return '#f59e0b'
  if (score >= 30) return '#ef4444'
  return '#7c3aed'
}
function scoreToTruckColor(score) {
  if (score >= 75) return 'green'
  if (score >= 55) return 'orange'
  return 'red'
}
const GLOW_MAP = {
  green:  'rgba(34,197,94,0.25)',
  orange: 'rgba(249,115,22,0.25)',
  red:    'rgba(239,68,68,0.25)',
}
const STATUS_LABEL = score =>
  score >= 90 ? 'EXCELLENT' :
  score >= 70 ? 'BON' :
  score >= 30 ? 'SURVEILLANCE' : 'CRITIQUE'

// ─── Tooltip personnalisé pour le graphique ──────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const score = payload[0]?.value
  return (
    <div style={{
      background: '#FFFDF8', border: '1px solid #D4C9B0',
      borderRadius: 8, padding: '8px 12px', fontSize: 12
    }}>
      <div style={{ fontWeight: 700, color: '#2A2A1E', marginBottom: 4 }}>{label}</div>
      <div style={{ color: scoreToColor(score), fontWeight: 800, fontSize: 15 }}>
        {score?.toFixed(1)} / 100
      </div>
      <div style={{ color: '#8A7D60', fontSize: 11, marginTop: 2 }}>
        {STATUS_LABEL(score)}
      </div>
    </div>
  )
}

export default function OcpHealthPage({ apiFetch, onNavigate }) {
  // ─── État ─────────────────────────────────────────────────────────────────
  const [health,   setHealth]   = useState(null)
  const [capteurs, setCapteurs] = useState([])
  const [history,  setHistory]  = useState([])
  const [histStats, setHistStats] = useState(null)
  const [loadLive, setLoadLive] = useState(true)
  const [loadHist, setLoadHist] = useState(true)
  const [days,     setDays]     = useState(30)

  // ─── Fetch score temps réel ───────────────────────────────────────────────
  useEffect(() => {
    const fetcher = apiFetch || fetch
    setLoadLive(true)
    fetcher(`${API}/pred/health?include_capteurs=true`)
      .then(r => r.ok ? r.json() : null)
      .then(h => { setHealth(h); setCapteurs(h?.capteurs || []) })
      .catch(() => setHealth(null))
      .finally(() => setLoadLive(false))
  }, [apiFetch])

  // ─── Fetch historique R ───────────────────────────────────────────────────
  useEffect(() => {
    setLoadHist(true)
    fetch(`${API}/ml/health-history?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.data?.length) {
          setHistory(d.data.map(p => ({
            ...p,
            date: p.timestamp?.slice(0, 10),
            score: +p.health_score?.toFixed(1),
          })))
          setHistStats(d.stats)
        }
      })
      .catch(() => {})
      .finally(() => setLoadHist(false))
  }, [days])

  // ─── Score temps réel ─────────────────────────────────────────────────────
  const score     = health?.score ?? 0
  const tColor    = scoreToTruckColor(score)
  const mainColor = scoreToColor(score)
  const tGlow     = GLOW_MAP[tColor] || GLOW_MAP.green

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '34px 28px', color: '#2A2A1E' }}>

      <h1 className="page-title">Indicateur Santé de l'Engin — CAT 994F1</h1>
      <p className="page-subtitle">OCP Benguerir · Score temps réel + Historique 11 mois (Pipeline ML — IsolationForest + AMDEC)</p>

      {/* ── SCORE TEMPS RÉEL ─────────────────────────────────────────────── */}
      {loadLive ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
          <div className="spinner" />
        </div>
      ) : !health ? (
        <div style={{ textAlign: 'center', padding: '40px 28px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠</div>
          <div style={{ color: '#8A7D60', marginBottom: 16 }}>
            Aucun fichier chargé — uploadez d'abord vos données.
          </div>
          <button onClick={() => onNavigate?.('ocp_upload')} className="btn btn-primary">
            Uploader un fichier
          </button>
        </div>
      ) : (
        <div className="card" style={{
          padding: '40px 32px', marginBottom: 28, textAlign: 'center',
          border: `1px solid ${mainColor}28`,
          boxShadow: `0 0 50px ${tGlow}`
        }}>
          {/* Score circulaire */}
          <div style={{
            fontFamily: 'Rajdhani, sans-serif', fontSize: 80, fontWeight: 900,
            color: mainColor, lineHeight: 1, marginBottom: 4,
            textShadow: `0 0 32px ${mainColor}60`
          }}>
            {score.toFixed(0)}
          </div>
          <div style={{
            fontSize: 13, color: '#8A7D60', marginBottom: 20,
            letterSpacing: '2px', textTransform: 'uppercase'
          }}>
            / 100 — {health.label}
          </div>

          {/* Image machine */}
          <div style={{ position: 'relative', width: '100%', maxWidth: 400, margin: '0 auto 28px' }}>
            <img src="/chargeuse994F.png" alt="CAT 994F" style={{
              width: '100%',
              filter: `drop-shadow(0 0 28px ${tGlow}) drop-shadow(0 4px 14px rgba(0,0,0,0.8))`
            }} />
            <div style={{
              position: 'absolute', inset: 0,
              background: `radial-gradient(ellipse at 60% 40%, ${mainColor}14 0%, transparent 65%)`,
              pointerEvents: 'none', borderRadius: 12
            }} />
            <div style={{
              position: 'absolute', bottom: 8, right: 12,
              background: `${mainColor}22`, border: `1px solid ${mainColor}55`,
              borderRadius: 99, padding: '4px 12px', fontSize: 12,
              fontWeight: 700, color: mainColor
            }}>
              {health.label}
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 40 }}>
            {[
              { label: 'Points critiques', val: health.points_critiques, color: '#7c3aed' },
              { label: 'Points anomalie',  val: health.points_anomalie,  color: '#ef4444' },
              { label: 'Points analysés',  val: health.nb_points?.toLocaleString(), color: '#8A7D60' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{
                  fontFamily: 'Rajdhani, sans-serif', fontSize: 36,
                  fontWeight: 900, color, lineHeight: 1
                }}>{val}</div>
                <div style={{ fontSize: 11, color: '#8A7D60', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>

          {score >= 90 && (
            <div style={{
              marginTop: 20, background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10,
              padding: '10px 20px', display: 'inline-block',
              fontSize: 13, color: '#22c55e', fontWeight: 600
            }}>
              ✓ Tous les paramètres sont dans les limites normales
            </div>
          )}
        </div>
      )}

      {/* ── HISTORIQUE 11 MOIS (Pipeline R) ──────────────────────────────── */}
      <div className="card" style={{ marginBottom: 28, padding: '22px 24px' }}>
        {/* En-tête */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '2px',
              textTransform: 'uppercase', color: '#B0A080', marginBottom: 4
            }}>
              Tendance historique — Pipeline ML
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#2A2A1E' }}>
              Health Score sur {days} derniers jours
            </div>
          </div>
          {/* Sélecteur période */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 30, 90, 180].map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 700,
                borderRadius: 6, cursor: 'pointer',
                background: days === d ? '#00843D' : 'transparent',
                color: days === d ? '#fff' : '#8A7D60',
                border: `1px solid ${days === d ? '#00843D' : '#D4C9B0'}`,
                transition: 'all 0.15s'
              }}>
                {d}j
              </button>
            ))}
          </div>
        </div>

        {/* KPIs R */}
        {histStats && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            {[
              { label: 'Score moyen', val: `${histStats.health_mean}/100`, color: scoreToColor(histStats.health_mean) },
              { label: 'Temps en alerte (<70)', val: `${histStats.pct_below_70}%`, color: '#f59e0b' },
              { label: 'Temps critique (<30)', val: `${histStats.pct_below_30}%`, color: '#ef4444' },
              { label: 'Anomalies IF', val: histStats.n_anomalies_if?.toLocaleString(), color: '#8A7D60' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{
                flex: 1, minWidth: 120, background: '#FAFAF8',
                border: '1px solid #E8E2D4', borderRadius: 10,
                padding: '12px 16px', textAlign: 'center'
              }}>
                <div style={{
                  fontFamily: 'Rajdhani, sans-serif', fontSize: 24,
                  fontWeight: 900, color, lineHeight: 1
                }}>{val ?? '—'}</div>
                <div style={{ fontSize: 10, color: '#B0A080', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Graphique */}
        {loadHist ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="spinner" />
          </div>
        ) : history.length === 0 ? (
          <div style={{
            height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8, color: '#8A7D60'
          }}>
            <span style={{ fontSize: 28 }}>📊</span>
            <span style={{ fontSize: 13 }}>
              Lancez <strong>mineassist_ML_SIMPLE.R</strong> puis copiez
              <code style={{ background: '#F3F0E8', padding: '1px 6px', borderRadius: 4, marginLeft: 4 }}>
                health_history.csv
              </code> dans <code>backend/models/</code>
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={history} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="hsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00843D" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#00843D" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,201,176,0.4)" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#B0A080', fontSize: 10 }}
                tickFormatter={d => d?.slice(5)}
                interval="preserveStartEnd"
                axisLine={false} tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 30, 70, 100]}
                tick={{ fill: '#B0A080', fontSize: 10 }}
                axisLine={false} tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              {/* Zones colorées de fond */}
              <ReferenceLine y={70} stroke="#f59e0b" strokeDasharray="4 3" strokeOpacity={0.6} />
              <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.6} />
              <Area
                type="monotone" dataKey="score"
                stroke="#00843D" strokeWidth={1.8}
                fill="url(#hsGrad)" dot={false}
                activeDot={{ r: 4, fill: '#00843D' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {history.length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: '#B0A080' }}>
            <span>━ <span style={{ color: '#f59e0b' }}>Seuil surveillance (70)</span></span>
            <span>━ <span style={{ color: '#ef4444' }}>Seuil critique (30)</span></span>
            <span style={{ marginLeft: 'auto' }}>{history.length} points horaires</span>
          </div>
        )}
      </div>

      {/* ── SCORES PAR CAPTEUR ────────────────────────────────────────────── */}
      {capteurs.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{
            padding: '14px 24px', borderBottom: '1px solid #D4C9B0',
            background: 'rgba(34,197,94,0.03)'
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '1.5px',
              textTransform: 'uppercase', color: '#B0A080'
            }}>
              Score par capteur (dernières 24h)
            </span>
          </div>
          {capteurs.map((c, i) => {
            const col = scoreToColor(c.score)
            return (
              <div key={c.col} style={{
                padding: '16px 24px',
                borderBottom: i < capteurs.length - 1 ? '1px solid #D4C9B0' : 'none',
                display: 'flex', alignItems: 'center', gap: 16
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: col, boxShadow: `0 0 6px ${col}`, flexShrink: 0
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#2A2A1E' }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: '#B0A080' }}>
                    {c.unit} — dernière valeur : {c.derniere_valeur?.toFixed(1)}
                  </div>
                </div>
                <div style={{ width: 200, height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ width: `${c.score}%`, height: '100%', background: col, borderRadius: 99, transition: 'width 0.6s' }} />
                </div>
                <div style={{
                  fontFamily: 'Rajdhani, sans-serif', fontSize: 20,
                  fontWeight: 900, color: col, minWidth: 48, textAlign: 'right'
                }}>
                  {c.score.toFixed(0)}
                </div>
                <div style={{ fontSize: 11, color: '#B0A080', minWidth: 60 }}>{c.etat}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
