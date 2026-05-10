"""
ocp_history_router.py — MineAssist v1 (mai 2026)
================================================

Ingère les fichiers Excel maintenance OCP (arrêts + sorties échangées)
et expose des KPIs maintenance pour les dashboards.

FICHIERS LUS (placés dans backend/data/ocp/) :
  • Suivi_des_ARRETS_2025.xlsx     → 4450 arrêts toutes machines
  • Suivi_des_ARRETS_2026.xlsx     → 1968 arrêts (en cours)
  • suivi_des_SE_2023-2026.xlsx    → Sorties Échangées (pièces remplacées)

MAPPING ENGINS (nomenclature OCP) :
  CHF1 / CHF/1 / chf1  → CAT 994F1 (Chargeuse 1)
  CHF2 / CHF/2         → CAT 994F2 (Chargeuse 2)
  CH994F1, CH994F2     → utilisé dans suivi SE

ENDPOINTS :
  GET  /history/status                  → état du module + nb fichiers chargés
  GET  /history/arrets/stats            → KPIs (total, durée moyenne, MTBF…)
  GET  /history/arrets/list             → liste paginée filtrable par engin
  GET  /history/arrets/types            → top types d'arrêts (regex sur descriptions)
  GET  /history/arrets/timeline         → arrêts par mois pour graphique
  GET  /history/se/stats                → KPIs sorties échangées
  GET  /history/se/types                → répartition par type de pièce

INTEGRATION :
  Dans backend/app/api.py :
      from app.ocp_history_router import history_router
      app.include_router(history_router)
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Query

history_router = APIRouter(prefix="/history", tags=["Historique Maintenance OCP"])

# ──────────────────────────────────────────────────────────────────────
#  Configuration
# ──────────────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).parent.parent / "data" / "ocp"

FILE_ARRETS_2025 = "Suivi_des_ARRETS_2025.xlsx"
FILE_ARRETS_2026 = "Suivi_des_ARRETS_2026.xlsx"
FILE_SE          = "suivi_des_SE_2023-2026.xlsx"

# Mapping nomenclature OCP → nom standard
ENGINS_MAP = {
    "994F1": ["CHF1", "CHF/1", "chf1", "CH994F1", "994F1"],
    "994F2": ["CHF2", "CHF/2", "chf2", "CH994F2", "994F2"],
}

# Catégorisation des descriptions d'arrêts (regex sur description)
TYPES_PANNES = {
    "fuite":          r"\bfuit",
    "huile_demande":  r"\b(?:demande|complim?ent|appoint)\s+(?:huile|hyd|d'huile)",
    "echauffement":   r"\b(?:[ée]chauffement|surchauffe|temp[ée]rature)",
    "pression":       r"\b(?:pression|p\.\s*basse)",
    "graisse":        r"\bgraissag?e",
    "pneumatique":    r"\b(?:pneu|pneumatique)",
    "filtre":         r"\bfiltr",
    "demarrage":      r"\b(?:d[ée]marrage|ne\s+d[ée]marre)",
    "ctr":            r"\b(?:ctr|contr[oô]le|inspection)",
    "moteur":         r"\bmoteur\b",
    "transmission":   r"\b(?:bv|bo[iî]te|transmission|convertisseur)",
    "freinage":       r"\b(?:frein|freinage)",
    "electrique":     r"\b(?:[ée]lectrique|c[aâ]ble|batterie)",
    "axe_articulation": r"\baxes?\b|\barticulation",
}

# ──────────────────────────────────────────────────────────────────────
#  Cache en mémoire (chargement à la demande)
# ──────────────────────────────────────────────────────────────────────
_cache = {
    "arrets":  None,   # DataFrame concat 2025+2026
    "se":      None,   # DataFrame concat des feuilles
    "loaded":  False,
    "errors":  [],
}


def _normalize_engin(equip: str) -> Optional[str]:
    """CHF1, chf/1, CH994F1 → '994F1' (sinon None)."""
    if not isinstance(equip, str):
        return None
    e = equip.strip()
    for std, variants in ENGINS_MAP.items():
        for v in variants:
            if e.lower() == v.lower() or e.upper().replace(" ", "") == v.upper().replace(" ", ""):
                return std
    return None


def _hms_to_minutes(v) -> Optional[float]:
    """Convertit datetime.time / 'HH:MM' / float Excel → minutes."""
    if v is None or pd.isna(v):
        return None
    if isinstance(v, (int, float)):
        # Excel : fraction de jour
        return float(v) * 24 * 60
    s = str(v)
    m = re.match(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", s)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2)) + (int(m.group(3) or 0) / 60)
    return None


def _classify_panne(desc: str) -> list[str]:
    """Renvoie les catégories qui matchent (≥1)."""
    if not isinstance(desc, str):
        return []
    out = []
    low = desc.lower()
    for cat, pattern in TYPES_PANNES.items():
        if re.search(pattern, low):
            out.append(cat)
    return out or ["autre"]


def _load_arrets() -> pd.DataFrame:
    """Charge les 2 fichiers d'arrêts et concatène."""
    frames = []
    for fname, year in [(FILE_ARRETS_2025, 2025), (FILE_ARRETS_2026, 2026)]:
        path = DATA_DIR / fname
        if not path.exists():
            _cache["errors"].append(f"Fichier introuvable : {path}")
            continue
        try:
            # Le fichier 2026 a 16k+ colonnes "Unnamed" parasites, on filtre
            xl = pd.ExcelFile(path)
            sheet = xl.sheet_names[0]
            # Lire d'abord pour connaître la largeur réelle
            df = pd.read_excel(path, sheet_name=sheet, header=0)
            # Garder les colonnes nommées proprement
            df = df.loc[:, ~df.columns.astype(str).str.startswith("Unnamed")]
            df["_annee"] = year
            df["_fichier"] = fname
            frames.append(df)
        except Exception as e:
            _cache["errors"].append(f"Erreur lecture {fname}: {e}")

    if not frames:
        return pd.DataFrame()

    all_df = pd.concat(frames, ignore_index=True)

    # Nettoyage
    if "Equipement" in all_df.columns:
        all_df["engin_std"] = all_df["Equipement"].astype(str).apply(_normalize_engin)
    else:
        all_df["engin_std"] = None

    if "Durée" in all_df.columns:
        all_df["duree_min"] = all_df["Durée"].apply(_hms_to_minutes)
    elif "Duree" in all_df.columns:
        all_df["duree_min"] = all_df["Duree"].apply(_hms_to_minutes)
    else:
        all_df["duree_min"] = None

    if "Description Arrêt" in all_df.columns:
        all_df["categories"] = all_df["Description Arrêt"].apply(_classify_panne)
    else:
        all_df["categories"] = [[] for _ in range(len(all_df))]

    return all_df


def _load_se() -> pd.DataFrame:
    """Charge le fichier des sorties échangées (toutes feuilles)."""
    path = DATA_DIR / FILE_SE
    if not path.exists():
        _cache["errors"].append(f"Fichier introuvable : {path}")
        return pd.DataFrame()
    try:
        xl = pd.ExcelFile(path)
        frames = []
        for sheet in xl.sheet_names:
            try:
                df = pd.read_excel(path, sheet_name=sheet, header=1,
                                  usecols=list(range(10)))
                df["_feuille"] = sheet
                frames.append(df)
            except Exception:
                continue
        if not frames:
            return pd.DataFrame()
        all_df = pd.concat(frames, ignore_index=True)
        if "ENGIN" in all_df.columns:
            all_df["engin_std"] = all_df["ENGIN"].astype(str).apply(_normalize_engin)
        return all_df
    except Exception as e:
        _cache["errors"].append(f"Erreur lecture {FILE_SE}: {e}")
        return pd.DataFrame()


def _ensure_loaded():
    if _cache["loaded"]:
        return
    print("[ocp_history] Chargement des fichiers Excel OCP...")
    _cache["arrets"] = _load_arrets()
    _cache["se"]     = _load_se()
    _cache["loaded"] = True
    n_arrets = len(_cache["arrets"]) if _cache["arrets"] is not None else 0
    n_se = len(_cache["se"]) if _cache["se"] is not None else 0
    print(f"[ocp_history] OK — {n_arrets} arrêts, {n_se} sorties échangées chargés.")


# ──────────────────────────────────────────────────────────────────────
#  Endpoints
# ──────────────────────────────────────────────────────────────────────

@history_router.get("/status")
def history_status():
    """État du module et fichiers chargés."""
    _ensure_loaded()
    a = _cache["arrets"]
    s = _cache["se"]
    return {
        "ok": True,
        "data_dir": str(DATA_DIR),
        "files_present": {
            FILE_ARRETS_2025: (DATA_DIR / FILE_ARRETS_2025).exists(),
            FILE_ARRETS_2026: (DATA_DIR / FILE_ARRETS_2026).exists(),
            FILE_SE:          (DATA_DIR / FILE_SE).exists(),
        },
        "n_arrets":             0 if a is None else len(a),
        "n_arrets_chf":         0 if a is None else int(a["engin_std"].notna().sum()),
        "n_sorties_echangees":  0 if s is None else len(s),
        "errors": _cache["errors"],
        "version": "v1",
    }


@history_router.get("/arrets/stats")
def arrets_stats(engin: str = Query("994F1", description="994F1 ou 994F2 ou 'all'")):
    """KPIs maintenance : total, durée moyenne, MTBF, durée totale."""
    _ensure_loaded()
    df = _cache["arrets"]
    if df is None or df.empty:
        return {"ok": False, "message": "Aucune donnée chargée"}

    if engin and engin.lower() != "all":
        df = df[df["engin_std"] == engin]

    durees = df["duree_min"].dropna()
    n = len(df)

    # MTBF = durée totale / nombre d'arrêts (en heures)
    if n > 1 and "DATE" in df.columns:
        try:
            dates = pd.to_datetime(df["DATE"], errors='coerce').dropna()
            if len(dates) > 1:
                span_hours = (dates.max() - dates.min()).total_seconds() / 3600
                mtbf_h = round(span_hours / n, 1) if n > 0 else 0
            else:
                mtbf_h = None
        except Exception:
            mtbf_h = None
    else:
        mtbf_h = None

    return {
        "engin":              engin,
        "n_arrets":           int(n),
        "duree_moyenne_min":  round(float(durees.mean()), 1) if len(durees) > 0 else None,
        "duree_mediane_min":  round(float(durees.median()), 1) if len(durees) > 0 else None,
        "duree_totale_h":     round(float(durees.sum() / 60), 1) if len(durees) > 0 else None,
        "duree_max_min":      round(float(durees.max()), 1) if len(durees) > 0 else None,
        "mtbf_heures":        mtbf_h,
        "annees_couvertes":   sorted(df["_annee"].dropna().unique().tolist()) if "_annee" in df else [],
    }


@history_router.get("/arrets/types")
def arrets_types(engin: str = Query("994F1")):
    """Top types de pannes par fréquence (basé sur les regex de catégorisation)."""
    _ensure_loaded()
    df = _cache["arrets"]
    if df is None or df.empty:
        return {"ok": False, "items": []}

    if engin and engin.lower() != "all":
        df = df[df["engin_std"] == engin]

    counts = {}
    for cats in df["categories"]:
        for c in (cats or []):
            counts[c] = counts.get(c, 0) + 1

    items = sorted(
        [{"type": k, "count": v} for k, v in counts.items()],
        key=lambda x: -x["count"],
    )

    return {"engin": engin, "n_total": int(len(df)), "items": items}


@history_router.get("/arrets/list")
def arrets_list(engin: str = Query("994F1"),
                limit: int = Query(50, ge=1, le=500),
                offset: int = Query(0, ge=0),
                category: Optional[str] = None):
    """Liste paginée des arrêts."""
    _ensure_loaded()
    df = _cache["arrets"]
    if df is None or df.empty:
        return {"ok": False, "items": []}

    if engin and engin.lower() != "all":
        df = df[df["engin_std"] == engin]

    if category:
        df = df[df["categories"].apply(lambda cs: category in (cs or []))]

    # Tri par date desc
    if "DATE" in df.columns:
        df = df.sort_values("DATE", ascending=False, na_position="last")

    sliced = df.iloc[int(offset):int(offset) + int(limit)]
    items = []
    for _, row in sliced.iterrows():
        items.append({
            "date":           str(row.get("DATE", ""))[:10],
            "equipement":     str(row.get("Equipement", "")),
            "engin_std":      row.get("engin_std", ""),
            "debut":          str(row.get("Début Arrêt", ""))[:10],
            "fin":            str(row.get("Fin Arrêt", ""))[:10],
            "description":    str(row.get("Description Arrêt", ""))[:200],
            "duree_min":      None if pd.isna(row.get("duree_min")) else float(row.get("duree_min")),
            "intervenant":    str(row.get("Intervenant / ou avisé", "") or row.get("Intervenant", "")),
            "categories":     row.get("categories", []),
            "annee":          int(row.get("_annee", 0)) if not pd.isna(row.get("_annee", 0)) else None,
        })
    return {
        "engin":   engin,
        "total":   int(len(df)),
        "limit":   limit,
        "offset":  offset,
        "items":   items,
    }


@history_router.get("/arrets/timeline")
def arrets_timeline(engin: str = Query("994F1")):
    """Arrêts groupés par mois (pour graphique d'évolution)."""
    _ensure_loaded()
    df = _cache["arrets"]
    if df is None or df.empty or "DATE" not in df.columns:
        return {"ok": False, "items": []}

    if engin and engin.lower() != "all":
        df = df[df["engin_std"] == engin]

    try:
        df = df.copy()
        df["mois"] = pd.to_datetime(df["DATE"], errors='coerce').dt.to_period("M").astype(str)
        grp = df.groupby("mois").agg(
            n_arrets=("DATE", "count"),
            duree_totale_min=("duree_min", "sum"),
        ).reset_index()
        grp = grp[grp["mois"] != "NaT"].sort_values("mois")
        items = grp.to_dict(orient="records")
        for it in items:
            it["duree_totale_min"] = round(float(it["duree_totale_min"] or 0), 1)
        return {"engin": engin, "items": items}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@history_router.get("/se/stats")
def se_stats(engin: str = Query("994F1")):
    """KPIs sorties échangées."""
    _ensure_loaded()
    df = _cache["se"]
    if df is None or df.empty:
        return {"ok": False, "items": []}

    if engin and engin.lower() != "all":
        df = df[df["engin_std"] == engin]

    types_col = "Type de S/E" if "Type de S/E" in df.columns else None
    types_count = []
    if types_col:
        vc = df[types_col].dropna().astype(str).value_counts().head(15)
        types_count = [{"type": k, "count": int(v)} for k, v in vc.items()]

    return {
        "engin":         engin,
        "n_total":       int(len(df)),
        "annees":        sorted(df["_feuille"].dropna().unique().tolist()) if "_feuille" in df else [],
        "types":         types_count,
    }
