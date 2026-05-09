#!/usr/bin/env python3
"""
Compare la sortie du simulateur VIMS_REPLAY aux fichiers VIMS reels de l'utilisateur.

Genere un rapport en 4 panneaux :
  - Distribution des valeurs (min/avg/max) par capteur, reel vs simu
  - Quelques courbes temporelles
  - Tableau de coherence (z-score / chevauchement de plages)

Usage :
  python comparer_avec_vims_reel.py
"""
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent

REAL_FILES = [
    Path('/home/ubuntu/attachments/f0a956c0-db28-4da7-8aba-ea1f53478008/Paramètres+Diagnostique_260310_115714.xlsx'),
    Path('/home/ubuntu/attachments/427b7281-3b50-422a-bc7b-e16c9f049a3f/Paramètres+Diagnostique_260310_121453.xlsx'),
]

# Liste des 8 capteurs principaux a tracer
KEY = [
    "CH994.P1.Régime moteur",
    "CH994.P1.Pression huile moteur",
    "CH994.P1.Température liquide refroidissement",
    "CH994.P1.Température sortie convertisseur",
    "CH994.P1.Température échappement Droit",
    "CH994.P2.Pression pompe hydraulique principale",
    "CH994.P2.Pression d\u2019air au réservoir",
    "CH994.P2.Tension électrique de système",
]


def load_real() -> pd.DataFrame:
    dfs = []
    for f in REAL_FILES:
        df = pd.read_excel(f, header=8)
        dfs.append(df)
    df = pd.concat(dfs, ignore_index=True)
    return df


def load_sim() -> pd.DataFrame:
    """Lance le simulateur 30 min et lit la sortie."""
    import subprocess
    csv_path = ROOT / 'sim_output_for_compare.csv'
    cmd = [
        'python', str(ROOT / 'vims_replay_simulator.py'),
        '--duration', '1800', '--csv', str(csv_path),
    ]
    print('  [...] lancement simu 30 min...')
    subprocess.check_call(cmd, cwd=str(ROOT))
    df = pd.read_csv(csv_path, sep=';', encoding='utf-8-sig')
    df['Heure'] = pd.to_datetime(df['Heure'])
    return df


def plot_compare(real_df: pd.DataFrame, sim_df: pd.DataFrame, out_png: Path):
    fig, axes = plt.subplots(4, 2, figsize=(14, 10))
    axes = axes.flatten()
    for ax, name in zip(axes, KEY):
        # Reel : on prend valeur moyenne
        sub = real_df[real_df['Paramètres Diagnostic'] == name]
        if sub.empty:
            ax.text(0.5, 0.5, f'(absent du reel)\n{name}',
                    transform=ax.transAxes, ha='center')
            continue
        real_vals = sub['Valeur moyenne'].astype(float).dropna().values
        sim_vals  = sim_df[name].astype(float).values

        ax.hist(real_vals, bins=30, color='#1f77b4', alpha=0.6, label='reel VIMS', density=True)
        ax.hist(sim_vals,  bins=30, color='#ff7f0e', alpha=0.5, label='simulateur', density=True)
        # Indicateurs
        rmean, rstd = real_vals.mean(), real_vals.std()
        smean, sstd = sim_vals.mean(),  sim_vals.std()
        delta = abs(rmean - smean) / (rstd + 1e-9)
        ax.set_title(f'{name.split(".")[-1]}\n'
                     f'real µ={rmean:.0f}±{rstd:.0f}  sim µ={smean:.0f}±{sstd:.0f}  '
                     f'Δ={delta:.2f}σ',
                     fontsize=9)
        ax.legend(fontsize=7)
        ax.grid(True, alpha=0.3)
    fig.suptitle('Comparaison VIMS reel vs simulateur (994 F1, distributions)',
                 fontsize=12, fontweight='bold')
    fig.tight_layout()
    fig.savefig(out_png, dpi=140)
    print(f'[ok] figure -> {out_png}')


def main():
    real_df = load_real()
    print(f'  reel : {len(real_df)} echantillons VIMS')
    sim_df = load_sim()
    print(f'  simu : {len(sim_df)} echantillons')

    out_dir = ROOT / 'figures_comparaison'
    out_dir.mkdir(exist_ok=True)
    plot_compare(real_df, sim_df, out_dir / 'comparaison_reel_vs_simu.png')

    # Tableau de synthese
    print('\n' + '=' * 90)
    print(f'{"Capteur":50s}  {"reel (mean±std)":18s}  {"sim (mean±std)":18s}  {"unite":7s}')
    print('-' * 90)
    for name in KEY:
        sub = real_df[real_df['Paramètres Diagnostic'] == name]
        if sub.empty:
            continue
        unite = sub['Unité de mesure'].dropna().iloc[0] if not sub['Unité de mesure'].dropna().empty else ''
        rmean = sub['Valeur moyenne'].mean()
        rstd  = sub['Valeur moyenne'].std()
        smean = sim_df[name].mean()
        sstd  = sim_df[name].std()
        print(f'{name[-50:]:50s}  {rmean:7.0f} ± {rstd:6.0f}   {smean:7.0f} ± {sstd:6.0f}  {unite:7s}')


if __name__ == '__main__':
    main()
