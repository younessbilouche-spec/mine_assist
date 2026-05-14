"""
MineAssist — Pipeline ML v4
Changements fondamentaux par rapport à v3 :

  1. HORIZON étendu à 2h (120 min au lieu de 30 min)
     → Les capteurs montrent un signal 2h avant une panne, pas 30 min
     
  2. LABELING inversé : fenêtre APRÈS la panne
     → On labellise les 2h AVANT chaque code GMAO enregistré
     → Plus cohérent avec ce que le GMAO capture réellement
     
  3. Pas de SMOTE (crée trop de bruit avec ces données)
     → class_weight seul + seuil optimisé
     
  4. Validation croisée temporelle (TimeSeriesSplit)
     → Évaluation plus robuste sur 5 périodes glissantes
"""

import pandas as pd
import numpy as np
from pathlib import Path
import json, joblib, argparse
from datetime import datetime

from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import (
    classification_report, f1_score, accuracy_score,
    roc_auc_score, precision_recall_curve
)
import warnings
warnings.filterwarnings("ignore")

try:
    from xgboost import XGBClassifier
    XGBOOST_DISPO = True
except ImportError:
    XGBOOST_DISPO = False
    print("⚠️  pip install xgboost")

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

HORIZON_MIN    = 120   # ← 2h au lieu de 30 min
FENETRE_POINTS = 12    # ← 12 × 5 min = 1h de fenêtre
BASE_DIR       = Path(__file__).resolve().parent
MODELS_DIR     = BASE_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# CHARGEMENT
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
            df["Parametre"] = df["Parametre"].str.replace(
                r"^CH\d+\.P\d+\.", "", regex=True)
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
    print(f"  → {len(df_all)} mesures | "
          f"{df_all['Heure'].min().date()} → {df_all['Heure'].max().date()}")
    return df_all


def charger_gmao(gmao_path):
    print("\n📋 Chargement GMAO...")
    df = pd.read_excel(gmao_path)
    df["Date de l'anomalie"] = pd.to_datetime(
        df["Date de l'anomalie"], errors="coerce")
    df = df.dropna(subset=["Date de l'anomalie"])
    df = df.rename(columns={
        "Date de l'anomalie": "timestamp",
        "Code d'anomalie":    "code_anomalie",
        "Gravité":            "gravite",
    })
    # Garder seulement les anomalies graves (gravité >= 2) pour le signal
    df_graves = df[df["gravite"] >= 2].copy()
    print(f"  → {len(df)} anomalies totales | "
          f"{len(df_graves)} de gravité ≥ 2 (utilisées pour le label)")
    return df_graves[["timestamp","code_anomalie","gravite"]]


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────────

def pivoter(df):
    df = df.copy()
    df["ts"] = df["Heure"].dt.round("5min")
    pivot = df.pivot_table(
        index="ts", columns="Parametre", values="Val_moy", aggfunc="mean")
    cols = [c for c in CAPTEURS_CIBLES if c in pivot.columns]
    pivot = pivot[cols]
    for col in pivot.columns:
        q99 = pivot[col].quantile(0.99)
        pivot[col] = pivot[col].where(
            (pivot[col] >= 0) & (pivot[col] <= q99 * 1.5))
    pivot = pivot.interpolate(method="time", limit=5)
    pivot = pivot.dropna(thresh=max(3, len(cols) // 2))
    print(f"\n🔄 Pivot : {len(pivot)} timestamps | {len(cols)} capteurs")
    return pivot


def creer_features(pivot):
    """
    Features glissantes sur FENETRE_POINTS points (1h).
    On ajoute aussi des features de tendance à plus long terme (3h).
    """
    features = pd.DataFrame(index=pivot.index)
    for col in pivot.columns:
        s = col.replace(" ","_").replace("'","").replace("°","deg")
        # Fenêtre courte (1h)
        r = pivot[col].rolling(window=FENETRE_POINTS, min_periods=3)
        features[f"{s}__mean"]  = r.mean()
        features[f"{s}__std"]   = r.std().fillna(0)
        features[f"{s}__min"]   = r.min()
        features[f"{s}__max"]   = r.max()
        features[f"{s}__range"] = r.max() - r.min()
        features[f"{s}__val"]   = pivot[col]
        # Pente courte
        def pente(x):
            if x.isna().any() or len(x) < 3: return 0.0
            return float(np.polyfit(range(len(x)), x.values, 1)[0])
        features[f"{s}__slope"] = pivot[col].rolling(
            window=FENETRE_POINTS, min_periods=3).apply(pente, raw=False)
        # Fenêtre longue (3h = 36 points) pour tendance
        r_long = pivot[col].rolling(window=36, min_periods=6)
        features[f"{s}__mean_3h"]  = r_long.mean()
        features[f"{s}__slope_3h"] = pivot[col].rolling(
            window=36, min_periods=6).apply(pente, raw=False)
    features = features.dropna(thresh=len(features.columns) // 3)
    print(f"⚙️  Features : {len(features)} points | {features.shape[1]} colonnes")
    return features


def etiqueter(features, df_gmao):
    """
    Pour chaque panne GMAO, on labellise les HORIZON_MIN minutes
    qui PRÉCÈDENT l'enregistrement du code.
    
    Logique : si une panne est enregistrée à 14h00,
    les capteurs de 12h00 à 13h55 portent le signal précurseur.
    """
    print(f"\n🏷️  Étiquetage (fenêtre de {HORIZON_MIN} min avant chaque panne)...")
    gmao = df_gmao.sort_values("timestamp")
    horizon = pd.Timedelta(minutes=HORIZON_MIN)

    timestamps = pd.to_datetime(features.index)
    y_bin     = np.zeros(len(features), dtype=int)
    y_gravite = np.zeros(len(features), dtype=int)

    for _, row in gmao.iterrows():
        ts_panne = row["timestamp"]
        # Fenêtre [ts_panne - horizon, ts_panne]
        mask = (timestamps >= ts_panne - horizon) & (timestamps <= ts_panne)
        y_bin[mask] = 1
        # On prend la gravité max
        y_gravite[mask] = np.maximum(y_gravite[mask], int(row["gravite"]))

    features = features.copy()
    features["y_bin"]     = y_bin
    features["y_gravite"] = y_gravite

    pct = y_bin.mean() * 100
    print(f"  → {y_bin.sum()} points en zone précurseur ({pct:.1f}%)")
    print(f"     Gravité 2:{(y_gravite==2).sum()} | 3:{(y_gravite==3).sum()}")
    return features


# ─────────────────────────────────────────────────────────────────────────────
# ISOLATION FOREST
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_if(X_train, y_bin_train, X_all):
    print("\n🌲 [3A] Isolation Forest...")
    scaler = StandardScaler()
    scaler.fit(X_train)
    X_train_s = scaler.transform(X_train)
    X_all_s   = scaler.transform(X_all)

    contamination = max(0.01, min(0.20, float(y_bin_train.mean())))
    print(f"  contamination = {contamination:.3f}")

    model = IsolationForest(n_estimators=300, contamination=contamination,
                            random_state=42, n_jobs=-1)
    model.fit(X_train_s)
    scores = model.decision_function(X_all_s)
    print(f"  ✅ IF entraîné")
    return model, scaler, scores


# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION CROISÉE TEMPORELLE
# ─────────────────────────────────────────────────────────────────────────────

def evaluer_avec_timeseries_split(X, y, modele_fn, n_splits=5):
    """
    TimeSeriesSplit : entraîne sur des fenêtres croissantes,
    évalue toujours sur la période suivante.
    Plus honnête que le simple split 80/20.
    """
    tscv   = TimeSeriesSplit(n_splits=n_splits)
    aucs   = []
    f1s    = []

    imputer = SimpleImputer(strategy="median")

    for fold, (train_idx, test_idx) in enumerate(tscv.split(X)):
        X_tr, X_te = X[train_idx], X[test_idx]
        y_tr, y_te = y[train_idx], y[test_idx]

        if (y_tr == 1).sum() < 5 or (y_te == 1).sum() < 5:
            continue

        X_tr = imputer.fit_transform(X_tr)
        X_te = imputer.transform(X_te)

        model = modele_fn()
        model.fit(X_tr, y_tr)

        y_proba = model.predict_proba(X_te)[:, 1]
        try:
            auc = roc_auc_score(y_te, y_proba)
        except:
            auc = 0.5

        # Seuil optimal par F1
        meilleur_f1, meilleur_seuil = 0, 0.5
        for seuil in np.arange(0.10, 0.60, 0.05):
            y_tmp = (y_proba >= seuil).astype(int)
            f = f1_score(y_te, y_tmp, zero_division=0)
            if f > meilleur_f1:
                meilleur_f1, meilleur_seuil = f, seuil

        aucs.append(auc)
        f1s.append(meilleur_f1)
        print(f"    Fold {fold+1}: AUC={auc:.3f} | F1={meilleur_f1:.3f} (seuil={meilleur_seuil:.2f})")

    return np.mean(aucs) if aucs else 0, np.mean(f1s) if f1s else 0


# ─────────────────────────────────────────────────────────────────────────────
# RANDOM FOREST FINAL
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_rf_final(X_train, X_test, y_train, y_test):
    print("\n🌳 [3B] Random Forest...")

    imputer = SimpleImputer(strategy="median")
    X_train = imputer.fit_transform(X_train)
    X_test  = imputer.transform(X_test)
    joblib.dump(imputer, MODELS_DIR / "imputer.pkl")

    n_pos = max((y_train == 1).sum(), 1)
    n_neg = (y_train == 0).sum()
    print(f"  Train : {n_neg} normaux | {n_pos} pannes")

    model = RandomForestClassifier(
        n_estimators=400,
        max_depth=15,
        min_samples_leaf=3,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train)

    y_proba = model.predict_proba(X_test)[:, 1]
    try:
        auc = roc_auc_score(y_test, y_proba)
    except:
        auc = 0.5

    # Seuil optimal
    meilleur_f1, meilleur_seuil = 0, 0.5
    for seuil in np.arange(0.10, 0.60, 0.05):
        y_tmp = (y_proba >= seuil).astype(int)
        f = f1_score(y_test, y_tmp, zero_division=0)
        if f > meilleur_f1:
            meilleur_f1, meilleur_seuil = f, seuil

    y_pred = (y_proba >= meilleur_seuil).astype(int)
    print(f"  ✅ Seuil={meilleur_seuil:.2f} | F1={meilleur_f1:.3f} | AUC={auc:.3f}")
    print(classification_report(y_test, y_pred, zero_division=0))

    joblib.dump(meilleur_seuil, MODELS_DIR / "rf_seuil.pkl")
    return model, {"f1": round(meilleur_f1,3), "auc": round(auc,3),
                   "seuil": round(meilleur_seuil,2)}


# ─────────────────────────────────────────────────────────────────────────────
# XGBOOST FINAL
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_xgb_final(X_train, X_test, y_train, y_test):
    print("\n⚡ [3C] XGBoost...")

    if not XGBOOST_DISPO:
        print("  ⚠️  pip install xgboost")
        return None, {}

    imputer = joblib.load(MODELS_DIR / "imputer.pkl")
    X_train = imputer.transform(X_train)
    X_test  = imputer.transform(X_test)

    n_pos = max((y_train == 1).sum(), 1)
    n_neg = (y_train == 0).sum()
    spw   = round(n_neg / n_pos, 2)
    print(f"  scale_pos_weight = {spw}")

    model = XGBClassifier(
        n_estimators=500,
        max_depth=5,
        learning_rate=0.02,
        subsample=0.8,
        colsample_bytree=0.7,
        scale_pos_weight=spw,
        reg_alpha=0.5,
        reg_lambda=2.0,
        eval_metric="aucpr",   # AUC sur Precision-Recall (mieux pour déséquilibre)
        random_state=42,
        n_jobs=-1,
        verbosity=0
    )
    model.fit(X_train, y_train,
              eval_set=[(X_test, y_test)], verbose=False)

    y_proba = model.predict_proba(X_test)[:, 1]
    try:
        auc = roc_auc_score(y_test, y_proba)
    except:
        auc = 0.5

    meilleur_f1, meilleur_seuil = 0, 0.5
    for seuil in np.arange(0.10, 0.60, 0.05):
        y_tmp = (y_proba >= seuil).astype(int)
        f = f1_score(y_test, y_tmp, zero_division=0)
        if f > meilleur_f1:
            meilleur_f1, meilleur_seuil = f, seuil

    y_pred = (y_proba >= meilleur_seuil).astype(int)
    print(f"  ✅ Seuil={meilleur_seuil:.2f} | F1={meilleur_f1:.3f} | AUC={auc:.3f}")
    print(classification_report(y_test, y_pred, zero_division=0))

    joblib.dump(meilleur_seuil, MODELS_DIR / "xgb_seuil.pkl")
    return model, {"f1": round(meilleur_f1,3), "auc_roc": round(auc,3),
                   "seuil": round(meilleur_seuil,2)}


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main(data_capteurs_dir, gmao_path):
    print("=" * 62)
    print("  MINEASSIST — Pipeline ML v4")
    print(f"  Horizon = {HORIZON_MIN} min | Fenêtre = {FENETRE_POINTS}×5min")
    print("=" * 62)
    np.random.seed(42)

    df_capteurs = charger_capteurs(data_capteurs_dir)
    df_gmao     = charger_gmao(gmao_path)
    pivot       = pivoter(df_capteurs)
    features    = creer_features(pivot)
    features    = etiqueter(features, df_gmao)

    label_cols    = ["y_bin","y_gravite"]
    X             = features.drop(columns=label_cols).values
    y_bin         = features["y_bin"].values
    feature_names = features.drop(columns=label_cols).columns.tolist()

    # Split chronologique 80/20
    n     = len(X)
    seuil = int(n * 0.8)
    X_train, X_test   = X[:seuil],     X[seuil:]
    y_train, y_test   = y_bin[:seuil], y_bin[seuil:]
    print(f"\n📊 Split : {seuil} train | {n-seuil} test")
    print(f"   Train anomalies : {y_train.sum()} ({y_train.mean()*100:.1f}%)")
    print(f"   Test  anomalies : {y_test.sum()} ({y_test.mean()*100:.1f}%)")

    meta = {"n_samples": int(n), "n_anomalies": int(y_bin.sum()),
            "horizon_min": HORIZON_MIN}

    # Validation croisée temporelle (évaluation honnête)
    print("\n📈 Validation croisée temporelle (5 folds)...")
    def make_rf():
        return RandomForestClassifier(n_estimators=200, class_weight="balanced",
                                      random_state=42, n_jobs=-1)
    auc_cv, f1_cv = evaluer_avec_timeseries_split(X, y_bin, make_rf)
    print(f"  RF cross-val : AUC moyen = {auc_cv:.3f} | F1 moyen = {f1_cv:.3f}")
    meta["cv_auc_rf"] = round(auc_cv, 3)
    meta["cv_f1_rf"]  = round(f1_cv, 3)

    # Entraînement final sur 80% + éval sur 20%
    if_model, if_scaler, _ = entrainer_if(X_train, y_train, X)

    if y_train.sum() >= 20:
        rf_model,  rf_metrics  = entrainer_rf_final(
            X_train, X_test, y_train, y_test)
        xgb_model, xgb_metrics = entrainer_xgb_final(
            X_train, X_test, y_train, y_test)
        meta["rf_metrics"]  = rf_metrics
        meta["xgb_metrics"] = xgb_metrics
    else:
        print("\n⚠️  Pas assez d'anomalies.")
        rf_model = xgb_model = None

    # Sauvegarde
    print("\n💾 Sauvegarde...")
    joblib.dump(if_model,  MODELS_DIR / "isolation_forest.pkl")
    joblib.dump(if_scaler, MODELS_DIR / "scaler_if.pkl")
    if rf_model:
        joblib.dump(rf_model,  MODELS_DIR / "random_forest_gravite.pkl")
    if xgb_model:
        joblib.dump(xgb_model, MODELS_DIR / "xgboost_alerte.pkl")
    with open(MODELS_DIR / "feature_names.json", "w", encoding="utf-8") as f:
        json.dump(feature_names, f, ensure_ascii=False, indent=2)
    meta["trained_at"] = datetime.now().isoformat()
    with open(MODELS_DIR / "model_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*62}")
    print("  ✅ PIPELINE v4 TERMINÉ")
    if meta.get("rf_metrics"):
        print(f"  RF  AUC={meta['rf_metrics']['auc']} | F1={meta['rf_metrics']['f1']}")
    if meta.get("xgb_metrics"):
        print(f"  XGB AUC={meta['xgb_metrics']['auc_roc']} | F1={meta['xgb_metrics']['f1']}")
    print(f"  Cross-val AUC (RF) = {auc_cv:.3f}")
    print(f"{'='*62}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_capteurs", default="./data/capteurs/")
    parser.add_argument("--gmao",          default="./data/gmao_anomalies.xlsx")
    args = parser.parse_args()
    main(args.data_capteurs, args.gmao)
