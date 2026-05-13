"""
═══════════════════════════════════════════════════════════════════════════
MineAssist — 3 améliorations ingénieur (v6)
À placer dans : backend/app/routers/ml_improvements.py

  [1] Prédiction P-F interval  → GET  /ml/predict-failure
  [2] Seuils dynamiques K-Means → POST /ml/health-dynamic
  [3] Recommandations RAG       → POST /ml/recommendation

Branchement dans backend/app/api.py (1 ligne) :
    from app.routers.ml_improvements import router as ml_v6
    app.include_router(ml_v6, prefix="/ml", tags=["ML v6"])
═══════════════════════════════════════════════════════════════════════════
"""

import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

BASE_DIR   = Path(__file__).resolve().parent.parent.parent
MODELS_DIR = BASE_DIR / "models"


# ═══════════════════════════════════════════════════════════════════════════
# AMÉLIORATION 1 — PRÉDICTION P-F INTERVAL
# ═══════════════════════════════════════════════════════════════════════════
#
# Concept industriel (Moubray, Reliability-Centered Maintenance, 1997) :
#   P = défaut Potentiel détecté (Health Score baisse)
#   F = défaillance Fonctionnelle (panne réelle)
#   P-F interval = temps disponible pour intervenir
#
# Méthode :
#   1. Régression linéaire sur les N derniers jours de Health Score
#   2. Si pente négative → projeter quand le score atteindra 30 (zone critique)
#   3. Si pente positive ou nulle → machine stable
#
# Avantages vs XGBoost :
#   - Mathématiquement défendable (méthode RCM standard)
#   - Pas besoin de pannes étiquetées
#   - Résultat interprétable par le technicien
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/predict-failure")
def predict_failure(days_window: int = 14):
    """
    Prédiction de panne par extrapolation linéaire du Health Score.
    
    Args:
        days_window: fenêtre d'analyse (jours) — défaut 14 jours
    
    Returns:
        prediction: dict avec pente, jours_avant_critique, confiance, recommandation
    """
    history_file = MODELS_DIR / "health_history.csv"
    if not history_file.exists():
        raise HTTPException(404, "health_history.csv non trouvé. Lance le pipeline R.")
    
    df = pd.read_csv(history_file)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp")
    
    # Fenêtre d'analyse : N derniers jours
    cutoff = df["timestamp"].max() - pd.Timedelta(days=days_window)
    df_window = df[df["timestamp"] >= cutoff].copy()
    
    if len(df_window) < 24:
        return {
            "status": "donnees_insuffisantes",
            "message": "Pas assez de points dans la fenêtre.",
            "score_actuel": None,
            "jours_avant_critique": None,
        }
    
    # Régression linéaire : Health Score en fonction du temps (heures)
    df_window["hours"] = (df_window["timestamp"] - df_window["timestamp"].min()
                          ).dt.total_seconds() / 3600.0
    
    x = df_window["hours"].values
    y = df_window["health_score"].values
    
    # Pente (degré 1)
    pente_h, intercept = np.polyfit(x, y, 1)  # score = pente_h × heures + intercept
    pente_jour = pente_h * 24.0                # conversion en points / jour
    
    # R² pour la confiance
    y_pred = pente_h * x + intercept
    ss_res = np.sum((y - y_pred) ** 2)
    ss_tot = np.sum((y - y.mean()) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0
    
    score_actuel = float(df_window["health_score"].iloc[-1])
    score_moyen  = float(df_window["health_score"].mean())
    
    # Classification du verdict
    SEUIL_CRITIQUE = 30.0
    
    if pente_jour >= -0.1:
        verdict = "stable"
        jours_avant_critique = None
        recommandation = (
            "🟢 Machine stable. Maintenir le suivi habituel."
            if score_actuel >= 50 else
            "🟡 Score bas mais stable. Vérifier conformité aux seuils opérationnels."
        )
    elif pente_jour < -2.0:
        verdict = "degradation_rapide"
        jours_avant_critique = max(0, (score_actuel - SEUIL_CRITIQUE) / abs(pente_jour))
        recommandation = (
            f"🔴 Dégradation rapide ({pente_jour:.2f} pt/jour). "
            f"Zone critique dans {jours_avant_critique:.1f} jours. "
            "Intervention préventive urgente recommandée."
        )
    else:
        verdict = "degradation_lente"
        jours_avant_critique = max(0, (score_actuel - SEUIL_CRITIQUE) / abs(pente_jour))
        recommandation = (
            f"🟠 Dégradation détectée ({pente_jour:.2f} pt/jour). "
            f"Zone critique dans {jours_avant_critique:.0f} jours si la tendance se poursuit. "
            "Planifier maintenance préventive."
        )
    
    # Date de projection (si dégradation)
    date_projection = None
    if jours_avant_critique is not None:
        date_projection = (df_window["timestamp"].max() +
                          pd.Timedelta(days=jours_avant_critique)
                         ).strftime("%Y-%m-%d")
    
    return {
        "status": "ok",
        "verdict": verdict,
        "fenetre_analyse_jours": days_window,
        "n_points_analyses": len(df_window),
        "score_actuel": round(score_actuel, 1),
        "score_moyen_fenetre": round(score_moyen, 1),
        "pente_par_jour": round(pente_jour, 3),
        "r_squared": round(r2, 3),
        "confiance": "haute" if r2 > 0.7 else "moyenne" if r2 > 0.4 else "faible",
        "jours_avant_critique": (
            round(jours_avant_critique, 1) if jours_avant_critique is not None else None
        ),
        "date_projection_critique": date_projection,
        "seuil_critique": SEUIL_CRITIQUE,
        "recommandation": recommandation,
        "methode": "P-F interval (régression linéaire RCM)",
        "calcule_a": datetime.now().isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════
# AMÉLIORATION 2 — SEUILS DYNAMIQUES PAR MODE K-MEANS
# ═══════════════════════════════════════════════════════════════════════════
#
# Concept :
#   La machine opère en 4 modes (ralenti, charge légère, charge nominale,
#   charge max) identifiés par K-Means. Une température de 90°C est normale
#   en charge max mais alarmante au ralenti.
#
# Méthode :
#   coefficient_mode = {
#     "Arrêt / Ralenti":   0.85,  # seuils plus stricts (peu sollicité)
#     "Charge légère":     0.95,
#     "Charge nominale":   1.00,  # référence
#     "Charge maximale":   1.10,  # seuils tolérants (sollicitation élevée)
#   }
# ═══════════════════════════════════════════════════════════════════════════

SEUILS_BASE = {
    "Température liquide refroidissement":  {"alerte": 95,   "max": 107,  "type": "max"},
    "Température échappement Droit":        {"alerte": 540,  "max": 600,  "type": "max"},
    "Température échappement gauche":       {"alerte": 540,  "max": 600,  "type": "max"},
    "Température sortie convertisseur":     {"alerte": 115,  "max": 129,  "type": "max"},
    "Température huile direction":          {"alerte": 63,   "max": 70,   "type": "max"},
    "Température huile freinage":           {"alerte": 63,   "max": 70,   "type": "max"},
    "Température essieux arrière":          {"alerte": 80,   "max": 90,   "type": "max"},
    "Régime moteur":                        {"alerte": 1900, "max": 2100, "type": "max"},
    "Pression huile moteur":                {"alerte_min": 3, "min": 2.5, "type": "min"},
    "Pression d'air au réservoir":          {"alerte_min": 500, "min": 400, "type": "min"},
    "Pression embrayage impeller":          {"alerte_min": 2, "min": 1.5, "type": "min"},
}

COEFFICIENTS_MODE = {
    "Arrêt / Ralenti":   0.85,
    "Charge légère":     0.95,
    "Charge nominale":   1.00,
    "Charge maximale":   1.10,
}


def detecter_mode(mesures: dict) -> str:
    """
    Détecte le mode opérationnel à partir du régime moteur.
    (Version simplifiée — en production on utilise le modèle K-Means sauvegardé)
    """
    rpm = float(mesures.get("Régime moteur", 0) or 0)
    if rpm < 800:    return "Arrêt / Ralenti"
    if rpm < 1200:   return "Charge légère"
    if rpm < 1700:   return "Charge nominale"
    return "Charge maximale"


def calculer_seuils_dynamiques(mode: str) -> dict:
    """Renvoie les seuils ajustés au mode opérationnel courant."""
    coef = COEFFICIENTS_MODE.get(mode, 1.0)
    seuils_adj = {}
    
    for capteur, cfg in SEUILS_BASE.items():
        if cfg["type"] == "max":
            seuils_adj[capteur] = {
                "alerte": round(cfg["alerte"] * coef, 1),
                "max":    round(cfg["max"] * coef, 1),
                "type":   "max",
            }
        else:
            # Pour les seuils min, on inverse la logique
            # En charge max, on tolère pression plus basse (coef inverse)
            coef_inverse = 2 - coef  # 1.10 → 0.90, 0.85 → 1.15
            seuils_adj[capteur] = {
                "alerte_min": round(cfg["alerte_min"] * coef_inverse, 2),
                "min":        round(cfg["min"] * coef_inverse, 2),
                "type":       "min",
            }
    return seuils_adj


class MesuresDynamiques(BaseModel):
    mesures: dict
    timestamp: Optional[str] = None


@router.post("/health-dynamic")
def health_score_dynamique(body: MesuresDynamiques):
    """
    Calcule le Health Score avec seuils ajustés au mode opérationnel.
    
    Body :
        mesures: { "Température liquide refroidissement": 92, ... }
    
    Returns :
        score (avec seuils dynamiques), score_statique (référence), gain en %
    """
    # 1. Détecter le mode courant
    mode_courant = detecter_mode(body.mesures)
    coef_mode    = COEFFICIENTS_MODE.get(mode_courant, 1.0)
    
    # 2. Calcul score statique (seuils fixes)
    score_statique = 100.0
    for capteur, cfg in SEUILS_BASE.items():
        val = body.mesures.get(capteur)
        if val is None:
            continue
        val = float(val)
        
        if cfg["type"] == "max":
            if val > cfg["max"]:
                penalite = min(100, 40 + (val - cfg["max"]) / cfg["max"] * 60)
            elif val > cfg["alerte"]:
                penalite = (val - cfg["alerte"]) / (cfg["max"] - cfg["alerte"]) * 40
            else:
                penalite = 0
        else:
            if val < cfg["min"]:
                penalite = min(100, 40 + (cfg["min"] - val) / cfg["min"] * 60)
            elif val < cfg["alerte_min"]:
                penalite = (cfg["alerte_min"] - val) / (cfg["alerte_min"] - cfg["min"]) * 40
            else:
                penalite = 0
        
        score_statique = max(0, score_statique - penalite)
    
    # 3. Calcul score dynamique (seuils ajustés au mode)
    seuils_adj = calculer_seuils_dynamiques(mode_courant)
    score_dynamique = 100.0
    capteurs_alertes_dyn = []
    
    for capteur, cfg_dyn in seuils_adj.items():
        val = body.mesures.get(capteur)
        if val is None:
            continue
        val = float(val)
        
        if cfg_dyn["type"] == "max":
            if val > cfg_dyn["max"]:
                penalite = min(100, 40 + (val - cfg_dyn["max"]) / cfg_dyn["max"] * 60)
                statut = "CRITIQUE"
            elif val > cfg_dyn["alerte"]:
                penalite = (val - cfg_dyn["alerte"]) / (cfg_dyn["max"] - cfg_dyn["alerte"]) * 40
                statut = "SURVEILLANCE"
            else:
                penalite, statut = 0, "OK"
        else:
            if val < cfg_dyn["min"]:
                penalite = min(100, 40 + (cfg_dyn["min"] - val) / cfg_dyn["min"] * 60)
                statut = "CRITIQUE"
            elif val < cfg_dyn["alerte_min"]:
                penalite = (cfg_dyn["alerte_min"] - val) / (cfg_dyn["alerte_min"] - cfg_dyn["min"]) * 40
                statut = "SURVEILLANCE"
            else:
                penalite, statut = 0, "OK"
        
        if penalite > 0:
            score_dynamique = max(0, score_dynamique - penalite)
            capteurs_alertes_dyn.append({
                "capteur":  capteur,
                "valeur":   round(val, 2),
                "statut":   statut,
                "seuil_base":      cfg_dyn.get("max", cfg_dyn.get("min")),
                "seuil_dynamique": cfg_dyn.get("max", cfg_dyn.get("min")),
                "penalite": round(float(penalite), 1),
            })
    
    score_dynamique = round(score_dynamique, 1)
    score_statique  = round(score_statique, 1)
    delta = round(score_dynamique - score_statique, 1)
    
    return {
        "score_dynamique": score_dynamique,
        "score_statique":  score_statique,
        "delta":           delta,
        "mode_courant":    mode_courant,
        "coefficient":     coef_mode,
        "capteurs_alerte": capteurs_alertes_dyn,
        "seuils_appliques": seuils_adj,
        "interpretation": (
            f"En mode '{mode_courant}', les seuils sont ajustés par un coefficient "
            f"de {coef_mode:.2f}. Le score dynamique est de {score_dynamique}/100, "
            f"contre {score_statique}/100 en seuils fixes (delta : {delta:+.1f})."
        ),
        "timestamp": body.timestamp or datetime.now().isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════
# AMÉLIORATION 3 — RECOMMANDATIONS PRESCRIPTIVES (ML + RAG)
# ═══════════════════════════════════════════════════════════════════════════
#
# Concept :
#   1. Identifier le capteur qui contribue le plus à la dégradation du score
#   2. Construire automatiquement une requête RAG basée sur ce capteur
#   3. Retourner la procédure de maintenance CAT correspondante
#
# C'est l'aboutissement de "Aide à la Décision" — ne pas juste alerter,
# mais dire QUOI FAIRE.
# ═══════════════════════════════════════════════════════════════════════════

# Mapping capteur → recommandation prescriptive directe (fallback si RAG indispo)
PROCEDURES_FALLBACK = {
    "Température liquide refroidissement": {
        "cause_probable": "Système de refroidissement défaillant",
        "actions": [
            "Vérifier le niveau de liquide de refroidissement",
            "Inspecter l'état du radiateur et nettoyer si encrassé",
            "Contrôler le fonctionnement du thermostat",
            "Vérifier l'état des durites et du ventilateur",
        ],
        "ref_manuel": "Manuel CAT 994F · Section 5 — Refroidissement",
        "urgence": "Élevée — risque de surchauffe moteur",
    },
    "Température sortie convertisseur": {
        "cause_probable": "Convertisseur de couple en surchauffe",
        "actions": [
            "Vérifier le niveau d'huile de transmission",
            "Contrôler l'état de l'échangeur transmission",
            "Inspecter le filtre à huile de transmission",
            "Vérifier l'absence de glissement du convertisseur",
        ],
        "ref_manuel": "Manuel CAT 994F · Section 7 — Transmission",
        "urgence": "Élevée — dégradation huile et joints",
    },
    "Pression huile moteur": {
        "cause_probable": "Lubrification moteur insuffisante",
        "actions": [
            "ARRÊT IMMÉDIAT recommandé si pression < 2.5 bar",
            "Vérifier le niveau d'huile moteur",
            "Contrôler l'état du filtre à huile",
            "Inspecter la pompe à huile et le pressostat",
        ],
        "ref_manuel": "Manuel CAT 994F · Section 4 — Lubrification moteur",
        "urgence": "CRITIQUE — risque casse moteur",
    },
    "Température huile direction": {
        "cause_probable": "Système hydraulique de direction sollicité",
        "actions": [
            "Vérifier le niveau d'huile hydraulique",
            "Inspecter l'échangeur hydraulique",
            "Contrôler les fuites éventuelles dans le circuit",
            "Vérifier la pompe de direction",
        ],
        "ref_manuel": "Manuel CAT 994F · Section 8 — Direction hydraulique",
        "urgence": "Moyenne — surveillance renforcée",
    },
    "Température huile freinage": {
        "cause_probable": "Freinage excessif ou refroidissement insuffisant",
        "actions": [
            "Vérifier la technique de conduite (freinage moteur)",
            "Inspecter l'état des disques de frein",
            "Contrôler le circuit de refroidissement des freins",
            "Vérifier le niveau d'huile de freinage",
        ],
        "ref_manuel": "Manuel CAT 994F · Section 9 — Système de freinage",
        "urgence": "Moyenne — risque de fading",
    },
    "Pression d'air au réservoir": {
        "cause_probable": "Compresseur d'air ou fuite circuit pneumatique",
        "actions": [
            "Vérifier le compresseur d'air",
            "Tester l'étanchéité du circuit pneumatique",
            "Inspecter le déshumidificateur",
            "Contrôler les valves de sécurité",
        ],
        "ref_manuel": "Manuel CAT 994F · Section 10 — Circuit pneumatique",
        "urgence": "Élevée — impact sur freinage",
    },
    "Régime moteur": {
        "cause_probable": "Régime moteur anormalement élevé",
        "actions": [
            "Vérifier le régulateur de régime",
            "Contrôler la pompe d'injection",
            "Inspecter le système d'admission",
            "Adapter la technique de conduite",
        ],
        "ref_manuel": "Manuel CAT 994F · Section 3 — Moteur",
        "urgence": "Moyenne",
    },
}


class RecommandationInput(BaseModel):
    mesures: dict
    use_rag: bool = True
    timestamp: Optional[str] = None


@router.post("/recommendation")
def recommandation_prescriptive(body: RecommandationInput):
    """
    Recommandation prescriptive basée sur les mesures actuelles.
    
    Workflow :
      1. Calcul Health Score
      2. Identification du capteur le plus dégradé
      3. Tentative d'interrogation RAG (si disponible)
      4. Fallback sur procédures CAT pré-définies
    
    Body :
        mesures: { "Température liquide refroidissement": 102, ... }
        use_rag: True pour tenter le RAG, False pour fallback direct
    """
    # 1. Identifier capteur le plus dégradé
    pire_capteur = None
    pire_penalite = 0
    
    for capteur, cfg in SEUILS_BASE.items():
        val = body.mesures.get(capteur)
        if val is None:
            continue
        val = float(val)
        
        if cfg["type"] == "max":
            if val > cfg["max"]:
                penalite = min(100, 40 + (val - cfg["max"]) / cfg["max"] * 60)
            elif val > cfg["alerte"]:
                penalite = (val - cfg["alerte"]) / (cfg["max"] - cfg["alerte"]) * 40
            else:
                penalite = 0
        else:
            if val < cfg["min"]:
                penalite = min(100, 40 + (cfg["min"] - val) / cfg["min"] * 60)
            elif val < cfg["alerte_min"]:
                penalite = (cfg["alerte_min"] - val) / (cfg["alerte_min"] - cfg["min"]) * 40
            else:
                penalite = 0
        
        if penalite > pire_penalite:
            pire_penalite = penalite
            pire_capteur = capteur
    
    # 2. Si aucun capteur en alerte → machine OK
    if pire_capteur is None or pire_penalite == 0:
        return {
            "status":          "ok",
            "machine_status":  "Normal",
            "message":         "🟢 Aucun capteur en alerte. Aucune action requise.",
            "capteur_fautif":  None,
            "recommandation":  None,
            "timestamp":       body.timestamp or datetime.now().isoformat(),
        }
    
    # 3. Récupérer la procédure
    procedure = PROCEDURES_FALLBACK.get(pire_capteur, {
        "cause_probable": "Capteur en dehors des seuils opérationnels",
        "actions": [
            "Consulter le manuel CAT 994F",
            "Demander expertise technicien sénior",
        ],
        "ref_manuel": "Manuel CAT 994F",
        "urgence": "À évaluer",
    })
    
    # 4. Tentative RAG (si demandé et disponible)
    rag_response = None
    if body.use_rag:
        try:
            from app.rag_engine import query_rag
            rag_query = (
                f"Procédure de maintenance pour {pire_capteur} en alerte "
                f"sur chargeuse CAT 994F. Quelles actions correctives ?"
            )
            rag_response = query_rag(rag_query, top_k=3)
        except Exception as e:
            rag_response = {"error": str(e), "available": False}
    
    # 5. Construire la réponse
    val_fautif = float(body.mesures.get(pire_capteur, 0))
    
    return {
        "status":           "recommendation",
        "capteur_fautif":   pire_capteur,
        "valeur_actuelle":  round(val_fautif, 2),
        "severite":         round(pire_penalite, 1),
        "cause_probable":   procedure["cause_probable"],
        "actions":          procedure["actions"],
        "ref_manuel":       procedure["ref_manuel"],
        "urgence":          procedure["urgence"],
        "rag_enriched":     rag_response is not None and "error" not in (rag_response or {}),
        "rag_response":     rag_response,
        "timestamp":        body.timestamp or datetime.now().isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════
# ENDPOINT BONUS : tout-en-un pour le dashboard
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/insights")
def get_full_insights():
    """
    Renvoie en une seule requête :
      - Prédiction P-F interval
      - Dernière analyse de mode
      - Recommandation prescriptive si une alerte est active
    
    Endpoint pratique pour le dashboard.
    """
    insights = {"timestamp": datetime.now().isoformat()}
    
    # 1. Prédiction
    try:
        insights["prediction"] = predict_failure(days_window=14)
    except Exception as e:
        insights["prediction"] = {"error": str(e)}
    
    # 2. Stats globales depuis health_history
    history_file = MODELS_DIR / "health_history.csv"
    if history_file.exists():
        df = pd.read_csv(history_file)
        if "mode_nom" in df.columns:
            modes = df["mode_nom"].value_counts(normalize=True).round(3).to_dict()
            insights["modes_distribution"] = modes
    
    return insights
