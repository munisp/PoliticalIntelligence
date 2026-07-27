# Documents & Legal Processing Service

Spec §18: document ingestion → OCR (PaddleOCR / Docling / VLM) → legal NLP →
Akoma Ntoso structuring → human-review routing.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --port 8400
pytest                       # 26 tests, no heavy deps required
```

Optional heavy backends (deterministic stdlib fallbacks used when absent):

```bash
pip install -r requirements-extras.txt   # paddleocr, docling, boto3, python-magic
```

The VLM backend needs no local install — point it at the platform's
vLLM-compatible endpoint:

```bash
export VLLM_BASE_URL=http://localhost:8000
export VLM_MODEL=Qwen/Qwen2.5-VL-7B-Instruct
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/documents` | multipart upload → 202 job (`Idempotency-Key` header supported) |
| GET | `/v1/documents/{id}` | job + per-stage status + artifact URIs |
| GET | `/v1/documents/{id}/artifacts/{kind}` | `raw` `ocr` `clauses` `edges` `akn` `quality` |
| GET | `/v1/documents/{id}/quality` | quality report (confidence distribution, review flags) |
| POST | `/v1/documents/{id}/reprocess` | re-run pipeline from stored raw artifact |
| GET | `/health` | liveness |

## Backend routing (auto mode)

| Input | Backend | Fallback |
| --- | --- | --- |
| text PDF / DOCX / TXT | docling | stdlib PDF stream parser / OOXML zip reader |
| scanned PDF, PNG/JPEG/TIFF | paddleocr | PNG text-chunk probe (conf 0.6) |
| low-confidence / complex | VLM (vLLM endpoint) | deterministic heuristic (never fabricates) |

Pages below `REVIEW_CONFIDENCE_THRESHOLD` (default 0.75, spec BR-4) are
flagged into the review report consumed by the API review-task queue.

## Configuration

All env-driven (see `app/config.py`): `DOCUMENTS_ARTIFACTS_DIR`,
`DOCUMENTS_S3_BUCKET` (+`DOCUMENTS_S3_ENDPOINT_URL` for MinIO),
`OCR_BACKEND` (`auto|docling|paddle|vlm`), `VLLM_BASE_URL`, `VLM_MODEL`,
`REVIEW_CONFIDENCE_THRESHOLD`.
