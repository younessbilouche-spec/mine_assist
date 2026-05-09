# ============================================================
# utils/data_processing.py
# Chargement, nettoyage et labellisation des donnees capteurs
# ============================================================

import numpy as np
import pandas as pd
from typing import Tuple, Dict, List
from app.ocp.utils.thresholds import (SENSORS_CONFIG, FEATURE_COLS, LABEL_COL,
                               FAULT_CODES, FAULT_THRESHOLD)

# Frequence 2 min
FREQ_MIN   = 2
STEPS_PH   = 60 // FREQ_MIN   # 30 pas/heure

# Parametres de detection d episodes de panne
MIN_EPISODE_STEPS = 5          # duree minimale panne = 10 min
MERGE_GAP_STEPS   = 15         # fusion si ecart < 30 min


# ─────────────────────────────────────────────────────────────
# 1. CHARGEMENT
# ─────────────────────────────────────────────────────────────

# Mapping explicite : noms de colonnes connus → nom interne
_COL_ALIASES = {
    # Date
    "heure":                    "Date",
    "date":                     "Date",
    "horodatage":               "Date",
    "timestamp":                "Date",
    # Capteurs (noms complets avec suffixes unites)
    "regime_moteur_rpm":        "Regime_moteur",
    "regime_moteur":            "Regime_moteur",
    "pression_huile_kpa":       "Pression_huile",
    "pression_huile":           "Pression_huile",
    "temp_refroidissement_c":   "Temp_refroid",
    "temp_refroid":             "Temp_refroid",
    "temp_refroidissement":     "Temp_refroid",
    "regime_convertisseur_rpm": "Regime_conv",
    "regime_conv":              "Regime_conv",
    "regime_convertisseur":     "Regime_conv",
    "temp_convertisseur_c":     "Temp_conv",
    "temp_conv":                "Temp_conv",
    "temp_convertisseur":       "Temp_conv",
    "temp_huile_direction_c":   "Temp_huile_dir",
    "temp_huile_dir":           "Temp_huile_dir",
    "temp_huile_direction":     "Temp_huile_dir",
    # Label
    "panne":                    LABEL_COL,
    "label":                    LABEL_COL,
    "defaut":                   LABEL_COL,
    "fault":                    LABEL_COL,
}


def load_data(filepath: str) -> pd.DataFrame:
    """
    Charge le fichier Excel capteurs.
    Gere plusieurs formats de noms de colonnes via _COL_ALIASES.
    Si le mapping explicite echoue, renomme par position.
    Conserve la colonne Label/panne si presente.
    """
    # Detecter la ligne d en-tete
    raw = pd.read_excel(filepath, nrows=5, header=None)
    header_row = 0
    for i in range(len(raw)):
        vals = [str(v).lower() for v in raw.iloc[i].fillna("").values]
        if any(k in " ".join(vals) for k in ["date", "heure", "regime", "temp"]):
            header_row = i
            break

    df = pd.read_excel(filepath, header=header_row)
    df = df.dropna(how="all").reset_index(drop=True)

    # Mapping explicite via _COL_ALIASES
    rename_map = {}
    for c in df.columns:
        key = str(c).lower().strip()
        if key in _COL_ALIASES:
            rename_map[c] = _COL_ALIASES[key]
    if rename_map:
        df.rename(columns=rename_map, inplace=True)

    # Si des colonnes FEATURE_COLS sont encore manquantes → renommage positionnel
    if not all(c in df.columns for c in FEATURE_COLS):
        known = {"Date", LABEL_COL} | set(FEATURE_COLS)
        non_mapped = [c for c in df.columns if c not in known]
        missing_feat = [c for c in FEATURE_COLS if c not in df.columns]
        for i, target in enumerate(missing_feat):
            if i < len(non_mapped):
                df.rename(columns={non_mapped[i]: target}, inplace=True)

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df[df["Date"].notna()].sort_values("Date").reset_index(drop=True)

    return df


# ─────────────────────────────────────────────────────────────
# 2. NETTOYAGE
# ─────────────────────────────────────────────────────────────

def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    - Convertit les capteurs en float
    - Remplace les valeurs codes electroniques par NaN
    - Interpole les trous (ffill + bfill)
    - Supprime les valeurs physiquement impossibles
    """
    df = df.copy()
    for col in FEATURE_COLS:
        if col not in df.columns:
            continue
        df[col] = pd.to_numeric(df[col], errors="coerce")

        # Valeurs codes electroniques
        df[col] = df[col].replace(FAULT_CODES, np.nan)
        df.loc[df[col] < FAULT_THRESHOLD, col] = np.nan

        # Valeurs physiquement impossibles
        cfg = SENSORS_CONFIG[col]
        lo  = cfg.get("min_abs", -9999)
        hi  = cfg.get("alarm", 99999) * 3
        df.loc[(df[col] < lo) | (df[col] > hi), col] = np.nan

    # Interpolation lineaire puis forward/backward fill
    df[FEATURE_COLS] = (df[FEATURE_COLS]
                        .interpolate(method="linear", limit=10)
                        .ffill()
                        .bfill()
                        .fillna(0))
    return df


# ─────────────────────────────────────────────────────────────
# 3. LABELLISATION
# ─────────────────────────────────────────────────────────────

def label_points(df: pd.DataFrame) -> np.ndarray:
    """
    Labellise chaque point selon les seuils officiels.
    Retour : array int (N,) avec valeurs 0/1/2/3
    """
    N      = len(df)
    labels = np.zeros(N, dtype=np.int32)

    for col, cfg in SENSORS_CONFIG.items():
        if col not in df.columns:
            continue
        vals = df[col].values
        al   = cfg["alarm"]
        mn   = cfg["min_normal"]
        mx   = cfg["max_normal"]

        if cfg["alarm_dir"] == "max":
            # Critique si >= alarme
            labels = np.where(vals >= al,
                              np.maximum(labels, 3), labels)
            # Anomalie si entre max_normal et alarme
            labels = np.where((vals >= mx) & (vals < al),
                              np.maximum(labels, 2), labels)
            # Pre-alerte si entre 95% de max_normal et max_normal
            thresh_prealert = mn + (mx - mn) * 0.90
            labels = np.where((vals >= thresh_prealert) & (vals < mx),
                              np.maximum(labels, 1), labels)
        else:  # alarm_dir == "min"
            labels = np.where(vals <= al,
                              np.maximum(labels, 3), labels)
            labels = np.where((vals <= mn) & (vals > al),
                              np.maximum(labels, 2), labels)
            thresh_prealert = mx - (mx - mn) * 0.90
            labels = np.where((vals <= thresh_prealert) & (vals > mn),
                              np.maximum(labels, 1), labels)

    return labels


def clean_episodes(labels: np.ndarray,
                   min_steps: int = MIN_EPISODE_STEPS,
                   merge_gap: int = MERGE_GAP_STEPS,
                   anomaly_level: int = 2) -> np.ndarray:
    """
    Nettoie les episodes de panne :
    1. Fusionne les episodes proches (gap < merge_gap pas)
    2. Supprime les episodes trop courts (< min_steps pas)

    Retourne un array binaire (0=Normal, 1=Anomalie)
    """
    binary = (labels >= anomaly_level).astype(np.int32)

    # Etape 1 : fusion des gaps
    in_event  = False
    gap_count = 0
    fused     = binary.copy()
    for i in range(len(fused)):
        if fused[i] == 1:
            in_event  = True
            gap_count = 0
        elif in_event:
            gap_count += 1
            if gap_count <= merge_gap:
                fused[i] = 1   # combler le gap
            else:
                in_event  = False
                gap_count = 0

    # Etape 2 : supprimer les episodes trop courts
    cleaned   = fused.copy()
    i = 0
    while i < len(cleaned):
        if cleaned[i] == 1:
            j = i
            while j < len(cleaned) and cleaned[j] == 1:
                j += 1
            if j - i < min_steps:
                cleaned[i:j] = 0
            i = j
        else:
            i += 1

    return cleaned


def build_target(binary_labels: np.ndarray) -> np.ndarray:
    """
    Construit les cibles pour 3 horizons : 1J (720), 1S (5040), 2S (10080).
    Retourne y_probs de shape (N, 3).
    Vectorise via sliding_window_view : evite les boucles Python O(N × max_h).
    """
    from numpy.lib.stride_tricks import sliding_window_view
    N = len(binary_labels)
    y = np.zeros((N, 3), dtype=np.int32)
    horizons = [720, 5040, 10080]
    max_h = max(horizons)
    padded = np.concatenate([binary_labels, np.zeros(max_h, dtype=np.int32)])
    for col, h in enumerate(horizons):
        # sliding_window_view(arr[N+h], h) → shape (N+1, h) ; on garde les N premieres lignes
        windows = sliding_window_view(padded[:N + h], h)[:N]
        y[:, col] = (windows.max(axis=1) > 0).astype(np.int32)
    return y


# ─────────────────────────────────────────────────────────────
# 4. CONSTRUCTION DES SEQUENCES
# ─────────────────────────────────────────────────────────────

def build_sequences(feats_norm: np.ndarray,
                    targets: np.ndarray,
                    window: int,
                    stride: int = 1) -> Tuple[np.ndarray, dict]:
    """
    Construit les sequences glissantes et les cibles multi-outputs.

    feats_norm : (N, 54) normalise
    targets    : (N, 3) cibles probabilites
    window     : nombre de pas dans la fenetre d entree
    stride     : decalage entre sequences

    Retour : X (n_seq, window, 54), y dict {"probs": (n_seq, 3), "sensors": (n_seq, 6)}
    """
    # On s'assure d'avoir au moins window + 1 points pour pouvoir predire le point suivant
    starts = np.arange(0, len(feats_norm) - window, stride)
    
    X = np.stack([feats_norm[i : i + window] for i in starts]).astype(np.float32)
    
    # La cible probabilite est associee a la fin de la fenetre
    y_probs = targets[starts + window - 1].astype(np.int32)
    
    # La cible capteurs est les 6 premieres features (les capteurs bruts normalises) au pas suivant (window)
    y_sensors = feats_norm[starts + window, :6].astype(np.float32)
    
    return X, {"probs": y_probs, "sensors": y_sensors}


# ─────────────────────────────────────────────────────────────
# 5. UTILITAIRES API
# ─────────────────────────────────────────────────────────────

def df_to_records(df: pd.DataFrame) -> List[Dict]:
    """Convertit un DataFrame en liste JSON-serialisable."""
    import math
    records = []
    for row in df.to_dict(orient="records"):
        clean = {}
        for k, v in row.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                clean[k] = None
            elif hasattr(v, "item"):
                clean[k] = v.item()
            else:
                clean[k] = v
        records.append(clean)
    return records
