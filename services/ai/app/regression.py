"""Model/prompt regression harness (golden Q&A set).

Scores the offline synthesizer against a golden set of policy questions:
  - citation presence (answer cites evidence from expected source domains)
  - contract completeness (all required CopilotAnswer contract fields)
  - determinism (identical answers across repeated runs)

Runs fully offline — no GPU or LLM endpoint required. Results are kept in
process and exposed at GET /v1/regression/latest; `run_regression()` is also
exercised by tests/test_regression.py.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from app.llm.offline import synthesize_copilot_answer
from app.llm.router import ModelRouter
from app.retrieval.fusion import HybridRetriever

# ---------------------------------------------------------------------------
# Golden Q&A set: 10 policy questions with expected citation domains.
# expected_domains = substrings expected in at least one citation string.
# ---------------------------------------------------------------------------
GOLDEN_QA: list[dict] = [
    {"q": "How can Kaduna create teaching jobs quickly?",
     "expected_domains": ["education"], "sector": "education"},
    {"q": "What legal instrument governs teacher licensing?",
     "expected_domains": ["licens"], "sector": "education"},
    {"q": "Which interventions grow SME formal employment?",
     "expected_domains": ["sme"], "sector": "sme"},
    {"q": "What does CAMA 2020 require for business registration?",
     "expected_domains": ["cama"], "sector": "sme"},
    {"q": "How should procurement create local jobs?",
     "expected_domains": ["procurement"], "sector": "procurement"},
    {"q": "What margin of preference does the PPA allow?",
     "expected_domains": ["ppa"], "sector": "procurement"},
    {"q": "Which agro-processing investments create rural jobs?",
     "expected_domains": ["agro"], "sector": "agriculture"},
    {"q": "How reliable is the latest labour force data?",
     "expected_domains": ["nbs"], "sector": "education"},
    {"q": "What are the risks in a school meals programme?",
     "expected_domains": ["school"], "sector": "education"},
    {"q": "Which sectors give the highest jobs per naira?",
     "expected_domains": ["job"], "sector": "sme"},
]

REQUIRED_CONTRACT_FIELDS = [
    "answer", "citations", "evidence", "uncertainty", "confidence",
    "model_routing",
]


@dataclass
class QuestionScore:
    question: str
    citations_present: bool
    citation_domains_hit: list[str]
    contract_complete: bool
    deterministic: bool
    score: float


@dataclass
class RegressionReport:
    run_id: str
    started_at: float
    questions: list[QuestionScore] = field(default_factory=list)

    @property
    def pass_rate(self) -> float:
        if not self.questions:
            return 0.0
        passed = sum(1 for q in self.questions if q.score >= 2 / 3)
        return round(passed / len(self.questions), 4)

    def to_dict(self) -> dict:
        return {
            "run_id": self.run_id,
            "questions_total": len(self.questions),
            "pass_rate": self.pass_rate,
            "mean_score": round(
                sum(q.score for q in self.questions) / max(1, len(self.questions)),
                4),
            "questions": [vars(q) for q in self.questions],
        }


_lock = threading.Lock()
_latest: RegressionReport | None = None


def _score_question(retriever: HybridRetriever, router: ModelRouter,
                    spec: dict) -> QuestionScore:
    bundle = retriever.retrieve(spec["q"], "jur:ng-kd", {}, top_k=8)
    _, meta = router.generate("interactive_copilot", spec["q"])
    answer1 = synthesize_copilot_answer(bundle, meta)
    answer2 = synthesize_copilot_answer(bundle, meta)

    citation_text = " ".join(answer1.citations).lower()
    hits = [d for d in spec["expected_domains"] if d in citation_text
            or d in answer1.answer.lower()]
    citations_present = bool(answer1.citations) and bool(hits)
    contract = answer1.model_dump()
    contract_complete = all(
        field in contract and contract[field] not in (None, "")
        for field in REQUIRED_CONTRACT_FIELDS)
    deterministic = answer1.model_dump() == answer2.model_dump()

    score = round(
        (0.5 if citations_present else 0.0)
        + (0.25 if contract_complete else 0.0)
        + (0.25 if deterministic else 0.0), 4)
    return QuestionScore(
        question=spec["q"],
        citations_present=citations_present,
        citation_domains_hit=hits,
        contract_complete=contract_complete,
        deterministic=deterministic,
        score=score)


def run_regression() -> RegressionReport:
    """Run the golden Q&A set against the offline synthesizer."""
    global _latest
    retriever = HybridRetriever()
    router = ModelRouter()
    report = RegressionReport(run_id=f"reg_{int(time.time())}",
                              started_at=time.time())
    for spec in GOLDEN_QA:
        report.questions.append(_score_question(retriever, router, spec))
    with _lock:
        _latest = report
    return report


def latest_report() -> RegressionReport | None:
    with _lock:
        return _latest
