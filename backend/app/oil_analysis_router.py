"""
oil_analysis_router.py
══════════════════════════════════════════════════════════════════════════════
Router FastAPI pour la gestion des analyses d'huile OKSA — CAT 994F
OCP Benguerir · MineAssist

Endpoints :
  GET  /oil/analyses          → Liste des analyses (avec filtres)
  GET  /oil/analyses/{id}     → Détail d'une analyse
  POST /oil/analyses          → Créer/importer une analyse
  GET  /oil/analyses/summary  → KPIs et état global
  GET  /oil/composants        → Liste des composants suivis
  GET  /oil/tendances         → Évolution temporelle d'un paramètre
  POST /oil/parse-oksa        → Extraire les données depuis un rapport OKSA (JSON)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, date
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends, UploadFile, File
from pydantic import BaseModel, Field

# ── Auth (adapter selon auth.py du projet) ──────────────────────────────────
try:
    from app.auth import get_current_user
    AUTH_ENABLED = True
except ImportError:
    AUTH_ENABLED = False
    def get_current_user(): return {"username": "anonymous", "role": "viewer"}

router = APIRouter(prefix="/oil", tags=["Analyses Huile"])

# ── Chemins de stockage ──────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "oil_analyses"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_FILE = DATA_DIR / "oil_analyses_db.json"
PDF_DIR = DATA_DIR / "pdf"
PDF_DIR.mkdir(parents=True, exist_ok=True)


# ════════════════════════════════════════════════════════════════════════════
# Modèles Pydantic
# ════════════════════════════════════════════════════════════════════════════

class MetauxUsure(BaseModel):
    fe:  Optional[float] = None   # Fer
    cr:  Optional[float] = None   # Chrome
    ni:  Optional[float] = None   # Nickel
    al:  Optional[float] = None   # Aluminium
    cu:  Optional[float] = None   # Cuivre
    pb:  Optional[float] = None   # Plomb
    sn:  Optional[float] = None   # Étain
    v:   Optional[float] = None   # Vanadium
    ag:  Optional[float] = None   # Argent


class MetauxAdditifs(BaseModel):
    ca:  Optional[float] = None   # Calcium
    p:   Optional[float] = None   # Phosphore
    zn:  Optional[float] = None   # Zinc
    mg:  Optional[float] = None   # Magnésium
    mo:  Optional[float] = None   # Molybdène
    b:   Optional[float] = None   # Bore
    s:   Optional[float] = None   # Soufre


class MetauxContaminants(BaseModel):
    si:  Optional[float] = None   # Silicium
    na:  Optional[float] = None   # Sodium
    k:   Optional[float] = None   # Potassium


class PhysicoChimique(BaseModel):
    viscosite_40:       Optional[float] = None
    viscosite_100:      Optional[float] = None
    tan:                Optional[float] = None
    tbn:                Optional[float] = None
    point_eclair:       Optional[float] = None
    oxydation:          Optional[float] = None
    sulfate:            Optional[float] = None
    nitrate:            Optional[float] = None
    phosphate_ant:      Optional[float] = None
    suie:               Optional[float] = None
    glycol:             Optional[float] = None
    dilution_diesel:    Optional[float] = None


class Particules(BaseModel):
    n_sup_4um:          Optional[int] = None
    n_sup_6um:          Optional[int] = None
    n_sup_14um:         Optional[int] = None
    code_iso_4406:      Optional[str] = None


class OilAnalysis(BaseModel):
    id:                 Optional[str] = None
    rapport_numero:     str
    machine:            str = "CAT 994F2"
    numero_serie:       Optional[str] = "53492"
    composant:          str             # PONT AR, PONT AV, PTO, MOTEUR, TRANSMISSION...
    grade_huile:        Optional[str] = None
    date_prelevement:   Optional[str] = None
    date_reception:     Optional[str] = None
    date_fin_analyse:   Optional[str] = None
    heures_engin:       Optional[int] = None
    laboratoire:        Optional[str] = "OKSA Rabat"
    etat_machine:       Optional[str] = None  # CRITIQUE / MARGINALE / NORMALE
    etat_lubrifiant:    Optional[str] = None  # CRITIQUE / MARGINALE / NORMALE
    physico_chimique:   Optional[PhysicoChimique] = None
    metaux_usure:       Optional[MetauxUsure] = None
    metaux_additifs:    Optional[MetauxAdditifs] = None
    metaux_contaminants: Optional[MetauxContaminants] = None
    particules:         Optional[Particules] = None
    recommandations:    Optional[List[str]] = Field(default_factory=list)
    alertes:            Optional[List[str]] = Field(default_factory=list)
    created_at:         Optional[str] = None


class OksaRawInput(BaseModel):
    """Permet de poster des données brutes extraites d'un rapport OKSA."""
    rapport_numero:     str
    composant:          str
    date_prelevement:   Optional[str] = None
    raw_values:         Dict[str, Any] = Field(default_factory=dict)


# ════════════════════════════════════════════════════════════════════════════
# Persistance JSON simple (remplaçable par SQLite/PostgreSQL)
# ════════════════════════════════════════════════════════════════════════════

def _load_db() -> List[dict]:
    if not DB_FILE.exists():
        return _seed_db()
    try:
        return json.loads(DB_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_db(data: List[dict]) -> None:
    DB_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _worst_status(etat_machine: Optional[str], etat_lubrifiant: Optional[str]) -> str:
    rank = {"NORMALE": 1, "MARGINALE": 2, "CRITIQUE": 3}
    machine = (etat_machine or "NORMALE").upper()
    lub = (etat_lubrifiant or "NORMALE").upper()
    return machine if rank.get(machine, 1) >= rank.get(lub, 1) else lub


def _date_key(analyse: dict) -> str:
    return (
        analyse.get("date_prelevement")
        or analyse.get("date_reception")
        or analyse.get("date_fin_analyse")
        or analyse.get("created_at")
        or ""
    )


VALID_COMPOSANTS = {"PONT AR", "PONT AV", "PTO", "MOTEUR",
                    "TRANSMISSION", "HYDRAULIQUE", "DIFFÉRENTIEL", "DIFFERENTIEL"}


def _normalize_composant(value: Any) -> str:
    return str(value or "").strip().upper()


def _is_valid_analyse(analyse: dict) -> bool:
    comp = _normalize_composant(analyse.get("composant"))
    rapport = str(analyse.get("rapport_numero") or analyse.get("id") or "").strip()
    if not comp or comp in {"STRING", "NULL", "NONE", "COMPOSANT"}:
        return False
    if comp not in VALID_COMPOSANTS:
        return False
    if not rapport or rapport.lower() in {"string", "null", "none"}:
        return False
    return True


def _valid_db() -> List[dict]:
    db = _load_db()
    cleaned = [a for a in db if isinstance(a, dict) and _is_valid_analyse(a)]
    if len(cleaned) != len(db):
        _save_db(cleaned)
    return cleaned


def _seed_db() -> List[dict]:
    """Données initiales issues des rapports OKSA fournis (avril 2026)."""
    initial = [
        {
            "id": "26-57744",
            "rapport_numero": "26-57744",
            "machine": "CAT 994F2",
            "numero_serie": "53492",
            "composant": "PONT AR",
            "grade_huile": "SAE 50",
            "date_prelevement": "2026-02-08",
            "date_reception": "2026-02-16",
            "date_fin_analyse": "2026-03-31",
            "heures_engin": 53492,
            "laboratoire": "OKSA Rabat",
            "etat_machine": "CRITIQUE",
            "etat_lubrifiant": "MARGINALE",
            "physico_chimique": {
                "viscosite_40": 138.2, "viscosite_100": None,
                "tan": 0.45, "tbn": None, "point_eclair": 204.0,
                "oxydation": 3.9, "sulfate": 15.6, "nitrate": 6.9,
                "phosphate_ant": 11.2
            },
            "metaux_usure": {
                "fe": 3.4, "cr": 1.2, "ni": 1.1, "al": 0.0,
                "cu": 5.2, "pb": 0.0, "sn": 0.3
            },
            "metaux_additifs": {
                "ca": 59.3, "p": 381.4, "zn": 76.9,
                "mg": 1.7, "mo": 1.3, "s": 48145.4
            },
            "metaux_contaminants": {"si": 6.2, "na": 6.2},
            "particules": {
                "n_sup_4um": 403654, "n_sup_6um": 218209,
                "n_sup_14um": 6410, "code_iso_4406": "23/22/16"
            },
            "recommandations": [
                "Ré-échantillonner à court terme pour suivi et confirmation.",
                "Respecter les conditions de prélèvement lors des prochains prélèvements."
            ],
            "alertes": ["CRITIQUE — état machine"],
            "created_at": "2026-04-13T00:00:00",
        },
        {
            "id": "26-57743",
            "rapport_numero": "26-57743",
            "machine": "CAT 994F2",
            "numero_serie": "53492",
            "composant": "PONT AV",
            "grade_huile": "SAE 50",
            "date_prelevement": "2026-02-08",
            "date_reception": "2026-02-16",
            "date_fin_analyse": "2026-03-31",
            "heures_engin": 53492,
            "laboratoire": "OKSA Rabat",
            "etat_machine": "CRITIQUE",
            "etat_lubrifiant": "CRITIQUE",
            "physico_chimique": {
                "viscosite_40": 50.6, "viscosite_100": None,
                "tan": 0.6, "tbn": None, "point_eclair": 200.0,
                "oxydation": 12.4, "sulfate": 28.4, "nitrate": 11.1,
                "phosphate_ant": 30.4
            },
            "metaux_usure": {
                "fe": 76.6, "cr": 1.7, "ni": 1.5, "al": 0.0,
                "cu": 19.5, "pb": 0.0, "sn": 0.3
            },
            "metaux_additifs": {
                "ca": 1570.6, "p": 571.4, "zn": 456.7,
                "mg": 9.4, "mo": 39.8, "s": 13770.9
            },
            "metaux_contaminants": {"si": 21.2, "na": 7.2},
            "particules": {
                "n_sup_4um": 401228, "n_sup_6um": 216594,
                "n_sup_14um": 64233, "code_iso_4406": "23/22/16"
            },
            "recommandations": ["VIDANGE À PRÉVOIR DANS LE PLUS BREF DÉLAI."],
            "alertes": [
                "CRITIQUE — viscosité 50.6 mm²/s (réf 200, hors seuil ±20%)",
                "CRITIQUE — état machine",
                "CRITIQUE — état lubrifiant",
            ],
            "created_at": "2026-04-13T00:00:00",
        },
        {
            "id": "26-57441",
            "rapport_numero": "26-57441",
            "machine": "CAT 994F2",
            "numero_serie": "53492",
            "composant": "PTO",
            "grade_huile": "80W90",
            "date_prelevement": "2026-02-08",
            "date_reception": "2026-02-16",
            "date_fin_analyse": "2026-03-31",
            "heures_engin": 53492,
            "laboratoire": "OKSA Rabat",
            "etat_machine": "CRITIQUE",
            "etat_lubrifiant": "CRITIQUE",
            "physico_chimique": {
                "viscosite_40": 145.3, "viscosite_100": None,
                "tan": 2.0, "tbn": None, "point_eclair": 190.0,
                "oxydation": 2.7, "sulfate": 14.7, "nitrate": 5.1,
                "phosphate_ant": 7.0
            },
            "metaux_usure": {
                "fe": 6.6, "cr": 0.1, "ni": 0.9, "al": 0.0,
                "cu": 2.7, "pb": 0.0, "sn": 0.3
            },
            "metaux_additifs": {
                "ca": 122.2, "p": 400.2, "zn": 52.1,
                "mg": 2.5, "mo": 1.2, "s": 42782.0
            },
            "metaux_contaminants": {"si": 7.2, "na": 6.0},
            "particules": {
                "n_sup_4um": 441269, "n_sup_6um": 250013,
                "n_sup_14um": 6623, "code_iso_4406": "23/22/17"
            },
            "recommandations": [
                "Continuer l'opération normalement.",
                "Rééchantillonner à intervalles courts.",
                "Respecter les conditions de prélèvement.",
            ],
            "alertes": ["CRITIQUE — état machine", "CRITIQUE — état lubrifiant"],
            "created_at": "2026-04-13T00:00:00",
        },
    ]
    _save_db(initial)
    return initial


# ════════════════════════════════════════════════════════════════════════════
# HELPERS — évaluation des seuils constructeur CAT 994F
# ════════════════════════════════════════════════════════════════════════════

# Seuils par grade d'huile (mg/kg)
SEUILS_METAUX: Dict[str, Dict] = {
    "SAE 50": {
        "fe": (60, 250), "al": (8, 16), "cu": (150, 900), "pb": (200, 300), "si": (30, 60),
    },
    "80W90": {
        "fe": (60, 250), "al": (8, 16), "cu": (150, 900), "pb": (200, 300), "si": (30, 60),
    },
}


def _evaluer_alertes(analyse: dict) -> List[str]:
    alertes = []
    grade = analyse.get("grade_huile", "SAE 50")
    seuils = SEUILS_METAUX.get(grade, SEUILS_METAUX["SAE 50"])

    pc = analyse.get("physico_chimique") or {}
    mu = analyse.get("metaux_usure") or {}

    # Viscosité ±20% de la référence
    visc = pc.get("viscosite_40")
    visc_ref = 200.0 if "SAE 50" in grade else 169.0
    if visc is not None:
        if visc < visc_ref * 0.80:
            alertes.append(
                f"Viscosité 40°C trop basse : {visc} mm²/s (réf {visc_ref}, seuil bas {visc_ref*0.8:.1f})")
        elif visc > visc_ref * 1.20:
            alertes.append(
                f"Viscosité 40°C trop haute : {visc} mm²/s (réf {visc_ref}, seuil haut {visc_ref*1.2:.1f})")

    # TAN
    tan = pc.get("tan")
    if tan is not None and tan > 2.4:
        alertes.append(f"TAN élevé : {tan} mgKOH/g (limite REF+0.4)")

    # Métaux d'usure
    for metal, (lo, hi) in seuils.items():
        val = mu.get(metal)
        if val is not None and val > hi:
            alertes.append(f"{metal.upper()} ({val} mg/kg) dépasse le seuil {hi} mg/kg")

    return alertes


# ════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ════════════════════════════════════════════════════════════════════════════

@router.get("/analyses", summary="Liste des analyses d'huile")
def list_analyses(
    composant:  Optional[str] = Query(
        None, description="Filtrer par composant (PONT AV, PONT AR, PTO...)"),
    etat:       Optional[str] = Query(
        None, description="Filtrer par état (CRITIQUE, MARGINALE, NORMALE)"),
    machine:    Optional[str] = Query("CAT 994F2"),
    limit:      int = Query(50, ge=1, le=200),
):
    db = _valid_db()

    if machine:
        db = [a for a in db if machine.upper() in (a.get("machine", "")).upper()]
    if composant:
        db = [a for a in db if composant.upper() in (a.get("composant", "")).upper()]
    if etat:
        db = [
            a for a in db
            if etat.upper() in [
                (a.get("etat_machine", "")).upper(),
                (a.get("etat_lubrifiant", "")).upper()
            ]
        ]

    # Tri par date décroissante
    db.sort(key=_date_key, reverse=True)
    return {"total": len(db), "analyses": db[:limit]}


@router.get("/analyses/summary", summary="KPIs globaux")
def summary():
    db = _valid_db()
    if not db:
        return {"total": 0, "critiques": 0, "marginales": 0, "normales": 0, "composants": []}

    statuts = [_worst_status(a.get("etat_machine"), a.get("etat_lubrifiant")) for a in db]
    critiques = sum(1 for s in statuts if "CRITIQUE" in s)
    marginales = sum(1 for s in statuts if "MARGINALE" in s)
    normales = sum(1 for s in statuts if "NORMALE" in s and "CRITIQUE" not in s)

    # Composants uniques avec leur dernier état
    composants_map: Dict[str, dict] = {}
    db_sorted = sorted(db, key=_date_key, reverse=True)
    for a in db_sorted:
        comp = a.get("composant", "")
        if comp not in composants_map:
            composants_map[comp] = {
                "composant": comp,
                "etat": _worst_status(a.get("etat_machine"), a.get("etat_lubrifiant")),
                "dernier_rapport": a.get("rapport_numero"),
                "date":  a.get("date_prelevement"),
                "alertes": a.get("alertes", []),
            }

    return {
        "total":      len(db),
        "critiques":  critiques,
        "marginales": marginales,
        "normales":   normales,
        "composants": list(composants_map.values()),
        "derniere_analyse": _date_key(db_sorted[0]) if db_sorted else None,
    }


@router.get("/analyses/{rapport_id}", summary="Détail d'une analyse")
def get_analyse(rapport_id: str):
    db = _valid_db()
    found = next((a for a in db if a.get("id") == rapport_id or a.get(
        "rapport_numero") == rapport_id), None)
    if not found:
        raise HTTPException(status_code=404, detail=f"Analyse '{rapport_id}' introuvable")
    return found


@router.post("/analyses", summary="Créer une nouvelle analyse")
def create_analyse(analyse: OilAnalysis):
    db = _valid_db()
    if not _is_valid_analyse(analyse.model_dump()):
        raise HTTPException(
            status_code=422, detail="Analyse huile invalide : composant ou rapport non reconnu.")

    # Vérifier doublon
    if any(a.get("rapport_numero") == analyse.rapport_numero for a in db):
        raise HTTPException(
            status_code=409, detail=f"Rapport {analyse.rapport_numero} déjà présent")

    new = analyse.model_dump()
    new["id"] = analyse.rapport_numero
    new["created_at"] = datetime.now().isoformat()
    new["alertes"] = _evaluer_alertes(new)

    db.append(new)
    _save_db(db)
    return {"status": "ok", "id": new["id"], "alertes_detectees": new["alertes"]}


@router.get("/composants", summary="Liste des composants surveillés")
def list_composants():
    db = _valid_db()
    comps = list({a.get("composant") for a in db if a.get("composant")})
    return {"composants": sorted(comps)}


@router.get("/tendances", summary="Évolution d'un paramètre dans le temps")
def tendances(
    composant: str = Query(..., description="Ex: PONT AV"),
    parametre: str = Query(
        "viscosite_40", description="physico_chimique.viscosite_40 ou metaux_usure.fe"),
):
    db = _valid_db()
    filtered = [
        a for a in db
        if composant.upper() in (a.get("composant", "")).upper()
    ]
    filtered.sort(key=_date_key)

    points = []
    for a in filtered:
        # Chercher le paramètre dans les sous-objets
        val = None
        for section in ["physico_chimique", "metaux_usure", "metaux_additifs", "metaux_contaminants"]:
            if a.get(section) and parametre in a[section]:
                val = a[section][parametre]
                break
        if val is not None:
            points.append({
                "date":    a.get("date_prelevement"),
                "rapport": a.get("rapport_numero"),
                "valeur":  val,
                "etat":    a.get("etat_lubrifiant", "NORMALE"),
            })

    return {
        "composant": composant,
        "parametre": parametre,
        "points":    points,
        "count":     len(points),
    }


@router.post("/parse-oksa", summary="Importer des valeurs brutes d'un rapport OKSA")
def parse_oksa(raw: OksaRawInput):
    """
    Transforme les valeurs brutes extraites d'un rapport OKSA
    en une structure OilAnalysis prête à être stockée.

    Exemple de raw_values :
    {
        "viscosite_40": 50.6, "tan": 0.6, "fe": 76.6, "cu": 19.5,
        "si": 21.2, "na": 7.2, "ca": 1570.6, "p": 571.4,
        "code_iso_4406": "23/22/16", "etat_machine": "CRITIQUE",
        "etat_lubrifiant": "CRITIQUE",
        "recommandations": ["VIDANGE À PRÉVOIR DANS LE PLUS BREF DÉLAI."]
    }
    """
    rv = raw.raw_values

    analyse = {
        "id":             raw.rapport_numero,
        "rapport_numero": raw.rapport_numero,
        "machine":        "CAT 994F2",
        "composant":      raw.composant,
        "date_prelevement": raw.date_prelevement,
        "created_at":     datetime.now().isoformat(),
        "physico_chimique": {
            "viscosite_40":   rv.get("viscosite_40"),
            "viscosite_100":  rv.get("viscosite_100"),
            "tan":            rv.get("tan"),
            "tbn":            rv.get("tbn"),
            "point_eclair":   rv.get("point_eclair"),
            "oxydation":      rv.get("oxydation"),
            "sulfate":        rv.get("sulfate"),
            "nitrate":        rv.get("nitrate"),
            "phosphate_ant":  rv.get("phosphate_ant"),
        },
        "metaux_usure": {
            "fe": rv.get("fe"), "cr": rv.get("cr"), "ni": rv.get("ni"),
            "al": rv.get("al"), "cu": rv.get("cu"), "pb": rv.get("pb"),
            "sn": rv.get("sn"),
        },
        "metaux_additifs": {
            "ca": rv.get("ca"), "p": rv.get("p"), "zn": rv.get("zn"),
            "mg": rv.get("mg"), "mo": rv.get("mo"), "s": rv.get("s"),
        },
        "metaux_contaminants": {
            "si": rv.get("si"), "na": rv.get("na"), "k": rv.get("k"),
        },
        "particules": {
            "n_sup_4um":  rv.get("n_sup_4um"),
            "n_sup_6um":  rv.get("n_sup_6um"),
            "n_sup_14um": rv.get("n_sup_14um"),
            "code_iso_4406": rv.get("code_iso_4406"),
        },
        "etat_machine":    rv.get("etat_machine"),
        "etat_lubrifiant": rv.get("etat_lubrifiant"),
        "recommandations": rv.get("recommandations", []),
        "grade_huile":     rv.get("grade_huile"),
        "heures_engin":    rv.get("heures_engin"),
        "laboratoire":     rv.get("laboratoire", "OKSA Rabat"),
    }

    alertes = _evaluer_alertes(analyse)
    analyse["alertes"] = alertes

    return {
        "status": "parsed",
        "analyse": analyse,
        "alertes_detectees": alertes,
        "conseil": (
            "Envoyer vers POST /oil/analyses pour persister cette analyse."
        ),
    }


@router.post("/upload-pdf", summary="Importer un rapport PDF OKSA")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Seuls les fichiers PDF sont acceptés.")

    safe_name = Path(file.filename).name
    pdf_path = PDF_DIR / safe_name
    pdf_path.write_bytes(await file.read())

    try:
        from app.oksa_parser import parse_oksa_pdf
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Parser OKSA indisponible : {exc}")

    parsed = parse_oksa_pdf(str(pdf_path))
    if not parsed.get("success"):
        raise HTTPException(
            status_code=422,
            detail=parsed.get("parse_error") or "Impossible d'extraire les données du PDF OKSA.",
        )

    db = _valid_db()
    rapport_numero = parsed.get("rapport_numero") or parsed.get("id") or pdf_path.stem
    db = [
        a for a in db
        if a.get("rapport_numero") != rapport_numero and a.get("id") != rapport_numero
    ]
    parsed["id"] = rapport_numero
    parsed["rapport_numero"] = rapport_numero
    if not _is_valid_analyse(parsed):
        raise HTTPException(
            status_code=422, detail="PDF OKSA parsé mais composant ou rapport non reconnu.")
    parsed["created_at"] = datetime.now().isoformat()
    parsed["alertes"] = _evaluer_alertes(parsed)
    db.append(parsed)
    _save_db(db)

    return {
        "status": "ok",
        "rapport_numero": rapport_numero,
        "composant": parsed.get("composant"),
        "etat_lubrifiant": parsed.get("etat_lubrifiant"),
        "etat_machine": parsed.get("etat_machine"),
        "alertes_detectees": parsed.get("alertes", []),
    }


@router.delete("/analyses/{rapport_id}", summary="Supprimer une analyse")
def delete_analyse(rapport_id: str):
    db = _valid_db()
    filtered = [a for a in db if a.get("id") != rapport_id and a.get(
        "rapport_numero") != rapport_id]
    if len(filtered) == len(db):
        raise HTTPException(status_code=404, detail=f"Analyse '{rapport_id}' introuvable")
    _save_db(filtered)
    return {"status": "deleted", "id": rapport_id}
