# ============================================================
# routers/defaut.py
# Analyse des defauts sur les donnees historiques reelles
#
# GET /api/defauts              → resume global (nb pannes, durees)
# GET /api/defauts/episodes     → liste des episodes de panne
# GET /api/defauts/capteur/{col}→ statistiques par capteur
# ============================================================

import os
import math
from datetime import datetime, timedelta
from typing import List, Dict

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pathlib import Path

from app.ocp.utils.ocp_cache import labels_cached, load_clean_cached
from app.ocp.utils.data_processing import clean_episodes
from app.ocp.utils.thresholds import (SENSORS_CONFIG, FEATURE_COLS, LABEL_NAMES,
                               LABEL_COLORS)

router = APIRouter()
UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "data" / "ocp_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CURRENT_FILE = str(UPLOAD_DIR / "current_data.xlsx")

FREQ_MIN = 2   # 2 minutes entre chaque point


def _load() -> pd.DataFrame:
    if not os.path.isfile(CURRENT_FILE):
        raise HTTPException(
            status_code=404,
            detail="Aucun fichier de donnees charge.",
        )
    return load_clean_cached(CURRENT_FILE)


def _safe(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if hasattr(v, "item"):
        return v.item()
    return v


# ─────────────────────────────────────────────────────────────
# RESUME GLOBAL
# ─────────────────────────────────────────────────────────────

@router.get("/defauts")
def defauts_summary():
    """
    Resume global des defauts detectes :
      - repartition des labels (Normal / Pre-alerte / Anomalie / Critique)
      - nombre et duree totale des episodes de panne
      - capteur le plus critique
    """
    df     = _load()
    labels = labels_cached(CURRENT_FILE)
    binary = clean_episodes(labels, anomaly_level=2)

    total  = len(labels)
    dist   = {
        LABEL_NAMES[k]: int((labels == k).sum())
        for k in sorted(LABEL_NAMES.keys())
    }
    pct    = {k: round(100 * v / total, 2) for k, v in dist.items()}

    # Episodes de panne
    episodes = _extract_episodes(binary, df["Date"].values)
    duree_totale_min = sum(ep["duree_min"] for ep in episodes)

    # Capteur le plus souvent en alarme
    alarm_counts = {}
    for col, cfg in SENSORS_CONFIG.items():
        if col not in df.columns:
            continue
        vals = df[col].values
        al   = cfg["alarm"]
        if cfg["alarm_dir"] == "max":
            alarm_counts[col] = int((vals >= al).sum())
        else:
            alarm_counts[col] = int((vals <= al).sum())
    top_capteur = max(alarm_counts, key=alarm_counts.get) if alarm_counts else None

    return {
        "nb_points":          total,
        "date_debut":         str(df["Date"].min()),
        "date_fin":           str(df["Date"].max()),
        "distribution_labels": dist,
        "pourcentages":       pct,
        "nb_episodes_panne":  len(episodes),
        "duree_totale_panne_min": duree_totale_min,
        "capteur_plus_critique": top_capteur,
        "alarmes_par_capteur": alarm_counts,
    }


# ─────────────────────────────────────────────────────────────
# ANALYSE AGREGEE (compatibilite frontend)
# ─────────────────────────────────────────────────────────────

@router.get("/defauts/analyse")
def defauts_analyse(
    include_summary: bool = Query(False, description="Inclure le resume global"),
):
    """
    Retourne l analyse agregee par capteur :
      exceeds_max   : capteurs depassant leur seuil d alarme MAX
      exceeds_min   : capteurs depassant leur seuil d alarme MIN
      faulty_sensors: capteurs avec donnees aberrantes (codes defaillants)
    """
    df  = _load()
    n   = len(df)

    exceeds_max    = []
    exceeds_min    = []
    faulty_sensors = []

    for col, cfg in SENSORS_CONFIG.items():
        if col not in df.columns:
            continue
        vals = df[col].values
        al   = cfg["alarm"]

        entry = {
            "sensor":      col,
            "label":       cfg["label"],
            "unit":        cfg["unit"],
            "criticality": cfg["criticality"],
        }

        if cfg["alarm_dir"] == "max":
            n_over = int((vals >= al).sum())
            if n_over > 0:
                exceeds_max.append({
                    **entry,
                    "over_max_pct":  round(100 * n_over / n, 2),
                    "alarm":         al,
                    "threshold_max": al,
                    "threshold_min": None,
                })
        else:
            n_under = int((vals <= al).sum())
            if n_under > 0:
                exceeds_min.append({
                    **entry,
                    "under_min_pct": round(100 * n_under / n, 2),
                    "alarm":         al,
                    "threshold_min": al,
                    "threshold_max": None,
                })

    response = {
        "total_records":  n,
        "exceeds_max":    exceeds_max,
        "exceeds_min":    exceeds_min,
        "faulty_sensors": faulty_sensors,
    }
    if include_summary:
        labels = labels_cached(CURRENT_FILE)
        binary = clean_episodes(labels, anomaly_level=2)
        dist = {LABEL_NAMES[k]: int((labels == k).sum()) for k in sorted(LABEL_NAMES.keys())}
        total = len(labels)
        response.update({
            "nb_points": total,
            "date_debut": str(df["Date"].min()),
            "date_fin": str(df["Date"].max()),
            "distribution_labels": dist,
            "pourcentages": {k: round(100 * v / total, 2) for k, v in dist.items()},
            "nb_episodes_panne": int(_count_episodes(binary)),
        })
    return response


def _count_episodes(binary: np.ndarray) -> int:
    if len(binary) == 0:
        return 0
    starts = (binary == 1) & (np.r_[0, binary[:-1]] == 0)
    return int(starts.sum())


# ─────────────────────────────────────────────────────────────
# LISTE DES EPISODES
# ─────────────────────────────────────────────────────────────

@router.get("/defauts/episodes")
def defauts_episodes(
    anomaly_level: int = Query(2, ge=1, le=3,
                               description="Niveau min pour considerer comme anomalie"),
    max_episodes:  int = Query(100, ge=1, le=500),
):
    """
    Liste des episodes de panne avec :
      - date debut/fin
      - duree en minutes
      - capteurs impliques
      - niveau max atteint
    """
    df     = _load()
    labels = labels_cached(CURRENT_FILE)
    binary = clean_episodes(labels, anomaly_level=anomaly_level)
    episodes = _extract_episodes(binary, df["Date"].values,
                                  labels=labels, df=df,
                                  max_eps=max_episodes)
    return {
        "anomaly_level": anomaly_level,
        "nb_episodes":   len(episodes),
        "episodes":      episodes,
    }


# ─────────────────────────────────────────────────────────────
# STATS PAR CAPTEUR
# ─────────────────────────────────────────────────────────────

@router.get("/defauts/capteur/{col}")
def defauts_capteur(col: str):
    """
    Statistiques d un capteur sur la periode historique :
      - min/max/mean/std
      - % du temps en zone normale / pre-alerte / anomalie / critique
      - nombre de depassements d alarme
    """
    if col not in SENSORS_CONFIG:
        raise HTTPException(status_code=404,
                            detail=f"Capteur inconnu : {col}")

    df  = _load()
    cfg = SENSORS_CONFIG[col]
    if col not in df.columns:
        raise HTTPException(status_code=422,
                            detail=f"Colonne {col} absente des donnees.")

    vals = df[col].values
    n    = len(vals)
    al   = cfg["alarm"]
    mn   = cfg["min_normal"]
    mx   = cfg["max_normal"]

    if cfg["alarm_dir"] == "max":
        n_critique  = int((vals >= al).sum())
        n_anomalie  = int(((vals >= mx) & (vals < al)).sum())
        n_prealerte = int(((vals >= mn + (mx - mn) * 0.90) & (vals < mx)).sum())
    else:
        n_critique  = int((vals <= al).sum())
        n_anomalie  = int(((vals <= mn) & (vals > al)).sum())
        n_prealerte = int(((vals <= mx - (mx - mn) * 0.90) & (vals > mn)).sum())

    n_normal = n - n_critique - n_anomalie - n_prealerte

    return {
        "col":        col,
        "label":      cfg["label"],
        "unit":       cfg["unit"],
        "nb_points":  n,
        "statistiques": {
            "min":   _safe(float(vals.min())),
            "max":   _safe(float(vals.max())),
            "mean":  _safe(float(vals.mean())),
            "std":   _safe(float(vals.std())),
        },
        "repartition": {
            "Normal":      n_normal,
            "Pre-alerte":  n_prealerte,
            "Anomalie":    n_anomalie,
            "Critique":    n_critique,
        },
        "pourcentages": {
            "Normal":     round(100 * n_normal     / n, 2),
            "Pre-alerte": round(100 * n_prealerte  / n, 2),
            "Anomalie":   round(100 * n_anomalie   / n, 2),
            "Critique":   round(100 * n_critique   / n, 2),
        },
        "seuils": {
            "min_normal": mn,
            "max_normal": mx,
            "alarm":      al,
            "alarm_dir":  cfg["alarm_dir"],
        },
    }


# ─────────────────────────────────────────────────────────────
# HELPER : EXTRACTION DES EPISODES
# ─────────────────────────────────────────────────────────────

def _extract_episodes(binary: np.ndarray,
                       dates:  np.ndarray,
                       labels: np.ndarray = None,
                       df: pd.DataFrame  = None,
                       max_eps: int       = 500) -> List[Dict]:
    """
    Extrait la liste des episodes de panne (binary == 1).
    """
    episodes = []
    i = 0
    while i < len(binary) and len(episodes) < max_eps:
        if binary[i] == 1:
            j = i
            while j < len(binary) and binary[j] == 1:
                j += 1
            # Episode [i, j)
            date_debut = pd.Timestamp(dates[i])
            date_fin   = pd.Timestamp(dates[j - 1])
            duree_min  = (j - i) * FREQ_MIN

            ep = {
                "id":         len(episodes) + 1,
                "date_debut": date_debut.strftime("%Y-%m-%dT%H:%M:%S"),
                "date_fin":   date_fin.strftime("%Y-%m-%dT%H:%M:%S"),
                "duree_min":  duree_min,
                "nb_points":  j - i,
            }

            # Niveau max
            if labels is not None:
                level_max = int(labels[i:j].max())
                ep["niveau_max"]  = level_max
                ep["niveau_name"] = LABEL_NAMES.get(level_max, "?")

            # Capteurs impliques
            if df is not None and labels is not None:
                impliques = []
                sub = df.iloc[i:j]
                for col, cfg in SENSORS_CONFIG.items():
                    if col not in df.columns:
                        continue
                    v   = sub[col].values
                    al  = cfg["alarm"]
                    if cfg["alarm_dir"] == "max":
                        n_al = int((v >= al).sum())
                    else:
                        n_al = int((v <= al).sum())
                    if n_al > 0:
                        impliques.append({
                            "col":       col,
                            "label":     cfg["label"],
                            "n_alarmes": n_al,
                        })
                ep["capteurs_impliques"] = impliques

            episodes.append(ep)
            i = j
        else:
            i += 1

    return episodes
