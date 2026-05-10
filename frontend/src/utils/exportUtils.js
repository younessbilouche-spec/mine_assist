// ─────────────────────────────────────────────────────────────────────────────
// src/utils/exportUtils.js — Export PNG, CSV, et PDF (via print natif)
//
// 3 stratégies, choisies pour MINIMISER les nouvelles dépendances :
//
//   1. CSV   → JS pur, aucune dépendance
//   2. PNG   → JS pur, utilise Canvas + XMLSerializer (fonctionne sur SVG natifs
//              comme Recharts et Leaflet en mode export)
//   3. PDF   → window.print() avec une feuille @media print (déjà incluse dans
//              theme.css). L'utilisateur choisit "Enregistrer en PDF" dans le
//              dialog d'impression — zéro dépendance JS, qualité vectorielle.
//
// SI vous voulez un export PDF DIRECT (sans dialog) :
//   npm i jspdf html-to-image
//   et utilisez `exportPdfDirect()` plus bas (fonction prête, à décommenter
//   après installation des deps).
// ─────────────────────────────────────────────────────────────────────────────

// ─── 1. CSV export ───────────────────────────────────────────────────────────
/**
 * Exporte un tableau d'objets en CSV.
 * @param {Array<Object>} rows  ex: [{ machine: "994F-1", value: 87.3 }, ...]
 * @param {String} filename     ex: "alertes_capteurs"
 * @param {Array<String>} cols  optionnel, force l'ordre des colonnes
 */
export function exportCsv(rows, filename = "export", cols = null) {
  if (!rows || rows.length === 0) {
    alert("Aucune donnée à exporter")
    return
  }

  const columns = cols || Object.keys(rows[0])
  const escape = v => {
    if (v === null || v === undefined) return ""
    const s = String(v)
    // Escape doubles quotes + wrap if needed (RFC 4180)
    if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes(";")) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const header = columns.join(";")
  const body = rows.map(r => columns.map(c => escape(r[c])).join(";")).join("\n")
  // BOM UTF-8 pour compatibilité Excel (les caractères français)
  const blob = new Blob(["\ufeff" + header + "\n" + body], { type: "text/csv;charset=utf-8" })

  triggerDownload(blob, `${sanitize(filename)}_${dateStamp()}.csv`)
}

// ─── 2. PNG export ───────────────────────────────────────────────────────────
/**
 * Exporte un élément DOM (carte, graphique, panel entier) en PNG.
 * Utilise une approche pure JS via Canvas + foreignObject SVG.
 *
 * @param {HTMLElement} element  ex: document.getElementById("monitor-card")
 * @param {String} filename
 * @param {Object} opts          { scale: 2 (pour qualité retina), bg: "#fff" }
 */
export async function exportElementAsPng(element, filename = "screenshot", opts = {}) {
  if (!element) {
    alert("Élément introuvable")
    return
  }

  const { scale = 2, bg = "#FFFDF8" } = opts
  const rect = element.getBoundingClientRect()
  const width = rect.width
  const height = rect.height

  try {
    // Strategy 1: dataURL d'un foreignObject SVG (marche pour la plupart des contenus)
    const cloneNode = element.cloneNode(true)
    inlineStyles(element, cloneNode)
    inlineImagesAsDataURL(cloneNode)

    // Wrap dans un foreignObject SVG
    const svgString = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="background:${bg};width:${width}px;height:${height}px">
            ${new XMLSerializer().serializeToString(cloneNode)}
          </div>
        </foreignObject>
      </svg>
    `

    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    img.crossOrigin = "anonymous"
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = url
    })

    const canvas = document.createElement("canvas")
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, width, height)

    URL.revokeObjectURL(url)

    canvas.toBlob(blob => {
      if (!blob) return alert("Échec de génération PNG")
      triggerDownload(blob, `${sanitize(filename)}_${dateStamp()}.png`)
    }, "image/png", 0.95)
  } catch (err) {
    console.error("Export PNG failed:", err)
    alert(
      "L'export PNG natif a échoué (souvent à cause de styles externes ou d'images cross-origin).\n" +
      "Astuce : utilisez l'export PDF (impression) qui ne souffre pas de ces limitations."
    )
  }
}

/**
 * Variante simple : exporte uniquement un SVG (le plus fiable pour Recharts).
 * À utiliser quand on veut juste un graphique.
 */
export function exportSvgAsPng(svgElement, filename = "chart", opts = {}) {
  if (!svgElement || svgElement.tagName.toLowerCase() !== "svg") {
    alert("L'élément n'est pas un SVG")
    return
  }
  const { scale = 2, bg = "#FFFDF8" } = opts
  const width = svgElement.viewBox?.baseVal?.width || svgElement.clientWidth || 800
  const height = svgElement.viewBox?.baseVal?.height || svgElement.clientHeight || 400

  const clone = svgElement.cloneNode(true)
  // Force xmlns pour les SVG sans namespace
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  }
  const svgString = new XMLSerializer().serializeToString(clone)
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" })
  const url = URL.createObjectURL(svgBlob)

  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement("canvas")
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    canvas.toBlob(blob => {
      triggerDownload(blob, `${sanitize(filename)}_${dateStamp()}.png`)
    }, "image/png", 0.95)
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    alert("Erreur de génération PNG")
  }
  img.src = url
}

// ─── 3. PDF export — méthode print natif (zéro dep) ──────────────────────────
/**
 * Lance le dialog d'impression avec un titre custom.
 * L'utilisateur choisit "Enregistrer en PDF" dans le dialog navigateur.
 * Avantages : qualité vectorielle, gère les multi-pages, pas de dep.
 *
 * Pour que ça rende bien, theme.css contient déjà :
 *   @media print { .no-print { display: none } ... }
 *
 * Marquez les éléments à cacher dans le PDF avec `data-no-print="true"` ou la classe `no-print`.
 */
export function printDashboard(title = "MineAssist — Rapport") {
  const originalTitle = document.title
  document.title = `${title} — ${new Date().toLocaleDateString("fr-FR")}`

  // Petit délai pour que le titre soit pris en compte par l'OS dialog
  setTimeout(() => {
    window.print()
    setTimeout(() => { document.title = originalTitle }, 500)
  }, 100)
}

// ─── 4. PDF export DIRECT (avec dependances) ─────────────────────────────────
/*
  Pour activer cette fonction, installez :
    npm i jspdf html-to-image

  Puis décommentez ce bloc :

  import { toPng } from "html-to-image"
  import jsPDF from "jspdf"

  export async function exportPdfDirect(element, filename = "rapport", opts = {}) {
    if (!element) return alert("Élément introuvable")
    const { orientation = "portrait", title = "MineAssist" } = opts
    try {
      const dataUrl = await toPng(element, { pixelRatio: 2, backgroundColor: "#FFFDF8" })
      const pdf = new jsPDF({ orientation, unit: "px", format: [element.offsetWidth, element.offsetHeight] })
      // Header
      pdf.setFontSize(10)
      pdf.text(`${title} · ${new Date().toLocaleDateString("fr-FR")}`, 12, 14)
      pdf.addImage(dataUrl, "PNG", 0, 24, element.offsetWidth, element.offsetHeight)
      pdf.save(`${sanitize(filename)}_${dateStamp()}.pdf`)
    } catch (e) {
      console.error("Export PDF failed:", e)
      alert("Erreur export PDF — utilisez l'option Imprimer comme fallback")
    }
  }
*/

// ─── Helpers ─────────────────────────────────────────────────────────────────
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function sanitize(str) {
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50)
}

function dateStamp() {
  const d = new Date()
  return d.toISOString().slice(0, 16).replace(/[T:]/g, "-")
}

/**
 * Inline les styles calculés sur l'arborescence (pour que l'export PNG via
 * foreignObject ait l'air correct, car les CSS externes ne sont pas embarqués).
 */
function inlineStyles(source, target) {
  const sourceEl = source
  const targetEl = target
  const computed = window.getComputedStyle(sourceEl)
  const styleStr = Array.from(computed)
    .filter(prop => !prop.startsWith("--"))
    .map(prop => `${prop}: ${computed.getPropertyValue(prop)}`)
    .join("; ")
  if (targetEl.style) targetEl.style.cssText = styleStr

  const sourceChildren = sourceEl.children
  const targetChildren = targetEl.children
  for (let i = 0; i < sourceChildren.length; i++) {
    if (targetChildren[i]) inlineStyles(sourceChildren[i], targetChildren[i])
  }
}

// Best effort : on ne touche pas aux images cross-origin (CORS would block).
// Hook réservé pour évolution future (ex. inline base64). Ne fait rien aujourd'hui.
// Pour un rendu fidèle, préférer html-to-image.
function inlineImagesAsDataURL(/* node */) {}

// ─── React hook practique ────────────────────────────────────────────────────
/**
 * useExport() — hook qui expose les actions d'export et un compteur "isExporting".
 * Utilisation :
 *   const { exportElementAsPng, printDashboard, exportCsv, isExporting } = useExport()
 */
import { useState, useCallback } from "react"

export function useExport() {
  const [isExporting, setIsExporting] = useState(false)

  const wrap = useCallback(async fn => {
    setIsExporting(true)
    try { await fn() } finally { setIsExporting(false) }
  }, [])

  return {
    exportElementAsPng: (el, name, opts) => wrap(() => exportElementAsPng(el, name, opts)),
    exportSvgAsPng: (svg, name, opts) => wrap(() => exportSvgAsPng(svg, name, opts)),
    exportCsv: (rows, name, cols) => wrap(() => exportCsv(rows, name, cols)),
    printDashboard: title => wrap(() => printDashboard(title)),
    isExporting,
  }
}
