"""
MineAssist — Module d'inférence (prédiction en temps réel)
Utilisé par le backend FastAPI pour scorer de nouvelles mesures capteur.

Usage depuis FastAPI:
    from inference import MineAssistPredictor
    predictor = MineAssistPredictor("./models/")
    result = predictor.predict(mesures_dict)
"""

import joblib, json
import numpy as np
import pandas as pd
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


@dataclass
class PredictionResult:
    """Résultat complet d'une prédiction temps-réel."""
    anomaly_score: float          # Score Isolation Forest [-1, 0] (plus bas = plus anormal)
    is_anomaly_if: bool           # Isolation Forest: anomalie oui/non
    alerte_imminente: bool        # Gradient Boosting: panne dans 30 min ?
    proba_alerte: float           # Probabilité de panne [0, 1]
    gravite_predite: int          # 0=normal, 1=info, 2=avert, 3=critique
    gravite_label: str            # Libellé lisible
    capteurs_suspects: list       # Capteurs les plus éloignés de la normale
    message: str                  # Message humain résumant la situation


GRAVITE_LABELS = {
    0: "Normal",
    1: "Information",
    2: "Avertissement",
    3: "Critique"
}


class MineAssistPredictor:
    """
    Classe principale pour scorer de nouvelles mesures.
    Charge les 3 modèles une seule fois (lazy loading).
    """
    
    def __init__(self, models_dir: str = "./models/"):
        self.models_dir  = Path(models_dir)
        self._if_model   = None
        self._if_scaler  = None
        self._rf_model   = None
        self._rf_scaler  = None
        self._gb_model   = None
        self._gb_scaler  = None
        self._features   = None
        self._meta       = None
        self._ready      = False
    
    def load(self):
        """Charge tous les modèles en mémoire."""
        try:
            self._if_model  = joblib.load(self.models_dir / "isolation_forest.pkl")
            self._if_scaler = joblib.load(self.models_dir / "scaler_if.pkl")
            self._rf_model  = joblib.load(self.models_dir / "random_forest_gravite.pkl")
            self._rf_scaler = joblib.load(self.models_dir / "scaler_rf.pkl")
            self._gb_model  = joblib.load(self.models_dir / "gradient_boosting_alerte.pkl")
            self._gb_scaler = joblib.load(self.models_dir / "scaler_gb.pkl")
            
            with open(self.models_dir / "feature_names.json") as f:
                self._features = json.load(f)
            with open(self.models_dir / "model_meta.json") as f:
                self._meta = json.load(f)
            
            self._ready = True
            print(f"✅ Predictor chargé | {len(self._features)} features | "
                  f"Entraîné le {self._meta.get('trained_at', '?')}")
        except FileNotFoundError as e:
            print(f"⚠️  Modèles non trouvés: {e} — lancez pipeline_ml.py d'abord")
            self._ready = False
    
    def _build_feature_vector(self, mesures: dict) -> np.ndarray:
        """
        Construit le vecteur de features à partir d'un dict de mesures.
        
        mesures: {
            "Température liquide refroidissement__mean": 92.3,
            "Pression huile moteur__mean": 4.1,
            ...
        }
        """
        vec = []
        for feat_name in self._features:
            # Cherche la valeur dans mesures, sinon utilise la médiane de training
            val = mesures.get(feat_name, np.nan)
            vec.append(float(val) if not (val is None or (isinstance(val, float) and np.isnan(val))) else 0.0)
        return np.array(vec).reshape(1, -1)
    
    def predict(self, mesures: dict) -> PredictionResult:
        """
        Prédit l'état de la machine à partir des mesures courantes.
        
        Args:
            mesures: dict {nom_feature: valeur}
        
        Returns:
            PredictionResult avec tous les scores et le message
        """
        if not self._ready:
            self.load()
        
        if not self._ready:
            return PredictionResult(
                anomaly_score=0, is_anomaly_if=False,
                alerte_imminente=False, proba_alerte=0,
                gravite_predite=0, gravite_label="Inconnu",
                capteurs_suspects=[], message="Modèles non disponibles"
            )
        
        X = self._build_feature_vector(mesures)
        
        # ── Isolation Forest ──────────────────────────────────────────────
        X_if = self._if_scaler.transform(X)
        if_score = float(self._if_model.decision_function(X_if)[0])
        is_anomaly_if = self._if_model.predict(X_if)[0] == -1
        
        # ── Gradient Boosting (alerte imminente) ──────────────────────────
        X_gb = self._gb_scaler.transform(X)
        proba_alerte = float(self._gb_model.predict_proba(X_gb)[0][1])
        alerte_imminente = proba_alerte > 0.5
        
        # ── Random Forest (gravité) ───────────────────────────────────────
        X_rf = self._rf_scaler.transform(X)
        gravite_predite = int(self._rf_model.predict(X_rf)[0])
        
        # ── Identifier les capteurs suspects ──────────────────────────────
        capteurs_suspects = self._identifier_suspects(mesures)
        
        # ── Message humain ────────────────────────────────────────────────
        message = self._generer_message(
            is_anomaly_if, alerte_imminente, proba_alerte,
            gravite_predite, capteurs_suspects
        )
        
        return PredictionResult(
            anomaly_score    = round(if_score, 4),
            is_anomaly_if    = is_anomaly_if,
            alerte_imminente = alerte_imminente,
            proba_alerte     = round(proba_alerte, 3),
            gravite_predite  = gravite_predite,
            gravite_label    = GRAVITE_LABELS.get(gravite_predite, "?"),
            capteurs_suspects = capteurs_suspects,
            message          = message,
        )
    
    def _identifier_suspects(self, mesures: dict, top_n: int = 3) -> list:
        """Retourne les capteurs dont les valeurs moyennes sont les plus éloignées."""
        suspects = []
        meta_stats = self._meta.get("stats_capteurs", {})
        
        for feat_name, val in mesures.items():
            if "__mean" not in feat_name:
                continue
            capteur_name = feat_name.replace("__mean", "")
            if capteur_name in meta_stats:
                mu    = meta_stats[capteur_name]["mu"]
                sigma = meta_stats[capteur_name]["sigma"]
                if sigma > 0:
                    z_score = abs((val - mu) / sigma)
                    suspects.append((capteur_name, round(z_score, 2), round(val, 2)))
        
        suspects.sort(key=lambda x: -x[1])
        return [{"capteur": s[0], "z_score": s[1], "valeur": s[2]} for s in suspects[:top_n]]
    
    def _generer_message(
        self, is_anomaly_if, alerte_imminente, proba, gravite, suspects
    ) -> str:
        if gravite == 3 or (alerte_imminente and proba > 0.7):
            suspects_str = ", ".join([s["capteur"] for s in suspects[:2]])
            return (
                f"🔴 ALERTE CRITIQUE — Risque de panne imminent ({proba*100:.0f}%). "
                f"Capteurs suspects: {suspects_str}. Arrêt préventif recommandé."
            )
        elif gravite == 2 or (alerte_imminente and proba > 0.4):
            return (
                f"🟠 AVERTISSEMENT — Comportement anormal détecté (probabilité panne: {proba*100:.0f}%). "
                "Surveillance renforcée nécessaire."
            )
        elif is_anomaly_if:
            return (
                "🟡 ANOMALIE détectée par analyse comportementale. "
                "Valeurs hors du profil normal. Vérification recommandée."
            )
        else:
            return "🟢 Machine en état normal. Aucune anomalie détectée."
    
    @property
    def status(self) -> dict:
        """Retourne l'état du predictor (pour /ml/status)."""
        if not self._meta:
            return {"ready": False, "message": "Modèles non chargés"}
        return {
            "ready": self._ready,
            "trained_at": self._meta.get("trained_at"),
            "n_samples": self._meta.get("n_samples"),
            "feature_count": self._meta.get("feature_count"),
            "models": list(self._meta.get("models", {}).keys()),
            "rf_metrics": self._meta.get("rf_metrics"),
            "gb_metrics": self._meta.get("gb_metrics"),
        }


# ── Singleton global pour le backend ─────────────────────────────────────────
_predictor_instance: Optional[MineAssistPredictor] = None

def get_predictor(models_dir: str = "./models/") -> MineAssistPredictor:
    """Retourne le predictor singleton (chargé une seule fois au démarrage)."""
    global _predictor_instance
    if _predictor_instance is None:
        _predictor_instance = MineAssistPredictor(models_dir)
        _predictor_instance.load()
    return _predictor_instance
