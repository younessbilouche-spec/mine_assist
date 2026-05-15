# -*- coding: utf-8 -*-
"""
Integration AMDEC + Pipeline Maintenance Predictive
CAT 994F1 - OCP Benguerir

Ce script :
  1. Parse l'AMDEC et calcule les RPN par capteur
  2. Met a jour les poids du Health Index
  3. Genere la table de diagnostic (alerte capteur -> modes AMDEC -> action)
  4. Sauvegarde le modele IsolationForest + metadata pour l'API
  5. Genere le rapport final enrichi
"""
import sys, os, warnings, json
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np
import joblib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

BASE_DIR    = os.path.dirname(__file__)
AMDEC_FILE  = r'C:\Users\ORIGINAL\Downloads\AMDEC-994F (1).xlsx'
CAPTEUR_DIR = os.path.join(BASE_DIR, 'data', 'capteurs')
GMAO_FILE   = os.path.join(BASE_DIR, 'data', 'gmao', 'anomalies',
              '994F1_export_ 31-12-2024 01-01-2026 23-02-2026 - Copie.xlsx')
OUTPUT_DIR  = os.path.join(BASE_DIR, 'resultats_ML', 'predictive_final')
MODEL_DIR   = os.path.join(BASE_DIR, 'models')
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)

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

SEUILS_ALARME = {
    'T_Echap_D': 600.0, 'T_Echap_G': 600.0,
    'P_Huile':   140.0, 'Regime':    1750.0,
    'T_Refroid': 105.0, 'T_Convert': 129.0,
}

# Mapping capteur -> circuits AMDEC
CAPTEUR_CIRCUITS = {
    'T_Echap_D': ["CIRUCIT\n D'ADMISSION ET\n D'ECHAPPEMENT", "CIRCUIT D'AIR"],
    'T_Echap_G': ["CIRUCIT\n D'ADMISSION ET\n D'ECHAPPEMENT", "CIRCUIT D'AIR"],
    'P_Huile':   ["CIRCUIT DE\n LUBRIFICATION", "BLOC"],
    'Regime':    ["CIRCUIT DE\n GASOIL", "CIRCUIT D'AIR"],
    'T_Refroid': ["CIRCUIT \nDE REFROIDISSEMENT"],
    'T_Convert': ["CIRCUIT DE TRANSMISSION", "CIRCUIT DE GRAISSAGE"],
}

# ─────────────────────────────────────────────────────────────
# 1. PARSE AMDEC
# ─────────────────────────────────────────────────────────────
def parse_amdec():
    print("[1/5] Parsing AMDEC...")
    df = pd.read_excel(AMDEC_FILE, sheet_name='994F1', skiprows=2, header=0)
    df.columns = ['Equipement','Circuit','Composant','Mode_Defaillance',
                  'Causes','Effets','Gravite','Occurrence','Tache_Maintenance','Frequence']
    df['Equipement'] = df['Equipement'].ffill()
    df['Circuit']    = df['Circuit'].ffill()
    df['Composant']  = df['Composant'].ffill()
    df = df.dropna(subset=['Mode_Defaillance'])

    occ_map = {'A': 3, 'B': 2, 'C': 1}
    df['Occ_num'] = df['Occurrence'].map(occ_map).fillna(1)
    df['Gravite']  = pd.to_numeric(df['Gravite'], errors='coerce').fillna(2)
    df['RPN']      = df['Gravite'] * df['Occ_num']

    print(f"  {len(df)} modes de defaillance | RPN max={df['RPN'].max():.0f}")
    return df


# ─────────────────────────────────────────────────────────────
# 2. CALCUL POIDS CRITICITE PAR CAPTEUR (depuis AMDEC)
# ─────────────────────────────────────────────────────────────
def calculer_poids_amdec(df_amdec):
    print("[2/5] Calcul poids criticite depuis AMDEC...")
    poids = {}
    rpn_details = {}

    for capteur, circuits in CAPTEUR_CIRCUITS.items():
        mask = df_amdec['Circuit'].str.strip().isin([c.strip() for c in circuits])
        subset = df_amdec[mask]
        if len(subset) == 0:
            poids[capteur] = 1.0
            rpn_details[capteur] = {'rpn_moy': 2.0, 'rpn_max': 2.0, 'nb_modes': 0, 'modes_critiques': 0}
            continue
        rpn_moy = subset['RPN'].mean()
        rpn_max = subset['RPN'].max()
        nb_crit = (subset['Gravite'] == 1).sum()
        poids[capteur] = rpn_moy / 3.0   # normalise sur 1 (RPN max theorique = 3*3=9)
        rpn_details[capteur] = {
            'rpn_moy': round(rpn_moy, 2),
            'rpn_max': rpn_max,
            'nb_modes': len(subset),
            'modes_critiques': int(nb_crit),
        }
        print(f"  {capteur:<12} : RPN_moy={rpn_moy:.2f}  modes={len(subset)}  critiques={nb_crit}  poids={poids[capteur]:.3f}")

    # Normaliser entre 0.5 et 1.5
    vals = np.array(list(poids.values()))
    vmin, vmax = vals.min(), vals.max()
    for k in poids:
        poids[k] = 0.5 + (poids[k] - vmin) / (vmax - vmin + 1e-9) * 1.0
    print(f"\n  Poids normalises : {poids}")
    return poids, rpn_details


# ─────────────────────────────────────────────────────────────
# 3. TABLE DE DIAGNOSTIC (capteur -> AMDEC -> action)
# ─────────────────────────────────────────────────────────────
def creer_table_diagnostic(df_amdec):
    print("[3/5] Creation table de diagnostic...")
    table = {}

    for capteur, circuits in CAPTEUR_CIRCUITS.items():
        mask   = df_amdec['Circuit'].str.strip().isin([c.strip() for c in circuits])
        subset = df_amdec[mask].copy()

        # Top 5 modes les plus critiques
        top = subset.nlargest(5, 'RPN')

        modes = []
        for _, row in top.iterrows():
            tache    = row['Tache_Maintenance'] if pd.notna(row['Tache_Maintenance']) else 'Inspection visuelle'
            frequence= row['Frequence'] if pd.notna(row['Frequence']) else 'A definir'
            modes.append({
                'composant':  str(row['Composant']).strip(),
                'mode':       str(row['Mode_Defaillance']).strip(),
                'causes':     str(row['Causes']).strip(),
                'effet':      str(row['Effets']).strip(),
                'gravite':    int(row['Gravite']),
                'occurrence': str(row['Occurrence']),
                'rpn':        float(row['RPN']),
                'tache':      str(tache).strip().replace('\n', ' '),
                'frequence':  str(frequence).strip(),
            })

        seuil = SEUILS_ALARME[capteur]
        table[capteur] = {
            'seuil_alarme': seuil,
            'circuits_amdec': [c.strip().replace('\n', ' ') for c in circuits],
            'nb_modes_total': int(len(subset)),
            'modes_critiques_g1': int((subset['Gravite'] == 1).sum()),
            'rpn_moyen': round(float(subset['RPN'].mean()), 2) if len(subset) else 0,
            'top_modes': modes,
        }
        print(f"  {capteur}: {len(subset)} modes | {(subset['Gravite']==1).sum()} critiques (G1)")

    return table


# ─────────────────────────────────────────────────────────────
# 4. PIPELINE CAPTEURS + MODELE
# ─────────────────────────────────────────────────────────────
def load_capteurs():
    dfs = []
    for f in sorted(os.listdir(CAPTEUR_DIR)):
        if not f.endswith('.xlsx'):
            continue
        path = os.path.join(CAPTEUR_DIR, f)
        try:
            df = pd.read_excel(path, header=8)
            df.columns = ['Engin','Parametre','Code','Heure','Val_min','Val_moy','Val_max','Unite','Capteur_OK']
            df['Heure']   = pd.to_datetime(df['Heure'], errors='coerce')
            df['Val_moy'] = pd.to_numeric(df['Val_moy'], errors='coerce')
            df = df[df['Heure'].notna() & df['Val_moy'].notna() & df['Parametre'].notna()]
            df['Param_short'] = df['Parametre'].str.strip().map(SIX_PARAMS)
            df = df[df['Param_short'].notna()]
            dfs.append(df[['Heure', 'Param_short', 'Val_moy']])
        except: pass

    df_all = pd.concat(dfs, ignore_index=True)
    df_all = df_all.drop_duplicates(subset=['Heure', 'Param_short']).sort_values('Heure')
    df_ts  = (df_all.pivot(index='Heure', columns='Param_short', values='Val_moy')
                    .rename_axis(None, axis=1))
    df_ts  = df_ts.resample('5min').mean().interpolate(method='time', limit=6).dropna()
    return df_ts


def feature_engineering(df_ts):
    fe = pd.DataFrame(index=df_ts.index)
    for col in df_ts.columns:
        fe[col] = df_ts[col]
        for w in ['15min', '1h', '4h', '12h']:
            fe[f'{col}_mean_{w}'] = df_ts[col].rolling(w).mean()
            fe[f'{col}_std_{w}']  = df_ts[col].rolling(w).std()
        fe[f'{col}_diff_1h']  = df_ts[col].diff(12)
        fe[f'{col}_mean_24h'] = df_ts[col].rolling('24h').mean()
        fe[f'{col}_dev_24h']  = df_ts[col] - fe[f'{col}_mean_24h']
        s = SEUILS_ALARME[col]
        fe[f'{col}_dist_norm'] = (df_ts[col] - s*0.7) / (s*0.3) if col != 'P_Huile' else (s - df_ts[col]) / s
    fe['delta_echap']    = (df_ts['T_Echap_D'] - df_ts['T_Echap_G']).abs()
    fe['T_echap_moy']    = (df_ts['T_Echap_D'] + df_ts['T_Echap_G']) / 2
    fe['ratio_P_Regime'] = df_ts['P_Huile'] / df_ts['Regime'].clip(lower=100)
    fe['corr_echap']     = df_ts['T_Echap_D'].rolling('1h').corr(df_ts['T_Echap_G'])
    fe['heure_sin']      = np.sin(2 * np.pi * df_ts.index.hour / 24)
    fe['heure_cos']      = np.cos(2 * np.pi * df_ts.index.hour / 24)
    return fe.dropna()


def compute_health_index(df_ts, poids_amdec):
    scores = pd.DataFrame(index=df_ts.index)
    for col in df_ts.columns:
        s     = SEUILS_ALARME[col]
        crit  = poids_amdec.get(col, 1.0)
        if col == 'P_Huile':
            p_nom = 3 * s
            ratio = (df_ts[col] - s) / (p_nom - s)
        else:
            p_nom = 0.60 * s
            ratio = 1.0 - (df_ts[col] - p_nom) / (s - p_nom)
        scores[col] = ratio.clip(0, 1) * 100 * crit
    total_w = sum(poids_amdec.get(c, 1.0) for c in df_ts.columns)
    return (scores.sum(axis=1) / total_w).rolling('1h', min_periods=1).mean().clip(0, 100)


def train_isolation_forest(fe):
    scaler = StandardScaler()
    X_sc   = scaler.fit_transform(fe.values)
    n_tr   = int(len(X_sc) * 0.70)
    iso    = IsolationForest(n_estimators=300, contamination=0.03,
                              max_features=0.8, random_state=42, n_jobs=-1)
    iso.fit(X_sc[:n_tr])
    raw    = -iso.score_samples(X_sc)
    vmin, vmax = np.quantile(raw, 0.01), np.quantile(raw, 0.99)
    score  = pd.Series(((raw - vmin) / (vmax - vmin)).clip(0, 1) * 100, index=fe.index)
    thr    = float(score.quantile(0.97))
    return iso, scaler, score, thr


# ─────────────────────────────────────────────────────────────
# 5. SAUVEGARDE MODELE + METADATA JSON
# ─────────────────────────────────────────────────────────────
def sauvegarder_modele(iso, scaler, feature_names, poids_amdec,
                       table_diagnostic, rpn_details, health, anomaly_score,
                       threshold_iso, df_ts):
    print("[4/5] Sauvegarde du modele...")

    # Modele sklearn
    joblib.dump({'model': iso, 'scaler': scaler, 'features': feature_names},
                os.path.join(MODEL_DIR, 'isolation_forest_994F1.joblib'))

    # Statistiques des capteurs (pour normalisation en temps reel)
    stats_capteurs = {}
    for col in df_ts.columns:
        stats_capteurs[col] = {
            'mean': round(float(df_ts[col].mean()), 2),
            'std':  round(float(df_ts[col].std()), 2),
            'p5':   round(float(df_ts[col].quantile(0.05)), 2),
            'p95':  round(float(df_ts[col].quantile(0.95)), 2),
            'min':  round(float(df_ts[col].min()), 2),
            'max':  round(float(df_ts[col].max()), 2),
            'seuil_alarme': SEUILS_ALARME[col],
        }

    # Metadata completes
    metadata = {
        'modele':        'IsolationForest',
        'version':       '1.0',
        'date_entrainement': pd.Timestamp.now().strftime('%Y-%m-%d'),
        'periode_data':  '2025-01-01 / 2025-12-01',
        'nb_features':   len(feature_names),
        'capteurs':      list(df_ts.columns),
        'seuils_alarme': SEUILS_ALARME,
        'poids_amdec':   {k: round(v, 4) for k, v in poids_amdec.items()},
        'rpn_details':   rpn_details,
        'threshold_anomaly': round(threshold_iso, 2),
        'stats_capteurs':stats_capteurs,
        'health_index': {
            'moyenne_annuelle': round(float(health.mean()), 2),
            'pct_bon':          round(float((health >= 80).mean() * 100), 1),
            'pct_attention':    round(float(((health >= 60) & (health < 80)).mean() * 100), 1),
            'pct_alerte':       round(float((health < 60).mean() * 100), 1),
        },
        'table_diagnostic': table_diagnostic,
    }

    meta_path = os.path.join(MODEL_DIR, 'maintenance_metadata_994F1.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    # Copier aussi dans l'app backend
    app_meta_path = os.path.join(BASE_DIR, 'app', 'maintenance_metadata_994F1.json')
    with open(app_meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"  Modele : {MODEL_DIR}/isolation_forest_994F1.joblib")
    print(f"  Meta   : {MODEL_DIR}/maintenance_metadata_994F1.json")
    print(f"  Meta   : app/maintenance_metadata_994F1.json")
    return metadata


# ─────────────────────────────────────────────────────────────
# 6. GRAPHIQUE AMDEC - RPN PAR CAPTEUR
# ─────────────────────────────────────────────────────────────
def graphique_amdec(df_amdec, poids_amdec, rpn_details, table_diagnostic):
    print("[5/5] Graphiques AMDEC...")

    # G1 : RPN par capteur
    fig, axes = plt.subplots(1, 2, figsize=(16, 6))
    capteurs  = list(rpn_details.keys())
    rpn_moys  = [rpn_details[c]['rpn_moy'] for c in capteurs]
    nb_crit   = [rpn_details[c]['modes_critiques'] for c in capteurs]
    colors    = ['#E53935' if r > 4 else '#FF9800' if r > 2 else '#4CAF50' for r in rpn_moys]

    axes[0].barh(capteurs, rpn_moys, color=colors, edgecolor='black', alpha=0.85)
    axes[0].axvline(4, color='red', ls='--', lw=1.2, label='Seuil critique RPN=4')
    axes[0].set_title('RPN Moyen par Capteur (AMDEC)\nRouge=Critique | Orange=Majeur | Vert=Mineur',
                      fontsize=11, fontweight='bold')
    axes[0].set_xlabel('RPN moyen (Gravite x Occurrence)')
    axes[0].legend()
    for i, (r, n) in enumerate(zip(rpn_moys, nb_crit)):
        axes[0].text(r + 0.05, i, f'  {n} modes G1', va='center', fontsize=8)

    # G2 : Nb modes par gravite par circuit
    rpn_circ = df_amdec.groupby('Circuit')['RPN'].mean().sort_values(ascending=True)
    rpn_circ.index = [str(i).replace('\n', ' ')[:30] for i in rpn_circ.index]
    colors2 = ['#E53935' if v > 4 else '#FF9800' if v > 3 else '#4CAF50' for v in rpn_circ.values]
    axes[1].barh(rpn_circ.index, rpn_circ.values, color=colors2, edgecolor='black', alpha=0.85)
    axes[1].axvline(4, color='red', ls='--', lw=1.2)
    axes[1].set_title('RPN Moyen par Circuit AMDEC\n(tous les circuits)', fontsize=11, fontweight='bold')
    axes[1].set_xlabel('RPN moyen')

    plt.suptitle('Analyse AMDEC - Criticite des Circuits - Chargeuse 994F1 OCP Benguerir',
                 fontsize=13, fontweight='bold')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, '9_amdec_rpn.png'), dpi=150)
    plt.close()

    # G2 : Heatmap Composant x Gravite pour les 6 capteurs
    rows = []
    for capteur, data in table_diagnostic.items():
        for m in data['top_modes']:
            rows.append({
                'capteur': capteur,
                'composant': m['composant'][:25],
                'gravite': m['gravite'],
                'rpn': m['rpn'],
            })
    if rows:
        df_hm = pd.DataFrame(rows)
        pivot  = df_hm.pivot_table(values='rpn', index='composant',
                                   columns='capteur', aggfunc='max').fillna(0)
        fig, ax = plt.subplots(figsize=(14, max(6, len(pivot)*0.4 + 2)))
        sns.heatmap(pivot, cmap='YlOrRd', annot=True, fmt='.0f',
                    linewidths=0.5, ax=ax, cbar_kws={'label': 'RPN'})
        ax.set_title('Heatmap RPN : Composants AMDEC vs Capteurs\n'
                     'Rouge=Critique | Jaune=Modere', fontsize=12, fontweight='bold')
        plt.tight_layout()
        plt.savefig(os.path.join(OUTPUT_DIR, '10_amdec_heatmap.png'), dpi=150)
        plt.close()

    print("  G9 : RPN par capteur | G10 : Heatmap AMDEC")


# ─────────────────────────────────────────────────────────────
# 7. RAPPORT ENRICHI
# ─────────────────────────────────────────────────────────────
def generer_rapport_enrichi(metadata, table_diagnostic, df_ts, health, anomaly_score, threshold_iso):
    path = os.path.join(OUTPUT_DIR, 'RAPPORT_AMDEC_COMPLET.txt')
    health_s = health.rolling('4h', min_periods=1).mean()

    with open(path, 'w', encoding='utf-8') as f:
        f.write("=" * 72 + "\n")
        f.write("  RAPPORT DE MAINTENANCE PREDICTIVE AVEC INTEGRATION AMDEC\n")
        f.write("  Chargeuse CAT 994F1 - OCP Benguerir\n")
        f.write(f"  Genere le : {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}\n")
        f.write("=" * 72 + "\n\n")

        f.write("1. ETAT DE LA MACHINE\n")
        f.write("-" * 40 + "\n")
        hi = metadata['health_index']
        f.write(f"   Health Index moyen    : {hi['moyenne_annuelle']:.1f} / 100\n")
        f.write(f"   % temps Bon (>80)     : {hi['pct_bon']}%\n")
        f.write(f"   % temps Attention     : {hi['pct_attention']}%\n")
        f.write(f"   % temps Alerte (<60)  : {hi['pct_alerte']}%\n")
        f.write(f"   Seuil anomalie        : {threshold_iso:.1f} / 100\n\n")

        f.write("2. STATISTIQUES DES 6 CAPTEURS\n")
        f.write("-" * 40 + "\n")
        for col, s in metadata['stats_capteurs'].items():
            pct_proche = 0
            if col in df_ts.columns:
                if col == 'P_Huile':
                    pct_proche = (df_ts[col] < s['seuil_alarme'] * 1.5).mean() * 100
                else:
                    pct_proche = (df_ts[col] > s['seuil_alarme'] * 0.85).mean() * 100
            f.write(f"   {col:<22} : moy={s['mean']:>7.1f}  max={s['max']:>7.1f}"
                    f"  seuil={s['seuil_alarme']}  proche_seuil={pct_proche:.1f}%\n")
        f.write("\n")

        f.write("3. ANALYSE AMDEC - CRITICITE PAR CAPTEUR\n")
        f.write("-" * 40 + "\n")
        for capteur, rpn in metadata['rpn_details'].items():
            poids = metadata['poids_amdec'].get(capteur, 1.0)
            f.write(f"\n   [{capteur}]  RPN_moy={rpn['rpn_moy']}  "
                    f"modes={rpn['nb_modes']}  critiques(G1)={rpn['modes_critiques']}  "
                    f"poids_health={poids:.3f}\n")

        f.write("\n4. TABLE DE DIAGNOSTIC - ALERTES ET ACTIONS\n")
        f.write("-" * 40 + "\n")
        f.write("   (Quand un capteur depasse son seuil, consulter ce tableau)\n\n")

        for capteur, data in table_diagnostic.items():
            seuil = data['seuil_alarme']
            unite = 'kPa' if 'Huile' in capteur or 'P_' in capteur else ('tr/min' if 'Regime' in capteur else 'deg C')
            f.write(f"\n   *** ALERTE {capteur} (seuil = {seuil} {unite}) ***\n")
            f.write(f"   Circuits AMDEC : {', '.join(data['circuits_amdec'])}\n")
            f.write(f"   Modes totaux   : {data['nb_modes_total']}  |  Critiques G1 : {data['modes_critiques_g1']}\n")
            f.write("   Top modes de defaillance :\n")
            for i, m in enumerate(data['top_modes'], 1):
                f.write(f"     {i}. [{m['composant']}] {m['mode']}\n")
                f.write(f"        Cause  : {m['causes']}\n")
                f.write(f"        Effet  : {m['effet']}\n")
                f.write(f"        RPN={m['rpn']:.0f} (G={m['gravite']} O={m['occurrence']})\n")
                f.write(f"        Action : {m['tache']}  |  Freq : {m['frequence']}\n")

        f.write("\n5. RECOMMANDATIONS FINALES\n")
        f.write("-" * 40 + "\n")
        hi_val = hi['moyenne_annuelle']
        if hi_val >= 85:
            f.write("   ETAT GENERAL : EXCELLENT - Continuer le plan de maintenance actuel\n")
        elif hi_val >= 70:
            f.write("   ETAT GENERAL : BON - Surveiller T_Convert (max=127 proche du seuil 129)\n")
            f.write("   PRIORITE     : Inspection Convertisseur de couple + Lubrification\n")
        else:
            f.write("   ETAT GENERAL : ATTENTION - Reviser le plan de maintenance\n")

        f.write("   POINTS D'ATTENTION IDENTIFIES :\n")
        for col, s in metadata['stats_capteurs'].items():
            if col == 'T_Echap_G' and s['max'] > s['seuil_alarme']:
                f.write(f"   !! {col} max={s['max']} > seuil={s['seuil_alarme']} => verifier turbocompresseur\n")
            if col == 'T_Refroid' and s['max'] > s['seuil_alarme']:
                f.write(f"   !! {col} max={s['max']} > seuil={s['seuil_alarme']} => verifier circuit refroidissement\n")
            if col == 'T_Convert' and s['max'] > s['seuil_alarme'] * 0.97:
                f.write(f"   !! {col} max={s['max']} tres proche du seuil {s['seuil_alarme']} => surveiller transmission\n")

    print(f"  Rapport enrichi : RAPPORT_AMDEC_COMPLET.txt")
    return path


# ─────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 65)
    print("  INTEGRATION AMDEC - CAT 994F1 - OCP BENGUERIR")
    print("=" * 65)

    df_amdec         = parse_amdec()
    poids_amdec, rpn = calculer_poids_amdec(df_amdec)
    table_diag       = creer_table_diagnostic(df_amdec)

    print("\n[3/5] Pipeline capteurs + modele...")
    df_ts            = load_capteurs()
    fe               = feature_engineering(df_ts)
    health           = compute_health_index(df_ts, poids_amdec)
    health_aligned   = health.reindex(fe.index, method='nearest')
    iso, scaler, anomaly_score, threshold_iso = train_isolation_forest(fe)

    metadata = sauvegarder_modele(iso, scaler, fe.columns.tolist(), poids_amdec,
                                   table_diag, rpn, health_aligned, anomaly_score,
                                   threshold_iso, df_ts)

    graphique_amdec(df_amdec, poids_amdec, rpn, table_diag)
    generer_rapport_enrichi(metadata, table_diag, df_ts, health_aligned,
                             anomaly_score, threshold_iso)

    print("\n" + "=" * 65)
    print("  INTEGRATION AMDEC TERMINEE")
    print("=" * 65)
    print(f"  Health Index moyen     : {metadata['health_index']['moyenne_annuelle']} / 100")
    print(f"  Poids AMDEC            : {metadata['poids_amdec']}")
    print(f"  Modele joblib          : models/isolation_forest_994F1.joblib")
    print(f"  Metadata JSON          : app/maintenance_metadata_994F1.json")
    print(f"  Rapport enrichi        : resultats_ML/predictive_final/RAPPORT_AMDEC_COMPLET.txt")
