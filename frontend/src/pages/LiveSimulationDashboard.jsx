/**
 * LiveSimulationDashboard.jsx — v3 (mai 2026)
 * MineAssist · OCP Benguerir · CAT 994F1 — Console de supervision live
 *
 * REFONTE COMPLÈTE :
 *   ✓ Polling adaptatif (1.5s en mode actif, 6s en arrière-plan)
 *   ✓ Console de pilotage (start/stop/export/reset buffer)
 *   ✓ Visualiseur cycle moteur (timeline horizontale)
 *   ✓ Heatmap des sous-systèmes (vue d'ensemble immédiate)
 *   ✓ Notifications email/WhatsApp avec statut live + test
 *   ✓ Alertes filtrables, triables, recherchables
 *   ✓ Export CSV des historiques
 *   ✓ Graphiques superposés multi-capteurs avec drilldown au clic
 *   ✓ KPI temps réel : latence, débit, taux d'alertes/min
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart, Area,
} from "recharts"
import { API } from "../config"
import { evalStatusOCP, getDisplayLimits, norm as normOCP } from "../utils/seuilsOCP"

const API_URL = API
const HISTORY_MAX = 300
const POLL_FAST = 1500
const POLL_SLOW = 6000

// ════════════════════════════════════════════════════════════════════════════
// PALETTE OCP
// ════════════════════════════════════════════════════════════════════════════
const C = {
  bg:         "#F5F0E8",
  bgGradient: "linear-gradient(135deg, #F5F0E8 0%, #EFE7D5 100%)",
  card:       "rgba(255,253,248,0.96)",
  cardElev:   "#FFFFFF",
  green:      "#00843D",
  greenLt:    "#00A84F",
  greenDark:  "#005C2B",
  greenPale:  "#E8F5EE",
  sand:       "#C9A84C",
  sandPale:   "#F7F0DC",
  red:        "#DC2626",
  redLt:      "#EF4444",
  redPale:    "#FEE2E2",
  orange:     "#F59E0B",
  orangeLt:   "#FBBF24",
  orangePale: "#FEF3C7",
  text:       "#1C1A14",
  textMid:    "#4A4535",
  textMuted:  "#8A7D60",
  textLight:  "#B0A080",
  border:     "#D4C9B0",
  borderLt:   "#E8E2D4",
  shadow:     "0 1px 2px rgba(28,26,20,0.04), 0 4px 12px rgba(28,26,20,0.06)",
}

// ════════════════════════════════════════════════════════════════════════════
// MAPPING CAPTEURS
// ════════════════════════════════════════════════════════════════════════════
const SENSORS = [
  { key: "Régime moteur",                      sub: "moteur",       unit: "tr/min", icon: "⚙", min: 600,  max: 2100, color: "#3B82F6" },
  { key: "Pression huile moteur",              sub: "moteur",       unit: "kPa",    icon: "🛢", min: 280,  max: 550,  color: "#3B82F6" },
  { key: "Température liquide refroidissement",sub: "moteur",       unit: "°C",     icon: "🌡", min: 70,   max: 100,  color: "#3B82F6" },
  { key: "Température échappement Droit",      sub: "moteur",       unit: "°C",     icon: "🔥", min: 200,  max: 650,  color: "#3B82F6" },
  { key: "Température échappement gauche",     sub: "moteur",       unit: "°C",     icon: "🔥", min: 200,  max: 650,  color: "#3B82F6" },
  { key: "Température sortie convertisseur",   sub: "transmission", unit: "°C",     icon: "🌡", min: 60,   max: 129,  color: "#8B5CF6" },
  { key: "Pression embrayage impeller",        sub: "transmission", unit: "kPa",    icon: "🛢", min: 1500, max: 3500, color: "#8B5CF6" },
  { key: "Pression pompe hydraulique principale", sub: "hydraulique", unit: "kPa",  icon: "🛢", min: 2500, max: 25000, color: "#06B6D4" },
  { key: "Température huile direction",        sub: "hydraulique",  unit: "°C",     icon: "🌡", min: 35,   max: 95,   color: "#06B6D4" },
  { key: "Température huile freinage",         sub: "freinage",     unit: "°C",     icon: "🌡", min: 40,   max: 110,  color: "#F59E0B" },
  { key: "Température essieux arrière",        sub: "essieux",      unit: "°C",     icon: "🌡", min: 38,   max: 90,   color: "#10B981" },
  { key: "Pression d'air au réservoir",        sub: "pneumatique",  unit: "kPa",    icon: "💨", min: 420,  max: 850,  color: "#EC4899" },
  { key: "Pression d\u2019air au réservoir",   sub: "pneumatique",  unit: "kPa",    icon: "💨", min: 420,  max: 850,  color: "#EC4899" },
]

const SUBSYSTEMS = [
  { key: "moteur",       label: "Moteur",       icon: "⚙",  color: "#3B82F6" },
  { key: "transmission", label: "Transmission", icon: "⚡", color: "#8B5CF6" },
  { key: "hydraulique",  label: "Hydraulique",  icon: "💧", color: "#06B6D4" },
  { key: "freinage",     label: "Freinage",     icon: "🔴", color: "#F59E0B" },
  { key: "essieux",      label: "Essieux",      icon: "🔧", color: "#10B981" },
  { key: "pneumatique",  label: "Pneumatique",  icon: "💨", color: "#EC4899" },
]

const CYCLE_PHASES = [
  { key: "approche",     label: "Approche",     color: "#94A3B8" },
  { key: "creusage",     label: "Creusage",     color: "#F59E0B" },
  { key: "levage",       label: "Levage",       color: "#3B82F6" },
  { key: "pleine_charge",label: "Pleine charge",color: "#DC2626" },
  { key: "vidage",       label: "Vidage",       color: "#10B981" },
  { key: "retour",       label: "Retour",       color: "#94A3B8" },
]

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════
const norm = (s) => String(s||"").replace(/^CH994\.P[12]\./, "").replace(/\u2019/g, "'").trim()

const sensorMeta = (paramName) => {
  const n = norm(paramName).toLowerCase()
  return SENSORS.find(s => n === s.key.toLowerCase() || n.includes(s.key.toLowerCase().slice(0,15))) || null
}

const fmt = (v, dec = 1) => {
  if (v == null || isNaN(v)) return "—"
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

const fmtAge = (iso) => {
  if (!iso) return "—"
  const d = new Date(iso)
  const sec = Math.round((Date.now() - d.getTime()) / 1000)
  if (sec < 5) return "à l'instant"
  if (sec < 60) return `il y a ${sec}s`
  if (sec < 3600) return `il y a ${Math.round(sec/60)}min`
  return d.toLocaleString('fr-FR')
}

const computeStatus = (value, sensor, ctx = {}) => {
  // v3.1 : utilise les VRAIS seuils OCP via seuilsOCP.js
  // ctx contient { rpm, hyd_load } pour les règles conditionnelles
  if (!sensor || value == null) return "ok"
  const fullParam = sensor._param || sensor.key
  const ocpStatus = evalStatusOCP(fullParam, value, ctx)
  if (ocpStatus !== "ok") return ocpStatus
  // Fallback sur les bornes hardcodées si pas de règle OCP applicable
  const range = sensor.max - sensor.min
  const margin = range * 0.1
  if (value > sensor.max || value < sensor.min) return "alerte"
  if (value > sensor.max - margin || value < sensor.min + margin) return "attention"
  return "ok"
}

const statusColor = (s) => s === "alerte" ? C.red : s === "attention" ? C.orange : C.green

// ════════════════════════════════════════════════════════════════════════════
// COMPOSANTS UI
// ════════════════════════════════════════════════════════════════════════════
function StatusDot({ status, size = 8 }) {
  const color = status === "alerte" ? C.red : status === "attention" ? C.orange : status === "off" ? C.textLight : C.green
  return (
    <span style={{
      display: "inline-block", width: size, height: size, borderRadius: "50%",
      background: color, boxShadow: status !== "off" ? `0 0 ${size}px ${color}` : "none",
      animation: status === "alerte" || status === "attention" ? "dot-pulse 1.5s ease infinite" : "none",
    }}/>
  )
}

function Pill({ children, color = C.textMuted, bg = "transparent", style = {} }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
      color, background: bg, borderRadius: 4, textTransform: "uppercase",
      ...style,
    }}>{children}</span>
  )
}

function SensorCard({ sensor, value, history, onClick, isSelected, ctx = {} }) {
  const status = computeStatus(value, sensor, ctx)
  const color = statusColor(status)
  const data = (history || []).slice(-30).map((v, i) => ({ i, v }))
  // v3.1 : limites d'affichage adaptatives selon le contexte (rpm/hyd_load)
  const lim = getDisplayLimits(sensor._param || sensor.key, ctx)
  const dispMin = lim.min ?? sensor.min
  const dispMax = lim.max ?? sensor.max
  const pct = value != null ? ((value - dispMin) / (dispMax - dispMin)) * 100 : 0

  return (
    <div onClick={onClick} style={{
      background: C.card, border: `1px solid ${isSelected ? color : C.border}`,
      borderRadius: 12, padding: "12px 14px", cursor: "pointer",
      transition: "all 0.2s",
      boxShadow: isSelected ? `0 0 0 2px ${color}30, ${C.shadow}` : C.shadow,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color,
      }}/>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
            <span style={{ fontSize: 12 }}>{sensor.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2,
              color: C.textMuted, textTransform: "uppercase" }}>{sensor.sub}</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.text,
            fontFamily: "Rajdhani, system-ui", lineHeight: 1.2 }}>{sensor.key}</div>
        </div>
        <StatusDot status={status} size={7}/>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color,
          fontFamily: "Rajdhani, system-ui", letterSpacing: -0.5 }}>
          {value != null ? fmt(value, sensor.unit === "tr/min" || sensor.unit === "kPa" ? 0 : 1) : "—"}
        </span>
        <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>{sensor.unit}</span>
      </div>

      {data.length > 1 && (
        <div style={{ height: 22, marginTop: 4, marginBottom: 4 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`g-${sensor.key.replace(/\W/g,'')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3}/>
                  <stop offset="100%" stopColor={color} stopOpacity={0.02}/>
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
                fill={`url(#g-${sensor.key.replace(/\W/g,'')})`} dot={false} isAnimationActive={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ position: "relative", height: 3, background: C.borderLt, borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: color, transition: "width 0.5s ease",
        }}/>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between",
        fontSize: 8, color: C.textLight, marginTop: 2, letterSpacing: 0.5 }}>
        <span>{Math.round(dispMin)}</span>
        <span>{Math.round(dispMax)}</span>
      </div>
    </div>
  )
}

function CycleVisualizer({ phase }) {
  const idx = CYCLE_PHASES.findIndex(p => p.key === phase)
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
        color: C.textMuted, textTransform: "uppercase", marginBottom: 12 }}>
        Cycle moteur · phase actuelle
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {CYCLE_PHASES.map((p, i) => {
          const isActive = idx === i
          const isPast = idx > i
          return (
            <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 10px", borderRadius: 99,
                background: isActive ? p.color : (isPast ? `${p.color}40` : "transparent"),
                border: `1px solid ${isActive ? p.color : C.borderLt}`,
                color: isActive ? "#FFF" : (isPast ? p.color : C.textMuted),
                fontSize: 10, fontWeight: 700, letterSpacing: 0.8, transition: "all 0.3s",
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: isActive ? "#FFF" : p.color,
                  animation: isActive ? "dot-pulse 1.4s ease infinite" : "none",
                }}/>
                {p.label}
              </div>
              {i < CYCLE_PHASES.length - 1 && (
                <div style={{ width: 10, height: 1, background: isPast ? p.color : C.borderLt }}/>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SubsystemHeatmap({ valuesByParam, ctx = {} }) {
  const subsysStatus = useMemo(() => {
    const out = {}
    for (const sub of SUBSYSTEMS) out[sub.key] = { ok: 0, attention: 0, alerte: 0 }
    for (const [param, val] of valuesByParam.entries()) {
      const s = sensorMeta(param)
      if (!s) continue
      // v3.1 : on enrichit le sensor avec son nom complet pour le mapping OCP
      const enriched = { ...s, _param: param }
      const st = computeStatus(val, enriched, ctx)
      out[s.sub][st]++
    }
    return out
  }, [valuesByParam, ctx.rpm, ctx.hyd_load])

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
        color: C.textMuted, textTransform: "uppercase", marginBottom: 12 }}>
        Vue d'ensemble · sous-systèmes
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
        {SUBSYSTEMS.map(sub => {
          const s = subsysStatus[sub.key]
          const total = s.ok + s.attention + s.alerte
          const status = s.alerte > 0 ? "alerte" : s.attention > 0 ? "attention" : total > 0 ? "ok" : "off"
          const bg = status === "alerte" ? C.redPale :
                     status === "attention" ? C.orangePale :
                     status === "ok" ? C.greenPale : "#F3F4F6"
          const col = status === "alerte" ? C.red :
                      status === "attention" ? C.orange :
                      status === "ok" ? C.green : C.textLight

          return (
            <div key={sub.key} style={{
              background: bg, border: `1px solid ${col}30`,
              borderRadius: 10, padding: "10px 8px",
              textAlign: "center", position: "relative", transition: "all 0.3s",
            }}>
              {status === "alerte" && (
                <div style={{
                  position: "absolute", top: 4, right: 4,
                  width: 6, height: 6, borderRadius: "50%",
                  background: C.red, boxShadow: `0 0 8px ${C.red}`,
                  animation: "dot-pulse 1s ease infinite",
                }}/>
              )}
              <div style={{ fontSize: 18, marginBottom: 2 }}>{sub.icon}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: col,
                letterSpacing: 0.8, textTransform: "uppercase" }}>
                {sub.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: col,
                fontFamily: "Rajdhani, system-ui", marginTop: 4 }}>
                {total > 0 ? `${s.ok + s.attention}/${total}` : "—"}
              </div>
              <div style={{ fontSize: 8, color: C.textMuted, marginTop: 2 }}>capteurs</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ChartTooltip({ active, payload, label, suffix = "" }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: "#FFF", border: `1px solid ${C.border}`,
      borderRadius: 6, padding: "6px 10px", fontSize: 10, boxShadow: C.shadow }}>
      <div style={{ color: C.textMuted, marginBottom: 3, fontSize: 9 }}>t={label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 700 }}>
          {p.name}: {fmt(p.value)}{suffix}
        </div>
      ))}
    </div>
  )
}

function NotificationsPanel({ status, onTest, testing, testResult }) {
  if (!status) return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: C.textMuted }}>Chargement...</div>
    </div>
  )
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
          color: C.textMuted, textTransform: "uppercase" }}>
          Notifications
        </div>
        <button onClick={onTest} disabled={testing} style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 1,
          padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.border}`,
          background: testing ? C.borderLt : C.greenPale,
          color: testing ? C.textMuted : C.greenDark,
          cursor: testing ? "not-allowed" : "pointer", textTransform: "uppercase",
        }}>
          {testing ? "Envoi..." : "Test"}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "5px 0", borderBottom: `1px solid ${C.borderLt}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot status={status.email_active ? "ok" : "off"} size={6}/>
            <span style={{ color: C.text, fontWeight: 600 }}>📧 Email</span>
          </div>
          <span style={{ fontSize: 10, color: C.textMuted, fontFamily: "Rajdhani, system-ui", fontWeight: 600 }}>
            {status.brevo_configured ? "Brevo HTTP" : status.smtp_host || "—"}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "5px 0", borderBottom: `1px solid ${C.borderLt}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot status={status.whatsapp_active ? "ok" : "off"} size={6}/>
            <span style={{ color: C.text, fontWeight: 600 }}>💬 WhatsApp</span>
          </div>
          <span style={{ fontSize: 10, color: C.textMuted }}>
            {status.whatsapp_active ? "Twilio" : "Inactif"}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", marginTop: 4 }}>
          <span style={{ color: C.textMuted, fontSize: 10 }}>Envoyées :</span>
          <span style={{ color: C.green, fontWeight: 800, fontFamily: "Rajdhani, system-ui" }}>
            {status.stats?.envoyees || 0}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: C.textMuted, fontSize: 10 }}>Anti-spam :</span>
          <span style={{ color: C.text, fontSize: 10, fontWeight: 600 }}>
            {Math.round((status.cooldown_seconds || 600) / 60)} min
          </span>
        </div>
      </div>

      {testResult && (
        <div style={{
          marginTop: 8, padding: "6px 10px", fontSize: 10, borderRadius: 6,
          background: testResult.success ? C.greenPale : C.redPale,
          color: testResult.success ? C.greenDark : C.red,
          border: `1px solid ${testResult.success ? C.green : C.red}30`,
        }}>
          {testResult.success ? "✓" : "⚠"} {testResult.message}
        </div>
      )}
    </div>
  )
}

const TH = (extra = {}) => ({
  padding: "8px 12px", fontSize: 9, fontWeight: 700, letterSpacing: 1,
  color: C.textMuted, textTransform: "uppercase", textAlign: "center",
  borderBottom: `1px solid ${C.border}`, ...extra,
})
const TD = (extra = {}) => ({ padding: "8px 12px", textAlign: "center", ...extra })

function AlertesTable({ alertes }) {
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    return alertes
      .filter(a => filter === "all" || a.niveau === filter)
      .filter(a => !search || JSON.stringify(a).toLowerCase().includes(search.toLowerCase()))
      .reverse()
      .slice(0, 50)
  }, [alertes, filter, search])

  const counts = useMemo(() => ({
    all: alertes.length,
    ALERTE: alertes.filter(a => a.niveau === "ALERTE").length,
    ATTENTION: alertes.filter(a => a.niveau === "ATTENTION").length,
  }), [alertes])

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.borderLt}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
          color: C.textMuted, textTransform: "uppercase" }}>
          Journal d'alertes · {filtered.length}/{alertes.length}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {["all", "ALERTE", "ATTENTION"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.8,
              padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer",
              background: filter === f ?
                (f === "ALERTE" ? C.red : f === "ATTENTION" ? C.orange : C.greenDark) :
                C.borderLt,
              color: filter === f ? "#FFF" : C.textMuted, textTransform: "uppercase",
            }}>
              {f === "all" ? "Tout" : f === "ALERTE" ? "Critique" : "Attention"} ({counts[f] || 0})
            </button>
          ))}
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Filtrer..."
            style={{ fontSize: 10, padding: "4px 8px", borderRadius: 4,
              border: `1px solid ${C.border}`, outline: "none",
              fontFamily: "system-ui", width: 100 }}/>
        </div>
      </div>
      <div style={{ maxHeight: 300, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: C.textMuted, fontSize: 11 }}>
            {alertes.length === 0 ? "✓ Aucune alerte — système nominal" : "Aucune alerte ne correspond au filtre"}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: C.sandPale, position: "sticky", top: 0 }}>
                <th style={TH({ width: 80 })}>Heure</th>
                <th style={TH({ width: 90 })}>Niveau</th>
                <th style={TH({ textAlign: "left" })}>Capteur</th>
                <th style={TH({ width: 80, textAlign: "right" })}>Valeur</th>
                <th style={TH({ width: 80, textAlign: "right" })}>Seuil</th>
                <th style={TH({ width: 60 })}>OCP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a, i) => {
                const isAlert = a.niveau === "ALERTE"
                const time = new Date(a.horodatage || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                return (
                  <tr key={i} style={{
                    borderBottom: `1px solid ${C.borderLt}`,
                    background: isAlert ? `${C.redPale}50` : "transparent",
                  }}>
                    <td style={TD({ fontFamily: "Rajdhani, system-ui", fontWeight: 600, color: C.textMid })}>
                      {time}
                    </td>
                    <td style={TD()}>
                      <Pill color={isAlert ? "#FFF" : C.orange}
                            bg={isAlert ? C.red : C.orangePale}>
                        {a.niveau || "—"}
                      </Pill>
                    </td>
                    <td style={TD({ textAlign: "left" })}>
                      <div style={{ fontWeight: 600, color: C.text, fontSize: 11 }}>
                        {norm(a.capteur || a.parametre || "—")}
                      </div>
                      {a.message && (
                        <div style={{ fontSize: 9, color: C.textMuted, marginTop: 1 }}>
                          {String(a.message).slice(0, 60)}
                        </div>
                      )}
                    </td>
                    <td style={TD({ textAlign: "right",
                      fontFamily: "Rajdhani, system-ui", fontWeight: 700,
                      color: isAlert ? C.red : C.orange, fontSize: 13 })}>
                      {fmt(a.valeur)}
                    </td>
                    <td style={TD({ textAlign: "right", fontSize: 10, color: C.textMuted })}>
                      {a.seuil != null ? fmt(a.seuil) : "—"}
                    </td>
                    <td style={TD({ fontSize: 9, color: C.textMuted })}>
                      {a.id_ocp || a.ocp_id || "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ConnectionMetrics({ metrics }) {
  return (
    <div style={{
      display: "flex", gap: 14, alignItems: "center",
      padding: "6px 12px", background: C.card,
      border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <StatusDot status={metrics.online ? "ok" : "alerte"} size={6}/>
        <span style={{ fontWeight: 700, color: metrics.online ? C.greenDark : C.red,
          letterSpacing: 0.5, textTransform: "uppercase" }}>
          {metrics.online ? "Connecté" : "Hors ligne"}
        </span>
      </div>
      <span style={{ color: C.borderLt }}>·</span>
      <div style={{ color: C.textMuted }}>
        Latence: <span style={{ color: C.text, fontWeight: 700, fontFamily: "Rajdhani, system-ui" }}>
          {metrics.latencyMs}ms
        </span>
      </div>
      <span style={{ color: C.borderLt }}>·</span>
      <div style={{ color: C.textMuted }}>
        Buffer: <span style={{ color: C.text, fontWeight: 700, fontFamily: "Rajdhani, system-ui" }}>
          {metrics.bufferSize}
        </span>
      </div>
      <span style={{ color: C.borderLt }}>·</span>
      <div style={{ color: C.textMuted }}>
        Alertes/min: <span style={{ color: C.red, fontWeight: 800, fontFamily: "Rajdhani, system-ui" }}>
          {metrics.alertRate}
        </span>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
export default function LiveSimulationDashboard() {
  const [state, setState]             = useState(null)
  const [error, setError]             = useState(null)
  const [running, setRunning]         = useState(true)
  const [history, setHistory]         = useState([])
  const [selectedSensor, setSelected] = useState(null)
  const [notifStatus, setNotifStatus] = useState(null)
  const [testing, setTesting]         = useState(false)
  const [testResult, setTestResult]   = useState(null)
  const [latency, setLatency]         = useState(0)
  const [alertRate, setAlertRate]     = useState(0)

  const lastTsRef     = useRef(null)
  const tickRef       = useRef(0)
  const alertTimesRef = useRef([])

  useEffect(() => {
    let abort = false
    let timeoutId = null

    const poll = async () => {
      const t0 = performance.now()
      try {
        const res = await fetch(`${API_URL}/sim/state?n=2`, { cache: "no-store" })
        const t1 = performance.now()
        setLatency(Math.round(t1 - t0))

        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const js = await res.json()
        if (abort) return
        setError(null)
        setState(js)

        const newAlerts = (js.alertes_recentes || []).length
        alertTimesRef.current = [...alertTimesRef.current.filter(t => Date.now() - t < 60000)]
        if (newAlerts > 0) {
          for (let i = 0; i < newAlerts - alertTimesRef.current.length; i++) {
            alertTimesRef.current.push(Date.now())
          }
        }
        setAlertRate(alertTimesRef.current.length)

        const last = js?.recent?.[js.recent.length - 1]
        if (last && last.horodatage !== lastTsRef.current) {
          lastTsRef.current = last.horodatage
          tickRef.current += 1
          setHistory(prev => {
            const point = { t: tickRef.current, _ts: last.horodatage }
            for (const m of last.mesures || []) {
              point[m.parametre] = m.valeur
            }
            const next = [...prev, point]
            return next.length > HISTORY_MAX ? next.slice(-HISTORY_MAX) : next
          })
        }
      } catch (e) {
        if (!abort) {
          setError(e.message || "Connexion impossible")
          setLatency(0)
        }
      }
    }

    poll()
    if (running) {
      const tick = () => {
        if (abort) return
        poll().finally(() => {
          timeoutId = setTimeout(tick, document.visibilityState === "visible" ? POLL_FAST : POLL_SLOW)
        })
      }
      timeoutId = setTimeout(tick, POLL_FAST)
    }

    return () => {
      abort = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [running])

  useEffect(() => {
    const load = () => fetch(`${API_URL}/sim/notif-status`)
      .then(r => r.ok ? r.json() : null)
      .then(setNotifStatus)
      .catch(() => {})
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [])

  const handleTestNotif = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetch(`${API_URL}/sim/notif-debug`, { method: "POST" })
      const data = await r.json()
      setTestResult({
        success: r.ok && data.ok !== false,
        message: data.detail || data.message || (r.ok ? "Email envoyé" : "Échec d'envoi"),
      })
      setTimeout(() => setTestResult(null), 5000)
    } catch (e) {
      setTestResult({ success: false, message: e.message })
    } finally {
      setTesting(false)
    }
  }, [])

  const handleExport = useCallback(() => {
    if (history.length === 0) return
    const params = Array.from(new Set(history.flatMap(h => Object.keys(h)).filter(k => k !== "t" && k !== "_ts")))
    const headers = ["timestamp", ...params].join(",")
    const rows = history.map(h => [h._ts, ...params.map(p => h[p] ?? "")].join(",")).join("\n")
    const csv = headers + "\n" + rows
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `simulation_994F_${new Date().toISOString().slice(0,16).replace(/[:T-]/g,"")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [history])

  const handleClearBuffer = useCallback(async () => {
    if (!confirm("Vider le buffer de simulation côté serveur ?")) return
    try {
      await fetch(`${API_URL}/sim/buffer`, { method: "DELETE" })
      setHistory([])
      lastTsRef.current = null
      tickRef.current = 0
    } catch {
      // Erreur réseau silencieuse : si le buffer ne peut pas être purgé côté serveur,
      // on conserve l'état local mais on n'interrompt pas l'utilisateur.
    }
  }, [])

  const last = state?.recent?.[state.recent.length - 1]
  const alertes = state?.alertes_recentes || []
  const cyclePhase = last?.cycle_phase
  const buf = state?.buffer_size ?? 0
  const engin = last?.engin || state?.engin || "994F1"

  const valuesByParam = useMemo(() => {
    const m = new Map()
    for (const meas of last?.mesures || []) m.set(meas.parametre, meas.valeur)
    return m
  }, [last])

  const sensorCards = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const [param, val] of valuesByParam.entries()) {
      const meta = sensorMeta(param)
      if (!meta) continue
      const dedup = `${meta.sub}-${meta.key}`
      if (seen.has(dedup)) continue
      seen.add(dedup)
      // v3.1 : on enrichit avec _param (nom complet) pour le mapping OCP
      out.push({ sensor: { ...meta, _param: param }, value: val, param })
    }
    return out
  }, [valuesByParam])

  // v3.1 : contexte courant (rpm + estimation charge hydraulique) pour les
  // règles conditionnelles OCP (#3, #6, #14)
  const ctx = useMemo(() => {
    let rpm = 0, pHyd = 0
    for (const [p, v] of valuesByParam.entries()) {
      const n = normOCP(p).toLowerCase()
      if (n.includes("régime moteur") || n.includes("regime moteur")) rpm = v
      if (n.includes("pression pompe hydraulique")) pHyd = v
    }
    // hyd_load = ratio (P/Pmax). Au-dessus de 0.3 → "engin en charge"
    const hyd_load = pHyd > 0 ? Math.min(1, pHyd / 25000) : 0
    return { rpm, hyd_load }
  }, [valuesByParam])

  // v3.1 : déduplication des alertes (regroupement <5s sur même capteur)
  const alertesDeduplicated = useMemo(() => {
    const out = []
    let lastByCapteur = new Map()
    for (const a of alertes) {
      const cap = norm(a.capteur || a.parametre || "")
      const t = new Date(a.horodatage || 0).getTime()
      const last = lastByCapteur.get(cap)
      if (last && (t - last) < 5000 && a.niveau === "ATTENTION") continue  // skip spam
      lastByCapteur.set(cap, t)
      out.push(a)
    }
    return out
  }, [alertes])

  const selectedHistory = useMemo(() => {
    if (!selectedSensor) {
      // v3.1 : mode multi-capteurs NORMALISÉ (% de la plage normale).
      // Sinon une grosse pression hydraulique (~13000 kPa) écrase
      // les températures (~50°C) sur le même axe Y.
      return history.map(h => {
        const point = { t: h.t, _ts: h._ts }
        for (const k of Object.keys(h)) {
          if (k === "t" || k === "_ts") continue
          const meta = sensorMeta(k)
          if (!meta) continue
          // % de la plage normale (0% = min, 100% = max)
          const v = h[k]
          if (v == null) continue
          const lim = getDisplayLimits(k, ctx)
          const min = lim.min ?? meta.min
          const max = lim.max ?? meta.max
          const pct = ((v - min) / (max - min)) * 100
          point[normOCP(k).slice(0, 28)] = Math.round(pct * 10) / 10
        }
        return point
      })
    }
    // Mode zoom : valeurs réelles sur le capteur sélectionné
    return history.map(h => {
      const point = { t: h.t, _ts: h._ts }
      for (const k of Object.keys(h)) {
        if (k === "t" || k === "_ts") continue
        if (norm(k).toLowerCase().includes(selectedSensor.toLowerCase())) {
          point[norm(k)] = h[k]
        }
      }
      return point
    })
  }, [history, selectedSensor, ctx])

  return (
    <div style={{
      minHeight: "100vh", background: C.bgGradient,
      fontFamily: "system-ui, -apple-system, sans-serif", color: C.text,
      padding: "20px 24px", boxSizing: "border-box",
    }}>
      <style>{`
        @keyframes dot-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }
        @keyframes fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .fade-up { animation: fade-up 0.4s ease both; }
        button:hover:not(:disabled) { filter: brightness(1.05); }
        button { transition: all 0.15s; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{
              background: C.green, color: "#FFF",
              padding: "3px 12px", fontSize: 10, fontWeight: 800,
              letterSpacing: 3, textTransform: "uppercase",
              clipPath: "polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%)",
            }}>
              MINEASSIST · LIVE OPS
            </div>
            <Pill color={C.greenDark} bg={C.greenPale}>● Engin {engin}</Pill>
            {running && <Pill color="#FFF" bg={C.green}>● Live</Pill>}
          </div>
          <h1 style={{
            margin: 0, fontSize: 26, fontWeight: 900,
            fontFamily: "Rajdhani, system-ui",
            letterSpacing: 0.5, color: C.text,
          }}>
            Console de supervision · CAT 994F1
          </h1>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
            Flux MATLAB → /sim/state · Mis à jour : {fmtAge(last?.horodatage)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <ConnectionMetrics metrics={{
            online: !error, latencyMs: latency, bufferSize: buf, alertRate,
          }}/>
          <button onClick={() => setRunning(r => !r)} style={{
            padding: "9px 16px", fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
            background: running ? C.orange : C.green, color: "#FFF",
            border: "none", borderRadius: 6, cursor: "pointer",
            fontFamily: "Rajdhani, system-ui", textTransform: "uppercase",
          }}>
            {running ? "⏸ Pause" : "▶ Reprendre"}
          </button>
          <button onClick={handleExport} disabled={history.length === 0} style={{
            padding: "9px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 1,
            background: C.card, color: C.text,
            border: `1px solid ${C.border}`, borderRadius: 6,
            cursor: history.length === 0 ? "not-allowed" : "pointer",
            opacity: history.length === 0 ? 0.5 : 1,
          }}>
            📥 CSV
          </button>
          <button onClick={handleClearBuffer} style={{
            padding: "9px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 1,
            background: C.card, color: C.red,
            border: `1px solid ${C.red}40`, borderRadius: 6, cursor: "pointer",
          }}>
            🗑 Reset
          </button>
        </div>
      </div>

      {error && (
        <div className="fade-up" style={{
          padding: "10px 14px", background: C.redPale,
          border: `1px solid ${C.red}40`, borderLeft: `3px solid ${C.red}`,
          borderRadius: 8, marginBottom: 14, fontSize: 12, color: C.red,
        }}>
          ⚠ {error} — Vérifiez que <code style={{ background: "#FFF", padding: "1px 4px" }}>uvicorn</code> tourne et que le simulateur MATLAB est actif.
        </div>
      )}

      <div className="fade-up" style={{
        display: "grid", gap: 12, marginBottom: 14,
        gridTemplateColumns: "minmax(420px, 1.3fr) minmax(360px, 1.2fr) minmax(220px, 0.7fr)",
      }}>
        <CycleVisualizer phase={cyclePhase}/>
        <SubsystemHeatmap valuesByParam={valuesByParam} ctx={ctx}/>
        <NotificationsPanel
          status={notifStatus}
          onTest={handleTestNotif}
          testing={testing}
          testResult={testResult}
        />
      </div>

      <div className="fade-up" style={{ marginBottom: 14, animationDelay: "0.05s" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: C.textMuted, textTransform: "uppercase" }}>
            Capteurs en temps réel · {sensorCards.length} actifs
          </div>
          {selectedSensor && (
            <button onClick={() => setSelected(null)} style={{
              fontSize: 9, fontWeight: 700, padding: "3px 10px",
              background: C.borderLt, color: C.textMid, border: "none",
              borderRadius: 4, cursor: "pointer", letterSpacing: 0.8, textTransform: "uppercase",
            }}>
              ✕ Désélectionner ({selectedSensor.slice(0,20)})
            </button>
          )}
        </div>
        <div style={{
          display: "grid", gap: 10,
          gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))",
        }}>
          {sensorCards.length === 0 ? (
            <div style={{
              padding: 24, background: C.card, border: `1px dashed ${C.border}`,
              borderRadius: 12, textAlign: "center", color: C.textMuted, fontSize: 12,
              gridColumn: "1 / -1",
            }}>
              ⏳ En attente de données du simulateur MATLAB...
            </div>
          ) : (
            sensorCards.map(({ sensor, value, param }) => {
              const sensorHist = history.map(h => h[param]).filter(v => v != null)
              return (
                <SensorCard
                  key={`${sensor.sub}-${sensor.key}`}
                  sensor={sensor} value={value} history={sensorHist} ctx={ctx}
                  isSelected={selectedSensor === sensor.key}
                  onClick={() => setSelected(selectedSensor === sensor.key ? null : sensor.key)}
                />
              )
            })
          )}
        </div>
      </div>

      <div className="fade-up" style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: "16px 18px", marginBottom: 14,
        animationDelay: "0.1s",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: C.textMuted, textTransform: "uppercase" }}>
              {selectedSensor ? `Évolution · ${selectedSensor}` : "Évolution multi-capteurs · normalisée (% plage normale)"}
            </div>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
              {history.length} points · {selectedSensor ? "Cliquer un autre capteur pour comparer" : "Cliquer un capteur ci-dessus pour voir ses valeurs réelles"}
            </div>
          </div>
        </div>

        {history.length < 2 ? (
          <div style={{
            height: 220, display: "flex", alignItems: "center", justifyContent: "center",
            color: C.textMuted, fontSize: 12,
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
              Collecte des données en cours...
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={selectedHistory} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke={C.borderLt} vertical={false}/>
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: C.textMuted }}
                tickLine={false} axisLine={false}/>
              <YAxis tick={{ fontSize: 9, fill: C.textMuted }}
                tickLine={false} axisLine={false} width={45}
                domain={selectedSensor ? ['auto', 'auto'] : [0, 100]}
                tickFormatter={selectedSensor ? undefined : (v) => `${v}%`}/>
              <Tooltip content={<ChartTooltip suffix={selectedSensor ? "" : "%"}/>}/>
              {(() => {
                const allKeys = Object.keys(selectedHistory[selectedHistory.length-1] || {})
                  .filter(k => k !== "t" && k !== "_ts")
                  .slice(0, selectedSensor ? 4 : 3)
                return allKeys.map((k, i) => {
                  const meta = sensorMeta(k)
                  return (
                    <Line key={k} type="monotone" dataKey={k}
                      stroke={meta?.color || ["#3B82F6", "#8B5CF6", "#06B6D4"][i % 3]}
                      strokeWidth={1.8} dot={false}
                      isAnimationActive={false}
                      name={norm(k).slice(0, 30)}
                    />
                  )
                })
              })()}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="fade-up" style={{ animationDelay: "0.15s" }}>
        <AlertesTable alertes={alertesDeduplicated}/>
      </div>

      <div style={{
        marginTop: 14, padding: "10px 16px",
        background: C.sandPale, border: `1px solid ${C.borderLt}`,
        borderRadius: 8, fontSize: 10, color: C.textMuted,
        display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
      }}>
        <span>OCP Benguerir · CAT 994F1 · MineAssist v3</span>
        <span>Polling : {running ? `${POLL_FAST/1000}s` : "pause"} · Buffer : {buf} mesures</span>
      </div>
    </div>
  )
}
