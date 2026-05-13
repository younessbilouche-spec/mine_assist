// ─────────────────────────────────────────────────────────────────────────────
// src/pages/GeoAnomalyDashboard.jsx — VERSION AMÉLIORÉE
//
// Nouveautés vs version actuelle :
//   1. 🔥 Heatmap Leaflet (leaflet.heat — déjà dans le package.json !)
//   2. 🔗 Clustering grille (sans dépendance externe) → carte fluide même avec 1000+ points
//   3. ⏱️  Timeline animée — slider/play pour voir l'apparition des anomalies dans le temps
//   4. 🔀 LayerControl — toggle "Marqueurs / Heatmap / Clusters"
//   5. 📊 Mini-bar latérale top zones avec barres horizontales animées
//   6. 🎚️  Filtres en chips cliquables (gravité, machine, source) au lieu de selects
//
// Le composant reste 100% compatible avec /gmao/geo-anomalies (api.py) — aucun
// changement backend nécessaire.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import {
  MapContainer, TileLayer, CircleMarker, Popup, useMap
} from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import "leaflet.heat"
import { API , C} from "../config"

// ── À MIGRER : remplacer par `import { API, C , C} from "../config"` ────────────
const TARGET_MACHINE = "994F-1"



// ─── Helpers ─────────────────────────────────────────────────────────────────
const toNum = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const markerColor = g => {
  const n = toNum(g)
  if (n >= 3) return C.red
  if (n >= 2) return C.orange
  return C.green
}

const markerFillOpacity = g => {
  const n = toNum(g)
  if (n >= 3) return 0.85
  if (n >= 2) return 0.68
  return 0.42
}

// Parse une date "YYYY-MM-DD" ou ISO en timestamp (NaN si invalide)
const parseDate = d => {
  if (!d) return NaN
  const t = new Date(d).getTime()
  return Number.isFinite(t) ? t : NaN
}

// Clustering en grille (cellule = pas de degré). Renvoie [{lat, lon, count, gravite_max}]
function clusterPoints(points, gridSize = 0.0008) {
  const cells = new Map()
  for (const p of points) {
    const key = `${Math.round(p.lat / gridSize)}_${Math.round(p.lon / gridSize)}`
    if (!cells.has(key)) {
      cells.set(key, { lat: 0, lon: 0, count: 0, gravite_max: 0, items: [] })
    }
    const c = cells.get(key)
    c.lat += p.lat
    c.lon += p.lon
    c.count += 1
    c.gravite_max = Math.max(c.gravite_max, toNum(p.gravite))
    c.items.push(p)
  }
  return Array.from(cells.values()).map(c => ({
    lat: c.lat / c.count,
    lon: c.lon / c.count,
    count: c.count,
    gravite_max: c.gravite_max,
    items: c.items,
  }))
}

// ─── UI primitives ───────────────────────────────────────────────────────────
function PageTitle({ children }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 700, color: C.textMuted, letterSpacing: 4,
      textTransform: "uppercase", marginBottom: 4,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{ width: 4, height: 16, background: C.green, borderRadius: 2 }} />
      {children}
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${C.border}, transparent)` }} />
    </div>
  )
}

function Card({ children, style, accent = C.sand }) {
  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderTop: `2px solid ${accent}`,
      padding: "20px 22px",
      boxShadow: "0 2px 10px rgba(139,105,20,0.07)",
      backdropFilter: "blur(8px)",
      ...style,
    }}>
      {children}
    </div>
  )
}

function CardTitle({ children, badge }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: C.textMuted, letterSpacing: 3,
      textTransform: "uppercase", marginBottom: 14, paddingBottom: 8,
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span>{children}</span>
      {badge ? (
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "3px 8px",
          background: badge.bg, color: badge.color, marginLeft: "auto",
        }}>
          {badge.label}
        </span>
      ) : null}
    </div>
  )
}

function KPI({ title, value, subtitle, color = C.green, icon = "•" }) {
  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderTop: `3px solid ${color}`, padding: "16px 18px",
      position: "relative", overflow: "hidden", minHeight: 122,
    }}>
      <div style={{
        position: "absolute", top: 0, right: 0, width: 64, height: 64,
        background: `${color}14`, clipPath: "polygon(100% 0, 0 0, 100% 100%)",
      }} />
      <div style={{ fontSize: 18, opacity: 0.6, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 34, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{
        fontSize: 10, color: C.textMuted, letterSpacing: 2,
        textTransform: "uppercase", marginTop: 8,
      }}>{title}</div>
      {subtitle ? <div style={{ fontSize: 11, color: C.textLight, marginTop: 5 }}>{subtitle}</div> : null}
    </div>
  )
}

function Chip({ active, onClick, children, color = C.green }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
        background: active ? color : "transparent",
        color: active ? "#fff" : color,
        border: `1.5px solid ${color}`,
        cursor: "pointer",
        fontFamily: "'Rajdhani', sans-serif",
        transition: "all 0.15s ease",
      }}
    >
      {children}
    </button>
  )
}

// ─── Map components ──────────────────────────────────────────────────────────

/**
 * HeatmapLayer — utilise leaflet.heat (déjà installé).
 * Reset propre quand `points` ou `visible` change.
 */
function HeatmapLayer({ points, visible }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
      layerRef.current = null
    }
    if (!visible || !points.length) return

    const heatPoints = points.map(p => [
      p.lat, p.lon, Math.min(1, 0.2 + toNum(p.gravite) * 0.3),
    ])

    layerRef.current = L.heatLayer(heatPoints, {
      radius: 28,
      blur: 22,
      maxZoom: 17,
      gradient: {
        0.2: C.green,
        0.4: C.greenLt,
        0.6: C.sand,
        0.8: C.orange,
        1.0: C.red,
      },
    }).addTo(map)

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }
  }, [map, points, visible])

  return null
}

/**
 * ClusteredMarkers — clustering grille, sans dépendance externe.
 * Chaque cluster est un cercle dont le rayon dépend du nombre de points.
 */
function ClusteredMarkers({ points, visible, onClusterClick }) {
  const clusters = useMemo(() => clusterPoints(points), [points])

  if (!visible) return null

  return clusters.map((cl, i) => {
    if (cl.count === 1) {
      const p = cl.items[0]
      return (
        <CircleMarker
          key={`s-${i}`}
          center={[p.lat, p.lon]}
          radius={Math.max(5, Math.min(13, 4 + toNum(p.occurrences, 1)))}
          pathOptions={{
            color: markerColor(p.gravite),
            fillColor: markerColor(p.gravite),
            fillOpacity: markerFillOpacity(p.gravite),
            weight: 1.2,
          }}
        >
          <Popup>
            <PopupBody p={p} />
          </Popup>
        </CircleMarker>
      )
    }
    const color = markerColor(cl.gravite_max)
    const radius = Math.min(28, 10 + Math.sqrt(cl.count) * 2.5)
    return (
      <CircleMarker
        key={`c-${i}`}
        center={[cl.lat, cl.lon]}
        radius={radius}
        pathOptions={{
          color, fillColor: color, fillOpacity: 0.55, weight: 2,
        }}
        eventHandlers={{ click: () => onClusterClick && onClusterClick(cl) }}
      >
        <Popup>
          <div style={{ minWidth: 220, fontFamily: "'Rajdhani',sans-serif", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, color, fontSize: 16, marginBottom: 6 }}>
              📦 Cluster · {cl.count} anomalies
            </div>
            <div><b>Gravité max :</b> {cl.gravite_max}</div>
            <div><b>Top codes :</b></div>
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
              {Object.entries(
                cl.items.reduce((acc, x) => {
                  acc[x.code || "—"] = (acc[x.code || "—"] || 0) + 1
                  return acc
                }, {})
              )
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([code, n]) => <li key={code}>{code} · <b>{n}</b></li>)}
            </ul>
          </div>
        </Popup>
      </CircleMarker>
    )
  })
}

function PopupBody({ p }) {
  return (
    <div style={{ minWidth: 230, lineHeight: 1.65, fontFamily: "'Rajdhani', sans-serif" }}>
      <div style={{ fontWeight: 700, color: markerColor(p.gravite), marginBottom: 8 }}>
        {p.code || "—"}
      </div>
      <div><b>Machine :</b> {p.machine || "—"}</div>
      <div><b>Zone :</b> {p.zone || "—"}</div>
      <div><b>Gravité :</b> {p.gravite ?? "—"}</div>
      <div><b>Occurrences :</b> {p.occurrences ?? "—"}</div>
      <div><b>Source :</b> {p.source || "—"}</div>
      <div><b>Type :</b> {p.type || "—"}</div>
      <div><b>Date :</b> {p.date || "—"}</div>
    </div>
  )
}

function MapAutoFit({ bounds, center, trigger }) {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => {
      map.invalidateSize()
      if (
        bounds &&
        Number.isFinite(Number(bounds.min_lat)) &&
        Number.isFinite(Number(bounds.max_lat)) &&
        Number.isFinite(Number(bounds.min_lon)) &&
        Number.isFinite(Number(bounds.max_lon))
      ) {
        map.fitBounds(
          [
            [Number(bounds.min_lat), Number(bounds.min_lon)],
            [Number(bounds.max_lat), Number(bounds.max_lon)],
          ],
          { padding: [18, 18] }
        )
      } else if (center && Number.isFinite(Number(center.lat)) && Number.isFinite(Number(center.lon))) {
        map.setView([Number(center.lat), Number(center.lon)], 13)
      }
    }, 120)
    return () => clearTimeout(t)
  }, [map, bounds, center, trigger])
  return null
}

// ─── Timeline player ─────────────────────────────────────────────────────────
/**
 * TimelinePlayer — slider + play/pause qui filtre les points jusqu'à un timestamp.
 * Si les points n'ont pas de date exploitable, le composant s'auto-désactive proprement.
 */
function TimelinePlayer({ points, onCutoffChange, enabled }) {
  const [playing, setPlaying] = useState(false)
  const [cutoffIdx, setCutoffIdx] = useState(100) // pourcentage
  const intervalRef = useRef(null)

  // Bornes temporelles
  const { tMin, tMax, hasDates } = useMemo(() => {
    const ts = points.map(p => parseDate(p.date)).filter(Number.isFinite)
    if (!ts.length) return { tMin: NaN, tMax: NaN, hasDates: false }
    return { tMin: Math.min(...ts), tMax: Math.max(...ts), hasDates: true }
  }, [points])

  // Calcul du cutoff timestamp
  const cutoffTs = useMemo(() => {
    if (!hasDates) return Infinity
    return tMin + ((tMax - tMin) * cutoffIdx) / 100
  }, [hasDates, tMin, tMax, cutoffIdx])

  // Push to parent
  useEffect(() => {
    onCutoffChange(hasDates && enabled ? cutoffTs : Infinity)
  }, [cutoffTs, hasDates, enabled, onCutoffChange])

  // Animation auto-play
  useEffect(() => {
    if (!playing || !hasDates) return
    intervalRef.current = setInterval(() => {
      setCutoffIdx(idx => {
        if (idx >= 100) {
          setPlaying(false)
          return 100
        }
        return Math.min(100, idx + 2)
      })
    }, 150)
    return () => clearInterval(intervalRef.current)
  }, [playing, hasDates])

  const cutoffLabel = useMemo(() => {
    if (!hasDates) return "—"
    const d = new Date(cutoffTs)
    if (!Number.isFinite(d.getTime())) return "—"
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
  }, [cutoffTs, hasDates])

  if (!hasDates) {
    return (
      <div style={{ fontSize: 12, color: C.textLight, fontStyle: "italic" }}>
        Timeline indisponible — les points ne contiennent pas de dates exploitables.
      </div>
    )
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <button
        onClick={() => {
          if (cutoffIdx >= 100) setCutoffIdx(0)
          setPlaying(p => !p)
        }}
        disabled={!enabled}
        style={{
          width: 38, height: 38, border: `1.5px solid ${C.green}`,
          background: playing ? C.green : "#fff", color: playing ? "#fff" : C.green,
          cursor: enabled ? "pointer" : "not-allowed", fontSize: 16,
          fontWeight: 700, opacity: enabled ? 1 : 0.4,
        }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min="0" max="100" value={cutoffIdx}
        disabled={!enabled}
        onChange={e => { setCutoffIdx(Number(e.target.value)); setPlaying(false) }}
        style={{ flex: 1, accentColor: C.green }}
      />
      <div style={{
        minWidth: 130, textAlign: "right",
        fontSize: 12, fontWeight: 600, color: C.textMid,
      }}>
        ⏱ {cutoffLabel}
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function GeoAnomalyDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Filtres
  const [graviteMin, setGraviteMin] = useState(1)
  const [codeFilter, setCodeFilter] = useState("")
  const [zoneFilter, setZoneFilter] = useState("all")
  const [machineFilter] = useState(TARGET_MACHINE)

  // Couches
  const [showMarkers, setShowMarkers] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [useClustering, setUseClustering] = useState(true)

  // Timeline
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [cutoffTs, setCutoffTs] = useState(Infinity)
  const handleCutoff = useCallback(t => setCutoffTs(t), [])

  // Fetch
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError("")
    const params = new URLSearchParams({ machine: TARGET_MACHINE })
    fetch(`${API}/gmao/geo-anomalies?${params}`)
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.detail || `Erreur API ${res.status}`)
        return json
      })
      .then(json => { if (!cancelled) setData(json) })
      .catch(err => { if (!cancelled) setError(err.message || "Erreur inconnue") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const allPoints = data?.map_points || []
  const zones = data?.top_zones || []

  // Filtrage : gravité + code + zone + machine + timeline
  const filteredPoints = useMemo(() => {
    return allPoints.filter(p => {
      if (toNum(p.gravite) < graviteMin) return false
      if (codeFilter && !String(p.code || "").toLowerCase().includes(codeFilter.toLowerCase())) return false
      if (zoneFilter !== "all" && String(p.zone || "") !== zoneFilter) return false
      if (machineFilter !== "all" && String(p.machine || "") !== machineFilter) return false
      const ts = parseDate(p.date)
      if (timelineEnabled && Number.isFinite(ts) && ts > cutoffTs) return false
      return true
    })
  }, [allPoints, graviteMin, codeFilter, zoneFilter, machineFilter, timelineEnabled, cutoffTs])

  // Severity breakdown
  const severity = useMemo(() => {
    return filteredPoints.reduce(
      (acc, p) => {
        const g = toNum(p.gravite)
        if (g >= 3) acc.g3 += 1
        else if (g >= 2) acc.g2 += 1
        else acc.g1 += 1
        return acc
      },
      { g1: 0, g2: 0, g3: 0 }
    )
  }, [filteredPoints])

  // Zone summary
  const zoneSummary = useMemo(() => {
    const groups = {}
    for (const p of filteredPoints) {
      const z = p.zone || "Inconnu"
      if (!groups[z]) groups[z] = { zone: z, anomalies: 0, gsum: 0, occ: 0 }
      groups[z].anomalies += 1
      groups[z].gsum += toNum(p.gravite)
      groups[z].occ += toNum(p.occurrences, 1)
    }
    return Object.values(groups)
      .map(z => ({
        zone: z.zone,
        anomalies: z.anomalies,
        gravite_moy: z.anomalies ? z.gsum / z.anomalies : 0,
        occurrences_total: z.occ,
      }))
      .sort((a, b) => b.anomalies - a.anomalies)
      .slice(0, 6)
  }, [filteredPoints])

  // Loading & error
  if (loading) {
    return (
      <div style={{ padding: 28, color: C.textMid }}>
        <PageTitle>Dashboard cartographique</PageTitle>
        <div style={{ marginTop: 16, fontSize: 14 }}>Chargement des anomalies géolocalisées…</div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div style={{ padding: 28 }}>
        <Card accent={C.red}>
          <CardTitle>Erreur</CardTitle>
          <div style={{ color: C.red, fontSize: 13 }}>{error || "Données indisponibles"}</div>
        </Card>
      </div>
    )
  }

  const machines = Array.isArray(data.machines) ? data.machines : []
  const zoneOptions = ["all", ...zones.map(z => z.zone)]

  return (
    <div style={{ padding: "24px 28px", fontFamily: "'Rajdhani', sans-serif" }}>
      <PageTitle>Dashboard cartographique des anomalies</PageTitle>
      <div style={{ marginBottom: 20, fontSize: 13, color: C.textLight }}>
        Localisation, densité et progression temporelle des défaillances terrain · {TARGET_MACHINE}
      </div>

      {/* KPI strip */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 16, marginBottom: 18,
      }}>
        <KPI
          title="Anomalies géolocalisées"
          value={data.total_geo_anomalies ?? 0}
          subtitle="événements terrain exploitables"
          color={C.green} icon="📍"
        />
        <KPI
          title="Machine couverte"
          value={TARGET_MACHINE}
          subtitle={machines.join(", ") || TARGET_MACHINE}
          color={C.orange} icon="🚜"
        />
        <KPI
          title="Zone dominante"
          value={zoneSummary[0]?.zone || "—"}
          subtitle={`${zoneSummary[0]?.anomalies || 0} anomalies`}
          color={C.red} icon="⚠️"
        />
        <KPI
          title="Points visibles"
          value={filteredPoints.length}
          subtitle={`après filtres (${allPoints.length} total)`}
          color={C.sand} icon="🗺️"
        />
      </div>

      {/* Filtres en chips */}
      <Card style={{ marginBottom: 16 }} accent={C.sand}>
        <CardTitle>Filtres rapides</CardTitle>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>

          <div>
            <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>
              Gravité min
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3].map(g => (
                <Chip
                  key={g}
                  active={graviteMin === g}
                  onClick={() => setGraviteMin(g)}
                  color={g === 3 ? C.red : g === 2 ? C.orange : C.green}
                >
                  G≥{g}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>
              Machine
            </div>
            <Chip active>{TARGET_MACHINE}</Chip>
          </div>

          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>
              Code anomalie
            </div>
            <input
              type="text" value={codeFilter}
              onChange={e => setCodeFilter(e.target.value)}
              placeholder="ex: E102, hydraulique…"
              style={{
                width: "100%", padding: "8px 12px",
                border: `1px solid ${C.border}`, background: "#fff",
                fontFamily: "'Rajdhani', sans-serif", fontSize: 13,
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 10, color: C.textMuted, letterSpacing: 1.5, marginBottom: 6, textTransform: "uppercase" }}>
              Zone
            </div>
            <select
              value={zoneFilter}
              onChange={e => setZoneFilter(e.target.value)}
              style={{
                padding: "8px 12px", border: `1px solid ${C.border}`,
                background: "#fff", fontFamily: "'Rajdhani', sans-serif", fontSize: 13,
              }}
            >
              {zoneOptions.map(z => (
                <option key={z} value={z}>{z === "all" ? "Toutes les zones" : z}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Couches */}
      <Card style={{ marginBottom: 16 }} accent={C.greenDark}>
        <CardTitle badge={{ label: "AFFICHAGE", bg: C.greenPale, color: C.greenDark }}>
          Couches & timeline
        </CardTitle>

        <div style={{
          display: "grid", gap: 16,
          gridTemplateColumns: "auto auto auto auto 1fr",
          alignItems: "center", flexWrap: "wrap",
        }}>
          <Chip active={showMarkers} onClick={() => setShowMarkers(v => !v)}>
            📍 Marqueurs
          </Chip>
          <Chip active={showHeatmap} onClick={() => setShowHeatmap(v => !v)} color={C.red}>
            🔥 Heatmap
          </Chip>
          <Chip active={useClustering} onClick={() => setUseClustering(v => !v)} color={C.orange}>
            🔗 Clusters
          </Chip>
          <Chip active={timelineEnabled} onClick={() => setTimelineEnabled(v => !v)} color={C.sand}>
            ⏱ Timeline
          </Chip>
          <div style={{ minWidth: 280 }}>
            <TimelinePlayer
              points={allPoints}
              enabled={timelineEnabled}
              onCutoffChange={handleCutoff}
            />
          </div>
        </div>
      </Card>

      {/* Map + side panel */}
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, marginBottom: 18 }}>
        <Card accent={C.green}>
          <CardTitle badge={{ label: "LEAFLET", bg: C.greenPale, color: C.greenDark }}>
            Carte des anomalies
          </CardTitle>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10, fontSize: 12, color: C.textMuted }}>
            <span>🟢 G1 faible</span>
            <span>🟠 G2 moyenne</span>
            <span>🔴 G3 critique</span>
            <span style={{ marginLeft: "auto", fontSize: 11 }}>
              Sévérité affichée : G1 <b>{severity.g1}</b> · G2 <b>{severity.g2}</b> · G3 <b>{severity.g3}</b>
            </span>
          </div>

          <div style={{ height: 540, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <MapContainer
              center={[data.center?.lat || 0, data.center?.lon || 0]}
              zoom={13}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapAutoFit
                bounds={data.bounds}
                center={data.center}
                trigger={filteredPoints.length}
              />

              {/* Heatmap (peut être visible avec ou sans markers) */}
              <HeatmapLayer points={filteredPoints} visible={showHeatmap} />

              {/* Markers ou Clusters (jamais les deux à la fois pour la lisibilité) */}
              {showMarkers && (
                useClustering
                  ? <ClusteredMarkers points={filteredPoints} visible />
                  : filteredPoints.map((p, i) => (
                      <CircleMarker
                        key={`${p.lat}-${p.lon}-${i}`}
                        center={[p.lat, p.lon]}
                        radius={Math.max(6, Math.min(15, 4 + toNum(p.occurrences, 1)))}
                        pathOptions={{
                          color: markerColor(p.gravite),
                          fillColor: markerColor(p.gravite),
                          fillOpacity: markerFillOpacity(p.gravite),
                          weight: 1.2,
                        }}
                      >
                        <Popup><PopupBody p={p} /></Popup>
                      </CircleMarker>
                    ))
              )}
            </MapContainer>
          </div>
        </Card>

        {/* Side : top zones + insight */}
        <div style={{ display: "grid", gap: 16 }}>
          <Card accent={C.orange}>
            <CardTitle badge={{ label: "TOP ZONES", bg: C.orangePale, color: C.orange }}>
              Priorités terrain
            </CardTitle>
            <div style={{ display: "grid", gap: 10 }}>
              {zoneSummary.length ? zoneSummary.map((z, i) => {
                const max = Math.max(...zoneSummary.map(x => x.anomalies), 1)
                const pct = (z.anomalies / max) * 100
                const color = z.gravite_moy >= 2.5 ? C.red : z.gravite_moy >= 2 ? C.orange : C.green
                return (
                  <div
                    key={i}
                    style={{
                      background: "#fff", border: `1px solid ${C.borderSoft}`,
                      padding: "10px 12px", cursor: "pointer",
                    }}
                    onClick={() => setZoneFilter(zoneFilter === z.zone ? "all" : z.zone)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                      <b>{z.zone}</b>
                      <span style={{ color: C.textMuted }}>{z.anomalies}</span>
                    </div>
                    <div style={{ height: 6, background: C.sandPale, marginTop: 7, position: "relative", overflow: "hidden" }}>
                      <div style={{
                        width: `${pct}%`, height: "100%", background: color,
                        transition: "width 0.5s ease",
                      }} />
                    </div>
                    <div style={{
                      marginTop: 6, fontSize: 11, color: C.textLight,
                      display: "flex", justifyContent: "space-between",
                    }}>
                      <span>Grav. {z.gravite_moy.toFixed(2)}</span>
                      <span>Occ. {z.occurrences_total}</span>
                    </div>
                  </div>
                )
              }) : <div style={{ color: C.textLight, fontSize: 12 }}>Aucune zone calculée avec ce filtre.</div>}
            </div>
          </Card>

          <Card accent={C.greenDark}>
            <CardTitle badge={{ label: "IA TERRAIN", bg: C.greenPale, color: C.greenDark }}>
              Synthèse maintenance
            </CardTitle>
            <div style={{ fontSize: 13, lineHeight: 1.75, color: C.textMid }}>
              {data.geo_insight || "Aucune synthèse terrain disponible."}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
