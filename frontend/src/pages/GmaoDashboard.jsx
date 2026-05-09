
import { useEffect, useMemo, useState } from "react"
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid
} from "recharts"
import { API } from "../config"
const API_URL = API

const C = {
  bg:         "#F5F0E8",
  bgCard:     "rgba(255,253,248,0.88)",
  border:     "#D4C9B0",
  green:      "#00843D",
  greenLt:    "#00A84F",
  greenDark:  "#005C2B",
  greenPale:  "#E8F5EE",
  orange:     "#C4760A",
  orangePale: "#FDF3E3",
  sand:       "#C9A84C",
  sandPale:   "#F7F0DC",
  text:       "#2A2A1E",
  textMid:    "#5A5240",
  textMuted:  "#8A7D60",
  textLight:  "#B0A080",
  danger:     "#C0392B",
  dangerPale: "#FDECEA",
  warn:       "#C4760A",
  ok:         "#00843D",
}

const SEV_COLOR = { 1: C.ok, 2: C.warn, 3: C.danger }
const SEV_LABEL = { 1: "G1", 2: "G2", 3: "G3" }

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: "rgba(255,253,248,0.97)", border: `1px solid ${C.border}`,
      padding: "10px 16px", fontFamily: "'Rajdhani', sans-serif",
      boxShadow: "0 4px 16px rgba(139,105,20,0.12)",
    }}>
      {label && <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6, letterSpacing: 1 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color ?? C.text, fontSize: 14, fontWeight: 600 }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toLocaleString("fr-FR") : p.value}</strong>
        </div>
      ))}
    </div>
  )
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: "var(--c-bgCard, rgba(255,253,248,0.92))",
      border: `1px solid var(--c-border, ${C.border})`,
      borderTop: `3px solid ${color}`,
      borderRadius: 14,
      padding: "20px 22px", flex: 1,
      backdropFilter: "blur(10px)",
      boxShadow: "0 8px 28px rgba(0,0,0,0.05), 0 2px 10px rgba(139,105,20,0.06)",
      transition: "transform .18s ease, box-shadow .18s ease",
    }}>
      <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1, fontFamily: "'Rajdhani', sans-serif" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: C.textLight, marginTop: 6 }}>{sub}</div>
    </div>
  )
}

function Panel({ children, title, style, right }) {
  return (
    <div style={{
      background: "var(--c-bgCard, rgba(255,253,248,0.92))",
      border: `1px solid var(--c-border, ${C.border})`,
      borderRadius: 14,
      padding: "22px 24px", backdropFilter: "blur(10px)",
      boxShadow: "0 8px 28px rgba(0,0,0,0.05), 0 2px 10px rgba(139,105,20,0.06)", ...style,
    }}>
      {title && (
        <div style={{
          fontSize: 11, color: C.textMuted, letterSpacing: 3, textTransform: "uppercase",
          marginBottom: 18, paddingBottom: 12, borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 8, fontWeight: 700,
        }}>
          <div style={{ width: 3, height: 14, background: C.sand, borderRadius: 2 }} />
          <span>{title}</span>
          {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

function SkelBox({ w = "100%", h = 20, mb = 8 }) {
  return (
    <div style={{
      width: w, height: h, marginBottom: mb, borderRadius: 3,
      background: "rgba(212,201,176,0.4)",
      backgroundImage: "linear-gradient(90deg,rgba(212,201,176,0.3) 25%,rgba(255,253,248,0.7) 50%,rgba(212,201,176,0.3) 75%)",
      backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite",
    }} />
  )
}

function fmtPeriod(range) {
  if (!range?.start || !range?.end) return "période non disponible"
  return `${range.start} → ${range.end}`
}

function shortSource(source = "") {
  return source.replace("Commande de ", "Cmd ").replace("Commande d'", "Cmd ")
}

function shortCodeLabel(label = "") {
  return label.length > 68 ? `${label.slice(0, 68)}…` : label
}

function detectCoverageWarning(data) {
  if (data?.summary?.coverage_mismatch) return true
  const months = Object.values(data?.active_months_by_machine || {})
  return months.length > 1 && new Set(months).size > 1
}

function buildComparativeText(machine, item) {
  if (!item) return "Données comparatives indisponibles."
  const parts = []
  if (item.criticality_rate !== null && item.criticality_rate !== undefined) {
    parts.push(`criticité G2+G3 ${item.criticality_rate.toFixed(1)}%`)
  }
  if (item.diagnostic_share !== null && item.diagnostic_share !== undefined) {
    parts.push(`diagnostic ${item.diagnostic_share.toFixed(1)}%`)
  }
  if (item.top_month) parts.push(`pic ${item.top_month}`)
  if (item.top_source) parts.push(`source dominante ${item.top_source}`)
  if (item.top_code_occurrences) parts.push(`code récurrent ${item.top_code_occurrences}`)
  return `${machine} — ${parts.join(" · ")}`
}

export default function GmaoDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rankingMode, setRankingMode] = useState("rows")

  useEffect(() => {
    fetch(`${API_URL}/gmao/stats`)
      .then(r => { if (!r.ok) throw new Error(`Erreur API ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const rankingData = useMemo(() => {
    if (!data) return []
    if (rankingMode === "occurrences") return data.top_codes_occurrences || []
    return data.top_codes || []
  }, [data, rankingMode])

  if (loading) return (
    <div style={{ padding: "28px 36px", maxWidth: 1320, margin: "0 auto", fontFamily: "'Rajdhani', sans-serif" }}>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      {[{ w:"100%", h:54, mb:24 }].map((_,i) => <SkelBox key={i} {..._} />)}
      <div style={{ display:"flex", gap:16, marginBottom:24 }}>
        {[...Array(5)].map((_,i) => (
          <div key={i} style={{ flex:1, background:"rgba(255,253,248,0.88)", border:"1px solid #D4C9B0", borderTop:"3px solid #C9A84C", padding:"18px 22px" }}>
            <SkelBox h={12} w="60%" mb={10} /> <SkelBox h={32} w="50%" mb={6} /> <SkelBox h={12} w="75%" mb={0} />
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:20, marginBottom:20 }}>
        {[260, 210, 210].map((h,i) => (
          <div key={i} style={{ background:"rgba(255,253,248,0.88)", border:"1px solid #D4C9B0", padding:"20px 22px" }}>
            <SkelBox h={14} w={200} mb={16} /> <SkelBox h={h} mb={0} />
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        {[...Array(2)].map((_,i) => (
          <div key={i} style={{ background:"rgba(255,253,248,0.88)", border:"1px solid #D4C9B0", padding:"20px 22px" }}>
            <SkelBox h={14} w={180} mb={16} /> <SkelBox h={380} mb={0} />
          </div>
        ))}
      </div>
    </div>
  )

  if (error) return (
    <div style={{
      margin: 32, padding: 20, background: C.dangerPale,
      border: `1px solid rgba(192,57,43,0.3)`, borderLeft: `4px solid ${C.danger}`,
      color: C.danger, fontFamily: "'Rajdhani', sans-serif", fontSize: 14,
    }}>
      ❌ {error} — Vérifie que le backend est démarré et que les fichiers anomalies sont bien dans data/gmao/anomalies
    </div>
  )

  const total = data.total || 0
  const occurrencesTotal = data.occurrences_total || 0
  const sev2 = data.by_severity?.[2] || 0
  const sev3 = data.by_severity?.[3] || 0
  const g23Pct = total ? (((sev2 + sev3) / total) * 100).toFixed(1) : "0.0"
  const f1Hours = data.service_hours_by_machine?.["994F-1"]
  const f2Hours = data.service_hours_by_machine?.["994F-2"]
  const f1Count = data.by_machine?.["994F-1"] || 0
  const f2Count = data.by_machine?.["994F-2"] || 0

  const allMonths = [...new Set((data.monthly || []).map(d => d.month))].sort()
  const monthlyChartData = allMonths.map(month => ({
    month: month.slice(2).replace("-", "/"),
    "994F-1": data.monthly.find(d => d.machine === "994F-1" && d.month === month)?.count || 0,
    "994F-2": data.monthly.find(d => d.machine === "994F-2" && d.month === month)?.count || 0,
  }))

  const severityData = [
    { name: "G1 Information", value: data.by_severity?.[1] || 0, color: C.ok },
    { name: "G2 Avertissement", value: sev2, color: C.warn },
    { name: "G3 Critique", value: sev3, color: C.danger },
  ]

  const normalizedData = Object.entries(data.comparison_by_machine || {}).map(([machine, item]) => ({
    machine,
    "Événements / 100h": item.event_rate_per_100h || 0,
    "Occurrences / 100h": item.occurrence_rate_per_100h || 0,
  }))

  const sourceData = [...new Set((data.by_source || []).map(d => d.Source))].map(src => ({
    source: shortSource(src),
    "994F-1": data.by_source.find(d => d.machine === "994F-1" && d.Source === src)?.count || 0,
    "994F-2": data.by_source.find(d => d.machine === "994F-2" && d.Source === src)?.count || 0,
  }))

  const duplicateWarning = (data.duplicate_files || []).length > 0
  const coverageWarning = detectCoverageWarning(data)

  return (
    <div style={{ padding: "0", maxWidth: 1360, margin: "0 auto",
      fontFamily: "'Rajdhani', sans-serif", position: "relative", zIndex: 1 }}>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 22,
        padding: "22px 24px",
        borderRadius: 18,
        background: `linear-gradient(135deg, ${C.greenPale}, rgba(255,253,248,0.84))`,
        border: `1px solid rgba(0,132,61,0.16)`,
        boxShadow: "0 10px 34px rgba(0,132,61,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: `linear-gradient(135deg, ${C.green}, ${C.sand})`,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 23, boxShadow: "0 8px 22px rgba(0,132,61,0.22)",
          }}>📊</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.text, letterSpacing: 1 }}>
              GMAO Analytics
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>
              Analyse maintenance · criticité · tendances 994F
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 10, background: C.greenPale, color: C.greenDark,
          border: `1px solid rgba(0,132,61,0.25)`, padding: "7px 13px",
          borderRadius: 999, fontWeight: 700, letterSpacing: 1.5,
        }}>
          {total.toLocaleString("fr-FR")} événements · {occurrencesTotal.toLocaleString("fr-FR")} occurrences
        </div>
      </div>

      {(duplicateWarning || coverageWarning) && (
        <div style={{
          padding: "14px 20px", marginBottom: 18,
          background: C.orangePale, border: `1px solid rgba(196,118,10,0.3)`,
          borderLeft: `4px solid ${C.orange}`,
          display: "flex", gap: 14, alignItems: "flex-start",
          boxShadow: "0 2px 10px rgba(196,118,10,0.08)",
        }}>
          <span style={{ fontSize: 22 }}>⚠</span>
          <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.65 }}>
            {duplicateWarning && (
              <div>
                <strong style={{ color: C.orange }}>Fichiers dupliqués ignorés :</strong>{" "}
                {(data.duplicate_files || []).map(d => `${d.file} = ${d.duplicate_of}`).join(" · ")}
              </div>
            )}
            {coverageWarning && (
              <div>
                <strong style={{ color: C.orange }}>Comparaison à normaliser :</strong>{" "}
                les machines n'ont pas la même fenêtre temporelle. Affiche les tendances mensuelles ou les taux /100h avant de comparer les volumes bruts.
              </div>
            )}
          </div>
        </div>
      )}

      {data.critical_g3?.length > 0 && (
        <div style={{
          padding: "14px 20px", marginBottom: 24,
          background: C.dangerPale, border: `1px solid rgba(192,57,43,0.3)`,
          borderLeft: `4px solid ${C.danger}`,
          display: "flex", gap: 14, alignItems: "center",
          boxShadow: "0 2px 10px rgba(192,57,43,0.08)",
        }}>
          <span style={{ fontSize: 24 }}>⚠</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.danger, letterSpacing: 2, marginBottom: 4 }}>
              ALERTE CRITIQUE — INTERVENTION REQUISE
            </div>
            <div style={{ fontSize: 14, color: C.text }}>
              <strong style={{ color: C.danger }}>{data.critical_g3[0]?.code}</strong>
              {" — "}{data.critical_g3[0]?.occurrences} occurrences cumulées
            </div>
          </div>
        </div>
      )}

      <div className="grid-4col" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 24 }}>
        <KpiCard label="Événements distincts" value={total.toLocaleString("fr-FR")} sub={`994F-1: ${f1Count} · 994F-2: ${f2Count}`} color={C.green} />
        <KpiCard label="Occurrences cumulées" value={occurrencesTotal.toLocaleString("fr-FR")} sub="charge réelle de répétition" color={C.sand} />
        <KpiCard label="Criticité G2 + G3" value={g23Pct + "%"} sub={`${sev2 + sev3} événements sur ${total}`} color={C.warn} />
        <KpiCard label="Heures 994F-1" value={f1Hours ? `${Math.round(f1Hours).toLocaleString("fr-FR")}h` : "—"} sub={fmtPeriod(data.date_range_by_machine?.["994F-1"])} color={C.green} />
        <KpiCard label="Heures 994F-2" value={f2Hours ? `${Math.round(f2Hours).toLocaleString("fr-FR")}h` : "—"} sub={fmtPeriod(data.date_range_by_machine?.["994F-2"])} color={C.greenLt} />
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 20, marginBottom: 20 }}>
        <Panel title="Évolution mensuelle des anomalies">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="month" tick={{ fill: C.textMuted, fontSize: 10, fontFamily: "Rajdhani" }} />
              <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: C.textMid }} />
              <Line dataKey="994F-1" stroke={C.green} strokeWidth={2.5} dot={false} />
              <Line dataKey="994F-2" stroke={C.orange} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Répartition par gravité">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={severityData} cx="50%" cy="45%" innerRadius={45} outerRadius={72}
                dataKey="value" paddingAngle={3}>
                {severityData.map((e, i) => <Cell key={i} fill={e.color} stroke="white" strokeWidth={2} />)}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: C.textMid }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Intensité normalisée">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={normalizedData}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="machine" tick={{ fill: C.textMuted, fontSize: 10 }} />
              <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Événements / 100h" fill={C.green} radius={[3,3,0,0]} />
              <Bar dataKey="Occurrences / 100h" fill={C.orange} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ marginTop: 8, fontSize: 11, color: C.textLight, lineHeight: 1.6 }}>
            Compare les machines sur une base équitable quand les fenêtres temporelles sont différentes.
          </div>
        </Panel>
      </div>

      <div className="grid-2col" style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 20, marginBottom: 20 }}>
        <Panel title="Anomalies par source">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={sourceData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis type="number" tick={{ fill: C.textMuted, fontSize: 9 }} />
              <YAxis dataKey="source" type="category" tick={{ fill: C.textMid, fontSize: 9 }} width={95} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="994F-1" fill={C.green} radius={[0,3,3,0]} />
              <Bar dataKey="994F-2" fill={C.orange} radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Lecture comparative">
          <div style={{
            padding: "14px 16px", marginBottom: 12,
            background: C.greenPale, border: `1px solid rgba(0,132,61,0.2)`,
            borderLeft: `3px solid ${C.green}`,
          }}>
            <div style={{ fontSize: 11, color: C.greenDark, fontWeight: 700, letterSpacing: 2, marginBottom: 6 }}>
              994F-1
            </div>
            <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7 }}>
              {buildComparativeText("994F-1", data.comparison_by_machine?.["994F-1"])}
            </div>
          </div>

          <div style={{
            padding: "14px 16px", marginBottom: 12,
            background: C.orangePale, border: `1px solid rgba(196,118,10,0.25)`,
            borderLeft: `3px solid ${C.orange}`,
          }}>
            <div style={{ fontSize: 11, color: C.orange, fontWeight: 700, letterSpacing: 2, marginBottom: 6 }}>
              994F-2
            </div>
            <div style={{ fontSize: 13, color: C.textMid, lineHeight: 1.7 }}>
              {buildComparativeText("994F-2", data.comparison_by_machine?.["994F-2"])}
            </div>
          </div>

          <div style={{
            padding: "12px 14px",
            background: C.sandPale, border: `1px solid rgba(201,168,76,0.35)`,
            fontSize: 12, color: C.textMid, lineHeight: 1.7,
          }}>
            <strong style={{ color: C.text }}>Conseil de lecture :</strong> affiche toujours à la fois le volume brut,
            les occurrences cumulées et le taux /100h. Sur ta base actuelle, le volume seul peut tromper.
          </div>
        </Panel>
      </div>

      <Panel
        title="Top codes d'anomalie"
        right={
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { id: "rows", label: "événements" },
              { id: "occurrences", label: "occurrences" },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setRankingMode(item.id)}
                style={{
                  background: rankingMode === item.id ? C.greenPale : "transparent",
                  color: rankingMode === item.id ? C.greenDark : C.textMuted,
                  border: `1px solid ${rankingMode === item.id ? "rgba(0,132,61,0.25)" : C.border}`,
                  padding: "4px 10px",
                  fontFamily: "'Rajdhani', sans-serif",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 430, overflowY: "auto" }}>
          {rankingData.map((c, i) => {
            const value = rankingMode === "occurrences" ? c.occurrences : c.count
            return (
              <div key={`${c["Code d'anomalie"]}-${i}`} style={{
                display: "grid", gridTemplateColumns: "1fr auto auto",
                alignItems: "center", gap: 12, padding: "9px 12px",
                background: i % 2 === 0 ? "rgba(201,168,76,0.06)" : "transparent",
                borderLeft: `2px solid ${SEV_COLOR[c.Gravité]}`,
              }}>
                <span style={{ fontSize: 13, color: C.text, lineHeight: 1.3 }}>{shortCodeLabel(c["Code d'anomalie"])}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: SEV_COLOR[c.Gravité], fontFamily: "monospace" }}>
                  {Number(value || 0).toLocaleString("fr-FR")}
                </span>
                <span style={{
                  fontSize: 10, padding: "2px 8px", fontWeight: 700,
                  background: `${SEV_COLOR[c.Gravité]}18`,
                  color: SEV_COLOR[c.Gravité],
                  border: `1px solid ${SEV_COLOR[c.Gravité]}44`,
                  fontFamily: "monospace",
                }}>
                  {SEV_LABEL[c.Gravité]}
                </span>
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}
