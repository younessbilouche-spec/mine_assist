import { useState, useEffect, useMemo } from "react"
import {
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  Brush,
} from "recharts"

import { API , C} from "../config"



const PARAMETRES = [
  { key: "Température liquide refroidissement", label: "Temp. liquide refroidissement", unite: "°C", critique: true },
  { key: "Température échappement Droit", label: "Temp. échappement Droit", unite: "°C", critique: true },
  { key: "Température échappement gauche", label: "Temp. échappement gauche", unite: "°C", critique: true },
  { key: "Température sortie convertisseur", label: "Temp. sortie convertisseur", unite: "°C", critique: true },
  { key: "Pression huile moteur", label: "Pression huile moteur", unite: "kPa", critique: true },
  { key: "Pression pompe hydraulique", label: "Pression pompe hydraulique", unite: "kPa", critique: true },
  { key: "Température huile freinage", label: "Temp. huile freinage", unite: "°C", critique: false },
  { key: "Température huile direction", label: "Temp. huile direction", unite: "°C", critique: false },
  { key: "Température PTO avant", label: "Temp. PTO avant", unite: "°C", critique: false },
  { key: "Température Essieux avant", label: "Temp. essieux avant", unite: "°C", critique: false },
  { key: "Température essieux arrière", label: "Temp. essieux arrière", unite: "°C", critique: false },
  { key: "Régime moteur", label: "Régime moteur", unite: "Tr/min", critique: false },
  { key: "Régime sortie convertisseur", label: "Régime sortie convertisseur", unite: "Tr/min", critique: false },
  { key: "Pression d'air au réservoir", label: "Pression d'air réservoir", unite: "kPa", critique: false },
  { key: "Pression embrayage impeller", label: "Pression embrayage impeller", unite: "kPa", critique: false },
  { key: "Courant embrayage impeller", label: "Courant embrayage impeller", unite: "%", critique: false },
  { key: "Courant embrayage Lock-up", label: "Courant embrayage Lock-up", unite: "%", critique: false },
]

function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.bgCard,
        border: `1px solid ${C.border}`,
        borderTop: `2px solid ${C.sand}`,
        padding: "20px 22px",
        backdropFilter: "blur(8px)",
        boxShadow: "0 2px 10px rgba(139,105,20,0.07)",
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function CardTitle({ children, accent, right }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: C.textMuted,
        letterSpacing: 3,
        textTransform: "uppercase",
        marginBottom: 14,
        paddingBottom: 10,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        gap: 7,
      }}
    >
      <div style={{ width: 3, height: 11, background: accent || C.sand }} />
      <span>{children}</span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  )
}

function StatBadge({ label, value, unite, color }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.5)",
        border: `1px solid ${C.border}`,
        padding: "8px 14px",
        textAlign: "center",
        minWidth: 100,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: C.textMuted,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || C.text, lineHeight: 1 }}>
        {value}
      </div>
      {unite && <div style={{ fontSize: 10, color: C.textLight, marginTop: 2 }}>{unite}</div>}
    </div>
  )
}

function CustomTooltip({ active, payload, label, unite, seuil_max, seuil_min, mode, mu, seuil_type }) {
  if (!active || !payload?.length) return null

  const val = payload[0]?.value
  const isOver = seuil_max != null && val > seuil_max
  const isUnder = seuil_min != null && val < seuil_min

  const isAlert =
    (mode === "high" && isOver) ||
    (mode === "low" && isUnder) ||
    (mode === "both" && (isOver || isUnder))

  let statusText = "Normal"
  if (mode === "high" && isOver) statusText = "Surchauffe potentielle"
  if (mode === "low" && isUnder) statusText = "Sous-seuil critique"
  if (mode === "both" && isOver) statusText = "Dérive haute"
  if (mode === "both" && isUnder) statusText = "Dérive basse"

  return (
    <div
      style={{
        background: C.bgCard,
        border: `1px solid ${isAlert ? C.danger : C.border}`,
        padding: "10px 14px",
        fontSize: 12,
        color: C.text,
        boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
        minWidth: 220,
      }}
    >
      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: isAlert ? C.danger : C.green }}>
        {val?.toFixed(2)} {unite}
      </div>
      <div style={{ fontSize: 11, color: isAlert ? C.danger : C.textLight, marginTop: 4 }}>
        {statusText}
      </div>
      <div style={{ fontSize: 11, color: C.textLight, marginTop: 4 }}>
        µ = {mu ?? "—"}
        {mode !== "low" && seuil_max != null
          ? ` · ${seuil_type === "seuil_metier_ocp" ? "seuil OCP max" : "seuil haut"} ${seuil_max}`
          : ""}
        {mode !== "high" && seuil_min != null
          ? ` · ${seuil_type === "seuil_metier_ocp" ? "seuil OCP min" : "seuil bas"} ${seuil_min}`
          : ""}
      </div>
    </div>
  )
}

function buildInterpretation(data) {
  if (!data) return ""
  if (data.interpretation) return data.interpretation

  if (data.mode === "high") {
    return `${data.nb_depassements} épisode(s) de surchauffe détecté(s).`
  }
  if (data.mode === "low") {
    return `${data.nb_depassements} chute(s) sous seuil critique détectée(s).`
  }
  return `${data.nb_depassements} dérive(s) hors plage normale détectée(s).`
}

export default function EvolutionChart({ selectedParam: controlledParam, onSelectParam } = {}) {
  // Le composant peut être contrôlé (via CapteursPage) ou autonome (anciennes
  // routes). Si `selectedParam` est fourni en prop on l'utilise, sinon on
  // gère un state interne (comportement initial).
  const [internalParam, setInternalParam] = useState(PARAMETRES[0].key)
  const selectedParam =
    controlledParam && PARAMETRES.some((p) => p.key === controlledParam)
      ? controlledParam
      : internalParam
  const setSelectedParam = (val) => {
    setInternalParam(val)
    if (typeof onSelectParam === "function") onSelectParam(val)
  }
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setLoading(true)
    setError("")
    setData(null)

    const encoded = encodeURIComponent(selectedParam)

    fetch(`${API}/gmao/evolution/${encoded}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok || json.detail) {
          throw new Error(json.detail || `Erreur API ${res.status}`)
        }
        return json
      })
      .then((json) => {
        setData(json)
      })
      .catch((err) => {
        setError(err.message)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [selectedParam])

  const paramInfo = PARAMETRES.find((p) => p.key === selectedParam)

  const monthSummaryText = useMemo(() => {
    if (!data?.monthly_summary?.length) return "Synthèse mensuelle indisponible"
    return data.monthly_summary
      .map((item) => `${item.month}: ${Number(item.moyenne).toFixed(1)} ${data.unite}`)
      .join(" · ")
  }, [data])

  const interpretationText = useMemo(() => buildInterpretation(data), [data])

  return (
    <div
      style={{
        padding: "28px 32px",
        maxWidth: 1200,
        margin: "0 auto",
        fontFamily: "'Rajdhani', sans-serif",
        position: "relative",
        zIndex: 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.textMuted,
            letterSpacing: 4,
            textTransform: "uppercase",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ width: 4, height: 16, background: C.green, borderRadius: 2 }} />
          Analyse temporelle — CAT 994F
        </div>
        <div style={{ fontSize: 11, color: C.textLight, letterSpacing: 1 }}>
          {data?.period_start ? `${data.period_start.slice(0, 10)} → ${data.period_end?.slice(0, 10)}` : "période de mesure"}
        </div>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <CardTitle accent={C.green}>Sélectionner un paramètre</CardTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PARAMETRES.map((p) => {
            const isSelected = p.key === selectedParam
            return (
              <button
                key={p.key}
                onClick={() => setSelectedParam(p.key)}
                style={{
                  background: isSelected ? (p.critique ? C.dangerPale : C.greenPale) : "rgba(255,255,255,0.5)",
                  border: `1px solid ${isSelected ? (p.critique ? "#e8bfba" : "rgba(0,132,61,0.3)") : C.border}`,
                  color: isSelected ? (p.critique ? C.danger : C.greenDark) : C.textMid,
                  padding: "6px 14px",
                  cursor: "pointer",
                  fontFamily: "'Rajdhani', sans-serif",
                  fontSize: 12,
                  fontWeight: isSelected ? 700 : 500,
                  letterSpacing: 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                {p.critique && <span style={{ fontSize: 9 }}>🚨</span>}
                {p.label}
                <span style={{ fontSize: 10, opacity: 0.7 }}>({p.unite})</span>
              </button>
            )
          })}
        </div>
      </Card>

      {loading && (
        <div
          style={{
            padding: "60px",
            textAlign: "center",
            color: C.textMuted,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 2,
          }}
        >
          CHARGEMENT...
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "18px 22px",
            background: C.dangerPale,
            border: `1px solid #e8bfba`,
            borderLeft: `4px solid ${C.danger}`,
            color: C.danger,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ❌ {error}
        </div>
      )}

      {data && !loading && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <StatBadge label="Moyenne µ" value={data.mu} unite={data.unite} color={C.green} />
            <StatBadge label="Écart-type σ" value={data.sigma} unite={data.unite} color={C.sand} />

            {data.mode !== "low" && data.seuil_max != null && (
              <StatBadge
                label={data.seuil_type === "seuil_metier_ocp" ? "Seuil max OCP" : "Seuil max 2σ"}
                value={data.seuil_max}
                unite={data.unite}
                color={C.danger}
              />
            )}

            {data.mode !== "high" && data.seuil_min != null && data.seuil_min > 0 && (
              <StatBadge
                label={data.seuil_type === "seuil_metier_ocp" ? "Seuil min OCP" : "Seuil min 2σ"}
                value={data.seuil_min}
                unite={data.unite}
                color={C.orange}
              />
            )}

            <StatBadge label="Points horaires" value={data.nb_points} color={C.textMid} />
            <StatBadge
              label="Écarts détectés"
              value={`${data.nb_depassements} (${data.pct_depassement}%)`}
              color={data.nb_depassements > 0 ? C.danger : C.green}
            />

            {data.health_score != null && (
              <StatBadge
                label="Santé machine"
                value={data.health_score}
                unite="%"
                color={
                  data.health_score >= 85
                    ? C.green
                    : data.health_score >= 65
                    ? C.orange
                    : C.danger
                }
              />
            )}

            {data.last_value != null && (
              <StatBadge label="Dernière valeur" value={data.last_value} unite={data.unite} color={C.greenDark} />
            )}
          </div>

          <Card style={{ marginBottom: 16 }}>
            <CardTitle
              accent={paramInfo?.critique ? C.danger : C.green}
              right={
                <span style={{ fontSize: 10, fontWeight: 400, color: C.textLight }}>
                  {data.seuil_type === "seuil_metier_ocp" ? "SEUIL MÉTIER OCP" : "SEUIL STATISTIQUE 2Σ"} · mode {data.mode || "both"}
                </span>
              }
            >
              Évolution — {paramInfo?.label}
            </CardTitle>

            <div style={{ marginBottom: 16 }}>
              {data.health_status && (
                <div
                  style={{
                    marginBottom: 10,
                    fontSize: 14,
                    fontWeight: 700,
                    color:
                      data.health_status === "Stable"
                        ? C.greenDark
                        : data.health_status === "À surveiller"
                        ? C.orange
                        : C.danger,
                  }}
                >
                  🩺 État machine : {data.health_status} {data.health_score != null ? `(${data.health_score}%)` : ""}
                </div>
              )}

              <div
                style={{
                  padding: "14px 18px",
                  background: data.nb_depassements > 0 ? "#FFF4E8" : "#EAF7F0",
                  borderLeft: `4px solid ${data.nb_depassements > 0 ? C.orange : C.green}`,
                  color: data.nb_depassements > 0 ? C.text : C.greenDark,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {data.nb_depassements > 0
                  ? `⚠️ ${interpretationText}`
                  : "Aucun écart significatif détecté sur la période affichée."}
              </div>

              {data.filter_notice && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "12px 16px",
                    background: "#FFF7E8",
                    borderLeft: `4px solid ${C.orange}`,
                    color: "#8A5A00",
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1.6,
                  }}
                >
                  ⚠️ {data.filter_notice}
                </div>
              )}

              {data.diagnostic_ia && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "12px 16px",
                    background: "#F6F4EE",
                    borderLeft: `4px solid ${C.green}`,
                    color: C.text,
                    fontSize: 14,
                    lineHeight: 1.7,
                  }}
                >
                  🤖 <strong>Diagnostic IA :</strong> {data.diagnostic_ia}
                </div>
              )}
            </div>

            <ResponsiveContainer width="100%" height={390}>
              <ComposedChart data={data.points} margin={{ top: 8, right: 20, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 9, fill: C.textMuted }}
                  angle={-40}
                  textAnchor="end"
                  interval={Math.max(0, Math.floor((data.points?.length || 1) / 20))}
                  height={60}
                />
                <YAxis tick={{ fontSize: 10, fill: C.textMuted }} unit={` ${data.unite}`} width={70} />
                <Tooltip
                  content={
                    <CustomTooltip
                      unite={data.unite}
                      seuil_max={data.seuil_max}
                      seuil_min={data.seuil_min}
                      mode={data.mode}
                      mu={data.mu}
                      seuil_type={data.seuil_type}
                    />
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Rajdhani',sans-serif", paddingTop: 8 }} />

                <Area
                  type="monotone"
                  dataKey="v"
                  name={paramInfo?.label}
                  fill={paramInfo?.critique ? "rgba(192,57,43,0.05)" : "rgba(0,132,61,0.05)"}
                  stroke="none"
                />

                <Line
                  type="monotone"
                  dataKey="v"
                  name={paramInfo?.label}
                  stroke={paramInfo?.critique ? C.danger : C.green}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 5, fill: C.green }}
                />

                {data.mode !== "low" && data.seuil_max != null && (
                  <ReferenceLine
                    y={data.seuil_max}
                    stroke={C.danger}
                    strokeDasharray="6 3"
                    strokeWidth={2}
                    label={{
                      value: `${data.seuil_type === "seuil_metier_ocp" ? "Seuil OCP max" : "Seuil max"} ${data.seuil_max}`,
                      position: "insideTopRight",
                      fontSize: 10,
                      fill: C.danger,
                      fontWeight: 700,
                    }}
                  />
                )}

                <ReferenceLine
                  y={data.mu}
                  stroke={C.sand}
                  strokeDasharray="4 2"
                  strokeWidth={1.5}
                  label={{
                    value: `µ = ${data.mu}`,
                    position: "insideBottomRight",
                    fontSize: 10,
                    fill: C.sand,
                    fontWeight: 700,
                  }}
                />

                {data.mode !== "high" && data.seuil_min != null && data.seuil_min > 0 && (
                  <ReferenceLine
                    y={data.seuil_min}
                    stroke={C.orange}
                    strokeDasharray="6 3"
                    strokeWidth={2}
                    label={{
                      value: `${data.seuil_type === "seuil_metier_ocp" ? "Seuil OCP min" : "Seuil min"} ${data.seuil_min}`,
                      position: "insideBottomRight",
                      fontSize: 10,
                      fill: C.orange,
                      fontWeight: 700,
                    }}
                  />
                )}

                <Brush
                  dataKey="t"
                  height={24}
                  stroke={C.border}
                  fill="rgba(255,255,255,0.5)"
                  travellerWidth={8}
                  startIndex={0}
                />
              </ComposedChart>
            </ResponsiveContainer>

            <div style={{ marginTop: 10, fontSize: 11, color: C.textLight, lineHeight: 1.7 }}>
              Synthèse mensuelle : {monthSummaryText}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
