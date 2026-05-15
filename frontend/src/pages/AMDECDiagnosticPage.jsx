import { useState, useEffect, useCallback } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import { API, C } from '../config'

// ─── Helpers ────────────────────────────────────────────────────────────────
const scoreColor = s => s >= 80 ? C.green : s >= 60 ? C.amber : s >= 30 ? C.orange : C.danger
const scoreLabel = s => s >= 80 ? 'BON' : s >= 60 ? 'ATTENTION' : s >= 30 ? 'ALERTE' : 'CRITIQUE'

const CAPTEURS = ['T_Echap_D', 'T_Echap_G', 'P_Huile', 'Regime', 'T_Refroid', 'T_Convert']
const CAPTEUR_LABELS = {
  T_Echap_D: 'Temp. Échap. Droit',
  T_Echap_G: 'Temp. Échap. Gauche',
  P_Huile:   'Pression Huile',
  Regime:    'Régime Moteur',
  T_Refroid: 'Temp. Refroidissement',
  T_Convert: 'Temp. Convertisseur',
}
const CAPTEUR_UNIT = {
  T_Echap_D: '°C', T_Echap_G: '°C', P_Huile: 'kPa',
  Regime: 'tr/min', T_Refroid: '°C', T_Convert: '°C',
}
const CAPTEUR_ICON = {
  T_Echap_D: '🌡️', T_Echap_G: '🌡️', P_Huile: '💧',
  Regime: '⚙️', T_Refroid: '❄️', T_Convert: '🔄',
}

// ─── Base components ─────────────────────────────────────────────────────────
function PageTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 4,
      textTransform: 'uppercase', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 4, height: 16, background: C.green, borderRadius: 2 }} />
      {children}
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg,${C.border},transparent)` }} />
    </div>
  )
}

function Card({ children, style }) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`,
      borderTop: `2px solid ${C.sand}`, padding: '22px 26px', marginBottom: 18,
      backdropFilter: 'blur(8px)', boxShadow: '0 2px 10px rgba(139,105,20,0.07)', ...style }}>
      {children}
    </div>
  )
}

function CardTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 3,
      textTransform: 'uppercase', marginBottom: 14, paddingBottom: 10,
      borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ width: 3, height: 11, background: C.sand }} />
      {children}
    </div>
  )
}

function Badge({ color, children }) {
  return (
    <span style={{ background: color + '22', color, border: `1px solid ${color}44`,
      padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: 1, borderRadius: 2 }}>
      {children}
    </span>
  )
}

// ─── Health Gauge ────────────────────────────────────────────────────────────
function HealthGauge({ score }) {
  const col = scoreColor(score ?? 0)
  const angle = -135 + ((score ?? 0) / 100) * 270
  const cx = 100, cy = 90, r = 70
  const toXY = (deg, rad) => ({
    x: cx + rad * Math.cos((deg * Math.PI) / 180),
    y: cy + rad * Math.sin((deg * Math.PI) / 180),
  })
  const arc = (a, b, rad) => {
    const s = toXY(a, rad), e = toXY(b, rad)
    return `M ${s.x} ${s.y} A ${rad} ${rad} 0 ${b - a > 180 ? 1 : 0} 1 ${e.x} ${e.y}`
  }
  const needle = toXY(angle, 55)
  return (
    <svg viewBox="0 0 200 130" style={{ width: '100%', maxWidth: 220 }}>
      <path d={arc(-135, 45, r)} fill="none" stroke="#E8E2D4" strokeWidth={14} strokeLinecap="round" />
      <path d={arc(-135, -135 + ((score ?? 0) / 100) * 270, r)} fill="none" stroke={col}
        strokeWidth={14} strokeLinecap="round" />
      {[-135, -90, -45, 0, 45].map((deg, i) => {
        const p = toXY(deg, r + 18)
        return <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
          fontSize={8} fill={C.textMuted} fontWeight={700}>{[0, 25, 50, 75, 100][i]}</text>
      })}
      <line x1={cx} y1={cy} x2={needle.x} y2={needle.y}
        stroke={col} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={6} fill={col} />
      <text x={cx} y={cy + 22} textAnchor="middle" fontSize={22} fontWeight={800} fill={col}>
        {(score ?? 0).toFixed(1)}
      </text>
      <text x={cx} y={cy + 36} textAnchor="middle" fontSize={9} fontWeight={700}
        fill={C.textMuted} letterSpacing={2}>/ 100</text>
    </svg>
  )
}

// ─── Radar Chart ─────────────────────────────────────────────────────────────
function WeightsRadar({ poids }) {
  if (!poids) return null
  const data = Object.entries(poids).map(([k, v]) => ({
    subject: CAPTEUR_LABELS[k] || k,
    poids: parseFloat(v.toFixed(2)),
  }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <RadarChart data={data}>
        <PolarGrid stroke={C.border} />
        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: C.textMuted, fontWeight: 600 }} />
        <PolarRadiusAxis angle={90} domain={[0, 2]} tick={{ fontSize: 9, fill: C.textLight }} />
        <Radar name="Poids AMDEC" dataKey="poids" stroke={C.green}
          fill={C.green} fillOpacity={0.25} strokeWidth={2} />
      </RadarChart>
    </ResponsiveContainer>
  )
}

// ─── History Chart ───────────────────────────────────────────────────────────
function HealthHistoryChart({ history }) {
  if (!history?.length) return (
    <div style={{ color: C.textLight, fontSize: 12, padding: 20, textAlign: 'center' }}>
      Pas de données historiques
    </div>
  )
  // history items: {date, health}
  const data = history.map(h => ({ date: h.date?.slice(0, 10), score: parseFloat((h.health ?? 0).toFixed(1)) }))
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id="hiGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={C.green} stopOpacity={0.3} />
            <stop offset="95%" stopColor={C.green} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
        <XAxis dataKey="date" tick={{ fontSize: 9, fill: C.textMuted }} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: C.textMuted }} tickLine={false} />
        <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, fontSize: 12 }}
          formatter={v => [`${v} / 100`, 'Health Index']} />
        <ReferenceLine y={80} stroke={C.green} strokeDasharray="4 2" strokeOpacity={0.5} />
        <ReferenceLine y={60} stroke={C.amber} strokeDasharray="4 2" strokeOpacity={0.5} />
        <ReferenceLine y={30} stroke={C.danger} strokeDasharray="4 2" strokeOpacity={0.5} />
        <Area type="monotone" dataKey="score" stroke={C.green} strokeWidth={2}
          fill="url(#hiGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── Diagnostic Modal ────────────────────────────────────────────────────────
function DiagnosticModal({ capteur, data, poids, onClose }) {
  if (!data) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }}>
      <div style={{ background: C.bgCard, padding: 40, border: `1px solid ${C.border}`,
        color: C.textMuted, fontFamily: "'Rajdhani', sans-serif", fontSize: 14 }}>
        Chargement...
      </div>
    </div>
  )

  const { top_modes = [], seuil_alarme, rpn_moyen, circuits_amdec = [], nb_modes_total } = data
  const capteurPoids = poids?.[capteur]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 16 }}>
      <div style={{ background: C.bgCard, border: `1px solid ${C.border}`,
        borderTop: `3px solid ${C.orange}`, width: '100%', maxWidth: 720,
        maxHeight: '85vh', overflowY: 'auto', padding: '28px 32px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.22)' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 3, color: C.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>
              Diagnostic AMDEC — Circuit
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>
              {CAPTEUR_ICON[capteur]} {CAPTEUR_LABELS[capteur] || capteur}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Badge color={C.orange}>Seuil: {seuil_alarme} {CAPTEUR_UNIT[capteur]}</Badge>
              <Badge color={C.blue}>Poids AMDEC: {capteurPoids?.toFixed(2) ?? '--'}</Badge>
              <Badge color={C.textMuted}>RPN moy: {rpn_moyen?.toFixed(1)}</Badge>
              <Badge color={C.text}>{nb_modes_total} modes</Badge>
            </div>
            {circuits_amdec.length > 0 && (
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>
                Circuits: {circuits_amdec.join(' / ')}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`,
            color: C.textMuted, cursor: 'pointer', padding: '6px 14px',
            fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>
            FERMER
          </button>
        </div>

        {top_modes.length ? top_modes.map((m, i) => {
          const isCrit = m.rpn >= 4
          return (
            <div key={i} style={{ marginBottom: 12, padding: '14px 18px',
              background: isCrit ? C.dangerPale : C.orangePale,
              borderLeft: `4px solid ${isCrit ? C.danger : C.orange}`, borderRadius: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{m.mode}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {isCrit && <Badge color={C.danger}>CRITIQUE</Badge>}
                  <Badge color={C.textMuted}>RPN {m.rpn}</Badge>
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.textMid, marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>Composant:</span> {m.composant}
              </div>
              <div style={{ fontSize: 12, color: C.textMid, marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>Causes:</span> {m.causes}
              </div>
              <div style={{ fontSize: 12, color: C.textMid, marginBottom: 6 }}>
                <span style={{ fontWeight: 700 }}>Effet:</span> {m.effet}
                {m.gravite && <span style={{ marginLeft: 12, color: C.textMuted }}>Gravité: {m.gravite}</span>}
              </div>
              <div style={{ padding: '8px 12px', background: C.greenPale,
                borderLeft: `3px solid ${C.green}`, fontSize: 12, color: C.greenDark }}>
                <span style={{ fontWeight: 700 }}>Tâche:</span> {m.tache}
                {m.frequence && m.frequence !== 'A definir' && (
                  <span style={{ marginLeft: 12, color: C.green }}>· {m.frequence}</span>
                )}
              </div>
            </div>
          )
        }) : (
          <div style={{ color: C.textLight, fontSize: 13, padding: 20, textAlign: 'center' }}>
            Aucun mode de défaillance enregistré pour ce capteur.
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Real-Time Predict Panel ─────────────────────────────────────────────────
function PredictPanel() {
  const defaults = { T_Echap_D: 392, T_Echap_G: 389, P_Huile: 442, Regime: 1402, T_Refroid: 85, T_Convert: 95 }
  const [vals, setVals] = useState(defaults)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch(`${API}/amdec/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vals),
      })
      setResult(await res.json())
    } catch (e) {
      setResult({ _error: e.message })
    }
    setLoading(false)
  }

  const niveau = result?.niveau_risque
  const nivColor = { NORMAL: C.green, ATTENTION: C.amber, ALERTE: C.orange, CRITIQUE: C.danger }[niveau] ?? C.textMuted

  return (
    <div>
      <CardTitle>Prédiction Temps Réel</CardTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        {CAPTEURS.map(cap => (
          <div key={cap}>
            <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700, letterSpacing: 1,
              textTransform: 'uppercase', marginBottom: 4 }}>
              {CAPTEUR_ICON[cap]} {CAPTEUR_LABELS[cap]} ({CAPTEUR_UNIT[cap]})
            </div>
            <input type="number" value={vals[cap]}
              onChange={e => setVals(v => ({ ...v, [cap]: parseFloat(e.target.value) || 0 }))}
              style={{ width: '100%', padding: '8px 10px', background: 'rgba(255,255,255,0.9)',
                border: `1px solid ${C.border}`, fontFamily: "'Rajdhani', sans-serif",
                fontSize: 14, color: C.text, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        ))}
      </div>
      <button onClick={run} disabled={loading}
        style={{ background: loading ? C.border : C.green, color: '#fff', border: 'none',
          padding: '11px 28px', fontFamily: "'Rajdhani', sans-serif", fontSize: 12,
          fontWeight: 700, letterSpacing: 3, cursor: loading ? 'wait' : 'pointer',
          textTransform: 'uppercase',
          clipPath: 'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)' }}>
        {loading ? 'ANALYSE EN COURS...' : 'ANALYSER'}
      </button>

      {result && !result._error && (
        <div style={{ marginTop: 16, padding: '16px 20px',
          background: niveau === 'NORMAL' ? C.greenPale : C.dangerPale,
          borderLeft: `4px solid ${nivColor}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2, color: C.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>
                Niveau de risque
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: nivColor }}>
                {niveau ?? '--'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: C.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>
                Health Index
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor(result.health_index ?? 0) }}>
                {result.health_index?.toFixed(1) ?? '--'}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.textMid, marginBottom: 8 }}>
            Score anomalie indicatif: <b style={{ color: C.text }}>{result.anomaly_score?.toFixed(1)}</b>
          </div>
          {result.capteurs_alerte?.length > 0 && (
            <div style={{ padding: '8px 12px', background: 'rgba(185,28,28,0.08)', borderRadius: 2 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.danger, letterSpacing: 2,
                textTransform: 'uppercase', marginBottom: 6 }}>Capteurs en alerte</div>
              {result.capteurs_alerte.map((c, i) => (
                <div key={i} style={{ fontSize: 12, color: C.danger, marginBottom: 3 }}>
                  {CAPTEUR_ICON[c.capteur]} {CAPTEUR_LABELS[c.capteur] || c.capteur}:{' '}
                  <b>{c.valeur} {CAPTEUR_UNIT[c.capteur]}</b>
                  <span style={{ color: C.textMuted }}> (seuil: {c.seuil})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {result?._error && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: C.dangerPale,
          borderLeft: `4px solid ${C.danger}`, color: C.danger, fontSize: 12 }}>
          Erreur: {result._error}
        </div>
      )}
    </div>
  )
}

const HEALTH_REFRESH_MS = 30_000 // 30 secondes

// ─── AI Recommendations Panel ────────────────────────────────────────────────
function AiRecommendationsPanel({ alertesHist, topRisques, stats, seuils }) {
  const [reco, setReco]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [expanded, setExpanded] = useState(false)

  const hasAlerts = alertesHist?.length > 0

  const generate = async () => {
    setLoading(true)
    setError(null)
    setReco(null)
    setExpanded(true)

    // Build symptoms from AMDEC alerts
    const symptoms = [
      ...(alertesHist || []).map(a =>
        `${CAPTEUR_LABELS[a.capteur] || a.capteur}: valeur max ${a.max} ${CAPTEUR_UNIT[a.capteur] || ''} > seuil ${a.seuil}`
      ),
      ...(topRisques || []).slice(0, 2).map(r =>
        `${CAPTEUR_LABELS[r.capteur] || r.capteur}: RPN moyen ${r.rpn_moy?.toFixed(1)}, ${r.nb_modes} modes de défaillance`
      ),
    ]

    // Choose most critical fault code
    const topCap = alertesHist?.[0]?.capteur || topRisques?.[0]?.capteur || 'T_Echap_G'
    const faultCode = `AMDEC-${topCap}`

    try {
      const token = localStorage.getItem("mineassist_token") || localStorage.getItem("token") || ""
      const res = await fetch(`${API}/diagnose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fault_code: faultCode,
          symptoms,
          gmao_context: `CAT 994F1 OCP Benguerir — Health Index AMDEC dégradé. Capteurs en dépassement seuil: ${(alertesHist || []).map(a => a.capteur).join(', ') || 'aucun'}. Analyse IsolationForest: anomalies détectées.`,
          hours_since_maintenance: null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail || `Erreur ${res.status}`)
      }
      const d = await res.json()
      setReco(d.diagnostic)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`,
      borderTop: `3px solid ${C.green}`, padding: '20px 24px', marginBottom: 18,
      boxShadow: '0 2px 10px rgba(0,132,61,0.08)' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 3,
            textTransform: 'uppercase', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 3, height: 11, background: C.green }} />
            Recommandations IA — MineAssist RAG
          </div>
          <div style={{ fontSize: 12, color: C.textMid }}>
            {hasAlerts
              ? `${alertesHist.length} capteur(s) en dépassement seuil détecté(s) — diagnostic IA disponible`
              : 'Aucune alerte active — analyse préventive disponible'}
          </div>
        </div>
        <button onClick={generate} disabled={loading}
          style={{ background: loading ? C.border : C.green, color: '#fff', border: 'none',
            padding: '10px 20px', fontFamily: "'Rajdhani', sans-serif", fontSize: 11,
            fontWeight: 700, letterSpacing: 2, cursor: loading ? 'wait' : 'pointer',
            textTransform: 'uppercase',
            clipPath: 'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)' }}>
          {loading ? 'ANALYSE EN COURS...' : 'GÉNÉRER RECOMMANDATIONS IA'}
        </button>
      </div>

      {hasAlerts && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {alertesHist.map((a, i) => (
            <div key={i} style={{ background: C.dangerPale, border: `1px solid ${C.danger}44`,
              borderRadius: 4, padding: '4px 10px', fontSize: 11, color: C.danger, fontWeight: 700 }}>
              {CAPTEUR_ICON[a.capteur]} {CAPTEUR_LABELS[a.capteur] || a.capteur}
              <span style={{ color: C.textMuted, fontWeight: 400 }}> · max {a.max} vs seuil {a.seuil}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', background: C.dangerPale,
          borderLeft: `4px solid ${C.danger}`, color: C.danger, fontSize: 12, marginBottom: 8 }}>
          <b>Erreur:</b> {error}
          <div style={{ fontSize: 11, color: C.textMid, marginTop: 4 }}>
            Vérifiez que la clé API OpenRouter est configurée dans le backend (.env → OPENROUTER_API_KEY).
          </div>
        </div>
      )}

      {reco && expanded && (
        <div style={{ marginTop: 12, padding: '16px 20px', background: C.greenPale,
          borderLeft: `4px solid ${C.green}`, borderRadius: 2 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.green, letterSpacing: 2,
            textTransform: 'uppercase', marginBottom: 10 }}>Diagnostic IA — Résultats</div>
          {reco.split('\n').map((line, i) => {
            const t = line.trim()
            if (!t) return <div key={i} style={{ height: 8 }} />
            if (t.startsWith('##') || t.startsWith('**'))
              return <div key={i} style={{ fontWeight: 700, color: C.text, fontSize: 13, marginTop: 10, marginBottom: 4 }}>
                {t.replace(/^#+\s*/, '').replace(/\*\*/g, '')}
              </div>
            if (t.startsWith('•') || t.startsWith('-') || t.startsWith('*'))
              return <div key={i} style={{ fontSize: 12, color: C.textMid, marginBottom: 4, paddingLeft: 14 }}>
                {t}
              </div>
            return <div key={i} style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6, marginBottom: 4 }}>
              {t}
            </div>
          })}
        </div>
      )}

      {!reco && !loading && !error && (
        <div style={{ fontSize: 11, color: C.textLight, fontStyle: 'italic', marginTop: 4 }}>
          Cliquez sur "Générer recommandations IA" pour obtenir un diagnostic basé sur les données AMDEC et la documentation CAT 994F1.
        </div>
      )}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function AMDECDiagnosticPage() {
  const [summary, setSummary]   = useState(null)
  const [metadata, setMetadata] = useState(null)
  const [health, setHealth]     = useState(null)
  const [diagCapteur, setDiagCapteur] = useState(null)
  const [diagData, setDiagData]       = useState(null)
  const [loadingDiag, setLoadingDiag] = useState(false)
  const [jours, setJours]       = useState(30)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [silentRefresh, setSilentRefresh] = useState(false)

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setSilentRefresh(true)
    if (!silent) setError(null)
    try {
      const [sumRes, metaRes, healthRes] = await Promise.all([
        fetch(`${API}/amdec/summary`),
        fetch(`${API}/amdec/metadata`),
        fetch(`${API}/amdec/health?jours=${jours}`),
      ])
      if (!sumRes.ok) throw new Error(`Summary: ${sumRes.status}`)
      if (!metaRes.ok) throw new Error(`Metadata: ${metaRes.status}`)
      if (!healthRes.ok) throw new Error(`Health: ${healthRes.status}`)
      const [s, m, h] = await Promise.all([sumRes.json(), metaRes.json(), healthRes.json()])
      setSummary(s)
      setMetadata(m)
      setHealth(h)
      setLastUpdated(new Date())
    } catch (e) {
      if (!silent) setError(e.message)
    }
    if (!silent) setLoading(false)
    else setSilentRefresh(false)
  }, [jours])

  // Chargement initial + auto-refresh toutes les 30s
  useEffect(() => {
    fetchAll()
    const id = setInterval(() => fetchAll(true), HEALTH_REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  const openDiag = async (cap) => {
    setDiagCapteur(cap)
    setDiagData(null)
    setLoadingDiag(true)
    try {
      const res = await fetch(`${API}/amdec/diagnostic/${cap}`)
      setDiagData(await res.json())
    } catch { setDiagData({}) }
    setLoadingDiag(false)
  }

  if (loading) return (
    <div style={{ padding: 60, textAlign: 'center', color: C.textMuted,
      fontFamily: "'Rajdhani', sans-serif" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
      <div style={{ fontSize: 13, letterSpacing: 3, fontWeight: 700 }}>CHARGEMENT DONNÉES AMDEC...</div>
    </div>
  )

  if (error) return (
    <div style={{ padding: 40 }}>
      <div style={{ padding: '18px 22px', background: C.dangerPale, borderLeft: `4px solid ${C.danger}`,
        color: C.danger, fontSize: 13, fontFamily: "'Rajdhani', sans-serif" }}>
        <b>Erreur API AMDEC:</b> {error}
        <div style={{ marginTop: 8, color: C.textMid, fontSize: 12 }}>
          Vérifiez que <code>amdec_integration.py</code> a été exécuté et que le backend FastAPI est démarré.
        </div>
      </div>
    </div>
  )

  // Derived values
  const hi        = health?.health_actuel ?? metadata?.health_index?.moyenne_annuelle ?? 0
  const poids     = metadata?.poids_amdec ?? {}
  const seuils    = metadata?.seuils_alarme ?? {}
  const stats     = metadata?.stats_capteurs ?? {}
  const rpn       = metadata?.rpn_details ?? {}
  const histData  = health?.historique ?? []
  const topRisques   = summary?.top_risques_amdec ?? []
  const alertesHist  = summary?.alertes_historiques ?? []
  const pctBon       = health?.pct_bon ?? summary?.pct_bon ?? 0
  const pctAlerte    = health?.pct_alerte ?? summary?.pct_alerte ?? 0

  const downloadRapport = async () => {
    try {
      const res = await fetch(`${API}/amdec/rapport`)
      const d = await res.json()
      const blob = new Blob([d.rapport], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'RAPPORT_AMDEC_COMPLET.txt'
      a.click()
      URL.revokeObjectURL(url)
    } catch {}
  }

  return (
    <div style={{ fontFamily: "'Rajdhani', sans-serif", color: C.text }}>
      <div style={{ marginBottom: 20, padding: '16px 22px',
        background: C.bgCard, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.green}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: C.textMuted, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 3 }}>
            Maintenance Prédictive · CAT 994F1
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>
            Diagnostic AMDEC & Détection d'Anomalies
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
            IsolationForest pondéré par RPN · 191 modes de défaillance · 14 circuits · 6 capteurs critiques
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: silentRefresh ? C.amber : C.green,
              boxShadow: `0 0 6px ${silentRefresh ? C.amber : C.green}`,
            }} />
            <span style={{ fontSize: 10, color: C.textMuted }}>
              {silentRefresh ? 'Actualisation...' : lastUpdated
                ? `Actualisé à ${lastUpdated.toLocaleTimeString('fr-FR')}`
                : ''}
            </span>
            <span style={{ fontSize: 10, color: C.textLight }}>Auto 30s</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={downloadRapport}
              style={{ background: C.green, color: '#fff', border: 'none', padding: '9px 16px',
                fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: 2,
                cursor: 'pointer', textTransform: 'uppercase',
                clipPath: 'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)' }}>
              Exporter
            </button>
            <button onClick={() => fetchAll(false)}
              style={{ background: 'none', color: C.green, border: `1px solid ${C.green}`, padding: '9px 14px',
                fontFamily: "'Rajdhani', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: 2,
                cursor: 'pointer', textTransform: 'uppercase' }}>
              Forcer actualisation
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI Banner ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Health Index Actuel', value: `${hi.toFixed(1)} / 100`, color: scoreColor(hi), icon: '❤️' },
          { label: 'État Machine',        value: scoreLabel(hi),             color: scoreColor(hi), icon: '🏭' },
          { label: '% Temps BON (>80)',   value: `${pctBon.toFixed(1)}%`,    color: C.green,        icon: '✅' },
          { label: '% Temps en Alerte',   value: `${pctAlerte.toFixed(1)}%`, color: C.danger,       icon: '⚠️' },
        ].map((k, i) => (
          <div key={i} style={{ background: C.bgCard, border: `1px solid ${C.border}`,
            borderTop: `3px solid ${k.color}`, padding: '16px 18px',
            boxShadow: '0 2px 8px rgba(139,105,20,0.07)' }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{k.icon}</div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: C.textMuted,
              textTransform: 'uppercase', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Recommandations IA ── */}
      <AiRecommendationsPanel
        alertesHist={alertesHist}
        topRisques={topRisques}
        stats={stats}
        seuils={seuils}
      />

      {/* ── Row 1: Gauge + Radar ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card>
          <CardTitle>Health Index Pondéré AMDEC</CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <div style={{ flex: '0 0 auto' }}>
              <HealthGauge score={hi} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: 2,
                textTransform: 'uppercase', marginBottom: 10 }}>Poids par capteur</div>
              {Object.entries(poids).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: C.textMid, fontWeight: 600 }}>{CAPTEUR_LABELS[k] || k}</span>
                    <span style={{ fontWeight: 800, color: v >= 1.2 ? C.danger : v >= 0.9 ? C.amber : C.green }}>
                      {v?.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
                    <div style={{ height: '100%', borderRadius: 2, width: `${Math.min(100, (v / 2) * 100)}%`,
                      background: v >= 1.2 ? C.danger : v >= 0.9 ? C.amber : C.green }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Radar Criticité AMDEC (RPN normalisé)</CardTitle>
          <WeightsRadar poids={poids} />
          <div style={{ fontSize: 10, color: C.textLight, textAlign: 'center', marginTop: 4 }}>
            Poids = RPN moyen normalisé × 1.5 max · T_Echap = circuits les plus critiques
          </div>
        </Card>
      </div>

      {/* ── Row 2: History + Top Risques ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 3,
              textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 3, height: 11, background: C.sand }} />
              Historique Health Index
            </div>
            <select value={jours} onChange={e => setJours(Number(e.target.value))}
              style={{ background: C.bgCard, border: `1px solid ${C.border}`, color: C.text,
                fontFamily: "'Rajdhani', sans-serif", fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}>
              {[7, 30, 90, 180].map(d => <option key={d} value={d}>{d} jours</option>)}
            </select>
          </div>
          <HealthHistoryChart history={histData} />
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: C.textMuted }}>
            <span>── <span style={{ color: C.green }}>BON (&gt;80)</span></span>
            <span>── <span style={{ color: C.amber }}>ATTENTION (&gt;60)</span></span>
            <span>── <span style={{ color: C.danger }}>ALERTE (&lt;30)</span></span>
          </div>
        </Card>

        <Card>
          <CardTitle>Top Risques AMDEC</CardTitle>
          {topRisques.length ? topRisques.map((r, i) => (
            <div key={i} style={{ padding: '10px 12px', marginBottom: 10,
              background: i === 0 ? C.dangerPale : i === 1 ? C.orangePale : C.sandPale,
              borderLeft: `3px solid ${i === 0 ? C.danger : i === 1 ? C.orange : C.sand}`,
              cursor: 'pointer' }} onClick={() => openDiag(r.capteur)}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 4 }}>
                {CAPTEUR_ICON[r.capteur]} {CAPTEUR_LABELS[r.capteur] || r.capteur}
              </div>
              <div style={{ fontSize: 11, color: C.textMid }}>
                RPN moy: <b>{r.rpn_moy?.toFixed(1)}</b>
                {' '}| Modes: <b>{r.nb_modes}</b>
                {r.modes_critiques > 0 && (
                  <span style={{ color: C.danger }}> | Critiques: <b>{r.modes_critiques}</b></span>
                )}
              </div>
            </div>
          )) : (
            <div style={{ color: C.textLight, fontSize: 12, padding: '10px 0' }}>Aucun risque</div>
          )}

          {alertesHist.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.danger, letterSpacing: 2,
                textTransform: 'uppercase', marginBottom: 8 }}>Points d'attention</div>
              {alertesHist.map((a, i) => (
                <div key={i} style={{ fontSize: 11, padding: '6px 10px', marginBottom: 6,
                  background: C.dangerPale, borderLeft: `2px solid ${C.danger}`, color: C.textMid }}>
                  <b style={{ color: C.text }}>{CAPTEUR_LABELS[a.capteur] || a.capteur}</b>
                  <br />Max obs: {a.max} (seuil: {a.seuil})
                  <br /><span style={{ color: C.danger, fontSize: 10 }}>{a.message}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Sensor Grid ── */}
      <Card>
        <CardTitle>Capteurs — Cliquer pour le Diagnostic AMDEC du Circuit</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
          {CAPTEURS.map(cap => {
            const w   = poids[cap] ?? 1
            const r   = rpn[cap]   ?? {}
            const s   = seuils[cap]
            const st  = stats[cap] ?? {}
            const isHigh = w >= 1.2
            const depasse = st.max > s
            return (
              <div key={cap} onClick={() => openDiag(cap)}
                style={{ padding: '16px 18px', background: C.bgCard, cursor: 'pointer',
                  border: `1px solid ${isHigh ? C.danger + '66' : C.border}`,
                  borderTop: `3px solid ${isHigh ? C.danger : w >= 0.9 ? C.amber : C.green}`,
                  transition: 'box-shadow 0.2s',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>
                    {CAPTEUR_ICON[cap]} {cap}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {isHigh && <Badge color={C.danger}>CRITIQUE</Badge>}
                    {depasse && <Badge color={C.orange}>SEUIL !</Badge>}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10, fontWeight: 600 }}>
                  {CAPTEUR_LABELS[cap]}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
                  <div style={{ color: C.textMid }}>Poids: <b style={{ color: isHigh ? C.danger : C.text }}>{w.toFixed(2)}</b></div>
                  <div style={{ color: C.textMid }}>RPN moy: <b>{r.rpn_moy?.toFixed(1) ?? '--'}</b></div>
                  <div style={{ color: C.textMid }}>Seuil: <b>{s} {CAPTEUR_UNIT[cap]}</b></div>
                  <div style={{ color: depasse ? C.danger : C.textMid }}>Max obs: <b>{st.max?.toFixed(1) ?? '--'}</b></div>
                  <div style={{ color: C.textMid }}>Moy: <b>{st.mean?.toFixed(1) ?? '--'}</b></div>
                  <div style={{ color: C.textMid }}>Modes: <b>{r.nb_modes ?? '--'}</b></div>
                </div>
                <div style={{ marginTop: 10, fontSize: 10, color: C.green, fontWeight: 700,
                  letterSpacing: 1, textTransform: 'uppercase' }}>
                  Voir modes AMDEC →
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* ── Predict + Info ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card>
          <PredictPanel />
        </Card>
        <Card>
          <CardTitle>Résultats Pipeline ML</CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Modèle', value: 'IsolationForest', icon: '🤖' },
              { label: 'Période données', value: metadata?.periode_data ?? '--', icon: '📅' },
              { label: 'Nb features', value: metadata?.nb_features ?? '--', icon: '🔢' },
              { label: 'Seuil alerte', value: metadata?.threshold_anomaly?.toFixed(1) ?? '--', icon: '🎯' },
              { label: 'Modes AMDEC', value: summary?.nb_modes_amdec ?? '--', icon: '📋' },
              { label: 'Health moy. annuel', value: `${(metadata?.health_index?.moyenne_annuelle ?? 0).toFixed(1)} / 100`, icon: '📊' },
            ].map((item, i) => (
              <div key={i} style={{ padding: '10px 14px', background: C.sandPale,
                border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</div>
                <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1,
                  textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '12px 16px', background: C.greenPale,
            borderLeft: `3px solid ${C.green}`, fontSize: 12, color: C.greenDark }}>
            <b>Rapport AMDEC complet disponible:</b><br />
            <span style={{ color: C.textMid }}>resultats_ML/predictive_final/RAPPORT_AMDEC_COMPLET.txt</span>
          </div>
          <div style={{ marginTop: 10, padding: '12px 16px', background: C.orangePale,
            borderLeft: `3px solid ${C.orange}`, fontSize: 12, color: C.textMid }}>
            <b style={{ color: C.orange }}>Capteurs ayant dépassé le seuil:</b><br />
            T_Echap_G (612.5°C &gt; 600°C) · T_Refroid (113°C &gt; 105°C)
          </div>
        </Card>
      </div>

      {/* Diagnostic Modal */}
      {diagCapteur && (
        <DiagnosticModal
          capteur={diagCapteur}
          data={loadingDiag ? null : diagData}
          poids={poids}
          onClose={() => { setDiagCapteur(null); setDiagData(null) }}
        />
      )}
    </div>
  )
}
