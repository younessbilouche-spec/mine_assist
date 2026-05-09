# app/ocp/router.py
"""
Router principal OCP — regroupe tous les sous-routers de maintenance prédictive.
Monté sous le préfixe /pred dans l'application principale.
"""
from fastapi import APIRouter
from app.ocp.routers import upload, sensors, health, defaut, alertes, prediction

ocp_router = APIRouter()

ocp_router.include_router(upload.router,     tags=["OCP - Upload"])
ocp_router.include_router(sensors.router,    tags=["OCP - Capteurs"])
ocp_router.include_router(defaut.router,     tags=["OCP - Défauts"])
ocp_router.include_router(health.router,     tags=["OCP - Santé"])
ocp_router.include_router(prediction.router, tags=["OCP - Prédiction"])
ocp_router.include_router(alertes.router,    tags=["OCP - Alertes"])