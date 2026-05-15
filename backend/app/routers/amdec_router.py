# -*- coding: utf-8 -*-
"""
backend/app/routers/amdec_router.py
Router AMDEC + Maintenance Predictive - CAT 994F1 - OCP Benguerir

Endpoints :
  GET  /amdec/metadata          -> metadata complet (poids, RPN, seuils)
  GET  /amdec/health            -> Health Index actuel + historique
  GET  /amdec/diagnostic/{capteur} -> modes AMDEC + actions pour un capteur
  GET  /amdec/rapport           -> rapport complet en texte
  POST /amdec/predict           -> score anomalie pour une mesure temps reel
  GET  /amdec/summary           -> resume dashboard (health + alertes + top risques)
"""
import json
import os
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

BASE_DIR  = Path(__file__).resolve().parent.parent.parent
META_FILE = BASE_DIR / "app" / "maintenance_metadata_994F1.json"
MODEL_FILE= BASE_DIR / "models" / "isolation_forest_994F1.joblib"
RAPPORT_FILE = BASE_DIR / "resultats_ML" / "predictive_final" / "RAPPORT_AMDEC_COMPLET.txt"
CAPTEUR_DIR  = BASE_DIR / "data" / "capteurs"

_META_CACHE  = None
_MODEL_CACHE = None


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
def _load_meta() -> dict:
    global _META_CACHE
    if _META_CACHE is not None:
        return _META_CACHE
    if not META_FILE.exists():
        raise HTTPException(404, "Metadata AMDEC introuvable. Lancer amdec_integration.py")
    with open(META_FILE, encoding="utf-8") as f:
        _META_CACHE = json.load(f)
    return _META_CACHE


def _load_model():
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE
    if not MODEL_FILE.exists():
        raise HTTPException(404, "Modele IsolationForest introuvable. Lancer amdec_integration.py")
    _MODEL_CACHE = joblib.load(str(MODEL_FILE))
    return _MODEL_CACHE


SIX_PARAMS_MAP = {
    'CH994.P1.Température échappement Droit':       'T_Echap_D',
    'CH994.P1.Température échappement gauche':      'T_Echap_G',
    'CH994.P1.Pression huile moteur':               'P_Huile',
    'CH994.P1.Régime moteur':                       'Regime',
    'CH994.P1.Température liquide refroidissement': 'T_Refroid',
    'CH994.P1.Température sortie convertisseur':    'T_Convert',
}


# ─────────────────────────────────────────────────────────────
# GET /amdec/metadata
# ─────────────────────────────────────────────────────────────
@router.get("/metadata")
def get_metadata():
    """Retourne toute la metadata : poids AMDEC, RPN, seuils, stats capteurs."""
    meta = _load_meta()
    return {
        "modele":             meta.get("modele"),
        "version":            meta.get("version"),
        "date_entrainement":  meta.get("date_entrainement"),
        "periode_data":       meta.get("periode_data"),
        "capteurs":           meta.get("capteurs"),
        "seuils_alarme":      meta.get("seuils_alarme"),
        "poids_amdec":        meta.get("poids_amdec"),
        "rpn_details":        meta.get("rpn_details"),
        "threshold_anomaly":  meta.get("threshold_anomaly"),
        "health_index":       meta.get("health_index"),
        "stats_capteurs":     meta.get("stats_capteurs"),
    }


# ─────────────────────────────────────────────────────────────
# GET /amdec/health
# ─────────────────────────────────────────────────────────────
@router.get("/health")
def get_health(jours: int = 30):
    """
    Retourne le Health Index actuel et l'historique sur N jours.
    Calcule en temps reel depuis les fichiers capteurs.
    """
    meta   = _load_meta()
    poids  = meta["poids_amdec"]
    seuils = meta["seuils_alarme"]
    stats  = meta["stats_capteurs"]

    # Charger dernieres donnees capteurs
    try:
        dfs = []
        for f in sorted(CAPTEUR_DIR.glob("*.xlsx")):
            try:
                df = pd.read_excel(str(f), header=8)
                df.columns = ['Engin','Parametre','Code','Heure','Val_min',
                              'Val_moy','Val_max','Unite','Capteur_OK']
                df['Heure']   = pd.to_datetime(df['Heure'], errors='coerce')
                df['Val_moy'] = pd.to_numeric(df['Val_moy'], errors='coerce')
                df = df[df['Heure'].notna() & df['Val_moy'].notna()]
                df['Param'] = df['Parametre'].str.strip().map(SIX_PARAMS_MAP)
                df = df[df['Param'].notna()]
                dfs.append(df[['Heure', 'Param', 'Val_moy']])
            except Exception:
                continue

        if not dfs:
            raise HTTPException(503, "Aucune donnee capteur disponible")

        df_all = pd.concat(dfs, ignore_index=True)
        df_all = df_all.drop_duplicates(subset=['Heure', 'Param']).sort_values('Heure')
        df_ts  = (df_all.pivot(index='Heure', columns='Param', values='Val_moy')
                        .rename_axis(None, axis=1))
        df_ts  = df_ts.resample('1h').mean().interpolate(limit=6).dropna()

        # Filtrer sur N jours
        cutoff = df_ts.index.max() - pd.Timedelta(days=jours)
        df_ts  = df_ts[df_ts.index >= cutoff]

        # Calculer Health Index
        scores_df = pd.DataFrame(index=df_ts.index)
        for col in df_ts.columns:
            if col not in seuils:
                continue
            s    = seuils[col]
            w    = float(poids.get(col, 1.0))
            if col == 'P_Huile':
                p_nom = 3 * s
                ratio = (df_ts[col] - s) / (p_nom - s)
            else:
                p_nom = 0.60 * s
                ratio = 1.0 - (df_ts[col] - p_nom) / (s - p_nom)
            scores_df[col] = ratio.clip(0, 1) * 100 * w

        total_w = sum(float(poids.get(c, 1.0)) for c in df_ts.columns if c in seuils)
        health  = (scores_df.sum(axis=1) / total_w).rolling(4, min_periods=1).mean().clip(0, 100)

        # Capteur le plus stresse
        last = df_ts.iloc[-1] if len(df_ts) > 0 else pd.Series()
        capteur_stress = {}
        for col in df_ts.columns:
            if col not in seuils:
                continue
            s = seuils[col]
            v = float(last.get(col, stats[col]['mean']))
            if col == 'P_Huile':
                pct = max(0, (s * 1.5 - v) / (s * 1.5) * 100)
            else:
                pct = max(0, (v - s * 0.7) / (s * 0.3) * 100)
            capteur_stress[col] = round(min(100, pct), 1)

        historique = [
            {"date": str(idx.date()), "health": round(float(v), 1)}
            for idx, v in health.resample('D').mean().items()
            if not np.isnan(v)
        ]

        current_health = round(float(health.iloc[-1]), 1) if len(health) > 0 else 0.0

        return {
            "health_actuel":   current_health,
            "statut":          "BON" if current_health >= 80 else
                               "ATTENTION" if current_health >= 60 else "ALERTE",
            "capteur_stress":  capteur_stress,
            "historique":      historique[-jours:],
            "health_moyen":    round(float(health.mean()), 1),
            "pct_bon":         round(float((health >= 80).mean() * 100), 1),
            "pct_attention":   round(float(((health >= 60) & (health < 80)).mean() * 100), 1),
            "pct_alerte":      round(float((health < 60).mean() * 100), 1),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Erreur calcul health: {str(e)}")


# ─────────────────────────────────────────────────────────────
# GET /amdec/diagnostic/{capteur}
# ─────────────────────────────────────────────────────────────
@router.get("/diagnostic/{capteur}")
def get_diagnostic(capteur: str):
    """
    Retourne les modes de defaillance AMDEC + actions pour un capteur donne.
    capteur : T_Echap_D | T_Echap_G | P_Huile | Regime | T_Refroid | T_Convert
    """
    meta  = _load_meta()
    table = meta.get("table_diagnostic", {})

    if capteur not in table:
        valides = list(table.keys())
        raise HTTPException(404, f"Capteur '{capteur}' inconnu. Valides : {valides}")

    data   = table[capteur]
    seuils = meta["seuils_alarme"]
    stats  = meta["stats_capteurs"]
    rpn    = meta["rpn_details"].get(capteur, {})

    return {
        "capteur":        capteur,
        "seuil_alarme":   seuils.get(capteur),
        "valeur_max_observee": stats[capteur]["max"] if capteur in stats else None,
        "a_depasse_seuil": (stats[capteur]["max"] > seuils[capteur]
                            if capteur in stats and capteur in seuils else False),
        "rpn_moyen":      rpn.get("rpn_moy"),
        "modes_critiques_g1": rpn.get("modes_critiques", 0),
        "circuits_amdec": data["circuits_amdec"],
        "nb_modes_total": data["nb_modes_total"],
        "top_modes":      data["top_modes"],
    }


# ─────────────────────────────────────────────────────────────
# GET /amdec/rapport
# ─────────────────────────────────────────────────────────────
@router.get("/rapport")
def get_rapport():
    """Retourne le rapport AMDEC complet en texte."""
    if not RAPPORT_FILE.exists():
        raise HTTPException(404, "Rapport introuvable. Lancer amdec_integration.py")
    with open(str(RAPPORT_FILE), encoding="utf-8") as f:
        contenu = f.read()
    return {"rapport": contenu, "date_generation": str(RAPPORT_FILE.stat().st_mtime)}


# ─────────────────────────────────────────────────────────────
# POST /amdec/predict
# ─────────────────────────────────────────────────────────────
class MesureTempsReel(BaseModel):
    T_Echap_D: float
    T_Echap_G: float
    P_Huile:   float
    Regime:    float
    T_Refroid: float
    T_Convert: float

@router.post("/predict")
def predict_anomalie(mesure: MesureTempsReel):
    """
    Calcule le score d'anomalie IsolationForest + Health Index pour une mesure.
    Retourne le niveau de risque et les capteurs les plus stresses.
    """
    meta   = _load_meta()
    bundle = _load_model()
    iso    = bundle["model"]
    scaler = bundle["scaler"]
    feat_names = bundle["features"]
    seuils = meta["seuils_alarme"]
    poids  = meta["poids_amdec"]

    vals = {
        'T_Echap_D': mesure.T_Echap_D,
        'T_Echap_G': mesure.T_Echap_G,
        'P_Huile':   mesure.P_Huile,
        'Regime':    mesure.Regime,
        'T_Refroid': mesure.T_Refroid,
        'T_Convert': mesure.T_Convert,
    }

    # Construire le vecteur de features (valeurs brutes + features derives simples)
    x = {}
    for col, v in vals.items():
        x[col] = v
        s = seuils.get(col, 1)
        x[f'{col}_dist_norm'] = (v - s*0.7) / (s*0.3) if col != 'P_Huile' else (s - v) / s
        for w_name in ['15min', '1h', '4h', '12h']:
            x[f'{col}_mean_{w_name}'] = v  # sans historique -> valeur actuelle
            x[f'{col}_std_{w_name}']  = 0.0
        x[f'{col}_diff_1h']  = 0.0
        x[f'{col}_mean_24h'] = v
        x[f'{col}_dev_24h']  = 0.0

    x['delta_echap']    = abs(vals['T_Echap_D'] - vals['T_Echap_G'])
    x['T_echap_moy']    = (vals['T_Echap_D'] + vals['T_Echap_G']) / 2
    x['ratio_P_Regime'] = vals['P_Huile'] / max(vals['Regime'], 100)
    x['corr_echap']     = 1.0
    x['heure_sin']      = np.sin(2 * np.pi * datetime.now().hour / 24)
    x['heure_cos']      = np.cos(2 * np.pi * datetime.now().hour / 24)

    # Aligner sur les features du modele
    x_vec = np.array([x.get(f, 0.0) for f in feat_names]).reshape(1, -1)
    x_sc  = scaler.transform(x_vec)

    # Score anomalie
    raw_score  = float(-iso.score_samples(x_sc)[0])
    threshold  = meta["threshold_anomaly"]

    # Health Index
    scores_hi = {}
    for col, v in vals.items():
        if col not in seuils:
            continue
        s = seuils[col]
        w = float(poids.get(col, 1.0))
        if col == 'P_Huile':
            ratio = (v - s) / (3*s - s)
        else:
            ratio = 1.0 - (v - s*0.6) / (s*0.4)
        scores_hi[col] = max(0, min(100, ratio * 100 * w))
    total_w = sum(float(poids.get(c, 1.0)) for c in vals if c in seuils)
    health  = round(sum(scores_hi.values()) / total_w, 1)

    # Capteurs en alerte
    alertes = []
    for col, v in vals.items():
        s = seuils.get(col)
        if s is None:
            continue
        if col == 'P_Huile' and v < s:
            alertes.append({"capteur": col, "valeur": v, "seuil": s, "type": "min"})
        elif col != 'P_Huile' and v > s:
            alertes.append({"capteur": col, "valeur": v, "seuil": s, "type": "max"})

    # Niveau de risque
    if alertes or health < 50:
        niveau = "CRITIQUE"
    elif health < 70:
        niveau = "ALERTE"
    elif health < 80:
        niveau = "ATTENTION"
    else:
        niveau = "NORMAL"

    return {
        "health_index":   health,
        "anomaly_score":  round(raw_score * 50, 1),  # normalise indicatif
        "niveau_risque":  niveau,
        "capteurs_alerte": alertes,
        "valeurs_recues": vals,
        "timestamp":      datetime.now().isoformat(),
    }


# ─────────────────────────────────────────────────────────────
# GET /amdec/summary
# ─────────────────────────────────────────────────────────────
@router.get("/summary")
def get_summary():
    """Resume pour le dashboard : health actuel + top risques AMDEC."""
    meta = _load_meta()
    hi   = meta.get("health_index", {})
    rpn  = meta.get("rpn_details", {})

    # Top 3 capteurs par RPN
    top_risques = sorted(
        [{"capteur": k, **v} for k, v in rpn.items()],
        key=lambda x: x["rpn_moy"], reverse=True
    )[:3]

    # Points d'attention (capteurs qui ont depasse leur seuil)
    stats   = meta.get("stats_capteurs", {})
    seuils  = meta.get("seuils_alarme", {})
    alertes = []
    for col, s in stats.items():
        seuil = seuils.get(col, 0)
        if col == 'T_Echap_G' and s['max'] > seuil:
            alertes.append({"capteur": col, "max": s['max'], "seuil": seuil,
                             "message": "Seuil depasse - verifier turbocompresseur"})
        elif col == 'T_Refroid' and s['max'] > seuil:
            alertes.append({"capteur": col, "max": s['max'], "seuil": seuil,
                             "message": "Seuil depasse - verifier circuit refroidissement"})
        elif col == 'T_Convert' and s['max'] > seuil * 0.97:
            alertes.append({"capteur": col, "max": s['max'], "seuil": seuil,
                             "message": "Tres proche du seuil - surveiller transmission"})

    return {
        "health_moyen":    hi.get("moyenne_annuelle"),
        "pct_bon":         hi.get("pct_bon"),
        "pct_alerte":      hi.get("pct_alerte"),
        "top_risques_amdec": top_risques,
        "alertes_historiques": alertes,
        "periode":         meta.get("periode_data"),
        "modele_version":  meta.get("version"),
        "nb_modes_amdec":  sum(v.get("nb_modes", 0) for v in rpn.values()),
    }
