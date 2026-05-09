# ============================================================
# utils/lstm_model.py
# Architecture CNN-LSTM + Focal Loss pour detection de pannes
# Input  : (batch, WINDOW, 54) sequences
# Output : (batch, 1) probabilite de panne dans horizon H
# ============================================================

import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, regularizers
from sklearn.metrics import precision_recall_curve
from typing import Tuple

# ─────────────────────────────────────────────────────────────
# HYPERPARAMETRES PAR DEFAUT
# ─────────────────────────────────────────────────────────────
WINDOW_SIZE        = 96     # 96 pas × 2 min = 3h20 de contexte
N_FEATURES         = 54     # 6 capteurs × 9 features
HORIZON_STEPS      = 30     # predire panne dans les 30 prochains pas (1h)
CONV_FILTERS       = 64
CONV_KERNEL        = 5
LSTM1_UNITS        = 128
LSTM2_UNITS        = 64
DENSE_UNITS        = 32
DROPOUT_RATE       = 0.3
L2_REG             = 1e-4
FOCAL_GAMMA        = 2.0    # focus sur les exemples difficiles
FOCAL_ALPHA        = 0.75   # poids de la classe positive (pannes rares)


# ─────────────────────────────────────────────────────────────
# FOCAL LOSS
# ─────────────────────────────────────────────────────────────

def focal_loss(gamma: float = FOCAL_GAMMA,
               alpha: float = FOCAL_ALPHA):
    """
    Focal Loss pour classification binaire desequilibree.
    FL(p) = -alpha * (1-p)^gamma * log(p)   pour la classe positive
    FL(p) = -(1-alpha) * p^gamma * log(1-p) pour la classe negative

    gamma > 0 : reduit la perte des exemples faciles
    alpha      : poids de la classe positive
    """
    def loss_fn(y_true, y_pred):
        y_true = tf.cast(y_true, tf.float32)
        y_pred = tf.clip_by_value(y_pred, 1e-7, 1.0 - 1e-7)

        # Terme positif et negatif
        ce_pos = -tf.math.log(y_pred)
        ce_neg = -tf.math.log(1.0 - y_pred)

        fl_pos = alpha       * tf.pow(1.0 - y_pred, gamma) * ce_pos
        fl_neg = (1 - alpha) * tf.pow(y_pred,        gamma) * ce_neg

        loss = y_true * fl_pos + (1.0 - y_true) * fl_neg
        return tf.reduce_mean(loss)

    loss_fn.__name__ = "focal_loss"
    return loss_fn


# ─────────────────────────────────────────────────────────────
# METRIQUE F2-SCORE (recall x2)
# ─────────────────────────────────────────────────────────────

class F2Score(keras.metrics.Metric):
    """
    F2-score batch-level : donne 2x plus de poids au recall.
    Formule : F2 = 5 * P * R / (4*P + R)
    """
    def __init__(self, threshold: float = 0.5, name="f2_score", **kwargs):
        super().__init__(name=name, **kwargs)
        self.threshold  = threshold
        self.tp = self.add_weight(name="tp", initializer="zeros")
        self.fp = self.add_weight(name="fp", initializer="zeros")
        self.fn = self.add_weight(name="fn", initializer="zeros")

    def update_state(self, y_true, y_pred, sample_weight=None):  # noqa: ARG002
        y_true = tf.cast(tf.reshape(y_true, [-1]), tf.float32)
        y_pred = tf.cast(tf.reshape(y_pred, [-1]) >= self.threshold, tf.float32)
        self.tp.assign_add(tf.reduce_sum(y_true * y_pred))
        self.fp.assign_add(tf.reduce_sum((1 - y_true) * y_pred))
        self.fn.assign_add(tf.reduce_sum(y_true * (1 - y_pred)))

    def result(self):
        precision = self.tp / (self.tp + self.fp + 1e-7)
        recall    = self.tp / (self.tp + self.fn + 1e-7)
        f2        = 5.0 * precision * recall / (4.0 * precision + recall + 1e-7)
        return f2

    def reset_state(self):
        self.tp.assign(0.0)
        self.fp.assign(0.0)
        self.fn.assign(0.0)

    def get_config(self):
        cfg = super().get_config()
        cfg["threshold"] = self.threshold
        return cfg


# ─────────────────────────────────────────────────────────────
# ARCHITECTURE CNN-LSTM
# ─────────────────────────────────────────────────────────────

def build_model(window:        int   = WINDOW_SIZE,
                n_features:    int   = N_FEATURES,
                conv_filters:  int   = CONV_FILTERS,
                conv_kernel:   int   = CONV_KERNEL,
                lstm1_units:   int   = LSTM1_UNITS,
                lstm2_units:   int   = LSTM2_UNITS,
                dense_units:   int   = DENSE_UNITS,
                dropout_rate:  float = DROPOUT_RATE,
                l2_reg:        float = L2_REG,
                focal_gamma:   float = FOCAL_GAMMA,
                focal_alpha:   float = FOCAL_ALPHA,
                learning_rate: float = 1e-3) -> keras.Model:
    """
    Construit et compile le modele CNN-LSTM.

    Architecture :
      Input (window, n_features)
        → Conv1D(filters, kernel, relu) + BatchNorm
        → MaxPool1D(2)
        → LSTM(lstm1_units, return_sequences=True)
        → LSTM(lstm2_units)
        → Dense(dense_units, relu) + Dropout
        → Dense(1, sigmoid)
    """
    reg = regularizers.l2(l2_reg)
    inp = keras.Input(shape=(window, n_features), name="input_seq")

    # ── Bloc convolutif : extraction de motifs locaux
    x = layers.Conv1D(conv_filters, conv_kernel,
                      padding="same", activation="relu",
                      kernel_regularizer=reg,
                      name="conv1d")(inp)
    x = layers.BatchNormalization(name="bn_conv")(x)
    x = layers.MaxPooling1D(2, name="maxpool")(x)
    x = layers.Dropout(dropout_rate * 0.5, name="drop_conv")(x)

    # ── Bloc LSTM : capture des dependances temporelles longues
    x = layers.LSTM(lstm1_units,
                    return_sequences=True,
                    kernel_regularizer=reg,
                    recurrent_dropout=0.0,
                    name="lstm1")(x)
    x = layers.BatchNormalization(name="bn_lstm1")(x)

    x = layers.LSTM(lstm2_units,
                    return_sequences=False,
                    kernel_regularizer=reg,
                    name="lstm2")(x)
    x = layers.BatchNormalization(name="bn_lstm2")(x)

    # ── Tête 1 : Probabilités (3 horizons)
    x_probs = layers.Dense(dense_units, activation="relu",
                           kernel_regularizer=reg,
                           name="dense_probs")(x)
    x_probs = layers.Dropout(dropout_rate, name="drop_probs")(x_probs)
    out_probs = layers.Dense(3, activation="sigmoid", name="probs")(x_probs)

    # ── Tête 2 : Capteurs (6 features continues)
    x_sensors = layers.Dense(dense_units, activation="relu",
                             kernel_regularizer=reg,
                             name="dense_sensors")(x)
    out_sensors = layers.Dense(6, activation="linear", name="sensors")(x_sensors)

    model = keras.Model(inputs=inp, outputs=[out_probs, out_sensors], name="CNN_LSTM_MultiTask")

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=learning_rate, clipnorm=1.0),
        loss={
            "probs": focal_loss(gamma=focal_gamma, alpha=focal_alpha),
            "sensors": "mse"
        },
        loss_weights={
            "probs": 1.0,
            "sensors": 0.5
        },
        metrics={
            "probs": [
                keras.metrics.AUC(name="auc"),
                F2Score(name="f2"),
            ],
            "sensors": ["mae"]
        },
    )
    return model


# ─────────────────────────────────────────────────────────────
# SEUIL OPTIMAL
# ─────────────────────────────────────────────────────────────

def find_optimal_threshold(y_true: np.ndarray,
                            y_prob: np.ndarray,
                            beta:      float = 2.0,
                            min_thr:   float = 0.25,
                            min_prec:  float = 0.20) -> Tuple[float, float]:
    """
    Cherche le seuil de decision qui maximise le F-beta score
    sur la courbe precision-recall, avec contraintes minimales
    pour eviter les seuils trop bas (trop de fausses alarmes).

    beta     : poids recall vs precision (2 = recall x2)
    min_thr  : seuil plancher absolu (default 0.25)
    min_prec : precision minimale requise (default 0.20 = 20%)

    Retour : (threshold_optimal, f_beta_max)
    """
    precisions, recalls, thresholds = precision_recall_curve(y_true, y_prob)

    f_beta = ((1 + beta**2) * precisions * recalls /
              (beta**2 * precisions + recalls + 1e-9))[:-1]  # align with thresholds

    # Progressivement relacher les contraintes jusqu'a trouver un candidat valide
    for mask in [
        (thresholds >= min_thr) & (precisions[:-1] >= min_prec),  # contrainte complete
        (thresholds >= min_thr),                                    # seuil plancher seul
        np.ones(len(thresholds), dtype=bool),                       # aucune contrainte
    ]:
        if mask.any():
            idx = int(np.argmax(np.where(mask, f_beta, -np.inf)))
            break

    return float(thresholds[idx]), float(f_beta[idx])


# ─────────────────────────────────────────────────────────────
# CALLBACKS STANDARD
# ─────────────────────────────────────────────────────────────

def get_callbacks(model_path: str,
                  patience_es:  int = 15,
                  patience_lr:  int = 7,
                  min_lr:       float = 1e-6) -> list:
    """
    Retourne les callbacks standards pour l'entrainement :
      - ModelCheckpoint  : sauvegarde du meilleur modele (val_f2)
      - EarlyStopping    : arret si val_f2 ne s ameliore plus
      - ReduceLROnPlateau: reduit le LR si stagnation
    """
    return [
        keras.callbacks.ModelCheckpoint(
            filepath=model_path,
            monitor="val_probs_f2",
            mode="max",
            save_best_only=True,
            verbose=1,
        ),
        keras.callbacks.EarlyStopping(
            monitor="val_probs_f2",
            mode="max",
            patience=patience_es,
            restore_best_weights=True,
            verbose=1,
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_probs_f2",
            mode="max",
            factor=0.5,
            patience=patience_lr,
            min_lr=min_lr,
            verbose=1,
        ),
    ]


# ─────────────────────────────────────────────────────────────
# CHARGEMENT MODELE
# ─────────────────────────────────────────────────────────────

def load_model(model_path: str) -> keras.Model:
    """
    Charge un modele sauvegarde avec les objets custom
    (focal_loss, F2Score).
    """
    custom_objects = {
        "loss_fn": focal_loss(),
        "F2Score": F2Score,
    }
    return keras.models.load_model(model_path,
                                   custom_objects=custom_objects,
                                   compile=False)
