/**
 * ErrorBoundary.jsx — MineAssist Sprint 2 (mai 2026)
 * Capture les erreurs React des pages enfants et empêche un crash
 * complet de l'application. Affiche un fallback avec bouton de recovery.
 */

import { Component } from "react"

const C = {
  bg: "#FFFDF8", card: "#FFFFFF",
  red: "#DC2626", redPale: "#FEE2E2",
  text: "#1C1A14", textMuted: "#8A7D60",
  border: "#D4C9B0", green: "#00843D",
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ errorInfo: info })
    if (typeof console !== "undefined") {
      console.error("[MineAssist crash]", error, info)
    }
    // Optionnel : remonter au backend (commenté par défaut)
    // try {
    //   fetch("/log/frontend-error", {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json" },
    //     body: JSON.stringify({
    //       message: error.message, stack: error.stack,
    //       componentStack: info?.componentStack,
    //       url: window.location.href,
    //       ts: new Date().toISOString(),
    //     }),
    //   }).catch(() => {})
    // } catch (_) {}
  }

  reset = () => this.setState({ error: null, errorInfo: null })
  reload = () => window.location.reload()

  render() {
    if (this.state.error) {
      const { error, errorInfo } = this.state
      return (
        <div style={{
          minHeight: "calc(100vh - 60px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: C.bg, padding: 32,
        }}>
          <div style={{
            maxWidth: 640, width: "100%", background: C.card,
            border: `1px solid ${C.border}`, borderRadius: 12, padding: 32,
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}>
            <div style={{
              display: "inline-block", padding: "4px 12px",
              fontSize: 10, fontWeight: 800, letterSpacing: 2,
              background: C.redPale, color: C.red,
              borderRadius: 4, textTransform: "uppercase", marginBottom: 12,
            }}>
              ERREUR INTERFACE
            </div>
            <h2 style={{
              margin: "0 0 8px", fontSize: 22, fontWeight: 800,
              fontFamily: "Rajdhani, system-ui", color: C.text,
            }}>
              Une erreur est survenue dans cette page
            </h2>
            <p style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6, margin: 0 }}>
              L'application reste fonctionnelle. Vous pouvez réessayer cette page
              ou recharger l'application complète.
            </p>

            <pre style={{
              marginTop: 18, padding: 12, fontSize: 11, fontFamily: "monospace",
              background: "#F5F0E8", border: `1px solid ${C.border}`, borderRadius: 6,
              color: "#7B1F22", overflowX: "auto", maxHeight: 160,
            }}>
              {error?.message || String(error)}
              {errorInfo?.componentStack && (
                "\n\n" + errorInfo.componentStack.split("\n").slice(0, 6).join("\n")
              )}
            </pre>

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button onClick={this.reset} style={{
                padding: "10px 20px", fontSize: 12, fontWeight: 700,
                background: C.green, color: "#fff", border: "none",
                borderRadius: 4, cursor: "pointer", letterSpacing: 1.5,
                fontFamily: "Rajdhani, system-ui", textTransform: "uppercase",
              }}>
                ↻ Réessayer
              </button>
              <button onClick={this.reload} style={{
                padding: "10px 20px", fontSize: 12, fontWeight: 700,
                background: "#fff", color: C.text, border: `1px solid ${C.border}`,
                borderRadius: 4, cursor: "pointer", letterSpacing: 1.5,
                fontFamily: "Rajdhani, system-ui", textTransform: "uppercase",
              }}>
                ⟲ Recharger l'app
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
