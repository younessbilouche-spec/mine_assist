"""
model_service.py — DÉPRÉCIÉ
Remplacé par XGBoost + RandomForest (voir app/ocp/routers/rul_router.py).
Ce fichier est conservé vide pour éviter les erreurs d'import dans le code legacy.
"""

class ModelService:
    """Stub vide — ModelService CNN-LSTM supprimé (AUC=0.34, remplacé par XGBoost)."""
    
    def __init__(self):
        self._model = None
    
    def load(self):
        return False
    
    @property
    def is_loaded(self):
        return False
    
    def get_status(self):
        return {"model_available": False, "model_type": "LSTM_DEPRECATED", "note": "Remplacé par XGBoost RUL"}
    
    def predict(self, df, **kwargs):
        return {"alerte_active": False, "note": "LSTM supprimé — utilisez /pred/rul/predict"}
    
    def predict_last(self, df):
        return {"available": False}
    
    def invalidate_cache(self):
        pass
    
    def warmup(self):
        pass
