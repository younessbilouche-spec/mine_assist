import { useState } from "react"
import { C } from "../../config"
import logo from "../../assets/mineassist_logo_final.png"

const NAV_WIDTH = 260
const NAV_COLLAPSED = 68

export default function DashboardShell({
  tabs, activeTab, onTabChange, user, onLogout,
  onChangePassword, children,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const w = collapsed ? NAV_COLLAPSED : NAV_WIDTH

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--c-bg, #F5F0E8)" }}>
      {/* ─── Sidebar ─── */}
      <nav
        className="sidebar-nav no-print"
        style={{
          width: w, minWidth: w, maxWidth: w,
          background: "var(--c-bgSidebar, rgba(248,244,236,0.97))",
          borderRight: `1px solid var(--c-border, ${C.border})`,
          display: "flex", flexDirection: "column",
          transition: "width 0.25s cubic-bezier(.4,0,.2,1), min-width 0.25s cubic-bezier(.4,0,.2,1)",
          position: "sticky", top: 0, height: "100vh",
          overflowY: "auto", overflowX: "hidden", zIndex: 100,
        }}
      >
        {/* Brand */}
        <div style={{
          padding: collapsed ? "18px 0" : "22px 20px 14px",
          borderBottom: `1px solid var(--c-border, ${C.border})`,
          display: "flex", flexDirection: "column", alignItems: collapsed ? "center" : "flex-start",
          gap: 12, flexShrink: 0,
        }}>
          <div style={{
            width: collapsed ? 44 : "100%", height: collapsed ? 44 : 80,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, 
          }}>
            <img src={logo} alt="MineAssist" style={{ width: "100%", height: "100%", objectFit: "contain", mixBlendMode: "multiply" }} />
          </div>
          {!collapsed && (
            <div style={{ paddingLeft: 4 }}>
              <div style={{ fontSize: 9, color: C.orange, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase" }}>
                Diagnostic IA · CAT 994F
              </div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {tabs.map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                title={collapsed ? tab.label : undefined}
                style={{
                  display: "flex", alignItems: "center",
                  gap: 10,
                  padding: collapsed ? "10px 0" : "9px 14px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  background: active
                    ? `linear-gradient(90deg, var(--c-greenPale, ${C.greenPale}), transparent)`
                    : "transparent",
                  border: "none",
                  borderLeft: active ? `3px solid ${C.green}` : "3px solid transparent",
                  borderRadius: "0 8px 8px 0",
                  color: active ? "var(--c-greenDark)" : "var(--c-textMuted)",
                  fontFamily: "'Rajdhani', sans-serif",
                  fontWeight: active ? 700 : 600,
                  fontSize: 13,
                  letterSpacing: 0.5,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                <span style={{ fontSize: 17, flexShrink: 0, width: 24, textAlign: "center" }}>
                  {tab.icon}
                </span>
                {!collapsed && <span>{tab.label}</span>}
              </button>
            )
          })}
        </div>

        {/* User footer */}
        <div style={{
          padding: collapsed ? "12px 6px" : "14px 16px",
          borderTop: `1px solid var(--c-border, ${C.border})`,
          flexShrink: 0, display: "flex", flexDirection: "column", gap: 8,
        }}>
          {!collapsed && user && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: user.role === "admin"
                  ? `linear-gradient(135deg, ${C.danger}, #E74C3C)`
                  : user.role === "chef"
                    ? `linear-gradient(135deg, ${C.orange}, #D4881E)`
                    : `linear-gradient(135deg, ${C.green}, ${C.greenLt})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 13, fontWeight: 700,
                flexShrink: 0,
              }}>
                {(user.nom_complet || "U").charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{
                  fontSize: 12, fontWeight: 700, color: "var(--c-text)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {user.nom_complet}
                </div>
                <div style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                  color: user.role === "admin" ? C.danger : user.role === "chef" ? C.orange : C.green,
                }}>
                  {user.role}
                </div>
              </div>
            </div>
          )}

          <div style={{
            display: "flex", gap: 4,
            justifyContent: collapsed ? "center" : "flex-start",
            flexWrap: "wrap",
          }}>
            {onChangePassword && (
              <button onClick={onChangePassword} style={smallBtn} title="Mot de passe">
                🔒
              </button>
            )}
            <button onClick={onLogout} style={{ ...smallBtn, color: C.danger }} title="Déconnexion">
              ⏏
            </button>
            <button
              onClick={() => setCollapsed(c => !c)}
              style={smallBtn}
              title={collapsed ? "Développer" : "Réduire"}
            >
              {collapsed ? "▶" : "◀"}
            </button>
          </div>
        </div>
      </nav>

      {/* ─── Main content ─── */}
      <main style={{
        flex: 1, minWidth: 0, minHeight: "100vh",
        transition: "margin 0.25s ease",
      }}>
        {children}
      </main>
    </div>
  )
}

const smallBtn = {
  background: "none",
  border: "1px solid var(--c-border, #D4C9B0)",
  borderRadius: 6,
  color: "var(--c-textMuted)",
  width: 30, height: 30,
  display: "flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", fontSize: 12, flexShrink: 0,
  fontFamily: "'Rajdhani', sans-serif",
}
