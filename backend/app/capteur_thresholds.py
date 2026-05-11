# app/capteur_thresholds.py

import re

CAPTEUR_THRESHOLDS = {
    # ── Températures — seuil MAX uniquement ─────────────────
    "Température liquide refroidissement": {
        "max": 107,
        "niveau": "critique",
        "unite": "°C",
        "source_seuil": "seulles.xlsx",
    },
    "Température échappement Droit": {
        "max": 600,
        "niveau": "critique",
        "unite": "°C",
        "source_seuil": "seulles.xlsx",
    },
    "Température échappement gauche": {
        "max": 600,
        "niveau": "critique",
        "unite": "°C",
        "source_seuil": "seulles.xlsx",
    },
    "Température sortie convertisseur": {
        "max": 129,
        "niveau": "critique",
        "unite": "°C",
        "source_seuil": "seulles.xlsx",
    },
    "Température huile convertisseur": {
        "max": 129,
        "niveau": "critique",
        "unite": "°C",
        "source_seuil": "seulles.xlsx",
    },
    "Température huile freinage": {
        "max": 70,
        "niveau": "critique",
        "unite": "°C",
        "source_seuil": "seulles.xlsx",
    },
    "Température huile direction": {
        "max": 70,
        "niveau": "critique",
        "unite": "°C",
        "source_seuil": "seulles.xlsx",
    },
    "Température PTO avant": {
        "max": 93,
        "niveau": "critique",
        "unite": "°C",
        "source_seuil": "seulles.xlsx",
    },
    "Température huile hydraulique": {
        "max": 93,
        "niveau": "critique",
        "unite": "°C",
        "source_seuil": "seulles.xlsx",
    },
    "Température essieux arrière": {
        "max": 120,
        "niveau": "attention",
        "unite": "°C",
        "source_seuil": "maintenance_994f",
    },
    "Température essieux avant": {
        "max": 120,
        "niveau": "attention",
        "unite": "°C",
        "source_seuil": "maintenance_994f",
    },

    # ── Pressions — plages min/max ──────────────────────────
    "Pression huile moteur": {
        "min": 275,
        "niveau": "critique",
        "unite": "kPa",
        "note": "Le fichier seuils mentionne aussi min 140 kPa à 750 +-30 rpm",
        "source_seuil": "seulles.xlsx",
    },
    "Pression pompe hydraulique principale": {
        "min": 15000,
        "max": 25000,
        "niveau": "attention",
        "unite": "kPa",
        "source_seuil": "seulles.xlsx",
    },
    "Pression pompe hydraulique": {
        "min": 15000,
        "max": 25000,
        "niveau": "attention",
        "unite": "kPa",
        "source_seuil": "seulles.xlsx",
    },
    "Pression d'air au réservoir": {
        "min": 600,
        "max": 900,
        "niveau": "attention",
        "unite": "kPa",
        "source_seuil": "seulles.xlsx",
    },
    "Pression sortie convertisseur": {
        "min": 370,
        "max": 570,
        "niveau": "attention",
        "unite": "kPa",
        "source_seuil": "seulles.xlsx",
    },
    "Pression lockup": {
        "min": 2135,
        "max": 2275,
        "niveau": "attention",
        "unite": "kPa",
        "source_seuil": "seulles.xlsx",
    },
    "Pression entrée convertisseur": {
        "min": 800,
        "max": 1000,
        "niveau": "attention",
        "unite": "kPa",
        "source_seuil": "seulles.xlsx",
    },
    "Pression embrayage impeller": {
        "min": 1860,
        "max": 1870,
        "niveau": "attention",
        "unite": "kPa",
        "source_seuil": "seulles.xlsx",
    },
    "Pression auto-graissage": {
        "min": 15000,
        "max": 21000,
        "niveau": "attention",
        "unite": "kPa",
        "source_seuil": "seulles.xlsx",
    },
    "Pression gasoil": {
        "min": 450,
        "niveau": "attention",
        "unite": "kPa",
        "note": "Le fichier seuils mentionne aussi min 415 kPa à 1000 rpm",
        "source_seuil": "seulles.xlsx",
    },

    # ── Régime / courant ─────────────────────────────────────
    "Régime moteur": {
        "max": 1750,
        "niveau": "critique",
        "unite": "Tr/min",
        "source_seuil": "seulles.xlsx",
    },
}

CAPTEUR_LABELS = {
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


def clean_param_name(param: str) -> str:
    s = str(param).strip()
    s = re.sub(r"^CH\d+\.(P\d+)\.", "", s, flags=re.IGNORECASE)
    return s.strip()


def find_capteur_rule(parametre: str):
    clean_param = clean_param_name(parametre).lower()

    for key, rule in CAPTEUR_THRESHOLDS.items():
        key_lower = key.lower()
        if key_lower in clean_param or clean_param in key_lower:
            return key, rule

    return None, None


def get_capteur_label(parametre: str) -> str:
    key, _ = find_capteur_rule(parametre)
    if key:
        return CAPTEUR_LABELS.get(key, clean_param_name(parametre))
    return clean_param_name(parametre)
