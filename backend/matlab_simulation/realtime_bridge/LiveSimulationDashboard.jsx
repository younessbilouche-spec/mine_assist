// ─────────────────────────────────────────────────────────────────────────
// LiveSimulationDashboard.jsx
// Page React MineAssist — Flux live de la simulation MATLAB → /sim/state
// À placer dans  frontend/src/pages/LiveSimulationDashboard.jsx
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, ReferenceLine
} from "recharts"
import ExportToolbar from "../components/ExportToolbar"

const API_URL = "http://127.0.0.1:8000"
const POLL_MS = 1000          // 1 Hz
const HISTORY_MAX = 240       // 4 min de courbe affichée

// ── Palette OCP (alignée sur MonitoringDashboard) ──────────────────────────
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

// ── Capteurs principaux (KPI cards + courbe) ───────────────────────────────
// Doit correspondre EXACTEMENT à capteur_thresholds.py
const KPI_PARAMS = [
  { key:"CH994.P1.Pression pompe hydraulique principale",  short:"P. pompe hydr.",   unit:"kPa",      icon:"🛢️",  fmt:0 },
  { key:"CH994.P1.Température liquide refroidissement",    short:"T° liquide refr.", unit:"°C",       icon:"🌡️",  fmt:1 },
  { key:"CH994.P2.Régime moteur",                          short:"Régime moteur",    unit:"Tr/min",   icon:"⚙️",   fmt:0 },
  { key:"CH994.P1.Pression huile moteur",                  short:"P. huile moteur",  unit:"kPa",      icon:"🛢️",  fmt:0 },
  { key:"CH994.P2.Pression d'air au réservoir",            short:"P. air réservoir", unit:"kPa",      icon:"💨",  fmt:0 },
  { key:"CH994.P1.Température huile freinage",             short:"T° huile frein.",  unit:"°C",       icon:"🌡️",  fmt:1 },
  { key:"CH994.P1.Température huile direction",            short:"T° huile dir.",    unit:"°C",       icon:"🌡️",  fmt:1 },
  { key:"CH994.P1.Température huile hydraulique",          short:"T° huile hydr.",   unit:"°C",       icon:"🌡️",  fmt:1 },
]

// Seuils inline (utilisés uniquement pour la coloration des cartes ;
// la vraie détection reste côté backend dans alert_detector.py)
const SEUILS_INLINE = {
  "CH994.P1.Pression pompe hydraulique principale":   { min:15000, max:25000 },
  "CH994.P1.Température liquide refroidissement":     { max:107 },
  "CH994.P1.Pression huile moteur":                   { min:275 },
  "CH994.P2.Pression d'air au réservoir":             { min:600, max:900 },
  "CH994.P2.Régime moteur":                           { max:1750 },
  "CH994.P1.Température huile freinage":              { max:70 },
  "CH994.P1.Température huile direction":             { max:70 },
  "CH994.P1.Température huile hydraulique":           { max:93 },
}

function levelOf(name, val) {
  const s = SEUILS_INLINE[name]
  if (!s || val == null || Number.isNaN(val)) return "ok"
  if (s.max != null && val > s.max) return "alerte"
  if (s.max != null && val > 0.9 * s.max) return "attention"
  if (s.min != null && val < s.min) return "alerte"
  if (s.min != null && val < 1.1 * s.min) return "attention"
  return "ok"
}

function levelColor(level) {
  if (level === "alerte")    return { fg:C.danger,    bg:C.dangerPale,  bd:"#e8bfba"            }
  if (level === "attention") return { fg:C.orange,    bg:C.orangePale,  bd:"rgba(196,118,10,.3)" }
  return                            { fg:C.greenDark, bg:C.greenPale,   bd:"rgba(0,132,61,.25)"  }
}

function fmt(val, dec=1) {
  if (val == null || Number.isNaN(val)) return "—"
  return Number(val).toLocaleString("fr-FR", { minimumFractionDigits:dec, maximumFractionDigits:dec })
}

function shortName(s) {
  if (!s) return ""
  return s.includes(".") ? s.slice(s.lastIndexOf(".") + 1) : s
}

// ── Sous-composants UI (mêmes que MonitoringDashboard) ─────────────────────
function Card({ children, style }) {
  return (
    <div style={{
      background: C.bgCard, border:`1px solid ${C.border}`, borderTop:`2px solid ${C.sand}`,
      padding:"20px 22px", backdropFilter:"blur(8px)",
      boxShadow:"0 2px 10px rgba(139,105,20,0.07)", ...style
    }}>{children}</div>
  )
}

function CardTitle({ children, accent, right }) {
  return (
    <div style={{
      fontSize:10, fontWeight:700, color:C.textMuted, letterSpacing:3,
      textTransform:"uppercase", marginBottom:14, paddingBottom:10,
      borderBottom:`1px solid ${C.border}`,
      display:"flex", alignItems:"center", gap:7,
    }}>
      <div style={{ width:3, height:11, background:accent || C.sand }} />
      <span>{children}</span>
      {right && <div style={{ marginLeft:"auto" }}>{right}</div>}
    </div>
  )
}

function LiveDot({ on=true }) {
  return (
    <span style={{
      display:"inline-block", width:8, height:8, borderRadius:"50%",
      background: on ? "#00d873" : "#aaa",
      boxShadow: on ? "0 0 8px rgba(0,216,115,0.7)" : "none",
      animation: on ? "pulse 1.4s ease-in-out infinite" : "none",
    }} />
  )
}

function KpiCardLive({ param, value }) {
  const lvl = levelOf(param.key, value)
  const col = levelColor(lvl)
  return (
    <div style={{
      background:col.bg, border:`1px solid ${col.bd}`, borderTop:`2px solid ${col.fg}`,
      padding:"16px 12px", textAlign:"center",
      transition:"background .25s,border-color .25s",
    }}>
      <div style={{ fontSize:18, marginBottom:4 }}>{param.icon}</div>
      <div style={{
        fontSize:28, fontWeight:700, color:col.fg,
        fontFamily:"'Rajdhani', sans-serif", lineHeight:1.05
      }}>
        {fmt(value, param.fmt)}
        <span style={{ fontSize:13, marginLeft:5, color:C.textMuted, fontWeight:600 }}>
          {param.unit}
        </span>
      </div>
      <div style={{
        fontSize:9, fontWeight:700, letterSpacing:2, textTransform:"uppercase",
        color:C.textMuted, marginTop:6
      }}>
        {param.short}
      </div>
      {lvl !== "ok" && (
        <div style={{
          marginTop:6, fontSize:9, fontWeight:700, letterSpacing:1.5,
          textTransform:"uppercase", color:col.fg
        }}>
          {lvl === "alerte" ? "● ALERTE" : "● Attention"}
        </div>
      )}
    </div>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: C.bgCard, border:`1px solid ${C.border}`,
      padding:"10px 14px", fontSize:12, color:C.text,
      boxShadow:"0 4px 16px rgba(0,0,0,0.1)"
    }}>
      {label != null && <div style={{ fontWeight:700, marginBottom:4, color:C.textMid }}>t = {label}s</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color:p.color || C.text }}>
          {p.name} : <strong>{fmt(p.value, 1)}</strong>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────────────
export default function LiveSimulationDashboard() {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [running, setRunning] = useState(true)
  const [history, setHistory] = useState([])    // séries pour la courbe
  const tickRef = useRef(0)
  const lastTsRef = useRef(null)

  // Polling boucle
  useEffect(() => {
    let abort = false
    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/sim/state?n=2`, { cache:"no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const js = await res.json()
        if (abort) return
        setError(null)
        setState(js)
        // Empile la dernière mesure dans l'historique de la courbe
        const last = js?.recent?.[js.recent.length - 1]
        if (last && last.horodatage !== lastTsRef.current) {
          lastTsRef.current = last.horodatage
          tickRef.current += 1
          setHistory(prev => {
            const point = { t: tickRef.current }
            for (const m of last.mesures || []) {
              point[m.parametre] = m.valeur
            }
            const next = [...prev, point]
            return next.length > HISTORY_MAX ? next.slice(-HISTORY_MAX) : next
          })
        }
      } catch (e) {
        if (!abort) setError(e.message || "fetch failed")
      }
    }
    poll()
    if (!running) return () => { abort = true }
    const id = setInterval(poll, POLL_MS)
    return () => { abort = true; clearInterval(id) }
  }, [running])

  // Dernière snapshot et alertes
  const last = state?.recent?.[state.recent.length - 1]
  const alertes = state?.alertes_recentes || []
  const buf = state?.buffer_size ?? 0

  // Map paramètre → valeur courante
  const valuesByParam = useMemo(() => {
    const m = new Map()
    for (const meas of last?.mesures || []) m.set(meas.parametre, meas.valeur)
    return m
  }, [last])

  // Données pour le graphique (3 capteurs phares)
  const chartParams = [
    { key:"CH994.P1.Température liquide refroidissement", color:C.danger, name:"T° eau (°C)", axis:"left" },
    { key:"CH994.P1.Pression pompe hydraulique principale", color:C.green, name:"P. pompe (×10² kPa)", axis:"right", scale: v => v / 100 },
    { key:"CH994.P2.Régime moteur",                       color:C.orange, name:"Régime (×10² rpm)", axis:"right", scale: v => v / 100 },
  ]

  const chartData = useMemo(() => {
    return history.map(p => {
      const o = { t:p.t }
      for (const cp of chartParams) {
        const v = p[cp.key]
        o[cp.name] = v == null ? null : (cp.scale ? cp.scale(v) : v)
      }
      return o
    })
  }, [history])

  const exportRows = useMemo(() => {
    return alertes.slice(-200).map(a => ({
      horodatage: a.horodatage,
      capteur:    a.parametre || a.label,
      niveau:     a.niveau,
      valeur:     a.valeur,
      unite:      a.unite,
      seuil:      a.seuil,
      motif:      a.motif,
    }))
  }, [alertes])

  const isLive = running && !error
  const defaut = last?.defaut_actif || "—"
  const phase  = last?.cycle_phase  || "—"
  const engin  = last?.engin        || "—"

  return (
    <div style={{ padding: 24, color: C.text, fontFamily:"'Rajdhani', sans-serif" }}>
      <style>{`
        @keyframes pulse { 0%{opacity:1} 50%{opacity:.45} 100%{opacity:1} }
      `}</style>

      {/* HEADER */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        marginBottom:14, gap:12, flexWrap:"wrap"
      }}>
        <div>
          <div style={{ fontSize:11, color:C.textMuted, letterSpacing:3, textTransform:"uppercase" }}>
            Simulation MATLAB → MineAssist
          </div>
          <div style={{ fontSize:24, fontWeight:700, color:C.greenDark, letterSpacing:1 }}>
            Flux capteurs en temps réel · {engin}
          </div>
        </div>
        <div style={{ display:"flex", gap:14, alignItems:"center" }}>
          <div style={{
            display:"flex", alignItems:"center", gap:7, fontSize:11,
            fontWeight:700, letterSpacing:1.5, textTransform:"uppercase",
            color: isLive ? C.greenDark : C.danger,
            background: isLive ? C.greenPale : C.dangerPale,
            border: `1px solid ${isLive ? "rgba(0,132,61,.25)" : "#e8bfba"}`,
            padding:"6px 12px",
          }}>
            <LiveDot on={isLive} />
            {isLive ? "Live · 1 Hz" : (error ? "Hors ligne" : "Pause")}
          </div>
          <button onClick={() => setRunning(r => !r)} style={{
            background:"none", border:`1px solid ${C.border}`, color:C.textMid,
            padding:"6px 14px", fontFamily:"'Rajdhani',sans-serif", fontSize:11,
            fontWeight:700, letterSpacing:1.5, textTransform:"uppercase",
            cursor:"pointer",
          }}>
            {running ? "⏸ Pause" : "▶ Reprendre"}
          </button>
          <ExportToolbar
            data={exportRows}
            filename={`mineassist_live_alertes_${engin}`}
            title={`Alertes simulation ${engin}`}
            disabled={exportRows.length === 0}
          />
        </div>
      </div>

      {/* BANDEAU INFO */}
      <div style={{
        marginBottom:18, padding:"12px 18px",
        background:"rgba(0,132,61,0.05)",
        border:`1px solid ${C.border}`, borderLeft:`4px solid ${C.green}`,
        display:"flex", flexWrap:"wrap", gap:24, alignItems:"center",
        fontSize:13, color:C.textMid, fontWeight:600,
      }}>
        <span>📡 <strong>{buf}</strong> mesures bufferisées</span>
        <span>🛞 phase cycle : <strong style={{ color:C.greenDark }}>{phase}</strong></span>
        <span>⚠ défaut injecté :{" "}
          <strong style={{ color: defaut === "—" ? C.greenDark : C.danger }}>{defaut}</strong>
        </span>
        <span>🕒 dernier point : <strong>{last?.horodatage?.slice(11,19) || "—"}</strong></span>
        {error && (
          <span style={{ color:C.danger }}>
            ⚠ {error} — vérifier que <code>uvicorn</code> tourne et que <code>sim_router</code> est inclus.
          </span>
        )}
      </div>

      {/* KPI CARDS */}
      <div style={{
        display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:20
      }} className="grid-4col">
        {KPI_PARAMS.map(p => (
          <KpiCardLive key={p.key} param={p} value={valuesByParam.get(p.key)} />
        ))}
      </div>

      {/* COURBES TEMPS RÉEL */}
      <Card style={{ marginBottom:20 }}>
        <CardTitle accent={C.green}
          right={
            <span style={{
              fontSize:10, color:C.textMuted, fontWeight:600, letterSpacing:1,
            }}>
              {history.length} points · fenêtre glissante {HISTORY_MAX}s
            </span>
          }>
          Évolution temps réel
        </CardTitle>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top:8, right:14, left:-6, bottom:6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="t" tick={{ fontSize:10, fill:C.textMuted }}
              label={{ value:"tick (s)", position:"insideBottomRight", offset:-2, fontSize:10, fill:C.textMuted }} />
            <YAxis yAxisId="left" tick={{ fontSize:10, fill:C.textMuted }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize:10, fill:C.textMuted }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize:11 }} />
            {/* Seuil critique T° eau */}
            <ReferenceLine yAxisId="left" y={107} stroke={C.danger}
              strokeDasharray="4 4" label={{ value:"Seuil T° 107°C", fontSize:10, fill:C.danger, position:"insideTopRight" }} />
            {chartParams.map(cp => (
              <Line key={cp.key} yAxisId={cp.axis} type="monotone" dataKey={cp.name}
                stroke={cp.color} dot={false} strokeWidth={2} isAnimationActive={false}
                connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ALERTES RÉCENTES */}
      <Card>
        <CardTitle accent={C.danger}
          right={
            <span style={{ fontSize:10, color:C.textMuted, fontWeight:600 }}>
              {alertes.length} alertes en mémoire
            </span>
          }>
          Alertes déclenchées par le backend
        </CardTitle>
        {alertes.length === 0 ? (
          <div style={{ fontSize:13, color:C.textMuted, padding:"14px 0" }}>
            Aucune alerte pour l'instant.
          </div>
        ) : (
          <div style={{ maxHeight:280, overflowY:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:`2px solid ${C.border}` }}>
                  <th style={th}>Heure</th>
                  <th style={th}>Capteur</th>
                  <th style={{ ...th, textAlign:"right" }}>Valeur</th>
                  <th style={{ ...th, textAlign:"right" }}>Seuil</th>
                  <th style={th}>Niveau</th>
                </tr>
              </thead>
              <tbody>
                {alertes.slice().reverse().slice(0, 60).map((a, i) => {
                  const isCrit = (a.niveau || "").toLowerCase().startsWith("alerte")
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}` }}>
                      <td style={td}>{(a.horodatage || "").slice(11,19)}</td>
                      <td style={td}>{shortName(a.parametre || a.label)}</td>
                      <td style={{ ...td, textAlign:"right", fontWeight:700, color:isCrit ? C.danger : C.orange }}>
                        {fmt(a.valeur, 1)} {a.unite}
                      </td>
                      <td style={{ ...td, textAlign:"right", color:C.textMuted }}>
                        {a.seuil != null ? fmt(a.seuil, 0) : "—"} {a.unite}
                      </td>
                      <td style={td}>
                        <span style={{
                          background: isCrit ? C.dangerPale : C.orangePale,
                          color:      isCrit ? C.danger     : C.orange,
                          border:`1px solid ${isCrit ? "#e8bfba" : "rgba(196,118,10,.3)"}`,
                          fontSize:9, fontWeight:700, letterSpacing:1.5, padding:"2px 8px",
                          textTransform:"uppercase", whiteSpace:"nowrap",
                        }}>
                          {isCrit ? "● ALERTE" : "● Attention"}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

const th = {
  textAlign:"left", padding:"8px 10px", fontSize:10, fontWeight:700,
  letterSpacing:2, textTransform:"uppercase", color:C.textMuted,
}
const td = {
  padding:"8px 10px", color:C.textMid, verticalAlign:"middle",
}
