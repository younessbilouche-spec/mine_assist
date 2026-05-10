/**
 * NotificationsDrawer.jsx — Sprint 3 (mai 2026)
 * ==============================================
 * 
 * Cloche dans la topbar + panneau latéral droit pour voir les
 * alertes récentes (RED, drift, défauts détectés). Polling toutes les
 * 30 secondes vers /pred/rul/alert-class et /pred/rul/drift.
 * 
 * Branchement (TopBar.jsx ou App.jsx) :
 *   <NotificationsBell apiUrl={API_URL} pollMs={30000} />
 * 
 * Stockage :
 *   - localStorage 'mineassist_notifs_seen' : { id: timestamp }
 *   - Une notif "vue" n'est plus comptée dans le badge mais reste affichée.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'

const SEEN_KEY = 'mineassist_notifs_seen'
const MUTE_KEY = 'mineassist_notifs_muted'

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') } catch (_) { return {} }
}

function saveSeen(obj) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(obj)) } catch (_) {}
}

function isMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1' } catch (_) { return false }
}

function setMuted(v) {
  try { localStorage.setItem(MUTE_KEY, v ? '1' : '0') } catch (_) {}
}

// Convertit /pred/rul/alert-class + /pred/rul/drift en items de notification
function buildNotifs(alertData, driftData) {
  const out = []
  if (alertData?.alerte_active && alertData?.alerte_globale === 'RED') {
    out.push({
      id: `alert_red_${alertData.timestamp || ''}`,
      level: 'RED',
      title: 'Alerte critique RUL',
      detail: `RUL global ${(alertData?.rul_min_h || '?').toString()} h. ${alertData?.message || ''}`,
      time: new Date().toISOString(),
      action: { label: 'Voir prédiction', path: '/prediction' },
    })
  }
  if (alertData?.alerte_active && alertData?.alerte_globale === 'ORANGE') {
    out.push({
      id: `alert_orange_${alertData.timestamp || ''}`,
      level: 'ORANGE',
      title: 'Attention surveillance',
      detail: `RUL global ${(alertData?.rul_min_h || '?').toString()} h.`,
      time: new Date().toISOString(),
      action: { label: 'Voir prédiction', path: '/prediction' },
    })
  }
  if (driftData?.drift_detected) {
    out.push({
      id: `drift_${driftData.timestamp || ''}`,
      level: 'DRIFT',
      title: 'Dérive distribution capteurs',
      detail: `${driftData?.n_features_drifted || 0} feature(s) dérivent. PSI max ${(driftData?.psi_max ?? 0).toFixed(2)}.`,
      time: new Date().toISOString(),
      action: { label: 'Voir détails', path: '/explainability' },
    })
  }
  return out
}

const LEVEL_COLORS = {
  RED:    { bg: '#FEE7E0', fg: '#7A1F0E', dot: '#C0392B' },
  ORANGE: { bg: '#FFF3DD', fg: '#7A4F0A', dot: '#E58E26' },
  DRIFT:  { bg: '#FFF8E1', fg: '#7A5C00', dot: '#A07000' },
  INFO:   { bg: '#E5F0FB', fg: '#0F3D7A', dot: '#2A6FB8' },
}

export default function NotificationsBell({ apiUrl = '', pollMs = 30000 }) {
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState([])
  const [muted, setMutedState] = useState(isMuted())
  const seenRef = useRef(loadSeen())

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      if (!apiUrl) return
      try {
        const [alertR, driftR] = await Promise.all([
          fetch(`${apiUrl}/pred/rul/alert-class`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${apiUrl}/pred/rul/drift`).then(r => r.ok ? r.json() : null).catch(() => null),
        ])
        if (cancelled) return
        const arr = buildNotifs(alertR, driftR)
        setNotifs(arr)
      } catch (_) {}
    }
    poll()
    const id = setInterval(poll, pollMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [apiUrl, pollMs])

  const unseenCount = useMemo(
    () => notifs.filter(n => !seenRef.current[n.id]).length,
    [notifs]
  )

  const handleOpen = () => {
    setOpen(true)
    // Marque tout comme vu après 1 seconde
    setTimeout(() => {
      const seen = { ...seenRef.current }
      for (const n of notifs) seen[n.id] = Date.now()
      seenRef.current = seen
      saveSeen(seen)
      setNotifs(arr => [...arr])
    }, 1000)
  }

  const handleMute = () => {
    const m = !muted
    setMutedState(m)
    setMuted(m)
  }

  return (
    <>
      <button
        onClick={handleOpen}
        title="Notifications"
        aria-label="Notifications"
        style={{
          position: 'relative',
          width: 36, height: 36,
          background: 'transparent',
          border: '1px solid var(--border, #D4C9B0)',
          borderRadius: 6,
          cursor: 'pointer',
          color: 'var(--fg, #3A3025)',
          fontSize: 16,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ◔
        {unseenCount > 0 && !muted && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 18, height: 18, padding: '0 4px',
            background: '#C0392B', color: '#fff',
            borderRadius: 9, fontSize: 11, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--bg)',
          }}>{unseenCount}</span>
        )}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 9990,
          }}
        >
          <aside
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0,
              width: 'min(420px, 92vw)',
              background: 'var(--bg-elevated, #FFFFFF)',
              color: 'var(--fg)',
              boxShadow: '-8px 0 30px rgba(0,0,0,0.18)',
              borderLeft: '1px solid var(--border)',
              zIndex: 9991,
              display: 'flex', flexDirection: 'column',
              animation: 'mineassist-drawer 0.2s ease',
            }}
          >
            <style>{`
              @keyframes mineassist-drawer { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
            `}</style>
            <header style={{
              padding: '16px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>Notifications</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleMute}
                  title={muted ? 'Activer les notifications' : 'Couper les notifications'}
                  style={{
                    border: '1px solid var(--border)', background: 'transparent',
                    padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                    fontSize: 12, color: 'var(--fg-muted)',
                  }}
                >{muted ? '🔇' : '🔔'}</button>
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    border: '1px solid var(--border)', background: 'transparent',
                    padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                    fontSize: 12, color: 'var(--fg-muted)',
                  }}
                >Fermer</button>
              </div>
            </header>

            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {notifs.length === 0 ? (
                <div style={{
                  padding: '40px 20px', textAlign: 'center',
                  color: 'var(--fg-muted)', fontSize: 14,
                }}>
                  Aucune notification active.<br />
                  <small>Les alertes RED, dérive et anomalies apparaîtront ici automatiquement.</small>
                </div>
              ) : notifs.map(n => {
                const c = LEVEL_COLORS[n.level] || LEVEL_COLORS.INFO
                return (
                  <div key={n.id} style={{
                    padding: '12px 14px',
                    margin: '6px',
                    background: c.bg,
                    color: c.fg,
                    borderLeft: `4px solid ${c.dot}`,
                    borderRadius: 6,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <strong>{n.title}</strong>
                      <small style={{ opacity: 0.7 }}>{n.level}</small>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>{n.detail}</div>
                    {n.action && (
                      <div style={{ marginTop: 8 }}>
                        <a
                          href={`#${n.action.path}`}
                          onClick={() => setOpen(false)}
                          style={{
                            color: c.fg, fontWeight: 700, textDecoration: 'underline',
                            fontSize: 12,
                          }}
                        >{n.action.label} →</a>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <footer style={{
              padding: '10px 20px',
              borderTop: '1px solid var(--border)',
              fontSize: 11, color: 'var(--fg-subtle)',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Polling : {pollMs / 1000}s</span>
              <span>{notifs.length} actif{notifs.length > 1 ? 's' : ''}</span>
            </footer>
          </aside>
        </div>
      )}
    </>
  )
}
