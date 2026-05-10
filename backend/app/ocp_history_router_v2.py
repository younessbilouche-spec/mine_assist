"""
ocp_history_router_v2.py — Améliorations Sprint 1 (mai 2026)
=============================================================

Module additif qui apporte :
  - Endpoint agrégé /history/dashboard (1 seul fetch côté frontend)
  - Cache TTL 10 min (rechargement à chaud sans redémarrer le serveur)
  - Export Excel /history/export.xlsx
  - Métadonnées de fraîcheur (loaded_at)

USAGE dans api.py :
    from app.ocp_history_router_v2 import history_v2_router
    app.include_router(history_v2_router)
"""

from __future__ import annotations

import io
import threading
import time
from datetime import datetime
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

# Réutiliser la logique de l'ancien router (pas de duplication)
from app.ocp_history_router import (
    _cache,
    _ensure_loaded,
    _classify_panne,
    arrets_stats,
    arrets_types,
    arrets_timeline,
    arrets_list,
)

history_v2_router = APIRouter(prefix="/history", tags=["Historique Maintenance OCP v2"])


# ─── TTL cache wrapper ────────────────────────────────────────────────────────
_TTL_LOCK = threading.Lock()
_TTL_STATE = {"loaded_at": 0.0, "ttl_s": 600}  # 10 minutes


def _ensure_fresh():
    """Recharge les fichiers Excel si le cache est plus vieux que TTL."""
    with _TTL_LOCK:
        now = time.time()
        if not _cache["loaded"] or (now - _TTL_STATE["loaded_at"]) > _TTL_STATE["ttl_s"]:
            # Forcer rechargement
            _cache["loaded"] = False
            _cache["errors"] = []
            _ensure_loaded()
            _TTL_STATE["loaded_at"] = now


# ─── Endpoint agrégé /dashboard ───────────────────────────────────────────────
@history_v2_router.get("/dashboard")
def history_dashboard(
    engin: str = Query("all", description="994F1, 994F2, ou 'all'"),
    limit: int = Query(500, ge=1, le=5000),
):
    """
    Endpoint agrégé : renvoie en 1 seul appel toutes les données nécessaires
    à MaintenanceHistoryDashboard (stats, types, timeline, list).

    Avantage : 1 fetch au lieu de 5 → page x4 plus rapide à charger.
    """
    _ensure_fresh()

    try:
        stats    = arrets_stats(engin=engin)
        types    = arrets_types(engin=engin)
        timeline = arrets_timeline(engin=engin)
        liste    = arrets_list(engin=engin, limit=limit)
    except Exception as e:
        raise HTTPException(500, detail=f"Erreur agrégation history : {e}")

    return {
        "stats":    stats,
        "types":    types,
        "timeline": timeline,
        "list":     liste,
        "loaded_at":     _TTL_STATE["loaded_at"],
        "loaded_at_iso": datetime.fromtimestamp(_TTL_STATE["loaded_at"]).isoformat() if _TTL_STATE["loaded_at"] else None,
        "ttl_seconds":   _TTL_STATE["ttl_s"],
        "version":       "v2",
    }


# ─── Endpoint export Excel ────────────────────────────────────────────────────
@history_v2_router.get("/export.xlsx")
def history_export_xlsx(
    engin: str = Query("all"),
    category: Optional[str] = Query(None),
):
    """
    Export Excel des arrêts (filtré par engin et/ou catégorie).
    Utile pour le reporting OCP / révision en réunion.
    """
    _ensure_fresh()
    df = _cache["arrets"]
    if df is None or df.empty:
        raise HTTPException(404, detail="Aucune donnée à exporter")

    if engin and engin.lower() != "all":
        df = df[df["engin_std"] == engin]

    if category:
        df = df[df["categories"].apply(lambda cs: category in (cs or []))]

    # Nettoyer pour export — colonnes lisibles uniquement
    cols_keep = [c for c in [
        "DATE", "Equipement", "engin_std", "Description Arrêt",
        "Début Arrêt", "Fin Arrêt", "Durée", "duree_min",
        "Intervenant / ou avisé", "Intervenant", "categories", "_annee", "_fichier",
    ] if c in df.columns]
    df_export = df[cols_keep].copy()

    # categories list -> string
    if "categories" in df_export.columns:
        df_export["categories"] = df_export["categories"].apply(
            lambda x: ",".join(x) if isinstance(x, list) else str(x)
        )

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df_export.to_excel(writer, index=False, sheet_name="Arrets")
    buf.seek(0)

    fname = f"historique_arrets_{engin}_{datetime.now():%Y%m%d_%H%M}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ─── Endpoint reload manuel ───────────────────────────────────────────────────
@history_v2_router.post("/reload")
def history_reload():
    """Force le rechargement immédiat des fichiers Excel (admin)."""
    with _TTL_LOCK:
        _cache["loaded"] = False
        _cache["errors"] = []
    _ensure_fresh()
    return {
        "reloaded": True,
        "loaded_at": _TTL_STATE["loaded_at"],
        "n_arrets": len(_cache["arrets"]) if _cache["arrets"] is not None else 0,
    }
