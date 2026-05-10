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
import { API } from "../config"

const C = {
  bg: "#F5F0E8", card: "rgba(255,253,248,0.96)",
  green: "#00843D", greenDark: "#005C2B", greenPale: "#E8F5EE",
  red: "#DC2626", redPale: "#FEE2E2",
  orange: "#F59E0B", orangePale: "#FEF3C7",
  text: "#1C1A14", textMid: "#4A4535", textMuted: "#8A7D60",
  border: "#D4C9B0", borderLt: "#E8E2D4",
  sand: "#C9A84C",
  shadow: "0 1px 2px rgba(28,26,20,0.04), 0 4px 12px rgba(28,26,20,0.06)",
}

const LANG_LABELS = { auto: "Auto", fr: "Français", en: "English", ar: "العربية" }
const LANG_FLAGS  = { auto: "🌐", fr: "🇫🇷", en: "🇬🇧", ar: "🇸🇦" }

export default function AskPageV2({ apiFetch, onSave }) {
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
      try { abortRef.current.abort() } catch (_) {}
      abortRef.current = null
    }
    setStreaming(false)
  }

  const ask = async () => {
    if (!question.trim() || streaming) return
    setStreaming(true)
    setCurrentAnswer("")
    setCurrentSources([])
    setCurrentLang(null)
    setCurrentAnswerId(null)

    const previousMessages = messages.slice(-4)
    const body = JSON.stringify({
      question,
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
        { role: "user", content: question },
        { role: "assistant", content: accumulated },
      ])
      onSave?.({
        id: Date.now(), type: "ask", question, answer: accumulated,
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
            setCurrentAnswer(data.answer || "(réponse vide)")
            setCurrentSources(data.sources || [])
            setCurrentLang(data.language_detected)
            setCurrentAnswerId(data.answer_id)
            setMessages(prev => [
              ...prev,
              { role: "user", content: question },
              { role: "assistant", content: data.answer },
            ])
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
    } catch (_) {}
  }

  const clearConversation = () => {
    setMessages([])
    setCurrentAnswer("")
    setCurrentSources([])
    setCurrentAnswerId(null)
    setQuestion("")
  }

  return (
    <div style={{ padding: "26px 32px", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "Rajdhani, system-ui", color: C.text }}>
        Ask MineAssist · CAT 994F
      </h1>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
        Streaming · Mémoire conversationnelle · FR / EN / العربية
      </div>

      {/* Statut LLM */}
      {llmStatus && !llmStatus.llm_configured && (
        <div style={{ background: C.redPale, border: `1px solid ${C.red}`, borderRadius: 6,
          padding: "10px 14px", marginTop: 14, fontSize: 12, color: C.red }}>
          ⚠ {llmStatus.message || "OPENROUTER_API_KEY manquante dans backend/.env"}
        </div>
      )}

      {/* Conversation */}
      {messages.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 16, marginTop: 16, maxHeight: 400, overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: 1.5 }}>
              CONVERSATION · {messages.length / 2} échange(s)
            </span>
            <button onClick={clearConversation} style={{
              fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "#fff",
              border: `1px solid ${C.border}`, cursor: "pointer", color: C.textMid,
            }}>
              ↻ Nouveau sujet
            </button>
          </div>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 10, display: "flex",
              flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 8 }}>
              <div style={{
                fontSize: 12, padding: "8px 12px", borderRadius: 8, maxWidth: "75%",
                background: m.role === "user" ? C.greenPale : "#F8F4EC",
                color: C.text,
                whiteSpace: "pre-wrap",
              }}>
                {m.content.length > 600 ? m.content.slice(0, 600) + "…" : m.content}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Réponse en cours / dernière */}
      {(streaming || currentAnswer) && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 18, marginTop: 14, boxShadow: C.shadow }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.greenDark, letterSpacing: 1.5 }}>
                {streaming ? "GÉNÉRATION..." : "RÉPONSE"}
              </span>
              {currentLang && (
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4,
                  background: C.greenPale, color: C.greenDark }}>
                  {LANG_FLAGS[currentLang]} {LANG_LABELS[currentLang]}
                </span>
              )}
              {streaming && (
                <span style={{ fontSize: 10, color: C.textMuted }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                    background: C.green, animation: "pulse 1s infinite" }} />
                  &nbsp;Stream actif
                </span>
              )}
            </div>
            {streaming && (
              <button onClick={cancel} style={{
                fontSize: 10, padding: "4px 10px", borderRadius: 4, background: "#fff",
                border: `1px solid ${C.red}`, color: C.red, cursor: "pointer",
              }}>
                ⏹ Arrêter
              </button>
            )}
          </div>

          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap",
            fontFamily: currentLang === "ar" ? "system-ui, sans-serif" : "system-ui",
            direction: currentLang === "ar" ? "rtl" : "ltr",
          }}>
            {currentAnswer || (streaming && "…")}
          </div>

          {/* Sources */}
          {currentSources.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.borderLt}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, letterSpacing: 1.5, marginBottom: 6 }}>
                SOURCES CITÉES
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {currentSources.map((s, i) => (
                  <span key={i} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4,
                    background: C.greenPale, color: C.greenDark, border: `1px solid ${C.green}30` }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Feedback */}
          {!streaming && currentAnswer && currentAnswerId && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.borderLt}`,
              display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: C.textMuted }}>Cette réponse était utile ?</span>
              <button onClick={() => sendFeedback("up")} disabled={!!feedback[currentAnswerId]} style={{
                fontSize: 14, padding: "4px 10px", borderRadius: 4, cursor: feedback[currentAnswerId] ? "default" : "pointer",
                background: feedback[currentAnswerId] === "up" ? C.greenPale : "#fff",
                border: `1px solid ${feedback[currentAnswerId] === "up" ? C.green : C.border}`,
              }}>
                👍
              </button>
              <button onClick={() => sendFeedback("down")} disabled={!!feedback[currentAnswerId]} style={{
                fontSize: 14, padding: "4px 10px", borderRadius: 4, cursor: feedback[currentAnswerId] ? "default" : "pointer",
                background: feedback[currentAnswerId] === "down" ? C.redPale : "#fff",
                border: `1px solid ${feedback[currentAnswerId] === "down" ? C.red : C.border}`,
              }}>
                👎
              </button>
              {feedback[currentAnswerId] && (
                <span style={{ fontSize: 10, color: C.green }}>Merci !</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Zone de saisie */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 16, marginTop: 14, boxShadow: C.shadow }}>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) ask() }}
          placeholder={
            language === "en" ? "Ask a technical question about CAT 994F..."
            : language === "ar" ? "اسأل سؤالاً تقنياً عن CAT 994F..."
            : "Posez une question technique sur la CAT 994F..."
          }
          disabled={streaming}
          style={{
            width: "100%", minHeight: 80, padding: 12, fontSize: 13, fontFamily: "system-ui",
            border: `1px solid ${C.border}`, borderRadius: 6, outline: "none", resize: "vertical",
            color: C.text, background: "#fff",
            direction: language === "ar" ? "rtl" : "ltr",
          }}
        />
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={ask} disabled={streaming || !question.trim()} style={{
            background: streaming || !question.trim() ? C.textMuted : C.green,
            color: "#fff", border: "none", padding: "10px 22px", fontSize: 12, fontWeight: 700,
            letterSpacing: 1.5, fontFamily: "Rajdhani, system-ui", textTransform: "uppercase",
            borderRadius: 4, cursor: streaming || !question.trim() ? "not-allowed" : "pointer",
          }}>
            {streaming ? "⟳ Génération…" : "▶ Demander"}
          </button>
          <span style={{ fontSize: 10, color: C.textMuted }}>Ctrl+Entrée</span>

          <select value={language} onChange={e => setLanguage(e.target.value)} disabled={streaming}
            style={{ fontSize: 11, padding: "5px 8px", borderRadius: 4, border: `1px solid ${C.border}`,
              background: "#fff", color: C.text }}>
            {Object.entries(LANG_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{LANG_FLAGS[k]} {v}</option>
            ))}
          </select>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.textMid }}>
            <input type="checkbox" checked={includeImages}
              onChange={e => setIncludeImages(e.target.checked)} />
            Images PDF
          </label>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  )
}
