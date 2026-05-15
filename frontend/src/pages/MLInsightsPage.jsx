/**
 * MLInsightsPage.jsx — 3 améliorations ingénieur (v6)
 * À placer dans : frontend/src/pages/MLInsightsPage.jsx
 *
 * Affiche :
 *   1. Prédiction P-F interval (régression sur Health Score)
 *   2. Health Score dynamique (seuils ajustés au mode K-Means)
 *   3. Recommandations prescriptives (ML + RAG)
 */
import { useState, useEffect } from 'react'
import { C } from "../config"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import { API } from '../config'



const verdictColor = {
  stable:              { c: C.green,  ic: '🟢', label: 'STABLE' },
  degradation_lente:   { c: C.orange, ic: '🟠', label: 'DÉGRADATION LENTE' },
  degradation_rapide:  { c: C.red,    ic: '🔴', label: 'DÉGRADATION RAPIDE' },
  donnees_insuffisantes: { c: C.muted, ic: '⚪', label: 'DONNÉES INSUFFISANTES' },
}

const urgenceColor = {
  'CRITIQUE — risque casse moteur': '#ef4444',
  'Élevée — risque de surchauffe moteur': '#ef4444',
  'Élevée — dégradation huile et joints': '#ef4444',
  'Élevée — impact sur freinage': '#ef4444',
  Élevée: '#ef4444',
  Moyenne: '#f59e0b',
}
const urgenceColorOf = (u) =>
  Object.entries(urgenceColor).find(([k]) => u?.startsWith(k))?.[1] || '#8A7D60'


export default function MLInsightsPage({ apiFetch }) {
  // ── État ────────────────────────────────────────────────────────────────
  const [prediction, setPrediction] = useState(null)
  const [loadPred,   setLoadPred]   = useState(true)
  const [history,    setHistory]    = useState([])
  const [loadHist,   setLoadHist]   = useState(true)

  // Pour le panneau "test seuils dynamiques"
  const [testMode, setTestMode] = useState('Charge nominale')
  const [dynScore, setDynScore] = useState(null)

  // Pour le panneau recommandations
  const [reco, setReco] = useState(null)
  const [loadReco, setLoadReco] = useState(false)

  // ── Fetch prédiction P-F ────────────────────────────────────────────────
  useEffect(() => {
    setLoadPred(true)
    fetch(`${API}/ml/predict-failure?days_window=14`)
      .then(r => r.ok ? r.json() : null)
      .then(setPrediction)
      .catch(() => setPrediction(null))
      .finally(() => setLoadPred(false))
  }, [])

  // ── Fetch historique pour la courbe ─────────────────────────────────────
  useEffect(() => {
    setLoadHist(true)
    fetch(`${API}/ml/health-history?days=14`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.data) {
          setHistory(d.data.map(p => ({
            ...p,
            score: +p.health_score?.toFixed(1),
            date:  p.timestamp?.slice(5, 10),
          })))
        }
      })
      .finally(() => setLoadHist(false))
  }, [])

  // ── Simulation seuils dynamiques (exemple statique) ─────────────────────
  const testerSeuils = (mode) => {
    setTestMode(mode)
    const exempleMesures = {
      'Arrêt / Ralenti':  { rpm: 700,  temp: 88 },
      'Charge légère':    { rpm: 1100, temp: 91 },
      'Charge nominale':  { rpm: 1500, temp: 92 },
      'Charge maximale':  { rpm: 1900, temp: 96 },
    }[mode]

    fetch(`${API}/ml/health-dynamic`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        mesures: {
          'Régime moteur':                      exempleMesures.rpm,
          'Température liquide refroidissement': exempleMesures.temp,
          'Température sortie convertisseur':    115,
          'Pression huile moteur':               4.0,
        }
      }),
    })
      .then(r => r.json())
      .then(setDynScore)
      .catch(() => setDynScore(null))
  }

  useEffect(() => { testerSeuils('Charge nominale') }, [])

  // ── Demande recommandation pour le pire scénario simulé ─────────────────
  const demanderReco = () => {
    setLoadReco(true)
    fetch(`${API}/ml/recommendation`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        mesures: {
          'Température liquide refroidissement': 102,
          'Pression huile moteur':               3.2,
          'Régime moteur':                       1500,
        },
        use_rag: true,
      }),
    })
      .then(r => r.json())
      .then(setReco)
      .catch(() => setReco({ error: 'Impossible de récupérer la recommandation.' }))
      .finally(() => setLoadReco(false))
  }

  // ── Préparer la courbe avec projection ──────────────────────────────────
  let chartData = history
  if (prediction?.jours_avant_critique && history.length > 0) {
    const lastDate  = new Date(history.at(-1).timestamp)
    const projDays  = Math.min(prediction.jours_avant_critique, 30)
    const lastScore = prediction.score_actuel
    const pente     = prediction.pente_par_jour

    const projection = []
    for (let i = 1; i <= projDays; i += 2) {
      const newDate = new Date(lastDate.getTime() + i * 86400000)
      projection.push({
        date:  newDate.toISOString().slice(5, 10),
        proj:  +(lastScore + pente * i).toFixed(1),
      })
    }
    chartData = [
      ...history.map(p => ({ ...p, proj: null })),
      ...projection.map(p => ({ ...p, score: null })),
    ]
  }

  const v = verdictColor[prediction?.verdict] || verdictColor.donnees_insuffisantes

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '34px 28px', color: C.text }}>

      {/* En-tête */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: C.orange, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
          OCP Benguerir · Maintenance Prédictive
        </div>
        <h1 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 26, fontWeight: 800, color: C.text, margin: '0 0 6px' }}>
          ML Insights — Aide à la décision
        </h1>
        <p style={{ fontSize: 13, color: C.textMid, margin: 0 }}>
          Intervalle P-F · Seuils dynamiques par mode opératoire · Recommandations prescriptives
        </p>
      </div>

      {/* ════════════════════════════════════════════════════════════════ */}
      {/* PANNEAU 1 — PRÉDICTION P-F INTERVAL                              */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '22px 26px', marginBottom: 22,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '2px',
              textTransform: 'uppercase', color: C.light,
            }}>
              1 · Prédiction P-F interval
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
              Projection de la trajectoire de santé sur 14 jours
            </div>
          </div>
          {prediction && prediction.status === 'ok' && (
            <span style={{
              background: `${v.c}15`,
              color: v.c,
              padding: '4px 12px',
              borderRadius: 16,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '1px',
              alignSelf: 'center',
            }}>
              {v.ic} {v.label}
            </span>
          )}
        </div>

        {loadPred ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="spinner" />
          </div>
        ) : !prediction ? (
          <div style={{ padding: 24, color: C.muted, textAlign: 'center' }}>
            Endpoint indisponible. Vérifie que <code>ml_improvements.py</code> est branché dans api.py.
          </div>
        ) : (
          <>
            {/* KPIs prédiction */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
              {[
                { label: 'Score actuel',
                  val: prediction.score_actuel != null ? `${prediction.score_actuel}` : '—',
                  unit: '/100',
                  color: prediction.score_actuel >= 70 ? C.green :
                         prediction.score_actuel >= 30 ? C.orange : C.red },
                { label: 'Pente / jour',
                  val: prediction.pente_par_jour != null ? `${prediction.pente_par_jour > 0 ? '+' : ''}${prediction.pente_par_jour}` : '—',
                  unit: 'pt',
                  color: prediction.pente_par_jour >= 0 ? C.green : C.red },
                { label: 'Jours avant critique',
                  val: prediction.jours_avant_critique != null ?
                       Math.round(prediction.jours_avant_critique) : '—',
                  unit: 'j',
                  color: prediction.verdict === 'degradation_rapide' ? C.red :
                         prediction.verdict === 'degradation_lente' ? C.orange : C.green },
                { label: 'Confiance (R²)',
                  val: prediction.r_squared != null ? `${(prediction.r_squared * 100).toFixed(0)}%` : '—',
                  color: C.muted,
                  sub: prediction.confiance },
              ].map(({ label, val, unit, color, sub }) => (
                <div key={label} style={{
                  flex: 1, minWidth: 140, background: '#FAFAF8',
                  border: '1px solid #E8E2D4', borderRadius: 10,
                  padding: '12px 16px', textAlign: 'center',
                }}>
                  <div style={{
                    fontFamily: 'Rajdhani, sans-serif', fontSize: 28,
                    fontWeight: 900, color, lineHeight: 1,
                  }}>
                    {val}
                    {unit && <span style={{ fontSize: 14, color: C.muted, marginLeft: 4 }}>{unit}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: C.light, marginTop: 4 }}>{label}</div>
                  {sub && <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>({sub})</div>}
                </div>
              ))}
            </div>

            {/* Courbe avec projection */}
            {!loadHist && chartData.length > 0 && (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <defs>
                    <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.green} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.green} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,201,176,0.4)" />
                  <XAxis dataKey="date" tick={{ fill: C.light, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} ticks={[0, 30, 70, 100]} tick={{ fill: C.light, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}
                    formatter={(v, n) => [v != null ? `${v}/100` : '—', n === 'proj' ? 'Projection' : 'Réel']}
                  />
                  <ReferenceLine y={70} stroke={C.orange} strokeDasharray="4 3" strokeOpacity={0.6} />
                  <ReferenceLine y={30} stroke={C.red}    strokeDasharray="4 3" strokeOpacity={0.6} />
                  <Line type="monotone" dataKey="score" stroke={C.green} strokeWidth={2} dot={false} name="Réel" connectNulls={false} />
                  <Line type="monotone" dataKey="proj"  stroke={C.red}   strokeWidth={2} strokeDasharray="6 3" dot={false} name="Projection" connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            )}

            {/* Recommandation */}
            <div style={{
              marginTop: 14, padding: '12px 16px',
              background: `${v.c}10`, border: `1px solid ${v.c}33`,
              borderRadius: 10, fontSize: 13, color: C.text, lineHeight: 1.6,
            }}>
              <strong>Verdict :</strong> {prediction.recommandation}
              {prediction.date_projection_critique && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  Date estimée de zone critique : <strong>{prediction.date_projection_critique}</strong>
                  &nbsp;· Méthode : {prediction.methode}
                </div>
              )}
            </div>
          </>
        )}
      </div>


      {/* ════════════════════════════════════════════════════════════════ */}
      {/* PANNEAU 2 — SEUILS DYNAMIQUES K-MEANS                            */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '22px 26px', marginBottom: 22,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '2px',
          textTransform: 'uppercase', color: C.light, marginBottom: 4,
        }}>
          2 · Seuils dynamiques par mode opérationnel
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
          Le même 92°C n'a pas la même signification à pleine charge ou au ralenti
        </div>

        {/* Sélecteur mode */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {['Arrêt / Ralenti', 'Charge légère', 'Charge nominale', 'Charge maximale']
            .map(mode => (
              <button key={mode}
                onClick={() => testerSeuils(mode)}
                style={{
                  padding: '8px 16px', fontSize: 12, fontWeight: 700,
                  borderRadius: 8, cursor: 'pointer',
                  background: testMode === mode ? C.green : 'transparent',
                  color:      testMode === mode ? '#fff'   : C.text,
                  border: `1px solid ${testMode === mode ? C.green : C.border}`,
                  transition: 'all .15s',
                }}>
                {mode}
              </button>
            ))}
        </div>

        {dynScore ? (
          <>
            {/* Comparaison statique vs dynamique */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ textAlign: 'center', padding: '14px 8px', background: '#F8F4ED', borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Score statique (avant)</div>
                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 36, fontWeight: 900, color: C.muted, lineHeight: 1, marginTop: 6 }}>
                  {dynScore.score_statique}<span style={{ fontSize: 16 }}>/100</span>
                </div>
                <div style={{ fontSize: 10, color: C.light, marginTop: 4 }}>Seuils fixes</div>
              </div>

              <div style={{ textAlign: 'center', padding: '14px 8px', background: `${C.green}10`, borderRadius: 10, border: `2px solid ${C.green}` }}>
                <div style={{ fontSize: 10, color: C.green, textTransform: 'uppercase', letterSpacing: 1 }}>Score dynamique (après)</div>
                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 36, fontWeight: 900, color: C.green, lineHeight: 1, marginTop: 6 }}>
                  {dynScore.score_dynamique}<span style={{ fontSize: 16 }}>/100</span>
                </div>
                <div style={{ fontSize: 10, color: C.green, marginTop: 4 }}>Coefficient × {dynScore.coefficient}</div>
              </div>

              <div style={{ textAlign: 'center', padding: '14px 8px', background: '#F8F4ED', borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Delta</div>
                <div style={{
                  fontFamily: 'Rajdhani, sans-serif', fontSize: 36, fontWeight: 900,
                  color: dynScore.delta >= 0 ? C.green : C.red,
                  lineHeight: 1, marginTop: 6,
                }}>
                  {dynScore.delta > 0 ? '+' : ''}{dynScore.delta}
                </div>
                <div style={{ fontSize: 10, color: C.light, marginTop: 4 }}>points</div>
              </div>
            </div>

            <div style={{ padding: '10px 14px', background: '#FAFAF8', borderRadius: 8, fontSize: 12, color: C.text, lineHeight: 1.6 }}>
              {dynScore.interpretation}
            </div>
          </>
        ) : (
          <div style={{ padding: 20, color: C.muted, textAlign: 'center' }}>
            Endpoint <code>/ml/health-dynamic</code> indisponible.
          </div>
        )}
      </div>


      {/* ════════════════════════════════════════════════════════════════ */}
      {/* PANNEAU 3 — RECOMMANDATIONS PRESCRIPTIVES                        */}
      {/* ════════════════════════════════════════════════════════════════ */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: '22px 26px', marginBottom: 22,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '2px',
              textTransform: 'uppercase', color: C.light,
            }}>
              3 · Recommandations prescriptives (ML + RAG)
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
              Ne pas juste alerter — dire QUOI FAIRE
            </div>
          </div>
          <button
            onClick={demanderReco}
            disabled={loadReco}
            style={{
              padding: '10px 18px', fontSize: 12, fontWeight: 700,
              borderRadius: 8, cursor: loadReco ? 'wait' : 'pointer',
              background: C.green, color: '#fff', border: 'none',
              opacity: loadReco ? 0.6 : 1,
            }}>
            {loadReco ? 'Calcul…' : '▶ Tester un scénario'}
          </button>
        </div>

        {!reco ? (
          <div style={{ padding: 20, color: C.muted, textAlign: 'center', fontSize: 13 }}>
            Clique sur "Tester un scénario" pour voir une recommandation basée sur un cas réel
            <br />(Température refroidissement 102°C + Pression huile 3.2 bar)
          </div>
        ) : reco.error ? (
          <div style={{ padding: 14, color: C.red, background: '#FEE2E2', borderRadius: 8 }}>
            {reco.error}
          </div>
        ) : reco.status === 'ok' ? (
          <div style={{ padding: 14, color: C.green, background: '#E8F5EE', borderRadius: 8 }}>
            {reco.message}
          </div>
        ) : (
          <div style={{ background: '#FAFAF8', borderRadius: 10, padding: 16 }}>
            {/* Header recommandation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Capteur en alerte
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{reco.capteur_fautif}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  Valeur mesurée : <strong>{reco.valeur_actuelle}</strong> · Sévérité : {reco.severite}/100
                </div>
              </div>
              <span style={{
                background: urgenceColorOf(reco.urgence) + '15',
                color:      urgenceColorOf(reco.urgence),
                padding: '4px 12px', borderRadius: 12,
                fontSize: 10, fontWeight: 700, letterSpacing: '1px',
              }}>
                URGENCE : {reco.urgence}
              </span>
            </div>

            {/* Cause probable */}
            <div style={{
              padding: '12px 14px', background: '#FFFCF5', border: '1px solid #FAEEDA',
              borderRadius: 8, marginBottom: 12,
            }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Cause probable</div>
              <div style={{ fontSize: 14, color: C.text }}>{reco.cause_probable}</div>
            </div>

            {/* Actions */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                Actions recommandées
              </div>
              {(reco.actions || []).map((a, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start',
                  padding: '8px 12px',
                  background: i === 0 && a.includes('IMMÉDIAT') ? '#FEE2E2' : '#FFF',
                  border: '1px solid ' + (i === 0 && a.includes('IMMÉDIAT') ? '#FCA5A5' : C.border),
                  borderRadius: 6, marginBottom: 4,
                }}>
                  <span style={{
                    minWidth: 22, height: 22, borderRadius: '50%',
                    background: C.green, color: '#fff',
                    fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{i + 1}</span>
                  <span style={{ fontSize: 13, color: C.text, flex: 1, lineHeight: 1.5 }}>{a}</span>
                </div>
              ))}
            </div>

            {/* Référence manuel + badge RAG */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.muted }}>
              <span>📖 {reco.ref_manuel}</span>
              {reco.rag_enriched && (
                <span style={{ background: '#E8F5EE', color: C.green, padding: '2px 10px', borderRadius: 12, fontWeight: 700 }}>
                  ✨ Enrichi par RAG
                </span>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
