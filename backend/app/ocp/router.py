# app/ocp/router.py
"""
Router principal OCP — regroupe tous les sous-routers de maintenance prédictive.
Monté sous le préfixe /pred dans l'application principale.
"""
from fastapi import APIRouter
from app.ocp.routers import upload, sensors, health, defaut, alertes, prediction
from app.ocp.routers.rul_router import router as rul_router, load_rul_models

# Re-export pour que api_gitlab.py puisse importer load_rul_models depuis ici
__all__ = ["ocp_router", "load_rul_models"]

ocp_router = APIRouter()

ocp_router.include_router(upload.router,     tags=["OCP - Upload"])
ocp_router.include_router(sensors.router,    tags=["OCP - Capteurs"])
ocp_router.include_router(defaut.router,     tags=["OCP - Défauts"])
ocp_router.include_router(health.router,     tags=["OCP - Santé"])
ocp_router.include_router(prediction.router, tags=["OCP - Prédiction"])
ocp_router.include_router(alertes.router,    tags=["OCP - Alertes"])
# ── Prédiction RUL via XGBoost + RandomForest ────────────────────────────────
ocp_router.include_router(rul_router, prefix="/rul", tags=["OCP - RUL XGBoost"])
