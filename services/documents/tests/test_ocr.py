"""OCR backend + router tests (all run without heavy extras — fallback
paths are exercised deterministically)."""
from __future__ import annotations

from app.ocr import docling, paddle, router
from app.ocr.docling import _pdf_text

from .fixtures import PPA_EXCERPT, make_docx, make_scanned_png, make_text_pdf

LINES = [ln for ln in PPA_EXCERPT.splitlines() if ln.strip()]


def test_stdlib_pdf_text_extraction():
    pdf = make_text_pdf(LINES)
    extracted = _pdf_text(pdf)
    assert any("Public Procurement Act 2007" in ln for ln in extracted)
    assert any("Establishment of the Bureau" in ln for ln in extracted)


def test_docling_fallback_pdf_structure():
    result = docling.extract(make_text_pdf(LINES), "ppa.pdf")
    if docling.available():
        assert result.backend == "docling"
    else:
        assert result.backend == "stdlib-fallback"
        assert result.fallback_used
    assert "shall maintain a register" in result.full_text
    assert result.mean_confidence > 0.8
    # sections detected from headings
    assert any("1." in s["heading"] or "Establishment" in s["heading"]
               for s in result.structure["sections"])


def test_docling_fallback_docx():
    result = docling.extract(make_docx(LINES), "ppa.docx")
    assert "Code of conduct" in result.full_text
    assert result.pages[0].kind in ("docx", "text_pdf")


def test_paddle_fallback_png_with_text_layer():
    png = make_scanned_png(LINES)
    result = paddle.extract(png, "scan.png")
    if paddle.available():
        assert result.backend == "paddleocr"
    else:
        assert result.backend == "paddle-fallback"
        assert result.fallback_used
        # embedded text layer recovered with moderate confidence
        assert "Public Procurement Act 2007" in result.full_text
        assert result.mean_confidence < 0.75  # routes to review / VLM


def test_paddle_fallback_png_without_text_layer():
    from PIL import Image
    import io
    buf = io.BytesIO()
    Image.new("RGB", (200, 80), "white").save(buf, format="PNG")
    result = paddle.extract(buf.getvalue(), "blank.png")
    if not paddle.available():
        assert result.pages[0].needs_review
        assert result.mean_confidence == 0.0


def test_router_sends_text_pdf_to_docling():
    result = router.extract(make_text_pdf(LINES), "ppa.pdf")
    assert result.backend in ("docling", "stdlib-fallback")
    assert "Bureau" in result.full_text


def test_router_sends_image_to_paddle_and_flags_review():
    result = router.extract(make_scanned_png(LINES), "scan.png")
    assert result.backend in ("paddleocr", "paddle-fallback", "vlm")
    if result.backend == "paddle-fallback":
        assert result.pages[0].needs_review  # 0.6 < 0.75 (BR-4)


def test_router_txt_goes_to_docling():
    result = router.extract(PPA_EXCERPT.encode(), "ppa.txt")
    assert "Public Procurement Act" in result.full_text
    assert result.mean_confidence >= 0.75
    assert not result.pages[0].needs_review
