# ============================================================
# routers/upload.py
# Upload d'un fichier Excel de donnees capteurs
# POST /pred/upload  → sauvegarde + validation + resume
# ============================================================

import os
import shutil
import tempfile

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.ocp.utils.data_processing import load_data, clean_data, label_points
from app.ocp.utils.thresholds import FEATURE_COLS, LABEL_NAMES
from pathlib import Path

router = APIRouter()

# Dossier de stockage temporaire du fichier courant
UPLOAD_DIR = "uploads"
UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "data" / "ocp_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CURRENT_FILE = str(UPLOAD_DIR / "current_data.xlsx")

os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/upload")
@router.post("/upload/")
async def upload_file(file: UploadFile = File(...)):
    """
    Telecharge un fichier Excel (.xlsx / .xls) de donnees capteurs.

    Retourne :
      - nb_points    : nombre de points apres nettoyage
      - date_debut   : premiere date
      - date_fin     : derniere date
      - colonnes     : colonnes detectees
      - label_counts : repartition des labels (0/1/2/3)
    """
    # Verifier l extension
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400,
            detail="Seuls les fichiers .xlsx et .xls sont acceptes.",
        )

    # Sauvegarder dans un temp puis valider avant de remplacer
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
    try:
        with os.fdopen(tmp_fd, "wb") as f:
            content = await file.read()
            f.write(content)

        # Validation : chargement + nettoyage
        df = load_data(tmp_path)
        if len(df) == 0:
            raise HTTPException(
                status_code=422,
                detail="Le fichier ne contient aucune ligne valide.",
            )

        missing = [c for c in FEATURE_COLS if c not in df.columns]
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"Colonnes capteurs manquantes : {missing}. "
                       f"Colonnes detectees : {list(df.columns)}",
            )

        df_clean = clean_data(df)
        labels   = label_points(df_clean)

        unique, counts = zip(*sorted(
            {int(l): int((labels == l).sum()) for l in set(labels)}.items()
        ))

        # Remplacer le fichier courant
        shutil.copy2(tmp_path, CURRENT_FILE)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500,
                            detail=f"Erreur lors du traitement : {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    return JSONResponse({
        "success":     True,
        "filename":    file.filename,
        "nb_points":   len(df_clean),
        "date_debut":  str(df_clean["Date"].min()),
        "date_fin":    str(df_clean["Date"].max()),
        "colonnes":    list(df_clean.columns),
        "label_counts": {
            LABEL_NAMES.get(l, str(l)): int(c)
            for l, c in zip(unique, counts)
        },
    })


@router.get("/upload/status")
def upload_status():
    """Indique si un fichier de donnees est disponible."""
    exists = os.path.isfile(CURRENT_FILE)
    if not exists:
        return {"file_loaded": False}

    try:
        df = load_data(CURRENT_FILE)
        df = clean_data(df)
        return {
            "file_loaded": True,
            "nb_points":   len(df),
            "date_debut":  str(df["Date"].min()),
            "date_fin":    str(df["Date"].max()),
        }
    except Exception as e:
        return {"file_loaded": False, "error": str(e)}
