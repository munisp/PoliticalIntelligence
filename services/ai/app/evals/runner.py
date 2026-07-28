"""Eval suite runner: score the fixed pack against an OpenAI-compatible
endpoint (or an injected httpx transport in tests)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

import httpx

from app.evals.pack import BUNDLE, EVAL_PACK, EvalCase

CHAT_PATH = "/v1/chat/completions"
_CITATION_RE = re.compile(r"\[(\d{1,2})\]")


@dataclass
class EvalResult:
    case_id: str
    category: str
    passed: bool
    detail: str
    response_excerpt: str = ""


@dataclass
class SuiteResult:
    score: float
    passed: bool
    gate: float
    results: list[EvalResult] = field(default_factory=list)

    @property
    def by_category(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = {}
        for r in self.results:
            c = out.setdefault(r.category, {"passed": 0, "total": 0})
            c["total"] += 1
            c["passed"] += int(r.passed)
        return out


def _chat(client: httpx.Client, base_url: str, case: EvalCase,
          model: str, timeout: float) -> str:
    resp = client.post(
        f"{base_url.rstrip('/')}{CHAT_PATH}",
        json={"model": model, "messages": case.messages,
              "temperature": 0.0, "max_tokens": case.max_tokens},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _valid_citation(text: str) -> bool:
    return any(1 <= int(n) <= len(BUNDLE) for n in _CITATION_RE.findall(text))


def _schema_ok(text: str, schema: dict[str, str]) -> bool:
    cleaned = text.strip()
    if cleaned.startswith("```"):  # tolerate fenced JSON
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    try:
        obj = json.loads(cleaned)
    except (ValueError, TypeError):
        return False
    if not isinstance(obj, dict):
        return False
    for key, type_name in schema.items():
        if key not in obj:
            return False
        value = obj[key]
        if type_name == "number":
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                return False
        elif type_name == "str":
            if not isinstance(value, str):
                return False
        elif type_name == "list":
            if not isinstance(value, list):
                return False
    return True


def score_case(case: EvalCase, text: str) -> EvalResult:
    low = text.lower()
    failures: list[str] = []
    for group in case.must_include:
        if not any(tok.lower() in low for tok in group):
            failures.append(f"missing one of {group}")
    for tok in case.must_exclude:
        if tok.lower() in low:
            failures.append(f"contains forbidden token {tok!r}")
    if case.require_citation and not _valid_citation(text):
        failures.append("no valid [n] citation marker")
    if case.refusal_markers and not any(m in low for m in case.refusal_markers):
        failures.append("no refusal marker")
    if case.schema and not _schema_ok(text, case.schema):
        failures.append("JSON schema non-conformance")
    return EvalResult(
        case_id=case.case_id, category=case.category,
        passed=not failures,
        detail="ok" if not failures else "; ".join(failures),
        response_excerpt=text[:200],
    )


def run_suite(endpoint: str, gate: float = 0.8, model: str = "qwen3-8b",
              timeout: float = 60.0,
              transport: httpx.BaseTransport | None = None,
              pack: list[EvalCase] | None = None) -> SuiteResult:
    """Run the full pack; returns a SuiteResult (passed = score >= gate).

    `transport` lets tests inject httpx.MockTransport — the same pattern as
    tests/test_serving.py — so the harness is fully deterministic offline.
    """
    cases = pack if pack is not None else EVAL_PACK
    results: list[EvalResult] = []
    with httpx.Client(transport=transport) as client:
        for case in cases:
            try:
                text = _chat(client, endpoint, case, model, timeout)
            except Exception as exc:
                results.append(EvalResult(
                    case_id=case.case_id, category=case.category,
                    passed=False, detail=f"request failed: {type(exc).__name__}"))
                continue
            results.append(score_case(case, text))
    score = (sum(r.passed for r in results) / len(results)) if results else 0.0
    return SuiteResult(score=round(score, 4), passed=score >= gate,
                       gate=gate, results=results)
