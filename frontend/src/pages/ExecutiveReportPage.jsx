import { useCallback, useState } from "react"
import { API , C} from "../config"



function tokenHeaders() {
  const token =
    localStorage.getItem("mineassist_token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("auth_token") ||
    sessionStorage.getItem("mineassist_token") ||
    sessionStorage.getItem("access_token") ||
    sessionStorage.getItem("token")
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function readJson(path, apiFetch = null) {
  const url = `${API}${path}`
  const res = apiFetch
    ? await apiFetch(url, { headers: tokenHeaders() })
    : await fetch(url, { headers: tokenHeaders() })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail || data?.message || `Erreur ${res.status}`)
  return data
}

function statusRank(status) {
  const s = String(status || "").toUpperCase()
  if (["CRITIQUE", "URGENCE", "CRITICAL"].includes(s)) return 3
  if (["MARGINALE", "PLANIFIÉE", "PLANIFIEE", "WARNING"].includes(s)) return 2
  if (["SURVEILLANCE", "ATTENTION"].includes(s)) return 1
  return 0
}

function oilScore(a) {
  if (!a) return 0
  const pc = a.physico_chimique || {}
  const mu = a.metaux_usure || {}
  const mc = a.metaux_contaminants || {}
  const par = a.particules || {}
  const ref = String(a.grade_huile || "").includes("80W90") ? 169 : 200
  let score = 100 - statusRank(a.etat_machine) * 12 - statusRank(a.etat_lubrifiant) * 12
  if (pc.viscosite_40 != null) {
    const gap = Math.abs(pc.viscosite_40 - ref) / ref
    if (gap > 0.20) score -= 22
    else if (gap > 0.10) score -= 10
  }
  if ((pc.tan || 0) > 2.4) score -= 10
  if ((mu.fe || 0) > 250) score -= 16
  else if ((mu.fe || 0) > 60) score -= 8
  if ((mc.si || 0) > 60) score -= 12
  else if ((mc.si || 0) > 30) score -= 6
  if ((par.n_sup_14um || 0) > 60000) score -= 12
  else if ((par.n_sup_14um || 0) > 15000) score -= 6
  return Math.max(0, Math.min(100, Math.round(score)))
}

function buildLocalReport(oilList = [], oilSummary = null, alertes = null) {
  const latest = new Map()
  oilList.forEach(a => { if (a?.composant && !latest.has(a.composant)) latest.set(a.composant, a) })
  const oils = [...latest.values()]
  const scores = oils.map(oilScore)
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : "N/A"
  const activeAlerts = alertes?.alertes_actives || alertes?.alertes || []
  const plan = []
  oils.forEach(a => {
    const score = oilScore(a)
    if (score < 75) plan.push({
      priorite: score < 45 ? "P1" : "P2",
      action: (a.recommandations || [])[0] || `Contrôler ${a.composant} et refaire un prélèvement`,
      delai: score < 45 ? "Immédiat" : "Sous 7 jours",
    })
  })
  activeAlerts.slice(0, 5).forEach(a => plan.push({
    priorite: "P1",
    action: a.action || a.recommandation || a.message || a.description || "Traiter l'alerte active",
    delai: "24-72h",
  }))
  if (!plan.length) plan.push({ priorite: "P3", action: "Continuer la surveillance conditionnelle périodique", delai: "Routine" })
  return {
    titre: "Rapport Exécutif MineAssist — Maintenance prédictive CAT 994F",
    generated_at: new Date().toISOString(),
    resume_executif: "MineAssist consolide les données capteurs, GMAO, analyses d'huile, alertes et modèles IA afin de fournir une aide à la décision pour la maintenance prédictive de la chargeuse CAT 994F.",
    indicateurs: {
      analyses_huile: oilList.length,
      composants_huile: oils.length,
      score_huile_moyen: avg,
      huile_critique: scores.filter(s => s < 45).length,
      huile_surveillance: scores.filter(s => s >= 45 && s < 75).length,
      alertes_actives: activeAlerts.length,
      composants_critiques: oilSummary?.critiques || 0,
    },
    plan_action: plan.slice(0, 8),
    tracabilite: {
      generation: "Frontend avec fallback local",
      source_huile: "/oil/analyses",
      source_alertes: "/pred/alertes si disponible",
      generated_by: "MineAssist Maintenance",
    },
  }
}

function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, boxShadow: "0 10px 30px rgba(30,42,36,.07)", ...style }}>{children}</div>
}

export default function ExecutiveReportPage({ apiFetch = null }) {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [fallback, setFallback] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true); setError(null); setFallback(false)
    try {
      const data = await readJson("/maintenance/report", apiFetch)
      setReport(data)
    } catch (e) {
      try {
        const [oilSummary, oilListRes, alertes] = await Promise.all([
          readJson("/oil/analyses/summary", apiFetch).catch(() => null),
          readJson("/oil/analyses", apiFetch).catch(() => ({ analyses: [] })),
          readJson("/pred/alertes", apiFetch).catch(() => null),
        ])
        setReport(buildLocalReport(oilListRes?.analyses || [], oilSummary, alertes))
        setFallback(true)
      } catch (fallbackError) {
        setError(fallbackError.message || e.message)
      }
    }
    setLoading(false)
  }, [])

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `rapport_executif_mineassist_${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return <div style={{ padding: "26px 30px", maxWidth: 1200, margin: "0 auto" }}>
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: C.orange, letterSpacing: 4, textTransform: "uppercase" }}>MineAssist · Reporting opérationnel</div>
      <h1 style={{ fontSize: 31, color: C.dark, margin: "4px 0", fontFamily: "Georgia, serif" }}>Rapport exécutif maintenance</h1>
      <div style={{ color: C.muted, fontSize: 13 }}>Synthèse machine, données, IA, huile, alertes, AMDEC et recommandations.</div>
    </div>

    <Card style={{ marginBottom: 16, borderLeft: `5px solid ${C.green}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: C.dark }}>Générer le rapport</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Le rapport consolide les données disponibles côté backend pour le pilotage maintenance.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={generate} disabled={loading} style={{ border: "none", background: loading ? C.muted : C.green, color: "white", borderRadius: 8, padding: "10px 18px", fontWeight: 900, cursor: loading ? "wait" : "pointer" }}>{loading ? "Génération..." : "Générer"}</button>
          {report && <button onClick={downloadJson} style={{ border: `1px solid ${C.border}`, background: C.card, color: C.dark, borderRadius: 8, padding: "10px 18px", fontWeight: 900, cursor: "pointer" }}>Télécharger JSON</button>}
        </div>
      </div>
    </Card>

    {fallback && <Card style={{ background: C.orangePale, borderLeft: `5px solid ${C.orange}`, color: C.orange, marginBottom: 16 }}>Mode local activé : le rapport a été généré depuis les endpoints existants. Pour le rapport backend complet, ajoutez le router `/maintenance/report` puis redémarrez FastAPI.</Card>}
    {error && <Card style={{ background: C.redPale, borderLeft: `5px solid ${C.red}`, color: C.red, marginBottom: 16 }}>Erreur : {error}</Card>}

    {report && <div style={{ display: "grid", gap: 16 }}>
      <Card><h2 style={{ color: C.dark, marginBottom: 10 }}>Résumé exécutif</h2><p style={{ color: C.text, lineHeight: 1.7 }}>{report.resume_executif}</p></Card>
      <Card><h2 style={{ color: C.dark, marginBottom: 10 }}>Indicateurs clés</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {Object.entries(report.indicateurs || {}).map(([k, v]) => <div key={k} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}><div style={{ color: C.muted, fontSize: 10, fontWeight: 900, letterSpacing: 1 }}>{k}</div><div style={{ color: C.dark, fontSize: 20, fontWeight: 900 }}>{String(v)}</div></div>)}
      </div></Card>
      <Card><h2 style={{ color: C.dark, marginBottom: 10 }}>Plan d'action priorisé</h2><ol style={{ paddingLeft: 20, color: C.text, lineHeight: 1.8 }}>{(report.plan_action || []).map((x, i) => <li key={i}><b>{x.priorite}</b> — {x.action} <span style={{ color: C.muted }}>({x.delai})</span></li>)}</ol></Card>
      <Card><h2 style={{ color: C.dark, marginBottom: 10 }}>Traçabilité</h2><pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: C.bg, border: `1px solid ${C.border}`, padding: 12, borderRadius: 8 }}>{JSON.stringify(report.tracabilite, null, 2)}</pre></Card>
    </div>}
  </div>
}
