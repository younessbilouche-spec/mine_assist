// ─────────────────────────────────────────────────────────────────────────────
// CapteursPage.jsx — page unifiée qui regroupe les 3 vues capteurs:
//   1. Live MATLAB           (ex-LiveSimulationDashboard)
//   2. Historique            (ex-MonitoringDashboard)
//   3. Évolution temporelle  (ex-EvolutionChart)
//
// Cross-link: cliquer sur un capteur dans Live / Historique → bascule en
// mode Évolution avec le paramètre pré-sélectionné.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useCallback } from "react"
import LiveSimulationDashboard from "./LiveSimulationDashboard"
import MonitoringDashboard from "./MonitoringDashboard"
import EvolutionChart from "./EvolutionChart"

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
}

const MODES = [
  {
    id:        "live",
    icon:      "🟢",
    label:     "Live MATLAB",
    sublabel:  "flux temps réel · 1 Hz · seuils OCP",
    accent:    C.green,
  },
  {
    id:        "historique",
    icon:      "📊",
    label:     "Historique",
    sublabel:  "stats agrégées · base GMAO",
    accent:    C.sand,
  },
  {
    id:        "evolution",
    icon:      "📈",
    label:     "Évolution",
    sublabel:  "courbe temporelle d'un capteur",
    accent:    C.orange,
  },
]

function ModeTab({ mode, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? "#fff" : "transparent",
        border: "none",
        borderBottom: active ? `3px solid ${mode.accent}` : `3px solid transparent`,
        padding: "14px 18px",
        cursor: "pointer",
        fontFamily: "'Rajdhani', sans-serif",
        textAlign: "left",
        position: "relative",
        transition: "background 0.2s ease",
        boxShadow: active ? "0 2px 10px rgba(139,105,20,0.06)" : "none",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.5)"
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent"
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 10, marginBottom: 4,
      }}>
        <span style={{ fontSize: 20 }}>{mode.icon}</span>
        <span style={{
          fontSize: 13, fontWeight: 700, letterSpacing: 2.4,
          textTransform: "uppercase",
          color: active ? mode.accent : C.textMuted,
        }}>
          {mode.label}
        </span>
        {active && mode.id === "live" && (
          <span style={{
            display: "inline-block",
            width: 8, height: 8, borderRadius: "50%",
            background: C.green,
            boxShadow: `0 0 0 0 ${C.green}80`,
            animation: "capteurs-pulse 1.4s infinite",
          }} />
        )}
      </div>
      <div style={{
        fontSize: 11, color: active ? C.textMid : C.textLight,
        letterSpacing: 0.4, marginLeft: 30,
      }}>
        {mode.sublabel}
      </div>
    </button>
  )
}

export default function CapteursPage({ initialMode = "live" }) {
  const [mode, setMode] = useState(initialMode)
  // Pour le cross-link Live/Historique → Évolution
  const [evolutionParam, setEvolutionParam] = useState(null)

  // Callback à passer aux sous-dashboards : sélectionne un paramètre et
  // bascule en mode Évolution.
  const goToEvolution = useCallback((paramName) => {
    if (paramName) setEvolutionParam(paramName)
    setMode("evolution")
  }, [])

  const activeMode = MODES.find((m) => m.id === mode)

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <style>{`
        @keyframes capteurs-pulse {
          0%   { box-shadow: 0 0 0 0   ${C.green}80; }
          70%  { box-shadow: 0 0 0 6px ${C.green}00; }
          100% { box-shadow: 0 0 0 0   ${C.green}00; }
        }
      `}</style>

      {/* En-tête avec sélecteur de mode */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          background: "rgba(245,240,232,0.98)",
          borderBottom: `1px solid ${C.border}`,
          padding: "10px 32px 0",
        }}
      >
        <div
          style={{
            maxWidth: 1240,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "'Rajdhani', sans-serif",
            }}
          >
            <div
              style={{
                width: 4,
                height: 18,
                background: activeMode?.accent || C.green,
                borderRadius: 2,
              }}
            />
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.textMuted,
                  letterSpacing: 4,
                  textTransform: "uppercase",
                }}
              >
                CAPTEURS · CAT 994F
              </div>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  color: C.text,
                  letterSpacing: 0.3,
                  lineHeight: 1.1,
                }}
              >
                Vue unifiée · {activeMode?.label}
              </div>
            </div>
          </div>

          <div
            style={{
              fontSize: 11,
              color: C.textLight,
              letterSpacing: 1,
              fontFamily: "'Rajdhani', sans-serif",
            }}
          >
            Engin actif :{" "}
            <span style={{ color: C.greenDark, fontWeight: 700, letterSpacing: 1.5 }}>
              994F1
            </span>
          </div>
        </div>

        {/* Onglets de mode */}
        <div
          style={{
            maxWidth: 1240,
            margin: "0 auto",
            display: "flex",
            gap: 4,
            background: "rgba(255,253,248,0.6)",
            border: `1px solid ${C.border}`,
            borderBottom: "none",
            borderRadius: "6px 6px 0 0",
            overflow: "hidden",
          }}
        >
          {MODES.map((m) => (
            <ModeTab
              key={m.id}
              mode={m}
              active={mode === m.id}
              onClick={() => setMode(m.id)}
            />
          ))}
        </div>
      </div>

      {/* Contenu — chaque mode rend son propre dashboard sans modification */}
      <div style={{ background: "rgba(255,253,248,0.4)" }}>
        {mode === "live" && (
          <LiveSimulationDashboard
            onSelectParam={goToEvolution}
          />
        )}
        {mode === "historique" && (
          <MonitoringDashboard
            onSelectParam={goToEvolution}
          />
        )}
        {mode === "evolution" && (
          <EvolutionChart
            selectedParam={evolutionParam}
            onSelectParam={setEvolutionParam}
          />
        )}
      </div>
    </div>
  )
}
