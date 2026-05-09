"""
pdf_image_extractor.py
Extrait les pages PDF pertinentes en images base64.
Compatible avec le format de sources : "manuel.pdf (page 42)"
100% gratuit — PyMuPDF (fitz), aucune API externe.
"""
from pathlib import Path
from typing import List, Optional
import base64
import io
import re

try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False

try:
    from pdf2image import convert_from_path
    PDF2IMAGE_AVAILABLE = True
except ImportError:
    PDF2IMAGE_AVAILABLE = False

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MANUAL_DIRS = [
    DATA_DIR / "manuals",
    DATA_DIR / "schemas",
    DATA_DIR / "fault_codes",
    DATA_DIR / "vims",
]


def pdf_page_to_base64(pdf_path: str, page_number: int, dpi: int = 130) -> Optional[str]:
    """
    Convertit une page PDF en PNG base64.
    page_number : 1-indexé.
    """
    try:
        if PYMUPDF_AVAILABLE:
            doc = fitz.open(pdf_path)
            if page_number < 1 or page_number > len(doc):
                doc.close()
                return None

            page = doc[page_number - 1]
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")
            doc.close()
            return base64.b64encode(img_bytes).decode("utf-8")

        elif PDF2IMAGE_AVAILABLE:
            images = convert_from_path(
                pdf_path,
                dpi=dpi,
                first_page=page_number,
                last_page=page_number,
            )
            if images:
                buf = io.BytesIO()
                images[0].save(buf, format="PNG")
                return base64.b64encode(buf.getvalue()).decode("utf-8")

    except Exception as e:
        print(f"⚠️ pdf_page_to_base64({pdf_path}, p{page_number}): {e}")

    return None


def extract_images_for_sources(
    sources: List[str],
    query: Optional[str] = None,
    max_images: int = 3,
) -> List[dict]:
    """
    Parcourt les sources retournées par le RAG et extrait les images des pages PDF.

    Format attendu :
      "manuel_994F.pdf (page 42)"
      "SIS_parts.pdf (page 7)"
      "gmao_export.xlsx" ← ignoré

    Args:
        sources: liste des sources
        query: conservé pour compatibilité avec api.py
        max_images: nombre max d'images retournées

    Retourne une liste de dicts :
      { source, pdf, page, image_b64 }
    """
    results = []
    seen = set()

    # query gardé pour compatibilité future
    _ = query

    for source in sources:
        if len(results) >= max_images:
            break

        pdf_name, page_num = _parse_source(source)
        if not pdf_name or not page_num:
            continue

        key = f"{pdf_name}:{page_num}"
        if key in seen:
            continue
        seen.add(key)

        full_path = _find_pdf(pdf_name)
        if not full_path:
            print(f"⚠️ PDF non trouvé : {pdf_name}")
            continue

        b64 = pdf_page_to_base64(str(full_path), page_num)
        if b64:
            results.append(
                {
                    "source": source,
                    "pdf": pdf_name,
                    "page": page_num,
                    "image_b64": b64,
                }
            )
            print(f"📸 Image extraite : {pdf_name} page {page_num}")

    return results


def _parse_source(source: str):
    """
    Parse "manuel.pdf (page 42)" → ("manuel.pdf", 42)
    Retourne (None, None) si format non reconnu.
    """
    pdf_match = re.search(r"([\w\-_. ]+\.pdf)", source, re.IGNORECASE)
    if not pdf_match:
        return None, None

    pdf_name = pdf_match.group(1).strip()

    patterns = [
        r"\(page\s+(\d+)\)",       # (page 42)
        r"[Pp]age\s*[:\.]?\s*(\d+)",  # page 42 / Page: 42
        r"[Pp]\.\s*(\d+)",         # p.42
        r":(\d+)\s*$",             # :42
    ]

    page_num = None
    for pat in patterns:
        m = re.search(pat, source)
        if m:
            page_num = int(m.group(1))
            break

    return pdf_name, page_num


def _find_pdf(pdf_name: str) -> Optional[Path]:
    """Cherche le PDF dans tous les dossiers connus."""
    for directory in MANUAL_DIRS:
        if not directory.exists():
            continue

        exact = directory / pdf_name
        if exact.exists():
            return exact

        for f in directory.glob("*.pdf"):
            if f.name.lower() == pdf_name.lower():
                return f

    return None


def check_dependencies() -> dict:
    return {
        "pymupdf": PYMUPDF_AVAILABLE,
        "pdf2image": PDF2IMAGE_AVAILABLE,
        "ready": PYMUPDF_AVAILABLE or PDF2IMAGE_AVAILABLE,
    }
