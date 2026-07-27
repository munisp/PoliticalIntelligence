"""VLM backend — vision-language model over the platform's vLLM endpoint.

OpenAI-compatible vision chat (VLLM_BASE_URL, model e.g. Qwen2.5-VL /
Qwen3-VL) for scanned/complex pages and clause semantics. When no endpoint
is configured (or the call fails), a deterministic heuristic extractor keeps
the pipeline functional offline — mirroring services/ai's offline
synthesizer discipline.
"""
from __future__ import annotations

import base64

import httpx

from app.config import settings
from app.logging_setup import get_logger
from app.models import ExtractionResult, Page, TextSpan

log = get_logger("ocr.vlm")

OCR_PROMPT = (
    "You are an OCR engine for legal/government documents. Transcribe ALL "
    "text on this page exactly, preserving line order and section numbers. "
    "Output plain text only — no commentary."
)

CLAUSE_PROMPT = (
    "Extract the numbered legal clauses from this document text. Return one "
    "clause per line as: <section-path> | <clause text>. No commentary."
)


def online() -> bool:
    return bool(settings.vllm_base_url)


def _chat_vision(prompt: str, image_b64: str | None = None,
                 max_tokens: int = 4096) -> str | None:
    """OpenAI-compatible chat completion; None on any failure."""
    if not online():
        return None
    content: list[dict] = [{"type": "text", "text": prompt}]
    if image_b64:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{image_b64}"},
        })
    headers = {"Content-Type": "application/json"}
    if settings.vllm_api_key:
        headers["Authorization"] = f"Bearer {settings.vllm_api_key}"
    try:
        resp = httpx.post(
            f"{settings.vllm_base_url}/v1/chat/completions",
            json={
                "model": settings.vlm_model,
                "messages": [{"role": "user", "content": content}],
                "temperature": 0.0,
                "max_tokens": max_tokens,
            },
            headers=headers,
            timeout=settings.vlm_timeout_seconds,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        log.warning("vlm call failed: %s", type(exc).__name__)
        return None


# ---------------------------------------------------------------------------
def extract(data: bytes, filename: str) -> ExtractionResult:
    """Transcribe a page image via the VLM; deterministic fallback offline."""
    text = _chat_vision(OCR_PROMPT, base64.b64encode(data).decode())
    if text is None:
        return _extract_fallback(data, filename)
    spans = [TextSpan(text=ln.strip(), confidence=0.85)
             for ln in text.splitlines() if ln.strip()]
    return ExtractionResult(
        pages=[Page(page_number=1, kind="scanned", spans=spans,
                    backend="vlm")],
        backend="vlm",
        structure={"reading_order": "vlm", "sections": []},
    )


def assist_clauses(text: str) -> list[tuple[str, str]] | None:
    """VLM-assisted clause split: [(section_path, clause_text)] or None."""
    out = _chat_vision(CLAUSE_PROMPT + "\n\n" + text[:12000])
    if not out:
        return None
    clauses: list[tuple[str, str]] = []
    for line in out.splitlines():
        if "|" not in line:
            continue
        path, _, body = line.partition("|")
        if path.strip() and body.strip():
            clauses.append((path.strip(), body.strip()))
    return clauses or None


def _extract_fallback(data: bytes, filename: str) -> ExtractionResult:
    """Offline heuristic: no VLM, no readable text — empty page flagged for
    human review (never fabricates content)."""
    page = Page(page_number=1, kind="scanned",
                spans=[TextSpan(text="", confidence=0.0)],
                backend="vlm-fallback", needs_review=True)
    return ExtractionResult(pages=[page], backend="vlm-fallback",
                            fallback_used=True,
                            structure={"reading_order": "unknown",
                                       "sections": []})
