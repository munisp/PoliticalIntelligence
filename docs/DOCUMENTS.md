# Document & Legal Processing Pipeline (spec §18)

Status: **implemented** — closes the ING-3/ING-4/ING-5/ING-6 gaps flagged in
`COMPLIANCE.md`. Binary upload, real OCR backends (PaddleOCR / Docling / VLM),
legal NLP, Akoma Ntoso 3.0 output, quality reporting and human-review routing.

Components:

| Layer | Code | Notes |
| --- | --- | --- |
| Processing service | `services/documents/` | FastAPI, port 8400, async jobs + idempotency |
| API integration | `api/documents.ts`, `api/queries/documents.ts` | register / processingStatus / quality / reprocess |
| Legislation import | `api/legislation.ts` `importFromDocument` | laws + clauses rows from clauses JSON |
| Contracts | `contracts/documents.ts` | zod schemas shared across the boundary |

## 1. Pipeline stages

```
upload → extract → segment → legal NLP → structure → review-task routing
```

1. **upload** — binary persisted in the content-addressed store
   (`app/storage.py`): local `./artifacts/documents/<sha256>` by default,
   mirrored to S3/MinIO when `DOCUMENTS_S3_BUCKET` is set (boto3, optional).
2. **extract** — OCR/structure parsing through the backend router.
3. **segment** — clause segmentation (numbered sections `15.—(1)`,
   definitions/interpretation, provisos `Provided that`, schedules, preamble).
4. **legal NLP** — obligation/prohibition/permission extraction (modal-verb
   rules: shall/must → obligation; shall not → prohibition; may → permission),
   defined-terms extraction (`"…" means …`), citation detection (Act/Law/
   Section/Cap references, Nigerian patterns: `Cap P44 LFN 2004`,
   `Public Procurement Act 2007`, `No. 14 of 2007`), cross-reference edges
   (CITES / AMENDS / REPEALS / ENABLES / RESTRICTS from verb context;
   internal `section N` references resolved to clause ids).
5. **structure** — Akoma Ntoso 3.0 XML (`app/akn.py`).
6. **review-task routing** — quality report + review flags; pages below
   confidence 0.75 (spec BR-4) are flagged `ocr_low_confidence`.

Per-stage status is tracked on the job (`pending/running/succeeded/failed`)
and artifacts are stored per document: `raw`, `ocr`, `clauses`, `edges`,
`akn`, `quality`.

## 2. OCR backend routing table

| Input | Primary backend | Fallback when extra absent | Escalation |
| --- | --- | --- | --- |
| Text PDF / DOCX / TXT / MD | **Docling** (sections, tables, reading order) | stdlib PDF content-stream parser (FlateDecode + Tj/TJ operators) / OOXML zip reader for DOCX | — |
| Scanned PDF / PNG / JPEG / TIFF | **PaddleOCR** (per-region confidence + bbox) | PNG text-chunk probe (embedded OCR layer, conf 0.6); empty image → conf 0.0 | VLM when endpoint configured |
| Complex layout / mean conf < 0.75 | **VLM** via vLLM endpoint (`VLLM_BASE_URL`, OpenAI-compatible vision chat, model `VLM_MODEL`, e.g. Qwen2.5-VL / Qwen3-VL) | deterministic heuristic extractor — flags page for human review, never fabricates text | human review queue |

Forced backend: `OCR_BACKEND=docling|paddle|vlm` (default `auto`).
Review threshold: `REVIEW_CONFIDENCE_THRESHOLD` (default 0.75, BR-4).

## 3. Installing the heavy extras

Base service runs on stdlib fallbacks (all 26 pytest tests pass without
extras). For production OCR:

```bash
pip install -r services/documents/requirements-extras.txt
```

- **PaddleOCR (CPU)** — `paddlepaddle` CPU wheel (~200MB) is sufficient; no
  CUDA required for inference. First run downloads detection/recognition
  models (~15MB). Set `PADDLE_LANG=en` (default).
- **Docling** — pulls torch + layout models (~1.5GB on first conversion).
  Provides real table extraction and reading order; without it tables come
  back empty and reading order is document order.
- **VLM** — no local install. Point at the platform vLLM endpoint:
  `VLLM_BASE_URL=http://vllm:8000`, `VLM_MODEL=Qwen/Qwen2.5-VL-7B-Instruct`,
  optional `VLLM_API_KEY`. Used both for scanned-page transcription and
  clause-semantics assist.
- **boto3** — only when `DOCUMENTS_S3_BUCKET` is set (MinIO:
  `DOCUMENTS_S3_ENDPOINT_URL=http://minio:9000`).

## 4. Akoma Ntoso output

`app/akn.py` emits AKN 3.0 with FRBR identification and a section/article
hierarchy. FRBRthis URIs follow `/akn/<country>/<doctype>/<year>/<slug>`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0">
  <act name="act">
    <meta><identification source="#meridian-documents">
      <FRBRWork><FRBRthis value="/akn/ng/act/2007/ppa"/>…</FRBRWork>
    </identification></meta>
    <body>
      <section eId="sec_s_1"><num>s.1</num>
        <heading>Establishment of the Bureau</heading>
        <content><p>(1) There is established the Bureau…</p></content>
      </section>…
    </body>
  </act>
</akomaNtoso>
```

Validity is enforced by a structural checklist (`structural_check`, asserted
empty in tests): well-formed XML, `akomaNtoso > act > meta/identification`
with FRBRWork/FRBRthis, non-empty body, every section has `eId`, `num`,
`content`.

## 5. Review workflow

1. Pages with OCR confidence < 0.75 → `ocr_low_confidence` review flags in the
   quality report; the API surfaces them via `documents.ocrReviewQueue`
   (review_tasks table) and `documents.quality`.
2. `legislation.importFromDocument(document_id)` (legal_analyst /
   data_steward) idempotently upserts `laws` + `clauses` rows
   (`review_state='draft'`, per-clause confidence, obligations JSON) and
   creates `legal_extract` review tasks for clauses below 0.75.
3. Clauses then flow through the standard review-state machine
   (`legislation.updateReviewState`: draft → in_review → approved →
   signed_off).
4. Fallback-mode registrations (service unreachable) always land
   `in_review` with sub-threshold confidence — nothing enters the corpus
   unreviewed.

## 6. API reference

Documents service (`DOCUMENTS_BASE_URL`, default `http://localhost:8400`):

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/documents` | multipart upload → 202 job; `Idempotency-Key` header dedupes |
| GET | `/v1/documents/{id}` | job status + per-stage status + artifact URIs |
| GET | `/v1/documents/{id}/artifacts/{kind}` | raw / ocr / clauses / edges / akn / quality |
| GET | `/v1/documents/{id}/quality` | quality report |
| POST | `/v1/documents/{id}/reprocess` | re-run from stored raw artifact |
| GET | `/health` | liveness |

tRPC (`api/documents.ts`, envelope-wrapped, zod-validated, RBAC'd, audited):

- `documents.register` — accepts `content_base64` (≤10MB decoded) or
  `source_url`; forwards to the service; on unreachable, deterministic
  fallback (txt/md only) with `processing_mode: "fallback"`.
- `documents.processingStatus(job_id)` — proxies service job status;
  retryable `DOCUMENTS_SERVICE_UNREACHABLE` when down.
- `documents.quality(document_id)` — proxies the quality report.
- `documents.reprocess(document_id)` — protected (legal_analyst/data_steward).
- `legislation.importFromDocument(document_id)` — law import (§5.2).

## 7. Honest limitations

- Without `paddleocr` installed, scanned images yield only embedded text
  chunks (or nothing, conf 0.0 → review). No OCR model ships with the base
  install.
- Without `docling`, the stdlib PDF parser handles simple text PDFs only;
  compressed object streams (PDF ≥1.5 xref streams) and custom font
  encodings can yield partial text, and tables/reading-order are not
  recovered.
- Without `VLLM_BASE_URL`, VLM escalation and VLM-assisted clause splitting
  are disabled (deterministic heuristics only).
- The fallback processor in the API layer handles `.txt`/`.md` only — binary
  formats require the service.
- Job state is in-process (same discipline as `services/ingestion`); a
  service restart loses queued jobs — persisted raw artifacts allow
  reprocess.
- AKN output is structurally validated against a checklist, not the full
  OASIS XSD.
