"""Document pipeline: upload → extract → segment → legal NLP → structure →
review-task routing (spec §18.1).

Artifacts stored per document (content-addressed in DocumentStore):
  raw        original binary
  ocr        extraction JSON (pages, spans, confidences, structure)
  clauses    clauses JSON (with obligations, terms, citations)
  edges      citation edge list JSON
  akn        Akoma Ntoso 3.0 XML
  quality    quality report JSON
"""
from __future__ import annotations

import json
import re

from app import akn as akn_mod
from app.config import settings
from app.legal import nlp
from app.logging_setup import get_logger
from app.models import (DocumentJob, ExtractionResult, QualityReport)
from app.ocr import router as ocr_router
from app.storage import DocumentStore

log = get_logger("pipeline")


def _stage(job: DocumentJob, name: str):
    return next(s for s in job.stages if s.name == name)


def _begin(job: DocumentJob, name: str) -> None:
    st = _stage(job, name)
    st.status = "running"
    from app.models import utcnow
    st.started_at = utcnow()


def _end(job: DocumentJob, name: str, detail: str | None = None) -> None:
    from app.models import utcnow
    st = _stage(job, name)
    st.status = "succeeded"
    st.finished_at = utcnow()
    st.detail = detail


def _fail(job: DocumentJob, name: str, exc: Exception) -> None:
    from app.models import utcnow
    st = _stage(job, name)
    st.status = "failed"
    st.finished_at = utcnow()
    st.detail = str(exc)


def _year_from_text(text: str) -> int | None:
    m = re.search(r"\b(19|20)\d{2}\b", text[:2000])
    return int(m.group(0)) if m else None


def run_pipeline(
    job: DocumentJob,
    data: bytes,
    filename: str,
    store: DocumentStore,
    *,
    title: str,
    jurisdiction_id: str = "jur:ng",
    doc_type: str = "act",
    language: str = "en",
) -> QualityReport:
    """Synchronous pipeline body (invoked from the job manager thread)."""
    # 1. upload — persist the raw binary
    _begin(job, "upload")
    raw_uri = store.put(data, suffix=_suffix(filename))
    job.artifacts["raw"] = raw_uri
    _end(job, "upload", raw_uri)

    # 2. extract — OCR / structure parsing via routed backend
    _begin(job, "extract")
    try:
        extraction: ExtractionResult = ocr_router.extract(data, filename)
    except Exception as exc:
        _fail(job, "extract", exc)
        raise
    job.artifacts["ocr"] = store.put(
        extraction.model_dump_json(indent=2).encode(), suffix=".ocr.json")
    job.ocr_confidence = extraction.mean_confidence
    _end(job, "extract",
         f"backend={extraction.backend} conf={extraction.mean_confidence}")

    # 3. segment — clause segmentation
    _begin(job, "segment")
    text = extraction.full_text
    clauses = nlp.segment_clauses(text, extraction.mean_confidence)
    for page in extraction.pages:
        if page.needs_review:
            job.review_flags.append({
                "type": "ocr_low_confidence",
                "page": page.page_number,
                "confidence": page.confidence,
                "threshold": settings.review_confidence_threshold,
            })
    _end(job, "segment", f"{len(clauses)} clauses")

    # 4. legal NLP — obligations, terms, citations, edges
    _begin(job, "legal_nlp")
    clauses = nlp.enrich(clauses)
    edges = nlp.build_edges(clauses)
    job.artifacts["clauses"] = store.put(
        json.dumps([c.model_dump(mode="json") for c in clauses],
                   indent=2).encode(), suffix=".clauses.json")
    job.artifacts["edges"] = store.put(
        json.dumps([e.model_dump(mode="json") for e in edges],
                   indent=2).encode(), suffix=".edges.json")
    n_obl = sum(len(c.obligations) for c in clauses)
    _end(job, "legal_nlp",
         f"{n_obl} obligations, {len(edges)} edges")

    # 5. structure — Akoma Ntoso serialization
    _begin(job, "structure")
    country = jurisdiction_id.replace("jur:", "").split("-")[0] or "ng"
    akn_xml = akn_mod.build_akn(
        title, clauses, country=country, doc_type=doc_type,
        year=_year_from_text(text),
        language={"en": "eng"}.get(language, language))
    job.artifacts["akn"] = store.put(akn_xml.encode(), suffix=".akn.xml")
    problems = akn_mod.structural_check(akn_xml)
    if problems:
        job.review_flags.append({"type": "akn_structure", "issues": problems})
    _end(job, "structure", f"akn ok={not problems}")

    # 6. review routing — quality report + human-review flags
    _begin(job, "review_routing")
    report = build_quality_report(job, extraction, clauses)
    job.artifacts["quality"] = store.put(
        report.model_dump_json(indent=2).encode(), suffix=".quality.json")
    _end(job, "review_routing", f"{len(report.review_flags)} flags")
    return report


def build_quality_report(
    job: DocumentJob,
    extraction: ExtractionResult,
    clauses,
) -> QualityReport:
    buckets = {"0.0-0.25": 0, "0.25-0.5": 0, "0.5-0.75": 0, "0.75-1.0": 0}
    low_pages: list[int] = []
    for page in extraction.pages:
        c = page.confidence
        if c < 0.25:
            buckets["0.0-0.25"] += 1
        elif c < 0.5:
            buckets["0.25-0.5"] += 1
        elif c < 0.75:
            buckets["0.5-0.75"] += 1
        else:
            buckets["0.75-1.0"] += 1
        if page.needs_review:
            low_pages.append(page.page_number)
    return QualityReport(
        document_id=job.document_id,
        page_count=len(extraction.pages),
        mean_ocr_confidence=extraction.mean_confidence,
        confidence_distribution=buckets,
        low_confidence_pages=low_pages,
        backend_used=extraction.backend,
        fallback_used=extraction.fallback_used,
        clause_count=len(clauses),
        obligation_count=sum(len(c.obligations) for c in clauses),
        defined_term_count=sum(len(c.defined_terms) for c in clauses),
        citation_count=sum(len(c.citations) for c in clauses),
        review_flags=job.review_flags,
        stages=job.stages,
    )


def _suffix(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot >= 0 else ".bin"
