import { useState } from "react"
import MaintenanceExecutiveDashboard from "./MaintenanceExecutiveDashboard"
import ExecutiveReportPage from "./ExecutiveReportPage"
import { C } from "../config"

const MODES = [
  {
    id: "dashboard",
    icon: "🏭",
    label: "Tableau de Bord 360°",
    sublabel: "vue d'ensemble de la flotte",
    accent: C.green,
  },
  {
    id: "report",
    icon: "📄",
    label: "Rapport Exécutif",
    sublabel: "synthèse IA & recommandations",
    accent: C.sand,
  },
]

export default function UnifiedExecutivePage({ apiFetch, onNavigate }) {
  const [mode, setMode] = useState("dashboard")
  const activeMode = MODES.find(m => m.id === mode)

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <div style={{ background: "rgba(245,240,232,0.98)", borderBottom: `1px solid ${C.border}`, padding: "10px 32px 0" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "'Rajdhani', sans-serif" }}>
            <div style={{ width: 4, height: 18, background: activeMode.accent, borderRadius: 2 }} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 4, textTransform: "uppercase" }}>PILOTAGE OPÉRATIONNEL</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: C.text, letterSpacing: 0.3, lineHeight: 1.1 }}>{activeMode.label}</div>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", gap: 4, background: "rgba(255,253,248,0.6)", border: `1px solid ${C.border}`, borderBottom: "none", borderRadius: "6px 6px 0 0", overflow: "hidden" }}>
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{
                flex: 1, padding: "14px 18px", cursor: "pointer", fontFamily: "'Rajdhani', sans-serif", textAlign: "left",
                background: mode === m.id ? "#fff" : "transparent",
                border: "none", borderBottom: mode === m.id ? `3px solid ${m.accent}` : `3px solid transparent`,
                transition: "all 0.2s"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 20 }}>{m.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: mode === m.id ? m.accent : C.textMuted }}>{m.label}</span>
              </div>
              <div style={{ fontSize: 11, color: mode === m.id ? C.textMid : C.textLight, marginLeft: 30 }}>{m.sublabel}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: "rgba(255,253,248,0.4)" }}>
        {mode === "dashboard" ? (
          <MaintenanceExecutiveDashboard apiFetch={apiFetch} onNavigate={onNavigate} />
        ) : (
          <ExecutiveReportPage apiFetch={apiFetch} />
        )}
      </div>
    </div>
  )
}
