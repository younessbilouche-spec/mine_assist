/**
 * PredictionPage.jsx — Refonte complète v4
 * Maintenance Prédictive RUL · CAT 994F1 · OCP Benguerir
 * Endpoints : /pred/rul/status + /pred/rul/predict/demo + /pred/rul/predict
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { C } from "../config"
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { API } from '../config'



const SUBSYSTEMS = [
  { key:'global_grav2', label:'RUL Global',    icon:'⚙️', desc:'Toutes anomalies grav. ≥ 2' },
  { key:'moteur',       label:'Moteur',         icon:'🔧', desc:'Sous-système moteur' },
  { key:'transmission', label:'Transmission',   icon:'⚡', desc:'Convertisseur + embrayages' },
  { key:'hydraulique',  label:'Hydraulique',    icon:'💧', desc:'Circuit huile + direction' },
]

const SENSORS = [
  { key:'engine_rpm',        label:'Régime moteur',         unit:'tr/min', sous:'Moteur',       max:2100 },
  { key:'converter_out_temp',label:'Temp. convertisseur',   unit:'°C',     sous:'Transmission', max:129  },
  { key:'rear_axle_temp',    label:'Temp. essieux arrière', unit:'°C',     sous:'Essieux',      max:90   },
  { key:'brake_oil_temp',    label:'Temp. huile freinage',  unit:'°C',     sous:'Freinage',     max:110  },
  { key:'air_tank_pressure', label:'Pression air',          unit:'kPa',    sous:'Pneumatique',  min:400  },
  { key:'steering_oil_temp', label:'Temp. huile direction', unit:'°C',     sous:'Direction',    max:95   },
]

// ─── Métriques ML réelles (pipeline R v5) ──────────────────────────────────
// Note : la prédiction supervisée du RUL (XGBoost) a été étudiée et écartée
// (AUC ≈ 0.51 avec 11 mois / 30 pannes critiques). Les métriques ci-dessous
// correspondent au pipeline industriel Health Score + Isolation Forest + K-Means.
const MODEL_METRICS = [
  { label:'Health Score moyen',   value:'54.3',    desc:'/ 100 sur 11 mois' },
  { label:'Temps en alerte',      value:'82.5%',   desc:'Score < 70 (surveillance)' },
  { label:'Anomalies IF',         value:'2 197',   desc:'sur 43 929 mesures (5%)' },
  { label:'Dataset',              value:'43 929',  desc:'Horodatages × 11 capteurs' },
  { label:'Entraînement',         value:'11 mois', desc:'Janv → Déc 2025' },
  { label:'Approche',             value:'R v5',    desc:'IF + K-Means + Health Score' },
]

const alertClass = rul => rul==null?'UNKNOWN':rul<24?'RED':rul<72?'ORANGE':'GREEN'

const ALERT = {
  RED:    { color:C.red,    bg:C.redPale,    border:'#FCA5A5', label:'ALERTE CRITIQUE', emoji:'🔴', short:'Critique', msg:'Panne probable < 24h — Intervention immédiate' },
  ORANGE: { color:C.orange, bg:C.orangePale, border:'#FDE68A', label:'SURVEILLANCE',    emoji:'🟠', short:'Attention', msg:'Surveiller — Panne 24-72h — Planifier maintenance' },
  GREEN:  { color:C.green,  bg:C.greenPale,  border:'#86EFAC', label:'NOMINAL',         emoji:'🟢', short:'Normal',   msg:'Aucune panne prévue dans les 72 prochaines heures' },
  UNKNOWN:{ color:C.textMuted, bg:'#F3F4F6', border:'#D1D5DB', label:'N/A',            emoji:'⚪', short:'—',        msg:'Chargez un fichier Excel pour analyser' },
}

const fmtH = h => h==null?'—':h<24?`${Math.round(h)}h`:`${(h/24).toFixed(1)}j`

function RulRing({ rul, size=150 }) {
  const alert = alertClass(rul)
  const cfg = ALERT[alert]
  const pct = rul==null?0:Math.min(1,rul/168)
  const r = size/2-13, circ = 2*Math.PI*r
  const cx=size/2, cy=size/2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E5E7EB" strokeWidth={13}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={cfg.color} strokeWidth={13}
        strokeDasharray={`${(pct*circ).toFixed(2)} ${circ.toFixed(2)}`}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
        style={{transition:'stroke-dasharray 1s ease,stroke 0.4s'}}/>
      <text x={cx} y={cy-8} textAnchor="middle"
        fontSize={rul==null?16:rul<100?26:20} fontWeight={800} fill={cfg.color}
        fontFamily="Rajdhani,system-ui">{rul==null?'—':fmtH(rul)}</text>
      <text x={cx} y={cy+9} textAnchor="middle" fontSize={9} fill={C.textMuted} fontFamily="system-ui">avant panne</text>
      <text x={cx} y={cy+24} textAnchor="middle" fontSize={10} fontWeight={700} fill={cfg.color}
        fontFamily="system-ui" letterSpacing={1}>{cfg.short.toUpperCase()}</text>
    </svg>
  )
}

function SubsysBar({ subsys, rul }) {
  const cfg = ALERT[alertClass(rul)]
  const pct = rul==null?0:Math.min(100,(rul/168)*100)
  return (
    <div style={{marginBottom:13}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <span style={{fontSize:15}}>{subsys.icon}</span>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:C.text,fontFamily:'Rajdhani,system-ui'}}>{subsys.label}</div>
            <div style={{fontSize:10,color:C.textMuted}}>{subsys.desc}</div>
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:17,fontWeight:800,color:cfg.color,fontFamily:'Rajdhani,system-ui',lineHeight:1}}>{fmtH(rul)}</div>
          <div style={{fontSize:9,fontWeight:700,color:cfg.color,background:cfg.bg,padding:'1px 5px',borderRadius:3,marginTop:2,letterSpacing:1}}>{cfg.short.toUpperCase()}</div>
        </div>
      </div>
      <div style={{height:6,background:'#E5E7EB',borderRadius:99,overflow:'hidden'}}>
        <div style={{width:`${pct}%`,height:'100%',background:cfg.color,borderRadius:99,transition:'width 1s ease'}}/>
      </div>
    </div>
  )
}

function SensorRow({ sensor }) {
  return (
    <tr style={{borderBottom:`1px solid ${C.borderLight}`}}>
      <td style={{padding:'10px 14px',width:6,paddingRight:0}}>
        <div style={{width:3,height:28,borderRadius:2,background:C.green}}/>
      </td>
      <td style={{padding:'10px 14px'}}>
        <div style={{fontSize:13,fontWeight:700,color:C.text,fontFamily:'Rajdhani,system-ui'}}>{sensor.label}</div>
        <div style={{fontSize:10,color:C.textMuted}}>{sensor.sous}</div>
      </td>
      <td style={{padding:'10px 14px',textAlign:'right'}}>
        <span style={{fontSize:18,fontWeight:800,color:C.textMuted,fontFamily:'Rajdhani,system-ui'}}>—</span>
        <span style={{fontSize:10,color:C.textMuted,marginLeft:3}}>{sensor.unit}</span>
      </td>
      <td style={{padding:'10px 14px',textAlign:'right',fontSize:11,color:C.textMuted}}>
        {sensor.max?<span style={{color:C.red}}>≤ {sensor.max}</span>:
         sensor.min?<span style={{color:C.green}}>≥ {sensor.min}</span>:'—'}
      </td>
      <td style={{padding:'10px 20px 10px 14px',width:'28%'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{flex:1,height:5,background:'#E5E7EB',borderRadius:99}}/>
          <span style={{fontSize:10,color:C.textMuted,minWidth:28,textAlign:'right'}}>—</span>
        </div>
      </td>
    </tr>
  )
}

function ChartTip({ active, payload, label }) {
  if (!active||!payload?.length) return null
  return (
    <div style={{background:'#FFF',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:11,boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
      <div style={{color:C.textMuted,marginBottom:4,fontSize:10}}>{label}</div>
      {payload.map((p,i)=><div key={i} style={{color:p.color,fontWeight:700}}>{p.name}: {p.value?.toFixed(0)}h</div>)}
    </div>
  )
}

function HistoryChart({ data }) {
  if (!data?.length) return null
  const d = data.map(p=>({date:String(p.date).slice(5,10),rul:parseFloat(p.rul_h)||0}))
  return (
    <ResponsiveContainer width="100%" height={175}>
      <AreaChart data={d} margin={{top:8,right:20,left:0,bottom:0}}>
        <defs>
          <linearGradient id="G" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={C.green} stopOpacity={0.25}/>
            <stop offset="95%" stopColor={C.green} stopOpacity={0.02}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={C.borderLight} vertical={false}/>
        <XAxis dataKey="date" tick={{fontSize:9,fill:C.textMuted}} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
        <YAxis tick={{fontSize:9,fill:C.textMuted}} tickLine={false} axisLine={false} unit="h" width={30}/>
        <Tooltip content={<ChartTip/>}/>
        <ReferenceLine y={24} stroke={C.red} strokeDasharray="4 2" strokeWidth={1.2}
          label={{value:'24h',position:'right',fontSize:9,fill:C.red}}/>
        <ReferenceLine y={72} stroke={C.orange} strokeDasharray="4 2" strokeWidth={1.2}
          label={{value:'72h',position:'right',fontSize:9,fill:C.orange}}/>
        <Area type="monotone" dataKey="rul" name="RUL" stroke={C.green} strokeWidth={2} fill="url(#G)" dot={false}/>
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Page principale ─────────────────────────────────────────────────────────
export default function PredictionPage({ apiFetch }) {
  const fetcher = apiFetch || ((...a)=>fetch(...a))
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [uploading,   setUploading]   = useState(false)
  const [error,       setError]       = useState(null)
  const [modelStatus, setModelStatus] = useState(null)
  const [uploadMsg,   setUploadMsg]   = useState(null)
  const fileRef = useRef(null)

  // Charge en priorité les données du fichier capteurs courant (uploadé via OcpFilesPage).
  // Si aucun fichier courant, fallback sur la prédiction démo synthétique.
  // Cela résout le bug critique de "déconnexion" entre OCP files et Prediction.
  const reloadCurrent = useCallback(() => {
    setLoading(true)
    setError(null)
    fetcher(`${API}/pred/rul/predict/current`)
      .then(r => {
        if (r.status === 404) return { _noFile: true }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(j => {
        if (j?._noFile) {
          // Aucun fichier courant : fallback démo
          return fetcher(`${API}/pred/rul/predict/demo`)
            .then(r => r.json())
            .then(d => { setData({ ...d, _demo: true }); setError(null) })
        }
        setData(j); setError(null)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetcher(`${API}/pred/rul/status`).then(r=>r.ok?r.json():null).then(setModelStatus).catch(()=>{})
    reloadCurrent()
  }, [reloadCurrent])

  const handleUpload = useCallback(async file => {
    if (!file) return
    setUploading(true); setUploadMsg(null); setError(null)
    try {
      const form = new FormData(); form.append('file', file)
      const r = await fetcher(`${API}/pred/rul/predict`,{method:'POST',body:form})
      if (!r.ok){const e=await r.json();throw new Error(e.detail||`HTTP ${r.status}`)}
      const j = await r.json()
      setData(j)
      setUploadMsg(`✓ ${j.nb_points??'?'} points analysés`)
    } catch(e){setError(e.message)}
    finally{setUploading(false)}
  }, [])

  const rul = data?.rul_heures || {}
  const alert = data?.alerte_globale || 'UNKNOWN'
  const alertCfg = ALERT[alert] || ALERT.UNKNOWN
  const history = data?.historique || []
  const isoF = data?.isolation_forest
  const period = data?.periode
  const isDemo = data?._demo === true
  const alertProba = data?.alert_proba || {}

  return (
    <div style={{padding:'22px 26px',fontFamily:'system-ui,-apple-system,sans-serif',color:C.text,fontSize:13,boxSizing:'border-box'}}>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .rc{animation:fadeUp .4s ease both}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {/* HEADER */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:14,marginBottom:20}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:5}}>
            <div style={{background:C.green,color:'#fff',padding:'3px 12px',fontSize:10,fontWeight:800,
              letterSpacing:3,textTransform:'uppercase',
              clipPath:'polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%)'}}>
              OCP · RUL PRÉDICTIF
            </div>
            {isDemo&&<span style={{fontSize:10,fontWeight:700,color:C.orange,background:C.orangePale,
              padding:'2px 8px',borderRadius:4,border:`1px solid ${C.orange}40`}}>
              MODE DÉMO — uploadez un fichier pour les vraies données
            </span>}
            {data?.source==='current_file'&&<span style={{fontSize:10,fontWeight:700,color:C.green,background:C.greenPale,
              padding:'2px 8px',borderRadius:4,border:`1px solid ${C.green}40`}}>
              ✓ FICHIER CAPTEURS COURANT · {data.nb_points} points
            </span>}
          </div>
          <h1 style={{margin:0,fontSize:25,fontWeight:900,fontFamily:'Rajdhani,system-ui',letterSpacing:0.5,color:C.text}}>
            Maintenance Prédictive · CAT 994F1
          </h1>
          {period&&<div style={{fontSize:11,color:C.textMuted,marginTop:3}}>
            Période : {period.debut?.slice(0,10)} → {period.fin?.slice(0,10)}
          </div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          {uploadMsg&&<span style={{fontSize:11,color:C.green,fontWeight:700}}>{uploadMsg}</span>}
          {error&&<span style={{fontSize:11,color:C.red}}>⚠ {error}</span>}
          <button onClick={reloadCurrent} disabled={loading} title="Recharger depuis le fichier capteurs courant" style={{
            background:'transparent',color:C.green,border:`1px solid ${C.green}`,
            padding:'8px 14px',fontSize:11,fontWeight:700,letterSpacing:1.5,
            cursor:loading?'not-allowed':'pointer',fontFamily:'system-ui',
            textTransform:'uppercase',borderRadius:4,
          }}>
            ↻ Fichier courant
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{display:'none'}}
            onChange={e=>handleUpload(e.target.files?.[0])}/>
          <button onClick={()=>fileRef.current?.click()} disabled={uploading} style={{
            background:uploading?C.textMuted:C.green,color:'#fff',border:'none',
            padding:'10px 22px',fontSize:12,fontWeight:700,letterSpacing:2,
            cursor:uploading?'not-allowed':'pointer',fontFamily:'Rajdhani,system-ui',
            textTransform:'uppercase',
            clipPath:'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)',
            transition:'background 0.2s',
          }}>
            {uploading?'⏳ Analyse…':'📁 Charger fichier Excel'}
          </button>
        </div>
      </div>

      {/* LOADING */}
      {loading&&(
        <div style={{display:'flex',alignItems:'center',gap:14,color:C.textMuted,padding:'50px 0'}}>
          <div style={{width:28,height:28,border:`3px solid ${C.greenPale}`,borderTopColor:C.green,
            borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
          <span style={{fontFamily:'Rajdhani,system-ui',fontSize:16,fontWeight:600}}>Chargement modèles ML…</span>
        </div>
      )}

      {!loading&&data&&(
        <>
          {/* LIGNE 1 : ALERTE + GAUGE + SOUS-SYSTÈMES + PROBAS */}
          <div className="rc" style={{display:'flex',gap:14,flexWrap:'wrap',marginBottom:14}}>

            {/* Bandeau alerte */}
            <div style={{flex:'0 0 210px',minWidth:190,background:alertCfg.bg,
              border:`2px solid ${alertCfg.border}`,borderRadius:14,padding:'18px 20px',
              display:'flex',flexDirection:'column',justifyContent:'center',
              boxShadow:alert==='RED'?`0 0 28px ${C.red}18`:'none'}}>
              <div style={{fontSize:34,marginBottom:8}}>{alertCfg.emoji}</div>
              <div style={{fontSize:13,fontWeight:800,letterSpacing:2,color:alertCfg.color,
                textTransform:'uppercase',marginBottom:6}}>{alertCfg.label}</div>
              <div style={{fontSize:11,color:C.textMid,lineHeight:1.6}}>{alertCfg.msg}</div>
            </div>

            {/* Gauge RUL global */}
            <div style={{flex:'0 0 174px',minWidth:160,background:C.card,
              border:`1px solid ${C.border}`,borderRadius:14,padding:'14px 10px',
              display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
              <div style={{fontSize:10,fontWeight:700,color:C.textMuted,letterSpacing:1.5,
                textTransform:'uppercase',marginBottom:8,textAlign:'center'}}>
                Durée de vie restante
              </div>
              <RulRing rul={rul.global_grav2} size={136}/>
            </div>

            {/* RUL sous-systèmes */}
            <div style={{flex:1,minWidth:250,background:C.card,border:`1px solid ${C.border}`,
              borderRadius:14,padding:'16px 18px'}}>
              <div style={{fontSize:10,fontWeight:700,color:C.textMuted,letterSpacing:1.5,
                textTransform:'uppercase',marginBottom:14}}>RUL par sous-système</div>
              {SUBSYSTEMS.map(s=><SubsysBar key={s.key} subsys={s} rul={rul[s.key]}/>)}
            </div>

            {/* Probas RF + Isolation Forest */}
            <div style={{flex:'0 0 210px',minWidth:190,display:'flex',flexDirection:'column',gap:12}}>
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,
                padding:'16px 16px',flex:1}}>
                <div style={{fontSize:10,fontWeight:700,color:C.textMuted,letterSpacing:1.5,
                  textTransform:'uppercase',marginBottom:12}}>Probabilité classe (RF)</div>
                {['RED','ORANGE','GREEN'].map(cls=>{
                  const p=alertProba[cls]??0; const cfg=ALERT[cls]
                  return(
                    <div key={cls} style={{marginBottom:10}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                        <span style={{fontSize:11,fontWeight:600,color:cfg.color}}>{cfg.emoji} {cls}</span>
                        <span style={{fontSize:13,fontWeight:800,color:cfg.color,fontFamily:'Rajdhani,system-ui'}}>
                          {(p*100).toFixed(0)}%
                        </span>
                      </div>
                      <div style={{height:5,background:'#E5E7EB',borderRadius:99}}>
                        <div style={{width:`${p*100}%`,height:'100%',background:cfg.color,
                          borderRadius:99,transition:'width 0.8s ease'}}/>
                      </div>
                    </div>
                  )
                })}
              </div>
              {isoF&&(
                <div style={{background:isoF.is_anomaly?C.redPale:C.greenPale,
                  border:`1px solid ${isoF.is_anomaly?'#FCA5A5':'#86EFAC'}`,
                  borderRadius:10,padding:'10px 14px',
                  display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:C.textMuted,letterSpacing:1,textTransform:'uppercase'}}>Isolation Forest</div>
                    <div style={{fontSize:10,color:C.textMid,marginTop:2}}>Score : {isoF.score?.toFixed(3)??'—'}</div>
                  </div>
                  <div style={{fontSize:12,fontWeight:800,color:isoF.is_anomaly?C.red:C.green}}>
                    {isoF.is_anomaly?'⚠ ANOMALIE':'✓ NORMAL'}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* LIGNE 2 : GRAPHIQUE + MÉTRIQUES MODÈLE */}
          <div className="rc" style={{display:'flex',gap:14,flexWrap:'wrap',marginBottom:14,animationDelay:'0.1s'}}>
            <div style={{flex:2,minWidth:300,background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:'16px 18px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:700,color:C.textMuted,letterSpacing:1.5,textTransform:'uppercase'}}>
                  Évolution du RUL global
                </div>
                <div style={{display:'flex',gap:14,fontSize:10}}>
                  <span style={{color:C.red,fontWeight:700}}>━ Critique &lt;24h</span>
                  <span style={{color:C.orange,fontWeight:700}}>━ Attention &lt;72h</span>
                </div>
              </div>
              {history.length>0?<HistoryChart data={history}/>:(
                <div style={{height:175,display:'flex',alignItems:'center',justifyContent:'center',
                  color:C.textMuted,fontSize:12,flexDirection:'column',gap:8}}>
                  <span style={{fontSize:28}}>📊</span>
                  <span>Uploadez un fichier Excel pour afficher l'historique réel</span>
                </div>
              )}
            </div>
            <div style={{flex:'0 0 190px',minWidth:175,background:C.card,border:`1px solid ${C.border}`,
              borderRadius:14,padding:'16px 16px'}}>
              <div style={{fontSize:10,fontWeight:700,color:C.textMuted,letterSpacing:1.5,textTransform:'uppercase',marginBottom:12}}>
                Performance modèle
              </div>
              {MODEL_METRICS.map(m=>(
                <div key={m.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                  padding:'7px 0',borderBottom:`1px solid ${C.borderLight}`}}>
                  <div>
                    <div style={{fontSize:11,color:C.textMid,fontWeight:600}}>{m.label}</div>
                    <div style={{fontSize:9,color:C.textMuted}}>{m.desc}</div>
                  </div>
                  <div style={{fontSize:14,fontWeight:800,color:C.green,fontFamily:'Rajdhani,system-ui'}}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* LIGNE 3 : TABLEAU CAPTEURS */}
          <div className="rc" style={{background:C.card,border:`1px solid ${C.border}`,
            borderRadius:14,overflow:'hidden',animationDelay:'0.2s'}}>
            <div style={{padding:'12px 18px',background:C.greenPale,borderBottom:`1px solid ${C.border}`,
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:10,fontWeight:700,color:C.greenDark,letterSpacing:1.5,textTransform:'uppercase'}}>
                6 Capteurs critiques — sélection multi-critères
              </div>
              <div style={{fontSize:10,color:C.textMuted}}>
                Importance RF · Corrélation Spearman · Permutation Importance
              </div>
            </div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{borderBottom:`1px solid ${C.border}`,background:'#FAFAF8'}}>
                  {['','Capteur · Sous-système','Valeur','Seuil OCP',"Niveau d'usage"].map((h,i)=>(
                    <th key={i} style={{padding:'9px 14px',fontSize:10,fontWeight:700,letterSpacing:1.5,
                      color:C.textMuted,textTransform:'uppercase',
                      textAlign:i===0?'center':i===1?'left':'right',
                      width:i===0?6:i===4?'28%':undefined,
                      paddingRight:i===4?20:14}}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SENSORS.map(s=><SensorRow key={s.key} sensor={s}/>)}
              </tbody>
            </table>
            <div style={{padding:'9px 18px',background:'#FAFAF8',borderTop:`1px solid ${C.borderLight}`}}>
              <div style={{fontSize:10,color:C.textMuted,fontStyle:'italic'}}>
                💡 Les valeurs s'afficheront après upload d'un fichier Excel mensuel CAT 994F1.
              </div>
            </div>
          </div>

          {/* STATUT MODÈLES */}
          {modelStatus&&(
            <div className="rc" style={{marginTop:14,animationDelay:'0.3s',background:C.greenPale,
              border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 16px',
              display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
              <div style={{display:'flex',alignItems:'center',gap:7}}>
                <div style={{width:7,height:7,borderRadius:'50%',background:C.green,
                  boxShadow:`0 0 5px ${C.green}`}}/>
                <span style={{fontSize:11,fontWeight:700,color:C.greenDark}}>
                  {modelStatus.nb_modeles} modèles chargés
                </span>
              </div>
              <span style={{fontSize:10,color:C.textMuted}}>·</span>
              <span style={{fontSize:10,color:C.textMuted}}>{modelStatus.capteurs_cles?.join(' · ')}</span>
              <span style={{fontSize:10,color:C.textMuted}}>·</span>
              <span style={{fontSize:10,color:C.textMuted}}>{modelStatus.description}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
