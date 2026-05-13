import { useState, useRef, useEffect } from "react"
import { API, C } from "../config"

const AGENT_COLORS = {
  gmao: { bg: "#E3F2FD", color: "#1565C0", icon: "🤖" },
  sensors: { bg: "#F3E5F5", color: "#6A1B9A", icon: "📡" },
  oil: { bg: "#FFF8E1", color: "#F57F17", icon: "🛢️" },
  consensus: { bg: C.greenPale, color: C.greenDark, icon: "✅" }
}

export default function MultiAgentDiagnosticPage() {
  const [query, setQuery] = useState("E102 (chute de pression)")
  const [events, setEvents] = useState([])
  const [running, setRunning] = useState(false)
  const endRef = useRef(null)

  // Auto-scroll to bottom
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events])

  const runSimulation = async () => {
    if (!query.trim() || running) return
    setRunning(true)
    setEvents([])

    try {
      const res = await fetch(`${API}/multi-agent/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      })

      if (!res.ok) throw new Error("Erreur serveur")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""

        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const dataStr = line.slice(5).trim()
          if (!dataStr) continue
          
          try {
            const data = JSON.parse(dataStr)
            
            // On cherche si cet agent a déjà un bloc "typing" actif
            setEvents(prev => {
              const newEvents = [...prev]
              const lastIdx = newEvents.length - 1
              
              if (lastIdx >= 0 && newEvents[lastIdx].agent === data.agent && newEvents[lastIdx].status === "typing") {
                // Remplace le bloc typing par le bloc done
                newEvents[lastIdx] = data
              } else {
                // Ajoute le nouveau bloc
                newEvents.push(data)
              }
              return newEvents
            })
          } catch (e) { /* ignore */ }
        }
      }
    } catch (err) {
      setEvents(prev => [...prev, { agent: "consensus", name: "Système", text: `Erreur : ${err.message}`, status: "done" }])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 900, margin: "0 auto", fontFamily: "'Rajdhani', sans-serif" }}>
      <div style={{ marginBottom: 24, textAlign: "center" }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: C.text, margin: 0 }}>
          Système Multi-Agents IA
        </h1>
        <p style={{ color: C.textMid, fontSize: 14, marginTop: 4 }}>
          Diagnostic collaboratif : GMAO ✕ Télémétrie ✕ Fiabilité
        </p>
      </div>

      {/* Input zone */}
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 24, boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>
          Symptôme ou Code de défaut
        </label>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            disabled={running}
            style={{ flex: 1, padding: "12px 16px", fontSize: 15, fontFamily: "inherit", border: `1px solid ${C.border}`, borderRadius: 6, outline: "none" }}
            onKeyDown={e => { if (e.key === "Enter") runSimulation() }}
          />
          <button
            onClick={runSimulation}
            disabled={running || !query.trim()}
            style={{
              background: running ? C.textMuted : C.green,
              color: "#fff", border: "none", padding: "0 24px", fontSize: 14, fontWeight: 700,
              letterSpacing: 1.5, borderRadius: 6, cursor: running ? "not-allowed" : "pointer", textTransform: "uppercase"
            }}
          >
            {running ? "Analyse en cours..." : "Lancer Conseil IA"}
          </button>
        </div>
      </div>

      {/* Chat zone */}
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, minHeight: 400, padding: "24px 24px 0 24px", boxShadow: "inset 0 2px 10px rgba(0,0,0,0.02)", display: "flex", flexDirection: "column" }}>
        
        {events.length === 0 && !running && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textLight, fontSize: 15 }}>
            Saisissez un défaut pour démarrer le Conseil des Experts.
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 24 }}>
          {events.map((ev, i) => {
            const style = AGENT_COLORS[ev.agent] || AGENT_COLORS.consensus
            const isConsensus = ev.agent === "consensus"

            return (
              <div key={i} style={{ display: "flex", gap: 14, marginBottom: 20, flexDirection: isConsensus ? "column" : "row", alignItems: isConsensus ? "center" : "flex-start" }}>
                
                {/* Avatar */}
                {!isConsensus && (
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: style.bg, border: `2px solid ${style.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                    {style.icon}
                  </div>
                )}

                {/* Bubble */}
                <div style={{ 
                  background: isConsensus ? style.bg : "#FAFAFA", 
                  border: `1px solid ${isConsensus ? style.color : C.border}`, 
                  borderRadius: isConsensus ? 12 : "2px 16px 16px 16px",
                  padding: isConsensus ? "20px 30px" : "14px 18px", 
                  maxWidth: isConsensus ? "100%" : "80%",
                  width: isConsensus ? "100%" : "auto",
                  boxShadow: isConsensus ? "0 8px 24px rgba(0,132,61,0.12)" : "none",
                  textAlign: isConsensus ? "center" : "left"
                }}>
                  {/* Name */}
                  <div style={{ fontSize: 11, fontWeight: 800, color: style.color, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: isConsensus ? "center" : "flex-start", gap: 6 }}>
                    {isConsensus && <span style={{ fontSize: 16 }}>{style.icon}</span>}
                    {ev.name}
                  </div>

                  {/* Content */}
                  {ev.status === "typing" ? (
                    <div style={{ display: "flex", gap: 4, alignItems: "center", height: 24, justifyContent: isConsensus ? "center" : "flex-start" }}>
                      <span className="dot" style={{ animationDelay: "0s" }} />
                      <span className="dot" style={{ animationDelay: "0.2s" }} />
                      <span className="dot" style={{ animationDelay: "0.4s" }} />
                    </div>
                  ) : (
                    <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap", textAlign: isConsensus ? "left" : "left", fontFamily: isConsensus ? "inherit" : "system-ui, sans-serif" }} dangerouslySetInnerHTML={{ __html: ev.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>') }} />
                  )}
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>
      </div>

      <style>{`
        .dot {
          width: 6px; height: 6px; border-radius: 50%; background: ${C.textLight};
          animation: bounce 1.4s infinite ease-in-out both;
        }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
