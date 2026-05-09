import { useState, useEffect } from 'react'
import { API } from '../config'

function scoreToColor(score) {
  if (score >= 90) return '#22c55e'
  if (score >= 75) return '#84cc16'
  if (score >= 55) return '#f59e0b'
  if (score >= 30) return '#ef4444'
  return '#7c3aed'
}

function scoreToTruckColor(score) {
  if (score >= 75) return 'green'
  if (score >= 55) return 'orange'
  return 'red'
}

const GLOW_MAP = {
  green:  'rgba(34,197,94,0.25)',
  orange: 'rgba(249,115,22,0.25)',
  red:    'rgba(239,68,68,0.25)',
}

export default function OcpHealthPage({ apiFetch, onNavigate }) {
  const [health,    setHealth]    = useState(null)
  const [capteurs,  setCapteurs]  = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    const fetcher = apiFetch || fetch
    fetcher(`${API}/pred/health?include_capteurs=true`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(h => { setHealth(h); setCapteurs(h.capteurs || []) })
      .catch(() => setHealth(null))
      .finally(() => setLoading(false))
  }, [apiFetch])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
      <div className="spinner" />
    </div>
  )

  if (!health) return (
    <div style={{ maxWidth:900, margin:'0 auto', padding:'60px 28px', color:'#2A2A1E', textAlign:'center' }}>
      <div style={{ fontSize:32, marginBottom:12 }}>⚠</div>
      <div style={{ color:'#8A7D60', marginBottom:16 }}>Aucun fichier chargé ou backend `/pred` indisponible — uploadez d'abord vos données.</div>
      <button onClick={() => onNavigate?.('ocp_upload')} className="btn btn-primary">Uploader un fichier</button>
    </div>
  )

  const score      = health.score ?? 0
  const tColor     = scoreToTruckColor(score)
  const mainColor  = scoreToColor(score)
  const tGlow      = GLOW_MAP[tColor] || GLOW_MAP.green

  return (
    <div style={{ maxWidth:1180, margin:'0 auto', padding:'34px 28px', color:'#2A2A1E' }}>
      <h1 className="page-title">Indicateur Santé de l'Engin</h1>
      <p className="page-subtitle">CHARGEUSE 994F — Évaluation sur les dernières {health.fenetre_heures}h</p>

      {/* Carte principale */}
      <div className="card" style={{ padding:'40px 32px', marginBottom:28, textAlign:'center', border:`1px solid ${mainColor}28`, boxShadow:`0 0 50px ${tGlow}` }}>
        {/* Score circulaire */}
        <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:80, fontWeight:900, color:mainColor, lineHeight:1, marginBottom:4, textShadow:`0 0 32px ${mainColor}60` }}>
          {score.toFixed(0)}
        </div>
        <div style={{ fontSize:13, color:'#8A7D60', marginBottom:20, letterSpacing:'2px', textTransform:'uppercase' }}>/ 100 — {health.label}</div>

        {/* Image machine */}
        <div style={{ position:'relative', width:'100%', maxWidth:400, margin:'0 auto 28px' }}>
          <img src="/chargeuse994F.png" alt="CAT 994F"
            style={{ width:'100%', filter:`drop-shadow(0 0 28px ${tGlow}) drop-shadow(0 4px 14px rgba(0,0,0,0.8))` }} />
          <div style={{ position:'absolute', inset:0, background:`radial-gradient(ellipse at 60% 40%, ${mainColor}14 0%, transparent 65%)`, pointerEvents:'none', borderRadius:12 }} />
          <div style={{ position:'absolute', bottom:8, right:12, background:`${mainColor}22`, border:`1px solid ${mainColor}55`, borderRadius:99, padding:'4px 12px', fontSize:12, fontWeight:700, color:mainColor }}>
            {health.label}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display:'flex', justifyContent:'center', gap:40 }}>
          {[
            { label:'Points critiques',  val: health.points_critiques, color:'#7c3aed' },
            { label:'Points anomalie',   val: health.points_anomalie,  color:'#ef4444' },
            { label:'Points analysés',   val: health.nb_points?.toLocaleString(), color:'#8A7D60' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ textAlign:'center' }}>
              <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:36, fontWeight:900, color, lineHeight:1 }}>{val}</div>
              <div style={{ fontSize:11, color:'#8A7D60', marginTop:4 }}>{label}</div>
            </div>
          ))}
        </div>

        {score >= 90 && (
          <div style={{ marginTop:20, background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.25)', borderRadius:10, padding:'10px 20px', display:'inline-block', fontSize:13, color:'#22c55e', fontWeight:600 }}>
            ✓ Tous les paramètres sont dans les limites normales
          </div>
        )}
      </div>

      {/* Scores par capteur */}
      {capteurs.length > 0 && (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ padding:'14px 24px', borderBottom:'1px solid #D4C9B0', background:'rgba(34,197,94,0.03)' }}>
            <span style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#B0A080' }}>Score par capteur (dernières 24h)</span>
          </div>
          {capteurs.map((c, i) => {
            const col = scoreToColor(c.score)
            return (
              <div key={c.col} style={{ padding:'16px 24px', borderBottom: i < capteurs.length-1 ? '1px solid #D4C9B0' : 'none', display:'flex', alignItems:'center', gap:16 }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:col, boxShadow:`0 0 6px ${col}`, flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'#2A2A1E' }}>{c.label}</div>
                  <div style={{ fontSize:11, color:'#B0A080' }}>{c.unit} — dernière valeur : {c.derniere_valeur?.toFixed(1)}</div>
                </div>
                {/* Barre de score */}
                <div style={{ width:200, height:6, background:'rgba(255,255,255,0.07)', borderRadius:99, overflow:'hidden' }}>
                  <div style={{ width:`${c.score}%`, height:'100%', background:col, borderRadius:99, transition:'width 0.6s' }} />
                </div>
                <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:20, fontWeight:900, color:col, minWidth:48, textAlign:'right' }}>
                  {c.score.toFixed(0)}
                </div>
                <div style={{ fontSize:11, color:'#B0A080', minWidth:60 }}>{c.etat}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
