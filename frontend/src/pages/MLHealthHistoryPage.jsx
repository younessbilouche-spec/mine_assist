/**
 * MLHealthHistoryPage.jsx
 * Affiche les résultats complets du pipeline R :
 *   - Health Score historique (courbe)
 *   - Anomalies Isolation Forest (barres)
 *   - Distribution des modes K-Means
 *   - KPIs globaux sur 11 mois
 *
 * Endpoint : GET /ml/health-history?days=N
 *            GET /ml/dashboard-summary
 */
import { useState, useEffect } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell
} from 'recharts'
import { API } from '../config'

const C = {
  green: '#00843D', greenPale: '#E8F5EE',
  orange: '#f59e0b', orangePale: '#FEF3C7',
  red: '#ef4444', redPale: '#FEE2E2',
  text: '#2A2A1E', muted: '#8A7D60', light: '#B0A080',
  border: '#D4C9B0', card: '#FFFDF8', bg: '#F5F0E8',
}

function scoreColor(s) {
  if (s >= 70) return C.green
  if (s >= 30) return C.orange
  return C.red
}

function KpiCard({ label, value, color, sub }) {
  return (
    <div style={{
      flex: 1, minWidth: 130, background: C.card,
      border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '16px 18px', textAlign: 'center'
    }}>
      <div style={{
        fontFamily: 'Rajdhani, sans-serif', fontSize: 32,
        fontWeight: 900, color: color || C.text, lineHeight: 1
      }}>{value}</div>
      <div style={{ fontSize: 11, color: C.light, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function MLHealthHistoryPage() {
  const [days,    setDays]    = useState(90)
  const [data,    setData]    = useState([])
  const [stats,   setStats]   = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API}/ml/health-history?days=${days}`).then(r => r.ok ? r.json() : null),
      fetch(`${API}/ml/dashboard-summary`).then(r => r.ok ? r.json() : null),
    ]).then(([hist, summ]) => {
      if (hist?.data) {
        setData(hist.data.map(p => ({
          ...p,
          date: p.timestamp?.slice(0, 10),
          score: +p.health_score?.toFixed(1),
          anom_pct: p.n_anomalies > 0 ? +(p.n_anomalies / 12 * 100).toFixed(1) : 0,
        })))
        setStats(hist.stats)
      }
      if (summ) setSummary(summ)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [days])

  const modeColors = ['#00843D', '#f59e0b', '#3b82f6', '#8b5cf6']

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div className="spinner" />
    </div>
  )

  const noData = data.length === 0

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '34px 28px', color: C.text }}>

      {/* En-tête */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">ML Historique — Pipeline R</h1>
        <p className="page-subtitle">
          Health Score · Isolation Forest · K-Means · 11 mois de données CAT 994F
        </p>
      </div>

      {/* Bandeau statut modèle */}
      {summary && (
        <div style={{
          background: summary.model_ready ? C.greenPale : C.orangePale,
          border: `1px solid ${summary.model_ready ? '#86efac' : '#fde68a'}`,
          borderRadius: 10, padding: '10px 18px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 13
        }}>
          <span style={{ fontSize: 18 }}>{summary.model_ready ? '✅' : '⚠️'}</span>
          <span style={{ fontWeight: 600 }}>
            {summary.model_ready
              ? `Modèles R chargés · Entraîné le ${summary.trained_at?.slice(0, 10)}`
              : 'Modèles non trouvés — Lance mineassist_ML_SIMPLE.R puis copie health_history.csv dans backend/models/'}
          </span>
          {summary.last_24h && (
            <span style={{ marginLeft: 'auto', color: C.muted, fontSize: 12 }}>
              Dernières 24h : score moy. {summary.last_24h.health_avg}/100
            </span>
          )}
        </div>
      )}

      {/* KPIs globaux */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <KpiCard label="Health Score moyen"    value={`${stats.health_mean}/100`}  color={scoreColor(stats.health_mean)} />
          <KpiCard label="Score minimum observé"  value={`${stats.health_min}/100`}   color={scoreColor(stats.health_min)} />
          <KpiCard label="Temps surveillance <70" value={`${stats.pct_below_70}%`}    color={C.orange} sub="du temps total" />
          <KpiCard label="Temps critique <30"     value={`${stats.pct_below_30}%`}    color={C.red}    sub="du temps total" />
          <KpiCard label="Anomalies IF détectées" value={stats.n_anomalies_if?.toLocaleString() ?? '—'} color={C.muted} />
        </div>
      )}

      {/* ── HEALTH SCORE HISTORIQUE ───────────────────────────────────────── */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '20px 22px', marginBottom: 20
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.light }}>
              Évolution du Health Score
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
              Zones : vert = bon · orange = surveillance · rouge = critique
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[7, 30, 90, 180].map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                padding: '5px 12px', fontSize: 11, fontWeight: 700,
                borderRadius: 6, cursor: 'pointer',
                background: days === d ? C.green : 'transparent',
                color: days === d ? '#fff' : C.muted,
                border: `1px solid ${days === d ? C.green : C.border}`,
                transition: 'all .15s'
              }}>{d}j</button>
            ))}
          </div>
        </div>

        {noData ? (
          <div style={{
            height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 10, color: C.muted
          }}>
            <span style={{ fontSize: 32 }}>📊</span>
            <span style={{ fontSize: 13, textAlign: 'center', maxWidth: 420 }}>
              Données non disponibles. Lance <strong>mineassist_ML_SIMPLE.R</strong> puis
              copie <code>health_history.csv</code> dans <code>backend/models/</code>
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.green} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={C.green} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,201,176,0.4)" />
              <XAxis dataKey="date" tick={{ fill: C.light, fontSize: 10 }}
                tickFormatter={d => d?.slice(5)} interval="preserveStartEnd"
                axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} ticks={[0, 30, 70, 100]}
                tick={{ fill: C.light, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v) => [`${v}/100`, 'Health Score']}
                contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
              />
              <ReferenceLine y={70} stroke={C.orange} strokeDasharray="4 3" strokeOpacity={0.7} />
              <ReferenceLine y={30} stroke={C.red}    strokeDasharray="4 3" strokeOpacity={0.7} />
              <Area type="monotone" dataKey="score" stroke={C.green} strokeWidth={1.8}
                fill="url(#grad)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── ANOMALIES + INFO ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Barres anomalies */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '20px 22px'
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.light, marginBottom: 4 }}>
            Densité d'anomalies (Isolation Forest)
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
            % de mesures anormales par jour — seuil : 5%
          </div>
          {noData ? (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
              Pas de données
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,201,176,0.4)" />
                <XAxis dataKey="date" tick={{ fill: C.light, fontSize: 9 }}
                  tickFormatter={d => d?.slice(5)} interval="preserveStartEnd"
                  axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.light, fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v) => [`${v}%`, 'Anomalies']}
                  contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
                />
                <ReferenceLine y={10} stroke={C.red} strokeDasharray="3 3" strokeOpacity={0.5} />
                <Bar dataKey="anom_pct" radius={[2, 2, 0, 0]}>
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.anom_pct > 10 ? C.red : '#3b82f6'} fillOpacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Info modèle */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '20px 22px'
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.light, marginBottom: 16 }}>
            À propos du pipeline
          </div>
          {[
            { icon: '💚', label: 'Health Score', desc: '11 seuils CAT · 0-100' },
            { icon: '🌲', label: 'Isolation Forest', desc: '200 arbres · contam. 10.2%' },
            { icon: '📊', label: 'K-Means', desc: '4 modes opérationnels' },
            { icon: '🔬', label: 'Langage', desc: 'R + isotree + tidyverse' },
            { icon: '📁', label: 'Données', desc: '43 929 timestamps · 11 mois' },
            { icon: '⚡', label: 'Inférence', desc: '< 5 ms par prédiction' },
          ].map(({ icon, label, desc }) => (
            <div key={label} style={{
              display: 'flex', gap: 10, alignItems: 'center',
              padding: '7px 0', borderBottom: `1px solid ${C.border}`
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{label}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Note de bas de page */}
      <div style={{
        background: C.orangePale, border: `1px solid #fde68a`,
        borderRadius: 10, padding: '12px 18px', fontSize: 12, color: '#92400e'
      }}>
        <strong>Note PFE :</strong> La prédiction supervisée du RUL (XGBoost) a été étudiée
        sur 4 configurations (AUC ≈ 0.51). Elle est reportée en v2.0 — conditions :
        ≥ 24 mois de données, annotation GMAO enrichie, capteurs vibratoires.
        Cette démarche honnête constitue un apport méthodologique du projet.
      </div>

    </div>
  )
}
