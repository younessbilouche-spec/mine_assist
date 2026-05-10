import { API } from "../config"

const DEFAULT_TIMEOUT_MS = 30000

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.details = details
  }
}

export function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path
  return `${API}${path.startsWith("/") ? path : `/${path}`}`
}

async function readBody(response) {
  const contentType = response.headers?.get?.("content-type") || ""
  if (contentType.includes("application/json")) return response.json()
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function apiRequest(path, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const response = await fetch(apiUrl(path), {
      ...fetchOptions,
      signal: fetchOptions.signal || ctrl.signal,
    })
    const body = await readBody(response)
    const detail = body && typeof body === "object" ? body.detail : null

    if (!response.ok || detail) {
      throw new ApiError(detail || `HTTP ${response.status}`, response.status, body)
    }

    return body
  } catch (error) {
    if (error.name === "AbortError") {
      throw new ApiError("Timeout API", 0)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function apiGet(path, options = {}) {
  return apiRequest(path, { ...options, method: "GET" })
}

export function apiPost(path, body, options = {}) {
  return apiRequest(path, {
    ...options,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: JSON.stringify(body),
  })
}
