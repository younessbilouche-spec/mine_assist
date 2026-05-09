"""
schema_locator.py
═════════════════════════════════════════════════════════════════════════
Localise un composant (pompe, vanne, solénoïde…) dans les schémas
hydrauliques ou électriques CAT 994F et retourne un crop centré sur
l'emplacement exact, avec les occurrences surlignées en rouge.

Fonctionnement :
  1. Recherche textuelle sur la page via fitz.Page.search_for()
  2. Groupement des rectangles proches en « clusters »
  3. Rendu haute résolution du crop (padding configurable)
  4. Dessin des rectangles de surbrillance en rouge
  5. Fallback → page entière à faible résolution si aucun match

Utilisation :
    from schema_locator import locate_in_schema, search_schemas

    # Recherche sur une page précise
    result = locate_in_schema("schema_hyd_994F.pdf", page=5,
                               keywords=["pompe principale", "main pump"])

    # Recherche automatique sur tout le PDF
    results = search_schemas(
        schema_paths=["/data/schemas/schema_hyd_994F.pdf",
                       "/data/schemas/schema_elec_994F.pdf"],
        keywords=["solénoïde", "solenoid", "S-001"],
        max_results=3,
    )
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

try:
    import fitz  # PyMuPDF ≥ 1.20
    FITZ_AVAILABLE = True
except ImportError:
    FITZ_AVAILABLE = False
    print("⚠️  PyMuPDF non installé — pip install pymupdf")


# ─────────────────────────────────────────────────────────────────────────────
# Constantes
# ─────────────────────────────────────────────────────────────────────────────

# Padding autour du cluster (en points PDF, 72 pts = 1 pouce)
CROP_PADDING_PTS = 80

# Résolution du rendu (DPI) — 180 pour les crops, 100 pour fallback page entière
CROP_DPI      = 180
FALLBACK_DPI  = 100

# Couleur des rectangles de surbrillance (RGB 0-1)
HIGHLIGHT_COLOR = (0.92, 0.10, 0.10)   # rouge vif
HIGHLIGHT_ALPHA = 0.25                  # semi-transparent

# Distance max entre deux Rect pour qu'ils soient dans le même cluster (pts)
CLUSTER_MERGE_DISTANCE = 120

# Score minimum pour qu'un match soit retenu
MIN_SCORE = 1


# ─────────────────────────────────────────────────────────────────────────────
# Dataclasses
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SchemaLocation:
    """Résultat d'une localisation dans un schéma."""
    pdf_name:   str            # nom du fichier PDF
    pdf_path:   str            # chemin absolu
    page:       int            # numéro de page (1-indexé)
    matched_keywords: List[str] = field(default_factory=list)
    score:      int   = 0      # nombre de matches
    image_b64:  str   = ""     # PNG en base64
    crop_box:   Optional[Tuple[float,float,float,float]] = None  # (x0,y0,x1,y1) pts
    is_fallback: bool = False  # True si page entière (aucun match textuel)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers internes
# ─────────────────────────────────────────────────────────────────────────────

def _normalize(text: str) -> str:
    """Normalise pour la recherche : accents, casse, ponctuation."""
    text = text.lower()
    for src, dst in [
        ("é","e"),("è","e"),("ê","e"),("ë","e"),
        ("à","a"),("â","a"),("ä","a"),
        ("ù","u"),("û","u"),("ü","u"),
        ("ô","o"),("ö","o"),
        ("î","i"),("ï","i"),
        ("ç","c"),("-"," "),(","," "),("."," "),
    ]:
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip()


def _rects_overlap_or_close(r1: "fitz.Rect", r2: "fitz.Rect",
                             margin: float = CLUSTER_MERGE_DISTANCE) -> bool:
    """Retourne True si deux Rect sont proches (distance < margin pts)."""
    expanded = fitz.Rect(r1.x0 - margin, r1.y0 - margin,
                         r1.x1 + margin, r1.y1 + margin)
    return bool(expanded.intersects(r2))


def _merge_rects(rects: List["fitz.Rect"]) -> "fitz.Rect":
    """Union de tous les Rect de la liste."""
    union = fitz.Rect(rects[0])
    for r in rects[1:]:
        union = union | r
    return union


def _cluster_rects(rects: List["fitz.Rect"]) -> List[List["fitz.Rect"]]:
    """Regroupe les Rect proches en clusters (Union-Find simplifié)."""
    clusters: List[List["fitz.Rect"]] = []
    used = [False] * len(rects)

    for i, r in enumerate(rects):
        if used[i]:
            continue
        cluster = [r]
        used[i] = True
        for j in range(i + 1, len(rects)):
            if not used[j] and _rects_overlap_or_close(r, rects[j]):
                cluster.append(rects[j])
                used[j] = True
        clusters.append(cluster)

    return clusters


def _render_crop(page: "fitz.Page",
                 crop_rect: "fitz.Rect",
                 highlight_rects: List["fitz.Rect"],
                 dpi: int = CROP_DPI) -> str:
    """
    Rend un crop de la page avec les highlights en rouge.
    Retourne une chaîne base64 PNG.
    """
    # Sécurité : s'assurer que le crop est dans les bornes de la page
    page_rect = page.rect
    crop_rect = fitz.Rect(
        max(crop_rect.x0, page_rect.x0),
        max(crop_rect.y0, page_rect.y0),
        min(crop_rect.x1, page_rect.x1),
        min(crop_rect.y1, page_rect.y1),
    )

    if crop_rect.is_empty or crop_rect.width < 10 or crop_rect.height < 10:
        crop_rect = page_rect  # fallback page entière

    # Dessiner les rectangles de surbrillance sur la page (annotations temporaires)
    drawn_annots = []
    for hr in highlight_rects:
        # Vérifier que le rect est dans la zone de crop
        if crop_rect.intersects(hr):
            annot = page.add_rect_annot(hr)
            annot.set_colors(stroke=HIGHLIGHT_COLOR, fill=HIGHLIGHT_COLOR)
            annot.set_opacity(HIGHLIGHT_ALPHA)
            annot.update()
            drawn_annots.append(annot)

    # Ajouter un rectangle de bordure rouge épais autour du crop entier
    border_rect = fitz.Rect(
        crop_rect.x0 + 2, crop_rect.y0 + 2,
        crop_rect.x1 - 2, crop_rect.y1 - 2,
    )
    if not border_rect.is_empty:
        border_annot = page.add_rect_annot(border_rect)
        border_annot.set_colors(stroke=(0.85, 0.10, 0.10))
        border_annot.set_border(width=2)
        border_annot.update()
        drawn_annots.append(border_annot)

    # Rendu
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    clip = crop_rect
    pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
    img_bytes = pix.tobytes("png")

    # Supprimer les annotations temporaires
    for annot in drawn_annots:
        try:
            page.delete_annot(annot)
        except Exception:
            pass

    return base64.b64encode(img_bytes).decode("utf-8")


def _page_to_base64_fallback(page: "fitz.Page", dpi: int = FALLBACK_DPI) -> str:
    """Retourne la page entière en base64 PNG (résolution basse)."""
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    return base64.b64encode(pix.tobytes("png")).decode("utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# API publique
# ─────────────────────────────────────────────────────────────────────────────

def locate_in_schema(
    pdf_path: str,
    page_number: int,
    keywords: List[str],
    padding: float = CROP_PADDING_PTS,
    crop_dpi: int = CROP_DPI,
) -> Optional[SchemaLocation]:
    """
    Localise les keywords sur une page précise d'un schéma PDF.

    Paramètres
    ----------
    pdf_path    : chemin absolu vers le PDF
    page_number : numéro de page 1-indexé
    keywords    : liste de termes à chercher (ex: ["pompe principale", "P-001"])
    padding     : espace autour du cluster (pts)
    crop_dpi    : résolution du crop

    Retourne
    --------
    SchemaLocation avec image_b64 rempli, ou None si le PDF est invalide.
    """
    if not FITZ_AVAILABLE:
        return None

    path = Path(pdf_path)
    if not path.exists():
        print(f"⚠️  schema_locator: PDF introuvable → {pdf_path}")
        return None

    try:
        doc = fitz.open(str(path))
    except Exception as e:
        print(f"⚠️  schema_locator: impossible d'ouvrir {path.name}: {e}")
        return None

    if page_number < 1 or page_number > len(doc):
        print(f"⚠️  schema_locator: page {page_number} hors limites ({len(doc)} pages)")
        doc.close()
        return None

    page = doc[page_number - 1]
    all_rects: List["fitz.Rect"] = []
    matched_kws: List[str] = []

    for kw in keywords:
        if not kw or not kw.strip():
            continue

        variants = _build_variants(kw)

        for variant in variants:
            try:
                found = page.search_for(variant, quads=False)
            except Exception:
                continue

            if found:
                all_rects.extend(found)
                if kw not in matched_kws:
                    matched_kws.append(kw)
                break  # une variante suffit pour ce keyword

    loc = SchemaLocation(
        pdf_name   = path.name,
        pdf_path   = str(path),
        page       = page_number,
        matched_keywords = matched_kws,
        score      = len(all_rects),
    )

    if all_rects:
        # Grouper les rectangles proches en clusters
        clusters = _cluster_rects(all_rects)

        # Prendre le cluster avec le plus de rectangles
        best_cluster = max(clusters, key=lambda c: len(c))
        cluster_union = _merge_rects(best_cluster)

        # Padder
        crop_rect = fitz.Rect(
            cluster_union.x0 - padding,
            cluster_union.y0 - padding,
            cluster_union.x1 + padding,
            cluster_union.y1 + padding,
        )

        loc.crop_box   = (crop_rect.x0, crop_rect.y0, crop_rect.x1, crop_rect.y1)
        loc.image_b64  = _render_crop(page, crop_rect, all_rects, dpi=crop_dpi)
        loc.is_fallback = False

        print(f"📍 Localisé '{matched_kws}' dans {path.name} p.{page_number} "
              f"— {len(all_rects)} occurrence(s), cluster box {cluster_union}")
    else:
        # Aucun match textuel → page entière
        loc.image_b64  = _page_to_base64_fallback(page)
        loc.is_fallback = True
        print(f"📄 Fallback page entière : {path.name} p.{page_number} "
              f"(aucun match pour {keywords})")

    doc.close()
    return loc


def search_schemas(
    schema_paths: List[str],
    keywords: List[str],
    page_hint: Optional[int] = None,
    max_results: int = 3,
    padding: float = CROP_PADDING_PTS,
    crop_dpi: int = CROP_DPI,
) -> List[SchemaLocation]:
    """
    Parcourt les PDFs de schémas et retourne les meilleures localisations.

    Si page_hint est fourni, seule cette page est analysée pour chaque PDF.
    Sinon, toutes les pages sont parcourues (peut être lent sur gros PDFs —
    utiliser en arrière-plan ou avec un timeout).

    Retourne une liste triée par score décroissant.
    """
    if not FITZ_AVAILABLE or not keywords:
        return []

    results: List[SchemaLocation] = []

    for pdf_path in schema_paths:
        path = Path(pdf_path)
        if not path.exists():
            continue

        try:
            doc = fitz.open(str(path))
        except Exception as e:
            print(f"⚠️  search_schemas: {path.name}: {e}")
            continue

        pages_to_scan = (
            [page_hint] if page_hint and 1 <= page_hint <= len(doc)
            else list(range(1, len(doc) + 1))
        )

        for page_num in pages_to_scan:
            page = doc[page_num - 1]
            matched_kws: List[str] = []
            score = 0

            for kw in keywords:
                if not kw or not kw.strip():
                    continue
                for variant in _build_variants(kw):
                    try:
                        found = page.search_for(variant, quads=False)
                    except Exception:
                        continue
                    if found:
                        score += len(found)
                        if kw not in matched_kws:
                            matched_kws.append(kw)
                        break

            if score >= MIN_SCORE:
                results.append(SchemaLocation(
                    pdf_name = path.name,
                    pdf_path = str(path),
                    page     = page_num,
                    matched_keywords = matched_kws,
                    score    = score,
                ))

        doc.close()

    if not results:
        return []

    # Trier par score décroissant et garder les N meilleurs
    results.sort(key=lambda r: r.score, reverse=True)
    top = results[:max_results]

    # Rendre les images pour les meilleurs résultats
    final: List[SchemaLocation] = []
    for loc in top:
        rendered = locate_in_schema(
            pdf_path    = loc.pdf_path,
            page_number = loc.page,
            keywords    = loc.matched_keywords,
            padding     = padding,
            crop_dpi    = crop_dpi,
        )
        if rendered:
            final.append(rendered)

    return final


# ─────────────────────────────────────────────────────────────────────────────
# Extracteur de mots-clés depuis le texte du diagnostic LLM
# ─────────────────────────────────────────────────────────────────────────────

# Composants hydrauliques / électriques connus sur la 994F
_KNOWN_COMPONENTS = [
    # Hydraulique
    "pompe principale", "main pump", "pompe charge", "charge pump",
    "vanne de décharge", "relief valve", "vanne proportionnelle",
    "vanne pilote", "pilot valve", "accumulateur", "accumulator",
    "vérin levage", "lift cylinder", "vérin inclinaison", "tilt cylinder",
    "filtre hydraulique", "hydraulic filter",
    "distributeur", "control valve", "soupape",
    "servo commande", "servo control",
    "circuit de direction", "steering circuit",
    "circuit de freinage", "brake circuit",
    "convertisseur de couple", "torque converter",
    "transmission", "pompe de transmission",
    "refroidisseur", "oil cooler", "heat exchanger",
    # Électrique
    "solénoïde", "solenoid",
    "relais", "relay",
    "capteur de pression", "pressure sensor",
    "capteur de température", "temperature sensor",
    "contacteur", "switch",
    "ECM", "ECU", "module de commande",
    "fusible", "fuse",
    "alternateur", "alternator",
    "démarreur", "starter",
    "injecteur", "injector",
    "régulateur", "regulator",
    "capteur de vitesse", "speed sensor",
    "turbocompresseur", "turbocharger",
]

# Patterns pour codes de référence (ex: MID 027, CID 0041, FMI 5, J762)
_REF_PATTERNS = [
    r"\b(?:MID|CID|FMI|DTC|SIS|ECS)\s*[\d]+\b",
    r"\b[A-Z]{1,3}[-]?\d{3,5}\b",   # ex: P-001, V-42, SV1234
    r"\b\d{3,6}[A-Z]{1,3}\b",        # ex: 994F, 7T-5267
]


def extract_keywords_from_diagnosis(diagnosis_text: str,
                                    symptoms: Optional[List[str]] = None,
                                    fault_code: Optional[str] = None) -> List[str]:
    """
    Extrait une liste de keywords pertinents à rechercher dans les schémas
    depuis le texte du diagnostic LLM + les données d'entrée du diagnostic.

    Retourne une liste dédupliquée, triée par longueur décroissante
    (les termes longs sont plus précis).
    """
    keywords: List[str] = []
    text_lower = _normalize(diagnosis_text or "")

    # 1. Codes de référence dans le texte
    for pat in _REF_PATTERNS:
        for m in re.findall(pat, diagnosis_text or "", re.IGNORECASE):
            kw = m.strip()
            if kw and kw not in keywords:
                keywords.append(kw)

    # 2. Composants connus mentionnés dans le diagnostic
    for comp in _KNOWN_COMPONENTS:
        if _normalize(comp) in text_lower:
            keywords.append(comp)

    # 3. Ajouter le code défaut brut
    if fault_code and fault_code.strip():
        keywords.append(fault_code.strip())

    # 4. Ajouter les symptômes (premiers mots significatifs)
    for sym in (symptoms or []):
        words = [w for w in sym.split() if len(w) > 4]
        keywords.extend(words[:2])

    # Dédupliquer en conservant l'ordre, trier par longueur décroissante
    seen: set = set()
    unique: List[str] = []
    for kw in keywords:
        k = kw.lower().strip()
        if k and k not in seen:
            seen.add(k)
            unique.append(kw)

    unique.sort(key=len, reverse=True)
    return unique[:12]  # limiter à 12 keywords max


def _build_variants(keyword: str) -> List[str]:
    """
    Génère des variantes d'un keyword pour maximiser les chances de match
    dans le PDF (casse, abréviations, traductions partielles).
    """
    variants = [keyword]

    kw_lower = keyword.lower()
    kw_upper = keyword.upper()
    kw_title = keyword.title()

    for v in [kw_lower, kw_upper, kw_title]:
        if v not in variants:
            variants.append(v)

    # Traductions fr→en et en→fr pour les termes courants
    translations = {
        "pompe": "pump", "pump": "pompe",
        "vanne": "valve", "valve": "vanne",
        "filtre": "filter", "filter": "filtre",
        "pression": "pressure", "pressure": "pression",
        "temperature": "temp", "temp": "temperature",
        "moteur": "engine", "engine": "moteur",
        "refroidissement": "cooling", "cooling": "refroidissement",
        "solénoïde": "solenoid", "solenoid": "solenoide",
        "circuit": "circuit",
        "convertisseur": "converter", "converter": "convertisseur",
        "transmission": "transmission",
    }

    norm = _normalize(keyword)
    for src, dst in translations.items():
        if src in norm:
            translated = norm.replace(src, dst)
            if translated not in [_normalize(v) for v in variants]:
                variants.append(translated)

    return variants


# ─────────────────────────────────────────────────────────────────────────────
# Intégration avec pdf_image_extractor (helper pour api.py)
# ─────────────────────────────────────────────────────────────────────────────

def extract_schema_crops_for_diagnosis(
    diagnosis_text:  str,
    symptoms:        Optional[List[str]] = None,
    fault_code:      Optional[str]       = None,
    rag_sources:     Optional[List[str]] = None,
    schema_dir:      Optional[str]       = None,
    max_crops:       int                 = 3,
) -> List[dict]:
    """
    Point d'entrée principal depuis api.py /diagnose.

    1. Extrait les keywords depuis le diagnostic LLM
    2. Cherche dans les schémas (hyd + elec) du répertoire
    3. Retourne une liste de crops sérialisables en JSON

    Retourne:
    [
        {
            "pdf_name": "schema_hyd_994F.pdf",
            "page": 5,
            "matched_keywords": ["pompe principale"],
            "score": 3,
            "image_b64": "...",
            "is_fallback": false,
            "crop_box": [x0, y0, x1, y1]  // null si fallback
        },
        ...
    ]
    """
    if not FITZ_AVAILABLE:
        return []

    keywords = extract_keywords_from_diagnosis(diagnosis_text, symptoms, fault_code)

    if not keywords:
        print("ℹ️  schema_locator: aucun keyword extrait du diagnostic")
        return []

    print(f"🔑 Keywords schéma extraits : {keywords}")

    # Localiser les PDFs de schémas
    if schema_dir:
        search_dirs = [Path(schema_dir)]
    else:
        base = Path(__file__).resolve().parent
        search_dirs = [
            base.parent / "data" / "schemas",
            base.parent / "data" / "manuals",
            base,  # fallback : même dossier que ce script
        ]

    schema_pdfs: List[str] = []
    for d in search_dirs:
        if d.exists():
            # Priorité aux PDFs contenant "schema", "hyd", "elec" dans le nom
            schema_pdfs.extend([
                str(f) for f in d.glob("*.pdf")
                if any(kw in f.name.lower() for kw in ["schema", "hyd", "elec", "994f"])
            ])

    # Si on a des sources RAG, extraire les hints de page
    page_hints: dict[str, int] = {}
    if rag_sources:
        for src in rag_sources:
            pdf_match = re.search(r"([\w\-_.]+\.pdf)", src, re.IGNORECASE)
            page_match = re.search(r"page\s+(\d+)", src, re.IGNORECASE)
            if pdf_match and page_match:
                page_hints[pdf_match.group(1).lower()] = int(page_match.group(1))

    if not schema_pdfs:
        print("⚠️  schema_locator: aucun PDF de schéma trouvé")
        return []

    locations: List[SchemaLocation] = search_schemas(
        schema_paths = schema_pdfs,
        keywords     = keywords,
        page_hint    = None,      # scan complet (utiliser page_hints si besoin)
        max_results  = max_crops,
        padding      = CROP_PADDING_PTS,
        crop_dpi     = CROP_DPI,
    )

    # Si search_schemas ne trouve rien et qu'on a des hints RAG → fallback page entière
    if not locations and page_hints:
        for pdf_path in schema_pdfs:
            pdf_name = Path(pdf_path).name.lower()
            hint_page = page_hints.get(pdf_name)
            if hint_page:
                loc = locate_in_schema(pdf_path, hint_page, keywords)
                if loc:
                    locations.append(loc)
                    if len(locations) >= max_crops:
                        break

    return [_loc_to_dict(loc) for loc in locations]


def _loc_to_dict(loc: SchemaLocation) -> dict:
    return {
        "pdf_name":        loc.pdf_name,
        "page":            loc.page,
        "matched_keywords": loc.matched_keywords,
        "score":           loc.score,
        "image_b64":       loc.image_b64,
        "is_fallback":     loc.is_fallback,
        "crop_box":        list(loc.crop_box) if loc.crop_box else None,
    }
