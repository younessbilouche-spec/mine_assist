// ─────────────────────────────────────────────────────────────────────────────
// src/components/ExportToolbar.jsx — Barre d'export prête à coller
//
// Usage dans n'importe quel dashboard :
//
//   import ExportToolbar from "../components/ExportToolbar"
//
//   const dashboardRef = useRef(null)
//
//   return (
//     <>
//       <ExportToolbar
//         containerRef={dashboardRef}
//         filename="monitoring_capteurs"
//         csvData={alertes}                  // optionnel
//         csvFilename="alertes_capteurs"
//         title="Monitoring 994F"
//       />
//       <div ref={dashboardRef}>
//         { ... votre dashboard ... }
//       </div>
//     </>
//   )
// ─────────────────────────────────────────────────────────────────────────────

import { useExport } from "../utils/exportUtils"

const C = {
  border: "#D4C9B0",
  green: "#00843D",
  greenDark: "#005C2B",
  greenPale: "#E8F5EE",
  orange: "#C4760A",
  orangePale: "#FDF3E3",
  textMid: "#5A5240",
  textMuted: "#8A7D60",
}

function Btn({ onClick, disabled, icon, label, color = C.green }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-no-print="true"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "8px 14px",
        background: "transparent",
        border: `1.5px solid ${color}`,
        color,
        fontFamily: "'Rajdhani', sans-serif", fontSize: 11,
        fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.15s ease",
      }}
      onMouseEnter={e => {
        if (disabled) return
        e.currentTarget.style.background = color
        e.currentTarget.style.color = "#fff"
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "transparent"
        e.currentTarget.style.color = color
      }}
    >
      <span style={{ fontSize: 13 }}>{icon}</span>
      {label}
    </button>
  )
}

export default function ExportToolbar({
  containerRef,
  filename = "dashboard",
  csvData = null,
  csvColumns = null,
  csvFilename = null,
  title = "MineAssist",
  className = "",
}) {
  const {
    exportElementAsPng,
    exportCsv,
    printDashboard,
    isExporting,
  } = useExport()

  const handlePng = () => {
    if (!containerRef?.current) {
      alert("Référence du dashboard manquante (containerRef)")
      return
    }
    exportElementAsPng(containerRef.current, filename)
  }

  const handlePdf = () => {
    printDashboard(title)
  }

  const handleCsv = () => {
    if (!csvData || csvData.length === 0) {
      alert("Aucune donnée tabulaire à exporter")
      return
    }
    exportCsv(csvData, csvFilename || filename, csvColumns)
  }

  return (
    <div
      data-no-print="true"
      className={className}
      style={{
        display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
        marginBottom: 14,
      }}
    >
      <span style={{
        fontSize: 10, fontWeight: 700, color: C.textMuted,
        letterSpacing: 2, textTransform: "uppercase", marginRight: 4,
      }}>
        Exporter :
      </span>

      <Btn
        onClick={handlePdf}
        disabled={isExporting}
        icon="🖨"
        label="PDF (Imprimer)"
        color={C.green}
      />
      <Btn
        onClick={handlePng}
        disabled={isExporting}
        icon="🖼"
        label="PNG"
        color={C.greenDark}
      />
      {csvData && (
        <Btn
          onClick={handleCsv}
          disabled={isExporting}
          icon="📄"
          label="CSV"
          color={C.orange}
        />
      )}

      {isExporting && (
        <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 8 }}>
          ⟳ Export en cours…
        </span>
      )}
    </div>
  )
}
