#!/usr/bin/env python3
"""Plot demo : courbes des 8 capteurs principaux pendant un defaut ventilo HS."""
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent


def main():
    df = pd.read_csv(ROOT / 'ventilo_hs_demo.csv', sep=';', encoding='utf-8-sig')
    df['Heure'] = pd.to_datetime(df['Heure'])
    t = (df['Heure'] - df['Heure'].iloc[0]).dt.total_seconds().values

    fig, axes = plt.subplots(4, 2, figsize=(13, 10), sharex=True)
    plots = [
        ('CH994.P1.Régime moteur', 'Tr/min', None),
        ('CH994.P1.Pression huile moteur', 'kPa', None),
        ('CH994.P1.Température liquide refroidissement', '°C', [85.5, 95]),
        ('CH994.P1.Température sortie convertisseur', '°C', None),
        ('CH994.P1.Température échappement Droit', '°C', None),
        ('CH994.P2.Pression pompe hydraulique principale', 'kPa', [25200, 28000]),
        ('CH994.P2.Pression d\u2019air au réservoir', 'kPa', None),
        ('CH994.P2.Tension électrique de système', 'mV', None),
    ]

    for ax, (col, unite, seuils) in zip(axes.flatten(), plots):
        ax.plot(t, df[col].values, color='#1f77b4', linewidth=0.8)
        if seuils:
            ax.axhline(seuils[0], color='orange', linestyle='--',
                       linewidth=1, label=f'attention {seuils[0]}')
            ax.axhline(seuils[1], color='red',    linestyle='--',
                       linewidth=1, label=f'alerte    {seuils[1]}')
            ax.legend(fontsize=7, loc='upper left')
        ax.axvline(60, color='gray', linestyle=':', linewidth=1)
        ax.set_title(f'{col.split(".")[-1]} ({unite})', fontsize=9)
        ax.grid(True, alpha=0.3)
        ax.set_xlim(0, t[-1])

    for ax in axes[-1, :]:
        ax.set_xlabel('temps (s)')

    fig.suptitle('VIMS Replay - defaut "ventilo HS" injecte a t=60s (994 F1)\n'
                 'Les 8 capteurs principaux sont enregistres ; T_eau franchit le seuil 95°C vers t=720s',
                 fontsize=11, fontweight='bold')
    fig.tight_layout()
    out = ROOT / 'figures_comparaison' / 'demo_fault_ventilo_hs.png'
    out.parent.mkdir(exist_ok=True)
    fig.savefig(out, dpi=140)
    print(f'[ok] figure -> {out}')


if __name__ == '__main__':
    main()
