"""CLI: python -m app.evals.run --endpoint http://vllm-qwen3-8b:8000 --gate 0.8

Exit code 0 when the suite score meets the gate, 1 otherwise. This is the
go-live gate referenced by docs/GPU-GOLIVE.md.
"""
from __future__ import annotations

import argparse
import sys

from app.evals.runner import run_suite


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="app.evals.run",
                                description="Go-live eval gate for the GPU "
                                            "LLM tier.")
    p.add_argument("--endpoint", required=True,
                   help="Base URL of the OpenAI-compatible endpoint")
    p.add_argument("--gate", type=float, default=0.8,
                   help="Minimum suite score to pass (default 0.8)")
    p.add_argument("--model", default="qwen3-8b")
    p.add_argument("--timeout", type=float, default=60.0)
    args = p.parse_args(argv)

    suite = run_suite(args.endpoint, gate=args.gate, model=args.model,
                      timeout=args.timeout)
    for r in suite.results:
        mark = "PASS" if r.passed else "FAIL"
        print(f"[{mark}] {r.case_id}: {r.detail}")
    print("\nBy category:")
    for cat, c in suite.by_category.items():
        print(f"  {cat}: {c['passed']}/{c['total']}")
    print(f"\nSuite score: {suite.score:.2%} (gate {suite.gate:.0%}) -> "
          f"{'PASS' if suite.passed else 'FAIL'}")
    return 0 if suite.passed else 1


if __name__ == "__main__":
    sys.exit(main())
