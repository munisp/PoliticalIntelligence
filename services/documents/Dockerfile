FROM python:3.12-slim

WORKDIR /srv
ENV PYTHONUNBUFFERED=1 \
    DOCUMENTS_ARTIFACTS_DIR=/srv/artifacts/documents

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Heavy OCR extras (PaddleOCR/Docling/boto3) are intentionally NOT baked in:
#   docker build --build-arg EXTRAS=1 ...   # or pip install -r requirements-extras.txt
# The service falls back to deterministic stdlib extractors without them.
COPY requirements-extras.txt ./

COPY app ./app
COPY conftest.py pytest.ini ./

EXPOSE 8400
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8400"]
