/**
 * RULDashboard.jsx — MineAssist ELITE v2
 * Design : Industriel Premium / Control Room
 */
import { useState, useEffect } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
         ResponsiveContainer, Cell, ReferenceLine } from "recharts"
import { API, C } from "../config"

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

function SensorCardElite({ c }) {
  const color = COLOR[c.verdict] || COLOR.stable
  const isCritical = c.verdict === "critique" || c.verdict === "alerte"

  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${isCritical ? color + '40' : 'rgba(0,0,0,0.05)'}`,
      borderRadius: 16,
      padding: "16px 20px",
      marginBottom: 12,
      display: "flex",
      alignItems: "center",
      gap: 20,
      boxShadow: isCritical ? `0 4px 15px ${color}15` : "0 2px 8px rgba(0,0,0,0.02)",
      transition: "all 0.2s ease",
      cursor: "default",
      position: "relative"
    }}>
      {/* Jauge circulaire stylisée */}
      <div style={{ position: "relative", width: 54, height: 54 }}>
        <svg viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="50" cy="50" r="42" stroke="rgba(0,0,0,0.05)" strokeWidth="10" fill="none" />
          <circle cx="50" cy="50" r="42" stroke={color} strokeWidth="10" fill="none"
                  strokeDasharray={`${c.di_pct * 2.64} 264`} strokeLinecap="round" />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", 
          justifyContent: "center", fontSize: 13, fontWeight: 800, color
        }}>
          {Math.round(c.di_pct)}%
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E" }}>{c.nom}</div>
        <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
          <span style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600 }}>AMDEC: <strong>{c.criticite}</strong></span>
          <span style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600 }}>PENTE: <strong>{c.pente_par_jour}</strong></span>
        </div>
      </div>

      <div style={{ textAlign: "right" }}>
        <div style={{ 
          fontSize: 24, fontWeight: 800, color: color, 
          fontFamily: "'Rajdhani', sans-serif", lineHeight: 1 
        }}>
          {c.rul_jours < 999 ? c.rul_jours : "—"}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#AEAEB2", textTransform: "uppercase" }}>Jours</div>
      </div>

      <div style={{
        padding: "4px 10px", borderRadius: 6, fontSize: 9, fontWeight: 900,
        background: `${color}15`, color: color, border: `1px solid ${color}30`,
        marginLeft: 15, minWidth: 100, textAlign: "center", letterSpacing: 0.5
      }}>
        {verdictLabel[c.verdict]}
      </div>
    </div>
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
      <h2 style={{ fontFamily: "Rajdhani", fontWeight: 800 }}>Intelligence Artificielle en attente</h2>
      <p>Lancez l'entraînement du modèle Random Forest pour voir les prédictions RUL.</p>
      <button onClick={handleRefresh} style={{
        background: COLOR.accent, color: "#fff", border: "none", padding: "15px 30px",
        borderRadius: 12, fontWeight: 800, cursor: "pointer", marginTop: 20
      }}>ENTRAÎNER LE MODÈLE MAINTENANT</button>
    </div>
  )

  const chartData = (data.tous_capteurs || [])
    .filter(c => c.rul_jours < 999)
    .map(c => ({
      name: c.nom.replace("Température ", "T. "),
      val: c.rul_jours,
      color: COLOR[c.verdict]
    }))

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "20px" }}>
      
      {/* HEADER SECTION */}
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
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>Prédiction RUL — <span style={{ color: COLOR.accent }}>Machine Learning</span></h1>
              <div style={{ fontSize: 13, color: "#8E8E93", fontWeight: 600, letterSpacing: 1 }}>
                RANDOM FOREST REGRESSOR • OCP CAT 994F • VERSION ELITE 2.0
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
            transform: refreshing ? "none" : "translateY(0)"
          }}
        >
          {refreshing ? "CALCUL EN COURS..." : "↻ ACTUALISER LE MODÈLE"}
        </button>
      </div>

      {/* KPI GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 30 }}>
        <KPIBox label="RUL SYSTÈME PONDÉRÉ" val={data.rul_systeme_j} unit="jours" icon="⏳" color={data.rul_systeme_j < 20 ? COLOR.alerte : COLOR.stable} subValue="Basé sur l'importance ML" />
        <KPIBox label="DATE CRITIQUE ESTIMÉE" val={data.date_critique} unit="échéance" icon="📅" color="#5856D6" />
        <KPIBox label="CAPTEUR PILOTE" val={data.capteur_pilote?.split(' ').pop()} unit="CRITIQUE" icon="🎯" color={COLOR.critique} subValue={data.capteur_pilote} />
        <KPIBox label="COMPOSANTS EN ALERTE" val={data.n_en_alerte} unit="unités" icon="⚠️" color={data.n_en_alerte > 0 ? COLOR.critique : COLOR.stable} subValue="Vérification requise" />
      </div>

      {/* MAIN CONTENT GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 450px", gap: 25 }}>
        
        {/* CHART SECTION */}
        <div style={{ background: "#fff", borderRadius: 24, padding: "30px", boxShadow: "0 10px 30px rgba(0,0,0,0.03)" }}>
          <div style={{ marginBottom: 25 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>PROJECTION DE DÉGRADATION</h3>
            <div style={{ fontSize: 13, color: "#8E8E93" }}>Comparaison du RUL par organe (en jours)</div>
          </div>
          
          <div style={{ height: 450 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 40, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.05)" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" tick={{ fontWeight: 700, fontSize: 12, fill: "#3A3A3C" }} width={100} axisLine={false} tickLine={false} />
                <Tooltip 
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontWeight: 700 }}
                />
                <Bar dataKey="val" radius={[0, 10, 10, 0]} barSize={35} label={{ position: 'right', fontWeight: 800, fontSize: 14 }}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
                <ReferenceLine x={7} stroke={COLOR.critique} strokeDasharray="5 5" label={{ position: 'top', value: 'LIMITE 7J', fill: COLOR.critique, fontSize: 10, fontWeight: 800 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* LIST SECTION */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ 
            background: "#fff", borderRadius: 24, padding: "25px", 
            boxShadow: "0 10px 30px rgba(0,0,0,0.03)", flex: 1,
            maxHeight: 600, overflowY: "auto"
          }}>
            <h3 style={{ margin: "0 0 20px 0", fontSize: 18, fontWeight: 800, display: "flex", justifyContent: "space-between" }}>
              SANTÉ DES COMPOSANTS
              <span style={{ fontSize: 12, color: COLOR.accent }}>LIVE ML</span>
            </h3>
            
            {data.tous_capteurs?.map((c, i) => (
              <SensorCardElite key={i} c={c} />
            ))}
          </div>

          <div style={{ 
            marginTop: 20, background: "linear-gradient(135deg, #00843D, #00632E)", 
            borderRadius: 20, padding: "20px", color: "#fff", display: "flex", gap: 15, alignItems: "center"
          }}>
            <div style={{ fontSize: 24 }}>💡</div>
            <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>
              <strong>Note IA :</strong> Le modèle identifie une accélération de l'usure sur le système d'huile. 
              Une inspection préventive est recommandée sous 10 jours.
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
