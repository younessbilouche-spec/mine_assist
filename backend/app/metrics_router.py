"""
metrics_router.py — Sprint 3 (mai 2026)
========================================

Endpoint /metrics au format Prometheus (texte) pour observabilité production.
Pas de dépendance externe (prometheus_client) → léger.

Usage Grafana / Prometheus :
  scrape_interval: 15s
  - targets: ['mineassist-backend:8000']
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

metrics_router = APIRouter(tags=["Métriques"])

# ─── Stats partagées (in-memory) ──────────────────────────────────────────────
_LOCK = threading.Lock()

_COUNTERS: Dict[str, int] = defaultdict(int)
_LATENCIES: Dict[str, deque] = defaultdict(lambda: deque(maxlen=500))
_START_TIME = time.time()


def record_request(path: str, method: str, status_code: int, latency_s: float):
    """Appelé par le middleware pour chaque requête."""
    with _LOCK:
        _COUNTERS[f"http_requests_total{{method=\"{method}\",path=\"{path}\",status=\"{status_code}\"}}"] += 1
        if status_code >= 500:
            _COUNTERS[f"http_errors_total{{path=\"{path}\"}}"] += 1
        _LATENCIES[f"{method} {path}"].append(latency_s)


def _percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    sorted_v = sorted(values)
    k = (len(sorted_v) - 1) * pct
    f = int(k)
    c = min(f + 1, len(sorted_v) - 1)
    if f == c:
        return sorted_v[f]
    return sorted_v[f] * (c - k) + sorted_v[c] * (k - f)


def _format_metric(name: str, value: float, labels: Optional[Dict[str, str]] = None,
                   help_text: Optional[str] = None, mtype: str = "gauge") -> str:
    out = []
    if help_text:
        out.append(f"# HELP {name} {help_text}")
        out.append(f"# TYPE {name} {mtype}")
    if labels:
        label_str = "{" + ",".join(f'{k}="{v}"' for k, v in labels.items()) + "}"
    else:
        label_str = ""
    out.append(f"{name}{label_str} {value}")
    return "\n".join(out)


@metrics_router.get("/metrics", response_class=PlainTextResponse)
def metrics_endpoint():
    """Format Prometheus exposition."""
    lines = []

    # Uptime
    lines.append("# HELP mineassist_uptime_seconds Process uptime in seconds")
    lines.append("# TYPE mineassist_uptime_seconds counter")
    lines.append(f"mineassist_uptime_seconds {int(time.time() - _START_TIME)}")

    # ML models loaded
    try:
        from app.ocp.routers.rul_router import _models, load_rul_models
        try:
            load_rul_models()
        except Exception:
            pass
        n_models = len(_models)
    except Exception:
        n_models = 0
    lines.append("# HELP mineassist_ml_models_loaded Number of ML models loaded")
    lines.append("# TYPE mineassist_ml_models_loaded gauge")
    lines.append(f"mineassist_ml_models_loaded {n_models}")

    # Requests counters
    lines.append("# HELP http_requests_total HTTP requests counter")
    lines.append("# TYPE http_requests_total counter")
    with _LOCK:
        for name, val in _COUNTERS.items():
            lines.append(f"{name} {val}")

        # Latency percentiles per endpoint
        lines.append("# HELP http_request_latency_seconds HTTP request latency percentiles")
        lines.append("# TYPE http_request_latency_seconds summary")
        for endpoint, deq in _LATENCIES.items():
            if not deq:
                continue
            method, path = endpoint.split(" ", 1)
            vals = list(deq)
            p50 = _percentile(vals, 0.5)
            p95 = _percentile(vals, 0.95)
            p99 = _percentile(vals, 0.99)
            lbl = f'method="{method}",path="{path}"'
            lines.append(f'http_request_latency_seconds{{{lbl},quantile="0.5"}} {p50:.4f}')
            lines.append(f'http_request_latency_seconds{{{lbl},quantile="0.95"}} {p95:.4f}')
            lines.append(f'http_request_latency_seconds{{{lbl},quantile="0.99"}} {p99:.4f}')
            lines.append(f'http_request_latency_seconds_count{{{lbl}}} {len(vals)}')

    # Feedback stats
    try:
        from pathlib import Path
        import json
        fpath = Path(__file__).resolve().parent.parent / "data" / "feedback.jsonl"
        up, down, total = 0, 0, 0
        if fpath.exists():
            with fpath.open("r", encoding="utf-8") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                        total += 1
                        if d.get("rating") == "up": up += 1
                        elif d.get("rating") == "down": down += 1
                    except Exception:
                        pass
        lines.append("# HELP mineassist_feedback_total User feedback votes")
        lines.append("# TYPE mineassist_feedback_total counter")
        lines.append(f'mineassist_feedback_total{{rating="up"}} {up}')
        lines.append(f'mineassist_feedback_total{{rating="down"}} {down}')
    except Exception:
        pass

    return "\n".join(lines) + "\n"


# ─── Middleware factory pour mesurer chaque requête ───────────────────────────
async def metrics_middleware(request: Request, call_next):
    """À enregistrer comme middleware FastAPI."""
    t0 = time.time()
    response = await call_next(request)
    latency = time.time() - t0
    try:
        # Normalise le path pour éviter explosion de cardinalité
        path = request.url.path
        # Trim variable IDs
        if len(path) > 80:
            path = path[:80] + "..."
        record_request(path, request.method, response.status_code, latency)
    except Exception:
        pass
    return response
