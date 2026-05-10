/**
 * main.jsx — Sprint 3 (mai 2026)
 * ===============================
 * 
 * Version compatible MineAssist (état-based, PAS de react-router-dom).
 * 
 * Wrappers ajoutés :
 *   - I18nProvider : contexte i18n FR/EN/AR avec fallback
 *   - ThemeProvider : dark mode + CSS variables (sand / dark)
 * 
 * Rétrocompatible : si tu enlèves les deux wrappers, l'app fonctionne pareil
 * (les composants ont des fallbacks de couleurs et de langue).
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/theme.css'
import App from './App.jsx'
import { ThemeProvider } from './components/ThemeProvider'
import { I18nProvider } from './i18n'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
)
