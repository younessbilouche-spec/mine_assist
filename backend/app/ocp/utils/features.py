# ============================================================
# utils/features.py
# Feature Engineering — 6 capteurs x 9 features = 54 features
#
# Pour chaque capteur et chaque timestep :
#   1. Valeur brute normalisee
#   2. Derivee 1re  (vitesse de changement)
#   3. Derivee 2e   (acceleration)
#   4. Moy. glissante 1h   (30 pas x 2 min)
#   5. Moy. glissante 6h   (180 pas)
#   6. Moy. glissante 24h  (720 pas)
#   7. Z-score 24h          (ecart a la moyenne longue)
#   8. Temps cumule > seuil normal sur 4h (240 pas)
#   9. Distance alarme normalisee
# ============================================================

import numpy as np
import pandas as pd
from typing import List
from app.ocp.utils.thresholds import SENSORS_CONFIG, FEATURE_COLS

# Frequence d echantillonnage : 2 min → pas/heure = 30
FREQ_MIN = 2
STEPS_PH = 60 // FREQ_MIN          # 30 pas / heure

WIN_1H = 1 * STEPS_PH           # 30
WIN_6H = 6 * STEPS_PH           # 180
WIN_24H = 24 * STEPS_PH           # 720
WIN_4H = 4 * STEPS_PH           # 120  (fenetre cumul depassement)

N_BASE_FEATURES = len(FEATURE_COLS)     # 6
N_ENG_PER_SENSOR = 9                     # features par capteur
N_TOTAL_FEATURES = N_BASE_FEATURES * N_ENG_PER_SENSOR  # 54


def engineer_features(df: pd.DataFrame) -> np.ndarray:
    """
    Calcule les 54 features engineerees sur tout le DataFrame.

    Parametres
    ----------
    df : DataFrame avec colonnes = FEATURE_COLS, index numerique, trié par date

    Retour
    ------
    array (N, 54) float32
    """
    N = len(df)
    result = np.zeros((N, N_TOTAL_FEATURES), dtype=np.float32)

    for j, col in enumerate(FEATURE_COLS):
        cfg = SENSORS_CONFIG[col]
        raw = df[col].values.astype(np.float64)

        # ── 1. Derivee 1re (diff normalisee par l ecart type)
        d1 = np.zeros(N)
        d1[1:] = raw[1:] - raw[:-1]

        # ── 2. Derivee 2e
        d2 = np.zeros(N)
        d2[2:] = d1[2:] - d1[1:-1]

        # ── 3-5. Moyennes glissantes
        s = pd.Series(raw)
        ma1h = s.rolling(WIN_1H,  min_periods=1).mean().values
        ma6h = s.rolling(WIN_6H,  min_periods=1).mean().values
        ma24h = s.rolling(WIN_24H, min_periods=1).mean().values

        # ── 6. Z-score 24h : (valeur - moy24h) / std24h
        std24h = s.rolling(WIN_24H, min_periods=2).std().fillna(1.0).values
        std24h = np.where(std24h < 1e-6, 1.0, std24h)
        zscore = (raw - ma24h) / std24h

        # ── 7. Temps cumule de depassement seuil sur 4h
        #    1 si la valeur depasse le seuil normal, 0 sinon
        if cfg["alarm_dir"] == "max":
            above = (raw > cfg["max_normal"]).astype(float)
        else:
            above = (raw < cfg["min_normal"]).astype(float)
        cumul_4h = pd.Series(above).rolling(WIN_4H, min_periods=1).mean().values

        # ── 8. Distance alarme normalisee [-1, 1]
        #    0 = dans la plage normale, >0 = en direction de l alarme
        rng = max(cfg["max_normal"] - cfg["min_normal"], 1.0)
        if cfg["alarm_dir"] == "max":
            alarm_dist = (raw - cfg["min_normal"]) / rng
        else:
            alarm_dist = (cfg["max_normal"] - raw) / rng

        # ── Empilement des 9 features pour ce capteur
        base = j * N_ENG_PER_SENSOR
        result[:, base + 0] = raw.astype(np.float32)
        result[:, base + 1] = d1.astype(np.float32)
        result[:, base + 2] = d2.astype(np.float32)
        result[:, base + 3] = ma1h.astype(np.float32)
        result[:, base + 4] = ma6h.astype(np.float32)
        result[:, base + 5] = ma24h.astype(np.float32)
        result[:, base + 6] = zscore.astype(np.float32)
        result[:, base + 7] = cumul_4h.astype(np.float32)
        result[:, base + 8] = alarm_dist.astype(np.float32)

    return result


def normalize_features(feats: np.ndarray,
                       fit_data: np.ndarray = None,
                       params: dict = None) -> tuple:
    """
    Normalisation Min-Max feature par feature.

    - Si fit_data fourni  → fit sur fit_data, retourne (feats_norm, params)
    - Si params fourni    → applique les params existants (inference)

    Retour : (array normalise, dict params)
    """
    if params is not None:
        f_min = np.array(params["min"], dtype=np.float32)
        f_rng = np.array(params["rng"], dtype=np.float32)
        return np.clip((feats - f_min) / f_rng, 0.0, 1.0).astype(np.float32), params

    # Fit sur fit_data
    base = fit_data if fit_data is not None else feats
    f_min = base.min(axis=0).astype(np.float32)
    f_max = base.max(axis=0).astype(np.float32)
    f_rng = (f_max - f_min + 1e-8).astype(np.float32)
    params = {"min": f_min.tolist(), "rng": f_rng.tolist()}
    normed = np.clip((feats - f_min) / f_rng, 0.0, 1.0).astype(np.float32)
    return normed, params


def feature_names() -> List[str]:
    """Retourne la liste des 54 noms de features."""
    suffixes = ["brut", "deriv1", "deriv2", "ma1h", "ma6h", "ma24h",
                "zscore24h", "cumul_dep4h", "dist_alarme"]
    names = []
    for col in FEATURE_COLS:
        for suf in suffixes:
            names.append(f"{col}_{suf}")
    return names
