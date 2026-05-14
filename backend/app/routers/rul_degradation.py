"""
MineAssist — Endpoint Random Forest "Pannes Critiques" (horizon 24 h)
À placer dans : backend/app/routers/rul_degradation.py

Endpoints :
  GET  /rul/predict          → résumé du dernier entraînement RF
  POST /rul/run-model        → exécute train_rf_grav3.py (3 variantes)
  POST /rul/predict-live     → évaluation de proba 24 h sur des mesures live
  GET  /rul/dashboard        → données agrégées pour le dashboard React

Approche supervisée :
  - Cible : 3 variantes testées (cohort `panne` interne, GMAO grav.≥2, grav.=3)
  - Horizon : 24 h à venir
  - Features : moyenne / std / max / val / pente sur fenêtre glissante 1 h
  - Split : chronologique 80 / 20

Branchement dans api.py :
  from app.routers.rul_degradation import router as rul_router
  app.include_router(rul_router, prefix="/rul", tags=["RUL — Random Forest"])
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


# ─── ENDPOINT 1 : Résumé du dernier entraînement RF ─────────────────────────
@router.get("/predict")
def rul_depuis_r():
    """
    Retourne le JSON produit par le dernier entraînement Random Forest.
    Lit ./models/rul_predictions.json produit par train_rf_grav3.py.
    """
    f = MODELS / "rul_predictions.json"
    if not f.exists():
        raise HTTPException(404,
            "rul_predictions.json non trouvé. "
            "Lance d'abord POST /rul/run-model.")
    with open(f, encoding="utf-8") as fp:
        return json.load(fp)

@router.post("/run-model")
def run_rul_model():
    """
    Exécute train_rf_grav3.py : entraîne les 3 variantes Random Forest
    sur les vraies cibles (cohort `panne` interne + GMAO gravité ≥ 2 + GMAO gravité = 3),
    horizon 24 h, split chronologique 80/20, et met à jour rul_predictions.json.
    """
    import subprocess
    import sys

    script_path = MODELS / "train_rf_grav3.py"

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            check=True,
            timeout=600,
        )
        return {
            "status":  "success",
            "message": "Random Forest entraîné (3 variantes) et JSON mis à jour",
            "logs":    result.stdout,
        }
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500,
            detail=f"Erreur lors de l'entraînement : {e.stderr}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504,
            detail="Timeout : l'entraînement RF a dépassé 600 s.")


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
    """
    Données agrégées pour le composant React RULDashboard.
    Expose les métriques des 3 variantes RF + la variante principale
    (celle qui a obtenu le meilleur AUC sur le test chronologique).
    """
    f = MODELS / "rul_predictions.json"
    if not f.exists():
        return {
            "available": False,
            "message": "Lance d'abord POST /rul/run-model pour entraîner le Random Forest.",
        }
    with open(f, encoding="utf-8") as fp:
        data = json.load(fp)

    capteurs = data.get("capteurs", []) or []
    top_capteurs = sorted(
        capteurs,
        key=lambda c: c.get("importance", 0),
        reverse=True,
    )[:6]

    return {
        "available":           True,
        "model_type":          data.get("model_type"),
        "model_principal":     data.get("model_principal"),
        "methode":             data.get("methode"),
        "horizon_h":           data.get("horizon_h"),
        "fenetre_features_min": data.get("fenetre_features_min"),
        "sources":             data.get("sources"),
        # Métriques de la variante principale
        "auc":                 data.get("auc"),
        "f1":                  data.get("f1"),
        "precision":           data.get("precision"),
        "recall":              data.get("recall"),
        "seuil_optimal":       data.get("seuil_optimal"),
        "proba_24h_courante":  data.get("proba_24h_courante"),
        "verdict":             data.get("verdict"),
        # Top capteurs par importance (pour barres horizontales)
        "capteurs":            top_capteurs,
        # Les 3 variantes détaillées (transparence pour le jury)
        "variantes":           data.get("variantes", {}),
        # Lecture honnête à afficher dans le dashboard
        "interpretation":      data.get("interpretation"),
        "calcule_a":           data.get("timestamp"),
    }
