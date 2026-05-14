"""
MineAssist — Endpoint RUL par dégradation physique (MSDM)
À placer dans : backend/app/routers/rul_degradation.py

Endpoints :
  GET  /rul/predict          → RUL système depuis les résultats R
  GET  /rul/capteur/{nom}    → RUL d'un capteur spécifique
  POST /rul/predict-live     → RUL calculé en temps réel sur mesures reçues

Branchement dans api.py :
  from app.routers.rul_degradation import router as rul_router
  app.include_router(rul_router, prefix="/rul", tags=["RUL — MSDM"])
"""

import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router  = APIRouter()
BASE    = Path(__file__).resolve().parent.parent.parent
MODELS  = BASE / "models"

# ─── Seuils physiques (identiques au script R) ──────────────────────────────
CAPTEURS_CFG = {
    "Température liquide refroidissement":
        {"normal":75,  "alerte":95,  "critique":107, "type":"max", "amdec":16},
    "Température sortie convertisseur":
        {"normal":90,  "alerte":115, "critique":129, "type":"max", "amdec":12},
    "Température échappement Droit":
        {"normal":400, "alerte":540, "critique":600, "type":"max", "amdec":14},
    "Température échappement gauche":
        {"normal":400, "alerte":540, "critique":600, "type":"max", "amdec":14},
    "Pression huile moteur":
        {"normal":4.5, "alerte":3.0, "critique":2.5, "type":"min", "amdec":16},
    "Température huile freinage":
        {"normal":45,  "alerte":63,  "critique":70,  "type":"max", "amdec":15},
    "Température huile direction":
        {"normal":45,  "alerte":63,  "critique":70,  "type":"max", "amdec":12},
    "Température essieux arrière":
        {"normal":55,  "alerte":80,  "critique":90,  "type":"max", "amdec":10},
    "Pression d'air au réservoir":
        {"normal":700, "alerte":500, "critique":400, "type":"min", "amdec":13},
    "Régime moteur":
        {"normal":1500,"alerte":1900,"critique":2100,"type":"max", "amdec":14},
}


def calcul_DI(valeur: float, cfg: dict) -> float:
    """Indice de dégradation 0% (normal) → 100% (critique)."""
    if valeur is None or np.isnan(valeur):
        return 0.0
    if cfg["type"] == "max":
        if valeur <= cfg["normal"]:
            return 0.0
        return min(150, (valeur - cfg["normal"]) /
                   (cfg["critique"] - cfg["normal"]) * 100)
    else:
        if valeur >= cfg["normal"]:
            return 0.0
        return min(150, (cfg["normal"] - valeur) /
                   (cfg["normal"] - cfg["critique"]) * 100)


def estimer_rul(di: float, pente_par_jour: float) -> dict:
    """Estime le RUL en jours depuis l'indice de dégradation et la pente."""
    if pente_par_jour <= 0.05:
        return {"rul_jours": None, "verdict": "stable",
                "message": "Machine stable — aucune dégradation détectée"}
    rul = max(0, (100 - di) / pente_par_jour)
    marge = 0.25
    verdict = (
        "critique"     if rul < 7 else
        "alerte"       if rul < 21 else
        "surveillance" if rul < 60 else
        "stable"
    )
    return {
        "rul_jours":       round(rul, 1),
        "rul_min_jours":   round(rul * (1 - marge), 1),
        "rul_max_jours":   round(rul * (1 + marge), 1),
        "date_critique":   (datetime.now() + timedelta(days=rul)).strftime("%Y-%m-%d"),
        "verdict":         verdict,
        "message": (
            f"⛔ CRITIQUE — intervention dans {rul:.0f} jours" if verdict == "critique" else
            f"🔴 ALERTE — planifier maintenance dans {rul:.0f} jours" if verdict == "alerte" else
            f"🟡 SURVEILLANCE — zone dégradée, prévoir inspection" if verdict == "surveillance" else
            f"🟢 Stable — RUL > 60 jours"
        )
    }


# ─── ENDPOINT 1 : RUL depuis les résultats R ────────────────────────────────
@router.get("/predict")
def rul_depuis_r():
    """
    Retourne les prédictions RUL calculées par le script R.
    Lit ./models/rul_predictions.json produit par degradation_model.R.
    """
    f = MODELS / "rul_predictions.json"
    if not f.exists():
        raise HTTPException(404,
            "rul_predictions.json non trouvé. "
            "Lance mineassist_ML_SIMPLE.R puis run_degradation_model(pivot).")
    with open(f, encoding="utf-8") as fp:
        return json.load(fp)

@router.post("/run-model")
def run_rul_model():
    """
    Exécute le véritable modèle Machine Learning Python (Random Forest).
    Met à jour le fichier rul_predictions.json.
    """
    import subprocess
    import sys
    
    script_path = MODELS / "train_rul_ml.py"
    
    try:
        # Exécuter le script d'entraînement Python
        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            check=True
        )
        
        return {
            "status": "success", 
            "message": "Modèle Random Forest entraîné et RUL prédit avec succès",
            "logs": result.stdout
        }
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'entraînement : {e.stderr}")


# ─── ENDPOINT 2 : RUL temps réel depuis mesures capteurs ────────────────────
class MesuresRUL(BaseModel):
    mesures:      dict            # {nom_capteur: valeur}
    historique:   Optional[list] = None  # [{ts, mesures}] pour calc pente
    timestamp:    Optional[str]  = None


@router.post("/predict-live")
def rul_temps_reel(body: MesuresRUL):
    """
    Calcule le RUL en temps réel à partir des mesures actuelles.

    Sans historique : utilise des pentes par défaut issues du modèle R.
    Avec historique : calcule la pente réelle (régression linéaire).

    Body :
        mesures: {"Température liquide refroidissement": 98.5, ...}
    """
    resultats = {}
    rul_list  = []

    for capteur, cfg in CAPTEURS_CFG.items():
        val = body.mesures.get(capteur)
        if val is None:
            continue

        val = float(val)
        di  = calcul_DI(val, cfg)

        # Pente estimée depuis l'historique ou valeur par défaut prudente
        pente = 0.0
        if body.historique and len(body.historique) >= 5:
            dis = []
            for h in body.historique[-30:]:
                v_h = h.get("mesures", {}).get(capteur)
                if v_h is not None:
                    dis.append(calcul_DI(float(v_h), cfg))
            if len(dis) >= 5:
                x    = np.arange(len(dis), dtype=float)
                pente = float(np.polyfit(x, dis, 1)[0])  # points DI / point
                # Convertir en points / jour (1 point = 5 min → 288 points/j)
                pente = pente * 288
        else:
            # Pente par défaut : 0.5 point/jour (dégradation lente prudente)
            pente = 0.5 if di > 30 else 0.1

        rul_res = estimer_rul(di, pente)
        resultats[capteur] = {
            "valeur":          round(val, 2),
            "di_pct":          round(di, 1),
            "pente_par_jour":  round(pente, 3),
            "criticite_amdec": cfg["amdec"],
            **rul_res,
        }

        if rul_res.get("rul_jours") is not None:
            rul_list.append((rul_res["rul_jours"], cfg["amdec"]))

    # Fusion pondérée par criticité AMDEC
    if rul_list:
        vals    = np.array([r[0] for r in rul_list])
        weights = np.array([r[1] for r in rul_list], dtype=float)
        rul_sys = float(np.average(vals, weights=weights))
    else:
        rul_sys = None

    # Capteur pilote (RUL le plus court)
    cap_pilote = min(
        resultats.items(),
        key=lambda x: x[1].get("rul_jours") or 9999
    )[0] if resultats else None

    return {
        "timestamp":       body.timestamp or datetime.now().isoformat(),
        "rul_systeme_j":   round(rul_sys, 1) if rul_sys else None,
        "date_critique":   (datetime.now() + timedelta(days=rul_sys)).strftime("%Y-%m-%d")
                           if rul_sys else None,
        "capteur_pilote":  cap_pilote,
        "methode":         "Multi-Sensor Degradation Model (MSDM)",
        "reference":       "NASA CMAPSS + IEC 62402",
        "capteurs":        resultats,
        "interpretation":  (
            f"Le capteur '{cap_pilote}' est le plus dégradé. "
            f"RUL système estimé : {rul_sys:.0f} jours."
            if rul_sys else "Tous les capteurs sont stables."
        )
    }


# ─── ENDPOINT 3 : Dashboard RUL ─────────────────────────────────────────────
@router.get("/dashboard")
def rul_dashboard():
    """Données agrégées pour le composant React RUL Dashboard."""
    f = MODELS / "rul_predictions.json"
    if not f.exists():
        return {"available": False, "message": "Lance le pipeline R d'abord."}
    with open(f, encoding="utf-8") as fp:
        data = json.load(fp)

    capteurs = data.get("capteurs", [])
    urgents  = [c for c in capteurs if c.get("verdict") in ("critique", "alerte")]
    urgents.sort(key=lambda c: c.get("rul_jours", 999))

    return {
        "available":       True,
        "rul_systeme_j":   data.get("rul_systeme_j"),
        "date_critique":   data.get("date_critique"),
        "capteur_pilote":  data.get("capteur_pilote"),
        "n_en_alerte":     len(urgents),
        "capteurs_urgents": urgents[:3],
        "tous_capteurs":   capteurs,
        "calcule_a":       data.get("timestamp"),
    }
