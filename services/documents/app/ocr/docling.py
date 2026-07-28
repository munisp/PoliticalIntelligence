"""Docling backend — structure-aware PDF/DOCX parsing.

Uses the real `docling` package when installed (lazy import). Otherwise a
deterministic stdlib fallback extracts text and a coarse section structure:

* PDF: minimal content-stream parser — inflates FlateDecode streams and pulls
  text-showing operators (Tj / TJ / ') out of them. Not a full PDF renderer;
  documented limitation: fonts with custom encodings or compressed object
  streams (PDF ≥1.5 xref streams) may yield partial text.
* DOCX: OOXML is a zip; word/document.xml paragraphs are read with ElementTree.
* Tables/reading order come from docling when available; the fallback emits
  paragraph blocks in file order (reading order == document order).
"""
from __future__ import annotations

import io
import re
import zipfile
import zlib
from xml.etree import ElementTree

from app.logging_setup import get_logger
from app.models import ExtractionResult, Page, TextSpan

log = get_logger("ocr.docling")

_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def available() -> bool:
    try:
        import docling  # noqa: F401
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Real docling path
# ---------------------------------------------------------------------------
def _extract_with_docling(data: bytes, filename: str) -> ExtractionResult:
    from docling.document_converter import DocumentConverter  # lazy import

    import tempfile, pathlib

    with tempfile.NamedTemporaryFile(
        suffix=pathlib.Path(filename).suffix or ".pdf", delete=False
    ) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    result = DocumentConverter().convert(tmp_path)
    doc = result.document
    pages: list[Page] = []
    # Docling items carry provenance with page numbers when known.
    spans_by_page: dict[int, list[TextSpan]] = {}
    for item, _level in doc.iterate_items():
        text = getattr(item, "text", None)
        if not text or not text.strip():
            continue
        page_no = 1
        prov = getattr(item, "prov", None)
        if prov:
            page_no = getattr(prov[0], "page_no", 1)
        spans_by_page.setdefault(page_no, []).append(
            TextSpan(text=text.strip(), confidence=0.98)
        )
    for page_no in sorted(spans_by_page):
        pages.append(Page(page_number=page_no, kind="text_pdf",
                          spans=spans_by_page[page_no], backend="docling"))
    tables = []
    for table in getattr(doc, "tables", []):
        try:
            tables.append(table.export_to_markdown())
        except Exception:
            pass
    return ExtractionResult(
        pages=pages,
        backend="docling",
        structure={"tables": tables, "reading_order": "docling",
                   "sections": _sections_from_pages(pages)},
    )


# ---------------------------------------------------------------------------
# Stdlib fallback path
# ---------------------------------------------------------------------------
def _pdf_streams(data: bytes) -> list[bytes]:
    """Yield decoded content streams of a PDF (FlateDecode + raw)."""
    out: list[bytes] = []
    for m in re.finditer(rb"stream\r?\n", data):
        start = m.end()
        end = data.find(b"endstream", start)
        if end < 0:
            continue
        raw = data[start:end].rstrip(b"\r\n")
        # Look back for the stream dict to check the filter.
        header = data[max(0, m.start() - 400):m.start()]
        if b"FlateDecode" in header:
            try:
                out.append(zlib.decompress(raw))
                continue
            except zlib.error:
                pass
        out.append(raw)
    return out


_PDF_TEXT_OP = re.compile(
    rb"(\((?:\\.|[^\\()])*\))\s*(?:Tj|')|\[(.*?)\]\s*TJ", re.DOTALL)
_PDF_STR = re.compile(rb"\((?:\\.|[^\\()])*\)")


def _decode_pdf_string(raw: bytes) -> str:
    body = raw[1:-1]
    body = body.replace(b"\\(", b"(").replace(b"\\)", b")")
    body = body.replace(b"\\n", b"\n").replace(b"\\\\", b"\\")
    return body.decode("latin-1", errors="replace")


def _pdf_text(data: bytes) -> list[str]:
    """Text lines from PDF content streams (reading order = stream order)."""
    lines: list[str] = []
    for stream in _pdf_streams(data):
        if b"BT" not in stream:
            continue
        for op in _PDF_TEXT_OP.finditer(stream):
            if op.group(2) is not None:  # TJ array
                parts = [_decode_pdf_string(s)
                         for s in _PDF_STR.findall(op.group(2))]
                text = "".join(parts)
            else:
                text = _decode_pdf_string(op.group(1))
            if text.strip():
                lines.append(text)
    return lines


def _docx_paragraphs(data: bytes) -> list[str]:
    paras: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml = zf.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    for para in root.iter(f"{_W_NS}p"):
        text = "".join(t.text or "" for t in para.iter(f"{_W_NS}t"))
        if text.strip():
            paras.append(text.strip())
    return paras


_SECTION_HEADING = re.compile(
    r"^(?:part\s+[ivxlcdm]+|section\s+\d+|\d+\.\s|[A-Z][A-Z &\-]{4,}$)",
    re.IGNORECASE,
)


def _sections_from_pages(pages: list[Page]) -> list[dict]:
    sections: list[dict] = []
    for page in pages:
        for line in page.text.splitlines():
            line = line.strip()
            if line and _SECTION_HEADING.match(line):
                sections.append({"heading": line, "page": page.page_number})
    return sections


def _extract_fallback(data: bytes, filename: str) -> ExtractionResult:
    name = filename.lower()
    if name.endswith(".docx") or data[:2] == b"PK":
        lines = _docx_paragraphs(data)
        kind = "docx"
    elif name.endswith((".txt", ".md")):
        lines = [ln for ln in data.decode("utf-8", "replace").splitlines()
                 if ln.strip()]
        kind = "text"
    else:  # assume PDF
        lines = _pdf_text(data)
        kind = "text_pdf"
    spans = [TextSpan(text=ln, confidence=0.95) for ln in lines]
    page = Page(page_number=1, kind=kind, spans=spans,
                backend="stdlib-fallback")
    return ExtractionResult(
        pages=[page] if spans else [],
        backend="stdlib-fallback",
        structure={"tables": [], "reading_order": "document-order",
                   "sections": _sections_from_pages([page])},
        fallback_used=True,
    )


def extract(data: bytes, filename: str) -> ExtractionResult:
    """Structure-aware extraction via docling, stdlib fallback otherwise."""
    if available():
        try:
            return _extract_with_docling(data, filename)
        except Exception as exc:
            log.warning("docling failed (%s); using stdlib fallback", exc)
    return _extract_fallback(data, filename)
