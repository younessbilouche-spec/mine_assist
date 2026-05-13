// ─────────────────────────────────────────────────────────────────────────────
// src/pages/AlertesPage.jsx — REFONTE v3 ROBUSTE
// - Couleurs hex solides (pas de template literals avec alpha)
// - Layouts en flexbox simple (pas de grid complexe)
// - Fallbacks visibles si donnees manquantes
// - Mode debug ?debug=1
// - apiFetch en prop OU via useAuth (compat)
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo } from 'react'
import { API } from '../config'

// ── Mode debug ──────────────────────────────────────────────────────────────
const DEBUG = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('debug') === '1'

// ── Palette urgence (couleurs SOLIDES) ──────────────────────────────────────
const URG = {
  URGENCE:      { fg: '#C0392B', bg: '#FBEFEC', accent: '#E74C3C', icon: '🔴', label: 'URGENCE',      rank: 3 },
  PLANIFIÉE:    { fg: '#C4760A', bg: '#FDF3E3', accent: '#F39C12', icon: '🟠', label: 'PLANIFIÉE',    rank: 2 },
  SURVEILLANCE: { fg: '#1E5BB8', bg: '#EDF2FA', accent: '#3B82F6', icon: '🔵', label: 'SURVEILLANCE', rank: 1 },
  NORMALE:      { fg: '#00843D', bg: '#EAF6EE', accent: '#00A84F', icon: '🟢', label: 'NORMALE',      rank: 0 },
}
const ECH_COLOR = {
  'Immédiat (< 2h)':           '#C0392B',
  'Court terme (< 24h)':       '#C4760A',
  'Moyen terme (< 1 semaine)': '#3B82F6',
}

// ── Helpers ──────────────────────────────────────────────────────────────────
// ── Pill urgence ────────────────────────────────────────────────────────────
function UrgencePill({ urgence, mini=false }) {
  const u = URG[urgence] || URG.NORMALE
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: u.bg, color: u.fg,
      border: `1px solid ${u.accent}`, borderRadius: 4,
      padding: mini ? '1px 6px' : '2px 8px',
      fontSize: mini ? 9 : 10, fontWeight: 800,
      letterSpacing: 0.5, textTransform: 'uppercase',
    }}>
      <span style={{ fontSize: mini ? 7 : 8 }}>{u.icon}</span>
      {u.label}
    </span>
  )
}

// ── Debug panel ─────────────────────────────────────────────────────────────
function DebugPanel({ data, error, loading }) {
  if (!DEBUG) return null
  return (
    <div style={{
      background: '#FFF8E1', border: '2px solid #C4760A',
      borderRadius: 8, padding: 12, marginBottom: 16,
      fontSize: 11, fontFamily: 'monospace', color: '#2A2A1E',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#C4760A' }}>
        🐞 DEBUG MODE — donnees recues du backend
      </div>
      <div>Loading: {String(loading)}</div>
      <div>Error: {error || '(none)'}</div>
      <div>Data keys: {data ? Object.keys(data).join(', ') : '(no data)'}</div>
      {data && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', color: '#005C2B' }}>Voir JSON</summary>
          <pre style={{
            maxHeight: 300, overflow: 'auto',
            background: '#FFFFFF', padding: 8, marginTop: 4, borderRadius: 4,
            fontSize: 10,
          }}>
{JSON.stringify(data, null, 2).slice(0, 3000)}
          </pre>
        </details>
      )}
    </div>
  )
}

// ── Carte alerte (compact, expand inline) ───────────────────────────────────
function AlerteCard({ alerte, isOpen, onToggle }) {
  const u = URG[alerte.urgence] || URG.NORMALE
  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid #D4C9B0',
      borderLeft: `4px solid ${u.accent}`,
      borderRadius: 8, marginBottom: 8, overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      {/* Header compact */}
      <div onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', cursor: 'pointer', flexWrap: 'wrap',
      }}>
        <div style={{ flex: '0 0 130px' }}>
          <UrgencePill urgence={alerte.urgence} />
          <div style={{
            fontSize: 9, color: '#B0A080', marginTop: 3,
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {alerte.type === 'RUL' ? '📊 IA · Isolation Forest' : `🔧 ${alerte.type || 'capteur'}`}
          </div>
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{
            fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 15,
            fontWeight: 700, color: '#2A2A1E', lineHeight: 1.2,
          }}>
            {alerte.capteur_label || alerte.capteur || 'Alerte'}
          </div>
          <div style={{
            fontSize: 11, color: '#8A7D60', marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {alerte.message}
          </div>
        </div>
        {alerte.valeur_actuelle != null && (
          <div style={{ flex: '0 0 110px', textAlign: 'right' }}>
            <div style={{
              fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 18,
              fontWeight: 800, color: u.fg, lineHeight: 1,
            }}>
              {alerte.valeur_actuelle}
              <span style={{ fontSize: 10, fontWeight: 500, marginLeft: 2 }}>{alerte.unite}</span>
            </div>
            {alerte.seuil_alarme != null && (
              <div style={{ fontSize: 9, color: '#B0A080', marginTop: 1 }}>
                seuil {alerte.seuil_alarme} {alerte.unite}
              </div>
            )}
          </div>
        )}
        <div style={{
          flex: '0 0 24px', textAlign: 'center', fontSize: 14,
          color: '#8A7D60', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>
          ▸
        </div>
      </div>

      {/* Body expand */}
      {isOpen && (
        <div style={{
          padding: '12px 16px', background: '#F7F0DC',
          borderTop: '1px solid #D4C9B0',
          fontSize: 11, color: '#2A2A1E', lineHeight: 1.5,
        }}>
          {alerte.recommandation && (
            <div style={{ marginBottom: 6 }}>
              <strong>Recommandation : </strong>{alerte.recommandation}
            </div>
          )}
          {alerte.cause_probable && (
            <div style={{ marginBottom: 6 }}>
              <strong>Cause probable : </strong>{alerte.cause_probable}
            </div>
          )}
          {alerte.echeance && (
            <div>
              <strong>Echeance : </strong>{alerte.echeance}
            </div>
          )}
          {!alerte.recommandation && !alerte.cause_probable && !alerte.echeance && (
            <div style={{ color: '#8A7D60', fontStyle: 'italic' }}>
              Pas de detail supplementaire pour cette alerte.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Plan d'intervention sticky ──────────────────────────────────────────────
function PlanSticky({ plan, urgenceGlobale }) {
  const u = URG[urgenceGlobale] || URG.NORMALE

  if (!plan || plan.length === 0) {
    return (
      <div style={{
        background: '#FFFFFF', border: '1px solid #D4C9B0', borderRadius: 12,
        padding: 14, textAlign: 'center', color: '#8A7D60', fontSize: 12,
      }}>
        Aucun plan disponible.
      </div>
    )
  }

  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #D4C9B0', borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        background: u.accent, color: '#FFFFFF', padding: '10px 16px',
      }}>
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 2,
          opacity: 0.85, textTransform: 'uppercase',
        }}>Plan d'intervention</div>
        <div style={{
          fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 18,
          fontWeight: 800, marginTop: 2,
        }}>
          {plan.length} action{plan.length > 1 ? 's' : ''} priorisee{plan.length > 1 ? 's' : ''}
        </div>
      </div>
      <div style={{ padding: 12 }}>
        {plan.map((item, idx) => {
          const echColor = ECH_COLOR[item.echeance] || '#00843D'
          return (
            <div key={item.priorite || idx} style={{
              display: 'flex', gap: 10, padding: '8px 4px',
              borderBottom: idx < plan.length - 1 ? '1px dashed #D4C9B0' : 'none',
              alignItems: 'flex-start',
            }}>
              <div style={{
                flex: '0 0 28px',
                width: 28, height: 28, borderRadius: '50%',
                background: '#FFFFFF', border: `2px solid ${echColor}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: echColor, fontWeight: 800, fontSize: 12,
                fontFamily: '"Rajdhani", system-ui, sans-serif',
                boxSizing: 'border-box',
              }}>
                {item.priorite ?? idx + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, color: '#2A2A1E', fontWeight: 600, lineHeight: 1.3,
                }}>{item.action}</div>
                <div style={{
                  display: 'inline-block', marginTop: 4,
                  background: '#FFFFFF', color: echColor,
                  border: `1px solid ${echColor}`, borderRadius: 4,
                  padding: '1px 7px', fontSize: 9, fontWeight: 700,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                }}>
                  ⏱ {item.echeance}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Loader ──────────────────────────────────────────────────────────────────
function AlertesLoader({ elapsed }) {
  const ESTIMATED_S = 13
  const pct = Math.min(98, (elapsed / ESTIMATED_S) * 100)
  const overTime = elapsed > ESTIMATED_S + 8
  const barColor = overTime ? '#C0392B' : '#00843D'

  return (
    <div style={{ padding: '60px 24px', maxWidth: 540, margin: '0 auto', textAlign: 'center' }}>
      <div style={{
        width: 48, height: 48, margin: '0 auto 20px',
        border: '4px solid #D4C9B0', borderTopColor: '#00843D',
        borderRadius: '50%', animation: 'spin 0.9s linear infinite',
      }} />
      <div style={{
        fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 20, fontWeight: 800,
        color: '#2A2A1E', marginBottom: 6, letterSpacing: 0.3,
      }}>
        Chargement des alertes
      </div>
      <div style={{ fontSize: 13, color: '#8A7D60', marginBottom: 18 }}>
        {elapsed.toFixed(0)}s ecoulees
        {!overTime && elapsed > 0 && ` / ~${ESTIMATED_S}s estimees`}
      </div>
      <div style={{
        height: 6, background: '#D4C9B0', borderRadius: 3, overflow: 'hidden',
        marginBottom: 20,
      }}>
        <div style={{
          height: '100%', width: `${pct}%`, background: barColor,
          transition: 'width 0.3s ease',
        }} />
      </div>
      <div style={{
        background: '#E8F5EE', border: '1px solid #00843D55',
        borderRadius: 8, padding: '10px 14px', textAlign: 'left',
        fontSize: 11.5, color: '#2A2A1E', lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 700, color: '#00843D', marginBottom: 3 }}>
          🚨 Generation du plan d'intervention
        </div>
        <div style={{ color: '#8A7D60' }}>
          Premier chargement : ~13s. Les rafraichissements suivants seront
          {' '}<strong>quasi instantanes</strong> grace au cache.
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Filter chip ─────────────────────────────────────────────────────────────
function FilterChip({ label, count, active, onClick, color, icon }) {
  return (
    <button onClick={onClick} style={{
      background: active ? color : '#FFFFFF',
      color: active ? '#FFFFFF' : color,
      border: `1px solid ${color}`, borderRadius: 99,
      padding: '5px 12px', fontSize: 11, fontWeight: 700,
      letterSpacing: 0.5, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      transition: 'all 0.15s',
      fontFamily: 'inherit',
    }}>
      {icon && <span style={{ fontSize: 8 }}>{icon}</span>}
      {label}
      <span style={{
        background: active ? 'rgba(255,255,255,0.25)' : '#FFFFFF',
        color: active ? '#FFFFFF' : color,
        borderRadius: 99, padding: '1px 7px', fontSize: 10, fontWeight: 800,
      }}>{count}</span>
    </button>
  )
}

// ── Page principale ─────────────────────────────────────────────────────────
export default function AlertesPage(props) {
  const apiFetch = props?.apiFetch || fetch

  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [openCards,  setOpenCards]  = useState({})
  const [refreshing, setRefreshing] = useState(false)
  const [filter,     setFilter]     = useState('ALL')
  const [elapsed,    setElapsed]    = useState(0)

  useEffect(() => {
    if (!loading) { setElapsed(0); return }
    const t0 = Date.now()
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 200)
    return () => clearInterval(id)
  }, [loading])

  const fetchAlertes = async (isRefresh = false) => {
    if (!apiFetch) {
      setError("apiFetch n'est pas disponible (verifier useAuth ou prop)")
      setLoading(false)
      return
    }
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    const ctrl = new AbortController()
    const tmo = setTimeout(() => ctrl.abort(), 60000)
    try {
      const res = await apiFetch(`${API}/pred/alertes`, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      const autoOpen = {}
      const urgs = (json.alertes || []).filter(a => a.urgence === 'URGENCE').slice(0, 2)
      urgs.forEach(a => { autoOpen[a.id] = true })
      setOpenCards(autoOpen)
    } catch (e) {
      if (e.name === 'AbortError') {
        setError('Le calcul a depasse 60s. Verifie le backend.')
      } else {
        setError(e.message)
      }
    } finally {
      clearTimeout(tmo)
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { fetchAlertes() }, [])

  const toggleCard = id => setOpenCards(prev => ({ ...prev, [id]: !prev[id] }))

  const filteredAlertes = useMemo(() => {
    if (!data?.alertes) return []
    if (filter === 'ALL') return data.alertes
    return data.alertes.filter(a => a.urgence === filter)
  }, [data, filter])

  const counts = useMemo(() => {
    const c = { URGENCE: 0, PLANIFIÉE: 0, SURVEILLANCE: 0, NORMALE: 0 }
    ;(data?.alertes || []).forEach(a => { c[a.urgence] = (c[a.urgence] || 0) + 1 })
    return c
  }, [data])

  if (loading) return (
    <div>
      <DebugPanel data={data} error={error} loading={loading} />
      <AlertesLoader elapsed={elapsed} />
    </div>
  )

  if (error) return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '20px 28px' }}>
      <DebugPanel data={data} error={error} loading={loading} />
      <div style={{
        background: '#FDECEA', border: '1px solid #C0392B55',
        borderRadius: 12, padding: 20, color: '#C0392B',
        maxWidth: 600, margin: '60px auto',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠ Erreur</div>
        <div style={{ fontSize: 13 }}>{error}</div>
        <div style={{ fontSize: 12, color: '#8A7D60', marginTop: 8 }}>
          Chargez un fichier via “OCP Fichiers” et vérifiez que le backend `/pred` est démarré.
        </div>
      </div>
    </div>
  )

  if (!data) return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '20px 28px' }}>
      <DebugPanel data={data} error={error} loading={loading} />
      <div style={{
        background: '#FFF8E1', border: '1px solid #C4760A',
        borderRadius: 12, padding: 20, color: '#2A2A1E',
        maxWidth: 600, margin: '60px auto',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: '#C4760A' }}>
          ⚠ Aucune donnee
        </div>
        <div style={{ fontSize: 13 }}>Le backend n'a renvoye aucune donnee.</div>
      </div>
    </div>
  )

  const urgenceGlobale = data?.urgence_globale || 'NORMALE'
  const uG = URG[urgenceGlobale] || URG.NORMALE
  return (
    <div style={{
      padding: '20px 28px',
      maxWidth: 1440,
      margin: '0 auto',
      color: '#2A2A1E',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: 12,
      boxSizing: 'border-box',
    }}>
      <DebugPanel data={data} error={error} loading={loading} />

      {/* ── Top bar : etat global + refresh ────────────────────────────── */}
      <div style={{
        background: uG.bg,
        border: `1px solid ${uG.accent}`,
        borderLeft: `4px solid ${uG.accent}`,
        borderRadius: 12, padding: '14px 20px', marginBottom: 16,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16, alignItems: 'center',
        boxSizing: 'border-box',
      }}>
        {/* Etat global */}
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 2,
            color: uG.fg, textTransform: 'uppercase',
          }}>
            Module 9 · Centre d'alertes
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: 24 }}>{uG.icon}</span>
            <div>
              <div style={{
                fontFamily: '"Rajdhani", system-ui, sans-serif', fontSize: 24,
                fontWeight: 800, color: uG.fg, lineHeight: 1,
              }}>
                Etat {uG.label.toLowerCase()}
              </div>
              <div style={{ fontSize: 11, color: '#8A7D60', marginTop: 2 }}>
                CAT 994F · {data?.nb_alertes || 0} alerte{(data?.nb_alertes || 0) !== 1 ? 's' : ''} active{(data?.nb_alertes || 0) !== 1 ? 's' : ''}
                {data?._cached !== undefined && (
                  <span style={{ marginLeft: 8 }}>
                    {data._cached ? (
                      <span style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 8,
                        background: '#EAF6EE', color: '#00843D',
                        fontWeight: 700, letterSpacing: 0.5,
                      }}>⚡ CACHE</span>
                    ) : (
                      <span style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 8,
                        background: '#F7F0DC', color: '#8C7012',
                        fontWeight: 700, letterSpacing: 0.5,
                      }}>📊 Isolation Forest</span>
                    )}
                    {data._timing && (
                      <span style={{ marginLeft: 6, color: '#B0A080' }}>
                        {data._timing.load_ms + data._timing.predict_ms}ms
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Refresh */}
        <button onClick={() => fetchAlertes(true)} disabled={refreshing} style={{
          background: '#FFFFFF', border: '1px solid #00843D55',
          borderRadius: 8, padding: '8px 16px',
          color: '#005C2B', fontSize: 12, fontWeight: 700,
          cursor: refreshing ? 'not-allowed' : 'pointer',
          opacity: refreshing ? 0.5 : 1, letterSpacing: 0.5,
          fontFamily: 'inherit',
        }}>
          {refreshing ? '…' : '↻ Actualiser'}
        </button>
      </div>

      {/* ── Filtres compteurs ──────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap',
      }}>
        <FilterChip label="Toutes" count={data?.alertes?.length || 0}
                    active={filter === 'ALL'}
                    onClick={() => setFilter('ALL')}
                    color={'#5A5240'} />
        {['URGENCE', 'PLANIFIÉE', 'SURVEILLANCE', 'NORMALE'].map(u => counts[u] > 0 && (
          <FilterChip key={u} label={URG[u].label} count={counts[u]}
                      active={filter === u}
                      onClick={() => setFilter(u)}
                      color={URG[u].accent} icon={URG[u].icon} />
        ))}
      </div>

      {/* ── Layout : Alertes (gauche) + Plan (droite) en flex ──────────── */}
      <div style={{
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
      }}>
        {/* Liste alertes */}
        <div style={{ flex: '1 1 600px', minWidth: 0, boxSizing: 'border-box' }}>
          {filteredAlertes.length === 0 && (
            <div style={{
              background: '#E8F5EE', border: '1px solid #00843D55',
              borderRadius: 12, padding: '24px 20px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#005C2B' }}>
                Aucune alerte {filter !== 'ALL' ? URG[filter]?.label.toLowerCase() : 'active'}
              </div>
              <div style={{ fontSize: 11, color: '#8A7D60', marginTop: 4 }}>
                Tous les capteurs sont dans leurs plages normales.
              </div>
            </div>
          )}
          {filteredAlertes.map((a, i) => (
            <AlerteCard key={a.id || i} alerte={a}
                        isOpen={!!openCards[a.id || i]}
                        onToggle={() => toggleCard(a.id || i)} />
          ))}
        </div>

        {/* Plan sticky */}
        <div style={{
          flex: '0 0 320px', maxWidth: 320, minWidth: 280,
          position: 'sticky', top: 12,
          boxSizing: 'border-box',
        }}>
          <PlanSticky plan={data?.plan_maintenance || data?.plan_intervention}
                      urgenceGlobale={urgenceGlobale} />

          {/* Legende niveaux */}
          <div style={{
            background: '#FFFFFF', border: '1px solid #D4C9B0',
            borderRadius: 12, padding: '10px 14px', marginTop: 12,
            fontSize: 11, color: '#5A5240',
            boxSizing: 'border-box',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
              color: '#005C2B', textTransform: 'uppercase', marginBottom: 6,
            }}>
              Niveaux d'urgence
            </div>
            {Object.values(URG).reverse().map(u => (
              <div key={u.label} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '3px 0', fontSize: 10,
              }}>
                <span style={{ color: u.fg, fontWeight: 700 }}>
                  {u.icon} {u.label}
                </span>
                <span style={{ color: '#8A7D60' }}>
                  {u.label === 'URGENCE' ? '< 2 h' :
                   u.label === 'PLANIFIÉE' ? '< 24 h' :
                   u.label === 'SURVEILLANCE' ? '< 1 sem.' : 'OK'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
