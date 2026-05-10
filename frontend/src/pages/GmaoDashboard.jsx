import { useEffect, useMemo, useState } from "react"
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { API } from "../config"

const API_URL = API
const TARGET_MACHINE = "994F-1"

const C = {
  bgCard: "rgba(255,253,248,0.94)",
  border: "#D4C9B0",
  green: "#00843D",
  greenDark: "#005C2B",
  greenPale: "#E8F5EE",
  orange: "#C4760A",
  orangePale: "#FDF3E3",
  sand: "#C9A84C",
  text: "#2A2A1E",
  textMid: "#5A5240",
  textMuted: "#8A7D60",
  textLight: "#B0A080",
  danger: "#C0392B",
  dangerPale: "#FDECEA",
}

const PRIORITY_COLOR = { P1: C.danger, P2: C.orange, P3: C.green }
const SEVERITY_COLOR = { 0: C.textLight, 1: C.green, 2: C.orange, 3: C.danger }

function fmt(n, suffix = "") {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—"
  return `${Number(n).toLocaleString("fr-FR")}${suffix}`
}

function shortCode(code = "", max = 74) {
  return code.length > max ? `${code.slice(0, max)}…` : code
}

function shortSource(source = "") {
  return source.replace("Commande de ", "Cmd ").replace("Commande d'", "Cmd ")
}

function riskColor(level = "") {
  if (level === "CRITIQUE") return C.danger
  if (level === "ÉLEVÉ") return C.orange
  return C.green
}

function Card({ children, style, accent = C.sand }) {
  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderTop: `3px solid ${accent}`,
      borderRadius: 16,
      padding: "20px 22px",
      boxShadow: "0 10px 28px rgba(42,42,30,0.06)",
      backdropFilter: "blur(10px)",
      ...style,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ children, right }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      paddingBottom: 10,
      marginBottom: 14,
      borderBottom: `1px solid ${C.border}`,
      color: C.textMuted,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: 2.6,
      textTransform: "uppercase",
    }}>
      <span style={{ width: 4, height: 14, borderRadius: 2, background: C.sand }} />
      <span>{children}</span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  )
}

function Kpi({ label, value, sub, color = C.green }) {
  return (
    <Card accent={color} style={{ minHeight: 116 }}>
      <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 2.4, textTransform: "uppercase", fontWeight: 800 }}>
        {label}
      </div>
      <div style={{
        marginTop: 10,
        fontSize: 31,
        lineHeight: 1,
        color,
        fontWeight: 900,
        fontFamily: "'Rajdhani', sans-serif",
      }}>
        {value}
      </div>
      <div style={{ marginTop: 8, color: C.textLight, fontSize: 12, lineHeight: 1.45 }}>{sub}</div>
    </Card>
  )
}

function Badge({ children, color }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "3px 8px",
      borderRadius: 999,
      background: `${color}16`,
      border: `1px solid ${color}44`,
      color,
      fontSize: 10,
      fontWeight: 900,
      letterSpacing: 0.8,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  )
}

function TooltipBox({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: "#FFFDF8",
      border: `1px solid ${C.border}`,
      padding: "10px 13px",
      boxShadow: "0 8px 20px rgba(42,42,30,0.10)",
      color: C.text,
      fontSize: 12,
      fontFamily: "'Rajdhani', sans-serif",
    }}>
      {label && <div style={{ color: C.textMuted, marginBottom: 5 }}>{label}</div>}
      {payload.map(item => (
        <div key={item.dataKey} style={{ color: item.color || C.textMid, fontWeight: 700 }}>
          {item.name || item.dataKey}: {fmt(item.value)}
        </div>
      ))}
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ padding: 28, fontFamily: "'Rajdhani', sans-serif", color: C.textMid }}>
      Chargement du diagnostic GMAO {TARGET_MACHINE}…
    </div>
  )
}

function ErrorState({ error }) {
  return (
    <div style={{ padding: 28, fontFamily: "'Rajdhani', sans-serif" }}>
      <Card accent={C.danger}>
        <SectionTitle>Erreur GMAO</SectionTitle>
        <div style={{ color: C.danger, fontWeight: 700 }}>{error}</div>
        <div style={{ color: C.textMuted, marginTop: 8, fontSize: 12 }}>
          Vérifie que le backend est lancé et que le fichier 994F1 est dans <code>backend/data/gmao/anomalies</code>.
        </div>
      </Card>
    </div>
  )
}

export default function GmaoDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const params = new URLSearchParams({ machine: TARGET_MACHINE })
    setLoading(true)
    setError("")
    fetch(`${API_URL}/gmao/stats?${params}`)
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.detail || `Erreur API ${res.status}`)
        return json
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const summary = data?.engineering_summary || {}
  const priorities = useMemo(() => data?.priority_risks || [], [data])
  const monthlyRisk = data?.monthly_risk || []
  const sourceRisk = useMemo(() => data?.source_risk || [], [data])
  const recentEvents = data?.recent_events || []
  const period = data?.date_range_by_machine?.[TARGET_MACHINE]
  const hours = data?.service_hours_by_machine?.[TARGET_MACHINE]
  const sev2 = data?.summary?.g2_total || 0
  const sev3 = data?.summary?.g3_total || 0

  const paretoData = useMemo(() => priorities.slice(0, 8).map(item => ({
    name: shortCode(item.code, 28),
    priority: item.priority,
    risque: item.risk_score,
    cumul: item.risk_pct_cum,
  })), [priorities])

  const sourceData = useMemo(() => sourceRisk.slice(0, 7).map(item => ({
    source: shortSource(item.Source),
    risque: item.risk_score,
    occurrences: item.occurrences,
  })), [sourceRisk])

  if (loading) return <Skeleton />
  if (error || !data) return <ErrorState error={error || "Données indisponibles"} />

  const levelColor = riskColor(summary.risk_level)
  const topPriority = priorities[0]

  return (
    <div style={{
      padding: "0",
      maxWidth: 1420,
      margin: "0 auto",
      fontFamily: "'Rajdhani', sans-serif",
      color: C.text,
      position: "relative",
      zIndex: 1,
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 18,
        alignItems: "center",
        marginBottom: 22,
        padding: "24px 26px",
        borderRadius: 20,
        background: `linear-gradient(135deg, ${C.greenPale}, rgba(255,253,248,0.86))`,
        border: `1px solid rgba(0,132,61,0.16)`,
        boxShadow: "0 12px 36px rgba(0,132,61,0.08)",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 22,
              background: `linear-gradient(135deg, ${C.green}, ${C.sand})`,
            }}>
              🛠
            </div>
            <div>
              <div style={{ fontSize: 27, fontWeight: 900, letterSpacing: 0.6 }}>
                GMAO décision maintenance — {TARGET_MACHINE}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: 2.4, textTransform: "uppercase", fontWeight: 800 }}>
                Priorisation ingénieur · criticité × occurrences · plan d’action
              </div>
            </div>
          </div>
          <div style={{ color: C.textMid, fontSize: 13, lineHeight: 1.55 }}>
            Objectif : ne pas seulement compter les anomalies, mais identifier les défauts qui méritent une intervention.
          </div>
        </div>
        <div style={{
          padding: "12px 18px",
          borderRadius: 999,
          background: `${levelColor}18`,
          border: `1px solid ${levelColor}55`,
          color: levelColor,
          fontWeight: 900,
          letterSpacing: 2,
          textTransform: "uppercase",
          textAlign: "center",
        }}>
          Risque {summary.risk_level || "—"}
          <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: 1, marginTop: 3 }}>
            score {fmt(summary.risk_total)}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 18 }}>
        <Kpi label="Score risque" value={fmt(summary.risk_total)} sub="gravité pondérée × occurrences" color={levelColor} />
        <Kpi label="Événements" value={fmt(data.total)} sub={`période ${period?.start || "—"} → ${period?.end || "—"}`} color={C.green} />
        <Kpi label="Occurrences" value={fmt(data.occurrences_total)} sub="répétitions cumulées des codes" color={C.sand} />
        <Kpi label="G2 + G3" value={fmt(sev2 + sev3)} sub={`${sev3} critiques G3 · ${sev2} avertissements G2`} color={sev3 ? C.danger : C.orange} />
        <Kpi label="Compteur engin" value={fmt(hours, "h")} sub="dernière valeur d’heures service" color={C.greenDark} />
      </div>

      {topPriority && (
        <Card accent={PRIORITY_COLOR[topPriority.priority]} style={{ marginBottom: 18 }}>
          <SectionTitle right={
            <Badge color={PRIORITY_COLOR[topPriority.priority]}>
              {topPriority.priority} · score {fmt(topPriority.risk_score)}
            </Badge>
          }>
            Première décision maintenance
          </SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 900, color: C.text, marginBottom: 8 }}>
                {topPriority.code}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <Badge color={SEVERITY_COLOR[topPriority.gravite]}>G{topPriority.gravite}</Badge>
                <Badge color={C.green}>{topPriority.source}</Badge>
                <Badge color={C.sand}>{fmt(topPriority.occurrences)} occurrences</Badge>
                <Badge color={C.textMuted}>{topPriority.last_date || "date inconnue"}</Badge>
              </div>
            </div>
            <div style={{
              padding: "12px 14px",
              background: PRIORITY_COLOR[topPriority.priority] === C.danger ? C.dangerPale : C.orangePale,
              borderLeft: `4px solid ${PRIORITY_COLOR[topPriority.priority]}`,
              color: C.textMid,
              fontSize: 13,
              lineHeight: 1.65,
            }}>
              <strong style={{ color: C.text }}>Action recommandée :</strong> {topPriority.recommendation}
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.95fr", gap: 18, marginBottom: 18 }}>
        <Card>
          <SectionTitle>Pareto des défauts à traiter</SectionTitle>
          <ResponsiveContainer width="100%" height={310}>
            <ComposedChart data={paretoData} margin={{ top: 10, right: 18, bottom: 48, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" angle={-28} textAnchor="end" height={72} tick={{ fill: C.textMuted, fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fill: C.textMuted, fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: C.textMuted, fontSize: 10 }} />
              <Tooltip content={<TooltipBox />} />
              <Bar yAxisId="left" dataKey="risque" name="Score risque" radius={[4, 4, 0, 0]}>
                {paretoData.map(item => <Cell key={item.name} fill={PRIORITY_COLOR[item.priority] || C.green} />)}
              </Bar>
              <Line yAxisId="right" type="monotone" dataKey="cumul" name="Cumul %" stroke={C.text} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionTitle>Tendance mensuelle du risque</SectionTitle>
          <ResponsiveContainer width="100%" height={310}>
            <AreaChart data={monthlyRisk} margin={{ top: 10, right: 18, left: 0, bottom: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="month" tick={{ fill: C.textMuted, fontSize: 10 }} />
              <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} />
              <Tooltip content={<TooltipBox />} />
              <Area type="monotone" dataKey="risk_score" name="Score risque" stroke={C.danger} fill={C.dangerPale} strokeWidth={2} />
              <Line type="monotone" dataKey="g3" name="G3" stroke={C.danger} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="g2" name="G2" stroke={C.orange} strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.2fr", gap: 18, marginBottom: 18 }}>
        <Card>
          <SectionTitle>Sources dominantes du risque</SectionTitle>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sourceData} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis type="number" tick={{ fill: C.textMuted, fontSize: 10 }} />
              <YAxis type="category" dataKey="source" width={116} tick={{ fill: C.textMid, fontSize: 10 }} />
              <Tooltip content={<TooltipBox />} />
              <Bar dataKey="risque" name="Score risque" fill={C.green} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <SectionTitle>Derniers événements critiques / récurrents</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto" }}>
            {recentEvents.map((event, i) => (
              <div key={`${event.date}-${i}`} style={{
                display: "grid",
                gridTemplateColumns: "92px 1fr auto",
                gap: 10,
                alignItems: "center",
                padding: "9px 10px",
                background: i % 2 === 0 ? "rgba(201,168,76,0.07)" : "rgba(255,255,255,0.35)",
                borderLeft: `3px solid ${SEVERITY_COLOR[event.gravite] || C.textLight}`,
              }}>
                <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 700 }}>{event.date || "—"}</div>
                <div>
                  <div style={{ fontSize: 12, color: C.text, fontWeight: 800 }}>{shortCode(event.code, 86)}</div>
                  <div style={{ fontSize: 11, color: C.textLight }}>{event.source} · {event.type} · {fmt(event.hours, "h")}</div>
                </div>
                <Badge color={SEVERITY_COLOR[event.gravite]}>G{event.gravite} · {fmt(event.occurrences)}x</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle>Plan d’action priorisé</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                {["Priorité", "Défaut", "Source", "Risque", "Occurrences", "Dernière date", "Action ingénieur"].map(head => (
                  <th key={head} style={{
                    padding: "9px 10px",
                    textAlign: head === "Défaut" || head === "Action ingénieur" ? "left" : "right",
                    color: C.textMuted,
                    fontSize: 9,
                    letterSpacing: 1.7,
                    textTransform: "uppercase",
                  }}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {priorities.slice(0, 10).map(item => (
                <tr key={`${item.code}-${item.source}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px", textAlign: "right" }}><Badge color={PRIORITY_COLOR[item.priority]}>{item.priority}</Badge></td>
                  <td style={{ padding: "10px", color: C.text, fontWeight: 800 }}>{shortCode(item.code, 72)}</td>
                  <td style={{ padding: "10px", color: C.textMid, textAlign: "right" }}>{shortSource(item.source)}</td>
                  <td style={{ padding: "10px", color: PRIORITY_COLOR[item.priority], fontWeight: 900, textAlign: "right" }}>{fmt(item.risk_score)}</td>
                  <td style={{ padding: "10px", color: C.textMid, textAlign: "right" }}>{fmt(item.occurrences)}</td>
                  <td style={{ padding: "10px", color: C.textMid, textAlign: "right" }}>{item.last_date || "—"}</td>
                  <td style={{ padding: "10px", color: C.textMid, lineHeight: 1.45 }}>{item.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
