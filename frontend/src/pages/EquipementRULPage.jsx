/**
 * EquipementRULPage.jsx  —  Page détail d'un équipement (OCP Mine Assist)
 * =========================================================================
 * Affiche pour un équipement sélectionné :
 *   - Hero banner : RUL + statut + probabilité panne
 *   - Graphe RUL_A évolution temporelle (AreaChart)
 *   - 6 capteurs critiques avec historique (MultiLine)
 *   - RUL par sous-système (RUL_A, RUL_B, RUL_C_Moteur, etc.)
 *   - Tableau des dernières anomalies
 *   - Widget de prédiction depuis fichier Excel (RulPredictionWidget)
 *
 * INTÉGRATION :
 *   1. Copier dans frontend/src/pages/
 *   2. Router : { path: '/equipement/:id', element: <EquipementRULPage /> }
 *   3. Utiliser <Link to={`/equipement/${eq.id}`}> depuis MainDashboard
 *   4. Le composant récupère l'id depuis useParams() ou props
 *
 * ENDPOINTS utilisés :
 *   GET /pred/rul/predict/demo   → données de prédiction démo
 *   GET /pred/rul/status         → état des modèles
 *   POST /pred/rul/predict       → prédiction sur fichier (via RulPredictionWidget)
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts'
import { API } from '../config'

// ─────────────────────────────────────────────
//  DESIGN SYSTEM OCP (identique au Dashboard)
// ─────────────────────────────────────────────
const OCP = {
  green:      '#00843D',
  greenLight: '#E6F4EC',
  greenMid:   '#4CAF7D',
  red:        '#C0392B',
  redLight:   '#FBEDEB',
  orange:     '#E67E22',
  orangeLight:'#FEF3E7',
  blue:       '#2980B9',
  purple:     '#8E44AD',
  gray50:     '#F8F7F4',
  gray100:    '#EDECEA',
  gray200:    '#D5D3CF',
  gray400:    '#9E9B96',
  gray700:    '#3D3B37',
  gray900:    '#1A1917',
  white:      '#FFFFFF',
  shadow:     '0 1px 4px rgba(0,0,0,0.08)',
  shadowMd:   '0 4px 16px rgba(0,0,0,0.10)',
}

// ─────────────────────────────────────────────
//  CAPTEURS CRITIQUES & CONFIG
// ─────────────────────────────────────────────
const SENSORS = [
  { key: 'engine_rpm',          label: 'Régime moteur',        unit: 'tr/min', color: '#C0392B', subsystem: 'Moteur',       normal: [700,  1900] },
  { key: 'converter_out_temp',  label: 'Temp. convertisseur',  unit: '°C',     color: '#E67E22', subsystem: 'Transmission', normal: [60,   120]  },
  { key: 'rear_axle_temp',      label: 'Temp. essieu arrière', unit: '°C',     color: '#2980B9', subsystem: 'Essieux',      normal: [40,   100]  },
  { key: 'brake_oil_temp',      label: 'Temp. huile freins',   unit: '°C',     color: '#8E44AD', subsystem: 'Freinage',     normal: [30,   90]   },
  { key: 'air_tank_pressure',   label: 'Pression air',         unit: 'bar',    color: '#16A085', subsystem: 'Pneumatique',  normal: [7.0,  9.0]  },
  { key: 'steering_oil_temp',   label: 'Temp. huile direction',unit: '°C',     color: '#27AE60', subsystem: 'Direction',    normal: [30,   85]   },
]

// Cibles RUL disponibles
const RUL_TARGETS = [
  { key: 'rul_A',           label: 'RUL global',      desc: 'Toutes anomalies grav. ≥ 2', color: OCP.green,  mae: 21  },
  { key: 'rul_B',           label: 'RUL critique',    desc: 'Anomalies gravité 3 seul.',   color: OCP.red,    mae: 114 },
  { key: 'rul_C_moteur',    label: 'RUL moteur',      desc: 'Anomalies sous-syst. moteur', color: '#C0392B',  mae: 69  },
  { key: 'rul_C_trans',     label: 'RUL transmission',desc: 'Anomalies transmission',      color: '#E67E22',  mae: 50  },
  { key: 'rul_C_hydraul',   label: 'RUL hydraulique', desc: 'Anomalies hydraulique',       color: '#2980B9',  mae: 32  },
  { key: 'rul_C_electr',    label: 'RUL électrique',  desc: 'Anomalies électrique',        color: '#8E44AD',  mae: 28  },
]

// ─────────────────────────────────────────────
//  GÉNÉRATION DONNÉES HISTORIQUES (48h glissant)
// ─────────────────────────────────────────────
function generateRULHistory(rul_A_actuel) {
  const n = 48
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.now() - (n - 1 - i) * 3600000)
    const heure = `${String(t.getDate()).padStart(2,'0')}/${String(t.getMonth()+1).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}h`
    const baseRul = rul_A_actuel + (n - 1 - i) * 1.4 + (Math.random() - 0.5) * 8
    return {
      heure,
      rul_A: Math.max(0, Math.round(baseRul)),
      rul_B: Math.max(0, Math.round(baseRul * 6.2 + (Math.random() - 0.5) * 20)),
      seuil_rouge: 24,
      seuil_orange: 72,
    }
  })
}

function generateSensorHistory(capteurs) {
  const n = 24
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.now() - (n - 1 - i) * 3600000)
    const heure = `${String(t.getHours()).padStart(2,'0')}h`
    const entry = { heure }
    SENSORS.forEach(s => {
      const base = capteurs[s.key]
      const wobble = base * 0.04 * (Math.random() - 0.5)
      const drift = i > 18 ? (s.normal[1] - base) * 0.05 * (i - 18) : 0
      entry[s.key] = +(base + wobble + drift).toFixed(1)
    })
    return entry
  })
}

function generateAnomалies() {
  const types = [
    'Avertissement de Colmatage du filtre à combustible',
    'Prélub. de moteur neutralisée',
    'Capteur pression huile — seuil dépassé',
    'Niveau huile insuffisant',
    'Température convertisseur élevée',
    'Pression air basse',
  ]
  return Array.from({ length: 8 }, (_, i) => ({
    id: `ANO-${1373 - i}`,
    type: types[i % types.length],
    gravite: [1, 1, 2, 2, 2, 3, 1, 2][i],
    heure: new Date(Date.now() - i * 7200000).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }),
    capteur: SENSORS[i % SENSORS.length].label,
    valeur: `${(SENSORS[i % SENSORS.length].normal[1] * 1.12).toFixed(1)} ${SENSORS[i % SENSORS.length].unit}`,
  }))
}

// ─────────────────────────────────────────────
//  COMPOSANTS UI
// ─────────────────────────────────────────────

function StatutBadge({ statut }) {
  const cfg = {
    RED:    { bg: OCP.red,    label: '⚠ CRITIQUE',  },
    ORANGE: { bg: OCP.orange, label: '⚡ ATTENTION', },
    GREEN:  { bg: OCP.green,  label: '✓ NOMINAL',   },
  }[statut] || { bg: OCP.gray400, label: '? INCONNU' }
  return (
    <span style={{
      background: cfg.bg, color: OCP.white,
      fontSize: 12, fontWeight: 700, letterSpacing: 1,
      padding: '5px 14px', borderRadius: 6, fontFamily: 'monospace',
    }}>
      {cfg.label}
    </span>
  )
}

function OcpTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: OCP.white, border: `1px solid ${OCP.gray200}`,
      borderRadius: 7, padding: '9px 13px', fontSize: 11,
      boxShadow: OCP.shadowMd,
    }}>
      <div style={{ fontWeight: 700, color: OCP.gray700, marginBottom: 5, fontFamily: 'monospace' }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || OCP.gray700, display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: OCP.gray400 }}>{p.name}</span>
          <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

function Card({ children, title, subtitle, style = {} }) {
  return (
    <div style={{
      background: OCP.white, borderRadius: 10,
      border: `1px solid ${OCP.gray100}`,
      boxShadow: OCP.shadow, padding: 20,
      ...style,
    }}>
      {title && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: OCP.gray900 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: OCP.gray400, marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

/** Jauge circulaire SVG pour le RUL */
function RulGauge({ rul, max = 168, statut }) {
  const R = 54
  const cx = 70, cy = 70
  const circ = 2 * Math.PI * R
  const pct = Math.min(1, rul / max)
  const dashArr = pct * circ
  const color = statut === 'RED' ? OCP.red : statut === 'ORANGE' ? OCP.orange : OCP.green
  return (
    <svg width={140} height={140} viewBox="0 0 140 140">
      {/* Track */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={OCP.gray100} strokeWidth={10} />
      {/* Progress */}
      <circle
        cx={cx} cy={cy} r={R}
        fill="none" stroke={color} strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${dashArr} ${circ}`}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      {/* Value */}
      <text x={cx} y={cy - 6} textAnchor="middle" fill={color}
        fontSize={22} fontWeight={800} fontFamily="monospace">
        {rul}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill={OCP.gray400} fontSize={11}>
        heures
      </text>
      <text x={cx} y={cy + 28} textAnchor="middle" fill={OCP.gray400} fontSize={10}>
        sur {max}h horizon
      </text>
    </svg>
  )
}

/** Carte d'un capteur avec mini-indicateur */
function CapteurCard({ sensor, valeur }) {
  const [min, max] = sensor.normal
  const isHigh = valeur > max
  const isLow  = valeur < min
  const isAlert = isHigh || isLow
  const pct = Math.min(100, Math.max(0, ((valeur - min * 0.7) / (max * 1.3 - min * 0.7)) * 100))

  return (
    <div style={{
      background: isAlert ? (isHigh ? OCP.redLight : OCP.orangeLight) : OCP.gray50,
      borderRadius: 8, padding: '12px 14px',
      border: `1px solid ${isAlert ? (isHigh ? OCP.red + '44' : OCP.orange + '44') : OCP.gray100}`,
      transition: 'background 0.3s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: OCP.gray400, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {sensor.subsystem}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: OCP.gray900, marginTop: 1 }}>
            {sensor.label}
          </div>
        </div>
        {isAlert && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: OCP.white,
            background: isHigh ? OCP.red : OCP.orange,
            padding: '2px 6px', borderRadius: 3,
          }}>
            {isHigh ? '↑ HAUT' : '↓ BAS'}
          </span>
        )}
      </div>
      <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace',
        color: isAlert ? (isHigh ? OCP.red : OCP.orange) : sensor.color, lineHeight: 1 }}>
        {valeur}
        <span style={{ fontSize: 12, fontWeight: 400, color: OCP.gray400, marginLeft: 4 }}>{sensor.unit}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 9, color: OCP.gray400, marginBottom: 4 }}>
        Zone normale : {min} – {max} {sensor.unit}
      </div>
      <div style={{ height: 4, background: OCP.gray200, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: isAlert ? (isHigh ? OCP.red : OCP.orange) : sensor.color,
          borderRadius: 2, transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  )
}

/** Ligne d'anomalie dans le tableau */
function AnomalieRow({ anom, index }) {
  const gravCfg = {
    1: { color: OCP.green,  label: 'G1 Info',  bg: OCP.greenLight },
    2: { color: OCP.orange, label: 'G2 Warn',  bg: OCP.orangeLight },
    3: { color: OCP.red,    label: 'G3 Crit.', bg: OCP.redLight },
  }[anom.gravite]

  return (
    <tr style={{ background: index % 2 === 0 ? OCP.white : OCP.gray50 }}>
      <td style={{ padding: '9px 12px', fontSize: 10, fontFamily: 'monospace', color: OCP.gray400 }}>{anom.heure}</td>
      <td style={{ padding: '9px 12px' }}>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
          background: gravCfg.bg, color: gravCfg.color,
        }}>
          {gravCfg.label}
        </span>
      </td>
      <td style={{ padding: '9px 12px', fontSize: 11, color: OCP.gray900 }}>{anom.type}</td>
      <td style={{ padding: '9px 12px', fontSize: 10, color: OCP.gray400 }}>{anom.capteur}</td>
      <td style={{ padding: '9px 12px', fontSize: 10, fontFamily: 'monospace', color: OCP.gray700, textAlign: 'right' }}>{anom.valeur}</td>
    </tr>
  )
}

// ─────────────────────────────────────────────
//  DONNÉES DÉMO ÉQUIPEMENT PAR DÉFAUT
// ─────────────────────────────────────────────
const DEFAULT_EQ = {
  id: 'CAT-994F-01', nom: 'Chargeuse A1', zone: 'Carrière Nord',
  statut: 'ORANGE', rul_A: 45, rul_B: 289,
  rul_C_moteur: 68, rul_C_trans: 95, rul_C_hydraul: 120, rul_C_electr: 210,
  proba_panne: 0.41,
  capteurs: {
    engine_rpm:         1748,
    converter_out_temp: 107,
    rear_axle_temp:     83,
    brake_oil_temp:     76,
    air_tank_pressure:  7.8,
    steering_oil_temp:  68,
  },
}

// ─────────────────────────────────────────────
//  COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────

/**
 * @param {Object} props
 * @param {Object} [props.equipement] - Données équipement (si non fournies, utilise l'API demo)
 * @param {Function} [props.onBack]   - Callback bouton retour
 */
export default function EquipementRULPage({ equipement, onBack }) {
  const [eq,          setEq]         = useState(equipement || DEFAULT_EQ)
  const [rulHistory,  setRulHistory]  = useState([])
  const [sensorHist,  setSensorHist]  = useState([])
  const [anomalies,   setAnomalies]   = useState([])
  const [, setLoading] = useState(true)
  const [activeTab,   setActiveTab]   = useState('rul')   // 'rul' | 'capteurs' | 'anomalies' | 'predict'
  const [predResult,  setPredResult]  = useState(null)
  const [uploading,   setUploading]   = useState(false)

  // ── Chargement données ──────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Essaie les données réelles d'abord
      try {
        const r = await fetch(`${API}/pred/rul/predict/demo`)
        if (r.ok) {
          const demo = await r.json()
          if (demo?.rul_A || demo?.rul) {
            setEq(prev => ({
              ...prev,
              rul_A: demo.rul_A ?? demo.rul ?? prev.rul_A,
              proba_panne: demo.proba_panne ?? demo.probability ?? prev.proba_panne,
              statut: demo.status ?? prev.statut,
              ...(demo.capteurs || {}),
            }))
          }
        }
      } catch {
        // Fallback silencieux : on retombe sur les générateurs mock ci-dessous.
      }

      setRulHistory(generateRULHistory(eq.rul_A))
      setSensorHist(generateSensorHistory(eq.capteurs))
      setAnomalies(generateAnomалies())
    } finally {
      setLoading(false)
    }
    // eq.capteurs et eq.rul_A sont des constantes du module : exclus volontairement
    // pour éviter une boucle de fetch (la fonction est recréée à chaque render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eq.rul_A])

  // loadData est défini dans la même fonction de rendu : on l'exclut volontairement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData() }, [])

  // ── Upload fichier Excel pour prédiction ──
  async function handleFileUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setPredResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`${API}/pred/rul/predict`, { method: 'POST', body: fd })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setPredResult(data)
    } catch (err) {
      setPredResult({ error: err.message })
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const rulColor = eq.statut === 'RED' ? OCP.red : eq.statut === 'ORANGE' ? OCP.orange : OCP.green

  // ─── Données pour le graphe radar capteurs ───
  const radarData = useMemo(() => SENSORS.map(s => {
    const [min, max] = s.normal
    const val = eq.capteurs[s.key] || 0
    const normalised = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100))
    return { sensor: s.label.slice(0, 12), score: Math.round(normalised) }
  }), [eq.capteurs])

  // ─────────────────────────────────────────────
  //  RENDU
  // ─────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: OCP.gray50,
      fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
      color: OCP.gray900,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;700&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${OCP.gray200}; border-radius: 3px; }
        .tab-btn { background: none; border: none; cursor: pointer; }
        .tab-btn:hover { opacity: 0.75; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{
        background: OCP.white, borderBottom: `1px solid ${OCP.gray100}`,
        padding: '0 28px', height: 58,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {onBack && (
            <button onClick={onBack} style={{
              background: OCP.gray50, border: `1px solid ${OCP.gray200}`,
              borderRadius: 7, padding: '6px 12px', fontSize: 12,
              cursor: 'pointer', color: OCP.gray700, fontWeight: 500,
            }}>
              ← Retour
            </button>
          )}
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: OCP.gray900, lineHeight: 1 }}>
              {eq.nom}
            </div>
            <div style={{ fontSize: 10, color: OCP.gray400, fontFamily: 'monospace' }}>
              {eq.id} · {eq.zone} · Maintenance Prédictive OCP
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StatutBadge statut={eq.statut} />
          <button onClick={loadData} style={{
            background: OCP.green, color: OCP.white,
            border: 'none', borderRadius: 7, padding: '7px 16px',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            Actualiser
          </button>
        </div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto', animation: 'fadeIn 0.3s ease' }}>

        {/* ── HERO BANNER ── */}
        <div style={{
          background: OCP.white, borderRadius: 12,
          border: `1px solid ${OCP.gray100}`,
          borderLeft: `5px solid ${rulColor}`,
          boxShadow: OCP.shadowMd,
          padding: '24px 28px',
          display: 'flex', gap: 28, flexWrap: 'wrap',
          marginBottom: 24,
        }}>
          {/* Jauge RUL */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <RulGauge rul={eq.rul_A} max={168} statut={eq.statut} />
            <div style={{ fontSize: 11, color: OCP.gray400, marginTop: 4 }}>RUL global (gravité ≥ 2)</div>
          </div>

          {/* KPIs texte */}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: OCP.gray400, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Diagnostique Machine — {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>

            {/* Barre probabilité */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: OCP.gray700 }}>Probabilité de panne imminente</span>
                <span style={{ fontSize: 18, fontWeight: 900, fontFamily: 'monospace', color: rulColor }}>
                  {(eq.proba_panne * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ height: 8, background: OCP.gray100, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${eq.proba_panne * 100}%`,
                  height: '100%',
                  background: `linear-gradient(90deg, ${OCP.green} 0%, ${OCP.orange} 60%, ${OCP.red} 100%)`,
                  borderRadius: 4, transition: 'width 0.8s ease',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: OCP.gray400, marginTop: 3 }}>
                <span>Sûr (0%)</span><span>Vigilance (50%)</span><span>Critique (100%)</span>
              </div>
            </div>

            {/* RUL par cible */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {RUL_TARGETS.slice(0, 3).map(t => (
                <div key={t.key} style={{
                  background: OCP.gray50, borderRadius: 8, padding: '10px 12px',
                  border: `1px solid ${OCP.gray100}`,
                }}>
                  <div style={{ fontSize: 9, color: OCP.gray400, marginBottom: 4 }}>{t.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, fontFamily: 'monospace', color: t.color, lineHeight: 1 }}>
                    {eq[t.key] || '—'}
                    <span style={{ fontSize: 10, fontWeight: 400, color: OCP.gray400 }}> h</span>
                  </div>
                  <div style={{ fontSize: 9, color: OCP.gray400, marginTop: 4 }}>MAE ±{t.mae}h</div>
                </div>
              ))}
            </div>
          </div>

          {/* Radar capteurs */}
          <div style={{ width: 200, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: OCP.gray700, marginBottom: 4 }}>Profil capteurs</div>
            <ResponsiveContainer width={200} height={160}>
              <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
                <PolarGrid stroke={OCP.gray200} />
                <PolarAngleAxis dataKey="sensor" tick={{ fontSize: 8, fill: OCP.gray400 }} />
                <Radar name="Valeur" dataKey="score" stroke={OCP.green} fill={OCP.green} fillOpacity={0.25} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 9, color: OCP.gray400 }}>Position dans la plage normale (%)</div>
          </div>
        </div>

        {/* ── ONGLETS ── */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 16,
          background: OCP.white, padding: 4,
          borderRadius: 10, border: `1px solid ${OCP.gray100}`,
          boxShadow: OCP.shadow,
          width: 'fit-content',
        }}>
          {[
            { key: 'rul',      label: '📈 Évolution RUL' },
            { key: 'capteurs', label: '⚙️ Capteurs' },
            { key: 'anomalies',label: '⚠️ Anomalies' },
            { key: 'predict',  label: '🔮 Prédiction fichier' },
          ].map(tab => (
            <button
              key={tab.key}
              className="tab-btn"
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '8px 18px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                color: activeTab === tab.key ? OCP.white : OCP.gray400,
                background: activeTab === tab.key ? OCP.green : 'transparent',
                transition: 'all 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── CONTENU ONGLETS ── */}

        {/* Onglet 1 : Évolution RUL */}
        {activeTab === 'rul' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, animation: 'fadeIn 0.3s ease' }}>

            {/* Graphe RUL_A principal */}
            <Card title="Évolution du RUL_A sur 48h" subtitle="Prédiction XGBoost · MAE ±21h · Horizon 168h">
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={rulHistory} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gRulA" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={OCP.green} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={OCP.green} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={OCP.gray100} vertical={false} />
                  <XAxis dataKey="heure" tick={{ fontSize: 9, fill: OCP.gray400 }} interval={5} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: OCP.gray400 }} axisLine={false} tickLine={false} domain={[0, 'auto']} />
                  <Tooltip content={<OcpTooltip />} />
                  <ReferenceLine y={24} stroke={OCP.red}    strokeDasharray="4 3" label={{ value: 'CRITIQUE 24h', fill: OCP.red,    fontSize: 9, position: 'right' }} />
                  <ReferenceLine y={72} stroke={OCP.orange} strokeDasharray="4 3" label={{ value: 'VIGILANCE 72h', fill: OCP.orange, fontSize: 9, position: 'right' }} />
                  <Area type="monotone" dataKey="rul_A" name="RUL global"
                    stroke={OCP.green} strokeWidth={2.5}
                    fill="url(#gRulA)" dot={false} activeDot={{ r: 5, fill: OCP.green }} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* RUL par sous-système */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{
                background: OCP.white, borderRadius: 10,
                border: `1px solid ${OCP.gray100}`, boxShadow: OCP.shadow,
                padding: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, color: OCP.gray900 }}>
                  RUL par sous-système
                </div>
                {RUL_TARGETS.map(t => {
                  const val = eq[t.key] || 0
                  const pct = Math.min(100, (val / 200) * 100)
                  return (
                    <div key={t.key} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: OCP.gray700 }}>{t.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: t.color }}>
                          {val}h
                        </span>
                      </div>
                      <div style={{ height: 5, background: OCP.gray100, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%',
                          background: val < 24 ? OCP.red : val < 72 ? OCP.orange : t.color,
                          borderRadius: 3, transition: 'width 0.6s ease',
                        }} />
                      </div>
                      <div style={{ fontSize: 9, color: OCP.gray400, marginTop: 2 }}>
                        {t.desc} · MAE ±{t.mae}h
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Recommandation */}
              <div style={{
                background: eq.statut === 'RED' ? OCP.redLight : eq.statut === 'ORANGE' ? OCP.orangeLight : OCP.greenLight,
                borderRadius: 10,
                border: `1px solid ${eq.statut === 'RED' ? OCP.red : eq.statut === 'ORANGE' ? OCP.orange : OCP.green}40`,
                padding: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: rulColor, marginBottom: 6 }}>
                  {eq.statut === 'RED' ? '🚨 Action immédiate' : eq.statut === 'ORANGE' ? '⚡ Planifier intervention' : '✅ Aucune action requise'}
                </div>
                <div style={{ fontSize: 11, color: OCP.gray700, lineHeight: 1.5 }}>
                  {eq.statut === 'RED'
                    ? 'Le modèle estime une panne dans moins de 24h. Arrêt préventif recommandé avant la prochaine vacation.'
                    : eq.statut === 'ORANGE'
                    ? `Planifier une maintenance dans les ${eq.rul_A}h. Surveiller la pression huile et la temp. convertisseur.`
                    : 'L\'équipement fonctionne dans les paramètres nominaux. Prochain contrôle planifié selon calendrier.'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Onglet 2 : Capteurs */}
        {activeTab === 'capteurs' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            {/* Cartes capteurs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 20 }}>
              {SENSORS.map(s => (
                <CapteurCard key={s.key} sensor={s} valeur={eq.capteurs[s.key]} />
              ))}
            </div>

            {/* Graphe historique multi-capteurs */}
            <Card
              title="Historique 24h — Capteurs thermiques"
              subtitle="Températures normalisées — Surveiller les dérives en fin de période"
            >
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={sensorHist} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={OCP.gray100} vertical={false} />
                  <XAxis dataKey="heure" tick={{ fontSize: 9, fill: OCP.gray400 }} interval={3} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: OCP.gray400 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<OcpTooltip />} />
                  {SENSORS.filter(s => s.unit === '°C').map(s => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                      stroke={s.color} strokeWidth={1.5} dot={false}
                      activeDot={{ r: 4, fill: s.color }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}

        {/* Onglet 3 : Anomalies */}
        {activeTab === 'anomalies' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <Card title="Dernières anomalies détectées" subtitle="Isolation Forest + règles métier OCP">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: OCP.gray50 }}>
                      {['Horodatage', 'Gravité', 'Description', 'Capteur concerné', 'Valeur mesurée'].map(h => (
                        <th key={h} style={{
                          padding: '10px 12px', textAlign: 'left',
                          fontSize: 10, fontWeight: 700, color: OCP.gray400,
                          textTransform: 'uppercase', letterSpacing: 0.5,
                          borderBottom: `2px solid ${OCP.gray100}`,
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {anomalies.map((a, i) => <AnomalieRow key={a.id} anom={a} index={i} />)}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, fontSize: 10, color: OCP.gray400, textAlign: 'right' }}>
                1 373 anomalies au total · Janvier – Décembre 2025 · 30 anomalies gravité critique (2.2%)
              </div>
            </Card>
          </div>
        )}

        {/* Onglet 4 : Prédiction fichier */}
        {activeTab === 'predict' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

              {/* Upload zone */}
              <Card title="Prédiction depuis fichier Excel" subtitle="Upload un fichier .xlsx avec les données capteurs → RUL prédit par XGBoost">
                <label style={{
                  display: 'block', border: `2px dashed ${OCP.gray200}`,
                  borderRadius: 10, padding: '32px 20px', textAlign: 'center',
                  cursor: 'pointer', transition: 'border-color 0.2s',
                }}>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} style={{ display: 'none' }} />
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
                  <div style={{ fontWeight: 700, color: OCP.gray700, marginBottom: 6 }}>
                    {uploading ? 'Analyse en cours…' : 'Glisser un fichier Excel ici'}
                  </div>
                  <div style={{ fontSize: 11, color: OCP.gray400 }}>
                    Formats acceptés : .xlsx, .xls, .csv<br />
                    Colonnes requises : {SENSORS.map(s => s.key).join(', ')}
                  </div>
                  {!uploading && (
                    <div style={{
                      marginTop: 16, display: 'inline-block',
                      background: OCP.green, color: OCP.white,
                      padding: '9px 24px', borderRadius: 8,
                      fontSize: 13, fontWeight: 700,
                    }}>
                      Sélectionner un fichier
                    </div>
                  )}
                  {uploading && (
                    <div style={{ marginTop: 12, color: OCP.green, fontWeight: 700, fontSize: 14 }}>
                      ⚙️ Prédiction XGBoost en cours…
                    </div>
                  )}
                </label>

                {/* Résultat prédiction */}
                {predResult && !predResult.error && (
                  <div style={{
                    marginTop: 16, background: OCP.greenLight,
                    border: `1px solid ${OCP.green}30`, borderRadius: 10, padding: 16,
                  }}>
                    <div style={{ fontWeight: 700, color: OCP.green, marginBottom: 10 }}>✓ Prédiction réussie</div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {Object.entries(predResult).slice(0, 6).map(([k, v]) => (
                        <div key={k} style={{ background: OCP.white, borderRadius: 8, padding: '8px 12px', minWidth: 100 }}>
                          <div style={{ fontSize: 9, color: OCP.gray400 }}>{k}</div>
                          <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: OCP.green }}>
                            {typeof v === 'number' ? v.toFixed(1) : String(v)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {predResult?.error && (
                  <div style={{ marginTop: 12, color: OCP.red, fontSize: 12, fontWeight: 600 }}>
                    ❌ Erreur : {predResult.error}
                  </div>
                )}
              </Card>

              {/* Info modèles */}
              <Card title="Performances des modèles" subtitle="Évaluation sur données OCP CAT 994F · Split chronologique 80/20">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { model: 'XGBoost Régression', target: 'RUL_A global',       mae: '21.0h', rmse: '27.4h', r2: '-0.07', badge: 'MEILLEUR RUL' },
                    { model: 'Random Forest Class.', target: 'Classif. RED/ORAN.', accuracy: '70.2%', recall: '93.1%', badge: 'MEILLEUR RECALL' },
                    { model: 'Isolation Forest',     target: 'Détection anomalies',precision: '90.9%', recall_if: '11.5%', badge: 'NON SUPERVISÉ' },
                    { model: 'XGBoost Régression',  target: 'RUL_B critique',     mae: '114.6h', rmse: '137.4h', badge: '' },
                  ].map((m, i) => (
                    <div key={i} style={{
                      background: OCP.gray50, borderRadius: 8, padding: '12px 14px',
                      border: `1px solid ${OCP.gray100}`,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: OCP.gray900 }}>{m.model}</div>
                        <div style={{ fontSize: 10, color: OCP.gray400, marginTop: 2 }}>{m.target}</div>
                        <div style={{ fontSize: 10, color: OCP.gray700, marginTop: 4, fontFamily: 'monospace' }}>
                          {m.mae && `MAE ${m.mae}`}
                          {m.accuracy && `Acc. ${m.accuracy}`}
                          {m.precision && `Préc. ${m.precision}`}
                          {m.rmse && ` · RMSE ${m.rmse}`}
                          {m.recall && ` · Rappel RED ${m.recall}`}
                          {m.recall_if && ` · Rappel ${m.recall_if}`}
                        </div>
                      </div>
                      {m.badge && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, background: OCP.green,
                          color: OCP.white, padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap',
                        }}>
                          {m.badge}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14, fontSize: 10, color: OCP.gray400, lineHeight: 1.5 }}>
                  Validation croisée temporelle (5 folds) : MAE moyenne XGBoost = 27.5 ± 7.6h<br />
                  6 capteurs critiques sélectionnés sur 333 features disponibles<br />
                  Données : 6 490 points horaires · janvier–décembre 2025
                </div>
              </Card>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
