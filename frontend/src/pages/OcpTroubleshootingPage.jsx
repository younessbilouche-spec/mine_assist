import { useState, useEffect } from 'react'
import { getOcpTroubleshooting } from '../services/ocpApi'

function CauseAccordion({ item }) {
  const [open, setOpen] = useState(item.id === 1)
  return (
    <div className="accordion" style={{ borderColor: open ? 'rgba(34,197,94,0.25)' : undefined }}>
      <div className="accordion-header" onClick={() => setOpen(o => !o)}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:28, height:28, borderRadius:7, background: open ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color: open ? '#00843D' : '#B0A080', flexShrink:0, transition:'all 0.2s' }}>{item.id}</div>
          <span style={{ fontFamily:'Rajdhani, sans-serif', fontSize:18, fontWeight:700, color: open ? '#2A2A1E' : '#8A7D60' }}>{item.titre}</span>
        </div>
        <span style={{ color: open ? '#00843D' : '#B0A080', fontSize:14, transform: open ? 'rotate(180deg)' : 'none', display:'inline-block', transition:'all 0.2s' }}>▲</span>
      </div>
      {open && (
        <div className="accordion-body" style={{ paddingTop:16, display:'flex', flexDirection:'column', gap:14 }}>
          {item.recommandations?.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#00843D', marginBottom:8 }}>Recommandations</div>
              {item.recommandations.map((r, i) => (
                <div key={i} style={{ display:'flex', gap:10, marginBottom:6, alignItems:'flex-start' }}>
                  <span style={{ color:'#00843D', fontSize:12, flexShrink:0, marginTop:2 }}>→</span>
                  <span style={{ fontSize:13, color:'#8A7D60', lineHeight:1.6 }}>{r}</span>
                </div>
              ))}
            </div>
          )}
          {item.outils?.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#3b82f6', marginBottom:8 }}>Outils de vérification</div>
              {item.outils.map((o, i) => (
                <div key={i} style={{ display:'flex', gap:10, marginBottom:6, alignItems:'flex-start' }}>
                  <span style={{ color:'#3b82f6', fontSize:12, flexShrink:0, marginTop:2 }}>⚙</span>
                  <span style={{ fontSize:13, color:'#8A7D60', lineHeight:1.6 }}>{o}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function OcpTroubleshootingPage({ apiFetch, type, onBack }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    if (!type) {
      setError(true)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(false)
    getOcpTroubleshooting(apiFetch, type)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [apiFetch, type])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
      <div className="spinner" />
    </div>
  )

  if (error || !data) return (
    <div style={{ maxWidth:1100, margin:'0 auto', padding:'34px 28px', color:'#2A2A1E', textAlign:'center' }}>
      <div style={{ fontSize:32, marginBottom:12 }}>🔍</div>
      <div style={{ marginBottom:16, color:'#8A7D60' }}>Type de panne non trouvé</div>
      <button onClick={onBack} className="btn btn-primary">← Retour</button>
    </div>
  )

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', padding:'34px 28px', color:'#2A2A1E' }}>
      <button onClick={onBack} className="btn btn-outline" style={{ marginBottom:32, fontSize:12, padding:'7px 14px' }}>← Retour</button>

      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
        <div style={{ width:5, height:32, background:'#ef4444', borderRadius:99 }} />
        <h1 style={{ fontFamily:'Rajdhani, sans-serif', fontSize:36, fontWeight:900, color:'#2A2A1E' }}>{data.titre}</h1>
      </div>
      <p className="page-subtitle">{data.causes?.length} causes identifiées</p>

      <div style={{ background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:12, padding:'12px 18px', display:'flex', alignItems:'center', gap:10, marginBottom:28 }}>
        <span style={{ fontSize:18 }}>⚠</span>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color:'#ef4444', marginBottom:2 }}>PANNE PROBABLE DÉTECTÉE</div>
          <div style={{ fontSize:12, color:'#8A7D60' }}>Suivez les vérifications dans l'ordre</div>
        </div>
      </div>

      {data.causes?.map(c => <CauseAccordion key={c.id} item={c} />)}
    </div>
  )
}
