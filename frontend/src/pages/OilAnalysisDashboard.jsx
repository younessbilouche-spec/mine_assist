// OilAnalysisDashboard.jsx
// ══════════════════════════════════════════════════════════════════════════
// Dashboard Analyses d'Huile — MineAssist 994F · OCP Benguerir
// Consomme les endpoints /oil/* du router FastAPI
// ══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Legend, Cell, RadarChart, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Radar, LineChart, Line,
} from "recharts"

import { API } from "../config"
const API_URL = API

// ── Color system ─────────────────────────────────────────────────────────────
const C = {
  bg:         "#F8FAFC",
  bgCard:     "#FFFFFF",
  border:     "#E2E8F0",
  text:       "#0F172A",
  textMid:    "#475569",
  textMuted:  "#94A3B8",
  orange:     "#E67E22",
  orangePale: "#FCE9D6",
  green:      "#00843D",
  greenPale:  "#E0F2E9",
  red:        "#DC2626",
  redPale:    "#FEE2E2",
  amber:      "#D97706",
  amberPale:  "#FEF3C7",
  dark:       "#0F172A",
}

const STATUS_COLOR = {
  CRITIQUE:  { bg: C.redPale,   text: C.red,    dot: "#EF4444" },
  MARGINALE: { bg: C.amberPale, text: C.amber,  dot: "#F59E0B" },
  NORMALE:   { bg: C.greenPale, text: C.green,  dot: "#22C55E" },
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function statusColors(etat) {
  return STATUS_COLOR[etat?.toUpperCase()] || STATUS_COLOR.NORMALE
}

function worstStatus(etatMachine, etatLub) {
  const rank = { CRITIQUE: 3, MARGINALE: 2, NORMALE: 1 }
  const a = rank[etatMachine?.toUpperCase()] || 1
  const b = rank[etatLub?.toUpperCase()] || 1
  return a >= b ? etatMachine : etatLub
}

const VALID_COMPOSANTS = new Set(["PONT AR", "PONT AV", "PTO", "MOTEUR", "TRANSMISSION", "HYDRAULIQUE", "DIFFÉRENTIEL", "DIFFERENTIEL"])

function validAnalyse(a) {
  const comp = String(a?.composant || "").trim().toUpperCase()
  const rapport = String(a?.rapport_numero || a?.id || "").trim().toLowerCase()
  return VALID_COMPOSANTS.has(comp) && rapport && !["string", "null", "none"].includes(rapport)
}

function oilReference(grade) {
  return String(grade || "").includes("80W90") ? 169 : 200
}

function oilScore(analyse) {
  if (!analyse) return 0
  const pc = analyse.physico_chimique || {}
  const mu = analyse.metaux_usure || {}
  const mc = analyse.metaux_contaminants || {}
  const par = analyse.particules || {}
  let score = 100
  const status = worstStatus(analyse.etat_machine, analyse.etat_lubrifiant)
  if (status === "CRITIQUE") score -= 32
  else if (status === "MARGINALE") score -= 16

  const ref = oilReference(analyse.grade_huile)
  if (pc.viscosite_40 != null) {
    const gap = Math.abs(pc.viscosite_40 - ref) / ref
    if (gap > 0.20) score -= 24
    else if (gap > 0.10) score -= 10
  }
  if ((pc.tan || 0) > 2.4) score -= 14
  if ((mu.fe || 0) > 250) score -= 18
  else if ((mu.fe || 0) > 60) score -= 8
  if ((mu.cu || 0) > 900) score -= 18
  else if ((mu.cu || 0) > 150) score -= 8
  if ((mc.si || 0) > 60) score -= 14
  else if ((mc.si || 0) > 30) score -= 7
  if ((par.n_sup_14um || 0) > 60000) score -= 14
  else if ((par.n_sup_14um || 0) > 15000) score -= 7
  return Math.max(0, Math.min(100, Math.round(score)))
}

function healthLabel(score) {
  if (score >= 85) return "Bon"
  if (score >= 65) return "Surveillance"
  if (score >= 40) return "Dégradé"
  return "Critique"
}

function scoreColor(score) {
  if (score >= 85) return C.green
  if (score >= 65) return C.amber
  if (score >= 40) return C.orange
  return C.red
}

function diagnosticVectors(analyse) {
  const pc = analyse?.physico_chimique || {}
  const mu = analyse?.metaux_usure || {}
  const mc = analyse?.metaux_contaminants || {}
  const par = analyse?.particules || {}
  const ref = oilReference(analyse?.grade_huile)
  const viscGap = pc.viscosite_40 != null ? Math.min(100, Math.abs(pc.viscosite_40 - ref) / ref * 250) : 0
  return [
    { axe: "Viscosité", valeur: Math.round(viscGap) },
    { axe: "Oxydation", valeur: Math.min(100, Math.round((pc.oxydation || 0) * 4)) },
    { axe: "Usure Fe", valeur: Math.min(100, Math.round((mu.fe || 0) / 250 * 100)) },
    { axe: "Cuivre", valeur: Math.min(100, Math.round((mu.cu || 0) / 900 * 100)) },
    { axe: "Silice", valeur: Math.min(100, Math.round((mc.si || 0) / 60 * 100)) },
    { axe: "Particules", valeur: Math.min(100, Math.round((par.n_sup_14um || 0) / 60000 * 100)) },
  ]
}

function maintenanceDiagnosis(analyse) {
  if (!analyse) return []
  const pc = analyse.physico_chimique || {}
  const mu = analyse.metaux_usure || {}
  const mc = analyse.metaux_contaminants || {}
  const par = analyse.particules || {}
  const ref = oilReference(analyse.grade_huile)
  const out = []
  if (pc.viscosite_40 != null && pc.viscosite_40 < ref * 0.8) {
    out.push({ type: "Perte viscosité", cause: "Dilution, cisaillement ou huile non conforme", action: "Vérifier grade, fuite carburant/eau, planifier vidange", level: "CRITIQUE" })
  } else if (pc.viscosite_40 != null && pc.viscosite_40 > ref * 1.2) {
    out.push({ type: "Viscosité élevée", cause: "Oxydation, contamination ou vieillissement huile", action: "Contrôler température, filtration et intervalle vidange", level: "MARGINALE" })
  }
  if ((mu.fe || 0) > 60) out.push({ type: "Usure ferreuse", cause: "Engrenages/roulements/arbre en usure", action: "Inspecter aimants, carter, bruit/vibration et tendance Fe", level: (mu.fe || 0) > 250 ? "CRITIQUE" : "MARGINALE" })
  if ((mu.cu || 0) > 150) out.push({ type: "Usure cuivre", cause: "Bagues, coussinets ou échangeur", action: "Contrôler jeu mécanique et refroidisseur d'huile", level: (mu.cu || 0) > 900 ? "CRITIQUE" : "MARGINALE" })
  if ((mc.si || 0) > 30) out.push({ type: "Contamination silice", cause: "Poussière, reniflard ou défaut étanchéité", action: "Inspecter joints, filtration et conditions de prélèvement", level: (mc.si || 0) > 60 ? "CRITIQUE" : "MARGINALE" })
  if ((par.n_sup_14um || 0) > 15000) out.push({ type: "Pollution particulaire", cause: "Filtration insuffisante ou usure active", action: "Remplacer filtre, nettoyer circuit, refaire prélèvement", level: (par.n_sup_14um || 0) > 60000 ? "CRITIQUE" : "MARGINALE" })
  if ((pc.tan || 0) > 2.4) out.push({ type: "Acidité élevée", cause: "Oxydation/huile vieillie", action: "Réduire intervalle de vidange et contrôler température", level: "MARGINALE" })
  if (!out.length) out.push({ type: "État acceptable", cause: "Aucun indicateur majeur hors seuil", action: "Continuer la surveillance périodique et comparer la tendance", level: "NORMALE" })
  return out
}

function latestByComponent(analyses) {
  const map = new Map()
  analyses.forEach(a => {
    if (!map.has(a.composant)) map.set(a.composant, a)
  })
  return [...map.values()]
}

function componentRiskData(analyses) {
  return latestByComponent(analyses).map(a => ({
    composant: a.composant,
    score: oilScore(a),
    risque: 100 - oilScore(a),
    viscosite: a.physico_chimique?.viscosite_40 || 0,
    fe: a.metaux_usure?.fe || 0,
    si: a.metaux_contaminants?.si || 0,
    particules: a.particules?.n_sup_14um || 0,
  }))
}

function trendData(analyses, comp) {
  return analyses
    .filter(a => !comp || a.composant === comp)
    .slice()
    .reverse()
    .map(a => ({
      date: a.date_prelevement || a.date_reception || a.rapport_numero,
      score: oilScore(a),
      viscosite: a.physico_chimique?.viscosite_40 || null,
      fe: a.metaux_usure?.fe || null,
      si: a.metaux_contaminants?.si || null,
    }))
}

function errorText(value) {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(errorText).filter(Boolean).join(" | ")
  if (typeof value === "object") {
    if (value.message) return errorText(value.message)
    if (value.msg) return errorText(value.msg)
    if (value.detail) return errorText(value.detail)
    if (value.loc && value.type) return `${value.loc.join(".")} : ${value.type}`
    return JSON.stringify(value)
  }
  return String(value)
}

async function apiFetch(url, opts = {}) {
  const token =
    localStorage.getItem("mineassist_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("access_token")
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) }
  if (token) headers["Authorization"] = `Bearer ${token}`
  let res
  try {
    res = await fetch(url, { ...opts, headers })
  } catch {
    throw new Error(`Backend indisponible (${url})`)
  }
  if (!res.ok) {
    const contentType = res.headers.get("content-type") || ""
    const body = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => "")
    throw new Error(errorText(body?.detail || body?.message || body) || `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ children, style }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: "18px 20px",
      boxShadow: "0 1px 6px rgba(0,0,0,0.05)", ...style
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ icon, text, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.orange, letterSpacing: 4,
        textTransform: "uppercase", marginBottom: 3 }}>
        {icon}  {text}
      </div>
      {sub && <div style={{ fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>{sub}</div>}
      <div style={{ width: 36, height: 2, background: C.orange, marginTop: 6 }} />
    </div>
  )
}

function StatusBadge({ status, size = "sm" }) {
  const sc = statusColors(status)
  const sizes = { sm: { fontSize: 10, padding: "2px 8px" }, md: { fontSize: 12, padding: "4px 12px" } }
  return (
    <span style={{
      background: sc.bg, color: sc.text,
      fontWeight: 700, borderRadius: 4,
      ...sizes[size], letterSpacing: 1,
      border: `1px solid ${sc.text}22`,
      display: "inline-block",
    }}>
      {status}
    </span>
  )
}

// KPI card with big number
function KpiCard({ label, value, sub, status, icon }) {
  const sc = status ? statusColors(status) : null
  return (
    <div style={{
      background: sc ? sc.bg : C.bgCard,
      border: `1px solid ${sc ? sc.text + "33" : C.border}`,
      borderTop: `3px solid ${sc ? sc.text : C.orange}`,
      borderRadius: 8, padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 4,
      flex: "1 1 0",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: sc?.text || C.textMuted,
        textTransform: "uppercase", letterSpacing: 3 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, color: sc?.text || C.text,
        fontFamily: "Georgia, serif", lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: C.textMid }}>{sub}</div>}
    </div>
  )
}

function ScoreGauge({ score, label = "Indice santé huile" }) {
  const color = scoreColor(score)
  return (
    <div style={{
      background: `linear-gradient(135deg, ${color}18, #fff)`,
      border: `1px solid ${color}44`,
      borderRadius: 12,
      padding: "18px 20px",
      minWidth: 230,
    }}>
      <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "end", gap: 10, marginTop: 8 }}>
        <div style={{ fontSize: 46, lineHeight: 1, fontWeight: 900, color, fontFamily: "Rajdhani, sans-serif" }}>{score}</div>
        <div style={{ marginBottom: 6, color: C.textMid, fontSize: 12 }}>/100 · {healthLabel(score)}</div>
      </div>
      <div style={{ height: 8, background: C.border, borderRadius: 99, overflow: "hidden", marginTop: 14 }}>
        <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 99 }} />
      </div>
    </div>
  )
}

function MaintenancePlan({ items }) {
  return (
    <Card style={{ borderLeft: `4px solid ${items.some(i => i.level === "CRITIQUE") ? C.red : C.orange}` }}>
      <SectionTitle icon="🛠️" text="Diagnostic industriel & plan d'action" sub="Lecture maintenance inspirée SOS/OKSA" />
      <div style={{ display: "grid", gap: 9 }}>
        {items.map((item, i) => {
          const sc = statusColors(item.level)
          return (
            <div key={`${item.type}-${i}`} style={{
              display: "grid", gridTemplateColumns: "120px 1fr", gap: 12,
              border: `1px solid ${sc.text}22`, background: sc.bg,
              borderRadius: 8, padding: "10px 12px",
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: sc.text }}>{item.type}</div>
                <StatusBadge status={item.level} />
              </div>
              <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.45 }}>
                <b style={{ color: C.text }}>Cause probable :</b> {item.cause}<br />
                <b style={{ color: C.text }}>Action :</b> {item.action}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// Composant state card (one per component)
function ComposantCard({ composant, selected, onClick }) {
  const etat = composant.etat?.toUpperCase()
  const sc   = statusColors(etat)
  const isSelected = selected === composant.composant
  return (
    <div onClick={onClick} style={{
      background: isSelected ? sc.bg : C.bgCard,
      border: `2px solid ${isSelected ? sc.text : C.border}`,
      borderRadius: 8, padding: "14px 16px",
      cursor: "pointer", transition: "all 0.2s",
      boxShadow: isSelected ? `0 0 0 2px ${sc.text}22` : "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{composant.composant}</div>
        <StatusBadge status={etat} />
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
        Rapport : {composant.dernier_rapport}
      </div>
      {composant.alertes?.length > 0 && (
        <div style={{ fontSize: 10, color: sc.text, background: sc.bg,
          borderLeft: `3px solid ${sc.text}`, padding: "4px 8px",
          borderRadius: 2, marginTop: 4 }}>
          ⚠ {composant.alertes[0]}
        </div>
      )}
    </div>
  )
}

// Detailed analysis panel
function AnalyseDetail({ analyse }) {
  if (!analyse) return (
    <div style={{ textAlign: "center", padding: 40, color: C.textMuted, fontSize: 13 }}>
      Sélectionner un composant pour voir le détail de l'analyse
    </div>
  )

  const pc  = analyse.physico_chimique || {}
  const mu  = analyse.metaux_usure || {}
  const mc  = analyse.metaux_contaminants || {}
  const ma  = analyse.metaux_additifs || {}
  const par = analyse.particules || {}

  const pire = worstStatus(analyse.etat_machine, analyse.etat_lubrifiant)
  const sc   = statusColors(pire)
  const score = oilScore(analyse)
  const radarData = diagnosticVectors(analyse)
  const diagnostics = maintenanceDiagnosis(analyse)

  // Bar chart data for wear metals
  const metauxData = [
    { name: "Fe",  val: mu.fe  || 0, lo: 60,  hi: 250  },
    { name: "Cu",  val: mu.cu  || 0, lo: 150, hi: 900  },
    { name: "Si",  val: mc.si  || 0, lo: 30,  hi: 60   },
    { name: "Al",  val: mu.al  || 0, lo: 8,   hi: 16   },
    { name: "Cr",  val: mu.cr  || 0, lo: 0,   hi: 30   },
  ].filter(d => d.val > 0)

  const pctVisc = pc.viscosite_40
    ? Math.round((pc.viscosite_40 / (analyse.grade_huile?.includes("80W90") ? 169 : 200)) * 100)
    : null

  return (
    <div>
      {/* Header strip */}
      <div style={{
        background: sc.bg, border: `1px solid ${sc.text}33`,
        borderRadius: 8, padding: "14px 18px", marginBottom: 16,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 10,
      }}>
        <div>
          <div style={{ fontSize: 11, color: sc.text, fontWeight: 700,
            letterSpacing: 3, textTransform: "uppercase" }}>
            {analyse.machine} · {analyse.composant}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginTop: 2 }}>
            Rapport {analyse.rapport_numero}
          </div>
          <div style={{ fontSize: 11, color: C.textMid, marginTop: 2 }}>
            Prélèvement : {analyse.date_prelevement}  ·  Grade : {analyse.grade_huile}
            {analyse.heures_engin ? `  ·  ${analyse.heures_engin} h` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 2 }}>MACHINE</div>
            <StatusBadge status={analyse.etat_machine} size="md" />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: 2 }}>LUBRIFIANT</div>
            <StatusBadge status={analyse.etat_lubrifiant} size="md" />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 14, marginBottom: 14 }}>
        <ScoreGauge score={score} />
        <Card>
          <SectionTitle icon="🎯" text="Profil de dégradation" sub="0 = bon, 100 = risque élevé" />
          <ResponsiveContainer width="100%" height={210}>
            <RadarChart data={radarData}>
              <PolarGrid stroke={C.border} />
              <PolarAngleAxis dataKey="axe" tick={{ fontSize: 10, fill: C.textMid }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9, fill: C.textMuted }} />
              <Radar dataKey="valeur" stroke={sc.text} fill={sc.text} fillOpacity={0.22} />
              <Tooltip formatter={(v) => [`${v}%`, "Risque"]} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <MaintenancePlan items={diagnostics} />

      {/* Grid: physico-chimique + métaux */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, margin: "14px 0" }}>

        {/* Physico-chimiques */}
        <Card>
          <SectionTitle icon="🧪" text="Analyses Physico-Chimiques" />
          {[
            { label: "Viscosité 40°C",  val: pc.viscosite_40, unit: "mm²/s",
              pct: pctVisc, warn: pctVisc && (pctVisc < 80 || pctVisc > 120) },
            { label: "TAN",             val: pc.tan, unit: "mgKOH/g",
              warn: pc.tan > 2.4 },
            { label: "Point d'éclair",  val: pc.point_eclair, unit: "°C", warn: false },
            { label: "Oxydation (FTIR)",val: pc.oxydation, unit: "abs/0.1mm", warn: false },
            { label: "Sulfate",         val: pc.sulfate, unit: "abs/0.1mm", warn: false },
            { label: "Nitrate",         val: pc.nitrate, unit: "abs/0.1mm", warn: false },
          ].map(({ label, val, unit, warn, pct }) => (
            val != null && (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", padding: "7px 0",
                borderBottom: `1px solid ${C.border}`,
              }}>
                <div style={{ fontSize: 12, color: C.textMid }}>{label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700,
                    color: warn ? C.red : C.text,
                    background: warn ? C.redPale : "transparent",
                    padding: warn ? "2px 6px" : "0",
                    borderRadius: 4,
                  }}>
                    {val} {unit}
                  </span>
                  {pct != null && (
                    <span style={{
                      fontSize: 10, color: warn ? C.red : C.green,
                      background: warn ? C.redPale : C.greenPale,
                      padding: "1px 6px", borderRadius: 10, fontWeight: 700
                    }}>
                      {pct}% réf
                    </span>
                  )}
                </div>
              </div>
            )
          ))}
        </Card>

        {/* Métaux d'usure — mini bar chart */}
        <Card>
          <SectionTitle icon="⚙️" text="Métaux d'usure" sub="vs seuils constructeur CAT" />
          {metauxData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={metauxData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.textMid }} />
                <YAxis tick={{ fontSize: 10, fill: C.textMuted }} />
                <Tooltip
                  formatter={(v, n) => [`${v} mg/kg`, n]}
                  contentStyle={{ fontSize: 11 }}
                />
                {metauxData.map(d => (
                  <ReferenceLine key={`hi-${d.name}`}
                    y={d.hi} stroke={C.red} strokeDasharray="4 4" strokeWidth={1} />
                ))}
                <Bar dataKey="val" name="Mesure" radius={[3, 3, 0, 0]}>
                  {metauxData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.val > d.hi ? C.red : d.val > d.lo ? C.amber : C.green}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: C.textMuted, fontSize: 12, textAlign: "center", padding: 20 }}>
              Aucun métal d'usure détecté
            </div>
          )}
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6, textAlign: "center" }}>
            — Ligne rouge = seuil constructeur · Vert/Ambre/Rouge = état
          </div>
        </Card>
      </div>

      {/* Particules + recommandations */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

        <Card>
          <SectionTitle icon="🔬" text="Comptage Particules ISO 4406" />
          {[
            { label: "n > 4 µm",   val: par.n_sup_4um,  fmt: (v) => v?.toLocaleString("fr-FR") },
            { label: "n > 6 µm",   val: par.n_sup_6um,  fmt: (v) => v?.toLocaleString("fr-FR") },
            { label: "n > 14 µm",  val: par.n_sup_14um, fmt: (v) => v?.toLocaleString("fr-FR") },
          ].map(({ label, val, fmt }) => (
            val != null && (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between",
                padding: "8px 0", borderBottom: `1px solid ${C.border}`,
              }}>
                <span style={{ fontSize: 12, color: C.textMid }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{fmt(val)} part/10ml</span>
              </div>
            )
          ))}
          {par.code_iso_4406 && (
            <div style={{ marginTop: 10, textAlign: "center" }}>
              <span style={{ fontSize: 11, color: C.textMuted }}>Code ISO 4406 </span>
              <span style={{
                fontSize: 18, fontWeight: 700, color: C.text,
                fontFamily: "monospace", marginLeft: 8,
              }}>
                {par.code_iso_4406}
              </span>
            </div>
          )}
        </Card>

        <Card style={{ borderLeft: `4px solid ${sc.text}` }}>
          <SectionTitle icon="📋" text="Recommandations OKSA" />
          {analyse.recommandations?.map((r, i) => (
            <div key={i} style={{
              display: "flex", gap: 8, padding: "7px 0",
              borderBottom: `1px solid ${C.border}`,
              alignItems: "flex-start",
            }}>
              <span style={{
                width: 20, height: 20, minWidth: 20,
                background: sc.bg, color: sc.text,
                borderRadius: "50%", fontSize: 11, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{i + 1}</span>
              <span style={{
                fontSize: 12, color: r.includes("VIDANGE") ? C.red : C.textMid,
                fontWeight: r.includes("VIDANGE") ? 700 : 400,
                fontStyle: "italic",
              }}>{r}</span>
            </div>
          ))}
          {analyse.alertes?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.red,
                letterSpacing: 3, marginBottom: 6 }}>ALERTES DÉTECTÉES</div>
              {analyse.alertes.map((a, i) => (
                <div key={i} style={{
                  fontSize: 11, color: C.red, background: C.redPale,
                  borderLeft: `3px solid ${C.red}`, padding: "5px 8px",
                  marginBottom: 4, borderRadius: "0 4px 4px 0",
                }}>⚠ {a}</div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Métaux additifs en tableau */}
      <Card>
        <SectionTitle icon="🧬" text="Métaux Additifs" sub="Vérification de l'intégrité du package additif" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {[
            { label: "Ca",  val: ma.ca,  unit: "mg/kg" },
            { label: "P",   val: ma.p,   unit: "mg/kg" },
            { label: "Zn",  val: ma.zn,  unit: "mg/kg" },
            { label: "Mg",  val: ma.mg,  unit: "mg/kg" },
            { label: "Mo",  val: ma.mo,  unit: "mg/kg" },
            { label: "S",   val: ma.s,   unit: "mg/kg", large: true },
          ].map(({ label, val, unit, large }) => val != null && (
            <div key={label} style={{
              background: C.bg, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "10px 14px",
              minWidth: large ? 120 : 90, textAlign: "center",
            }}>
              <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 700,
                letterSpacing: 2, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>
                {val >= 10000 ? (val / 1000).toFixed(1) + "k" : val}
              </div>
              <div style={{ fontSize: 9, color: C.textMuted }}>{unit}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════

export default function OilAnalysisDashboard() {
  const [summary, setSummary] = useState({
    total: 0,
    critiques: 0,
    marginales: 0,
    normales: 0,
    composants: [],
  })
  const [analyses,      setAnalyses]      = useState([])
  const [selectedComp,  setSelectedComp]  = useState(null)
  const [activeDetail,  setActiveDetail]  = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState(null)
  const [activeTab,     setActiveTab]     = useState("tableau-bord")

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [sum, list] = await Promise.all([
        apiFetch(`${API_URL}/oil/analyses/summary`),
        apiFetch(`${API_URL}/oil/analyses`),
      ])
      const cleanAnalyses = (list.analyses || []).filter(validAnalyse)
      const cleanComposants = (sum.composants || []).filter(c =>
        VALID_COMPOSANTS.has(String(c?.composant || "").trim().toUpperCase())
      )
      setSummary({ ...sum, total: cleanAnalyses.length, composants: cleanComposants })
      setAnalyses(cleanAnalyses)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // When composant is selected, load its most recent analysis
  useEffect(() => {
    if (!selectedComp) { setActiveDetail(null); return }
    const found = analyses.find(a =>
      (a.composant || "").toUpperCase() === selectedComp.toUpperCase()
    )
    setActiveDetail(found || null)
  }, [selectedComp, analyses])


  // ── Import PDF button ────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)

  const handleImport = useCallback(async (file) => {
    if (!file || !file.name.endsWith('.pdf')) {
      setImportMsg({ type: 'error', text: 'Seuls les fichiers PDF sont acceptés.' })
      return
    }
    setImporting(true); setImportMsg(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const token =
        localStorage.getItem('mineassist_token') ||
        localStorage.getItem('token') ||
        localStorage.getItem('access_token')
      const res   = await fetch(`${API_URL}/oil/upload-pdf`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setImportMsg({
          type: 'success',
          text: `✅ Importé : ${data.rapport_numero} · ${data.composant} · ${data.etat_lubrifiant}`
        })
        if (data.composant) {
          setSelectedComp(data.composant)
          setActiveTab("detail")
        }
        setError(null)
        await load()
      } else {
        setImportMsg({ type: 'error', text: errorText(data.detail || data.message || data) || 'Erreur lors de l\'import' })
      }
    } catch(e) {
      setImportMsg({ type: 'error', text: errorText(e) || "Erreur lors de l'import" })
    }
    setImporting(false)
  }, [load])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    handleImport(file)
  }, [handleImport])

  const riskData = componentRiskData(analyses)
  const worstOil = riskData.slice().sort((a, b) => a.score - b.score)[0]
  const avgScore = riskData.length
    ? Math.round(riskData.reduce((acc, r) => acc + r.score, 0) / riskData.length)
    : 0
  const selectedTrend = trendData(analyses, selectedComp || worstOil?.composant)

  // ── Render ─────────────────────────────────────────────────────────────────
  const tabs = [
    { id: "tableau-bord", label: "📊 Tableau de bord" },
    { id: "detail",       label: "🔬 Détail analyse" },
    { id: "liste",        label: "📋 Toutes les analyses" },
  ]

  return (
    <div style={{
        padding: "28px 32px",
        width: "100%",
        maxWidth: 1320,
        margin: "0 auto",
        minHeight: "calc(100vh - 64px)",
        position: "relative",
        zIndex: 1,
        boxSizing: "border-box",
      }}>

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.orange,
          letterSpacing: 4, textTransform: "uppercase", marginBottom: 4 }}>
          MINEASSIST · MODULE ANALYSES D'HUILE
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: C.text,
          fontFamily: "Georgia, serif" }}>
          Surveillance Lubrifiants
        </div>
        <div style={{ fontSize: 13, color: C.textMid, marginTop: 4 }}>
          CAT 994F2 · N° Série 53492 · OCP Benguerir · Labo OKSA Rabat
        </div>
      </div>


      {/* ── Import PDF zone ──────────────────────────────────────────────── */}
      <div
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        style={{
          border: `2px dashed ${importing ? C.orange : C.border}`,
          borderRadius: 8, padding: "14px 20px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
          background: importing ? C.orangePale : C.bgCard,
          transition: "all 0.2s",
        }}
      >
        <span style={{ fontSize: 20 }}>📄</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 2 }}>
            Importer un rapport OKSA
          </div>
          <div style={{ fontSize: 11, color: C.textMuted }}>
            Glisser-déposer un PDF ici, ou cliquer pour sélectionner
          </div>
        </div>
        <label style={{
          padding: "8px 18px", background: importing ? C.textMuted : C.orange,
          color: "#fff", borderRadius: 6, cursor: importing ? "wait" : "pointer",
          fontSize: 12, fontWeight: 700, letterSpacing: 1,
        }}>
          {importing ? "⟳ Import en cours..." : "📂 Choisir un PDF"}
          <input type="file" accept=".pdf" style={{ display: "none" }}
            onChange={e => handleImport(e.target.files[0])}
          />
        </label>
      </div>

      {/* Import message */}
      {importMsg && (
        <div style={{
          padding: "10px 16px", marginBottom: 14, borderRadius: 6, fontSize: 12,
          background: importMsg.type === 'success' ? C.greenPale : C.redPale,
          color: importMsg.type === 'success' ? C.green : C.red,
          border: `1px solid ${importMsg.type === 'success' ? C.green : C.red}33`,
          borderLeft: `4px solid ${importMsg.type === 'success' ? C.green : C.red}`,
        }}>
          {importMsg.text}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{ background: "#FEE2E2", border: `1px solid ${C.red}33`,
          borderLeft: `4px solid ${C.red}`, borderRadius: 8,
          padding: "12px 16px", marginBottom: 16, fontSize: 13, color: C.red }}>
          ⚠ Impossible de contacter l'API : {error}
          <button onClick={load} style={{ marginLeft: 12, padding: "2px 10px",
            background: C.red, color: "#fff", border: "none",
            borderRadius: 4, cursor: "pointer", fontSize: 11 }}>
            Réessayer
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 20,
        borderBottom: `1px solid ${C.border}` }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: "10px 16px", border: "none", background: "none",
            cursor: "pointer", fontSize: 12, fontWeight: 700,
            color: activeTab === t.id ? C.orange : C.textMid,
            borderBottom: activeTab === t.id ? `3px solid ${C.orange}` : "3px solid transparent",
            transition: "all 0.15s",
          }}>
            {t.label}
          </button>
        ))}
        <button onClick={load} style={{
          marginLeft: "auto", padding: "6px 14px",
          background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 6, cursor: "pointer", fontSize: 11,
          color: C.textMid, display: "flex", alignItems: "center", gap: 5,
        }}>
          {loading ? "⟳ Chargement..." : "↺ Actualiser"}
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: C.textMuted }}>
          ⟳ Chargement des analyses...
        </div>
      )}

      {/* ── TAB: TABLEAU DE BORD ────────────────────────────────────────────── */}
      {!loading && activeTab === "tableau-bord" && summary && (
        <>
          {/* KPI row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <ScoreGauge score={avgScore} label="Santé huile globale" />
            <KpiCard
              label="Total analyses"
              value={summary.total}
              sub="dans la base de données"
              icon="📊"
            />
            <KpiCard
              label="Critiques"
              value={summary.critiques}
              sub="intervention requise"
              status="CRITIQUE"
              icon="🚨"
            />
            <KpiCard
              label="Marginales"
              value={summary.marginales}
              sub="surveillance renforcée"
              status="MARGINALE"
              icon="⚠️"
            />
            <KpiCard
              label="Normales"
              value={summary.normales}
              sub="état satisfaisant"
              status="NORMALE"
              icon="✅"
            />
          </div>

          {riskData.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 14, marginBottom: 16 }}>
              <Card>
                <SectionTitle icon="🏭" text="Matrice criticité composants" sub="Priorisation maintenance par indice santé huile" />
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={riskData} margin={{ top: 10, right: 15, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="composant" tick={{ fontSize: 11, fill: C.textMid }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: C.textMuted }} />
                    <Tooltip formatter={(v, n) => [n === "risque" ? `${v}%` : `${v}/100`, n === "risque" ? "Risque" : "Score"]} />
                    <Legend />
                    <Bar dataKey="risque" name="Risque maintenance" radius={[4,4,0,0]}>
                      {riskData.map((r, i) => (
                        <Cell key={i} fill={r.score < 40 ? C.red : r.score < 65 ? C.orange : r.score < 85 ? C.amber : C.green} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card style={{ borderLeft: `4px solid ${worstOil?.score < 50 ? C.red : C.orange}` }}>
                <SectionTitle icon="📌" text="Priorité maintenance" sub="Composant à traiter en premier" />
                <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(worstOil?.score || 0), fontFamily: "Rajdhani, sans-serif" }}>
                  {worstOil?.composant || "—"}
                </div>
                <div style={{ fontSize: 13, color: C.textMid, margin: "8px 0 14px" }}>
                  Score huile {worstOil?.score ?? "—"}/100 · risque {worstOil?.risque ?? "—"}%
                </div>
                <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6 }}>
                  Décision recommandée : traiter d'abord les composants avec viscosité hors plage, Fe/Cu élevés,
                  silice ou particules ISO élevées. Cette vue transforme le rapport laboratoire en plan de maintenance.
                </div>
              </Card>
            </div>
          )}

          {/* Composants grid */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted,
              letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>
              État des composants
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {summary.composants?.map(c => (
                <ComposantCard
                  key={c.composant}
                  composant={c}
                  selected={selectedComp}
                  onClick={() => {
                    setSelectedComp(c.composant)
                    setActiveTab("detail")
                  }}
                />
              ))}
            </div>
          </div>

          {/* Viscosity comparison chart */}
          {analyses.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16 }}>
              <Card>
                <SectionTitle icon="📉" text="Comparaison viscosités 40°C" sub="Mesures vs référence constructeur (±20%)" />
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={latestByComponent(analyses).map(a => ({
                      name: a.composant,
                      mesure: a.physico_chimique?.viscosite_40,
                      reference: oilReference(a.grade_huile),
                    }))}
                    margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => [`${v} mm²/s`]} />
                    <Legend />
                    <Bar dataKey="mesure" name="Viscosité mesurée" radius={[4,4,0,0]}>
                      {latestByComponent(analyses).map((a, i) => {
                        const v = a.physico_chimique?.viscosite_40 || 0
                        const ref = oilReference(a.grade_huile)
                        return <Cell key={i} fill={v < ref * 0.8 || v > ref * 1.2 ? C.red : v < ref * 0.9 ? C.amber : C.green} />
                      })}
                    </Bar>
                    <Bar dataKey="reference" name="Référence" fill={C.textMuted} opacity={0.3} radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card>
                <SectionTitle icon="📈" text={`Tendance ${selectedComp || worstOil?.composant || ""}`} sub="Score huile, viscosité et métaux clés" />
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={selectedTrend} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.textMid }} />
                    <YAxis tick={{ fontSize: 10, fill: C.textMuted }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="score" name="Score huile" stroke={C.green} strokeWidth={2} dot />
                    <Line type="monotone" dataKey="fe" name="Fe mg/kg" stroke={C.red} strokeWidth={2} dot />
                    <Line type="monotone" dataKey="si" name="Si mg/kg" stroke={C.orange} strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ── TAB: DETAIL ─────────────────────────────────────────────────────── */}
      {!loading && activeTab === "detail" && (
        <>
          {/* Composant selector */}
          <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            {summary?.composants?.map(c => {
              const sc = statusColors(c.etat)
              return (
                <button key={c.composant} onClick={() => setSelectedComp(c.composant)} style={{
                  padding: "8px 16px", border: `2px solid ${selectedComp === c.composant ? sc.text : C.border}`,
                  borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700,
                  background: selectedComp === c.composant ? sc.bg : C.bgCard,
                  color: selectedComp === c.composant ? sc.text : C.textMid,
                  transition: "all 0.15s",
                }}>
                  {c.composant}
                  <span style={{ marginLeft: 6, fontSize: 10 }}>
                    <StatusBadge status={c.etat} />
                  </span>
                </button>
              )
            })}
          </div>
          <AnalyseDetail analyse={activeDetail} />
        </>
      )}

      {/* ── TAB: LISTE ──────────────────────────────────────────────────────── */}
      {!loading && activeTab === "liste" && (
        <Card>
          <SectionTitle icon="📋" text="Toutes les analyses" sub={`${analyses.length} analyse(s) dans la base`} />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.dark }}>
                  {["Rapport N°", "Composant", "Grade", "Date Prélèv.", "Viscosité 40°C",
                    "TAN", "Fe (mg/kg)", "ISO 4406", "Machine", "Lubrifiant"].map(h => (
                    <th key={h} style={{
                      padding: "10px 12px", color: "#fff",
                      fontWeight: 700, fontSize: 10, letterSpacing: 2,
                      textAlign: "left", textTransform: "uppercase",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analyses.map((a, i) => {
                  const pire = worstStatus(a.etat_machine, a.etat_lubrifiant)
                  const sc   = statusColors(pire)
                  return (
                    <tr key={a.id} onClick={() => {
                      setSelectedComp(a.composant)
                      setActiveTab("detail")
                    }} style={{
                      background: i % 2 === 0 ? C.bg : C.bgCard,
                      cursor: "pointer", transition: "background 0.1s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = sc.bg}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.bg : C.bgCard}
                    >
                      {[
                        a.rapport_numero,
                        a.composant,
                        a.grade_huile,
                        a.date_prelevement,
                        a.physico_chimique?.viscosite_40 != null
                          ? `${a.physico_chimique.viscosite_40} mm²/s` : "—",
                        a.physico_chimique?.tan != null
                          ? `${a.physico_chimique.tan} mgKOH/g` : "—",
                        a.metaux_usure?.fe != null ? `${a.metaux_usure.fe}` : "—",
                        a.particules?.code_iso_4406 || "—",
                        null,  // Machine status (custom render)
                        null,  // Lub status (custom render)
                      ].map((val, ci) => {
                        if (ci === 8) return (
                          <td key={ci} style={{ padding: "9px 12px" }}>
                            <StatusBadge status={a.etat_machine} />
                          </td>
                        )
                        if (ci === 9) return (
                          <td key={ci} style={{ padding: "9px 12px" }}>
                            <StatusBadge status={a.etat_lubrifiant} />
                          </td>
                        )
                        return (
                          <td key={ci} style={{
                            padding: "9px 12px", color: C.text,
                          }}>{val}</td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
