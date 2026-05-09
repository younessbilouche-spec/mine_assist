import os
import ast
import hashlib
import re
from pathlib import Path
from typing import List, Optional, Any
from app.routers.export_router import router as export_router
from app.routers.ml_router import router as ml_router
from app.oil_analysis_router import router as oil_router
from datetime import datetime, timedelta
from app.sim_router import sim_router
from app.ocp.router import ocp_router, load_rul_models


from fastapi import FastAPI, Depends
# ── Lifespan — charger les modèles XGBoost + RandomForest au démarrage ──────
from contextlib import asynccontextmanager




import pandas as pd
from app.auth import auth_router, get_current_user, require_role

from app.capteur_thresholds import (
    CAPTEUR_THRESHOLDS,
    clean_param_name,
    find_capteur_rule,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Charger les modèles XGBoost + RandomForest (PFE 2025)
    # LSTM/CNN-LSTM supprimé — AUC=0.34 (pire qu'aléatoire)
    try:
        load_rul_models()
        print("✅ Modèles XGBoost + RandomForest chargés (RUL prédictif).")
    except Exception as e:
        print(f"⚠️  Modèles RUL non disponibles : {e}")
    yield




_GMAO_CAPTEURS_CACHE = None
def load_gmao_capteurs() -> tuple[pd.DataFrame, list[dict]]:
    global _GMAO_CAPTEURS_CACHE

    if _GMAO_CAPTEURS_CACHE is not None:
        return _GMAO_CAPTEURS_CACHE, []

    print("⏳ Chargement des capteurs (cache froid)...")

    all_files = [
        f for f in list((BASE_DIR / "data" / "gmao" / "capteurs").glob("*.xlsx")) +
                    list((BASE_DIR / "data" / "gmao" / "capteurs").glob("*.xls")) +
                    list((BASE_DIR / "data" / "gmao" / "capteurs").glob("*.csv"))
        if not f.name.startswith("~$")
    ]

    if not all_files:
        raise HTTPException(status_code=404, detail="Aucun fichier capteurs trouvé dans data/gmao/capteurs")

    frames = []
    file_debug = []

    for f in all_files:
        try:
            raw_df = _read_capteur_file(f)
            std_df = _standardize_capteur_dataframe(raw_df, f.name)

            if std_df.empty:
                file_debug.append({
                    "file": f.name,
                    "status": "ignored",
                    "kind": "capteurs",
                    "reason": "Aucune ligne exploitable",
                })
                continue

            std_df["horodatage"] = pd.to_datetime(std_df["horodatage"], errors="coerce")
            std_df["val_min"] = pd.to_numeric(std_df["val_min"], errors="coerce")
            std_df["val_moy"] = pd.to_numeric(std_df["val_moy"], errors="coerce")
            std_df["val_max"] = pd.to_numeric(std_df["val_max"], errors="coerce")
            std_df = std_df.dropna(subset=["parametre", "horodatage"]).copy()

            frames.append(std_df)
            file_debug.append({
                "file": f.name,
                "status": "ok",
                "kind": "capteurs",
                "rows": len(std_df),
                "machine": std_df["machine"].iloc[0] if not std_df.empty else "N/A",
            })
            print(f"✅ GMAO capteurs chargé : {f.name} ({len(std_df)} lignes)")
        except Exception as e:
            file_debug.append({
                "file": f.name,
                "status": "error",
                "kind": "capteurs",
                "reason": str(e),
            })
            print(f"⚠️ Erreur lecture capteurs {f.name}: {e}")

    if not frames:
        raise HTTPException(status_code=500, detail="Impossible d'exploiter les fichiers capteurs")

    df = pd.concat(frames, ignore_index=True)
    df = df.sort_values("horodatage").reset_index(drop=True)

    _GMAO_CAPTEURS_CACHE = df
    return _GMAO_CAPTEURS_CACHE, file_debug
_GMAO_ANOMALIES = None
_GMAO_CAPTEURS = None
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from openai import OpenAI

from app.notifications_router import notifications_router
from app.rag_engine import RAGEngine
from app.pdf_image_extractor import extract_images_for_sources, check_dependencies

load_dotenv()

APP_NAME = os.getenv("APP_NAME", "MineAssist 994F")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct")
TOP_K = int(os.getenv("TOP_K", "5"))
MAX_CHARS_CONTEXT = int(os.getenv("MAX_CHARS_CONTEXT", "6000"))

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
ALLOW_ALL_ORIGINS = "*" in ALLOWED_ORIGINS

app = FastAPI(title=APP_NAME,lifespan=lifespan,)
app.include_router(export_router, prefix="/export", tags=["Export PDF"])
app.include_router(ml_router, prefix="/ml", tags=["Machine Learning"])
app.include_router(auth_router)
app.include_router(notifications_router)
app.include_router(oil_router)
app.include_router(sim_router)
app.include_router(
    ocp_router,
    prefix="/pred",
    tags=["Maintenance Prédictive — XGBoost + RandomForest"],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOW_ALL_ORIGINS else ALLOWED_ORIGINS,
    allow_credentials=not ALLOW_ALL_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

rag = RAGEngine()

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

GMAO_ANOMALIES_DIR = DATA_DIR / "gmao" / "anomalies"
GMAO_CAPTEURS_DIR = DATA_DIR / "gmao" / "capteurs"


class AskRequest(BaseModel):
    question: str


class DiagnoseRequest(BaseModel):
    fault_code: Optional[str] = None
    symptoms: List[str] = Field(default_factory=list)
    gmao_context: Optional[str] = None
    hours_since_maintenance: Optional[int] = None






@app.on_event("startup")
def startup_event():
    deps = check_dependencies()
    print(
        f"[OK] MineAssist démarré | PyMuPDF={deps['pymupdf']} | "
        f"pdf2image={deps['pdf2image']}"
    )


@app.get("/")
def root():
    return {"message": APP_NAME, "status": "running"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": OPENROUTER_MODEL,
        "pdf_images": check_dependencies(),
    }


@app.post("/index-documents")
def index_documents():
    try:
        result = rag.index_all()
        return {"status": "ok", "details": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _normalize_col_name(name: Any) -> str:
    if name is None:
        return ""
    s = str(name).strip().lower()
    replacements = {
        "é": "e", "è": "e", "ê": "e", "ë": "e",
        "à": "a", "â": "a", "ä": "a",
        "ù": "u", "û": "u", "ü": "u",
        "ô": "o", "ö": "o",
        "î": "i", "ï": "i",
        "ç": "c",
        "’": "'",
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _find_matching_column(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    normalized_map = {_normalize_col_name(c): c for c in df.columns}

    for cand in candidates:
        norm_cand = _normalize_col_name(cand)
        if norm_cand in normalized_map:
            return normalized_map[norm_cand]

    for cand in candidates:
        norm_cand = _normalize_col_name(cand)
        for norm_col, original_col in normalized_map.items():
            if norm_cand in norm_col or norm_col in norm_cand:
                return original_col

    return None


def _normalize_machine_label(value: Any) -> str:
    if value is None:
        return "N/A"

    raw = str(value).strip()
    compact = re.sub(r"[^A-Z0-9]", "", raw.upper())

    if compact in {"994F1", "994F01"}:
        return "994F-1"
    if compact in {"994F2", "994F02"}:
        return "994F-2"

    return raw


def _detect_machine_from_filename(filename: str) -> str:
    name = filename.upper().replace(" ", "")
    if "994F1" in name or "994F-1" in name:
        return "994F-1"
    if "994F2" in name or "994F-2" in name:
        return "994F-2"
    return _normalize_machine_label(Path(filename).stem)


def _safe_read_excel(path: Path, header: int = 0) -> pd.DataFrame:
    return pd.read_excel(path, header=header)


def _hash_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


# ─────────────────────────────────────────────────────────────
# GMAO ANOMALIES
# ─────────────────────────────────────────────────────────────

def _read_anomaly_file(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    return _safe_read_excel(path, header=0)


def _standardize_anomaly_dataframe(df: pd.DataFrame, source_file: str) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]

    col_date = _find_matching_column(df, [
        "Date de l'anomalie", "Date anomalie", "Date", "Date événement",
        "Date evenement", "Date d'anomalie"
    ])
    col_severity = _find_matching_column(df, [
        "Gravité", "Gravite", "Criticité", "Criticite", "Severity", "Priorité", "Priorite"
    ])
    col_code = _find_matching_column(df, [
        "Code d'anomalie", "Code anomalie", "Code", "Fault Code",
        "Code défaut", "Code defaut", "Anomaly Code"
    ])
    col_source = _find_matching_column(df, [
        "Source", "Sous-système", "Sous systeme", "System", "Subsystem"
    ])
    col_type = _find_matching_column(df, [
        "Type", "Catégorie", "Categorie", "Classe", "Nature"
    ])
    col_occurrences = _find_matching_column(df, [
        "Occurrences", "Occurrence", "Count", "Nombre", "Nb occurrences"
    ])
    col_hours = _find_matching_column(df, [
        "Heures Valeur", "Heures", "Heures de service", "Service Hours", "Compteur heures"
    ])

    out = pd.DataFrame()
    out["machine"] = [_normalize_machine_label(_detect_machine_from_filename(source_file))] * len(df)

    if col_date:
        out["Date de l'anomalie"] = pd.to_datetime(df[col_date], errors="coerce")
    else:
        out["Date de l'anomalie"] = pd.NaT

    if col_severity:
        out["Gravité"] = pd.to_numeric(df[col_severity], errors="coerce")
    else:
        out["Gravité"] = None

    if col_code:
        out["Code d'anomalie"] = df[col_code].astype(str).str.strip()
    else:
        out["Code d'anomalie"] = ""

    if col_source:
        out["Source"] = df[col_source].astype(str).str.strip()
    else:
        out["Source"] = "Non renseigné"

    if col_type:
        out["Type"] = df[col_type].astype(str).str.strip()
    else:
        out["Type"] = "Non renseigné"

    if col_occurrences:
        out["Occurrences"] = pd.to_numeric(df[col_occurrences], errors="coerce").fillna(1)
    else:
        out["Occurrences"] = 1

    if col_hours:
        out["Heures Valeur"] = pd.to_numeric(df[col_hours], errors="coerce")
    else:
        out["Heures Valeur"] = None

    out = out[
        out["Code d'anomalie"].notna()
        & (out["Code d'anomalie"].astype(str).str.strip() != "")
        & (out["Code d'anomalie"].astype(str).str.lower() != "nan")
    ].copy()

    out["Source"] = out["Source"].replace({"": "Non renseigné", "nan": "Non renseigné"})
    out["Type"] = out["Type"].replace({"": "Non renseigné", "nan": "Non renseigné"})
    out["Gravité"] = out["Gravité"].fillna(0).astype(int)

    out["month"] = out["Date de l'anomalie"].dt.to_period("M").astype(str)
    out = out[out["month"] != "NaT"].copy()

    return out


def _parse_anomaly_location(value):
    """
    Parse une valeur du type "[32.24516,-7.82953,0.0]" vers (lat, lon, alt)
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None, None, None

    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None, None, None

    try:
        parsed = ast.literal_eval(text)
        if isinstance(parsed, (list, tuple)) and len(parsed) >= 2:
            lat = float(parsed[0])
            lon = float(parsed[1])
            alt = float(parsed[2]) if len(parsed) >= 3 and parsed[2] is not None else None
            return lat, lon, alt
    except Exception:
        pass

    return None, None, None


def _zone_from_coords(lat, lon):
    if lat is None or lon is None:
        return "Inconnu"

    lat = float(lat)
    lon = float(lon)

    if 32.248 <= lat <= 32.255 and -7.845 <= lon <= -7.835:
        return "Zone chargement"
    if 32.242 <= lat <= 32.248 and -7.842 <= lon <= -7.833:
        return "Zone circulation"
    if 32.236 <= lat <= 32.242 and -7.840 <= lon <= -7.830:
        return "Zone rampe"

    if lat >= 32.246:
        return "Secteur nord"
    if lon <= -7.838:
        return "Secteur ouest"
    return "Secteur sud"


def _location_candidates():
    return [
        "Emplacement de l'anomalie", "Emplacement", "Location", "GPS",
        "Coordonnées GPS", "Coordonnees GPS", "Coordonnées", "Coordonnees",
        "Latitude/Longitude", "Lat/Lon"
    ]


@app.get("/gmao/geo-anomalies")
def gmao_geo_anomalies():
    """
    Analyse spatiale des anomalies.
    Retourne les points GPS, zones fréquentes, défauts dominants par zone
    et une lecture métier simple.
    """
    try:
        all_files = (
            list(GMAO_ANOMALIES_DIR.glob("*.xlsx")) +
            list(GMAO_ANOMALIES_DIR.glob("*.xls")) +
            list(GMAO_ANOMALIES_DIR.glob("*.csv"))
        )

        if not all_files:
            raise HTTPException(
                status_code=404,
                detail="Aucun fichier anomalies trouvé dans data/gmao/anomalies"
            )

        frames = []
        for f in all_files:
            if f.name.startswith("~$"):
                continue

            try:
                raw_df = _read_anomaly_file(f)
                std_df = _standardize_anomaly_dataframe(raw_df, f.name)

                loc_col = _find_matching_column(raw_df, _location_candidates())

                if loc_col and not std_df.empty:
                    raw_df = raw_df.reset_index(drop=True)
                    std_df = std_df.reset_index(drop=True)
                    std_df["Emplacement de l'anomalie"] = raw_df[loc_col].astype(str)

                frames.append(std_df)

            except Exception as e:
                print(f"⚠️ Erreur lecture anomalies géo {f.name}: {e}")
                continue

        if not frames:
            raise HTTPException(
                status_code=500,
                detail="Impossible d'exploiter les fichiers anomalies"
            )

        df = pd.concat(frames, ignore_index=True)

        if "Emplacement de l'anomalie" not in df.columns:
            raise HTTPException(
                status_code=400,
                detail="La colonne 'Emplacement de l'anomalie' est absente"
            )

        coords = df["Emplacement de l'anomalie"].apply(_parse_anomaly_location)
        df["lat"] = coords.apply(lambda x: x[0])
        df["lon"] = coords.apply(lambda x: x[1])
        df["alt"] = coords.apply(lambda x: x[2])

        df = df.dropna(subset=["lat", "lon"]).copy()

        if df.empty:
            raise HTTPException(
                status_code=404,
                detail="Aucune anomalie géolocalisable trouvée"
            )

        df["zone"] = df.apply(
            lambda row: _zone_from_coords(row["lat"], row["lon"]),
            axis=1
        )

        if df["zone"].nunique() <= 1 and len(df) >= 4:
            lat_mid = float(df["lat"].median())
            lon_mid = float(df["lon"].median())

            def _dynamic_zone(row):
                if row["lat"] >= lat_mid and row["lon"] <= lon_mid:
                    return "Secteur nord-ouest"
                if row["lat"] >= lat_mid and row["lon"] > lon_mid:
                    return "Secteur nord-est"
                if row["lat"] < lat_mid and row["lon"] <= lon_mid:
                    return "Secteur sud-ouest"
                return "Secteur sud-est"

            df["zone"] = df.apply(_dynamic_zone, axis=1)

        df["Gravité"] = pd.to_numeric(df["Gravité"], errors="coerce").fillna(0).astype(int)
        df["Occurrences"] = pd.to_numeric(df["Occurrences"], errors="coerce").fillna(1).astype(int)

        points = (
            df.sort_values("Date de l'anomalie", ascending=False)
            .head(500)
            .assign(date=lambda x: x["Date de l'anomalie"].astype(str))
        )

        map_points = []
        for _, row in points.iterrows():
            map_points.append({
                "lat": round(float(row["lat"]), 6),
                "lon": round(float(row["lon"]), 6),
                "alt": round(float(row["alt"]), 2) if pd.notna(row["alt"]) else None,
                "machine": str(row.get("machine", "N/A")),
                "code": str(row.get("Code d'anomalie", "")),
                "source": str(row.get("Source", "")),
                "type": str(row.get("Type", "")),
                "gravite": int(row.get("Gravité", 0)),
                "occurrences": int(row.get("Occurrences", 1)),
                "zone": str(row.get("zone", "Inconnu")),
                "date": str(row.get("date", ""))[:19].replace("T", " "),
            })

        top_zones = (
            df.groupby("zone")
            .agg(
                anomalies=("zone", "size"),
                gravite_moy=("Gravité", "mean"),
                occurrences_total=("Occurrences", "sum"),
                lat_centre=("lat", "mean"),
                lon_centre=("lon", "mean"),
            )
            .reset_index()
            .sort_values(["anomalies", "occurrences_total"], ascending=False)
        )
        top_zones["gravite_moy"] = top_zones["gravite_moy"].round(2)

        geo_insight = ""
        if not top_zones.empty:
            z = top_zones.iloc[0]
            if z["gravite_moy"] >= 2.5:
                geo_insight = (
                    f"La zone {z['zone']} est prioritaire : "
                    f"{int(z['anomalies'])} anomalies avec une gravité moyenne élevée "
                    f"({z['gravite_moy']})."
                )
            else:
                geo_insight = (
                    f"La zone {z['zone']} concentre le plus d'anomalies "
                    f"({int(z['anomalies'])}). Une vérification terrain est recommandée."
                )

        top_codes_by_zone = (
            df.groupby(["zone", "Code d'anomalie"])
            .size()
            .reset_index(name="count")
            .sort_values(["zone", "count"], ascending=[True, False])
        )
        top_codes_by_zone = (
            top_codes_by_zone.groupby("zone")
            .head(5)
            .to_dict(orient="records")
        )

        severity_by_zone = (
            df.groupby(["zone", "Gravité"])
            .size()
            .reset_index(name="count")
            .sort_values(["zone", "Gravité"])
            .to_dict(orient="records")
        )

        bounds = {
            "min_lat": round(float(df["lat"].min()), 6),
            "max_lat": round(float(df["lat"].max()), 6),
            "min_lon": round(float(df["lon"].min()), 6),
            "max_lon": round(float(df["lon"].max()), 6),
        }

        center = {
            "lat": round(float(df["lat"].mean()), 6),
            "lon": round(float(df["lon"].mean()), 6),
        }

        return {
            "total_geo_anomalies": int(len(df)),
            "machines": sorted(df["machine"].dropna().astype(str).unique().tolist()),
            "center": center,
            "bounds": bounds,
            "map_points": map_points,
            "top_zones": top_zones.to_dict(orient="records"),
            "geo_insight": geo_insight,
            "top_codes_by_zone": top_codes_by_zone,
            "severity_by_zone": severity_by_zone,
            "zones_detected": sorted(df["zone"].dropna().astype(str).unique().tolist()),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@app.get("/gmao/stats")
def gmao_stats():
    """
    Dashboard 1 — GMAO / anomalies historiques
    Lit seulement data/gmao/anomalies/
    """
    try:
        all_files = (
            list(GMAO_ANOMALIES_DIR.glob("*.xlsx")) +
            list(GMAO_ANOMALIES_DIR.glob("*.xls")) +
            list(GMAO_ANOMALIES_DIR.glob("*.csv"))
        )

        if not all_files:
            raise HTTPException(
                status_code=404,
                detail="Aucun fichier anomalies trouvé dans data/gmao/anomalies"
            )

        frames = []
        file_debug = []
        duplicate_files = []
        seen_hashes: dict[str, str] = {}

        for f in all_files:
            try:
                file_hash = _hash_file(f)
                if file_hash in seen_hashes:
                    duplicate_files.append({
                        "file": f.name,
                        "duplicate_of": seen_hashes[file_hash],
                        "reason": "hash_identique",
                    })
                    file_debug.append({
                        "file": f.name,
                        "status": "duplicate",
                        "kind": "anomalies",
                        "duplicate_of": seen_hashes[file_hash],
                    })
                    print(f"⚠️ Fichier anomalies dupliqué ignoré : {f.name} = {seen_hashes[file_hash]}")
                    continue

                raw_df = _read_anomaly_file(f)
                std_df = _standardize_anomaly_dataframe(raw_df, f.name)

                if std_df.empty:
                    file_debug.append({
                        "file": f.name,
                        "status": "ignored",
                        "kind": "anomalies",
                        "reason": "Aucune ligne exploitable",
                    })
                    continue

                seen_hashes[file_hash] = f.name
                frames.append(std_df)
                file_debug.append({
                    "file": f.name,
                    "status": "ok",
                    "kind": "anomalies",
                    "rows": len(std_df),
                    "machine": std_df["machine"].iloc[0] if not std_df.empty else "N/A",
                })
                print(f"✅ GMAO anomalies chargé : {f.name} ({len(std_df)} lignes)")
            except Exception as e:
                file_debug.append({
                    "file": f.name,
                    "status": "error",
                    "kind": "anomalies",
                    "reason": str(e),
                })
                print(f"⚠️ Erreur lecture anomalies {f.name}: {e}")

        if not frames:
            raise HTTPException(
                status_code=500,
                detail="Impossible d'exploiter les fichiers anomalies"
            )

        df = pd.concat(frames, ignore_index=True)
        df["month"] = df["Date de l'anomalie"].dt.to_period("M").astype(str)

        total = int(len(df))
        occurrences_total = int(pd.to_numeric(df["Occurrences"], errors="coerce").fillna(0).sum())

        by_severity = {
            int(k): int(v)
            for k, v in df["Gravité"].value_counts().sort_index().items()
        }
        by_machine = {
            str(k): int(v)
            for k, v in df["machine"].value_counts().items()
        }

        monthly = (
            df.groupby(["machine", "month"])
            .size()
            .reset_index(name="count")
            .sort_values(["machine", "month"])
            .to_dict(orient="records")
        )

        top_codes = (
            df.groupby(["Code d'anomalie", "Gravité"])
            .size()
            .reset_index(name="count")
            .sort_values("count", ascending=False)
            .head(15)
            .to_dict(orient="records")
        )

        top_codes_occurrences = (
            df.groupby(["Code d'anomalie", "Gravité"])["Occurrences"]
            .sum()
            .reset_index(name="occurrences")
            .sort_values("occurrences", ascending=False)
            .head(15)
            .to_dict(orient="records")
        )

        by_source = (
            df.groupby(["machine", "Source"])
            .size()
            .reset_index(name="count")
            .sort_values("count", ascending=False)
            .to_dict(orient="records")
        )

        by_type = (
            df.groupby(["machine", "Type"])
            .size()
            .reset_index(name="count")
            .sort_values("count", ascending=False)
            .to_dict(orient="records")
        )

        severity_mix_by_machine = (
            df.groupby(["machine", "Gravité"])
            .size()
            .reset_index(name="count")
            .sort_values(["machine", "Gravité"])
            .to_dict(orient="records")
        )

        g3_df = df[df["Gravité"] == 3].copy()
        if not g3_df.empty:
            critical_g3 = (
                g3_df.groupby("Code d'anomalie")["Occurrences"]
                .sum()
                .sort_values(ascending=False)
                .reset_index()
                .rename(columns={
                    "Code d'anomalie": "code",
                    "Occurrences": "occurrences",
                })
                .to_dict(orient="records")
            )
        else:
            critical_g3 = []

        service_hours_by_machine = {
            str(machine): round(float(hours), 1)
            for machine, hours in df.groupby("machine")["Heures Valeur"].max().dropna().items()
        }

        service_hours_span_by_machine = {}
        date_range_by_machine = {}
        active_months_by_machine = {}
        comparison_by_machine = {}

        for machine, machine_df in df.groupby("machine"):
            machine_name = str(machine)
            monthly_machine = (
                machine_df.groupby("month")
                .size()
                .sort_values(ascending=False)
            )
            sources_machine = (
                machine_df.groupby("Source")
                .size()
                .sort_values(ascending=False)
            )
            codes_machine = (
                machine_df.groupby("Code d'anomalie")
                .size()
                .sort_values(ascending=False)
            )
            occ_codes_machine = (
                machine_df.groupby("Code d'anomalie")["Occurrences"]
                .sum()
                .sort_values(ascending=False)
            )

            total_machine = len(machine_df)
            sev_ge2_rate = round(float(((machine_df["Gravité"] >= 2).sum() / total_machine) * 100), 1) if total_machine else 0.0
            diagnostic_share = round(float(((machine_df["Type"].astype(str) == "Diagnostic").sum() / total_machine) * 100), 1) if total_machine else 0.0

            if machine_df["Heures Valeur"].notna().any():
                hours_span = float(machine_df["Heures Valeur"].max() - machine_df["Heures Valeur"].min())
                service_hours_span_by_machine[machine_name] = round(hours_span, 1)
            else:
                hours_span = 0.0

            if machine_df["Date de l'anomalie"].notna().any():
                start_date = machine_df["Date de l'anomalie"].min()
                end_date = machine_df["Date de l'anomalie"].max()
                date_range_by_machine[machine_name] = {
                    "start": start_date.strftime("%Y-%m-%d"),
                    "end": end_date.strftime("%Y-%m-%d"),
                }

            active_months_by_machine[machine_name] = int(machine_df["month"].nunique())

            comparison_by_machine[machine_name] = {
                "criticality_rate": sev_ge2_rate,
                "diagnostic_share": diagnostic_share,
                "top_month": monthly_machine.index[0] if not monthly_machine.empty else None,
                "top_source": sources_machine.index[0] if not sources_machine.empty else None,
                "top_code": codes_machine.index[0] if not codes_machine.empty else None,
                "top_code_occurrences": occ_codes_machine.index[0] if not occ_codes_machine.empty else None,
                "event_rate_per_100h": round((total_machine / hours_span) * 100, 1) if hours_span > 0 else None,
                "occurrence_rate_per_100h": round((float(machine_df["Occurrences"].fillna(0).sum()) / hours_span) * 100, 1) if hours_span > 0 else None,
            }

        top_machine = max(by_machine, key=by_machine.get) if by_machine else None
        top_source = by_source[0]["Source"] if by_source else None
        coverage_mismatch = len(set(active_months_by_machine.values())) > 1 if active_months_by_machine else False

        return {
            "total": total,
            "occurrences_total": occurrences_total,
            "by_severity": by_severity,
            "by_machine": by_machine,
            "service_hours_by_machine": service_hours_by_machine,
            "service_hours_span_by_machine": service_hours_span_by_machine,
            "active_months_by_machine": active_months_by_machine,
            "date_range_by_machine": date_range_by_machine,
            "comparison_by_machine": comparison_by_machine,
            "severity_mix_by_machine": severity_mix_by_machine,
            "monthly": monthly,
            "top_codes": top_codes,
            "top_codes_occurrences": top_codes_occurrences,
            "by_source": by_source,
            "by_type": by_type,
            "critical_g3": critical_g3,
            "duplicate_files": duplicate_files,
            "summary": {
                "top_machine": top_machine,
                "top_source": top_source,
                "g3_total": int((df["Gravité"] == 3).sum()),
                "g2_total": int((df["Gravité"] == 2).sum()),
                "g1_total": int((df["Gravité"] == 1).sum()),
                "coverage_mismatch": coverage_mismatch,
            },
            "files_loaded": file_debug,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────
# GMAO CAPTEURS / PARAMÈTRES DIAGNOSTIC
# ─────────────────────────────────────────────────────────────

def _read_capteur_file(path: Path) -> pd.DataFrame:
    """
    Gère deux formats d'exports capteurs :
    - format classique avec colonnes à la ligne 9
    - format direct avec colonnes à la ligne 1
    """
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)

    # Essai 1 : format standard avec 8 lignes d'en-tête
    try:
        df = pd.read_excel(path, header=8)
        cols = [str(c).strip() for c in df.columns]

        if "Paramètres Diagnostic" in cols or "Parametres Diagnostic" in cols:
            return df
    except Exception:
        pass

    # Essai 2 : format direct avec colonnes dès la première ligne
    try:
        df = pd.read_excel(path, header=0)
        cols = [str(c).strip() for c in df.columns]

        if "Paramètres Diagnostic" in cols or "Parametres Diagnostic" in cols:
            return df
    except Exception:
        pass

    raise ValueError(f"Impossible de détecter l'en-tête du fichier capteur : {path.name}")


def _standardize_capteur_dataframe(df: pd.DataFrame, source_file: str) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]

    col_machine = _find_matching_column(df, [
        "Engin", "Machine", "Equipement", "Equipment"
    ])
    col_param = _find_matching_column(df, [
        "Paramètres Diagnostic", "Parametres Diagnostic", "Paramètre", "Parametre"
    ])
    col_time = _find_matching_column(df, [
        "Heure", "Date", "Horodatage", "Timestamp"
    ])
    col_min = _find_matching_column(df, [
        "Valeur minimale", "Val_min", "Minimum", "Min"
    ])
    col_avg = _find_matching_column(df, [
        "Valeur moyenne", "Val_moy", "Moyenne", "Average", "Avg"
    ])
    col_max = _find_matching_column(df, [
        "Valeur maximale", "Val_max", "Maximum", "Max"
    ])
    col_unit = _find_matching_column(df, [
        "Unité de mesure", "Unite de mesure", "Unité", "Unite", "Unit"
    ])

    out = pd.DataFrame()

    if col_machine:
        out["machine"] = df[col_machine].apply(_normalize_machine_label)
    else:
        out["machine"] = _normalize_machine_label(_detect_machine_from_filename(source_file))

    if col_param:
        out["parametre"] = df[col_param].astype(str).str.strip()
    else:
        out["parametre"] = ""

    if col_time:
        out["horodatage"] = pd.to_datetime(df[col_time], errors="coerce")
    else:
        out["horodatage"] = pd.NaT

    out["val_min"] = pd.to_numeric(df[col_min], errors="coerce") if col_min else None
    out["val_moy"] = pd.to_numeric(df[col_avg], errors="coerce") if col_avg else None
    out["val_max"] = pd.to_numeric(df[col_max], errors="coerce") if col_max else None

    if col_unit:
        out["unite"] = df[col_unit].astype(str).str.strip()
    else:
        out["unite"] = ""

    out = out[
        out["parametre"].notna()
        & (out["parametre"].astype(str).str.strip() != "")
        & (out["parametre"].astype(str).str.lower() != "nan")
    ].copy()

    return out


# ─────────────────────────────────────────────────────────────
# ALERTES CAPTEURS
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# SEUILS OFFICIELS OCP BENGUERIR — CHARGEUSE 994F
# Source : seulles.xlsx (validé équipe maintenance OCP)
# Températures : seuil MAX uniquement (alertes hautes)
# Pressions : MIN et/ou MAX selon le paramètre
# ─────────────────────────────────────────────────────────────

def detect_capteur_alertes(df: pd.DataFrame) -> list[dict]:
    alertes = []
    if df.empty:
        return alertes

    # ── 1. Alertes temps réel : dernière mesure par paramètre ──
    latest_df = (
        df.sort_values("horodatage")
        .groupby(["machine", "parametre"], as_index=False)
        .tail(1)
    )

    for _, row in latest_df.iterrows():
        param      = str(row.get("parametre", "")).strip()
        val_max    = row.get("val_max")
        val_min    = row.get("val_min")
        machine    = row.get("machine", "N/A")
        unite      = row.get("unite", "")
        horodatage = row.get("horodatage")

        for key, rule in CAPTEUR_THRESHOLDS.items():
            if key.lower() in param.lower():
                if "max" in rule and pd.notna(val_max) and float(val_max) > float(rule["max"]):
                    alertes.append({
                        "machine":      str(machine),
                        "parametre":    param,
                        "type":         "max",
                        "valeur":       float(val_max),
                        "seuil":        float(rule["max"]),
                        "niveau":       rule["niveau"],
                        "unite":        unite,
                        "horodatage":   str(horodatage) if pd.notna(horodatage) else "",
                        "source":       "temps_reel",
                        "source_seuil": rule.get("source_seuil", "OCP FMS officiel"),
                    })
                if "min" in rule and pd.notna(val_min) and float(val_min) < float(rule["min"]):
                    alertes.append({
                        "machine":      str(machine),
                        "parametre":    param,
                        "type":         "min",
                        "valeur":       float(val_min),
                        "seuil":        float(rule["min"]),
                        "niveau":       rule["niveau"],
                        "unite":        unite,
                        "horodatage":   str(horodatage) if pd.notna(horodatage) else "",
                        "source":       "temps_reel",
                        "source_seuil": rule.get("source_seuil", "OCP FMS officiel"),
                    })

    # ── 2. Alertes historiques : max/min absolu sur toute la période ──
    hist_df = (
        df.groupby(["parametre", "machine"], as_index=False)
        .agg(
            val_max_hist=("val_max", "max"),
            val_min_hist=("val_min", "min"),
            unite=("unite", "first"),
            horodatage_max=("horodatage", "max"),
        )
    )

    seen_hist = set()

    for _, row in hist_df.iterrows():
        param        = str(row.get("parametre", "")).strip()
        val_max_hist = row.get("val_max_hist")
        val_min_hist = row.get("val_min_hist")
        machine      = row.get("machine", "N/A")
        unite        = row.get("unite", "")
        horodatage   = row.get("horodatage_max")

        for key, rule in CAPTEUR_THRESHOLDS.items():
            if key.lower() in param.lower():
                if "max" in rule and pd.notna(val_max_hist) and float(val_max_hist) > float(rule["max"]):
                    uid = f"{machine}:{param}:max_hist"
                    if uid not in seen_hist:
                        seen_hist.add(uid)
                        alertes.append({
                            "machine":      str(machine),
                            "parametre":    param,
                            "type":         "max",
                            "valeur":       float(val_max_hist),
                            "seuil":        float(rule["max"]),
                            "niveau":       rule["niveau"],
                            "unite":        unite,
                            "horodatage":   str(horodatage) if pd.notna(horodatage) else "",
                            "source":       "historique",
                            "source_seuil": rule.get("source_seuil", "OCP FMS officiel"),
                        })
                if "min" in rule and pd.notna(val_min_hist) and float(val_min_hist) < float(rule["min"]):
                    uid = f"{machine}:{param}:min_hist"
                    if uid not in seen_hist:
                        seen_hist.add(uid)
                        alertes.append({
                            "machine":      str(machine),
                            "parametre":    param,
                            "type":         "min",
                            "valeur":       float(val_min_hist),
                            "seuil":        float(rule["min"]),
                            "niveau":       rule["niveau"],
                            "unite":        unite,
                            "horodatage":   str(horodatage) if pd.notna(horodatage) else "",
                            "source":       "historique",
                            "source_seuil": rule.get("source_seuil", "OCP FMS officiel"),
                        })

    # Trier : critiques d'abord, temps réel avant historique
    alertes = sorted(
        alertes,
        key=lambda x: (
            0 if x["niveau"] == "critique" else 1,
            0 if x["source"] == "temps_reel" else 1,
            x["parametre"],
        )
    )

    return alertes




def build_capteur_threshold_summary(df: pd.DataFrame) -> list[dict]:
    summaries = []
    if df.empty:
        return summaries

    param_counts = df["parametre"].value_counts()
    max_rows = int(param_counts.max()) if not param_counts.empty else 0

    for param, param_df in df.groupby("parametre"):
        clean_param = clean_param_name(param)

        rule_match = None
        for key, rule in CAPTEUR_THRESHOLDS.items():
            if key.lower() in clean_param.lower() or clean_param.lower() in key.lower():
                rule_match = (key, rule)
                break

        # si aucune règle métier ne match, on ignore ce paramètre
        if not rule_match:
            continue

        _, rule = rule_match

        unit = param_df["unite"].dropna().astype(str)
        unit_value = unit.iloc[0] if not unit.empty else ""

        coverage_pct = round((len(param_df) / max_rows) * 100, 1) if max_rows else 0.0

        max_observed = float(param_df["val_max"].max()) if param_df["val_max"].notna().any() else None
        min_observed = float(param_df["val_min"].min()) if param_df["val_min"].notna().any() else None

        max_breach_rate = None
        min_breach_rate = None

        if "max" in rule:
            max_breach_rate = round(float((param_df["val_max"] > float(rule["max"])).mean() * 100), 2)

        if "min" in rule:
            min_breach_rate = round(float((param_df["val_min"] < float(rule["min"])).mean() * 100), 2)

        breach_candidates = [v for v in [max_breach_rate, min_breach_rate] if v is not None]
        worst_breach_rate = max(breach_candidates) if breach_candidates else 0.0

        if worst_breach_rate > 20:
            statut = "chronique"
        elif worst_breach_rate > 5:
            statut = "frequente"
        elif worst_breach_rate > 0:
            statut = "rare"
        else:
            statut = "stable"

        summaries.append({
            "parametre": clean_param,
            "parametre_brut": str(param),
            "unite": unit_value,
            "samples": int(len(param_df)),
            "coverage_pct": coverage_pct,
            "latest_timestamp": param_df["horodatage"].max().strftime("%Y-%m-%d %H:%M") if param_df["horodatage"].notna().any() else None,
            "niveau": rule.get("niveau", "attention"),
            "statut": statut,
            "max_threshold": float(rule["max"]) if "max" in rule else None,
            "min_threshold": float(rule["min"]) if "min" in rule else None,
            "max_observed": round(max_observed, 2) if max_observed is not None else None,
            "min_observed": round(min_observed, 2) if min_observed is not None else None,
            "max_breach_rate": max_breach_rate,
            "min_breach_rate": min_breach_rate,
            "worst_breach_rate": round(float(worst_breach_rate), 2),
        })

    statut_order = {"chronique": 0, "frequente": 1, "rare": 2, "stable": 3}

    return sorted(
        summaries,
        key=lambda x: (
            0 if x["niveau"] == "critique" else 1,
            statut_order.get(x["statut"], 99),
            -x["worst_breach_rate"],
            x["parametre"],
        ),
    )


@app.get("/gmao/params-stats")
def gmao_params_stats():
    try:
        # ✅ CACHE (IMPORTANT)
        df, file_debug = load_gmao_capteurs()

        total_mesures = int(len(df))
        nb_parametres = int(df["parametre"].nunique())

        by_machine = {
            str(k): int(v)
            for k, v in df["machine"].value_counts().items()
        }

        latest_rows = (
            df.sort_values("horodatage", ascending=False)
            .head(50)
            .assign(horodatage=lambda x: x["horodatage"].astype(str))
            .to_dict(orient="records")
        )

        top_param_max = (
            df.groupby("parametre")["val_max"]
            .max()
            .reset_index()
            .sort_values("val_max", ascending=False)
            .head(15)
            .to_dict(orient="records")
        )

        top_param_avg = (
            df.groupby("parametre")["val_moy"]
            .mean()
            .reset_index()
            .sort_values("val_moy", ascending=False)
            .head(15)
            .to_dict(orient="records")
        )

        latest_by_param = (
            df.sort_values("horodatage")
            .groupby(["machine", "parametre"], as_index=False)
            .tail(1)
            .sort_values("horodatage", ascending=False)
        )

        alertes = detect_capteur_alertes(df)

        # 🔥 AJOUT IMPORTANT
        threshold_summary = build_capteur_threshold_summary(df)

        return {
            "total_mesures": total_mesures,
            "nb_parametres": nb_parametres,
            "by_machine": by_machine,
            "latest_rows": latest_rows,
            "top_param_max": top_param_max,
            "top_param_avg": top_param_avg,
            "latest_by_param": latest_by_param.assign(
                horodatage=lambda x: x["horodatage"].astype(str)
            ).to_dict(orient="records"),

            # 🔥 ICI LA CORRECTION
            "threshold_summary": threshold_summary,

            "alertes": alertes[:20],
            "nb_alertes": len(alertes),
            "nb_critiques": sum(1 for a in alertes if a["niveau"] == "critique"),
            "nb_attentions": sum(1 for a in alertes if a["niveau"] == "attention"),
            "files_loaded": file_debug,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _find_capteur_rule(parametre: str):
    clean_param = clean_param_name(parametre).lower()

    for key, rule in CAPTEUR_THRESHOLDS.items():
        key_lower = key.lower()
        if key_lower in clean_param or clean_param in key_lower:
            return key, rule

    return None, None


def _sanitize_capteur_series(df_param: pd.DataFrame) -> pd.DataFrame:
    if df_param.empty:
        return df_param

    df_param = df_param.copy()
    df_param["val_moy"] = pd.to_numeric(df_param["val_moy"], errors="coerce")
    df_param["horodatage"] = pd.to_datetime(df_param["horodatage"], errors="coerce")
    df_param = df_param.dropna(subset=["horodatage", "val_moy"]).copy()

    param_name = clean_param_name(df_param["parametre"].iloc[0]).lower()

    if any(x in param_name for x in ["temp", "pression", "regime", "courant"]):
        df_param = df_param[df_param["val_moy"] > 0].copy()

    if "temp" in param_name:
        df_param = df_param[(df_param["val_moy"] > 20) & (df_param["val_moy"] <= 1000)].copy()
    elif "pression pompe hydraulique" in param_name or "auto-graissage" in param_name:
        df_param = df_param[df_param["val_moy"] <= 40000].copy()
    elif "pression" in param_name:
        df_param = df_param[df_param["val_moy"] <= 5000].copy()
    elif "regime" in param_name:
        df_param = df_param[df_param["val_moy"] <= 3000].copy()
    elif "courant" in param_name:
        df_param = df_param[df_param["val_moy"] <= 200].copy()

    return df_param



@app.get("/gmao/evolution/{parametre}")
def gmao_evolution(parametre: str):
    try:
        df, _ = load_gmao_capteurs()

        mask = df["parametre"].str.contains(parametre, case=False, na=False)
        df_param = df[mask].copy()

        if df_param.empty:
            raise HTTPException(status_code=404, detail=f"Paramètre '{parametre}' non trouvé")

        raw_count = len(df_param)

        df_param = _sanitize_capteur_series(df_param)

        if df_param.empty:
            raise HTTPException(status_code=404, detail=f"Aucune mesure exploitable pour '{parametre}'")

        filtered_count = raw_count - len(df_param)

        # Resample horaire sur la valeur moyenne uniquement
        df_resampled = (
            df_param.set_index("horodatage")["val_moy"]
            .resample("1h")
            .mean()
            .dropna()
            .reset_index()
        )
        df_resampled.columns = ["horodatage", "val_moy"]

        if df_resampled.empty:
            raise HTTPException(status_code=404, detail=f"Aucune série horaire exploitable pour '{parametre}'")

        unite = df_param["unite"].iloc[0] if "unite" in df_param.columns else ""

        # Stats descriptives
        mu = float(df_resampled["val_moy"].mean())
        sigma = float(df_resampled["val_moy"].std()) if pd.notna(df_resampled["val_moy"].std()) else 0.0
        last_value = float(df_resampled["val_moy"].iloc[-1])

        # Seuils métier si connus, sinon fallback statistique
        _, rule = find_capteur_rule(parametre)

        seuil_max = None
        seuil_min = None
        seuil_type = "2sigma_statistique"

        if rule:
            seuil_max = float(rule["max"]) if "max" in rule else None
            seuil_min = float(rule["min"]) if "min" in rule else None
            seuil_type = "seuil_metier_ocp"
        else:
            seuil_max = round(mu + 2 * sigma, 2)
            seuil_min = round(mu - 2 * sigma, 2)

        param_lower = parametre.lower()

        if seuil_max is not None and seuil_min is None:
            mode = "high"
        elif seuil_min is not None and seuil_max is None:
            mode = "low"
        elif seuil_min is not None and seuil_max is not None:
            mode = "both"
        else:
            if "temp" in param_lower:
                mode = "high"
            elif "pression huile moteur" in param_lower:
                mode = "low"
            elif "pression" in param_lower:
                mode = "both"
            else:
                mode = "both"

        points = [
            {
                "t": row["horodatage"].strftime("%Y-%m-%d %H:%M"),
                "v": round(float(row["val_moy"]), 2)
            }
            for _, row in df_resampled.iterrows()
        ]

        # Détection des dépassements
        depassements = []
        for p in points:
            over = seuil_max is not None and p["v"] > seuil_max
            under = seuil_min is not None and p["v"] < seuil_min

            if mode == "high" and over:
                depassements.append(p)
            elif mode == "low" and under:
                depassements.append(p)
            elif mode == "both" and (over or under):
                depassements.append(p)

        nb_depassements = len(depassements)
        pct_depassement = round((nb_depassements / len(points)) * 100, 2) if points else 0.0

        # Interprétation métier
        if mode == "high":
            interpretation = (
                f"{nb_depassements} épisodes de surchauffe détectés. "
                f"À croiser avec les seuils métier OCP avant décision maintenance."
            )
        elif mode == "low":
            interpretation = (
                f"{nb_depassements} chutes sous seuil critique détectées. "
                f"À croiser avec les seuils métier OCP avant décision maintenance."
            )
        else:
            interpretation = (
                f"{nb_depassements} dérives hors plage normale détectées. "
                f"À croiser avec les seuils métier OCP avant décision maintenance."
            )

        # Score santé machine
        health_score = 100.0
        if len(points) > 0:
            penalty = min(60.0, pct_depassement * 2.0)
            filter_penalty = min(20.0, (filtered_count / max(raw_count, 1)) * 100)
            sigma_penalty = min(20.0, (sigma / max(mu, 1)) * 100)
            health_score = max(0.0, 100.0 - penalty - filter_penalty - sigma_penalty)

        health_status = (
            "Stable" if health_score >= 85
            else "À surveiller" if health_score >= 65
            else "Critique"
        )

        # Diagnostic IA simple
        diagnostic_ia = "Aucun signe critique détecté."
        if filtered_count > 0 and pct_depassement == 0:
            diagnostic_ia = (
                "Présence probable de valeurs aberrantes ou perte de signal capteur, "
                "sans dérive métier réelle."
            )
        elif mode == "high" and nb_depassements > 0:
            diagnostic_ia = (
                "Présence d'épisodes de surchauffe à investiguer : refroidissement, "
                "ventilation ou échange thermique."
            )
        elif mode == "low" and nb_depassements > 0:
            diagnostic_ia = (
                "Présence de chutes sous seuil à investiguer : pression, lubrification "
                "ou perte de charge."
            )
        elif mode == "both" and nb_depassements > 0:
            diagnostic_ia = (
                "Présence de dérives hors plage normale, à corréler avec l'état du circuit "
                "et la qualité du capteur."
            )

        monthly_summary_df = (
            df_resampled.assign(month=lambda x: x["horodatage"].dt.to_period("M").astype(str))
            .groupby("month")["val_moy"]
            .mean()
            .reset_index(name="moyenne")
        )

        return {
            "parametre": parametre,
            "unite": unite,
            "mu": round(mu, 2),
            "sigma": round(sigma, 2),
            "last_value": round(last_value, 2),
            "seuil_max": round(seuil_max, 2) if seuil_max is not None else None,
            "seuil_min": round(seuil_min, 2) if seuil_min is not None else None,
            "mode": mode,
            "points": points,
            "nb_points": len(points),
            "nb_depassements": nb_depassements,
            "pct_depassement": pct_depassement,
            "interpretation": interpretation,
            "period_start": df_resampled["horodatage"].min().strftime("%Y-%m-%d %H:%M"),
            "period_end": df_resampled["horodatage"].max().strftime("%Y-%m-%d %H:%M"),
            "monthly_summary": monthly_summary_df.to_dict(orient="records"),
            "seuil_type": seuil_type,
            "filtered_count": int(filtered_count),
            "filter_notice": (
                f"{filtered_count} valeurs aberrantes ont été filtrées automatiquement."
                if filtered_count > 0 else None
            ),
            "health_score": round(health_score, 1),
            "health_status": health_status,
            "diagnostic_ia": diagnostic_ia,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@app.post("/cache/clear")
def clear_cache():
    return {"status": "ok", "message": "Aucun cache serveur persistant à vider"}


# ─────────────────────────────────────────────────────────────
# PROMPTS SYSTÈME
# ─────────────────────────────────────────────────────────────

SYSTEM_ASK_WITH_CONTEXT = """Tu es MineAssist, un expert senior en maintenance de la chargeuse CAT 994F à OCP Benguérir.
Tu réponds comme un technicien expérimenté qui parle à un collègue : naturellement, avec précision, sans jargon inutile.

Règles de réponse :
- Réponds de manière fluide et naturelle, comme dans une vraie conversation professionnelle.
- N'impose jamais de structure rigide. Si la question est simple, réponds simplement.
- Si la question est technique (code défaut, procédure, mesure), développe avec les détails utiles.
- Utilise des listes à tirets ou des étapes numérotées SEULEMENT quand c'est naturellement utile (procédures, causes multiples).
- N'invente jamais de valeurs, références ou procédures.
- Si le contexte documentaire est suffisant, base-toi dessus. Sinon, dis-le clairement et réponds avec tes connaissances générales.
- Pas de titres en majuscules, pas de sections forcées, pas de symboles inutiles.
- Sois direct et concis. Va à l'essentiel.
"""

SYSTEM_ASK_NO_CONTEXT = """Tu es MineAssist, un expert senior en maintenance de la chargeuse CAT 994F à OCP Benguérir.
Tu réponds comme un technicien expérimenté qui parle à un collègue : naturellement, avec précision.

Aucun document pertinent n'a été trouvé pour cette question.
Réponds avec tes connaissances générales sur la CAT 994F, en précisant brièvement que tu te bases sur des connaissances générales.
Recommande de consulter la documentation officielle Caterpillar si une précision est nécessaire.

Règles :
- Réponds de manière fluide et naturelle.
- Pas de structure rigide ni de sections forcées.
- Sois direct, précis et utile.
- Pas de titres en majuscules, pas de symboles inutiles.
"""

SYSTEM_DIAGNOSE_WITH_CONTEXT = """Tu es MineAssist, système de diagnostic CAT 994F — OCP Benguérir.

════════════════════════════════════════════════════
INSTRUCTIONS CRITIQUES — À RESPECTER ABSOLUMENT
════════════════════════════════════════════════════

1. Ta réponse doit commencer DIRECTEMENT par la ligne "MID XXX - CID XXXX - FMI XX".
   AUCUN texte avant. AUCUN titre. AUCUNE introduction. AUCUN résumé du cas.
   Pas de "##", pas de tableau, pas de "---", pas de "Voici le diagnostic".

2. Toute ta réponse est en FRANÇAIS, sauf les marqueurs structurels listés ci-dessous.

3. Le contexte documentaire est en anglais (CAT SIS). Traduis-le intégralement en français.

════════════════════════════════════════════════════
FORMAT DE SORTIE OBLIGATOIRE (copie ce gabarit exactement)
════════════════════════════════════════════════════

MID 081 - CID 1403 - FMI 06
SMCS - 5479-038-T3

Conditions Which Generate This Code:
Ce code de diagnostic est associé à la vanne solénoïde N°3 (embrayage 3ème vitesse). Le FMI 06 signifie que l'ECM a déterminé que le courant du solénoïde est au-dessus de la normale.

The possible causes of this diagnostic code are listed:

Le circuit d'activation du solénoïde est court-circuité à la masse.

Le solénoïde est défaillant.

L'ECM est défaillant. Peu probable.

Note: La procédure suivante peut générer d'autres codes. Ignorer ces codes et les effacer une fois le code d'origine corrigé.

System Response:

Seuls les rapports sans codes de diagnostic actifs sont disponibles.

Test Step 1. VÉRIFIER LE SOLÉNOÏDE

Mettre le commutateur de déconnexion et le commutateur de démarrage en position MARCHE. Ne pas démarrer le moteur.

Observer l'état du code de diagnostic.

Déconnecter le solénoïde présentant le code de diagnostic actif du faisceau de câblage.

Expected Result:

Le CID 1403 FMI 06 passe au CID 1403 FMI 05 lors de la déconnexion du solénoïde.

Results:

YES - Le CID 1403 FMI 06 passe au FMI 05 lors de la déconnexion. Le circuit est correct.
Repair: Le solénoïde est défaillant. Répéter ce test pour confirmer, puis remplacer le solénoïde.

STOP

NO - Le CID 1403 FMI 06 reste actif. Proceed to Test Step 2.

Test Step 2. VÉRIFIER LE COURT-CIRCUIT À LA MASSE DU CIRCUIT D'ACTIVATION

Mettre le commutateur de démarrage et le commutateur de déconnexion en position ARRÊT.

Laisser le solénoïde déconnecté du faisceau de câblage.

Déconnecter le ou les connecteurs du faisceau de l'ECM.

Mesurer la résistance depuis le contact J2-7 (fil 754-BU Bleu) vers tous les contacts utilisés dans les connecteurs ECM.

Expected Result:

Chaque mesure de résistance est supérieure à 5 000 ohms.

Results:

OK - Résistance > 5 000 ohms. Le faisceau de câblage est correct. Proceed to Test Step 3.

NOT OK - Résistance < 5 000 ohms. Court-circuit entre J2-7 (fil 754-BU) et le circuit à faible résistance.
Repair: Réparer ou remplacer le faisceau de câblage.

STOP

════════════════════════════════════════════════════
RÈGLES STRICTES
════════════════════════════════════════════════════

MARQUEURS À CONSERVER EN ANGLAIS (ne jamais traduire) :
  MID / CID / FMI / SMCS
  "Conditions Which Generate This Code:"
  "The possible causes of this diagnostic code are listed:"
  "Note:"
  "System Response:"
  "Test Step N."  (N = numéro)
  "Expected Result:"
  "Results:"
  YES / NO / OK / NOT OK
  "Repair:"
  STOP
  "Proceed to Test Step N"

CONTENU À TRADUIRE EN FRANÇAIS :
  - Toutes les descriptions, causes, procédures, résultats, réparations
  - Les titres des Test Steps (après "Test Step N.") : en MAJUSCULES

RÉFÉRENCES TECHNIQUES À CONSERVER TELLES QUELLES :
  - Numéros de contacts : J1-16, J2-7, etc.
  - Couleurs de fils : wire 754-BU(Blue), wire 202-BK(Black), etc.
  - Valeurs : 5 000 ohms, 5 ohms, 8,0 DCV, 18 à 35 DCV, etc.
  - Références pièces : 146-4080, 7X-1710, etc.

INTERDICTIONS ABSOLUES :
  - Ne jamais commencer par autre chose que "MID XXX - CID XXXX - FMI XX"
  - Ne jamais résumer ou paraphraser les procédures : traduire intégralement
  - Ne jamais inventer de valeurs ou références
  - Ne jamais utiliser de markdown (##, **, --, tableaux)
  - Ne jamais répéter le tableau de saisie fourni en entrée
"""

SYSTEM_DIAGNOSE_NO_CONTEXT = """Tu es MineAssist, système de diagnostic CAT 994F — OCP Benguérir.

Aucun document pertinent n'a été trouvé dans la base documentaire.

Réponds en français, de manière naturelle et concise :
- Indique que tu te bases sur tes connaissances générales de la CAT 994F.
- Propose les causes les plus probables selon le code ou les symptômes fournis.
- Recommande de consulter la documentation officielle Caterpillar SIS pour confirmation.
- Pas de tableau, pas de titre markdown, pas de structure rigide.
"""


# ─────────────────────────────────────────────────────────────
# APPEL LLM
# ─────────────────────────────────────────────────────────────

def get_llm_client() -> OpenAI:
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY manquante")
    return OpenAI(base_url="https://openrouter.ai/api/v1", api_key=OPENROUTER_API_KEY)


def call_llm(system_prompt: str, user_prompt: str) -> str:
    client = get_llm_client()
    response = client.chat.completions.create(
        model=OPENROUTER_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
        max_tokens=4000,
    )
    return response.choices[0].message.content


# ─────────────────────────────────────────────────────────────
# ENDPOINTS IA
# ─────────────────────────────────────────────────────────────

@app.post("/ask")
def ask(req: AskRequest):
    try:
        context, sources = rag.build_context(
            query=req.question,
            top_k=TOP_K,
            max_chars=MAX_CHARS_CONTEXT,
        )
        has_ctx = bool(context.strip())
        system = SYSTEM_ASK_WITH_CONTEXT if has_ctx else SYSTEM_ASK_NO_CONTEXT

        ctx_block = f"\n\n---\n## 📂 CONTEXTE DOCUMENTAIRE\n{context}" if has_ctx else ""
        sources_block = (
            "\n\n---\n## 📚 Sources disponibles\n" +
            "\n".join(f"- {s}" for s in sources)
        ) if sources else ""

        user_prompt = f"## Question\n{req.question}{ctx_block}{sources_block}"
        answer = call_llm(system, user_prompt)
        pdf_images = extract_images_for_sources(sources, query=req.question, max_images=3)

        return {
            "question": req.question,
            "answer": answer,
            "sources": sources,
            "pdf_images": pdf_images,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/diagnose")
def diagnose(req: DiagnoseRequest):
    try:
        symptoms_text = ", ".join(req.symptoms) if req.symptoms else "Non spécifiés"
        heures = f"{req.hours_since_maintenance}h" if req.hours_since_maintenance else "Non renseigné"
        code = req.fault_code or "Non renseigné"

        query = f"Code défaut: {code} | Symptômes: {symptoms_text} | Heures depuis maintenance: {heures}"

        context, sources = rag.build_context(
            query=query,
            top_k=TOP_K,
            max_chars=MAX_CHARS_CONTEXT,
        )
        has_ctx = bool(context.strip())
        system = SYSTEM_DIAGNOSE_WITH_CONTEXT if has_ctx else SYSTEM_DIAGNOSE_NO_CONTEXT

        ctx_block = f"\n\n---\n## 📂 CONTEXTE DOCUMENTAIRE\n{context}" if has_ctx else ""
        sources_block = (
            "\n\n---\n## 📚 Sources disponibles\n" +
            "\n".join(f"- {s}" for s in sources)
        ) if sources else ""

        user_prompt = f"""Code défaut : {code}
Symptômes : {symptoms_text}
Heures depuis maintenance : {heures}
Contexte GMAO : {req.gmao_context or 'Aucun'}
{ctx_block}"""

        answer = call_llm(system, user_prompt)
        pdf_images = extract_images_for_sources(sources, query=query, max_images=3)

        return {
            "input": req.model_dump(),
            "diagnostic": answer,
            "sources": sources,
            "pdf_images": pdf_images,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

import joblib
import json

# ─────────────────────────────────────────────────────────────
# ANOMALY DETECTION — Isolation Forest
# ─────────────────────────────────────────────────────────────

MODELS_DIR = BASE_DIR / "models"


@app.get("/gmao/anomaly-results")
def gmao_anomaly_results():
    """
    Retourne les résultats de détection d'anomalies Isolation Forest.
    """
    try:
        meta_path = MODELS_DIR / "model_meta.json"
        csv_path = MODELS_DIR / "train_results.csv"

        if not meta_path.exists():
            raise HTTPException(
                status_code=404,
                detail="Modèle non entraîné. Lance train_anomaly.py d'abord."
            )

        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)

        df = pd.read_csv(csv_path)
        df["Heure_round"] = pd.to_datetime(df["Heure_round"])

        anomalies_df = df[df["is_anomaly"] == 1].copy()
        top_anomalies = (
            anomalies_df
            .sort_values("anomaly_score")
            .head(100)
        )

        anomaly_points = []
        for _, row in top_anomalies.iterrows():
            point = {
                "t": str(row["Heure_round"])[:16],
                "score": round(float(row["anomaly_score"]), 4),
            }
            for col in meta["parametres"]:
                if col in row:
                    short = col.split(".")[-1]
                    point[short] = round(float(row[col]), 2) if pd.notna(row[col]) else None
            anomaly_points.append(point)

        sample_df = df.iloc[::4]
        timeline = []
        for _, row in sample_df.iterrows():
            timeline.append({
                "t": str(row["Heure_round"])[:16],
                "score": round(float(row["anomaly_score"]), 4),
                "is_anomaly": int(row["is_anomaly"]),
            })

        training_start = df["Heure_round"].min().strftime("%Y-%m-%d %H:%M") if not df.empty else None
        training_end = df["Heure_round"].max().strftime("%Y-%m-%d %H:%M") if not df.empty else None

        return {
            "meta": meta,
            "anomaly_points": anomaly_points,
            "timeline": timeline,
            "nb_anomalies": meta["nb_anomalies"],
            "pct_anomalies": meta["pct_anomalies"],
            "nb_total": meta["n_train"],
            "parametres": meta["parametres"],
            "stats_2sigma": meta["stats_2sigma"],
            "training_start": training_start,
            "training_end": training_end,
            "n_estimators": meta.get("n_estimators"),
            "contamination": meta.get("contamination"),
            "raw_measure_count": meta.get("raw_measure_count"),
            "scope_machine": meta.get("scope_machine", "994F-1"),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/gmao/predict-anomaly")
def predict_anomaly(data: dict):
    """
    Prédit si une nouvelle mesure est anormale.
    Body: {"valeurs": [temp_liq, temp_ech_d, temp_ech_g, temp_conv, pression_huile, regime]}
    """
    try:
        model_path  = MODELS_DIR / "isolation_forest.pkl"
        scaler_path = MODELS_DIR / "scaler.pkl"

        if not model_path.exists():
            raise HTTPException(status_code=404, detail="Modèle non trouvé")

        model  = joblib.load(model_path)
        scaler = joblib.load(scaler_path)

        valeurs = data.get("valeurs", [])
        if len(valeurs) != 6:
            raise HTTPException(
                status_code=400,
                detail="6 valeurs requises dans l'ordre : temp_liq, temp_ech_d, temp_ech_g, temp_conv, pression_huile, regime"
            )

        X = scaler.transform([valeurs])
        prediction = model.predict(X)[0]
        score      = float(model.decision_function(X)[0])

        is_anomaly = bool(prediction == -1)

        return {
            "is_anomaly": is_anomaly,
            "score":      round(score, 4),
            "verdict":    "🚨 ANOMALIE DÉTECTÉE" if is_anomaly else "✅ Normal",
            "confiance":  round(float(abs(score) * 100), 1),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))