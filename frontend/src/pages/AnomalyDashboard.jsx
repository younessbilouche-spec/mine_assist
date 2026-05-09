
import { useState, useEffect, useMemo } from "react"
import {
  ComposedChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine
} from "recharts"
import { API } from "../config"
const API_URL = API

const C = {
  bg:        "#F5F0E8",
  bgCard:    "rgba(255,253,248,0.92)",
  border:    "#D4C9B0",
  green:     "#00843D",
  greenLt:   "#00A84F",
  greenDark: "#005C2B",
  greenPale: "#E8F5EE",
  orange:    "#C4760A",
  orangePale:"#FDF3E3",
  sand:      "#C9A84C",
  sandPale:  "#F7F0DC",
  text:      "#2A2A1E",
  textMid:   "#5A5240",
  textMuted: "#8A7D60",
  textLight: "#B0A080",
  danger:    "#C0392B",
  dangerPale:"#FDECEA",
  ok:        "#00843D",
}

function Card({ children, style }) {
  return (
    <div style={{
      background: "var(--c-bgCard, rgba(255,253,248,0.92))",
      border: `1px solid var(--c-border, ${C.border})`,
      borderTop: `2px solid ${C.sand}`,
      borderRadius: 14,
      padding: "22px 24px",
      backdropFilter: "blur(10px)",
      boxShadow: "0 8px 28px rgba(0,0,0,0.05), 0 2px 10px rgba(139,105,20,0.06)", ...style
    }}>
      {children}
    </div>
  )
}

function CardTitle({ children, accent, right }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: 3,
      textTransform: "uppercase", marginBottom: 14, paddingBottom: 10,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", gap: 7
    }}>
      <div style={{ width: 3, height: 11, background: accent || C.sand }} />
      <span>{children}</span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  )
}

function KpiCard({ icon, label, value, sub, accent }) {
  return (
    <Card style={{ textAlign: "center", padding: "20px 16px", borderTop: `3px solid ${accent || C.green}` }}>
      <div style={{
        fontSize: 22, margin: "0 auto 10px", width: 44, height: 44,
        borderRadius: 12, background: `${accent || C.green}14`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{icon}</div>
      <div style={{
        fontSize: 30, fontWeight: 700, color: accent || C.green,
        fontFamily: "'Rajdhani', sans-serif", lineHeight: 1
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 2.5,
        textTransform: "uppercase", color: C.textMuted, margin: "8px 0 4px"
      }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.textLight }}>{sub}</div>}
    </Card>
  )
}

function TimelineTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${d?.is_anomaly ? C.danger : C.border}`,
      padding: "10px 14px", fontSize: 12, color: C.text,
      boxShadow: "0 4px 16px rgba(0,0,0,0.1)", minWidth: 180
    }}>
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ fontWeight: 700, color: d?.is_anomaly ? C.danger : C.green }}>
        {d?.is_anomaly ? "🚨 Anomalie" : "✅ Normal"}
      </div>
      <div style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>
        Score : {d?.score?.toFixed(4)}
      </div>
    </div>
  )
}

function shortName(fullName) {
  return fullName.split(".").pop()
}

function computeDominantDriver(point, stats, params) {
  let best = { name: "—", z: 0 }
  params.forEach(param => {
    const short = shortName(param)
    const value = point?.[short]
    const st = stats?.[param]
    if (value === null || value === undefined || !st || !st.sigma) return
    const z = Math.abs((Number(value) - Number(st.mu)) / Number(st.sigma || 1))
    if (z > best.z) best = { name: short, z }
  })
  return best
}

export default function AnomalyDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState("timeline")

  const [predictVals, setPredictVals] = useState(["","","","","",""])
  const [predictResult, setPredictResult] = useState(null)
  const [predictLoading, setPredictLoading] = useState(false)

  const PREDICT_LABELS = [
    { label: "Temp. liquide refroid.", unite: "°C" },
    { label: "Temp. échappement Droit", unite: "°C" },
    { label: "Temp. échappement gauche", unite: "°C" },
    { label: "Temp. sortie convertisseur", unite: "°C" },
    { label: "Pression huile moteur", unite: "kPa" },
    { label: "Régime moteur", unite: "Tr/min" },
  ]

  useEffect(() => {
    fetch(`${API_URL}/gmao/anomaly-results`)
      .then(res => res.json())
      .then(json => {
        if (json.detail) throw new Error(json.detail)
        setData(json)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const handlePredict = async () => {
    const valeurs = predictVals.map(v => parseFloat(v))
    if (valeurs.some(isNaN)) return
    setPredictLoading(true)
    setPredictResult(null)
    try {
      const r = await fetch(`${API_URL}/gmao/predict-anomaly`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valeurs }),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json.detail || "Erreur de prédiction")
      setPredictResult(json)
    } catch (e) {
      setPredictResult({ error: e.message })
    }
    setPredictLoading(false)
  }

  const enrichedTop = useMemo(() => {
    if (!data?.anomaly_points) return []
    return data.anomaly_points.map(item => {
      const dominant = computeDominantDriver(item, data.stats_2sigma, data.parametres || [])
      return { ...item, dominant_param: dominant.name, dominant_z: dominant.z }
    })
  }, [data])

  if (loading) return <SkeletonLoader />

  if (error) return (
    <div style={{ padding: "28px 32px", fontFamily: "'Rajdhani', sans-serif" }}>
      <div style={{
        padding: "18px 22px", background: C.dangerPale,
        border: `1px solid #e8bfba`, borderLeft: `4px solid ${C.danger}`,
        color: C.danger, fontSize: 13, fontWeight: 600
      }}>
        ❌ {error}
        <div style={{ fontSize: 11, color: C.textMid, marginTop: 6, fontWeight: 400 }}>
          Lance d'abord : <code>python train_anomaly.py</code>
        </div>
      </div>
    </div>
  )

  const { meta, timeline, nb_anomalies, pct_anomalies, nb_total, parametres, stats_2sigma } = data
  const timelineColored = timeline.map(p => ({
    ...p,
    score_normal: p.is_anomaly === 0 ? p.score : null,
    score_anomaly: p.is_anomaly === 1 ? p.score : null,
  }))

  return (
    <div style={{
      padding: "0", maxWidth: 1320, margin: "0 auto",
      fontFamily: "'Rajdhani', sans-serif", position: "relative", zIndex: 1
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 22,
        padding: "22px 24px",
        borderRadius: 18,
        background: `linear-gradient(135deg, ${C.dangerPale}, rgba(255,253,248,0.86))`,
        border: `1px solid rgba(192,57,43,0.14)`,
        boxShadow: "0 10px 34px rgba(192,57,43,0.08)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 14
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: `linear-gradient(135deg, ${C.danger}, ${C.orange})`,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 23, boxShadow: "0 8px 22px rgba(192,57,43,0.22)",
          }}>🤖</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.text, letterSpacing: 1 }}>
              Détection d'anomalies
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>
              Isolation Forest · surveillance intelligente
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 10, background: C.greenPale, color: C.greenDark,
          border: `1px solid rgba(0,132,61,0.25)`, padding: "7px 13px",
          borderRadius: 999, fontWeight: 700, letterSpacing: 1.5
        }}>
          {data.scope_machine || "994F-1"} · {nb_total} points alignés · contamination {Number(data.contamination || meta?.contamination || 0).toFixed(2)}
        </div>
      </div>

      <div style={{
        marginBottom: 18, padding: "12px 18px",
        background: C.orangePale, border: `1px solid rgba(196,118,10,0.25)`,
        borderLeft: `4px solid ${C.orange}`, fontSize: 12, color: C.textMid, lineHeight: 1.7
      }}>
        Entraînement basé sur <strong>{data.scope_machine || "994F-1"}</strong> du{" "}
        <strong>{data.training_start?.slice(0, 10)}</strong> au <strong>{data.training_end?.slice(0, 10)}</strong>,
        avec <strong>{parametres?.length || 0} paramètres</strong> et <strong>{data.n_estimators || meta?.n_estimators || 200} arbres</strong>.
        Les scores sont statistiques : ils indiquent une combinaison inhabituelle, pas une panne certaine.
      </div>

      <div className="grid-4col" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
        <KpiCard icon="📊" label="Points alignés" value={nb_total} sub="fenêtres 2 minutes" accent={C.green} />
        <KpiCard icon="🎛️" label="Paramètres utilisés" value={parametres.length} sub="variables moteur ciblées" accent={C.orange} />
        <KpiCard icon="🚨" label="Anomalies" value={nb_anomalies} sub={`${pct_anomalies}% des points`} accent={C.danger} />
        <KpiCard icon="🧠" label="Modèle" value={`${data.n_estimators || meta?.n_estimators || 200}`} sub="arbres Isolation Forest" accent={C.ok} />
      </div>

      <div style={{
        display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap",
      }}>
        {[
          { id: "timeline", label: "📈 timeline score" },
          { id: "top", label: "🚨 top anomalies" },
          { id: "stats", label: "📊 stats 2σ" },
          { id: "predict", label: "🔮 tester" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            background: activeTab === tab.id ? C.greenPale : "rgba(255,255,255,0.42)",
            border: `1px solid ${activeTab === tab.id ? "rgba(0,132,61,0.3)" : C.border}`,
            borderRadius: 999,
            color: activeTab === tab.id ? C.greenDark : C.textMuted,
            padding: "8px 18px", cursor: "pointer",
            fontFamily: "'Rajdhani', sans-serif", fontSize: 12,
            fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "timeline" && (
        <Card>
          <CardTitle accent={C.danger} right={<span style={{ fontSize: 10, fontWeight: 400, color: C.textLight }}>{data.training_start?.slice(0, 10)} → {data.training_end?.slice(0, 10)}</span>}>
            Score d'anomalie dans le temps
          </CardTitle>
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={timelineColored} margin={{ top: 8, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: C.textMuted }} interval={Math.floor(timelineColored.length / 15)} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10, fill: C.textMuted }} />
              <Tooltip content={<TimelineTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Rajdhani',sans-serif" }} />
              <ReferenceLine y={0} stroke={C.danger} strokeDasharray="4 2" strokeWidth={1.5} label={{ value: "frontière anomalie", position: "insideTopRight", fontSize: 10, fill: C.danger }} />
              <Line type="monotone" dataKey="score_normal" name="Normal" stroke={C.green} strokeWidth={1} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="score_anomaly" name="Anomalie" stroke={C.danger} strokeWidth={2} dot={{ r: 3, fill: C.danger }} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      )}

      {activeTab === "top" && (
        <Card>
          <CardTitle accent={C.danger}>
            Top anomalies interprétables
            <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 400, color: C.textLight }}>
              score bas = combinaison la plus atypique
            </span>
          </CardTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  {["#", "Horodatage", "Score", "Paramètre dominant", "Écart max σ"].concat(parametres.map(shortName)).map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: h === "#" || h === "Horodatage" || h === "Paramètre dominant" ? "left" : "right", fontSize: 9, fontWeight: 700, color: C.textMuted, letterSpacing: 1.5, textTransform: "uppercase" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enrichedTop.map((a, i) => (
                  <tr key={i} style={{
                    borderBottom: `1px solid ${C.border}`,
                    background: i % 2 === 0 ? "rgba(192,57,43,0.03)" : "transparent"
                  }}>
                    <td style={{ padding: "7px 10px", color: C.textLight }}>{i + 1}</td>
                    <td style={{ padding: "7px 10px", color: C.textMid }}>{a.t}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>
                      <span style={{ background: C.dangerPale, color: C.danger, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
                        {a.score?.toFixed(4)}
                      </span>
                    </td>
                    <td style={{ padding: "7px 10px", color: C.text }}>{a.dominant_param}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: C.orange, fontWeight: 700 }}>{a.dominant_z ? a.dominant_z.toFixed(1) : "—"}</td>
                    {parametres.map(p => {
                      const short = shortName(p)
                      const val = a[short]
                      const stat = stats_2sigma?.[p]
                      const isHigh = stat && val > stat.seuil_max
                      const isLow = stat && val < stat.seuil_min
                      return (
                        <td key={p} style={{
                          padding: "7px 10px", textAlign: "right",
                          fontWeight: (isHigh || isLow) ? 700 : 400,
                          color: isHigh ? C.danger : isLow ? C.orange : C.text,
                        }}>
                          {val ?? "—"}{isHigh && " ↑"}{isLow && " ↓"}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === "stats" && (
        <Card>
          <CardTitle accent={C.sand} right={<span style={{ fontSize: 10, fontWeight: 400, color: C.textLight }}>{data.training_start?.slice(0, 10)} → {data.training_end?.slice(0, 10)}</span>}>
            Statistiques 2σ — base du modèle
          </CardTitle>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                {["Paramètre", "Moyenne µ", "Écart-type σ", "Seuil min 2σ", "Seuil max 2σ", "Min observé", "Max observé"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: h === "Paramètre" ? "left" : "right", fontSize: 9, fontWeight: 700, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats_2sigma || {}).map(([param, s], i) => (
                <tr key={param} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? "rgba(201,168,76,0.03)" : "transparent" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600, color: C.textMid }}>{shortName(param)}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: C.green, fontWeight: 600 }}>{s.mu}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: C.sand, fontWeight: 600 }}>{s.sigma}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: C.orange, fontWeight: 600 }}>{s.seuil_min}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: C.danger, fontWeight: 600 }}>{s.seuil_max}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: C.textLight }}>{s.min_obs}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", color: C.textLight }}>{s.max_obs}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12, fontSize: 11, color: C.textLight, lineHeight: 1.6 }}>
            Cette table décrit la variabilité statistique de la base d'entraînement. Elle sert à expliquer les anomalies, pas à remplacer les seuils métier maintenance.
          </div>
        </Card>
      )}

      {activeTab === "predict" && (
        <Card>
          <CardTitle accent={C.orange} right={<span style={{ fontSize: 10, fontWeight: 400, color: C.textLight }}>{parametres.length} paramètres requis</span>}>
            Tester le modèle — saisie manuelle
          </CardTitle>
          <div style={{ marginBottom: 16, padding: "10px 14px", background: C.orangePale,
            border: `1px solid rgba(196,118,10,0.2)`, borderLeft: `4px solid ${C.orange}`, fontSize: 12, color: C.textMid }}>
            Saisis des valeurs capteurs cohérentes avec la réalité terrain. Le verdict reste une aide au tri, pas une décision maintenance automatique.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
            {PREDICT_LABELS.map((p, i) => (
              <div key={i}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
                  {p.label} <span style={{ color: C.textLight }}>({p.unite})</span>
                </div>
                <input
                  type="number"
                  value={predictVals[i]}
                  onChange={e => {
                    const copy = [...predictVals]
                    copy[i] = e.target.value
                    setPredictVals(copy)
                  }}
                  placeholder={`ex: ${[85, 450, 450, 100, 300, 1500][i]}`}
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.9)",
                    border: `1px solid ${C.border}`, color: C.text,
                    padding: "9px 12px", fontFamily: "'Rajdhani', sans-serif",
                    fontSize: 14, outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
            ))}
          </div>
          <button
            onClick={handlePredict}
            disabled={predictLoading || predictVals.some(v => v === "")}
            style={{
              background: predictLoading || predictVals.some(v => v === "") ? C.border : C.orange,
              color: "#fff", border: "none", padding: "12px 32px",
              fontFamily: "'Rajdhani', sans-serif", fontSize: 13, fontWeight: 700,
              letterSpacing: 3, cursor: predictLoading ? "wait" : "pointer",
              textTransform: "uppercase",
            }}
          >
            {predictLoading ? "⟳ Analyse..." : "▶ Analyser"}
          </button>

          {predictResult && !predictResult.error && (
            <div style={{
              marginTop: 20, padding: "20px 24px",
              background: predictResult.is_anomaly ? C.dangerPale : C.greenPale,
              border: `2px solid ${predictResult.is_anomaly ? C.danger : C.green}`,
              borderLeft: `6px solid ${predictResult.is_anomaly ? C.danger : C.green}`,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: predictResult.is_anomaly ? C.danger : C.green, marginBottom: 10 }}>
                {predictResult.verdict}
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Score</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: C.textMid }}>{predictResult.score?.toFixed(4)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>Confiance relative</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: predictResult.is_anomaly ? C.danger : C.green }}>{predictResult.confiance}%</div>
                </div>
              </div>
            </div>
          )}

          {predictResult?.error && (
            <div style={{ marginTop: 16, padding: "12px 16px", background: C.dangerPale, border: `1px solid #e8bfba`, borderLeft: `4px solid ${C.danger}`, fontSize: 13, color: C.danger }}>
              ❌ Erreur : {predictResult.error}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function SkeletonBox({ w = "100%", h = 20, mb = 8, radius = 3 }) {
  return (
    <div style={{
      width: w, height: h, marginBottom: mb,
      background: `linear-gradient(90deg, rgba(212,201,176,0.3) 25%, rgba(212,201,176,0.6) 50%, rgba(212,201,176,0.3) 75%)`,
      backgroundSize: "200% 100%",
      animation: "shimmer 1.4s infinite",
      borderRadius: radius,
    }} />
  )
}

function SkeletonLoader() {
  return (
    <div style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto", fontFamily: "'Rajdhani', sans-serif" }}>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      <SkeletonBox h={18} w={340} mb={24} />
      <SkeletonBox h={54} mb={20} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
        {[...Array(4)].map((_,i) => (
          <div key={i} style={{ background: "rgba(255,253,248,0.92)", border: "1px solid #D4C9B0", borderTop: "2px solid #C9A84C", padding: "18px 14px" }}>
            <SkeletonBox h={22} w={40} mb={10} />
            <SkeletonBox h={30} w="60%" mb={8} />
            <SkeletonBox h={12} w="80%" mb={0} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {[...Array(4)].map((_,i) => <SkeletonBox key={i} w={160} h={36} mb={0} />)}
      </div>
      <div style={{ background: "rgba(255,253,248,0.92)", border: "1px solid #D4C9B0", borderTop: "2px solid #C9A84C", padding: "20px 22px" }}>
        <SkeletonBox h={14} w={220} mb={16} />
        <SkeletonBox h={380} mb={0} />
      </div>
    </div>
  )
}
