"""
MineAssist — Détecteur d'alertes
Analyse les valeurs des capteurs et retourne les alertes selon les seuils 994F.
"""

from datetime import datetime
from notification_service import Alerte, NiveauAlerte

# ─────────────────────────────────────────────────────────────
# SEUILS CATERPILLAR 994F (valeurs officielles)
# ─────────────────────────────────────────────────────────────
SEUILS_994F = {
    # Paramètre complet                            min    max   unité
    "CH994.P1.Température liquide refroidissement": (None, 107,  "°C"),
    "CH994.P1.Pression huile moteur":               (207,  None, "kPa"),
    "CH994.P1.Régime moteur":                       (None, 2200, "Tr/min"),
    "CH994.P1.Température huile direction":          (None, 107,  "°C"),
    "CH994.P1.Température huile freinage":           (None, 120,  "°C"),
    "CH994.P1.Température sortie convertisseur":     (None, 121,  "°C"),
    "CH994.P1.Température échappement Droit":        (None, 600,  "°C"),
    "CH994.P1.Température échappement gauche":       (None, 600,  "°C"),
    "CH994.P2.Pression d'air au réservoir":          (700,  None, "kPa"),
    "CH994.P2.Température essieux arrière":          (None, 120,  "°C"),
    "CH994.P2.Température Essieux avant":            (None, 120,  "°C"),
    "CH994.P1.Température PTO avant":                (None, 100,  "°C"),
}

# Labels courts pour les messages
LABELS = {
    "CH994.P1.Température liquide refroidissement": "Temp. Liq. Refroid.",
    "CH994.P1.Pression huile moteur":               "Press. Huile Moteur",
    "CH994.P1.Régime moteur":                       "Régime Moteur",
    "CH994.P1.Température huile direction":          "Temp. Huile Direction",
    "CH994.P1.Température huile freinage":           "Temp. Huile Freinage",
    "CH994.P1.Température sortie convertisseur":     "Temp. Sort. Convertisseur",
    "CH994.P1.Température échappement Droit":        "Temp. Echap. Droit",
    "CH994.P1.Température échappement gauche":       "Temp. Echap. Gauche",
    "CH994.P2.Pression d'air au réservoir":          "Press. Air Réservoir",
    "CH994.P2.Température essieux arrière":          "Temp. Essieux Arrière",
    "CH994.P2.Température Essieux avant":            "Temp. Essieux Avant",
    "CH994.P1.Température PTO avant":                "Temp. PTO Avant",
}

SEUIL_ATTENTION_RATIO = 0.90  # 90% du seuil max = attention


def analyser_mesure(
    parametre: str,
    val_max: float,
    val_min: float,
    engin: str = "994F1",
    horodatage: datetime = None,
) -> Alerte | None:
    """
    Analyse une mesure et retourne une Alerte si nécessaire, sinon None.

    Args:
        parametre:   Nom complet du paramètre (ex: CH994.P1.Régime moteur)
        val_max:     Valeur maximale de l'intervalle
        val_min:     Valeur minimale de l'intervalle
        engin:       Identifiant de l'engin
        horodatage:  Datetime de la mesure

    Returns:
        Alerte si anomalie détectée, None sinon
    """
    config = SEUILS_994F.get(parametre)
    if config is None:
        return None  # Paramètre non surveillé

    seuil_min, seuil_max, unite = config
    label = LABELS.get(parametre, parametre)
    ts = horodatage or datetime.now()

    # ── Vérifier dépassement max ──
    if seuil_max is not None:
        if val_max > seuil_max:
            return Alerte(
                parametre=parametre, label=label,
                valeur=val_max, unite=unite, seuil=seuil_max,
                niveau=NiveauAlerte.ALERTE, engin=engin, horodatage=ts,
                motif=f"Val. max {val_max} {unite} > seuil critique {seuil_max} {unite}"
            )
        if val_max > seuil_max * SEUIL_ATTENTION_RATIO:
            return Alerte(
                parametre=parametre, label=label,
                valeur=val_max, unite=unite, seuil=seuil_max,
                niveau=NiveauAlerte.ATTENTION, engin=engin, horodatage=ts,
                motif=f"Val. max {val_max} {unite} proche du seuil {seuil_max} {unite} (>90%)"
            )

    # ── Vérifier dépassement min ──
    if seuil_min is not None:
        if val_min < seuil_min:
            return Alerte(
                parametre=parametre, label=label,
                valeur=val_min, unite=unite, seuil=seuil_min,
                niveau=NiveauAlerte.ALERTE, engin=engin, horodatage=ts,
                motif=f"Val. min {val_min} {unite} < seuil critique {seuil_min} {unite}"
            )
        if val_min < seuil_min * (2 - SEUIL_ATTENTION_RATIO):
            return Alerte(
                parametre=parametre, label=label,
                valeur=val_min, unite=unite, seuil=seuil_min,
                niveau=NiveauAlerte.ATTENTION, engin=engin, horodatage=ts,
                motif=f"Val. min {val_min} {unite} proche du seuil bas {seuil_min} {unite}"
            )

    return None


def analyser_batch(mesures: list[dict]) -> list[Alerte]:
    """
    Analyse une liste de mesures (depuis GMAO / API) et retourne les alertes.

    Format attendu pour chaque mesure:
    {
        "parametre": "CH994.P1.Température liquide refroidissement",
        "val_max": 110.0,
        "val_min": 85.0,
        "engin": "994F1",
        "horodatage": datetime(...)   # optionnel
    }
    """
    alertes = []
    for m in mesures:
        alerte = analyser_mesure(
            parametre=m.get("parametre", ""),
            val_max=float(m.get("val_max", 0)),
            val_min=float(m.get("val_min", 0)),
            engin=m.get("engin", "994F1"),
            horodatage=m.get("horodatage"),
        )
        if alerte:
            alertes.append(alerte)

    # Trier: alertes critiques d'abord
    alertes.sort(key=lambda a: (a.niveau != NiveauAlerte.ALERTE, a.horodatage), reverse=False)
    return alertes
