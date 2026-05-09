# app/ocp/routers/prediction.py
# v3 : remplace le modèle CNN-LSTM par XGBoost + RandomForest (PFE 2025)
# Les endpoints restent identiques pour ne pas casser le frontend.

from typing import Optional
import os
import time
import threading
from fastapi import APIRouter, File, HTTPException, UploadFile, Request, Query
from fastapi.responses import JSONResponse

from app.ocp.utils.data_processing import load_data, clean_data
from pathlib import Path

router = APIRouter()

UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "data" / "ocp_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CURRENT_FILE = str(UPLOAD_DIR / "current_data.xlsx")

_DF_CACHE   = {"key": None, "df": None}
_RESULT_CACHE = {"key": None, "result": None}
_CACHE_LOCK = threading.Lock()


def _file_key(path: str) -> tuple:
    try:
        st = os.stat(path)
        return (path, st.st_mtime_ns, st.st_size)
    except FileNotFoundError:
        return (path, 0, 0)


def _get_clean_df(path: str):
    key = _file_key(path)
    with _CACHE_LOCK:
        if _DF_CACHE["key"] == key and _DF_CACHE["df"] is not None:
            return _DF_CACHE["df"]
    df = clean_data(load_data(path))
    with _CACHE_LOCK:
        _DF_CACHE["key"] = key
        _DF_CACHE["df"] = df
    return df


def _invalidate_caches(model_service=None):
    with _CACHE_LOCK:
        _DF_CACHE["key"]      = None
        _DF_CACHE["df"]       = None
        _RESULT_CACHE["key"]  = None
        _RESULT_CACHE["result"] = None


def _run_xgb_prediction(df):
    """Lance la prédiction XGBoost RUL sur le DataFrame courant."""
    try:
        import pandas as pd
        from app.ocp.routers.rul_router import (
            _models, _predict_rul, _build_features_from_wide, load_rul_models
        )
        load_rul_models()
        if not _models:
            return None

        # Renommer les colonnes du format CAT vers le format pipeline
        rename = {
            "Regime_moteur": "engine_rpm",
            "Pression_huile": "oil_pressure",
            "Temp_refroid": "coolant_temp",
            "Regime_conv": "converter_out_rpm",
            "Temp_conv": "converter_out_temp",
            "Temp_huile_dir": "steering_oil_temp",
            "Date": "timestamp",
        }
        df_rul = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
        X = _build_features_from_wide(df_rul)

        if len(X) == 0:
            return None

        result = _predict_rul(X)
        return result
    except Exception as e:
        import logging
        logging.getLogger("uvicorn.error").warning(f"[RUL] prediction.py fallback: {e}")
        return None


def _format_result_for_frontend(df, xgb_result, horizon=None):
    """
    Construit une réponse compatible avec le frontend PredictionPage.jsx existant.
    Les champs proba_1d / proba_1w / proba_2w sont mappés depuis le RUL.
    """
    import math

    if xgb_result is None:
        return {
            "alerte_active": False,
            "proba_recente": 0.0,
            "seuil_decision": 0.5,
            "horizon_min": 720,
            "nb_points_total": len(df),
            "statistiques": {"proba_max": 0, "proba_mean": 0, "nb_alertes": 0, "pct_alertes": 0},
            "points": [],
            "forecast": {},
            "model_info": {"model_type": "XGBoost_RUL", "note": "Modèle non chargé"},
            "prediction_rul": {"disponible": False},
        }

    rul_h = xgb_result["rul_heures"].get("global_grav2") or 168
    alert = xgb_result["alerte_globale"]
    proba_red    = xgb_result["alert_proba"].get("RED", 0)
    proba_orange = xgb_result["alert_proba"].get("ORANGE", 0)
    proba_green  = xgb_result["alert_proba"].get("GREEN", 0)

    # Construire des points simplifiés pour le graphique historique
    points = []
    try:
        from app.ocp.routers.rul_router import _models, _build_features_from_wide
        rename = {
            "Regime_moteur": "engine_rpm",
            "Pression_huile": "oil_pressure",
            "Temp_refroid": "coolant_temp",
            "Regime_conv": "converter_out_rpm",
            "Temp_conv": "converter_out_temp",
            "Temp_huile_dir": "steering_oil_temp",
            "Date": "timestamp",
        }
        df_rul = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
        X = _build_features_from_wide(df_rul)

        model_global = _models.get("xgb_global")
        if model_global and len(X) > 0:
            expected_cols = model_global.get_booster().feature_names
            import numpy as np
            stride = max(1, len(X) // 200)
            indices = list(range(0, len(X), stride))
            if indices[-1] != len(X) - 1:
                indices.append(len(X) - 1)
            for i in indices:
                row = X.iloc[[i]]
                X_al = row.reindex(columns=expected_cols, fill_value=0)
                rul_i = float(model_global.predict(X_al)[0])
                rul_i = max(0, min(rul_i, 168))
                # Convertir RUL → proba (1 - RUL/168)
                proba_i = 1 - (rul_i / 168)
                ts = X.index[i].strftime("%Y-%m-%dT%H:%M:%S") if hasattr(X.index[i], "strftime") else str(X.index[i])
                points.append({
                    "date":      ts,
                    "proba_1d":  round(proba_i, 4),
                    "proba_1w":  round(max(0, proba_i - 0.1), 4),
                    "proba_2w":  round(max(0, proba_i - 0.2), 4),
                    "alerte":    1 if rul_i < 24 else 0,
                    "rul_h":     round(rul_i, 1),
                })
    except Exception:
        pass

    return {
        "alerte_active":  alert == "RED",
        "proba_recente":  round(proba_red, 4),
        "seuil_decision": 0.5,
        "horizon_min":    720,
        "nb_points_total": len(df),
        "nb_points_pred":  len(points),
        "statistiques": {
            "proba_max":   round(proba_red, 4),
            "proba_mean":  round(proba_red, 4),
            "nb_alertes":  sum(1 for p in points if p.get("alerte")),
            "pct_alertes": round(100 * sum(1 for p in points if p.get("alerte")) / max(1, len(points)), 2),
        },
        "points":   points,
        "forecast": {},
        "model_info": {
            "model_type":        "XGBoost_RUL",
            "capteurs_utilises": xgb_result.get("capteurs_utilises", []),
            "rul_heures":        xgb_result["rul_heures"],
        },
        "prediction_rul": {
            "disponible":    True,
            "rul_heures":    xgb_result["rul_heures"],
            "alerte_globale": alert,
            "alert_proba":   xgb_result.get("alert_proba", {}),
        },
    }


@router.get("/prediction")
def predict_current(request: Request, horizon: Optional[int] = Query(None)):
    if not os.path.isfile(CURRENT_FILE):
        raise HTTPException(
            status_code=404,
            detail="Aucun fichier de données chargé. Utilisez POST /pred/upload d'abord."
        )

    cache_key = (_file_key(CURRENT_FILE), horizon)
    with _CACHE_LOCK:
        if _RESULT_CACHE["key"] == cache_key and _RESULT_CACHE["result"] is not None:
            cached = dict(_RESULT_CACHE["result"])
            cached["_cached"] = True
            return JSONResponse(cached)

    t0 = time.time()
    df = _get_clean_df(CURRENT_FILE)
    t_load = round((time.time() - t0) * 1000)

    t1 = time.time()
    xgb_result = _run_xgb_prediction(df)
    t_pred = round((time.time() - t1) * 1000)

    result = _format_result_for_frontend(df, xgb_result, horizon)
    result["_cached"]  = False
    result["_timing"]  = {"load_ms": t_load, "predict_ms": t_pred}

    with _CACHE_LOCK:
        _RESULT_CACHE["key"]    = cache_key
        _RESULT_CACHE["result"] = result

    return JSONResponse(result)


@router.post("/prediction/upload")
async def predict_from_upload(request: Request, file: UploadFile = File(...)):
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Seuls .xlsx et .xls sont acceptés.")

    import tempfile
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
    try:
        with os.fdopen(tmp_fd, "wb") as f:
            f.write(await file.read())
        df = clean_data(load_data(tmp_path))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    _invalidate_caches()
    xgb_result = _run_xgb_prediction(df)
    result = _format_result_for_frontend(df, xgb_result)
    return JSONResponse(result)


@router.get("/prediction/status")
def prediction_status(request: Request):
    """Retourne le statut des modèles XGBoost (compatibilité avec l'ancien endpoint LSTM)."""
    try:
        from app.ocp.routers.rul_router import _models, load_rul_models
        load_rul_models()
        return {
            "model_available":  len(_models) > 0,
            "model_type":       "XGBoost_RUL",
            "nb_modeles":       len(_models),
            "modeles_charges":  list(_models.keys()),
        }
    except Exception:
        return {"model_available": False, "model_type": "XGBoost_RUL"}


@router.post("/prediction/cache/clear")
def clear_cache(request: Request):
    _invalidate_caches()
    return {"ok": True, "message": "Cache vidé."}
