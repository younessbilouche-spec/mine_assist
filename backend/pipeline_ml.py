"""
MineAssist — Pipeline ML Complet v2
CAT 994F · OCP Benguerir

DÉMARCHE :
  Étape 1 : Charger et fusionner données capteurs + codes GMAO
  Étape 2 : Feature engineering (stats sur fenêtre temporelle)
  Étape 3A: Détection d'anomalies non-supervisée (Isolation Forest amélioré)
  Étape 3B: Classification supervisée de la gravité (Random Forest)
  Étape 3C: Prédiction anticipée de panne (30 min avant)
  Étape 4 : Évaluation + sauvegarde des modèles

Usage:
    python pipeline_ml.py --data_capteurs ./data/capteurs/ --gmao ./data/gmao_anomalies.xlsx
"""

import pandas as pd
import numpy as np
from pathlib import Path
import json, joblib, argparse
from datetime import datetime

from sklearn.ensemble import IsolationForest, RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    classification_report, confusion_matrix,
    roc_auc_score, f1_score, accuracy_score
)
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
import warnings
warnings.filterwarnings("ignore")

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

FENETRE_MINUTES = 30      # fenêtre glissante pour features
HORIZON_ALERTE_MIN = 30   # prédire une panne 30 min à l'avance

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 1 : CHARGEMENT DES DONNÉES
# ─────────────────────────────────────────────────────────────────────────────

def charger_capteurs(data_dir: Path) -> pd.DataFrame:
    """
    Charge tous les fichiers Excel des capteurs.
    Format attendu: header à la ligne 8 (index 8 = 9ème ligne).
    Colonnes: Engin, Parametre, Code, Heure, Val_min, Val_moy, Val_max, Unite, Capteur_OK
    """
    print("📂 Chargement des capteurs...")
    all_files = list(data_dir.glob("*.xlsx")) + list(data_dir.glob("*.xls"))
    
    if not all_files:
        raise FileNotFoundError(f"Aucun fichier capteur dans {data_dir}")
    
    frames = []
    for f in all_files:
        try:
            df = pd.read_excel(f, header=8)
            df.columns = [
                "Engin", "Parametre", "Code", "Heure",
                "Val_min", "Val_moy", "Val_max", "Unite", "Capteur_OK"
            ]
            # Nettoyage du nom du paramètre: enlever "CH994.P1." etc.
            df["Parametre"] = df["Parametre"].str.strip()
            df["Parametre"] = df["Parametre"].str.replace(
                r"^CH\d+\.P\d+\.", "", regex=True
            )
            # Conversions numériques
            for col in ["Val_min", "Val_moy", "Val_max"]:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            df["Heure"] = pd.to_datetime(df["Heure"], errors="coerce")
            df = df.dropna(subset=["Heure", "Parametre"])
            
            # Filtrer sur les capteurs cibles seulement
            df = df[df["Parametre"].isin(CAPTEURS_CIBLES)]
            frames.append(df)
            print(f"  ✅ {f.name}: {len(df)} mesures")
        except Exception as e:
            print(f"  ⚠️  {f.name}: erreur → {e}")
    
    if not frames:
        raise ValueError("Aucune donnée capteur chargée avec succès.")
    
    df_all = pd.concat(frames, ignore_index=True)
    df_all = df_all.sort_values("Heure").drop_duplicates(
        subset=["Heure", "Parametre"], keep="last"
    )
    print(f"\n  → {len(df_all)} mesures totales | "
          f"{df_all['Heure'].min().date()} → {df_all['Heure'].max().date()}")
    return df_all


def charger_gmao(gmao_path: Path) -> pd.DataFrame:
    """
    Charge les codes d'anomalies GMAO.
    Colonnes importantes:
      - "Code d'anomalie": libellé du défaut
      - "Date de l'anomalie": horodatage
      - "Gravité": 1=info, 2=avertissement, 3=critique
      - "FMI du code d'anomalie": Failure Mode Identifier
      - "CID du code d'anomalie": Component Identifier
    """
    print("\n📋 Chargement des anomalies GMAO...")
    df = pd.read_excel(gmao_path)
    df["Date de l'anomalie"] = pd.to_datetime(df["Date de l'anomalie"], errors="coerce")
    df = df.dropna(subset=["Date de l'anomalie"])
    df = df.rename(columns={
        "Date de l'anomalie": "timestamp",
        "Code d'anomalie": "code_anomalie",
        "Gravité": "gravite",
        "FMI du code d'anomalie": "fmi",
        "CID du code d'anomalie": "cid",
    })
    print(f"  → {len(df)} anomalies | Gravité 1:{(df['gravite']==1).sum()} | "
          f"2:{(df['gravite']==2).sum()} | 3:{(df['gravite']==3).sum()}")
    return df[["timestamp", "code_anomalie", "gravite", "fmi", "cid"]]


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 2 : FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────────

def pivoter_capteurs(df_capteurs: pd.DataFrame, freq: str = "5min") -> pd.DataFrame:
    """
    Transforme les données long → large :
      Avant: (timestamp, parametre, valeur)
      Après: (timestamp, temp_refroid, pression_huile, ...) — une colonne par capteur
    
    On rééchantillonne à 5 minutes pour aligner tous les capteurs.
    """
    print("\n🔄 Pivot des capteurs (format large)...")
    
    # Arrondir à la fréquence choisie
    df = df_capteurs.copy()
    df["ts_round"] = df["Heure"].dt.round(freq)
    
    pivot = df.pivot_table(
        index="ts_round",
        columns="Parametre",
        values="Val_moy",
        aggfunc="mean"
    )
    
    # Garder seulement les colonnes disponibles
    cols_dispo = [c for c in CAPTEURS_CIBLES if c in pivot.columns]
    pivot = pivot[cols_dispo]
    
    # Supprimer valeurs physiquement impossibles (capteurs défaillants)
    for col in pivot.columns:
        q1, q99 = pivot[col].quantile([0.01, 0.99])
        pivot[col] = pivot[col].where(
            (pivot[col] >= 0) & (pivot[col] <= q99 * 1.5)
        )
    
    # Interpolation temporelle pour combler les trous < 15 min
    pivot = pivot.interpolate(method="time", limit=3)
    pivot = pivot.dropna(thresh=max(3, len(cols_dispo) // 2))
    
    print(f"  → {len(pivot)} timestamps | {len(cols_dispo)} capteurs")
    return pivot


def creer_features_glissantes(pivot: pd.DataFrame, fenetre: int = 6) -> pd.DataFrame:
    """
    Crée des features statistiques sur fenêtre glissante.
    
    Pour chaque capteur, on calcule sur les N derniers points:
      - Moyenne (tendance centrale)
      - Écart-type (variabilité)
      - Min / Max (extremes)
      - Pente (tendance : montée ou descente ?)
      - Ratio val/seuil (proximité du danger)
    
    Résultat: ~50-70 features par timestamp
    """
    print(f"\n⚙️  Feature engineering (fenêtre={fenetre} × 5min = {fenetre*5}min)...")
    
    features = pd.DataFrame(index=pivot.index)
    
    for col in pivot.columns:
        safe_col = col.replace(" ", "_").replace("'", "").replace("°", "deg")
        series = pivot[col]
        
        # Stats basiques sur la fenêtre
        roll = series.rolling(window=fenetre, min_periods=2)
        features[f"{safe_col}__mean"]  = roll.mean()
        features[f"{safe_col}__std"]   = roll.std().fillna(0)
        features[f"{safe_col}__min"]   = roll.min()
        features[f"{safe_col}__max"]   = roll.max()
        features[f"{safe_col}__range"] = roll.max() - roll.min()
        
        # Pente (régression linéaire sur la fenêtre)
        def pente(x):
            if x.isna().any() or len(x) < 2:
                return 0.0
            return np.polyfit(range(len(x)), x.values, 1)[0]
        
        features[f"{safe_col}__slope"] = series.rolling(
            window=fenetre, min_periods=2
        ).apply(pente, raw=False)
        
        # Valeur instantanée
        features[f"{safe_col}__val"] = series
    
    # Supprimer les lignes avec trop de NaN
    features = features.dropna(thresh=len(features.columns) // 2)
    features = features.fillna(features.median())
    
    print(f"  → {len(features)} points | {features.shape[1]} features")
    return features


def etiqueter_avec_gmao(
    features: pd.DataFrame,
    df_gmao: pd.DataFrame,
    horizon_min: int = 30
) -> pd.DataFrame:
    """
    Associe chaque timestamp à la prochaine anomalie GMAO.
    
    Pour chaque instant t, on cherche:
      - Y a-t-il une anomalie GMAO dans [t, t + horizon_min] ?
      - Si oui, quelle est la gravité maximale ?
    
    Labels créés:
      - label_anomalie: 0=normal, 1=anomalie dans les 30 prochaines min
      - label_gravite:  0=normal, 1=info, 2=avert, 3=critique
    """
    print(f"\n🏷️  Étiquetage GMAO (horizon={horizon_min} min)...")
    
    df_gmao_sorted = df_gmao.sort_values("timestamp")
    timestamps = pd.to_datetime(features.index)
    horizon = pd.Timedelta(minutes=horizon_min)
    
    labels_anomalie = np.zeros(len(features), dtype=int)
    labels_gravite  = np.zeros(len(features), dtype=int)
    
    for i, ts in enumerate(timestamps):
        # Anomalies dans [ts, ts + horizon]
        mask = (
            (df_gmao_sorted["timestamp"] >= ts) &
            (df_gmao_sorted["timestamp"] <= ts + horizon)
        )
        anomalies_proches = df_gmao_sorted[mask]
        
        if len(anomalies_proches) > 0:
            labels_anomalie[i] = 1
            labels_gravite[i]  = int(anomalies_proches["gravite"].max())
    
    features = features.copy()
    features["label_anomalie"] = labels_anomalie
    features["label_gravite"]  = labels_gravite
    
    pct = labels_anomalie.mean() * 100
    print(f"  → {labels_anomalie.sum()} points avant anomalie ({pct:.1f}%)")
    print(f"     Gravité 1:{(labels_gravite==1).sum()} | "
          f"2:{(labels_gravite==2).sum()} | "
          f"3:{(labels_gravite==3).sum()}")
    return features


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 3A : DÉTECTION D'ANOMALIES NON-SUPERVISÉE (Isolation Forest)
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_isolation_forest(X: np.ndarray) -> tuple:
    """
    Isolation Forest amélioré:
    - contamination calibrée sur les données réelles
    - plus d'arbres pour plus de stabilité
    """
    print("\n🌲 [3A] Isolation Forest (non-supervisé)...")
    
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    model = IsolationForest(
        n_estimators=300,
        contamination=0.08,   # ~8% d'anomalies attendues
        max_samples="auto",
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_scaled)
    
    scores = model.decision_function(X_scaled)
    preds  = model.predict(X_scaled)
    n_anom = (preds == -1).sum()
    
    print(f"  ✅ Entraîné | {n_anom} anomalies ({n_anom/len(preds)*100:.1f}%)")
    return model, scaler, scores


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 3B : CLASSIFICATION SUPERVISÉE DE LA GRAVITÉ
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_classificateur_gravite(
    X: np.ndarray, y: np.ndarray
) -> tuple:
    """
    Random Forest pour classifier la gravité d'une future anomalie.
    Classes: 0=normal, 1=info, 2=avertissement, 3=critique
    
    On utilise un Random Forest car:
    - Robuste aux données déséquilibrées
    - Interprétable (importance des features)
    - Fonctionne bien avec peu de données
    """
    print("\n🌳 [3B] Random Forest — Classification gravité...")
    
    # Ne garder que les points avec anomalie OU normal (50/50 max)
    mask_pos = y > 0
    mask_neg = y == 0
    
    n_pos = mask_pos.sum()
    n_neg = min(mask_neg.sum(), n_pos * 3)  # 3x plus de négatifs max
    
    idx_pos = np.where(mask_pos)[0]
    idx_neg = np.random.choice(np.where(mask_neg)[0], n_neg, replace=False)
    idx_all = np.concatenate([idx_pos, idx_neg])
    np.random.shuffle(idx_all)
    
    X_bal, y_bal = X[idx_all], y[idx_all]
    
    X_train, X_test, y_train, y_test = train_test_split(
        X_bal, y_bal, test_size=0.2, random_state=42, stratify=y_bal
    )
    
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)
    
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train_s, y_train)
    
    y_pred = model.predict(X_test_s)
    acc    = accuracy_score(y_test, y_pred)
    f1     = f1_score(y_test, y_pred, average="weighted", zero_division=0)
    
    print(f"  ✅ Accuracy: {acc:.3f} | F1-score: {f1:.3f}")
    print(f"  📊 Rapport:\n{classification_report(y_test, y_pred, zero_division=0)}")
    
    # Feature importances (top 10)
    feature_names_out = [f"feature_{i}" for i in range(X.shape[1])]
    importances = pd.Series(model.feature_importances_, index=feature_names_out)
    print(f"  🔑 Top features: {importances.nlargest(5).to_dict()}")
    
    return model, scaler, {"accuracy": acc, "f1": f1}


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 3C : PRÉDICTION ANTICIPÉE (ALERTE PRÉVENTIVE)
# ─────────────────────────────────────────────────────────────────────────────

def entrainer_modele_alerte(
    X: np.ndarray, y_bin: np.ndarray
) -> tuple:
    """
    Gradient Boosting pour prédire une panne imminente (binaire: 0=OK, 1=danger).
    Plus sensible que le Random Forest pour la détection précoce.
    """
    print("\n⚡ [3C] Gradient Boosting — Alerte préventive (30 min)...")
    
    X_train, X_test, y_train, y_test = train_test_split(
        X, y_bin, test_size=0.2, random_state=42, stratify=y_bin
    )
    
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)
    
    # Ratio déséquilibre
    ratio = (y_bin == 0).sum() / max((y_bin == 1).sum(), 1)
    
    model = GradientBoostingClassifier(
        n_estimators=150,
        learning_rate=0.05,
        max_depth=5,
        subsample=0.8,
        random_state=42,
    )
    model.fit(X_train_s, y_train)
    
    y_pred = model.predict(X_test_s)
    y_proba = model.predict_proba(X_test_s)[:, 1]
    
    f1  = f1_score(y_test, y_pred, zero_division=0)
    try:
        auc = roc_auc_score(y_test, y_proba)
    except:
        auc = 0.5
    
    print(f"  ✅ F1: {f1:.3f} | AUC-ROC: {auc:.3f}")
    print(f"  📊 {classification_report(y_test, y_pred, zero_division=0)}")
    
    return model, scaler, {"f1": f1, "auc_roc": auc}


# ─────────────────────────────────────────────────────────────────────────────
# ÉTAPE 4 : SAUVEGARDE ET MÉTADONNÉES
# ─────────────────────────────────────────────────────────────────────────────

def sauvegarder_modeles(
    if_model, if_scaler,
    rf_model, rf_scaler,
    gb_model, gb_scaler,
    feature_names: list,
    meta: dict,
    models_dir: Path
):
    """Sauvegarde tous les modèles + métadonnées JSON."""
    print("\n💾 Sauvegarde des modèles...")
    
    joblib.dump(if_model,  models_dir / "isolation_forest.pkl")
    joblib.dump(if_scaler, models_dir / "scaler_if.pkl")
    joblib.dump(rf_model,  models_dir / "random_forest_gravite.pkl")
    joblib.dump(rf_scaler, models_dir / "scaler_rf.pkl")
    joblib.dump(gb_model,  models_dir / "gradient_boosting_alerte.pkl")
    joblib.dump(gb_scaler, models_dir / "scaler_gb.pkl")
    
    # Sauvegarder les noms de features pour l'inférence
    with open(models_dir / "feature_names.json", "w") as f:
        json.dump(feature_names, f, ensure_ascii=False, indent=2)
    
    # Métadonnées complètes
    meta["trained_at"]     = datetime.now().isoformat()
    meta["feature_count"]  = len(feature_names)
    meta["capteurs_used"]  = CAPTEURS_CIBLES
    meta["fenetre_min"]    = FENETRE_MINUTES
    meta["horizon_min"]    = HORIZON_ALERTE_MIN
    meta["models"] = {
        "isolation_forest":       "isolation_forest.pkl",
        "random_forest_gravite":  "random_forest_gravite.pkl",
        "gradient_boosting":      "gradient_boosting_alerte.pkl",
    }
    
    with open(models_dir / "model_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    
    print(f"  ✅ 3 modèles sauvegardés dans {models_dir}")
    print(f"  ✅ {len(feature_names)} features enregistrées")


# ─────────────────────────────────────────────────────────────────────────────
# PIPELINE PRINCIPAL
# ─────────────────────────────────────────────────────────────────────────────

def main(data_capteurs_dir: str, gmao_path: str):
    print("=" * 65)
    print("  MINEASSIST v2 — Pipeline ML Complet")
    print("  CAT 994F · OCP Benguerir")
    print("  Supervisé + Non-supervisé + Alerte préventive")
    print("=" * 65)
    
    np.random.seed(42)
    
    # ── Étape 1: Chargement ──────────────────────────────────────────────────
    df_capteurs = charger_capteurs(Path(data_capteurs_dir))
    df_gmao     = charger_gmao(Path(gmao_path))
    
    # ── Étape 2: Feature engineering ─────────────────────────────────────────
    pivot    = pivoter_capteurs(df_capteurs, freq="5min")
    features = creer_features_glissantes(pivot, fenetre=FENETRE_MINUTES // 5)
    features = etiqueter_avec_gmao(features, df_gmao, horizon_min=HORIZON_ALERTE_MIN)
    
    # Séparer X et labels
    label_cols = ["label_anomalie", "label_gravite"]
    X = features.drop(columns=label_cols).values
    y_gravite = features["label_gravite"].values
    y_bin     = features["label_anomalie"].values
    feature_names = features.drop(columns=label_cols).columns.tolist()
    
    # ── Étape 3A: Isolation Forest (non-supervisé) ────────────────────────────
    if_model, if_scaler, if_scores = entrainer_isolation_forest(X)
    
    # ── Étape 3B: Classification gravité (supervisé) ──────────────────────────
    meta_rf = {"n_samples": len(X), "n_anomalies": int(y_bin.sum())}
    if y_bin.sum() >= 20:
        rf_model, rf_scaler, rf_metrics = entrainer_classificateur_gravite(X, y_gravite)
        meta_rf["rf_metrics"] = rf_metrics
    else:
        print("  ⚠️  Pas assez d'anomalies labellisées pour la classification supervisée")
        rf_model = rf_scaler = None
        meta_rf["rf_metrics"] = None
    
    # ── Étape 3C: Alerte préventive (supervisé) ───────────────────────────────
    if y_bin.sum() >= 20:
        gb_model, gb_scaler, gb_metrics = entrainer_modele_alerte(X, y_bin)
        meta_rf["gb_metrics"] = gb_metrics
    else:
        gb_model = gb_scaler = None
        meta_rf["gb_metrics"] = None
    
    # ── Étape 4: Sauvegarde ────────────────────────────────────────────────────
    sauvegarder_modeles(
        if_model, if_scaler,
        rf_model or IsolationForest(), rf_scaler or StandardScaler(),
        gb_model or IsolationForest(), gb_scaler or StandardScaler(),
        feature_names, meta_rf, MODELS_DIR
    )
    
    print("\n" + "=" * 65)
    print("  ✅ PIPELINE TERMINÉ AVEC SUCCÈS")
    print("  3 modèles prêts :")
    print("    🌲 Isolation Forest  → /ml/anomaly-score")
    print("    🌳 Random Forest     → /ml/predict-gravite")
    print("    ⚡ Gradient Boosting → /ml/predict-alerte")
    print("=" * 65)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MineAssist ML Pipeline v2")
    parser.add_argument("--data_capteurs", default="./data/capteurs/",
                        help="Dossier contenant les fichiers Excel capteurs")
    parser.add_argument("--gmao", default="./data/gmao_anomalies.xlsx",
                        help="Fichier Excel GMAO anomalies")
    args = parser.parse_args()
    
    main(args.data_capteurs, args.gmao)
