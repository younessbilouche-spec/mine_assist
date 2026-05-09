import { useState } from "react"

const C = {
  bg: "#F7F2E6",
  card: "#FFFDF8",
  dark: "#12372A",
  text: "#1E2A24",
  muted: "#7C7366",
  border: "#E3D8C4",
  green: "#00843D",
  greenDark: "#006B31",
  gold: "#C4760A",
  red: "#B91C1C",
  redPale: "#FEE2E2",
  greenPale: "#E8F5EE",
}

function HexBackground() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.24 }}>
        <defs>
          <pattern id="loginHex" x="0" y="0" width="88" height="102" patternUnits="userSpaceOnUse">
            <polygon points="44,5 81,26 81,73 44,96 7,73 7,26" fill="none" stroke="#B8AA90" strokeWidth="1" />
            <polygon points="44,18 68,32 68,66 44,80 20,66 20,32" fill="none" stroke="#00843D" strokeWidth=".45" />
          </pattern>
          <linearGradient id="loginGlow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00843D" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#C4760A" stopOpacity="0.10" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#loginHex)" />
        <circle cx="82%" cy="18%" r="240" fill="url(#loginGlow)" />
        <circle cx="14%" cy="75%" r="220" fill="#C4760A" opacity="0.08" />
      </svg>
    </div>
  )
}

function Field({ label, value, onChange, type = "text", placeholder, autoFocus }) {
  const [focused, setFocused] = useState(false)
  return (
    <label style={{ display: "block", marginBottom: 18 }}>
      <span style={{ display: "block", fontSize: 10, color: C.muted, letterSpacing: 2.4, textTransform: "uppercase", fontWeight: 900, marginBottom: 8 }}>
        {label}
      </span>
      <input
        autoFocus={autoFocus}
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%",
          border: `1.5px solid ${focused ? C.green : C.border}`,
          outline: "none",
          borderRadius: 10,
          background: "rgba(255,253,248,.94)",
          padding: "14px 15px",
          color: C.text,
          fontSize: 14,
          fontWeight: 700,
          boxShadow: focused ? "0 0 0 4px rgba(0,132,61,.09)" : "inset 0 1px 0 rgba(255,255,255,.8)",
          transition: "all .18s ease",
        }}
      />
    </label>
  )
}

async function runLogin(onLogin, username, password) {
  if (!onLogin) throw new Error("Service d'authentification indisponible.")
  try {
    return await onLogin(username, password)
  } catch (firstError) {
    const msg = String(firstError?.message || firstError || "")
    if (/argument|credentials|undefined|not a function/i.test(msg)) {
      return onLogin({ username, password })
    }
    throw firstError
  }
}

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const disabled = loading || !username.trim() || !password

  const submit = async (e) => {
    e.preventDefault()
    if (disabled) return
    setLoading(true)
    setError("")
    try {
      await runLogin(onLogin, username.trim(), password)
    } catch (err) {
      setError(err?.message || "Identifiant ou mot de passe incorrect.")
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden", background: `linear-gradient(135deg, ${C.bg} 0%, #EFE6D4 52%, #E8DFC8 100%)`, fontFamily: "'Rajdhani', 'Segoe UI', sans-serif", color: C.text }}>
      <HexBackground />
      <div style={{ position: "relative", minHeight: "100vh", display: "grid", gridTemplateColumns: "minmax(420px, .95fr) minmax(460px, 1.05fr)", alignItems: "stretch" }}>
        <section style={{ padding: "56px 64px", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "linear-gradient(180deg, rgba(18,55,42,.96), rgba(0,132,61,.92))", color: "white", boxShadow: "22px 0 60px rgba(18,55,42,.22)" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 72 }}>
              <div style={{ background: "white", color: C.green, borderRadius: 12, padding: "10px 12px", fontWeight: 900, letterSpacing: 3, boxShadow: "0 10px 26px rgba(0,0,0,.20)" }}>OCP</div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 2 }}>MineAssist</div>
                <div style={{ fontSize: 11, opacity: .7, letterSpacing: 3 }}>CAT 994F · MAINTENANCE PRÉDICTIVE</div>
              </div>
            </div>
            <div style={{ maxWidth: 520 }}>
              <div style={{ fontSize: 11, letterSpacing: 4, color: "#F8D08C", fontWeight: 900, textTransform: "uppercase", marginBottom: 14 }}>Plateforme industrielle</div>
              <h1 style={{ fontFamily: "Georgia, serif", fontSize: 48, lineHeight: 1.05, margin: 0 }}>Pilotage maintenance 360°</h1>
              <p style={{ fontSize: 16, lineHeight: 1.7, opacity: .84, marginTop: 18 }}>
                Surveillance capteurs, diagnostic assisté, analyse huiles, prédiction LSTM et plan d'action pour la chargeuse CAT 994F.
              </p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              ["IA", "Diagnostic"],
              ["LSTM", "Prédiction"],
              ["OKSA", "Huiles"],
            ].map(([k, v]) => (
              <div key={k} style={{ border: "1px solid rgba(255,255,255,.20)", borderRadius: 14, padding: 14, background: "rgba(255,255,255,.08)", backdropFilter: "blur(10px)" }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#F8D08C" }}>{k}</div>
                <div style={{ fontSize: 12, opacity: .75, marginTop: 3 }}>{v}</div>
              </div>
            ))}
          </div>
        </section>

        <main style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 42 }}>
          <form onSubmit={submit} style={{ width: "100%", maxWidth: 460, background: "rgba(255,253,248,.92)", border: `1px solid ${C.border}`, borderTop: `5px solid ${C.green}`, borderRadius: 22, padding: "38px 40px", boxShadow: "0 26px 80px rgba(77,60,33,.18)", backdropFilter: "blur(18px)" }}>
            <div style={{ textAlign: "center", marginBottom: 30 }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.green, color: "white", borderRadius: 12, padding: "10px 15px", fontWeight: 900, letterSpacing: 4, marginBottom: 16 }}>OCP</div>
              <h2 style={{ margin: 0, color: C.dark, fontSize: 26, letterSpacing: 3, fontWeight: 900 }}>MINEASSIST</h2>
              <div style={{ color: C.muted, fontSize: 11, letterSpacing: 3, marginTop: 8 }}>ACCÈS SÉCURISÉ</div>
            </div>

            {error && (
              <div style={{ background: C.redPale, border: `1px solid ${C.red}33`, borderLeft: `4px solid ${C.red}`, color: C.red, borderRadius: 10, padding: "11px 13px", fontSize: 13, fontWeight: 700, marginBottom: 18 }}>
                {error}
              </div>
            )}

            <Field label="Nom d'utilisateur" value={username} onChange={setUsername} placeholder="Saisir votre identifiant" autoFocus />
            <div style={{ position: "relative" }}>
              <Field label="Mot de passe" value={password} onChange={setPassword} type={showPassword ? "text" : "password"} placeholder="Saisir votre mot de passe" />
              <button type="button" onClick={() => setShowPassword(v => !v)} style={{ position: "absolute", right: 12, top: 35, border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 16 }}>
                {showPassword ? "Masquer" : "Afficher"}
              </button>
            </div>

            <button type="submit" disabled={disabled} style={{ width: "100%", border: "none", borderRadius: 12, background: disabled ? "#A7B2AA" : `linear-gradient(135deg, ${C.green}, ${C.greenDark})`, color: "white", padding: "15px 18px", fontSize: 13, fontWeight: 900, letterSpacing: 2.5, cursor: disabled ? "not-allowed" : "pointer", boxShadow: disabled ? "none" : "0 14px 30px rgba(0,132,61,.28)", transition: "all .18s ease" }}>
              {loading ? "AUTHENTIFICATION..." : "SE CONNECTER"}
            </button>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
              <div style={{ background: C.greenPale, border: `1px solid ${C.green}22`, borderRadius: 10, padding: 11 }}>
                <div style={{ color: C.green, fontSize: 10, fontWeight: 900, letterSpacing: 2 }}>JWT</div>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>Session sécurisée</div>
              </div>
              <div style={{ background: "#F8F2E6", border: `1px solid ${C.border}`, borderRadius: 10, padding: 11 }}>
                <div style={{ color: C.gold, fontSize: 10, fontWeight: 900, letterSpacing: 2 }}>OCP</div>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>Accès maintenance</div>
              </div>
            </div>
          </form>
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        input::placeholder { color: #B8AA90; font-weight: 500; }
        @media (max-width: 980px) {
          div[style*="grid-template-columns: minmax(420px"] { grid-template-columns: 1fr !important; }
          section { display: none !important; }
          main { padding: 24px !important; }
          form { padding: 30px 24px !important; }
        }
      `}</style>
    </div>
  )
}
