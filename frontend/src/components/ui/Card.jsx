import { C } from "../../config"

export function Card({ children, style, accent, className }) {
  return (
    <div
      className={className}
      style={{
        background: "var(--c-bgCard, rgba(255,253,248,0.92))",
        border: `1px solid var(--c-border, ${C.border})`,
        borderRadius: 12,
        padding: "22px 24px",
        boxShadow: "0 1px 3px var(--c-shadow, rgba(139,105,20,0.07)), 0 4px 16px rgba(0,0,0,0.03)",
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      {accent && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${accent}, transparent)`,
          borderRadius: "12px 12px 0 0",
        }} />
      )}
      {children}
    </div>
  )
}

export function CardTitle({ children, accent, right, icon }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700,
      color: "var(--c-textMuted)",
      letterSpacing: 2.5, textTransform: "uppercase",
      marginBottom: 16, paddingBottom: 12,
      borderBottom: `1px solid var(--c-border, ${C.border})`,
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <div style={{
        width: 4, height: 14, borderRadius: 2,
        background: accent || `linear-gradient(180deg, ${C.green}, ${C.sand})`,
        flexShrink: 0,
      }} />
      {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
      <span style={{ flex: 1 }}>{children}</span>
      {right && <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>{right}</div>}
    </div>
  )
}

export function KpiCard({ label, value, sub, accent, icon, trend, style }) {
  const color = accent || C.green
  return (
    <Card
      style={{
        textAlign: "center", padding: "20px 16px",
        borderTop: `3px solid ${color}`,
        borderRadius: 12,
        ...style,
      }}
    >
      {icon && (
        <div style={{
          fontSize: 22, marginBottom: 8,
          width: 44, height: 44, borderRadius: 10, margin: "0 auto 10px",
          background: `${color}12`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {icon}
        </div>
      )}
      <div style={{
        fontSize: 30, fontWeight: 700, color,
        fontFamily: "'Rajdhani', sans-serif", lineHeight: 1,
      }}>
        {value ?? "—"}
      </div>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 2,
        textTransform: "uppercase",
        color: "var(--c-textMuted)",
        margin: "10px 0 4px",
      }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--c-textLight)", marginTop: 2 }}>
          {sub}
        </div>
      )}
      {trend && (
        <div style={{
          fontSize: 11, fontWeight: 700, marginTop: 6,
          color: trend > 0 ? C.danger : C.green,
        }}>
          {trend > 0 ? `▲ +${trend}%` : `▼ ${trend}%`}
        </div>
      )}
    </Card>
  )
}

export function PageHeader({ title, subtitle, icon, right }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      marginBottom: 24, gap: 16, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {icon && (
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.greenPale}, rgba(0,132,61,0.12))`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>
            {icon}
          </div>
        )}
        <div>
          <h1 style={{
            fontSize: 20, fontWeight: 700, color: "var(--c-text)",
            fontFamily: "'Rajdhani', sans-serif", letterSpacing: 1,
            margin: 0,
          }}>
            {title}
          </h1>
          {subtitle && (
            <div style={{ fontSize: 11, color: "var(--c-textMuted)", letterSpacing: 1.5, marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {right && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div>}
    </div>
  )
}
