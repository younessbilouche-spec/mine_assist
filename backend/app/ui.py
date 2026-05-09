import streamlit as st
import requests
import pandas as pd
from datetime import datetime
from typing import Any, Dict, List, Optional

API_URL = "http://127.0.0.1:8000"
REQUEST_TIMEOUT = 60

st.set_page_config(
    page_title="MineAssist 994F · OCP",
    page_icon="⛏️",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Chakra+Petch:wght@400;500;600;700&display=swap');

    :root {
        --ocp-green: #11874b;
        --ocp-green-dark: #0c6b3c;
        --ocp-green-soft: #e3eddc;
        --ocp-gold: #c88f1e;
        --ocp-gold-soft: #efe1b8;
        --paper: #f4efdf;
        --paper-2: #eee7d2;
        --paper-3: #f8f4e8;
        --ink: #5f6058;
        --muted: #9f9887;
        --line: #cfbf96;
        --line-soft: #ded4bc;
        --danger: #c55a42;
        --danger-soft: #f7e6e0;
    }

    html, body, [class*="css"] {
        font-family: 'Rajdhani', sans-serif;
        background: var(--paper) !important;
        color: var(--ink) !important;
    }

    .stApp {
        background:
            radial-gradient(circle at 1px 1px, rgba(170, 150, 96, 0.09) 1px, transparent 0),
            linear-gradient(180deg, #f7f2e4 0%, #f3ecd9 100%);
        background-size: 24px 24px, 100% 100%;
    }

    .block-container {
        max-width: 1400px;
        padding-top: 0.55rem;
        padding-bottom: 2rem;
    }

    h1, h2, h3, h4, h5, h6, p, div, span, label {
        color: var(--ink) !important;
    }

    [data-testid="stSidebar"] { display: none; }

    .topbar {
        background: rgba(247, 241, 225, 0.96);
        border-bottom: 2px solid var(--ocp-green);
        padding: 10px 22px 8px 22px;
        margin: -0.55rem -1rem 0.75rem -1rem;
        position: sticky;
        top: 0;
        z-index: 100;
        backdrop-filter: blur(6px);
    }

    .topbar-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        flex-wrap: wrap;
    }

    .brand-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .ocp-box {
        background: var(--ocp-green);
        color: #fff !important;
        font-family: 'Chakra Petch', sans-serif;
        font-size: 0.72rem;
        font-weight: 700;
        padding: 4px 9px;
        border-radius: 2px;
        letter-spacing: 0.12em;
        line-height: 1;
    }

    .brand-title {
        font-family: 'Chakra Petch', sans-serif;
        font-size: 1.12rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        color: #454540 !important;
        line-height: 1;
    }

    .brand-sub {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.22em;
        color: #a49b88 !important;
        margin-top: 3px;
    }

    .live-state {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.64rem;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted) !important;
        white-space: nowrap;
    }

    .live-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #61b486;
        margin-right: 7px;
        box-shadow: 0 0 0 4px rgba(97,180,134,0.12);
        vertical-align: middle;
    }

    .alert-banner {
        background: var(--danger-soft);
        border: 1px solid #e4b9ad;
        border-left: 4px solid var(--danger);
        padding: 10px 14px;
        margin: 8px 0 14px 0;
    }

    .alert-title {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.6rem;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        color: #b55240 !important;
        font-weight: 600;
    }

    .alert-text {
        margin-top: 4px;
        font-size: 0.9rem;
        color: #846b62 !important;
    }

    .metric-panel {
        background: rgba(255,255,255,0.28);
        border: 1px solid var(--line);
        border-top: 2px solid var(--ocp-gold);
        padding: 12px 15px 10px 15px;
        min-height: 94px;
    }

    .metric-panel.green { border-top-color: var(--ocp-green); }
    .metric-panel.red { border-top-color: var(--danger); }
    .metric-panel.gold { border-top-color: var(--ocp-gold); }

    .metric-label {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.54rem;
        text-transform: uppercase;
        letter-spacing: 0.24em;
        color: #b2a68a !important;
        margin-bottom: 12px;
    }

    .metric-value {
        font-family: 'Chakra Petch', sans-serif;
        font-size: 1.95rem;
        line-height: 1;
        font-weight: 700;
        color: var(--ocp-green) !important;
    }

    .metric-value.red { color: #c35a44 !important; }
    .metric-value.gold { color: #bf8920 !important; }

    .metric-sub {
        margin-top: 8px;
        font-size: 0.68rem;
        color: #b0a587 !important;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .panel {
        background: rgba(255,255,255,0.28);
        border: 1px solid var(--line);
        padding: 12px 14px;
    }

    .panel-title {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.24em;
        color: #a29373 !important;
        margin-bottom: 10px;
        font-weight: 500;
    }

    .compare-card-green {
        border-left: 3px solid var(--ocp-green);
        background: #edf5ec;
        padding: 12px 14px;
        margin-bottom: 10px;
    }

    .compare-card-gold {
        border-left: 3px solid var(--ocp-gold);
        background: #fbf2df;
        padding: 12px 14px;
    }

    .compare-title {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.6rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-weight: 700;
    }

    .compare-text {
        margin-top: 6px;
        color: #6a6a63 !important;
        font-size: 0.9rem;
    }

    .stTabs [data-baseweb="tab-list"] {
        gap: 4px;
        background: transparent;
        border-bottom: 1px solid var(--line);
        padding-bottom: 5px;
        margin-bottom: 10px;
    }

    .stTabs [data-baseweb="tab"] {
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px 4px 0 0;
        padding: 8px 15px;
        color: #8e8777 !important;
        font-family: 'Chakra Petch', sans-serif;
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.09em;
        font-weight: 600;
    }

    .stTabs [aria-selected="true"] {
        background: #dfe7d8 !important;
        border-color: #c5d0c0 !important;
        color: var(--ocp-green) !important;
    }

    .stTextInput > div > div,
    .stNumberInput > div > div,
    .stTextArea textarea,
    .stSelectbox > div > div {
        background: rgba(255,255,255,0.25) !important;
        border: 1px solid var(--line) !important;
        border-radius: 0 !important;
        color: var(--ink) !important;
        font-family: 'Rajdhani', sans-serif !important;
    }

    .stTextArea textarea { min-height: 110px !important; }

    .stButton > button {
        background: var(--ocp-green) !important;
        color: white !important;
        border: none !important;
        border-radius: 2px !important;
        font-family: 'Chakra Petch', sans-serif !important;
        text-transform: uppercase !important;
        letter-spacing: 0.14em !important;
        font-size: 0.7rem !important;
        font-weight: 700 !important;
        padding: 0.62rem 1rem !important;
        box-shadow: none !important;
    }

    .stButton > button:hover {
        background: var(--ocp-green-dark) !important;
    }

    .stAlert {
        border-radius: 0 !important;
        border: 1px solid var(--line) !important;
    }

    .source-chip {
        display: inline-block;
        padding: 5px 9px;
        margin: 4px 5px 0 0;
        background: #e4efe1;
        border: 1px solid #c9dbc8;
        font-size: 0.68rem;
        color: var(--ocp-green) !important;
        font-family: 'IBM Plex Mono', monospace;
    }

    .answer-box {
        background: rgba(255,255,255,0.26);
        border: 1px solid var(--line);
        border-left: 3px solid var(--ocp-gold);
        padding: 14px;
    }

    .footer-note {
        margin-top: 24px;
        text-align: center;
        font-size: 0.68rem;
        color: #9d9787 !important;
        font-family: 'IBM Plex Mono', monospace;
        text-transform: uppercase;
        letter-spacing: 0.12em;
    }

    .small-cap {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: #9a9075 !important;
    }

    .mini-note {
        font-size: 0.78rem;
        color: #8e8677 !important;
    }

    .stDataFrame, .stTable {
        border: 1px solid var(--line-soft) !important;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_data(ttl=20)
def api_get(endpoint: str) -> Optional[Dict[str, Any]]:
    try:
        r = requests.get(f"{API_URL}{endpoint}", timeout=REQUEST_TIMEOUT)
        if r.status_code == 200:
            return r.json()
        return {"_error": f"HTTP {r.status_code}", "_text": r.text}
    except Exception as e:
        return {"_error": str(e)}


def api_post(endpoint: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        r = requests.post(f"{API_URL}{endpoint}", json=payload, timeout=REQUEST_TIMEOUT)
        if r.status_code == 200:
            return r.json()
        return {"_error": f"HTTP {r.status_code}", "_text": r.text}
    except Exception as e:
        return {"_error": str(e)}


def health_status() -> Dict[str, Any]:
    return api_get("/health") or {"_error": "API inaccessible"}


def gmao_stats() -> Dict[str, Any]:
    return api_get("/gmao/stats") or {"_error": "Stats indisponibles"}


def gmao_params_stats() -> Dict[str, Any]:
    return api_get("/gmao/params-stats") or {"_error": "Stats capteurs indisponibles"}


def notif_thresholds() -> Dict[str, Any]:
    return api_get("/notifications/seuils") or {"_error": "Notifications non branchées"}


def notif_test() -> Dict[str, Any]:
    return api_get("/notifications/test") or {"_error": "Test notifications indisponible"}


def render_sources(sources: List[str]):
    if not sources:
        st.info("Aucune source documentaire utilisée.")
        return
    chips = "".join([f'<span class="source-chip">{s}</span>' for s in sources])
    st.markdown(chips, unsafe_allow_html=True)


def safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def df_from_records(records: List[Dict[str, Any]]) -> pd.DataFrame:
    if not records:
        return pd.DataFrame()
    return pd.DataFrame(records)


def render_metric(label: str, value: str, sub: str, tone: str = "green"):
    value_cls = "metric-value"
    if tone == "red":
        value_cls += " red"
    elif tone == "gold":
        value_cls += " gold"
    st.markdown(
        f"""
        <div class="metric-panel {tone}">
            <div class="metric-label">{label}</div>
            <div class="{value_cls}">{value}</div>
            <div class="metric-sub">{sub}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


health = health_status()
stats = gmao_stats()
params_stats = gmao_params_stats()

st.markdown(
    f"""
    <div class="topbar">
        <div class="topbar-inner">
            <div class="brand-wrap">
                <div class="ocp-box">OCP</div>
                <div>
                    <div class="brand-title">MINEASSIST</div>
                    <div class="brand-sub">CAT 994F · Diagnostic IA · Gestion maintenance</div>
                </div>
            </div>
            <div class="live-state"><span class="live-dot"></span>Système actif · {datetime.now().strftime('%d/%m/%Y %H:%M')}</div>
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)

crit_msg = "Aucune alerte critique en direct"
if isinstance(stats, dict) and not stats.get("_error"):
    g3 = stats.get("critical_g3", [])
    if g3:
        first = g3[0]
        crit_msg = f"{first.get('code', 'Code critique')} — {first.get('occurrences', 0)} occurrences cumulées · intervention prioritaire"

st.markdown(
    f"""
    <div class="alert-banner">
        <div class="alert-title">Alerte critique — intervention requise</div>
        <div class="alert-text">{crit_msg}</div>
    </div>
    """,
    unsafe_allow_html=True,
)

if not stats.get("_error"):
    by_machine = stats.get("by_machine", {})
    by_severity = stats.get("by_severity", {})
    total = safe_int(stats.get("total", 0))
    g3_count = safe_int(by_severity.get(3, 0))
    g2_count = safe_int(by_severity.get(2, 0))
    m1v = str(safe_int(by_machine.get("994F-1", 0)))
    m2v = str(safe_int(by_machine.get("994F-2", 0)))
else:
    total = g3_count = g2_count = 0
    m1v = m2v = "0"

k1, k2, k3, k4 = st.columns(4)
with k1:
    render_metric("Total anomalies", str(total), "Historique consolidé", "green")
with k2:
    render_metric("Gravité critique 3", str(g3_count), "Intervention prioritaire", "red")
with k3:
    render_metric("Gravité élevée 2", str(g2_count), "Niveau élevé", "gold")
with k4:
    render_metric(
        "Machines suivies",
        str(len(stats.get("by_machine", {})) if not stats.get("_error") else 0),
        f"994F-1: {m1v} · 994F-2: {m2v}",
        "green"
    )

st.markdown("")

tab_chat, tab_diag, tab_dashboard, tab_params, tab_surv, tab_system = st.tabs(
    ["💬 Question libre", "🔧 Diagnostic", "📊 GMAO analytics", "📡 Monitoring capteurs", "🚨 Surveillance", "⚙️ Système"]
)

with tab_chat:
    st.markdown('<div class="panel-title">Question technique libre</div>', unsafe_allow_html=True)
    question = st.text_area("", placeholder="Pose ta question technique sur la CAT 994F...", height=120, label_visibility="collapsed")
    ask_btn = st.button("Poser la question", type="primary", key="ask_btn")

    if ask_btn:
        if not question.strip():
            st.warning("Veuillez saisir une question.")
        else:
            with st.spinner("Recherche en cours..."):
                result = api_post("/ask", {"question": question})
            if not result or result.get("_error"):
                st.error("Impossible d'obtenir une réponse.")
            else:
                st.markdown('<div class="panel">', unsafe_allow_html=True)
                st.markdown('<div class="panel-title">Résultat</div>', unsafe_allow_html=True)
                st.markdown(f'<div class="answer-box">{result.get("answer", "Aucune réponse")}</div>', unsafe_allow_html=True)
                st.markdown('<div style="height:8px"></div>', unsafe_allow_html=True)
                st.markdown('<div class="small-cap">Sources documentaires</div>', unsafe_allow_html=True)
                render_sources(result.get("sources", []))
                st.markdown('</div>', unsafe_allow_html=True)

                images = result.get("pdf_images", [])
                if images:
                    st.markdown('<div style="height:10px"></div>', unsafe_allow_html=True)
                    st.markdown('<div class="panel">', unsafe_allow_html=True)
                    st.markdown('<div class="panel-title">Pages du manuel · illustrations extraites</div>', unsafe_allow_html=True)
                    cols = st.columns(min(3, len(images)))
                    for i, item in enumerate(images[:3]):
                        img_b64 = item.get("image_b64")
                        caption = f"{item.get('pdf', '')} · page {item.get('page', '')}"
                        if img_b64:
                            cols[i].image(f"data:image/png;base64,{img_b64}", caption=caption, use_container_width=True)
                    st.markdown('</div>', unsafe_allow_html=True)

with tab_diag:
    st.markdown('<div class="panel-title">Diagnostic assisté de panne</div>', unsafe_allow_html=True)
    st.info("Aide à la décision — consulter le manuel et l'équipe terrain avant intervention.")

    a, b = st.columns(2)
    with a:
        fault_code = st.text_input("Code défaut", placeholder="Ex: MID 036 CID 096 FMI 03")
        hours = st.number_input("Heures depuis maintenance", min_value=0, value=0, step=10)
    with b:
        symptoms_raw = st.text_area("Symptômes observés", placeholder="Perte de puissance moteur\nSystème hydraulique lent", height=120)

    gmao_ctx = st.text_area("Contexte GMAO / historique", placeholder="Interventions récentes, observations terrain...", height=100)
    diag_btn = st.button("Lancer le diagnostic", type="primary", key="diag_btn")

    if diag_btn:
        symptoms_list = [s.strip("-• ").strip() for s in symptoms_raw.splitlines() if s.strip()]
        payload = {
            "fault_code": fault_code or None,
            "symptoms": symptoms_list,
            "gmao_context": gmao_ctx or None,
            "hours_since_maintenance": int(hours) if hours > 0 else None,
        }
        with st.spinner("Analyse du cas..."):
            result = api_post("/diagnose", payload)

        if not result or result.get("_error"):
            st.error("Échec du diagnostic.")
        else:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Résultat du diagnostic</div>', unsafe_allow_html=True)
            st.markdown(f'<div class="answer-box">{result.get("diagnostic", "Aucune réponse")}</div>', unsafe_allow_html=True)
            st.markdown('<div style="height:8px"></div>', unsafe_allow_html=True)
            st.markdown('<div class="small-cap">Sources documentaires</div>', unsafe_allow_html=True)
            render_sources(result.get("sources", []))
            st.markdown('</div>', unsafe_allow_html=True)

            images = result.get("pdf_images", [])
            if images:
                st.markdown('<div style="height:10px"></div>', unsafe_allow_html=True)
                st.markdown('<div class="panel">', unsafe_allow_html=True)
                st.markdown('<div class="panel-title">Pages du manuel · illustrations extraites</div>', unsafe_allow_html=True)
                cols = st.columns(min(3, len(images)))
                for i, item in enumerate(images[:3]):
                    img_b64 = item.get("image_b64")
                    caption = f"{item.get('pdf', '')} · page {item.get('page', '')}"
                    if img_b64:
                        cols[i].image(f"data:image/png;base64,{img_b64}", caption=caption, use_container_width=True)
                st.markdown('</div>', unsafe_allow_html=True)

with tab_dashboard:
    st.markdown('<div class="panel-title">GMAO analytics</div>', unsafe_allow_html=True)

    if stats.get("_error"):
        st.error("Impossible de charger les statistiques GMAO.")
    else:
        monthly = df_from_records(stats.get("monthly", []))
        top_codes = df_from_records(stats.get("top_codes", []))
        by_source = df_from_records(stats.get("by_source", []))
        critical_g3 = df_from_records(stats.get("critical_g3", []))
        by_machine_df = pd.DataFrame({
            "Machine": list(stats.get("by_machine", {}).keys()),
            "Total": list(stats.get("by_machine", {}).values()),
        }) if stats.get("by_machine") else pd.DataFrame()

        r1c1, r1c2 = st.columns([1.1, 0.9])
        with r1c1:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Évolution mensuelle des anomalies</div>', unsafe_allow_html=True)
            if not monthly.empty and {"machine", "month", "count"}.issubset(monthly.columns):
                pivot = monthly.pivot(index="month", columns="machine", values="count").fillna(0)
                st.line_chart(pivot, height=280)
            else:
                st.info("Aucune donnée mensuelle disponible.")
            st.markdown('</div>', unsafe_allow_html=True)

        with r1c2:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Répartition par machine</div>', unsafe_allow_html=True)
            if not by_machine_df.empty:
                st.bar_chart(by_machine_df.set_index("Machine"), height=280)
            else:
                st.info("Aucune donnée machine.")
            st.markdown('</div>', unsafe_allow_html=True)

        st.markdown("")
        r2c1, r2c2 = st.columns([1, 1])
        with r2c1:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Top codes d’anomalie</div>', unsafe_allow_html=True)
            if not top_codes.empty:
                st.dataframe(top_codes, use_container_width=True, height=310)
            else:
                st.info("Aucun top code disponible.")
            st.markdown('</div>', unsafe_allow_html=True)

        with r2c2:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Event vs diagnostic par machine</div>', unsafe_allow_html=True)
            if not by_source.empty and {"machine", "count"}.issubset(by_source.columns):
                chart_df = by_source.groupby("machine", as_index=False)["count"].sum()
                st.bar_chart(chart_df.set_index("machine"), height=310)
            else:
                st.info("Données comparatives indisponibles.")
            st.markdown('</div>', unsafe_allow_html=True)

        st.markdown("")
        r3c1, r3c2 = st.columns([1, 1])
        with r3c1:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Codes critiques G3</div>', unsafe_allow_html=True)
            if not critical_g3.empty:
                st.dataframe(critical_g3, use_container_width=True, height=250)
            else:
                st.info("Aucune criticité G3 disponible.")
            st.markdown('</div>', unsafe_allow_html=True)

        with r3c2:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Analyse comparative</div>', unsafe_allow_html=True)
            top1 = critical_g3.iloc[0]["code"] if not critical_g3.empty and "code" in critical_g3.columns else "code dominant indisponible"
            top1_occ = int(critical_g3.iloc[0]["occurrences"]) if not critical_g3.empty and "occurrences" in critical_g3.columns else 0
            st.markdown(
                f"""
                <div class="compare-card-green">
                    <div class="compare-title" style="color:#116f45 !important;">994F-1 — Analyse</div>
                    <div class="compare-text">Code dominant : <b>{top1}</b>. Volume observé : <b>{top1_occ}</b>. Suivi recommandé sur la machine la plus chargée.</div>
                </div>
                <div class="compare-card-gold">
                    <div class="compare-title" style="color:#af7c15 !important;">994F-2 — Alerte</div>
                    <div class="compare-text">Comparer les anomalies récurrentes, vérifier câblage, communication modules et historique GMAO avant intervention lourde.</div>
                </div>
                """,
                unsafe_allow_html=True,
            )
            st.markdown('</div>', unsafe_allow_html=True)

with tab_params:
    st.markdown('<div class="panel-title">Monitoring capteurs</div>', unsafe_allow_html=True)

    if params_stats.get("_error"):
        st.error("Impossible de charger les données capteurs.")
    else:
        total_mesures = safe_int(params_stats.get("total_mesures", 0))
        nb_parametres = safe_int(params_stats.get("nb_parametres", 0))
        by_machine_params = params_stats.get("by_machine", {})

        p1, p2, p3 = st.columns(3)
        with p1:
            render_metric("Mesures totales", str(total_mesures), "Données capteurs", "green")
        with p2:
            render_metric("Paramètres suivis", str(nb_parametres), "Capteurs actifs", "gold")
        with p3:
            render_metric("Machines", str(len(by_machine_params)), "Sources données", "green")

        st.markdown("")

        r1c1, r1c2 = st.columns(2)
        with r1c1:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Top paramètres (val max)</div>', unsafe_allow_html=True)
            df_max = df_from_records(params_stats.get("top_param_max", []))
            if not df_max.empty:
                st.dataframe(df_max, use_container_width=True, height=320)
            else:
                st.info("Aucune donnée")
            st.markdown('</div>', unsafe_allow_html=True)

        with r1c2:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Top paramètres (moyenne)</div>', unsafe_allow_html=True)
            df_avg = df_from_records(params_stats.get("top_param_avg", []))
            if not df_avg.empty:
                st.dataframe(df_avg, use_container_width=True, height=320)
            else:
                st.info("Aucune donnée")
            st.markdown('</div>', unsafe_allow_html=True)

        st.markdown("")

        r2c1, r2c2 = st.columns([1, 1])
        with r2c1:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Dernière mesure par paramètre</div>', unsafe_allow_html=True)
            df_latest_param = df_from_records(params_stats.get("latest_by_param", []))
            if not df_latest_param.empty:
                st.dataframe(df_latest_param, use_container_width=True, height=350)
            else:
                st.info("Pas de données")
            st.markdown('</div>', unsafe_allow_html=True)

        with r2c2:
            st.markdown('<div class="panel">', unsafe_allow_html=True)
            st.markdown('<div class="panel-title">Répartition par machine</div>', unsafe_allow_html=True)
            if by_machine_params:
                df_machine_params = pd.DataFrame({
                    "Machine": list(by_machine_params.keys()),
                    "Mesures": list(by_machine_params.values()),
                })
                st.bar_chart(df_machine_params.set_index("Machine"), height=350)
            else:
                st.info("Aucune donnée machine")
            st.markdown('</div>', unsafe_allow_html=True)

        st.markdown("")

        st.markdown('<div class="panel">', unsafe_allow_html=True)
        st.markdown('<div class="panel-title">Dernières mesures</div>', unsafe_allow_html=True)
        latest_rows = df_from_records(params_stats.get("latest_rows", []))
        if not latest_rows.empty:
            st.dataframe(latest_rows.head(50), use_container_width=True, height=360)
        else:
            st.info("Pas de données récentes")
        st.markdown('</div>', unsafe_allow_html=True)

with tab_surv:
    st.markdown('<div class="panel-title">Surveillance & notifications</div>', unsafe_allow_html=True)
    s1, s2 = st.columns([1.1, 1])

    with s1:
        st.markdown('<div class="panel">', unsafe_allow_html=True)
        st.markdown('<div class="panel-title">Test manuel</div>', unsafe_allow_html=True)
        st.markdown('<div class="mini-note">Tester l’envoi email / WhatsApp depuis le backend.</div>', unsafe_allow_html=True)
        if st.button("Envoyer une notification de test", key="notif_btn"):
            with st.spinner("Test en cours..."):
                result = notif_test()
            if result.get("_error"):
                st.error("Module notifications indisponible.")
            else:
                st.success(f"Test effectué · email_ok={result.get('email_ok')} · whatsapp_ok={result.get('whatsapp_ok')}")
        st.markdown('</div>', unsafe_allow_html=True)

    with s2:
        st.markdown('<div class="panel">', unsafe_allow_html=True)
        st.markdown('<div class="panel-title">Seuils configurés</div>', unsafe_allow_html=True)
        seuils = notif_thresholds()
        if seuils.get("_error"):
            st.info("Router notifications non encore branché.")
        else:
            st.success(f"{len(seuils)} seuil(s) détecté(s)")
        st.markdown('</div>', unsafe_allow_html=True)

with tab_system:
    st.markdown('<div class="panel-title">État du système</div>', unsafe_allow_html=True)
    sy1, sy2 = st.columns(2)

    with sy1:
        st.markdown('<div class="panel">', unsafe_allow_html=True)
        st.markdown('<div class="panel-title">Health API</div>', unsafe_allow_html=True)
        if health.get("_error"):
            st.error(health.get("_error"))
        else:
            st.json(health)
        st.markdown('</div>', unsafe_allow_html=True)

    with sy2:
        st.markdown('<div class="panel">', unsafe_allow_html=True)
        st.markdown('<div class="panel-title">Guide rapide</div>', unsafe_allow_html=True)
        st.markdown(
            """
            - lancer le backend FastAPI sur `8000`
            - lancer l’indexation via `POST /index-documents`
            - vérifier `OPENROUTER_API_KEY`
            - utiliser `gmao/anomalies` pour le dashboard maintenance
            - utiliser `gmao/capteurs` pour le monitoring capteurs
            - utiliser l’onglet Surveillance pour tester les alertes
            """
        )
        st.markdown('</div>', unsafe_allow_html=True)

st.markdown(
    """
    <div class="footer-note">
        MineAssist 994F · Interface premium OCP · Benguérir
    </div>
    """,
    unsafe_allow_html=True,
)