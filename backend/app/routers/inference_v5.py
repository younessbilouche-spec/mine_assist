"""
MineAssist — Module d'inférence v5
À placer dans : backend/app/routers/inference_v5.py

Charge les 3 modèles ML qui fonctionnent (sans RF gravité 3) et
fournit les prédictions au router FastAPI.
"""

import joblib, json
import numpy as np
import pandas as pd
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional

SEUILS_CAPTEURS = {
    "Température liquide refroidissement":  {"max": 107, "alerte": 95},
    "Température échappement Droit":        {"max": 600, "alerte": 540},
    "Température échappement gauche":       {"max": 600, "alerte": 540},
    "Température sortie convertisseur":     {"max": 129, "alerte": 115},
    "Température huile direction":          {"max":  70, "alerte":  63},
    "Température huile freinage":           {"max":  70, "alerte":  63},
    "Température essieux arrière":          {"max":  90, "alerte":  80},
    "Pression huile moteur":                {"min":  2.5,"alerte_min": 3},
    "Pression d'air au réservoir":          {"min":  400,"alerte_min": 500},
    "Pression embrayage impeller":          {"min":  1.5,"alerte_min": 2},
    "Régime moteur":                        {"max": 2100,"alerte": 1900},
}

CAPTEURS_CIBLES = list(SEUILS_CAPTEURS.keys())


@dataclass
class PredictionV5:
    health_score:    float       # 0-100
    health_status:   str         # "EXCELLENT", "BON", "SURVEILLANCE", "DÉGRADÉ", "CRITIQUE"
    anomaly_score:   float       # IF score (négatif = anormal)
    is_anomaly:      bool
    operating_mode:  int         # 0-3
    mode_label:      str
    capteurs_alerte: list        # capteurs en zone surveillance/critique
    message:         str
    timestamp:       str


def _health_status(score: float) -> str:
    if score >= 90: return "EXCELLENT"
    if score >= 70: return "BON"
    if score >= 50: return "SURVEILLANCE"
    if score >= 30: return "DÉGRADÉ"
    return "CRITIQUE"


def _calculer_health_capteur(capteur: str, val: float) -> tuple:
    """Calcule la pénalité d'un capteur et retourne (penalite, statut)."""
    if capteur not in SEUILS_CAPTEURS or val is None or np.isnan(val):
        return 0, "OK"
    cfg = SEUILS_CAPTEURS[capteur]
    
    if "max" in cfg:
        alerte, maxi = cfg.get("alerte", cfg["max"]*0.9), cfg["max"]
        if val > maxi:
            return min(100, 40 + (val - maxi) / maxi * 60), "CRITIQUE"
        if val > alerte:
            return (val - alerte) / (maxi - alerte) * 40, "SURVEILLANCE"
    elif "min" in cfg:
        alerte, mini = cfg.get("alerte_min", cfg["min"]*1.1), cfg["min"]
        if val < mini:
            return min(100, 40 + (mini - val) / mini * 60), "CRITIQUE"
        if val < alerte:
            return (alerte - val) / (alerte - mini) * 40, "SURVEILLANCE"
    return 0, "OK"


class MineAssistPredictorV5:
    """Predictor singleton chargé une seule fois au démarrage."""
    
    def __init__(self, models_dir: str = "./models"):
        self.models_dir = Path(models_dir)
        self._if_model = self._if_scaler = self._if_imputer = None
        self._km_model = self._km_scaler = self._km_imputer = None
        self._meta     = None
        self._ready    = False
    
    def load(self):
        try:
            self._if_model   = joblib.load(self.models_dir / "isolation_forest.pkl")
            self._if_scaler  = joblib.load(self.models_dir / "scaler_if.pkl")
            self._if_imputer = joblib.load(self.models_dir / "imputer_if.pkl")
            self._km_model   = joblib.load(self.models_dir / "kmeans_modes.pkl")
            self._km_scaler  = joblib.load(self.models_dir / "scaler_km.pkl")
            with open(self.models_dir / "model_meta.json") as f:
                self._meta = json.load(f)
            self._ready = True
            print("✅ Predictor v5 chargé")
        except Exception as e:
            print(f"⚠️  Erreur chargement predictor v5 : {e}")
            self._ready = False
    
    def predict(self, mesures: dict, timestamp: str = None) -> PredictionV5:
        """
        Prédit sur une mesure courante.
        mesures : { "Température liquide refroidissement": 92.3, ... }
        """
        if not self._ready:
            self.load()
        if not self._ready:
            return PredictionV5(
                health_score=0, health_status="ERREUR", anomaly_score=0,
                is_anomaly=False, operating_mode=-1, mode_label="N/A",
                capteurs_alerte=[], message="Modèles non chargés",
                timestamp=timestamp or pd.Timestamp.now().isoformat()
            )
        
        # 1. Health Score
        score = 100.0
        capteurs_alerte = []
        for capteur in CAPTEURS_CIBLES:
            val = mesures.get(capteur)
            if val is None: continue
            penalite, statut = _calculer_health_capteur(capteur, float(val))
            if penalite > 0:
                capteurs_alerte.append({
                    "capteur":  capteur,
                    "valeur":   round(float(val), 2),
                    "statut":   statut,
                    "penalite": round(float(penalite), 1)
                })
                score -= penalite
        score = max(0, min(100, score))
        
        # 2. Vecteur capteurs pour IF + KMeans
        vec = np.array([
            float(mesures.get(c, np.nan)) for c in CAPTEURS_CIBLES
        ]).reshape(1, -1)
        
        # Isolation Forest
        vec_if = self._if_imputer.transform(vec)
        vec_if = self._if_scaler.transform(vec_if)
        if_score   = float(self._if_model.decision_function(vec_if)[0])
        is_anomaly = bool(self._if_model.predict(vec_if)[0] == -1)
        
        # K-Means
        vec_km = self._km_scaler.transform(self._if_imputer.transform(vec))
        mode   = int(self._km_model.predict(vec_km)[0])
        
        # Nom du mode (basé sur RPM moyen du cluster)
        rpm_val = float(mesures.get("Régime moteur", 0)) or 0
        if rpm_val < 800:    mode_label = "Arrêt"
        elif rpm_val < 1200: mode_label = "Ralenti"
        elif rpm_val < 1700: mode_label = "Charge nominale"
        else:                mode_label = "Charge maximale"
        
        # Message synthétique
        statut = _health_status(score)
        if statut == "CRITIQUE":
            msg = f"🔴 CRITIQUE — Health {score:.0f}/100. {len(capteurs_alerte)} capteurs hors seuils. Arrêt préventif recommandé."
        elif statut == "DÉGRADÉ":
            msg = f"🟠 DÉGRADÉ — Health {score:.0f}/100. {len(capteurs_alerte)} capteurs en alerte."
        elif statut == "SURVEILLANCE":
            msg = f"🟡 SURVEILLANCE — Health {score:.0f}/100. Veille renforcée."
        elif is_anomaly:
            msg = f"🟡 Comportement anormal détecté (Isolation Forest). Vérification recommandée."
        else:
            msg = f"🟢 Machine normale. Health {score:.0f}/100."
        
        return PredictionV5(
            health_score    = round(score, 1),
            health_status   = statut,
            anomaly_score   = round(if_score, 4),
            is_anomaly      = is_anomaly,
            operating_mode  = mode,
            mode_label      = mode_label,
            capteurs_alerte = capteurs_alerte,
            message         = msg,
            timestamp       = timestamp or pd.Timestamp.now().isoformat()
        )
    
    @property
    def status(self) -> dict:
        if not self._meta:
            return {"ready": False}
        return {
            "ready":      self._ready,
            "trained_at": self._meta.get("trained_at"),
            "approach":   self._meta.get("approach"),
            "modules":    self._meta.get("modules"),
            "n_samples":  self._meta.get("n_samples"),
            "health_stats": self._meta.get("health_score_stats"),
            "if_stats":     self._meta.get("isolation_forest"),
        }


_instance: Optional[MineAssistPredictorV5] = None

def get_predictor_v5(models_dir: str = "./models") -> MineAssistPredictorV5:
    global _instance
    if _instance is None:
        _instance = MineAssistPredictorV5(models_dir)
        _instance.load()
    return _instance
