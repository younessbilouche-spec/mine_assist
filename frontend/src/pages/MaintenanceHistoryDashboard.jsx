/**
 * MaintenanceHistoryDashboard.jsx — v1 (mai 2026)
 * MineAssist · OCP Benguerir · CAT 994F1/F2 — Historique maintenance
 *
 * Exploite les fichiers Excel OCP placés dans backend/data/ocp/ :
 *   • Suivi_des_ARRETS_2025.xlsx
 *   • Suivi_des_ARRETS_2026.xlsx
 *   • suivi_des_SE_2023-2026.xlsx
 *
 * Affiche : KPIs maintenance, top types de pannes, timeline, liste détaillée.
 */

import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart, Area,
} from "recharts"
import { API , C} from "../config"




// Couleurs par catégorie de panne
const CAT_COLORS = {
  fuite:           "#DC2626",
  huile_demande:   "#F59E0B",
  echauffement:    "#EF4444",
  pression:        "#06B6D4",
  graisse:         "#8B5CF6",
  pneumatique:     "#EC4899",
  filtre:          "#84CC16",
  demarrage:       "#F97316",
  ctr:             "#94A3B8",
  moteur:          "#3B82F6",
  transmission:    "#A855F7",
  freinage:        "#FB923C",
  electrique:      "#FBBF24",
  axe_articulation:"#0EA5E9",
  autre:           "#6B7280",
}

const CAT_LABELS = {
  fuite:            "Fuite",
  huile_demande:    "Demande huile",
  echauffement:     "Échauffement",
  pression:         "Pression",
  graisse:          "Graissage",
  pneumatique:      "Pneumatique",
  filtre:           "Filtre",
  demarrage:        "Démarrage",
  ctr:              "Contrôle",
  moteur:           "Moteur",
  transmission:     "Transmission",
  freinage:         "Freinage",
  electrique:       "Électrique",
  axe_articulation: "Axes/Articulation",
  autre:            "Autre",
}

const fmtNum = (v, dec = 1) => v == null ? "—" :
  Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })

// ──────────────────────────────────────────────────────────────────────
// COMPOSANTS
// ──────────────────────────────────────────────────────────────────────

function KpiCard({ label, value, unit, color = C.green, sublabel }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 16px",
      boxShadow: C.shadow, position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color,
      }}/>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
        color: C.textMuted, textTransform: "uppercase", marginBottom: 8,
      }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span style={{
          fontSize: 28, fontWeight: 800, color, lineHeight: 1,
          fontFamily: "Rajdhani, system-ui",
        }}>{value}</span>
        {unit && <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>{unit}</span>}
      </div>
      {sublabel && (
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
          {sublabel}
        </div>
      )}
    </div>
  )
}

function TypesPannesChart({ data }) {
  const chartData = (data || []).slice(0, 10).map(d => ({
    name: CAT_LABELS[d.type] || d.type,
    count: d.count,
    color: CAT_COLORS[d.type] || "#6B7280",
  }))
  if (chartData.length === 0) return null
  const total = chartData.reduce((s, d) => s + d.count, 0)

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 16px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
          color: C.textMuted, textTransform: "uppercase" }}>
          Top types de pannes · {total} total
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 4" stroke={C.borderLt} horizontal={false}/>
          <XAxis type="number" tick={{ fontSize: 9, fill: C.textMuted }}
            tickLine={false} axisLine={false}/>
          <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: C.text, fontWeight: 600 }}
            tickLine={false} axisLine={false} width={120}/>
          <Tooltip
            cursor={{ fill: C.borderLt + "60" }}
            contentStyle={{ borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 11 }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {chartData.map((d, i) => (
              <rect key={i} fill={d.color}/>
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function TimelineChart({ data }) {
  if (!data || data.length === 0) return null
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
        color: C.textMuted, textTransform: "uppercase", marginBottom: 10 }}>
        Évolution mensuelle des arrêts
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="grad-arrets" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.green} stopOpacity={0.4}/>
              <stop offset="100%" stopColor={C.green} stopOpacity={0.02}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke={C.borderLt} vertical={false}/>
          <XAxis dataKey="mois" tick={{ fontSize: 9, fill: C.textMuted }}
            tickLine={false} axisLine={false}/>
          <YAxis tick={{ fontSize: 9, fill: C.textMuted }}
            tickLine={false} axisLine={false} width={30}/>
          <Tooltip contentStyle={{ borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 11 }}/>
          <Area type="monotone" dataKey="n_arrets" stroke={C.green} strokeWidth={2}
            fill="url(#grad-arrets)" name="Arrêts"/>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function ArretsTable({ items, loading }) {
  const [search, setSearch] = useState("")
  const [catFilter, setCatFilter] = useState("all")

  const filtered = useMemo(() => {
    return (items || []).filter(it => {
      const matchSearch = !search || JSON.stringify(it).toLowerCase().includes(search.toLowerCase())
      const matchCat = catFilter === "all" || (it.categories || []).includes(catFilter)
      return matchSearch && matchCat
    })
  }, [items, search, catFilter])

  const allCats = useMemo(() => {
    const s = new Set()
    for (const it of items || []) for (const c of (it.categories || [])) s.add(c)
    return Array.from(s).sort()
  }, [items])

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, overflow: "hidden",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.borderLt}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
          color: C.textMuted, textTransform: "uppercase" }}>
          Détail des arrêts · {filtered.length} affichés
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{
            fontSize: 10, padding: "4px 8px", borderRadius: 4,
            border: `1px solid ${C.border}`, outline: "none",
            background: "#FFF", fontFamily: "system-ui",
          }}>
            <option value="all">Toutes catégories</option>
            {allCats.map(c => (
              <option key={c} value={c}>{CAT_LABELS[c] || c}</option>
            ))}
          </select>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Rechercher..."
            style={{ fontSize: 10, padding: "4px 8px", borderRadius: 4,
              border: `1px solid ${C.border}`, outline: "none",
              fontFamily: "system-ui", width: 140 }}/>
        </div>
      </div>
      <div style={{ maxHeight: 460, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: C.textMuted, fontSize: 12 }}>
            ⏳ Chargement...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: C.textMuted, fontSize: 12 }}>
            Aucun arrêt trouvé
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: C.sandPale, position: "sticky", top: 0 }}>
                <th style={TH({ width: 90 })}>Date</th>
                <th style={TH({ width: 70 })}>Engin</th>
                <th style={TH({ textAlign: "left" })}>Description</th>
                <th style={TH({ width: 140 })}>Catégories</th>
                <th style={TH({ width: 80, textAlign: "right" })}>Durée</th>
                <th style={TH({ width: 100 })}>Intervenant</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.borderLt}` }}>
                  <td style={TD({ fontFamily: "Rajdhani, system-ui", fontWeight: 600, color: C.textMid })}>
                    {it.date || "—"}
                  </td>
                  <td style={TD({ fontWeight: 700, color: C.greenDark })}>
                    {it.equipement || "—"}
                  </td>
                  <td style={TD({ textAlign: "left", color: C.text })}>
                    {(it.description || "").slice(0, 120)}
                  </td>
                  <td style={TD()}>
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center" }}>
                      {(it.categories || []).slice(0, 2).map(c => (
                        <span key={c} style={{
                          fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                          background: (CAT_COLORS[c] || "#6B7280") + "20",
                          color: CAT_COLORS[c] || "#6B7280", letterSpacing: 0.5,
                          textTransform: "uppercase",
                        }}>{CAT_LABELS[c] || c}</span>
                      ))}
                    </div>
                  </td>
                  <td style={TD({ textAlign: "right",
                    fontFamily: "Rajdhani, system-ui", fontWeight: 700, color: C.text })}>
                    {it.duree_min != null ? fmtNum(it.duree_min, 0) + " min" : "—"}
                  </td>
                  <td style={TD({ fontSize: 10, color: C.textMuted })}>
                    {(it.intervenant || "—").slice(0, 12)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const TH = (extra = {}) => ({
  padding: "8px 12px", fontSize: 9, fontWeight: 700, letterSpacing: 1,
  color: C.textMuted, textTransform: "uppercase", textAlign: "center",
  borderBottom: `1px solid ${C.border}`, ...extra,
})
const TD = (extra = {}) => ({ padding: "8px 12px", textAlign: "center", ...extra })

// ──────────────────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ──────────────────────────────────────────────────────────────────────
export default function MaintenanceHistoryDashboard() {
  const [engin, setEngin] = useState("994F1")
  const [status, setStatus] = useState(null)
  const [stats, setStats] = useState(null)
  const [types, setTypes] = useState(null)
  const [timeline, setTimeline] = useState(null)
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [loadedAt, setLoadedAt] = useState(null)

  useEffect(() => {
    let abort = false
    setLoading(true)
    setError(null)

    // v2 : 1 seul appel agrégé /history/dashboard (avec fallback sur l'ancien)
    fetch(`${API}/history/dashboard?engin=${engin}&limit=500`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        if (abort) return
        setStats(d.stats)
        setTypes(d.types)
        setTimeline(d.timeline)
        setList(d.list)
        setLoadedAt(d.loaded_at_iso)
        // status simulé depuis stats
        setStatus({ ok: true, n_arrets: d.stats?.n_arrets, n_arrets_chf: d.stats?.n_arrets })
        setLoading(false)
      })
      .catch(() => {
        // Fallback : ancien comportement (5 fetchs en parallèle)
        Promise.all([
          fetch(`${API}/history/status`).then(r => r.json()).catch(() => null),
          fetch(`${API}/history/arrets/stats?engin=${engin}`).then(r => r.json()).catch(() => null),
          fetch(`${API}/history/arrets/types?engin=${engin}`).then(r => r.json()).catch(() => null),
          fetch(`${API}/history/arrets/timeline?engin=${engin}`).then(r => r.json()).catch(() => null),
          fetch(`${API}/history/arrets/list?engin=${engin}&limit=200`).then(r => r.json()).catch(() => null),
        ]).then(([st, sta, ty, tl, ls]) => {
          if (abort) return
          setStatus(st); setStats(sta); setTypes(ty); setTimeline(tl); setList(ls)
          setLoading(false)
          if (!st || st.ok === false) {
            setError("Module historique non chargé. Vérifier backend/data/ocp/")
          }
        }).catch(e => {
          if (!abort) {
            setError(e.message || "Erreur de chargement")
            setLoading(false)
          }
        })
      })

    return () => { abort = true }
  }, [engin])

  return (
    <div style={{
      minHeight: "100vh", background: C.bgGradient,
      fontFamily: "system-ui, -apple-system, sans-serif", color: C.text,
      padding: "20px 24px", boxSizing: "border-box",
    }}>
      <style>{`
        @keyframes fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .fade-up { animation: fade-up 0.4s ease both; }
        button:hover:not(:disabled) { filter: brightness(1.05); }
        button { transition: all 0.15s; }
      `}</style>

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{
              background: C.green, color: "#FFF",
              padding: "3px 12px", fontSize: 10, fontWeight: 800,
              letterSpacing: 3, textTransform: "uppercase",
              clipPath: "polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%)",
            }}>
              MINEASSIST · HISTORIQUE
            </div>
            {status?.ok && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
                color: C.greenDark, background: C.greenPale,
                padding: "2px 8px", borderRadius: 4, textTransform: "uppercase",
              }}>
                ● {status.n_arrets} arrêts · {status.n_arrets_chf} CHF
              </span>
            )}
          </div>
          <h1 style={{
            margin: 0, fontSize: 26, fontWeight: 900,
            fontFamily: "Rajdhani, system-ui", letterSpacing: 0.5, color: C.text,
          }}>
            Historique maintenance · {engin}
          </h1>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
            Données Excel OCP : suivi des arrêts + sorties échangées
          </div>
        </div>

        {/* Sélecteur engin + export */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {["994F1", "994F2", "all"].map(e => (
            <button key={e} onClick={() => setEngin(e)} style={{
              padding: "10px 18px", fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
              background: engin === e ? C.green : C.card,
              color: engin === e ? "#FFF" : C.text,
              border: `1px solid ${engin === e ? C.green : C.border}`,
              borderRadius: 6, cursor: "pointer",
              fontFamily: "Rajdhani, system-ui", textTransform: "uppercase",
            }}>
              {e === "all" ? "Tous" : `CAT ${e}`}
            </button>
          ))}
          <a href={`${API}/history/export.xlsx?engin=${engin}`} download
             style={{
               padding: "10px 16px", fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
               background: C.sand, color: "#FFF", border: `1px solid ${C.sand}`,
               borderRadius: 6, cursor: "pointer", textDecoration: "none",
               fontFamily: "Rajdhani, system-ui", textTransform: "uppercase",
             }}>
            ↓ Excel
          </a>
        </div>
      </div>
      {loadedAt && (
        <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 14 }}>
          Données rechargées : {new Date(loadedAt).toLocaleString("fr-FR")} · {list?.length ?? "?"} arrêts
        </div>
      )}

      {/* Erreur */}
      {error && (
        <div className="fade-up" style={{
          padding: "12px 16px", background: C.redPale,
          border: `1px solid ${C.red}40`, borderLeft: `3px solid ${C.red}`,
          borderRadius: 8, marginBottom: 14, fontSize: 12, color: C.red,
        }}>
          ⚠ {error}
          <div style={{ fontSize: 10, marginTop: 4, color: C.textMuted }}>
            Placez les fichiers <code>Suivi_des_ARRETS_2025.xlsx</code>, <code>Suivi_des_ARRETS_2026.xlsx</code> et <code>suivi_des_SE_2023-2026.xlsx</code> dans <code>backend/data/ocp/</code>
          </div>
        </div>
      )}

      {/* LIGNE 1 : KPIs */}
      <div className="fade-up" style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        gap: 12, marginBottom: 14,
      }}>
        <KpiCard
          label="Total arrêts"
          value={loading ? "—" : (stats?.n_arrets ?? 0)}
          unit=""
          color={C.green}
          sublabel={stats?.annees_couvertes?.length ? `Période : ${stats.annees_couvertes.join(", ")}` : ""}
        />
        <KpiCard
          label="Durée totale"
          value={loading ? "—" : fmtNum(stats?.duree_totale_h, 1)}
          unit="h"
          color={C.orange}
          sublabel="d'immobilisation cumulée"
        />
        <KpiCard
          label="Durée moyenne"
          value={loading ? "—" : fmtNum(stats?.duree_moyenne_min, 0)}
          unit="min"
          color={C.sand}
          sublabel={`médiane : ${fmtNum(stats?.duree_mediane_min, 0)} min`}
        />
        <KpiCard
          label="MTBF"
          value={loading ? "—" : fmtNum(stats?.mtbf_heures, 1)}
          unit="h"
          color={C.greenLt}
          sublabel="Mean Time Between Failures"
        />
        <KpiCard
          label="Arrêt le plus long"
          value={loading ? "—" : fmtNum(stats?.duree_max_min, 0)}
          unit="min"
          color={C.red}
          sublabel="durée max enregistrée"
        />
      </div>

      {/* LIGNE 2 : graphiques */}
      <div className="fade-up" style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: 12, marginBottom: 14, animationDelay: "0.05s",
      }}>
        <TypesPannesChart data={types?.items}/>
        <TimelineChart data={timeline?.items}/>
      </div>

      {/* LIGNE 3 : tableau */}
      <div className="fade-up" style={{ animationDelay: "0.1s" }}>
        <ArretsTable items={list?.items} loading={loading}/>
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 14, padding: "10px 16px",
        background: C.sandPale, border: `1px solid ${C.borderLt}`,
        borderRadius: 8, fontSize: 10, color: C.textMuted,
        display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
      }}>
        <span>OCP Benguerir · Historique maintenance · v1</span>
        <span>
          {status?.files_present && Object.entries(status.files_present)
            .map(([f, ok]) => `${ok ? "✓" : "✗"} ${f}`)
            .join(" · ")}
        </span>
      </div>
    </div>
  )
}
