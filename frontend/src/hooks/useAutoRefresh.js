// ─────────────────────────────────────────────────────────────────────────────
// src/hooks/useAutoRefresh.js
//
// PROBLÈME ACTUEL dans MonitoringDashboard.jsx (ligne ~170) :
//   useEffect(() => {
//     fetch(`${API_URL}/gmao/params-stats`)   ← pas d'AbortController
//       .then(...)
//   }, [refresh])                            ← pas de cleanup → fuite mémoire
//
// Idem dans AnomalyDashboard.jsx ligne ~120 et GmaoDashboard.jsx.
//
// SOLUTION : ce hook gère fetch + abort + retry + état loading/error/data
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react"
import { API } from "../config"

/**
 * useAutoRefresh — fetch périodique propre avec cleanup
 *
 * @param {string}   path       - Chemin relatif ex: "/gmao/params-stats"
 * @param {object}   options
 * @param {number}   options.interval  - Intervalle auto-refresh en ms (0 = désactivé)
 * @param {boolean}  options.enabled   - Activer ou non le fetch (utile pour auth)
 * @param {function} options.transform - Transformer la réponse JSON avant stockage
 * @param {object}   options.fetchOpts - Options fetch (method, headers, body…)
 *
 * @returns {{ data, loading, error, refresh }}
 *
 * Utilisation :
 *   const { data, loading, error, refresh } = useAutoRefresh("/gmao/params-stats")
 *   const { data } = useAutoRefresh("/gmao/evolution/temp", { interval: 10000 })
 */
export function useAutoRefresh(path, {
  interval  = 0,
  enabled   = true,
  transform = null,
  fetchOpts = {},
} = {}) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const abortRef              = useRef(null)
  const url                   = `${API}${path}`

  const fetchData = useCallback(async () => {
    if (!enabled) return

    // Annuler la requête précédente si elle est encore en cours
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(url, {
        ...fetchOpts,
        signal: abortRef.current.signal,
      })
      if (!res.ok) throw new Error(`Erreur API ${res.status} — ${res.statusText}`)
      const json = await res.json()
      setData(transform ? transform(json) : json)
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [url, enabled, transform]) // fetchOpts intentionnellement exclu (objet instable)

  useEffect(() => {
    fetchData()

    let timer = null
    if (interval > 0) {
      timer = setInterval(fetchData, interval)
    }

    return () => {
      clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [fetchData, interval])

  return { data, loading, error, refresh: fetchData }
}


/**
 * useApiFetch — fetch authentifié (passe le token JWT du localStorage)
 * Même logique que apiFetch dans useAuth.js mais sous forme de hook
 *
 * Utilisation :
 *   const { data } = useApiFetch("/gmao/anomaly-results", { enabled: isAuthenticated })
 */
export function useApiFetch(path, options = {}) {
  const token = localStorage.getItem("mineassist_token")
  return useAutoRefresh(path, {
    ...options,
    fetchOpts: {
      ...options.fetchOpts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.fetchOpts?.headers ?? {}),
      },
    },
  })
}
