// ─────────────────────────────────────────────────────────────────────────
// LiveSimulationDashboard.jsx
// Page React MineAssist — Flux live de la simulation MATLAB → /sim/state
// À placer dans  frontend/src/pages/LiveSimulationDashboard.jsx
//
// v2 (mai 2026) — aligné sur les 13 seuils OCP officiels (seuils_ocp.py)
//   • Logique conditionnelle rpm + hyd_load (plus de fausses alertes idle)
//   • Bandeau cycle moteur (approche / levage / creusage / pleine charge / vidage / retour)
//   • Panneau "Alertes OCP en cours" enrichi (ID OCP, badge, dédup capteur)
//   • KPI étendus (T° échap, T° essieux arr.)
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, ReferenceLine
} from "recharts"
import ExportToolbar from "../components/ExportToolbar"

import { API } from "../config"
const API_URL = API
const POLL_MS = 10000         // 0.1 Hz (1 requête toutes les 10s)
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
// Étendu pour couvrir les 13 seuils OCP affichables sur cartes
const KPI_PARAMS = [
  { key:"CH994.P2.Régime moteur",                          short:"Régime moteur",     unit:"Tr/min",   icon:"⚙️",  fmt:0, ocp:"#18" },
  { key:"CH994.P1.Régime moteur",                          short:"Régime moteur",     unit:"Tr/min",   icon:"⚙️",  fmt:0, ocp:"#18" },
  { key:"CH994.P1.Pression pompe hydraulique principale",  short:"P. pompe hydr.",    unit:"kPa",      icon:"🛢️", fmt:0, ocp:"#6"  },
  { key:"CH994.P2.Pression pompe hydraulique principale",  short:"P. pompe hydr.",    unit:"kPa",      icon:"🛢️", fmt:0, ocp:"#6"  },
  { key:"CH994.P1.Pression huile moteur",                  short:"P. huile moteur",   unit:"kPa",      icon:"🛢️", fmt:0, ocp:"#3"  },
  { key:"CH994.P2.Pression d'air au réservoir",            short:"P. air réservoir",  unit:"kPa",      icon:"💨",  fmt:0, ocp:"#4/5" },
  { key:"CH994.P2.Pression d\u2019air au réservoir",        short:"P. air réservoir",  unit:"kPa",      icon:"💨",  fmt:0, ocp:"#4/5" },
  { key:"CH994.P2.Pression embrayage impeller",            short:"P. embr. impeller", unit:"kPa",      icon:"🛢️", fmt:0, ocp:"#14" },
  { key:"CH994.P1.Température liquide refroidissement",    short:"T° liquide refr.",  unit:"°C",       icon:"🌡️", fmt:1, ocp:"L"   },
  { key:"CH994.P1.Température échappement Droit",          short:"T° échap. droit",   unit:"°C",       icon:"🔥",  fmt:0, ocp:"#1"  },
  { key:"CH994.P1.Température échappement gauche",         short:"T° échap. gauche",  unit:"°C",       icon:"🔥",  fmt:0, ocp:"#2"  },
  { key:"CH994.P1.Température sortie convertisseur",       short:"T° huile conv.",    unit:"°C",       icon:"🌡️", fmt:1, ocp:"#8/17" },
  { key:"CH994.P1.Température huile direction",            short:"T° huile dir.",     unit:"°C",       icon:"🌡️", fmt:1, ocp:"#9"  },
  { key:"CH994.P1.Température huile freinage",             short:"T° huile frein.",   unit:"°C",       icon:"🌡️", fmt:1, ocp:"#10" },
  { key:"CH994.P2.Température essieux arrière",            short:"T° essieux arr.",   unit:"°C",       icon:"🌡️", fmt:1, ocp:"#7"  },
]

// ── Logique seuils OCP (mirror du backend seuils_ocp.py) ───────────────────
// Renvoie "ok" | "attention" | "alerte" selon les 13 règles OCP officielles.

function _normalize(name) {
  if (!name) return ""
  let s = String(name)
  s = s.replace(/^CH994\.P[12]\./, "")
  s = s.replace(/\u2019/g, "'")        // apostrophe courbe → droite
  return s.toLowerCase().trim()
}

// Map normalisé → fonction (val, ctx) → "ok"|"attention"|"alerte"
// ctx = { rpm, hydLoad, cyclePhase }
function levelMax(val, lim) {
  if (val == null || Number.isNaN(val)) return "ok"
  if (val > lim) return "alerte"
  if (val > 0.95 * lim) return "attention"
  return "ok"
}
function levelMin(val, lim) {
  if (val == null || Number.isNaN(val)) return "ok"
  if (val < lim) return "alerte"
  if (val < 1.05 * lim) return "attention"
  return "ok"
}
function levelRange(val, lo, hi) {
  if (val == null || Number.isNaN(val)) return "ok"
  if (val < lo || val > hi) return "alerte"
  // pas d'attention sur range (déjà serré)
  return "ok"
}

const OCP_RULES = {
  // OCP#1
  "température échappement droit":     v => levelMax(v, 600),
  // OCP#2
  "température échappement gauche":    v => levelMax(v, 600),
  // OCP#3 — conditionnel rpm
  "pression huile moteur": (v, ctx) => {
    const rpm = ctx?.rpm
    if (rpm == null) return "ok"
    if (rpm >= 720 && rpm <= 780)   return levelMin(v, 140)
    if (rpm >= 1650 && rpm <= 1750) return levelMin(v, 275)
    return "ok"
  },
  // OCP#4 + #5 — air pressure
  "pression d'air au réservoir": v => {
    const lvl1 = levelRange(v, 600, 900)   // OCP#4
    const lvl2 = levelMin(v, 600)          // OCP#5
    if (lvl1 === "alerte" || lvl2 === "alerte") return "alerte"
    if (lvl1 === "attention" || lvl2 === "attention") return "attention"
    return "ok"
  },
  // OCP#6 — conditionnel rpm + hyd_load
  "pression pompe hydraulique principale": (v, ctx) => {
    if (ctx?.rpm == null) return "ok"
    if (ctx.rpm > 1500 && (ctx.hydLoad ?? 0) > 0.3) {
      return levelMin(v, 15000)
    }
    return "ok"
  },
  // OCP#7
  "température essieux arrière": v => levelMax(v, 129),
  // OCP#8 + #17 (proxy convertisseur)
  "température sortie convertisseur": v => {
    const a = levelMax(v, 129)   // OCP#8
    const b = levelMax(v, 93)    // OCP#17 (proxy hydraulique)
    return a === "alerte" ? "alerte" : (b === "alerte" ? "alerte" : (a !== "ok" || b !== "ok" ? "attention" : "ok"))
  },
  // OCP#9
  "température huile direction":  v => levelMax(v, 70),
  // OCP#10
  "température huile freinage":   v => levelMax(v, 70),
  // OCP#14 — conditionnel rpm
  "pression embrayage impeller": (v, ctx) => {
    if (ctx?.rpm == null || ctx.rpm < 1510) return "ok"
    return levelRange(v, 1860, 1870)
  },
  // OCP#17 (alias direct si jamais le capteur "T° huile hydraulique" existe)
  "température huile hydraulique": v => levelMax(v, 93),
  // OCP#18
  "régime moteur": v => levelMax(v, 1750),
  // Legacy non-OCP : T° liquide refroidissement (max 107°C)
  "température liquide refroidissement": v => levelMax(v, 107),
}

// Estime hyd_load (0..1) à partir du contexte (cycle_phase puis P_pompe)
function estimateHydLoad(cyclePhase, pPompe) {
  if (cyclePhase) {
    const ph = cyclePhase.toLowerCase()
    if (ph.includes("creusage") || ph.includes("levage") || ph.includes("pleine charge") || ph.includes("charge"))
      return 0.6
  }
  if (pPompe != null && !Number.isNaN(pPompe)) {
    const v = (pPompe - 30) / 26000
    return Math.max(0, Math.min(1, v))
  }
  return 0.0
}

function levelOf(name, val, ctx) {
  const norm = _normalize(name)
  const fn = OCP_RULES[norm]
  if (!fn) return "ok"
  return fn(val, ctx)
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

// Extrait l'ID OCP (#1, #2, ...) du motif backend si présent
function extractOcpId(motif) {
  if (!motif) return null
  const m = String(motif).match(/OCP#(\d+)/)
  return m ? `#${m[1]}` : null
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

// ── Bandeau cycle moteur ───────────────────────────────────────────────────
const PHASES = [
  { key:"approche",      label:"Approche",      icon:"🚛" },
  { key:"levage",        label:"Levage",        icon:"⬆️" },
  { key:"creusage",      label:"Creusage",      icon:"⛏" },
  { key:"pleine charge", label:"Pleine charge", icon:"💪" },
  { key:"vidage",        label:"Vidage",        icon:"⬇️" },
  { key:"retour",        label:"Retour",        icon:"↩️" },
]

function CyclePhaseBar({ phase }) {
  const active = (phase || "").toLowerCase()
  return (
    <div style={{
      display:"flex", gap:6, marginBottom:18, flexWrap:"wrap",
      background:"rgba(255,253,248,0.6)", padding:8,
      border:`1px solid ${C.border}`,
    }}>
      {PHASES.map(p => {
        const isActive = active === p.key
        return (
          <div key={p.key} style={{
            flex:"1 1 130px", display:"flex", alignItems:"center", gap:8,
            padding:"8px 12px",
            background: isActive ? C.greenPale : "transparent",
            border:`1px solid ${isActive ? "rgba(0,132,61,.4)" : "transparent"}`,
            color: isActive ? C.greenDark : C.textMuted,
            fontWeight: isActive ? 700 : 500,
            transition:"all .25s",
          }}>
            <span style={{ fontSize:16 }}>{p.icon}</span>
            <span style={{ fontSize:11, letterSpacing:1.5, textTransform:"uppercase" }}>
              {p.label}
            </span>
            {isActive && <LiveDot on />}
          </div>
        )
      })}
    </div>
  )
}

function KpiCardLive({ param, value, ctx, onClick }) {
  const lvl = levelOf(param.key, value, ctx)
  const col = levelColor(lvl)
  const clickable = typeof onClick === "function"
  return (
    <div
      onClick={clickable ? onClick : undefined}
      title={clickable ? "Cliquer pour voir l'évolution temporelle" : undefined}
      style={{
        background:col.bg, border:`1px solid ${col.bd}`, borderTop:`2px solid ${col.fg}`,
        padding:"16px 12px", textAlign:"center", position:"relative",
        transition:"background .25s,border-color .25s,transform .15s,box-shadow .15s",
        cursor: clickable ? "pointer" : "default",
      }}
      onMouseEnter={(e) => {
        if (clickable) {
          e.currentTarget.style.transform = "translateY(-2px)"
          e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.08)"
        }
      }}
      onMouseLeave={(e) => {
        if (clickable) {
          e.currentTarget.style.transform = "translateY(0)"
          e.currentTarget.style.boxShadow = "none"
        }
      }}
    >
      {param.ocp && param.ocp !== "L" && (
        <div style={{
          position:"absolute", top:6, right:8, fontSize:9, fontWeight:700,
          letterSpacing:1, color:C.textMuted, opacity:0.7,
        }}>
          OCP{param.ocp}
        </div>
      )}
      <div style={{ fontSize:18, marginBottom:4 }}>{param.icon}</div>
      <div style={{
        fontSize:26, fontWeight:700, color:col.fg,
        fontFamily:"'Rajdhani', sans-serif", lineHeight:1.05
      }}>
        {fmt(value, param.fmt)}
        <span style={{ fontSize:12, marginLeft:5, color:C.textMuted, fontWeight:600 }}>
          {param.unit}
        </span>
      </div>
      <div style={{
        fontSize:9, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase",
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
// Map d'un nom de capteur "CH994.P1.Régime moteur" -> "Régime moteur"
// (compatible avec les clés de PARAMETRES dans EvolutionChart.jsx)
function toEvolutionKey(paramKey) {
  if (!paramKey) return null
  const last = paramKey.includes(".") ? paramKey.slice(paramKey.lastIndexOf(".") + 1) : paramKey
  // Normaliser les apostrophes typographiques (’) en simple quote (')
  return last.replace(/\u2019/g, "'")
}

export default function LiveSimulationDashboard({ onSelectParam } = {}) {
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

  // Map paramètre → valeur courante (les KPI peuvent avoir des doublons P1/P2)
  const valuesByParam = useMemo(() => {
    const m = new Map()
    for (const meas of last?.mesures || []) m.set(meas.parametre, meas.valeur)
    return m
  }, [last])

  // Contexte rpm + hyd_load pour les règles conditionnelles OCP
  const ctx = useMemo(() => {
    const rpm = valuesByParam.get("CH994.P2.Régime moteur")
              ?? valuesByParam.get("CH994.P1.Régime moteur")
              ?? null
    const pPompe = valuesByParam.get("CH994.P2.Pression pompe hydraulique principale")
                ?? valuesByParam.get("CH994.P1.Pression pompe hydraulique principale")
                ?? null
    return {
      rpm,
      hydLoad: estimateHydLoad(last?.cycle_phase, pPompe),
      cyclePhase: last?.cycle_phase || "",
    }
  }, [valuesByParam, last])

  // KPI : on déduplique P1/P2 pour ne pas afficher deux cartes pour le même capteur.
  // Pour chaque label "short" unique, on prend la PREMIÈRE entrée qui a une valeur non-null.
  const uniqueKpi = useMemo(() => {
    const byShort = new Map()
    for (const p of KPI_PARAMS) {
      const v = valuesByParam.get(p.key)
      if (v == null) continue
      if (!byShort.has(p.short)) {
        byShort.set(p.short, { ...p, _value: v })
      }
    }
    return [...byShort.values()].slice(0, 12)
  }, [valuesByParam])

  // Données pour le graphique (3 capteurs phares)
  const chartParams = [
    { key:"CH994.P1.Température liquide refroidissement", color:C.danger, name:"T° eau (°C)", axis:"left" },
    { key:"CH994.P1.Pression pompe hydraulique principale", color:C.green, name:"P. pompe (×10² kPa)", axis:"right", scale: v => v / 100 },
    { key:"CH994.P2.Pression pompe hydraulique principale", color:C.green, name:"P. pompe (×10² kPa)", axis:"right", scale: v => v / 100 },
    { key:"CH994.P2.Régime moteur",                       color:C.orange, name:"Régime (×10² rpm)", axis:"right", scale: v => v / 100 },
    { key:"CH994.P1.Régime moteur",                       color:C.orange, name:"Régime (×10² rpm)", axis:"right", scale: v => v / 100 },
  ]

  const chartData = useMemo(() => {
    return history.map(p => {
      const o = { t:p.t }
      // Pour chaque "name", on utilise le premier key non-null (P1 ou P2)
      const seen = new Set()
      for (const cp of chartParams) {
        if (seen.has(cp.name)) continue
        const v = p[cp.key]
        if (v != null) {
          seen.add(cp.name)
          o[cp.name] = cp.scale ? cp.scale(v) : v
        } else {
          // Place null si non encore vu
          if (!(cp.name in o)) o[cp.name] = null
        }
      }
      return o
    })
  }, [history])

  // Lignes uniques pour la légende (dédup name)
  const chartLineDefs = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const cp of chartParams) {
      if (seen.has(cp.name)) continue
      seen.add(cp.name)
      out.push(cp)
    }
    return out
  }, [])

  // Alertes : dédoublonne par label en gardant la plus récente
  const alertesUniq = useMemo(() => {
    const m = new Map()
    for (const a of alertes) {
      const k = a.label || a.parametre || ""
      const prev = m.get(k)
      if (!prev || (a.horodatage || "") > (prev.horodatage || "")) m.set(k, a)
    }
    return [...m.values()]
      .sort((a, b) => {
        const sev = (lvl) => (lvl || "").toLowerCase().startsWith("alerte") ? 0 : 1
        const sd = sev(a.niveau) - sev(b.niveau)
        if (sd !== 0) return sd
        return (b.horodatage || "").localeCompare(a.horodatage || "")
      })
  }, [alertes])

  const exportRows = useMemo(() => {
    return alertes.slice(-200).map(a => ({
      horodatage: a.horodatage,
      capteur:    a.parametre || a.label,
      ocp_id:     extractOcpId(a.motif) || "",
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

  // Compteurs alertes par niveau
  const nCrit = alertesUniq.filter(a => (a.niveau || "").toLowerCase().startsWith("alerte")).length
  const nAtt  = alertesUniq.filter(a => (a.niveau || "").toLowerCase().startsWith("attention")).length

  return (
    <div style={{ padding: 24, paddingTop: 20, color: C.text, fontFamily:"'Rajdhani', sans-serif" }}>
      <style>{`
        @keyframes pulse { 0%{opacity:1} 50%{opacity:.45} 100%{opacity:1} }
      `}</style>

      {/* HEADER */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        marginBottom:14, gap:10, flexWrap:"wrap", position:"relative", zIndex: 1,
      }}>
        <div>
          <div style={{ fontSize:11, color:C.textMuted, letterSpacing:3, textTransform:"uppercase" }}>
            Simulation MATLAB → MineAssist · 13 seuils OCP officiels
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
        marginBottom:14, padding:"12px 18px",
        background:"rgba(0,132,61,0.05)",
        border:`1px solid ${C.border}`, borderLeft:`4px solid ${C.green}`,
        display:"flex", flexWrap:"wrap", gap:24, alignItems:"center",
        fontSize:13, color:C.textMid, fontWeight:600,
      }}>
        <span>📡 <strong>{buf}</strong> mesures bufferisées</span>
        <span>🛞 phase cycle : <strong style={{ color:C.greenDark }}>{phase}</strong></span>
        <span>⚙️ régime : <strong>{ctx.rpm != null ? fmt(ctx.rpm, 0) : "—"}</strong> tr/min</span>
        <span>💪 charge hyd. : <strong>{(ctx.hydLoad * 100).toFixed(0)}%</strong></span>
        <span>⚠ défaut injecté :{" "}
          <strong style={{ color: defaut === "—" || defaut === null ? C.greenDark : C.danger }}>
            {defaut || "aucun"}
          </strong>
        </span>
        <span>🕒 {last?.horodatage?.slice(11,19) || "—"}</span>
        {(nCrit > 0 || nAtt > 0) && (
          <span style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            {nCrit > 0 && (
              <span style={{
                background:C.dangerPale, color:C.danger, border:"1px solid #e8bfba",
                padding:"3px 10px", fontSize:11, fontWeight:700, letterSpacing:1.5,
                textTransform:"uppercase",
              }}>
                ● {nCrit} ALERTE{nCrit > 1 ? "S" : ""}
              </span>
            )}
            {nAtt > 0 && (
              <span style={{
                background:C.orangePale, color:C.orange, border:"1px solid rgba(196,118,10,.3)",
                padding:"3px 10px", fontSize:11, fontWeight:700, letterSpacing:1.5,
                textTransform:"uppercase",
              }}>
                ● {nAtt} attention{nAtt > 1 ? "s" : ""}
              </span>
            )}
          </span>
        )}
        {error && (
          <span style={{ color:C.danger, width:"100%" }}>
            ⚠ {error} — vérifier que <code>uvicorn</code> tourne et que <code>sim_router</code> est inclus.
          </span>
        )}
      </div>

      {/* CYCLE MOTEUR */}
      <CyclePhaseBar phase={phase} />

      {/* KPI CARDS — grille fluide */}
      <div style={{
        display:"grid",
        gridTemplateColumns:"repeat(auto-fill, minmax(170px, 1fr))",
        gap:12, marginBottom:20
      }}>
        {uniqueKpi.map(p => (
          <KpiCardLive
            key={p.key}
            param={p}
            value={p._value}
            ctx={ctx}
            onClick={
              typeof onSelectParam === "function"
                ? () => onSelectParam(toEvolutionKey(p.key))
                : undefined
            }
          />
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
            {/* Seuil rpm OCP#18 (×10²) */}
            <ReferenceLine yAxisId="right" y={17.5} stroke={C.orange}
              strokeDasharray="4 4" label={{ value:"Seuil rpm 1750 (OCP#18)", fontSize:10, fill:C.orange, position:"insideTopLeft" }} />
            {chartLineDefs.map(cp => (
              <Line key={cp.name} yAxisId={cp.axis} type="monotone" dataKey={cp.name}
                stroke={cp.color} dot={false} strokeWidth={2} isAnimationActive={false}
                connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* ALERTES OCP EN COURS — résumé par capteur */}
      <Card style={{ marginBottom:20 }}>
        <CardTitle accent={C.danger}
          right={
            <span style={{ fontSize:10, color:C.textMuted, fontWeight:600 }}>
              {alertesUniq.length} capteur{alertesUniq.length > 1 ? "s" : ""} · {alertes.length} évènements bruts
            </span>
          }>
          Alertes OCP en cours · vue par capteur
        </CardTitle>
        {alertesUniq.length === 0 ? (
          <div style={{ fontSize:13, color:C.greenDark, padding:"14px 0", fontWeight:600 }}>
            ✓ Aucune alerte OCP active. Les 13 seuils officiels sont surveillés.
          </div>
        ) : (
          <div style={{
            display:"grid",
            gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))",
            gap:10,
          }}>
            {alertesUniq.map((a, i) => {
              const isCrit = (a.niveau || "").toLowerCase().startsWith("alerte")
              const col = isCrit ? { fg:C.danger, bg:C.dangerPale, bd:"#e8bfba" } : { fg:C.orange, bg:C.orangePale, bd:"rgba(196,118,10,.3)" }
              const ocpId = extractOcpId(a.motif)
              return (
                <div key={i} style={{
                  background:col.bg, border:`1px solid ${col.bd}`, borderLeft:`4px solid ${col.fg}`,
                  padding:"10px 14px",
                }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    {ocpId && (
                      <span style={{
                        background:col.fg, color:"#fff", fontSize:9, fontWeight:700,
                        letterSpacing:1, padding:"2px 7px",
                      }}>
                        OCP {ocpId}
                      </span>
                    )}
                    <span style={{
                      fontSize:9, fontWeight:700, letterSpacing:1.5, color:col.fg,
                      textTransform:"uppercase",
                    }}>
                      ● {isCrit ? "ALERTE" : "Attention"}
                    </span>
                    <span style={{ marginLeft:"auto", fontSize:10, color:C.textMuted }}>
                      {(a.horodatage || "").slice(11,19)}
                    </span>
                  </div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:3 }}>
                    {shortName(a.parametre || a.label)}
                  </div>
                  <div style={{ fontSize:14, fontWeight:700, color:col.fg }}>
                    {fmt(a.valeur, 1)} {a.unite}
                    {a.seuil != null && (
                      <span style={{ fontSize:11, color:C.textMuted, fontWeight:600, marginLeft:8 }}>
                        / seuil {fmt(a.seuil, 0)} {a.unite}
                      </span>
                    )}
                  </div>
                  {a.motif && (
                    <div style={{ fontSize:10, color:C.textMid, marginTop:5, lineHeight:1.4 }}>
                      {a.motif}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* HISTORIQUE BRUT */}
      <Card>
        <CardTitle accent={C.sand}
          right={
            <span style={{ fontSize:10, color:C.textMuted, fontWeight:600 }}>
              {alertes.length} évènements en mémoire
            </span>
          }>
          Historique brut des évènements
        </CardTitle>
        {alertes.length === 0 ? (
          <div style={{ fontSize:13, color:C.textMuted, padding:"14px 0" }}>
            Aucun évènement pour l'instant.
          </div>
        ) : (
          <div style={{ maxHeight:280, overflowY:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:`2px solid ${C.border}` }}>
                  <th style={th}>Heure</th>
                  <th style={th}>OCP</th>
                  <th style={th}>Capteur</th>
                  <th style={{ ...th, textAlign:"right" }}>Valeur</th>
                  <th style={{ ...th, textAlign:"right" }}>Seuil</th>
                  <th style={th}>Niveau</th>
                </tr>
              </thead>
              <tbody>
                {alertes.slice().reverse().slice(0, 80).map((a, i) => {
                  const isCrit = (a.niveau || "").toLowerCase().startsWith("alerte")
                  const ocpId = extractOcpId(a.motif)
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${C.border}` }}>
                      <td style={td}>{(a.horodatage || "").slice(11,19)}</td>
                      <td style={{ ...td, color:C.textMuted, fontWeight:700, fontSize:11 }}>
                        {ocpId || "—"}
                      </td>
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
