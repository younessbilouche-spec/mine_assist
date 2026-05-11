"""
explain_router.py — Sprint 3 (mai 2026)
========================================

Module additif d'explicabilité ML pour MineAssist.

Endpoints :
  POST /pred/rul/explain          → SHAP waterfall sur 1 prédiction RUL
  POST /pred/rul/anomaly/explain  → Capteurs contributeurs au score Isolation Forest
  GET  /pred/rul/drift             → Détection de dérive (KS test + PSI)

Ces 3 endpoints servent la PAGE EXPLICABILITÉ frontend qui transforme la
prédiction en quelque chose d'INTERPRÉTABLE pour le technicien :
  "Pourquoi RUL = 18h ? → engine_rpm anormalement bas (-12h) +
   converter_out_temp élevée (-7h) + rear_axle_temp normale (+2h)..."

Implémentation :
  - SHAP : utilise la méthode `predict(pred_contribs=True)` native d'XGBoost
    (Tree SHAP), pas de dépendance au package shap → léger.
  - PSI / KS : pure NumPy/SciPy.
"""

from __future__ import annotations
from app.ocp.routers.rul_router import (
    SELECTED_SENSORS,
    _build_features_from_wide,
    _models,
    _pivot_excel_to_wide,
    load_rul_models,
)

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("uvicorn.error")

# Réutilise les utilitaires du router RUL existant

explain_router = APIRouter(prefix="/pred/rul", tags=["Explicabilité ML"])


# ─── Pydantic models ─────────────────────────────────────────────────────────
class ExplainRequest(BaseModel):
    target: str = Field(
        default="global", description="global | moteur | transmission | hydraulique")
    use_current_file: bool = Field(default=True)
    point_index: int = Field(default=-1, description="Index du point à expliquer (-1 = dernier)")


# ─── Loaders ─────────────────────────────────────────────────────────────────
def _get_current_file() -> Path:
    return Path(__file__).resolve().parent.parent / "data" / "ocp_uploads" / "current_data.xlsx"


def _build_X_from_current() -> pd.DataFrame:
    """Charge le fichier capteurs courant et renvoie X (features 118 cols)."""
    f = _get_current_file()
    if not f.exists():
        raise HTTPException(404, "Aucun fichier capteurs courant.")
    try:
        df_raw = pd.read_excel(str(f), header=8)
    except Exception:
        df_raw = pd.read_excel(str(f))
    df_wide = _pivot_excel_to_wide(df_raw)
    X = _build_features_from_wide(df_wide)
    if len(X) == 0:
        raise HTTPException(422, "Aucune donnée exploitable dans le fichier.")
    return X


def _xgb_target(target: str):
    key_map = {
        "global": "xgb_global",
        "moteur": "xgb_moteur",
        "transmission": "xgb_transmission",
        "hydraulique": "xgb_hydraulique",
    }
    key = key_map.get(target.lower())
    if not key:
        raise HTTPException(400, f"Target invalide. Choisir parmi : {list(key_map.keys())}")
    model = _models.get(key)
    if model is None:
        raise HTTPException(503, f"Modèle {key} non chargé.")
    return model, key


# ─── /explain — SHAP waterfall ────────────────────────────────────────────────
@explain_router.post("/explain")
def rul_explain(req: ExplainRequest):
    """
    Calcule les contributions SHAP (Tree SHAP natif XGBoost) pour 1 point.
    Réponse :
    {
      "target": "global",
      "rul_h": 18.4,
      "base_value": 72.1,        # moyenne du modèle
      "contributions": [
        {"feature": "engine_rpm_mean_w12", "value": 1240.5, "shap": -12.3},
        {"feature": "converter_out_temp_mean_w12", "value": 96.2, "shap": -7.4},
        ...
      ]
    }
    """
    load_rul_models()
    X = _build_X_from_current()
    idx = req.point_index if req.point_index >= 0 else len(X) - 1
    if idx >= len(X) or idx < 0:
        raise HTTPException(400, f"point_index hors bornes [0..{len(X)-1}]")

    x_row = X.iloc[[idx]].copy()
    model, target_key = _xgb_target(req.target)

    # Tree SHAP natif XGBoost
    try:
        booster = model.get_booster() if hasattr(model, "get_booster") else model
        try:
            import xgboost as xgb
            dmat = xgb.DMatrix(x_row)
            shap_values = booster.predict(dmat, pred_contribs=True)
        except Exception as e:
            logger.warning(f"DMatrix failed: {e} — fallback sklearn API")
            shap_values = model.predict(x_row.values, pred_contribs=True)
        # shape : (1, n_features+1) où la dernière colonne = bias
        sv = np.asarray(shap_values).flatten()
        bias = float(sv[-1])
        feat_shap = sv[:-1]
    except Exception as e:
        logger.exception("SHAP failed")
        raise HTTPException(500, f"Erreur calcul SHAP : {e}")

    feat_names = list(X.columns)
    feat_vals = x_row.iloc[0].values

    contribs = []
    for fname, fval, sv_i in zip(feat_names, feat_vals, feat_shap):
        try:
            contribs.append({
                "feature": str(fname),
                "value": float(fval),
                "shap": float(sv_i),
            })
        except Exception:
            continue

    contribs.sort(key=lambda c: abs(c["shap"]), reverse=True)
    top_contribs = contribs[:15]

    rul_h = float(model.predict(x_row.values)[0])

    return {
        "target": req.target,
        "model": target_key,
        "rul_h": round(rul_h, 2),
        "base_value": round(bias, 2),
        "point_index": idx,
        "n_points": len(X),
        "timestamp": str(X.index[idx]) if hasattr(X.index[idx], '__str__') else None,
        "contributions": top_contribs,
        "n_total_features": len(feat_names),
    }


# ─── /anomaly/explain ─────────────────────────────────────────────────────────
class AnomalyExplainRequest(BaseModel):
    point_index: int = Field(default=-1)


@explain_router.post("/anomaly/explain")
def anomaly_explain(req: AnomalyExplainRequest):
    """
    Pour Isolation Forest : pas de SHAP natif, mais on peut estimer la
    contribution de chaque capteur en mesurant l'écart à la médiane
    pondéré par l'importance globale du capteur (z-score normalisé).
    """
    load_rul_models()
    iso = _models.get("iso_forest")
    scaler = _models.get("iso_scaler")
    if iso is None or scaler is None:
        raise HTTPException(503, "Isolation Forest non chargé.")

    X = _build_X_from_current()
    idx = req.point_index if req.point_index >= 0 else len(X) - 1
    if idx >= len(X) or idx < 0:
        raise HTTPException(400, f"point_index hors bornes")

    # Capteurs utilisés par l'Isolation Forest
    capteurs_iso = [
        "engine_rpm_mean_w12",
        "converter_out_temp_mean_w12",
        "rear_axle_temp_mean_w12",
        "brake_oil_temp_mean_w12",
        "air_tank_pressure_mean_w12",
        "steering_oil_temp_mean_w12",
    ]
    # Filtre sur colonnes existantes
    capteurs_iso = [c for c in capteurs_iso if c in X.columns]

    if not capteurs_iso:
        raise HTTPException(500, "Aucun capteur Iso Forest trouvé dans X.")

    x_full = X[capteurs_iso].iloc[idx].values.reshape(1, -1)
    try:
        x_scaled = scaler.transform(x_full)
        score = float(iso.score_samples(x_scaled)[0])
        is_anomaly = bool(iso.predict(x_scaled)[0] == -1)
    except Exception as e:
        raise HTTPException(500, f"Erreur Iso Forest : {e}")

    # Contribution heuristique : |z-score| de chaque capteur vs distribution X
    contribs = []
    for i, cname in enumerate(capteurs_iso):
        col = X[cname].dropna()
        if len(col) < 5:
            continue
        med = float(col.median())
        mad = float((col - med).abs().median()) or 1e-6
        val = float(x_full[0, i])
        z = (val - med) / mad
        # Cherche le nom court du capteur (sans suffix _mean_w12)
        short = cname.replace("_mean_w12", "")
        contribs.append({
            "capteur": short,
            "feature": cname,
            "value": val,
            "median_train": med,
            "z_score": round(z, 2),
            "abs_contribution": round(abs(z), 2),
        })

    contribs.sort(key=lambda c: c["abs_contribution"], reverse=True)

    return {
        "score": round(score, 4),
        "is_anomaly": is_anomaly,
        "interpretation": (
            "Anomalie détectée — score < seuil" if is_anomaly
            else "Comportement normal — score >= seuil"
        ),
        "point_index": idx,
        "contributions": contribs,
    }


# ─── /drift — Détection de dérive ─────────────────────────────────────────────
@explain_router.get("/drift")
def drift_detection(reference_n: int = 1000, current_n: int = 200):
    """
    Compare la distribution actuelle (N derniers points du fichier courant) à
    une distribution de référence (premiers points = baseline).

    Tests appliqués pour chaque capteur :
      - PSI (Population Stability Index)  : <0.1 stable | 0.1-0.25 modéré | >0.25 dérive
      - KS-statistic (Kolmogorov-Smirnov) : 0=identique | 1=très différent

    Réponse :
      drift_status : "stable" | "warning" | "drift"
      capteurs_drift : liste capteurs avec PSI > 0.25
    """
    load_rul_models()
    X = _build_X_from_current()

    if len(X) < (reference_n + current_n):
        ref_n = max(50, len(X) // 3)
        cur_n = max(20, len(X) // 6)
    else:
        ref_n = reference_n
        cur_n = current_n

    ref = X.iloc[:ref_n]
    cur = X.iloc[-cur_n:]

    # Capteurs principaux à monitorer
    capteurs_check = []
    for c in SELECTED_SENSORS:
        for suffix in ["_mean_w12", "_mean_w6", ""]:
            col = c + suffix if suffix else c
            if col in X.columns:
                capteurs_check.append(col)
                break

    results = []
    for col in capteurs_check:
        ref_col = ref[col].dropna()
        cur_col = cur[col].dropna()
        if len(ref_col) < 10 or len(cur_col) < 5:
            continue

        # PSI
        psi = _compute_psi(ref_col.values, cur_col.values, bins=10)

        # KS-statistic (simple, sans dépendance scipy)
        ks_stat = _ks_statistic(ref_col.values, cur_col.values)

        if psi > 0.25:
            status = "drift"
        elif psi > 0.1:
            status = "warning"
        else:
            status = "stable"

        results.append({
            "capteur": col.replace("_mean_w12", "").replace("_mean_w6", ""),
            "feature": col,
            "psi": round(psi, 3),
            "ks_stat": round(ks_stat, 3),
            "ref_mean": round(float(ref_col.mean()), 2),
            "cur_mean": round(float(cur_col.mean()), 2),
            "ref_std": round(float(ref_col.std()), 2),
            "cur_std": round(float(cur_col.std()), 2),
            "status": status,
        })

    results.sort(key=lambda r: r["psi"], reverse=True)
    drift_capteurs = [r for r in results if r["status"] == "drift"]
    warn_capteurs = [r for r in results if r["status"] == "warning"]

    overall = "stable"
    if len(drift_capteurs) > 2:
        overall = "drift"
    elif len(drift_capteurs) > 0 or len(warn_capteurs) > 3:
        overall = "warning"

    return {
        "overall_status": overall,
        "n_drift": len(drift_capteurs),
        "n_warning": len(warn_capteurs),
        "n_stable": len(results) - len(drift_capteurs) - len(warn_capteurs),
        "ref_window": {"n_points": int(ref_n)},
        "cur_window": {"n_points": int(cur_n)},
        "details": results,
        "interpretation": (
            "Dérive significative détectée — réentraîner le modèle." if overall == "drift"
            else "Avertissement : surveiller la distribution." if overall == "warning"
            else "Distribution stable — modèle valide."
        ),
    }


def _compute_psi(ref: np.ndarray, cur: np.ndarray, bins: int = 10) -> float:
    """Population Stability Index — pure NumPy."""
    try:
        eps = 1e-6
        # Bins à partir de la distribution de référence
        edges = np.percentile(ref, np.linspace(0, 100, bins + 1))
        edges = np.unique(edges)
        if len(edges) < 3:
            return 0.0
        ref_hist, _ = np.histogram(ref, bins=edges)
        cur_hist, _ = np.histogram(cur, bins=edges)
        ref_pct = ref_hist / max(ref_hist.sum(), 1) + eps
        cur_pct = cur_hist / max(cur_hist.sum(), 1) + eps
        psi = np.sum((cur_pct - ref_pct) * np.log(cur_pct / ref_pct))
        return float(psi)
    except Exception:
        return 0.0


def _ks_statistic(a: np.ndarray, b: np.ndarray) -> float:
    """Kolmogorov-Smirnov 2-sample statistic (max écart entre CDFs)."""
    try:
        all_vals = np.sort(np.concatenate([a, b]))
        cdf_a = np.searchsorted(np.sort(a), all_vals, side="right") / len(a)
        cdf_b = np.searchsorted(np.sort(b), all_vals, side="right") / len(b)
        return float(np.max(np.abs(cdf_a - cdf_b)))
    except Exception:
        return 0.0
