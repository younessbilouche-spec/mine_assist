import { useState, useEffect, useMemo, useCallback } from "react"
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Brush,
} from "recharts"
import { API, C } from "../config"

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────
const MAX_CHART_PTS = 350

const SENSORS = [
  { label: "Temp. liquide refroid.", unite: "°C",    typical: 85,   min: 70,  max: 100,  icon: "🌡" },
  { label: "Temp. échapp. Droit",   unite: "°C",    typical: 420,  min: 200, max: 650,  icon: "🔥" },
  { label: "Temp. échapp. Gauche",  unite: "°C",    typical: 415,  min: 200, max: 650,  icon: "🔥" },
  { label: "Temp. sortie conv.",    unite: "°C",    typical: 95,   min: 60,  max: 129,  icon: "⚙"  },
  { label: "Pression huile",        unite: "kPa",   typical: 400,  min: 280, max: 550,  icon: "🛢"  },
  { label: "Régime moteur",         unite: "Tr/min",typical: 1800, min: 600, max: 2100, icon: "⚡"  },
]

function scoreZone(s) {
  if (s == null) return { label: "—",        color: C.textMuted, bg: "transparent" }
  if (s >= 0.55) return { label: "Anomalie",  color: C.danger,   bg: C.dangerPale  }
  if (s >= 0.45) return { label: "Attention", color: C.orange,   bg: C.orangePale  }
  return              { label: "Normal",    color: C.green,    bg: C.greenPale   }
}

function shortName(n) { return (n || "").split(".").pop() }

function dominantDriver(point, stats, params) {
  let best = { name: "—", z: 0 }
  ;(params || []).forEach(p => {
    const v = point?.[shortName(p)]
    const s = stats?.[p]
    if (v == null || !s?.sigma) return
    const z = Math.abs((+v - +s.mu) / +s.sigma)
    if (z > best.z) best = { name: shortName(p), z }
  })
  return best
}

// ─────────────────────────────────────────────────────────────────────────────
// MICRO-COMPOSANTS
// ─────────────────────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{
      background: "rgba(255,253,248,0.97)",
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: "20px 22px",
      boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
      ...style,
    }}>{children}</div>
  )
}

function Label({ children, color }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 800, letterSpacing: 2.5,
      textTransform: "uppercase", color: color || C.textMuted,
      marginBottom: 5,
    }}>{children}</div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: C.border, margin: "14px 0" }} />
}

function ZoneBadge({ score, size = "sm" }) {
  const z = scoreZone(score)
  return (
    <span style={{
      display: "inline-block",
      padding: size === "lg" ? "5px 14px" : "2px 9px",
      borderRadius: 6,
      background: z.bg,
      color: z.color,
      fontSize: size === "lg" ? 12 : 10,
      fontWeight: 800,
      border: `1px solid ${z.color}30`,
      letterSpacing: 0.8,
    }}>{z.label}</span>
  )
}

function MiniProgressBar({ value, max, color, h = 5 }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div style={{ height: h, borderRadius: h, background: "rgba(0,0,0,0.07)", overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%",
        background: color, borderRadius: h,
        transition: "width .5s ease",
      }} />
    </div>
  )
}

function HealthRing({ pct, color }) {
  const r = 38, c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <svg width={96} height={96} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={48} cy={48} r={r} fill="none" stroke={`${color}20`} strokeWidth={9} />
      <circle cx={48} cy={48} r={r} fill="none" stroke={color} strokeWidth={9}
        strokeDasharray={c} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset .8s ease" }}
      />
      <text x={48} y={52} textAnchor="middle"
        style={{ transform: "rotate(90deg) translate(0,-96px)", fontSize: 18,
          fontWeight: 800, fill: color, fontFamily: "'Rajdhani',sans-serif" }}>
        {Math.round(pct)}%
      </text>
    </svg>
  )
}

// Tooltip graphe
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  const z = scoreZone(d?.score)
  return (
    <div style={{
      background: "#fff", border: `1px solid ${z.color}50`,
      borderLeft: `4px solid ${z.color}`,
      padding: "10px 14px", borderRadius: 10,
      boxShadow: "0 6px 20px rgba(0,0,0,0.1)",
      fontFamily: "'Rajdhani',sans-serif", minWidth: 190,
    }}>
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 5 }}>{label}</div>
      <ZoneBadge score={d?.score} />
      <div style={{ fontSize: 12, color: C.textMid, marginTop: 6 }}>
        Score : <strong style={{ color: z.color }}>{d?.score?.toFixed(4)}</strong>
      </div>
      <div style={{ fontSize: 9, color: C.textLight, marginTop: 6,
        borderTop: `1px solid ${C.border}`, paddingTop: 5 }}>
        &lt;0.45 normal · 0.45–0.55 attention · &gt;0.55 anomalie
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
export default function AnomalyDashboard() {
  const [data,           setData]           = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState("")
  const [refresh,        setRefresh]        = useState(0)
  const [sliderVals,     setSliderVals]     = useState(SENSORS.map(s => s.typical))
  const [predictResult,  setPredictResult]  = useState(null)
  const [predictLoading, setPredictLoading] = useState(false)
  const [showStats,      setShowStats]      = useState(false)

  useEffect(() => {
    setLoading(true); setError("")
    fetch(`${API}/gmao/anomaly-results`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok || j.detail) throw new Error(j.detail || `HTTP ${r.status}`)
        return j
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [refresh])

  // ── Décimation : tous les hooks avant tout return conditionnel ────────────
  const chartData = useMemo(() => {
    const raw = data?.timeline
    if (!Array.isArray(raw) || !raw.length) return []

    const colored = raw.map(p => ({
      ...p,
      score_ok:  p.is_anomaly === 0 ? p.score : null,
      score_bad: p.is_anomaly === 1 ? p.score : null,
    }))

    if (colored.length <= MAX_CHART_PTS) return colored

    // Garder toutes les anomalies + échantillonner les normaux
    const bad     = colored.filter(p => p.is_anomaly === 1)
    const ok      = colored.filter(p => p.is_anomaly === 0)
    const budget  = Math.max(50, MAX_CHART_PTS - bad.length)
    const step    = Math.ceil(ok.length / budget)
    const okSet   = new Set(ok.filter((_, i) => i % step === 0).map(p => p.t))

    return colored.filter(p => p.is_anomaly === 1 || okSet.has(p.t))
  }, [data])

  const enrichedTop = useMemo(() => {
    if (!data?.anomaly_points) return []
    return data.anomaly_points.map(pt => ({
      ...pt,
      ...dominantDriver(pt, data.stats_2sigma, data.parametres),
    }))
  }, [data])

  const radarData = useMemo(() => SENSORS.map((s, i) => {
    const paramKey = Object.keys(data?.stats_2sigma || {}).find(k =>
      shortName(k).toLowerCase().includes(s.label.split(" ").pop().toLowerCase().slice(0, 5))
    )
    const st = data?.stats_2sigma?.[paramKey]
    const z  = st?.sigma
      ? Math.abs((sliderVals[i] - st.mu) / st.sigma)
      : Math.abs((sliderVals[i] - s.typical) / ((s.max - s.min) / 6))
    return { subject: s.label.split(".").pop().trim(), score: Math.min(10, z * 2), fullMark: 10 }
  }), [sliderVals, data])

  const handlePredict = useCallback(async () => {
    setPredictLoading(true); setPredictResult(null)
    try {
      const r = await fetch(`${API}/gmao/predict-anomaly`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valeurs: sliderVals }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail || "Erreur")
      setPredictResult(j)
    } catch (e) { setPredictResult({ error: e.message }) }
    setPredictLoading(false)
  }, [sliderVals])

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading) return <Skeleton />
  if (error)   return <ErrState msg={error} onRetry={() => setRefresh(r => r + 1)} />

  const { timeline = [], nb_anomalies = 0, pct_anomalies = 0,
          nb_total = 0, parametres = [], stats_2sigma = {} } = data || {}

  if (!timeline.length || !parametres.length) {
    return <EmptyState onRetry={() => setRefresh(r => r + 1)} />
  }

  // ── Métriques dérivées ────────────────────────────────────────────────────
  const anomPct   = parseFloat(pct_anomalies) || 0
  const healthPct = Math.max(0, 100 - anomPct * 2)
  const scoreMax  = timeline.reduce((m, p) => Math.max(m, p.score ?? 0), 0)
  const isDecim   = timeline.length > MAX_CHART_PTS
  const nbNormal  = timeline.filter(p => p.score < 0.45).length
  const nbAttn    = timeline.filter(p => p.score >= 0.45 && p.score < 0.55).length
  const nbAnom    = timeline.filter(p => p.score >= 0.55).length
  const topDriver = enrichedTop[0]

  const healthColor = healthPct >= 85 ? C.green : healthPct >= 60 ? C.orange : C.danger

  // ── RENDU ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1340, margin: "0 auto", padding: "20px 20px 48px",
      fontFamily: "'Rajdhani',sans-serif" }}>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .anom-row:hover { background: rgba(99,102,241,0.04) !important; }
        .anom-slider::-webkit-slider-thumb { accent-color: #6366f1; }
      `}</style>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — EN-TÊTE + KPIs
      ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start",
        justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        {/* titre */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: "linear-gradient(135deg,#6366f1,#0ea5e9)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
            }}>🤖</div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.text, lineHeight: 1 }}>
                Détection d'anomalies IA
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>
                Isolation Forest · {data.scope_machine || "994F-1"} ·{" "}
                {data.training_start?.slice(0,10)} → {data.training_end?.slice(0,10)}
              </div>
            </div>
          </div>
        </div>
        <button onClick={() => setRefresh(r => r + 1)} style={{
          background: "none", border: `1px solid ${C.border}`, color: C.textMuted,
          padding: "8px 18px", borderRadius: 8, cursor: "pointer",
          fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: 2,
        }}>↻ ACTUALISER</button>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 22 }}>
        {[
          { label: "Points analysés", val: nb_total?.toLocaleString("fr-FR"), sub: "fenêtres 2 min",
            color: C.green, bar: nb_total, barMax: nb_total },
          { label: "Anomalies détectées", val: nb_anomalies, sub: `${anomPct}% du total`,
            color: anomPct > 10 ? C.danger : anomPct > 5 ? C.orange : C.ok,
            bar: nb_anomalies, barMax: nb_total },
          { label: "Score de santé", val: `${Math.round(healthPct)}%`, sub: "base nominale filtrée",
            color: healthColor, bar: healthPct, barMax: 100 },
          { label: "Modèle IF", val: `${data.n_estimators || 200}`, sub: "arbres · contamination " + Number(data.contamination || 0).toFixed(2),
            color: "#6366f1", bar: null },
        ].map(({ label, val, sub, color, bar, barMax }) => (
          <Card key={label} style={{ padding: "18px 20px" }}>
            <Label>{label}</Label>
            <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1,
              fontFamily: "'Rajdhani',sans-serif", marginBottom: 4 }}>{val}</div>
            <div style={{ fontSize: 11, color: C.textLight, marginBottom: bar != null ? 8 : 0 }}>{sub}</div>
            {bar != null && <MiniProgressBar value={bar} max={barMax} color={color} h={4} />}
          </Card>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2 — GRAPHE PRINCIPAL + PANNEAU DROIT
      ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 16, marginBottom: 18 }}>

        {/* graphe timeline */}
        <Card style={{ padding: "20px 20px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            marginBottom: 4 }}>
            <div>
              <Label>Score d'isolation — évolution temporelle</Label>
              <div style={{ fontSize: 11, color: C.textLight }}>
                {isDecim
                  ? `${timeline.length.toLocaleString("fr-FR")} pts → ${chartData.length} affichés (anomalies conservées)`
                  : `${timeline.length} points · pas de décimation`}
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {[["Normal", C.green], ["Attention", C.orange], ["Anomalie", C.danger]].map(([l, c]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.textMuted }}>{l}</span>
                </div>
              ))}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 52, left: -8, bottom: 0 }}>
              <ReferenceArea y1={0.55} y2={Math.min(1, scoreMax * 1.1)}
                fill={C.danger} fillOpacity={0.05} />
              <ReferenceArea y1={0.45} y2={0.55}
                fill={C.orange} fillOpacity={0.06} />
              <ReferenceArea y1={0} y2={0.45}
                fill={C.green} fillOpacity={0.04} />

              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: C.textMuted }}
                interval="preserveStartEnd" minTickGap={70}
                axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: C.textMuted }}
                domain={[0, Math.min(1, scoreMax * 1.1)]}
                axisLine={false} tickLine={false} width={34} />
              <Tooltip content={<ChartTooltip />} />

              <ReferenceLine y={0.45} stroke={C.orange} strokeDasharray="5 3" strokeWidth={1}
                label={{ value: "attention", position: "right", fill: C.orange, fontSize: 9 }} />
              <ReferenceLine y={0.55} stroke={C.danger} strokeDasharray="5 3" strokeWidth={1.5}
                label={{ value: "anomalie", position: "right", fill: C.danger, fontSize: 9 }} />

              {/* courbe normale */}
              <Line type="monotone" dataKey="score_ok" name="Normal"
                stroke={C.green} strokeWidth={1.5} dot={false}
                activeDot={{ r: 4 }} connectNulls={false} />

              {/* points anomalie uniquement */}
              <Line type="monotone" dataKey="score_bad" name="Anomalie"
                stroke={C.danger} strokeWidth={0}
                dot={({ cx, cy, index }) =>
                  cx && cy
                    ? <circle key={`a${index}`} cx={cx} cy={cy} r={4}
                        fill={C.danger} stroke="#fff" strokeWidth={1.5}
                        style={{ filter: "drop-shadow(0 0 4px rgba(192,57,43,0.5))" }} />
                    : null
                }
                activeDot={{ r: 6, fill: C.danger, stroke: "#fff", strokeWidth: 2 }}
                connectNulls={false} />

              <Brush dataKey="t" height={22} stroke="#6366f1"
                fill="rgba(99,102,241,0.05)" tickFormatter={() => ""} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        {/* panneau droit */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* anneau santé */}
          <Card style={{ padding: "18px 16px", textAlign: "center" }}>
            <Label>Santé système</Label>
            <div style={{ display: "flex", justifyContent: "center", margin: "6px 0" }}>
              <HealthRing pct={healthPct} color={healthColor} />
            </div>
            <ZoneBadge score={healthPct < 60 ? 0.6 : healthPct < 85 ? 0.48 : 0.3} />
          </Card>

          {/* répartition */}
          <Card style={{ padding: "16px" }}>
            <Label>Répartition scores</Label>
            {[
              { label: "Normal",    n: nbNormal, color: C.green  },
              { label: "Attention", n: nbAttn,   color: C.orange },
              { label: "Anomalie",  n: nbAnom,   color: C.danger },
            ].map(({ label, n, color }) => (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                  <span style={{ color: C.textMid }}>{label}</span>
                  <span style={{ color }}>{n.toLocaleString("fr-FR")}</span>
                </div>
                <MiniProgressBar value={n} max={nb_total} color={color} h={5} />
              </div>
            ))}
          </Card>

          {/* pire anomalie */}
          {topDriver && (
            <Card style={{ padding: "16px", borderLeft: `4px solid ${C.danger}` }}>
              <Label color={C.danger}>Anomalie principale</Label>
              <div style={{ fontSize: 9, color: C.textLight, marginBottom: 6 }}>{topDriver.t}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: C.danger,
                fontFamily: "'Rajdhani',sans-serif", lineHeight: 1 }}>
                {topDriver.score?.toFixed(4)}
              </div>
              <div style={{ fontSize: 11, color: C.textMid, marginTop: 6 }}>
                Driver : <strong>{topDriver.name || topDriver.dominant_param}</strong>
              </div>
              {(topDriver.z || topDriver.dominant_z) && (
                <div style={{ fontSize: 10, color: C.orange }}>
                  Z-score : {(topDriver.z || topDriver.dominant_z).toFixed(2)}σ
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3 — TOP ANOMALIES
      ══════════════════════════════════════════════════════════════════════ */}
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 14 }}>
          <Label>Top anomalies interprétables</Label>
          <span style={{ fontSize: 10, color: C.textLight }}>score bas = combinaison la plus atypique</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                {["#", "Horodatage", "Score", "Zone", "Driver dominant", "Z-score max",
                  ...parametres.map(shortName)].map(h => (
                  <th key={h} style={{ padding: "8px 12px",
                    textAlign: h === "#" || h === "Horodatage" || h === "Driver dominant" || h === "Zone" ? "left" : "right",
                    fontSize: 9, fontWeight: 800, color: C.textMuted,
                    letterSpacing: 1.5, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enrichedTop.slice(0, 12).map((a, i) => {
                const z = scoreZone(a.score)
                return (
                  <tr key={i} className="anom-row" style={{
                    borderBottom: `1px solid ${C.border}`,
                    background: i === 0 ? `${C.danger}05` : "transparent",
                    transition: "background .15s",
                  }}>
                    <td style={{ padding: "9px 12px", color: C.textLight, fontWeight: 700 }}>
                      {i === 0 ? "▲" : i + 1}
                    </td>
                    <td style={{ padding: "9px 12px", color: C.textMid, whiteSpace: "nowrap" }}>{a.t}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      <div>
                        <span style={{ fontWeight: 800, color: z.color,
                          fontFamily: "'Rajdhani',sans-serif", fontSize: 14 }}>
                          {a.score?.toFixed(4)}
                        </span>
                        <MiniProgressBar value={a.score} max={0.8} color={z.color} h={3} />
                      </div>
                    </td>
                    <td style={{ padding: "9px 12px" }}><ZoneBadge score={a.score} /></td>
                    <td style={{ padding: "9px 12px", fontWeight: 700, color: C.text }}>
                      {a.name || a.dominant_param}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right" }}>
                      <span style={{ color: (a.z || a.dominant_z) > 3 ? C.danger : C.orange, fontWeight: 700 }}>
                        {(a.z || a.dominant_z) ? `${(a.z || a.dominant_z).toFixed(1)}σ` : "—"}
                      </span>
                    </td>
                    {parametres.map(p => {
                      const sh = shortName(p), val = a[sh]
                      const st = stats_2sigma?.[p]
                      const hi = st && val > st.seuil_max
                      const lo = st && val < st.seuil_min
                      return (
                        <td key={p} style={{ padding: "9px 12px", textAlign: "right",
                          fontWeight: (hi || lo) ? 700 : 400,
                          color: hi ? C.danger : lo ? C.orange : C.text }}>
                          {val ?? "—"}{hi && " ↑"}{lo && " ↓"}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 4 — TEST IA + STATS (côte à côte)
      ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>

        {/* TEST IA */}
        <Card>
          <Label>Test IA — simulation capteurs</Label>
          <div style={{ fontSize: 11, color: C.textLight, marginBottom: 14 }}>
            Ajuste les valeurs · le modèle évalue la combinaison
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
            {SENSORS.map((s, i) => {
              const val      = sliderVals[i]
              const outRange = val < s.min || val > s.max
              const pct      = Math.max(0, Math.min(100, ((val - s.min) / (s.max - s.min)) * 100))
              return (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.textMid }}>
                      {s.icon} {s.label}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {outRange && (
                        <span style={{ fontSize: 9, color: C.orange, fontWeight: 800 }}>HORS PLAGE</span>
                      )}
                      <input type="number" value={val} min={s.min} max={s.max}
                        onChange={e => {
                          const c = [...sliderVals]; c[i] = +e.target.value; setSliderVals(c)
                        }}
                        style={{
                          width: 72, textAlign: "right", padding: "3px 7px",
                          border: `1px solid ${outRange ? C.orange : C.border}`,
                          color: outRange ? C.orange : C.text,
                          background: "rgba(255,255,255,0.9)", borderRadius: 6,
                          fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 700,
                          outline: "none",
                        }}
                      />
                      <span style={{ fontSize: 10, color: C.textLight, width: 38 }}>{s.unite}</span>
                    </div>
                  </div>
                  <input type="range" min={s.min} max={s.max} value={val}
                    onChange={e => {
                      const c = [...sliderVals]; c[i] = +e.target.value; setSliderVals(c)
                    }}
                    style={{ width: "100%", accentColor: "#6366f1", cursor: "pointer" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between",
                    fontSize: 9, color: C.textLight }}>
                    <span>{s.min}</span>
                    <span style={{ color: C.green, fontWeight: 700 }}>typique : {s.typical}</span>
                    <span>{s.max}</span>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <button onClick={handlePredict} disabled={predictLoading} style={{
              flex: 1, padding: "12px",
              background: predictLoading ? "#d1d5db" : "linear-gradient(135deg,#6366f1,#0ea5e9)",
              color: "#fff", border: "none", borderRadius: 10,
              fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 800,
              letterSpacing: 2, cursor: predictLoading ? "wait" : "pointer",
              boxShadow: predictLoading ? "none" : "0 4px 14px rgba(99,102,241,0.35)",
            }}>
              {predictLoading ? "⟳ Analyse..." : "▶ ANALYSER"}
            </button>
            <button onClick={() => { setSliderVals(SENSORS.map(s => s.typical)); setPredictResult(null) }}
              style={{
                padding: "12px 16px", background: "none",
                border: `1px solid ${C.border}`, color: C.textMuted,
                borderRadius: 10, cursor: "pointer",
                fontFamily: "'Rajdhani',sans-serif", fontSize: 11, fontWeight: 700,
              }}>↺</button>
          </div>

          {/* résultat */}
          {predictResult?.error && (
            <div style={{ padding: "12px 14px", background: C.dangerPale,
              border: `1px solid ${C.danger}40`, borderRadius: 8,
              fontSize: 12, color: C.danger, fontWeight: 700 }}>
              ❌ {predictResult.error}
            </div>
          )}
          {predictResult && !predictResult.error && (() => {
            const z = scoreZone(predictResult.score)
            return (
              <div style={{ padding: "16px 18px", borderRadius: 12,
                background: z.bg, border: `1px solid ${z.color}40`,
                borderLeft: `5px solid ${z.color}` }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: C.textMuted,
                  letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Verdict</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: z.color, marginBottom: 10,
                  fontFamily: "'Rajdhani',sans-serif" }}>
                  {predictResult.is_anomaly ? "⚠ Anomalie détectée" : "✅ Comportement normal"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 9, color: C.textMuted, fontWeight: 800, marginBottom: 4 }}>
                      SCORE
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: z.color,
                      fontFamily: "'Rajdhani',sans-serif" }}>
                      {predictResult.score?.toFixed(4)}
                    </div>
                    <MiniProgressBar value={predictResult.score} max={0.8} color={z.color} h={4} />
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.textMuted, fontWeight: 800, marginBottom: 4 }}>
                      CONFIANCE
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800,
                      color: predictResult.is_anomaly ? C.danger : C.green,
                      fontFamily: "'Rajdhani',sans-serif" }}>
                      {predictResult.confiance}%
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 9, color: C.textLight, marginTop: 10 }}>
                  &lt;0.45 normal · 0.45–0.55 attention · &gt;0.55 anomalie
                </div>
              </div>
            )
          })()}
          {!predictResult && (
            <div style={{ textAlign: "center", padding: "18px 0",
              color: C.textLight, fontSize: 12 }}>
              Lance l'analyse pour voir le verdict
            </div>
          )}
        </Card>

        {/* RADAR + STATS 2σ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <Label>Radar déviation Z-score</Label>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                <PolarGrid stroke={C.border} />
                <PolarAngleAxis dataKey="subject"
                  tick={{ fontSize: 9, fontWeight: 700, fill: C.textMuted }} />
                <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
                <Radar dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </Card>

          {/* Statistiques 2σ (accordéon) */}
          <Card>
            <button onClick={() => setShowStats(s => !s)} style={{
              width: "100%", background: "none", border: "none", cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: 0, fontFamily: "'Rajdhani',sans-serif",
            }}>
              <Label>Statistiques 2σ — base modèle</Label>
              <span style={{ fontSize: 12, color: C.textMuted }}>
                {showStats ? "▲ réduire" : "▼ afficher"}
              </span>
            </button>

            {showStats && (
              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                      {["Paramètre", "µ", "σ", "Min 2σ", "Max 2σ"].map(h => (
                        <th key={h} style={{ padding: "6px 10px",
                          textAlign: h === "Paramètre" ? "left" : "right",
                          fontSize: 8, fontWeight: 800, color: C.textMuted,
                          letterSpacing: 1.5, textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stats_2sigma).map(([param, s], i) => (
                      <tr key={param} style={{ borderBottom: `1px solid ${C.border}`,
                        background: i % 2 === 0 ? "rgba(201,168,76,0.03)" : "transparent" }}>
                        <td style={{ padding: "7px 10px", fontWeight: 700, color: C.textMid }}>
                          {shortName(param)}
                        </td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: C.green, fontWeight: 700 }}>{s.mu}</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: C.sand }}>{s.sigma}</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: C.orange }}>{s.seuil_min}</td>
                        <td style={{ padding: "7px 10px", textAlign: "right", color: C.danger }}>{s.seuil_max}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 10, fontSize: 10, color: C.textLight, lineHeight: 1.6 }}>
                  Ces seuils sont statistiques (µ ± 2σ sur la base d'entraînement).
                  Ils servent à expliquer les anomalies, pas à remplacer les seuils métier.
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTATS VIDE / ERREUR / SKELETON
// ─────────────────────────────────────────────────────────────────────────────
function ErrState({ msg, onRetry }) {
  return (
    <div style={{ padding: 60, textAlign: "center", fontFamily: "'Rajdhani',sans-serif" }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.danger, marginBottom: 8 }}>{msg}</div>
      <div style={{ fontSize: 12, color: C.textMid, marginBottom: 20 }}>
        Lance d'abord :{" "}
        <code style={{ background: C.sandPale, padding: "2px 8px", borderRadius: 4 }}>
          python train_anomaly.py
        </code>
      </div>
      <button onClick={onRetry} style={{
        padding: "10px 24px", background: C.danger, color: "#fff",
        border: "none", borderRadius: 8, cursor: "pointer",
        fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
      }}>Réessayer</button>
    </div>
  )
}

function EmptyState({ onRetry }) {
  return (
    <div style={{ padding: 80, textAlign: "center", fontFamily: "'Rajdhani',sans-serif" }}>
      <div style={{ fontSize: 52, marginBottom: 14 }}>🤖</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 8 }}>
        Modèle non entraîné
      </div>
      <div style={{ fontSize: 12, color: C.textMid, marginBottom: 20 }}>
        Aucune analyse disponible. Lance le script puis recharge.
      </div>
      <code style={{ background: C.sandPale, padding: "8px 18px", borderRadius: 6,
        fontSize: 12, display: "block", marginBottom: 20 }}>
        python train_anomaly.py
      </code>
      <button onClick={onRetry} style={{
        padding: "10px 24px", background: "#6366f1", color: "#fff",
        border: "none", borderRadius: 8, cursor: "pointer",
        fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
      }}>Actualiser</button>
    </div>
  )
}

function SBox({ w = "100%", h = 20, mb = 8 }) {
  return (
    <div style={{
      width: w, height: h, marginBottom: mb, borderRadius: 6,
      background: "linear-gradient(90deg,rgba(212,201,176,0.3)25%,rgba(212,201,176,0.6)50%,rgba(212,201,176,0.3)75%)",
      backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite",
    }} />
  )
}

function Skeleton() {
  return (
    <div style={{ maxWidth: 1340, margin: "0 auto", padding: 20,
      fontFamily: "'Rajdhani',sans-serif" }}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      <SBox h={40} w={320} mb={20} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        {[...Array(4)].map((_,i) => (
          <div key={i} style={{ background: "rgba(255,253,248,0.97)", border: "1px solid #D4C9B0",
            borderRadius: 16, padding: 20 }}>
            <SBox h={12} w="60%" mb={10} />
            <SBox h={30} w="45%" mb={8} />
            <SBox h={10} w="80%" mb={0} />
          </div>
        ))}
      </div>
      <SBox h={360} mb={16} />
      <SBox h={200} mb={0} />
    </div>
  )
}
