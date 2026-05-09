# ============================================================
# utils/thresholds.py
# Seuils officiels — Chargeuse 994F
# 6 capteurs : moteur + convertisseur + direction
# ============================================================

FEATURE_COLS = [
    "Regime_moteur",
    "Pression_huile",
    "Temp_refroid",
    "Regime_conv",
    "Temp_conv",
    "Temp_huile_dir",
]

LABEL_COL = "Label"

LABEL_NAMES = {
    0: "Normal",
    1: "Pre-alerte",
    2: "Anomalie",
    3: "Critique",
}

LABEL_COLORS = {
    0: "#22c55e",
    1: "#f59e0b",
    2: "#ef4444",
    3: "#7c3aed",
}

# Valeurs electroniquement impossibles (codes capteur defaillant)
FAULT_CODES = [-32764, -16383, -32768, 32767, -1]
FAULT_THRESHOLD = -500

SENSORS_CONFIG = {
    # IMPORTANT : alarm / min_normal / max_normal sont utilises par label_points() et
    # clean_data() pour la labellisation et le nettoyage du dataset d'entrainement.
    # NE PAS modifier ces valeurs sans revalider le pipeline.
    #
    # threshold_max / threshold_min sont UNIQUEMENT pour l'affichage graphique
    # (lignes rouge/verte dans les graphes capteurs du frontend).
    "Regime_moteur": {
        "label":         "Regime moteur",
        "unit":          "RPM",
        "min_abs":       400,
        "min_normal":    750,
        "max_normal":    1730,
        "alarm":         1750,
        "alarm_dir":     "max",
        "criticality":   1,
        "threshold_max": 1700,
        "threshold_min": 700,
    },
    "Pression_huile": {
        "label":         "Pression huile moteur",
        "unit":          "kPa",
        "min_abs":       1,
        "min_normal":    275,
        "max_normal":    625,
        "alarm":         140,
        "alarm_dir":     "min",
        "criticality":   1,
        "threshold_max": 500,
        "threshold_min": 300,
    },
    "Temp_refroid": {
        "label":         "Temperature refroidissement",
        "unit":          "deg C",
        "min_abs":       15,
        "min_normal":    75,
        "max_normal":    102,
        "alarm":         107,
        "alarm_dir":     "max",
        "criticality":   1,
        "threshold_max": 90,
    },
    "Regime_conv": {
        "label":         "Regime convertisseur",
        "unit":          "RPM",
        "min_abs":       0,
        "min_normal":    600,
        "max_normal":    2200,
        "alarm":         2400,
        "alarm_dir":     "max",
        "criticality":   2,
        "threshold_max": 1500,
    },
    "Temp_conv": {
        "label":         "Temperature convertisseur",
        "unit":          "deg C",
        "min_abs":       15,
        "min_normal":    60,
        "max_normal":    110,
        "alarm":         120,
        "alarm_dir":     "max",
        "criticality":   2,
        "threshold_max": 120,
    },
    "Temp_huile_dir": {
        "label":         "Temperature huile direction",
        "unit":          "deg C",
        "min_abs":       15,
        "min_normal":    40,
        "max_normal":    90,
        "alarm":         100,
        "alarm_dir":     "max",
        "criticality":   2,
        "threshold_max": 70,
    },
}

# Causes et recommandations par type de panne
TROUBLESHOOTING_DB = {
    "echauffement moteur thermique": {
        "titre": "Echauffement Moteur Thermique",
        "causes": [
            {"id": 1, "titre": "Niveau bas liquide refroidissement",
             "recommandations": ["Ajouter du liquide de refroidissement"],
             "outils": ["Indicateur niveau radiateur"]},
            {"id": 2, "titre": "Radiateur bouche",
             "recommandations": ["Nettoyer ou remplacer le radiateur"],
             "outils": ["Inspection visuelle / nettoyage haute pression"]},
            {"id": 3, "titre": "Pompe a eau defaillante",
             "recommandations": ["Verifier la pompe a eau", "Remplacer si necessaire"],
             "outils": ["Controle debit pompe"]},
        ],
    },
    "pression huile basse": {
        "titre": "Pression Huile Moteur Basse",
        "causes": [
            {"id": 1, "titre": "Niveau d huile bas",
             "recommandations": ["Completer le niveau d huile"],
             "outils": ["Jauge d huile"]},
            {"id": 2, "titre": "Filtre a huile colmate",
             "recommandations": ["Remplacer le filtre"],
             "outils": ["Cle filtre"]},
            {"id": 3, "titre": "Pompe a huile defectueuse",
             "recommandations": ["Revision ou remplacement de la pompe"],
             "outils": ["Manometre pression huile"]},
        ],
    },
    "surchauffe convertisseur": {
        "titre": "Surchauffe Convertisseur",
        "causes": [
            {"id": 1, "titre": "Huile convertisseur degradee",
             "recommandations": ["Verifier et remplacer l huile convertisseur"],
             "outils": ["Test huile"]},
            {"id": 2, "titre": "Radiateur convertisseur bouche",
             "recommandations": ["Nettoyer le radiateur convertisseur"],
             "outils": ["Inspection visuelle"]},
        ],
    },
    "surchauffe huile direction": {
        "titre": "Surchauffe Huile Direction",
        "causes": [
            {"id": 1, "titre": "Huile direction degradee",
             "recommandations": ["Remplacer l huile de direction"],
             "outils": ["Test huile direction"]},
            {"id": 2, "titre": "Fuite dans le circuit direction",
             "recommandations": ["Inspecter les joints et canalisations"],
             "outils": ["Test de pression circuit"]},
        ],
    },
}
