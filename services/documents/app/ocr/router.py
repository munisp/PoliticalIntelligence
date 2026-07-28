"""Stage router — picks the OCR backend per document and escalates
low-confidence pages to VLM / human review (spec §18.2, BR-4).

Routing table (auto mode):
  text-based PDF / DOCX / TXT / MD  -> docling (structure-aware)
  scanned PDF / PNG / JPEG / TIFF   -> paddleocr
  complex layout or mean confidence < threshold -> VLM escalation
  page confidence < 0.75            -> human review queue flag
"""
from __future__ import annotations

from app.config import settings
from app.logging_setup import get_logger
from app.models import ExtractionResult, Page, TextSpan
from app.ocr import docling, paddle, vlm

log = get_logger("ocr.router")


def _is_text_document(data: bytes, filename: str) -> bool:
    name = filename.lower()
    if name.endswith((".txt", ".md", ".docx")):
        return True
    if paddle.is_image(data, filename):
        return False
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        # Text PDF if its content streams carry text operators.
        probe = docling.extract(data, filename)
        if probe.pages and probe.full_text.strip():
            # Reuse: return value signals text layer present. Caller re-runs
            # extraction through the normal path (cheap for fixtures; for
            # large PDFs docling caches internally).
            return True
        return False
    return True  # unknown types: try text extraction first


def route_backend(data: bytes, filename: str) -> str:
    forced = settings.ocr_backend
    if forced != "auto":
        return forced
    if paddle.is_image(data, filename):
        return "paddle"
    if _is_text_document(data, filename):
        return "docling"
    return "paddle"


def extract(data: bytes, filename: str) -> ExtractionResult:
    backend = route_backend(data, filename)
    log.info("routing %s -> %s", filename, backend)
    if backend == "docling":
        result = docling.extract(data, filename)
    elif backend == "vlm":
        result = vlm.extract(data, filename)
    else:
        result = paddle.extract(data, filename)

    # Escalation: empty/low-confidence result -> try VLM (spec §18.2).
    if (result.mean_confidence < settings.review_confidence_threshold
            and backend != "vlm" and vlm.online()
            and paddle.is_image(data, filename)):
        log.info("escalating %s to VLM (confidence %.2f)", filename,
                 result.mean_confidence)
        vlm_result = vlm.extract(data, filename)
        if vlm_result.full_text.strip():
            result = vlm_result

    _flag_review(result)
    return result


def _flag_review(result: ExtractionResult) -> None:
    """Spec BR-4: per-page confidence below threshold -> human review."""
    for page in result.pages:
        if page.confidence < settings.review_confidence_threshold:
            page.needs_review = True
