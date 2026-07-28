"""PaddleOCR backend — scanned pages & images.

Uses the real `paddleocr` package when installed (lazy import; heavy dep —
see requirements-extras.txt). Produces per-region confidence + bounding
boxes, and (via `paddle` render or pdf2image-free path) page images are
handled as raw image bytes (PNG/JPEG/TIFF) or single-image PDFs.

Deterministic fallback when paddleocr is absent: a lightweight text-layer
probe. For images we cannot OCR without a model, so the fallback emits a
low-confidence synthetic span derived from image metadata (dimensions,
embedded PNG text chunks / EXIF) and flags the page for VLM escalation /
human review — never fabricates confident text.
"""
from __future__ import annotations

import io
import re
import struct
import zlib

from app.config import settings
from app.logging_setup import get_logger
from app.models import ExtractionResult, Page, TextSpan

log = get_logger("ocr.paddle")


def available() -> bool:
    try:
        from paddleocr import PaddleOCR  # noqa: F401
        return True
    except Exception:
        return False


_ENGINE = None


def _engine():
    global _ENGINE
    if _ENGINE is None:
        from paddleocr import PaddleOCR  # lazy import

        _ENGINE = PaddleOCR(use_angle_cls=True, lang=settings.paddle_lang,
                            show_log=False)
    return _ENGINE


# ---------------------------------------------------------------------------
def _extract_with_paddle(data: bytes, filename: str) -> ExtractionResult:
    ocr = _engine()
    result = ocr.ocr(data, cls=True)
    spans: list[TextSpan] = []
    # paddle returns [ [ [bbox, (text, conf)], ... ] ] per image/page
    pages_raw = result if result and isinstance(result[0], list) else [result]
    pages: list[Page] = []
    for idx, page_lines in enumerate(pages_raw or []):
        page_spans: list[TextSpan] = []
        for line in page_lines or []:
            bbox, (text, conf) = line[0], line[1]
            flat = [float(bbox[0][0]), float(bbox[0][1]),
                    float(bbox[2][0]), float(bbox[2][1])]
            page_spans.append(TextSpan(text=str(text),
                                       confidence=round(float(conf), 4),
                                       bbox=flat))
        pages.append(Page(page_number=idx + 1, kind="scanned",
                          spans=page_spans, backend="paddleocr"))
    return ExtractionResult(pages=pages, backend="paddleocr",
                            structure={"reading_order": "top-to-bottom",
                                       "sections": []})


# ---------------------------------------------------------------------------
# Deterministic fallback — PNG/JPEG metadata probe (never fabricates text)
# ---------------------------------------------------------------------------
def _png_text_chunks(data: bytes) -> list[str]:
    """Read tEXt/zTXt chunks from a PNG — scanned exports sometimes carry
    embedded OCR text layers."""
    out: list[str] = []
    if not data.startswith(b"\x89PNG"):
        return out
    pos = 8
    while pos + 12 <= len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        ctype = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + length]
        if ctype == b"tEXt":
            try:
                key, _, value = payload.partition(b"\x00")
                if key.lower() in (b"ocr", b"text", b"description",
                                   b"comment") and value.strip():
                    out.append(value.decode("latin-1", "replace").strip())
            except Exception:
                pass
        elif ctype == b"zTXt":
            try:
                key, _, rest = payload.partition(b"\x00")
                value = zlib.decompress(rest[2:])
                if key.lower() in (b"ocr", b"text", b"description"):
                    out.append(value.decode("latin-1", "replace").strip())
            except Exception:
                pass
        pos += 12 + length
        if ctype == b"IEND":
            break
    return out


def _image_size(data: bytes) -> tuple[int, int] | None:
    if data.startswith(b"\x89PNG") and len(data) >= 24:
        w, h = struct.unpack(">II", data[16:24])
        return int(w), int(h)
    return None


def _extract_fallback(data: bytes, filename: str) -> ExtractionResult:
    spans: list[TextSpan] = []
    for chunk in _png_text_chunks(data):
        # Embedded text layer: real content, moderate confidence.
        for line in chunk.splitlines():
            if line.strip():
                spans.append(TextSpan(text=line.strip(), confidence=0.6))
    size = _image_size(data)
    detail = f"{size[0]}x{size[1]} image" if size else "image"
    if not spans:
        # No model + no text layer: zero readable text, confidence 0 so the
        # router escalates to VLM / human review (spec BR-4).
        spans.append(TextSpan(text="", confidence=0.0))
    page = Page(page_number=1, kind="image", spans=spans,
                backend="paddle-fallback", needs_review=not bool(spans[0].text))
    log.info("paddle fallback on %s (%s): %d span(s)", filename, detail,
             len(spans))
    return ExtractionResult(pages=[page], backend="paddle-fallback",
                            fallback_used=True,
                            structure={"reading_order": "unknown",
                                       "sections": []})


def is_image(data: bytes, filename: str) -> bool:
    name = filename.lower()
    return (
        name.endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"))
        or data[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1")
        or data[:2] in (b"II", b"MM")
    )


def extract(data: bytes, filename: str) -> ExtractionResult:
    """OCR scanned/image content via PaddleOCR, fallback otherwise."""
    if available():
        try:
            return _extract_with_paddle(data, filename)
        except Exception as exc:
            log.warning("paddleocr failed (%s); using fallback", exc)
    return _extract_fallback(data, filename)


_WORDISH = re.compile(r"[A-Za-z]{3,}")
