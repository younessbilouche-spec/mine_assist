/**
 * seuilsOCP.js — Version JS des règles de seuils officiels OCP
 * Mirror exact de backend/matlab_simulation/vims_replay/seuils_OCP.json
 *
 * Permet au frontend d'évaluer le statut "ok | attention | alerte" d'un
 * capteur en utilisant le contexte (rpm, hyd_load, cycle_phase) pour les
 * règles conditionnelles, comme le backend.
 *
 * Statut returned :
 *   "alerte"    → seuil franchi (notifier)
 *   "attention" → 90% du seuil
 *   "ok"        → dans la plage nominale
 */

// ─────────────────────────────────────────────────────────────────────
// Règles OCP (ID 1..18) — source seuils_OCP.json
// ─────────────────────────────────────────────────────────────────────
export const REGLES_OCP = [
  { id: 1,  param: "Température échappement Droit",       op: "max",   max: 600,  unit: "°C",  crit: "elevee" },
  { id: 2,  param: "Température échappement gauche",      op: "max",   max: 600,  unit: "°C",  crit: "elevee" },
  { id: 3,  param: "Pression huile moteur",               op: "rpm_cond", unit: "kPa", crit: "elevee",
    cond: [
      { rpm_min: 720,  rpm_max: 780,  P_min: 140 },
      { rpm_min: 1650, rpm_max: 1750, P_min: 275 },
    ]},
  { id: 4,  param: "Pression d'air au réservoir",         op: "range", min: 600, max: 900, unit: "kPa", crit: "moyenne" },
  { id: 6,  param: "Pression pompe hydraulique principale", op: "rpm_hyd_cond", unit: "kPa", crit: "moyenne",
    cond: [
      { rpm_min: 1500, hyd_load_min: 0.3, P_min: 15000, P_max: 25000 },
    ]},
  { id: 7,  param: "Température essieux arrière",         op: "max",   max: 129,  unit: "°C",  crit: "elevee" },
  { id: 8,  param: "Température sortie convertisseur",    op: "max",   max: 129,  unit: "°C",  crit: "elevee" },
  { id: 9,  param: "Température huile direction",         op: "max",   max: 70,   unit: "°C",  crit: "moyenne" },
  { id: 10, param: "Température huile freinage",          op: "max",   max: 70,   unit: "°C",  crit: "elevee" },
  { id: 14, param: "Pression embrayage impeller",         op: "rpm_cond", unit: "kPa", crit: "moyenne",
    cond: [
      { rpm_min: 1510, P_min: 1860, P_max: 1870 },
    ]},
  { id: 17, param: "Température huile hydraulique",       op: "max",   max: 93,   unit: "°C",  crit: "elevee" },
  { id: 18, param: "Régime moteur",                       op: "max",   max: 1750, unit: "tr/min", crit: "elevee" },
  // T° liquide refroidissement (pas dans seuils_OCP.json mais utile à afficher)
  { id: "L", param: "Température liquide refroidissement", op: "max",  max: 100,  unit: "°C",  crit: "moyenne" },
]

// Normalize : enlève prefixe "CH994.P1." / "CH994.P2.", apostrophe courbe
export const norm = (s) => {
  if (!s) return ""
  return String(s).replace(/^CH994\.P[12]\./, "").replace(/\u2019/g, "'").trim()
}

// Trouve la règle OCP correspondant à un nom de paramètre
export const findRegle = (paramName) => {
  const n = norm(paramName).toLowerCase()
  return REGLES_OCP.find(r => {
    const rn = r.param.toLowerCase()
    return n === rn || n.startsWith(rn.slice(0, 18)) || rn.startsWith(n.slice(0, 18))
  }) || null
}

/**
 * Évalue un capteur dans son contexte.
 * @param {string} param - nom du paramètre (peut contenir prefixe P1/P2)
 * @param {number} value - valeur courante
 * @param {object} ctx - { rpm, hyd_load, cyclePhase }
 * @returns {"ok"|"attention"|"alerte"}
 */
export const evalStatusOCP = (param, value, ctx = {}) => {
  if (value == null || isNaN(value)) return "ok"
  const r = findRegle(param)
  if (!r) return "ok"

  const rpm = ctx.rpm || 0
  const hyd = ctx.hyd_load || 0

  switch (r.op) {
    case "max": {
      if (value > r.max) return "alerte"
      if (value > r.max * 0.92) return "attention"
      return "ok"
    }
    case "min": {
      if (value < r.min) return "alerte"
      if (value < r.min * 1.08) return "attention"
      return "ok"
    }
    case "range": {
      if (value < r.min || value > r.max) return "alerte"
      const margin = (r.max - r.min) * 0.08
      if (value < r.min + margin || value > r.max - margin) return "attention"
      return "ok"
    }
    case "rpm_cond": {
      // Trouver la condition rpm applicable
      const c = r.cond.find(c => rpm >= c.rpm_min && rpm <= (c.rpm_max || 9999))
      if (!c) return "ok"  // hors plage rpm = pas de règle
      if (c.P_min != null && value < c.P_min) return "alerte"
      if (c.P_max != null && value > c.P_max) return "alerte"
      if (c.P_min != null && value < c.P_min * 1.05) return "attention"
      return "ok"
    }
    case "rpm_hyd_cond": {
      const c = r.cond.find(c => rpm >= c.rpm_min && hyd >= (c.hyd_load_min || 0))
      if (!c) return "ok"  // engin au ralenti = pas de règle hydraulique
      if (c.P_min != null && value < c.P_min) return "alerte"
      if (c.P_max != null && value > c.P_max) return "alerte"
      if (c.P_min != null && value < c.P_min * 1.05) return "attention"
      return "ok"
    }
    default:
      return "ok"
  }
}

/**
 * Renvoie le seuil "principal" affichable (pour la barre de progression).
 * Pour les règles conditionnelles, prend la limite la plus pertinente.
 */
export const getDisplayLimits = (param, ctx = {}) => {
  const r = findRegle(param)
  if (!r) return { min: null, max: null }

  switch (r.op) {
    case "max":
      return { min: 0, max: r.max }
    case "min":
      return { min: r.min, max: r.min * 2 }
    case "range":
      return { min: r.min, max: r.max }
    case "rpm_cond": {
      const rpm = ctx.rpm || 0
      const c = r.cond.find(c => rpm >= c.rpm_min && rpm <= (c.rpm_max || 9999))
      if (c) return { min: c.P_min || 0, max: c.P_max || c.P_min * 1.5 }
      return { min: 0, max: r.cond[0].P_min * 2 }
    }
    case "rpm_hyd_cond": {
      const c = r.cond[0]
      return { min: 0, max: c.P_max || c.P_min * 1.5 }
    }
    default:
      return { min: null, max: null }
  }
}

/**
 * Sous-système d'un capteur (pour la heatmap)
 */
export const SUBSYSTEM_OF_PARAM = {
  "Régime moteur":                          "moteur",
  "Pression huile moteur":                  "moteur",
  "Température liquide refroidissement":    "moteur",
  "Température échappement Droit":          "moteur",
  "Température échappement gauche":         "moteur",
  "Température sortie convertisseur":       "transmission",
  "Pression embrayage impeller":            "transmission",
  "Pression pompe hydraulique principale":  "hydraulique",
  "Température huile hydraulique":          "hydraulique",
  "Température huile direction":            "hydraulique",
  "Température huile freinage":             "freinage",
  "Température essieux arrière":            "essieux",
  "Pression d'air au réservoir":            "pneumatique",
}

export const getSubsystem = (param) => {
  const n = norm(param)
  return SUBSYSTEM_OF_PARAM[n] || "autre"
}
