# ─────────────────────────────────────────────────────────────────────────────
# backend/app/routers/export_router.py
#
# PROBLÈME ACTUEL :
#   - Le diagnostic IA dans DiagnosePage s'affiche à l'écran mais ne peut pas
#     être sauvegardé ni transmis à un technicien terrain
#   - Le bouton "Exporter en PDF" dans DiagnosePage appelle POST /export/rapport-diagnostic
#     mais cet endpoint n'existe pas encore dans api.py
#
# SOLUTION : cet endpoint génère un PDF professionnel OCP avec :
#   - En-tête OCP + numéro de rapport automatique
#   - Code défaut + symptômes saisis
#   - Diagnostic complet IA
#   - Sources documentaires utilisées
#   - Pied de page avec avertissement légal
#
# Installation requise :
#   pip install reportlab
#
# Ajouter dans api.py :
#   from app.routers.export_router import router as export_router
#   app.include_router(export_router, prefix="/export", tags=["Export"])
# ─────────────────────────────────────────────────────────────────────────────

import io
import textwrap
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


# ── Schéma de la requête (identique à ce qu'envoie DiagnosePage) ──────────────
class RapportDiagRequest(BaseModel):
    fault_code:               Optional[str] = None
    symptoms:                 List[str] = []
    gmao_context:             Optional[str] = None
    hours_since_maintenance:  Optional[int] = None
    diagnostic:               str = ""
    sources:                  List[str] = []


# ── Couleurs OCP ───────────────────────────────────────────────────────────────
OCP_GREEN = (0,    132/255, 61/255)    # #00843D
OCP_SAND = (201/255, 168/255, 76/255)  # C9A84C
OCP_DARK = (42/255,  42/255, 30/255)  # #2A2A1E
OCP_MUTED = (138/255, 125/255, 96/255)  # #8A7D60
OCP_DANGER = (192/255, 57/255, 43/255)  # #C0392B


def _build_pdf(req: RapportDiagRequest) -> bytes:
    """
    Génère le PDF en mémoire avec reportlab et retourne les bytes.
    """
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import cm
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, HRFlowable,
            Table, TableStyle
        )
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
    except ImportError as e:
        raise RuntimeError(
            "reportlab non installé. Exécuter : pip install reportlab"
        ) from e

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm,  bottomMargin=2.5*cm,
    )

    W, H = A4
    styles = getSampleStyleSheet()

    # ── Styles personnalisés ─────────────────────────────────────────────────
    style_title = ParagraphStyle(
        "OcpTitle",
        fontName="Helvetica-Bold",
        fontSize=18,
        textColor=colors.HexColor("#00843D"),
        spaceAfter=4,
        leading=22,
    )
    style_sub = ParagraphStyle(
        "OcpSub",
        fontName="Helvetica",
        fontSize=9,
        textColor=colors.HexColor("#8A7D60"),
        spaceAfter=0,
        letterSpacing=1,
    )
    style_section = ParagraphStyle(
        "OcpSection",
        fontName="Helvetica-Bold",
        fontSize=10,
        textColor=colors.HexColor("#00843D"),
        spaceBefore=14,
        spaceAfter=6,
        borderPad=4,
        leftIndent=0,
    )
    style_body = ParagraphStyle(
        "OcpBody",
        fontName="Helvetica",
        fontSize=10,
        textColor=colors.HexColor("#2A2A1E"),
        leading=16,
        spaceAfter=4,
    )
    style_mono = ParagraphStyle(
        "OcpMono",
        fontName="Courier",
        fontSize=9,
        textColor=colors.HexColor("#2A2A1E"),
        leading=14,
        leftIndent=12,
        spaceAfter=2,
    )
    style_warn = ParagraphStyle(
        "OcpWarn",
        fontName="Helvetica-Oblique",
        fontSize=8,
        textColor=colors.HexColor("#C4760A"),
        leading=12,
    )
    style_footer = ParagraphStyle(
        "OcpFooter",
        fontName="Helvetica",
        fontSize=7,
        textColor=colors.HexColor("#8A7D60"),
        alignment=TA_CENTER,
        leading=10,
    )

    now = datetime.now()
    rapport_id = f"DIAG-994F-{now.strftime('%Y%m%d-%H%M%S')}"

    elements = []

    # ── EN-TÊTE ──────────────────────────────────────────────────────────────
    header_data = [[
        Paragraph("<b>OCP</b>", ParagraphStyle("hdr", fontName="Helvetica-Bold", fontSize=22,
                  textColor=colors.white)),
        Paragraph(
            f"<b>MineAssist — Rapport de diagnostic</b><br/>"
            f"<font size=8>CAT 994F · OCP Khouribga · {rapport_id}</font>",
            ParagraphStyle("hdrr", fontName="Helvetica", fontSize=11,
                           textColor=colors.white, leading=16)
        ),
        Paragraph(
            f"<font size=8>Généré le<br/>{now.strftime('%d/%m/%Y à %H:%M')}</font>",
            ParagraphStyle("hdrl", fontName="Helvetica", fontSize=8,
                           textColor=colors.white, alignment=TA_RIGHT, leading=12)
        ),
    ]]
    header_table = Table(header_data, colWidths=[2.5*cm, 11*cm, 3.5*cm])
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#00843D")),
        ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING",   (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 18))

    # ── AVERTISSEMENT ────────────────────────────────────────────────────────
    elements.append(Paragraph(
        "⚠ Aide à la décision uniquement — Consulter le manuel officiel CAT avant toute intervention.",
        style_warn
    ))
    elements.append(HRFlowable(width="100%", thickness=0.5,
                    color=colors.HexColor("#D4C9B0"), spaceAfter=12))

    # ── SECTION 1 : CONTEXTE ─────────────────────────────────────────────────
    elements.append(Paragraph("1. Contexte de l'intervention", style_section))

    context_rows = [
        ["Code défaut",   req.fault_code or "Non renseigné"],
        ["Heures maint.",
            f"{req.hours_since_maintenance} h" if req.hours_since_maintenance else "Non renseigné"],
        ["Engin",         "CAT 994F — OCP Khouribga"],
        ["Date analyse",  now.strftime("%d/%m/%Y %H:%M")],
        ["Référence",     rapport_id],
    ]
    ctx_table = Table(context_rows, colWidths=[5*cm, 11*cm])
    ctx_table.setStyle(TableStyle([
        ("FONTNAME",    (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME",    (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE",    (0, 0), (-1, -1), 9),
        ("TEXTCOLOR",   (0, 0), (0, -1), colors.HexColor("#5A5240")),
        ("TEXTCOLOR",   (1, 0), (1, -1), colors.HexColor("#2A2A1E")),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1),
         [colors.HexColor("#F7F0DC"), colors.HexColor("#FFFDF8")]),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("GRID",          (0, 0), (-1, -1), 0.3, colors.HexColor("#D4C9B0")),
    ]))
    elements.append(ctx_table)

    # ── SECTION 2 : SYMPTÔMES ────────────────────────────────────────────────
    if req.symptoms:
        elements.append(Paragraph("2. Symptômes rapportés", style_section))
        for s in req.symptoms:
            elements.append(Paragraph(f"• {s}", style_body))

    # ── SECTION 3 : CONTEXTE GMAO ───────────────────────────────────────────
    if req.gmao_context:
        elements.append(Paragraph("3. Contexte GMAO / historique", style_section))
        elements.append(Paragraph(req.gmao_context, style_body))

    # ── SECTION 4 : DIAGNOSTIC IA ────────────────────────────────────────────
    sec_num = 4 if (req.symptoms or req.gmao_context) else 2
    elements.append(Paragraph(f"{sec_num}. Diagnostic IA — MineAssist RAG", style_section))

    # Découper le diagnostic en paragraphes (préserver les sauts de ligne)
    for line in req.diagnostic.split("\n"):
        line = line.strip()
        if not line:
            elements.append(Spacer(1, 4))
            continue
        # Lignes qui commencent par un numéro ou •  → style monospace
        if line.startswith(("•", "-", "*", "1.", "2.", "3.")):
            elements.append(Paragraph(line, style_mono))
        else:
            elements.append(Paragraph(line, style_body))

    # ── SECTION 5 : SOURCES ──────────────────────────────────────────────────
    if req.sources:
        elements.append(Paragraph(f"{sec_num + 1}. Sources documentaires", style_section))
        for src in req.sources:
            icon = "📊" if ".pptx" in src.lower() else "📄"
            elements.append(Paragraph(f"{icon}  {src}", style_mono))

    # ── PIED DE PAGE ─────────────────────────────────────────────────────────
    elements.append(Spacer(1, 24))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#D4C9B0")))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph(
        f"MineAssist · CAT 994F1 · OCP Benguerir · Rapport {rapport_id} · "
        f"Généré le {now.strftime('%d/%m/%Y à %H:%M')} · "
        "Ce document est une aide à la décision, non un document d'intervention officiel.",
        style_footer
    ))

    doc.build(elements)
    return buf.getvalue()


@router.post("/rapport-diagnostic")
def export_rapport_diagnostic(req: RapportDiagRequest):
    """
    Génère et retourne un rapport PDF de diagnostic pour la CAT 994F.

    Reçoit exactement le même body que /diagnose + le diagnostic déjà calculé.
    Le frontend appelle cet endpoint APRÈS avoir obtenu la réponse de /diagnose.

    Retourne un fichier PDF en streaming.
    """
    try:
        pdf_bytes = _build_pdf(req)
    except RuntimeError as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(e))

    now = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"rapport_diagnostic_994F_{now}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )
