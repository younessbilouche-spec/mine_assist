# app/ocp/routers/prediction.py
#
# v2 PERF (perf_patch) :
#   - Cache du resultat predict() base sur (mtime + size + horizon).
#     Si le fichier Excel n'a pas change, on retourne instant le dernier
#     resultat sans relire le fichier ni relancer l'inference.
#   - Cache du DataFrame nettoye base sur (mtime + size).
#     Evite le pd.read_excel + clean_data a chaque requete (~5-10s pour 17 MB).
#
from typing import Optional
import os
import time
import threading
from fastapi import APIRouter, File, HTTPException, UploadFile, Request, Query
from fastapi.responses import JSONResponse

from app.ocp.utils.data_processing import load_data, clean_data
from pathlib import Path

router = APIRouter()

UPLOAD_DIR = Path(__file__).parent.parent.parent.parent / "data" / "ocp_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CURRENT_FILE = str(UPLOAD_DIR / "current_data.xlsx")

# ─────────────────────────────────────────────────────────────
# CACHE INTERNE
# ─────────────────────────────────────────────────────────────
_DF_CACHE = {"key": None, "df": None}
_RESULT_CACHE = {"key": None, "result": None}
_CACHE_LOCK = threading.Lock()


def _file_key(path: str) -> tuple:
    """Cle de cache : (path, mtime, size). Si le fichier change, la cle change."""
    try:
        st = os.stat(path)
        return (path, st.st_mtime_ns, st.st_size)
    except FileNotFoundError:
        return (path, 0, 0)


def _get_clean_df(path: str):
    """Charge + nettoie le DataFrame avec cache (mtime + size)."""
    key = _file_key(path)
    with _CACHE_LOCK:
        if _DF_CACHE["key"] == key and _DF_CACHE["df"] is not None:
            return _DF_CACHE["df"]
    # Reload
    df = clean_data(load_data(path))
    with _CACHE_LOCK:
        _DF_CACHE["key"] = key
        _DF_CACHE["df"] = df
    return df


def _invalidate_caches(model_service=None):
    with _CACHE_LOCK:
        _DF_CACHE["key"] = None
        _DF_CACHE["df"] = None
        _RESULT_CACHE["key"] = None
        _RESULT_CACHE["result"] = None
    if model_service is not None and hasattr(model_service, "invalidate_cache"):
        model_service.invalidate_cache()


# ─────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────

@router.get("/prediction")
def predict_current(request: Request, horizon: Optional[int] = Query(None)):
    if not os.path.isfile(CURRENT_FILE):
        raise HTTPException(
            status_code=404,
            detail="Aucun fichier de donnees charge. Utilisez POST /pred/upload d'abord."
        )

    cache_key = (_file_key(CURRENT_FILE), horizon)
    with _CACHE_LOCK:
        if _RESULT_CACHE["key"] == cache_key and _RESULT_CACHE["result"] is not None:
            cached = _RESULT_CACHE["result"]
            cached["_cached"] = True
            return JSONResponse(cached)

    t0 = time.time()
    df = _get_clean_df(CURRENT_FILE)
    t_load = round((time.time() - t0) * 1000)

    t1 = time.time()
    result = request.app.state.ocp_model_service.predict(df, horizon_override=horizon)
    t_pred = round((time.time() - t1) * 1000)

    result["_cached"] = False
    result["_timing"] = {"load_ms": t_load, "predict_ms": t_pred}

    with _CACHE_LOCK:
        _RESULT_CACHE["key"] = cache_key
        _RESULT_CACHE["result"] = result

    return JSONResponse(result)


@router.post("/prediction/upload")
async def predict_from_upload(request: Request, file: UploadFile = File(...)):
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Seuls .xlsx et .xls sont acceptes.")

    import tempfile
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
    try:
        with os.fdopen(tmp_fd, "wb") as f:
            f.write(await file.read())
        df = clean_data(load_data(tmp_path))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    # invalidate caches puisqu'on a une nouvelle donnee
    _invalidate_caches(request.app.state.ocp_model_service)
    result = request.app.state.ocp_model_service.predict(df)
    return JSONResponse(result)


@router.get("/prediction/status")
def prediction_status(request: Request):
    return request.app.state.ocp_model_service.get_status()


@router.post("/prediction/cache/clear")
def clear_cache(request: Request):
    """Force-clear du cache (a appeler apres upload manuel d'un nouveau fichier)."""
    _invalidate_caches(request.app.state.ocp_model_service)
    return {"ok": True, "message": "Cache vide."}
