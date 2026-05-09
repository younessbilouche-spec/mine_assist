import { useState } from 'react'
import { uploadOcpFile } from '../services/ocpApi'

const TAGS = [
  { icon:'⚙', label:'Maintenance' },
  { icon:'🚛', label:'Engin' },
  { icon:'🏭', label:'Usine' },
  { icon:'⚡', label:'Industrie' },
]

export default function OcpFilesPage({ apiFetch, onNavigate }) {
  const [file, setFile]         = useState(null)
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [uploaded, setUploaded] = useState(false)
  const [drag, setDrag]         = useState(false)
  const [activeTag, setActiveTag] = useState('Engin')

  function getErrorMessage(err) {
    if (!err) return 'Erreur de connexion — vérifiez que le backend `/pred` est démarré.'
    if (typeof err === 'string') return err
    if (err.message) return err.message
    try { return JSON.stringify(err) }
    catch { return String(err) }
  }

  function handleFileChange(e) {
    const f = e.target.files[0]
    if (f) { setFile(f); setResult(null); setUploaded(false); setError(null) }
  }

  function handleDrop(e) {
    e.preventDefault(); setDrag(false)
    const f = Array.from(e.dataTransfer.files).find(f => f.name.match(/\.xlsx?$/i))
    if (f) { setFile(f); setResult(null); setUploaded(false); setError(null) }
  }

  async function handleUpload() {
    if (!file) { setError('Sélectionnez un fichier .xlsx'); return }
    setLoading(true); setError(null)
    try {
      const data = await uploadOcpFile(apiFetch, file)
      setResult(data)
      setUploaded(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth:1180, margin:'0 auto', padding:'34px 28px', color:'#2A2A1E' }}>
      {/* Tags */}
      <div style={{ display:'flex', gap:10, marginBottom:28, justifyContent:'center', flexWrap:'wrap' }}>
        {TAGS.map(t => (
          <button key={t.label} onClick={() => setActiveTag(t.label)} className="badge"
            style={{ background: activeTag===t.label ? '#E8F5EE' : '#FFFDF8', color: activeTag===t.label ? '#00843D' : '#8A7D60', border:`1px solid ${activeTag===t.label ? '#00A84F66' : '#D4C9B0'}`, padding:'10px 20px', fontSize:14, fontWeight:700, borderRadius:10, boxShadow: activeTag===t.label ? '0 6px 18px rgba(0,132,61,0.10)' : 'none' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <h1 className="page-title" style={{ color:'#2A2A1E' }}>
        Fichiers Capteurs
        <span style={{ background:'#E8F5EE', border:'1px solid #00A84F55', color:'#00843D', borderRadius:99, padding:'6px 16px', fontSize:14, fontWeight:700, letterSpacing:'1px' }}>MAINTENANCE 4.0</span>
      </h1>
      <p className="page-subtitle" style={{ color:'#8A7D60' }}>Importez un seul fichier Excel capteurs; il alimente ensuite Défauts, Santé, Prédiction RUL et Alertes.</p>

      {error && <div style={{ background:'#FDECEA', border:'1px solid #C0392B55', borderRadius:10, padding:'12px 18px', color:'#C0392B', fontSize:13, marginBottom:24, fontWeight:600 }}>{error}</div>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:20 }}>
        {/* Machine image */}
        <div className="card" style={{ padding:32, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:320, background:'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(6,21,16,0.9))' }}>
          <img src="/chargeuse994F.png" alt="CAT 994F"
            style={{ width:'90%', maxWidth:380, filter:'drop-shadow(0 8px 32px rgba(34,197,94,0.25)) drop-shadow(0 0 2px rgba(0,0,0,0.8))', animation:'float 4s ease-in-out infinite' }} />
          <div style={{ marginTop:20, textAlign:'center' }}>
            <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:22, fontWeight:900, color:'#FFFFFF' }}>CHARGEUSE CAT 994F</div>
            <div style={{ fontSize:12, color:'#D9E8DB', marginTop:4 }}>Engin minier — OCP Mines de phosphates</div>
          </div>
        </div>

        {/* Drop zone */}
        <label className="card"
          onDragOver={e=>{e.preventDefault();setDrag(true)}}
          onDragLeave={()=>setDrag(false)}
          onDrop={handleDrop}
          style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:320, cursor:'pointer', padding:32, border: drag ? '2px dashed #00843D' : '2px dashed #D4C9B0', background: drag ? '#E8F5EE' : '#FFFFFF', transition:'all 0.2s', gap:16, boxShadow:'0 8px 24px rgba(42,42,30,0.06)' }}>
          <input type="file" accept=".xlsx,.xls" onChange={handleFileChange} style={{display:'none'}} />
          <div style={{ fontSize:52 }}>📁</div>
          <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:26, fontWeight:900, color: drag ? '#00843D' : '#2A2A1E' }}>
            {file ? file.name : 'Glissez votre fichier ici'}
          </div>
          <div style={{ fontSize:13, color:'#8A7D60', textAlign:'center' }}>
            {file ? `${(file.size/1024/1024).toFixed(2)} MB` : 'ou cliquez pour sélectionner • .xlsx, .xls'}
          </div>
          {file && !uploaded && (
            <button onClick={e=>{e.preventDefault();handleUpload()}} disabled={loading}
              className="btn btn-primary" style={{ marginTop:8 }}>
              {loading ? '⏳ Chargement...' : '↑ Uploader'}
            </button>
          )}
        </label>
      </div>

      {/* Résultat upload */}
      {result && (
        <div className="card" style={{ marginTop:20, overflow:'hidden', background:'#FFFFFF', border:'1px solid #D4C9B0' }}>
          <div style={{ padding:'14px 22px', borderBottom:'1px solid #D4C9B0', background:'#E8F5EE', display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:16 }}>✅</span>
            <span style={{ fontFamily:'Rajdhani, sans-serif', fontSize:18, fontWeight:700, color:'#00843D' }}>{result.filename}</span>
            <span className="badge badge-green" style={{ marginLeft:'auto' }}>Valide</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:0 }}>
            {[
              { label:'Points chargés', val: result.nb_points?.toLocaleString() },
              { label:'Date début',     val: result.date_debut?.slice(0,10) },
              { label:'Date fin',       val: result.date_fin?.slice(0,10) },
            ].map(({ label, val }) => (
              <div key={label} style={{ padding:'16px 22px', borderRight:'1px solid #D4C9B0', textAlign:'center' }}>
                <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:24, fontWeight:900, color:'#2A2A1E' }}>{val}</div>
                <div style={{ fontSize:11, color:'#8A7D60', marginTop:4 }}>{label}</div>
              </div>
            ))}
          </div>
          {result.label_counts && (
            <div style={{ padding:'12px 22px', borderTop:'1px solid #D4C9B0', display:'flex', gap:20, flexWrap:'wrap' }}>
              {Object.entries(result.label_counts).map(([label, count]) => {
                const color = label === 'Normal' ? '#22c55e' : label === 'Anomalie' ? '#ef4444' : '#f59e0b'
                return (
                  <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background:color }} />
                    <span style={{ fontSize:12, color:'#5A5240' }}>{label}: <strong style={{ color }}>{count?.toLocaleString()}</strong></span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Boutons action */}
      {uploaded && (
        <div style={{ display:'flex', gap:12, justifyContent:'center', marginTop:28 }}>
          <button onClick={() => onNavigate?.('ocp_defaut')} className="btn btn-outline">⚠ Analyser les défauts</button>
          <button onClick={() => onNavigate?.('ocp_sante')} className="btn btn-outline">❤ Santé engin</button>
          <button onClick={() => onNavigate?.('prediction')} className="btn btn-primary">📈 Prédiction RUL →</button>
        </div>
      )}

      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}`}</style>
    </div>
  )
}
