/**
 * Hook d'authentification pour MineAssist
 * Gère le token JWT, l'utilisateur courant, et les headers API
 */
import { useState, useCallback } from "react"

export function useAuth() {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("mineassist_user")
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })

  const [token, setToken] = useState(() =>
    localStorage.getItem("mineassist_token") || null
  )

  const login = useCallback((userData, accessToken) => {
    setUser(userData)
    setToken(accessToken)
    localStorage.setItem("mineassist_user", JSON.stringify(userData))
    localStorage.setItem("mineassist_token", accessToken)
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    setToken(null)
    localStorage.removeItem("mineassist_user")
    localStorage.removeItem("mineassist_token")
  }, [])

  /**
   * Headers JSON avec Bearer token — à utiliser dans tous les fetch()
   * Exemple: fetch(`${API}/ask`, { method:"POST", headers: authHeaders(), body: ... })
   */
  const authHeaders = useCallback(() => ({
    "Content-Type": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
  }), [token])

  /**
   * Wrapper fetch qui gère automatiquement les erreurs 401 (déconnexion)
   */
  const apiFetch = useCallback(async (url, options = {}) => {
    const headers = { ...authHeaders(), ...(options.headers || {}) }
    
    // Si c'est un FormData, on laisse le navigateur gérer le Content-Type
    if (options.body instanceof FormData) {
      delete headers["Content-Type"]
    }

    const response = await fetch(url, {
      ...options,
      headers
    })
    if (response.status === 401) {
      logout()
      throw new Error("Session expirée. Veuillez vous reconnecter.")
    }
    return response
  }, [authHeaders, logout])

  /**
   * Vérifie si l'utilisateur a accès à une fonctionnalité selon son rôle
   */
  const canAccess = useCallback((feature) => {
    if (!user) return false
    if (user.role === "admin") return true
    const permissions = {
      chef:       ["ask", "diagnose", "gmao", "monitor", "capteurs", "anomaly", "evolution", "geo", "oil", "export", "prediction", "alertes_ocp"],
      technicien: ["ask", "diagnose", "monitor", "capteurs", "prediction", "alertes_ocp"],
    }
    return (permissions[user.role] || []).includes(feature)
  }, [user])

  const isAdmin = user?.role === "admin"
  const isChef  = user?.role === "chef" || isAdmin
  const isTech  = !!user

  return {
    user,
    token,
    isAuthenticated: !!user && !!token,
    isAdmin,
    isChef,
    isTech,
    login,
    logout,
    authHeaders,
    apiFetch,
    canAccess,
  }
}
