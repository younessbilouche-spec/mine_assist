/**
 * ExplicabilityPage.jsx — Sprint 3 (mai 2026)
 * ============================================
 * 
 * Page "Pourquoi cette prédiction ?" pour la soutenance :
 *   - Waterfall SHAP : top features qui poussent vers RED ou GREEN
 *   - Anomaly contributors : capteurs déviants vs distribution training
 *   - Drift PSI/KS : tableau ressenti par feature
 * 
 * Endpoints consommés (Sprint 3) :
 *   POST /pred/rul/explain         — { sample } -> waterfall
 *   POST /pred/rul/anomaly/explain — { sample } -> top contributeurs IF
 *   GET  /pred/rul/drift           — détection dérive vs baseline
 * 
 * Ajout dans App.jsx (state-based) :
 *   {activeTab === "explainability" && <ExplicabilityPage />}
 */

import React, { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

const API = (typeof window !== 'undefined' && window.__API_URL__) || 'http://localhost:8000'

const C = {
  bg: 'var(--bg, #F5F0E1)',
  card: 'var(--bg-card, #FBF7E9)',
  fg: 'var(--fg, #3A3025)',
  fgMuted: 'var(--fg-muted, #6B5E45)',
  accent: 'var(--accent, #B8842B)',
  border: 'var(--border, #D4C9B0)',
  red:    '#C0392B',
  orange: '#E58E26',
  green:  '#3F8F3F',
  blue:   '#2A6FB8',
}

function Card({ title, subtitle, children, action }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: 18,
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: C.fg }}>{title}</h3>
          {subtitle && <div style={{ fontSize: 12, color: C.fgMuted, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {action}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  )
}

function ShapWaterfall({ data, basePred, finalPred }) {
  if (!data || data.length === 0) return <div style={{ color: C.fgMuted }}>Pas de données SHAP.</div>

  const sorted = [...data].sort((a, b) => Math.abs(b.shap_value) - Math.abs(a.shap_value)).slice(0, 12)
  const chartData = sorted.map(d => ({
    feature: d.feature.length > 28 ? d.feature.slice(0, 28) + '…' : d.feature,
    shap_value: d.shap_value,
    color: d.shap_value > 0 ? C.red : C.green,
  }))

  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
        marginBottom: 12, fontSize: 13,
      }}>
        <div>
          <span style={{ color: C.fgMuted }}>Prédiction de base</span>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.fg }}>
            {basePred?.toFixed(0) ?? '—'} h
          </div>
        </div>
        <div>
          <span style={{ color: C.fgMuted }}>Prédiction finale</span>
          <div style={{
            fontSize: 22, fontWeight: 700,
            color: finalPred < basePred ? C.red : C.green,
          }}>
            {finalPred?.toFixed(0) ?? '—'} h
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(280, sorted.length * 28)}>
        <BarChart layout="vertical" data={chartData} margin={{ left: 100, right: 20 }}>
          <XAxis type="number" stroke={C.fgMuted} fontSize={11} />
          <YAxis dataKey="feature" type="category" stroke={C.fgMuted} fontSize={11} width={140} />
          <ReferenceLine x={0} stroke={C.border} />
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            contentStyle={{ background: C.card, border: `1px solid ${C.border}` }}
            formatter={(v) => [`${v > 0 ? '+' : ''}${v.toFixed(2)} h`, 'Impact']}
          />
          <Bar dataKey="shap_value" barSize={18}>
            {chartData.map((e, i) => <Cell key={i} fill={e.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: C.fgMuted }}>
        <span><span style={{ color: C.red, fontSize: 16 }}>■</span> Pousse vers RED (RUL plus court)</span>
        <span><span style={{ color: C.green, fontSize: 16 }}>■</span> Pousse vers GREEN (RUL plus long)</span>
      </div>
    </div>
  )
}

function AnomalyContributors({ data }) {
  if (!data || data.length === 0) return <div style={{ color: C.fgMuted }}>Aucune donnée.</div>
  const max = Math.max(...data.map(d => Math.abs(d.zscore || 0)))
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
          <th style={{ textAlign: 'left', padding: 8, color: C.fgMuted }}>Capteur</th>
          <th style={{ textAlign: 'right', padding: 8, color: C.fgMuted }}>Valeur</th>
          <th style={{ textAlign: 'right', padding: 8, color: C.fgMuted }}>Z-score</th>
          <th style={{ textAlign: 'left', padding: 8, color: C.fgMuted, width: 220 }}>Déviation</th>
        </tr>
      </thead>
      <tbody>
        {data.slice(0, 10).map(d => {
          const z = d.zscore || 0
          const pct = max > 0 ? Math.min(100, Math.abs(z) / max * 100) : 0
          const color = Math.abs(z) > 3 ? C.red : Math.abs(z) > 2 ? C.orange : C.fgMuted
          return (
            <tr key={d.feature} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: 8, color: C.fg }}>{d.feature}</td>
              <td style={{ padding: 8, textAlign: 'right', color: C.fg, fontFamily: 'monospace' }}>
                {(d.value ?? 0).toFixed(2)}
              </td>
              <td style={{ padding: 8, textAlign: 'right', color, fontWeight: 700 }}>
                {z > 0 ? '+' : ''}{z.toFixed(2)}σ
              </td>
              <td style={{ padding: 8 }}>
                <div style={{
                  height: 8, background: '#EFE9D8', borderRadius: 4,
                  position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute', top: 0, height: '100%',
                    left: z < 0 ? `${50 - pct/2}%` : '50%',
                    width: `${pct/2}%`,
                    background: color,
                  }} />
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function DriftPanel({ drift }) {
  if (!drift) return <div style={{ color: C.fgMuted }}>Charger un fichier capteur pour vérifier la dérive.</div>
  const status = drift.drift_detected
    ? { label: 'Dérive détectée', color: C.red, bg: '#FEE7E0' }
    : drift.warning
    ? { label: 'Attention dérive', color: C.orange, bg: '#FFF3DD' }
    : { label: 'Distribution stable', color: C.green, bg: '#E5F5E5' }

  return (
    <div>
      <div style={{
        background: status.bg, color: status.color,
        padding: '10px 14px', borderRadius: 6,
        fontWeight: 700, marginBottom: 12,
      }}>
        {status.label} · PSI max {drift.psi_max?.toFixed(3) ?? '—'} · KS max p-value {drift.ks_pmin?.toFixed(3) ?? '—'}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th style={{ textAlign: 'left', padding: 8, color: C.fgMuted }}>Feature</th>
            <th style={{ textAlign: 'right', padding: 8, color: C.fgMuted }}>PSI</th>
            <th style={{ textAlign: 'right', padding: 8, color: C.fgMuted }}>KS p-value</th>
            <th style={{ textAlign: 'left', padding: 8, color: C.fgMuted }}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {(drift.per_feature || []).slice(0, 12).map(f => (
            <tr key={f.feature} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: 8, color: C.fg }}>{f.feature}</td>
              <td style={{
                padding: 8, textAlign: 'right',
                color: f.psi > 0.25 ? C.red : f.psi > 0.10 ? C.orange : C.fg,
                fontFamily: 'monospace', fontWeight: 600,
              }}>{f.psi?.toFixed(3) ?? '—'}</td>
              <td style={{ padding: 8, textAlign: 'right', color: C.fg, fontFamily: 'monospace' }}>
                {f.ks_pvalue?.toFixed(3) ?? '—'}
              </td>
              <td style={{ padding: 8, color: f.drift ? C.red : C.fgMuted }}>
                {f.drift ? '✕ DRIFT' : '✓ stable'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ExplicabilityPage() {
  const [shap, setShap] = useState(null)
  const [anom, setAnom] = useState(null)
  const [drift, setDrift] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadAll = async () => {
    setLoading(true); setError(null)
    try {
      // 1) SHAP : envoie un sample vide → backend lit current_data.xlsx
      const shapR = await fetch(`${API}/pred/rul/explain`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample: null }),
      })
      if (shapR.ok) setShap(await shapR.json())

      const anomR = await fetch(`${API}/pred/rul/anomaly/explain`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample: null }),
      })
      if (anomR.ok) setAnom(await anomR.json())

      const driftR = await fetch(`${API}/pred/rul/drift`)
      if (driftR.ok) setDrift(await driftR.json())
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  return (
    <div style={{
      padding: '20px 24px',
      background: C.bg,
      minHeight: '100vh',
      color: C.fg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 18,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Explicabilité ML</h1>
          <p style={{ margin: '4px 0 0', color: C.fgMuted, fontSize: 13 }}>
            Pourquoi le modèle prédit ce qu'il prédit · SHAP + Isolation Forest + Drift detection
          </p>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          style={{
            background: C.accent, color: '#fff',
            padding: '8px 14px', borderRadius: 6,
            border: 'none', fontWeight: 600, cursor: 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >{loading ? 'Chargement…' : 'Recharger'}</button>
      </div>

      {error && (
        <div style={{
          background: '#FEE7E0', color: '#7A1F0E',
          padding: 12, borderRadius: 6, marginBottom: 16,
        }}>Erreur : {error}</div>
      )}

      <Card
        title="Waterfall SHAP — pourquoi ce RUL ?"
        subtitle="Tree SHAP natif XGBoost · ordre par |contribution|"
      >
        <ShapWaterfall
          data={shap?.contributions || []}
          basePred={shap?.base_value}
          finalPred={shap?.prediction}
        />
      </Card>

      <Card
        title="Contributeurs d'anomalie — Isolation Forest"
        subtitle="Z-scores des capteurs vs distribution training (top 10)"
      >
        <AnomalyContributors data={anom?.contributors || []} />
      </Card>

      <Card
        title="Détection de dérive — PSI + KS test"
        subtitle="Population Stability Index vs distribution training. PSI > 0.25 = dérive."
      >
        <DriftPanel drift={drift} />
      </Card>

      <div style={{ fontSize: 12, color: C.fgMuted, padding: 16 }}>
        <strong>Comment lire ?</strong> SHAP montre l'impact de chaque feature sur la prédiction
        (rouge = baisse RUL, vert = augmente RUL). Isolation Forest détecte les capteurs qui
        s'écartent du comportement normal. PSI mesure si la distribution actuelle reste
        cohérente avec celle du training (un PSI > 0.25 indique qu'il faut ré-entraîner le modèle).
      </div>
    </div>
  )
}
