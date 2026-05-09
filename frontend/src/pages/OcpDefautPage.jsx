import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { getOcpDefautsAnalyse, getOcpSensorData } from '../services/ocpApi'

const CRIT_COLOR = { 1:'#ef4444', 2:'#f97316', 3:'#6b7280' }

function SensorChart({ apiFetch, col, thresholdMax, thresholdMin }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    getOcpSensorData(apiFetch, col, 300)
      .then(setData)
      .catch(() => setData(null))
  }, [apiFetch, col])

  if (!data) return <div style={{ padding:20, textAlign:'center', color:'#B0A080', fontSize:13 }}>Chargement...</div>

  const chartData = (data.data || []).map(r => ({ date: r.date?.slice(0, 16), value: r.value }))

  return (
    <div style={{ marginTop:12 }}>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(34,197,94,0.05)" />
          <XAxis dataKey="date" tick={{ fill:'#B0A080', fontSize:9 }} interval={Math.floor(chartData.length/5)} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill:'#B0A080', fontSize:9 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={v => [v?.toFixed(2), 'Valeur']} contentStyle={{ background:'#FFFDF8', border:'1px solid #D4C9B0', borderRadius:8, fontSize:12 }} />
          {thresholdMax && <ReferenceLine y={thresholdMax} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value:'Alarme', position:'right', fontSize:9, fill:'#ef4444' }} />}
          {thresholdMin && <ReferenceLine y={thresholdMin} stroke="#f97316" strokeDasharray="4 3" strokeOpacity={0.7} label={{ value:'Alarme', position:'right', fontSize:9, fill:'#f97316' }} />}
          <Line type="monotone" dataKey="value" stroke="#f5a623" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function Accordion({ apiFetch, sensor, color }) {
  const [open, setOpen] = useState(false)
  const pct = (sensor.over_max_pct || sensor.under_min_pct || 0).toFixed(2)
  return (
    <div className="accordion" style={{ borderColor: open ? color+'55' : undefined }}>
      <div className="accordion-header" onClick={() => setOpen(o => !o)}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:9, height:9, borderRadius:'50%', background:color, boxShadow:`0 0 7px ${color}`, flexShrink:0 }} />
          <span style={{ fontFamily:'Rajdhani, sans-serif', fontSize:18, fontWeight:700, color:'#2A2A1E' }}>{sensor.label}</span>
          <span style={{ fontSize:11, color:'#8A7D60' }}>{sensor.unit}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <span style={{ fontFamily:'Rajdhani, sans-serif', fontSize:22, fontWeight:900, color }}>{pct}%</span>
          <span style={{ color: open ? color : '#B0A080', transform: open ? 'rotate(180deg)' : 'none', display:'inline-block', transition:'all 0.2s', fontSize:14 }}>▲</span>
        </div>
      </div>
      {open && (
        <div className="accordion-body">
          <SensorChart
            apiFetch={apiFetch}
            col={sensor.sensor}
            thresholdMax={sensor.threshold_max}
            thresholdMin={sensor.threshold_min}
          />
        </div>
      )}
    </div>
  )
}

const SectionTitle = ({ label }) => (
  <div style={{ display:'flex', alignItems:'center', gap:10, margin:'28px 0 14px' }}>
    <span style={{ fontFamily:'Rajdhani, sans-serif', fontSize:10, fontWeight:700, letterSpacing:'2px', textTransform:'uppercase', color:'#C4760A' }}>{label}</span>
    <div style={{ flex:1, height:1, background:'#D4C9B0' }} />
  </div>
)

export default function OcpDefautPage({ apiFetch }) {
  const [analysis, setAnalysis] = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getOcpDefautsAnalyse(apiFetch)
      .then(setAnalysis)
      .catch((err) => {
        setError(err.message || "Impossible de charger l'analyse des défauts.")
        setAnalysis({ exceeds_max:[], exceeds_min:[], faulty_sensors:[], total_records:0 })
      })
      .finally(() => setLoading(false))
  }, [apiFetch])

  return (
    <div style={{ display:'flex', minHeight:'calc(100vh - 66px)' }}>
      {/* Panneau gauche */}
      <div style={{ width:280, flexShrink:0, borderRight:'1px solid #D4C9B0', padding:28, background:'#FFFDF8' }}>
        <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:22, fontWeight:900, color:'#2A2A1E', marginBottom:4 }}>CHARGEUSE 994F</div>
        <div style={{ fontSize:10, color:'#8A7D60', marginBottom:22, letterSpacing:'1px', textTransform:'uppercase' }}>Engin minier — OCP</div>

        <div style={{ background:'linear-gradient(135deg,rgba(34,197,94,0.06),rgba(6,21,16,0.95))', borderRadius:14, border:'1px solid #D4C9B0', padding:14, marginBottom:22, position:'relative', overflow:'hidden' }}>
          <img src="/chargeuse994F.png" alt="CAT 994F" style={{ width:'100%', borderRadius:8, filter:'drop-shadow(0 4px 12px rgba(0,0,0,0.7))' }} />
          <svg viewBox="0 0 260 160" width="100%" style={{ position:'absolute', top:0, left:0, pointerEvents:'none' }}>
            {(analysis?.exceeds_max?.length > 0) && <>
              <circle cx="158" cy="58" r="7" fill="#ef4444" opacity="0.95"/>
              <circle cx="158" cy="58" r="14" fill="#ef4444" opacity="0.18"/>
            </>}
            {(analysis?.exceeds_min?.length > 0) && <>
              <circle cx="120" cy="100" r="7" fill="#f97316" opacity="0.95"/>
              <circle cx="120" cy="100" r="14" fill="#f97316" opacity="0.18"/>
            </>}
            <circle cx="210" cy="145" r="7" fill="#22c55e" opacity="0.95"/>
            <circle cx="210" cy="145" r="14" fill="#22c55e" opacity="0.18"/>
          </svg>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:20 }}>
          {[
            { label:'Seuil MAX', val: analysis?.exceeds_max?.length || 0, color:'#ef4444' },
            { label:'Seuil MIN', val: analysis?.exceeds_min?.length || 0, color:'#f97316' },
            { label:'Défauts',   val: analysis?.faulty_sensors?.length || 0, color:'#6b7280' },
            { label:'Normal',    val: 6-(analysis?.exceeds_max?.length||0)-(analysis?.exceeds_min?.length||0), color:'#22c55e' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ background:'#FFFFFF', border:`1px solid ${color}22`, borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
              <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:26, fontWeight:900, color }}>{val}</div>
              <div style={{ fontSize:10, color:'#B0A080', marginTop:2 }}>{label}</div>
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px', textTransform:'uppercase', color:'#B0A080', marginBottom:10 }}>Légende</div>
          {[
            { color:'#22c55e', label:'Aucun défaut détecté' },
            { color:'#ef4444', label:'Criticité 1 — Critique' },
            { color:'#f97316', label:'Criticité 2 — Attention' },
            { color:'#6b7280', label:'Criticité 3 — Info' },
          ].map(({ color, label }) => (
            <div key={color} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
              <div style={{ width:9, height:9, borderRadius:'50%', background:color, boxShadow:`0 0 6px ${color}55`, flexShrink:0 }} />
              <span style={{ fontSize:11, color:'#8A7D60' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Panneau droit */}
      <div style={{ flex:1, padding:32, overflowY:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <h1 style={{ fontFamily:'Rajdhani, sans-serif', fontSize:36, fontWeight:900, color:'#2A2A1E' }}>Détection des Défauts</h1>
          <span style={{ fontSize:12, color:'#B0A080' }}>{analysis?.total_records?.toLocaleString() || 0} enregistrements</span>
        </div>
        {error && (
          <div style={{ background:'#FDECEA', border:'1px solid #C0392B55', color:'#C0392B', borderRadius:10, padding:'12px 16px', marginBottom:18, fontSize:13, fontWeight:600 }}>
            {error} — chargez d'abord un fichier Excel dans “OCP Fichiers” et vérifiez que le backend `/pred` est démarré.
          </div>
        )}
        {loading && (
          <div style={{ background:'#FFF8E1', border:'1px solid #C4760A55', color:'#C4760A', borderRadius:10, padding:'12px 16px', marginBottom:18, fontSize:13, fontWeight:600 }}>
            Chargement optimisé en cours...
          </div>
        )}

        <SectionTitle label="Capteurs dépassant le seuil Maximum" />
        {!analysis?.exceeds_max?.length
          ? <div style={{ textAlign:'center', padding:'20px 0', color:'#B0A080', fontSize:13 }}>✓ Aucun dépassement de seuil maximum</div>
          : analysis.exceeds_max.map(s => <Accordion key={s.sensor} apiFetch={apiFetch} sensor={s} color={CRIT_COLOR[s.criticality] || '#ef4444'} />)
        }

        <SectionTitle label="Capteurs dépassant le seuil Minimum" />
        {!analysis?.exceeds_min?.length
          ? <div style={{ textAlign:'center', padding:'20px 0', color:'#B0A080', fontSize:13 }}>✓ Aucun dépassement de seuil minimum</div>
          : analysis.exceeds_min.map(s => <Accordion key={s.sensor} apiFetch={apiFetch} sensor={s} color={CRIT_COLOR[s.criticality] || '#f97316'} />)
        }

        {analysis?.faulty_sensors?.length > 0 && <>
          <SectionTitle label="Capteurs présentant des défauts" />
          {analysis.faulty_sensors.map(s => <Accordion key={s.sensor} apiFetch={apiFetch} sensor={s} color="#6b7280" />)}
        </>}
      </div>
    </div>
  )
}
