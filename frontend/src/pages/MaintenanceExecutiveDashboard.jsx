import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart, Bar, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { API , C} from "../config"
import { getOcpAlertes, getOcpEngineHealth, runOcpPrediction, getOcpUploadStatus } from "../services/ocpApi"



function errorText(value) {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(errorText).filter(Boolean).join(" | ")
  if (typeof value === "object") return errorText(value.detail || value.message || value.msg) || JSON.stringify(value)
  return String(value)
}

async function apiFetch(path) {
  const token = localStorage.getItem("mineassist_token") || localStorage.getItem("token") || localStorage.getItem("access_token")
  const res = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(errorText(body?.detail || body?.message || body) || `Erreur ${res.status}`)
  return body
}

function statusRank(status) {
  const s = String(status || "").toUpperCase()
  if (["CRITIQUE", "URGENCE", "CRITICAL"].includes(s)) return 3
  if (["MARGINALE", "PLANIFIÉE", "PLANIFIEE", "WARNING"].includes(s)) return 2
  if (["SURVEILLANCE", "ATTENTION"].includes(s)) return 1
  return 0
}

function statusLabel(rank) {
  return ["NORMALE", "SURVEILLANCE", "PLANIFIÉE", "CRITIQUE"][Math.max(0, Math.min(3, rank))]
}

function statusColors(status) {
  const rank = typeof status === "number" ? status : statusRank(status)
  if (rank >= 3) return { bg: C.redPale, text: C.red }
  if (rank === 2) return { bg: C.amberPale, text: C.amber }
  if (rank === 1) return { bg: C.bluePale, text: C.blue }
  return { bg: C.greenPale, text: C.green }
}

function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, boxShadow: "0 10px 30px rgba(30,42,36,.07)", ...style }}>{children}</div>
}

function SectionTitle({ icon, title, sub }) {
  return <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 10, fontWeight: 900, color: C.orange, letterSpacing: 3, textTransform: "uppercase" }}>{icon} {title}</div>
    {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{sub}</div>}
  </div>
}

function StatusBadge({ status }) {
  const rank = typeof status === "number" ? status : statusRank(status)
  const sc = statusColors(rank)
  return <span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.text}33`, borderRadius: 999, padding: "3px 9px", fontSize: 10, fontWeight: 900, letterSpacing: 1 }}>{statusLabel(rank)}</span>
}

function Kpi({ title, value, sub, status, icon }) {
  const sc = status != null ? statusColors(status) : { bg: C.greenPale, text: C.green }
  return <Card style={{ minWidth: 210, flex: 1, borderLeft: `5px solid ${sc.text}` }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <div>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>{title}</div>
        <div style={{ fontSize: 34, fontWeight: 900, color: sc.text, lineHeight: 1.1, marginTop: 6 }}>{value}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{sub}</div>
      </div>
      <div style={{ fontSize: 28 }}>{icon}</div>
    </div>
  </Card>
}

function getProb(prediction) {
  return prediction?.probability_1d ?? prediction?.probabilite_1j ?? prediction?.probability ?? prediction?.proba ?? prediction?.prediction?.probability ?? null
}

function oilScore(a) {
  if (!a) return 0
  const pc = a.physico_chimique || {}
  const mu = a.metaux_usure || {}
  const mc = a.metaux_contaminants || {}
  const par = a.particules || {}
  const grade = String(a.grade_huile || "")
  const ref = grade.includes("80W90") ? 169 : 200
  let score = 100 - statusRank(a.etat_machine) * 12 - statusRank(a.etat_lubrifiant) * 12
  if (pc.viscosite_40 != null) {
    const gap = Math.abs(pc.viscosite_40 - ref) / ref
    if (gap > .2) score -= 22
    else if (gap > .1) score -= 10
  }
  if ((pc.tan || 0) > 2.4) score -= 10
  if ((mu.fe || 0) > 250) score -= 16
  else if ((mu.fe || 0) > 60) score -= 8
  if ((mu.cu || 0) > 900) score -= 14
  else if ((mu.cu || 0) > 150) score -= 7
  if ((mc.si || 0) > 60) score -= 12
  else if ((mc.si || 0) > 30) score -= 6
  if ((par.n_sup_14um || 0) > 60000) score -= 12
  else if ((par.n_sup_14um || 0) > 15000) score -= 6
  return Math.max(0, Math.min(100, Math.round(score)))
}

function rpnItem({ source, equipement, mode, cause, action, gravite, probabilite, detectabilite, delai, responsable }) {
  return { source, equipement, mode, cause, action, gravite, probabilite, detectabilite, rpn: gravite * probabilite * detectabilite, delai, responsable }
}

export default function MaintenanceExecutiveDashboard({ apiFetch: ocpFetch, onNavigate }) {
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState([])
  const [data, setData] = useState({ oilSummary: null, oilList: [], alertes: null, health: null, prediction: null, upload: null })

  const load = useCallback(async () => {
    setLoading(true)
    const next = { oilSummary: null, oilList: [], alertes: null, health: null, prediction: null, upload: null }
    const errs = []
    await Promise.all([
      apiFetch("/oil/analyses/summary").then(v => next.oilSummary = v).catch(e => errs.push(`Huile summary: ${e.message}`)),
      apiFetch("/oil/analyses").then(v => next.oilList = v.analyses || []).catch(e => errs.push(`Huile liste: ${e.message}`)),
      getOcpAlertes(ocpFetch).then(v => next.alertes = v).catch(e => errs.push(`OCP alertes: ${e.message}`)),
      getOcpEngineHealth(ocpFetch).then(v => next.health = v).catch(e => errs.push(`OCP santé: ${e.message}`)),
      runOcpPrediction(ocpFetch).then(v => next.prediction = v).catch(e => errs.push(`LSTM: ${e.message}`)),
      getOcpUploadStatus(ocpFetch).then(v => next.upload = v).catch(e => errs.push(`Upload OCP: ${e.message}`)),
    ])
    setData(next)
    setErrors(errs)
    setLoading(false)
  }, [ocpFetch])

  useEffect(() => { load() }, [load])

  const oilLatest = useMemo(() => {
    const map = new Map()
    data.oilList.forEach(a => { if (a?.composant && !map.has(a.composant)) map.set(a.composant, a) })
    return [...map.values()]
  }, [data.oilList])

  const oilAvg = oilLatest.length ? Math.round(oilLatest.reduce((s, a) => s + oilScore(a), 0) / oilLatest.length) : null
  const activeAlerts = data.alertes?.alertes_actives || data.alertes?.alertes || []
  const interventions = data.alertes?.plan_interventions || data.alertes?.interventions || []
  const rulProb = data.prediction?.prediction_rul?.rul_heures?.global_grav2 != null
    ? Math.max(0, 1 - data.prediction.prediction_rul.rul_heures.global_grav2 / 168)
    : getProb(data.prediction)
  const globalRank = Math.max(
    statusRank(data.health?.etat_global || data.health?.status),
    activeAlerts.length ? 2 : 0,
    data.oilSummary?.critiques ? 3 : data.oilSummary?.marginales ? 2 : 0,
    rulProb != null ? (rulProb >= .75 ? 3 : rulProb >= .45 ? 2 : rulProb >= .25 ? 1 : 0) : 0,
  )

  const rpn = useMemo(() => {
    const items = []
    oilLatest.forEach(a => {
      const score = oilScore(a)
      if (score < 85) items.push(rpnItem({
        source: "Huile OKSA", equipement: a.composant, mode: `Dégradation huile (${score}/100)`,
        cause: (a.alertes || [])[0] || "Usure/contamination probable", action: (a.recommandations || [])[0] || "Contrôle + rééchantillonnage",
        gravite: score < 45 ? 5 : score < 65 ? 4 : 3, probabilite: score < 45 ? 5 : score < 65 ? 4 : 3,
        detectabilite: 2, delai: score < 45 ? "Immédiat" : "Sous 7 jours", responsable: "Maintenance + Labo",
      }))
    })
    activeAlerts.slice(0, 6).forEach(a => {
      const urgency = statusRank(a.urgence || a.niveau || a.status || a.etat)
      items.push(rpnItem({
        source: "Capteurs/IF", equipement: a.capteur || a.composant || a.type || "CAT 994F", mode: a.titre || a.message || a.description || "Alerte active",
        cause: a.cause || a.valeur || "Dépassement seuil / probabilité panne", action: a.action || a.recommandation || "Inspecter et appliquer plan OCP",
        gravite: urgency >= 3 ? 5 : urgency === 2 ? 4 : 3, probabilite: urgency >= 3 ? 5 : 4, detectabilite: 2,
        delai: urgency >= 3 ? "Immédiat" : "24-72h", responsable: "Maintenance OCP",
      }))
    })
    interventions.slice(0, 5).forEach(it => items.push(rpnItem({
      source: "Plan OCP", equipement: it.equipement || it.capteur || "CAT 994F", mode: it.titre || it.intervention || it.action || "Intervention planifiée",
      cause: it.cause || it.justification || "Alerte corrélée", action: it.action || it.description || it.tache || "Exécuter intervention",
      gravite: 4, probabilite: 4, detectabilite: 2, delai: it.delai || it.echeance || "Planifiée", responsable: it.responsable || "Chef maintenance",
    })))
    if (rulProb != null && rulProb >= .25) items.push(rpnItem({
      source: "Health Score", equipement: "CAT 994F", mode: `Probabilité panne ${Math.round(rulProb * 100)}%`, cause: "Signature temporelle anormale", action: "Vérifier capteurs critiques + réduire intervalle inspection",
      gravite: rulProb >= .75 ? 5 : 4, probabilite: rulProb >= .75 ? 5 : 4, detectabilite: 3, delai: rulProb >= .75 ? "Immédiat" : "Sous 48h", responsable: "Fiabilité",
    }))
    return items.sort((a, b) => b.rpn - a.rpn).slice(0, 10)
  }, [oilLatest, activeAlerts, interventions, rulProb])

  const oilChart = oilLatest.map(a => ({ composant: a.composant, score: oilScore(a), risque: 100 - oilScore(a), fe: a.metaux_usure?.fe || 0, si: a.metaux_contaminants?.si || 0 }))
  const trend = data.oilList.slice().reverse().slice(-12).map(a => ({ date: a.date_prelevement || a.rapport_numero, score: oilScore(a), fe: a.metaux_usure?.fe || 0 }))

  return <div style={{ padding: "26px 30px", maxWidth: 1480, margin: "0 auto" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-end", marginBottom: 22, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 900, color: C.orange, letterSpacing: 4, textTransform: "uppercase" }}>MineAssist · Pilotage Maintenance</div>
        <h1 style={{ fontSize: 32, color: C.dark, margin: "4px 0", fontFamily: "Georgia, serif" }}>Vue 360° CAT 994F</h1>
        <div style={{ color: C.muted, fontSize: 13 }}>Maintenance prédictive · GMAO · Capteurs · Health Score · Analyse huiles · Aide à la décision</div>
      </div>
      <button onClick={load} style={{ border: "none", background: C.green, color: "white", borderRadius: 8, padding: "10px 18px", fontWeight: 900, cursor: "pointer" }}>{loading ? "Chargement..." : "Actualiser"}</button>
    </div>

    {errors.length > 0 && <Card style={{ marginBottom: 16, background: C.amberPale, borderLeft: `5px solid ${C.amber}` }}>
      <SectionTitle icon="⚠" title="Données partiellement disponibles" sub="La synthèse reste exploitable, mais certains modules ne répondent pas." />
      <div style={{ fontSize: 12, color: C.muted }}>{errors.slice(0, 4).join(" · ")}</div>
    </Card>}

    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <Kpi title="État global" value={<StatusBadge status={globalRank} />} sub="pire état détecté" status={globalRank} icon="🏭" />
      <Kpi title="Santé huile" value={oilAvg == null ? "—" : `${oilAvg}/100`} sub={`${oilLatest.length} composant(s) suivis`} status={oilAvg == null ? 0 : oilAvg < 45 ? 3 : oilAvg < 70 ? 2 : 0} icon="🛢" />
      <Kpi title="Alertes actives" value={activeAlerts.length} sub="capteurs, seuils et LSTM" status={activeAlerts.length ? 2 : 0} icon="🚨" />
      <Kpi title="Risque ML" value={rulProb == null ? "—" : `${Math.round(rulProb * 100)}%`} sub="risque panne court terme" status={rulProb == null ? 0 : rulProb >= .75 ? 3 : rulProb >= .45 ? 2 : 1} icon="🔮" />
      <Kpi title="Fichier OCP" value={data.upload?.has_file || data.upload?.file_exists ? "OK" : "—"} sub={data.upload?.filename || "dernier Excel capteurs"} status={data.upload?.has_file || data.upload?.file_exists ? 0 : 1} icon="📁" />
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1.25fr .75fr", gap: 16, marginBottom: 16 }} className="grid-2col">
      <Card>
        <SectionTitle icon="🧮" title="Matrice AMDEC / RPN" sub="RPN = Gravité × Probabilité × Détectabilité — priorisation maintenance" />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: C.dark, color: "white" }}>{["Rang", "Source", "Équipement", "Mode", "RPN", "Délai", "Action"].map(h => <th key={h} style={{ padding: "9px 10px", textAlign: "left", fontSize: 10, letterSpacing: 1 }}>{h}</th>)}</tr></thead>
            <tbody>{(rpn.length ? rpn : [rpnItem({ source: "Système", equipement: "CAT 994F", mode: "Aucun risque critique", cause: "Données normales", action: "Continuer surveillance", gravite: 1, probabilite: 1, detectabilite: 1, delai: "Routine", responsable: "Maintenance" })]).map((it, i) => {
              const sc = statusColors(it.rpn >= 40 ? 3 : it.rpn >= 24 ? 2 : it.rpn >= 12 ? 1 : 0)
              return <tr key={i} style={{ background: i % 2 ? C.card : C.bg }}>
                <td style={{ padding: "9px 10px", fontWeight: 900 }}>{i + 1}</td><td style={{ padding: "9px 10px" }}>{it.source}</td><td style={{ padding: "9px 10px", fontWeight: 800 }}>{it.equipement}</td><td style={{ padding: "9px 10px" }}>{it.mode}</td>
                <td style={{ padding: "9px 10px", color: sc.text, fontWeight: 900 }}>{it.rpn}</td><td style={{ padding: "9px 10px" }}>{it.delai}</td><td style={{ padding: "9px 10px", color: C.muted }}>{it.action}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </Card>
      <Card style={{ borderLeft: `5px solid ${statusColors(globalRank).text}` }}>
        <SectionTitle icon="📌" title="Décision maintenance" sub="Ce que le chef maintenance doit faire" />
        <div style={{ fontSize: 22, color: statusColors(globalRank).text, fontWeight: 900, marginBottom: 10 }}>{globalRank >= 3 ? "Intervention immédiate" : globalRank === 2 ? "Planifier intervention" : globalRank === 1 ? "Surveillance renforcée" : "Exploitation normale"}</div>
        <ol style={{ paddingLeft: 18, color: C.text, fontSize: 13, lineHeight: 1.7 }}>
          {(rpn.length ? rpn.slice(0, 4).map(x => x.action) : ["Continuer la surveillance périodique", "Garder l'historique capteurs et huile à jour", "Exporter le rapport hebdomadaire"]).map((a, i) => <li key={i}>{a}</li>)}
        </ol>
        <button onClick={() => onNavigate?.("alertes_ocp")} style={{ marginTop: 14, border: "none", background: C.dark, color: "white", borderRadius: 8, padding: "9px 14px", fontWeight: 900, cursor: "pointer" }}>Voir alertes & plan</button>
      </Card>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }} className="grid-2col">
      <Card>
        <SectionTitle icon="🛢" title="Risque huile par composant" sub="Dernières analyses OKSA" />
        <ResponsiveContainer width="100%" height={260}><BarChart data={oilChart}><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="composant" tick={{ fontSize: 11 }}/><YAxis domain={[0, 100]} tick={{ fontSize: 10 }}/><Tooltip/><Legend/><Bar dataKey="risque" name="Risque huile %" radius={[5,5,0,0]}>{oilChart.map((d, i) => <Cell key={i} fill={d.score < 45 ? C.red : d.score < 70 ? C.amber : C.green}/>)}</Bar></BarChart></ResponsiveContainer>
      </Card>
      <Card>
        <SectionTitle icon="📈" title="Tendance huile" sub="Score et Fe sur les derniers rapports" />
        <ResponsiveContainer width="100%" height={260}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="date" tick={{ fontSize: 10 }}/><YAxis tick={{ fontSize: 10 }}/><Tooltip/><Legend/><Line type="monotone" dataKey="score" name="Score huile" stroke={C.green} strokeWidth={2}/><Line type="monotone" dataKey="fe" name="Fe mg/kg" stroke={C.red} strokeWidth={2}/></LineChart></ResponsiveContainer>
      </Card>
    </div>

    <Card>
      <SectionTitle icon="🔎" title="Traçabilité opérationnelle" sub="Informations à montrer dans le rapport et la soutenance" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }} className="grid-4col">
        {[{ k: "Machine", v: "CAT 994F2 · OCP Benguerir" }, { k: "Données", v: "Capteurs Excel + PDF OKSA + GMAO" }, { k: "IA", v: "Health Score + Isolation Forest + K-Means + RAG" }, { k: "Décision", v: "AMDEC/RPN + plan maintenance" }].map(x => <div key={x.k} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}><div style={{ fontSize: 10, color: C.muted, fontWeight: 900, letterSpacing: 2 }}>{x.k}</div><div style={{ fontSize: 13, color: C.text, fontWeight: 800, marginTop: 5 }}>{x.v}</div></div>)}
      </div>
    </Card>
  </div>
}
