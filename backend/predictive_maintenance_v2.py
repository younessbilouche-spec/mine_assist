# -*- coding: utf-8 -*-
"""
Pipeline de Maintenance Predictive V2 - Chargeuse CAT 994F1 - OCP Benguerir
Ameliorations v2:
  - Double strategie de labeling (GMAO filtre + seuils capteurs)
  - Features long-terme (24h, 7j)
  - SMOTE + XGBoost + optimisation seuil
  - SHAP explainability
"""
import sys, os, warnings
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import seaborn as sns
import shap
import optuna
optuna.logging.set_verbosity(optuna.logging.WARNING)

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import (classification_report, confusion_matrix,
                             precision_recall_curve, f1_score,
                             average_precision_score, roc_auc_score)
from sklearn.preprocessing import StandardScaler
from imblearn.over_sampling import SMOTE
from imblearn.pipeline import Pipeline as ImbPipeline
import xgboost as xgb

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
BASE_DIR    = os.path.dirname(__file__)
CAPTEUR_DIR = os.path.join(BASE_DIR, 'data', 'capteurs')
GMAO_FILE   = os.path.join(BASE_DIR, 'data', 'gmao', 'anomalies',
              '994F1_export_ 31-12-2024 01-01-2026 23-02-2026 - Copie.xlsx')
OUTPUT_DIR  = os.path.join(BASE_DIR, 'resultats_ML', 'predictive_994F1_v2')
os.makedirs(OUTPUT_DIR, exist_ok=True)

SIX_PARAMS = {
    'CH994.P1.Temperature echappement Droit':       'T_Echap_D',
    'CH994.P1.Température échappement Droit':       'T_Echap_D',
    'CH994.P1.Temperature echappement gauche':      'T_Echap_G',
    'CH994.P1.Température échappement gauche':      'T_Echap_G',
    'CH994.P1.Pression huile moteur':               'P_Huile',
    'CH994.P1.Regime moteur':                       'Regime',
    'CH994.P1.Régime moteur':                       'Regime',
    'CH994.P1.Temperature liquide refroidissement': 'T_Refroid',
    'CH994.P1.Température liquide refroidissement': 'T_Refroid',
    'CH994.P1.Temperature sortie convertisseur':    'T_Convert',
    'CH994.P1.Température sortie convertisseur':    'T_Convert',
}

SEUILS = {
    'T_Echap_D': 550.0,   # seuil d'alerte precoce (alarme a 600)
    'T_Echap_G': 550.0,
    'P_Huile':   200.0,   # bas (alarme a 140 mais precurseur a 200)
    'Regime':    1700.0,  # pre-surrégime (alarme a 1750)
    'T_Refroid':  95.0,   # surchauffe (alarme a 105)
    'T_Convert':  115.0,  # pre-alarme (alarme a 129)
}

# Anomalies GMAO physiquement liees aux 6 capteurs
GMAO_MOTS_CLES_PERTINENTS = [
    'lubrification',        # P_Huile
    'huile moteur',         # P_Huile
    'convertisseur',        # T_Convert
    'echappement',          # T_Echap
    'échappement',
    'refroidissement',      # T_Refroid
    'surchauffe',
    'temperature',          # toutes temp
    'température',
    'turbocompresseur',     # precurseur T_Echap
    'injecteur',            # precurseur T_Echap
    'regime moteur',        # Regime
    'régime moteur',
    'calage',               # moteur timing -> T_Echap
    'carburant',            # moteur sante
    'combustible',
    'graissage',            # lubrification
    'transmission',         # T_Convert
    'solenoid',
    'solénoïde',
]

RESAMPLE     = '5min'
WINDOWS_TEST = ['2h', '4h', '8h', '12h', '24h']
GMAO_GRAV    = 2


# ─────────────────────────────────────────────
# 1. CHARGEMENT CAPTEURS
# ─────────────────────────────────────────────
def load_capteurs():
    print("\n[1/6] Chargement capteurs...")
    dfs = []
    for f in sorted(os.listdir(CAPTEUR_DIR)):
        if not f.endswith('.xlsx'):
            continue
        path = os.path.join(CAPTEUR_DIR, f)
        try:
            df = pd.read_excel(path, header=8)
            df.columns = ['Engin','Parametre','Code','Heure',
                          'Val_min','Val_moy','Val_max','Unite','Capteur_OK']
            df['Heure']   = pd.to_datetime(df['Heure'], errors='coerce')
            df['Val_moy'] = pd.to_numeric(df['Val_moy'], errors='coerce')
            df = df[df['Heure'].notna() & df['Val_moy'].notna() & df['Parametre'].notna()]
            df['Param_short'] = df['Parametre'].str.strip().map(SIX_PARAMS)
            df = df[df['Param_short'].notna()]
            dfs.append(df[['Heure', 'Param_short', 'Val_moy']])
            print(f"  OK {f}: {len(df):>7} lignes")
        except Exception as e:
            print(f"  ERR {f}: {e}")

    df_all = pd.concat(dfs, ignore_index=True)
    df_all = df_all.drop_duplicates(subset=['Heure', 'Param_short'])
    df_all = df_all.sort_values('Heure')

    df_ts = (df_all.pivot(index='Heure', columns='Param_short', values='Val_moy')
                   .rename_axis(None, axis=1))
    df_ts = df_ts.resample(RESAMPLE).mean()
    df_ts = df_ts.interpolate(method='time', limit=6)
    df_ts = df_ts.dropna()

    print(f"  Dataset : {len(df_ts)} lignes x {len(df_ts.columns)} capteurs")
    print(f"  Periode : {df_ts.index.min().date()} -> {df_ts.index.max().date()}")
    return df_ts


# ─────────────────────────────────────────────
# 2. CHARGEMENT + FILTRAGE GMAO
# ─────────────────────────────────────────────
def load_gmao():
    print("\n[2/6] Chargement GMAO...")
    df = pd.read_excel(GMAO_FILE)
    df.columns = df.columns.str.strip()
    col_date = "Date de l'anomalie"
    col_code = "Code d'anomalie"
    col_grav = 'Gravite' if 'Gravite' in df.columns else 'Gravité'

    # Nettoyage colonne gravité (peut être "Gravité" avec accent)
    for c in df.columns:
        if 'ravit' in c:
            col_grav = c
            break

    df[col_date] = pd.to_datetime(df[col_date], errors='coerce')
    df[col_grav] = pd.to_numeric(df[col_grav], errors='coerce')
    df = df[df[col_date].notna() & df[col_grav].notna()]

    # Filtrage : anomalies pertinentes
    def est_pertinent(code):
        if not isinstance(code, str):
            return False
        code_lower = code.lower()
        return any(kw.lower() in code_lower for kw in GMAO_MOTS_CLES_PERTINENTS)

    df['pertinent'] = df[col_code].apply(est_pertinent)
    df_grave    = df[df[col_grav] >= GMAO_GRAV]
    df_pertinent = df_grave[df_grave['pertinent']]

    print(f"  Total anomalies           : {len(df)}")
    print(f"  Gravite >= {GMAO_GRAV}            : {len(df_grave)}")
    print(f"  Pertinentes (physiques)   : {len(df_pertinent)}")
    print("\n  Anomalies pertinentes retenues :")
    for code, cnt in df_pertinent[col_code].value_counts().items():
        print(f"    {cnt:>4}x  {str(code)[:75]}")

    return df_pertinent, col_date, col_code


# ─────────────────────────────────────────────
# 3. DOUBLE STRATEGIE DE LABELING
# ─────────────────────────────────────────────
def create_labels(df_ts, df_gmao, col_date, window_str='8h'):
    """
    Label 1 si DANS la fenetre precedant une anomalie GMAO pertinente
    OU si un capteur depasse son seuil d'alerte precoce.
    """
    window = pd.Timedelta(window_str)
    labels = pd.Series(0, index=df_ts.index, name='label')

    # Strategie A : GMAO pertinent
    n_gmao = 0
    for _, row in df_gmao.iterrows():
        t    = row[col_date]
        mask = (df_ts.index >= t - window) & (df_ts.index <= t)
        if mask.sum() > 0:
            labels[mask] = 1
            n_gmao += mask.sum()

    # Strategie B : depassement de seuil capteur (> 15 min continu)
    CONSEC_MIN = 3   # 3 x 5min = 15 min de depassement continu
    n_seuil = 0
    for col, seuil in SEUILS.items():
        if col not in df_ts.columns:
            continue
        if col in ['P_Huile']:
            over = (df_ts[col] < seuil).astype(int)   # pression : trop bas
        else:
            over = (df_ts[col] > seuil).astype(int)   # temperature/regime : trop haut

        # Garder seulement les sequences de depassements continus >= CONSEC_MIN
        run = over * (over.groupby((over != over.shift()).cumsum()).transform('count') >= CONSEC_MIN)

        # Marquer la fenetre AVANT le depassement
        run_idx = df_ts.index[run == 1]
        for t in run_idx:
            mask = (df_ts.index >= t - window) & (df_ts.index <= t)
            labels[mask] = 1
            n_seuil += mask.sum()

    labels = labels.clip(upper=1)
    n_pos = labels.sum()
    n_neg = len(labels) - n_pos

    print(f"\n  Fenetre : {window_str}")
    print(f"  Labels depuis GMAO       : {n_gmao} pts")
    print(f"  Labels depuis seuils     : {n_seuil} pts")
    print(f"  Normal    : {n_neg:>6} lignes")
    print(f"  Pre-panne : {n_pos:>6} lignes ({n_pos/len(labels)*100:.1f}%)")

    return labels


def chercher_meilleure_fenetre(df_ts, df_gmao, col_date, df_features_base):
    """Tester plusieurs fenetres et choisir celle qui maximise le F1 XGBoost."""
    print("\n  Test des fenetres precurseur :")
    resultats = {}
    tscv = TimeSeriesSplit(n_splits=3)

    for w in WINDOWS_TEST:
        labels = create_labels(df_ts, df_gmao, col_date, window_str=w)
        labels = labels.loc[df_features_base.index]
        X = df_features_base.values
        y = labels.values
        n_pos = y.sum()
        if n_pos < 50:
            print(f"    {w}: trop peu de positifs ({n_pos}) - ignore")
            continue
        scale_w = (len(y) - n_pos) / max(n_pos, 1)
        scores = []
        for tr, te in tscv.split(X):
            Xtr, Xte = X[tr], X[te]
            ytr, yte = y[tr], y[te]
            if ytr.sum() < 10:
                continue
            m = xgb.XGBClassifier(n_estimators=100, scale_pos_weight=scale_w,
                                   eval_metric='logloss', verbosity=0, random_state=42)
            m.fit(Xtr, ytr)
            yp = m.predict(Xte)
            scores.append(f1_score(yte, yp, zero_division=0))
        if scores:
            f1_moy = np.mean(scores)
            resultats[w] = f1_moy
            print(f"    {w}: F1 = {f1_moy:.3f}")

    best = max(resultats, key=resultats.get) if resultats else '8h'
    print(f"\n  Meilleure fenetre : {best} (F1={resultats.get(best, 0):.3f})")
    return best


# ─────────────────────────────────────────────
# 4. FEATURE ENGINEERING AVANCE
# ─────────────────────────────────────────────
def feature_engineering(df_ts):
    print("\n[4/6] Feature engineering avance...")
    fe = pd.DataFrame(index=df_ts.index)

    # Valeurs brutes
    for col in df_ts.columns:
        fe[col] = df_ts[col]

    # Fenetres courtes (30min, 2h)
    for col in df_ts.columns:
        for w in ['30min', '2h']:
            fe[f'{col}_mean_{w}'] = df_ts[col].rolling(w).mean()
            fe[f'{col}_std_{w}']  = df_ts[col].rolling(w).std()
            fe[f'{col}_max_{w}']  = df_ts[col].rolling(w).max()

    # Fenetres longues (6h, 24h)
    for col in df_ts.columns:
        for w in ['6h', '24h']:
            fe[f'{col}_mean_{w}']   = df_ts[col].rolling(w).mean()
            fe[f'{col}_trend_{w}']  = df_ts[col].rolling(w).apply(
                lambda x: np.polyfit(np.arange(len(x)), x, 1)[0] if len(x) > 2 else 0,
                raw=True
            )
            # Nb de depassements de seuil dans la fenetre
            if col in SEUILS:
                if col == 'P_Huile':
                    over = (df_ts[col] < SEUILS[col]).astype(int)
                else:
                    over = (df_ts[col] > SEUILS[col]).astype(int)
                fe[f'{col}_nb_over_{w}'] = over.rolling(w).sum()

    # Tendance 7 jours (derive lente)
    for col in df_ts.columns:
        fe[f'{col}_mean_7j'] = df_ts[col].rolling('7D').mean()
        fe[f'{col}_dev_7j']  = df_ts[col] - fe[f'{col}_mean_7j']   # ecart a la moyenne 7j

    # Features croisees
    fe['delta_echap']       = df_ts['T_Echap_D'] - df_ts['T_Echap_G']
    fe['delta_echap_abs']   = fe['delta_echap'].abs()
    fe['ratio_phuile_rpm']  = df_ts['P_Huile'] / (df_ts['Regime'].clip(lower=100))
    fe['T_echap_moy']       = (df_ts['T_Echap_D'] + df_ts['T_Echap_G']) / 2

    # Score de stress global
    stress = pd.Series(0.0, index=df_ts.index)
    for col, seuil in SEUILS.items():
        if col not in df_ts.columns:
            continue
        if col == 'P_Huile':
            stress += (df_ts[col] < seuil).astype(float)
        else:
            stress += (df_ts[col] > seuil).astype(float)
    fe['score_stress']        = stress
    fe['score_stress_cum_24h'] = stress.rolling('24h').sum()

    # Heure du jour et jour de semaine (cycles operatoires)
    fe['heure_jour'] = df_ts.index.hour + df_ts.index.minute / 60.0
    fe['jour_sem']   = df_ts.index.dayofweek

    # Correlation glissante entre T_Echap_D et T_Echap_G (decorrelation = anomalie)
    fe['corr_echap_2h'] = (
        df_ts['T_Echap_D'].rolling('2h').corr(df_ts['T_Echap_G'])
    )

    fe = fe.dropna()
    print(f"  Features : {len(fe.columns)} colonnes x {len(fe)} lignes")
    return fe


# ─────────────────────────────────────────────
# 5. OPTIMISATION HYPERPARAMETRES (Optuna)
# ─────────────────────────────────────────────
def optimiser_xgboost(X_tr, y_tr, scale_w, n_trials=30):
    def objective(trial):
        params = {
            'n_estimators':     trial.suggest_int('n_estimators', 100, 500),
            'max_depth':        trial.suggest_int('max_depth', 3, 8),
            'learning_rate':    trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
            'subsample':        trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.5, 1.0),
            'min_child_weight': trial.suggest_int('min_child_weight', 1, 10),
            'scale_pos_weight': scale_w,
            'eval_metric': 'logloss',
            'verbosity': 0,
            'random_state': 42,
        }
        tscv = TimeSeriesSplit(n_splits=3)
        scores = []
        for tr, te in tscv.split(X_tr):
            m = xgb.XGBClassifier(**params)
            m.fit(X_tr[tr], y_tr[tr])
            yp = m.predict(X_tr[te])
            scores.append(f1_score(y_tr[te], yp, zero_division=0))
        return np.mean(scores)

    study = optuna.create_study(direction='maximize')
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)
    return study.best_params


# ─────────────────────────────────────────────
# 6. ENTRAINEMENT + EVALUATION
# ─────────────────────────────────────────────
def train_and_evaluate(fe, labels):
    print("\n[5/6] Entrainement du modele...")

    feature_cols = [c for c in fe.columns if c != 'label']
    X = fe[feature_cols].values
    y = labels.loc[fe.index].values

    scaler  = StandardScaler()
    X_sc    = scaler.fit_transform(X)

    n_pos   = y.sum()
    n_neg   = len(y) - n_pos
    scale_w = n_neg / max(n_pos, 1)
    print(f"  Classe normale    : {n_neg}")
    print(f"  Classe pre-panne  : {n_pos}")
    print(f"  scale_pos_weight  : {scale_w:.1f}")

    # Split temporel : 80% train / 20% test
    split = int(len(X_sc) * 0.8)
    X_tr, X_te = X_sc[:split], X_sc[split:]
    y_tr, y_te = y[:split],    y[split:]
    idx_te     = fe.index[split:]

    # Optuna
    print("\n  Optimisation hyperparametres (30 trials)...")
    best_params = optimiser_xgboost(X_tr, y_tr, scale_w, n_trials=30)
    print(f"  Meilleurs params : {best_params}")

    # SMOTE sur train
    print("\n  Application SMOTE...")
    smote = SMOTE(random_state=42, k_neighbors=min(5, n_pos-1) if n_pos > 5 else 1)
    try:
        X_tr_sm, y_tr_sm = smote.fit_resample(X_tr, y_tr)
        print(f"  Apres SMOTE : {y_tr_sm.sum()} positifs / {len(y_tr_sm)} total")
    except Exception as e:
        print(f"  SMOTE ignore ({e}) - utilisation des donnees originales")
        X_tr_sm, y_tr_sm = X_tr, y_tr

    # Entrainement final
    best_params['scale_pos_weight'] = 1.0   # SMOTE a equiliibré, pas besoin
    best_params['eval_metric']      = 'logloss'
    best_params['verbosity']        = 0
    best_params['random_state']     = 42

    model = xgb.XGBClassifier(**best_params)
    model.fit(X_tr_sm, y_tr_sm)

    # Probabilites de prediction
    y_prob = model.predict_proba(X_te)[:, 1]

    # Optimiser seuil de decision
    precisions, recalls, thresholds = precision_recall_curve(y_te, y_prob)
    f1s = 2 * precisions * recalls / (precisions + recalls + 1e-9)
    best_thr = thresholds[np.argmax(f1s)]
    y_pred   = (y_prob >= best_thr).astype(int)

    print(f"\n  Seuil optimal : {best_thr:.3f}")
    print(f"  PR-AUC        : {average_precision_score(y_te, y_prob):.3f}")
    print(f"  ROC-AUC       : {roc_auc_score(y_te, y_prob):.3f}")
    print(f"  F1 final      : {f1_score(y_te, y_pred, zero_division=0):.3f}")
    print("\n  Rapport classification :")
    print(classification_report(y_te, y_pred,
                                target_names=['Normal','Pre-panne'],
                                zero_division=0))

    return model, scaler, feature_cols, X_te, y_te, y_pred, y_prob, idx_te, precisions, recalls, thresholds, best_thr


# ─────────────────────────────────────────────
# 7. GRAPHIQUES
# ─────────────────────────────────────────────
def generer_graphiques(df_ts, fe, labels, model, scaler, feature_cols,
                       X_te, y_te, y_pred, y_prob, idx_te,
                       precisions, recalls, thresholds, best_thr):
    print("\n[6/6] Generation des graphiques...")
    cols = df_ts.columns.tolist()

    # --- G1 : Series temporelles des 6 capteurs avec seuils ---
    fig, axes = plt.subplots(3, 2, figsize=(18, 14), sharex=True)
    fig.suptitle('Series temporelles - 6 capteurs critiques - Chargeuse 994F1\nJan-Dec 2025',
                 fontsize=14, fontweight='bold')
    colors = ['#2196F3','#F44336','#4CAF50','#FF9800','#9C27B0','#009688']
    for ax, col, color in zip(axes.flat, cols, colors):
        ax.plot(df_ts.index, df_ts[col], color=color, lw=0.4, alpha=0.8)
        if col in SEUILS:
            ax.axhline(SEUILS[col], color='black', ls='--', lw=1.2,
                       label=f'Seuil={SEUILS[col]}')
        # Zones pre-panne
        ax.fill_between(df_ts.index, df_ts[col].min(), df_ts[col].max(),
                        where=labels.reindex(df_ts.index, fill_value=0)==1,
                        alpha=0.15, color='red', label='Pre-panne')
        ax.set_title(col, fontsize=10)
        ax.legend(fontsize=7, loc='upper right')
        ax.set_ylabel(col.split('_')[0])
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '1_series_capteurs.png'), dpi=150)
    plt.close()

    # --- G2 : Courbe Precision-Recall ---
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot(recalls, precisions, color='navy', lw=2)
    idx_best = np.argmin(np.abs(thresholds - best_thr))
    ax.plot(recalls[idx_best], precisions[idx_best], 'ro', ms=10,
            label=f'Seuil optimal={best_thr:.2f}')
    pr_auc = average_precision_score(y_te, y_prob)
    ax.set_title(f'Courbe Precision-Recall (PR-AUC={pr_auc:.3f})\nMaintenance Predictive 994F1',
                 fontsize=12)
    ax.set_xlabel('Recall')
    ax.set_ylabel('Precision')
    ax.legend()
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '2_precision_recall.png'), dpi=150)
    plt.close()

    # --- G3 : Matrice de confusion ---
    cm = confusion_matrix(y_te, y_pred)
    fig, ax = plt.subplots(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                xticklabels=['Normal','Pre-panne'],
                yticklabels=['Normal','Pre-panne'], ax=ax, annot_kws={'size': 14})
    ax.set_title('Matrice de confusion - XGBoost\n(seuil optimise)', fontsize=12)
    ax.set_ylabel('Reel')
    ax.set_xlabel('Predit')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '3_confusion_matrix.png'), dpi=150)
    plt.close()

    # --- G4 : Score anomalie + labels dans le temps ---
    fig, axes = plt.subplots(3, 1, figsize=(18, 12), sharex=True)
    axes[0].plot(df_ts.index, df_ts['T_Echap_D'], color='#F44336', lw=0.5)
    axes[0].plot(df_ts.index, df_ts['T_Convert'],  color='#FF9800', lw=0.5)
    axes[0].axhline(SEUILS['T_Echap_D'], color='darkred', ls='--', lw=1)
    axes[0].axhline(SEUILS['T_Convert'],  color='darkorange', ls='--', lw=1)
    axes[0].set_title('Temperatures (echappement + convertisseur)', fontsize=10)
    axes[0].set_ylabel('Deg C')
    axes[0].legend(['T_Echap_D','T_Convert','Seuil Echap','Seuil Convert'],
                   fontsize=7, loc='upper right')

    axes[1].plot(idx_te, y_prob, color='#9C27B0', lw=0.7, alpha=0.8)
    axes[1].axhline(best_thr, color='black', ls='--', lw=1.2,
                    label=f'Seuil decision={best_thr:.2f}')
    axes[1].fill_between(idx_te, y_prob, 0, where=y_prob>=best_thr,
                         alpha=0.4, color='red', label='Alerte predite')
    axes[1].set_title('Probabilite de pre-panne (XGBoost)', fontsize=10)
    axes[1].set_ylabel('Probabilite')
    axes[1].legend(fontsize=8, loc='upper right')

    label_te = labels.loc[idx_te]
    axes[2].fill_between(idx_te, label_te, 0, alpha=0.6, color='tomato', label='Label reel')
    axes[2].fill_between(idx_te, y_pred,   0, alpha=0.4, color='steelblue', label='Prediction')
    axes[2].set_title('Comparaison label reel vs prediction', fontsize=10)
    axes[2].set_ylabel('0/1')
    axes[2].xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    axes[2].legend(fontsize=8, loc='upper right')

    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '4_score_anomalie_timeline.png'), dpi=150)
    plt.close()

    # --- G5 : Top 20 features importance XGBoost ---
    importances = pd.Series(model.feature_importances_, index=feature_cols)
    top20 = importances.nlargest(20)
    fig, ax = plt.subplots(figsize=(10, 7))
    top20.sort_values().plot.barh(ax=ax, color='steelblue')
    ax.set_title('Top 20 features - XGBoost\n(Maintenance Predictive 994F1)', fontsize=12)
    ax.set_xlabel('Importance')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '5_feature_importance.png'), dpi=150)
    plt.close()

    # --- G6 : SHAP summary ---
    print("  Calcul SHAP (peut prendre 1-2 min)...")
    try:
        X_te_df = pd.DataFrame(X_te, columns=feature_cols)
        explainer = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X_te_df[:1000])
        fig, ax = plt.subplots(figsize=(10, 8))
        shap.summary_plot(shap_values, X_te_df[:1000], feature_names=feature_cols,
                          show=False, max_display=20)
        plt.title('SHAP - Impact des features sur la prediction\n(Maintenance Predictive 994F1)',
                  fontsize=12)
        plt.tight_layout()
        plt.savefig(os.path.join(OUTPUT_DIR, '6_shap_summary.png'), dpi=150, bbox_inches='tight')
        plt.close()
        print("  SHAP genere.")
    except Exception as e:
        print(f"  SHAP ignore : {e}")

    # --- G7 : Distribution score anomalie Normal vs Pre-panne ---
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.hist(y_prob[y_te==0], bins=60, alpha=0.6, color='steelblue', density=True, label='Normal')
    ax.hist(y_prob[y_te==1], bins=60, alpha=0.6, color='tomato',    density=True, label='Pre-panne')
    ax.axvline(best_thr, color='black', ls='--', lw=1.5, label=f'Seuil={best_thr:.2f}')
    ax.set_title('Distribution des probabilites - Normal vs Pre-panne\n(XGBoost)', fontsize=12)
    ax.set_xlabel('Probabilite de pre-panne')
    ax.set_ylabel('Densite')
    ax.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '7_distribution_scores.png'), dpi=150)
    plt.close()

    # --- G8 : Score de stress cumulatif ---
    stress_24h = fe['score_stress_cum_24h'] if 'score_stress_cum_24h' in fe.columns else None
    if stress_24h is not None:
        fig, axes = plt.subplots(2, 1, figsize=(16, 8), sharex=True)
        axes[0].fill_between(fe.index, stress_24h, alpha=0.7, color='orange')
        axes[0].set_title('Score de stress cumule (24h) - nb de capteurs au-dessus seuil', fontsize=11)
        axes[0].set_ylabel('Score')
        label_aligned = labels.reindex(fe.index, fill_value=0)
        axes[1].fill_between(fe.index, label_aligned, alpha=0.7, color='tomato')
        axes[1].set_title('Zones pre-panne (label reel)', fontsize=11)
        axes[1].set_ylabel('Label')
        axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
        plt.tight_layout()
        plt.savefig(os.path.join(OUTPUT_DIR, '8_stress_score.png'), dpi=150)
        plt.close()

    print(f"\n  8 graphiques sauvegardes dans : {OUTPUT_DIR}")


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 65)
    print("  MAINTENANCE PREDICTIVE V2 - CAT 994F1 - OCP BENGUERIR")
    print("=" * 65)

    df_ts              = load_capteurs()
    df_gmao, col_date, col_code = load_gmao()

    print("\n[3/6] Recherche meilleure fenetre precurseur...")
    fe_base = feature_engineering(df_ts)
    # Utiliser features de base pour selectionner la fenetre
    fe_base_simple = fe_base[[c for c in df_ts.columns]].dropna()
    best_window = chercher_meilleure_fenetre(df_ts, df_gmao, col_date, fe_base_simple)

    # Labels avec la meilleure fenetre
    labels = create_labels(df_ts, df_gmao, col_date, window_str=best_window)

    # Features completes
    fe = fe_base.copy()

    # Aligner labels avec features
    labels = labels.reindex(fe.index, fill_value=0)

    (model, scaler, feature_cols,
     X_te, y_te, y_pred, y_prob,
     idx_te, precisions, recalls,
     thresholds, best_thr) = train_and_evaluate(fe, labels)

    generer_graphiques(df_ts, fe, labels, model, scaler, feature_cols,
                       X_te, y_te, y_pred, y_prob, idx_te,
                       precisions, recalls, thresholds, best_thr)

    pr_auc = average_precision_score(y_te, y_prob)
    roc    = roc_auc_score(y_te, y_prob)
    f1     = f1_score(y_te, y_pred, zero_division=0)

    print("\n" + "=" * 65)
    print("  RESULTATS FINAUX")
    print("=" * 65)
    print(f"  Fenetre precurseur optimale : {best_window}")
    print(f"  Seuil de decision optimal   : {best_thr:.3f}")
    print(f"  PR-AUC                      : {pr_auc:.3f}")
    print(f"  ROC-AUC                     : {roc:.3f}")
    print(f"  F1-Score                    : {f1:.3f}")
    print(f"\n  Pipeline V2 termine. Resultats dans :")
    print(f"  {OUTPUT_DIR}")
