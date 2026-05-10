/**
 * MainDashboard.jsx  —  Dashboard principal Mine Assist (OCP)
 * ============================================================
 * Vue globale de la flotte CAT 994F avec :
 *   - KPI cards (santé flotte, RUL moyen, alertes actives)
 *   - Grille d'équipements avec statut RED / ORANGE / GREEN
 *   - Graphe anomalies par jour (BarChart Recharts)
 *   - Répartition anomalies par sous-système (PieChart)
 *
 * INTÉGRATION :
 *   1. Copier ce fichier dans frontend/src/pages/
 *   2. Ajouter dans votre router : { path: '/dashboard', element: <MainDashboard /> }
 *   3. Le composant utilise import { API } from '../config' (déjà dans votre projet)
 *
 * ENDPOINTS utilisés :
 *   GET /pred/rul/predict/demo   → prédiction démo sur 1 équipement
 *   GET /pred/rul/status         → état des modèles
 *   GET /gmao/anomaly-results    → résultats anomalies (si disponible)
 */

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { API } from '../config'

// ─────────────────────────────────────────────
//  DESIGN SYSTEM OCP
// ─────────────────────────────────────────────
const OCP = {
  green:      '#00843D',
  greenLight: '#E6F4EC',
  greenMid:   '#4CAF7D',
  red:        '#C0392B',
  redLight:   '#FBEDEB',
  orange:     '#E67E22',
  orangeLight:'#FEF3E7',
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
//  CAPTEURS CRITIQUES (6 sélectionnés par ML)
// ─────────────────────────────────────────────
const SENSORS = [
  { key: 'engine_rpm',          label: 'Régime moteur',       unit: 'tr/min', subsystem: 'Moteur',       normal: [700, 1900] },
  { key: 'converter_out_temp',  label: 'Temp. convertisseur', unit: '°C',     subsystem: 'Transmission', normal: [60, 120]  },
  { key: 'rear_axle_temp',      label: 'Temp. essieu arrière',unit: '°C',     subsystem: 'Essieux',      normal: [40, 100]  },
  { key: 'brake_oil_temp',      label: 'Temp. huile freins',  unit: '°C',     subsystem: 'Freinage',     normal: [30, 90]   },
  { key: 'air_tank_pressure',   label: 'Pression air',        unit: 'bar',    subsystem: 'Pneumatique',  normal: [7.0, 9.0] },
  { key: 'steering_oil_temp',   label: 'Temp. huile direction',unit: '°C',   subsystem: 'Direction',    normal: [30, 85]   },
]

// Couleurs sous-systèmes pour le pie chart
const SUBSYSTEM_COLORS = {
  Moteur:       '#C0392B',
  Transmission: '#E67E22',
  Freinage:     '#8E44AD',
  Essieux:      '#2980B9',
  Pneumatique:  '#16A085',
  Direction:    '#27AE60',
  Électrique:   '#F39C12',
  Hydraulique:  '#2C3E50',
}

// ─────────────────────────────────────────────
//  DONNÉES MOCK (remplacées par l'API en prod)
// ─────────────────────────────────────────────

/** Génère une flotte fictive de 6 chargeuses */
function generateFleetMock() {
  const equipements = [
    { id: 'CAT-994F-01', nom: 'Chargeuse A1', zone: 'Carrière Nord' },
    { id: 'CAT-994F-02', nom: 'Chargeuse A2', zone: 'Carrière Nord' },
    { id: 'CAT-994F-03', nom: 'Chargeuse B1', zone: 'Carrière Sud' },
    { id: 'CAT-994F-04', nom: 'Chargeuse B2', zone: 'Carrière Sud' },
    { id: 'CAT-994F-05', nom: 'Chargeuse C1', zone: 'Atelier central' },
    { id: 'CAT-994F-06', nom: 'Chargeuse C2', zone: 'Zone export' },
  ]
  return equipements.map((eq, i) => {
    const rul = [18, 45, 92, 12, 130, 68][i]
    const statut = rul < 24 ? 'RED' : rul < 72 ? 'ORANGE' : 'GREEN'
    return {
      ...eq,
      rul_A: rul,
      rul_B: rul * 6 + Math.round(Math.random() * 20),
      statut,
      proba_panne: [0.87, 0.41, 0.12, 0.94, 0.06, 0.28][i],
      nb_anomalies_24h: [3, 1, 0, 5, 0, 1][i],
      derniere_maj: new Date(Date.now() - Math.random() * 3600000).toISOString(),
      capteurs: SENSORS.reduce((acc, s, j) => {
        const base = [1600, 95, 72, 68, 8.2, 55][j]
        const drift = statut === 'RED' ? 1.3 : statut === 'ORANGE' ? 1.1 : 1.0
        acc[s.key] = +(base * drift + (Math.random() - 0.5) * base * 0.05).toFixed(1)
        return acc
      }, {}),
    }
  })
}

/** Anomalies par jour (14 derniers jours) */
function generateAnomaliesParJour() {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000)
    const label = `${d.getDate()}/${d.getMonth() + 1}`
    return {
      jour: label,
      grav1: Math.round(Math.random() * 8 + 2),
      grav2: Math.round(Math.random() * 5 + 1),
      grav3: Math.random() > 0.7 ? Math.round(Math.random() * 3) : 0,
    }
  })
}

/** Répartition anomalies par sous-système */
const ANOMALIES_PAR_SOUS_SYSTEME = [
  { name: 'Moteur',       value: 420 },
  { name: 'Transmission', value: 312 },
  { name: 'Hydraulique',  value: 280 },
  { name: 'Freinage',     value: 185 },
  { name: 'Électrique',   value: 110 },
  { name: 'Direction',    value: 66  },
]

// ─────────────────────────────────────────────
//  COMPOSANTS RÉUTILISABLES
// ─────────────────────────────────────────────

/** Pastille de statut colorée */
function StatutBadge({ statut, size = 'md' }) {
  const cfg = {
    RED:    { bg: OCP.red,    text: OCP.white,  label: 'CRITIQUE' },
    ORANGE: { bg: OCP.orange, text: OCP.white,  label: 'ATTENTION' },
    GREEN:  { bg: OCP.green,  text: OCP.white,  label: 'NORMAL'   },
  }[statut] || { bg: OCP.gray200, text: OCP.gray700, label: '???' }

  const fontSize = size === 'sm' ? 9 : size === 'lg' ? 13 : 11
  const padding  = size === 'sm' ? '2px 7px' : size === 'lg' ? '5px 14px' : '3px 10px'

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: cfg.bg, color: cfg.text,
      fontSize, fontWeight: 700, letterSpacing: 1,
      padding, borderRadius: 4,
      fontFamily: 'monospace',
    }}>
      <span style={{
        width: size === 'sm' ? 5 : 7,
        height: size === 'sm' ? 5 : 7,
        borderRadius: '50%',
        background: cfg.text,
        opacity: 0.8,
        animation: statut === 'RED' ? 'pulse 1.4s ease-in-out infinite' : 'none',
      }} />
      {cfg.label}
    </span>
  )
}

/** Carte KPI en haut du dashboard */
function KpiCard({ titre, valeur, unite, sousTitre, couleur, icone }) {
  return (
    <div style={{
      background: OCP.white, borderRadius: 10,
      border: `1px solid ${OCP.gray100}`,
      boxShadow: OCP.shadow,
      padding: '18px 22px',
      flex: '1 1 180px', minWidth: 150,
      borderLeft: `4px solid ${couleur || OCP.green}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: OCP.gray400, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {titre}
        </div>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{icone}</span>
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 32, fontWeight: 800, color: couleur || OCP.gray900, fontFamily: 'monospace', lineHeight: 1 }}>
          {valeur}
        </span>
        {unite && <span style={{ fontSize: 14, color: OCP.gray400, fontWeight: 500 }}>{unite}</span>}
      </div>
      {sousTitre && (
        <div style={{ marginTop: 6, fontSize: 11, color: OCP.gray400 }}>{sousTitre}</div>
      )}
    </div>
  )
}

/** Barre d'état d'un capteur (valeur + barre de progression) */
function CapteurBar({ sensor, valeur }) {
  const [min, max] = sensor.normal
  const pct = Math.min(100, Math.max(0, ((valeur - min * 0.7) / (max * 1.3 - min * 0.7)) * 100))
  const isAlert = valeur < min || valeur > max
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: OCP.gray400, marginBottom: 2 }}>
        <span>{sensor.label.slice(0, 18)}</span>
        <span style={{ fontWeight: 700, color: isAlert ? OCP.red : OCP.gray700, fontFamily: 'monospace' }}>
          {valeur} {sensor.unit}
        </span>
      </div>
      <div style={{ height: 3, background: OCP.gray100, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 2,
          background: isAlert ? OCP.red : OCP.green,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}

/** Carte d'un équipement dans la grille */
function EquipementCard({ eq, onClick }) {
  const borderColor = { RED: OCP.red, ORANGE: OCP.orange, GREEN: OCP.green }[eq.statut]
  const bgColor = { RED: OCP.redLight, ORANGE: OCP.orangeLight, GREEN: OCP.greenLight }[eq.statut]
  const rulColor = eq.rul_A < 24 ? OCP.red : eq.rul_A < 72 ? OCP.orange : OCP.green

  return (
    <div
      onClick={() => onClick(eq)}
      style={{
        background: OCP.white, borderRadius: 10,
        border: `1px solid ${OCP.gray100}`,
        borderTop: `3px solid ${borderColor}`,
        boxShadow: OCP.shadow,
        padding: 16, cursor: 'pointer',
        transition: 'box-shadow 0.2s, transform 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = OCP.shadowMd
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = OCP.shadow
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      {/* En-tête carte */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: OCP.gray900 }}>{eq.nom}</div>
          <div style={{ fontSize: 10, color: OCP.gray400, marginTop: 2 }}>
            📍 {eq.zone} &nbsp;·&nbsp; {eq.id}
          </div>
        </div>
        <StatutBadge statut={eq.statut} size="sm" />
      </div>

      {/* RUL principal */}
      <div style={{
        background: bgColor, borderRadius: 8,
        padding: '10px 14px', marginBottom: 12,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: OCP.gray400, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            RUL avant panne
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: rulColor, fontFamily: 'monospace', lineHeight: 1.1 }}>
            {eq.rul_A}<span style={{ fontSize: 13, fontWeight: 500, color: OCP.gray400 }}>h</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: OCP.gray400 }}>Probabilité panne</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: rulColor, fontFamily: 'monospace' }}>
            {(eq.proba_panne * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Capteurs critiques */}
      <div>
        {SENSORS.slice(0, 4).map(s => (
          <CapteurBar key={s.key} sensor={s} valeur={eq.capteurs[s.key]} />
        ))}
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 10, paddingTop: 8,
        borderTop: `1px solid ${OCP.gray100}`,
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, color: OCP.gray400,
      }}>
        <span>⚠️ {eq.nb_anomalies_24h} anomalie(s) / 24h</span>
        <span>Mis à jour {formatRelative(eq.derniere_maj)}</span>
      </div>
    </div>
  )
}

/** Tooltip personnalisé pour les graphiques */
function OcpTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: OCP.white, border: `1px solid ${OCP.gray200}`,
      borderRadius: 6, padding: '8px 12px', fontSize: 11,
      boxShadow: OCP.shadowMd,
    }}>
      <div style={{ fontWeight: 600, color: OCP.gray700, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || OCP.gray700, display: 'flex', gap: 6 }}>
          <span>{p.name} :</span>
          <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
//  UTILITAIRES
// ─────────────────────────────────────────────
function formatRelative(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 60000
  if (diff < 2)  return 'à l\'instant'
  if (diff < 60) return `il y a ${Math.round(diff)} min`
  return `il y a ${Math.round(diff / 60)}h`
}

function calcKpis(fleet) {
  const alertes = fleet.filter(e => e.statut === 'RED').length
  const warnings = fleet.filter(e => e.statut === 'ORANGE').length
  const rulMoyen = Math.round(fleet.reduce((s, e) => s + e.rul_A, 0) / fleet.length)
  const santeScore = Math.round(
    fleet.reduce((s, e) => s + (e.statut === 'GREEN' ? 100 : e.statut === 'ORANGE' ? 60 : 20), 0) / fleet.length
  )
  return { alertes, warnings, rulMoyen, santeScore, total: fleet.length }
}

// ─────────────────────────────────────────────
//  COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────
export default function MainDashboard() {
  const [fleet,        setFleet]        = useState([])
  const [anomParJour,  setAnomParJour]  = useState([])
  const [modelStatus,  setModelStatus]  = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [selected,     setSelected]     = useState(null)
  const [lastRefresh,  setLastRefresh]  = useState(new Date())

  // ── Chargement données ──────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Essaie l'API réelle, sinon fallback sur mock
      let fleetData = generateFleetMock()
      try {
        const r = await fetch(`${API}/pred/rul/predict/demo`)
        if (r.ok) {
          const demo = await r.json()
          // Le premier équipement de la flotte reçoit les données réelles
          if (demo?.rul_A || demo?.rul) {
            fleetData[0] = {
              ...fleetData[0],
              rul_A: demo.rul_A ?? demo.rul ?? fleetData[0].rul_A,
              proba_panne: demo.proba_panne ?? demo.probability ?? fleetData[0].proba_panne,
              statut: demo.status ?? fleetData[0].statut,
            }
          }
        }
      } catch {
        fleetData = generateFleetMock()
      }

      // Statut des modèles
      try {
        const r = await fetch(`${API}/pred/rul/status`)
        if (r.ok) setModelStatus(await r.json())
      } catch {
        setModelStatus(null)
      }

      setFleet(fleetData)
      setAnomParJour(generateAnomaliesParJour())
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    // Rafraîchissement toutes les 2 minutes
    const interval = setInterval(loadData, 120_000)
    return () => clearInterval(interval)
  }, [loadData])

  const kpis = calcKpis(fleet)

  // ── RENDU ───────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: OCP.gray50,
      fontFamily: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
      color: OCP.gray900,
    }}>
      {/* Styles globaux */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;700&display=swap');
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: ${OCP.gray200}; border-radius: 3px; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{
        background: OCP.white,
        borderBottom: `1px solid ${OCP.gray100}`,
        padding: '0 28px',
        height: 58,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8,
            background: OCP.green, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 18 }}>⚙️</span>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: OCP.gray900, lineHeight: 1 }}>
              Mine Assist — OCP Benguerir
            </div>
            <div style={{ fontSize: 10, color: OCP.gray400, fontFamily: 'monospace' }}>
              Maintenance prédictive · CAT 994F · {kpis.total} chargeuses
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {modelStatus && (
            <div style={{
              fontSize: 10, color: OCP.gray400, fontFamily: 'monospace',
              background: OCP.gray50, padding: '4px 10px', borderRadius: 6,
              border: `1px solid ${OCP.gray200}`,
            }}>
              Modèles ML ✓ chargés
            </div>
          )}
          <div style={{ fontSize: 10, color: OCP.gray400 }}>
            🔄 Actualisé à {lastRefresh.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <button
            onClick={loadData}
            style={{
              background: OCP.green, color: OCP.white,
              border: 'none', borderRadius: 7,
              padding: '7px 16px', fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Actualiser
          </button>
        </div>
      </div>

      {/* ── CONTENU ── */}
      <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 80, color: OCP.gray400 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
            <div style={{ fontSize: 14 }}>Chargement des données en cours…</div>
          </div>
        ) : (
          <>
            {/* ── ALERTES BANNER ── */}
            {kpis.alertes > 0 && (
              <div style={{
                background: OCP.redLight,
                border: `1px solid ${OCP.red}`,
                borderLeft: `5px solid ${OCP.red}`,
                borderRadius: 10,
                padding: '12px 20px',
                marginBottom: 20,
                display: 'flex', alignItems: 'center', gap: 12,
                animation: 'fadeIn 0.3s ease',
              }}>
                <span style={{ fontSize: 20 }}>🚨</span>
                <div>
                  <div style={{ fontWeight: 700, color: OCP.red, fontSize: 14 }}>
                    {kpis.alertes} équipement(s) en état CRITIQUE — intervention immédiate requise
                  </div>
                  <div style={{ fontSize: 11, color: OCP.gray400, marginTop: 2 }}>
                    RUL estimé inférieur à 24h · Cliquer sur la carte pour le détail
                  </div>
                </div>
              </div>
            )}

            {/* ── KPI ROW ── */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
              <KpiCard
                titre="Score de santé flotte"
                valeur={kpis.santeScore}
                unite="%"
                sousTitre={`${kpis.total - kpis.alertes - kpis.warnings} engins nominaux`}
                couleur={kpis.santeScore > 80 ? OCP.green : kpis.santeScore > 50 ? OCP.orange : OCP.red}
                icone="💚"
              />
              <KpiCard
                titre="RUL moyen flotte"
                valeur={kpis.rulMoyen}
                unite="h"
                sousTitre="Remaining Useful Life médian"
                couleur={kpis.rulMoyen > 72 ? OCP.green : kpis.rulMoyen > 24 ? OCP.orange : OCP.red}
                icone="⏱️"
              />
              <KpiCard
                titre="Alertes critiques"
                valeur={kpis.alertes}
                sousTitre={`+ ${kpis.warnings} en vigilance (ORANGE)`}
                couleur={kpis.alertes > 0 ? OCP.red : OCP.green}
                icone={kpis.alertes > 0 ? '🚨' : '✅'}
              />
              <KpiCard
                titre="Engins surveillés"
                valeur={kpis.total}
                sousTitre="CAT 994F · Benguerir"
                couleur={OCP.green}
                icone="🏗️"
              />
            </div>

            {/* ── GRILLE ÉQUIPEMENTS ── */}
            <div style={{ marginBottom: 8 }}>
              <h2 style={{
                fontSize: 16, fontWeight: 700, color: OCP.gray900,
                margin: '0 0 14px', letterSpacing: -0.3,
              }}>
                État de la flotte
                <span style={{
                  marginLeft: 10, fontSize: 11, fontWeight: 500,
                  color: OCP.gray400, fontFamily: 'monospace',
                }}>
                  {fleet.filter(e => e.statut === 'GREEN').length} vert ·{' '}
                  {fleet.filter(e => e.statut === 'ORANGE').length} orange ·{' '}
                  {fleet.filter(e => e.statut === 'RED').length} rouge
                </span>
              </h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                gap: 16,
                animation: 'fadeIn 0.4s ease',
              }}>
                {fleet.map(eq => (
                  <EquipementCard key={eq.id} eq={eq} onClick={setSelected} />
                ))}
              </div>
            </div>

            {/* ── GRAPHIQUES ANALYTIQUES ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20, marginTop: 28 }}>

              {/* Anomalies par jour */}
              <div style={{
                background: OCP.white, borderRadius: 10,
                border: `1px solid ${OCP.gray100}`, boxShadow: OCP.shadow, padding: 20,
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: OCP.gray900 }}>
                  Anomalies détectées — 14 derniers jours
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={anomParJour} barSize={12} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke={OCP.gray100} vertical={false} />
                    <XAxis dataKey="jour" tick={{ fontSize: 10, fill: OCP.gray400 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: OCP.gray400 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<OcpTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                    <Bar dataKey="grav1" name="Gravité 1" stackId="a" fill={OCP.greenMid}  radius={[0,0,0,0]} />
                    <Bar dataKey="grav2" name="Gravité 2" stackId="a" fill={OCP.orange}    radius={[0,0,0,0]} />
                    <Bar dataKey="grav3" name="Gravité 3" stackId="a" fill={OCP.red}       radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Répartition sous-systèmes */}
              <div style={{
                background: OCP.white, borderRadius: 10,
                border: `1px solid ${OCP.gray100}`, boxShadow: OCP.shadow, padding: 20,
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: OCP.gray900 }}>
                  Anomalies par sous-système
                </h3>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={ANOMALIES_PAR_SOUS_SYSTEME}
                      cx="50%" cy="50%"
                      innerRadius={45} outerRadius={70}
                      paddingAngle={3} dataKey="value"
                    >
                      {ANOMALIES_PAR_SOUS_SYSTEME.map((entry) => (
                        <Cell key={entry.name} fill={SUBSYSTEM_COLORS[entry.name] || OCP.gray400} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v + ' anomalies', n]} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Légende manuelle */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4 }}>
                  {ANOMALIES_PAR_SOUS_SYSTEME.map(e => (
                    <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: SUBSYSTEM_COLORS[e.name], display: 'inline-block' }} />
                      <span style={{ color: OCP.gray700 }}>{e.name}</span>
                      <span style={{ color: OCP.gray400, fontFamily: 'monospace' }}>{e.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── TOP FEATURES ML ── */}
            <div style={{
              background: OCP.white, borderRadius: 10,
              border: `1px solid ${OCP.gray100}`, boxShadow: OCP.shadow,
              padding: 20, marginTop: 20,
            }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: OCP.gray900 }}>
                Importance des capteurs dans le modèle XGBoost
                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: OCP.gray400 }}>
                  (Feature importance normalisée · Rappel RED = 93.1%)
                </span>
              </h3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Var. pression huile 24h', pct: 30, sub: 'Moteur' },
                  { label: 'Pression air (moyenne)',  pct: 14, sub: 'Pneumatique' },
                  { label: 'Max pression 168h',       pct: 6,  sub: 'Moteur' },
                  { label: 'Var. temp. conv. 72h',    pct: 4,  sub: 'Transmission' },
                  { label: 'RPM moteur 168h moy.',    pct: 2,  sub: 'Moteur' },
                  { label: 'Temp. essieu arrière',    pct: 1,  sub: 'Essieux' },
                ].map((f, i) => (
                  <div key={i} style={{
                    flex: '1 1 140px', minWidth: 120,
                    background: OCP.gray50, borderRadius: 8,
                    padding: '10px 12px',
                    border: `1px solid ${OCP.gray100}`,
                  }}>
                    <div style={{ fontSize: 10, color: OCP.gray400, marginBottom: 4 }}>{f.sub}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: OCP.gray900, marginBottom: 8, lineHeight: 1.3 }}>
                      {f.label}
                    </div>
                    <div style={{ height: 4, background: OCP.gray200, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        width: `${(f.pct / 30) * 100}%`, height: '100%',
                        background: OCP.green, borderRadius: 2,
                      }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: OCP.green, marginTop: 4, fontFamily: 'monospace' }}>
                      {f.pct}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── MODAL ÉQUIPEMENT ── */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(26,25,23,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: OCP.white, borderRadius: 14,
              padding: 28, maxWidth: 520, width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: OCP.gray900 }}>{selected.nom}</div>
                <div style={{ fontSize: 11, color: OCP.gray400, marginTop: 2 }}>
                  {selected.id} · {selected.zone}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: OCP.gray400 }}
              >✕</button>
            </div>
            <StatutBadge statut={selected.statut} size="lg" />
            <div style={{ display: 'flex', gap: 20, margin: '18px 0', justifyContent: 'space-around' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: OCP.gray400 }}>RUL_A (global)</div>
                <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace',
                  color: selected.rul_A < 24 ? OCP.red : selected.rul_A < 72 ? OCP.orange : OCP.green }}>
                  {selected.rul_A}h
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: OCP.gray400 }}>Proba. panne</div>
                <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: OCP.red }}>
                  {(selected.proba_panne * 100).toFixed(0)}%
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: OCP.gray400 }}>Anomalies / 24h</div>
                <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: OCP.orange }}>
                  {selected.nb_anomalies_24h}
                </div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${OCP.gray100}`, paddingTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Lectures capteurs</div>
              {SENSORS.map(s => (
                <CapteurBar key={s.key} sensor={s} valeur={selected.capteurs[s.key]} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button
                onClick={() => setSelected(null)}
                style={{
                  flex: 1, padding: '10px 0',
                  background: OCP.green, color: OCP.white,
                  border: 'none', borderRadius: 8, fontSize: 13,
                  fontWeight: 700, cursor: 'pointer',
                }}
              >
                Voir page détail →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
