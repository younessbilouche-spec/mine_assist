# -*- coding: utf-8 -*-
"""
Maintenance Predictive - CAT 994F1 - OCP Benguerir
Approche : Detection d'anomalies non supervisee
  - Health Index (score de sante 0-100)
  - IsolationForest (detection etats anormaux)
  - Validation qualitative avec GMAO
  - 8 graphiques + rapport
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
import matplotlib.patches as mpatches
import seaborn as sns
import shap
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from sklearn.decomposition import PCA
from scipy import stats

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(__file__)
CAPTEUR_DIR = os.path.join(BASE_DIR, 'data', 'capteurs')
GMAO_FILE   = os.path.join(BASE_DIR, 'data', 'gmao', 'anomalies',
              '994F1_export_ 31-12-2024 01-01-2026 23-02-2026 - Copie.xlsx')
OUTPUT_DIR  = os.path.join(BASE_DIR, 'resultats_ML', 'predictive_final')
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

# Seuils alarme (source seulles.xlsx OCP)
SEUILS = {
    'T_Echap_D': 600.0,
    'T_Echap_G': 600.0,
    'P_Huile':   140.0,   # min (en dessous = alarme)
    'Regime':    1750.0,
    'T_Refroid': 105.0,
    'T_Convert': 129.0,
}

# Poids de criticite par capteur (selon seulles.xlsx)
CRITICITE = {
    'T_Echap_D': 1.0,
    'T_Echap_G': 1.0,
    'P_Huile':   1.0,
    'Regime':    0.8,
    'T_Refroid': 0.9,
    'T_Convert': 0.8,
}

# Plages normales observees (percentiles 5-95 sur donnees saines)
# seront calculees automatiquement
RESAMPLE = '5min'

GMAO_MOTS_CLES = [
    'lubrification', 'huile', 'convertisseur', 'echappement',
    'échappement', 'refroidissement', 'surchauffe', 'temperature',
    'température', 'turbocompresseur', 'injecteur', 'regime',
    'régime', 'calage', 'carburant', 'combustible', 'graissage',
    'transmission', 'solenoid', 'solénoïde', 'filtre',
    'prelubrification', 'prélubrification', 'niveau', 'pression',
]


# ─────────────────────────────────────────────────────────────
# 1. CHARGEMENT CAPTEURS
# ─────────────────────────────────────────────────────────────
def load_capteurs():
    print("\n[1/4] Chargement capteurs...")
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
        except Exception as e:
            print(f"  ERR {f}: {e}")

    df_all = pd.concat(dfs, ignore_index=True)
    df_all = df_all.drop_duplicates(subset=['Heure', 'Param_short'])
    df_all = df_all.sort_values('Heure')
    df_ts  = (df_all.pivot(index='Heure', columns='Param_short', values='Val_moy')
                    .rename_axis(None, axis=1))
    df_ts  = df_ts.resample(RESAMPLE).mean()
    df_ts  = df_ts.interpolate(method='time', limit=6).dropna()

    print(f"  {len(df_ts)} lignes x {len(df_ts.columns)} capteurs")
    print(f"  Periode : {df_ts.index.min().date()} -> {df_ts.index.max().date()}")

    # Stats descriptives
    print("\n  Statistiques des capteurs :")
    for col in df_ts.columns:
        seuil = SEUILS.get(col, '?')
        print(f"  {col:<22} min={df_ts[col].min():>7.1f}  "
              f"moy={df_ts[col].mean():>7.1f}  "
              f"max={df_ts[col].max():>7.1f}  "
              f"seuil={seuil}")
    return df_ts


# ─────────────────────────────────────────────────────────────
# 2. CHARGEMENT GMAO
# ─────────────────────────────────────────────────────────────
def load_gmao():
    print("\n[2/4] Chargement GMAO...")
    df = pd.read_excel(GMAO_FILE)
    df.columns = df.columns.str.strip()
    col_date = "Date de l'anomalie"
    col_code = "Code d'anomalie"
    col_grav = next(c for c in df.columns if 'ravit' in c)
    col_type = 'Type'

    df[col_date] = pd.to_datetime(df[col_date], errors='coerce')
    df[col_grav] = pd.to_numeric(df[col_grav], errors='coerce')
    df = df[df[col_date].notna() & df[col_grav].notna()]

    def pertinent(code):
        if not isinstance(code, str):
            return False
        c = code.lower()
        return any(k in c for k in GMAO_MOTS_CLES)

    df['pertinent'] = df[col_code].apply(pertinent)

    print(f"  Total : {len(df)} | Gravite>=2 : {(df[col_grav]>=2).sum()} "
          f"| Pertinentes : {df['pertinent'].sum()}")
    return df, col_date, col_code, col_grav


# ─────────────────────────────────────────────────────────────
# 3. FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────
def feature_engineering(df_ts):
    print("\n[3/4] Feature engineering...")
    fe = pd.DataFrame(index=df_ts.index)

    for col in df_ts.columns:
        fe[col] = df_ts[col]
        for w in ['15min', '1h', '4h', '12h']:
            fe[f'{col}_mean_{w}'] = df_ts[col].rolling(w).mean()
            fe[f'{col}_std_{w}']  = df_ts[col].rolling(w).std()
        fe[f'{col}_diff_1h']  = df_ts[col].diff(12)
        fe[f'{col}_diff_4h']  = df_ts[col].diff(48)
        fe[f'{col}_mean_24h'] = df_ts[col].rolling('24h').mean()
        fe[f'{col}_dev_24h']  = df_ts[col] - fe[f'{col}_mean_24h']

        # Distance normalisee au seuil (0=normal, 1=au seuil, >1=alarme)
        s = SEUILS[col]
        if col == 'P_Huile':
            fe[f'{col}_dist_norm'] = (s - df_ts[col]) / s
        else:
            fe[f'{col}_dist_norm'] = (df_ts[col] - s * 0.7) / (s * 0.3)

    fe['delta_echap']      = (df_ts['T_Echap_D'] - df_ts['T_Echap_G']).abs()
    fe['T_echap_moy']      = (df_ts['T_Echap_D'] + df_ts['T_Echap_G']) / 2
    fe['ratio_P_Regime']   = df_ts['P_Huile'] / df_ts['Regime'].clip(lower=100)
    fe['corr_echap']       = df_ts['T_Echap_D'].rolling('1h').corr(df_ts['T_Echap_G'])
    fe['heure_sin']        = np.sin(2 * np.pi * df_ts.index.hour / 24)
    fe['heure_cos']        = np.cos(2 * np.pi * df_ts.index.hour / 24)

    fe = fe.dropna()
    print(f"  {len(fe.columns)} features x {len(fe)} lignes")
    return fe


# ─────────────────────────────────────────────────────────────
# 4. HEALTH INDEX
# ─────────────────────────────────────────────────────────────
def compute_health_index(df_ts):
    """
    Score de sante [0, 100].
    100 = parfaitement normal
    0   = toutes alarmes actives
    Base : distance normalisee de chaque capteur a son seuil critique.
    """
    scores = pd.DataFrame(index=df_ts.index)
    for col in df_ts.columns:
        s    = SEUILS[col]
        crit = CRITICITE[col]
        if col == 'P_Huile':
            # plus la pression est basse par rapport au seuil, plus c'est mauvais
            # normale : au-dessus de 3x le seuil
            p_norm  = 3 * s   # ~420 kPa = nominal
            ratio   = (df_ts[col] - s) / (p_norm - s)
        else:
            # normale : en dessous de 60% du seuil
            p_norm  = 0.60 * s
            ratio   = 1.0 - (df_ts[col] - p_norm) / (s - p_norm)

        ratio = ratio.clip(0, 1)
        scores[col] = ratio * 100 * crit

    total_crit = sum(CRITICITE.values())
    health = scores.sum(axis=1) / total_crit

    # Lissage 1h pour eviter le bruit
    health_smooth = health.rolling('1h', min_periods=1).mean().clip(0, 100)
    return health_smooth, scores


# ─────────────────────────────────────────────────────────────
# 5. ISOLATION FOREST
# ─────────────────────────────────────────────────────────────
def fit_isolation_forest(fe):
    print("  IsolationForest...")
    scaler  = StandardScaler()
    X_sc    = scaler.fit_transform(fe.values)

    # Entrainer sur les 70% premiers (periode la plus saine)
    n_train = int(len(X_sc) * 0.70)
    iso = IsolationForest(
        n_estimators=300,
        contamination=0.03,   # 3% contamination estimee
        max_features=0.8,
        random_state=42,
        n_jobs=-1,
    )
    iso.fit(X_sc[:n_train])

    # Score sur tout le dataset (-score_samples = anomaly score, plus haut = plus anormal)
    anomaly_score = pd.Series(
        -iso.score_samples(X_sc),
        index=fe.index,
        name='anomaly_score'
    )
    # Normaliser en [0, 100]
    vmin, vmax = anomaly_score.quantile(0.01), anomaly_score.quantile(0.99)
    anomaly_norm = ((anomaly_score - vmin) / (vmax - vmin)).clip(0, 1) * 100

    # Seuil d'alerte : percentile 97
    threshold_iso = float(anomaly_norm.quantile(0.97))
    alerte_iso    = anomaly_norm > threshold_iso

    print(f"  Seuil alerte IsolationForest : {threshold_iso:.1f}/100")
    print(f"  Periodes en alerte : {alerte_iso.sum()} pts ({alerte_iso.mean()*100:.1f}%)")
    return anomaly_norm, alerte_iso, threshold_iso, scaler, iso


# ─────────────────────────────────────────────────────────────
# 6. VALIDATION GMAO
# ─────────────────────────────────────────────────────────────
def valider_gmao(anomaly_score, health, df_gmao, col_date, col_grav):
    print("\n  Validation avec GMAO...")
    window = pd.Timedelta('6h')
    resultats = []

    for _, row in df_gmao[df_gmao[col_grav] >= 2].iterrows():
        t      = row[col_date]
        # Score anomalie moyen dans les 6h AVANT l'anomalie GMAO
        mask   = (anomaly_score.index >= t - window) & (anomaly_score.index <= t)
        if mask.sum() == 0:
            continue
        score_avant = anomaly_score[mask].mean()
        health_avant= health[mask].mean()
        # Score sur periode normale (6h avant la fenetre)
        mask_ref    = (anomaly_score.index >= t - 2*window) & (anomaly_score.index < t - window)
        score_ref   = anomaly_score[mask_ref].mean() if mask_ref.sum() > 0 else np.nan
        resultats.append({
            'date':         t,
            'anomalie':     str(row["Code d'anomalie"])[:60],
            'gravite':      row[col_grav],
            'score_avant':  score_avant,
            'score_ref':    score_ref,
            'health_avant': health_avant,
            'delta_score':  score_avant - score_ref if not np.isnan(score_ref) else np.nan,
        })

    df_val = pd.DataFrame(resultats).dropna(subset=['score_avant'])
    if len(df_val) > 0:
        print(f"  {len(df_val)} anomalies GMAO comparees")
        print(f"  Score anomalie moyen AVANT panne  : {df_val['score_avant'].mean():.1f}/100")
        print(f"  Score anomalie moyen periode ref  : {df_val['score_ref'].mean():.1f}/100")
        print(f"  Delta moyen                       : +{df_val['delta_score'].mean():.1f} pts")
        pct_eleve = (df_val['score_avant'] > df_val['score_ref']).mean() * 100
        print(f"  Anomalies avec score plus eleve avant panne : {pct_eleve:.0f}%")
    return df_val


# ─────────────────────────────────────────────────────────────
# 7. GRAPHIQUES
# ─────────────────────────────────────────────────────────────
def generer_graphiques(df_ts, fe, health, anomaly_norm, alerte_iso,
                       threshold_iso, df_gmao, df_val,
                       col_date, col_grav, scaler, iso):

    print("\n[4/4] Generation des graphiques...")
    COLORS = {
        'T_Echap_D': '#E53935', 'T_Echap_G': '#FF7043',
        'P_Huile':   '#1E88E5', 'Regime':    '#43A047',
        'T_Refroid': '#8E24AA', 'T_Convert': '#FB8C00',
    }
    gmao_graves = df_gmao[df_gmao[col_grav] >= 2]
    gmao_pert   = df_gmao[df_gmao['pertinent'] & (df_gmao[col_grav] >= 2)]

    def add_gmao_lines(ax, alpha=0.3):
        for _, row in gmao_pert.iterrows():
            t = row[col_date]
            if df_ts.index.min() <= t <= df_ts.index.max():
                ax.axvline(t, color='purple', lw=0.5, alpha=alpha, zorder=1)

    # ── G1 : 6 capteurs avec seuils et evenements GMAO ──────────
    fig, axes = plt.subplots(3, 2, figsize=(20, 15), sharex=True)
    fig.suptitle('Chargeuse CAT 994F1 - OCP Benguerir\n'
                 '6 Capteurs Critiques (Jan - Dec 2025) | Lignes violettes = anomalies GMAO',
                 fontsize=13, fontweight='bold', y=0.98)
    for ax, col in zip(axes.flat, COLORS):
        color = COLORS[col]
        ax.plot(df_ts.index, df_ts[col], color=color, lw=0.4, alpha=0.85)
        ax.axhline(SEUILS[col], color='black', ls='--', lw=1.2,
                   label=f'Seuil alarme = {SEUILS[col]}')
        ax.axhline(SEUILS[col] * 0.85, color='gray', ls=':', lw=0.8,
                   label=f'Pre-alerte = {SEUILS[col]*0.85:.0f}')
        add_gmao_lines(ax)
        ax.set_title(col, fontsize=11, color=color, fontweight='bold')
        ax.legend(fontsize=7, loc='upper right')
        ax.set_ylabel(col)
    axes[2,0].xaxis.set_major_formatter(mdates.DateFormatter('%b'))
    axes[2,1].xaxis.set_major_formatter(mdates.DateFormatter('%b'))
    plt.tight_layout(rect=[0, 0, 1, 0.97])
    plt.savefig(os.path.join(OUTPUT_DIR, '1_capteurs_serie.png'), dpi=150)
    plt.close()
    print("  G1 : series capteurs")

    # ── G2 : Health Index ────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(18, 5))
    health_smooth = health.rolling('4h', min_periods=1).mean()
    # Zones colorees
    ax.fill_between(health_smooth.index, health_smooth,
                    where=health_smooth >= 80, color='#4CAF50', alpha=0.6, label='Bon (>80)')
    ax.fill_between(health_smooth.index, health_smooth,
                    where=(health_smooth >= 60) & (health_smooth < 80),
                    color='#FF9800', alpha=0.6, label='Attention (60-80)')
    ax.fill_between(health_smooth.index, health_smooth,
                    where=health_smooth < 60, color='#F44336', alpha=0.6, label='Alerte (<60)')
    ax.plot(health_smooth.index, health_smooth, color='black', lw=0.6, alpha=0.7)
    ax.axhline(80, color='#4CAF50', ls='--', lw=1)
    ax.axhline(60, color='#F44336', ls='--', lw=1)
    add_gmao_lines(ax, alpha=0.5)
    ax.set_ylim(0, 105)
    ax.set_ylabel('Health Index [0-100]', fontsize=11)
    ax.set_title('Health Index - Chargeuse 994F1 (Jan-Dec 2025)\n'
                 'Lignes violettes = anomalies GMAO pertinentes (gravite >= 2)',
                 fontsize=12, fontweight='bold')
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    ax.legend(fontsize=9, loc='lower left')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '2_health_index.png'), dpi=150)
    plt.close()
    print("  G2 : health index")

    # ── G3 : Score anomalie IsolationForest ──────────────────────
    fig, axes = plt.subplots(2, 1, figsize=(18, 9), sharex=True)
    an_smooth = anomaly_norm.rolling('2h', min_periods=1).mean()
    axes[0].fill_between(an_smooth.index, an_smooth, alpha=0.7,
                         color='#9C27B0', label='Score anomalie')
    axes[0].axhline(threshold_iso, color='red', ls='--', lw=1.5,
                    label=f'Seuil alerte = {threshold_iso:.1f}')
    axes[0].fill_between(an_smooth.index, an_smooth,
                         where=an_smooth > threshold_iso,
                         alpha=0.5, color='red', label='Zone alerte')
    add_gmao_lines(axes[0], alpha=0.6)
    axes[0].set_ylabel('Score Anomalie [0-100]')
    axes[0].set_title('Score Anomalie IsolationForest | Lignes violettes = GMAO graves',
                      fontsize=11, fontweight='bold')
    axes[0].legend(fontsize=8)

    # Combiner health + anomalie
    combined = (100 - health.reindex(an_smooth.index, method='nearest') + an_smooth) / 2
    axes[1].fill_between(an_smooth.index, combined, alpha=0.7, color='darkorange')
    add_gmao_lines(axes[1], alpha=0.6)
    axes[1].set_ylabel('Score Risque Combine [0-100]')
    axes[1].set_title('Score de Risque Combine (Health + Anomalie)', fontsize=11)
    axes[1].xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '3_anomaly_score.png'), dpi=150)
    plt.close()
    print("  G3 : score anomalie")

    # ── G4 : Heatmap mensuelle du Health Index ───────────────────
    health_df  = health.to_frame('health')
    health_df['mois']  = health_df.index.month
    health_df['heure'] = health_df.index.hour
    pivot = health_df.pivot_table(values='health', index='heure', columns='mois', aggfunc='mean')
    mois_noms = ['Jan','Feb','Mar','Avr','Mai','Jun','Jul','Aou','Sep','Oct','Nov','Dec']
    pivot.columns = [mois_noms[m-1] for m in pivot.columns]

    fig, ax = plt.subplots(figsize=(14, 7))
    sns.heatmap(pivot, cmap='RdYlGn', vmin=60, vmax=100, ax=ax,
                linewidths=0.3, annot=False, cbar_kws={'label': 'Health Index'})
    ax.set_title('Heatmap Health Index - Heure du jour x Mois\n'
                 'Vert = sain | Rouge = degrade', fontsize=12, fontweight='bold')
    ax.set_xlabel('Mois')
    ax.set_ylabel('Heure du jour')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '4_heatmap_health.png'), dpi=150)
    plt.close()
    print("  G4 : heatmap mensuelle")

    # ── G5 : Validation GMAO ─────────────────────────────────────
    if len(df_val) > 10:
        fig, axes = plt.subplots(1, 2, figsize=(14, 6))

        axes[0].scatter(df_val['score_ref'], df_val['score_avant'],
                        c=df_val['gravite'], cmap='RdYlGn_r',
                        s=60, alpha=0.8, edgecolors='black', lw=0.5)
        lim = max(df_val[['score_ref','score_avant']].max().max() + 5, 30)
        axes[0].plot([0, lim], [0, lim], 'k--', lw=1, label='Pas de changement')
        axes[0].set_xlabel('Score anomalie periode ref (6-12h avant)')
        axes[0].set_ylabel('Score anomalie avant anomalie GMAO (0-6h)')
        axes[0].set_title('Score avant vs Score ref\npour chaque anomalie GMAO (gravite>=2)',
                          fontsize=11)
        axes[0].legend()
        pct = (df_val['score_avant'] > df_val['score_ref']).mean() * 100
        axes[0].text(0.05, 0.92, f'{pct:.0f}% des pannes\navec score eleve',
                     transform=axes[0].transAxes, fontsize=10,
                     bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.7))

        axes[1].bar(['Score ref\n(periode normale)', 'Score avant\nla panne'],
                    [df_val['score_ref'].mean(), df_val['score_avant'].mean()],
                    color=['#4CAF50', '#F44336'], alpha=0.85, edgecolor='black')
        axes[1].errorbar(['Score ref\n(periode normale)', 'Score avant\nla panne'],
                         [df_val['score_ref'].mean(), df_val['score_avant'].mean()],
                         yerr=[df_val['score_ref'].std(), df_val['score_avant'].std()],
                         fmt='none', color='black', capsize=5)
        axes[1].set_ylabel('Score Anomalie moyen [0-100]')
        axes[1].set_title('Comparaison score moyen\nNormal vs Avant anomalie GMAO', fontsize=11)

        plt.suptitle('Validation : Le modele detecte-t-il les anomalies GMAO ?',
                     fontsize=12, fontweight='bold')
        plt.tight_layout()
        plt.savefig(os.path.join(OUTPUT_DIR, '5_validation_gmao.png'), dpi=150)
        plt.close()
        print("  G5 : validation GMAO")

    # ── G6 : Distribution score anomalie par mois ────────────────
    an_df = anomaly_norm.to_frame('score')
    an_df['mois'] = an_df.index.month
    mois_data = [an_df[an_df['mois']==m]['score'].values for m in range(1,13)]
    mois_data  = [x for x in mois_data if len(x) > 0]
    mois_labels= [mois_noms[m-1] for m in range(1,13)
                  if len(an_df[an_df['mois']==m]) > 0]

    fig, ax = plt.subplots(figsize=(14, 6))
    bp = ax.boxplot(mois_data, labels=mois_labels, patch_artist=True,
                    medianprops=dict(color='black', lw=2))
    for patch, m in zip(bp['boxes'], range(1, len(mois_data)+1)):
        med = np.median(mois_data[m-1])
        patch.set_facecolor('#F44336' if med > threshold_iso * 0.7 else
                            '#FF9800' if med > threshold_iso * 0.5 else '#4CAF50')
        patch.set_alpha(0.7)
    ax.axhline(threshold_iso, color='red', ls='--', lw=1.5,
               label=f'Seuil alerte = {threshold_iso:.1f}')
    ax.set_title('Distribution du Score Anomalie par Mois\n'
                 'Vert=normal | Orange=attention | Rouge=alerte', fontsize=12, fontweight='bold')
    ax.set_xlabel('Mois')
    ax.set_ylabel('Score Anomalie [0-100]')
    ax.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '6_distribution_mensuelle.png'), dpi=150)
    plt.close()
    print("  G6 : distribution mensuelle")

    # ── G7 : PCA - Espace d'etat de la machine ───────────────────
    scaler_pca = StandardScaler()
    X_pca = scaler_pca.fit_transform(df_ts.values)
    pca   = PCA(n_components=2)
    X_2d  = pca.fit_transform(X_pca)
    scores_aligned = anomaly_norm.reindex(df_ts.index, method='nearest').values

    fig, ax = plt.subplots(figsize=(10, 8))
    sc = ax.scatter(X_2d[:, 0], X_2d[:, 1],
                    c=scores_aligned, cmap='RdYlGn_r',
                    s=1, alpha=0.3, vmin=0, vmax=100)
    plt.colorbar(sc, ax=ax, label='Score Anomalie')
    # Marquer les points en alerte
    alerte_mask = scores_aligned > threshold_iso
    ax.scatter(X_2d[alerte_mask, 0], X_2d[alerte_mask, 1],
               c='red', s=5, alpha=0.6, label='Etat anormal', zorder=3)
    var_exp = pca.explained_variance_ratio_
    ax.set_xlabel(f'PC1 ({var_exp[0]*100:.1f}% variance)')
    ax.set_ylabel(f'PC2 ({var_exp[1]*100:.1f}% variance)')
    ax.set_title('Espace d\'etat PCA de la Machine (6 capteurs)\n'
                 'Vert=normal | Rouge=anomalie detectee', fontsize=12, fontweight='bold')
    ax.legend(fontsize=9)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '7_pca_espace_etat.png'), dpi=150)
    plt.close()
    print("  G7 : PCA espace d'etat")

    # ── G8 : Contribution des capteurs aux anomalies (SHAP) ──────
    print("  Calcul SHAP IsolationForest...")
    try:
        X_sc  = scaler.transform(fe.values)
        # Echantillon aleatoire representatif
        idx_s = np.random.choice(len(X_sc), min(800, len(X_sc)), replace=False)
        X_smp = X_sc[idx_s]
        X_smp_df = pd.DataFrame(X_smp, columns=fe.columns)
        explainer   = shap.TreeExplainer(iso)
        shap_values = explainer.shap_values(X_smp_df)
        plt.figure(figsize=(12, 9))
        shap.summary_plot(shap_values, X_smp_df,
                          feature_names=fe.columns.tolist(),
                          show=False, max_display=20,
                          plot_type='bar')
        plt.title('Contribution des features a la detection d\'anomalies (SHAP)\n'
                  'Chargeuse 994F1 - OCP Benguerir', fontsize=12, fontweight='bold')
        plt.tight_layout()
        plt.savefig(os.path.join(OUTPUT_DIR, '8_shap_contribution.png'),
                    dpi=150, bbox_inches='tight')
        plt.close()
        print("  G8 : SHAP contributions")
    except Exception as e:
        print(f"  G8 SHAP ignore : {e}")

    print(f"\n  8 graphiques dans : {OUTPUT_DIR}")


# ─────────────────────────────────────────────────────────────
# 8. RAPPORT TEXTE
# ─────────────────────────────────────────────────────────────
def generer_rapport(df_ts, health, anomaly_norm, alerte_iso,
                    threshold_iso, df_gmao, df_val, col_grav):
    rapport_path = os.path.join(OUTPUT_DIR, 'RAPPORT_FINAL.txt')
    health_smooth = health.rolling('4h', min_periods=1).mean()

    with open(rapport_path, 'w', encoding='utf-8') as f:
        f.write("=" * 70 + "\n")
        f.write("  RAPPORT DE MAINTENANCE PREDICTIVE\n")
        f.write("  Chargeuse CAT 994F1 - OCP Benguerir\n")
        f.write("  Methode : Detection d'Anomalies Non Supervisee\n")
        f.write("=" * 70 + "\n\n")

        f.write("--- DONNEES UTILISEES ---\n")
        f.write(f"  Periode capteurs : {df_ts.index.min().date()} -> {df_ts.index.max().date()}\n")
        f.write(f"  Lignes capteurs  : {len(df_ts)}\n")
        f.write(f"  Capteurs         : {', '.join(df_ts.columns)}\n")
        f.write(f"  Anomalies GMAO   : {len(df_gmao)}\n\n")

        f.write("--- HEALTH INDEX ---\n")
        f.write(f"  Moyenne annuelle   : {health_smooth.mean():.1f} / 100\n")
        f.write(f"  Minimum            : {health_smooth.min():.1f}\n")
        f.write(f"  % temps etat Bon   : {(health_smooth >= 80).mean()*100:.1f}%\n")
        f.write(f"  % temps Attention  : {((health_smooth >= 60) & (health_smooth < 80)).mean()*100:.1f}%\n")
        f.write(f"  % temps Alerte     : {(health_smooth < 60).mean()*100:.1f}%\n\n")

        f.write("--- ISOLATION FOREST ---\n")
        f.write(f"  Seuil alerte       : {threshold_iso:.1f} / 100\n")
        f.write(f"  % temps en alerte  : {alerte_iso.mean()*100:.1f}%\n")
        f.write(f"  Nb periodes alerte : {(alerte_iso.astype(int).diff()==1).sum()}\n\n")

        f.write("--- VALIDATION GMAO ---\n")
        if len(df_val) > 0:
            pct = (df_val['score_avant'] > df_val['score_ref']).mean() * 100
            f.write(f"  Anomalies comparees : {len(df_val)}\n")
            f.write(f"  Score avant panne   : {df_val['score_avant'].mean():.1f}\n")
            f.write(f"  Score periode ref   : {df_val['score_ref'].mean():.1f}\n")
            f.write(f"  Delta moyen         : +{df_val['delta_score'].mean():.1f}\n")
            f.write(f"  Taux detection      : {pct:.0f}% des pannes ont un score plus eleve avant\n\n")

        f.write("--- CAPTEURS : STATISTIQUES ---\n")
        for col in df_ts.columns:
            s = SEUILS[col]
            pct_proche = ((df_ts[col] > s * 0.85).mean() * 100) if col != 'P_Huile' else \
                         ((df_ts[col] < s * 1.5).mean() * 100)
            f.write(f"  {col:<22} moy={df_ts[col].mean():>7.1f}  "
                    f"max={df_ts[col].max():>7.1f}  "
                    f"seuil={s}  "
                    f"% proche seuil={pct_proche:.1f}%\n")

        f.write("\n--- INTERPRETATION ---\n")
        hi_moy = health_smooth.mean()
        if hi_moy >= 85:
            etat = "EXCELLENT - Machine bien entretenue"
        elif hi_moy >= 70:
            etat = "BON - Surveillance normale recommandee"
        else:
            etat = "ATTENTION - Plan de maintenance a revoir"
        f.write(f"  Etat general : {etat}\n")
        f.write(f"  Health Index moyen = {hi_moy:.1f}/100\n")

    print(f"  Rapport sauvegarde : RAPPORT_FINAL.txt")
    return rapport_path


# ─────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 65)
    print("  MAINTENANCE PREDICTIVE - CAT 994F1 - OCP BENGUERIR")
    print("  Methode : Detection d'Anomalies Non Supervisee")
    print("=" * 65)

    df_ts                       = load_capteurs()
    df_gmao, col_date, col_code, col_grav = load_gmao()

    print("\n[3/4] Modelisation...")
    fe                          = feature_engineering(df_ts)
    health, scores              = compute_health_index(df_ts)
    anomaly_norm, alerte_iso, threshold_iso, scaler, iso = fit_isolation_forest(fe)
    # Aligner health sur l'index de anomaly_norm (apres dropna du fe)
    health_aligned              = health.reindex(anomaly_norm.index, method='nearest')
    df_val                      = valider_gmao(anomaly_norm, health_aligned, df_gmao, col_date, col_grav)

    generer_graphiques(df_ts, fe, health_aligned, anomaly_norm, alerte_iso,
                       threshold_iso, df_gmao, df_val, col_date, col_grav, scaler, iso)

    rapport = generer_rapport(df_ts, health_aligned, anomaly_norm, alerte_iso,
                              threshold_iso, df_gmao, df_val, col_grav)

    health_smooth = health_aligned.rolling('4h', min_periods=1).mean()
    print("\n" + "=" * 65)
    print("  RESULTATS FINAUX")
    print("=" * 65)
    print(f"  Health Index moyen     : {health_smooth.mean():.1f} / 100")
    print(f"  % temps etat Bon (>80) : {(health_smooth>=80).mean()*100:.1f}%")
    print(f"  Seuil alerte IsoForest : {threshold_iso:.1f} / 100")
    print(f"  % temps en alerte      : {alerte_iso.mean()*100:.1f}%")
    if len(df_val) > 0:
        pct = (df_val['score_avant'] > df_val['score_ref']).mean() * 100
        print(f"  Taux detection GMAO    : {pct:.0f}%")
    print(f"\n  Graphiques et rapport dans :")
    print(f"  {OUTPUT_DIR}")
    print("  Pipeline termine avec succes.")
