# MineAssist · Backend FastAPI · Dockerfile
# Build: docker build -t mineassist-backend ./backend
# Run:   docker run -p 8000:8000 --env-file backend/.env mineassist-backend

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dépendances système (libgomp pour XGBoost, libgl1 pour PyMuPDF/OpenCV)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libgomp1 libgl1 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

# Couche dépendances Python — cache pip si requirements.txt inchangé
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

# Code applicatif
COPY app /app/app
COPY models /app/models
COPY train_anomaly.py /app/

# Volumes recommandés (montés au runtime) :
#   /app/data         (Excel + uploads)
#   /app/.chroma      (index ChromaDB)
#   /app/logs         (logs JSON)
RUN mkdir -p /app/data /app/.chroma /app/logs

EXPOSE 8000

# Healthcheck via /healthz
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
