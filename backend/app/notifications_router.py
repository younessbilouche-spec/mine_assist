"""
MineAssist — Router FastAPI pour les notifications
À intégrer dans api.py : app.include_router(notifications_router)
"""

from app.alert_detector import analyser_batch, SEUILS_994F, LABELS
from app.notification_service import (
    Alerte,
    NiveauAlerte,
    EmailConfig,
    WhatsAppConfig,
    notifier,
)
from pydantic import BaseModel, Field
from fastapi import APIRouter, BackgroundTasks
from typing import Optional
from datetime import datetime
import logging
import os
from pathlib import Path
from dotenv import load_dotenv

# Charger explicitement backend/.env
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


logger = logging.getLogger(__name__)
notifications_router = APIRouter(prefix="/notifications", tags=["Notifications"])


# ─────────────────────────────────────────────────────────────
# CONFIGURATION DYNAMIQUE (.env)
# ─────────────────────────────────────────────────────────────

def get_email_config() -> EmailConfig:
    return EmailConfig(
        smtp_host=os.getenv("SMTP_HOST", "smtp.gmail.com"),
        smtp_port=int(os.getenv("SMTP_PORT", "587")),
        sender_email=os.getenv("SENDER_EMAIL", ""),
        sender_password=os.getenv("SENDER_PASSWORD", ""),
        recipient_email=os.getenv("CHEF_EMAIL", ""),
        recipient_name=os.getenv("CHEF_NOM", "Chef de Service"),
    )


def get_whatsapp_config() -> WhatsAppConfig:
    return WhatsAppConfig(
        account_sid=os.getenv("TWILIO_SID", ""),
        auth_token=os.getenv("TWILIO_TOKEN", ""),
        from_number=os.getenv("TWILIO_FROM", "whatsapp:+14155238886"),
        to_number=os.getenv("CHEF_WHATSAPP", ""),
    )


# ─────────────────────────────────────────────────────────────
# SCHÉMAS PYDANTIC
# ─────────────────────────────────────────────────────────────

class MesureInput(BaseModel):
    parametre: str
    val_max: float
    val_min: float
    engin: str = "994F1"
    horodatage: Optional[datetime] = None


class BatchMesuresRequest(BaseModel):
    mesures: list[MesureInput] = Field(..., min_length=1)


class AlerteManuelleRequest(BaseModel):
    """Pour déclencher manuellement une alerte (tests, urgences)."""
    label: str
    parametre: str
    valeur: float
    unite: str
    seuil: float
    niveau: NiveauAlerte
    motif: str = ""
    engin: str = "994F1"


class NotificationResponse(BaseModel):
    nb_alertes: int
    nb_critiques: int
    nb_attentions: int
    email_ok: Optional[bool]
    whatsapp_ok: Optional[bool]
    alertes: list[dict]


# ─────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────

@notifications_router.post(
    "/analyser",
    response_model=NotificationResponse,
    summary="Analyser des mesures et envoyer alertes si nécessaire",
)
async def analyser_et_notifier(
    payload: BatchMesuresRequest,
    background_tasks: BackgroundTasks,
    email: bool = True,
    whatsapp: bool = True,
):
    """
    Reçoit un batch de mesures GMAO, détecte les anomalies,
    et envoie les notifications si des alertes sont trouvées.
    """
    mesures = [m.model_dump() for m in payload.mesures]
    alertes = analyser_batch(mesures)

    if not alertes:
        return NotificationResponse(
            nb_alertes=0,
            nb_critiques=0,
            nb_attentions=0,
            email_ok=None,
            whatsapp_ok=None,
            alertes=[],
        )

    def _send():
        email_cfg = get_email_config() if email else None
        whatsapp_cfg = get_whatsapp_config() if whatsapp else None

        resultats = notifier(
            alertes,
            email_config=email_cfg,
            whatsapp_config=whatsapp_cfg,
        )
        logger.info(f"Résultats notifications async: {resultats}")

    background_tasks.add_task(_send)

    return NotificationResponse(
        nb_alertes=len(alertes),
        nb_critiques=sum(1 for a in alertes if a.niveau == NiveauAlerte.ALERTE),
        nb_attentions=sum(1 for a in alertes if a.niveau == NiveauAlerte.ATTENTION),
        email_ok=True,      # accusé optimiste, envoi réel en arrière-plan
        whatsapp_ok=True,   # accusé optimiste, envoi réel en arrière-plan
        alertes=[
            {
                "label": a.label,
                "valeur": a.valeur,
                "unite": a.unite,
                "seuil": a.seuil,
                "niveau": a.niveau.value,
                "motif": a.motif,
                "horodatage": a.horodatage.isoformat(),
                "engin": a.engin,
                "parametre": a.parametre,
            }
            for a in alertes
        ],
    )


@notifications_router.post(
    "/alerte-manuelle",
    summary="Déclencher manuellement une notification",
)
async def alerte_manuelle(
    payload: AlerteManuelleRequest,
    background_tasks: BackgroundTasks,
):
    """Utile pour les urgences terrain ou les tests."""
    alerte = Alerte(
        parametre=payload.parametre,
        label=payload.label,
        valeur=payload.valeur,
        unite=payload.unite,
        seuil=payload.seuil,
        niveau=payload.niveau,
        engin=payload.engin,
        motif=payload.motif,
    )

    def _send():
        resultats = notifier(
            [alerte],
            get_email_config(),
            get_whatsapp_config(),
        )
        logger.info(f"Résultats notification manuelle: {resultats}")

    background_tasks.add_task(_send)

    return {
        "status": "notification envoyée",
        "niveau": alerte.niveau.value,
        "label": alerte.label,
    }


@notifications_router.get(
    "/test",
    summary="Tester la connexion email et WhatsApp",
)
async def tester_notifications():
    """Envoie une notification de test pour vérifier la configuration."""
    alerte_test = Alerte(
        parametre="TEST",
        label="Test MineAssist",
        valeur=999.0,
        unite="°C",
        seuil=100.0,
        niveau=NiveauAlerte.ALERTE,
        motif="Ceci est un test du système de notification MineAssist.",
    )

    resultats = notifier(
        [alerte_test],
        get_email_config(),
        get_whatsapp_config(),
    )

    return {
        "status": "test effectué",
        "email_ok": resultats.get("email"),
        "whatsapp_ok": resultats.get("whatsapp"),
    }


@notifications_router.get(
    "/seuils",
    summary="Consulter les seuils d'alerte configurés",
)
async def get_seuils():
    """Retourne tous les seuils configurés pour la 994F."""
    return {
        param: {
            "label": LABELS.get(param, param),
            "seuil_min": smin,
            "seuil_max": smax,
            "unite": unite,
        }
        for param, (smin, smax, unite) in SEUILS_994F.items()
    }
