"""In-code fixture generators (stdlib only + PIL for the PNG).

* text PDF — minimal valid PDF with a FlateDecode content stream of Tj ops
* DOCX — minimal OOXML zip with word/document.xml
* scanned-style PNG — rendered text image with an embedded tEXt OCR chunk
  (mimics a scanner export with a text layer)
"""
from __future__ import annotations

import io
import zlib
import zipfile

PPA_EXCERPT = """Public Procurement Act 2007
An Act to establish the National Council on Public Procurement and the Bureau of Public Procurement.
1. — Establishment of the Bureau.
(1) There is established the Bureau of Public Procurement.
(2) The Bureau shall maintain a register of contractors and suppliers.
2. — Functions of the Bureau.
The Bureau may issue guidelines and standard bidding documents to every Procuring Entity.
15. — Code of conduct.
(1) Every bidder shall not submit false information to a Procuring Entity.
(2) A Procuring Entity must evaluate all bids received before the deadline.
Provided that the Bureau may waive the requirement in an emergency.
16. — Amendment.
This Act amends the Public Procurement Act Cap P44 LFN 2004 and section 3 of the Fiscal Responsibility Act 2007.
17. — Interpretation.
In this Act, "Bureau" means the Bureau of Public Procurement and "Procuring Entity" includes any public body.
"""


def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_text_pdf(lines: list[str]) -> bytes:
    """Build a one-page text PDF (FlateDecode stream, Helvetica)."""
    ops = ["BT /F1 11 Tf 14 TL 72 740 Td"]
    for ln in lines:
        ops.append(f"({_pdf_escape(ln)}) Tj T*")
    ops.append("ET")
    stream = zlib.compress("\n".join(ops).encode("latin-1", "replace"))

    objects: list[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objects.append(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>")
    objects.append(b"<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(stream)
                   + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
              f"startxref\n{xref_pos}\n%%EOF".encode())
    return out.getvalue()


def make_docx(paragraphs: list[str]) -> bytes:
    body = "".join(
        f"<w:p><w:r><w:t xml:space='preserve'>{p}</w:t></w:r></w:p>"
        for p in paragraphs)
    document = (
        "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
        "<w:document xmlns:w='http://schemas.openxmlformats.org/"
        "wordprocessingml/2006/main'><w:body>" + body + "</w:body></w:document>")
    content_types = (
        "<?xml version='1.0'?><Types xmlns='http://schemas.openxmlformats.org/"
        "package/2006/content-types'><Default Extension='xml' "
        "ContentType='application/xml'/></Types>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("word/document.xml", document)
    return buf.getvalue()


def make_scanned_png(lines: list[str]) -> bytes:
    """Scanned-style page: text drawn on white, plus an embedded tEXt chunk
    carrying a partial OCR text layer (as scanner software often embeds)."""
    from PIL import Image, ImageDraw, PngImagePlugin

    img = Image.new("RGB", (800, 60 + 28 * len(lines)), "white")
    draw = ImageDraw.Draw(img)
    for i, ln in enumerate(lines):
        draw.text((20, 20 + 28 * i), ln, fill="black")
    meta = PngImagePlugin.PngInfo()
    # Partial text layer, lower quality than the source (OCR-ish noise).
    meta.add_text("ocr", "\n".join(lines[:2]))
    buf = io.BytesIO()
    img.save(buf, format="PNG", pnginfo=meta)
    return buf.getvalue()
