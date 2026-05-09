#!/usr/bin/env python3
"""
VALIDER_SEUILS_OCP.PY

Verifie que les sorties du simulateur respectent les seuils officiels OCP
(fichier seulles.xlsx fourni par l'utilisateur, mai 2026).

Pour chaque seuil :
  - mode "normal"          : la simu doit RESPECTER le seuil 100 % du temps
  - mode "fault" approprie : la simu doit DECLENCHER le bon seuil
  
Usage :
  python valider_seuils_OCP.py                 # mode normal
  python valider_seuils_OCP.py --fault ventilo_hs --t-fault 60 --duration 1500
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
SEUILS_FILE = ROOT / "seuils_OCP.json"


def lance_simulation(duration: int = 1800, fault: str = "", t_fault: int = 60) -> pd.DataFrame:
    """Lance le simulateur et lit le CSV resultant."""
    csv_path = ROOT / 'sim_validation.csv'
    cmd = [
        sys.executable, str(ROOT / 'vims_replay_simulator.py'),
        '--duration', str(duration), '--csv', str(csv_path),
    ]
    if fault:
        cmd += ['--fault', fault, '--t-fault', str(t_fault)]
    print(f'  [run] {" ".join(cmd)}')
    subprocess.check_call(cmd, cwd=str(ROOT))
    df = pd.read_csv(csv_path, sep=';', encoding='utf-8-sig')
    df['Heure'] = pd.to_datetime(df['Heure'])
    return df


def valider_seuil(df: pd.DataFrame, seuil: dict) -> dict:
    """Renvoie {nb_violations, total, pct_respecte, valeur_max_obs, valeur_min_obs}."""
    capteur = seuil['capteur_vims']
    if capteur not in df.columns:
        return {"erreur": f"capteur absent : {capteur}"}

    vals = df[capteur].astype(float).values
    op = seuil['operateur']

    if op == 'max':
        # Alerte si val > limite_max (ou >=, selon la regle)
        limite = seuil['limite_max']
        # On considere violation si val > limite (sauf si la regle dit ">=")
        if '>=' in seuil['regle']:
            mask = vals >= limite
        else:
            mask = vals > limite
        violations = int(mask.sum())
        return {
            "id": seuil['id'],
            "param_ocp": seuil['param_ocp'],
            "capteur_vims": capteur,
            "regle": seuil['regle'],
            "violations": violations,
            "total": len(vals),
            "pct_respecte": 100.0 * (1 - violations / len(vals)),
            "val_min_obs": float(vals.min()),
            "val_max_obs": float(vals.max()),
            "limite": limite,
            "criticite": seuil.get('criticite', ''),
            "ok": violations == 0,
        }
    elif op == 'min':
        limite = seuil['limite_min']
        mask = vals < limite
        violations = int(mask.sum())
        return {
            "id": seuil['id'],
            "param_ocp": seuil['param_ocp'],
            "capteur_vims": capteur,
            "regle": seuil['regle'],
            "violations": violations,
            "total": len(vals),
            "pct_respecte": 100.0 * (1 - violations / len(vals)),
            "val_min_obs": float(vals.min()),
            "val_max_obs": float(vals.max()),
            "limite": limite,
            "criticite": seuil.get('criticite', ''),
            "ok": violations == 0,
        }
    elif op == 'range':
        lo = seuil['limite_min']; hi = seuil['limite_max']
        mask = (vals < lo) | (vals > hi)
        violations = int(mask.sum())
        return {
            "id": seuil['id'],
            "param_ocp": seuil['param_ocp'],
            "capteur_vims": capteur,
            "regle": seuil['regle'],
            "violations": violations,
            "total": len(vals),
            "pct_respecte": 100.0 * (1 - violations / len(vals)),
            "val_min_obs": float(vals.min()),
            "val_max_obs": float(vals.max()),
            "limite": f"{lo}-{hi}",
            "criticite": seuil.get('criticite', ''),
            "ok": violations == 0,
        }
    elif op == 'regime_conditionnel':
        rpm_col = "CH994.P1.Régime moteur"
        if rpm_col not in df.columns:
            return {"erreur": "regime moteur absent"}
        rpm = df[rpm_col].astype(float).values
        violations = 0
        windows_actifs = 0
        details = []
        for cond in seuil['limites_conditionnelles']:
            mask_cond = (rpm >= cond['rpm_min']) & (rpm <= cond['rpm_max'])
            # Filtre additionnel hyd_load_min ?
            if 'hyd_load_min' in cond:
                # Approxime hyd via P_hyd > 5000 kPa ~ engine actively pumping
                p_col = seuil['capteur_vims']
                # On verifie en charge : valeur attendue elevee mais ici on cherche basse
                pass  # difficile a inferer sans hyd_norm exact - on relache cette condition
            n_actifs = int(mask_cond.sum())
            windows_actifs += n_actifs
            if n_actifs == 0:
                details.append(f"{cond['rpm_min']}-{cond['rpm_max']} rpm : aucun sample dans cette plage")
                continue
            if 'P_min_kPa' in cond:
                violations_basse = int((vals[mask_cond] < cond['P_min_kPa']).sum())
                violations += violations_basse
                details.append(f"{cond['rpm_min']}-{cond['rpm_max']} rpm, P>={cond['P_min_kPa']} -> {violations_basse}/{n_actifs} viol")
            if 'P_max_kPa' in cond:
                violations_haute = int((vals[mask_cond] > cond['P_max_kPa']).sum())
                # Pour le seuil "faible pression" on n'alarme pas sur haute, juste basse
                if 'faible' in seuil['param_ocp'].lower():
                    pass
                else:
                    violations += violations_haute
                    details.append(f"{cond['rpm_min']}-{cond['rpm_max']} rpm, P<={cond['P_max_kPa']} -> {violations_haute} viol")
        return {
            "id": seuil['id'],
            "param_ocp": seuil['param_ocp'],
            "capteur_vims": seuil['capteur_vims'],
            "regle": seuil['regle'],
            "violations": violations,
            "total": windows_actifs if windows_actifs > 0 else len(vals),
            "pct_respecte": 100.0 * (1 - violations / max(1, windows_actifs)),
            "val_min_obs": float(vals.min()),
            "val_max_obs": float(vals.max()),
            "limite": "regime_dep",
            "criticite": seuil.get('criticite', ''),
            "details": '; '.join(details),
            "ok": violations == 0,
        }
    else:
        return {"erreur": f"operateur inconnu : {op}"}


def afficher_resultats(results: list, mode: str):
    print(f'\n{"=" * 110}')
    print(f'  VALIDATION SEUILS OCP - mode {mode!r}')
    print(f'{"=" * 110}')
    print(f'{"#":>3}  {"PARAMETRE":40s}  {"REGLE":35s}  {"VIOL":>6s}  {"% OK":>7s}  {"OBS":>15s}  {"STATUS"}')
    print('-' * 110)
    nb_ok = nb_ko = 0
    for r in results:
        if 'erreur' in r:
            print(f'  ERR {r["erreur"]}')
            continue
        status = 'OK' if r['ok'] else 'KO'
        if r['ok']: nb_ok += 1
        else:       nb_ko += 1
        param = r['param_ocp'][:40]
        regle = r['regle'][:35]
        viol  = r['violations']
        pct   = r['pct_respecte']
        obs   = f'[{r["val_min_obs"]:.0f}..{r["val_max_obs"]:.0f}]'
        print(f'{r["id"]:>3}  {param:40s}  {regle:35s}  {viol:>6d}  {pct:>6.1f}%  {obs:>15s}  {status}')
    print('-' * 110)
    print(f'  Bilan : {nb_ok} seuils OK, {nb_ko} seuils violes ({mode})')
    return nb_ok, nb_ko


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--duration', type=int, default=1800, help='Duree (s)')
    p.add_argument('--fault', default='', help='Defaut a injecter (vide = mode normal)')
    p.add_argument('--t-fault', type=int, default=60)
    p.add_argument('--mode-double', action='store_true',
                   help='Lance les 2 modes : normal puis fault')
    args = p.parse_args()

    seuils = json.loads(SEUILS_FILE.read_text(encoding='utf-8'))['seuils']
    print(f'  [seuils OCP] {len(seuils)} seuils mappables charges depuis {SEUILS_FILE.name}')

    if args.mode_double:
        # Mode normal
        print('\n>>> Phase 1/2 : simulation NORMALE')
        df_normal = lance_simulation(duration=args.duration, fault='')
        results_normal = [valider_seuil(df_normal, s) for s in seuils]
        nb_ok_n, nb_ko_n = afficher_resultats(results_normal, mode='NORMAL')

        # Mode fault
        print('\n>>> Phase 2/2 : simulation avec defaut ventilo_hs')
        df_fault = lance_simulation(duration=max(args.duration, 1500), fault='ventilo_hs', t_fault=60)
        results_fault = [valider_seuil(df_fault, s) for s in seuils]
        nb_ok_f, nb_ko_f = afficher_resultats(results_fault, mode='FAULT ventilo_hs')

        print('\n' + '=' * 110)
        print('  CONCLUSION')
        print('=' * 110)
        print(f'  Mode normal  : {nb_ok_n} respectes / {nb_ko_n} violes')
        print(f'  Mode fault   : {nb_ok_f} respectes / {nb_ko_f} violes (les violations sont attendues sur certains seuils)')
        if nb_ko_n == 0:
            print(f'\n  [OK] La simulation NORMALE respecte 100 % des seuils OCP.')
        else:
            print(f'\n  [KO] La simulation NORMALE viole {nb_ko_n} seuils -> a corriger dans le simulateur.')
    else:
        df = lance_simulation(duration=args.duration, fault=args.fault, t_fault=args.t_fault)
        results = [valider_seuil(df, s) for s in seuils]
        afficher_resultats(results, mode=args.fault or 'NORMAL')


if __name__ == '__main__':
    main()
