FROM python:3.12-slim

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 \
    INGESTION_ARTIFACTS_DIR=/srv/artifacts/ingestion

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Extras (pyiceberg for the DM-4 lakehouse export, kafka-python, PyMySQL,
# optional dagster) are installed by default — pyiceberg is small and the
# lakehouse path is a first-class feature. Disable for a slimmer image:
#   docker build --build-arg WITH_INGESTION_EXTRAS=false ...
ARG WITH_INGESTION_EXTRAS=true
COPY requirements-extras.txt ./
RUN if [ "$WITH_INGESTION_EXTRAS" = "true" ]; then \
      pip install --no-cache-dir -r requirements-extras.txt || \
      echo "WARN: ingestion extras install failed (best-effort) — fallbacks remain"; \
    fi

COPY app ./app
COPY conftest.py pytest.ini ./

EXPOSE 8300
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8300"]
