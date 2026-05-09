// ─────────────────────────────────────────────────────────────────────────────
// DiagnosticRenderer.jsx  —  v4 (parseur bilingue EN/FR)
//
// Accepte les marqueurs structurels en anglais ET en français car le LLM
// traduit parfois les marqueurs malgré les instructions.
//
// Usage :
//   import DiagnosticRenderer from "./DiagnosticRenderer"
//   <DiagnosticRenderer text={result.diagnostic} />
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react"
import { C } from "../config"

// ═══════════════════════════════════════════════════════════════════════════════
// PARSEUR BILINGUE (EN + FR)
// ═══════════════════════════════════════════════════════════════════════════════

const JUNK_RX = [
  /^Afficher image\s*$/i,
  /^-{3,}$/,
  /^={3,}$/,
  /^Illustration\s+\d+\s+g\d+/i,
  /^Dépistage des pannes\s*$/i,
  /^994F Wheel Loader Power Train/i,
  /^Copyright\s+\d+/i,
  /^Tous droits/i,
  /^Réseau privé/i,
  /^\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/i,
  /^i\d{7,}\s*$/,
  /^Produit\s*:/i,
  /^Modèle\s*:/i,
  /^Configuration\s*:/i,
  /^Numéro d'imprimé/i,
]
const isJunk = l => JUNK_RX.some(rx => rx.test(l.trim()))

// ── Détecteurs bilingues ────────────────────────────────────────────────────
const isStop = l =>
  /^(STOP|Arr[eê]t)\s*\.?$/i.test(l.trim())

const isTestStep = l =>
  /^(Test Step|[ÉE]tape(?: de [Tt]est)?)\s+\d+\s*[.:]/i.test(l.trim())

const isExpected = l =>
  /^(Expected Results?|R[eé]sultat[s]?\s+[Aa]ttendu[s]?)\s*:/i.test(l.trim())

const isResults = l =>
  /^(Results?|R[eé]sultats?)\s*:?\s*$/i.test(l.trim())

const isRepair = l =>
  /^(Repair|R[eé]paration)\s*:/i.test(l.trim())

const isSystemResponse = l =>
  /^(System Response|R[eé]ponse(?: du)?\s+[Ss]yst[eè]me)\s*:/i.test(l.trim())

const isPossibleCauses = l =>
  /possible causes?|causes?\s+possibles?|les causes\s+(possibles?|de ce)/i.test(l)

const isConditions = l =>
  /Conditions Which Generate|[Cc]onditions\s+[Qq]ui\s+[Gg][eé]n[eè]rent|[Cc]onditions\s+[Gg][eé]n[eé]ratrices/i.test(l)

const isNote = l =>
  /^Note\s*:/i.test(l.trim())

const stripBullet = l => l.replace(/^[•*]\s*/, "").trim()

// Reconnaît YES/OUI/NO/NON/OK/NOT OK/NON OK avec ou sans puce
function matchOutcome(rawLine) {
  const l = stripBullet(rawLine)
  const m = l.match(/^(YES|OUI|NO|NON|OK|NOT OK|NON OK)\s*[-–:]\s*([\s\S]*)/i)
  if (!m) return null
  // Normalise vers les labels anglais pour le style
  const raw = m[1].toUpperCase()
  const label = raw === "OUI" ? "YES"
              : raw === "NON" ? "NO"
              : raw === "NON OK" ? "NOT OK"
              : raw
  return { label, rest: m[2].trim() }
}

// Détecte "Proceed to Test Step N" ou "Passer à l'étape N" etc.
function proceedStep(text) {
  const m = text.match(
    /(?:Proceed to (?:Test Step|[ÉE]tape(?: de [Tt]est)?)|Passer [àa][^d]|[ÉE]tape\s+suivante\s*:?)\s*(\d+)/i
  )
  return m ? m[m.length - 1] : null
}

// Nettoie le préambule LLM avant le premier MID/CID/FMI
function cleanLLMOutput(text) {
  const midIdx = text.search(/MID\s+\d+\s*[-–]\s*CID\s*\d+\s*[-–]\s*FMI\s*\d+/i)
  if (midIdx > 0) return text.slice(midIdx)
  return text
}

// ── parseSection ──────────────────────────────────────────────────────────────
function parseSection(raw) {
  const hm = raw.match(/MID\s+(\d+)\s*[-–]\s*CID\s*(\d+)\s*[-–]\s*FMI\s*(\d+)/i)
  if (!hm) return null

  const mid = hm[1], cidRaw = hm[2], fmi = hm[3]
  const smcsMatch = raw.match(/SMCS\s*[-–]\s*([\w-]+)/i)
  const smcs = smcsMatch ? smcsMatch[1] : null

  const lines = raw.split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !isJunk(l))

  let i = 0

  // Skip jusqu'au header MID/CID/FMI
  while (i < lines.length && !lines[i].match(/MID\s+\d+\s*[-–]\s*CID/i)) i++
  i++
  if (i < lines.length && /^SMCS\s*[-–]/i.test(lines[i])) i++
  if (i < lines.length && /^MID\s+\d+\s+CID\s+\d+\s+FMI\s+\d+\s*$/i.test(lines[i])) i++
  if (i < lines.length && isConditions(lines[i])) i++

  // ── Description ─────────────────────────────────────────────────────────────
  const description = []
  while (i < lines.length) {
    const l = lines[i]
    if (isPossibleCauses(l) || isNote(l) || isSystemResponse(l) || isTestStep(l)) break
    description.push(l)
    i++
  }

  // ── Causes ──────────────────────────────────────────────────────────────────
  const causes = []
  if (i < lines.length && isPossibleCauses(lines[i])) {
    i++
    while (i < lines.length) {
      const l = lines[i]
      if (isNote(l) || isSystemResponse(l) || isTestStep(l)) break
      if (l.length > 3) causes.push(l)
      i++
    }
  }

  // ── Notes ────────────────────────────────────────────────────────────────────
  const notes = []
  while (i < lines.length && isNote(lines[i])) {
    let text = lines[i].replace(/^Note\s*:\s*/i, "").trim()
    i++
    while (i < lines.length &&
      !isNote(lines[i]) &&
      !isSystemResponse(lines[i]) &&
      !isTestStep(lines[i])) {
      text += " " + lines[i]
      i++
    }
    notes.push(text.trim())
  }

  // ── System Response ──────────────────────────────────────────────────────────
  const systemResponse = []
  if (i < lines.length && isSystemResponse(lines[i])) {
    i++
    while (i < lines.length && !isTestStep(lines[i])) {
      const l = lines[i]
      if (!/^(The machine response is listed|La r[eé]ponse de la machine est)/i.test(l) && l.length > 2)
        systemResponse.push(l)
      i++
    }
  }

  // ── Test Steps ────────────────────────────────────────────────────────────────
  const testSteps = []
  while (i < lines.length) {
    if (!isTestStep(lines[i])) { i++; continue }

    // Extrait numéro et titre — gère "Test Step 1." et "Étape 1."
    const sm = lines[i].match(
      /^(?:Test Step|[ÉE]tape(?: de [Tt]est)?)\s+(\d+)\s*[.:]\s*(.*)/i
    )
    if (!sm) { i++; continue }
    const stepNum = sm[1], stepTitle = sm[2].trim()
    i++

    // Actions
    const actions = []
    while (i < lines.length) {
      const l = lines[i]
      if (isExpected(l) || isResults(l) || matchOutcome(l) || isTestStep(l)) break
      if (l.length > 1) actions.push(l)
      i++
    }

    // Expected Result
    let expectedResult = ""
    if (i < lines.length && isExpected(lines[i])) {
      i++
      const parts = []
      while (i < lines.length) {
        const l = lines[i]
        if (isResults(l) || matchOutcome(l) || isTestStep(l)) break
        if (l.length > 1) parts.push(l)
        i++
      }
      expectedResult = parts.join(" ")
    }

    // "Results:" header
    if (i < lines.length && isResults(lines[i])) i++

    // Blocs OUI/NON/OK/NON OK
    const results = []
    while (i < lines.length && !isTestStep(lines[i])) {
      const l = lines[i]
      const om = matchOutcome(l)
      if (!om) {
        if (results.length > 0 && l.length > 2 && !isStop(l))
          results[results.length - 1].text += " " + l
        i++; continue
      }

      let text = om.rest
      let repair = ""
      let next = proceedStep(text) || (isStop(text) ? "STOP" : null)
      i++

      while (i < lines.length) {
        const ll = lines[i]
        if (isStop(ll)) { i++; break }
        if (matchOutcome(ll)) break
        if (isTestStep(ll)) break
        if (isRepair(ll)) {
          repair = ll.replace(/^(?:Repair|R[eé]paration)\s*:\s*/i, "").trim()
          i++
          while (i < lines.length) {
            const rl = lines[i]
            if (isStop(rl)) { i++; break }
            if (matchOutcome(rl) || isTestStep(rl)) break
            if (rl.length > 1) repair += " " + rl
            i++
          }
          if (!next) next = proceedStep(repair)
          break
        }
        if (ll.length > 1) { text += " " + ll; if (!next) next = proceedStep(ll) }
        i++
      }

      results.push({ label: om.label, text: text.trim(), repair: repair.trim(), next: next || null })
    }

    testSteps.push({ num: stepNum, title: stepTitle, actions, expectedResult, results })
  }

  // ── Libellé FMI en français ───────────────────────────────────────────────────
  const FMI_FR = {
    "0": "Donnée valide — au-dessus de la plage normale",
    "1": "Donnée valide — en dessous de la plage normale",
    "2": "Donnée erratique / intermittente",
    "3": "Tension trop haute — court-circuit haut",
    "4": "Tension trop basse — court-circuit bas",
    "5": "Courant trop faible — circuit ouvert",
    "6": "Courant trop élevé — circuit à la masse",
    "7": "Système mécanique non réactif",
    "8": "Fréquence ou largeur d'impulsion anormale",
    "9": "Mise à jour anormale — communication",
    "11": "Mode de défaillance non identifiable",
    "12": "Dispositif ou composant défectueux",
    "13": "Hors calibration",
  }

  return {
    code: `MID ${mid} – CID ${cidRaw} – FMI ${fmi}`,
    mid, cid: cidRaw, fmi,
    fmiLabel: FMI_FR[fmi] || `FMI ${fmi}`,
    smcs,
    description: description.filter(l => l.length > 4),
    causes: causes.filter(l => l.length > 3),
    notes,
    systemResponse: systemResponse.filter(l => l.length > 3),
    testSteps,
  }
}

function splitIntoSections(text) {
  const clean = cleanLLMOutput(text)
  const parts = clean.split(/(?=MID\s+\d+\s*[-–]\s*CID\s*\d+\s*[-–]\s*FMI\s*\d+)/i)
  return parts.map(p => parseSection(p)).filter(Boolean)
}

// ═══════════════════════════════════════════════════════════════════════════════
// COULEURS
// ═══════════════════════════════════════════════════════════════════════════════

function fmiBadge(fmi) {
  const map = {
    "3": { bg:"#FDF3E3", color:"#7D4806", border:"#C4760A" },
    "4": { bg:"#FDF3E3", color:"#7D4806", border:"#C4760A" },
    "5": { bg:"#FDECEA", color:"#922B21", border:"#C0392B" },
    "6": { bg:"#FDECEA", color:"#922B21", border:"#C0392B" },
    "9": { bg:"#EAF0FD", color:"#154680", border:"#1A5276" },
  }
  return map[fmi] || { bg: C.greenPale, color: C.greenDark, border: C.green }
}

const OUTCOME_STYLES = {
  YES:      { fr:"OUI",    bg:"#E8F5EE", border:"#00843D", textColor:"#004D24", iconBg:"#00843D", icon:"✓" },
  OK:       { fr:"OK",     bg:"#E8F5EE", border:"#00843D", textColor:"#004D24", iconBg:"#00843D", icon:"✓" },
  NO:       { fr:"NON",    bg:"#FDECEA", border:"#C0392B", textColor:"#7B241C", iconBg:"#C0392B", icon:"✗" },
  "NOT OK": { fr:"NON OK", bg:"#FDECEA", border:"#C0392B", textColor:"#7B241C", iconBg:"#C0392B", icon:"✗" },
}
const outcomeStyle = lbl => OUTCOME_STYLES[lbl] || OUTCOME_STYLES.YES

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSANTS
// ═══════════════════════════════════════════════════════════════════════════════

function TitreSection({ children, icon }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:7,
      fontSize:9, fontWeight:700, letterSpacing:3, color:C.textMuted,
      textTransform:"uppercase", fontFamily:"'Rajdhani',sans-serif",
      marginBottom:10, paddingBottom:6, borderBottom:`1px solid ${C.border}`,
    }}>
      {icon} {children}
    </div>
  )
}

function EnteteSis({ s }) {
  const b = fmiBadge(s.fmi)
  return (
    <div style={{
      background:"linear-gradient(135deg,#1a2e1a 0%,#0d1f0d 100%)",
      padding:"18px 22px 15px", borderBottom:`3px solid ${C.green}`,
    }}>
      <div style={{
        fontSize:9, letterSpacing:3, color:"rgba(200,220,200,0.38)",
        fontFamily:"'Rajdhani',sans-serif", fontWeight:700,
        textTransform:"uppercase", marginBottom:8,
      }}>
        994F WHEEL LOADER · GROUPE MOTOPROPULSEUR · RENR6306-02
      </div>
      <div style={{display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap"}}>
        <div>
          <div style={{
            fontFamily:"'Rajdhani',sans-serif", fontWeight:700,
            fontSize:25, color:"#fff", letterSpacing:1, lineHeight:1.1,
          }}>
            MID {s.mid}
            <span style={{color:"rgba(255,255,255,0.22)",margin:"0 6px"}}>–</span>
            CID {s.cid}
            <span style={{color:"rgba(255,255,255,0.22)",margin:"0 6px"}}>–</span>
            FMI {s.fmi}
          </div>
          {s.smcs && (
            <div style={{
              fontSize:11, color:"rgba(200,220,200,0.42)", letterSpacing:2,
              fontFamily:"'Rajdhani',sans-serif", fontWeight:600, marginTop:4,
            }}>
              SMCS — {s.smcs}
            </div>
          )}
        </div>
        <div style={{
          marginLeft:"auto", padding:"5px 12px",
          background:b.bg, color:b.color, border:`1px solid ${b.border}`,
          fontSize:10, fontWeight:700, fontFamily:"'Rajdhani',sans-serif",
          letterSpacing:1, textTransform:"uppercase",
          alignSelf:"center", maxWidth:210, textAlign:"center", lineHeight:1.4,
        }}>
          {s.fmiLabel}
        </div>
      </div>
    </div>
  )
}

function CarteResultat({ result }) {
  const st = outcomeStyle(result.label)
  return (
    <div style={{
      border:`1px solid ${st.border}`, borderTop:`3px solid ${st.border}`,
      background:st.bg, padding:"10px 12px",
    }}>
      <div style={{
        display:"flex", alignItems:"center", gap:6,
        fontSize:10, fontWeight:800, letterSpacing:2,
        color:st.textColor, fontFamily:"'Rajdhani',sans-serif", marginBottom:7,
      }}>
        <span style={{
          width:17, height:17, background:st.iconBg, color:"#fff",
          fontSize:9, display:"inline-flex", alignItems:"center",
          justifyContent:"center", fontWeight:900,
        }}>{st.icon}</span>
        {st.fr}
      </div>
      {result.text && (
        <div style={{fontSize:12, color:st.textColor, lineHeight:1.6, marginBottom:result.repair?7:0}}>
          {result.text}
        </div>
      )}
      {result.repair && (
        <div style={{
          fontSize:11, color:C.textMid, fontStyle:"italic",
          borderTop:`1px dashed ${st.border}`, paddingTop:6, marginTop:4,
        }}>
          🔧 {result.repair}
        </div>
      )}
      {result.next && (
        <div style={{
          marginTop:7, fontSize:10, fontWeight:700, letterSpacing:1,
          color: result.next==="STOP" ? "#C0392B" : C.green,
          fontFamily:"'Rajdhani',sans-serif",
        }}>
          {result.next==="STOP" ? "⏹ ARRÊT" : `→ Étape ${result.next}`}
        </div>
      )}
    </div>
  )
}

function EtapeTest({ step }) {
  const [ouvert, setOuvert] = useState(true)
  return (
    <div style={{
      border:`1px solid ${C.border}`, borderLeft:`4px solid ${C.greenDark}`,
      marginBottom:10, background:"rgba(255,255,255,0.75)", overflow:"hidden",
    }}>
      <button
        onClick={() => setOuvert(o => !o)}
        style={{
          width:"100%", textAlign:"left", border:"none", cursor:"pointer",
          background: ouvert
            ? "linear-gradient(90deg,rgba(0,132,61,0.09),transparent)"
            : "rgba(255,255,255,0.45)",
          padding:"11px 14px", display:"flex", alignItems:"center",
          gap:10, transition:"background 0.2s",
        }}
      >
        <span style={{
          minWidth:26, height:26, background:C.greenDark, color:"#fff",
          fontSize:12, fontWeight:800, display:"flex", alignItems:"center",
          justifyContent:"center", flexShrink:0, fontFamily:"'Rajdhani',sans-serif",
          clipPath:"polygon(4px 0%,100% 0%,calc(100% - 4px) 100%,0% 100%)",
        }}>{step.num}</span>
        <span style={{
          flex:1, fontFamily:"'Rajdhani',sans-serif", fontWeight:700,
          fontSize:12, letterSpacing:1.5, color:C.greenDark, textTransform:"uppercase",
        }}>
          ÉTAPE {step.num} — {step.title}
        </span>
        <span style={{fontSize:11, color:C.textMuted}}>{ouvert?"▲":"▼"}</span>
      </button>

      {ouvert && (
        <div style={{padding:"13px 15px"}}>
          {step.actions.length > 0 && (
            <div style={{marginBottom:13}}>
              <div style={{
                fontSize:9, fontWeight:700, letterSpacing:2, color:C.textMuted,
                textTransform:"uppercase", fontFamily:"'Rajdhani',sans-serif", marginBottom:7,
              }}>Procédure</div>
              <ol style={{margin:0, paddingLeft:20}}>
                {step.actions.map((a, i) => (
                  <li key={i} style={{fontSize:13, color:C.text, lineHeight:1.7, marginBottom:3}}>
                    {a.replace(/^[A-Z]\.\s*/, "")}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {step.expectedResult && (
            <div style={{
              padding:"9px 13px", marginBottom:12,
              background:"#F7F0DC", border:`1px solid ${C.sand}`, borderLeft:`3px solid ${C.sand}`,
            }}>
              <div style={{
                fontSize:9, fontWeight:700, letterSpacing:2, color:C.orange,
                textTransform:"uppercase", fontFamily:"'Rajdhani',sans-serif", marginBottom:4,
              }}>Résultat attendu</div>
              <div style={{fontSize:13, color:C.textMid, lineHeight:1.6}}>{step.expectedResult}</div>
            </div>
          )}

          {step.results.length > 0 && (
            <div style={{
              display:"grid",
              gridTemplateColumns: step.results.length > 1 ? "1fr 1fr" : "1fr",
              gap:9,
            }}>
              {step.results.map((r, i) => <CarteResultat key={i} result={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SectionDiagnostic({ s, index, total }) {
  return (
    <div style={{
      background:C.bgCard, border:`1px solid ${C.border}`,
      boxShadow:"0 2px 14px rgba(0,0,0,0.05)",
      marginBottom: total > 1 ? 20 : 0, overflow:"hidden",
    }}>
      <EnteteSis s={s} />
      <div style={{padding:"18px 22px"}}>
        {total > 1 && (
          <div style={{
            fontSize:9, color:C.textLight, letterSpacing:2,
            fontFamily:"'Rajdhani',sans-serif", marginBottom:12,
          }}>CODE {index+1} / {total}</div>
        )}

        {s.description.length > 0 && (
          <div style={{
            fontSize:13, color:C.textMid, lineHeight:1.75,
            marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}`,
          }}>
            {s.description.map((l,i) => <p key={i} style={{margin:"0 0 5px"}}>{l}</p>)}
          </div>
        )}

        {s.notes.map((n,i) => (
          <div key={i} style={{
            padding:"8px 12px", marginBottom:8, fontSize:12,
            background:"#F7F7F2", border:"1px solid #D0D0C0",
            borderLeft:`3px solid ${C.textMuted}`,
            color:C.textMid, lineHeight:1.6, fontStyle:"italic",
          }}>
            <span style={{fontStyle:"normal", fontWeight:700, color:C.textMuted}}>Note : </span>{n}
          </div>
        ))}

        {s.causes.length > 0 && (
          <div style={{marginBottom:16}}>
            <TitreSection icon="⚠">Causes possibles</TitreSection>
            {s.causes.map((c,i) => (
              <div key={i} style={{
                display:"flex", gap:10, alignItems:"flex-start",
                padding:"7px 11px", border:`1px solid ${C.border}`,
                background: i%2===0 ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.3)",
                marginBottom:4,
              }}>
                <span style={{
                  minWidth:20, height:20, background:C.orange, color:"#fff",
                  fontSize:10, fontWeight:700, display:"flex", alignItems:"center",
                  justifyContent:"center", flexShrink:0, fontFamily:"'Rajdhani',sans-serif",
                }}>{i+1}</span>
                <span style={{fontSize:13, color:C.text, lineHeight:1.5}}>{c}</span>
              </div>
            ))}
          </div>
        )}

        {s.systemResponse.length > 0 && (
          <div style={{
            padding:"11px 14px", marginBottom:16,
            background:"#EAF0FD", border:"1px solid #AEC6E8", borderLeft:"4px solid #1A5276",
          }}>
            <div style={{
              fontSize:9, fontWeight:700, letterSpacing:3, color:"#1A5276",
              textTransform:"uppercase", fontFamily:"'Rajdhani',sans-serif", marginBottom:6,
            }}>ℹ Réponse système</div>
            {s.systemResponse.map((l,i) => (
              <div key={i} style={{
                fontSize:13, color:"#1A3A5C", lineHeight:1.65,
                paddingLeft: s.systemResponse.length>1 ? 12 : 0,
              }}>
                {s.systemResponse.length>1 && "• "}{l}
              </div>
            ))}
          </div>
        )}

        {s.testSteps.length > 0 && (
          <div>
            <TitreSection icon="🔧">
              Procédure de dépistage — {s.testSteps.length} étape{s.testSteps.length>1?"s":""}
            </TitreSection>
            {s.testSteps.map(step => <EtapeTest key={step.num} step={step} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export default function DiagnosticRenderer({ text }) {
  if (!text) return null

  const hasCodes = /MID\s+\d+\s*[-–]\s*CID\s*\d+/i.test(text)

  if (!hasCodes) {
    return (
      <div style={{
        padding:"16px 20px", background:"rgba(255,255,255,0.75)",
        border:`1px solid ${C.border}`, borderLeft:`4px solid ${C.orange}`,
        fontSize:14, color:C.text, lineHeight:1.75, whiteSpace:"pre-wrap",
      }}>
        {text}
      </div>
    )
  }

  const sections = splitIntoSections(text)

  if (!sections.length) {
    return (
      <div style={{
        padding:"16px 20px", background:"rgba(255,255,255,0.75)",
        border:`1px solid ${C.border}`, borderLeft:`4px solid ${C.orange}`,
        fontSize:14, color:C.text, lineHeight:1.75, whiteSpace:"pre-wrap",
      }}>
        {text}
      </div>
    )
  }

  return (
    <div>
      <div style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"7px 14px", marginBottom:14,
        background:"#1a2e1a", color:"rgba(200,220,200,0.58)",
        fontSize:10, fontFamily:"'Rajdhani',sans-serif",
        fontWeight:700, letterSpacing:2, textTransform:"uppercase",
      }}>
        <span style={{
          background:C.green, color:"#fff", padding:"2px 8px",
          fontSize:9, letterSpacing:1, flexShrink:0,
        }}>CAT SIS</span>
        994F Wheel Loader — Dépistage des pannes · RENR6306-02
        <span style={{marginLeft:"auto", opacity:0.5}}>
          {sections.length} code{sections.length>1?"s":""} détecté{sections.length>1?"s":""}
        </span>
      </div>

      {sections.map((s,i) => (
        <SectionDiagnostic key={i} s={s} index={i} total={sections.length} />
      ))}
    </div>
  )
}
