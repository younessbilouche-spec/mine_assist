"""
Test SMTP direct — diagnostic
Lance ce script tel quel. Il imprime TOUT le dialogue SMTP avec Gmail.
Tu vois exactement si l'e-mail part ou pas, et pourquoi.

Usage :
    python test_smtp_direct.py
"""

import os
import smtplib
import sys
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def main() -> int:
    # essaie de charger .env si dispo
    try:
        from dotenv import load_dotenv
        load_dotenv()
        print("[ok] .env charge")
    except ImportError:
        print("[info] python-dotenv pas installe, utilise les variables d'env actuelles")

    sender = _env("SENDER_EMAIL") or _env("SMTP_USER")
    password = _env("SENDER_PASSWORD") or _env("SMTP_PASSWORD")
    recipient = _env("CHEF_EMAIL") or _env("NOTIF_EMAIL_TO")
    smtp_host = _env("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(_env("SMTP_PORT", "587"))

    print()
    print("=" * 60)
    print("Configuration lue depuis .env :")
    print(f"  SMTP host       = {smtp_host}")
    print(f"  SMTP port       = {smtp_port}")
    print(f"  Expediteur      = {sender or '(VIDE !)'}")
    print(f"  Mot de passe    = {'*' * len(password) if password else '(VIDE !)'}"
          f"  ({len(password)} chars)")
    print(f"  Destinataire    = {recipient or '(VIDE !)'}")
    print("=" * 60)
    print()

    if not sender or not password or not recipient:
        print("[ERREUR] credentials manquants — verifie ton .env")
        return 1

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "[TEST DIRECT] MineAssist diagnostic SMTP"
    msg["From"] = f"MineAssist Test <{sender}>"
    msg["To"] = recipient
    msg.attach(MIMEText("Ceci est un test direct SMTP.\n\n"
                        "Si tu lis ceci, ton SMTP fonctionne.\n",
                        "plain", "utf-8"))

    try:
        print(f"[1/5] Connexion a {smtp_host}:{smtp_port} ...")
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=15)
        server.set_debuglevel(2)  # AFFICHE TOUT le dialogue SMTP

        print("[2/5] STARTTLS ...")
        server.starttls()

        print("[3/5] Authentification ...")
        server.login(sender, password)

        print("[4/5] Envoi du message ...")
        refused = server.sendmail(sender, recipient, msg.as_string())
        print(f"      sendmail() retour : {refused}")

        print("[5/5] Fermeture connexion ...")
        server.quit()

        print()
        print("=" * 60)
        if not refused:
            print("RESULTAT : Gmail a accepte le message a 100%.")
            print("           => Si tu n'as rien dans la boite de Youness, c'est :")
            print("            - soit dans son SPAM / Tous les messages / Corbeille")
            print("            - soit un filtre Gmail qui le supprime")
            print("            - soit un retard reseau (jusqu'a 30 min sur Gmail)")
        else:
            print(f"RESULTAT : recipients refuses : {refused}")
        print("=" * 60)
        return 0

    except smtplib.SMTPAuthenticationError as e:
        print()
        print("[ECHEC AUTHENTIFICATION]")
        print(f"  {e}")
        print()
        print("Cause probable :")
        print("  - mot de passe d'application Gmail invalide")
        print("  - 2FA non active sur le compte (requis pour app passwords)")
        print("  - app password revoque cote Google")
        print("  Genere un nouveau app password : https://myaccount.google.com/apppasswords")
        return 2

    except smtplib.SMTPRecipientsRefused as e:
        print()
        print("[ECHEC DESTINATAIRE]")
        print(f"  {e}")
        print(f"  Verifie l'orthographe de CHEF_EMAIL = {recipient!r}")
        return 3

    except smtplib.SMTPException as e:
        print()
        print(f"[ECHEC SMTP] {type(e).__name__}: {e}")
        return 4

    except Exception as e:
        print()
        print(f"[EXCEPTION INATTENDUE] {type(e).__name__}: {e}")
        return 5


if __name__ == "__main__":
    sys.exit(main())
