"""
MineAssist — Détecteur d'alertes
Analyse les valeurs des capteurs et retourne les alertes selon les seuils 994F.
"""

from datetime import datetime
import re
from app.notification_service import Alerte, NiveauAlerte

# ─────────────────────────────────────────────────────────────
# SEUILS MÉTIER OCP / 994F
# Alignés avec api.py
# ─────────────────────────────────────────────────────────────
from app.capteur_thresholds import (
    CAPTEUR_THRESHOLDS as SEUILS_994F,
    get_capteur_label,
    find_capteur_rule,
    clean_param_name,
)

LABELS = {
    "Température liquide refroidissement": "Temp. Liq. Refroid.",
    "Pression huile moteur": "Press. Huile Moteur",
    "Régime moteur": "Régime Moteur",
    "Température huile direction": "Temp. Huile Direction",
    "Température huile freinage": "Temp. Huile Freinage",
    "Température sortie convertisseur": "Temp. Sort. Convertisseur",
    "Température huile convertisseur": "Temp. Huile Convertisseur",
    "Température échappement Droit": "Temp. Echap. Droit",
    "Température échappement gauche": "Temp. Echap. Gauche",
    "Pression d'air au réservoir": "Press. Air Réservoir",
    "Température essieux arrière": "Temp. Essieux Arrière",
    "Température essieux avant": "Temp. Essieux Avant",
    "Température PTO avant": "Temp. PTO Avant",
    "Pression pompe hydraulique principale": "Press. Pompe Hydraulique",
    "Pression pompe hydraulique": "Press. Pompe Hydraulique",
    "Pression sortie convertisseur": "Press. Sortie Convertisseur",
    "Pression lockup": "Press. Lockup",
    "Pression entrée convertisseur": "Press. Entrée Convertisseur",
    "Pression embrayage impeller": "Press. Embrayage Impeller",
    "Pression auto-graissage": "Press. Auto-graissage",
    "Pression gasoil": "Press. Gasoil",
}

SEUIL_ATTENTION_RATIO = 0.90  # 90% du seuil max = attention


def _clean_param_name(param: str) -> str:
    s = str(param).strip()
    s = re.sub(r"^CH\d+\.(P\d+)\.", "", s, flags=re.IGNORECASE)
    return s.strip()


def _find_threshold(parametre: str):
    clean_param = _clean_param_name(parametre).lower()

    for key, rule in SEUILS_994F.items():
        key_lower = key.lower()
        if key_lower in clean_param or clean_param in key_lower:
            return key, rule

    return None, None


def analyser_mesure(
    parametre: str,
    val_max: float,
    val_min: float,
    engin: str = "994F-1",
    horodatage: datetime = None,
) -> Alerte | None:
    """
    Analyse une mesure et retourne une Alerte si nécessaire, sinon None.
    """
    seuil_key, config = find_capteur_rule(parametre)
    if config is None:
        return None

    seuil_min = config.get("min")
    seuil_max = config.get("max")
    unite = config.get("unite", "")
    label = get_capteur_label(parametre)
    ts = horodatage or datetime.now()

    # Sécurisation des valeurs
    try:
        val_max = float(val_max) if val_max is not None else None
    except Exception:
        val_max = None

    try:
        val_min = float(val_min) if val_min is not None else None
    except Exception:
        val_min = None

    # ── Vérifier dépassement max ──
    if seuil_max is not None and val_max is not None:
        if val_max > seuil_max:
            return Alerte(
                parametre=parametre,
                label=label,
                valeur=val_max,
                unite=unite,
                seuil=seuil_max,
                niveau=NiveauAlerte.ALERTE,
                engin=engin,
                horodatage=ts,
                motif=f"Val. max {val_max} {unite} > seuil critique {seuil_max} {unite}",
            )

        if val_max > seuil_max * SEUIL_ATTENTION_RATIO:
            return Alerte(
                parametre=parametre,
                label=label,
                valeur=val_max,
                unite=unite,
                seuil=seuil_max,
                niveau=NiveauAlerte.ATTENTION,
                engin=engin,
                horodatage=ts,
                motif=f"Val. max {val_max} {unite} proche du seuil {seuil_max} {unite} (>90%)",
            )

    # ── Vérifier dépassement min ──
    if seuil_min is not None and val_min is not None:
        if val_min < seuil_min:
            return Alerte(
                parametre=parametre,
                label=label,
                valeur=val_min,
                unite=unite,
                seuil=seuil_min,
                niveau=NiveauAlerte.ALERTE,
                engin=engin,
                horodatage=ts,
                motif=f"Val. min {val_min} {unite} < seuil critique {seuil_min} {unite}",
            )

        if val_min < seuil_min * (2 - SEUIL_ATTENTION_RATIO):
            return Alerte(
                parametre=parametre,
                label=label,
                valeur=val_min,
                unite=unite,
                seuil=seuil_min,
                niveau=NiveauAlerte.ATTENTION,
                engin=engin,
                horodatage=ts,
                motif=f"Val. min {val_min} {unite} proche du seuil bas {seuil_min} {unite}",
            )

    return None


def analyser_batch(mesures: list[dict]) -> list[Alerte]:
    """
    Analyse une liste de mesures et retourne les alertes.
    """
    alertes = []

    for m in mesures:
        alerte = analyser_mesure(
            parametre=m.get("parametre", ""),
            val_max=m.get("val_max"),
            val_min=m.get("val_min"),
            engin=m.get("engin", "994F-1"),
            horodatage=m.get("horodatage"),
        )
        if alerte:
            alertes.append(alerte)

    alertes.sort(
        key=lambda a: (a.niveau != NiveauAlerte.ALERTE, a.horodatage),
        reverse=False,
    )
    return alertes