from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"


def _safe_len(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def _read_oil_db() -> list[dict]:
    path = DATA_DIR / "oil" / "oil_analyses_db.json"
    if not path.exists():
        return []
    try:
        import json
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _status_rank(status: str | None) -> int:
    s = str(status or "").upper()
    if s in {"CRITIQUE", "URGENCE", "CRITICAL"}:
        return 3
    if s in {"MARGINALE", "PLANIFIÉE", "PLANIFIEE", "WARNING"}:
        return 2
    if s in {"SURVEILLANCE", "ATTENTION"}:
        return 1
    return 0


def _oil_score(a: dict) -> int:
    pc = a.get("physico_chimique") or {}
    mu = a.get("metaux_usure") or {}
    mc = a.get("metaux_contaminants") or {}
    par = a.get("particules") or {}
    ref = 169 if "80W90" in str(a.get("grade_huile") or "") else 200
    score = 100 - _status_rank(a.get("etat_machine")) * 12 - \
        _status_rank(a.get("etat_lubrifiant")) * 12
    visc = pc.get("viscosite_40")
    if visc is not None:
        gap = abs(float(visc) - ref) / ref
        if gap > 0.20:
            score -= 22
        elif gap > 0.10:
            score -= 10
    if (pc.get("tan") or 0) > 2.4:
        score -= 10
    if (mu.get("fe") or 0) > 250:
        score -= 16
    elif (mu.get("fe") or 0) > 60:
        score -= 8
    if (mc.get("si") or 0) > 60:
        score -= 12
    elif (mc.get("si") or 0) > 30:
        score -= 6
    if (par.get("n_sup_14um") or 0) > 60000:
        score -= 12
    elif (par.get("n_sup_14um") or 0) > 15000:
        score -= 6
    return max(0, min(100, round(score)))


def _latest_by_component(analyses: list[dict]) -> list[dict]:
    out = {}
    for a in analyses:
        comp = str(a.get("composant") or "").strip().upper()
        if comp and comp not in {"STRING", "NULL", "NONE"} and comp not in out:
            out[comp] = a
    return list(out.values())


@router.get("/report")
def executive_report():
    oil = _read_oil_db()
    latest_oil = _latest_by_component(oil)
    oil_scores = [_oil_score(a) for a in latest_oil]
    oil_avg = round(sum(oil_scores) / len(oil_scores)) if oil_scores else None
    oil_critical = sum(1 for s in oil_scores if s < 45)
    oil_watch = sum(1 for s in oil_scores if 45 <= s < 75)

    capteur_files = list((DATA_DIR / "gmao" / "capteurs").glob("*")
                         ) if (DATA_DIR / "gmao" / "capteurs").exists() else []
    anomaly_files = list((DATA_DIR / "gmao" / "anomalies").glob("*")
                         ) if (DATA_DIR / "gmao" / "anomalies").exists() else []
    ocp_current = DATA_DIR / "ocp_uploads" / "current_data.xlsx"

    plan_action = []
    for a in latest_oil:
        score = _oil_score(a)
        if score < 75:
            plan_action.append({
                "priorite": "P1" if score < 45 else "P2",
                "module": "Analyse huiles",
                "composant": a.get("composant"),
                "action": (a.get("recommandations") or ["Contrôle lubrifiant + rééchantillonnage"])[0],
                "delai": "Immédiat" if score < 45 else "Sous 7 jours",
            })
    if not plan_action:
        plan_action.append({
            "priorite": "P3",
            "module": "Surveillance",
            "composant": "CAT 994F",
            "action": "Continuer la surveillance conditionnelle et mettre à jour les données capteurs/huile.",
            "delai": "Routine hebdomadaire",
        })

    return {
        "titre": "Rapport Exécutif MineAssist — Maintenance prédictive CAT 994F",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "resume_executif": (
            "MineAssist consolide les données capteurs, GMAO, analyses d'huile OKSA, documentation technique et modèles IA "
            "afin de fournir une aide à la décision pour la maintenance prédictive de la chargeuse CAT 994F. "
            "Le système transforme les données brutes en indicateurs de santé, alertes, diagnostic et plan d'action priorisé."
        ),
        "indicateurs": {
            "analyses_huile": len(oil),
            "composants_huile": len(latest_oil),
            "score_huile_moyen": oil_avg if oil_avg is not None else "N/A",
            "huile_critique": oil_critical,
            "huile_surveillance": oil_watch,
            "fichier_ocp_charge": ocp_current.exists(),
            "fichiers_capteurs": _safe_len(capteur_files),
            "fichiers_anomalies": _safe_len(anomaly_files),
        },
        "plan_action": plan_action[:8],
        "methodologie": {
            "maintenance": "Maintenance conditionnelle + prédictive + AMDEC/RPN",
            "ia": ["LSTM pour prédiction temporelle", "Isolation Forest pour anomalies", "RAG pour diagnostic documentaire"],
            "huile": "Lecture OKSA/SOS : viscosité, TAN, métaux d'usure, contaminants, ISO 4406",
            "decision": "Priorisation par criticité, délai et responsabilité maintenance",
        },
        "tracabilite": {
            "data_dir": str(DATA_DIR),
            "ocp_current_file": str(ocp_current),
            "ocp_current_exists": ocp_current.exists(),
            "oil_db_records": len(oil),
            "generated_by": "MineAssist Maintenance",
        },
    }
