"""
MineAssist - Router FastAPI pour l'ingestion temps reel de la simulation MATLAB
================================================================================

Permet a un simulateur (MATLAB ou Python) de pousser des valeurs capteurs
en continu et de declencher en direct la detection d'alertes 994F.

INTEGRATION (2 lignes a ajouter dans app/api.py) :

    from app.sim_router import sim_router
    app.include_router(sim_router)

ENDPOINTS :

    POST /sim/ingest        Ingere une snapshot de mesures (NON-BLOQUANT :
                             la detection d'alertes + notifications eventuelles
                             sont faites en tache de fond pour ne pas saturer
                             le worker uvicorn).
    GET  /sim/state         Renvoie la fenetre temporelle (par defaut 60 dernieres
                             secondes) + alertes recentes.
    GET  /sim/last-values   Renvoie uniquement la derniere snapshot (1 mesure par
                             capteur) pour les dashboards.
    GET  /sim/notif-status  Etat du dispatcher de notifications (anti-spam, last sent...)
    POST /sim/notif-test    Force l'envoi d'un email/whatsapp de test (ALERTE bidon)
    DELETE /sim/buffer      Vide le buffer (debug / reinitialisation).

V3.3 - mai 2026 :
  - FALLBACK HTTP API (Brevo) : si SMTP est bloque par le firewall reseau
    (cas tres frequent en entreprise / ecole), on peut envoyer via l'API
    HTTPS de Brevo (port 443, jamais bloque). Suffit de definir BREVO_API_KEY
    dans le .env. Si la cle est presente, le router essaie Brevo en
    PRIORITE, et fallback sur SMTP en cas d'echec.
  - Le champ 'transport' dans la reponse de /sim/notif-debug indique
    quelle voie a effectivement marche (Brevo HTTP vs SMTP_SSL/STARTTLS).
  - 300 emails/jour gratuits chez Brevo, largement suffisant pour les
    notifications d'alertes 994F.

V3.2 - mai 2026 :
  - FIX BUG : le compteur 'envoyees' s'incrementait a tort sur la cle
    'nb_alertes' (truthy) du dict retourne par notifier(). Maintenant on
    teste explicitement result['email'] is True / result['whatsapp'] is True.
  - SMTP port 465 (SSL) supporte en plus du port 587 (STARTTLS) : si
    SMTP_PORT=465 dans le .env, le router utilise SMTP_SSL au lieu de
    SMTP+starttls. Permet de contourner les firewalls qui bloquent 587.
  - Nouveau champ stats['last_email_error'] : derniere exception SMTP
    visible directement dans /sim/notif-status (avant il fallait fouiller
    les logs uvicorn).
  - Nouveau endpoint POST /sim/notif-debug : declenche un envoi synchrone
    et renvoie l'exception complete dans la reponse JSON (utile pour
    diagnostiquer firewall, app password, etc.).

V3.1 - mai 2026 :
  - lit les variables d'environnement existantes du backend MineAssist
    (SENDER_EMAIL, SENDER_PASSWORD, CHEF_EMAIL, CHEF_NOM, TWILIO_SID,
     TWILIO_TOKEN, TWILIO_FROM, CHEF_WHATSAPP) en priorite, puis les
    aliases generiques (SMTP_USER, SMTP_PASSWORD, NOTIF_EMAIL_TO, ...).
    Aucun renommage requis dans le .env existant.

V3 - mai 2026 :
  - integration optionnelle de `notification_service.notifier()` :
      * declenchee uniquement sur ALERTE (pas sur Attention) pour eviter le spam,
      * anti-spam : minimum N minutes entre 2 notifications du meme capteur
        (defaut 10 min, configurable via MINEASSIST_NOTIF_COOLDOWN_S),
      * configuration via variables d'environnement (cf. _build_notif_configs).
  - tout reste en tache de fond, le worker uvicorn n'est jamais bloque.

V2 - mai 2026 :
  - sim_ingest est maintenant `async def` + BackgroundTasks pour la detection
    d'alertes : la reponse HTTP revient en <5 ms, le worker reste dispo pour
    les autres routes (geo, gmao, monitoring) meme a 1 Hz.

Le buffer est en memoire (deque), capacite 1800 = 30 min a 1 Hz.
"""

from __future__ import annotations

import json
import os
import smtplib
import ssl
import traceback
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from threading import Lock
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel, Field

from app.alert_detector import analyser_batch
from app.notification_service import (
    Alerte,
    NiveauAlerte,
    EmailConfig,
    WhatsAppConfig,
    notifier,
    envoyer_whatsapp,
    _build_email_html,
)


# --------------------------------------------------------------------- #
#  Buffer en memoire
# --------------------------------------------------------------------- #
_BUFFER_MAX_MESURES = 1800        # 30 min a 1 Hz
_BUFFER_MAX_ALERTES = 500
_buffer_mesures: deque = deque(maxlen=_BUFFER_MAX_MESURES)
_buffer_alertes: deque = deque(maxlen=_BUFFER_MAX_ALERTES)
_lock = Lock()


# --------------------------------------------------------------------- #
#  Etat anti-spam des notifications
# --------------------------------------------------------------------- #
#  Cle = (engin, parametre)  ->  dernier datetime envoye
_last_notified: dict[tuple[str, str], datetime] = {}
_notif_lock = Lock()
_notif_stats: dict = {
    "envoyees":              0,
    "supprimees_anti_spam":  0,
    "echecs":                0,
    "last_email_error":      None,
    "last_email_ok_at":      None,
    "last_transport":        None,
}


# --------------------------------------------------------------------- #
#  Schemas Pydantic
# --------------------------------------------------------------------- #
class MesureLive(BaseModel):
    parametre: str = Field(..., description='Nom complet du capteur (ex. "CH994.P1.Pression pompe hydraulique principale")')
    valeur: float = Field(..., description="Valeur instantanee")
    val_min: Optional[float] = Field(None, description="Valeur min sur l'intervalle (sinon = valeur)")
    val_max: Optional[float] = Field(None, description="Valeur max sur l'intervalle (sinon = valeur)")
    unite: Optional[str] = None


class IngestRequest(BaseModel):
    engin: str = Field("994F1", description='Identifiant engin ("994F1" / "994F-1" / "994F2")')
    horodatage: Optional[datetime] = None
    mesures: List[MesureLive] = Field(..., min_length=1)
    cycle_phase: Optional[str] = Field(None, description="Phase du cycle (approche/levage/maintien/vidage/retour)")
    defaut_actif: Optional[str] = Field(None, description="Nom du defaut injecte (ex. fuite_hydraulique, ventilo_HS)")


class IngestResponse(BaseModel):
    status: str
    received_at: str
    buffer_size: int


# --------------------------------------------------------------------- #
#  Configuration des notifications (via variables d'environnement)
# --------------------------------------------------------------------- #
def _env_bool(name: str, default: bool = False) -> bool:
    val = os.getenv(name, "").strip().lower()
    if val in ("1", "true", "yes", "on", "y"):
        return True
    if val in ("0", "false", "no", "off", "n"):
        return False
    return default


def _env_first(*names: str, default: str = "") -> str:
    """Retourne la premiere variable d'env definie et non vide parmi `names`."""
    for n in names:
        v = os.getenv(n)
        if v is not None and v.strip() != "":
            return v
    return default


def _is_placeholder_phone(num: str) -> bool:
    """Detecte les numeros par defaut/placeholders WhatsApp pour eviter d'envoyer
       a des numeros bidons (ex: whatsapp:+212600000000)."""
    n = num.replace("whatsapp:", "").replace("+", "").replace(" ", "")
    return (not n) or n.startswith("212600000000") or n.endswith("0000000")


def _build_notif_configs() -> tuple[Optional[EmailConfig], Optional[WhatsAppConfig]]:
    """
    Construit les configs Email / WhatsApp a partir des variables d'environnement.
    Si MINEASSIST_NOTIF_ENABLED != true  ->  retourne (None, None) (notif desactivees).

    Convention noms :
      EMAIL  -> SENDER_EMAIL  ou SMTP_USER
                SENDER_PASSWORD ou SMTP_PASSWORD
                CHEF_EMAIL      ou NOTIF_EMAIL_TO
                CHEF_NOM        ou NOTIF_EMAIL_NAME
      WHATSAPP -> TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
                  CHEF_WHATSAPP   ou NOTIF_WHATSAPP_TO
    """
    if not _env_bool("MINEASSIST_NOTIF_ENABLED", default=False):
        return None, None

    email_cfg = None
    if _env_bool("MINEASSIST_NOTIF_EMAIL", default=True):
        email_cfg = EmailConfig(
            smtp_host=_env_first("SMTP_HOST", default="smtp.gmail.com"),
            smtp_port=int(_env_first("SMTP_PORT", default="587")),
            sender_email=_env_first("SENDER_EMAIL", "SMTP_USER"),
            sender_password=_env_first("SENDER_PASSWORD", "SMTP_PASSWORD"),
            recipient_email=_env_first("CHEF_EMAIL", "NOTIF_EMAIL_TO"),
            recipient_name=_env_first("CHEF_NOM", "NOTIF_EMAIL_NAME",
                                      default="Chef de Service"),
        )
        if not email_cfg.sender_email or not email_cfg.recipient_email:
            email_cfg = None

    whatsapp_cfg = None
    if _env_bool("MINEASSIST_NOTIF_WHATSAPP", default=False):
        to_number = _env_first("CHEF_WHATSAPP", "NOTIF_WHATSAPP_TO")
        if to_number and _is_placeholder_phone(to_number):
            print("[sim_router] WhatsApp desactive : numero destinataire = "
                  "placeholder (mettez un vrai numero dans CHEF_WHATSAPP)")
            to_number = ""
        whatsapp_cfg = WhatsAppConfig(
            account_sid=_env_first("TWILIO_SID", "TWILIO_ACCOUNT_SID"),
            auth_token=_env_first("TWILIO_TOKEN", "TWILIO_AUTH_TOKEN"),
            from_number=_env_first("TWILIO_FROM",
                                   default="whatsapp:+14155238886"),
            to_number=to_number,
        )
        if not whatsapp_cfg.account_sid or not whatsapp_cfg.to_number:
            whatsapp_cfg = None

    return email_cfg, whatsapp_cfg


def _get_cooldown_seconds() -> int:
    try:
        return int(os.getenv("MINEASSIST_NOTIF_COOLDOWN_S", "600"))  # 10 min
    except ValueError:
        return 600


# --------------------------------------------------------------------- #
#  Helpers communs au SMTP et a Brevo : fabrication sujet + textes
# --------------------------------------------------------------------- #
def _build_email_subject(alertes: list[Alerte]) -> str:
    n_crit = sum(1 for a in alertes if a.niveau == NiveauAlerte.ALERTE)
    if n_crit > 0:
        return f"[MineAssist] {n_crit} alerte(s) critique(s) - 994F1 OCP Benguerir"
    return f"[MineAssist] {len(alertes)} attention(s) - 994F1 OCP Benguerir"


def _build_email_text(alertes: list[Alerte]) -> str:
    txt = f"MineAssist - {len(alertes)} anomalie(s) detectee(s) sur 994F1.\n\n"
    for a in alertes:
        txt += (f"  - {a.label}: {a.valeur}{a.unite} "
                f"(seuil: {a.seuil}) -- {a.niveau.value}\n")
    return txt


def _safe_html(alertes: list[Alerte]) -> str:
    try:
        return _build_email_html(alertes)
    except Exception:
        return f"<pre>{_build_email_text(alertes)}</pre>"


# --------------------------------------------------------------------- #
#  Transport 1 : SMTP direct (port 587 STARTTLS ou 465 SSL)
# --------------------------------------------------------------------- #
def _envoyer_email_smtp(alertes: list[Alerte],
                        cfg: EmailConfig) -> tuple[bool, Optional[str]]:
    """SMTP brut (Gmail, OVH, etc.). Bloque si firewall reseau bloque 25/465/587."""
    if not alertes:
        return True, None

    msg = MIMEMultipart("alternative")
    msg["Subject"] = _build_email_subject(alertes)
    msg["From"]    = f"MineAssist OCP <{cfg.sender_email}>"
    msg["To"]      = cfg.recipient_email
    msg.attach(MIMEText(_build_email_text(alertes), "plain", "utf-8"))
    msg.attach(MIMEText(_safe_html(alertes), "html", "utf-8"))

    timeout = int(os.getenv("MINEASSIST_NOTIF_TIMEOUT_S", "20"))

    try:
        if int(cfg.smtp_port) == 465:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port,
                                  timeout=timeout, context=ctx) as server:
                server.login(cfg.sender_email, cfg.sender_password)
                server.sendmail(cfg.sender_email,
                                cfg.recipient_email,
                                msg.as_string())
        else:
            with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port,
                              timeout=timeout) as server:
                server.starttls()
                server.login(cfg.sender_email, cfg.sender_password)
                server.sendmail(cfg.sender_email,
                                cfg.recipient_email,
                                msg.as_string())
        print(f"[sim_router] email SMTP envoye a {cfg.recipient_email} "
              f"({len(alertes)} alerte(s), port={cfg.smtp_port})")
        return True, None

    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[sim_router] echec SMTP (port {cfg.smtp_port}) : {err}")
        return False, err


# --------------------------------------------------------------------- #
#  Transport 2 : Brevo HTTP API (port 443, jamais bloque par les firewalls)
#  https://developers.brevo.com/reference/sendtransacemail
# --------------------------------------------------------------------- #
def _envoyer_email_brevo(alertes: list[Alerte],
                         cfg: EmailConfig,
                         api_key: str) -> tuple[bool, Optional[str]]:
    """Brevo (ex-Sendinblue) en HTTPS. 300 emails/jour gratuits, port 443."""
    if not alertes:
        return True, None

    body = {
        "sender":      {"name": "MineAssist OCP", "email": cfg.sender_email},
        "to":          [{"email": cfg.recipient_email,
                         "name":  cfg.recipient_name}],
        "subject":     _build_email_subject(alertes),
        "htmlContent": _safe_html(alertes),
        "textContent": _build_email_text(alertes),
        "tags":        ["mineassist", "994F1"],
    }

    timeout = int(os.getenv("MINEASSIST_NOTIF_TIMEOUT_S", "20"))
    req = urllib.request.Request(
        url="https://api.brevo.com/v3/smtp/email",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "api-key":      api_key,
            "content-type": "application/json",
            "accept":       "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read().decode("utf-8", errors="ignore")
            if resp.status in (200, 201):
                print(f"[sim_router] email BREVO envoye a {cfg.recipient_email} "
                      f"({len(alertes)} alerte(s)) -> HTTP {resp.status}")
                return True, None
            return False, f"Brevo HTTP {resp.status}: {payload[:300]}"

    except urllib.error.HTTPError as e:
        body_err = ""
        try:
            body_err = e.read().decode("utf-8", errors="ignore")[:300]
        except Exception:
            pass
        err = f"Brevo HTTP {e.code}: {body_err or e.reason}"
        print(f"[sim_router] echec Brevo : {err}")
        return False, err

    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[sim_router] echec Brevo : {err}")
        return False, err


# --------------------------------------------------------------------- #
#  Dispatcher : essaie Brevo en priorite si BREVO_API_KEY est defini,
#  fallback automatique sur SMTP. Retourne (ok, error, transport_used).
# --------------------------------------------------------------------- #
def _envoyer_email_smart(alertes: list[Alerte],
                         cfg: EmailConfig) -> tuple[bool, Optional[str], str]:
    """
    Retourne (ok, error_message, transport_used).

    Strategie :
      1. Si BREVO_API_KEY est defini -> Brevo HTTPS en priorite (port 443)
      2. Sinon ou si Brevo echoue   -> SMTP fallback (port SMTP_PORT)
    """
    if not alertes:
        return True, None, "noop"

    errors: list[str] = []
    brevo_key = _env_first("BREVO_API_KEY")

    # 1) Brevo HTTPS (recommande sur reseaux qui bloquent SMTP)
    if brevo_key:
        ok, err = _envoyer_email_brevo(alertes, cfg, brevo_key)
        if ok:
            return True, None, "brevo_http"
        errors.append(f"brevo: {err}")

    # 2) SMTP direct (Gmail, OVH, etc.)
    if cfg.sender_password:
        ok, err = _envoyer_email_smtp(alertes, cfg)
        if ok:
            return True, None, f"smtp:{cfg.smtp_port}"
        errors.append(f"smtp:{cfg.smtp_port}: {err}")
    else:
        errors.append("smtp: skip (sender_password vide)")

    return False, " | ".join(errors), "all_failed"


# --------------------------------------------------------------------- #
#  Detection d'alertes + notifications en arriere-plan
# --------------------------------------------------------------------- #
def _filter_for_notification(alertes_obj: list[Alerte], engin: str) -> list[Alerte]:
    """
    Garde uniquement les ALERTE (pas les Attention) et applique l'anti-spam :
    on n'envoie pas plus d'une notification par capteur toutes les N secondes.
    """
    cooldown = timedelta(seconds=_get_cooldown_seconds())
    a_envoyer: list[Alerte] = []
    now = datetime.now()

    with _notif_lock:
        for a in alertes_obj:
            if a.niveau != NiveauAlerte.ALERTE:
                continue  # on n'alerte qu'au franchissement du seuil critique
            cle = (engin, a.parametre)
            last = _last_notified.get(cle)
            if last and (now - last) < cooldown:
                _notif_stats["supprimees_anti_spam"] += 1
                continue
            _last_notified[cle] = now
            a_envoyer.append(a)

    return a_envoyer


def _detect_alerts_async(payload: list[dict], engin: str, ts: datetime,
                         cycle_phase: Optional[str], defaut_actif: Optional[str]) -> None:
    """
    Tourne en tache de fond apres que la reponse HTTP soit deja partie.
    Ne bloque jamais le worker uvicorn.

    1. detection (analyser_batch)
    2. ecriture dans le buffer in-memory (toujours)
    3. envoi email + whatsapp (optionnel, si MINEASSIST_NOTIF_ENABLED=true,
       avec anti-spam cooldown par capteur).
    """
    # 1) detection -----------------------------------------------------
    try:
        alertes_obj = analyser_batch(payload)
    except Exception as e:
        print(f"[sim_router] erreur analyser_batch : {e}")
        return

    # 2) buffer in-memory ----------------------------------------------
    alertes_dict = []
    for a in alertes_obj:
        d = {
            "parametre": getattr(a, "parametre", None),
            "label": getattr(a, "label", None),
            "valeur": getattr(a, "valeur", None),
            "unite": getattr(a, "unite", None),
            "seuil": getattr(a, "seuil", None),
            "niveau": (a.niveau.value if hasattr(getattr(a, "niveau", None), "value")
                       else str(getattr(a, "niveau", ""))),
            "motif": getattr(a, "motif", None),
            "engin": getattr(a, "engin", engin),
            "horodatage": (a.horodatage.isoformat() if hasattr(getattr(a, "horodatage", None), "isoformat")
                           else ts.isoformat()),
            "cycle_phase": cycle_phase,
            "defaut_actif": defaut_actif,
        }
        alertes_dict.append(d)

    if alertes_dict:
        with _lock:
            for a in alertes_dict:
                _buffer_alertes.append(a)

    # 3) notifications externes (optionnel) ----------------------------
    email_cfg, wa_cfg = _build_notif_configs()
    if email_cfg is None and wa_cfg is None:
        return  # notifications desactivees, on s'arrete la

    a_envoyer = _filter_for_notification(alertes_obj, engin)
    if not a_envoyer:
        return

    # --- envoi email --------------------------------------------------
    email_ok: Optional[bool] = None
    transport_used = "none"
    if email_cfg is not None:
        email_ok, err, transport_used = _envoyer_email_smart(a_envoyer, email_cfg)
        with _notif_lock:
            if email_ok:
                _notif_stats["envoyees"]            += len(a_envoyer)
                _notif_stats["last_email_ok_at"]    = datetime.now().isoformat()
                _notif_stats["last_email_error"]    = None
                _notif_stats["last_transport"]      = transport_used
            else:
                _notif_stats["echecs"]              += 1
                _notif_stats["last_email_error"]    = err
                _notif_stats["last_transport"]      = transport_used

    # --- envoi whatsapp -----------------------------------------------
    whatsapp_ok: Optional[bool] = None
    if wa_cfg is not None:
        try:
            whatsapp_ok = envoyer_whatsapp(a_envoyer, wa_cfg)
        except Exception as e:
            whatsapp_ok = False
            with _notif_lock:
                _notif_stats["echecs"] += 1
            print(f"[sim_router] erreur whatsapp : {e}")

    print(f"[sim_router] notifier -> email={email_ok} whatsapp={whatsapp_ok} "
          f"transport={transport_used} ({len(a_envoyer)} alerte(s))")


# --------------------------------------------------------------------- #
#  Router
# --------------------------------------------------------------------- #
sim_router = APIRouter(prefix="/sim", tags=["Simulation MATLAB"])


@sim_router.post("/ingest", response_model=IngestResponse)
async def sim_ingest(req: IngestRequest, bg: BackgroundTasks):
    """
    Recoit une snapshot capteurs (1 a N parametres) a horodatage donne.
    NON-BLOQUANT : on stocke immediatement dans le buffer puis la detection
    d'alertes + notifications sont planifiees en tache de fond pour ne pas
    saturer le worker uvicorn.
    """
    ts = req.horodatage or datetime.now()

    snapshot = {
        "horodatage": ts.isoformat(),
        "engin": req.engin,
        "cycle_phase": req.cycle_phase,
        "defaut_actif": req.defaut_actif,
        "mesures": {m.parametre: m.valeur for m in req.mesures},
        "raw": [m.model_dump() for m in req.mesures],
    }

    with _lock:
        _buffer_mesures.append(snapshot)
        size = len(_buffer_mesures)

    payload = [
        {
            "parametre": m.parametre,
            "val_max": m.val_max if m.val_max is not None else m.valeur,
            "val_min": m.val_min if m.val_min is not None else m.valeur,
            "engin": req.engin,
            "horodatage": ts,
        }
        for m in req.mesures
    ]
    bg.add_task(_detect_alerts_async, payload, req.engin, ts,
                req.cycle_phase, req.defaut_actif)

    return IngestResponse(
        status="ok",
        received_at=ts.isoformat(),
        buffer_size=size,
    )


@sim_router.get("/state")
async def sim_state(n: int = 60):
    """
    Renvoie les n dernieres snapshots + les alertes recentes (max 100).
    """
    with _lock:
        recent = list(_buffer_mesures)[-n:]
        alertes = list(_buffer_alertes)[-100:]
        total = len(_buffer_mesures)

    last = recent[-1] if recent else None
    return {
        "buffer_size": total,
        "n_returned": len(recent),
        "engin": last["engin"] if last else None,
        "horodatage": last["horodatage"] if last else None,
        "cycle_phase": last.get("cycle_phase") if last else None,
        "defaut_actif": last.get("defaut_actif") if last else None,
        "recent": [
            {
                "horodatage": s["horodatage"],
                "engin": s["engin"],
                "cycle_phase": s.get("cycle_phase"),
                "defaut_actif": s.get("defaut_actif"),
                "mesures": s["raw"],
            }
            for s in recent
        ],
        "alertes_recentes": alertes,
    }


@sim_router.get("/last-values")
async def sim_last_values():
    """
    Renvoie uniquement la derniere snapshot (format dashboard).
    """
    with _lock:
        last = _buffer_mesures[-1] if _buffer_mesures else None
        size = len(_buffer_mesures)

    if last is None:
        return {"buffer_size": 0, "snapshot": None}

    return {
        "buffer_size": size,
        "snapshot": {
            "horodatage": last["horodatage"],
            "engin": last["engin"],
            "cycle_phase": last.get("cycle_phase"),
            "defaut_actif": last.get("defaut_actif"),
            "values": last["mesures"],
            "mesures": last["raw"],
        }
    }


@sim_router.get("/notif-status")
async def sim_notif_status():
    """
    Etat du dispatcher de notifications : nb envoyees, anti-spam, configuration.
    """
    email_cfg, wa_cfg = _build_notif_configs()
    with _notif_lock:
        last_per_capteur = {
            f"{k[0]}::{k[1]}": v.isoformat() for k, v in _last_notified.items()
        }
        stats = dict(_notif_stats)
    return {
        "enabled": email_cfg is not None or wa_cfg is not None,
        "email_active": email_cfg is not None,
        "whatsapp_active": wa_cfg is not None,
        "cooldown_seconds": _get_cooldown_seconds(),
        "stats": stats,
        "dernieres_envois_par_capteur": last_per_capteur,
        "destinataire_email": email_cfg.recipient_email if email_cfg else None,
        "destinataire_whatsapp": wa_cfg.to_number if wa_cfg else None,
        "smtp_host": email_cfg.smtp_host if email_cfg else None,
        "smtp_port": email_cfg.smtp_port if email_cfg else None,
        "brevo_configured": bool(_env_first("BREVO_API_KEY")),
        "version": "v3.3",
    }


@sim_router.post("/notif-debug")
async def sim_notif_debug():
    """
    Test SYNCHRONE : envoie un email de test et renvoie le resultat
    (succes / echec + exception complete) directement dans la reponse JSON.
    Pas besoin de fouiller dans les logs uvicorn.

    Bypass l'anti-spam et la BackgroundTask. Utile pour diagnostiquer un
    blocage SMTP (firewall, app password, port, etc.).
    """
    email_cfg, _ = _build_notif_configs()
    if email_cfg is None:
        return {
            "ok": False,
            "reason": "Email desactive (MINEASSIST_NOTIF_ENABLED != true ou "
                      "credentials manquants)",
            "config_loaded": False,
        }

    fake = Alerte(
        parametre="CH994.P1.Test debug",
        label="Test debug SMTP MineAssist",
        valeur=999.0,
        unite="(test)",
        seuil=100.0,
        niveau=NiveauAlerte.ALERTE,
        engin="994F1",
        horodatage=datetime.now(),
        motif="Test synchrone via /sim/notif-debug",
    )

    t_start = datetime.now()
    transport_used = "none"
    try:
        ok, err, transport_used = _envoyer_email_smart([fake], email_cfg)
    except Exception as e:
        ok = False
        err = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
    duration_ms = (datetime.now() - t_start).total_seconds() * 1000

    with _notif_lock:
        if ok:
            _notif_stats["envoyees"]            += 1
            _notif_stats["last_email_ok_at"]    = datetime.now().isoformat()
            _notif_stats["last_email_error"]    = None
            _notif_stats["last_transport"]      = transport_used
        else:
            _notif_stats["echecs"]              += 1
            _notif_stats["last_email_error"]    = err
            _notif_stats["last_transport"]      = transport_used

    brevo_configured = bool(_env_first("BREVO_API_KEY"))

    return {
        "ok": ok,
        "error": err,
        "duration_ms": round(duration_ms, 1),
        "smtp_host": email_cfg.smtp_host,
        "smtp_port": email_cfg.smtp_port,
        "sender": email_cfg.sender_email,
        "recipient": email_cfg.recipient_email,
        "transport_used": transport_used,
        "brevo_configured": brevo_configured,
        "hint": (
            "Brevo HTTP active (port 443) en priorite, SMTP en fallback."
            if brevo_configured else
            "Brevo non configure : BREVO_API_KEY manquant dans .env. Utilise SMTP uniquement."
        ),
    }


@sim_router.post("/notif-test")
async def sim_notif_test(bg: BackgroundTasks):
    """
    Force l'envoi d'une notification de test (ALERTE bidon) pour valider la
    configuration SMTP / Twilio. Bypass l'anti-spam.
    """
    email_cfg, wa_cfg = _build_notif_configs()
    if email_cfg is None and wa_cfg is None:
        return {
            "status": "skipped",
            "reason": "Notifications desactivees (MINEASSIST_NOTIF_ENABLED != true)",
        }

    fake = Alerte(
        parametre="CH994.P1.Test notification",
        label="Test notification MineAssist",
        valeur=999.0,
        unite="(test)",
        seuil=100.0,
        niveau=NiveauAlerte.ALERTE,
        engin="994F1",
        horodatage=datetime.now(),
        motif="Test manuel via /sim/notif-test",
    )

    def _send():
        try:
            if email_cfg is not None:
                ok, err, transport_used = _envoyer_email_smart([fake], email_cfg)
                with _notif_lock:
                    if ok:
                        _notif_stats["envoyees"]            += 1
                        _notif_stats["last_email_ok_at"]    = datetime.now().isoformat()
                        _notif_stats["last_email_error"]    = None
                        _notif_stats["last_transport"]      = transport_used
                    else:
                        _notif_stats["echecs"]              += 1
                        _notif_stats["last_email_error"]    = err
                        _notif_stats["last_transport"]      = transport_used
                print(f"[sim_router] notif-test email -> ok={ok} "
                      f"transport={transport_used} err={err}")
            if wa_cfg is not None:
                wa_ok = envoyer_whatsapp([fake], wa_cfg)
                print(f"[sim_router] notif-test whatsapp -> {wa_ok}")
        except Exception as e:
            print(f"[sim_router] notif-test erreur : {e}")

    bg.add_task(_send)
    return {
        "status": "scheduled",
        "email_active": email_cfg is not None,
        "whatsapp_active": wa_cfg is not None,
        "hint": "Verifie /sim/notif-status apres 5 secondes pour voir le resultat. "
                "Pour un retour synchrone (avec exception complete), utilise /sim/notif-debug.",
    }


@sim_router.delete("/buffer")
async def sim_clear():
    """
    Vide le buffer (debug / reinitialisation).
    """
    with _lock:
        _buffer_mesures.clear()
        _buffer_alertes.clear()
    with _notif_lock:
        _last_notified.clear()
    return {"status": "cleared"}
