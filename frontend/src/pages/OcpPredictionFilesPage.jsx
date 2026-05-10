export default function OcpPredictionFilesPage({ onNavigate }) {
  return (
    <div style={{ maxWidth:900, margin:'0 auto', padding:'60px 28px', color:'#2A2A1E', textAlign:'center' }}>
      <div style={{ fontSize:44, marginBottom:14 }}>📊</div>
      <h1 style={{ fontFamily:'Rajdhani, sans-serif', fontSize:42, margin:'0 0 10px', color:'#2A2A1E' }}>
        Données RUL
      </h1>
      <p style={{ color:'#8A7D60', fontSize:16, lineHeight:1.6, maxWidth:680, margin:'0 auto 24px' }}>
        Cette page était redondante: le même fichier Excel est déjà importé dans “OCP Fichiers”.
        Utilisez “OCP Fichiers”, puis lancez directement “Prédiction RUL”.
      </p>
      <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
        <button onClick={() => onNavigate?.('ocp_upload')} className="btn btn-primary">📁 Aller à OCP Fichiers</button>
        <button onClick={() => onNavigate?.('prediction')} className="btn btn-outline">🔮 Voir Prédiction RUL</button>
      </div>
    </div>
  )
}
