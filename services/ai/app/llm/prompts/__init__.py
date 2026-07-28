"""Versioned prompt bundles (docs/LLM.md §Prompt versioning).

Prompts are code artifacts: every bundle carries a version and a changelog;
a generation result can always be traced to (model version, prompt bundle
name, bundle version). The offline synthesizer and the LLM path share the
SAME §9.2 output contract — enforced by `app.llm.prompts.contract` on any
LLM JSON output.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class PromptBundle:
    name: str
    version: str
    system: str
    user_template: str  # {query}, {jurisdiction_id}, {evidence} placeholders
    changelog: tuple[str, ...] = field(default_factory=tuple)

    def render(self, query: str, jurisdiction_id: str, evidence: str) -> str:
        return self.user_template.format(
            query=query, jurisdiction_id=jurisdiction_id, evidence=evidence)


_CONTRACT_PREAMBLE = (
    "You are the Meridian Policy Twin generation engine. Respond with a "
    "SINGLE JSON object only (no markdown fences, no commentary). The object "
    "MUST satisfy the section 9.2 recommendation contract: keys title, "
    "rationale, assumptions (list), evidence_base (list of >=1 items each "
    "with a citation), estimated_jobs (int), budget_ranges, timeline, "
    "implementation_actors, legal_dependencies, risk_register, kpis, "
    "simulation_scenarios, confidence (0..1). Cite evidence ids verbatim."
)

BUNDLES: dict[str, PromptBundle] = {
    "recommendation_v1": PromptBundle(
        name="recommendation_v1",
        version="1.0.0",
        system=_CONTRACT_PREAMBLE,
        user_template=(
            "Policy query: {query}\nJurisdiction: {jurisdiction_id}\n"
            "Evidence:\n{evidence}\n\nReturn the recommendation JSON."),
        changelog=(
            "1.0.0 initial bundle: JSON contract preamble + evidence ids",
        ),
    ),
    "copilot_grounded_v1": PromptBundle(
        name="copilot_grounded_v1",
        version="1.0.0",
        system=(
            "You are the Policy Twin copilot. Answer ONLY from the supplied "
            "evidence; append [evidence_source_id] citations to every claim. "
            "If the evidence is insufficient, say so and set uncertainty "
            "high. Never invent statistics."),
        user_template=(
            "Q: {query}\nJurisdiction: {jurisdiction_id}\n"
            "Evidence:\n{evidence}\n\nAnswer with citations."),
        changelog=(
            "1.0.0 initial bundle: grounded answers, refusal on thin evidence",
        ),
    ),
    "brief_memo_v1": PromptBundle(
        name="brief_memo_v1",
        version="1.0.0",
        system=(
            "You draft executive brief sections for senior government "
            "officials. Tone: concise, decision-oriented. Every section must "
            "reference at least one citation id from the evidence bundle. "
            "Output plain prose paragraphs (no lists unless asked)."),
        user_template=(
            "Brief topic: {query}\nJurisdiction: {jurisdiction_id}\n"
            "Evidence:\n{evidence}\n\nDraft the section."),
        changelog=(
            "1.0.0 initial bundle: executive memo style, citation floor",
        ),
    ),
    "legal_extract_v1": PromptBundle(
        name="legal_extract_v1",
        version="1.0.0",
        system=(
            "You extract legal obligations, prohibitions, and powers from "
            "legislation excerpts as JSON: {obligations: [{clause, text, "
            "actor, modality}], citations: [...]}. Do not paraphrase clause "
            "numbers; quote them verbatim."),
        user_template=(
            "Extraction target: {query}\nJurisdiction: {jurisdiction_id}\n"
            "Excerpt:\n{evidence}\n\nReturn the obligations JSON."),
        changelog=(
            "1.0.0 initial bundle: obligation/modality schema",
        ),
    ),
}


def get_bundle(name: str) -> PromptBundle:
    if name not in BUNDLES:
        raise KeyError(f"unknown prompt bundle: {name}")
    return BUNDLES[name]
