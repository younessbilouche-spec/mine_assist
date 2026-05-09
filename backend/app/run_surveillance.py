"""
MineAssist — Script autonome de surveillance
Usage: python run_surveillance.py --fichier data.xlsx --email --whatsapp

Peut être exécuté manuellement, via cron, ou planifié.
"""

import argparse
import logging
import sys
import os
import pandas as pd
from datetime import datetime
from pathlib import Path

# Ajouter le dossier courant au path
sys.path.insert(0, str(Path(__file__).parent))

from app.notification_service import EmailConfig, WhatsAppConfig, notifier
from app.alert_detector import analyser_batch, SEUILS_994F

# ─── Logging ────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("mineassist_surveillance.log", encoding="utf-8"),
    ]
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# LECTURE DU FICHIER EXCEL GMAO
# ─────────────────────────────────────────────────────────────

def charger_donnees_excel(chemin: str) -> list[dict]:
    """
    Charge un fichier Excel GMAO 994F (format OCP Benguérir).
    Gère le format avec les 8 lignes d'en-tête à ignorer.
    """
    logger.info(f"Chargement du fichier: {chemin}")
    try:
        df = pd.read_excel(chemin, sheet_name=0, header=8)
        df.columns = ['Engin','Parametre','Code','Heure',
                      'Val_min','Val_moy','Val_max','Unite','Capteur_OK']
        df = df.dropna(subset=['Parametre', 'Heure'])
        df['Parametre'] = df['Parametre'].str.strip()

        mesures = []
        for _, row in df.iterrows():
            mesures.append({
                "parametre":   row['Parametre'],
                "val_max":     float(row['Val_max']),
                "val_min":     float(row['Val_min']),
                "engin":       str(row['Engin']).strip(),
                "horodatage":  row['Heure'] if pd.notna(row['Heure']) else datetime.now(),
            })
        logger.info(f"  → {len(mesures)} mesures chargées")
        return mesures

    except Exception as e:
        logger.error(f"Erreur lecture fichier: {e}")
        raise


# ─────────────────────────────────────────────────────────────
# RÉSUMÉ CONSOLE
# ─────────────────────────────────────────────────────────────

def afficher_resume(alertes):
    n_crit = sum(1 for a in alertes if a.niveau.value == "ALERTE")
    n_att  = sum(1 for a in alertes if a.niveau.value == "Attention")

    print("\n" + "═"*60)
    print("  🔧 MINEASSIST — RÉSUMÉ DE SURVEILLANCE")
    print("  OCP Benguérir | Caterpillar 994F1")
    print("═"*60)
    print(f"  🚨 Alertes critiques : {n_crit}")
    print(f"  ⚠️  Attentions        : {n_att}")
    print(f"  📋 Total anomalies   : {len(alertes)}")
    print("─"*60)

    for a in alertes:
        icon = "🚨" if a.niveau.value == "ALERTE" else "⚠️ "
        print(f"  {icon} [{a.engin}] {a.label}: {a.valeur} {a.unite} "
              f"(seuil: {a.seuil}) — {a.horodatage.strftime('%d/%m %H:%M')}")
    print("═"*60 + "\n")


# ─────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="MineAssist — Surveillance 994F & Notifications OCP"
    )
    parser.add_argument("--fichier", "-f",  help="Chemin vers le fichier Excel GMAO")
    parser.add_argument("--email",          action="store_true", help="Envoyer par email")
    parser.add_argument("--whatsapp",       action="store_true", help="Envoyer par WhatsApp")
    parser.add_argument("--tous",           action="store_true", help="Email + WhatsApp")
    parser.add_argument("--test",           action="store_true", help="Mode test (alert fictive)")
    args = parser.parse_args()

    # ── Config depuis variables d'environnement (ou .env) ──
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    email_cfg = EmailConfig(
        smtp_host=os.getenv("SMTP_HOST", "smtp.gmail.com"),
        smtp_port=int(os.getenv("SMTP_PORT", "587")),
        sender_email=os.getenv("SENDER_EMAIL", ""),
        sender_password=os.getenv("SENDER_PASSWORD", ""),
        recipient_email=os.getenv("CHEF_EMAIL", ""),
        recipient_name=os.getenv("CHEF_NOM", "Chef de Service"),
    )

    wa_cfg = WhatsAppConfig(
        account_sid=os.getenv("TWILIO_SID", ""),
        auth_token=os.getenv("TWILIO_TOKEN", ""),
        from_number=os.getenv("TWILIO_FROM", "whatsapp:+14155238886"),
        to_number=os.getenv("CHEF_WHATSAPP", ""),
    )

    use_email     = args.email or args.tous
    use_whatsapp  = args.whatsapp or args.tous

    # ── Mode test ──
    if args.test:
        logger.info("Mode TEST activé")
        from app.notification_service import Alerte, NiveauAlerte
        alertes = [Alerte(
            parametre="TEST",
            label="Temp. Liq. Refroid.",
            valeur=115.0, unite="°C", seuil=107.0,
            niveau=NiveauAlerte.ALERTE,
            motif="Test automatique MineAssist"
        )]
        afficher_resume(alertes)
        notifier(alertes,
                 email_cfg if use_email else None,
                 wa_cfg if use_whatsapp else None)
        return

    # ── Lecture fichier ──
    if not args.fichier:
        parser.error("Spécifiez --fichier ou --test")

    mesures = charger_donnees_excel(args.fichier)
    alertes = analyser_batch(mesures)

    afficher_resume(alertes)

    if not alertes:
        logger.info("✅ Aucune anomalie détectée — aucune notification envoyée.")
        return

    resultats = notifier(
        alertes,
        email_cfg if use_email else None,
        wa_cfg if use_whatsapp else None,
    )

    logger.info(f"Résultats: {resultats}")


if __name__ == "__main__":
    main()
