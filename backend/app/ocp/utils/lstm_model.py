"""
lstm_model.py — DÉPRÉCIÉ
Architecture CNN-LSTM supprimée (AUC=0.34, pire qu'aléatoire).
Remplacée par XGBoost + RandomForest (PFE 2025, MAE=21h, Rappel RED=93%).
"""


def build_model(*args, **kwargs):
    raise NotImplementedError("CNN-LSTM supprimé. Utilisez app/ocp/routers/rul_router.py")


def focal_loss(*args, **kwargs):
    raise NotImplementedError("focal_loss supprimé (CNN-LSTM déprécié)")


class F2Score:
    pass


def load_model(*args, **kwargs):
    raise NotImplementedError("load_model supprimé. Modèles XGBoost dans models/rul/")
