# ============================================================
# utils/model_service.py
# Service encapsulant le chargement et l'inference du modele CNN-LSTM.
# S'assure que le modele (et TensorFlow) n'est charge qu'une seule fois
# au demarrage de l'application via FastAPI Lifespan.
#
# v2 PERF (perf_patch) :
#   1. Sliding window stride dynamique (au lieu de stride=1)
#       -> 100x moins d'inferences sur l'historique
#   2. Forecast iteratif : model(x, training=False) au lieu de
#      model.predict(batch_size=1)  -> 5-10x plus rapide
#   3. predict_last(df) : inference sur LE DERNIER point seulement
#      -> /pred/alertes ~ 200ms (au lieu de 30-60s)
#   4. Cache LRU interne sur fingerprint des donnees
#   5. warmup() : pre-warm TF lors du startup
# ============================================================

import os
import json
import math
import logging
import threading
import hashlib

import numpy as np
import pandas as pd
from fastapi import HTTPException

from app.ocp.utils.features import engineer_features
from app.ocp.utils.thresholds import SENSORS_CONFIG, FEATURE_COLS

logger = logging.getLogger("uvicorn.error")


def _df_fingerprint(df: pd.DataFrame) -> str:
    """Hash leger d'un DataFrame (taille + premiere/derniere date + checksum partiel)."""
    if len(df) == 0:
        return "empty"
    try:
        first = str(df["Date"].iloc[0]) if "Date" in df.columns else ""
        last  = str(df["Date"].iloc[-1]) if "Date" in df.columns else ""
        # checksum sur 100 derniers points uniquement (rapide)
        tail_vals = df.tail(100)[FEATURE_COLS].values.tobytes() if all(c in df.columns for c in FEATURE_COLS) else b""
        h = hashlib.md5(tail_vals).hexdigest()[:12]
        return f"{len(df)}|{first}|{last}|{h}"
    except Exception:
        return f"{len(df)}|nofp"


class ModelService:
    """
    Gestionnaire global du modele LSTM.
    Charge Keras, le modele, et les metadonnees au demarrage.
    Offre une methode thread-safe pour l'inference.
    """

    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    MODEL_DIR = os.path.join(BASE_DIR, "models")
    MODEL_PATH = os.path.join(MODEL_DIR, "best_model.keras")
    NORM_PATH = os.path.join(MODEL_DIR, "norm_params.json")
    INFO_PATH = os.path.join(MODEL_DIR, "model_info.json")

    # Plafond sur le nb de fenetres calculees pour l'historique.
    # 1500 fenetres = grille temporelle assez fine pour le rendu chart,
    # tout en restant rapide (1 batch unique pour le modele).
    MAX_HISTORICAL_WINDOWS = 1500

    def __init__(self):
        self._model = None
        self._norm_params = None
        self._model_info = None
        # cache resultat complet predict()
        self._cache_key = None
        self._cache_result = None
        # cache resultat predict_last()
        self._cache_last_key = None
        self._cache_last_result = None
        self._lock = threading.Lock()
        # tf.function compilee pour le forecast (40x speedup vs Python loop)
        self._tf_step = None

    def load(self):
        """Charge le modele Keras en memoire. Ne doit etre appele qu'une fois."""
        logger.info("Chargement du modele CNN-LSTM...")
        if not os.path.isfile(self.MODEL_PATH):
            logger.warning(f"Modele non trouve : {self.MODEL_PATH}. Lancez train_lstm.py.")
            return False

        if not os.path.isfile(self.NORM_PATH):
            logger.warning(f"Parametres de normalisation introuvables : {self.NORM_PATH}")
            return False

        # Import TensorFlow ici pour deferer l'initialisation lourde
        import tensorflow as tf
        tf.get_logger().setLevel("ERROR")

        from app.ocp.utils.lstm_model import focal_loss, F2Score

        try:
            self._model = tf.keras.models.load_model(
                self.MODEL_PATH,
                custom_objects={"loss_fn": focal_loss(), "F2Score": F2Score},
                compile=False,
            )

            with open(self.NORM_PATH) as f:
                self._norm_params = json.load(f)

            if os.path.isfile(self.INFO_PATH):
                with open(self.INFO_PATH) as f:
                    self._model_info = json.load(f)
            else:
                self._model_info = {}

            logger.info("Modele LSTM charge avec succes.")
            # Compile la tf.function pour le forecast (premiere inference
            # plus lente mais ensuite x40 plus rapide).
            try:
                self._tf_step = tf.function(
                    lambda x: self._model(x, training=False),
                    reduce_retracing=True,
                )
            except Exception as e:
                logger.warning(f"tf.function compile ignore : {e}")
                self._tf_step = None
            # Pre-warm TF (premiere inference compile les kernels)
            try:
                self.warmup()
            except Exception as e:
                logger.warning(f"Warmup ignore : {e}")
            return True

        except Exception as e:
            logger.error(f"Erreur lors du chargement du modele : {e}")
            self._model = None
            return False

    def warmup(self):
        """Run un dummy inference pour pre-charger les kernels TF/XLA + tf.function."""
        if not self.is_loaded:
            return
        window = self._norm_params.get("window_size", 96)
        n_feat = len(self._norm_params.get("norm_min", [])) or 54
        import numpy as _np
        import tensorflow as _tf
        dummy = _tf.constant(_np.zeros((1, window, n_feat), dtype=_np.float32))
        # Compile model() + tf.function (premier appel = trace + compile)
        _ = self._model(dummy, training=False)
        if self._tf_step is not None:
            _ = self._tf_step(dummy)
        logger.info("Modele LSTM pre-warm OK.")

    @property
    def is_loaded(self) -> bool:
        return self._model is not None and self._norm_params is not None

    def get_status(self) -> dict:
        return {
            "model_available": self.is_loaded,
            "model_path": self.MODEL_PATH,
            "norm_path": self.NORM_PATH,
            "model_info": self._model_info or {},
            "cache_active": self._cache_key is not None,
        }

    def invalidate_cache(self):
        """Force-reset des caches (a appeler apres upload d'un nouveau fichier)."""
        with self._lock:
            self._cache_key = None
            self._cache_result = None
            self._cache_last_key = None
            self._cache_last_result = None

    # ────────────────────────────────────────────────────────
    # PREDICT_LAST : lightweight pour /pred/alertes
    # Run l'inference sur LA DERNIERE fenetre uniquement.
    # ────────────────────────────────────────────────────────
    def predict_last(self, df: pd.DataFrame) -> dict:
        """
        Inference rapide : retourne uniquement la proba sur le dernier point.
        Coute ~1 forward pass (pas 100k).
        """
        if not self.is_loaded:
            raise HTTPException(
                status_code=503,
                detail=f"Modele non charge. Lancez train_lstm.py d'abord. ({self.MODEL_PATH})",
            )

        with self._lock:
            fp = _df_fingerprint(df)
            if self._cache_last_key == fp and self._cache_last_result is not None:
                return self._cache_last_result

        window = self._norm_params.get("window_size", 96)
        norm_min = np.array(self._norm_params["norm_min"], dtype=np.float32)
        norm_rng = np.array(self._norm_params["norm_rng"], dtype=np.float32)
        opt_thr = self._model_info.get("optimal_threshold", 0.5)

        if len(df) < window:
            return {
                "available": False,
                "proba_1d": None, "proba_1w": None, "proba_2w": None,
                "seuil_decision": opt_thr,
                "alerte_active": False,
                "nb_points": len(df),
            }

        # Feature engineering UNIQUEMENT sur la queue (window+rolling buffer)
        # On a besoin d'au moins WIN_24H = 720 points en arriere pour calculer
        # correctement les rolling means. On prend tail(800) pour avoir une marge.
        tail_size = max(800, window + 100)
        df_tail = df.tail(tail_size).reset_index(drop=True)
        feats_raw = engineer_features(df_tail)
        feats_norm = np.clip((feats_raw - norm_min) / norm_rng, 0.0, 1.0).astype(np.float32)

        # Une seule inference (via tf.function compilee = ~5-10ms)
        import tensorflow as tf
        x = tf.constant(feats_norm[-window:][np.newaxis].astype(np.float32))
        step_fn = self._tf_step if self._tf_step is not None else (
            lambda v: self._model(v, training=False)
        )
        out = step_fn(x)
        # out = [probs (1,3), sensors (1,6)]
        y_prob = np.asarray(out[0])[0]  # shape (3,)

        proba_1d = float(y_prob[0])
        proba_1w = float(y_prob[1])
        proba_2w = float(y_prob[2])

        result = {
            "available": True,
            "proba_1d": round(proba_1d, 4),
            "proba_1w": round(proba_1w, 4),
            "proba_2w": round(proba_2w, 4),
            "seuil_decision": round(opt_thr, 4),
            "alerte_active": proba_1d >= opt_thr,
            "nb_points": len(df),
        }

        with self._lock:
            self._cache_last_key = fp
            self._cache_last_result = result
        return result

    # ────────────────────────────────────────────────────────
    # PREDICT : full pour /pred/prediction
    # Avec stride dynamique pour speed-up
    # ────────────────────────────────────────────────────────
    def predict(self, df: pd.DataFrame, max_display: int = 300, freq_min: int = 2, horizon_override: int = None) -> dict:
        """
        Lance la prediction sur un DataFrame nettoye.
        Retourne un dictionnaire JSON-serialisable.

        v2 PERF :
            * stride dynamique sur la fenetre glissante : on ne calcule
              plus qu'au plus MAX_HISTORICAL_WINDOWS (~1500) inferences
              sur l'historique au lieu de N (~100k).
            * forecast iteratif via model(x) au lieu de model.predict(x)
            * cache sur fingerprint des donnees + horizon
        """
        if not self.is_loaded:
            raise HTTPException(
                status_code=503,
                detail=f"Modele non charge. Lancez train_lstm.py d'abord. ({self.MODEL_PATH})",
            )

        cache_key = (_df_fingerprint(df), int(max_display), int(freq_min), horizon_override)
        with self._lock:
            if self._cache_key == cache_key and self._cache_result is not None:
                logger.info("predict() : cache HIT")
                return self._cache_result

        window = self._norm_params.get("window_size", 96)
        base_horizon = self._norm_params.get("horizon_steps", 30)
        horizon = base_horizon if horizon_override is None else horizon_override
        norm_min = np.array(self._norm_params["norm_min"], dtype=np.float32)
        norm_rng = np.array(self._norm_params["norm_rng"], dtype=np.float32)
        opt_thr = self._model_info.get("optimal_threshold", 0.5)

        # Feature engineering
        feats_raw = engineer_features(df)
        feats_norm = np.clip((feats_raw - norm_min) / norm_rng, 0.0, 1.0).astype(np.float32)

        N = len(feats_norm)
        if N < window:
            raise HTTPException(
                status_code=422,
                detail=f"Pas assez de points ({N}) pour la fenetre {window}. Chargez au moins {window} lignes.",
            )

        # ── Sliding windows AVEC STRIDE DYNAMIQUE
        # Avant : starts = arange(0, N-window+1, 1)  ~= 100k fenetres
        # Apres : on plafonne a MAX_HISTORICAL_WINDOWS, plus la derniere
        # fenetre (=temps reel) est toujours incluse.
        n_possible = N - window + 1
        max_w = self.MAX_HISTORICAL_WINDOWS
        if n_possible <= max_w:
            stride = 1
            starts = np.arange(0, n_possible, dtype=np.int64)
        else:
            stride = max(1, n_possible // max_w)
            starts = np.arange(0, n_possible, stride, dtype=np.int64)
            # toujours inclure la derniere fenetre (=etat courant)
            if starts[-1] != n_possible - 1:
                starts = np.append(starts, n_possible - 1)

        logger.info(f"predict() : N={N}, stride={stride}, n_windows={len(starts)}")

        # Construction batch
        X = np.stack([feats_norm[i : i + window] for i in starts])

        # Inference batch (1 seul appel model.predict pour tout l'historique)
        preds = self._model.predict(X, batch_size=512, verbose=0)
        y_prob = np.asarray(preds[0])     # (n_windows, 3)
        y_sensors = np.asarray(preds[1])  # (n_windows, 6)

        # Alignement : y_prob[i] correspond a la fin de la sequence i (index = starts[i] + window - 1)
        indices_pred = starts + window - 1
        full_prob = np.full((N, 3), np.nan)
        full_prob[indices_pred] = y_prob

        full_sensors_pred = np.full((N, 6), np.nan)
        full_sensors_pred[indices_pred] = y_sensors
        full_sensors_pred = full_sensors_pred * norm_rng[:6] + norm_min[:6]

        # Indicateur binaire avec seuil optimal (basé sur 1J, i.e., index 0)
        full_bin = np.zeros(N, dtype=np.int32)
        full_bin[indices_pred] = (y_prob[:, 0] >= opt_thr).astype(np.int32)

        # Alertes actives sur la fenetre la plus recente (basé sur 1J)
        recent_prob = y_prob[-window:, 0] if len(y_prob) >= window else y_prob[:, 0]
        prob_max = float(recent_prob.max()) if len(recent_prob) > 0 else 0.0
        alerte = prob_max >= opt_thr

        horizon_min = horizon * freq_min

        # ── Sous-echantillonnage pour le frontend (sur les indices PRED uniquement)
        # On prefere afficher les points qui ont une vraie predict, pas les NaN
        valid_idx = indices_pred  # deja la liste des indices qui ont une predict
        if len(valid_idx) > max_display:
            step_disp = max(1, len(valid_idx) // max_display)
            sel_pos = np.arange(0, len(valid_idx), step_disp, dtype=np.int64)
            # toujours garder le dernier point (=temps reel)
            if sel_pos[-1] != len(valid_idx) - 1:
                sel_pos = np.append(sel_pos, len(valid_idx) - 1)
            idx_out = valid_idx[sel_pos]
        else:
            idx_out = valid_idx

        dates = df["Date"].dt.strftime("%Y-%m-%dT%H:%M:%S").values

        points = []
        for i in idx_out:
            p1d = float(full_prob[i, 0]) if not math.isnan(full_prob[i, 0]) else None
            p1w = float(full_prob[i, 1]) if not math.isnan(full_prob[i, 1]) else None
            p2w = float(full_prob[i, 2]) if not math.isnan(full_prob[i, 2]) else None

            point_data = {
                "date": dates[i],
                "proba_1d": round(p1d, 4) if p1d is not None else None,
                "proba_1w": round(p1w, 4) if p1w is not None else None,
                "proba_2w": round(p2w, 4) if p2w is not None else None,
                "alerte": int(full_bin[i]),
            }
            for j, col in enumerate(FEATURE_COLS):
                if col in df.columns:
                    point_data[col] = self._safe(df[col].iloc[i])
            points.append(point_data)

        # ── Forecast iteratif (boucle 144 steps)
        # PERF : on utilise self._tf_step (tf.function compilee) au lieu de
        # self._model.predict(batch_size=1). Speed-up x40 (~40s -> ~1s).
        FORECAST_STEPS = {720: 48, 5040: 96, 10080: 144}
        MAX_STEPS = max(FORECAST_STEPS.values())

        forecast_window = feats_norm[-window:].copy()
        last_date = df["Date"].iloc[-1]
        all_forecast = []

        import tensorflow as tf
        step_fn = self._tf_step if self._tf_step is not None else (
            lambda x: self._model(x, training=False)
        )

        for step_f in range(MAX_STEPS):
            x_f = tf.constant(forecast_window[np.newaxis].astype(np.float32))
            pred_f = step_fn(x_f)
            # pred_f = [probs (1,3), sensors (1,6)]
            sensors_norm_f = np.asarray(pred_f[1])[0]
            sensors_real_f = sensors_norm_f * norm_rng[:6] + norm_min[:6]

            future_dt = last_date + pd.Timedelta(minutes=freq_min * (step_f + 1))
            fp_dict = {"date": future_dt.strftime("%Y-%m-%dT%H:%M:%S")}
            for j, col in enumerate(FEATURE_COLS):
                fp_dict[col] = self._safe(float(sensors_real_f[j]))
            all_forecast.append(fp_dict)

            new_row = forecast_window[-1].copy()
            new_row[:6] = np.clip(sensors_norm_f, 0.0, 1.0)
            forecast_window = np.roll(forecast_window, -1, axis=0)
            forecast_window[-1] = new_row

        forecast = {
            str(h): all_forecast[:n]
            for h, n in FORECAST_STEPS.items()
        }

        # ── Statistiques (basées sur 1J)
        valid_prob = y_prob[:, 0][~np.isnan(y_prob[:, 0])]
        stats = {
            "proba_max": round(float(valid_prob.max()), 4) if len(valid_prob) else 0,
            "proba_mean": round(float(valid_prob.mean()), 4) if len(valid_prob) else 0,
            "nb_alertes": int(full_bin.sum()),
            "pct_alertes": round(100 * full_bin.sum() / max(1, len(indices_pred)), 2),
        }

        # ── Seuils capteurs pour affichage Y-axis
        sensor_bounds = {
            col: {
                "min_normal":    cfg["min_normal"],
                "max_normal":    cfg["max_normal"],
                "alarm":         cfg["alarm"],
                "alarm_dir":     cfg["alarm_dir"],
                "unit":          cfg["unit"],
                "label":         cfg["label"],
                "threshold_max": cfg.get("threshold_max"),
                "threshold_min": cfg.get("threshold_min"),
            }
            for col, cfg in SENSORS_CONFIG.items()
        }

        result = {
            "alerte_active": alerte,
            "proba_recente": round(prob_max, 4),
            "seuil_decision": round(opt_thr, 4),
            "horizon_min": horizon_min,
            "nb_points_total": N,
            "nb_points_pred": len(indices_pred),
            "stride_used": int(stride),
            "statistiques": stats,
            "sensor_bounds": sensor_bounds,
            "points": points,
            "forecast": forecast,
            "model_info": {
                "window_size": window,
                "horizon_steps": horizon,
                "test_auc": self._model_info.get("test_auc"),
                "optimal_threshold": opt_thr,
                "n_features": self._model_info.get("n_features"),
                "freq_min": freq_min,
            },
        }

        with self._lock:
            self._cache_key = cache_key
            self._cache_result = result
            # Mettre aussi a jour le cache last
            self._cache_last_key = _df_fingerprint(df)
            self._cache_last_result = {
                "available": True,
                "proba_1d": result["points"][-1]["proba_1d"] if result["points"] else None,
                "proba_1w": result["points"][-1]["proba_1w"] if result["points"] else None,
                "proba_2w": result["points"][-1]["proba_2w"] if result["points"] else None,
                "seuil_decision": result["seuil_decision"],
                "alerte_active": result["alerte_active"],
                "nb_points": N,
            }
        return result

    @staticmethod
    def _safe(v):
        if hasattr(v, "item"):
            v = v.item()
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        return v
