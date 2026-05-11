"""
MineAssist — Notification Service
OCP Benguérir | Caterpillar 994F
Notifications Email (SMTP) + WhatsApp (Twilio) pour alertes et attentions
"""

import smtplib
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# 1. MODÈLES DE DONNÉES
# ─────────────────────────────────────────────────────────────

class NiveauAlerte(str, Enum):
    ATTENTION = "Attention"
    ALERTE = "ALERTE"


@dataclass
class Alerte:
    parametre:    str
    label:        str
    valeur:       float
    unite:        str
    seuil:        float
    niveau:       NiveauAlerte
    engin:        str = "994F1"
    horodatage:   datetime = field(default_factory=datetime.now)
    motif:        str = ""

    @property
    def emoji(self) -> str:
        return "🚨" if self.niveau == NiveauAlerte.ALERTE else "⚠️"

    @property
    def couleur_html(self) -> str:
        return "#C8102E" if self.niveau == NiveauAlerte.ALERTE else "#E87722"

    @property
    def bg_html(self) -> str:
        return "#FFEBEE" if self.niveau == NiveauAlerte.ALERTE else "#FFF3E0"


# ─────────────────────────────────────────────────────────────
# 2. CONFIGURATION
# ─────────────────────────────────────────────────────────────

@dataclass
class EmailConfig:
    smtp_host:     str = "smtp.gmail.com"
    smtp_port:     int = 587
    sender_email:  str = ""          # ex: mineassist.ocp@gmail.com
    sender_password: str = ""        # mot de passe app Gmail
    recipient_email: str = ""        # email du chef
    recipient_name:  str = "Chef de Service"


@dataclass
class WhatsAppConfig:
    """Utilise Twilio WhatsApp Sandbox (gratuit pour tests)"""
    account_sid:  str = ""           # Twilio Account SID
    auth_token:   str = ""           # Twilio Auth Token
    from_number:  str = "whatsapp:+14155238886"   # Numéro sandbox Twilio
    to_number:    str = ""           # ex: whatsapp:+212600000000


# ─────────────────────────────────────────────────────────────
# 3. EMAIL
# ─────────────────────────────────────────────────────────────

def _build_email_html(alertes: list[Alerte]) -> str:
    rows = ""
    for a in alertes:
        rows += f"""
        <tr style="background:{a.bg_html}">
          <td style="padding:8px;border:1px solid #ddd">{a.horodatage.strftime('%d/%m/%Y %H:%M')}</td>
          <td style="padding:8px;border:1px solid #ddd">{a.engin}</td>
          <td style="padding:8px;border:1px solid #ddd">{a.label}</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:center">
            <b style="color:{a.couleur_html}">{a.valeur} {a.unite}</b>
          </td>
          <td style="padding:8px;border:1px solid #ddd;text-align:center">{a.seuil} {a.unite}</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:center">
            <span style="color:{a.couleur_html};font-weight:bold">{a.emoji} {a.niveau.value}</span>
          </td>
          <td style="padding:8px;border:1px solid #ddd;font-size:12px">{a.motif}</td>
        </tr>"""

    n_alertes = sum(1 for a in alertes if a.niveau == NiveauAlerte.ALERTE)
    n_attentions = sum(1 for a in alertes if a.niveau == NiveauAlerte.ATTENTION)

    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">
  <div style="max-width:900px;margin:auto;background:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.15)">

    <!-- Header -->
    <div style="background:#1E3A5F;padding:20px 30px">
      <h1 style="color:white;margin:0;font-size:20px">🔧 MineAssist — Système d'Alertes</h1>
      <p style="color:#aaa;margin:4px 0 0">OCP Benguérir | Caterpillar 994F1</p>
    </div>

    <!-- KPI Banner -->
    <div style="display:flex;background:#f9f9f9;border-bottom:2px solid #eee">
      <div style="flex:1;text-align:center;padding:15px;border-right:1px solid #eee">
        <div style="font-size:28px;font-weight:bold;color:#C8102E">{n_alertes}</div>
        <div style="font-size:12px;color:#666">🚨 Alertes critiques</div>
      </div>
      <div style="flex:1;text-align:center;padding:15px;border-right:1px solid #eee">
        <div style="font-size:28px;font-weight:bold;color:#E87722">{n_attentions}</div>
        <div style="font-size:12px;color:#666">⚠️ Attentions</div>
      </div>
      <div style="flex:1;text-align:center;padding:15px">
        <div style="font-size:14px;font-weight:bold;color:#1E3A5F">{datetime.now().strftime('%d/%m/%Y %H:%M')}</div>
        <div style="font-size:12px;color:#666">📅 Date rapport</div>
      </div>
    </div>

    <!-- Table -->
    <div style="padding:20px">
      <h2 style="color:#1E3A5F;font-size:15px">Détail des anomalies détectées</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#1E3A5F;color:white">
            <th style="padding:10px;border:1px solid #ddd">Horodatage</th>
            <th style="padding:10px;border:1px solid #ddd">Engin</th>
            <th style="padding:10px;border:1px solid #ddd">Paramètre</th>
            <th style="padding:10px;border:1px solid #ddd">Valeur</th>
            <th style="padding:10px;border:1px solid #ddd">Seuil</th>
            <th style="padding:10px;border:1px solid #ddd">Niveau</th>
            <th style="padding:10px;border:1px solid #ddd">Motif</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="background:#1E3A5F;padding:15px 30px;text-align:center">
      <p style="color:#aaa;margin:0;font-size:11px">
        Ce message a été généré automatiquement par MineAssist · OCP Benguérir<br>
        Ne pas répondre directement à cet email.
      </p>
    </div>
  </div>
</body>
</html>"""


def envoyer_email(alertes: list[Alerte], config: EmailConfig) -> bool:
    """Envoie un email HTML récapitulatif des alertes."""
    if not alertes:
        logger.info("Aucune alerte à envoyer par email.")
        return True

    n_crit = sum(1 for a in alertes if a.niveau == NiveauAlerte.ALERTE)
    sujet = (
        f"🚨 [MineAssist] {n_crit} alerte(s) critique(s) — 994F1 OCP Benguérir"
        if n_crit > 0
        else f"⚠️ [MineAssist] {len(alertes)} attention(s) — 994F1 OCP Benguérir"
    )

    msg = MIMEMultipart("alternative")
    msg["Subject"] = sujet
    msg["From"] = f"MineAssist OCP <{config.sender_email}>"
    msg["To"] = config.recipient_email

    # Fallback texte
    texte = f"MineAssist — {len(alertes)} anomalie(s) détectée(s) sur 994F1.\n"
    for a in alertes:
        texte += f"  {a.emoji} {a.label}: {a.valeur}{a.unite} (seuil: {a.seuil}) — {a.niveau.value}\n"

    msg.attach(MIMEText(texte, "plain", "utf-8"))
    msg.attach(MIMEText(_build_email_html(alertes), "html", "utf-8"))

    try:
        with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=15) as server:
            server.starttls()
            server.login(config.sender_email, config.sender_password)
            server.sendmail(config.sender_email, config.recipient_email, msg.as_string())
        logger.info(f"✅ Email envoyé à {config.recipient_email} — {len(alertes)} alerte(s)")
        return True
    except Exception as e:
        logger.error(f"❌ Échec envoi email: {e}")
        return False


# ─────────────────────────────────────────────────────────────
# 4. WHATSAPP (TWILIO)
# ─────────────────────────────────────────────────────────────

def _build_whatsapp_message(alertes: list[Alerte]) -> str:
    """Construit un message WhatsApp concis."""
    n_crit = sum(1 for a in alertes if a.niveau == NiveauAlerte.ALERTE)
    n_att = sum(1 for a in alertes if a.niveau == NiveauAlerte.ATTENTION)
    now = datetime.now().strftime("%d/%m/%Y %H:%M")

    lines = [
        f"*🔧 MineAssist — OCP Benguérir*",
        f"Engin: *994F1* | {now}",
        "",
    ]
    if n_crit:
        lines.append(f"🚨 *{n_crit} ALERTE(S) CRITIQUE(S)*")
    if n_att:
        lines.append(f"⚠️ *{n_att} attention(s)*")
    lines.append("")

    for a in alertes[:8]:  # Max 8 dans WhatsApp pour lisibilité
        lines.append(f"{a.emoji} *{a.label}*: {a.valeur} {a.unite} (seuil: {a.seuil})")

    if len(alertes) > 8:
        lines.append(f"_...et {len(alertes) - 8} autre(s) anomalie(s)_")

    lines += ["", "_Consultez MineAssist pour le détail complet._"]
    return "\n".join(lines)


def envoyer_whatsapp(alertes: list[Alerte], config: WhatsAppConfig) -> bool:
    """Envoie une notification WhatsApp via Twilio."""
    if not alertes:
        return True
    try:
        from twilio.rest import Client
        client = Client(config.account_sid, config.auth_token)
        message = _build_whatsapp_message(alertes)
        msg = client.messages.create(
            body=message,
            from_=config.from_number,
            to=config.to_number
        )
        logger.info(f"✅ WhatsApp envoyé (SID: {msg.sid})")
        return True
    except ImportError:
        logger.error("❌ Twilio non installé. Lancez: pip install twilio")
        return False
    except Exception as e:
        logger.error(f"❌ Échec WhatsApp: {e}")
        return False


# ─────────────────────────────────────────────────────────────
# 5. DISPATCHER PRINCIPAL
# ─────────────────────────────────────────────────────────────

def notifier(
    alertes:        list[Alerte],
    email_config:   Optional[EmailConfig] = None,
    whatsapp_config: Optional[WhatsAppConfig] = None,
) -> dict:
    """
    Dispatch des notifications vers email et/ou WhatsApp.
    Retourne un dict avec les statuts d'envoi.
    """
    resultats = {"email": None, "whatsapp": None, "nb_alertes": len(alertes)}

    if not alertes:
        logger.info("Aucune alerte — aucune notification envoyée.")
        return resultats

    if email_config:
        resultats["email"] = envoyer_email(alertes, email_config)

    if whatsapp_config:
        resultats["whatsapp"] = envoyer_whatsapp(alertes, whatsapp_config)

    return resultats
