# ═══════════════════════════════════════════════════════════════════════
# backend/app/routers/ml_router.py  — VERSION CORRIGÉE v5
# Remplace entièrement l'ancien fichier ml_router.py
#
# Nouveaux endpoints ajoutés (en plus des anciens /status et /retrain) :
#   GET  /ml/health-history      → courbe Health Score pour le dashboard
#   GET  /ml/dashboard-summary   → résumé 24h pour la page d'accueil
#   POST /ml/predict             → prédiction temps réel
#
# Les anciens /ml/status et /ml/retrain sont conservés intacts.
# ═══════════════════════════════════════════════════════════════════════

import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth import get_current_user

router = APIRouter()

BASE_DIR        = Path(__file__).resolve().parent.parent.parent
MODEL_META      = BASE_DIR / "models" / "model_meta.json"
HEALTH_HISTORY  = BASE_DIR / "models" / "health_history.csv"
TRAIN_SCRIPT    = BASE_DIR / "train_anomaly.py"


# ─── Helpers ──────────────────────────────────────────────────────────

def _load_meta() -> dict:
    if not MODEL_META.exists():
        return {"status": "absent", "trained_at": None, "n_samples": 0}
    try:
        with open(MODEL_META, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"status": "erreur_lecture", "trained_at": None}


# ─── ENDPOINT 1 : status (inchangé) ───────────────────────────────────

@router.get("/status")
def ml_status():
    """État des modèles ML (Isolation Forest + Health Score R)."""
    meta = _load_meta()
    model_file  = BASE_DIR / "models" / "isolation_forest.pkl"
    history_ok  = HEALTH_HISTORY.exists()

    return {
        **meta,
        "model_file_exists":    model_file.exists(),
        "health_history_exists": history_ok,
        "model_size_kb": round(model_file.stat().st_size / 1024, 1)
                         if model_file.exists() else None,
    }


# ─── ENDPOINT 2 : retrain (inchangé) ──────────────────────────────────

@router.post("/retrain")
def ml_retrain(current_user: dict = Depends(get_current_user)):
    """Lance le ré-entraînement du modèle. Accès : admin ou chef."""
    if current_user.get("role") not in ("admin", "chef"):
        raise HTTPException(403, "Accès refusé. Rôle admin ou chef requis.")

    if not TRAIN_SCRIPT.exists():
        raise HTTPException(500, f"Script introuvable : {TRAIN_SCRIPT}")

    started_at = datetime.now().isoformat()

    try:
        result = subprocess.run(
            [sys.executable, str(TRAIN_SCRIPT)],
            capture_output=True, text=True, timeout=120,
            cwd=str(BASE_DIR),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Timeout : entraînement > 120 secondes.")
    except Exception as e:
        raise HTTPException(500, str(e))

    if result.returncode != 0:
        raise HTTPException(
            500, f"Échec (code {result.returncode}) : {result.stderr[-500:]}")

    return JSONResponse(content={
        "success":     True,
        "started_at":  started_at,
        "finished_at": datetime.now().isoformat(),
        "stdout_tail": result.stdout[-800:],
        "model_meta":  _load_meta(),
    })


# ─── ENDPOINT 3 : health-history (NOUVEAU — lit les résultats R) ──────

@router.get("/health-history")
def ml_health_history(days: int = 7):
    """
    Retourne la courbe Health Score calculée par le script R.
    Utilisé par le dashboard React pour afficher l'évolution.

    → Nécessite que resultats_ML/health_history.csv ait été copié
      dans backend/models/health_history.csv
    """
    if not HEALTH_HISTORY.exists():
        return {
            "error": "health_history.csv non trouvé. Lance mineassist_ML_SIMPLE.R puis copie le fichier.",
            "data": []
        }

    df = pd.read_csv(HEALTH_HISTORY)
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    # Filtrer sur les N derniers jours
    cutoff = df["timestamp"].max() - pd.Timedelta(days=days)
    df = df[df["timestamp"] >= cutoff]

    # Agrégation par heure pour ne pas saturer le frontend
    df["hour"] = df["timestamp"].dt.floor("h")
    agg = df.groupby("hour").agg(
        health_score  = ("health_score",  "mean"),
        anomaly_score = ("anomaly_score", "mean"),
        n_anomalies   = ("anomalie",       "sum"),
        mode          = ("mode", lambda x: int(x.mode()[0]) if len(x) > 0 else 0),
    ).reset_index()

    agg["health_score"]  = agg["health_score"].round(1)
    agg["anomaly_score"] = agg["anomaly_score"].round(4)
    agg["timestamp"]     = agg["hour"].dt.strftime("%Y-%m-%dT%H:%M:%S")

    # Statistiques globales sur la période
    stats = {
        "health_mean":    round(float(df["health_score"].mean()), 1),
        "health_min":     round(float(df["health_score"].min()),  1),
        "pct_below_70":   round(float((df["health_score"] < 70).mean() * 100), 1),
        "pct_below_30":   round(float((df["health_score"] < 30).mean() * 100), 1),
        "n_anomalies_if": int(df["anomalie"].sum()) if "anomalie" in df.columns else 0,
    }

    return {
        "days":    days,
        "n_points": len(agg),
        "stats":   stats,
        "data":    agg[["timestamp","health_score","anomaly_score","mode"]
                       ].to_dict(orient="records"),
    }


# ─── ENDPOINT 4 : dashboard-summary (NOUVEAU) ─────────────────────────

@router.get("/dashboard-summary")
def ml_dashboard_summary():
    """Résumé pour la carte ML de la page d'accueil."""
    meta = _load_meta()

    summary = {
        "model_ready": MODEL_META.exists(),
        "trained_at":  meta.get("trained_at"),
        "approach":    meta.get("approach", "engineering_grade_v5_R"),
        "modules":     meta.get("modules", []),
    }

    if HEALTH_HISTORY.exists():
        df = pd.read_csv(HEALTH_HISTORY)
        last_24h = df.tail(288)   # 288 × 5 min = 24h
        summary["last_24h"] = {
            "health_avg":   round(float(last_24h["health_score"].mean()), 1),
            "health_min":   round(float(last_24h["health_score"].min()),  1),
            "n_anomalies":  int(last_24h["anomalie"].sum())
                            if "anomalie" in last_24h.columns else 0,
            "n_points":     len(last_24h),
        }

    return summary


# ─── ENDPOINT 5 : predict (NOUVEAU — prédiction temps réel) ───────────

class MesuresInput(BaseModel):
    mesures:   dict
    timestamp: Optional[str] = None


@router.post("/predict")
def ml_predict(body: MesuresInput):
    """
    Calcule le Health Score en temps réel sur des mesures capteurs.

    Body : { "mesures": { "Température liquide refroidissement": 92.3, ... } }
    """
    # Seuils constructeur CAT
    SEUILS = {
        "Température liquide refroidissement":  {"max": 107, "alerte": 95},
        "Température échappement Droit":        {"max": 600, "alerte": 540},
        "Température échappement gauche":       {"max": 600, "alerte": 540},
        "Température sortie convertisseur":     {"max": 129, "alerte": 115},
        "Température huile direction":          {"max":  70, "alerte":  63},
        "Température huile freinage":           {"max":  70, "alerte":  63},
        "Température essieux arrière":          {"max":  90, "alerte":  80},
        "Régime moteur":                        {"max": 2100,"alerte": 1900},
        "Pression huile moteur":                {"min": 2.5, "alerte_min": 3},
        "Pression d'air au réservoir":          {"min": 400, "alerte_min": 500},
        "Pression embrayage impeller":          {"min": 1.5, "alerte_min": 2},
    }

    score = 100.0
    alertes = []

    for capteur, cfg in SEUILS.items():
        val = body.mesures.get(capteur)
        if val is None:
            continue
        val = float(val)

        if "max" in cfg:
            if val > cfg["max"]:
                penalite = min(100, 40 + (val - cfg["max"]) / cfg["max"] * 60)
                statut = "CRITIQUE"
            elif val > cfg["alerte"]:
                penalite = (val - cfg["alerte"]) / (cfg["max"] - cfg["alerte"]) * 40
                statut = "SURVEILLANCE"
            else:
                penalite, statut = 0, "OK"
        else:
            if val < cfg["min"]:
                penalite = min(100, 40 + (cfg["min"] - val) / cfg["min"] * 60)
                statut = "CRITIQUE"
            elif val < cfg["alerte_min"]:
                penalite = (cfg["alerte_min"] - val) / (cfg["alerte_min"] - cfg["min"]) * 40
                statut = "SURVEILLANCE"
            else:
                penalite, statut = 0, "OK"

        if penalite > 0:
            score = max(0, score - penalite)
            alertes.append({"capteur": capteur, "valeur": round(val, 2),
                            "statut": statut, "penalite": round(penalite, 1)})

    score = round(score, 1)

    if score >= 70:
        statut_global, message = "BON",          f"🟢 Machine normale. Health {score}/100."
    elif score >= 30:
        statut_global, message = "SURVEILLANCE", f"🟡 SURVEILLANCE — Health {score}/100. {len(alertes)} capteur(s) en alerte."
    else:
        statut_global, message = "CRITIQUE",     f"🔴 CRITIQUE — Health {score}/100. Arrêt préventif recommandé."

    return {
        "health_score":    score,
        "health_status":   statut_global,
        "capteurs_alerte": alertes,
        "message":         message,
        "timestamp":       body.timestamp or datetime.now().isoformat(),
    }
