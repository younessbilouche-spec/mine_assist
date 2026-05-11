# ============================================================
# routers/sensors.py
# Details des capteurs, donnees en temps reel et troubleshooting
#
# GET /api/sensors              → liste + config des 6 capteurs
# GET /api/sensors/{col}        → config + guide de depannage
# GET /api/sensors/data         → serie temporelle nettoyee
# GET /api/sensors/data/{col}   → serie d un capteur
# ============================================================

import os
import math

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pathlib import Path

from app.ocp.utils.ocp_cache import labels_cached, load_clean_cached
from app.ocp.utils.data_processing import df_to_records
from app.ocp.utils.thresholds import (SENSORS_CONFIG, FEATURE_COLS, LABEL_NAMES,
                                      LABEL_COLORS, TROUBLESHOOTING_DB)

router = APIRouter()
UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "data" / "ocp_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CURRENT_FILE = str(UPLOAD_DIR / "current_data.xlsx")


def _load_current() -> pd.DataFrame:
    if not os.path.isfile(CURRENT_FILE):
        raise HTTPException(
            status_code=404,
            detail="Aucun fichier de donnees charge. "
                   "Utilisez POST /api/upload d abord.",
        )
    return load_clean_cached(CURRENT_FILE)


def _safe_val(v):
    """Convertit une valeur en type JSON-serialisable."""
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if hasattr(v, "item"):
        return v.item()
    if isinstance(v, (pd.Timestamp, np.datetime64)):
        return str(v)
    return v


# ─────────────────────────────────────────────────────────────
# LISTE DES CAPTEURS
# ─────────────────────────────────────────────────────────────

@router.get("/sensors")
def list_sensors():
    """Retourne la configuration de tous les capteurs."""
    result = []
    for col in FEATURE_COLS:
        cfg = SENSORS_CONFIG[col]
        result.append({
            "col":         col,
            "label":       cfg["label"],
            "unit":        cfg["unit"],
            "min_normal":  cfg["min_normal"],
            "max_normal":  cfg["max_normal"],
            "alarm":       cfg["alarm"],
            "alarm_dir":   cfg["alarm_dir"],
            "criticality": cfg["criticality"],
        })
    return result


# ─────────────────────────────────────────────────────────────
# SERIE TEMPORELLE COMPLETE  (doit etre avant /sensors/{col})
# ─────────────────────────────────────────────────────────────

@router.get("/sensors/data")
def sensors_data(
    max_points: int = Query(500, ge=50, le=5000,
                            description="Nombre max de points retournes (subsampling)"),
):
    """
    Retourne les donnees nettoyees de tous les capteurs
    avec le label de statut par point.
    """
    df = _load_current()
    labels = labels_cached(CURRENT_FILE)
    df = df.copy()
    df["label"] = labels
    df["label_name"] = [LABEL_NAMES.get(int(l), "?") for l in labels]
    df["label_color"] = [LABEL_COLORS.get(int(l), "#888") for l in labels]

    # Formater la date
    df["Date"] = df["Date"].dt.strftime("%Y-%m-%dT%H:%M:%S")

    # Subsampling si trop de points
    step = max(1, len(df) // max_points)
    df = df.iloc[::step].reset_index(drop=True)

    cols_out = ["Date"] + FEATURE_COLS + ["label", "label_name", "label_color"]
    df = df[[c for c in cols_out if c in df.columns]]

    return JSONResponse(df_to_records(df))


# ─────────────────────────────────────────────────────────────
# SERIE D UN CAPTEUR  (doit etre avant /sensors/{col})
# ─────────────────────────────────────────────────────────────

@router.get("/sensors/data/{col}")
def sensor_data_single(
    col: str,
    max_points: int = Query(500, ge=50, le=5000),
):
    """
    Retourne la serie temporelle d un capteur avec :
      - valeur brute
      - statut (label)
      - seuils pour affichage graphique
    """
    if col not in SENSORS_CONFIG:
        raise HTTPException(status_code=404,
                            detail=f"Capteur inconnu : {col}")

    df = _load_current()
    labels = labels_cached(CURRENT_FILE)
    cfg = SENSORS_CONFIG[col]

    out_df = pd.DataFrame({
        "date":       df["Date"].dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "value":      df[col],
        "label":      labels,
        "label_name": [LABEL_NAMES.get(int(l), "?") for l in labels],
    })

    step = max(1, len(out_df) // max_points)
    out_df = out_df.iloc[::step].reset_index(drop=True)

    return {
        "col":        col,
        "label":      cfg["label"],
        "unit":       cfg["unit"],
        "thresholds": {
            "min_normal": cfg["min_normal"],
            "max_normal": cfg["max_normal"],
            "alarm":      cfg["alarm"],
            "alarm_dir":  cfg["alarm_dir"],
        },
        "data": df_to_records(out_df),
    }


# ─────────────────────────────────────────────────────────────
# DETAIL D UN CAPTEUR + TROUBLESHOOTING
# ─────────────────────────────────────────────────────────────

@router.get("/sensors/{col}")
def sensor_detail(col: str):
    """
    Retourne la configuration detaillee d un capteur
    ainsi que les guides de depannage associes.
    """
    if col not in SENSORS_CONFIG:
        raise HTTPException(
            status_code=404,
            detail=f"Capteur inconnu : {col}. "
                   f"Valeurs valides : {FEATURE_COLS}",
        )
    cfg = SENSORS_CONFIG[col]

    # Trouver les fiches de depannage liees a ce capteur
    troubleshooting = []
    col_lower = col.lower()
    for key, fiche in TROUBLESHOOTING_DB.items():
        if any(part in key for part in col_lower.split("_")):
            troubleshooting.append(fiche)

    return {
        "col":           col,
        "label":         cfg["label"],
        "unit":          cfg["unit"],
        "min_abs":       cfg.get("min_abs"),
        "min_normal":    cfg["min_normal"],
        "max_normal":    cfg["max_normal"],
        "alarm":         cfg["alarm"],
        "alarm_dir":     cfg["alarm_dir"],
        "criticality":   cfg["criticality"],
        "troubleshooting": troubleshooting,
    }


# ─────────────────────────────────────────────────────────────
# TROUBLESHOOTING DATABASE
# ─────────────────────────────────────────────────────────────

@router.get("/troubleshooting")
def get_troubleshooting():
    """Retourne toute la base de depannage."""
    return list(TROUBLESHOOTING_DB.values())


@router.get("/troubleshooting/{fault_key}")
def get_troubleshooting_item(fault_key: str):
    """Retourne la fiche de depannage pour un type de panne."""
    fiche = TROUBLESHOOTING_DB.get(fault_key)
    if fiche is None:
        raise HTTPException(
            status_code=404,
            detail=f"Type de panne inconnu : {fault_key}. "
                   f"Valeurs valides : {list(TROUBLESHOOTING_DB.keys())}",
        )
    return fiche
