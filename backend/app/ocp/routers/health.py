# ============================================================
# routers/health.py
# Indicateur de sante global de la chargeuse
#
# GET /api/health               → score sante global [0-100]
# GET /api/health/capteurs      → score par capteur
# GET /api/health/historique    → evolution du score dans le temps
# ============================================================

import os
import math

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pathlib import Path

from app.ocp.utils.ocp_cache import labels_cached, load_clean_cached
from app.ocp.utils.thresholds import SENSORS_CONFIG, FEATURE_COLS

router = APIRouter()
UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "data" / "ocp_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CURRENT_FILE = str(UPLOAD_DIR / "current_data.xlsx")

# Fenetre recente pour le score de sante (dernier N points)
RECENT_WINDOW = 720   # 720 × 2min = 24h


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
# CALCUL DU SCORE DE SANTE
# ─────────────────────────────────────────────────────────────

def _score_capteur(vals: np.ndarray, cfg: dict) -> float:
    """
    Calcule un score de sante [0, 100] pour un capteur.

    Score = 100 × proportion de points en zone normale
    Penalite additionnelle :
      - points en pre-alerte : -0.5 point chacun (normalise)
      - points en anomalie   : -1.5 point chacun
      - points critiques     : -3.0 points chacun
    """
    n   = len(vals)
    if n == 0:
        return 100.0

    al  = cfg["alarm"]
    mn  = cfg["min_normal"]
    mx  = cfg["max_normal"]

    if cfg["alarm_dir"] == "max":
        n_crit   = int((vals >= al).sum())
        n_anom   = int(((vals >= mx) & (vals < al)).sum())
        thresh_pa = mn + (mx - mn) * 0.90
        n_pa     = int(((vals >= thresh_pa) & (vals < mx)).sum())
    else:
        n_crit   = int((vals <= al).sum())
        n_anom   = int(((vals <= mn) & (vals > al)).sum())
        thresh_pa = mx - (mx - mn) * 0.90
        n_pa     = int(((vals <= thresh_pa) & (vals > mn)).sum())

    penalty = (n_pa * 0.5 + n_anom * 1.5 + n_crit * 3.0) / n * 100
    score   = max(0.0, 100.0 - penalty)
    return round(score, 1)


def _health_label(score: float) -> str:
    if score >= 90:
        return "Excellent"
    if score >= 75:
        return "Bon"
    if score >= 55:
        return "Moyen"
    if score >= 30:
        return "Mauvais"
    return "Critique"


def _health_color(score: float) -> str:
    if score >= 90:
        return "#22c55e"   # vert
    if score >= 75:
        return "#84cc16"   # vert-jaune
    if score >= 55:
        return "#f59e0b"   # orange
    if score >= 30:
        return "#ef4444"   # rouge
    return "#7c3aed"       # violet critique


# ─────────────────────────────────────────────────────────────
# SCORE GLOBAL
# ─────────────────────────────────────────────────────────────

@router.get("/health")
def health_global(include_capteurs: bool = Query(False, description="Inclure le detail par capteur")):
    """
    Score de sante global sur les dernieres 24h.
    Combine les scores individuels ponderes par criticite.
    """
    df = _load()

    # Fenetre recente
    window = min(RECENT_WINDOW, len(df))
    df_rec = df.iloc[-window:]

    scores = {}
    weights = {}
    for col, cfg in SENSORS_CONFIG.items():
        if col not in df_rec.columns:
            continue
        s = _score_capteur(df_rec[col].values, cfg)
        scores[col]  = s
        weights[col] = cfg.get("criticality", 1)

    # Score global pondere
    total_w  = sum(weights.values())
    score_g  = sum(scores[c] * weights[c] for c in scores) / total_w if total_w else 0

    labels   = labels_cached(CURRENT_FILE)[-window:]
    n_crit   = int((labels == 3).sum())
    n_anom   = int((labels == 2).sum())

    response = {
        "score":         round(score_g, 1),
        "label":         _health_label(score_g),
        "color":         _health_color(score_g),
        "fenetre_heures": round(window * 2 / 60, 1),
        "nb_points":     window,
        "points_critiques": n_crit,
        "points_anomalie":  n_anom,
        "scores_capteurs":  scores,
    }
    if include_capteurs:
        response["capteurs"] = _capteurs_from_df(df_rec)
    return response


def _capteurs_from_df(df_rec: pd.DataFrame):
    result = []
    for col, cfg in SENSORS_CONFIG.items():
        if col not in df_rec.columns:
            continue
        vals  = df_rec[col].values
        score = _score_capteur(vals, cfg)
        result.append({
            "col":         col,
            "label":       cfg["label"],
            "unit":        cfg["unit"],
            "score":       score,
            "etat":        _health_label(score),
            "color":       _health_color(score),
            "criticality": cfg.get("criticality", 1),
            "derniere_valeur": _safe(float(vals[-1])) if len(vals) > 0 else None,
            "valeur_min":  _safe(float(vals.min()))  if len(vals) > 0 else None,
            "valeur_max":  _safe(float(vals.max()))  if len(vals) > 0 else None,
            "valeur_moy":  _safe(float(vals.mean())) if len(vals) > 0 else None,
        })
    result.sort(key=lambda x: x["score"])
    return result


# ─────────────────────────────────────────────────────────────
# SCORES PAR CAPTEUR
# ─────────────────────────────────────────────────────────────

@router.get("/health/capteurs")
def health_capteurs():
    """Score de sante detaille pour chaque capteur."""
    df     = _load()
    window = min(RECENT_WINDOW, len(df))
    df_rec = df.iloc[-window:]

    return _capteurs_from_df(df_rec)


# ─────────────────────────────────────────────────────────────
# HISTORIQUE DU SCORE
# ─────────────────────────────────────────────────────────────

@router.get("/health/historique")
def health_historique(
    fenetre_h: int = Query(24, ge=1, le=168,
                           description="Fenetre glissante en heures pour chaque score"),
    max_points: int = Query(200, ge=20, le=1000,
                            description="Nombre max de points dans la serie"),
):
    """
    Evolution du score de sante global dans le temps.
    Calcule le score sur une fenetre glissante.
    """
    df     = _load()
    steps_fenetre = max(1, fenetre_h * 30)   # 30 pas/heure a 2 min

    # Subsampler d abord
    step_sub = max(1, len(df) // max_points)
    indices  = list(range(steps_fenetre, len(df), step_sub))

    records = []
    for i in indices:
        start  = max(0, i - steps_fenetre)
        df_win = df.iloc[start:i]
        if len(df_win) == 0:
            continue

        w_scores = []
        w_poids  = []
        for col, cfg in SENSORS_CONFIG.items():
            if col not in df_win.columns:
                continue
            s = _score_capteur(df_win[col].values, cfg)
            w_scores.append(s * cfg.get("criticality", 1))
            w_poids.append(cfg.get("criticality", 1))

        score_g = sum(w_scores) / sum(w_poids) if w_poids else 0
        date    = df["Date"].iloc[i - 1]

        records.append({
            "date":  date.strftime("%Y-%m-%dT%H:%M:%S"),
            "score": round(score_g, 1),
            "label": _health_label(score_g),
            "color": _health_color(score_g),
        })

    return {"fenetre_h": fenetre_h, "points": records}
