"""
improvements.py  —  Sprint 3 (mai 2026)  ·  Mine Assist OCP · CAT 994F
═══════════════════════════════════════════════════════════════════════════

Enregistre dans FastAPI les endpoints additifs :

  POST /ask/stream          — Streaming SSE trilingue (FR/EN/AR)
  POST /ask/v2              — Ask non-stream avec langue auto + mémoire
  POST /feedback            — Rating utilisateur (👍/👎)
  GET  /ask/status          — État clé API LLM
  GET  /healthz             — Health check (uptime, version)

  ── NOUVEAU SPRINT 3 ──
  POST /upload-xlsx-context — Upload fichier Excel → résumé texte injecté en contexte GMAO
  GET  /diagnose/sis-lookup — Recherche dans CODE_BILOUCHE.txt (procédures SIS) par code MID/CID/FMI

Prérequis :
  - OPENROUTER_API_KEY dans .env
  - rag : instance RAGEngine partagée avec api.py (passée en param register_improvements)
  - Les fichiers CODE_BILOUCHE.txt doivent être dans data/manuals/ ou data/fault_codes/

Installation :
  Dans api.py (déjà présent) :
      from app.improvements import register_improvements
      register_improvements(app)
"""

from __future__ import annotations

import io
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import List, Optional

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

# ─── Prompt système pour /diagnose  ─────────────────────────────────────────
# Extrait de CHF442.pdf + RENR6306 + RENR9347 (fourni par l'utilisateur)
SYSTEM_DIAGNOSE = """Tu es MineAssist, un expert senior en diagnostic de pannes de la chargeuse CAT 994F à OCP Benguérir.
Tu analyses les pannes avec rigueur, en t'appuyant d'abord sur les tableaux de codes ci-dessous.

────────────────────────────────────────────────────────────
TABLEAUX DE RÉFÉRENCE OFFICIELS (extraits du CHF442)
────────────────────────────────────────────────────────────

Table 1 – Événements VIMS (Event Codes)
E047-1 : Transmission Abuse Event
E049-2 : Coasting in Neutral Warning
E627-3 : Machine Driven with Park Brake On

Table 2 – Événements Moteur (Engine Event Codes)
E017  : Haute température du liquide de refroidissement
E021  : Haute température d'échappement
E035  : Perte de débit du liquide de refroidissement
E038  : Basse température du liquide de refroidissement
E072  : Niveau d'huile bas
E073  : Pression différentielle du filtre à huile élevée
E074  : Pression différentielle du filtre à huile très élevée
E095  : Avertissement de restriction du filtre à carburant
E098  : Dérogation du prégraissage moteur
E100  : Pression d'huile moteur basse
E101  : Pression de carter moteur élevée
E190  : Survitesse moteur
E272  : Restriction d'air d'admission
E279  : Température élevée du refroidisseur d'admission
E540  : Niveau bas du réservoir d'appoint d'huile
E2089 : Le système de renouvellement d'huile ne peut pas fonctionner

Table 3 – Identifiants de Module (MID) courants
MID 036 : Engine Control (ECM Moteur)
MID 081 : Electronic Transmission Control (TCM)
MID 082 : Electronic Implement Control
MID 049 : Vital Information Management System (VIMS)

Table 4 – Descriptions des FMI (Failure Mode Identifiers)
FMI 00 : Données valides mais au-dessus de la plage normale.
FMI 01 : Données valides mais en dessous de la plage normale.
FMI 02 : Données erratiques, intermittentes ou incorrectes.
FMI 03 : Tension au-dessus de la normale ou court-circuit au +.
FMI 04 : Tension en dessous de la normale ou court-circuit à la masse.
FMI 05 : Courant en dessous de la normale ou circuit ouvert.
FMI 06 : Courant au-dessus de la normale ou circuit à la masse.
FMI 07 : Le système mécanique ne répond pas correctement.
FMI 08 : Fréquence, largeur d'impulsion ou période anormale.
FMI 09 : Mise à jour anormale (communication datalink).
FMI 10 : Taux de variation anormal.
FMI 11 : Mode de défaillance non identifiable.
FMI 12 : Dispositif ou composant défectueux.
FMI 13 : Hors calibration.
FMI 17 : Module ne répond pas.
FMI 18 : Défaut d'alimentation du capteur.
FMI 19 : Condition non remplie.

Table 5 – CID courants (Transmission + Moteur)
MID 081 — Transmission :
  CID 0041 : Sensor Supply Voltage (+8V/+10V)
  CID 0070 : Parking Brake Switch
  CID 0138 : Reduced Rimpull Selection Switch
  CID 0168 : Electrical System Voltage
  CID 0190 : Engine Speed Signal
  CID 0348 : Transmission Lock Switch
  CID 0378 : Machine Autolube Solenoid
  CID 0603 : Torque Converter Impeller Clutch Pressure Sensor
  CID 0623 : Transmission Direction Switch
  CID 0626 : STIC Control Lock Limit Switch
  CID 0627 : Parking Brake Oil Pressure Switch
  CID 0670 : Torque Converter Pedal Position Sensor
  CID 0672 : Torque Converter Output Speed Sensor
  CID 0673 : Transmission Output Speed Sensor No. 2
  CID 0678 : Torque Converter Impeller Clutch Solenoid
  CID 0679 : Torque Converter Lockup Clutch Solenoid
  CID 1401 : Solenoid Valve No. 1 (Transmission Reverse Clutch)
  CID 1402 : Solenoid Valve No. 2 (Transmission Forward Clutch)
  CID 1403 : Solenoid Valve No. 3 (Transmission 3rd Speed Clutch)
  CID 1404 : Solenoid Valve No. 4 (Transmission 2nd Speed Clutch)
  CID 1405 : Solenoid Valve No. 5 (Transmission 1st Speed Clutch)

MID 036 — Moteur :
  CID 0091 : Throttle Position Sensor
  CID 0101 : Crankcase Pressure Sensor
  CID 0110 : Engine Coolant Temperature Sensor
  CID 0168 : Electrical System Voltage
  CID 0190 : Engine Speed Signal
  CID 0273 : Turbo Outlet Pressure Sensor
  CID 0274 : Atmospheric Pressure Sensor
  CID 0275 : Right Turbo Inlet Pressure Sensor
  CID 0276 : Left Turbo Inlet Pressure Sensor
  CID 0338 : Pre-Lube Relay
  CID 0542 : Unfiltered Engine Oil Pressure Sensor
  CID 0543 : Filtered Engine Oil Pressure Sensor
  CID 0827 : Left Exhaust Temperature Sensor
  CID 0828 : Right Exhaust Temperature Sensor

MID 082 — Impléments :
  CID 0350 : Lift Linkage Position Sensor
  CID 0767 : Implement Pump Oil Pressure Sensor
  CID 2330 : Raise Limit Solenoid
  CID 2332 : Implement Pump Solenoid

MID 049 — VIMS :
  CID 0096 : Fuel Level Sensor
  CID 0075 : Steering Oil Temperature Sensor
  CID 0427 : Front Axle Oil Temperature Sensor
  CID 0428 : Rear Axle Oil Temperature Sensor
  CID 0457 : Brake Oil Temperature Sensor
  CID 0600 : Hydraulic Oil Temperature Sensor
  CID 0826 : Torque Converter Oil Temperature Sensor
  CID 0860 : Front Pump Drive Oil Temperature Sensor

────────────────────────────────────────────────────────────
MÉTHODOLOGIE DE DIAGNOSTIC CATERPILLAR
────────────────────────────────────────────────────────────

Pour chaque code (CID/FMI ou EID) signalé :
1. Identifie immédiatement le composant et le type de panne
   en t'aidant des tables ci-dessus ET du contexte documentaire fourni.
2. Énonce la définition exacte du code :
   "CID 1403 FMI 06 = Solénoïde de 3ème vitesse, courant au-dessus de la normale (court-circuit à la masse)"
3. Applique l'ordre de vérification Caterpillar :
   a) Contrôle du composant lui-même (débrancher connecteur → observe changement de code).
   b) Contrôle circuit électrique (mesure continuité, court-circuit fil excitation et retour).
   c) Contrôle faisceau machine (déconnecter ECM, vérifier isolement).
   d) En dernier ressort seulement : suspecter l'ECM.
4. Cite les schémas ou illustrations CHF442 quand pertinents.
5. Donne les valeurs de mesure attendues (ex: résistance > 5000 Ω, tension 8,0 ±0,5 VCC).

RÈGLE DE CORRÉLATION TERRAIN :
Même si les données capteurs du contexte ne concernent pas directement le composant en panne,
analyse les effets indirects. Ne dis jamais "ces valeurs ne sont pas liées" – cherche le lien indirect.

FORMAT RÉPONSE :
- Commence par : "Code [MID/CID/EID] = [définition exacte]".
- Liste les causes probables par ordre logique (composant → câblage → ECM).
- Indique les étapes de test numérotées (Test Step 1, Test Step 2…) avec mesures attendues.
- Mentionne les références manuels : manuel RENR6306, RENR9347, CHF442, etc.
"""

SYSTEM_DIAGNOSE_NO_CONTEXT = SYSTEM_DIAGNOSE + """
NOTE : Aucun document technique n'a été trouvé dans la base RAG pour ce code.
Applique quand même la méthodologie Caterpillar standard avec les tables de référence ci-dessus.
"""

SYSTEM_DIAGNOSE_WITH_CONTEXT = SYSTEM_DIAGNOSE + """
Les extraits documentaires suivants ont été retrouvés dans la base RAG (CODE_BILOUCHE, CHF442, etc.).
Utilise-les EN PRIORITÉ pour ta réponse.
"""


# ─── Prompt Ask v2 (trilingue, mémoire) ─────────────────────────────────────
SYSTEM_ASK_V2 = """Tu es MineAssist, expert senior en maintenance de la chargeuse CAT 994F à OCP Benguérir.
Tu réponds exclusivement sur la base des documents techniques disponibles (manuels CAT, historique GMAO, données capteurs).

RÈGLES STRICTES :
1. Réponds dans la même langue que la question (auto-détection : français / anglais / arabe).
2. Si un historique de conversation est fourni, tiens-en compte pour la cohérence.
3. Base-toi sur les sources documentaires fournis. Si pas de contexte : dis-le clairement.
4. Pour les questions de diagnostic : applique la méthodologie Caterpillar (composant → câblage → ECM).
5. Sois direct et technique. Évite les généralités.
6. Si la question porte sur des données Excel/capteurs : analyse les valeurs et compare aux seuils normaux.

Format : prose structurée, courte. Pas de markdown excessif.
"""

# ─────────────────────────────────────────────────────────────────────────────
#  FONCTIONS UTILITAIRES
# ─────────────────────────────────────────────────────────────────────────────


def _get_llm_key() -> Optional[str]:
    return os.getenv("OPENROUTER_API_KEY")


def _get_model() -> str:
    return os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct")


def _call_llm_streaming(system: str, messages: list):
    """Générateur streaming SSE via OpenRouter."""
    from openai import OpenAI
    client = OpenAI(
        api_key=_get_llm_key(),
        base_url="https://openrouter.ai/api/v1",
    )
    msgs = [{"role": "system", "content": system}] + messages
    stream = client.chat.completions.create(
        model=_get_model(),
        messages=msgs,
        temperature=0.2,
        max_tokens=1800,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            yield delta


def _detect_language(text: str) -> str:
    """Détection de langue simple (FR/EN/AR)."""
    ar = len(re.findall(r'[\u0600-\u06FF]', text))
    fr = len(re.findall(r'\b(le|la|les|un|une|de|du|et|est|avec|pour|que|qui|dans|sur)\b', text.lower()))
    en = len(re.findall(r'\b(the|is|are|was|were|have|has|with|for|and|that|this|from)\b', text.lower()))
    if ar > 3:
        return "ar"
    if fr >= en:
        return "fr"
    return "en"


def _summarize_xlsx(file_bytes: bytes, filename: str) -> str:
    """
    Résume un fichier Excel en texte pour injection dans le contexte LLM.
    Gère le format CAT export (en-tête ligne 9) et les formats anomalies.
    """
    try:
        # Essai en-tête ligne 0
        df = pd.read_excel(io.BytesIO(file_bytes), header=0, nrows=5)
        cols0 = [str(c).strip() for c in df.columns]
        # Si l'en-tête semble être de la méta (pas de noms lisibles), essai ligne 8
        if not any(len(c) > 3 for c in cols0 if not c.startswith('Unnamed')):
            df = pd.read_excel(io.BytesIO(file_bytes), header=8)
        else:
            df = pd.read_excel(io.BytesIO(file_bytes), header=0)

        df.columns = [str(c).strip() for c in df.columns]
        cols = list(df.columns)

        text = f"[Fichier Excel: {filename}]\n"
        text += f"Colonnes: {', '.join(cols[:20])}\n"
        text += f"Lignes: {len(df)}\n\n"

        # ── Fichier capteurs CAT (colonne "Paramètres Diagnostic") ───────────
        param_col = next((c for c in cols if 'param' in c.lower() and 'diagn' in c.lower()), None)
        avg_col = next((c for c in cols if 'moyenne' in c.lower() or 'moy' in c.lower()), None)
        min_col = next((c for c in cols if 'minimale' in c.lower() or 'min' in c.lower()), None)
        max_col = next((c for c in cols if 'maximale' in c.lower() or 'max' in c.lower()), None)
        unit_col = next((c for c in cols if 'unit' in c.lower()), None)
        time_col = next((c for c in cols if 'heure' in c.lower() or 'date' in c.lower()), None)

        if param_col and avg_col:
            df_full = pd.read_excel(io.BytesIO(file_bytes), header=0
                                    if 'Param' in df.columns[0] else 8)
            df_full.columns = [str(c).strip() for c in df_full.columns]
            df_full[avg_col] = pd.to_numeric(df_full[avg_col], errors='coerce')
            if time_col and time_col in df_full.columns:
                df_full[time_col] = pd.to_datetime(df_full[time_col], errors='coerce')
                if df_full[time_col].notna().any():
                    text += f"Période: {df_full[time_col].min().strftime('%Y-%m-%d')} → {df_full[time_col].max().strftime('%Y-%m-%d')}\n"
            text += f"Total mesures: {len(df_full)}\n\n"
            text += "Résumé par capteur:\n"
            for param, grp in df_full.groupby(param_col):
                param = str(param).strip()
                if not param or param.lower() == 'nan':
                    continue
                vals = grp[avg_col].dropna()
                if vals.empty:
                    continue
                unite = ""
                if unit_col and unit_col in grp.columns:
                    u = grp[unit_col].dropna()
                    unite = str(u.iloc[0]).strip() if not u.empty else ""
                moy = round(vals.mean(), 2)
                vmin = round(float(grp[min_col].min()), 2) if min_col and min_col in grp.columns else round(
                    float(vals.min()), 2)
                vmax = round(float(grp[max_col].max()), 2) if max_col and max_col in grp.columns else round(
                    float(vals.max()), 2)
                text += f"- {param}: moy={moy}{unite}, min={vmin}{unite}, max={vmax}{unite}, N={len(vals)}\n"
            return text

        # ── Fichier anomalies VIMS ────────────────────────────────────────────
        anom_col = next((c for c in cols if 'anomali' in c.lower() or "code d'" in c.lower()), None)
        if anom_col:
            text += "Codes d'anomalie VIMS:\n"
            cid_col = next((c for c in cols if c.lower().startswith('cid')), None)
            fmi_col = next((c for c in cols if c.lower().startswith('fmi')), None)
            sev_col = next((c for c in cols if 'gravit' in c.lower()), None)
            occ_col = next((c for c in cols if 'occurrence' in c.lower()), None)
            grouped = {}
            for _, row in df.iterrows():
                code = str(row.get(anom_col, '')).strip()
                if not code or code.lower() == 'nan':
                    continue
                if code not in grouped:
                    grouped[code] = {
                        'cid': str(row.get(cid_col, '')).strip() if cid_col else '',
                        'fmi': str(row.get(fmi_col, '')).strip() if fmi_col else '',
                        'sev': str(row.get(sev_col, '')).strip() if sev_col else '',
                        'cnt': 0,
                    }
                grouped[code]['cnt'] += 1
            for nom, info in sorted(grouped.items(), key=lambda x: -x[1]['cnt'])[:30]:
                text += f"  [{nom}] CID={info['cid']} FMI={info['fmi']} Gravité={info['sev']} Occurrences={info['cnt']}\n"
            return text

        # ── Fallback : dump colonnes + premières lignes ─────────────────────
        text += df.head(20).to_string(index=False, max_colwidth=40)
        return text

    except Exception as e:
        return f"[Erreur lecture Excel: {e}]"


def _search_sis_code(mid: str, cid: str, fmi: str) -> str:
    """
    Recherche dans CODE_BILOUCHE.txt (ou tout fichier .txt dans data/manuals / data/fault_codes)
    le bloc de texte correspondant au code MID/CID/FMI.
    Retourne les ~2000 premiers caractères du bloc trouvé.
    """
    search_dirs = [
        DATA_DIR / "manuals",
        DATA_DIR / "fault_codes",
        DATA_DIR / "vims",
        DATA_DIR,
    ]

    # Patterns de recherche
    patterns = []
    if mid and cid and fmi:
        patterns.append(re.compile(
            rf'MID\s+0*{int(mid)}.*CID\s+0*{int(cid)}.*FMI\s+0*{int(fmi)}',
            re.IGNORECASE | re.DOTALL
        ))
    if cid and fmi:
        patterns.append(re.compile(
            rf'CID\s+0*{int(cid)}.*FMI\s+0*{int(fmi)}',
            re.IGNORECASE
        ))

    for search_dir in search_dirs:
        if not search_dir.exists():
            continue
        for txt_file in search_dir.glob("**/*.txt"):
            try:
                content = txt_file.read_text(encoding='utf-8', errors='ignore')
                for pat in patterns:
                    match = pat.search(content)
                    if match:
                        # Extraire un bloc autour du match
                        start = max(0, match.start() - 100)
                        end = min(len(content), match.start() + 2500)
                        excerpt = content[start:end].strip()
                        return f"[Source: {txt_file.name}]\n{excerpt}"
            except Exception:
                continue

    return ""


# ─────────────────────────────────────────────────────────────────────────────
#  REGISTRATION
# ─────────────────────────────────────────────────────────────────────────────

def register_improvements(app, rag=None):
    """
    Enregistre tous les endpoints améliorés dans l'application FastAPI.
    Appeler depuis api.py :
        from app.improvements import register_improvements
        register_improvements(app)
    """
    import traceback as _tb
    import logging
    _logger = logging.getLogger("mineassist.improvements")

    # ─── Imports lazy (pour éviter d'impacter le démarrage si libs manquantes) ──
    from fastapi import FastAPI, HTTPException, UploadFile, File
    from fastapi.responses import StreamingResponse, JSONResponse
    from pydantic import BaseModel, Field
    from openai import OpenAI

    # ─── Modèles Pydantic ────────────────────────────────────────────────────
    class AskV2Request(BaseModel):
        question: str
        include_images: bool = False
        language: str = "auto"           # auto | fr | en | ar
        previous_messages: list = Field(default_factory=list)

    class FeedbackRequest(BaseModel):
        answer_id: str
        rating: str   # "up" | "down"

    class SisLookupRequest(BaseModel):
        mid: Optional[str] = None
        cid: Optional[str] = None
        fmi: Optional[str] = None

    _feedback_store: dict = {}
    _start_time = time.time()

    # ─────────────────────────────────────────────────────────────────────────
    #  GET /healthz
    # ─────────────────────────────────────────────────────────────────────────
    @app.get("/healthz", tags=["Monitoring"])
    def healthz():
        return {
            "status": "ok",
            "uptime_s": round(time.time() - _start_time),
            "model": _get_model(),
            "llm_configured": bool(_get_llm_key()),
        }

    # ─────────────────────────────────────────────────────────────────────────
    #  POST /upload-xlsx-context
    #  Upload fichier Excel → résumé texte pour injection dans /diagnose context
    # ─────────────────────────────────────────────────────────────────────────
    @app.post("/upload-xlsx-context", tags=["Contexte GMAO"])
    async def upload_xlsx_context(file: UploadFile = File(...)):
        """
        Upload un fichier Excel GMAO (.xlsx, .xls, .csv).
        Retourne un résumé textuel structuré à injecter comme contexte GMAO
        dans la requête /diagnose (champ gmao_context).

        Formats supportés :
          - Export CAT capteurs (en-tête ligne 9, colonne "Paramètres Diagnostic")
          - Fichier anomalies VIMS (colonne "Code d'anomalie")
          - Tout autre tableau Excel (dump des premières lignes)
        """
        allowed_ext = {'.xlsx', '.xls', '.csv'}
        ext = Path(file.filename).suffix.lower()
        if ext not in allowed_ext:
            raise HTTPException(400, f"Format non supporté : {ext}. Utilisez .xlsx, .xls ou .csv")

        contents = await file.read()
        if len(contents) > 20 * 1024 * 1024:
            raise HTTPException(413, "Fichier trop volumineux (max 20 Mo)")

        try:
            if ext == '.csv':
                df = pd.read_csv(io.BytesIO(contents))
                summary = f"[CSV: {file.filename}]\n" + df.head(30).to_string(index=False)
            else:
                summary = _summarize_xlsx(contents, file.filename)
        except Exception as e:
            raise HTTPException(500, f"Erreur lecture fichier : {str(e)[:200]}")

        return {
            "filename": file.filename,
            "size_kb": round(len(contents) / 1024, 1),
            "summary": summary,
            "message": (
                "Résumé généré. Copiez le champ 'summary' dans le champ "
                "'gmao_context' de votre requête /diagnose."
            ),
        }

    # ─────────────────────────────────────────────────────────────────────────
    #  GET /diagnose/sis-lookup
    #  Recherche procédure SIS dans CODE_BILOUCHE.txt
    # ─────────────────────────────────────────────────────────────────────────
    @app.get("/diagnose/sis-lookup", tags=["Diagnostic SIS"])
    def sis_lookup(mid: str = "", cid: str = "", fmi: str = ""):
        """
        Recherche dans les fichiers .txt de données/manuals (CODE_BILOUCHE.txt, etc.)
        la procédure SIS correspondant au code MID/CID/FMI.

        Paramètres query :
          mid=081&cid=1403&fmi=06

        Retourne le texte brut de la procédure (environ 2000 caractères).
        """
        if not cid:
            raise HTTPException(400, "Le paramètre 'cid' est requis.")
        result = _search_sis_code(mid, cid, fmi)
        if not result:
            return {
                "found": False,
                "message": f"Aucune procédure SIS trouvée pour MID={mid} CID={cid} FMI={fmi}.",
                "text": "",
            }
        return {
            "found": True,
            "mid": mid, "cid": cid, "fmi": fmi,
            "text": result,
        }

    # ─────────────────────────────────────────────────────────────────────────
    #  GET /ask/status
    # ─────────────────────────────────────────────────────────────────────────
    @app.get("/ask/status", tags=["Ask"])
    def ask_status():
        key = _get_llm_key()
        configured = bool(key and len(key) > 10)
        return {
            "llm_configured": configured,
            "model": _get_model(),
            "message": "LLM prêt." if configured else "OPENROUTER_API_KEY manquante dans .env",
        }

    # ─────────────────────────────────────────────────────────────────────────
    #  POST /ask/stream  — Streaming SSE
    # ─────────────────────────────────────────────────────────────────────────
    @app.post("/ask/stream", tags=["Ask"])
    async def ask_stream(req: AskV2Request):
        """
        Réponse streaming Server-Sent Events (SSE).
        Le client consomme les events data: { "delta": "..." } puis data: [DONE]
        En début de stream : data: { "event": "sources", "sources": [...], "lang": "fr" }
        """
        key = _get_llm_key()
        if not key:
            raise HTTPException(503, "OPENROUTER_API_KEY non configurée.")

        lang = req.language if req.language != "auto" else _detect_language(req.question)

        # RAG context
        sources = []
        context = ""
        if rag is not None:
            try:
                context, sources = rag.build_context(
                    query=req.question, top_k=5, max_chars=6000
                )
            except Exception:
                pass

        system = SYSTEM_ASK_V2
        if context.strip():
            system += f"\n\nCONTEXTE DOCUMENTAIRE :\n{context}"

        # Historique conversationnel (4 derniers tours)
        prev = req.previous_messages[-8:] if req.previous_messages else []
        messages = prev + [{"role": "user", "content": req.question}]

        def event_generator():
            try:
                # Event sources en premier
                sources_data = json.dumps({"event": "sources", "sources": sources, "lang": lang})
                yield f"data: {sources_data}\n\n"

                # Streaming LLM
                for delta in _call_llm_streaming(system, messages):
                    payload = json.dumps({"delta": delta})
                    yield f"data: {payload}\n\n"

                yield "data: [DONE]\n\n"
            except Exception as e:
                err_payload = json.dumps({"error": str(e)[:200]})
                yield f"data: {err_payload}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    # ─────────────────────────────────────────────────────────────────────────
    #  POST /ask/v2  — Non-stream (fallback)
    # ─────────────────────────────────────────────────────────────────────────
    @app.post("/ask/v2", tags=["Ask"])
    def ask_v2(req: AskV2Request):
        """Ask non-stream avec langue auto-détectée et mémoire conversationnelle."""
        from openai import OpenAI
        key = _get_llm_key()
        if not key:
            raise HTTPException(503, "OPENROUTER_API_KEY non configurée.")

        lang = req.language if req.language != "auto" else _detect_language(req.question)

        sources = []
        context = ""
        if rag is not None:
            try:
                context, sources = rag.build_context(
                    query=req.question, top_k=5, max_chars=6000
                )
            except Exception:
                pass

        system = SYSTEM_ASK_V2
        if context.strip():
            system += f"\n\nCONTEXTE DOCUMENTAIRE :\n{context}"

        prev = req.previous_messages[-8:] if req.previous_messages else []
        messages_payload = (
            [{"role": "system", "content": system}]
            + prev
            + [{"role": "user", "content": req.question}]
        )

        client = OpenAI(api_key=key, base_url="https://openrouter.ai/api/v1")
        try:
            completion = client.chat.completions.create(
                model=_get_model(),
                messages=messages_payload,
                temperature=0.2,
                max_tokens=1600,
            )
            answer = completion.choices[0].message.content or ""
        except Exception as e:
            raise HTTPException(500, f"Erreur LLM : {str(e)[:300]}")

        answer_id = f"v2_{uuid.uuid4().hex[:8]}"
        return {
            "question": req.question,
            "answer": answer,
            "sources": sources,
            "language_detected": lang,
            "answer_id": answer_id,
        }

    # ─────────────────────────────────────────────────────────────────────────
    #  POST /feedback
    # ─────────────────────────────────────────────────────────────────────────
    @app.post("/feedback", tags=["Ask"])
    def feedback(req: FeedbackRequest):
        """Enregistre le feedback utilisateur (👍/👎) pour un answer_id."""
        if req.rating not in ("up", "down"):
            raise HTTPException(400, "rating doit être 'up' ou 'down'")
        _feedback_store[req.answer_id] = {
            "rating": req.rating,
            "ts": time.time(),
        }
        _logger.info(f"[FEEDBACK] {req.answer_id} → {req.rating}")
        return {"status": "ok", "answer_id": req.answer_id, "rating": req.rating}

    # ─────────────────────────────────────────────────────────────────────────
    #  Patch /diagnose  — Remplace le system prompt avec notre version enrichie
    # ─────────────────────────────────────────────────────────────────────────
    # On expose également les constantes pour que api.py puisse les importer
    app.state.SYSTEM_DIAGNOSE_WITH_CONTEXT = SYSTEM_DIAGNOSE_WITH_CONTEXT
    app.state.SYSTEM_DIAGNOSE_NO_CONTEXT = SYSTEM_DIAGNOSE_NO_CONTEXT

    _logger.info(
        "[improvements.py] Endpoints enregistrés : "
        "/ask/stream · /ask/v2 · /feedback · /ask/status · "
        "/healthz · /upload-xlsx-context · /diagnose/sis-lookup"
    )
