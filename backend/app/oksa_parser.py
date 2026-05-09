"""
oksa_parser.py
══════════════════════════════════════════════════════════════════════════════
Parser automatique des rapports d'analyse OKSA — format PDF standard.
Extrait ~45 champs sans aucune saisie manuelle.

Usage direct :
    from app.oksa_parser import parse_oksa_pdf, parse_oksa_folder

    # Un seul fichier
    result = parse_oksa_pdf("/data/oil/CHAR-994F2-PONT_AV-26-57443.pdf")
    print(result)

    # Dossier complet
    results = parse_oksa_folder("/data/oil/")
    for r in results:
        print(r["rapport_numero"], r["composant"], r["etat_lubrifiant"])

Dépendances :
    pip install pymupdf
"""

from __future__ import annotations

import re
import json
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import fitz          # PyMuPDF
    FITZ_OK = True
except ImportError:
    FITZ_OK = False
    print("⚠  PyMuPDF manquant — pip install pymupdf")


# ════════════════════════════════════════════════════════════════════════════
# Patterns regex calés sur la mise en page OKSA standard
# ════════════════════════════════════════════════════════════════════════════

# Identifiants
RE_RAPPORT     = re.compile(r"Rapport\s+N[°º]\s*[:\-]?\s*([\d\-]+)", re.I)
RE_RAPPORT2    = re.compile(r"(?:26|25|24|23|22)-\d{5,6}")   # fallback direct
RE_DATE_PREL   = re.compile(r"DATE\s+DE\s+PREL[EÈ]VEMENT\s*[:\-]?\s*(\d{2}[/\-]\d{2}[/\-]\d{4})", re.I)
RE_DATE_REC    = re.compile(r"DATE\s+DE\s+RECEPTION\s*[:\-]?\s*(\d{2}[/\-]\d{2}[/\-]\d{4})", re.I)
RE_DATE_FIN    = re.compile(r"DATE\s+DE\s+FIN\s+D.ANALYSE\s*[:\-]?\s*(\d{2}[/\-]\d{2}[/\-]\d{4})", re.I)

# Identification engin
RE_NOM_EQUIP   = re.compile(r"NOM\s+DE\s+L.EQUIPEMENT\s*[:\-]?\s*(CHAR\s*\S+)", re.I)
RE_COMPOSANT   = re.compile(r"NUMERO\s+DE\s+SERIE\s*[:\-]?\s*(\S.*?)(?:\n|TYPE)", re.I | re.S)
RE_GRADE       = re.compile(r"GRADE\s*[:\-]\s*(SAE\s*\d+\w*|[\d]+W[\d]+)", re.I)
RE_HEURES      = re.compile(r"HEURES[/\s]*KM\s*[:\-]?\s*(\d{4,8})", re.I)
RE_SERIE       = re.compile(r"(?:N[°º]?\s*[Ss]érie|NUMERO\s+DE\s+SERIE)\s*[:\-]?\s*(\d{4,8})", re.I)

# Physico-chimique  (num flottant après le label)
_NF = r"\s+([\-]?[\d]+[\.,][\d]*)"   # nombre flottant
RE_VISC40  = re.compile(r"VISCOSITE\s*\(40\)" + _NF, re.I)
RE_VISC100 = re.compile(r"VISCOSITE\s*\(100\)" + _NF, re.I)
RE_TAN     = re.compile(r"(?:^|\s)TAN\s" + _NF, re.I | re.M)
RE_TBN     = re.compile(r"(?:^|\s)TBN\s" + _NF, re.I | re.M)
RE_FLASH   = re.compile(r"POINT\s+D[.'`]?ECLAIR" + _NF, re.I)
RE_OXYD    = re.compile(r"OXIDATION" + _NF, re.I)
RE_SULF    = re.compile(r"SULFATE" + _NF, re.I)
RE_NITR    = re.compile(r"NITRATE" + _NF, re.I)
RE_PHOS_A  = re.compile(r"PHOSPHATE\s+ANT" + _NF, re.I)

# Métaux d'usure (ppm = mg/kg)
RE_FE  = re.compile(r"Fe\s*[-–]\s*Fer" + _NF, re.I)
RE_CR  = re.compile(r"Cr\s*[-–]\s*Chrome" + _NF, re.I)
RE_NI  = re.compile(r"Ni\s*[-–]\s*Nickel" + _NF, re.I)
RE_AL  = re.compile(r"Al\s*[-–]\s*Aluminium" + _NF, re.I)
RE_CU  = re.compile(r"Cu\s*[-–]\s*Cuivre" + _NF, re.I)
RE_PB  = re.compile(r"Pb\s*[-–]\s*Plomb" + _NF, re.I)
RE_SN  = re.compile(r"Sn\s*[-–]\s*Etain" + _NF, re.I)
RE_AG  = re.compile(r"Ag\s*[-–]\s*Argent" + _NF, re.I)
RE_V   = re.compile(r"V\s*[-–]\s*Vanadium" + _NF, re.I)

# Métaux contaminants
RE_SI  = re.compile(r"Si\s*[-–]\s*Silicium" + _NF, re.I)
RE_NA  = re.compile(r"Na\s*[-–]\s*Sodium" + _NF, re.I)
RE_K   = re.compile(r"K\s*[-–]\s*Potassium" + _NF, re.I)
RE_TI  = re.compile(r"Ti\s*[-–]\s*TITANE" + _NF, re.I)

# Métaux additifs
RE_MO  = re.compile(r"Mo\s*[-–]\s*Molybdène" + _NF, re.I)
RE_MN  = re.compile(r"Mn\s*[-–]\s*Manganèse" + _NF, re.I)
RE_S   = re.compile(r"S[-–]\s*Soufre" + _NF, re.I)
RE_B   = re.compile(r"B\s*[-–]\s*Bore" + _NF, re.I)
RE_MG  = re.compile(r"Mg\s*[-–]\s*Magnésium" + _NF, re.I)
RE_CA  = re.compile(r"Ca\s*[-–]\s*Calcium" + _NF, re.I)
RE_BA  = re.compile(r"Ba\s*[-–]\s*Baryum" + _NF, re.I)
RE_P   = re.compile(r"P\s*[-–]\s*Phosphore" + _NF, re.I)
RE_ZN  = re.compile(r"Zn\s*[-–]\s*Zinc" + _NF, re.I)

# Particules
RE_P4  = re.compile(r"n\s*>\s*4\s*[µu]m\s+([\d\s]+)", re.I)
RE_P6  = re.compile(r"n\s*>\s*6\s*[µu]m\s+([\d\s]+)", re.I)
RE_P14 = re.compile(r"n\s*>\s*14\s*[µu]m\s+([\d\s]+)", re.I)
RE_ISO = re.compile(r"(\d{1,2}/\d{1,2}/\d{1,2})\s")

# Statuts (CRITIQUE / MARGINALE / NORMALE)
RE_ETAT_MACH = re.compile(
    r"CONDITION\s+DE\s+LA\s+MACHINE.*?(CRITIQUE|MARGINALE|NORMALE)", re.I | re.S)
RE_ETAT_LUB  = re.compile(
    r"CONDITION\s+DU\s+LUBRIFIANT.*?(CRITIQUE|MARGINALE|NORMALE)", re.I | re.S)

# Recommandations — capture de tout le bloc
RE_RECO = re.compile(
    r"Recommandations?\s*:?\s*\n((?:[-–•]\s*.+\n?)+)", re.I)

# Noms de composants connus dans les noms de fichier / le texte
COMPOSANT_MAP = {
    "PONT AR":  ["PONT AR", "PONT_AR", "PONT-AR", "PONTARR"],
    "PONT AV":  ["PONT AV", "PONT_AV", "PONT-AV", "PONTAV"],
    "PTO":      ["PTO", " PTO"],
    "MOTEUR":   ["MOTEUR", "ENGINE"],
    "TRANSMISSION": ["TRANSMISSION", "TRANS"],
    "CONVERTISSEUR": ["CONVERTISSEUR", "TORQUE"],
    "CIRCUIT DIRECTION": ["DIRECTION", "STEERING"],
}


# ════════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════════

def _float(s: Optional[str]) -> Optional[float]:
    """Convertit une chaîne en float, gère la virgule décimale française."""
    if s is None: return None
    s = str(s).replace(",", ".").replace(" ", "").strip()
    try: return float(s)
    except: return None


def _int_clean(s: Optional[str]) -> Optional[int]:
    if s is None: return None
    s = re.sub(r"[^\d]", "", str(s))
    try: return int(s)
    except: return None


def _date_iso(s: Optional[str]) -> Optional[str]:
    """Convertit DD/MM/YYYY en YYYY-MM-DD."""
    if not s: return None
    for fmt in ["%d/%m/%Y", "%d-%m-%Y"]:
        try:
            return datetime.strptime(s.strip(), fmt).strftime("%Y-%m-%d")
        except: pass
    return s.strip()


def _first(pattern: re.Pattern, text: str) -> Optional[str]:
    m = pattern.search(text)
    return m.group(1).strip() if m else None


def _detect_composant(text: str, filename: str = "") -> str:
    """Détecte le composant depuis le nom du fichier ou le texte."""
    combined = (filename.upper() + " " + text[:500].upper())
    for composant, variants in COMPOSANT_MAP.items():
        for v in variants:
            if v.upper() in combined:
                return composant
    return "INCONNU"


def _detect_machine(text: str) -> str:
    m = re.search(r"CHAR\s+994F[\d]*", text, re.I)
    return m.group(0).strip().upper() if m else "CAT 994F2"


def _extract_etat(text: str) -> tuple[Optional[str], Optional[str]]:
    """
    Extrait état machine et état lubrifiant.
    Dans un rapport OKSA les mots CRITIQUE/MARGINALE/NORMALE apparaissent
    plusieurs fois — on prend les deux premières occurrences distinctes
    dans l'ordre machine → lubrifiant.
    """
    # Chercher les deux premiers statuts dans le texte
    hits = re.findall(r"\b(CRITIQUE|MARGINALE|NORMALE)\b", text, re.I)
    hits = [h.upper() for h in hits]

    # Le premier apparaît souvent dans "CONDITION DE LA MACHINE"
    # Le second dans "CONDITION DU LUBRIFIANT"
    etat_mach = hits[0] if hits else None
    etat_lub  = hits[1] if len(hits) > 1 else etat_mach

    # Affiner via les sections
    m_mach = RE_ETAT_MACH.search(text)
    m_lub  = RE_ETAT_LUB.search(text)
    if m_mach: etat_mach = m_mach.group(1).upper()
    if m_lub:  etat_lub  = m_lub.group(1).upper()

    return etat_mach, etat_lub


def _extract_recommandations(text: str) -> List[str]:
    """Extrait la liste des recommandations depuis le bloc texte."""
    recos = []
    m = RE_RECO.search(text)
    if m:
        bloc = m.group(1)
        for line in bloc.splitlines():
            line = re.sub(r"^[-–•\s]+", "", line).strip()
            if len(line) > 5:
                recos.append(line)
    if not recos:
        # Fallback : chercher des phrases clés courantes OKSA
        phrases = [
            "VIDANGE",
            "ÉCHANTILLONNER",
            "RESPECTER",
            "CONTINUER",
            "PRÉLÈVEMENT",
            "SURVEILLANCE",
        ]
        for ph in phrases:
            m2 = re.search(
                rf"({ph}[^.\n]{{5,150}})", text, re.I
            )
            if m2:
                recos.append(m2.group(1).strip())

    return recos[:5]  # max 5 recommandations


# ════════════════════════════════════════════════════════════════════════════
# Seuils constructeur CAT 994F pour évaluation automatique
# ════════════════════════════════════════════════════════════════════════════

SEUILS = {
    "SAE 50": {
        "viscosite_40":  {"ref": 200.0,  "tol_pct": 20},   # ±20%
        "tan":           {"ref_plus": 0.4},                  # REF + 0.4 (réf inconnue → alerte si > 2.0)
        "fe":            (60, 250),
        "al":            (8, 16),
        "cu":            (150, 900),
        "pb":            (200, 300),
        "si":            (30, 60),
    },
    "80W90": {
        "viscosite_40":  {"ref": 169.0,  "tol_pct": 20},
        "tan":           {"ref_plus": 0.4},
        "fe":            (60, 250),
        "al":            (8, 16),
        "cu":            (150, 900),
        "pb":            (200, 300),
        "si":            (30, 60),
    },
}


def _evaluer_alertes(data: dict) -> List[str]:
    alertes = []
    grade   = (data.get("grade_huile") or "SAE 50").upper()
    seuils  = SEUILS.get("80W90" if "80W90" in grade else "SAE 50", {})

    pc = data.get("physico_chimique") or {}
    mu = data.get("metaux_usure") or {}
    mc = data.get("metaux_contaminants") or {}

    # Viscosité
    vs = seuils.get("viscosite_40")
    v  = pc.get("viscosite_40")
    if vs and v is not None:
        lo = vs["ref"] * (1 - vs["tol_pct"] / 100)
        hi = vs["ref"] * (1 + vs["tol_pct"] / 100)
        if v < lo:
            alertes.append(
                f"Viscosité 40°C trop basse : {v} mm²/s "
                f"(réf {vs['ref']}, seuil bas {lo:.1f})"
            )
        elif v > hi:
            alertes.append(
                f"Viscosité 40°C trop haute : {v} mm²/s "
                f"(réf {vs['ref']}, seuil haut {hi:.1f})"
            )

    # TAN (approximation : alerte si > 2.0 faute de valeur de référence connue)
    tan = pc.get("tan")
    if tan is not None and tan > 2.0:
        alertes.append(f"TAN élevé : {tan} mgKOH/g")

    # Métaux d'usure vs seuils (lo, hi)
    metal_map = {
        "fe": mu.get("fe"), "al": mu.get("al"),
        "cu": mu.get("cu"), "pb": mu.get("pb"),
        "si": mc.get("si"),
    }
    for key, val in metal_map.items():
        lim = seuils.get(key)
        if val is not None and isinstance(lim, tuple):
            lo_m, hi_m = lim
            if val > hi_m:
                alertes.append(f"{key.upper()} élevé : {val} mg/kg > seuil {hi_m}")

    return alertes


# ════════════════════════════════════════════════════════════════════════════
# Fonction principale de parsing
# ════════════════════════════════════════════════════════════════════════════

def parse_oksa_pdf(pdf_path: str) -> dict:
    """
    Lit un rapport OKSA au format PDF et retourne un dict structuré
    compatible avec le modèle OilAnalysis.

    Retourne toujours un dict — en cas d'erreur, le champ "parse_error"
    est rempli et "success" vaut False.
    """
    path = Path(pdf_path)
    result: Dict[str, Any] = {
        "success":         False,
        "source_file":     path.name,
        "parse_error":     None,
    }

    if not FITZ_OK:
        result["parse_error"] = "PyMuPDF non installé (pip install pymupdf)"
        return result

    if not path.exists():
        result["parse_error"] = f"Fichier introuvable : {pdf_path}"
        return result

    try:
        doc  = fitz.open(str(path))
        text = "\n".join(page.get_text() for page in doc)
        doc.close()
    except Exception as e:
        result["parse_error"] = f"Impossible de lire le PDF : {e}"
        return result

    try:
        # ── Identifiants ─────────────────────────────────────────────────
        rapport_num = (
            _first(RE_RAPPORT, text)
            or (RE_RAPPORT2.findall(path.name) or [None])[0]
            or (RE_RAPPORT2.findall(text[:300]) or [None])[0]
            or path.stem
        )

        composant   = _detect_composant(text, path.name)
        machine     = _detect_machine(text)

        grade = _first(RE_GRADE, text)
        # Normalisation grade
        if grade:
            grade = grade.upper().replace(" ", "")
            if "80W90" in grade:  grade = "80W90"
            elif "SAE50" in grade: grade = "SAE 50"
            elif grade.isdigit():  grade = f"SAE {grade}"

        heures = _int_clean(_first(RE_HEURES, text))

        # ── Dates ────────────────────────────────────────────────────────
        date_prel = _date_iso(_first(RE_DATE_PREL, text))
        date_rec  = _date_iso(_first(RE_DATE_REC,  text))
        date_fin  = _date_iso(_first(RE_DATE_FIN,  text))

        # ── Physico-chimique ──────────────────────────────────────────────
        physico = {
            "viscosite_40":  _float(_first(RE_VISC40,  text)),
            "viscosite_100": _float(_first(RE_VISC100, text)),
            "tan":           _float(_first(RE_TAN,     text)),
            "tbn":           _float(_first(RE_TBN,     text)),
            "point_eclair":  _float(_first(RE_FLASH,   text)),
            "oxydation":     _float(_first(RE_OXYD,    text)),
            "sulfate":       _float(_first(RE_SULF,    text)),
            "nitrate":       _float(_first(RE_NITR,    text)),
            "phosphate_ant": _float(_first(RE_PHOS_A,  text)),
        }

        # ── Métaux d'usure ────────────────────────────────────────────────
        metaux_usure = {
            "fe": _float(_first(RE_FE, text)),
            "cr": _float(_first(RE_CR, text)),
            "ni": _float(_first(RE_NI, text)),
            "al": _float(_first(RE_AL, text)),
            "cu": _float(_first(RE_CU, text)),
            "pb": _float(_first(RE_PB, text)),
            "sn": _float(_first(RE_SN, text)),
            "ag": _float(_first(RE_AG, text)),
            "v":  _float(_first(RE_V,  text)),
        }

        # ── Métaux contaminants ───────────────────────────────────────────
        metaux_contaminants = {
            "si": _float(_first(RE_SI, text)),
            "na": _float(_first(RE_NA, text)),
            "k":  _float(_first(RE_K,  text)),
            "ti": _float(_first(RE_TI, text)),
        }

        # ── Métaux additifs ───────────────────────────────────────────────
        metaux_additifs = {
            "mo": _float(_first(RE_MO, text)),
            "mn": _float(_first(RE_MN, text)),
            "s":  _float(_first(RE_S,  text)),
            "b":  _float(_first(RE_B,  text)),
            "mg": _float(_first(RE_MG, text)),
            "ca": _float(_first(RE_CA, text)),
            "ba": _float(_first(RE_BA, text)),
            "p":  _float(_first(RE_P,  text)),
            "zn": _float(_first(RE_ZN, text)),
        }

        # ── Particules ────────────────────────────────────────────────────
        def _part(pattern):
            m = pattern.search(text)
            return _int_clean(m.group(1)) if m else None

        code_iso_hits = RE_ISO.findall(text)
        code_iso      = code_iso_hits[0] if code_iso_hits else None

        particules = {
            "n_sup_4um":     _part(RE_P4),
            "n_sup_6um":     _part(RE_P6),
            "n_sup_14um":    _part(RE_P14),
            "code_iso_4406": code_iso,
        }

        # ── Statuts ───────────────────────────────────────────────────────
        etat_mach, etat_lub = _extract_etat(text)

        # ── Recommandations ───────────────────────────────────────────────
        recos = _extract_recommandations(text)

        # ── Assemblage final ──────────────────────────────────────────────
        data = {
            "id":                  rapport_num,
            "rapport_numero":      rapport_num,
            "source_file":         path.name,
            "machine":             machine,
            "numero_serie":        _first(RE_SERIE, text) or "53492",
            "composant":           composant,
            "grade_huile":         grade,
            "date_prelevement":    date_prel,
            "date_reception":      date_rec,
            "date_fin_analyse":    date_fin,
            "heures_engin":        heures,
            "laboratoire":         "OKSA Rabat",
            "etat_machine":        etat_mach,
            "etat_lubrifiant":     etat_lub,
            "physico_chimique":    physico,
            "metaux_usure":        metaux_usure,
            "metaux_additifs":     metaux_additifs,
            "metaux_contaminants": metaux_contaminants,
            "particules":          particules,
            "recommandations":     recos,
            "created_at":          datetime.now().isoformat(),
        }

        data["alertes"] = _evaluer_alertes(data)

        result.update(data)
        result["success"] = True

    except Exception as e:
        result["parse_error"] = str(e)
        result["traceback"]   = traceback.format_exc()

    return result


# ════════════════════════════════════════════════════════════════════════════
# Parsing d'un dossier complet
# ════════════════════════════════════════════════════════════════════════════

def parse_oksa_folder(folder_path: str,
                      recursive: bool = False,
                      skip_existing: Optional[List[str]] = None) -> List[dict]:
    """
    Parse tous les PDF dans un dossier (ou sous-dossiers si recursive=True).

    skip_existing : liste de rapport_numero déjà en base → ignorés
    Retourne une liste de dicts (seuls les succès complets).
    """
    folder = Path(folder_path)
    if not folder.exists():
        return []

    pattern = "**/*.pdf" if recursive else "*.pdf"
    pdfs    = sorted(folder.glob(pattern))
    results = []
    skip    = set(skip_existing or [])

    for pdf in pdfs:
        # Heuristique rapide : ignorer si le numéro de rapport est déjà connu
        if skip:
            m = RE_RAPPORT2.search(pdf.name)
            if m and m.group(0) in skip:
                print(f"⏭  Ignoré (déjà importé) : {pdf.name}")
                continue

        print(f"📄 Parsing : {pdf.name}")
        r = parse_oksa_pdf(str(pdf))

        if r.get("success"):
            results.append(r)
            print(f"   ✅ {r['composant']} · {r['rapport_numero']} · {r.get('etat_lubrifiant')}")
        else:
            print(f"   ⚠  Erreur : {r.get('parse_error')}")

    return results


# ════════════════════════════════════════════════════════════════════════════
# Watcher de dossier — détection automatique de nouveaux PDFs
# ════════════════════════════════════════════════════════════════════════════

def watch_folder(folder_path: str,
                 db_file: str,
                 interval_sec: int = 60,
                 on_new: Optional[callable] = None) -> None:
    """
    Surveille un dossier toutes les `interval_sec` secondes.
    Dès qu'un nouveau PDF OKSA est détecté, il est parsé et ajouté à la base.

    db_file  : chemin vers oil_analyses_db.json
    on_new   : callback optionnel appelé avec le dict de la nouvelle analyse
    interval : fréquence de vérification en secondes

    Lancer en background :
        import threading
        t = threading.Thread(
            target=watch_folder,
            args=("/data/oil/incoming", "/data/oil_analyses_db.json"),
            daemon=True
        )
        t.start()
    """
    import time

    folder  = Path(folder_path)
    db_path = Path(db_file)
    folder.mkdir(parents=True, exist_ok=True)

    print(f"👁  Watcher démarré — dossier : {folder} · intervalle : {interval_sec}s")

    def load_db():
        if db_path.exists():
            try:
                return json.loads(db_path.read_text(encoding="utf-8"))
            except: return []
        return []

    def save_db(data):
        db_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    seen = set(db_path.stat().st_mtime if db_path.exists() else 0 for _ in [1])
    known_rapports = {a.get("rapport_numero") for a in load_db()}

    while True:
        time.sleep(interval_sec)
        try:
            db = load_db()
            known_rapports = {a.get("rapport_numero") for a in db}

            for pdf in sorted(folder.glob("*.pdf")):
                m = RE_RAPPORT2.search(pdf.name)
                rapport_id = m.group(0) if m else pdf.stem

                if rapport_id in known_rapports:
                    continue  # déjà importé

                print(f"🆕 Nouveau PDF détecté : {pdf.name}")
                r = parse_oksa_pdf(str(pdf))

                if r.get("success"):
                    db.append(r)
                    known_rapports.add(r.get("rapport_numero"))
                    save_db(db)
                    print(f"   ✅ Importé : {r['composant']} · {r['rapport_numero']}")

                    if callable(on_new):
                        try: on_new(r)
                        except Exception as e:
                            print(f"   ⚠  Callback erreur : {e}")
                else:
                    print(f"   ⚠  Parse échoué : {r.get('parse_error')}")

        except Exception as e:
            print(f"⚠  Watcher erreur : {e}")


# ════════════════════════════════════════════════════════════════════════════
# CLI rapide
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys, json

    if len(sys.argv) < 2:
        print("Usage : python oksa_parser.py <fichier.pdf>  [ou]  <dossier/>")
        sys.exit(0)

    target = Path(sys.argv[1])

    if target.is_dir():
        results = parse_oksa_folder(str(target))
        print(f"\n✅ {len(results)} analyse(s) parsées")
        for r in results:
            print(f"   {r['composant']:<14} {r['rapport_numero']:<12} {r.get('etat_lubrifiant','?')}")
    else:
        r = parse_oksa_pdf(str(target))
        print(json.dumps(r, ensure_ascii=False, indent=2))
