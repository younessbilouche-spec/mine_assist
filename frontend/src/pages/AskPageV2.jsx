/**
 * AskPageV2.jsx — Sprint 1+2 (mai 2026)
 * MineAssist · OCP · Page Ask améliorée
 *
 * Améliorations vs v1 :
 *   - Détection automatique de langue (FR / EN / AR) ou choix manuel
 *   - Streaming SSE : réponse mot-à-mot type ChatGPT
 *   - Mémoire conversationnelle (4 derniers tours)
 *   - Bouton feedback 👍/👎
 *   - Citations sources avec [chunk_id, p.page]
 *
 * Endpoints utilisés :
 *   POST /ask/stream   (streaming SSE)  ← prioritaire
 *   POST /ask/v2       (fallback non-stream)
 *   POST /feedback     (rating utilisateur)
 *   GET  /ask/status   (état clé API)
 */

import { useEffect, useRef, useState } from "react"
import { API, C } from "../config"
import ocpLogo from "../assets/ocp-logo.png"
import mineassistLogo from "../assets/mineassist_logo_final.png"



const LANG_LABELS = { auto: "Auto", fr: "Français", en: "English", ar: "العربية" }
const LANG_FLAGS = { auto: "🌐", fr: "🇫🇷", en: "🇬🇧", ar: "🇸🇦" }

export default function AskPageV2({ apiFetch, onSave, toggleHistory, historyCollapsed }) {
  const [question, setQuestion] = useState("")
  const [language, setLanguage] = useState("auto")
  const [includeImages, setIncludeImages] = useState(false)
  const [messages, setMessages] = useState([])  // mémoire : {role, content}
  const [streaming, setStreaming] = useState(false)
  const [currentAnswer, setCurrentAnswer] = useState("")
  const [currentSources, setCurrentSources] = useState([])
  const [currentLang, setCurrentLang] = useState(null)
  const [currentAnswerId, setCurrentAnswerId] = useState(null)
  const [llmStatus, setLlmStatus] = useState(null)
  const [feedback, setFeedback] = useState({})  // {answerId: 'up'|'down'}
  const abortRef = useRef(null)

  useEffect(() => {
    apiFetch(`${API}/ask/status`).then(r => r.json()).then(setLlmStatus)
      .catch(() => setLlmStatus({ llm_configured: false }))
  }, [apiFetch])

  const cancel = () => {
    if (abortRef.current) {
      try { abortRef.current.abort() } catch (_) { }
      abortRef.current = null
    }
    setStreaming(false)
  }

  const ask = async (overrideQuestion = null) => {
    // If overrideQuestion is an event (from onClick), ignore it
    const isEvent = overrideQuestion && typeof overrideQuestion === 'object' && overrideQuestion.nativeEvent;
    const q = (overrideQuestion && !isEvent) ? overrideQuestion : question;

    if (!q || !q.trim() || streaming) return

    setQuestion("") // Vider le champ immédiatement
    setStreaming(true)
    setCurrentAnswer("")
    setCurrentSources([])
    setCurrentLang(null)
    setCurrentAnswerId(null)

    const previousMessages = messages.slice(-4)
    const body = JSON.stringify({
      question: q,
      include_images: includeImages,
      language,
      previous_messages: previousMessages,
    })

    abortRef.current = new AbortController()

    try {
      // Tentative streaming SSE
      const res = await fetch(`${API}/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        throw new Error(`Stream HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      let accumulated = ""
      let sources = []
      let lang = language

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""
        for (const line of lines) {
          if (!line.startsWith("data:")) continue
          const data = line.slice(5).trim()
          if (data === "[DONE]") continue
          try {
            const obj = JSON.parse(data)
            if (obj.event === "sources") {
              sources = obj.sources || []
              lang = obj.lang || lang
              setCurrentSources(sources)
              setCurrentLang(lang)
            } else if (obj.delta) {
              accumulated += obj.delta
              setCurrentAnswer(accumulated)
            } else if (obj.error) {
              accumulated += `\n\n[ERROR: ${obj.error}]`
              setCurrentAnswer(accumulated)
            }
          } catch (_) { /* ignore */ }
        }
      }

      // Sauvegarde dans l'historique mémoire
      const newAnswerId = `a_${Date.now().toString(36)}`
      setCurrentAnswerId(newAnswerId)
      setMessages(prev => [
        ...prev,
        { role: "user", content: q },
        { role: "assistant", content: accumulated },
      ])
      setCurrentAnswer("") // Clear it from the streaming bubble so it only shows in history

      onSave?.({
        id: Date.now(), type: "ask", question: q, answer: accumulated,
        sources, lang_detected: lang, timestamp: new Date().toISOString(),
      })
    } catch (e) {
      if (e.name !== "AbortError") {
        // Fallback non-stream
        try {
          const r = await fetch(`${API}/ask/v2`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          })
          const data = await r.json()
          if (!r.ok) {
            setCurrentAnswer(`Erreur : ${data?.detail || r.status}`)
          } else {
            setMessages(prev => [
              ...prev,
              { role: "user", content: q },
              { role: "assistant", content: data.answer || "(réponse vide)" },
            ])
            setCurrentAnswer("") // Clear streaming bubble
            setCurrentSources(data.sources || [])
            setCurrentLang(data.language_detected)
            setCurrentAnswerId(data.answer_id)
          }
        } catch (e2) {
          setCurrentAnswer(`Erreur : ${e2.message}`)
        }
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const sendFeedback = async (rating) => {
    if (!currentAnswerId) return
    setFeedback(prev => ({ ...prev, [currentAnswerId]: rating }))
    try {
      await fetch(`${API}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer_id: currentAnswerId, rating }),
      })
    } catch (_) { }
  }

  const clearConversation = () => {
    setMessages([])
    setCurrentAnswer("")
    setCurrentSources([])
    setCurrentAnswerId(null)
    setQuestion("")
  }

  const formatText = (txt) => {
    if (!txt) return { __html: "" }
    let html = txt
      // Remplacer les titres ## Titre
      .replace(/## (.*?)(?:\n|$)/g, '<h3 style="color: #00843D; margin: 18px 0 8px 0; font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #EAEFEA; padding-bottom: 4px;">$1</h3>')
      // Remplacer le gras **gras**
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Remplacer les sauts de ligne par des <br/>
      .replace(/\n/g, '<br/>')
      // Nettoyer les <br/> consécutifs inutiles sous les titres
      .replace(/<\/h3><br\/>/g, '</h3>')
    return { __html: html }
  }

  const QUICK_PROMPTS = [
    "Quelle est la procédure de vérification du niveau d'huile moteur ?",
    "Que signifie le code d'événement E102 (Basse pression d'huile) ?",
    "Quelles sont les opérations à effectuer lors de l'entretien des 1000 heures (PM1000) ?"
  ]

  const handleQuickPrompt = (prompt) => {
    ask(prompt)
  }

  // Ref to auto-scroll
  const messagesEndRef = useRef(null)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, currentAnswer, streaming])

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "transparent" }}>
      {/* Header */}
      <div style={{ padding: "16px 32px", background: "#2A2A1E", borderBottom: `4px solid ${C.green}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            onClick={toggleHistory}
            style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#FFF",
              width: 36, height: 36, borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s"
            }}
            onMouseOver={e => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
            onMouseOut={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
            title={historyCollapsed ? "Afficher l'historique" : "Masquer l'historique"}
          >
            {historyCollapsed ? "❱" : "❰"}
          </button>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <img src={mineassistLogo} alt="MineAssist" style={{ width: "100%", height: "100%", objectFit: "contain", mixBlendMode: "multiply" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "Rajdhani, system-ui", color: "#FFF", letterSpacing: 1 }}>
                  MineAssist AI <span style={{ fontSize: 12, color: "#2A2A1E", background: "#FFB300", padding: "1px 6px", borderRadius: 4, marginLeft: 6, verticalAlign: "middle" }}>CAT 994F</span>
                </h1>
                <div style={{ fontSize: 11, color: "#D4C9B0", marginTop: 2, letterSpacing: 2, fontWeight: 600 }}>
                  GROUPE OCP — MAINTENANCE PRÉDICTIVE
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {llmStatus && !llmStatus.llm_configured && (
            <div style={{ background: "#FF444422", border: `1px solid #FF4444`, borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#FF4444", fontWeight: 600 }}>
              ⚠ LLM Non Configuré
            </div>
          )}
          {messages.length > 0 && (
            <button onClick={clearConversation} style={{ background: "transparent", border: "1px solid #D4C9B0", color: "#D4C9B0", borderRadius: 20, padding: "6px 14px", fontSize: 12, cursor: "pointer", transition: "all 0.2s" }} onMouseOver={e => { e.target.style.background = "#D4C9B0"; e.target.style.color = "#2A2A1E" }} onMouseOut={e => { e.target.style.background = "transparent"; e.target.style.color = "#D4C9B0" }}>
              ↻ Nouveau Diagnostic
            </button>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "32px", display: "flex", flexDirection: "column", gap: 24, scrollBehavior: "smooth" }}>

        {/* Empty State / Quick Prompts */}
        {messages.length === 0 && !streaming && !currentAnswer && (
          <div style={{ margin: "auto", textAlign: "center", maxWidth: 600, animation: "fadeIn 0.5s" }}>
            <div style={{ position: "relative", width: 240, height: 160, margin: "0 auto 24px auto" }}>
              <img src="/chargeuse994F.png" alt="CAT 994F" style={{ width: "100%", height: "100%", objectFit: "contain", filter: "drop-shadow(0 12px 24px rgba(0,132,61,0.2)) drop-shadow(0 0 2px rgba(0,0,0,0.5))", animation: "floatAsk 4s ease-in-out infinite" }} />
              <img src={ocpLogo} alt="OCP" style={{ position: "absolute", bottom: -10, right: -10, width: 54, height: 54, objectFit: "contain", background: "#FFF", borderRadius: "50%", padding: 6, border: `2px solid ${C.green}`, boxShadow: "0 4px 16px rgba(0,0,0,0.15)" }} />
            </div>
            <h2 style={{ fontSize: 26, color: "#2A2A1E", marginBottom: 12, fontFamily: "Rajdhani, sans-serif", fontWeight: 800 }}>Base de Connaissance OCP</h2>
            <p style={{ color: "#6A7A70", fontSize: 15, marginBottom: 32 }}>Consultez instantanément les manuels techniques et historiques d'intervention de la chargeuse CAT 994F.</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
              {QUICK_PROMPTS.map((prompt, i) => (
                <button key={i} onClick={() => handleQuickPrompt(prompt)} style={{
                  background: "#FFF", border: `1px solid #D1DDD6`, borderLeft: `4px solid ${C.green}`, borderRadius: 8, padding: "16px 20px",
                  textAlign: "left", fontSize: 14, color: "#2A2A1E", fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", justifyContent: "space-between", alignItems: "center"
                }}
                  onMouseOver={(e) => { e.currentTarget.style.borderLeftColor = "#FFB300"; e.currentTarget.style.transform = "translateX(4px)" }}
                  onMouseOut={(e) => { e.currentTarget.style.borderLeftColor = C.green; e.currentTarget.style.transform = "translateX(0)" }}
                >
                  {prompt}
                  <span style={{ color: C.green, fontSize: 18, fontWeight: "bold" }}>→</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Historique */}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 16, maxWidth: 800, alignSelf: m.role === "user" ? "flex-end" : "flex-start" }}>
            {m.role !== "user" && (
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#FFF", border: `2px solid ${C.green}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 4 }}>
                <img src={ocpLogo} alt="OCP" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              </div>
            )}
            <div style={{
              background: m.role === "user" ? "#2A2A1E" : "#FFF",
              color: m.role === "user" ? "#FFF" : "#2A2A1E",
              padding: "16px 20px", borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.05)", fontSize: 14, lineHeight: 1.6, border: m.role === "user" ? `1px solid #FFB300` : `1px solid #D1DDD6`
            }}>
              <div dangerouslySetInnerHTML={formatText(m.content)} />
            </div>
          </div>
        ))}

        {/* Current Stream / Answer */}
        {(streaming || currentAnswer) && (
          <div style={{ display: "flex", gap: 16, maxWidth: 800, alignSelf: "flex-start" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#FFF", border: `2px solid ${C.green}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 4 }}>
              {streaming ? <span style={{ animation: "spin 2s linear infinite", fontSize: 16 }}>⏳</span> : <img src={ocpLogo} alt="OCP" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
            </div>
            <div style={{ background: "#FFF", color: "#2A2A1E", padding: "16px 20px", borderRadius: "4px 18px 18px 18px", boxShadow: "0 4px 12px rgba(0,132,61,0.08)", fontSize: 14, lineHeight: 1.6, border: `1px solid ${C.green}`, minWidth: 200 }}>

              <div dangerouslySetInnerHTML={formatText(currentAnswer)} />
              {streaming && <span style={{ display: "inline-block", width: 8, height: 16, background: C.green, marginLeft: 4, animation: "blink 1s infinite" }} />}

              {/* Sources */}
              {currentSources.length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.borderLt}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: 1.5, marginBottom: 8 }}>SOURCES CITÉES</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {currentSources.map((s, idx) => (
                      <span key={idx} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: C.greenPale, color: C.greenDark, fontWeight: 600 }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Feedback */}
              {!streaming && currentAnswer && currentAnswerId && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.borderLt}`, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: C.textMuted }}>Cette réponse était-elle utile ?</span>
                  <button onClick={() => sendFeedback("up")} disabled={!!feedback[currentAnswerId]} style={{ cursor: "pointer", background: "none", border: "none", filter: feedback[currentAnswerId] === "down" ? "grayscale(1) opacity(0.3)" : "none" }}>👍</button>
                  <button onClick={() => sendFeedback("down")} disabled={!!feedback[currentAnswerId]} style={{ cursor: "pointer", background: "none", border: "none", filter: feedback[currentAnswerId] === "up" ? "grayscale(1) opacity(0.3)" : "none" }}>👎</button>
                  {feedback[currentAnswerId] && <span style={{ fontSize: 11, color: C.green }}>Merci !</span>}
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} style={{ height: 120, flexShrink: 0 }} />
      </div>

      {/* Floating Input Area */}
      <div style={{
        padding: "0 32px 24px 32px", flexShrink: 0,
        background: "linear-gradient(to top, rgba(245,240,232,1) 60%, rgba(245,240,232,0) 100%)",
        marginTop: -100, position: "relative", zIndex: 10
      }}>
        <div style={{
          maxWidth: 850, margin: "0 auto", background: "#FFF",
          border: `1px solid #D1DDD6`, borderRadius: 20, padding: "10px 16px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", gap: 8,
          transition: "all 0.2s",
          borderBottom: `4px solid ${C.green}`
        }}
          onFocusCapture={e => e.currentTarget.style.borderColor = C.green}
          onBlurCapture={e => e.currentTarget.style.borderColor = "#D1DDD6"}>

          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
            placeholder={language === "en" ? "Ask MineAssist about CAT 994F..." : language === "ar" ? "اسأل MineAssist عن CAT 994F..." : "Posez une question à MineAssist..."}
            disabled={streaming}
            style={{
              width: "100%", minHeight: 40, maxHeight: 150, padding: "6px 0", fontSize: 16,
              fontFamily: "system-ui", fontWeight: 500, border: "none", outline: "none",
              resize: "none", color: "#2A2A1E", background: "transparent",
              direction: language === "ar" ? "rtl" : "ltr"
            }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid #F0F2F0`, paddingTop: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <select value={language} onChange={e => setLanguage(e.target.value)} disabled={streaming} style={{ fontSize: 11, padding: "5px 8px", borderRadius: 6, border: `1px solid #E0E4E2`, background: "#F9FAFA", color: "#2A2A1E", cursor: "pointer", outline: "none", fontWeight: 600 }}>
                {Object.entries(LANG_LABELS).map(([k, v]) => <option key={k} value={k}>{LANG_FLAGS[k]} {v}</option>)}
              </select>

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#2A2A1E", fontWeight: 600, cursor: "pointer", background: includeImages ? C.greenPale : "#F9FAFA", padding: "5px 10px", borderRadius: 6, border: `1px solid ${includeImages ? C.green : "#E0E4E2"}`, transition: "all 0.2s" }}>
                <input type="checkbox" checked={includeImages} onChange={e => setIncludeImages(e.target.checked)} style={{ display: "none" }} />
                {includeImages ? "🖼️ PDF Inclus" : "🖼️ Inclure PDF"}
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {streaming ? (
                <button onClick={cancel} style={{ background: "#FFF", border: `1.5px solid #FF4444`, color: "#FF4444", borderRadius: 12, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  ⏹ Arrêter
                </button>
              ) : (
                <button id="ask-submit-btn" onClick={() => ask()} disabled={!question.trim()} style={{
                  background: C.green, border: "none", color: "#FFF", borderRadius: 12, padding: "8px 20px",
                  fontSize: 13, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase",
                  cursor: !question.trim() ? "not-allowed" : "pointer",
                  opacity: !question.trim() ? 0.5 : 1,
                  boxShadow: "0 4px 12px rgba(0,132,61,0.2)"
                }}>
                  Envoyer ➔
                </button>
              )}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "center", fontSize: 10, color: "#9AABA0", marginTop: 8, fontWeight: 600, letterSpacing: 0.5 }}>
          MINEASSIST BY OCP · IA DE MAINTENANCE PRÉDICTIVE · CAT 994F
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin { 100%{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes floatAsk { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
      `}</style>
    </div>
  )
}
