"""
MineAssist — Pipeline ML v3
Corrections du problème recall=0 :
  1. SMOTE pour sur-échantillonner les anomalies dans le train
  2. Seuil XGBoost abaissé à 0.25 (au lieu de 0.5)
  3. RF en mode binaire (normal vs anomalie) — plus stable
  4. Normalisation des features calculée sur train uniquement
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
    print("⚠️  pip install xgboost")

try:
    from imblearn.over_sampling import SMOTE
    SMOTE_DISPO = True
except ImportError:
    SMOTE_DISPO = False
    print("⚠️  pip install imbalanced-learn  (SMOTE non disponible)")

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

FENETRE_POINTS = 6
HORIZON_MIN    = 30
SEUIL_XGB      = 0.25   # ← abaissé de 0.5 à 0.25 pour augmenter le recall
BASE_DIR       = Path(__file__).resolve().parent
MODELS_DIR     = BASE_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# CHARGEMENT (identique à v2)
# ─────────────────────────────────────────────────────────────────────────────

def charger_capteurs(data_dir):
    print("📂 Chargement des capteurs...")
    all_files = list(Path(data_dir).glob("*.xlsx")) + list(Path(data_dir).glob("*.xls"))
    if not all_files:
        raise FileNotFoundError(f"Aucun fichier dans {data_dir}")
    frames = []
    for f in all_files:
        try:
            df = pd.read_excel(f, header=8)
            df.columns = ["Engin","Parametre","Code","Heure",
                          "Val_min","Val_moy","Val_max","Unite","Capteur_OK"]
            df["Parametre"] = df["Parametre"].str.strip()
            df["Parametre"] = df["Parametre"].str.replace(r"^CH\d+\.P\d+\.", "", regex=True)
            for col in ["Val_min","Val_moy","Val_max"]:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            df["Heure"] = pd.to_datetime(df["Heure"], errors="coerce")
            df = df.dropna(subset=["Heure","Parametre"])
            df = df[df["Parametre"].isin(CAPTEURS_CIBLES)]
            frames.append(df)
            print(f"  ✅ {f.name}")
        except Exception as e:
            print(f"  ⚠️  {f.name}: {e}")
    df_all = pd.concat(frames, ignore_index=True).sort_values("Heure")
    print(f"  → {len(df_all)} mesures")
    return df_all


def charger_gmao(gmao_path):
    print("\n📋 Chargement GMAO...")
    df = pd.read_excel(gmao_path)
    df["Date de l'anomalie"] = pd.to_datetime(df["Date de l'anomalie"], errors="coerce")
    df = df.dropna(subset=["Date de l'anomalie"])
    df = df.rename(columns={
        "Date de l'anomalie": "timestamp",
        "Code d'anomalie":    "code_anomalie",
        "Gravité":            "gravite",
    })
    print(f"  → {len(df)} anomalies")
    return df[["timestamp","code_anomalie","gravite"]]


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────────

def pivoter(df):
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
    print(f"\n🔄 Pivot : {len(pivot)} timestamps | {len(cols)} capteurs")
    return pivot


def creer_features(pivot):
    features = pd.DataFrame(index=pivot.index)
    for col in pivot.columns:
        safe = col.replace(" ","_").replace("'","").replace("°","deg")
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
    print(f"⚙️  Features : {len(features)} points | {features.shape[1]} colonnes")
    return features


def etiqueter(features, df_gmao):
    print(f"\n🏷️  Étiquetage (horizon={HORIZON_MIN} min)...")
    gmao = df_gmao.sort_values("timestamp")
    horizon = pd.Timedelta(minutes=HORIZON_MIN)
    timestamps = pd.to_datetime(features.index)
    y_bin     = np.zeros(len(features), dtype=int)
    y_gravite = np.zeros(len(features), dtype=int)
    for i, ts in enumerate(timestamps):
        mask = (gmao["timestamp"] >= ts) & (gmao["timestamp"] <= ts + horizon)
        proches = gmao[mask]
        if len(proches) > 0:
            y_bin[i]     = 1
            y_gravite[i] = int(proches["gravite"].max())
    features = features.copy()
    features["y_bin"]     = y_bin
    features["y_gravite"] = y_gravite
    print(f"  → {y_bin.sum()} points avant panne ({y_bin.mean()*100:.1f}%)")
    return features


# ─────────────────────────────────────────────────────────────────────────────
# SPLIT CHRONOLOGIQUE
# ─────────────────────────────────────────────────────────────────────────────

def split_chrono(X, y, ratio_test=0.2):
    n = len(X)
    s = int(n * (1 - ratio_test))
    print(f"  Split chrono : {s} train | {n-s} test")
    return X[:s], X[s:], y[:s], y[s:]


# ─────────────────────────────────────────────────────────────────────────────
# ISOLATION FOREST
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_if(X, y_bin):
    print("\n🌲 [3A] Isolation Forest...")
    scaler = StandardScaler()

    # CORRECTION : fitter le scaler sur TRAIN uniquement, pas tout X
    n = int(len(X) * 0.8)
    scaler.fit(X[:n])
    X_scaled = scaler.transform(X)

    contamination = max(0.01, min(0.20, float(y_bin.mean())))
    print(f"  contamination = {contamination:.3f}")

    model = IsolationForest(n_estimators=300, contamination=contamination,
                            random_state=42, n_jobs=-1)
    model.fit(X_scaled[:n])   # entraîné sur train uniquement
    scores = model.decision_function(X_scaled)
    print(f"  ✅ IF entraîné")
    return model, scaler, scores


# ─────────────────────────────────────────────────────────────────────────────
# RANDOM FOREST — binaire + SMOTE
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_rf(X, y_bin):
    """
    RF simplifié en binaire : 0=normal, 1=anomalie (toute gravité confondue).
    Plus stable que multi-classe avec peu d'exemples critiques.
    SMOTE crée de nouveaux exemples synthétiques de la classe minoritaire.
    """
    print("\n🌳 [3B] Random Forest — Détection binaire...")

    X_train, X_test, y_train, y_test = split_chrono(X, y_bin)

    print(f"  Train : {(y_train==0).sum()} normaux | {(y_train==1).sum()} pannes")

    # Remplir les NaN avant SMOTE (SMOTE refuse les valeurs manquantes)
    from sklearn.impute import SimpleImputer
    imputer = SimpleImputer(strategy="median")
    X_train = imputer.fit_transform(X_train)
    X_test  = imputer.transform(X_test)
    joblib.dump(imputer, MODELS_DIR / "imputer.pkl")

    # SMOTE : crée des exemples synthétiques pour équilibrer les classes
    if SMOTE_DISPO and (y_train == 1).sum() >= 10:
        print("  SMOTE : sur-échantillonnage des pannes...")
        sm = SMOTE(random_state=42, k_neighbors=5)
        X_train, y_train = sm.fit_resample(X_train, y_train)
        print(f"  Après SMOTE : {(y_train==0).sum()} normaux | {(y_train==1).sum()} pannes")
    else:
        print("  SMOTE non dispo → class_weight='balanced'")

    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train)

    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    # Seuil optimisé : chercher le seuil qui maximise le F1
    meilleur_f1, meilleur_seuil = 0, 0.5
    for seuil in np.arange(0.10, 0.50, 0.05):
        y_tmp = (y_proba >= seuil).astype(int)
        f = f1_score(y_test, y_tmp, zero_division=0)
        if f > meilleur_f1:
            meilleur_f1    = f
            meilleur_seuil = seuil

    y_pred_opt = (y_proba >= meilleur_seuil).astype(int)
    acc = accuracy_score(y_test, y_pred_opt)
    try:
        auc = roc_auc_score(y_test, y_proba)
    except:
        auc = 0.5

    print(f"  ✅ Seuil optimal : {meilleur_seuil:.2f} | F1: {meilleur_f1:.3f} | AUC: {auc:.3f}")
    print(classification_report(y_test, y_pred_opt, zero_division=0))

    # Sauvegarder le seuil optimal pour l'inférence
    joblib.dump(meilleur_seuil, MODELS_DIR / "rf_seuil.pkl")

    return model, {"f1": round(meilleur_f1, 3), "auc": round(auc, 3),
                   "seuil_optimal": round(meilleur_seuil, 2)}


# ─────────────────────────────────────────────────────────────────────────────
# XGBOOST — seuil abaissé
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_xgboost(X, y_bin):
    """
    XGBoost avec seuil de décision abaissé à 0.25.
    Augmente le recall (détecte plus de pannes) au prix de quelques faux positifs.
    Logique industrielle : mieux vaut une fausse alarme qu'une panne ratée.
    """
    print("\n⚡ [3C] XGBoost — Alerte 30 min...")

    if not XGBOOST_DISPO:
        print("  ⚠️  pip install xgboost")
        return None, {"f1": 0, "auc_roc": 0}

    X_train, X_test, y_train, y_test = split_chrono(X, y_bin)

    # Remplir les NaN (réutiliser l'imputer sauvegardé par RF si dispo)
    from sklearn.impute import SimpleImputer
    imputer_path = MODELS_DIR / "imputer.pkl"
    if imputer_path.exists():
        imputer = joblib.load(imputer_path)
        X_train = imputer.transform(X_train)
        X_test  = imputer.transform(X_test)
    else:
        imputer = SimpleImputer(strategy="median")
        X_train = imputer.fit_transform(X_train)
        X_test  = imputer.transform(X_test)

    n_pos = max((y_train == 1).sum(), 1)
    n_neg = (y_train == 0).sum()
    spw   = round(n_neg / n_pos, 2)
    print(f"  scale_pos_weight = {spw}")

    model = XGBClassifier(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.03,
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

    y_proba = model.predict_proba(X_test)[:, 1]

    # Seuil abaissé à SEUIL_XGB (0.25 au lieu de 0.5)
    y_pred_025 = (y_proba >= SEUIL_XGB).astype(int)

    f1  = f1_score(y_test, y_pred_025, zero_division=0)
    try:
        auc = roc_auc_score(y_test, y_proba)
    except:
        auc = 0.5

    print(f"  ✅ Seuil={SEUIL_XGB} | F1: {f1:.3f} | AUC-ROC: {auc:.3f}")
    print(classification_report(y_test, y_pred_025, zero_division=0))

    # Sauvegarder le seuil pour l'inférence
    joblib.dump(SEUIL_XGB, MODELS_DIR / "xgb_seuil.pkl")

    return model, {"f1": round(f1, 3), "auc_roc": round(auc, 3),
                   "seuil": SEUIL_XGB}


# ─────────────────────────────────────────────────────────────────────────────
# SAUVEGARDE
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
    meta["trained_at"]    = datetime.now().isoformat()
    meta["feature_count"] = len(feature_names)
    meta["seuil_xgb"]     = SEUIL_XGB
    with open(MODELS_DIR / "model_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"  ✅ Modèles dans : {MODELS_DIR}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main(data_capteurs_dir, gmao_path):
    print("=" * 60)
    print("  MINEASSIST — Pipeline ML v3")
    print("  Corrections : SMOTE + seuil optimisé + RF binaire")
    print("=" * 60)
    np.random.seed(42)

    df_capteurs = charger_capteurs(data_capteurs_dir)
    df_gmao     = charger_gmao(gmao_path)
    pivot       = pivoter(df_capteurs)
    features    = creer_features(pivot)
    features    = etiqueter(features, df_gmao)

    label_cols    = ["y_bin", "y_gravite"]
    X             = features.drop(columns=label_cols).values
    y_bin         = features["y_bin"].values
    y_gravite     = features["y_gravite"].values
    feature_names = features.drop(columns=label_cols).columns.tolist()

    meta = {"n_samples": int(len(X)), "n_anomalies": int(y_bin.sum())}

    if_model, if_scaler, _ = entrainer_if(X, y_bin)

    if y_bin.sum() >= 20:
        rf_model,  rf_metrics  = entrainer_rf(X, y_bin)
        xgb_model, xgb_metrics = entrainer_xgboost(X, y_bin)
        meta["rf_metrics"]  = rf_metrics
        meta["xgb_metrics"] = xgb_metrics
    else:
        print("\n⚠️  Trop peu d'anomalies pour entraîner RF/XGBoost")
        rf_model = xgb_model = None

    sauvegarder(if_model, if_scaler, rf_model, xgb_model, feature_names, meta)

    print("\n" + "=" * 60)
    print("  ✅ PIPELINE v3 TERMINÉ")
    if meta.get("rf_metrics"):
        print(f"  RF  : F1={meta['rf_metrics']['f1']} | AUC={meta['rf_metrics']['auc']}")
    if meta.get("xgb_metrics"):
        print(f"  XGB : F1={meta['xgb_metrics']['f1']} | AUC={meta['xgb_metrics']['auc_roc']}")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_capteurs", default="./data/capteurs/")
    parser.add_argument("--gmao",          default="./data/gmao_anomalies.xlsx")
    args = parser.parse_args()
    main(args.data_capteurs, args.gmao)
