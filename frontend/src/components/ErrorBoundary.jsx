import { Component } from "react"

/**
 * Error boundary global — empêche un crash React dans une page
 * (ex : `Cannot read properties of undefined`) de figer toute l'application.
 *
 * Affiche un panneau d'erreur lisible avec un bouton de recharge / retour
 * et permet à la sidebar de rester utilisable en remontant l'erreur.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    if (typeof console !== "undefined" && console.error) {
      console.error("[ErrorBoundary]", error, info)
    }
  }

  reset = () => this.setState({ error: null, info: null })

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        style={{
          padding: "28px 32px",
          maxWidth: 760,
          margin: "60px auto",
          background: "#FFFDF8",
          border: "1px solid #E3D8C4",
          borderLeft: "4px solid #C0392B",
          borderRadius: 14,
          color: "#2A2A1E",
          fontFamily: "'Rajdhani', system-ui, sans-serif",
          boxShadow: "0 18px 48px rgba(0,0,0,0.08)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 2,
            color: "#C0392B",
            textTransform: "uppercase",
          }}
        >
          Mineassist · erreur interface
        </div>
        <h2
          style={{
            margin: "6px 0 12px",
            fontSize: 22,
            fontWeight: 800,
            color: "#2A2A1E",
          }}
        >
          Une erreur est survenue dans cette page
        </h2>
        <div
          style={{
            background: "#FBEFEC",
            border: "1px solid #E74C3C33",
            borderRadius: 8,
            padding: "10px 12px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            color: "#7B1F14",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}
        >
          {String(error?.message || error)}
        </div>
        {info?.componentStack && (
          <details style={{ marginTop: 12, fontSize: 12, color: "#5A5240" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>
              Détails techniques
            </summary>
            <pre
              style={{
                marginTop: 8,
                background: "#F7F2E6",
                padding: 10,
                borderRadius: 8,
                fontSize: 11,
                overflow: "auto",
                maxHeight: 240,
              }}
            >
              {info.componentStack}
            </pre>
          </details>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            onClick={this.reset}
            style={{
              background: "#00843D",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 18px",
              fontWeight: 800,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            Recharger la vue
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#FFFFFF",
              color: "#005C2B",
              border: "1px solid #00843D55",
              borderRadius: 8,
              padding: "10px 18px",
              fontWeight: 700,
              letterSpacing: 1,
              cursor: "pointer",
            }}
          >
            Recharger la page
          </button>
        </div>
      </div>
    )
  }
}
