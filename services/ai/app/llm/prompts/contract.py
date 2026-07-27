"""§9.2 output-contract validation for LLM JSON output.

The offline synthesizer (app.llm.offline) produces the Recommendation
contract deterministically; when a live LLM answers instead, its JSON output
must satisfy the SAME contract. This module validates raw LLM text and, on
failure, supports exactly one repair retry (the caller re-prompts with the
validation error appended).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

REQUIRED_LIST_KEYS = (
    "assumptions", "evidence_base", "budget_ranges", "timeline",
    "implementation_actors", "legal_dependencies", "risk_register", "kpis",
    "simulation_scenarios",
)
REQUIRED_SCALAR_KEYS = ("title", "rationale", "estimated_jobs", "confidence")


@dataclass
class ContractResult:
    ok: bool
    data: dict[str, Any] | None = None
    errors: list[str] = field(default_factory=list)
    repaired: bool = False  # True when JSON had to be extracted from prose


def extract_json(raw: str) -> tuple[dict[str, Any] | None, bool, str | None]:
    """Extract a JSON object from raw LLM output.

    Returns (obj, repaired, error). `repaired` is True when the object had
    to be recovered from markdown fences or surrounding prose."""
    text = raw.strip()
    try:
        obj = json.loads(text)
        return (obj if isinstance(obj, dict) else None), False, (
            None if isinstance(obj, dict) else "top-level JSON is not an object")
    except json.JSONDecodeError:
        pass
    # Repair: strip code fences.
    fenced = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE)
    # Repair: take the first balanced {...} block.
    start = fenced.find("{")
    if start == -1:
        return None, False, "no JSON object found in output"
    depth = 0
    for i in range(start, len(fenced)):
        if fenced[i] == "{":
            depth += 1
        elif fenced[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    obj = json.loads(fenced[start:i + 1])
                    if isinstance(obj, dict):
                        return obj, True, None
                    return None, True, "top-level JSON is not an object"
                except json.JSONDecodeError as exc:
                    return None, True, f"JSON parse error: {exc}"
    return None, True, "unbalanced braces in output"


def validate_recommendation_contract(raw: str) -> ContractResult:
    """Validate raw LLM output against the §9.2 contract shape."""
    obj, repaired, err = extract_json(raw)
    if obj is None:
        return ContractResult(ok=False, errors=[err or "unparseable"],
                              repaired=repaired)
    errors: list[str] = []
    for key in REQUIRED_SCALAR_KEYS:
        if key not in obj:
            errors.append(f"missing required key: {key}")
    for key in REQUIRED_LIST_KEYS:
        value = obj.get(key)
        if not isinstance(value, list):
            errors.append(f"key must be a list: {key}")
    evidence = obj.get("evidence_base")
    if isinstance(evidence, list):
        if len(evidence) < 1:
            errors.append("evidence_base must contain at least 1 item")
        elif not all(isinstance(e, dict) and e.get("citation") for e in evidence):
            errors.append("every evidence_base item needs a citation")
    conf = obj.get("confidence")
    if conf is not None and not (isinstance(conf, (int, float))
                                 and 0.0 <= float(conf) <= 1.0):
        errors.append("confidence must be a number in [0, 1]")
    jobs = obj.get("estimated_jobs")
    if jobs is not None and not isinstance(jobs, int):
        errors.append("estimated_jobs must be an integer")
    return ContractResult(ok=not errors, data=obj if not errors else None,
                          errors=errors, repaired=repaired)


def repair_prompt(original_prompt: str, bad_output: str,
                  errors: list[str]) -> str:
    """Prompt for the single allowed repair retry."""
    return (
        f"{original_prompt}\n\n"
        "Your previous answer FAILED the output contract:\n"
        + "\n".join(f"- {e}" for e in errors)
        + "\nPrevious answer:\n" + bad_output[:2000]
        + "\nReturn ONLY the corrected JSON object."
    )


def generate_with_contract(router: Any, workload_class: str, prompt: str,
                           request_id: str = "-",
                           max_repairs: int = 1
                           ) -> tuple[dict[str, Any] | None, Any, ContractResult]:
    """Generate via the router and validate against the §9.2 contract.

    On contract failure, re-prompt once with the validation errors. Returns
    (parsed_json | None, routing_meta, final ContractResult). Callers fall
    back to the offline synthesizer when parsed_json is None."""
    text, meta = router.generate(workload_class, prompt,
                                 request_id=request_id)
    if text is None:
        return None, meta, ContractResult(ok=False, errors=["offline"])
    result = validate_recommendation_contract(text)
    attempts = 0
    while not result.ok and attempts < max_repairs:
        attempts += 1
        text, meta = router.generate(
            workload_class,
            repair_prompt(prompt, text, result.errors),
            request_id=request_id)
        if text is None:
            return None, meta, ContractResult(ok=False, errors=["offline"])
        result = validate_recommendation_contract(text)
    return (result.data if result.ok else None), meta, result
