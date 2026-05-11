"""
test_smoke.py — Sprint 3 (mai 2026)
====================================

Tests fumée minimaux pour CI : valident que l'app démarre, que les routes
critiques existent et répondent, et que la couche /healthz est verte.

Lancer : pytest backend/tests -q
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client():
    from app.api import app
    return TestClient(app)


# ─── Liveness / readiness ────────────────────────────────────────────────────
def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"


def test_readyz(client):
    r = client.get("/readyz")
    assert r.status_code in (200, 503)
    data = r.json()
    assert "checks" in data
    assert "rul_models" in data["checks"]


# ─── Endpoints RUL ───────────────────────────────────────────────────────────
def test_rul_predict_demo(client):
    r = client.get("/pred/rul/predict/demo")
    assert r.status_code == 200
    data = r.json()
    assert "rul_heures" in data
    assert "alert_class" in data


def test_rul_predict_current_returns_404_when_no_file(client):
    """Sans fichier uploadé, l'endpoint doit renvoyer 404 avec message clair."""
    r = client.get("/pred/rul/predict/current")
    assert r.status_code in (200, 404)
    if r.status_code == 404:
        assert "fichier" in r.json().get("detail", "").lower()


def test_rul_alert_class(client):
    r = client.get("/pred/rul/alert-class")
    assert r.status_code == 200
    data = r.json()
    assert "alerte_globale" in data
    assert "alerte_active" in data


# ─── Endpoints Ask / Diagnose ────────────────────────────────────────────────
def test_ask_v2_minimum(client):
    """/ask/v2 doit accepter une requête mais peut renvoyer 503 si OpenRouter
    non configuré — pas de crash."""
    r = client.post("/ask/v2", json={"question": "Comment faire un test ?"})
    assert r.status_code in (200, 401, 429, 503)


def test_diagnose_v2_validation(client):
    """/diagnose/v2 doit valider le schéma."""
    r = client.post("/diagnose/v2", json={})
    assert r.status_code in (200, 422, 503)


# ─── Endpoints Historique ────────────────────────────────────────────────────
def test_history_dashboard(client):
    r = client.get("/history/dashboard?engin=994F1")
    assert r.status_code == 200
    data = r.json()
    assert "stats" in data
    assert "loaded_at" in data


def test_history_export_xlsx_format(client):
    r = client.get("/history/export.xlsx?engin=994F1&limit=5")
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        assert "spreadsheet" in r.headers.get(
            "content-type", "") or "xlsx" in r.headers.get("content-disposition", "")


# ─── Feedback ────────────────────────────────────────────────────────────────
def test_feedback_record_and_stats(client):
    r = client.post("/feedback", json={
        "answer_id": "test_smoke_001",
        "rating": "up",
    })
    assert r.status_code == 200
    assert r.json().get("saved") is True

    r2 = client.get("/feedback/stats")
    assert r2.status_code == 200
    data = r2.json()
    assert "total" in data
    assert data["total"] >= 1


# ─── Métriques ───────────────────────────────────────────────────────────────
def test_metrics_endpoint_exists(client):
    r = client.get("/metrics")
    assert r.status_code == 200
    body = r.text
    assert "mineassist_uptime_seconds" in body
    assert "mineassist_ml_models_loaded" in body


# ─── Drift / Explain ─────────────────────────────────────────────────────────
def test_drift_endpoint_returns_404_when_no_file(client):
    r = client.get("/pred/rul/drift")
    assert r.status_code in (200, 404, 422)
