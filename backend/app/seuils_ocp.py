"""
MineAssist - Detecteur d'alertes selon les seuils officiels OCP / CAT 994F
==========================================================================

Charge `seuils_OCP.json` (cf. fichier seulles.xlsx fourni par OCP Benguerir,
mai 2026) et evalue les 13 seuils mappables sur une snapshot de mesures.

Operateurs supportes :
  - max                  : alerte si valeur > limite_max  (ou >= selon `regle`)
  - min                  : alerte si valeur < limite_min
  - range                : alerte si valeur hors [limite_min, limite_max]
  - regime_conditionnel  : applique des bornes P_min/P_max uniquement quand
                           le regime moteur (rpm) est dans une plage donnee,
                           avec optionnellement un filtre sur la charge
                           hydraulique commandee (hyd_norm).

Niveau ATTENTION declenche a 95 % du seuil (max) ou 105 % du seuil (min).
Niveau ALERTE declenche au franchissement strict.

Ce module est utilise par `sim_router.py` (chemin /sim/ingest) en plus de
l'analyseur historique `alert_detector.py`. Pour les capteurs couverts par
les seuils OCP, le resultat OCP est prioritaire sur les seuils legacy
(plus permissif a l'idle pour P_pompe / P_impeller / P_huile_moteur).
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.notification_service import Alerte, NiveauAlerte


# --------------------------------------------------------------------- #
#  Chargement du fichier seuils_OCP.json (cache module-level)
# --------------------------------------------------------------------- #
_SEUILS_FILE = Path(__file__).parent / "seuils_OCP.json"
_SEUILS_CACHE: Optional[list[dict]] = None
_COVERED_SENSORS_CACHE: Optional[set[str]] = None

# Ratio pour declencher le niveau ATTENTION (95 % du seuil critique max)
SEUIL_ATTENTION_RATIO = 0.95


def _normalize_param(name: str) -> str:
    """Normalise un nom de capteur pour matching robuste :
       - enleve les prefixes CH994.P1./P2.
       - normalise les apostrophes (droite U+0027 vs courbe U+2019)
       - lowercase + strip
    """
    s = str(name).strip()
    s = re.sub(r"^CH\d+\.P\d+\.", "", s, flags=re.IGNORECASE)
    s = s.replace("\u2019", "'")
    return s.strip().lower()


def _load_seuils() -> list[dict]:
    global _SEUILS_CACHE
    if _SEUILS_CACHE is None:
        if _SEUILS_FILE.exists():
            try:
                data = json.loads(_SEUILS_FILE.read_text(encoding="utf-8"))
                _SEUILS_CACHE = data.get("seuils", [])
            except Exception as e:
                print(f"[seuils_ocp] erreur chargement {_SEUILS_FILE.name} : {e}")
                _SEUILS_CACHE = []
        else:
            print(f"[seuils_ocp] fichier absent : {_SEUILS_FILE}")
            _SEUILS_CACHE = []
    return _SEUILS_CACHE


def covered_sensors() -> set[str]:
    """Renvoie l'ensemble des noms de capteurs (normalises) couverts par les
    seuils OCP. sim_router.py s'en sert pour shadow les alertes legacy."""
    global _COVERED_SENSORS_CACHE
    if _COVERED_SENSORS_CACHE is None:
        _COVERED_SENSORS_CACHE = {
            _normalize_param(s["capteur_vims"]) for s in _load_seuils()
        }
    return _COVERED_SENSORS_CACHE


# --------------------------------------------------------------------- #
#  Helpers d'extraction depuis la snapshot
# --------------------------------------------------------------------- #
def _find_value(snapshot: dict, capteur_vims: str) -> Optional[float]:
    """Cherche la valeur d'un capteur dans le snapshot, avec match flexible
    (P1/P2 swap, apostrophe variations)."""
    target = _normalize_param(capteur_vims)
    for key, val in snapshot.items():
        if _normalize_param(key) == target:
            try:
                return float(val)
            except (TypeError, ValueError):
                return None
    return None


def _find_rpm(snapshot: dict) -> Optional[float]:
    # Le simulateur peut envoyer P1.Regime moteur ou P2.Regime moteur :
    # _normalize_param enleve le prefixe donc les deux matchent.
    return _find_value(snapshot, "CH994.P1.Régime moteur")


def _find_hyd_norm(snapshot: dict, cycle_phase: Optional[str]) -> float:
    """Estime la charge hydraulique commandee (0..1).

    Priorite :
      1. Si cycle_phase indique une phase haute charge -> 0.6 (haute)
      2. Sinon, derive de P_pompe : (P - 30) / 26000, clamp 0..1
      3. Sinon, 0.0
    """
    if cycle_phase:
        ph = cycle_phase.lower()
        # phases vims_replay_simulator : creusage / pleine_charge / retour vide
        # phases mineassist_live_simulator : approche / levage / maintien / vidage / retour
        if any(k in ph for k in (
            "creusage", "pleine charge", "pleine_charge",
            "levage", "charge",
        )):
            return 0.6
    p = _find_value(snapshot, "CH994.P2.Pression pompe hydraulique principale")
    if p is None:
        return 0.0
    return max(0.0, min(1.0, (p - 30.0) / 26000.0))


# --------------------------------------------------------------------- #
#  Construction d'une Alerte
# --------------------------------------------------------------------- #
def _make_alerte(seuil: dict, valeur: float, niveau: NiveauAlerte,
                 motif: str, engin: str, ts: datetime,
                 seuil_aff: Optional[float] = None) -> Alerte:
    if seuil_aff is None:
        seuil_aff = (seuil.get("limite_max")
                     or seuil.get("limite_min")
                     or 0.0)
    return Alerte(
        parametre=seuil["capteur_vims"],
        label=seuil["param_ocp"],
        valeur=round(float(valeur), 2),
        unite=seuil.get("unite", ""),
        seuil=float(seuil_aff) if seuil_aff is not None else 0.0,
        niveau=niveau,
        engin=engin,
        horodatage=ts,
        motif=motif,
    )


# --------------------------------------------------------------------- #
#  Evaluation d'un seuil
# --------------------------------------------------------------------- #
def _eval_seuil(seuil: dict, snapshot: dict, engin: str, ts: datetime,
                cycle_phase: Optional[str]) -> Optional[Alerte]:
    capteur = seuil["capteur_vims"]
    val = _find_value(snapshot, capteur)
    if val is None:
        return None  # capteur absent du snapshot, pas d'evaluation possible

    op = seuil["operateur"]
    label = seuil["param_ocp"]
    unite = seuil.get("unite", "")
    sid = seuil["id"]

    # OCP : un franchissement de seuil officiel = ALERTE critique
    NIV_ALERTE = NiveauAlerte.ALERTE
    NIV_ATTENTION = NiveauAlerte.ATTENTION

    if op == "max":
        lim = float(seuil["limite_max"])
        regle = seuil.get("regle", "")
        depassement = (val >= lim) if ">=" in regle else (val > lim)
        if depassement:
            return _make_alerte(
                seuil, val, NIV_ALERTE,
                f"OCP#{sid} {label}: {val:.1f}{unite} > seuil {lim}{unite}",
                engin, ts,
            )
        if val > lim * SEUIL_ATTENTION_RATIO:
            return _make_alerte(
                seuil, val, NIV_ATTENTION,
                f"OCP#{sid} {label}: {val:.1f}{unite} proche du seuil {lim}{unite}",
                engin, ts,
            )
        return None

    if op == "min":
        lim = float(seuil["limite_min"])
        if val < lim:
            return _make_alerte(
                seuil, val, NIV_ALERTE,
                f"OCP#{sid} {label}: {val:.1f}{unite} < seuil {lim}{unite}",
                engin, ts,
            )
        if val < lim * (2.0 - SEUIL_ATTENTION_RATIO):  # = 1.05 * lim
            return _make_alerte(
                seuil, val, NIV_ATTENTION,
                f"OCP#{sid} {label}: {val:.1f}{unite} proche du seuil bas {lim}{unite}",
                engin, ts,
            )
        return None

    if op == "range":
        lo = float(seuil["limite_min"])
        hi = float(seuil["limite_max"])
        if val < lo or val > hi:
            return _make_alerte(
                seuil, val, NIV_ALERTE,
                f"OCP#{sid} {label}: {val:.1f}{unite} hors plage [{lo},{hi}]{unite}",
                engin, ts,
            )
        margin = (hi - lo) * 0.05
        if val < lo + margin or val > hi - margin:
            return _make_alerte(
                seuil, val, NIV_ATTENTION,
                f"OCP#{sid} {label}: {val:.1f}{unite} proche de la limite [{lo},{hi}]",
                engin, ts,
            )
        return None

    if op == "regime_conditionnel":
        rpm = _find_rpm(snapshot)
        if rpm is None:
            return None
        hyd_norm = _find_hyd_norm(snapshot, cycle_phase)
        is_faible = "faible" in label.lower()

        for cond in seuil.get("limites_conditionnelles", []):
            rpm_min = float(cond.get("rpm_min", 0))
            rpm_max = float(cond.get("rpm_max", 99999))
            if not (rpm_min <= rpm <= rpm_max):
                continue
            hyd_min = cond.get("hyd_load_min")
            if hyd_min is not None and hyd_norm < float(hyd_min):
                continue

            p_min = cond.get("P_min_kPa")
            p_max = cond.get("P_max_kPa")

            # Pression trop basse (la regle premiere : "(faible)")
            if p_min is not None and val < float(p_min):
                return _make_alerte(
                    seuil, val, NIV_ALERTE,
                    f"OCP#{sid} {label}: {val:.1f}{unite} < {p_min}{unite} a rpm={rpm:.0f}",
                    engin, ts,
                    seuil_aff=float(p_min),
                )
            # Pression trop haute (uniquement si la regle n'est pas "faible")
            if p_max is not None and val > float(p_max) and not is_faible:
                return _make_alerte(
                    seuil, val, NIV_ALERTE,
                    f"OCP#{sid} {label}: {val:.1f}{unite} > {p_max}{unite} a rpm={rpm:.0f}",
                    engin, ts,
                    seuil_aff=float(p_max),
                )
        return None

    # Operateur inconnu
    return None


# --------------------------------------------------------------------- #
#  API publique
# --------------------------------------------------------------------- #
def analyser_snapshot_ocp(snapshot: dict,
                          engin: str = "994F1",
                          ts: Optional[datetime] = None,
                          cycle_phase: Optional[str] = None) -> list[Alerte]:
    """Analyse une snapshot {nom_capteur: valeur} selon les seuils officiels OCP.

    Args:
        snapshot:    dict {nom_capteur_vims: valeur}
        engin:       identifiant engin (defaut "994F1")
        ts:          horodatage (defaut: now())
        cycle_phase: phase optionnelle ("approche", "levage", "creusage", ...)

    Returns:
        liste d'Alerte (peut etre vide)
    """
    ts = ts or datetime.now()
    alertes: list[Alerte] = []
    for seuil in _load_seuils():
        a = _eval_seuil(seuil, snapshot, engin, ts, cycle_phase)
        if a is not None:
            alertes.append(a)

    # Tri : ALERTE en premier, puis ordre id croissant
    alertes.sort(key=lambda a: (a.niveau != NiveauAlerte.ALERTE, a.label))
    return alertes


def info() -> dict:
    """Diagnostic : renvoie les seuils charges + capteurs couverts."""
    seuils = _load_seuils()
    return {
        "seuils_file": str(_SEUILS_FILE),
        "seuils_file_exists": _SEUILS_FILE.exists(),
        "n_seuils": len(seuils),
        "ids": [s.get("id") for s in seuils],
        "covered_sensors": sorted(covered_sensors()),
        "version": "ocp-v1",
    }
