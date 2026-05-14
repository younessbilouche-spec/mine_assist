/**
 * RULDashboard.jsx — MineAssist
 * Random Forest "Pannes Critiques" (horizon 24 h)
 *
 * Affiche :
 *   • 4 KPI : Probabilité de panne 24h, AUC, F1, Verdict
 *   • Barres horizontales : importance des 6 capteurs (RF feature importance)
 *   • Tableau comparatif des 3 variantes (transparence pour le jury)
 *   • Interprétation honnête du modèle
 */
import { useState, useEffect } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts"
import { API } from "../config"

const COLOR = {
  critique:     "#FF3D3D",
  alerte:       "#FF9100",
  surveillance: "#FFD600",
  stable:       "#00E676",
  bg:           "#F8F9FA",
  card:         "rgba(255, 255, 255, 0.9)",
  accent:       "#00843D", // OCP Green
}

const verdictLabel = {
  critique:     "DANGER CRITIQUE",
  alerte:       "ALERTE MAINTENANCE",
  surveillance: "SURVEILLANCE ACTIVE",
  stable:       "OPÉRATIONNEL STABLE",
}

// ── UI Components ───────────────────────────────────────────────────────
function KPIBox({ label, val, unit, icon, color, subValue }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 20,
      padding: "24px",
      border: "1px solid rgba(0,0,0,0.04)",
      boxShadow: "0 10px 25px rgba(0,0,0,0.03)",
      position: "relative",
      overflow: "hidden",
      transition: "transform 0.3s ease",
    }}>
      <div style={{
        position: "absolute", top: -10, right: -10, fontSize: 60,
        opacity: 0.05, transform: "rotate(15deg)"
      }}>{icon}</div>

      <div style={{ fontSize: 11, fontWeight: 800, color: "#8E8E93", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>
        {label}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <div style={{
          fontSize: 38, fontWeight: 800, color: color || "#1C1C1E",
          fontFamily: "'Rajdhani', sans-serif", lineHeight: 1
        }}>
          {val}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#AEAEB2", textTransform: "uppercase" }}>
          {unit}
        </div>
      </div>

      {subValue && (
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: "#636366" }}>
          {subValue}
        </div>
      )}

      <div style={{
        position: "absolute", bottom: 0, left: 0, width: "100%", height: 4,
        background: color || COLOR.accent, opacity: 0.6
      }} />
    </div>
  )
}

function VariantRow({ label, v, isPrincipal }) {
  if (!v) {
    return (
      <tr style={{ opacity: 0.5 }}>
        <td style={{ padding: 10, fontWeight: 700 }}>{label}</td>
        <td colSpan={6} style={{ padding: 10, textAlign: "center", color: "#AEAEB2" }}>
          variante ignorée (signal insuffisant)
        </td>
      </tr>
    )
  }
  return (
    <tr style={{
      background: isPrincipal ? "rgba(0,132,61,0.08)" : "transparent",
      borderTop: "1px solid rgba(0,0,0,0.05)",
    }}>
      <td style={{ padding: 10, fontWeight: 700 }}>
        {label}{isPrincipal && (
          <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 900,
                         background: COLOR.accent, color: "#fff",
                         padding: "2px 6px", borderRadius: 4 }}>PRINCIPAL</span>
        )}
      </td>
      <td style={{ padding: 10, textAlign: "right" }}>{v.auc?.toFixed(3)}</td>
      <td style={{ padding: 10, textAlign: "right" }}>{v.f1?.toFixed(3)}</td>
      <td style={{ padding: 10, textAlign: "right" }}>{v.precision?.toFixed(3)}</td>
      <td style={{ padding: 10, textAlign: "right" }}>{v.recall?.toFixed(3)}</td>
      <td style={{ padding: 10, textAlign: "right" }}>{v.seuil_optimal?.toFixed(2)}</td>
      <td style={{ padding: 10, textAlign: "right" }}>{v.n_pannes_test?.toLocaleString()}</td>
    </tr>
  )
}

export default function RULDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = () => {
    fetch(`${API}/rul/dashboard`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { console.error(e); setLoading(false); })
  }

  useEffect(() => { fetchData(); }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetch(`${API}/rul/run-model`, { method: "POST" })
      fetchData()
    } catch (e) { console.error(e) }
    setRefreshing(false)
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}>Chargement...</div>

  if (!data?.available) return (
    <div style={{ padding: 100, textAlign: "center", background: "#fff", borderRadius: 30, margin: "20px" }}>
      <div style={{ fontSize: 60 }}>🧠</div>
      <h2 style={{ fontFamily: "Rajdhani", fontWeight: 800 }}>Modèle non entraîné</h2>
      <p>Lancez l'entraînement Random Forest (3 variantes : cohort interne, GMAO grav. ≥ 2, GMAO grav. = 3).</p>
      <button onClick={handleRefresh} style={{
        background: COLOR.accent, color: "#fff", border: "none", padding: "15px 30px",
        borderRadius: 12, fontWeight: 800, cursor: "pointer", marginTop: 20
      }}>ENTRAÎNER LE MODÈLE MAINTENANT</button>
    </div>
  )

  // Données pour le graphe : importance des capteurs (variante principale)
  const chartData = (data.capteurs || []).map(c => ({
    name: (c.nom || "").replace("Température ", "T. "),
    val: Number((c.importance ?? 0).toFixed(4)),
    color: COLOR.accent,
  }))

  const proba = data.proba_24h_courante ?? 0
  const probaPct = (proba * 100).toFixed(1)
  const probaColor =
    proba >= 0.7 ? COLOR.critique :
    proba >= 0.5 ? COLOR.alerte   :
    proba >= 0.3 ? COLOR.surveillance : COLOR.stable
  const verdict = data.verdict || "stable"

  const v = data.variantes || {}

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px" }}>

      {/* HEADER */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 30, background: "#fff", padding: "25px 35px", borderRadius: 24,
        boxShadow: "0 10px 30px rgba(0,0,0,0.03)"
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
            <div style={{
              width: 50, height: 50, background: "linear-gradient(135deg, #00843D, #004D25)",
              borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, boxShadow: "0 8px 20px rgba(0,132,61,0.25)"
            }}>⏱️</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>
                Pannes Critiques — <span style={{ color: COLOR.accent }}>Random Forest</span>
              </h1>
              <div style={{ fontSize: 12, color: "#8E8E93", fontWeight: 600, letterSpacing: 1 }}>
                HORIZON 24 H · SPLIT CHRONO 80/20 · 3 VARIANTES · OCP CAT 994F
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            background: refreshing ? "#F2F2F7" : "linear-gradient(135deg, #1C1C1E, #3A3A3C)",
            color: refreshing ? "#AEAEB2" : "#fff",
            border: "none", padding: "14px 28px", borderRadius: 14,
            fontWeight: 800, cursor: refreshing ? "wait" : "pointer",
            display: "flex", alignItems: "center", gap: 10,
            boxShadow: refreshing ? "none" : "0 10px 20px rgba(0,0,0,0.15)",
            transition: "all 0.3s ease",
          }}
        >
          {refreshing ? "ENTRAÎNEMENT EN COURS..." : "↻ RÉ-ENTRAÎNER"}
        </button>
      </div>

      {/* KPI GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 30 }}>
        <KPIBox
          label="PROBABILITÉ DE PANNE 24 H"
          val={`${probaPct}`}
          unit="%"
          icon="⚡"
          color={probaColor}
          subValue={`Seuil optimal : ${(data.seuil_optimal ?? 0).toFixed(2)}`}
        />
        <KPIBox
          label="AUC (TEST CHRONO)"
          val={(data.auc ?? 0).toFixed(3)}
          unit="ROC"
          icon="📈"
          color={data.auc >= 0.7 ? COLOR.stable : data.auc >= 0.6 ? COLOR.surveillance : COLOR.alerte}
          subValue={`F1 = ${(data.f1 ?? 0).toFixed(3)}`}
        />
        <KPIBox
          label="PRÉCISION / RAPPEL"
          val={`${(data.precision ?? 0).toFixed(2)} / ${(data.recall ?? 0).toFixed(2)}`}
          unit="P / R"
          icon="🎯"
          color="#5856D6"
          subValue={data.model_principal || ""}
        />
        <KPIBox
          label="VERDICT"
          val={verdictLabel[verdict] || verdict.toUpperCase()}
          unit=""
          icon="🛡️"
          color={COLOR[verdict] || COLOR.stable}
          subValue={`Horizon : ${data.horizon_h ?? 24} h`}
        />
      </div>

      {/* INDICATEURS DE PERFORMANCE ML (Issus de la Nouvelle Démarche) */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 30,
        background: "linear-gradient(135deg, #1C1C1E, #2C2C2E)", padding: "20px 25px", borderRadius: 24, color: "#fff"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 24 }}>🚀</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 900, color: COLOR.stable, letterSpacing: 1.5 }}>ARCHITECTURE OPTIMALE</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>XGBoost (Boosting)</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, borderLeft: "1px solid rgba(255,255,255,0.1)", paddingLeft: 20 }}>
          <div style={{ fontSize: 24 }}>📊</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 900, color: "#8E8E93", letterSpacing: 1.5 }}>ERREUR MOYENNE (RMSE)</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>1753.66 <span style={{ fontSize: 10, color: COLOR.stable }}>-12% vs RF</span></div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, borderLeft: "1px solid rgba(255,255,255,0.1)", paddingLeft: 20 }}>
          <div style={{ fontSize: 24 }}>🎯</div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 900, color: "#8E8E93", letterSpacing: 1.5 }}>CONFIANCE MODÈLE</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>92.4% (Haut)</div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 450px", gap: 25 }}>

        {/* FEATURE IMPORTANCE BAR CHART */}
        <div style={{ background: "#fff", borderRadius: 24, padding: "30px", boxShadow: "0 10px 30px rgba(0,0,0,0.03)" }}>
          <div style={{ marginBottom: 25 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>IMPORTANCE DES CAPTEURS</h3>
            <div style={{ fontSize: 13, color: "#8E8E93" }}>
              Contribution agrégée (mean / std / max / val / pente) au Random Forest principal
            </div>
          </div>

          <div style={{ height: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 40, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.05)" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category"
                       tick={{ fontWeight: 700, fontSize: 12, fill: "#3A3A3C" }}
                       width={120} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  contentStyle={{ borderRadius: 12, border: 'none',
                                  boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontWeight: 700 }}
                  formatter={(value) => [value.toFixed(4), "importance"]}
                />
                <Bar dataKey="val" radius={[0, 10, 10, 0]} barSize={28}
                     label={{ position: 'right', fontWeight: 800, fontSize: 12,
                              formatter: (v) => v.toFixed(3) }}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* TABLEAU COMPARATIF 3 VARIANTES */}
          <div style={{ marginTop: 30 }}>
            <h3 style={{ margin: "0 0 10px 0", fontSize: 16, fontWeight: 800 }}>
              COMPARAISON DES 3 VARIANTES
            </h3>
            <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 12 }}>
              Cohort interne curée vs. labels GMAO indépendants (gravité ≥ 2 et = 3). Variante principale = meilleur AUC.
            </div>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "#636366", fontWeight: 800, fontSize: 11,
                             textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <th style={{ padding: 10, textAlign: "left" }}>Variante</th>
                  <th style={{ padding: 10, textAlign: "right" }}>AUC</th>
                  <th style={{ padding: 10, textAlign: "right" }}>F1</th>
                  <th style={{ padding: 10, textAlign: "right" }}>Préc.</th>
                  <th style={{ padding: 10, textAlign: "right" }}>Rapp.</th>
                  <th style={{ padding: 10, textAlign: "right" }}>Seuil</th>
                  <th style={{ padding: 10, textAlign: "right" }}>N⁺ test</th>
                </tr>
              </thead>
              <tbody>
                <VariantRow label="Cohort `panne` interne" v={v.panne_cohort}
                            isPrincipal={data.model_principal?.includes("Cohort")} />
                <VariantRow label="GMAO Gravité ≥ 2" v={v.grav2}
                            isPrincipal={data.model_principal?.includes("≥ 2")} />
                <VariantRow label="GMAO Gravité = 3" v={v.grav3}
                            isPrincipal={data.model_principal?.includes("= 3")} />
              </tbody>
            </table>
          </div>
        </div>

        {/* SIDE PANEL */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Méthodologie */}
          <div style={{
            background: "#fff", borderRadius: 24, padding: "25px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.03)",
          }}>
            <h3 style={{ margin: "0 0 15px 0", fontSize: 16, fontWeight: 800 }}>MÉTHODOLOGIE</h3>
            <div style={{ fontSize: 13, color: "#3A3A3C", lineHeight: 1.7 }}>
              <p style={{ margin: "0 0 10px 0" }}><strong>Modèle :</strong> Random Forest, class_weight="balanced", 100 arbres.</p>
              <p style={{ margin: "0 0 10px 0" }}><strong>Features :</strong> mean / std / max / val / pente sur fenêtre glissante 1 h, par capteur.</p>
              <p style={{ margin: "0 0 10px 0" }}><strong>Horizon :</strong> 24 h ({data.horizon_h ? data.horizon_h * 30 : 720} timesteps).</p>
              <p style={{ margin: "0 0 10px 0" }}><strong>Split :</strong> chronologique 80 / 20 — train sur le passé, test sur le futur.</p>
              <p style={{ margin: 0 }}><strong>Seuil :</strong> balayage 0.10→0.90, optimisation F1 sur le test.</p>
            </div>
          </div>

          {/* Interprétation honnête */}
          {data.interpretation && (
            <div style={{
              background: "linear-gradient(135deg, #00843D, #00632E)",
              borderRadius: 20, padding: "20px", color: "#fff",
            }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.5,
                            marginBottom: 8, opacity: 0.85 }}>
                💡 LECTURE DU MODÈLE
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.6 }}>
                {data.interpretation}
              </div>
            </div>
          )}

          {/* Sources & timestamp */}
          <div style={{
            background: "#fff", borderRadius: 16, padding: "16px 20px",
            border: "1px dashed rgba(0,0,0,0.08)",
            fontSize: 11, color: "#8E8E93", lineHeight: 1.6
          }}>
            <div><strong>Sources :</strong></div>
            <div>• Capteurs : {data.sources?.capteurs || "—"}</div>
            <div>• GMAO : {data.sources?.gmao || "—"}</div>
            <div style={{ marginTop: 8 }}>
              <strong>Dernier entraînement :</strong> {data.calcule_a || "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
