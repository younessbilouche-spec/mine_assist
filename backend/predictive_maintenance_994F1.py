# -*- coding: utf-8 -*-
"""
Pipeline de Maintenance Predictive - Chargeuse CAT 994F1 - OCP Benguerir
"""
import sys, os, warnings
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import seaborn as sns
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import (classification_report, confusion_matrix,
                             precision_recall_curve, roc_auc_score, f1_score)
from sklearn.preprocessing import StandardScaler
import xgboost as xgb

warnings.filterwarnings('ignore')

# ─────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────
BASE_DIR   = os.path.dirname(__file__)
DATA_DIR   = os.path.join(BASE_DIR, 'data')
CAPTEUR_DIR = os.path.join(DATA_DIR, 'capteurs')
GMAO_FILE  = os.path.join(DATA_DIR, 'gmao', 'anomalies',
             '994F1_export_ 31-12-2024 01-01-2026 23-02-2026 - Copie.xlsx')
OUTPUT_DIR = os.path.join(BASE_DIR, 'resultats_ML', 'predictive_994F1')
os.makedirs(OUTPUT_DIR, exist_ok=True)

SIX_PARAMS = {
    'CH994.P1.Température échappement Droit':      'T_Echap_D',
    'CH994.P1.Température échappement gauche':     'T_Echap_G',
    'CH994.P1.Pression huile moteur':              'P_Huile',
    'CH994.P1.Régime moteur':                      'Regime',
    'CH994.P1.Température liquide refroidissement':'T_Refroid',
    'CH994.P1.Température sortie convertisseur':   'T_Convert',
}

# Seuils métier (source seulles.xlsx)
SEUILS = {
    'T_Echap_D':  600.0,
    'T_Echap_G':  600.0,
    'P_Huile':    140.0,   # min à 750 rpm
    'Regime':     1750.0,  # surrégime
    'T_Refroid':  105.0,   # surchauffe
    'T_Convert':  129.0,
}

RESAMPLE_FREQ   = '5min'
PRE_FAULT_WINDOW = '4h'    # fenêtre précurseur avant anomalie GMAO
GRAVITE_MIN      = 2       # gravité 2 et 3 seulement


# ─────────────────────────────────────────────
# ÉTAPE 1 — CHARGEMENT CAPTEURS
# ─────────────────────────────────────────────
def load_capteurs():
    print("\n[1/6] Chargement des capteurs...")
    dfs = []
    for f in sorted(os.listdir(CAPTEUR_DIR)):
        if not f.endswith('.xlsx'):
            continue
        path = os.path.join(CAPTEUR_DIR, f)
        try:
            df = pd.read_excel(path, header=8)
            df.columns = ['Engin','Parametre','Code','Heure',
                          'Val_min','Val_moy','Val_max','Unite','Capteur_OK']
            df = df[df['Parametre'].notna()].copy()
            df['Heure']   = pd.to_datetime(df['Heure'], errors='coerce')
            df['Val_moy'] = pd.to_numeric(df['Val_moy'], errors='coerce')
            df = df[df['Heure'].notna() & df['Val_moy'].notna()]
            df = df[df['Parametre'].str.strip().isin(SIX_PARAMS.keys())]
            df['Parametre'] = df['Parametre'].str.strip().map(SIX_PARAMS)
            dfs.append(df[['Heure', 'Parametre', 'Val_moy']])
            print(f"  OK {f}: {len(df):>7} lignes")
        except Exception as e:
            print(f"  ERR {f}: {e}")

    df_all = pd.concat(dfs, ignore_index=True)
    df_all = df_all.drop_duplicates(subset=['Heure', 'Parametre'])
    df_all = df_all.sort_values('Heure')

    # Pivot : une colonne par capteur
    df_ts = (df_all.pivot(index='Heure', columns='Parametre', values='Val_moy')
                   .rename_axis(None, axis=1))

    # Resample régulier + interpolation linéaire (max 3 pas manquants)
    df_ts = df_ts.resample(RESAMPLE_FREQ).mean()
    df_ts = df_ts.interpolate(method='time', limit=3)
    df_ts = df_ts.dropna()

    print(f"\n  Dataset capteurs : {len(df_ts)} lignes × {len(df_ts.columns)} capteurs")
    print(f"  Periode : {df_ts.index.min().date()} -> {df_ts.index.max().date()}")
    return df_ts


# ─────────────────────────────────────────────
# ÉTAPE 2 — CHARGEMENT GMAO
# ─────────────────────────────────────────────
def load_gmao():
    print("\n[2/6] Chargement GMAO...")
    df = pd.read_excel(GMAO_FILE)
    df.columns = df.columns.str.strip()

    col_date  = "Date de l'anomalie"
    col_code  = "Code d'anomalie"
    col_grav  = 'Gravité'
    col_type  = 'Type'
    col_occ   = 'Occurrences'

    df[col_date] = pd.to_datetime(df[col_date], errors='coerce')
    df[col_grav] = pd.to_numeric(df[col_grav], errors='coerce')
    df = df[df[col_date].notna() & df[col_grav].notna()]

    graves = df[df[col_grav] >= GRAVITE_MIN].copy()

    print(f"  Total anomalies : {len(df)}")
    print(f"  Gravité >= {GRAVITE_MIN} : {len(graves)}")
    print("\n  Top 10 anomalies graves :")
    top = graves[col_code].value_counts().head(10)
    for code, cnt in top.items():
        print(f"    {cnt:>4}x  {code[:70]}")

    return df, graves, col_date, col_code, col_grav, col_type


# ─────────────────────────────────────────────
# ÉTAPE 3 — CORRÉLATION CAPTEURS / GMAO
# ─────────────────────────────────────────────
def analyse_correlation(df_ts, graves, col_date):
    print("\n[3/6] Analyse corrélation capteurs / anomalies...")

    window = pd.Timedelta(PRE_FAULT_WINDOW)
    stats = {col: {'avant': [], 'normal': []} for col in df_ts.columns}

    for _, row in graves.iterrows():
        t = row[col_date]
        mask_avant  = (df_ts.index >= t - window) & (df_ts.index < t)
        mask_normal = (df_ts.index >= t - 2*window) & (df_ts.index < t - window)
        for col in df_ts.columns:
            vals_av = df_ts.loc[mask_avant, col].dropna()
            vals_nm = df_ts.loc[mask_normal, col].dropna()
            if len(vals_av) > 2 and len(vals_nm) > 2:
                stats[col]['avant'].extend(vals_av.tolist())
                stats[col]['normal'].extend(vals_nm.tolist())

    print("\n  Paramètre          | Moy Normale | Moy Avant Panne | Delta%")
    print("  " + "-"*60)
    for col in df_ts.columns:
        av = np.array(stats[col]['avant'])
        nm = np.array(stats[col]['normal'])
        if len(av) > 10 and len(nm) > 10:
            moy_av = av.mean()
            moy_nm = nm.mean()
            delta  = (moy_av - moy_nm) / (abs(moy_nm) + 1e-9) * 100
            print(f"  {col:<20} | {moy_nm:>11.1f} | {moy_av:>15.1f} | {delta:>+7.1f}%")

    # Graphique distributions
    fig, axes = plt.subplots(2, 3, figsize=(16, 9))
    fig.suptitle('Distribution des 6 capteurs : Normal vs Avant Panne\n(Chargeuse 994F1 — OCP Benguerir)',
                 fontsize=13, fontweight='bold')
    for ax, col in zip(axes.flat, df_ts.columns):
        av = stats[col]['avant']
        nm = stats[col]['normal']
        if av and nm:
            ax.hist(nm, bins=40, alpha=0.6, color='steelblue', label='Normal',  density=True)
            ax.hist(av, bins=40, alpha=0.6, color='tomato',    label='Avant panne', density=True)
            if col in SEUILS:
                ax.axvline(SEUILS[col], color='black', linestyle='--', lw=1.5,
                           label=f'Seuil={SEUILS[col]}')
        ax.set_title(col, fontsize=10)
        ax.legend(fontsize=7)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '1_distribution_capteurs.png'), dpi=150)
    plt.close()
    print("\n  Graphique sauvegardé : 1_distribution_capteurs.png")

    return stats


# ─────────────────────────────────────────────
# ÉTAPE 4 — FEATURE ENGINEERING
# ─────────────────────────────────────────────
def feature_engineering(df_ts):
    print("\n[4/6] Feature engineering...")
    fe = df_ts.copy()

    windows = ['30min', '2h', '6h']
    for col in df_ts.columns:
        for w in windows:
            fe[f'{col}_mean_{w}'] = df_ts[col].rolling(w).mean()
            fe[f'{col}_std_{w}']  = df_ts[col].rolling(w).std()
            fe[f'{col}_max_{w}']  = df_ts[col].rolling(w).max()
        # Tendance (dérivée)
        fe[f'{col}_trend'] = df_ts[col].diff(periods=6)
        # Dépassement seuil
        if col in SEUILS:
            fe[f'{col}_over'] = (df_ts[col] > SEUILS[col]).astype(int)

    # Features croisées
    fe['delta_echap']       = fe['T_Echap_D'] - fe['T_Echap_G']          # déséquilibre échappement
    fe['ratio_phuile_rpm']  = fe['P_Huile'] / (fe['Regime'].clip(lower=100))  # corrélation physique
    fe['score_stress']      = (                                            # score de stress global
        (fe['T_Echap_D'] > SEUILS['T_Echap_D']).astype(int) +
        (fe['T_Echap_G'] > SEUILS['T_Echap_G']).astype(int) +
        (fe['P_Huile']   < SEUILS['P_Huile']).astype(int)   +
        (fe['T_Refroid'] > SEUILS['T_Refroid']).astype(int) +
        (fe['T_Convert'] > SEUILS['T_Convert']).astype(int)
    )

    fe = fe.dropna()
    print(f"  Features générées : {len(fe.columns)} colonnes × {len(fe)} lignes")
    return fe


# ─────────────────────────────────────────────
# ÉTAPE 5 — LABELING
# ─────────────────────────────────────────────
def create_labels(fe, graves, col_date):
    print("\n[5/6] Création des labels...")
    window = pd.Timedelta(PRE_FAULT_WINDOW)
    fe['label'] = 0

    n_labeled = 0
    for _, row in graves.iterrows():
        t = row[col_date]
        mask = (fe.index >= t - window) & (fe.index <= t)
        count = mask.sum()
        if count > 0:
            fe.loc[mask, 'label'] = 1
            n_labeled += count

    n_pos = fe['label'].sum()
    n_neg = len(fe) - n_pos
    ratio = n_neg / max(n_pos, 1)
    print(f"  Normal     : {n_neg:>6} lignes")
    print(f"  Pré-panne  : {n_pos:>6} lignes")
    print(f"  Ratio imbalance : 1:{ratio:.0f}")

    # Timeline des labels
    fig, ax = plt.subplots(figsize=(16, 3))
    ax.fill_between(fe.index, fe['label'], alpha=0.7, color='tomato', label='Pré-panne')
    ax.set_title('Timeline des fenêtres pré-défaillance (gravité ≥ 2)', fontsize=11)
    ax.set_xlabel('Date')
    ax.set_ylabel('Label')
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    ax.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '2_timeline_labels.png'), dpi=150)
    plt.close()
    print("  Graphique sauvegardé : 2_timeline_labels.png")

    return fe


# ─────────────────────────────────────────────
# ÉTAPE 6 — MODÈLES
# ─────────────────────────────────────────────
def train_models(fe):
    print("\n[6/6] Entraînement des modèles...")

    feature_cols = [c for c in fe.columns if c != 'label']
    X = fe[feature_cols].values
    y = fe['label'].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # ── 6a. Isolation Forest (non supervisé) ──
    print("\n  [6a] Isolation Forest...")
    iso = IsolationForest(contamination=0.05, n_estimators=200,
                          random_state=42, n_jobs=-1)
    iso_pred = iso.fit_predict(X_scaled)
    iso_labels = (iso_pred == -1).astype(int)
    iso_f1 = f1_score(y, iso_labels, zero_division=0)
    print(f"  F1-score IsolationForest : {iso_f1:.3f}")

    # ── 6b. Random Forest supervisé ──
    print("\n  [6b] Random Forest (TimeSeriesSplit)...")
    tscv = TimeSeriesSplit(n_splits=5)
    rf_scores = []
    rf_best = None

    n_pos = y.sum()
    n_neg = len(y) - n_pos
    weight_ratio = n_neg / max(n_pos, 1)

    for fold, (train_idx, test_idx) in enumerate(tscv.split(X_scaled)):
        X_tr, X_te = X_scaled[train_idx], X_scaled[test_idx]
        y_tr, y_te = y[train_idx],         y[test_idx]
        rf = RandomForestClassifier(n_estimators=200, class_weight={0:1, 1:weight_ratio},
                                    random_state=42, n_jobs=-1)
        rf.fit(X_tr, y_tr)
        y_pred = rf.predict(X_te)
        f1 = f1_score(y_te, y_pred, zero_division=0)
        rf_scores.append(f1)
        print(f"    Fold {fold+1}/5 — F1: {f1:.3f}")
        if rf_best is None or f1 > max(rf_scores[:-1], default=0):
            rf_best = rf

    print(f"  F1 moyen RandomForest : {np.mean(rf_scores):.3f} ± {np.std(rf_scores):.3f}")

    # ── 6c. XGBoost ──
    print("\n  [6c] XGBoost...")
    xgb_scores = []
    for fold, (train_idx, test_idx) in enumerate(tscv.split(X_scaled)):
        X_tr, X_te = X_scaled[train_idx], X_scaled[test_idx]
        y_tr, y_te = y[train_idx],         y[test_idx]
        xgb_m = xgb.XGBClassifier(n_estimators=200, scale_pos_weight=weight_ratio,
                                   eval_metric='logloss', random_state=42,
                                   use_label_encoder=False, verbosity=0)
        xgb_m.fit(X_tr, y_tr)
        y_pred = xgb_m.predict(X_te)
        f1 = f1_score(y_te, y_pred, zero_division=0)
        xgb_scores.append(f1)
    print(f"  F1 moyen XGBoost : {np.mean(xgb_scores):.3f} ± {np.std(xgb_scores):.3f}")

    # ── Rapport final sur dernier fold RF ──
    print("\n  Rapport classification (RF — dernier fold) :")
    splits = list(tscv.split(X_scaled))
    _, test_idx = splits[-1]
    y_te   = y[test_idx]
    y_pred = rf_best.predict(X_scaled[test_idx])
    print(classification_report(y_te, y_pred, target_names=['Normal','Pré-panne'],
                                 zero_division=0))

    # ── Importance des features ──
    importances = pd.Series(rf_best.feature_importances_, index=feature_cols)
    top20 = importances.nlargest(20)

    fig, ax = plt.subplots(figsize=(10, 7))
    top20.sort_values().plot.barh(ax=ax, color='steelblue')
    ax.set_title('Top 20 features — Random Forest\n(Maintenance Prédictive 994F1)', fontsize=12)
    ax.set_xlabel('Importance')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '3_feature_importance.png'), dpi=150)
    plt.close()
    print("\n  Graphique sauvegardé : 3_feature_importance.png")

    # ── Matrice de confusion ──
    cm = confusion_matrix(y_te, y_pred)
    fig, ax = plt.subplots(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                xticklabels=['Normal','Pré-panne'],
                yticklabels=['Normal','Pré-panne'], ax=ax)
    ax.set_title('Matrice de confusion — Random Forest', fontsize=12)
    ax.set_ylabel('Réel')
    ax.set_xlabel('Prédit')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '4_confusion_matrix.png'), dpi=150)
    plt.close()
    print("  Graphique sauvegardé : 4_confusion_matrix.png")

    # ── Score anomalie dans le temps (IsolationForest) ──
    iso_scores = -iso.score_samples(X_scaled)
    fig, axes = plt.subplots(2, 1, figsize=(16, 8), sharex=True)
    axes[0].plot(fe.index, fe['T_Echap_D'], color='steelblue', lw=0.5, label='T_Echap_D (°C)')
    axes[0].axhline(SEUILS['T_Echap_D'], color='red', linestyle='--', lw=1, label='Seuil 600°C')
    axes[0].set_ylabel('Température (°C)')
    axes[0].legend(fontsize=8)
    axes[0].set_title('Température Échappement Droit + Score Anomalie — 994F1', fontsize=12)
    axes[1].fill_between(fe.index, iso_scores, alpha=0.6, color='orange', label='Score anomalie')
    axes[1].fill_between(fe.index, fe['label']*iso_scores.max(), alpha=0.3,
                         color='red', label='Label GMAO (gravité ≥2)')
    axes[1].set_ylabel('Score anomalie')
    axes[1].set_xlabel('Date')
    axes[1].legend(fontsize=8)
    axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '5_score_anomalie_timeline.png'), dpi=150)
    plt.close()
    print("  Graphique sauvegardé : 5_score_anomalie_timeline.png")

    # ── Résumé scores ──
    print("\n" + "="*50)
    print("  RÉSUMÉ DES PERFORMANCES")
    print("="*50)
    print(f"  Isolation Forest F1  : {iso_f1:.3f}")
    print(f"  Random Forest F1 moy : {np.mean(rf_scores):.3f} ± {np.std(rf_scores):.3f}")
    print(f"  XGBoost F1 moy       : {np.mean(xgb_scores):.3f} ± {np.std(xgb_scores):.3f}")
    print(f"\n  Graphiques sauvegardés dans : {OUTPUT_DIR}")

    return rf_best, scaler, feature_cols, importances


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 60)
    print("  MAINTENANCE PRÉDICTIVE — CAT 994F1 — OCP BENGUERIR")
    print("=" * 60)

    df_ts   = load_capteurs()
    df_gmao, graves, col_date, col_code, col_grav, col_type = load_gmao()
    stats   = analyse_correlation(df_ts, graves, col_date)
    fe      = feature_engineering(df_ts)
    fe      = create_labels(fe, graves, col_date)
    rf, scaler, features, importances = train_models(fe)

    print("\n  Pipeline terminé avec succès.")
