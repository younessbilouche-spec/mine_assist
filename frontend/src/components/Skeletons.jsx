/**
 * Skeletons.jsx — MineAssist Sprint 2 (mai 2026)
 * Composants skeleton pour remplacer les "Chargement..." textuels.
 * Améliore drastiquement le ressenti UX.
 */

const skel = {
  base: "#E5E7EB",
  shine: "#F3F4F6",
}

const pulseStyle = `
  @keyframes mineassist-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .ma-skeleton { animation: mineassist-pulse 1.4s ease-in-out infinite; background: ${skel.base}; border-radius: 4px; }
`

export function SkeletonStyles() {
  return <style>{pulseStyle}</style>
}

export function SkeletonLine({ width = "100%", height = 12, mt = 0, mb = 0 }) {
  return (
    <div className="ma-skeleton" style={{
      width, height, marginTop: mt, marginBottom: mb,
    }} />
  )
}

export function SkeletonKPI() {
  return (
    <div style={{
      background: "rgba(255,253,248,0.96)", border: "1px solid #D4C9B0",
      borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 2px rgba(28,26,20,0.04)",
    }}>
      <SkeletonStyles />
      <SkeletonLine width={70} height={8} mb={10} />
      <SkeletonLine width={90} height={28} />
      <SkeletonLine width={50} height={9} mt={8} />
    </div>
  )
}

export function SkeletonChart({ height = 220 }) {
  return (
    <div style={{
      background: "rgba(255,253,248,0.96)", border: "1px solid #D4C9B0",
      borderRadius: 12, padding: 16,
    }}>
      <SkeletonStyles />
      <SkeletonLine width={140} height={10} mb={12} />
      <SkeletonLine width="100%" height={height} />
    </div>
  )
}

export function SkeletonTable({ rows = 6 }) {
  return (
    <div style={{
      background: "rgba(255,253,248,0.96)", border: "1px solid #D4C9B0",
      borderRadius: 12, padding: 12,
    }}>
      <SkeletonStyles />
      <SkeletonLine width={180} height={10} mb={14} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <SkeletonLine width={80} height={14} />
          <SkeletonLine width="100%" height={14} />
          <SkeletonLine width={60} height={14} />
        </div>
      ))}
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div style={{ padding: "26px 32px" }}>
      <SkeletonStyles />
      <SkeletonLine width={260} height={28} mb={6} />
      <SkeletonLine width={400} height={11} mb={20} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 18 }}>
        <SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <SkeletonChart /><SkeletonChart />
      </div>
    </div>
  )
}

export default PageSkeleton
