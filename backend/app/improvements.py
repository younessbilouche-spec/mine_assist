"""
improvements.py — Sprint 1 + 2 (mai 2026)
==========================================

Module additif qui apporte les améliorations de l'audit ingénieur sans
toucher au code existant. Inclus :

  - Détection automatique de langue Ask (FR / EN / AR)
  - Prompts trilingues
  - Streaming SSE pour /ask/stream
  - Mémoire conversationnelle (previous_messages)
  - Rate limiting léger sur /ask et /ask/stream
  - Endpoints /healthz et /readyz
  - Endpoint /feedback (rating up/down)
  - Logging structuré JSON
  - DiagnoseRequest enrichi (ml_signals)

USAGE dans api.py — ajouter à la fin du fichier :

    from app.improvements import register_improvements
    register_improvements(app)
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("mineassist")

# ─── Rate limiting léger en mémoire (par IP / user) ──────────────────────────
_RATE_BUCKETS: Dict[str, deque] = defaultdict(lambda: deque(maxlen=100))
_RATE_LOCK = threading.Lock()


def _rate_check(key: str, limit_per_minute: int = 15) -> bool:
    """Renvoie False si la limite est dépassée pour la clé donnée."""
    now = time.time()
    cutoff = now - 60.0
    with _RATE_LOCK:
        bucket = _RATE_BUCKETS[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit_per_minute:
            return False
        bucket.append(now)
        return True


def _rate_key(request: Request) -> str:
    user_id = (
        request.headers.get("X-User-Id")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.client.host
        if request.client else "anonymous"
    )
    return user_id or "anonymous"


# ─── Détection de langue ──────────────────────────────────────────────────────
def _detect_lang(text: str) -> str:
    """
    Détection de langue robuste sans dépendance externe.
    Retourne 'fr', 'en', ou 'ar'. Défaut : 'fr'.
    """
    if not text or not text.strip():
        return "fr"
    s = text.strip().lower()

    # Arabe : présence de caractères arabes
    if any("\u0600" <= c <= "\u06ff" for c in s):
        return "ar"

    # Mots indicateurs
    fr_markers = (
        "le ", "la ", "les ", "des ", "une ", "comment", "pourquoi",
        "quelle", "quel ", "où ", "quand", "est-ce", "ça ", "à la", "est ",
        "régime", "moteur", "défaut", "huile", "pression", "température",
    )
    en_markers = (
        "the ", "what ", "how ", "why ", "where ", "when ",
        "is ", "are ", "engine", "oil", "pressure", "temperature",
        "fault", "code", "should", "would", "could", "have to",
    )
    fr_score = sum(1 for m in fr_markers if m in s)
    en_score = sum(1 for m in en_markers if m in s)

    if en_score > fr_score and en_score >= 2:
        return "en"
    return "fr"


# ─── Prompts trilingues — version v3 stricte (procédures embarquées) ─────────
#
# Changement majeur (mai 2026) :
# - INTERDICTION ABSOLUE de répondre "documentation non consultée".
# - Quand le RAG renvoie peu/rien, utiliser les procédures CAT 994F embarquées
#   ci-dessous comme base de connaissances de secours, en mentionnant clairement
#   qu'il s'agit d'une procédure générique (mais EN DONNANT la procédure).
# - Format de réponse : 5 sections structurées avec étapes numérotées.
# - Couples de serrage et références CAT toujours marquées "(à valider sur SIS)"
#   plutôt qu'inventées.
#
SYSTEM_ASK_FR = """Tu es **MineAssist**, expert senior maintenance CAT 994F au site OCP Benguerir.
Tu réponds en français au technicien terrain, en langage technique direct, ACTIONABLE.

CONTEXTE : Site phosphatier ouvert, T° jusqu'à 45°C, poussière, vibrations.
Engin : chargeuse 994F (moteur 3516B, transmission planétaire 4F/3R, VIMS embarqué).
Plan PM : PM250 / PM500 / PM1000 / PM2000.

RÈGLES STRICTES (ne JAMAIS s'en écarter) :

1. **INTERDIT** de dire « la documentation officielle n'a pas été consultée »
   ou « basé sur les connaissances générales » ou toute formulation
   évasive équivalente. Tu DOIS toujours répondre par une procédure utile.

2. **Source du savoir** :
   a) Si le bloc CONTEXT/CONTEXTE ci-dessous contient des chunks `[c1, p.X]`,
      utilise-les EN PRIORITÉ et cite-les exactement (ex: « [c3, p.145] »).
   b) Si CONTEXT vide ou peu pertinent, utilise la **base de connaissances
      embarquée CAT 994F** (procédures, intervalles, EPI). Indique en haut :
      « Procédure générique CAT 994F (manuel SIS à valider). »
   c) JAMAIS inventer un n° de pièce CAT exact, un couple de serrage exact,
      ni un code défaut. Si tu ne connais pas la valeur exacte, écris-la
      « (à valider sur SIS / VIMS) ».

3. **FORMAT** — Réponse en 5 sections, dans cet ordre :
   ## Synthèse
   2-3 lignes : quoi faire, durée estimée, criticité.
   ## Procédure (étapes numérotées)
   1. ... 2. ... 3. ...
   ## Outils & pièces
   - Liste claire (références CAT si certaines, sinon génériques).
   ## Sécurité (EPI / LOTO)
   - EPI obligatoires, consignation, purge pression, refroidissement.
   ## Sources
   - Liste des [chunk_id, p.X] cités OU mention « Base CAT 994F embarquée ».

4. **TOUJOURS** rappeler : EPI complets, consignation LOTO, purge pression
   hydraulique avant ouverture, refroidissement moteur avant intervention.

5. Réponse en français, technique, sans bavardage. Pas d'emoji."""

# Procédures de secours (8 réflexes terrain) — embarquées dans le prompt
# pour que l'IA puisse répondre même si RAG vide. Tous les couples/références
# précises sont marqués « (à valider sur SIS) ».
SYSTEM_ASK_FR += """

BASE DE CONNAISSANCES CAT 994F EMBARQUÉE (utiliser si RAG vide ou faible) :

[FILTRE HYDRAULIQUE — remplacement]
Outillage : clé à filtre, bac récupération 30L, chiffons propres, EPI.
Périodicité : PM1000 (env. 1000 h), ou si delta P > seuil VIMS.
Procédure : 1) Engin sur surface plane, godet au sol, frein de parking, moteur
arrêté. 2) Consignation LOTO, purge pression hydraulique (cycle 5x les vérins
moteur arrêté). 3) Localiser le boîtier filtre principal (côté gauche châssis
sous capot maintenance). 4) Bac sous filtre, dévisser cartouche dans le sens
inverse aiguilles montre. 5) Vérifier joint torique du nouveau filtre (lubrifier
légère huile hyd propre). 6) Visser à la main + 3/4 de tour (ou couple
constructeur sur SIS). 7) Démarrer 5 min au ralenti, contrôler étanchéité,
recompléter niveau réservoir hyd au repère MAX FROID. 8) Compléter carnet
maintenance VIMS. Total ~30-45 min.

[FILTRE À HUILE MOTEUR — remplacement]
Outillage : clé à sangle, bac, EPI. Périodicité : PM250.
Procédure : 1) Vidange préalable (si combinée), sinon huile encore tiède.
2) LOTO, dévisser le filtre vissé sur bloc moteur côté maintenance. 3) Lubrifier
joint neuf, visser à la main + 3/4 tour. 4) Refaire niveau, démarrer 2 min,
vérifier P_huile au tableau VIMS. 5) Couper, attendre 5 min, vérifier niveau.

[FILTRE À AIR — remplacement]
Outillage : EPI, brosse air comprimé. Périodicité : indicateur encrassement
ou PM500 (deux étages : primaire + secondaire).
Procédure : 1) Moteur arrêté, capot ouvert. 2) Détacher clips, sortir cartouche
primaire, ne PAS souffler. 3) Cartouche secondaire : ne remplacer qu'1 fois sur 3.
4) Remettre cartouche neuve sec dans son sens, refermer clips. 5) Reset alarme
encrassement VIMS.

[VIDANGE HUILE MOTEUR]
Périodicité : PM250 (250 h). Capacité ~265 L huile CAT DEO 15W-40 (à vérifier
sur SIS selon climat). Couple bouchon : voir SIS.
Procédure : 1) Moteur tiède, EPI. 2) LOTO. 3) Bac de récup grande capacité.
4) Dévisser bouchon vidange carter. 5) Récupérer toute l'huile (~15 min).
6) Visser bouchon (couple SIS). 7) Remplir avec capacité préconisée.
8) Démarrer, vérifier témoin pression, couper, contrôler niveau.
9) Fiche entretien VIMS + cuve d'usage.

[VIDANGE TRANSMISSION + FILTRE]
Périodicité : PM2000. Huile CAT TDTO 30 (à valider). Capacité ~60 L (SIS).
Procédure : engin chaud, bac, dévisser bouchon de vidange transmission, attendre
écoulement complet, remplacer cartouche filtre transmission au passage,
remplir + cycle test 5 min.

[VIDANGE HYDRAULIQUE]
Périodicité : PM2000 ou analyse huile mauvaise. Capacité ~330 L huile CAT HYDO
Advanced (à valider SIS). Toujours combiner avec remplacement filtre principal
et reniflard.

[REMPLACEMENT COURROIE ALTERNATEUR]
Outillage : clé tendeur, EPI. Périodicité : inspection PM500, remplacement
si fissures, brillance ou allongement > limite.
Procédure : moteur froid, LOTO. Détendre tendeur automatique, sortir courroie
ancienne, comparer avec neuve, monter neuve en respectant le routage (schéma
sur capot moteur), libérer tendeur, vérifier alignement poulies, démarrer
2 min puis recontrôler tension.

[CONTRÔLE PRESSION PNEUS]
Manomètre étalonné. Pression de service : ~700 kPa avant / ~700 kPa arrière
(à valider charge réelle godet sur SIS). Toujours à FROID. Vérifier valves,
état flancs (coupures, hernies), profondeur sculpture (>= 25% reste).
Reporter valeurs sur fiche tournée pneumatique.

⚠ Tous les couples de serrage exacts, capacités exactes, références CAT exactes
DOIVENT être validés sur le manuel SIS / VIMS de l'engin avant intervention.
"""


SYSTEM_ASK_EN = """You are **MineAssist**, senior maintenance expert for the CAT 994F at OCP Benguerir site.
Answer the technician in direct, field-actionable technical English.

CONTEXT: Open-pit phosphate mine, up to 45°C, dust, vibrations.
Equipment: 994F loader (3516B engine, planetary 4F/3R transmission, VIMS).
PM plan: PM250 / PM500 / PM1000 / PM2000.

STRICT RULES (never deviate):

1. **FORBIDDEN** to say "official documentation was not consulted" or "based on
   general knowledge". You MUST always provide an actionable answer.

2. **Knowledge source**:
   a) If the CONTEXT block below contains chunks `[c1, p.X]`, use them FIRST
      and cite exactly (e.g. "[c3, p.145]").
   b) If CONTEXT is empty or weakly relevant, use the **embedded CAT 994F
      knowledge base** (procedures, intervals, PPE). Open with: "Generic CAT
      994F procedure (validate on SIS manual)."
   c) NEVER invent an exact CAT part number, exact torque value, or fault code.
      If you don't know the exact value, write "(validate on SIS / VIMS)".

3. **FORMAT** — Answer in 5 sections, in this order:
   ## Summary
   2-3 lines: what to do, estimated time, criticality.
   ## Procedure (numbered steps)
   1. ... 2. ... 3. ...
   ## Tools & parts
   - Clear list (CAT part numbers if certain, generic otherwise).
   ## Safety (PPE / LOTO)
   - Required PPE, lockout/tagout, pressure release, cooldown.
   ## Sources
   - List of [chunk_id, p.X] cited OR "Embedded CAT 994F knowledge base".

4. **ALWAYS** remind: full PPE, LOTO lockout, hydraulic pressure release before
   opening, engine cooldown before service.

5. Technical, no fluff, no emoji. Keep CAT part numbers and fault codes
   (CID/MID/FMI) in English.

EMBEDDED CAT 994F KNOWLEDGE (use if RAG empty/weak):

[HYDRAULIC FILTER replacement]
Tools: filter wrench, 30L drain pan, clean rags, PPE.
Interval: PM1000 (~1000 h) or if VIMS delta-P alarm.
Procedure: 1) Park flat, bucket down, parking brake, engine OFF. 2) LOTO,
relieve hydraulic pressure (cycle 5x cylinders engine off). 3) Locate main
filter housing (left chassis under maintenance hood). 4) Drain pan under
filter, unscrew cartridge counter-clockwise. 5) Inspect O-ring of new filter
(lightly oil with clean hyd oil). 6) Hand-tighten + 3/4 turn (or OEM torque
on SIS). 7) Start 5 min idle, check leaks, top up reservoir to MAX-COLD.
8) Update VIMS log. Total ~30-45 min.

[ENGINE OIL FILTER replacement] PM250. Strap wrench, drain pan, PPE.
Drain prior or with engine warm. Lube new gasket, hand + 3/4 turn. Top up,
start 2 min, check oil pressure on VIMS. Stop, wait 5 min, recheck level.

[AIR FILTER replacement] PM500 or restriction indicator. Two stages
(primary + secondary). Replace primary, do NOT clean. Secondary every 3rd time.

[ENGINE OIL CHANGE] PM250 (~250 h). ~265 L CAT DEO 15W-40 (verify on SIS).

[TRANSMISSION OIL CHANGE + FILTER] PM2000. CAT TDTO 30, ~60 L (SIS).

[HYDRAULIC OIL CHANGE] PM2000 or bad oil analysis. ~330 L CAT HYDO Advanced.

[ALTERNATOR BELT] PM500 inspect, replace if cracks/glaze/elongation.

[TIRE PRESSURE CHECK] Cold pressure, ~700 kPa front/rear (validate per real
load on SIS). Check valves, sidewalls, tread depth (>= 25% remaining).

⚠ All exact torque, capacity, and CAT part numbers MUST be validated on the
SIS / VIMS manual before service.
"""


SYSTEM_ASK_AR = """أنت **MineAssist**، خبير صيانة محترف في معدات CAT 994F بموقع OCP بنجرير (المغرب).
أجب الفني بلغة تقنية مباشرة وقابلة للتطبيق ميدانياً.

السياق: منجم فوسفات مفتوح، حرارة تصل 45°م، غبار واهتزازات.
المعدة: محملة 994F (محرك 3516B، علبة تروس كوكبية 4F/3R، نظام VIMS).
خطة الصيانة: PM250 / PM500 / PM1000 / PM2000.

قواعد صارمة (لا تخالفها أبداً):

1. **ممنوع** قول "لم يتم الرجوع للوثائق الرسمية" أو "بناء على المعرفة العامة".
   يجب دائماً تقديم إجابة عملية قابلة للتنفيذ.

2. **مصدر المعرفة**:
   أ) إذا احتوى السياق على [c1, p.X] استخدمها أولاً واقتبسها بدقة [c3, p.145].
   ب) إذا كان السياق فارغاً أو ضعيفاً، استخدم قاعدة المعرفة CAT 994F المضمّنة
      أدناه. ابدأ الإجابة بـ: "إجراء عام لـ CAT 994F (يتم التحقق منه على دليل SIS)".
   ج) لا تختلق رقم قطعة CAT دقيق ولا عزم ربط دقيق ولا رمز عطل. إذا لم تعرف
      القيمة الدقيقة، اكتب "(يُحقَّق على SIS / VIMS)".

3. **الشكل** — إجابة مكوّنة من 5 أقسام بالترتيب التالي:
   ## ملخص
   2-3 أسطر: ماذا نفعل، الوقت المقدر، الخطورة.
   ## الإجراء (خطوات مرقمة)
   1. ... 2. ... 3. ...
   ## أدوات وقطع
   - قائمة واضحة (أرقام قطع CAT إن كانت مؤكدة).
   ## السلامة (EPI / LOTO)
   - معدات الحماية، إقفال LOTO، تفريغ الضغط، التبريد.
   ## المصادر
   - [chunk_id, p.X] المقتبسة أو "قاعدة المعرفة CAT 994F المضمّنة".

4. **دائماً** ذكّر: معدات حماية كاملة، إقفال LOTO، تفريغ الضغط الهيدروليكي قبل
   الفتح، تبريد المحرك قبل التدخل.

5. لغة تقنية مباشرة، بدون رموز تعبيرية. احتفظ بأرقام القطع ورموز الأعطال
   (CID/MID/FMI) بالإنجليزية.

قاعدة المعرفة المضمّنة CAT 994F (استخدمها إذا كان RAG فارغاً أو ضعيفاً):

[تغيير الفلتر الهيدروليكي] PM1000. أدوات: مفتاح فلتر، حوض 30L، خرق نظيفة، EPI.
الإجراء: 1) أوقف الآلة على سطح مستوٍ، أنزل الجرافة، كبح وقفي، أطفئ المحرك.
2) LOTO، فرّغ الضغط الهيدروليكي. 3) حدد علبة الفلتر الرئيسية. 4) ضع الحوض،
فُك الخرطوش عكس عقارب الساعة. 5) افحص حلقة الجوان للفلتر الجديد (شحم بزيت
نظيف). 6) ربط يدوي + 3/4 لفة (أو عزم SIS). 7) شغّل 5 دقائق، افحص التسرب،
أعد ملء خزان الزيت إلى MAX-COLD. 8) سجل في VIMS. الوقت ~30-45 د.

[فلتر زيت المحرك] PM250.
[فلتر الهواء] PM500.
[تغيير زيت المحرك] PM250 (~265L CAT DEO 15W-40 — يحقق على SIS).
[تغيير زيت علبة التروس + فلتر] PM2000 (~60L CAT TDTO 30).
[تغيير الزيت الهيدروليكي] PM2000 (~330L CAT HYDO Advanced).

⚠ جميع عزوم الربط الدقيقة وكميات الزيت وأرقام قطع CAT الدقيقة يجب التحقق منها
على دليل SIS / VIMS قبل التدخل.
"""

PROMPTS_BY_LANG: Dict[str, str] = {
    "fr": SYSTEM_ASK_FR,
    "en": SYSTEM_ASK_EN,
    "ar": SYSTEM_ASK_AR,
}


# ─── Modèles Pydantic ─────────────────────────────────────────────────────────
class AskV2Request(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    include_images: bool = False
    language: Literal["fr", "en", "ar", "auto"] = "auto"
    previous_messages: List[Dict[str, str]] = Field(default_factory=list)
    """Format : [{"role": "user"|"assistant", "content": "..."}]"""


class DiagnoseV2Request(BaseModel):
    fault_code: Optional[str] = None
    symptoms: List[str] = Field(default_factory=list)
    gmao_context: Optional[str] = None
    hours_since_maintenance: Optional[int] = None
    ml_signals: Optional[Dict[str, Any]] = None
    """{rul_h: float, alert_class: str, iso_score: float, top_capteurs_anomalie: [str]}"""
    language: Literal["fr", "en", "ar", "auto"] = "auto"


class FeedbackRequest(BaseModel):
    answer_id: str = Field(..., max_length=64)
    rating: Literal["up", "down"]
    comment: Optional[str] = Field(None, max_length=1000)
    user: Optional[str] = Field(None, max_length=64)


# ─── Logging structuré JSON ──────────────────────────────────────────────────
def setup_json_logger():
    """
    Configure un logger JSON pour les événements applicatifs.
    Compatible Loki/CloudWatch/Datadog/ELK.
    """
    handler = logging.StreamHandler()

    class JsonFormatter(logging.Formatter):
        def format(self, record):
            data = {
                "ts": datetime.utcnow().isoformat() + "Z",
                "level": record.levelname,
                "logger": record.name,
                "msg": record.getMessage(),
            }
            if hasattr(record, "extra_data"):
                data.update(record.extra_data)
            return json.dumps(data, ensure_ascii=False)

    handler.setFormatter(JsonFormatter())
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


def log_event(event: str, **kwargs):
    """Log un événement structuré."""
    record = logger.makeRecord(
        logger.name, logging.INFO, "", 0, event, (), None,
    )
    record.extra_data = kwargs
    logger.handle(record)


# ─── Stockage feedback ───────────────────────────────────────────────────────
_FEEDBACK_FILE = Path(__file__).resolve().parent.parent / "data" / "feedback.jsonl"
_FEEDBACK_LOCK = threading.Lock()


def _save_feedback(req: FeedbackRequest):
    _FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    line = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "answer_id": req.answer_id,
        "rating": req.rating,
        "comment": req.comment,
        "user": req.user,
    }
    with _FEEDBACK_LOCK:
        with _FEEDBACK_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")


# ─── Enregistrement des routes additionnelles ─────────────────────────────────
def register_improvements(app: FastAPI):
    """
    À appeler à la fin de api.py :
        from app.improvements import register_improvements
        register_improvements(app)
    """
    setup_json_logger()
    log_event("improvements_loaded", version="sprint1+2", date="2026-05-01")

    # Récupère les imports de api.py de manière paresseuse
    def _get_api():
        from app import api as _api
        return _api

    # ────────────── /healthz ──────────────
    @app.get("/healthz", tags=["Monitoring"])
    def healthz():
        """Liveness probe — l'app répond ?"""
        return {
            "status": "ok",
            "ts": datetime.utcnow().isoformat() + "Z",
            "service": "mineassist",
        }

    # ────────────── /readyz ──────────────
    @app.get("/readyz", tags=["Monitoring"])
    def readyz():
        """Readiness probe — modèles + RAG + clé API prêts ?"""
        api = _get_api()
        checks = {}
        try:
            from app.ocp.routers.rul_router import _models, load_rul_models
            try:
                load_rul_models()
            except Exception:
                pass
            checks["rul_models"] = bool(_models) and len(_models) >= 4
        except Exception as e:
            checks["rul_models"] = False
            checks["rul_models_error"] = str(e)[:120]

        try:
            checks["rag_index"] = (
                hasattr(api, "rag")
                and api.rag is not None
                and api.rag.collection is not None
            )
        except Exception:
            checks["rag_index"] = False

        checks["openrouter_key"] = bool(getattr(api, "OPENROUTER_API_KEY", None))

        all_ok = all(v is True for k, v in checks.items() if not k.endswith("_error"))
        status_code = 200 if all_ok else 503
        return JSONResponse(
            content={
                "ready": all_ok,
                "checks": checks,
                "ts": datetime.utcnow().isoformat() + "Z",
            },
            status_code=status_code,
        )

    # ────────────── /ask/v2 ──────────────
    @app.post("/ask/v2", tags=["Ask"])
    def ask_v2(req: AskV2Request, request: Request):
        """
        Version améliorée de /ask :
          - Détection automatique de langue (FR/EN/AR)
          - Mémoire conversationnelle (previous_messages)
          - Rate limit 15 req/min/user
          - Logging structuré
        """
        if not _rate_check(_rate_key(request), limit_per_minute=15):
            raise HTTPException(429, detail="Trop de requêtes. Patientez 1 minute.")

        api = _get_api()
        if not api.OPENROUTER_API_KEY:
            raise HTTPException(503, detail="OPENROUTER_API_KEY manquante.")

        t0 = time.time()
        lang = _detect_lang(req.question) if req.language == "auto" else req.language
        system_prompt = PROMPTS_BY_LANG.get(lang, SYSTEM_ASK_FR)

        try:
            context, sources = api.rag.build_context(
                query=req.question,
                top_k=api.TOP_K,
                max_chars=api.MAX_CHARS_CONTEXT,
            )
        except Exception as e:
            log_event("rag_error", error=str(e))
            context, sources = "", []

        has_ctx = bool(context.strip())
        ctx_block = f"\n\n---\nCONTEXT / CONTEXTE:\n{context}" if has_ctx else ""
        if not has_ctx:
            # PAS de bail-out — au contraire, on FORCE l'utilisation de la base
            # CAT 994F embarquée dans le system prompt et on demande une
            # procédure structurée complète.
            note = {
                "fr": "\n\n(IMPORTANT : la recherche RAG n'a pas trouvé de chunk pertinent. "
                      "Ne dis JAMAIS « documentation non consultée ». À la place, fournis une "
                      "PROCÉDURE STRUCTURÉE COMPLÈTE en utilisant la BASE DE CONNAISSANCES "
                      "CAT 994F EMBARQUÉE dans ton prompt système. Commence par : "
                      "« Procédure générique CAT 994F (à valider sur SIS / VIMS). » "
                      "puis donne les 5 sections : Synthèse, Procédure, Outils, Sécurité, Sources.)",
                "en": "\n\n(IMPORTANT: RAG search returned no relevant chunks. NEVER say "
                      "'documentation not consulted'. Instead, provide a COMPLETE STRUCTURED "
                      "PROCEDURE using the EMBEDDED CAT 994F KNOWLEDGE BASE in your system "
                      "prompt. Start with: 'Generic CAT 994F procedure (validate on SIS / VIMS).' "
                      "then deliver the 5 sections: Summary, Procedure, Tools, Safety, Sources.)",
                "ar": "\n\n(مهم: لم يجد البحث RAG أي مقاطع ذات صلة. لا تقل أبداً «لم يتم الرجوع "
                      "للوثائق». بدلاً من ذلك، قدم إجراءً منظماً كاملاً باستخدام قاعدة المعرفة "
                      "CAT 994F المضمّنة في برومبت النظام. ابدأ بـ: «إجراء عام لـ CAT 994F "
                      "(يُحقَّق على SIS / VIMS).» ثم قدم الأقسام الخمسة.)",
            }
            system_prompt = system_prompt + note.get(lang, note["fr"])

        # Construire messages avec mémoire
        messages = [{"role": "system", "content": system_prompt}]
        for prev in (req.previous_messages or [])[-4:]:
            if prev.get("role") in ("user", "assistant") and prev.get("content"):
                messages.append({"role": prev["role"], "content": str(prev["content"])[:2000]})
        messages.append({"role": "user", "content": f"{req.question}{ctx_block}"})

        try:
            client = api.get_llm_client()
            resp = client.chat.completions.create(
                model=api.OPENROUTER_MODEL,
                messages=messages,
                temperature=0.1,
                max_tokens=4000,
            )
            answer = resp.choices[0].message.content or ""
        except Exception as e:
            log_event("llm_error", error=str(e), lang=lang)
            raise HTTPException(500, detail=f"LLM error: {str(e)[:300]}")

        latency_ms = int((time.time() - t0) * 1000)
        log_event("ask_v2_ok", lang=lang, has_ctx=has_ctx, latency_ms=latency_ms,
                  q_len=len(req.question), a_len=len(answer))

        # Génération answer_id pour feedback
        import hashlib
        answer_id = hashlib.sha1(
            f"{req.question}{answer[:200]}{t0}".encode("utf-8")
        ).hexdigest()[:16]

        return {
            "answer_id": answer_id,
            "question": req.question,
            "answer": answer,
            "sources": sources,
            "language_detected": lang,
            "latency_ms": latency_ms,
        }

    # ────────────── /ask/stream ──────────────
    @app.post("/ask/stream", tags=["Ask"])
    def ask_stream(req: AskV2Request, request: Request):
        """
        Streaming SSE — le LLM streame les tokens dès qu'ils arrivent.
        Effet "ChatGPT" : le texte apparaît au fur et à mesure.

        Format SSE :
          data: {"delta": "le texte"}\n\n
          data: {"delta": "suivant"}\n\n
          data: [DONE]\n\n
        """
        if not _rate_check(_rate_key(request), limit_per_minute=10):
            raise HTTPException(429, detail="Trop de requêtes en streaming.")

        api = _get_api()
        if not api.OPENROUTER_API_KEY:
            raise HTTPException(503, detail="OPENROUTER_API_KEY manquante.")

        lang = _detect_lang(req.question) if req.language == "auto" else req.language
        system_prompt = PROMPTS_BY_LANG.get(lang, SYSTEM_ASK_FR)

        try:
            context, sources = api.rag.build_context(
                query=req.question,
                top_k=api.TOP_K,
                max_chars=api.MAX_CHARS_CONTEXT,
            )
        except Exception:
            context, sources = "", []

        has_ctx = bool(context.strip())
        ctx_block = f"\n\n---\nCONTEXT:\n{context}" if has_ctx else ""
        if not has_ctx:
            # Même garde-fou que /ask/v2 : interdiction de bail-out, on force
            # l'utilisation de la base CAT 994F embarquée.
            note_stream = {
                "fr": "\n\n(IMPORTANT : pas de chunk RAG trouvé. NE DIS PAS « documentation "
                      "non consultée ». Utilise la BASE CAT 994F EMBARQUÉE et donne une "
                      "procédure complète en 5 sections.)",
                "en": "\n\n(IMPORTANT: no RAG chunk found. DO NOT say 'documentation not "
                      "consulted'. Use the EMBEDDED CAT 994F base and give a complete "
                      "5-section procedure.)",
                "ar": "\n\n(مهم: لم يُعثر على مقاطع RAG. لا تقل «لم تُستشار الوثائق». استخدم "
                      "قاعدة CAT 994F المضمّنة وقدم إجراءً كاملاً في 5 أقسام.)",
            }
            system_prompt = system_prompt + note_stream.get(lang, note_stream["fr"])

        messages = [{"role": "system", "content": system_prompt}]
        for prev in (req.previous_messages or [])[-4:]:
            if prev.get("role") in ("user", "assistant") and prev.get("content"):
                messages.append({"role": prev["role"], "content": str(prev["content"])[:2000]})
        messages.append({"role": "user", "content": f"{req.question}{ctx_block}"})

        def event_stream():
            # Préambule : sources (le client peut afficher pendant que le texte arrive)
            yield f"data: {json.dumps({'event': 'sources', 'sources': sources, 'lang': lang}, ensure_ascii=False)}\n\n"
            try:
                client = api.get_llm_client()
                stream = client.chat.completions.create(
                    model=api.OPENROUTER_MODEL,
                    messages=messages,
                    temperature=0.1,
                    max_tokens=4000,
                    stream=True,
                )
                for chunk in stream:
                    try:
                        delta = chunk.choices[0].delta.content or ""
                    except Exception:
                        delta = ""
                    if delta:
                        yield f"data: {json.dumps({'delta': delta}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                err = str(e)[:200]
                yield f"data: {json.dumps({'error': err}, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    # ────────────── /diagnose/v2 ──────────────
    @app.post("/diagnose/v2", tags=["Diagnose"])
    def diagnose_v2(req: DiagnoseV2Request, request: Request):
        """
        Diagnose enrichi avec signaux ML actuels (RUL, score Isolation Forest,
        capteurs hors plage). Le LLM priorise alors les causes du sous-système
        le plus à risque.
        """
        if not _rate_check(_rate_key(request), limit_per_minute=20):
            raise HTTPException(429, detail="Trop de requêtes.")

        api = _get_api()
        if not api.OPENROUTER_API_KEY:
            raise HTTPException(503, detail="OPENROUTER_API_KEY manquante.")

        # Récupération des signaux ML automatiques si non fournis
        ml_signals = req.ml_signals or {}
        if not ml_signals:
            try:
                from app.ocp.routers.rul_router import alert_class_now
                snapshot = alert_class_now()
                ml_signals = {
                    "rul_h": snapshot.get("rul_h"),
                    "alert_class": snapshot.get("alerte_globale"),
                }
            except Exception:
                pass

        lang_q_text = (req.fault_code or "") + " " + " ".join(req.symptoms or [])
        lang = _detect_lang(lang_q_text) if req.language == "auto" else req.language
        system_prompt = PROMPTS_BY_LANG.get(lang, SYSTEM_ASK_FR)

        ml_block = ""
        if ml_signals:
            ml_block = "\n\n## Signaux ML actuels\n"
            if ml_signals.get("rul_h") is not None:
                ml_block += f"- RUL global : {ml_signals['rul_h']} h\n"
            if ml_signals.get("alert_class"):
                ml_block += f"- Classe d'alerte : {ml_signals['alert_class']}\n"
            if ml_signals.get("iso_score") is not None:
                ml_block += f"- Score anomalie (Isolation Forest) : {ml_signals['iso_score']}\n"
            top = ml_signals.get("top_capteurs_anomalie") or []
            if top:
                ml_block += f"- Capteurs hors plage : {', '.join(top)}\n"
            ml_block += "→ Priorise tes hypothèses sur le sous-système correspondant.\n"

        user_prompt = "## Diagnose request\n"
        if req.fault_code:
            user_prompt += f"- Fault code : {req.fault_code}\n"
        if req.symptoms:
            user_prompt += "- Symptoms : " + ", ".join(req.symptoms) + "\n"
        if req.gmao_context:
            user_prompt += f"- GMAO context : {req.gmao_context}\n"
        if req.hours_since_maintenance is not None:
            user_prompt += f"- Hours since last maintenance : {req.hours_since_maintenance}\n"
        user_prompt += ml_block

        try:
            client = api.get_llm_client()
            resp = client.chat.completions.create(
                model=api.OPENROUTER_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=3000,
            )
            answer = resp.choices[0].message.content or ""
        except Exception as e:
            raise HTTPException(500, detail=f"LLM error: {str(e)[:300]}")

        return {
            "answer": answer,
            "ml_signals_used": ml_signals,
            "language_detected": lang,
        }

    # ────────────── /feedback ──────────────
    @app.post("/feedback", tags=["Feedback"])
    def feedback(req: FeedbackRequest):
        """Enregistre un feedback utilisateur (👍/👎) sur une réponse."""
        try:
            _save_feedback(req)
            log_event("feedback_received", rating=req.rating, answer_id=req.answer_id)
            return {"saved": True}
        except Exception as e:
            raise HTTPException(500, detail=f"Erreur enregistrement feedback : {e}")

    @app.get("/feedback/stats", tags=["Feedback"])
    def feedback_stats():
        """Statistiques des feedbacks reçus."""
        if not _FEEDBACK_FILE.exists():
            return {"total": 0, "up": 0, "down": 0, "ratio_up": None}
        up, down, total = 0, 0, 0
        try:
            with _FEEDBACK_FILE.open("r", encoding="utf-8") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                        total += 1
                        if d.get("rating") == "up":
                            up += 1
                        elif d.get("rating") == "down":
                            down += 1
                    except Exception:
                        pass
        except Exception:
            pass
        return {
            "total": total,
            "up": up,
            "down": down,
            "ratio_up": (up / total) if total else None,
        }

    log_event("improvements_routes_registered",
              routes=["/healthz", "/readyz", "/ask/v2", "/ask/stream",
                      "/diagnose/v2", "/feedback", "/feedback/stats"])
