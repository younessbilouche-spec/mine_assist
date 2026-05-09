import { useState, useEffect } from "react"
import GmaoDashboard from "./pages/GmaoDashboard"
import AnomalyDashboard from "./pages/AnomalyDashboard"
import GeoAnomalyDashboard from "./pages/GeoAnomalyDashboard"
import OilAnalysisDashboard from "./pages/OilAnalysisDashboard"
import MaintenanceExecutiveDashboard from "./pages/MaintenanceExecutiveDashboard"
import ExecutiveReportPage from "./pages/ExecutiveReportPage"
import { useAuth } from "./hooks/useAuth"
import LoginPage from "./pages/LoginPage"
import DiagnosticRenderer from "./pages/DiagnosticRenderer"
import CapteursPage from "./pages/CapteursPage"
import PredictionPage from "./pages/PredictionPage"
import AlertesPage    from "./pages/AlertesPage"
import OcpFilesPage from "./pages/OcpFilesPage"
import OcpDefautPage from "./pages/OcpDefautPage"
import OcpHealthPage from "./pages/OcpHealthPage"
import OcpTroubleshootingPage from "./pages/OcpTroubleshootingPage"
import DashboardShell from "./components/ui/DashboardShell"

import { API, C } from "./config"

// ── Storage helpers (localStorage) ────────────────────────────────────────
const STORAGE_KEY = "mineassist_history"

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
  } catch { return [] }
}

function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)))
  } catch {
    return
  }
}

// ── Background ────────────────────────────────────────────────────────────
const PhosphateBg = () => (
  <div style={{
    position:"fixed", inset:0, zIndex:0, overflow:"hidden",
    background:"linear-gradient(145deg, #F7F2E6 0%, #EDE5D0 40%, #E8DFC8 100%)",
    pointerEvents:"none",
  }}>
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{opacity:0.18}}>
      <defs>
        <pattern id="hex" x="0" y="0" width="80" height="92" patternUnits="userSpaceOnUse">
          <polygon points="40,4 74,22 74,58 40,76 6,58 6,22" fill="none" stroke="#8B6914" strokeWidth="1"/>
          <polygon points="40,14 64,27 64,53 40,66 16,53 16,27" fill="none" stroke="#00843D" strokeWidth="0.5"/>
        </pattern>
        <pattern id="grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="40" y2="40" stroke="#B8AA90" strokeWidth="0.4"/>
          <line x1="40" y1="0" x2="0" y2="40" stroke="#B8AA90" strokeWidth="0.4"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)"/>
      <rect width="100%" height="100%" fill="url(#hex)" opacity="0.7"/>
    </svg>
    <svg style={{position:"absolute",top:-80,right:-60,opacity:0.07}} width="500" height="500">
      <polygon points="250,0 450,130 450,370 250,500 50,370 50,130" fill="#00843D"/>
    </svg>
    <svg style={{position:"absolute",bottom:-120,left:-80,opacity:0.05}} width="600" height="600">
      <polygon points="300,0 540,150 540,450 300,600 60,450 60,150" fill="#C4760A"/>
    </svg>
  </div>
)

// ── Shared Styles ──────────────────────────────────────────────────────────
const S = {
  app:   { minHeight:"100vh", color:C.text, fontFamily:"'Rajdhani', sans-serif", position:"relative" },
  nav:   {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"0 16px", height:64, background:"rgba(255,253,248,0.95)",
    borderBottom:`3px solid ${C.green}`, position:"sticky", top:0, zIndex:200,
    backdropFilter:"blur(12px)", boxShadow:"0 2px 20px rgba(0,132,61,0.12)",
    flexWrap:"wrap",
    overflow:"hidden", gap:0,
  },
  ocpBadge: {
    background:C.green, color:"#fff", fontFamily:"'Rajdhani', sans-serif",
    fontWeight:700, fontSize:18, letterSpacing:4, padding:"4px 14px",
    clipPath:"polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%)",
    boxShadow:"0 2px 12px rgba(0,132,61,0.35)",
  },
  tab: (active) => ({
    display:"flex", alignItems:"center", gap:5, padding:"0 14px",
    borderBottom: active ? `3px solid ${C.green}` : "3px solid transparent",
    borderTop:"3px solid transparent", borderLeft:"none", borderRight:"none",
    background: active ? C.greenPale : "transparent",
    color: active ? C.greenDark : C.textMuted,
    fontFamily:"'Rajdhani', sans-serif", fontWeight:700, fontSize:12,
    letterSpacing:1.5, cursor:"pointer", textTransform:"uppercase", transition:"all 0.2s",
    whiteSpace:"nowrap",
  }),
  label: {
    display:"block", fontSize:11, fontWeight:700, color:C.textMuted,
    letterSpacing:2, textTransform:"uppercase", marginBottom:8,
  },
  input: {
    width:"100%", background:"rgba(255,255,255,0.9)", border:`1px solid ${C.border}`,
    color:C.text, padding:"11px 14px", fontFamily:"'Rajdhani', sans-serif",
    fontSize:15, outline:"none", boxSizing:"border-box", transition:"all 0.2s",
  },
  textarea: {
    width:"100%", background:"rgba(255,255,255,0.9)", border:`1px solid ${C.border}`,
    color:C.text, padding:"11px 14px", fontFamily:"'Rajdhani', sans-serif",
    fontSize:15, outline:"none", resize:"vertical", minHeight:100,
    boxSizing:"border-box", transition:"all 0.2s",
  },
  btn: {
    background:C.green, color:"#fff", border:"none", padding:"12px 32px",
    fontFamily:"'Rajdhani', sans-serif", fontSize:13, fontWeight:700,
    letterSpacing:3, cursor:"pointer", textTransform:"uppercase",
    clipPath:"polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%)",
    boxShadow:"0 3px 12px rgba(0,132,61,0.25)", transition:"all 0.2s",
  },
  btnOff: {
    background:C.border, color:C.textLight, border:"none", padding:"12px 32px",
    fontFamily:"'Rajdhani', sans-serif", fontSize:13, fontWeight:700,
    letterSpacing:3, cursor:"not-allowed", textTransform:"uppercase",
    clipPath:"polygon(10px 0%, 100% 0%, calc(100% - 10px) 100%, 0% 100%)",
  },
  answerBox: {
    background:"rgba(255,255,255,0.7)", border:`1px solid ${C.border}`,
    borderLeft:`4px solid ${C.green}`, padding:"18px 22px",
    fontSize:15, lineHeight:1.85, whiteSpace:"pre-wrap", color:C.text,
  },
  grid2: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:18, marginBottom:18 },
}

// ── Small components ──────────────────────────────────────────────────────
function PageTitle({ children }) {
  return (
    <div style={{fontSize:12,fontWeight:700,color:C.textMuted,letterSpacing:4,
      textTransform:"uppercase",marginBottom:24,display:"flex",alignItems:"center",gap:10}}>
      <div style={{width:4,height:16,background:C.green,borderRadius:2}}/>
      {children}
      <div style={{flex:1,height:1,background:`linear-gradient(90deg,${C.border},transparent)`}}/>
    </div>
  )
}

function Card({ children, style }) {
  return (
    <div style={{background:C.bgCard,border:`1px solid ${C.border}`,
      borderTop:`2px solid ${C.sand}`,padding:"22px 26px",marginBottom:18,
      backdropFilter:"blur(8px)",boxShadow:"0 2px 10px rgba(139,105,20,0.07)",...style}}>
      {children}
    </div>
  )
}

function CardTitle({ children }) {
  return (
    <div style={{fontSize:11,fontWeight:700,color:C.textMuted,letterSpacing:3,
      textTransform:"uppercase",marginBottom:14,paddingBottom:10,
      borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:7}}>
      <div style={{width:3,height:11,background:C.sand}}/>
      {children}
    </div>
  )
}

function AnswerSources({ sources }) {
  if (!sources?.length) return (
    <div style={{marginTop:12,padding:"9px 14px",background:C.orangePale,
      border:`1px solid rgba(196,118,10,0.2)`,borderLeft:`3px solid ${C.orange}`,
      fontSize:13,color:C.textMid,fontStyle:"italic"}}>
      ℹ️ Réponse basée sur connaissances générales
    </div>
  )
  return (
    <div style={{marginTop:12}}>
      <div style={S.label}>Sources</div>
      {sources.map((s,i) => {
        const isPptx = s.toLowerCase().includes(".pptx") || s.toLowerCase().includes(".ppt")
        const icon   = isPptx ? "📊" : s.toLowerCase().includes(".pdf") ? "📄" : "📋"
        return (
          <div key={i} style={{fontSize:12,color:C.greenDark,padding:"5px 12px",
            background:C.greenPale,borderLeft:`3px solid ${C.green}`,marginBottom:3}}>
            {icon} {s}
          </div>
        )
      })}
    </div>
  )
}

// ── PDF / PPTX page images ─────────────────────────────────────────────────
function PdfImages({ images }) {
  const [expanded, setExpanded] = useState(null)
  if (!images?.length) return null
  const hasCropped = images.some(img => img.cropped)
  return (
    <div style={{marginTop:18}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <div style={S.label}>📖 Illustrations extraites des documents</div>
        {hasCropped && (
          <div style={{fontSize:10,fontWeight:700,letterSpacing:1,
            background:"rgba(0,132,61,0.1)",color:C.greenDark,
            border:"1px solid rgba(0,132,61,0.25)",padding:"2px 10px",
            display:"flex",alignItems:"center",gap:5}}>
            🎯 Zone ciblée automatiquement
          </div>
        )}
      </div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        {images.map((img,i) => {
          const isPptx   = img.pdf?.toLowerCase().includes(".pptx")
          const label    = isPptx ? `Diapo ${img.page}` : `Page ${img.page}`
          const isCrop   = img.cropped
          const isExpand = expanded === i
          return (
            <div key={i} style={{
              border:`2px solid ${isExpand ? C.green : isCrop ? C.greenLt : C.border}`,
              background:"#fff",cursor:"pointer",transition:"all 0.25s",
              boxShadow: isExpand ? `0 0 0 3px ${C.greenPale},0 4px 16px rgba(0,132,61,0.15)` : "0 2px 8px rgba(0,0,0,0.08)",
              flex:"0 0 auto",position:"relative",
            }} onClick={()=>setExpanded(isExpand ? null : i)}>
              {isCrop && !isExpand && (
                <div style={{position:"absolute",top:6,right:6,zIndex:2,
                  background:C.green,color:"#fff",fontSize:9,fontWeight:700,padding:"2px 7px",letterSpacing:1}}>
                  🎯 CIBLÉ
                </div>
              )}
              <img
                src={`data:image/png;base64,${img.image_b64}`}
                alt={`${img.pdf} ${label}`}
                style={{display:"block",padding:4,
                  width: isExpand ? "min(720px,80vw)" : isCrop ? 220 : 160,
                  height: isExpand ? "auto" : isCrop ? "auto" : 110,
                  maxHeight: isExpand ? "none" : isCrop ? 200 : 110,
                  objectFit: isExpand ? "contain" : "cover",
                  transition:"all 0.3s",
                }}
              />
              <div style={{padding:"5px 8px",borderTop:`1px solid ${C.border}`,
                fontSize:11,color:C.textMuted,
                display:"flex",justifyContent:"space-between",alignItems:"center",gap:6,
                background: isCrop ? "rgba(0,132,61,0.04)" : "transparent"}}>
                <span style={{maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {isPptx?"📊":"📄"} {img.pdf}
                </span>
                <span style={{
                  background: isCrop ? C.greenPale : C.sandPale,
                  color: isCrop ? C.greenDark : C.textMid,
                  padding:"1px 7px",fontWeight:700,fontSize:10,whiteSpace:"nowrap"}}>
                  {label}
                </span>
              </div>
              {isExpand && (
                <div style={{padding:"6px",textAlign:"center",fontSize:11,
                  color:C.green,fontWeight:600,background:C.greenPale}}>
                  ▲ Cliquer pour réduire
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{marginTop:8,fontSize:11,color:C.textLight,fontStyle:"italic"}}>
        💡 Cliquer pour agrandir · 🎯 = zone du composant ciblée automatiquement
      </div>
    </div>
  )
}


// ── Schema Location Crops ─────────────────────────────────────────────────
function SchemaLocations({ locations }) {
  const [expanded, setExpanded] = useState(null)
  if (!locations?.length) return null

  return (
    <div style={{marginTop:22}}>
      {/* Header banner */}
      <div style={{
        display:"flex", alignItems:"center", gap:10, marginBottom:12,
        padding:"9px 14px",
        background:"linear-gradient(90deg,rgba(196,118,10,0.10) 0%,rgba(196,118,10,0.04) 100%)",
        border:`1px solid rgba(196,118,10,0.30)`,
        borderLeft:`4px solid ${C.orange}`,
      }}>
        <span style={{fontSize:18}}>📍</span>
        <div style={{flex:1}}>
          <div style={{fontSize:11,fontWeight:700,color:C.orange,letterSpacing:2,textTransform:"uppercase"}}>
            Localisation dans les schémas
          </div>
          <div style={{fontSize:11,color:C.textMid,marginTop:2}}>
            Zones exactes identifiées dans les schémas hydrauliques / électriques 994F
          </div>
        </div>
        <div style={{fontSize:10,background:C.orangePale,color:C.orange,
          border:`1px solid rgba(196,118,10,0.25)`,padding:"3px 10px",
          fontWeight:700,letterSpacing:1}}>
          🔴 Surlignage automatique
        </div>
      </div>

      <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
        {locations.map((loc, i) => {
          const isExpand    = expanded === i
          const isFallback  = loc.is_fallback
          const kws         = loc.matched_keywords?.join(", ") || ""
          const schemaType  = loc.pdf_name?.toLowerCase().includes("hyd") ? "🔧 Hydraulique"
                            : loc.pdf_name?.toLowerCase().includes("elec") ? "⚡ Électrique"
                            : "📄 Schéma"

          return (
            <div key={i} style={{
              border:`2px solid ${isExpand ? C.orange : isFallback ? C.border : C.orange}`,
              background:"#fff", cursor:"pointer", transition:"all 0.25s",
              boxShadow: isExpand
                ? `0 0 0 3px rgba(196,118,10,0.12), 0 6px 24px rgba(196,118,10,0.18)`
                : "0 2px 10px rgba(0,0,0,0.09)",
              flex:"0 0 auto", position:"relative",
              maxWidth: isExpand ? "min(800px,90vw)" : 240,
            }} onClick={() => setExpanded(isExpand ? null : i)}>

              {/* Badge type */}
              <div style={{
                position:"absolute", top:0, left:0, right:0,
                background: isFallback
                  ? "rgba(139,125,96,0.85)"
                  : "linear-gradient(90deg,rgba(196,118,10,0.92),rgba(180,100,5,0.92))",
                color:"#fff", fontSize:9, fontWeight:700, letterSpacing:1,
                padding:"3px 8px", display:"flex",
                justifyContent:"space-between", alignItems:"center",
              }}>
                <span>{schemaType}</span>
                <span style={{opacity:0.9}}>P.{loc.page}</span>
              </div>

              {/* Image */}
              <img
                src={`data:image/png;base64,${loc.image_b64}`}
                alt={`Schéma p.${loc.page}`}
                style={{
                  display:"block",
                  marginTop:20,
                  width: isExpand ? "min(780px,88vw)" : 236,
                  height: isExpand ? "auto" : isFallback ? 140 : 180,
                  objectFit: isExpand ? "contain" : "cover",
                  objectPosition:"top",
                  transition:"all 0.3s",
                }}
              />

              {/* Footer */}
              <div style={{
                padding:"6px 9px",
                borderTop:`1px solid rgba(196,118,10,0.2)`,
                background: isFallback ? C.sandPale : "rgba(253,243,227,0.8)",
              }}>
                {!isFallback && kws && (
                  <div style={{fontSize:10,color:C.orange,fontWeight:700,
                    marginBottom:3, overflow:"hidden", textOverflow:"ellipsis",
                    whiteSpace:"nowrap", maxWidth:220}}>
                    🎯 {kws}
                  </div>
                )}
                <div style={{
                  fontSize:10, color: isFallback ? C.textLight : C.textMid,
                  fontStyle: isFallback ? "italic" : "normal",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:220,
                }}>
                  {isFallback ? "Vue générale — composant non localisé textuellement" : `${loc.score} occurrence(s) trouvée(s)`}
                </div>
              </div>

              {isExpand && (
                <div style={{padding:"6px",textAlign:"center",fontSize:11,
                  color:C.orange,fontWeight:600,background:C.orangePale}}>
                  ▲ Cliquer pour réduire
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{marginTop:8,fontSize:11,color:C.textLight,fontStyle:"italic"}}>
        💡 Cliquer pour agrandir · Rectangles rouges = emplacements exacts du composant dans le schéma
      </div>
    </div>
  )
}

// ── Sidebar History ────────────────────────────────────────────────────────
function Sidebar({ history, onSelect, onClear, currentId }) {
  const grouped = history.reduce((acc, item) => {
    const date = new Date(item.timestamp).toLocaleDateString("fr-FR", {day:"2-digit",month:"short"})
    if (!acc[date]) acc[date] = []
    acc[date].push(item)
    return acc
  }, {})

  return (
    <div style={{
      width:260, minWidth:260, background:C.bgSidebar,
      borderRight:`1px solid ${C.border}`,
      display:"flex",flexDirection:"column",
      position:"sticky",top:64,height:"calc(100vh - 64px)",
      overflowY:"auto",
    }}>
      <div style={{padding:"16px 18px",borderBottom:`1px solid ${C.border}`,
        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:11,fontWeight:700,color:C.textMuted,letterSpacing:3,textTransform:"uppercase"}}>
          Historique
        </div>
        {history.length > 0 && (
          <button onClick={onClear} style={{background:"none",border:"none",
            color:C.danger,cursor:"pointer",fontSize:11,fontWeight:700,letterSpacing:1}}>
            Effacer
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div style={{padding:24,fontSize:13,color:C.textLight,textAlign:"center",lineHeight:1.7}}>
          Aucune conversation.<br/>Pose une question pour commencer.
        </div>
      ) : (
        <div style={{flex:1}}>
          {Object.entries(grouped).reverse().map(([date, items]) => (
            <div key={date}>
              <div style={{padding:"10px 18px 4px",fontSize:10,fontWeight:700,
                color:C.textLight,letterSpacing:2,textTransform:"uppercase",
                background:"rgba(201,168,76,0.06)"}}>
                {date}
              </div>
              {items.slice().reverse().map(item => (
                <div key={item.id}
                  onClick={()=>onSelect(item)}
                  style={{
                    padding:"10px 18px",cursor:"pointer",
                    background: currentId===item.id ? C.greenPale : "transparent",
                    borderLeft: currentId===item.id ? `3px solid ${C.green}` : "3px solid transparent",
                    transition:"all 0.15s",
                  }}
                >
                  <div style={{fontSize:11,color:currentId===item.id ? C.greenDark : C.text,
                    fontWeight:600,lineHeight:1.4,
                    overflow:"hidden",textOverflow:"ellipsis",
                    display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>
                    {item.question}
                  </div>
                  <div style={{fontSize:10,color:C.textLight,marginTop:4,
                    display:"flex",alignItems:"center",gap:6}}>
                    <span style={{
                      background: item.type==="diagnose" ? C.orangePale : C.greenPale,
                      color: item.type==="diagnose" ? C.orange : C.greenDark,
                      padding:"1px 6px",fontWeight:700,fontSize:9,
                    }}>
                      {item.type==="diagnose" ? "🔧 DIAG" : "💬 Q&R"}
                    </span>
                    <span>{new Date(item.timestamp).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Change Password Modal ──────────────────────────────────────────────────
function ChangePasswordModal({ open, onClose, apiFetch, onSuccess }) {
  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    if (!open) {
      setOldPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setLoading(false)
      setError("")
      setSuccess("")
    }
  }, [open])

  if (!open) return null

  const handleSubmit = async () => {
    setError("")
    setSuccess("")

    if (!oldPassword || !newPassword || !confirmPassword) {
      setError("Veuillez remplir tous les champs.")
      return
    }

    if (newPassword.length < 6) {
      setError("Le nouveau mot de passe doit faire au moins 6 caractères.")
      return
    }

    if (newPassword !== confirmPassword) {
      setError("La confirmation du mot de passe ne correspond pas.")
      return
    }

    setLoading(true)
    try {
      const r = await apiFetch(`${API}/auth/change-password`, {
        method: "POST",
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      })

      const data = await r.json()

      if (!r.ok) {
        throw new Error(data.detail || "Erreur lors du changement de mot de passe")
      }

      setSuccess("Mot de passe modifié avec succès.")
      setOldPassword("")
      setNewPassword("")
      setConfirmPassword("")

      setTimeout(() => {
        onClose()
        onSuccess?.()
      }, 900)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const inputStyle = {
    width: "100%",
    background: "rgba(255,255,255,0.95)",
    border: `1px solid ${C.border}`,
    color: C.text,
    padding: "11px 14px",
    fontFamily: "'Rajdhani', sans-serif",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
    marginBottom: 12,
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: 16,
    }}>
      <div style={{
        width: "100%", maxWidth: 460,
        background: C.bgCard,
        border: `1px solid ${C.border}`,
        borderTop: `3px solid ${C.green}`,
        padding: "24px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
      }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: C.textMuted,
          letterSpacing: 3, textTransform: "uppercase", marginBottom: 18,
        }}>
          Changer le mot de passe
        </div>

        <input
          type="password"
          placeholder="Ancien mot de passe"
          value={oldPassword}
          onChange={e => setOldPassword(e.target.value)}
          style={inputStyle}
        />

        <input
          type="password"
          placeholder="Nouveau mot de passe"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
          style={inputStyle}
        />

        <input
          type="password"
          placeholder="Confirmer le nouveau mot de passe"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          style={{ ...inputStyle, marginBottom: 0 }}
        />

        {error && (
          <div style={{
            marginTop: 14,
            padding: "10px 12px",
            background: C.dangerPale,
            borderLeft: `4px solid ${C.danger}`,
            color: C.danger,
            fontSize: 13,
            fontWeight: 600,
          }}>
            ⚠️ {error}
          </div>
        )}

        {success && (
          <div style={{
            marginTop: 14,
            padding: "10px 12px",
            background: C.greenPale,
            borderLeft: `4px solid ${C.green}`,
            color: C.greenDark,
            fontSize: 13,
            fontWeight: 600,
          }}>
            ✅ {success}
          </div>
        )}

        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          marginTop: 18,
        }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.textMuted,
              padding: "10px 16px",
              cursor: "pointer",
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            Annuler
          </button>

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              background: loading ? C.border : C.green,
              color: "#fff",
              border: "none",
              padding: "10px 18px",
              cursor: loading ? "wait" : "pointer",
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            {loading ? "Modification..." : "Valider"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Ask Page ──────────────────────────────────────────────────────────────
function AskPage({ onSave, apiFetch }) {
  const [question, setQuestion] = useState("")
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState(null)

  const handleAsk = async () => {
    if (!question.trim()) return
    setLoading(true); setResult(null)
    try {
      const r = await apiFetch(`${API}/ask`, {
        method:"POST",
        body: JSON.stringify({ question }),
      })
      const data = await r.json()
      setResult(data)
      onSave({
        id: Date.now(),
        type: "ask",
        question,
        answer: data.answer,
        sources: data.sources,
        pdf_images: data.pdf_images,
        timestamp: new Date().toISOString(),
      })
    } catch(e) {
      setResult({ answer:`❌ API inaccessible: ${e.message}`, sources:[], pdf_images:[] })
    }
    setLoading(false)
  }

  const foc = e => { e.target.style.borderColor=C.green; e.target.style.boxShadow=`0 0 0 3px rgba(0,132,61,0.08)` }
  const blr = e => { e.target.style.borderColor=C.border; e.target.style.boxShadow="none" }

  return (
    <div style={{padding:"28px 32px",maxWidth:960,margin:"0 auto",position:"relative",zIndex:1}}>
      <PageTitle>Question technique libre — CAT 994F</PageTitle>

      <Card>
        <CardTitle>Nouvelle question</CardTitle>
        <label style={S.label}>Votre question</label>
        <textarea style={S.textarea}
          placeholder="Ex: Procédure de remplacement du filtre hydraulique ?"
          value={question} onChange={e=>setQuestion(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&e.ctrlKey&&handleAsk()}
          onFocus={foc} onBlur={blr}
        />
        <div style={{marginTop:14,display:"flex",alignItems:"center",gap:14}}>
          <button style={loading||!question.trim() ? S.btnOff : S.btn}
            onClick={handleAsk} disabled={loading||!question.trim()}>
            {loading ? "⟳  Recherche..." : "▶  Poser la question"}
          </button>
          <span style={{fontSize:11,color:C.textLight}}>Ctrl+Entrée</span>
        </div>
      </Card>

      {result && (
        <Card>
          <CardTitle>Réponse</CardTitle>
          <div style={{fontSize:11,color:C.textMuted,marginBottom:5,letterSpacing:1}}>QUESTION</div>
          <div style={{color:C.greenDark,fontSize:15,fontWeight:700,marginBottom:14}}>{result.question || question}</div>
          <div style={S.answerBox}>{result.answer}</div>
          <AnswerSources sources={result.sources}/>
          <PdfImages images={result.pdf_images}/>
        </Card>
      )}
    </div>
  )
}

// ── Diagnose Page ─────────────────────────────────────────────
function DiagnosePage({ onSave, apiFetch }) {
  const [faultCode, setFaultCode] = useState("")
  const [symptoms, setSymptoms]   = useState("")
  const [gmaoCtx, setGmaoCtx]     = useState("")
  const [hours, setHours]         = useState("")
  const [loading, setLoading]     = useState(false)
  const [result, setResult]       = useState(null)
  const [exporting, setExporting] = useState(false)

  const handleDiagnose = async () => {
    setLoading(true); setResult(null)
    try {
      const r = await apiFetch(`${API}/diagnose`, {
        method:"POST",
        body: JSON.stringify({
          fault_code: faultCode||null,
          symptoms: symptoms.split("\n").map(s=>s.trim()).filter(Boolean),
          gmao_context: gmaoCtx||null,
          hours_since_maintenance: hours ? parseInt(hours) : null,
        }),
      })
      const data = await r.json()
      setResult(data)
      const q = [faultCode, symptoms.split("\n")[0]].filter(Boolean).join(" — ") || "Diagnostic"
      onSave({
        id: Date.now(),
        type: "diagnose",
        question: q,
        answer: data.diagnostic,
        sources: data.sources,
        pdf_images: data.pdf_images,
        schema_locations: data.schema_locations || [],
        timestamp: new Date().toISOString(),
      })
    } catch(e) {
      setResult({ diagnostic:`❌ API inaccessible: ${e.message}`, sources:[], pdf_images:[] })
    }
    setLoading(false)
  }

  const handleExportPDF = async () => {
    if (!result) return
    setExporting(true)
    try {
      const r = await apiFetch(`${API}/export/rapport-diagnostic`, {
        method:"POST",
        body: JSON.stringify({
          fault_code: faultCode || null,
          symptoms: symptoms.split("\n").map(s=>s.trim()).filter(Boolean),
          gmao_context: gmaoCtx || null,
          hours_since_maintenance: hours ? parseInt(hours) : null,
          diagnostic: result.diagnostic,
          sources: result.sources || [],
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      const blob = await r.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      const cd   = r.headers.get("Content-Disposition") || ""
      const fn   = cd.match(/filename="(.+?)"/)?.[1] || "rapport_diagnostic.pdf"
      a.href = url; a.download = fn; a.click()
      URL.revokeObjectURL(url)
    } catch(e) {
      alert(`Export PDF échoué : ${e.message}`)
    }
    setExporting(false)
  }

  const foc = e => { e.target.style.borderColor=C.green; e.target.style.boxShadow=`0 0 0 3px rgba(0,132,61,0.08)` }
  const blr = e => { e.target.style.borderColor=C.border; e.target.style.boxShadow="none" }

  return (
    <div style={{padding:"28px 32px",maxWidth:960,margin:"0 auto",position:"relative",zIndex:1}}>
      <PageTitle>Diagnostic de panne — CAT 994F</PageTitle>

      <div style={{padding:"11px 18px",marginBottom:16,background:C.orangePale,
        border:`1px solid rgba(196,118,10,0.3)`,borderLeft:`4px solid ${C.orange}`,
        display:"flex",gap:10,alignItems:"center",fontSize:13,color:C.textMid}}>
        <span style={{fontSize:18}}>⚠</span>
        Aide à la décision — Consulter le manuel officiel CAT avant toute intervention.
      </div>

      <div style={S.grid2}>
        <Card style={{marginBottom:0}}>
          <label style={S.label}>Code défaut</label>
          <input style={S.input} placeholder="Ex: MID 036 CID 0096 FMI 03"
            value={faultCode} onChange={e=>setFaultCode(e.target.value)} onFocus={foc} onBlur={blr}/>
          <div style={{marginTop:14}}>
            <label style={S.label}>Heures depuis maintenance</label>
            <input style={S.input} type="number" placeholder="Ex: 250"
              value={hours} onChange={e=>setHours(e.target.value)} onFocus={foc} onBlur={blr}/>
          </div>
        </Card>
        <Card style={{marginBottom:0}}>
          <label style={S.label}>Symptômes (un par ligne)</label>
          <textarea style={{...S.textarea,minHeight:120}}
            placeholder={"Perte de puissance\nFumée noire\nHydraulique lente"}
            value={symptoms} onChange={e=>setSymptoms(e.target.value)} onFocus={foc} onBlur={blr}/>
        </Card>
      </div>

      <Card>
        <label style={S.label}>Contexte GMAO / Historique</label>
        <textarea style={{...S.textarea,minHeight:70}}
          placeholder="Interventions récentes, observations terrain..."
          value={gmaoCtx} onChange={e=>setGmaoCtx(e.target.value)} onFocus={foc} onBlur={blr}/>
        <div style={{marginTop:14}}>
          <button style={loading ? S.btnOff : S.btn} onClick={handleDiagnose} disabled={loading}>
            {loading ? "⟳  Diagnostic en cours..." : "▶  Lancer le diagnostic"}
          </button>
        </div>
      </Card>

      {result && (
        <Card>
          <CardTitle>Résultat du diagnostic</CardTitle>
          <DiagnosticRenderer text={result.diagnostic} />
          <AnswerSources sources={result.sources}/>
          <PdfImages images={result.pdf_images}/>
          <SchemaLocations locations={result.schema_locations}/>
          {result.diagnostic && !result.diagnostic.startsWith("❌") && (
            <div style={{marginTop:14,display:"flex",gap:10}}>
              <button
                onClick={handleExportPDF}
                disabled={exporting}
                style={{
                  background: exporting ? C.border : C.greenDark,
                  color:"#fff", border:"none", padding:"10px 24px",
                  fontFamily:"'Rajdhani', sans-serif", fontSize:12, fontWeight:700,
                  letterSpacing:2, cursor: exporting ? "wait" : "pointer",
                  textTransform:"uppercase",
                  clipPath:"polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)",
                  boxShadow:"0 2px 10px rgba(0,92,43,0.2)",
                  transition:"all 0.2s",
                }}
              >
                {exporting ? "⟳  Génération PDF..." : "⬇  Exporter en PDF"}
              </button>
              <span style={{fontSize:11,color:C.textLight,alignSelf:"center"}}>
                Rapport complet avec sources
              </span>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ── History Detail View ───────────────────────────────────────────────────
function HistoryDetail({ item, onClose }) {
  return (
    <div style={{padding:"28px 32px",maxWidth:960,margin:"0 auto",position:"relative",zIndex:1}}>
      <div style={{marginBottom:20,display:"flex",alignItems:"center",gap:14}}>
        <button onClick={onClose} style={{
          background:"none",border:`1px solid ${C.border}`,color:C.textMid,
          padding:"7px 16px",cursor:"pointer",fontFamily:"'Rajdhani', sans-serif",
          fontSize:12,fontWeight:700,letterSpacing:2,
        }}>← RETOUR</button>
        <div style={{fontSize:11,color:C.textMuted,letterSpacing:2}}>
          {new Date(item.timestamp).toLocaleString("fr-FR")}
          {" · "}
          <span style={{
            background: item.type==="diagnose" ? C.orangePale : C.greenPale,
            color: item.type==="diagnose" ? C.orange : C.greenDark,
            padding:"2px 8px",fontWeight:700,
          }}>
            {item.type==="diagnose" ? "🔧 DIAGNOSTIC" : "💬 QUESTION"}
          </span>
        </div>
      </div>

      <Card>
        <div style={{fontSize:11,color:C.textMuted,marginBottom:5,letterSpacing:1}}>
          {item.type==="diagnose" ? "CAS" : "QUESTION"}
        </div>
        <div style={{color:C.greenDark,fontSize:15,fontWeight:700,marginBottom:14}}>
          {item.question}
        </div>
        <div style={item.type==="diagnose"
          ? {...S.answerBox, borderLeftColor:C.orange}
          : S.answerBox}>
          {item.answer}
        </div>
        <AnswerSources sources={item.sources}/>
        <PdfImages images={item.pdf_images}/>
      </Card>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────
const TABS = [
  { id:"maintenance_360",   icon:"🏭", label:"Vue 360° Maintenance",          shortLabel:"360°" },
  { id:"ask",       icon:"💬", label:"Question libre",       shortLabel:"Q&R" },
  { id:"diagnose",  icon:"🔧", label:"Diagnostic",           shortLabel:"Diag" },
  { id:"capteurs",  icon:"📡", label:"Capteurs",             shortLabel:"Capteurs" },
  { id:"gmao",      icon:"📊", label:"GMAO Analytics",       shortLabel:"GMAO" },
  { id:"geo",       icon:"📍", label:"Analyse géographique", shortLabel:"Géo" },
  { id:"anomaly",   icon:"🤖", label:"Détection IA",         shortLabel:"IA" },
  { id:"oil",       icon:"🛢️", label:"Analyse huiles",       shortLabel:"Huiles" },
  { id:"ocp_upload", icon:"📁", label:"OCP Fichiers",         shortLabel:"OCP" },
  { id:"ocp_defaut", icon:"⚠️", label:"OCP Défauts",          shortLabel:"Défauts" },
  { id:"ocp_sante",  icon:"❤", label:"OCP Santé",             shortLabel:"Santé" },
  { id:"prediction", icon:"📊", label:"Prédiction RUL",        shortLabel:"RUL" },
  { id:"alertes_ocp",icon:"🚨", label:"Alertes & Plan",      shortLabel:"Alertes" },
  { id:"executive_report",icon:"📄", label:"Rapport Exécutif",          shortLabel:"Rapport" },
]

export default function App() {
  const { user, isAuthenticated, login, logout, apiFetch } = useAuth()

  const [activeTab, setActiveTab]       = useState("maintenance_360")
  const [history, setHistory]           = useState(loadHistory)
  const [selectedItem, setSelectedItem] = useState(null)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [ocpTroubleshootingType, setOcpTroubleshootingType] = useState(null)

  if (!isAuthenticated) {
    return <LoginPage onLogin={login} />
  }

  const handleSave = (item) => {
    const newHistory = [item, ...history.filter(h=>h.id!==item.id)]
    setHistory(newHistory)
    saveHistory(newHistory)
  }

  const handleSelect = (item) => {
    setSelectedItem(item)
    setActiveTab(item.type === "diagnose" ? "diagnose" : "ask")
  }

  const handleClear = () => {
    if (confirm("Effacer tout l'historique ?")) {
      setHistory([])
      localStorage.removeItem(STORAGE_KEY)
      setSelectedItem(null)
    }
  }

  const handleTabChange = (id) => {
    setActiveTab(id)
    setSelectedItem(null)
    if (id !== "ocp_troubleshooting") {
      setOcpTroubleshootingType(null)
    }
  }

  const showHistory = !["gmao", "geo", "monitor", "evolution", "anomaly",
    "prediction", "alertes_ocp", "capteurs", "oil", "ocp_upload",
    "ocp_defaut", "ocp_sante", "ocp_troubleshooting", "maintenance_360", "executive_report"].includes(activeTab)
  const visibleTabs = TABS

  return (
    <DashboardShell
      tabs={visibleTabs}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      user={user}
      onLogout={logout}
      onChangePassword={() => setShowChangePassword(true)}
    >
      <div style={S.app}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&display=swap');
          * { box-sizing:border-box; margin:0; padding:0; }
          body { background:var(--c-bg,#F5F0E8); }
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
          @keyframes floatIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
          input::placeholder, textarea::placeholder { color:${C.textLight}; }
          ::-webkit-scrollbar { width:6px; height:6px; }
          ::-webkit-scrollbar-track { background:transparent; }
          ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:999px; }
          button:not(:disabled):hover { filter:brightness(1.04); }

          .app-shell-content {
            width:min(100%,1480px);
            margin:0 auto;
            padding:28px 30px 44px;
            position:relative;
            z-index:1;
          }
          .page-content { animation:floatIn .28s ease both; }
          .grid-2col { grid-template-columns:1fr 1fr !important; }
          .grid-4col { grid-template-columns:repeat(4,minmax(0,1fr)) !important; }

          @media (max-width: 1024px) {
            .grid-4col { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
          }
          @media (max-width: 768px) {
            .sidebar-nav { display:none !important; }
            .app-shell-content { padding:18px 16px 32px; }
            .page-content { padding:16px !important; }
            .grid-2col { grid-template-columns:1fr !important; }
            .grid-4col { grid-template-columns:1fr !important; }
            .sidebar-panel { display:none; }
          }
        `}</style>

        <PhosphateBg/>

        <div style={{display:"flex",minHeight:"100vh"}}>
          {showHistory && (
            <div className="sidebar-panel">
              <Sidebar
                history={history}
                onSelect={handleSelect}
                onClear={handleClear}
                currentId={selectedItem?.id}
              />
            </div>
          )}

          <div className="app-shell-content" style={{flex:1,minWidth:0}}>
            {selectedItem && activeTab !== "gmao" && activeTab !== "geo" ? (
              <HistoryDetail item={selectedItem} onClose={() => setSelectedItem(null)}/>
            ) : (
              <>
                {activeTab === "maintenance_360" && <MaintenanceExecutiveDashboard apiFetch={apiFetch} onNavigate={handleTabChange} />}
                {activeTab === "executive_report" && <ExecutiveReportPage apiFetch={apiFetch} />}
                {activeTab==="ask"      && <AskPage      onSave={handleSave} apiFetch={apiFetch} />}
                {activeTab==="diagnose" && <DiagnosePage onSave={handleSave} apiFetch={apiFetch} />}
                {activeTab==="gmao" && <GmaoDashboard/>}
                {activeTab === "geo" && <GeoAnomalyDashboard />}
                {activeTab === "capteurs" && <CapteursPage />}
                {activeTab === "anomaly" && <AnomalyDashboard />}
                {activeTab === "oil" && <OilAnalysisDashboard />}
                {activeTab === "ocp_upload" && <OcpFilesPage apiFetch={apiFetch} onNavigate={handleTabChange} />}
                {activeTab === "ocp_defaut" && <OcpDefautPage apiFetch={apiFetch} />}
                {activeTab === "ocp_sante" && <OcpHealthPage apiFetch={apiFetch} onNavigate={handleTabChange} />}
                {activeTab === "ocp_troubleshooting" && (
                  <OcpTroubleshootingPage
                    apiFetch={apiFetch}
                    type={ocpTroubleshootingType}
                    onBack={() => handleTabChange("alertes_ocp")}
                  />
                )}
                {(activeTab === "monitor" || activeTab === "evolution" || activeTab === "live") && (
                  <CapteursPage initialMode={activeTab === "monitor" ? "historique" : (activeTab === "evolution" ? "evolution" : "live")} />
                )}
                {activeTab === "prediction" && <PredictionPage apiFetch={apiFetch} />}
                {activeTab === "alertes_ocp" && <AlertesPage apiFetch={apiFetch} />}
              </>
            )}
          </div>

          <ChangePasswordModal
            open={showChangePassword}
            onClose={() => setShowChangePassword(false)}
            apiFetch={apiFetch}
            onSuccess={() => {
              alert("Mot de passe modifié avec succès.")
            }}
          />
        </div>
      </div>
    </DashboardShell>
  )
}
