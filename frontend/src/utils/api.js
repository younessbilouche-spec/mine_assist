/**
 * Helpers d'appel API homogènes pour MineAssist.
 *
 * Évite la répétition du pattern "fetch -> json -> détecter erreurs" dans chaque
 * page : on s'occupe ici de `res.ok`, du champ `detail` renvoyé par FastAPI et
 * d'un timeout par défaut.
 *
 * Usage :
 *   import { apiGet, apiPost, ApiError } from "../utils/api"
 *
 *   try {
 *     const data = await apiGet(`${API}/gmao/anomaly-results`)
 *   } catch (err) {
 *     if (err instanceof ApiError && err.status === 404) ...
 *   }
 */
import { API } from "../config"

const DEFAULT_TIMEOUT_MS = 20_000

/** Erreur API enrichie : on garde le code HTTP et le payload pour pouvoir
 *  afficher un message ciblé côté composant. */
export class ApiError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message || "Erreur API")
    this.name = "ApiError"
    this.status = status
    this.payload = payload
  }
}

/** Construit une URL absolue à partir d'un chemin relatif (ex: "/gmao/stats"). */
export function apiUrl(path) {
  if (!path) return API
  if (/^https?:\/\//.test(path)) return path
  return `${API}${path.startsWith("/") ? path : `/${path}`}`
}

/** Fetch + timeout via AbortController. */
async function fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } catch (err) {
    if (err.name === "AbortError") {
      throw new ApiError(`Timeout (${Math.round(timeoutMs / 1000)} s) sur ${url}`, { status: 0 })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Lit le corps de la réponse en JSON si possible, sinon en texte. */
async function readBody(res) {
  const ctype = res.headers?.get?.("content-type") || ""
  if (ctype.includes("application/json")) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }
  try {
    const text = await res.text()
    return text || null
  } catch {
    return null
  }
}

/** Cœur du wrapper : exécute la requête et homogénéise la gestion d'erreurs. */
async function apiRequest(method, path, { body, headers, fetcher, timeoutMs, signal } = {}) {
  const url = apiUrl(path)
  const init = {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  }
  if (body !== undefined && body !== null) {
    init.body = typeof body === "string" ? body : JSON.stringify(body)
  }
  if (signal) init.signal = signal

  const doFetch = fetcher || fetchWithTimeout
  const res = await doFetch(url, init, timeoutMs)
  const payload = await readBody(res)

  if (!res.ok) {
    const detail =
      (payload && typeof payload === "object" && (payload.detail || payload.message)) ||
      (typeof payload === "string" ? payload : null) ||
      `HTTP ${res.status}`
    throw new ApiError(detail, { status: res.status, payload })
  }

  // FastAPI peut renvoyer 200 + { detail: "..." } dans certains cas legacy.
  if (payload && typeof payload === "object" && payload.detail && Object.keys(payload).length === 1) {
    throw new ApiError(payload.detail, { status: res.status, payload })
  }

  return payload
}

export function apiGet(path, options = {})  { return apiRequest("GET",  path, options) }
export function apiPost(path, body, options = {}) { return apiRequest("POST",  path, { ...options, body }) }
export function apiPut(path, body, options = {})  { return apiRequest("PUT",   path, { ...options, body }) }
export function apiDel(path, options = {})         { return apiRequest("DELETE", path, options) }

/** Variante qui ne lève pas : retourne `{ data, error }` pour les composants
 *  qui préfèrent la convention "tuple" plutôt que try/catch. */
export async function apiSafe(promise) {
  try {
    return { data: await promise, error: null }
  } catch (err) {
    return { data: null, error: err instanceof ApiError ? err : new ApiError(err?.message || "Erreur") }
  }
}
