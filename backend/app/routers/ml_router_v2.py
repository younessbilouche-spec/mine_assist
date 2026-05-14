"""
MineAssist — Router FastAPI pour le ML v2
Remplace entièrement ml_router.py existant.

Endpoints:
  GET  /ml/status              → État des 3 modèles
  POST /ml/retrain             → Ré-entraîner tous les modèles (admin)
  POST /ml/predict             → Prédiction sur mesures passées en JSON
  GET  /ml/anomaly-score/{ts}  → Score d'anomalie pour un timestamp
  GET  /ml/dashboard-data      → Données agrégées pour le dashboard

Ajouter dans api.py:
  from app.routers.ml_router_v2 import router as ml_router
  app.include_router(ml_router, prefix="/ml", tags=["ML v2"])
"""

import json, sys, subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth import get_current_user
from app.routers.inference import get_predictor

router = APIRouter()

BASE_DIR    = Path(__file__).resolve().parent.parent.parent
MODELS_DIR  = BASE_DIR / "models"
TRAIN_SCRIPT = BASE_DIR / "pipeline_ml_FINAL_v5.py"


# ─── Schémas Pydantic ─────────────────────────────────────────────────────────

class MesuresCapteurs(BaseModel):
    """Corps de la requête POST /ml/predict"""
    # Dict {nom_feature: valeur} — ex: {"Température_liquide_refroidissement__mean": 92.3}
    mesures: dict
    timestamp: Optional[str] = None  # ISO format, optionnel


class TrainRequest(BaseModel):
    """Corps de la requête POST /ml/retrain"""
    data_capteurs_path: Optional[str] = None  # Si None: utilise chemin par défaut
    gmao_path: Optional[str] = None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/status")
def ml_status():
    """
    Retourne l'état des 3 modèles ML.
    Pas d'authentification requise (info publique).
    """
    predictor = get_predictor(str(MODELS_DIR))
    return predictor.status


@router.post("/predict")
def ml_predict(body: MesuresCapteurs):
    """
    Score une mesure capteur en temps réel avec les 3 modèles.
    
    Body: {"mesures": {"Température_liquide_refroidissement__mean": 92.3, ...}}
    
    Retourne:
    {
        "anomaly_score": -0.12,          // IF score (plus bas = plus suspect)
        "is_anomaly_if": true,           // IF: anomalie ou non
        "alerte_imminente": true,        // Gradient Boosting: panne dans 30 min ?
        "proba_alerte": 0.73,            // Probabilité de panne
        "gravite_predite": 2,            // 0=OK, 1=info, 2=avert, 3=critique
        "gravite_label": "Avertissement",
        "capteurs_suspects": [...],
        "message": "🟠 AVERTISSEMENT — ..."
    }
    """
    predictor = get_predictor(str(MODELS_DIR))
    
    if not predictor._ready:
        raise HTTPException(
            status_code=503,
            detail="Modèles ML non disponibles. Lancez /ml/retrain d'abord."
        )
    
    result = predictor.predict(body.mesures)
    
    return {
        "timestamp":         body.timestamp or datetime.now().isoformat(),
        "anomaly_score":     result.anomaly_score,
        "is_anomaly_if":     result.is_anomaly_if,
        "alerte_imminente":  result.alerte_imminente,
        "proba_alerte":      result.proba_alerte,
        "gravite_predite":   result.gravite_predite,
        "gravite_label":     result.gravite_label,
        "capteurs_suspects": result.capteurs_suspects,
        "message":           result.message,
    }


@router.post("/retrain")
def ml_retrain(
    body: TrainRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    Lance le ré-entraînement complet des 3 modèles.
    Accès: admin ou chef uniquement.
    Durée: 30-90 secondes selon la taille des données.
    """
    if current_user.get("role") not in ("admin", "chef"):
        raise HTTPException(status_code=403, detail="Accès refusé (admin/chef requis)")
    
    if not TRAIN_SCRIPT.exists():
        raise HTTPException(status_code=500, detail=f"Script introuvable: {TRAIN_SCRIPT}")
    
    # Chemins par défaut
    data_path = body.data_capteurs_path or str(BASE_DIR / "data" / "capteurs")
    gmao_path = body.gmao_path or str(BASE_DIR / "data" / "gmao_anomalies.xlsx")
    
    started_at = datetime.now().isoformat()
    
    try:
        result = subprocess.run(
            [sys.executable, str(TRAIN_SCRIPT),
             "--data_capteurs", data_path,
             "--gmao", gmao_path],
            capture_output=True, text=True, timeout=180,
            cwd=str(BASE_DIR),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Timeout 180s dépassé")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur (code {result.returncode}): {result.stderr[-500:]}"
        )
    
    # Recharger le predictor avec les nouveaux modèles
    from app.routers import inference as inf_module
    inf_module._predictor_instance = None  # Reset singleton
    
    new_status = get_predictor(str(MODELS_DIR)).status
    
    return {
        "success":     True,
        "started_at":  started_at,
        "finished_at": datetime.now().isoformat(),
        "log_tail":    result.stdout[-1000:],
        "new_status":  new_status,
    }


@router.get("/dashboard-data")
def ml_dashboard_data(days: int = 7):
    """
    Données agrégées pour le dashboard React.
    Retourne l'historique des scores ML sur les N derniers jours.
    """
    results_file = MODELS_DIR / "train_results.csv"
    
    if not results_file.exists():
        return {"error": "Pas de données d'entraînement disponibles", "data": []}
    
    import pandas as pd
    df = pd.read_csv(results_file)
    
    if "ts_round" in df.columns:
        df["ts_round"] = pd.to_datetime(df["ts_round"])
        cutoff = df["ts_round"].max() - pd.Timedelta(days=days)
        df = df[df["ts_round"] >= cutoff]
    
    # Résumé par jour
    if "ts_round" in df.columns and "is_anomaly" in df.columns:
        df["date"] = df["ts_round"].dt.date.astype(str)
        daily = df.groupby("date").agg(
            n_points      = ("is_anomaly", "count"),
            n_anomalies   = ("is_anomaly", "sum"),
            mean_score    = ("anomaly_score", "mean"),
        ).reset_index()
        daily["pct_anomalies"] = (daily["n_anomalies"] / daily["n_points"] * 100).round(1)
        return {"data": daily.to_dict(orient="records"), "days": days}
    
    return {"data": [], "days": days}
