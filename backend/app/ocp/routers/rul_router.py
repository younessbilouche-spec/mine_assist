"""
router_rul.py — Endpoint de prédiction RUL via XGBoost + RandomForest
======================================================================
S'intègre dans l'application FastAPI mine_assist SANS toucher au code
LSTM existant. Ajoute les endpoints :

  GET  /rul/status          → état des modèles chargés
  POST /rul/predict         → prédiction RUL à partir d'un fichier Excel
  GET  /rul/predict/current → prédiction sur le fichier courant uploadé
  GET  /rul/alert-class     → classe d'alerte RED/ORANGE/GREEN temps réel

Modèles utilisés :
  - XGBoost entraîné sur 6 capteurs × 6 définitions de RUL
  - RandomForest classifier (RED / ORANGE / GREEN)
  - Isolation Forest (détection non-supervisée)
"""

import os
import json
import logging
import threading
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import joblib
from fastapi import APIRouter, File, HTTPException, UploadFile, Query
from fastapi.responses import JSONResponse

logger = logging.getLogger("uvicorn.error")

router = APIRouter()

# ─── Chemins ────────────────────────────────────────────────────────────────
MODELS_DIR = Path(__file__).resolve().parent.parent / "models" / "rul"

MODEL_FILES = {
    "xgb_global":       MODELS_DIR / "xgb_RUL_A_grav2.pkl",
    "xgb_moteur":       MODELS_DIR / "xgb_RUL_C_Moteur.pkl",
    "xgb_transmission": MODELS_DIR / "xgb_RUL_C_Transmission.pkl",
    "xgb_hydraulique":  MODELS_DIR / "xgb_RUL_C_Hydraulique.pkl",
    "rf_classifier":    MODELS_DIR / "rf_classifier.pkl",
    "iso_forest":       MODELS_DIR / "isolation_forest.pkl",
    "iso_scaler":       MODELS_DIR / "isolation_scaler.pkl",
}

# ─── 6 capteurs sélectionnés (score composite multi-critères) ───────────────
SELECTED_SENSORS = [
    "engine_rpm",       # Moteur      — score 0.756
    "converter_out_temp",  # Transmission — score 0.650
    "rear_axle_temp",   # Essieux     — score 0.507
    "brake_oil_temp",   # Freinage    — score 0.484
    "air_tank_pressure",# Pneumatique — score 0.451
    "steering_oil_temp",# Direction   — score 0.343
]

# Mapping noms de colonnes Excel OCP → noms courts du pipeline
COLUMN_MAPPING = {
    # Noms possibles dans les fichiers Excel CAT 994F
    "Régime moteur":                          "engine_rpm",
    "CH994.P1.Régime moteur":                 "engine_rpm",
    "Regime_moteur":                          "engine_rpm",
    "Température sortie convertisseur":        "converter_out_temp",
    "CH994.P1.Température sortie convertisseur": "converter_out_temp",
    "Temp_conv":                              "converter_out_temp",
    "Température essieux arrière":             "rear_axle_temp",
    "CH994.P2.Température essieux arrière":    "rear_axle_temp",
    "Température huile freinage":              "brake_oil_temp",
    "CH994.P1.Température huile freinage":     "brake_oil_temp",
    "Pression d'air au réservoir":             "air_tank_pressure",
    "CH994.P2.Pression d'air au réservoir":    "air_tank_pressure",
    "Température huile direction":             "steering_oil_temp",
    "CH994.P1.Température huile direction":    "steering_oil_temp",
    "Temp_huile_dir":                         "steering_oil_temp",
    # Noms alternatifs courants
    "Pression_huile":                         "oil_pressure",
    "Temp_refroid":                           "coolant_temp",
    "Regime_conv":                            "converter_out_rpm",
}

# Horizons d'alerte
ALERT_BANDS = {"RED": 24, "ORANGE": 72}

# ─── Chargement des modèles (une seule fois au démarrage) ───────────────────
_models = {}
_models_lock = threading.Lock()
_models_loaded = False


def load_rul_models():
    """Charge tous les modèles RUL en mémoire."""
    global _models_loaded
    with _models_lock:
        if _models_loaded:
            return

        logger.info("[RUL] Chargement des modèles XGBoost/RF/IsolationForest...")
        for name, path in MODEL_FILES.items():
            if path.exists():
                try:
                    _models[name] = joblib.load(path)
                    logger.info(f"[RUL] ✓ {name} chargé ({path.name})")
                except Exception as e:
                    logger.warning(f"[RUL] ✗ {name} : {e}")
            else:
                logger.warning(f"[RUL] Modèle absent : {path}")

        _models_loaded = True
        logger.info(f"[RUL] {len(_models)}/{len(MODEL_FILES)} modèles chargés.")


# ─── Feature Engineering (adapté au format Excel CAT mensuel) ───────────────

def _pivot_excel_to_wide(df_raw: pd.DataFrame) -> pd.DataFrame:
    """
    Convertit le format long Excel CAT (1 ligne par mesure de capteur)
    vers le format large (1 ligne par timestamp, 1 colonne par capteur).
    """
    # Détecter les colonnes clés
    col_param = next((c for c in df_raw.columns if "paramètre" in str(c).lower() or "parametre" in str(c).lower()), None)
    col_time = next((c for c in df_raw.columns if "heure" in str(c).lower() or "time" in str(c).lower() or "date" in str(c).lower()), None)
    col_val = next((c for c in df_raw.columns if "moyenne" in str(c).lower() or "moy" in str(c).lower()), None)

    if col_param is None or col_time is None or col_val is None:
        # Peut-être déjà en format large
        return df_raw

    df_raw[col_time] = pd.to_datetime(df_raw[col_time], errors="coerce")
    df_raw = df_raw.dropna(subset=[col_time])
    df_raw[col_val] = pd.to_numeric(df_raw[col_val], errors="coerce")

    # Mapper les noms de paramètres vers les noms courts
    df_raw["_short"] = df_raw[col_param].map(COLUMN_MAPPING)
    df_raw = df_raw.dropna(subset=["_short"])

    # Pivoter : 1 ligne par timestamp, 1 colonne par capteur
    pivot = df_raw.pivot_table(
        index=col_time, columns="_short", values=col_val,
        aggfunc="mean",
    )
    pivot.index.name = "timestamp"
    return pivot.reset_index()


def _build_features_from_wide(df: pd.DataFrame, timestamp_col: str = "timestamp") -> pd.DataFrame:
    """
    Construit les features pour le modèle RUL à partir d'un DataFrame large.
    Reproduit le feature engineering du pipeline (rolling stats, slopes, thresholds).
    """
    df = df.set_index(timestamp_col).sort_index()
    df = df.resample("1h").mean()

    feature_dfs = []

    # Valeurs brutes (moyennes par capteur)
    raw = df[[c for c in SELECTED_SENSORS if c in df.columns]].copy()
    raw.columns = [f"{c}_mean" for c in raw.columns]
    feature_dfs.append(raw)

    # Rolling stats (6h, 24h, 72h, 168h)
    for sensor in SELECTED_SENSORS:
        if sensor not in df.columns:
            continue
        s = df[sensor]
        for w in [6, 24, 72, 168]:
            roll = s.rolling(window=w, min_periods=max(2, w // 4))
            feature_dfs.append(roll.mean().rename(f"{sensor}_mean_roll{w}h_mean").to_frame())
            feature_dfs.append(roll.std().rename(f"{sensor}_mean_roll{w}h_std").to_frame())
            feature_dfs.append(roll.min().rename(f"{sensor}_mean_roll{w}h_min").to_frame())
            feature_dfs.append(roll.max().rename(f"{sensor}_mean_roll{w}h_max").to_frame())

    # Pentes (slopes sur 6h et 24h)
    for sensor in SELECTED_SENSORS:
        if sensor not in df.columns:
            continue
        s = df[sensor]
        for w in [6, 24]:
            feature_dfs.append(((s - s.shift(w)) / w).rename(f"{sensor}_mean_slope{w}h").to_frame())

    # Features temporelles
    time_feats = pd.DataFrame(index=df.index)
    time_feats["hour_sin"] = np.sin(2 * np.pi * df.index.hour / 24)
    time_feats["hour_cos"] = np.cos(2 * np.pi * df.index.hour / 24)
    time_feats["day_of_week"] = df.index.dayofweek
    time_feats["is_weekend"] = (df.index.dayofweek >= 5).astype(int)
    feature_dfs.append(time_feats)

    X = pd.concat(feature_dfs, axis=1)
    X = X.ffill().fillna(0)
    return X


def _predict_rul(X: pd.DataFrame) -> dict:
    """Lance la prédiction RUL sur toutes les cibles et retourne le résultat."""
    if not _models:
        raise HTTPException(503, detail="Modèles RUL non chargés. Contactez l'administrateur.")

    results = {}
    last_point = X.tail(1) if len(X) > 0 else X

    # Aligner les colonnes sur ce que le modèle attend
    for name, model in _models.items():
        if not name.startswith("xgb_"):
            continue
        try:
            expected_cols = model.get_booster().feature_names
            # Ajouter les colonnes manquantes avec 0, supprimer les inconnues
            X_aligned = last_point.reindex(columns=expected_cols, fill_value=0)
            rul_h = float(model.predict(X_aligned)[0])
            rul_h = max(0.0, min(rul_h, 336.0))
            results[name] = rul_h
        except Exception as e:
            logger.warning(f"[RUL] predict {name} : {e}")
            results[name] = None

    # Classification d'alerte (RF)
    alert_class = None
    alert_proba = {}
    if "rf_classifier" in _models:
        try:
            model_clf = _models["rf_classifier"]
            expected_cols = model_clf.feature_names_in_
            X_clf = last_point.reindex(columns=expected_cols, fill_value=0)
            pred_class = model_clf.predict(X_clf)[0]
            alert_class = str(pred_class)
            proba = model_clf.predict_proba(X_clf)[0]
            for cls, p in zip(model_clf.classes_, proba):
                alert_proba[str(cls)] = round(float(p), 3)
        except Exception as e:
            logger.warning(f"[RUL] classifier : {e}")

    # Isolation Forest (anomalie non-supervisée)
    iso_score = None
    iso_is_anomaly = None
    if "iso_forest" in _models and "iso_scaler" in _models:
        try:
            sensor_cols = [f"{s}_mean" for s in SELECTED_SENSORS if f"{s}_mean" in last_point.columns]
            if sensor_cols:
                X_iso = _models["iso_scaler"].transform(last_point[sensor_cols].fillna(0))
                iso_score = float(_models["iso_forest"].score_samples(X_iso)[0])
                iso_is_anomaly = bool(_models["iso_forest"].predict(X_iso)[0] == -1)
        except Exception as e:
            logger.warning(f"[RUL] isolation_forest : {e}")

    # Déterminer l'alerte globale à partir du RUL principal
    rul_global = results.get("xgb_global")
    if rul_global is not None:
        if rul_global < ALERT_BANDS["RED"]:
            global_alert = "RED"
        elif rul_global < ALERT_BANDS["ORANGE"]:
            global_alert = "ORANGE"
        else:
            global_alert = "GREEN"
    else:
        global_alert = alert_class or "UNKNOWN"

    return {
        "rul_heures": {
            "global_grav2":  results.get("xgb_global"),
            "moteur":        results.get("xgb_moteur"),
            "transmission":  results.get("xgb_transmission"),
            "hydraulique":   results.get("xgb_hydraulique"),
        },
        "alert_class":       alert_class,
        "alert_proba":       alert_proba,
        "alerte_globale":    global_alert,
        "alerte_active":     global_alert == "RED",
        "isolation_forest":  {
            "score":      iso_score,
            "is_anomaly": iso_is_anomaly,
        },
        "nb_points":    len(X),
        "capteurs_utilises": SELECTED_SENSORS,
        "modeles": {
            "xgb_global": "XGBoost — RUL global (gravité ≥ 2)",
            "xgb_moteur": "XGBoost — RUL sous-système Moteur",
            "xgb_transmission": "XGBoost — RUL sous-système Transmission",
            "xgb_hydraulique": "XGBoost — RUL sous-système Hydraulique",
            "rf_classifier": "Random Forest — Classification RED/ORANGE/GREEN",
        },
    }


# ─── Endpoint historique (série temporelle des prédictions) ─────────────────

def _predict_history(X: pd.DataFrame, stride: int = 24) -> list:
    """
    Calcule le RUL sur une fenêtre glissante pour l'affichage historique.
    stride=24 → 1 prédiction par jour (rapide).
    """
    points = []
    model_global = _models.get("xgb_global")
    if model_global is None:
        return points

    try:
        expected_cols = model_global.get_booster().feature_names
    except Exception:
        return points

    indices = list(range(0, len(X), stride))
    if len(indices) > 0 and indices[-1] != len(X) - 1:
        indices.append(len(X) - 1)

    for i in indices:
        row = X.iloc[[i]]
        try:
            X_aligned = row.reindex(columns=expected_cols, fill_value=0)
            rul = float(model_global.predict(X_aligned)[0])
            rul = max(0.0, min(rul, 168.0))
            ts = X.index[i].strftime("%Y-%m-%dT%H:%M:%S") if hasattr(X.index[i], "strftime") else str(X.index[i])
            if rul < ALERT_BANDS["RED"]:
                alert = "RED"
            elif rul < ALERT_BANDS["ORANGE"]:
                alert = "ORANGE"
            else:
                alert = "GREEN"
            points.append({"date": ts, "rul_h": round(rul, 1), "alert": alert})
        except Exception:
            continue

    return points


# ─── ENDPOINTS ──────────────────────────────────────────────────────────────

@router.get("/status")
def rul_status():
    """État des modèles RUL chargés."""
    load_rul_models()
    return {
        "modeles_charges": list(_models.keys()),
        "nb_modeles":      len(_models),
        "capteurs_cles":   SELECTED_SENSORS,
        "alert_bands":     ALERT_BANDS,
        "description": (
            "Modèles XGBoost + RF entraînés sur 11 mois de données "
            "CAT 994F1 OCP Benguerir (1.36M mesures, 6490 échantillons horaires)"
        ),
    }


@router.post("/predict")
async def predict_from_file(file: UploadFile = File(...)):
    """
    Prédiction RUL à partir d'un fichier Excel mensuel CAT.
    Accepte le même format que les fichiers capteurs mensuels.
    """
    load_rul_models()

    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(400, detail="Seuls .xlsx et .xls sont acceptés.")

    import tempfile
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
    try:
        with os.fdopen(tmp_fd, "wb") as f:
            f.write(await file.read())

        # Lire avec header=8 (format CAT)
        try:
            df_raw = pd.read_excel(tmp_path, header=8)
        except Exception:
            df_raw = pd.read_excel(tmp_path)

        df_wide = _pivot_excel_to_wide(df_raw)
        X = _build_features_from_wide(df_wide)

        if len(X) == 0:
            raise HTTPException(422, detail="Aucune donnée exploitable dans le fichier.")

        result = _predict_rul(X)
        history = _predict_history(X, stride=max(1, len(X) // 100))
        result["historique"] = history
        result["periode"] = {
            "debut": str(X.index.min()),
            "fin":   str(X.index.max()),
        }
        return JSONResponse(result)

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.get("/predict/demo")
def predict_demo():
    """
    Endpoint de démonstration : retourne une prédiction simulée
    (utile pour tester le frontend sans fichier).
    """
    load_rul_models()
    import random
    random.seed(42)
    rul = random.uniform(10, 120)
    alert = "RED" if rul < 24 else ("ORANGE" if rul < 72 else "GREEN")

    return {
        "rul_heures": {
            "global_grav2": round(rul, 1),
            "moteur":       round(rul * 1.2, 1),
            "transmission": round(rul * 0.9, 1),
            "hydraulique":  round(rul * 1.1, 1),
        },
        "alert_class":    alert,
        "alert_proba":    {"RED": 0.65, "ORANGE": 0.25, "GREEN": 0.10} if alert == "RED" else
                          {"RED": 0.15, "ORANGE": 0.60, "GREEN": 0.25},
        "alerte_globale":  alert,
        "alerte_active":   alert == "RED",
        "isolation_forest": {"score": -0.42, "is_anomaly": alert == "RED"},
        "demo": True,
        "capteurs_utilises": SELECTED_SENSORS,
    }
