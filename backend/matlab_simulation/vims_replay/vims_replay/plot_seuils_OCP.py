#!/usr/bin/env python3
"""
PLOT_SEUILS_OCP.PY

Genere une figure montrant la simulation et les seuils OCP officiels
superposes en lignes pointillees rouges. Permet de verifier visuellement
que la simulation respecte les seuils.
"""
import json
import subprocess
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent

# Lance simu 30 min mode normal
csv_path = ROOT / 'sim_seuils_normal.csv'
subprocess.check_call([
    sys.executable, str(ROOT / 'vims_replay_simulator.py'),
    '--duration', '1800', '--csv', str(csv_path),
], cwd=str(ROOT))

df_normal = pd.read_csv(csv_path, sep=';', encoding='utf-8-sig')
df_normal['t'] = np.arange(len(df_normal))

# Lance simu fault fuite_huile
csv_fault = ROOT / 'sim_seuils_fuite.csv'
subprocess.check_call([
    sys.executable, str(ROOT / 'vims_replay_simulator.py'),
    '--duration', '1500', '--fault', 'fuite_huile', '--t-fault', '60',
    '--csv', str(csv_fault),
], cwd=str(ROOT))
df_fault = pd.read_csv(csv_fault, sep=';', encoding='utf-8-sig')
df_fault['t'] = np.arange(len(df_fault))

# 8 sous-plots avec seuils OCP
fig, axes = plt.subplots(4, 2, figsize=(14, 12), sharex=False)
plt.style.use('default')

panels = [
    {
        'col': "CH994.P1.Régime moteur",
        'title': "Regime moteur",
        'unit': "Tr/min",
        'seuil': 1750, 'seuil_dir': 'max',
        'seuil_label': 'OCP : surregime > 1750',
        'df': df_normal,
    },
    {
        'col': "CH994.P1.Pression huile moteur",
        'title': "Pression huile moteur (defaut fuite_huile)",
        'unit': "kPa",
        'seuil': 140, 'seuil_dir': 'min',
        'seuil_label': 'OCP : >= 140 kPa @ 750 rpm',
        'df': df_fault,
    },
    {
        'col': "CH994.P1.Température liquide refroidissement",
        'title': "Temperature liquide refroidissement",
        'unit': "°C",
        'seuil': 95, 'seuil_dir': 'max',
        'seuil_label': '(Pas dans OCP - seuil interne MineAssist 95)',
        'df': df_normal,
    },
    {
        'col': "CH994.P1.Température sortie convertisseur",
        'title': "Temperature sortie convertisseur",
        'unit': "°C",
        'seuil': 129, 'seuil_dir': 'max',
        'seuil_label': 'OCP : alerte >= 129',
        'df': df_normal,
    },
    {
        'col': "CH994.P1.Température échappement Droit",
        'title': "Temperature echappement droit",
        'unit': "°C",
        'seuil': 600, 'seuil_dir': 'max',
        'seuil_label': 'OCP : alerte > 600',
        'df': df_normal,
    },
    {
        'col': "CH994.P2.Pression pompe hydraulique principale",
        'title': "Pression pompe hydraulique principale",
        'unit': "kPa",
        'seuil': 15000, 'seuil_dir': 'min_conditional',
        'seuil_label': 'OCP : >= 15000 @ rpm > 1500',
        'df': df_normal,
    },
    {
        'col': "CH994.P2.Pression d\u2019air au réservoir",
        'title': "Pression d'air reservoir",
        'unit': "kPa",
        'seuil_lo': 600, 'seuil_hi': 900, 'seuil_dir': 'range',
        'seuil_label': 'OCP : plage [600..900]',
        'df': df_normal,
    },
    {
        'col': "CH994.P2.Pression embrayage impeller",
        'title': "Pression embrayage impeller",
        'unit': "kPa",
        'seuil_lo': 1860, 'seuil_hi': 1870, 'seuil_dir': 'range_cond',
        'seuil_label': 'OCP : [1860..1870] @ rpm >= 1510',
        'df': df_normal,
    },
]

for ax, p in zip(axes.flat, panels):
    df = p['df']
    ax.plot(df['t'], df[p['col']], 'b-', lw=0.8, label='Simu')
    if p['seuil_dir'] == 'max':
        ax.axhline(p['seuil'], color='red', ls='--', lw=1.5,
                   label=p['seuil_label'])
    elif p['seuil_dir'] == 'min':
        ax.axhline(p['seuil'], color='red', ls='--', lw=1.5,
                   label=p['seuil_label'])
    elif p['seuil_dir'] == 'min_conditional':
        ax.axhline(p['seuil'], color='red', ls='--', lw=1.5,
                   label=p['seuil_label'])
    elif p['seuil_dir'] in ('range', 'range_cond'):
        ax.axhspan(p['seuil_lo'], p['seuil_hi'], color='green', alpha=0.1,
                   label=p['seuil_label'])
        ax.axhline(p['seuil_lo'], color='red', ls='--', lw=1.0)
        ax.axhline(p['seuil_hi'], color='red', ls='--', lw=1.0)
    ax.set_title(p['title'], fontsize=11, weight='bold')
    ax.set_xlabel('t (s)', fontsize=9)
    ax.set_ylabel(p['unit'], fontsize=9)
    ax.legend(fontsize=8, loc='upper right')
    ax.grid(True, alpha=0.3)

fig.suptitle("Validation des seuils OCP officiels - simulation 994F1\n"
             "(seuils en pointilles rouges / plage verte = zone normale)",
             fontsize=13, weight='bold')
fig.tight_layout(rect=[0, 0, 1, 0.97])

out = ROOT / 'figures_comparaison' / 'validation_seuils_OCP.png'
out.parent.mkdir(exist_ok=True)
fig.savefig(out, dpi=120, bbox_inches='tight')
print(f'  [ok] figure ecrite : {out}')
