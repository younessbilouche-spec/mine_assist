# ============================================================
# routers/alertes.py
# Alertes temps-reel et plan de maintenance
#
# GET /pred/alertes  → alertes actives + plan d interventions
#
# v2 PERF (perf_patch) :
#   - Utilise le modèle XGBoost/RF (rul_router) pour la prédiction RUL.
#   - Cache du DataFrame charge (mtime + size).
#   - Cache du resultat alertes complet (mtime + size).
# ============================================================

import os
import time
import math
import threading
from datetime import datetime

import numpy as np
import pandas as pd
from fastapi import APIRouter, Request

from app.ocp.utils.data_processing import load_data, clean_data, label_points
from app.ocp.utils.thresholds import SENSORS_CONFIG, FEATURE_COLS, TROUBLESHOOTING_DB
from pathlib import Path

router = APIRouter()
UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "data" / "ocp_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CURRENT_FILE = str(UPLOAD_DIR / "current_data.xlsx")

# Nb de points recents a analyser pour l etat courant (2h = 60 pts a 2min)
RECENT_WINDOW = 60

# Mapping capteur → cle TROUBLESHOOTING_DB
_SENSOR_FAULT_MAP = {
    "Temp_refroid":   "echauffement moteur thermique",
    "Pression_huile": "pression huile basse",
    "Temp_conv":      "surchauffe convertisseur",
    "Temp_huile_dir": "surchauffe huile direction",
}

# Urgence selon le niveau de depassement
_URGENCE_RANK = {"URGENCE": 3, "PLANIFIÉE": 2, "SURVEILLANCE": 1, "NORMALE": 0}

# ─────────────────────────────────────────────────────────────
# CACHE
# ─────────────────────────────────────────────────────────────
_DF_CACHE = {"key": None, "df": None}
_RESULT_CACHE = {"key": None, "result": None}
_LOCK = threading.Lock()


def _file_key(path: str) -> tuple:
    try:
        st = os.stat(path)
        return (path, st.st_mtime_ns, st.st_size)
    except FileNotFoundError:
        return (path, 0, 0)


def _get_clean_df(path: str):
    key = _file_key(path)
    with _LOCK:
        if _DF_CACHE["key"] == key and _DF_CACHE["df"] is not None:
            return _DF_CACHE["df"]
    df = clean_data(load_data(path))
    with _LOCK:
        _DF_CACHE["key"] = key
        _DF_CACHE["df"] = df
    return df


def _safe(v):
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _urgence_capteur(val: float, cfg: dict) -> str:
    """Calcule le niveau d urgence d un capteur selon sa valeur courante."""
    al = cfg["alarm"]
    mn = cfg["min_normal"]
    mx = cfg["max_normal"]
    if cfg["alarm_dir"] == "max":
        if val >= al:
            return "URGENCE"
        if val >= mx:
            return "PLANIFIÉE"
        if val >= mn + (mx - mn) * 0.90:
            return "SURVEILLANCE"
    else:
        if val <= al:
            return "URGENCE"
        if val <= mn:
            return "PLANIFIÉE"
        if val <= mx - (mx - mn) * 0.90:
            return "SURVEILLANCE"
    return "NORMALE"


def _urgence_rul(rul_heures) -> str:
    """Calcule le niveau d urgence base sur le RUL (Remaining Useful Life) en heures."""
    if rul_heures is None:
        return "NORMALE"
    if rul_heures < 24:
        return "URGENCE"
    if rul_heures < 72:
        return "PLANIFIÉE"
    if rul_heures < 120:
        return "SURVEILLANCE"
    return "NORMALE"


@router.get("/alertes")
def get_alertes(request: Request):
    """
    Combine violations capteurs et predictions LSTM pour generer
    un plan de maintenance priorise avec interventions recommandees.

    v2 PERF : utilise model_service.predict_last() (1 inference,
    pas l'inference complete sur toute la serie historique).
    """
    # ── 0. Cache result?
    file_key = _file_key(CURRENT_FILE)
    with _LOCK:
        if _RESULT_CACHE["key"] == file_key and _RESULT_CACHE["result"] is not None:
            cached = dict(_RESULT_CACHE["result"])
            cached["_cached"] = True
            return cached

    # ── 1. Charger et nettoyer les donnees
    if not os.path.isfile(CURRENT_FILE):
        return _empty_response("Aucun fichier de donnees charge.")

    t0 = time.time()
    df = _get_clean_df(CURRENT_FILE)
    t_load = round((time.time() - t0) * 1000)

    # Fenetre recente
    df_recent = df.tail(RECENT_WINDOW).reset_index(drop=True)
    if len(df_recent) == 0:
        return _empty_response("Donnees insuffisantes.")

    last_date = str(df_recent["Date"].iloc[-1]) if "Date" in df_recent.columns else ""

    # ── 2. Alertes capteurs (valeur mediane sur la fenetre recente)
    alertes_capteurs = []
    for col, cfg in SENSORS_CONFIG.items():
        if col not in df_recent.columns:
            continue
        vals = df_recent[col].dropna().values
        if len(vals) == 0:
            continue
        val_median = float(np.median(vals))
        val_max    = float(np.max(vals))
        val_min    = float(np.min(vals))
        urgence    = _urgence_capteur(val_median, cfg)

        if urgence == "NORMALE":
            continue

        fault_key    = _SENSOR_FAULT_MAP.get(col)
        interventions = []
        if fault_key and fault_key in TROUBLESHOOTING_DB:
            db_entry = TROUBLESHOOTING_DB[fault_key]
            interventions = db_entry.get("causes", [])

        seuil_ref = cfg["alarm"]
        val_affichee = val_max if cfg["alarm_dir"] == "max" else val_min

        alertes_capteurs.append({
            "id":               f"cap_{col}",
            "type":             "CAPTEUR",
            "urgence":          urgence,
            "capteur":          col,
            "capteur_label":    cfg["label"],
            "unite":            cfg["unit"],
            "valeur_actuelle":  round(val_affichee, 2),
            "valeur_mediane":   round(val_median, 2),
            "seuil_alarme":     seuil_ref,
            "alarm_dir":        cfg["alarm_dir"],
            "criticite":        cfg["criticality"],
            "message":          _message_capteur(col, cfg, val_affichee, urgence),
            "interventions":    interventions,
        })

    # ── 3. Alerte RUL (XGBoost + RandomForest)
    alerte_rul = None
    rul_prediction = {"disponible": False}
    t_pred = 0
    try:
        from app.ocp.routers.rul_router import _models, _predict_rul, _build_features_from_wide, _pivot_excel_to_wide, load_rul_models
        load_rul_models()
        if _models:
            t1 = time.time()
            # On construit les features à partir du df courant
            df_rul = df.rename(columns={
                "Regime_moteur": "engine_rpm",
                "Pression_huile": "oil_pressure",
                "Temp_refroid": "coolant_temp",
                "Regime_conv": "converter_out_rpm",
                "Temp_conv": "converter_out_temp",
                "Temp_huile_dir": "steering_oil_temp",
            })
            if "Date" in df_rul.columns:
                df_rul = df_rul.rename(columns={"Date": "timestamp"})
            from app.ocp.routers.rul_router import _build_features_from_wide
            X = _build_features_from_wide(df_rul)
            r = _predict_rul(X)
            t_pred = round((time.time() - t1) * 1000)
            rul_h = r["rul_heures"].get("global_grav2")
            rul_prediction = {
                "disponible":    True,
                "rul_heures":    r["rul_heures"],
                "alerte_globale": r["alerte_globale"],
                "alerte_active": r["alerte_active"],
                "alert_class":   r["alert_class"],
            }
            urgence_rul = _urgence_rul(rul_h)
            if urgence_rul != "NORMALE":
                rul_h_str = f"{rul_h:.0f}h" if rul_h else "—"
                alerte_rul = {
                    "id":            "rul_prediction",
                    "type":          "RUL",
                    "urgence":       urgence_rul,
                    "capteur":       None,
                    "capteur_label": "Prédiction IA — XGBoost RUL",
                    "unite":         "h",
                    "valeur_actuelle": round(rul_h or 0, 1),
                    "seuil_alarme":  72,
                    "message":       f"Panne probable dans {rul_h_str} ({r['alerte_globale']})",
                    "interventions": [],
                }
    except Exception as e:
        pass

    # ── 4. Fusionner et trier par urgence
    toutes_alertes = alertes_capteurs[:]
    if alerte_rul:
        toutes_alertes.append(alerte_rul)

    toutes_alertes.sort(
        key=lambda a: (_URGENCE_RANK.get(a["urgence"], 0), a.get("criticite", 0)),
        reverse=True,
    )

    # ── 5. Urgence globale
    urgence_globale = "NORMALE"
    for a in toutes_alertes:
        if _URGENCE_RANK.get(a["urgence"], 0) > _URGENCE_RANK.get(urgence_globale, 0):
            urgence_globale = a["urgence"]

    # ── 6. Plan de maintenance
    plan = _build_plan(toutes_alertes)

    result = {
        "timestamp":        last_date,
        "urgence_globale":  urgence_globale,
        "nb_alertes":       len(toutes_alertes),
        "alertes":          toutes_alertes,
        "plan_maintenance": plan,
        "prediction_rul":   rul_prediction,
        "_timing":          {"load_ms": t_load, "predict_ms": t_pred},
        "_cached":          False,
    }

    with _LOCK:
        _RESULT_CACHE["key"] = file_key
        _RESULT_CACHE["result"] = result

    return result


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _message_capteur(col: str, cfg: dict, valeur: float, urgence: str) -> str:
    label = cfg["label"]
    unite = cfg["unit"]
    seuil = cfg["alarm"]
    if urgence == "URGENCE":
        return f"{label} a atteint le seuil d'alarme ({valeur:.1f} {unite} / alarme: {seuil} {unite})"
    if urgence == "PLANIFIÉE":
        return f"{label} depasse la zone normale ({valeur:.1f} {unite})"
    return f"{label} approche de la zone de pre-alerte ({valeur:.1f} {unite})"


# Fonction _message_lstm supprimée — remplacée par le message inline dans alerte_rul


def _build_plan(alertes: list) -> list:
    plan = []
    echeances = {
        "URGENCE":      "Immédiat (< 2h)",
        "PLANIFIÉE":    "Court terme (< 24h)",
        "SURVEILLANCE": "Moyen terme (< 1 semaine)",
    }
    for i, alerte in enumerate(alertes):
        urgence = alerte["urgence"]
        echeance = echeances.get(urgence, "A planifier")

        if alerte["type"] == "CAPTEUR":
            action = f"Inspecter {alerte['capteur_label']} — {alerte['message']}"
        else:
            action = alerte["message"]

        plan.append({
            "priorite":   i + 1,
            "urgence":    urgence,
            "type":       alerte["type"],
            "action":     action,
            "capteur":    alerte.get("capteur"),
            "echeance":   echeance,
            "nb_causes":  len(alerte.get("interventions", [])),
        })
    return plan


def _empty_response(message: str) -> dict:
    return {
        "timestamp":        "",
        "urgence_globale":  "NORMALE",
        "nb_alertes":       0,
        "alertes":          [],
        "plan_maintenance": [],
        "prediction_rul":   {"disponible": False},
        "message":          message,
    }
