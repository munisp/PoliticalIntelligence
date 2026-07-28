"""Deterministic go-live eval harness (G1, docs/GPU-GOLIVE.md).

A fixed pack of eval cases is scored against any OpenAI-compatible
endpoint (vLLM / Ray Serve) or a mock transport in tests. The suite is
deterministic: fixed prompts, fixed expected predicates, binary per-case
scores, no sampling variance beyond the endpoint itself. Go-live is gated
on `python -m app.evals.run --endpoint ... --gate 0.8` passing.
"""
from app.evals.pack import EVAL_PACK, EvalCase
from app.evals.runner import EvalResult, SuiteResult, run_suite

__all__ = ["EVAL_PACK", "EvalCase", "EvalResult", "SuiteResult", "run_suite"]
