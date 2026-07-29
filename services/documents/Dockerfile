FROM python:3.12-slim

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 \
    DOCUMENTS_ARTIFACTS_DIR=/srv/artifacts/documents

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Heavy OCR extras (PaddleOCR/Docling/boto3) are NOT baked in by default to
# keep the image slim (~200MB paddlepaddle wheel + ~1.5GB docling/torch
# models). Opt in at build time:
#   docker build --build-arg WITH_OCR_EXTRAS=true -t policy-twin/documents:ocr .
#   # or in compose: services.documents.build.args.WITH_OCR_EXTRAS: "true"
# Best-effort: a failed extras install does NOT fail the image build — the
# service falls back to deterministic stdlib extractors without them.
ARG WITH_OCR_EXTRAS=false
COPY requirements-extras.txt ./
RUN if [ "$WITH_OCR_EXTRAS" = "true" ]; then \
      pip install --no-cache-dir -r requirements-extras.txt || \
      echo "WARN: OCR extras install failed (best-effort) — stdlib fallbacks remain"; \
    fi

COPY app ./app
COPY conftest.py pytest.ini ./

EXPOSE 8400
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8400"]
