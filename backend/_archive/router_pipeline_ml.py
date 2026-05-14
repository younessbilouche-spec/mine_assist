"""
MineAssist — Pipeline ML Complet FINAL (v2.1)
CAT 994F · OCP Benguerir

Ce fichier remplace entièrement l'ancien pipeline_ml.py
Toutes les corrections sont déjà intégrées :
  ✅ Split chronologique (pas aléatoire)
  ✅ Pas de StandardScaler pour RF et XGBoost
  ✅ Une seule méthode pour le déséquilibre
  ✅ Contamination calculée depuis les données GMAO
  ✅ XGBoost à la place de GradientBoosting

Usage:
    python pipeline_ml_FINAL.py \
        --data_capteurs ./data/capteurs/ \
        --gmao ./data/gmao_anomalies.xlsx
"""

import pandas as pd
import numpy as np
from pathlib import Path
import json, joblib, argparse
from datetime import datetime

from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    classification_report, f1_score, accuracy_score, roc_auc_score
)
import warnings
warnings.filterwarnings("ignore")

try:
    from xgboost import XGBClassifier
    XGBOOST_DISPO = True
except ImportError:
    XGBOOST_DISPO = False
    print("⚠️  XGBoost non installé → pip install xgboost")

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTES
# ─────────────────────────────────────────────────────────────────────────────

CAPTEURS_CIBLES = [
    "Température liquide refroidissement",
    "Température échappement Droit",
    "Température échappement gauche",
    "Température sortie convertisseur",
    "Pression huile moteur",
    "Régime moteur",
    "Température huile direction",
    "Température huile freinage",
    "Pression d'air au réservoir",
    "Température essieux arrière",
    "Pression embrayage impeller",
]

FENETRE_POINTS  = 6      # 6 × 5 min = 30 min de fenêtre glissante
HORIZON_MIN     = 30     # prédire une panne 30 min à l'avance
BASE_DIR        = Path(__file__).resolve().parent
MODELS_DIR      = BASE_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 1 : CHARGEMENT
# ─────────────────────────────────────────────────────────────────────────────

def charger_capteurs(data_dir: Path) -> pd.DataFrame:
    print("📂 Chargement des capteurs...")
    all_files = list(data_dir.glob("*.xlsx")) + list(data_dir.glob("*.xls"))
    if not all_files:
        raise FileNotFoundError(f"Aucun fichier dans {data_dir}")

    frames = []
    for f in all_files:
        try:
            df = pd.read_excel(f, header=8)
            df.columns = ["Engin", "Parametre", "Code", "Heure",
                          "Val_min", "Val_moy", "Val_max", "Unite", "Capteur_OK"]
            df["Parametre"] = df["Parametre"].str.strip()
            df["Parametre"] = df["Parametre"].str.replace(r"^CH\d+\.P\d+\.", "", regex=True)
            for col in ["Val_min", "Val_moy", "Val_max"]:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            df["Heure"] = pd.to_datetime(df["Heure"], errors="coerce")
            df = df.dropna(subset=["Heure", "Parametre"])
            df = df[df["Parametre"].isin(CAPTEURS_CIBLES)]
            frames.append(df)
            print(f"  ✅ {f.name} ({len(df)} lignes)")
        except Exception as e:
            print(f"  ⚠️  {f.name} : {e}")

    df_all = pd.concat(frames, ignore_index=True)
    df_all = df_all.sort_values("Heure")
    print(f"\n  → {len(df_all)} mesures | {df_all['Heure'].min().date()} → {df_all['Heure'].max().date()}")
    return df_all


def charger_gmao(gmao_path: Path) -> pd.DataFrame:
    print("\n📋 Chargement GMAO...")
    df = pd.read_excel(gmao_path)
    df["Date de l'anomalie"] = pd.to_datetime(df["Date de l'anomalie"], errors="coerce")
    df = df.dropna(subset=["Date de l'anomalie"])
    df = df.rename(columns={
        "Date de l'anomalie": "timestamp",
        "Code d'anomalie":    "code_anomalie",
        "Gravité":            "gravite",
        "FMI du code d'anomalie": "fmi",
        "CID du code d'anomalie": "cid",
    })
    print(f"  → {len(df)} anomalies | gravité 1:{(df['gravite']==1).sum()} "
          f"2:{(df['gravite']==2).sum()} 3:{(df['gravite']==3).sum()}")
    return df[["timestamp", "code_anomalie", "gravite"]]


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 2 : FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────────

def pivoter_capteurs(df: pd.DataFrame) -> pd.DataFrame:
    print("\n🔄 Pivot des capteurs...")
    df = df.copy()
    df["ts"] = df["Heure"].dt.round("5min")
    pivot = df.pivot_table(index="ts", columns="Parametre", values="Val_moy", aggfunc="mean")
    cols = [c for c in CAPTEURS_CIBLES if c in pivot.columns]
    pivot = pivot[cols]
    for col in pivot.columns:
        q99 = pivot[col].quantile(0.99)
        pivot[col] = pivot[col].where((pivot[col] >= 0) & (pivot[col] <= q99 * 1.5))
    pivot = pivot.interpolate(method="time", limit=3)
    pivot = pivot.dropna(thresh=max(3, len(cols) // 2))
    print(f"  → {len(pivot)} timestamps | {len(cols)} capteurs")
    return pivot


def creer_features(pivot: pd.DataFrame) -> pd.DataFrame:
    print(f"\n⚙️  Features glissantes (fenêtre={FENETRE_POINTS}×5min)...")
    features = pd.DataFrame(index=pivot.index)
    for col in pivot.columns:
        safe = col.replace(" ", "_").replace("'", "").replace("°", "deg")
        roll = pivot[col].rolling(window=FENETRE_POINTS, min_periods=2)
        features[f"{safe}__mean"]  = roll.mean()
        features[f"{safe}__std"]   = roll.std().fillna(0)
        features[f"{safe}__min"]   = roll.min()
        features[f"{safe}__max"]   = roll.max()
        features[f"{safe}__range"] = roll.max() - roll.min()
        features[f"{safe}__val"]   = pivot[col]
        def pente(x):
            if x.isna().any() or len(x) < 2: return 0.0
            return float(np.polyfit(range(len(x)), x.values, 1)[0])
        features[f"{safe}__slope"] = pivot[col].rolling(
            window=FENETRE_POINTS, min_periods=2).apply(pente, raw=False)
    features = features.dropna(thresh=len(features.columns) // 2)
    features = features.fillna(features.median())
    print(f"  → {len(features)} points | {features.shape[1]} features")
    return features


def etiqueter(features: pd.DataFrame, df_gmao: pd.DataFrame) -> pd.DataFrame:
    print(f"\n🏷️  Étiquetage GMAO (horizon={HORIZON_MIN} min)...")
    gmao = df_gmao.sort_values("timestamp")
    horizon = pd.Timedelta(minutes=HORIZON_MIN)
    timestamps = pd.to_datetime(features.index)
    label_anom    = np.zeros(len(features), dtype=int)
    label_gravite = np.zeros(len(features), dtype=int)
    for i, ts in enumerate(timestamps):
        mask = (gmao["timestamp"] >= ts) & (gmao["timestamp"] <= ts + horizon)
        proches = gmao[mask]
        if len(proches) > 0:
            label_anom[i]    = 1
            label_gravite[i] = int(proches["gravite"].max())
    features = features.copy()
    features["label_anomalie"] = label_anom
    features["label_gravite"]  = label_gravite
    pct = label_anom.mean() * 100
    print(f"  → {label_anom.sum()} points avant panne ({pct:.1f}%)")
    return features


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 3A : ISOLATION FOREST — CORRIGÉ
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_isolation_forest(X: np.ndarray, y_bin: np.ndarray):
    print("\n🌲 [3A] Isolation Forest...")

    # StandardScaler conservé (IF en a besoin)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Contamination calculée depuis les vraies données (pas inventée)
    proportion = float((y_bin > 0).mean())
    contamination = max(0.01, min(0.20, proportion))
    print(f"  contamination = {contamination:.3f} (calculée depuis GMAO)")

    model = IsolationForest(
        n_estimators=300,
        contamination=contamination,
        max_samples="auto",
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_scaled)

    scores = model.decision_function(X_scaled)
    preds  = model.predict(X_scaled)
    n_anom = (preds == -1).sum()
    print(f"  ✅ {n_anom} anomalies détectées ({n_anom/len(preds)*100:.1f}%)")
    return model, scaler, scores


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 3B : RANDOM FOREST — CORRIGÉ
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_random_forest(X: np.ndarray, y_gravite: np.ndarray):
    print("\n🌳 [3B] Random Forest — Gravité...")

    # Split CHRONOLOGIQUE (pas aléatoire — obligatoire pour séries temporelles)
    n = len(X)
    seuil = int(n * 0.8)
    X_train, X_test = X[:seuil], X[seuil:]
    y_train, y_test = y_gravite[:seuil], y_gravite[seuil:]
    print(f"  Split chrono : {seuil} train | {n-seuil} test")

    # PAS de StandardScaler — inutile pour les arbres
    # class_weight="balanced" suffit (pas d'undersampling en plus)
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=15,
        min_samples_leaf=3,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    f1  = f1_score(y_test, y_pred, average="weighted", zero_division=0)
    print(f"  ✅ Accuracy: {acc:.3f} | F1-weighted: {f1:.3f}")
    print(classification_report(y_test, y_pred, zero_division=0))
    return model, {"accuracy": round(acc, 3), "f1_weighted": round(f1, 3)}


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 3C : XGBOOST — CORRIGÉ (remplace GradientBoosting)
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_xgboost(X: np.ndarray, y_bin: np.ndarray):
    print("\n⚡ [3C] XGBoost — Alerte 30 min...")

    if not XGBOOST_DISPO:
        print("  ⚠️  XGBoost non dispo. pip install xgboost")
        return None, {"f1": 0, "auc_roc": 0}

    # Split CHRONOLOGIQUE
    n = len(X)
    seuil = int(n * 0.8)
    X_train, X_test = X[:seuil], X[seuil:]
    y_train, y_test = y_bin[:seuil], y_bin[seuil:]
    print(f"  Split chrono : {seuil} train | {n-seuil} test")

    # PAS de StandardScaler — inutile pour XGBoost
    # scale_pos_weight = gestion native du déséquilibre (équivalent class_weight)
    n_pos = max((y_train == 1).sum(), 1)
    n_neg = (y_train == 0).sum()
    spw   = round(n_neg / n_pos, 2)
    print(f"  scale_pos_weight = {spw} ({n_neg} normaux / {n_pos} pannes)")

    model = XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=spw,
        reg_alpha=0.1,
        reg_lambda=1.0,
        eval_metric="logloss",
        random_state=42,
        n_jobs=-1,
        verbosity=0
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]
    f1  = f1_score(y_test, y_pred, zero_division=0)
    try:
        auc = roc_auc_score(y_test, y_proba)
    except:
        auc = 0.5
    print(f"  ✅ F1: {f1:.3f} | AUC-ROC: {auc:.3f}")
    print(classification_report(y_test, y_pred, zero_division=0))
    return model, {"f1": round(f1, 3), "auc_roc": round(auc, 3)}


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 4 : SAUVEGARDE
# ─────────────────────────────────────────────────────────────────────────────

def sauvegarder(if_model, if_scaler, rf_model, xgb_model,
                feature_names, meta):
    print("\n💾 Sauvegarde...")
    joblib.dump(if_model,  MODELS_DIR / "isolation_forest.pkl")
    joblib.dump(if_scaler, MODELS_DIR / "scaler_if.pkl")
    joblib.dump(rf_model,  MODELS_DIR / "random_forest_gravite.pkl")
    if xgb_model is not None:
        joblib.dump(xgb_model, MODELS_DIR / "xgboost_alerte.pkl")

    with open(MODELS_DIR / "feature_names.json", "w", encoding="utf-8") as f:
        json.dump(feature_names, f, ensure_ascii=False, indent=2)

    meta["trained_at"] = datetime.now().isoformat()
    meta["feature_count"] = len(feature_names)
    meta["capteurs_used"] = CAPTEURS_CIBLES
    meta["corrections"] = [
        "split_chronologique",
        "no_scaler_arbres",
        "une_seule_methode_desequilibre",
        "contamination_calculee"
    ]
    with open(MODELS_DIR / "model_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"  ✅ Modèles dans : {MODELS_DIR}")
    print(f"  ✅ {len(feature_names)} features sauvegardées")


# ─────────────────────────────────────────────────────────────────────────────
# FONCTION PRINCIPALE
# ─────────────────────────────────────────────────────────────────────────────

def main(data_capteurs_dir: str, gmao_path: str):
    print("=" * 60)
    print("  MINEASSIST — Pipeline ML Final v2.1")
    print("  CAT 994F · OCP Benguerir")
    print("=" * 60)
    np.random.seed(42)

    # Chargement
    df_capteurs = charger_capteurs(Path(data_capteurs_dir))
    df_gmao     = charger_gmao(Path(gmao_path))

    # Feature engineering
    pivot    = pivoter_capteurs(df_capteurs)
    features = creer_features(pivot)
    features = etiqueter(features, df_gmao)

    # Séparation X / labels
    label_cols    = ["label_anomalie", "label_gravite"]
    X             = features.drop(columns=label_cols).values
    y_gravite     = features["label_gravite"].values
    y_bin         = features["label_anomalie"].values
    feature_names = features.drop(columns=label_cols).columns.tolist()

    meta = {"n_samples": len(X), "n_anomalies": int(y_bin.sum())}

    # Entraînement des 3 modèles (versions corrigées)
    if_model, if_scaler, _  = entrainer_isolation_forest(X, y_bin)
    meta["if_contamination"]  = float(max(0.01, min(0.20, y_bin.mean())))

    if y_bin.sum() >= 20:
        rf_model, rf_metrics  = entrainer_random_forest(X, y_gravite)
        xgb_model, xgb_metrics = entrainer_xgboost(X, y_bin)
        meta["rf_metrics"]    = rf_metrics
        meta["xgb_metrics"]   = xgb_metrics
    else:
        print("\n⚠️  Pas assez d'anomalies labellisées (<20). Modèles supervisés non entraînés.")
        rf_model  = RandomForestClassifier().fit(X[:10], y_gravite[:10])
        xgb_model = None
        meta["rf_metrics"]  = None
        meta["xgb_metrics"] = None

    # Sauvegarde
    sauvegarder(if_model, if_scaler, rf_model, xgb_model, feature_names, meta)

    print("\n" + "=" * 60)
    print("  ✅ ENTRAÎNEMENT TERMINÉ")
    print("  Modèles disponibles :")
    print("    🌲 Isolation Forest  → GET  /ml/anomaly-score")
    print("    🌳 Random Forest     → POST /ml/predict (gravité)")
    print("    ⚡ XGBoost           → POST /ml/predict (alerte 30min)")
    print("  Lance maintenant : uvicorn app.api:app --reload")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_capteurs", default="./data/capteurs/")
    parser.add_argument("--gmao",          default="./data/gmao_anomalies.xlsx")
    args = parser.parse_args()
    main(args.data_capteurs, args.gmao)
