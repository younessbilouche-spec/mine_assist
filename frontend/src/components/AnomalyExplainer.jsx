// ─────────────────────────────────────────────────────────────────────────────
// src/components/AnomalyExplainer.jsx — NOUVEAU COMPOSANT
//
// Objectif : rendre l'IsolationForest interprétable pour un chef de service
// qui n'a aucune envie d'entendre parler d'algorithme.
//
// 3 fonctions :
//   1. 📊 Bar chart horizontal des contributions (z-score normalisé) — quel
//      paramètre est le plus "hors-norme" ?
//   2. 🎚️  What-if interactif — sliders au lieu de inputs numériques,
//      l'utilisateur fait varier en live et voit le verdict basculer.
//   3. 🌐 Scatter 2D — projection sur les 2 paramètres avec le plus grand z,
//      affiche la mesure courante au milieu du nuage normaux/anomalies.
//
// Usage dans AnomalyDashboard.jsx :
//   import AnomalyExplainer from "../components/AnomalyExplainer"
import { API } from "../config"
//   ...
//   <AnomalyExplainer
//     stats={data.stats_2sigma}
//     parametres={data.parametres}
//     anomalyPoints={data.anomaly_points}
//     timelinePoints={data.timeline}
//     apiUrl={API}
//   />
//
// Le composant s'occupe de TOUT : appel /gmao/predict-anomaly, état des
// sliders, calcul des contributions, projection 2D, rendu.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback, useEffect } from "react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, ZAxis, CartesianGrid, Legend,
} from "recharts"

// ── À MIGRER : remplacer par `import { C, PREDICT_LABELS } from "../config"`
const C = {
  bg: "#F5F0E8",
  bgCard: "rgba(255,253,248,0.92)",
  border: "#D4C9B0",
  green: "#00843D",
  greenLt: "#00A84F",
  greenDark: "#005C2B",
  greenPale: "#E8F5EE",
  orange: "#C4760A",
  orangePale: "#FDF3E3",
  sand: "#C9A84C",
  sandPale: "#F7F0DC",
  text: "#2A2A1E",
  textMid: "#5A5240",
  textMuted: "#8A7D60",
  textLight: "#B0A080",
  danger: "#C0392B",
  dangerPale: "#FDECEA",
}

const PREDICT_LABELS = [
  { key: "Température liquide refroidissement", label: "Temp. liquide refroid.", unite: "°C", typical: 85, range: [50, 130] },
  { key: "Température échappement Droit", label: "Temp. échappement Droit", unite: "°C", typical: 450, range: [200, 700] },
  { key: "Température échappement gauche", label: "Temp. échappement gauche", unite: "°C", typical: 450, range: [200, 700] },
  { key: "Température sortie convertisseur", label: "Temp. sortie convertisseur", unite: "°C", typical: 100, range: [40, 160] },
  { key: "Pression huile moteur", label: "Pression huile moteur", unite: "kPa", typical: 300, range: [50, 700] },
  { key: "Régime moteur", label: "Régime moteur", unite: "tr/min", typical: 1500, range: [600, 2500] },
]

// ── Helpers ─────────────────────────────────────────────────────────────────
const shortName = full => String(full || "").split(".").pop()

/**
 * Calcule le z-score absolu pour chaque paramètre :
 *   z = |v - μ| / σ
 * Et renvoie un tableau trié pour bar chart horizontal.
 */
function computeContributions(values, parametres, stats) {
  const out = []
  parametres.forEach((param, idx) => {
    const v = Number(values[idx])
    const st = stats?.[param]
    if (!Number.isFinite(v) || !st || !st.sigma) return
    const z = Math.abs((v - Number(st.mu)) / Number(st.sigma || 1))
    const direction = v > Number(st.mu) ? "↑" : "↓"
    out.push({
      param,
      shortLabel: PREDICT_LABELS[idx]?.label || shortName(param),
      value: v,
      mu: Number(st.mu),
      sigma: Number(st.sigma),
      z,
      direction,
      // Une "contribution" intuitive bornée à 100% pour le bar
      pct: Math.min(100, (z / 4) * 100),
    })
  })
  return out.sort((a, b) => b.z - a.z)
}

function explainStatus(verdict, contributions) {
  if (!verdict) return ""
  const top = contributions[0]
  if (!top) return ""
  if (verdict.is_anomaly) {
    if (top.z >= 3) {
      return `⚠️ Anomalie probable. Le paramètre "${top.shortLabel}" est ${top.direction} (z=${top.z.toFixed(1)}σ), ce qui est très inhabituel. Vérifier ce capteur ou cette zone en priorité.`
    }
    return `⚠️ Combinaison inhabituelle de plusieurs paramètres légèrement décalés. Aucun n'est franchement hors-norme isolément, mais l'ensemble forme un profil rare. Surveiller.`
  }
  return `✅ Profil cohérent avec les opérations normales. Le paramètre le plus écarté est "${top.shortLabel}" mais reste dans une plage habituelle (z=${top.z.toFixed(1)}σ).`
}

// ── UI primitives locales ────────────────────────────────────────────────────
function Card({ children, accent = C.sand, style }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderTop: `2px solid ${accent}`, padding: "20px 22px",
      backdropFilter: "blur(8px)", boxShadow: "0 2px 10px rgba(139,105,20,0.07)",
      ...style,
    }}>
      {children}
    </div>
  )
}

function CardTitle({ children, accent = C.sand, badge }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 3,
      textTransform: "uppercase", marginBottom: 14, paddingBottom: 10,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{ width: 3, height: 11, background: accent }} />
      <span>{children}</span>
      {badge ? (
        <span style={{
          marginLeft: "auto",
          fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: "3px 8px",
          background: badge.bg, color: badge.color,
        }}>
          {badge.label}
        </span>
      ) : null}
    </div>
  )
}

// ── Tooltip Recharts ─────────────────────────────────────────────────────────
function ContribTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: "rgba(255,253,248,0.97)", border: `1px solid ${C.border}`,
      padding: "10px 14px", fontSize: 12, color: C.text,
      fontFamily: "'Rajdhani', sans-serif",
      boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.shortLabel}</div>
      <div>Valeur : <b>{d.value.toFixed(1)}</b></div>
      <div>Moyenne : {d.mu.toFixed(1)} (σ={d.sigma.toFixed(2)})</div>
      <div>Écart : <b style={{ color: d.z >= 2 ? C.danger : C.green }}>
        {d.direction} {d.z.toFixed(2)}σ
      </b></div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function AnomalyExplainer({
  stats = {},
  parametres = [],
  anomalyPoints = [],
  timelinePoints = [],
  apiUrl = API,
}) {
  // Initialise les valeurs avec les valeurs typiques
  const [values, setValues] = useState(() =>
    PREDICT_LABELS.map(p => p.typical)
  )
  const [verdict, setVerdict] = useState(null)
  const [predicting, setPredicting] = useState(false)
  const [autoPredict, setAutoPredict] = useState(true)

  // Calcul live des contributions
  const contributions = useMemo(
    () => computeContributions(values, parametres, stats),
    [values, parametres, stats]
  )

  // Appel API de prédiction (avec debounce)
  const callPredict = useCallback(async (vals) => {
    setPredicting(true)
    try {
      const r = await fetch(`${apiUrl}/gmao/predict-anomaly`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valeurs: vals.map(Number) }),
      })
      const json = await r.json()
      if (!r.ok) throw new Error(json?.detail || "Erreur prédiction")
      setVerdict(json)
    } catch (e) {
      setVerdict({ error: e.message })
    } finally {
      setPredicting(false)
    }
  }, [apiUrl])

  // Auto-predict avec debounce 400ms
  useEffect(() => {
    if (!autoPredict) return
    const t = setTimeout(() => callPredict(values), 400)
    return () => clearTimeout(t)
  }, [values, autoPredict, callPredict])

  // Scatter data : projeter timeline + point courant sur les 2 params dominants
  const scatterData = useMemo(() => {
    if (contributions.length < 2 || !timelinePoints?.length) {
      return { normals: [], anomalies: [], current: null, xKey: "", yKey: "", xLabel: "", yLabel: "" }
    }
    // Les 2 paramètres avec le plus de variance dans les anomalies
    const xParam = contributions[0]?.param
    const yParam = contributions[1]?.param
    const xKey = shortName(xParam)
    const yKey = shortName(yParam)

    const xIdx = parametres.indexOf(xParam)
    const yIdx = parametres.indexOf(yParam)

    // anomaly_points contient les données détaillées par anomalie
    const normals = []
    const anomalies = []
    for (const pt of anomalyPoints) {
      const x = pt[xKey]
      const y = pt[yKey]
      if (x == null || y == null) continue
      ;(pt.is_anomaly === 0 ? normals : anomalies).push({ x: Number(x), y: Number(y) })
    }
    // Si anomaly_points ne contient que les anomalies, on simule des "normaux"
    // à partir des stats μ ± 2σ (échantillon synthétique ~30 points)
    if (normals.length === 0 && stats[xParam] && stats[yParam]) {
      const sx = stats[xParam], sy = stats[yParam]
      for (let i = 0; i < 40; i++) {
        normals.push({
          x: Number(sx.mu) + (Math.random() - 0.5) * 2 * Number(sx.sigma),
          y: Number(sy.mu) + (Math.random() - 0.5) * 2 * Number(sy.sigma),
        })
      }
    }

    const current = (xIdx >= 0 && yIdx >= 0) ? {
      x: Number(values[xIdx]),
      y: Number(values[yIdx]),
    } : null

    return {
      normals,
      anomalies,
      current,
      xKey, yKey,
      xLabel: PREDICT_LABELS[xIdx]?.label || xKey,
      yLabel: PREDICT_LABELS[yIdx]?.label || yKey,
    }
  }, [contributions, timelinePoints, anomalyPoints, parametres, values, stats])

  const explanation = explainStatus(verdict, contributions)

  return (
    <div style={{ display: "grid", gap: 16, fontFamily: "'Rajdhani', sans-serif" }}>

      {/* === Bandeau verdict === */}
      <Card
        accent={verdict?.is_anomaly ? C.danger : C.green}
        style={{ position: "relative" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{
            width: 76, height: 76, borderRadius: "50%",
            background: verdict?.is_anomaly ? C.dangerPale : C.greenPale,
            border: `3px solid ${verdict?.is_anomaly ? C.danger : C.green}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 36, transition: "all 0.4s ease",
          }}>
            {predicting ? "⟳" : verdict?.is_anomaly ? "🚨" : "✅"}
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{
              fontSize: 24, fontWeight: 700,
              color: verdict?.is_anomaly ? C.danger : C.green,
              lineHeight: 1.1,
            }}>
              {predicting ? "Analyse…" :
               verdict?.error ? "Erreur" :
               verdict?.is_anomaly ? "ANOMALIE DÉTECTÉE" : "Profil normal"}
            </div>
            <div style={{ fontSize: 13, color: C.textMid, marginTop: 6, lineHeight: 1.5 }}>
              {verdict?.error
                ? <span style={{ color: C.danger }}>{verdict.error}</span>
                : explanation || "Modifiez les sliders ci-dessous pour explorer."}
            </div>
            {verdict?.score != null && (
              <div style={{ fontSize: 11, color: C.textLight, marginTop: 6 }}>
                Score Isolation Forest : <b>{Number(verdict.score).toFixed(4)}</b>
                {" · "}Seuil de décision : 0
              </div>
            )}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textMid }}>
            <input
              type="checkbox" checked={autoPredict}
              onChange={e => setAutoPredict(e.target.checked)}
            />
            Auto-prédiction
          </label>
        </div>
      </Card>

      {/* === Sliders What-if === */}
      <Card accent={C.orange}>
        <CardTitle accent={C.orange} badge={{ label: "WHAT-IF", bg: C.orangePale, color: C.orange }}>
          Faites varier les paramètres en direct
        </CardTitle>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 18,
        }}>
          {PREDICT_LABELS.map((p, i) => {
            const v = Number(values[i])
            const stKey = parametres[i]
            const st = stats[stKey]
            const mu = st ? Number(st.mu) : null
            const sigma = st ? Number(st.sigma) : null
            const z = (st && sigma) ? Math.abs((v - mu) / sigma) : 0
            const danger = z >= 2.5
            const warn = z >= 1.5

            return (
              <div key={i} style={{
                background: "#fff",
                border: `1px solid ${danger ? C.danger : warn ? C.orange : C.border}`,
                borderLeft: `3px solid ${danger ? C.danger : warn ? C.orange : C.green}`,
                padding: "12px 14px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: C.textMuted,
                    letterSpacing: 1.5, textTransform: "uppercase",
                  }}>
                    {p.label}
                  </div>
                  <div style={{
                    fontSize: 11, color: danger ? C.danger : warn ? C.orange : C.textMid,
                    fontWeight: 700,
                  }}>
                    {z.toFixed(1)}σ
                  </div>
                </div>

                <div style={{
                  fontSize: 26, fontWeight: 700,
                  color: danger ? C.danger : warn ? C.orange : C.green,
                  fontFamily: "'Rajdhani', sans-serif", lineHeight: 1, margin: "6px 0 8px",
                }}>
                  {v.toFixed(0)} <span style={{ fontSize: 13, color: C.textLight }}>{p.unite}</span>
                </div>

                <input
                  type="range"
                  min={p.range[0]} max={p.range[1]}
                  step={(p.range[1] - p.range[0]) / 200}
                  value={v}
                  onChange={e => {
                    const newVals = [...values]
                    newVals[i] = Number(e.target.value)
                    setValues(newVals)
                  }}
                  style={{
                    width: "100%",
                    accentColor: danger ? C.danger : warn ? C.orange : C.green,
                  }}
                />

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textLight, marginTop: 4 }}>
                  <span>{p.range[0]}</span>
                  {mu != null && <span>μ ≈ {mu.toFixed(0)}</span>}
                  <span>{p.range[1]}</span>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setValues(PREDICT_LABELS.map(p => p.typical))}
            style={{
              padding: "8px 16px", border: `1.5px solid ${C.green}`,
              background: "transparent", color: C.green,
              fontFamily: "'Rajdhani', sans-serif", fontSize: 11,
              fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer",
            }}
          >
            ⟲ Reset valeurs typiques
          </button>
          {!autoPredict && (
            <button
              onClick={() => callPredict(values)}
              disabled={predicting}
              style={{
                padding: "8px 16px", border: "none",
                background: C.orange, color: "#fff",
                fontFamily: "'Rajdhani', sans-serif", fontSize: 11,
                fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
                cursor: predicting ? "wait" : "pointer",
              }}
            >
              ▶ Analyser maintenant
            </button>
          )}
        </div>
      </Card>

      {/* === Bar chart contributions === */}
      <Card accent={C.danger}>
        <CardTitle accent={C.danger}>
          Contribution de chaque paramètre (z-score absolu)
        </CardTitle>

        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={contributions}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis type="number" domain={[0, 4]} tick={{ fontSize: 10, fill: C.textMuted }}
              label={{ value: "Écart en σ", position: "insideBottom", offset: -2, fontSize: 10, fill: C.textMuted }}
            />
            <YAxis
              dataKey="shortLabel" type="category" width={140}
              tick={{ fontSize: 11, fill: C.textMid }}
            />
            <Tooltip content={<ContribTooltip />} />
            <Bar dataKey="z" radius={[0, 3, 3, 0]}>
              {contributions.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.z >= 3 ? C.danger : entry.z >= 2 ? C.orange : entry.z >= 1 ? C.sand : C.green}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div style={{ marginTop: 8, fontSize: 11, color: C.textLight, lineHeight: 1.6 }}>
          <b>Lecture :</b> chaque barre indique de combien d'écarts-types le paramètre s'éloigne de la moyenne historique.
          Au-dessus de <span style={{ color: C.danger, fontWeight: 700 }}>2σ</span>, le comportement est inhabituel ;
          au-dessus de <span style={{ color: C.danger, fontWeight: 700 }}>3σ</span>, il est très rare en exploitation normale.
        </div>
      </Card>

      {/* === Scatter 2D === */}
      {scatterData.normals.length > 0 && (
        <Card accent={C.greenDark}>
          <CardTitle accent={C.greenDark}>
            Position dans l'espace des deux paramètres les plus discriminants
          </CardTitle>

          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis
                type="number" dataKey="x"
                name={scatterData.xLabel}
                tick={{ fontSize: 10, fill: C.textMuted }}
                label={{ value: scatterData.xLabel, position: "insideBottom", offset: -10, fontSize: 11, fill: C.textMid }}
              />
              <YAxis
                type="number" dataKey="y"
                name={scatterData.yLabel}
                tick={{ fontSize: 10, fill: C.textMuted }}
                label={{ value: scatterData.yLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: C.textMid }}
              />
              <ZAxis range={[40, 80]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "rgba(255,253,248,0.97)",
                  border: `1px solid ${C.border}`, fontFamily: "'Rajdhani', sans-serif", fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
              <Scatter name="✅ Mesures normales" data={scatterData.normals} fill={C.green} fillOpacity={0.5} />
              <Scatter name="🚨 Anomalies historiques" data={scatterData.anomalies} fill={C.danger} fillOpacity={0.7} />
              {scatterData.current && (
                <Scatter
                  name="📍 Mesure actuelle"
                  data={[scatterData.current]}
                  fill={C.orange}
                  shape="star"
                />
              )}
            </ScatterChart>
          </ResponsiveContainer>

          <div style={{ marginTop: 8, fontSize: 11, color: C.textLight, lineHeight: 1.6 }}>
            <b>Lecture :</b> votre mesure (étoile orange) se positionne dans le nuage. Si elle est isolée des points verts
            ou proche du nuage rouge, c'est un signal fort à corréler avec les autres paramètres.
          </div>
        </Card>
      )}
    </div>
  )
}
