"""
Simulateur temps reel CAT 994F  ->  MineAssist
=================================================

Genere a chaque tick (1 Hz) :
  * Pression pompe hydraulique principale (kPa)
  * Pression huile moteur (kPa)
  * Regime moteur (rpm)
  * Temperature liquide refroidissement (degC)
  * Temperature huile direction (degC)
  * Temperature huile freinage (degC)
  * Temperature huile hydraulique (degC)
  * Temperature PTO avant (degC)
  * Temperature echappement Droit/gauche (degC)
  * Pression d'air au reservoir (kPa)
  * Pression sortie convertisseur (kPa)

et POSTe une snapshot a http://127.0.0.1:8000/sim/ingest.

USAGE :
    python mineassist_live_simulator.py
    python mineassist_live_simulator.py --duration 600 --speed 1.0
    python mineassist_live_simulator.py --fault fuite_hydraulique --t-fault 60
    python mineassist_live_simulator.py --fault ventilo_hs --t-fault 120

OPTIONS :
    --api URL           backend MineAssist (defaut http://127.0.0.1:8000)
    --duration SEC      duree de simulation (defaut 1800 = 30 min)
    --dt SEC            pas d'echantillonnage capteur (defaut 1.0)
    --speed FACTOR      acceleration temps reel (1.0 = vrai temps reel)
    --engin ID          identifiant engin (defaut 994F1)
    --fault NAME        defaut a injecter : fuite_hydraulique | ventilo_hs |
                        radiateur_encrasse | niveau_bas | none
    --t-fault SEC       instant d'injection du defaut
    --csv OUT.csv       enregistrer un CSV en parallele
"""

import argparse
import csv
import math
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

import requests
import numpy as np

# ============================================================
#  PARAMETRES PHYSIQUES (calibres VIMS reel 994F-1, jan+fev 2025)
# ============================================================

# --- Hydraulique (cf. parametres_hydraulique.m, etape 1) ---
Q_NOM         = 1500e-3 / 60.0       # m^3/s (debit nominal cumule 2 pompes, 1500 L/min)
ETA_POMPE     = 0.92
P_MAX         = 28e6                 # 280 bar = soupape decharge
P_MIN         = 0.5e6
A_PISTON      = 0.04                 # m^2
M_CHARGE      = 40000.0              # kg
G             = 9.81
R_CANAL       = 5.0e9                # Pa.s/m^3
C_HYDR        = 1.0e-8               # m^3/Pa
B_FROT        = 1.5e6                # N.s/m
K_BUTEE       = 1.0e7                # raideur butee
C_BUTEE       = 5.0e5                # amortissement butee
X_MAX         = 0.6                  # m

# --- Thermique (cf. parametres_thermique.m, etape 2) ---
P_MOT_MAX     = 820e3                # W (3516B)
ETA_THERMO    = 0.40
FRAC_COOLANT  = 0.55
RPM_IDLE      = 750
RPM_MAX       = 1900
C_BLOCK       = 2.3e6                # J/K
C_COOLANT     = 0.875e6              # J/K
U_BC          = 5e4                  # W/K
U_RAD_ON      = 1.2e4                # W/K
U_RAD_OFF     = 1.5e3
T_FAN_ON      = 85.0
T_FAN_OFF     = 82.0
T_AMB         = 35.0                 # Benguerir

# Conditions initiales
T_BLOCK_0     = 90.0
T_COOLANT_0   = 83.0

# Bruit capteur
SIGMA_T       = 0.5                  # degC
SIGMA_P       = 200.0                # kPa
SIGMA_RPM     = 5.0


# ============================================================
#  CYCLE D'EXPLOITATION (60 s, calage VIMS)
# ============================================================

def cmd_hydraulique(t: float) -> float:
    """Commande operateur (-1..+1) pour le verin."""
    tau = t % 60.0
    if tau < 10:    return 0.2     # approche / penetration
    if tau < 25:    return 1.0     # levage a fond
    if tau < 40:    return 0.0     # maintien haut
    if tau < 55:    return -1.0    # vidage / descente
    return 0.0                     # retour position basse


def cycle_phase(t: float) -> str:
    tau = t % 60.0
    if tau < 10:    return "approche"
    if tau < 25:    return "levage"
    if tau < 40:    return "maintien"
    if tau < 55:    return "vidage"
    return "retour"


def regime_moteur(t: float) -> float:
    """Regime moteur cycle (rpm)."""
    tau = t % 60.0
    if tau < 15:    return 750.0    # ralenti
    if tau < 40:    return 1500.0   # charge moy
    if tau < 50:    return 1700.0   # pleine charge
    return 750.0


# ============================================================
#  ETATS DU SIMULATEUR
# ============================================================

@dataclass
class State:
    # Hydraulique
    p_pompe: float = 0.5e6           # Pa
    x_verin: float = 0.0             # m
    v_verin: float = 0.0             # m/s
    # Thermique
    T_block: float = T_BLOCK_0       # degC
    T_coolant: float = T_COOLANT_0   # degC
    fan_on: bool = False


# ============================================================
#  PARAMETRES DEFAUTS (CLI)
# ============================================================

@dataclass
class DefautConfig:
    fuite_hydraulique: bool = False
    fuite_debit: float = 80e-3 / 60.0   # m^3/s (~80 L/min)
    ventilo_hs: bool = False
    radiateur_encrasse: bool = False
    radiateur_reduction: float = 0.85
    niveau_bas: bool = False
    niveau_frac_C: float = 0.30
    niveau_frac_Urad: float = 0.15
    t_debut: float = 60.0
    nom: Optional[str] = None


def configure_defaut(name: str, t_debut: float) -> DefautConfig:
    d = DefautConfig(t_debut=t_debut)
    if name in (None, "", "none"):
        return d
    d.nom = name
    if name == "fuite_hydraulique":
        d.fuite_hydraulique = True
    elif name == "ventilo_hs":
        d.ventilo_hs = True
    elif name == "radiateur_encrasse":
        d.radiateur_encrasse = True
    elif name == "niveau_bas":
        d.niveau_bas = True
    else:
        sys.exit(f"Defaut inconnu : {name}. "
                 "Choisir parmi : fuite_hydraulique, ventilo_hs, radiateur_encrasse, niveau_bas")
    return d


# ============================================================
#  PAS DE SIMULATION (1 Hz interne, mais sous-pas 100 Hz pour l'hydraulique)
# ============================================================

SUB_DT_HYDRO = 0.01   # 100 Hz pour la stabilite numerique de l'hydraulique


def step_hydraulique(s: State, t: float, def_cfg: DefautConfig) -> None:
    """Avance les etats hydrauliques de 1 s en plusieurs sous-pas (Euler)."""
    n_sub = int(round(1.0 / SUB_DT_HYDRO))
    for _ in range(n_sub):
        u = max(-1.0, min(1.0, cmd_hydraulique(t)))
        Q_pompe = ETA_POMPE * Q_NOM * u

        Q_fuite = 0.0
        if def_cfg.fuite_hydraulique and t >= def_cfg.t_debut:
            Q_fuite = def_cfg.fuite_debit

        Q_consomme_verin = A_PISTON * s.v_verin
        # equation de continuite (pression)
        dp = (Q_pompe - Q_fuite - Q_consomme_verin
              - (s.p_pompe - P_MIN) / R_CANAL) / C_HYDR
        # bilan de force sur la charge
        F_pression = s.p_pompe * A_PISTON
        F_poids    = M_CHARGE * G
        F_frot     = B_FROT * s.v_verin
        # butee haute / basse
        F_butee = 0.0
        if s.x_verin > X_MAX:
            F_butee += -K_BUTEE * (s.x_verin - X_MAX) - C_BUTEE * max(0.0, s.v_verin)
        if s.x_verin < 0:
            F_butee += -K_BUTEE * s.x_verin - C_BUTEE * min(0.0, s.v_verin)
        dv = (F_pression - F_poids - F_frot + F_butee) / M_CHARGE

        s.p_pompe += SUB_DT_HYDRO * dp
        s.x_verin += SUB_DT_HYDRO * s.v_verin
        s.v_verin += SUB_DT_HYDRO * dv

        # Ecretage soupape de decharge
        s.p_pompe = max(P_MIN, min(P_MAX, s.p_pompe))

        t += SUB_DT_HYDRO


def step_thermique(s: State, t: float, def_cfg: DefautConfig, dt: float = 1.0) -> None:
    """Avance les etats thermiques de dt s (Euler explicite)."""
    rpm = regime_moteur(t)
    rpm = max(RPM_IDLE, min(RPM_MAX, rpm))
    P_moteur = P_MOT_MAX * (rpm / RPM_MAX) ** 2.5

    # Hysteresis ventilo
    if s.T_coolant >= T_FAN_ON:
        s.fan_on = True
    elif s.T_coolant <= T_FAN_OFF:
        s.fan_on = False
    if def_cfg.ventilo_hs and t >= def_cfg.t_debut:
        s.fan_on = False

    Q_combustion = (1 - ETA_THERMO) * FRAC_COOLANT * P_moteur
    Q_bc = U_BC * (s.T_block - s.T_coolant)
    U_rad = U_RAD_ON if s.fan_on else U_RAD_OFF
    if def_cfg.radiateur_encrasse and t >= def_cfg.t_debut:
        U_rad *= (1 - def_cfg.radiateur_reduction)

    C_eff = C_COOLANT
    if def_cfg.niveau_bas and t >= def_cfg.t_debut:
        C_eff = C_COOLANT * def_cfg.niveau_frac_C
        U_rad = U_rad * def_cfg.niveau_frac_Urad

    Q_rad = U_rad * (s.T_coolant - T_AMB)

    s.T_block   += dt * (Q_combustion - Q_bc) / C_BLOCK
    s.T_coolant += dt * (Q_bc - Q_rad) / C_eff


def derive_other_sensors(s: State, t: float, def_cfg: DefautConfig, rng: np.random.Generator) -> dict:
    """
    Derive les autres capteurs CAT 994F a partir de l'etat interne.
    Calage : VIMS reel 994F-1 jan+fev 2025.
    """
    rpm = regime_moteur(t)

    # Pression huile moteur (kPa) : nominale 350 kPa au ralenti, 480 kPa charge
    p_huile_moteur = 200 + 0.18 * rpm + rng.normal(0, 8)

    # Temperatures couplees au regime moteur
    norm_rpm = (rpm - RPM_IDLE) / (RPM_MAX - RPM_IDLE)   # 0..1

    # Echappement (en degC) : 250 ralenti -> 480 charge max
    T_ech_d = 250 + 230 * norm_rpm + rng.normal(0, 8)
    T_ech_g = 245 + 230 * norm_rpm + rng.normal(0, 8)

    # Sortie convertisseur de couple
    T_sortie_conv = 60 + 20 * norm_rpm + rng.normal(0, 1.0)

    # Huile direction / freinage / hydraulique : couplees a la pression hydraulique
    p_hyd_bar = s.p_pompe / 1e5
    T_huile_dir   = 45 + 0.05 * p_hyd_bar + rng.normal(0, 0.7)
    T_huile_frein = 60 + 0.04 * p_hyd_bar + rng.normal(0, 0.7)
    T_huile_hyd   = 50 + 0.10 * p_hyd_bar + rng.normal(0, 0.8)
    T_PTO_avant   = 50 + 12 * norm_rpm + rng.normal(0, 1.2)

    # Essieux (VIMS : moy 40-50 degC)
    T_essieu_av = 42 + 8 * norm_rpm + rng.normal(0, 1.0)
    T_essieu_ar = 42 + 8 * norm_rpm + rng.normal(0, 1.0)

    # Pression air reservoir (frein air) : 700-850 kPa
    p_air = 750 + 50 * math.sin(2 * math.pi * t / 90.0) + rng.normal(0, 8)

    # Pression sortie convertisseur (couple converter, 370-570 kPa)
    p_sortie_conv = 400 + 100 * norm_rpm + rng.normal(0, 10)

    return dict(
        p_huile_moteur=p_huile_moteur,
        T_ech_d=T_ech_d,
        T_ech_g=T_ech_g,
        T_sortie_conv=T_sortie_conv,
        T_huile_dir=T_huile_dir,
        T_huile_frein=T_huile_frein,
        T_huile_hyd=T_huile_hyd,
        T_PTO_avant=T_PTO_avant,
        T_essieu_av=T_essieu_av,
        T_essieu_ar=T_essieu_ar,
        p_air=p_air,
        p_sortie_conv=p_sortie_conv,
    )


# ============================================================
#  POST vers MineAssist
# ============================================================

def build_payload(s: State, t: float, derived: dict, def_cfg: DefautConfig,
                  engin: str, rpm: float, ts: datetime) -> dict:
    """Construit le payload exact attendu par /sim/ingest."""
    # Conversion : Pa -> kPa, m^3/s -> L/min
    p_pompe_kPa = s.p_pompe / 1000.0    # kPa

    # IMPORTANT : noms canoniques avec accents (= capteur_thresholds.py)
    mesures = [
        # ---- Hydraulique / Pression ----
        {"parametre": "CH994.P1.Pression pompe hydraulique principale",
         "valeur": p_pompe_kPa, "unite": "kPa"},
        {"parametre": "CH994.P1.Pression huile moteur",
         "valeur": derived["p_huile_moteur"], "unite": "kPa"},
        {"parametre": "CH994.P2.Pression d\u2019air au r\u00e9servoir",
         "valeur": derived["p_air"], "unite": "kPa"},
        {"parametre": "CH994.P1.Pression sortie convertisseur",
         "valeur": derived["p_sortie_conv"], "unite": "kPa"},
        # ---- Thermique ----
        {"parametre": "CH994.P1.Temp\u00e9rature liquide refroidissement",
         "valeur": s.T_coolant, "unite": "\u00b0C"},
        {"parametre": "CH994.P1.Temp\u00e9rature huile direction",
         "valeur": derived["T_huile_dir"], "unite": "\u00b0C"},
        {"parametre": "CH994.P1.Temp\u00e9rature huile freinage",
         "valeur": derived["T_huile_frein"], "unite": "\u00b0C"},
        {"parametre": "CH994.P1.Temp\u00e9rature huile hydraulique",
         "valeur": derived["T_huile_hyd"], "unite": "\u00b0C"},
        {"parametre": "CH994.P1.Temp\u00e9rature PTO avant",
         "valeur": derived["T_PTO_avant"], "unite": "\u00b0C"},
        {"parametre": "CH994.P1.Temp\u00e9rature \u00e9chappement Droit",
         "valeur": derived["T_ech_d"], "unite": "\u00b0C"},
        {"parametre": "CH994.P1.Temp\u00e9rature \u00e9chappement gauche",
         "valeur": derived["T_ech_g"], "unite": "\u00b0C"},
        {"parametre": "CH994.P1.Temp\u00e9rature sortie convertisseur",
         "valeur": derived["T_sortie_conv"], "unite": "\u00b0C"},
        {"parametre": "CH994.P2.Temp\u00e9rature essieux avant",
         "valeur": derived["T_essieu_av"], "unite": "\u00b0C"},
        {"parametre": "CH994.P2.Temp\u00e9rature essieux arri\u00e8re",
         "valeur": derived["T_essieu_ar"], "unite": "\u00b0C"},
        # ---- Cinematique moteur ----
        {"parametre": "CH994.P2.R\u00e9gime moteur",
         "valeur": rpm, "unite": "Tr/min"},
    ]

    return {
        "engin": engin,
        "horodatage": ts.isoformat(),
        "mesures": mesures,
        "cycle_phase": cycle_phase(t),
        "defaut_actif": def_cfg.nom,
    }


# ============================================================
#  BOUCLE PRINCIPALE
# ============================================================

def run(args):
    rng = np.random.default_rng(42)
    s = State()
    def_cfg = configure_defaut(args.fault, args.t_fault)

    csv_writer = None
    csv_file = None
    if args.csv:
        csv_file = open(args.csv, "w", newline="", encoding="utf-8")
        csv_writer = csv.writer(csv_file)

    sess = requests.Session()
    api_url = args.api.rstrip("/") + "/sim/ingest"

    print(f"=== Simulateur live MineAssist ===")
    print(f"  API     : {api_url}")
    print(f"  Engin   : {args.engin}")
    print(f"  Duree   : {args.duration} s   (dt={args.dt} s, vitesse x{args.speed})")
    if def_cfg.nom:
        print(f"  Defaut  : {def_cfg.nom} a t={def_cfg.t_debut} s")
    print()

    t = 0.0
    n_alertes_total = 0
    t_real_start = time.time()

    while t < args.duration:
        ts_sim = datetime.now()

        # --- Avance des modeles ---
        step_hydraulique(s, t, def_cfg)
        step_thermique(s, t, def_cfg, dt=args.dt)

        rpm = regime_moteur(t) + rng.normal(0, SIGMA_RPM)
        derived = derive_other_sensors(s, t, def_cfg, rng)

        payload = build_payload(s, t, derived, def_cfg, args.engin, rpm, ts_sim)

        # Bruit final sur la pression (apres conversion en kPa)
        for m in payload["mesures"]:
            if "Pression pompe hydraulique" in m["parametre"]:
                m["valeur"] += rng.normal(0, SIGMA_P)
            if "Temperature liquide refroidissement" in m["parametre"]:
                m["valeur"] += rng.normal(0, SIGMA_T)

        # --- POST ---
        if not args.dry_run:
            try:
                r = sess.post(api_url, json=payload, timeout=2.0)
                r.raise_for_status()
                resp = r.json()
                nb_a = resp.get("nb_alertes", 0)
                n_alertes_total += nb_a
                if nb_a:
                    for a in resp.get("alertes", []):
                        print(f"  [t={t:6.1f}s] {a['niveau']:9s}  {a['label']:<30s}  "
                              f"= {a['valeur']:.1f} {a['unite']}  "
                              f"(seuil {a['seuil']} {a['unite']})")
            except requests.exceptions.RequestException as e:
                if t < 5:
                    print(f"  ATTENTION : POST failed : {e}", file=sys.stderr)

        # --- CSV optionnel ---
        if csv_writer:
            if t < 0.5:
                header = ["time_s", "horodatage", "cycle_phase", "defaut_actif"] + \
                         [m["parametre"].replace("CH994.P1.", "").replace("CH994.P2.", "")
                          for m in payload["mesures"]]
                csv_writer.writerow(header)
            row = [f"{t:.1f}", ts_sim.isoformat(), payload["cycle_phase"], payload["defaut_actif"] or ""]
            row += [f"{m['valeur']:.2f}" for m in payload["mesures"]]
            csv_writer.writerow(row)

        # --- Affichage local toutes les 10 s ---
        if int(t) % 10 == 0 and abs(t - int(t)) < args.dt / 2:
            tag = ""
            if def_cfg.nom and t >= def_cfg.t_debut:
                tag = f"  [DEFAUT={def_cfg.nom}]"
            print(f"  t={t:6.1f}s | "
                  f"P_hyd={s.p_pompe/1e5:6.1f} bar | "
                  f"T_eau={s.T_coolant:5.1f}degC | "
                  f"fan={'ON' if s.fan_on else 'off'} | "
                  f"rpm={rpm:5.0f} | "
                  f"phase={cycle_phase(t):8s} | "
                  f"alertes_total={n_alertes_total}{tag}")

        # --- Cadence temps reel ---
        if args.speed > 0:
            target_real = (t + args.dt) / args.speed
            elapsed = time.time() - t_real_start
            sleep = target_real - elapsed
            if sleep > 0:
                time.sleep(sleep)

        t += args.dt

    if csv_file:
        csv_file.close()
        print(f"\nCSV ecrit : {args.csv}")
    print(f"\nSimulation terminee. {n_alertes_total} alertes generees.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--duration", type=float, default=1800.0)
    ap.add_argument("--dt", type=float, default=1.0)
    ap.add_argument("--speed", type=float, default=1.0,
                    help="0 ou >0 ; 0=temps reel desactive")
    ap.add_argument("--engin", default="994F1")
    ap.add_argument("--fault", default=None,
                    help="fuite_hydraulique | ventilo_hs | radiateur_encrasse | niveau_bas")
    ap.add_argument("--t-fault", dest="t_fault", type=float, default=60.0)
    ap.add_argument("--csv", default=None)
    ap.add_argument("--dry-run", action="store_true",
                    help="N'envoie rien au backend, pour test offline")
    args = ap.parse_args()
    run(args)


if __name__ == "__main__":
    main()
