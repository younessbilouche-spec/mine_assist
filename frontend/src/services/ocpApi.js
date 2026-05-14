import { API } from '../config'

const BASE_URL = `${API}/pred`

function authHeaders(extra = {}) {
  const token =
    localStorage.getItem('mineassist_token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('token') ||
    localStorage.getItem('auth_token') ||
    sessionStorage.getItem('mineassist_token') ||
    sessionStorage.getItem('access_token') ||
    sessionStorage.getItem('token')
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
}

function errorText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(errorText).filter(Boolean).join(' | ')
  if (typeof value === 'object') {
    if (value.message) return errorText(value.message)
    if (value.msg) return errorText(value.msg)
    if (value.detail) return errorText(value.detail)
    if (value.loc && value.type) return `${value.loc.join('.')} : ${value.type}`
    return JSON.stringify(value)
  }
  return String(value)
}

async function responseError(res, fallback) {
  const contentType = res.headers.get('content-type') || ''
  const body = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => '')
  return errorText(body?.detail || body?.message || body) || fallback
}

async function request(apiFetch, path, options = {}) {
  const headers = authHeaders(options.headers || {})
  let res
  try {
    if (apiFetch) {
      res = await apiFetch(`${BASE_URL}${path}`, { ...options, headers })
    } else {
      res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
    }
  } catch {
    throw new Error(`Backend OCP indisponible (${BASE_URL}${path})`)
  }
  if (!res.ok) {
    throw new Error(await responseError(res, `Erreur ${res.status}: ${path}`))
  }
  return res.json()
}

async function uploadRequest(apiFetch, path, file) {
  const formData = new FormData()
  formData.append('file', file)
  
  // Note: On ne met pas Content-Type pour les FormData, le navigateur le fait.
  // apiFetch va ajouter le Bearer token via authHeaders().
  
  let res
  try {
    if (apiFetch) {
      res = await apiFetch(`${BASE_URL}${path}`, { method: 'POST', body: formData })
    } else {
      const headers = authHeaders()
      res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: formData })
    }
  } catch {
    throw new Error(`Backend OCP indisponible (${BASE_URL}${path})`)
  }
  if (!res.ok) {
    throw new Error(await responseError(res, `Erreur upload: ${res.status}`))
  }
  return res.json()
}

export async function uploadOcpFile(apiFetch, file) {
  return uploadRequest(apiFetch, '/upload', file)
}

export function getOcpUploadStatus(apiFetch) {
  return request(apiFetch, '/upload/status')
}

export function getOcpSensors(apiFetch) {
  return request(apiFetch, '/sensors')
}

export function getOcpSensorsData(apiFetch, maxPoints = 500) {
  return request(apiFetch, `/sensors/data?max_points=${maxPoints}`)
}

export function getOcpSensorData(apiFetch, col, maxPoints = 500) {
  return request(apiFetch, `/sensors/data/${encodeURIComponent(col)}?max_points=${maxPoints}`)
}

export function getOcpDefauts(apiFetch) {
  return request(apiFetch, '/defauts')
}

export function getOcpDefautsAnalyse(apiFetch) {
  return request(apiFetch, '/defauts/analyse')
}

export function getOcpDefautsEpisodes(apiFetch, anomalyLevel = 2) {
  return request(apiFetch, `/defauts/episodes?anomaly_level=${anomalyLevel}`)
}

export function getOcpDefautCapteur(apiFetch, col) {
  return request(apiFetch, `/defauts/capteur/${encodeURIComponent(col)}`)
}

export function getOcpEngineHealth(apiFetch) {
  return request(apiFetch, '/health')
}

export function getOcpHealthCapteurs(apiFetch) {
  return request(apiFetch, '/health/capteurs')
}

export function getOcpHealthHistorique(apiFetch, fenetreH = 24) {
  return request(apiFetch, `/health/historique?fenetre_h=${fenetreH}`)
}

export function runOcpPrediction(apiFetch, horizon = null) {
  const qs = horizon ? `?horizon=${horizon}` : ''
  return request(apiFetch, `/prediction${qs}`)
}

export function getOcpPredictionStatus(apiFetch) {
  return request(apiFetch, '/prediction/status')
}

export function getOcpAlertes(apiFetch) {
  return request(apiFetch, '/alertes')
}

export function getOcpTroubleshooting(apiFetch, faultKey) {
  return request(apiFetch, `/troubleshooting/${encodeURIComponent(faultKey)}`)
}

export function getAllOcpTroubleshooting(apiFetch) {
  return request(apiFetch, '/troubleshooting')
}
