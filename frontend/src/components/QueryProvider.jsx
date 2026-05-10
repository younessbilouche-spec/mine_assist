/**
 * QueryProvider.jsx — MineAssist Sprint 2 (mai 2026)
 * Wrapper autour de TanStack Query pour le cache navigateur entre pages.
 *
 * INSTALLATION : npm install @tanstack/react-query
 *
 * USAGE dans main.jsx :
 *   import { QueryProvider } from "./components/QueryProvider"
 *   ...
 *   <QueryProvider>
 *     <App />
 *   </QueryProvider>
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

export function QueryProvider({ children }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        // Les données restent fraîches 60 s — pas de refetch entre tabs
        staleTime: 60_000,
        // Pas de refetch automatique au focus (évite les hits inutiles)
        refetchOnWindowFocus: false,
        // Retry 1 fois avant d'abandonner
        retry: 1,
        // Cache 10 min en mémoire
        gcTime: 10 * 60_000,
      },
    },
  }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

export default QueryProvider
