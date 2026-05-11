"""
MineAssist — Entraînement Isolation Forest
Détection d'anomalies sur les capteurs CAT 994F
Usage: python train_anomaly.py
"""

import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import joblib
import json

# ─── Chemins ────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "gmao" / "capteurs"
MODELS_DIR = BASE_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)

# ─── Paramètres ciblés (liés à l'échauffement moteur) ───────────────────────
PARAMETRES_CIBLES = [
    "CH994.P1.Température liquide refroidissement",
    "CH994.P1.Température échappement Droit",
    "CH994.P1.Température échappement gauche",
    "CH994.P1.Température sortie convertisseur",
    "CH994.P1.Pression huile moteur",
    "CH994.P1.Régime moteur",
]


def charger_donnees():
    """Charge et prépare les données capteurs."""
    print("📂 Chargement des fichiers capteurs...")

    all_files = (
        list(DATA_DIR.glob("*.xlsx")) +
        list(DATA_DIR.glob("*.xls")) +
        list(DATA_DIR.glob("*.csv"))
    )

    if not all_files:
        raise FileNotFoundError(f"Aucun fichier trouvé dans {DATA_DIR}")

    frames = []
    for f in all_files:
        try:
            df = pd.read_excel(f, header=8)
            df.columns = ['Engin', 'Parametre', 'Code', 'Heure',
                          'Val_min', 'Val_moy', 'Val_max', 'Unite', 'Capteur_OK']
            df = df.dropna(subset=['Parametre', 'Heure'])
            df['Parametre'] = df['Parametre'].str.strip()
            df['Val_moy'] = pd.to_numeric(df['Val_moy'], errors='coerce')
            df['Val_max'] = pd.to_numeric(df['Val_max'], errors='coerce')
            df['Val_min'] = pd.to_numeric(df['Val_min'], errors='coerce')
            frames.append(df)
            print(f"  ✅ {f.name} ({len(df)} lignes)")
        except Exception as e:
            print(f"  ⚠️ Erreur {f.name}: {e}")

    df = pd.concat(frames, ignore_index=True)
    print(f"\n📊 Total : {len(df)} mesures chargées")
    return df


def preparer_features(df):
    """
    Pivot : chaque ligne = un horodatage, chaque colonne = un paramètre.
    On garde seulement les 6 paramètres ciblés.
    """
    print("\n🔧 Préparation des features...")

    # Filtrer les paramètres cibles
    df_filtre = df[df['Parametre'].isin(PARAMETRES_CIBLES)].copy()
    df_filtre['Heure'] = pd.to_datetime(df_filtre['Heure'])

    # Arrondir à 2 minutes pour aligner les capteurs
    df_filtre['Heure_round'] = df_filtre['Heure'].dt.round('2min')

    # Pivot : une colonne par paramètre
    pivot = df_filtre.pivot_table(
        index='Heure_round',
        columns='Parametre',
        values='Val_moy',
        aggfunc='mean'
    )

    # Garder seulement les colonnes disponibles
    cols_dispo = [c for c in PARAMETRES_CIBLES if c in pivot.columns]
    pivot = pivot[cols_dispo].copy()

    # Supprimer les valeurs négatives (défauts capteur)
    pivot = pivot[(pivot >= 0).all(axis=1)]

    # Supprimer les lignes avec trop de NaN
    pivot = pivot.dropna(thresh=len(cols_dispo) // 2)

    # Interpoler les NaN restants
    pivot = pivot.interpolate(method='time').dropna()

    print(f"  → {len(pivot)} points temporels")
    print(f"  → {len(cols_dispo)} paramètres : {cols_dispo}")

    return pivot, cols_dispo


def calculer_stats(pivot):
    """Calcule les statistiques 2σ pour chaque paramètre."""
    stats = {}
    for col in pivot.columns:
        mu = float(pivot[col].mean())
        sigma = float(pivot[col].std())
        stats[col] = {
            "mu":        round(mu, 3),
            "sigma":     round(sigma, 3),
            "seuil_max": round(mu + 2 * sigma, 3),
            "seuil_min": round(mu - 2 * sigma, 3),
            "min_obs":   round(float(pivot[col].min()), 3),
            "max_obs":   round(float(pivot[col].max()), 3),
        }
    return stats


def entrainer_isolation_forest(X):
    """Entraîne le modèle Isolation Forest."""
    print("\n🤖 Entraînement Isolation Forest...")

    # Normalisation
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Isolation Forest
    # contamination = proportion d'anomalies attendues (~5%)
    model = IsolationForest(
        n_estimators=200,
        contamination=0.05,
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_scaled)

    # Score sur les données d'entraînement
    scores = model.decision_function(X_scaled)
    predictions = model.predict(X_scaled)
    nb_anomalies = int((predictions == -1).sum())
    pct_anomalies = round(nb_anomalies / len(predictions) * 100, 2)

    print(f"  ✅ Modèle entraîné sur {len(X)} points")
    print(f"  📊 Anomalies détectées : {nb_anomalies} ({pct_anomalies}%)")

    return model, scaler, scores, predictions


def sauvegarder(model, scaler, stats, cols, pivot, scores, predictions):
    """Sauvegarde le modèle et les métadonnées."""
    print("\n💾 Sauvegarde...")

    # Modèle et scaler
    joblib.dump(model,  MODELS_DIR / "isolation_forest.pkl")
    joblib.dump(scaler, MODELS_DIR / "scaler.pkl")

    # Métadonnées JSON
    meta = {
        "parametres":     cols,
        "n_estimators":   200,
        "contamination":  0.05,
        "n_train":        len(pivot),
        "nb_anomalies":   int((predictions == -1).sum()),
        "pct_anomalies":  round(float((predictions == -1).mean() * 100), 2),
        "stats_2sigma":   stats,
    }
    with open(MODELS_DIR / "model_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # Données d'entraînement avec scores (pour visualisation)
    pivot_out = pivot.copy()
    pivot_out["anomaly_score"] = scores
    pivot_out["is_anomaly"] = (predictions == -1).astype(int)
    pivot_out.reset_index().to_csv(
        MODELS_DIR / "train_results.csv", index=False
    )

    print(f"  ✅ Modèle sauvegardé dans {MODELS_DIR}")
    print(f"  ✅ Métadonnées : model_meta.json")
    print(f"  ✅ Résultats   : train_results.csv")


def main():
    print("=" * 60)
    print("  MINEASSIST — Détection d'anomalies Isolation Forest")
    print("  CAT 994F · OCP Benguerir")
    print("=" * 60)

    df = charger_donnees()
    pivot, cols = preparer_features(df)
    stats = calculer_stats(pivot)

    X = pivot.values
    model, scaler, scores, predictions = entrainer_isolation_forest(X)

    sauvegarder(model, scaler, stats, cols, pivot, scores, predictions)

    print("\n" + "=" * 60)
    print("  ✅ Entraînement terminé avec succès !")
    print("  → Lance maintenant le backend FastAPI")
    print("  → Appelle POST /gmao/train-anomaly ou GET /gmao/anomaly-results")
    print("=" * 60)


if __name__ == "__main__":
    main()
