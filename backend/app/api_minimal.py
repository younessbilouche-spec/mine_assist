"""
Minimal API serveur — auth + endpoints stub pour démo/test sans dépendances ML.
Permet de lancer rapidement le backend sans TensorFlow / ChromaDB / sentence-transformers.
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.auth import auth_router

load_dotenv()

ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
]

app = FastAPI(title="MineAssist 994F - Minimal")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)


@app.get("/")
def root():
    return {"status": "ok", "mode": "minimal", "name": "MineAssist 994F"}


@app.get("/healthz")
def healthz():
    return {"ok": True}


# ── Stub endpoints renvoyant des données mock pour permettre aux pages ──
# de fonctionner sans l'environnement ML complet.
@app.get("/pred/rul/status")
def rul_status():
    return {
        "model_loaded": False,
        "mode": "mock",
        "metrics": {"mae_h": 21, "recall": 0.931, "n_capteurs": 6},
    }


@app.get("/pred/rul/predict/demo")
def rul_predict_demo():
    return {
        "rul_h": 156,
        "urgence": "PLANIFIÉE",
        "confidence": 0.78,
        "mode": "mock",
    }


@app.get("/gmao/anomaly-results")
def gmao_anomaly():
    return {"anomalies": [], "mode": "mock"}


@app.get("/gmao/stats")
def gmao_stats():
    return {"interventions": 0, "anomalies": 0, "mode": "mock"}
