# ─────────────────────────────────────────────────────────────────────────────
# backend/app/routers/ml_router.py
#
# PROBLÈME ACTUEL :
#   - Le modèle Isolation Forest est entraîné UNE FOIS manuellement (train_anomaly.py)
#   - Pour ré-entraîner : relancer le script à la main en SSH
#   - Pas de feedback sur l'état du modèle en production
#
# SOLUTION : endpoint POST /ml/retrain qui re-lance l'entraînement depuis l'API
#   + GET /ml/status pour voir quand le modèle a été entraîné et ses métriques
#
# Ajouter dans api.py :
#   from app.routers.ml_router import router as ml_router
#   app.include_router(ml_router, prefix="/ml", tags=["ML"])
# ─────────────────────────────────────────────────────────────────────────────

import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse

# Import de la vérification auth existante (à adapter selon ton auth.py)
# from app.auth import require_role
# Pour l'instant on utilise une dépendance simple :
from app.auth import get_current_user

router = APIRouter()

BASE_DIR   = Path(__file__).resolve().parent.parent.parent
MODEL_META = BASE_DIR / "models" / "model_meta.json"
TRAIN_SCRIPT = BASE_DIR / "train_anomaly.py"


def _load_meta() -> dict:
    """Charge les métadonnées du modèle depuis model_meta.json"""
    if not MODEL_META.exists():
        return {"status": "absent", "trained_at": None, "n_samples": 0, "features": []}
    try:
        with open(MODEL_META, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"status": "erreur_lecture", "trained_at": None}


@router.get("/status")
def ml_status():
    """
    Retourne l'état actuel du modèle Isolation Forest.

    Réponse exemple :
    {
        "status": "ok",
        "trained_at": "2026-02-15T08:30:00",
        "n_samples": 17239,
        "features": ["Température liquide refroidissement", ...],
        "contamination": 0.05,
        "model_file_exists": true
    }
    """
    meta = _load_meta()
    model_file = BASE_DIR / "models" / "isolation_forest.pkl"
    scaler_file = BASE_DIR / "models" / "scaler.pkl"

    return {
        **meta,
        "model_file_exists":  model_file.exists(),
        "scaler_file_exists": scaler_file.exists(),
        "model_size_kb": round(model_file.stat().st_size / 1024, 1) if model_file.exists() else None,
    }


@router.post("/retrain")
def ml_retrain(current_user: dict = Depends(get_current_user)):
    """
    Lance le ré-entraînement du modèle Isolation Forest.

    ACCÈS : admin uniquement (vérification du rôle)

    Ce endpoint :
    1. Vérifie que l'utilisateur est admin
    2. Lance train_anomaly.py en sous-processus
    3. Retourne les nouvelles métriques du modèle

    Durée typique : 15-40 secondes selon la taille de la base.
    """
    # Vérification du rôle
    if current_user.get("role") not in ("admin", "chef"):
        raise HTTPException(
            status_code=403,
            detail="Accès refusé. Le ré-entraînement nécessite le rôle admin ou chef."
        )

    if not TRAIN_SCRIPT.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Script d'entraînement introuvable : {TRAIN_SCRIPT}"
        )

    started_at = datetime.now().isoformat()

    try:
        # Lance train_anomaly.py avec le même interpréteur Python que l'API
        result = subprocess.run(
            [sys.executable, str(TRAIN_SCRIPT)],
            capture_output=True,
            text=True,
            timeout=120,  # 2 minutes max
            cwd=str(BASE_DIR),
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=504,
            detail="Timeout : l'entraînement a dépassé 120 secondes."
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Erreur lors du lancement : {str(e)}"
        )

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"Entraînement échoué (code {result.returncode}) : {result.stderr[-500:]}"
        )

    # Lire les nouvelles métriques
    new_meta = _load_meta()

    return JSONResponse(content={
        "success":     True,
        "started_at":  started_at,
        "finished_at": datetime.now().isoformat(),
        "stdout_tail": result.stdout[-800:],   # dernières lignes du log
        "model_meta":  new_meta,
        "message":     (
            f"Modèle ré-entraîné avec succès sur {new_meta.get('n_samples', '?')} échantillons. "
            f"Le cache anomalies sera mis à jour au prochain appel à /gmao/anomaly-results."
        ),
    })
