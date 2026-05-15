# -*- coding: utf-8 -*-
"""
Pipeline de Maintenance Predictive V3 - Chargeuse CAT 994F1 - OCP Benguerir

Correction V3 - Labeling forward-looking :
  label[t] = 1 si un capteur va depasser son seuil dans les H prochaines heures
  => formulation correcte : on predit le futur a partir du present
  => pas de fuite de donnees, evaluation honnete
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

from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import (classification_report, confusion_matrix,
                             precision_recall_curve, f1_score,
                             average_precision_score, roc_auc_score)
from sklearn.preprocessing import StandardScaler
from imblearn.over_sampling import SMOTE
import xgboost as xgb

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
BASE_DIR    = os.path.dirname(__file__)
CAPTEUR_DIR = os.path.join(BASE_DIR, 'data', 'capteurs')
GMAO_FILE   = os.path.join(BASE_DIR, 'data', 'gmao', 'anomalies',
              '994F1_export_ 31-12-2024 01-01-2026 23-02-2026 - Copie.xlsx')
OUTPUT_DIR  = os.path.join(BASE_DIR, 'resultats_ML', 'predictive_994F1_v3')
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

# Seuils alarme reels (source : seulles.xlsx OCP)
SEUILS_ALARME = {
    'T_Echap_D': 600.0,
    'T_Echap_G': 600.0,
    'P_Huile':   140.0,
    'Regime':    1750.0,
    'T_Refroid': 105.0,
    'T_Convert': 129.0,
}

# Seuils pre-alarme (80% du seuil alarme - zone d'alerte precoce)
SEUILS_PREALERTE = {
    'T_Echap_D': 520.0,
    'T_Echap_G': 520.0,
    'P_Huile':   180.0,   # pression : inferieur a ce seuil = warning
    'Regime':    1650.0,
    'T_Refroid':  98.0,
    'T_Convert':  118.0,
}

RESAMPLE       = '5min'
HORIZON_PRED   = '2h'     # on predit les 2 prochaines heures
STEPS_HORIZON  = int(pd.Timedelta(HORIZON_PRED) / pd.Timedelta(RESAMPLE))  # = 24 pas

GMAO_MOTS_CLES = [
    'lubrification', 'huile moteur', 'convertisseur', 'echappement',
    'échappement', 'refroidissement', 'surchauffe', 'temperature',
    'température', 'turbocompresseur', 'injecteur', 'regime moteur',
    'régime moteur', 'calage', 'carburant', 'combustible',
    'graissage', 'transmission', 'solenoid', 'solénoïde',
]


# ─────────────────────────────────────────────
# 1. CHARGEMENT CAPTEURS
# ─────────────────────────────────────────────
def load_capteurs():
    print("\n[1/5] Chargement capteurs...")
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
    df_ts  = (df_all.pivot(index='Heure', columns='Param_short', values='Val_moy')
                    .rename_axis(None, axis=1))
    df_ts  = df_ts.resample(RESAMPLE).mean()
    df_ts  = df_ts.interpolate(method='time', limit=6)
    df_ts  = df_ts.dropna()

    print(f"  Dataset : {len(df_ts)} lignes x {len(df_ts.columns)} capteurs")
    print(f"  Periode : {df_ts.index.min().date()} -> {df_ts.index.max().date()}")
    return df_ts


# ─────────────────────────────────────────────
# 2. LABELING FORWARD-LOOKING (correct)
# ─────────────────────────────────────────────
def create_labels_forward(df_ts):
    """
    label[t] = 1 si dans les HORIZON_PRED prochaines heures
               au moins un capteur va depasser son seuil ALARME (reel)
               pendant au moins 15 min consecutives (3 x 5min).
    Formulation correcte : on predit un evenement FUTUR serieux.
    """
    print(f"\n[2/5] Labeling forward-looking (horizon={HORIZON_PRED})...")

    CONSEC = 3   # 3 x 5min = 15 min minimum de depassement continu

    en_alerte = pd.Series(False, index=df_ts.index)
    for col, seuil in SEUILS_ALARME.items():
        if col not in df_ts.columns:
            continue
        if col == 'P_Huile':
            over = (df_ts[col] < seuil).astype(int)
        else:
            over = (df_ts[col] > seuil).astype(int)
        # Garder uniquement les sequences continues >= CONSEC pas
        group     = (over != over.shift()).cumsum()
        run_len   = over.groupby(group).transform('count')
        over_cons = (over == 1) & (run_len >= CONSEC)
        en_alerte |= over_cons
        print(f"  {col}: {over_cons.sum()} pts en alarme soutenue ({over_cons.mean()*100:.1f}%)")

    print(f"  Total pts en alarme (union 6 capteurs) : {en_alerte.sum()} ({en_alerte.mean()*100:.1f}%)")

    # Label forward : a l'instant t, est-ce qu'une alerte arrive dans [t+1, t+HORIZON] ?
    alerte_arr  = en_alerte.values.astype(int)
    labels_fwd  = np.zeros(len(alerte_arr), dtype=int)
    for i in range(len(alerte_arr) - STEPS_HORIZON):
        if alerte_arr[i+1 : i+STEPS_HORIZON+1].any():
            labels_fwd[i] = 1

    labels = pd.Series(labels_fwd, index=df_ts.index, name='label')
    n_pos  = labels.sum()
    n_neg  = len(labels) - n_pos
    print(f"\n  Normal    : {n_neg:>6} ({n_neg/len(labels)*100:.1f}%)")
    print(f"  Pre-alerte: {n_pos:>6} ({n_pos/len(labels)*100:.1f}%)")
    print(f"  Ratio imbalance 1:{n_neg/max(n_pos,1):.1f}")
    return labels, en_alerte


# ─────────────────────────────────────────────
# 3. FEATURE ENGINEERING
# ─────────────────────────────────────────────
def feature_engineering(df_ts):
    print("\n[3/5] Feature engineering...")
    fe = pd.DataFrame(index=df_ts.index)

    for col in df_ts.columns:
        fe[col] = df_ts[col]

    # Fenetres courtes : etat actuel et recent
    for col in df_ts.columns:
        for w in ['15min', '30min', '1h', '2h']:
            fe[f'{col}_mean_{w}'] = df_ts[col].rolling(w).mean()
            fe[f'{col}_std_{w}']  = df_ts[col].rolling(w).std()
            fe[f'{col}_max_{w}']  = df_ts[col].rolling(w).max()
            fe[f'{col}_min_{w}']  = df_ts[col].rolling(w).min()

    # Tendances (vitesse de changement)
    for col in df_ts.columns:
        fe[f'{col}_diff_15m']  = df_ts[col].diff(3)     # 3 x 5min = 15 min
        fe[f'{col}_diff_1h']   = df_ts[col].diff(12)    # 12 x 5min = 1h
        fe[f'{col}_diff_2h']   = df_ts[col].diff(24)    # 24 x 5min = 2h

    # Fenetres longues : tendance de fond
    for col in df_ts.columns:
        fe[f'{col}_mean_6h']  = df_ts[col].rolling('6h').mean()
        fe[f'{col}_mean_24h'] = df_ts[col].rolling('24h').mean()
        fe[f'{col}_dev_24h']  = df_ts[col] - fe[f'{col}_mean_24h']  # ecart a moyenne journaliere

    # Distance au seuil (normalise)
    for col, seuil in SEUILS_ALARME.items():
        if col not in df_ts.columns:
            continue
        if col == 'P_Huile':
            fe[f'{col}_dist_seuil'] = (df_ts[col] - seuil) / (seuil + 1e-9)
        else:
            fe[f'{col}_dist_seuil'] = (df_ts[col] - seuil) / (seuil + 1e-9)

    # Features croisees
    fe['delta_echap']         = df_ts['T_Echap_D'] - df_ts['T_Echap_G']
    fe['delta_echap_abs']     = fe['delta_echap'].abs()
    fe['T_echap_moy']         = (df_ts['T_Echap_D'] + df_ts['T_Echap_G']) / 2.0
    fe['ratio_phuile_regime'] = df_ts['P_Huile'] / df_ts['Regime'].clip(lower=100)
    fe['corr_echap_1h']       = df_ts['T_Echap_D'].rolling('1h').corr(df_ts['T_Echap_G'])

    # Score stress global
    stress = pd.Series(0.0, index=df_ts.index)
    for col, seuil in SEUILS_PREALERTE.items():
        if col not in df_ts.columns:
            continue
        stress += (df_ts[col] < seuil).astype(float) if col == 'P_Huile' \
                  else (df_ts[col] > seuil).astype(float)
    fe['score_stress']       = stress
    fe['stress_cum_2h']      = stress.rolling('2h').sum()
    fe['stress_cum_6h']      = stress.rolling('6h').sum()

    # Cyclicite temporelle
    fe['heure_sin'] = np.sin(2 * np.pi * df_ts.index.hour / 24)
    fe['heure_cos'] = np.cos(2 * np.pi * df_ts.index.hour / 24)
    fe['jour_sin']  = np.sin(2 * np.pi * df_ts.index.dayofweek / 7)
    fe['jour_cos']  = np.cos(2 * np.pi * df_ts.index.dayofweek / 7)

    fe = fe.dropna()
    print(f"  Features : {len(fe.columns)} colonnes x {len(fe)} lignes")
    return fe


# ─────────────────────────────────────────────
# 4. ENTRAINEMENT + EVALUATION
# ─────────────────────────────────────────────
def train_and_evaluate(fe, labels):
    print("\n[4/5] Entrainement XGBoost optimise...")

    feature_cols = list(fe.columns)
    X = fe.values
    y = labels.reindex(fe.index, fill_value=0).values

    scaler = StandardScaler()
    X_sc   = scaler.fit_transform(X)

    # Split temporel strict 70/15/15
    n       = len(X_sc)
    n_train = int(n * 0.70)
    n_val   = int(n * 0.15)
    X_tr, y_tr = X_sc[:n_train],          y[:n_train]
    X_val,y_val= X_sc[n_train:n_train+n_val], y[n_train:n_train+n_val]
    X_te, y_te = X_sc[n_train+n_val:],    y[n_train+n_val:]
    idx_te     = fe.index[n_train+n_val:]

    n_pos  = y_tr.sum()
    n_neg  = len(y_tr) - n_pos
    sw     = n_neg / max(n_pos, 1)
    print(f"  Train {len(y_tr)} | Val {len(y_val)} | Test {len(y_te)}")
    print(f"  scale_pos_weight train : {sw:.2f}")

    # SMOTE sur train
    try:
        k = min(5, int(n_pos) - 1)
        if k >= 1:
            sm = SMOTE(random_state=42, k_neighbors=k)
            X_tr_sm, y_tr_sm = sm.fit_resample(X_tr, y_tr)
            print(f"  SMOTE : {y_tr_sm.sum()} pos / {len(y_tr_sm)} total")
        else:
            X_tr_sm, y_tr_sm = X_tr, y_tr
    except Exception as e:
        X_tr_sm, y_tr_sm = X_tr, y_tr
        print(f"  SMOTE ignore : {e}")

    # Optuna avec validation set
    print("  Optuna (40 trials)...")
    def objective(trial):
        params = dict(
            n_estimators     = trial.suggest_int('n_estimators', 100, 600),
            max_depth        = trial.suggest_int('max_depth', 3, 9),
            learning_rate    = trial.suggest_float('lr', 0.005, 0.3, log=True),
            subsample        = trial.suggest_float('sub', 0.5, 1.0),
            colsample_bytree = trial.suggest_float('col', 0.4, 1.0),
            min_child_weight = trial.suggest_int('mcw', 1, 15),
            gamma            = trial.suggest_float('gamma', 0, 5),
            reg_alpha        = trial.suggest_float('alpha', 1e-4, 10, log=True),
            reg_lambda       = trial.suggest_float('lambda', 1e-4, 10, log=True),
            scale_pos_weight = 1.0,  # SMOTE a equilibre
            eval_metric      = 'logloss',
            verbosity        = 0,
            random_state     = 42,
        )
        m = xgb.XGBClassifier(**params)
        m.fit(X_tr_sm, y_tr_sm,
              eval_set=[(X_val, y_val)],
              verbose=False)
        return f1_score(y_val, m.predict(X_val), zero_division=0)

    study = optuna.create_study(direction='maximize')
    study.optimize(objective, n_trials=40, show_progress_bar=False)
    bp = study.best_params
    print(f"  Best F1 val : {study.best_value:.3f}")
    print(f"  Params : n_est={bp['n_estimators']} depth={bp['max_depth']} lr={bp['lr']:.4f}")

    # Modele final
    best_params = dict(
        n_estimators     = bp['n_estimators'],
        max_depth        = bp['max_depth'],
        learning_rate    = bp['lr'],
        subsample        = bp['sub'],
        colsample_bytree = bp['col'],
        min_child_weight = bp['mcw'],
        gamma            = bp['gamma'],
        reg_alpha        = bp['alpha'],
        reg_lambda       = bp['lambda'],
        scale_pos_weight = 1.0,
        eval_metric      = 'logloss',
        verbosity        = 0,
        random_state     = 42,
    )
    model = xgb.XGBClassifier(**best_params)
    model.fit(X_tr_sm, y_tr_sm,
              eval_set=[(X_val, y_val)],
              verbose=False)

    # Probabilites sur test
    y_prob = model.predict_proba(X_te)[:, 1]

    # Optimiser seuil sur validation (pas sur test)
    y_prob_val = model.predict_proba(X_val)[:, 1]
    precs_v, recs_v, thrs_v = precision_recall_curve(y_val, y_prob_val)
    # precision_recall_curve retourne len(thrs) = len(precs)-1
    # on aligne sur thrs
    precs_v_t = precs_v[:-1]
    recs_v_t  = recs_v[:-1]
    f1s_v     = 2 * precs_v_t * recs_v_t / (precs_v_t + recs_v_t + 1e-9)
    valid_mask = recs_v_t >= 0.50
    if valid_mask.any():
        best_thr = thrs_v[valid_mask][np.argmax(f1s_v[valid_mask])]
    else:
        best_thr = 0.5

    y_pred = (y_prob >= best_thr).astype(int)

    # Metriques
    pr_auc = average_precision_score(y_te, y_prob)
    roc    = roc_auc_score(y_te, y_prob)
    f1     = f1_score(y_te, y_pred, zero_division=0)

    print(f"\n  === RESULTATS SUR TEST SET ===")
    print(f"  Seuil decision  : {best_thr:.3f}")
    print(f"  PR-AUC          : {pr_auc:.3f}")
    print(f"  ROC-AUC         : {roc:.3f}")
    print(f"  F1-Score        : {f1:.3f}")
    print(f"  Recall pre-panne: {f1_score(y_te, y_pred, pos_label=1, zero_division=0):.3f}")
    print("\n  Rapport classification :")
    print(classification_report(y_te, y_pred,
                                target_names=['Normal','Pre-alerte'],
                                zero_division=0))

    precs, recs, thrs = precision_recall_curve(y_te, y_prob)
    return model, scaler, feature_cols, X_te, y_te, y_pred, y_prob, idx_te, precs, recs, thrs, best_thr


# ─────────────────────────────────────────────
# 5. GRAPHIQUES
# ─────────────────────────────────────────────
def generer_graphiques(df_ts, fe, labels, en_alerte, model, scaler, feature_cols,
                       X_te, y_te, y_pred, y_prob, idx_te,
                       precs, recs, thrs, best_thr):
    print("\n[5/5] Generation des graphiques...")
    sensor_colors = {
        'T_Echap_D': '#E53935',
        'T_Echap_G': '#FF7043',
        'P_Huile':   '#1E88E5',
        'Regime':    '#43A047',
        'T_Refroid': '#8E24AA',
        'T_Convert': '#FB8C00',
    }

    # --- G1 : Series temporelles 6 capteurs ---
    fig, axes = plt.subplots(3, 2, figsize=(20, 14), sharex=True)
    fig.suptitle('Series temporelles - 6 capteurs - Chargeuse 994F1 (Jan-Dec 2025)\n'
                 'Zones grises = etat pre-alerte futur (label forward)',
                 fontsize=13, fontweight='bold')
    for ax, (col, color) in zip(axes.flat, sensor_colors.items()):
        ax.plot(df_ts.index, df_ts[col], color=color, lw=0.5, alpha=0.9, label=col)
        seuil_a = SEUILS_ALARME.get(col)
        seuil_p = SEUILS_PREALERTE.get(col)
        if seuil_a:
            ax.axhline(seuil_a, color='black', ls='-', lw=1.2, label=f'Alarme {seuil_a}')
        if seuil_p:
            ax.axhline(seuil_p, color='gray', ls='--', lw=0.8, label=f'Pre-alerte {seuil_p}')
        lab_al = labels.reindex(df_ts.index, fill_value=0)
        ax.fill_between(df_ts.index, df_ts[col].min(), df_ts[col].max(),
                        where=lab_al==1, alpha=0.12, color='red')
        ax.set_title(col, fontsize=11, color=color)
        ax.legend(fontsize=7, loc='upper right')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '1_series_capteurs.png'), dpi=150)
    plt.close()
    print("  G1 : series capteurs")

    # --- G2 : Timeline labels vs alertes reelles ---
    fig, axes = plt.subplots(2, 1, figsize=(18, 7), sharex=True)
    label_aligned = labels.reindex(df_ts.index, fill_value=0)
    axes[0].fill_between(df_ts.index, label_aligned, alpha=0.7,
                         color='tomato', label='Label forward (pre-alerte)')
    axes[0].set_title('Label forward : pre-alerte attendue dans les 2h', fontsize=11)
    axes[0].set_ylabel('0 / 1')
    axes[0].legend()
    axes[1].fill_between(df_ts.index, en_alerte.reindex(df_ts.index, fill_value=False).astype(int),
                         alpha=0.7, color='orange', label='Alerte reelle (capteur depasse seuil)')
    axes[1].set_title('Alerte reelle (capteur en zone pre-alerte)', fontsize=11)
    axes[1].set_ylabel('0 / 1')
    axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    axes[1].legend()
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '2_timeline_labels.png'), dpi=150)
    plt.close()
    print("  G2 : timeline labels")

    # --- G3 : Courbe PR ---
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot(recs, precs, color='navy', lw=2.5)
    ax.fill_between(recs, precs, alpha=0.15, color='navy')
    pr_auc = average_precision_score(y_te, y_prob)
    # Point seuil optimal
    idx_b = np.argmin(np.abs(thrs - best_thr)) if len(thrs) > 0 else 0
    if idx_b < len(recs):
        ax.plot(recs[idx_b], precs[idx_b], 'ro', ms=10, zorder=5,
                label=f'Seuil optimal={best_thr:.2f}')
    ax.set_title(f'Courbe Precision-Recall (PR-AUC = {pr_auc:.3f})\n994F1 - Horizon {HORIZON_PRED}',
                 fontsize=12)
    ax.set_xlabel('Recall (taux de detection)')
    ax.set_ylabel('Precision')
    ax.legend(fontsize=10)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '3_precision_recall.png'), dpi=150)
    plt.close()
    print("  G3 : courbe PR")

    # --- G4 : Matrice de confusion ---
    cm = confusion_matrix(y_te, y_pred)
    fig, ax = plt.subplots(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
                xticklabels=['Normal','Pre-alerte'],
                yticklabels=['Normal','Pre-alerte'],
                ax=ax, annot_kws={'size': 15})
    f1 = f1_score(y_te, y_pred, zero_division=0)
    roc= roc_auc_score(y_te, y_prob)
    ax.set_title(f'Matrice de confusion - XGBoost\nF1={f1:.3f} | ROC-AUC={roc:.3f}', fontsize=12)
    ax.set_ylabel('Reel')
    ax.set_xlabel('Predit')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '4_confusion_matrix.png'), dpi=150)
    plt.close()
    print("  G4 : matrice confusion")

    # --- G5 : Score probabilite dans le temps ---
    fig, axes = plt.subplots(3, 1, figsize=(20, 12), sharex=True)
    # Temperature echappement
    axes[0].plot(df_ts.index, df_ts['T_Echap_D'], color='#E53935', lw=0.5, label='T_Echap_D')
    axes[0].plot(df_ts.index, df_ts['T_Echap_G'], color='#FF7043', lw=0.5, label='T_Echap_G')
    axes[0].axhline(SEUILS_ALARME['T_Echap_D'], color='black', ls='--', lw=1)
    axes[0].axhline(SEUILS_PREALERTE['T_Echap_D'], color='gray', ls=':', lw=1)
    axes[0].set_ylabel('Temp Echap (deg C)')
    axes[0].legend(fontsize=8, loc='upper right')
    axes[0].set_title('Temperature Echappement + Score pre-alerte XGBoost', fontsize=11)
    # Probabilite XGBoost sur periode test
    axes[1].fill_between(idx_te, y_prob, 0, alpha=0.7, color='#9C27B0')
    axes[1].axhline(best_thr, color='red', ls='--', lw=1.5,
                    label=f'Seuil={best_thr:.2f}')
    axes[1].set_ylabel('P(pre-alerte)')
    axes[1].set_ylim(0, 1)
    axes[1].legend(fontsize=9)
    axes[1].set_title('Probabilite de pre-alerte (XGBoost) - periode test', fontsize=11)
    # Comparaison
    axes[2].fill_between(idx_te, y_te,   0, alpha=0.5, color='tomato',    label='Label reel')
    axes[2].fill_between(idx_te, y_pred, 0, alpha=0.4, color='steelblue', label='Prediction')
    axes[2].set_ylabel('0 / 1')
    axes[2].legend(fontsize=9)
    axes[2].xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    axes[2].set_title('Label reel vs Prediction', fontsize=11)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '5_score_timeline.png'), dpi=150)
    plt.close()
    print("  G5 : score timeline")

    # --- G6 : Feature importance XGBoost ---
    importances = pd.Series(model.feature_importances_, index=feature_cols)
    top25 = importances.nlargest(25)
    fig, ax = plt.subplots(figsize=(11, 9))
    colors_bar = ['#E53935' if 'Echap' in i else
                  '#1E88E5' if 'Huile' in i else
                  '#43A047' if 'Regime' in i else
                  '#8E24AA' if 'Refroid' in i else
                  '#FB8C00' if 'Convert' in i else '#607D8B'
                  for i in top25.index]
    top25.sort_values().plot.barh(ax=ax, color=colors_bar[::-1])
    ax.set_title('Top 25 features - XGBoost\n(Maintenance Predictive 994F1 - Horizon 2h)',
                 fontsize=12)
    ax.set_xlabel('Importance')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '6_feature_importance.png'), dpi=150)
    plt.close()
    print("  G6 : feature importance")

    # --- G7 : SHAP ---
    print("  Calcul SHAP...")
    try:
        X_te_df = pd.DataFrame(X_te[:500], columns=feature_cols)
        explainer   = shap.TreeExplainer(model)
        shap_values = explainer.shap_values(X_te_df)
        plt.figure(figsize=(11, 9))
        shap.summary_plot(shap_values, X_te_df, feature_names=feature_cols,
                          show=False, max_display=20)
        plt.title('SHAP - Impact des features sur la prediction de pre-alerte\n(994F1 OCP)',
                  fontsize=12)
        plt.tight_layout()
        plt.savefig(os.path.join(OUTPUT_DIR, '7_shap_summary.png'), dpi=150, bbox_inches='tight')
        plt.close()
        print("  G7 : SHAP")
    except Exception as e:
        print(f"  SHAP ignore : {e}")

    # --- G8 : Distribution scores Normal vs Pre-alerte ---
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.hist(y_prob[y_te==0], bins=80, alpha=0.65, color='steelblue',
            density=True, label=f'Normal (n={int((y_te==0).sum())})')
    ax.hist(y_prob[y_te==1], bins=80, alpha=0.65, color='tomato',
            density=True, label=f'Pre-alerte (n={int((y_te==1).sum())})')
    ax.axvline(best_thr, color='black', ls='--', lw=2, label=f'Seuil={best_thr:.2f}')
    ax.set_title('Separation des distributions - Normal vs Pre-alerte\n(XGBoost | Horizon 2h)',
                 fontsize=12)
    ax.set_xlabel('Probabilite de pre-alerte')
    ax.set_ylabel('Densite')
    ax.legend(fontsize=10)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '8_distribution_scores.png'), dpi=150)
    plt.close()
    print("  G8 : distribution scores")

    print(f"\n  8 graphiques sauvegardes dans : {OUTPUT_DIR}")


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 65)
    print("  MAINTENANCE PREDICTIVE V3 - CAT 994F1 - OCP BENGUERIR")
    print(f"  Horizon de prediction : {HORIZON_PRED}")
    print("=" * 65)

    df_ts              = load_capteurs()
    labels, en_alerte  = create_labels_forward(df_ts)
    fe                 = feature_engineering(df_ts)

    (model, scaler, feature_cols,
     X_te, y_te, y_pred, y_prob,
     idx_te, precs, recs,
     thrs, best_thr) = train_and_evaluate(fe, labels)

    generer_graphiques(df_ts, fe, labels, en_alerte, model, scaler, feature_cols,
                       X_te, y_te, y_pred, y_prob, idx_te,
                       precs, recs, thrs, best_thr)

    pr_auc = average_precision_score(y_te, y_prob)
    roc    = roc_auc_score(y_te, y_prob)
    f1     = f1_score(y_te, y_pred, zero_division=0)

    print("\n" + "=" * 65)
    print("  RESULTATS FINAUX - V3")
    print("=" * 65)
    print(f"  Horizon de prediction   : {HORIZON_PRED}")
    print(f"  Seuil de decision       : {best_thr:.3f}")
    print(f"  PR-AUC                  : {pr_auc:.3f}   (>0.5 = modele utile)")
    print(f"  ROC-AUC                 : {roc:.3f}   (>0.7 = bon)")
    print(f"  F1-Score                : {f1:.3f}")
    print(f"\n  Graphiques dans : {OUTPUT_DIR}")
    print("  Pipeline V3 termine avec succes.")
