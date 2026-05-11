
import { useMemo, useState, useEffect, useRef } from "react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, Cell
} from "recharts"
import ExportToolbar from "../components/ExportToolbar"
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
      boxShadow: "0 8px 28px rgba(0,0,0,0.05), 0 2px 10px rgba(139,105,20,0.06)",
      ...style
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

function KpiCard({ label, value, sub, accent, icon }) {
  return (
    <Card style={{ textAlign: "center", padding: "20px 16px", borderTop: `3px solid ${accent || C.green}` }}>
      <div style={{
        fontSize: 22, margin: "0 auto 10px", width: 44, height: 44,
        borderRadius: 12, background: `${accent || C.green}14`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{icon}</div>
      <div style={{
        fontSize: 32, fontWeight: 700, color: accent || C.green,
        fontFamily: "'Rajdhani', sans-serif", lineHeight: 1
      }}>
        {value ?? "—"}
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

function AlertBadge({ niveau, statut }) {
  const isCrit = niveau === "critique"
  const chronic = statut === "chronique"
  const bg = chronic ? C.dangerPale : (isCrit ? C.orangePale : C.greenPale)
  const color = chronic ? C.danger : (isCrit ? C.orange : C.greenDark)
  return (
    <span style={{
      background: bg,
      color,
      border: `1px solid ${chronic ? "#e8bfba" : "rgba(196,118,10,0.25)"}`,
      fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
      padding: "2px 8px", textTransform: "uppercase", whiteSpace: "nowrap"
    }}>
      {chronic ? "Chronique" : isCrit ? "Critique" : "Attention"}
    </span>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      padding: "10px 14px", fontSize: 12, color: C.text,
      boxShadow: "0 4px 16px rgba(0,0,0,0.1)"
    }}>
      {label && <div style={{ fontWeight: 700, marginBottom: 4, color: C.textMid }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.text }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toLocaleString("fr-FR") : p.value}</strong>
        </div>
      ))}
    </div>
  )
}

function fmt(val) {
  if (val === null || val === undefined || Number.isNaN(val)) return "—"
  return typeof val === "number" ? val.toFixed(2) : val
}

function shortLabel(str = "") {
  const last = str.includes(".") ? str.slice(str.lastIndexOf(".") + 1) : str
  return last.length > 32 ? `${last.slice(0, 32)}…` : last
}

function statusColor(status) {
  if (status === "chronique") return C.danger
  if (status === "frequente") return C.orange
  if (status === "rare") return C.sand
  return C.green
}

export default function MonitoringDashboard({ onSelectParam } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [view, setView] = useState("seuils")
  const containerRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    setError("")
    fetch(`${API_URL}/gmao/params-stats`)
      .then(res => { if (!res.ok) throw new Error(`Erreur API ${res.status}`); return res.json() })
      .then(json => setData(json))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [refresh])

  // useMemo : sans ça, le `||` recrée un tableau à chaque render et instabilise
  // les useMemo en aval (breachData, etc.).
  const thresholdSummary = useMemo(() => data?.threshold_summary || [], [data])
  const chronicThresholds = thresholdSummary.filter(item => item.statut === "chronique")
  const rareCritical = thresholdSummary.filter(item => item.niveau === "critique" && item.statut === "rare")
  const coverageData = useMemo(() => (data?.parameter_coverage || []).slice(0, 10).map(item => ({
    name: shortLabel(item.parametre),
    "Couverture %": item.coverage_pct || 0,
    rows: item.rows || 0,
  })), [data])

  const breachData = useMemo(() => thresholdSummary.slice(0, 8).map(item => ({
    name: shortLabel(item.parametre),
    "Taux de dépassement %": item.worst_breach_rate || 0,
    color: statusColor(item.statut),
  })), [thresholdSummary])

  const latestParamForLine = useMemo(() => (data?.latest_by_param || []).slice(0, 10).map(m => ({
    name: shortLabel(m.parametre),
    min: m.val_min ?? 0,
    moy: m.val_moy ?? 0,
    max: m.val_max ?? 0,
  })), [data])

  if (loading) return <SkeletonMonitoring />
  if (error) return <ErrorState message={error} onRetry={() => setRefresh(r => r + 1)} />
  if (!data) return null

  const singleMachine = Object.keys(data.by_machine || {}).length <= 1
  const machineNames = Object.keys(data.by_machine || {})
  const machineLabel = machineNames.join(", ") || "N/A"

  return (
    <div
      ref={containerRef}
      style={{
        padding: "0", maxWidth: 1320, margin: "0 auto",
        position: "relative", zIndex: 1,
        fontFamily: "'Rajdhani', sans-serif"
      }}
    >
      <ExportToolbar
        containerRef={containerRef}
        filename="monitoring_capteurs"
        title="Monitoring Capteurs 994F"
        csvData={data?.alertes || []}
        csvFilename="alertes_capteurs"
      />

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 22,
        padding: "22px 24px",
        borderRadius: 18,
        background: `linear-gradient(135deg, ${C.greenPale}, rgba(255,253,248,0.82))`,
        border: `1px solid rgba(0,132,61,0.16)`,
        boxShadow: "0 10px 34px rgba(0,132,61,0.08)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 14
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: `linear-gradient(135deg, ${C.green}, ${C.greenDark})`,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 23, boxShadow: "0 8px 22px rgba(0,132,61,0.24)",
          }}>📡</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: C.text, letterSpacing: 1 }}>
              Monitoring capteurs
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 2, textTransform: "uppercase" }}>
              CAT 994F · supervision seuils et couverture
            </div>
          </div>
        </div>
        <button
          onClick={() => setRefresh(r => r + 1)}
          style={{
            background: "none", border: `1px solid ${C.border}`, color: C.textMuted,
            padding: "6px 16px", cursor: "pointer", fontFamily: "'Rajdhani', sans-serif",
            fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
            transition: "all 0.2s"
          }}
        >
          ↻ Rafraîchir
        </button>
      </div>

      <div style={{
        marginBottom: 20, padding: "12px 18px",
        background: singleMachine ? C.orangePale : C.greenPale,
        border: `1px solid ${singleMachine ? "rgba(196,118,10,0.25)" : "rgba(0,132,61,0.2)"}`,
        borderLeft: `4px solid ${singleMachine ? C.orange : C.green}`,
        display: "flex", alignItems: "center", gap: 12,
        fontSize: 13, color: C.textMid, fontWeight: 600
      }}>
        <span style={{ fontSize: 18 }}>{singleMachine ? "ℹ️" : "✅"}</span>
        Fenêtre analysée : {data.date_range?.start} → {data.date_range?.end}
        {" · "}Machine(s) couverte(s) : <strong>{machineLabel}</strong>
        {singleMachine && <span style={{ color: C.orange }}> · comparaison multi-machine non pertinente sur cette base</span>}
      </div>

      {(chronicThresholds.length > 0 || rareCritical.length > 0) && (
        <div style={{
          marginBottom: 20, padding: "14px 18px",
          background: C.dangerPale,
          border: `1px solid #e8bfba`,
          borderLeft: `4px solid ${C.danger}`,
          fontSize: 13, color: C.textMid, lineHeight: 1.7
        }}>
          <strong style={{ color: C.danger }}>Lecture intelligente :</strong>{" "}
          {chronicThresholds.length > 0 && (
            <> {chronicThresholds.length} paramètre(s) dépassent souvent leur seuil — à afficher comme <strong>problème chronique / seuil à recalibrer</strong>, pas comme simple alerte ponctuelle. </>
          )}
          {rareCritical.length > 0 && (
            <> {rareCritical.length} paramètre(s) critiques ont un dépassement rare — à traiter comme <strong>signal prioritaire</strong>. </>
          )}
        </div>
      )}

      <div className="grid-4col" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
        <KpiCard icon="📏" label="Mesures brutes" value={data.total_mesures?.toLocaleString("fr-FR")} sub="lignes capteurs" accent={C.green} />
        <KpiCard icon="🎛️" label="Paramètres" value={data.nb_parametres} sub="variables suivies" accent={C.orange} />
        <KpiCard icon="🚨" label="Alertes directes + histo" value={data.nb_alertes} sub={`${data.nb_critiques} critique(s) · ${data.nb_attentions} attention(s)`} accent={data.nb_critiques > 0 ? C.danger : C.ok} />
        <KpiCard icon="📅" label="Dernier point" value={data.latest_timestamp ? data.latest_timestamp.slice(5, 16).replace("T", " ") : "—"} sub={machineLabel} accent={C.sand} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {[
          { id: "seuils", label: "santé des seuils" },
          { id: "couverture", label: "couverture capteurs" },
          { id: "snapshot", label: "dernier snapshot" },
        ].map(item => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            style={{
              background: view === item.id ? C.greenPale : "rgba(255,255,255,0.42)",
              color: view === item.id ? C.greenDark : C.textMuted,
              border: `1px solid ${view === item.id ? "rgba(0,132,61,0.25)" : C.border}`,
              padding: "8px 14px",
              borderRadius: 999,
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.6,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === "seuils" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Card>
              <CardTitle accent={C.danger}>Paramètres les plus à risque</CardTitle>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={breachData} margin={{ top: 6, right: 8, left: -12, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: C.textMuted }} angle={-32} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: C.textMuted }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Taux de dépassement %" radius={[2, 2, 0, 0]}>
                    {breachData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ marginTop: 8, fontSize: 11, color: C.textLight }}>
                Un taux très élevé suggère souvent un seuil global mal calibré ou dépendant du mode opératoire.
              </div>
            </Card>

            <Card>
              <CardTitle accent={C.orange}>Tableau de décision</CardTitle>
              <div style={{ overflowX: "auto", maxHeight: 285 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                      {["Paramètre", "Statut", "Niveau", "Taux pire", "Max obs.", "Min obs."].map(h => (
                        <th key={h} style={{
                          padding: "8px 10px", textAlign: "left",
                          fontSize: 10, fontWeight: 700, color: C.textMuted,
                          letterSpacing: 2, textTransform: "uppercase"
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {thresholdSummary.slice(0, 10).map((item, i) => {
                      const clickable = typeof onSelectParam === "function"
                      return (
                      <tr
                        key={`${item.parametre}-${i}`}
                        onClick={clickable ? () => onSelectParam(shortLabel(item.parametre)) : undefined}
                        title={clickable ? "Cliquer pour voir l'évolution temporelle" : undefined}
                        style={{
                          borderBottom: `1px solid ${C.border}`,
                          background: i % 2 === 0 ? "rgba(201,168,76,0.03)" : "transparent",
                          cursor: clickable ? "pointer" : "default",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          if (clickable) e.currentTarget.style.background = C.greenPale
                        }}
                        onMouseLeave={(e) => {
                          if (clickable) e.currentTarget.style.background = i % 2 === 0 ? "rgba(201,168,76,0.03)" : "transparent"
                        }}
                      >
                        <td style={{ padding: "8px 10px", color: clickable ? C.greenDark : C.textMid, fontWeight: clickable ? 600 : 500 }}>
                          {clickable && <span style={{ marginRight: 6, fontSize: 10 }}>→</span>}
                          {shortLabel(item.parametre)}
                        </td>
                        <td style={{ padding: "8px 10px" }}><AlertBadge niveau={item.niveau} statut={item.statut} /></td>
                        <td style={{ padding: "8px 10px", color: item.niveau === "critique" ? C.danger : C.orange }}>{item.niveau}</td>
                        <td style={{ padding: "8px 10px", fontWeight: 700, color: statusColor(item.statut) }}>{item.worst_breach_rate}%</td>
                        <td style={{ padding: "8px 10px", color: C.text }}>{fmt(item.max_observed)}</td>
                        <td style={{ padding: "8px 10px", color: C.text }}>{fmt(item.min_observed)}</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}

      {view === "couverture" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <Card>
            <CardTitle accent={C.sand}>Complétude des paramètres</CardTitle>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={coverageData} margin={{ top: 6, right: 8, left: -12, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: C.textMuted }} angle={-32} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10, fill: C.textMuted }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="Couverture %" fill={C.sand} radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card>
            <CardTitle accent={C.green}>Paramètres les moins couverts</CardTitle>
            <div style={{ overflowX: "auto", maxHeight: 285 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                    {["Paramètre", "Lignes", "Couverture", "Début", "Fin"].map(h => (
                      <th key={h} style={{
                        padding: "8px 10px", textAlign: "left",
                        fontSize: 10, fontWeight: 700, color: C.textMuted,
                        letterSpacing: 2, textTransform: "uppercase"
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.parameter_coverage || []).slice(0, 10).map((item, i) => (
                    <tr key={`${item.parametre}-${i}`} style={{
                      borderBottom: `1px solid ${C.border}`,
                      background: i % 2 === 0 ? "rgba(201,168,76,0.03)" : "transparent"
                    }}>
                      <td style={{ padding: "8px 10px", color: C.textMid }}>{shortLabel(item.parametre)}</td>
                      <td style={{ padding: "8px 10px", color: C.text }}>{item.rows}</td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: item.coverage_pct < 50 ? C.danger : C.greenDark }}>{item.coverage_pct}%</td>
                      <td style={{ padding: "8px 10px", color: C.textLight }}>{String(item.first_seen).slice(0, 10)}</td>
                      <td style={{ padding: "8px 10px", color: C.textLight }}>{String(item.last_seen).slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {view === "snapshot" && (
        <Card style={{ marginBottom: 16 }}>
          <CardTitle accent={C.sand}>Min / moy / max par paramètre — dernière valeur connue</CardTitle>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={latestParamForLine} margin={{ top: 4, right: 16, left: -10, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: C.textMuted }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10, fill: C.textMuted }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Rajdhani',sans-serif", paddingTop: 8 }} />
              <Line type="monotone" dataKey="min" stroke={C.greenLt} strokeWidth={1.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="moy" stroke={C.sand} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="max" stroke={C.danger} strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <CardTitle accent={C.danger}>Détail des alertes capteurs</CardTitle>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                {["Machine", "Paramètre", "Source", "Niveau", "Type", "Valeur", "Seuil", "Date"].map(h => (
                  <th key={h} style={{
                    padding: "8px 12px", textAlign: "left",
                    fontSize: 10, fontWeight: 700, color: C.textMuted,
                    letterSpacing: 2, textTransform: "uppercase"
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.alertes || []).map((a, i) => (
                <tr key={`${a.machine}-${a.parametre}-${i}`} style={{
                  borderBottom: `1px solid ${C.border}`,
                  background: i % 2 === 0 ? "rgba(201,168,76,0.03)" : "transparent"
                }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600, color: C.text }}>{a.machine}</td>
                  <td style={{ padding: "8px 12px", color: C.textMid }}>{shortLabel(a.parametre)}</td>
                  <td style={{ padding: "8px 12px", color: C.textLight }}>{a.source}</td>
                  <td style={{ padding: "8px 12px" }}><AlertBadge niveau={a.niveau} statut={a.source === "historique" ? "frequente" : "rare"} /></td>
                  <td style={{ padding: "8px 12px", color: C.textMid }}>{a.type}</td>
                  <td style={{ padding: "8px 12px", fontWeight: 700, color: a.niveau === "critique" ? C.danger : C.orange }}>{fmt(a.valeur)}</td>
                  <td style={{ padding: "8px 12px", color: C.text }}>{fmt(a.seuil)} {a.unite || ""}</td>
                  <td style={{ padding: "8px 12px", color: C.textLight }}>{String(a.horodatage).slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function SkeletonBox({ w = "100%", h = 20, mb = 8 }) {
  return (
    <div style={{
      width: w, height: h, marginBottom: mb,
      background: "rgba(212,201,176,0.4)",
      backgroundImage: "linear-gradient(90deg, rgba(212,201,176,0.3) 25%, rgba(255,253,248,0.7) 50%, rgba(212,201,176,0.3) 75%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.4s infinite",
      borderRadius: 3,
    }} />
  )
}

function SkeletonMonitoring() {
  return (
    <div style={{
      padding: "28px 32px", maxWidth: 1200, margin: "0 auto",
      fontFamily: "'Rajdhani', sans-serif",
    }}>
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <SkeletonBox h={16} w={300} mb={0} />
        <SkeletonBox h={32} w={110} mb={0} />
      </div>
      <SkeletonBox h={48} mb={20} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 }}>
        {[...Array(4)].map((_,i) => (
          <div key={i} style={{ background: "rgba(255,253,248,0.92)", border: "1px solid #D4C9B0", borderTop: "2px solid #C9A84C", padding: "18px 14px" }}>
            <SkeletonBox h={22} w={36} mb={10} />
            <SkeletonBox h={32} w="55%" mb={8} />
            <SkeletonBox h={12} w="75%" mb={0} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[...Array(2)].map((_,i) => (
          <div key={i} style={{ background: "rgba(255,253,248,0.92)", border: "1px solid #D4C9B0", borderTop: "2px solid #C9A84C", padding: "20px 22px" }}>
            <SkeletonBox h={14} w={200} mb={16} />
            <SkeletonBox h={240} mb={0} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div style={{
      padding: "28px 32px", maxWidth: 600, margin: "0 auto",
      fontFamily: "'Rajdhani', sans-serif"
    }}>
      <div style={{
        padding: "18px 22px", background: "#FDECEA",
        border: `1px solid #e8bfba`, borderLeft: `4px solid #C0392B`
      }}>
        <div style={{ fontWeight: 700, color: "#C0392B", marginBottom: 6 }}>
          ❌ Erreur de chargement
        </div>
        <div style={{ fontSize: 13, color: "#5A5240", marginBottom: 14 }}>{message}</div>
        <button onClick={onRetry} style={{
          background: "#C0392B", color: "#fff", border: "none",
          padding: "8px 20px", cursor: "pointer",
          fontFamily: "'Rajdhani', sans-serif", fontSize: 12,
          fontWeight: 700, letterSpacing: 2, textTransform: "uppercase"
        }}>
          ↻ Réessayer
        </button>
      </div>
    </div>
  )
}
