"""Embedding indexer (AI-1/AI-2/AI-4/AI-12, docs/LLM.md §Embeddings).

DEFAULT indexer — runs with NO GPU and NO external services:

  * Passages are collected from the retrieval corpus (laws/clauses/policy
    briefs/evidence passages in app.data.corpus) plus any number of JSONL
    passage exports listed in INDEXER_EXTRA_JSONL (comma-separated; one
    {"id","type","jurisdiction","title","citation","content"} object per
    line — e.g. exported platform laws/clauses/documents/briefs/evidence).
  * Each passage is embedded with the deterministic hashing embedding
    (app.llm.embeddings.hashing_embed) unless the optional
    sentence-transformers backend is installed.
  * Vectors are persisted to a JSONL artifact (INDEXER_OUT, default
    artifacts/passage-vectors.jsonl) AND bulk-indexed into OpenSearch as a
    k-NN index when OPENSEARCH_URL is configured (plain httpx `_bulk`, no
    opensearch-py dependency).

CLI:
    python -m app.retrieval.indexer reindex [--backend auto|hashing|sentence-transformers]
                                            [--out PATH] [--batch-size N]

Scheduler hook: `start_index_scheduler()` runs `reindex` on an interval
(INDEXER_INTERVAL_SECONDS); wired into the FastAPI lifespan in app.main when
the env var is set. `python -m app.retrieval.indexer schedule` blocks in the
loop (compose/systemd friendly).
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any, Iterable

from app.config import settings
from app.llm.embeddings import EMBEDDING_DIM, backend_name, embed_texts
from app.logging_setup import get_logger

log = get_logger("retrieval.indexer")

DEFAULT_OUT = "artifacts/passage-vectors.jsonl"
KNN_INDEX_ENV = "OPENSEARCH_KNN_INDEX"
DEFAULT_KNN_INDEX = "policy-embeddings"

REQUIRED_KEYS = ("id", "type", "jurisdiction", "title", "citation", "content")


def knn_index_name() -> str:
    return os.getenv(KNN_INDEX_ENV, DEFAULT_KNN_INDEX)


# ---------------------------------------------------------------------------
# Passage collection
# ---------------------------------------------------------------------------
def _corpus_passages() -> list[dict[str, str]]:
    from app.data import corpus

    return [
        {
            "id": str(p.get("id", f"passage:{i}")),
            "type": str(p.get("type", "legal")),
            "jurisdiction": str(p.get("jurisdiction", "jur:ng")),
            "title": str(p.get("title", "")),
            "citation": str(p.get("citation", "")),
            "content": str(p.get("content", "")),
        }
        for i, p in enumerate(corpus.PASSAGES)
    ]


def _jsonl_passages(path: str) -> Iterable[dict[str, str]]:
    with open(path, "r", encoding="utf-8") as fh:
        for ln, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            missing = [k for k in REQUIRED_KEYS if k not in row]
            if missing:
                raise ValueError(f"{path}:{ln} missing keys {missing}")
            yield {k: str(row[k]) for k in REQUIRED_KEYS}


def collect_passages(extra_jsonl: list[str] | None = None) -> list[dict[str, str]]:
    """Corpus passages + optional JSONL exports (dedup by id, corpus wins)."""
    sources = extra_jsonl
    if sources is None:
        env = os.getenv("INDEXER_EXTRA_JSONL", "")
        sources = [p for p in (s.strip() for s in env.split(",")) if p]
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for passage in _corpus_passages():
        seen.add(passage["id"])
        out.append(passage)
    for src in sources:
        for passage in _jsonl_passages(src):
            if passage["id"] in seen:
                continue
            seen.add(passage["id"])
            out.append(passage)
    return out


# ---------------------------------------------------------------------------
# Sinks
# ---------------------------------------------------------------------------
def write_jsonl(rows: list[dict[str, Any]], out_path: str | None = None) -> str:
    path = Path(out_path or os.getenv("INDEXER_OUT", DEFAULT_OUT))
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
    return str(path)


def _opensearch_bulk(rows: list[dict[str, Any]]) -> int:
    """Bulk-index rows into the k-NN index via the OpenSearch HTTP API."""
    import httpx

    base = settings.opensearch_url
    assert base, "OPENSEARCH_URL not configured"
    index = knn_index_name()
    # Ensure a k-NN mapping exists (idempotent create; 400 = already exists).
    mapping = {
        "settings": {"index": {"knn": True}},
        "mappings": {"properties": {
            "passage_id": {"type": "keyword"},
            "type": {"type": "keyword"},
            "jurisdiction": {"type": "keyword"},
            "title": {"type": "text"},
            "citation": {"type": "text"},
            "content": {"type": "text"},
            "embedding": {"type": "knn_vector", "dimension": EMBEDDING_DIM},
        }},
    }
    resp = httpx.put(f"{base}/{index}", json=mapping, timeout=15.0)
    if resp.status_code >= 400 and "resource_already_exists" not in resp.text:
        resp.raise_for_status()
    lines: list[str] = []
    for row in rows:
        lines.append(json.dumps({"index": {"_index": index,
                                           "_id": row["passage_id"]}}))
        lines.append(json.dumps(row))
    bulk = "\n".join(lines) + "\n"
    resp = httpx.post(f"{base}/_bulk?refresh=true",
                      content=bulk,
                      headers={"Content-Type": "application/x-ndjson"},
                      timeout=60.0)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("errors"):
        first = next(i for i in payload["items"] if "error" in i["index"])
        raise RuntimeError(f"opensearch bulk errors, first: {first['index']['error']}")
    return len(rows)


# ---------------------------------------------------------------------------
# Reindex
# ---------------------------------------------------------------------------
def reindex(batch_size: int = 64, backend: str = "auto",
            out_path: str | None = None,
            extra_jsonl: list[str] | None = None) -> dict[str, Any]:
    """Batch-embed every passage and persist vectors (JSONL + OpenSearch)."""
    passages = collect_passages(extra_jsonl)
    rows: list[dict[str, Any]] = []
    for i in range(0, len(passages), batch_size):
        batch = passages[i:i + batch_size]
        vectors = embed_texts([p["content"] for p in batch], backend=backend)
        for p, v in zip(batch, vectors):
            rows.append({
                "passage_id": p["id"],
                "type": p["type"],
                "jurisdiction": p["jurisdiction"],
                "title": p["title"],
                "citation": p["citation"],
                "content": p["content"],
                "embedding": [round(float(x), 6) for x in v],
            })
    result: dict[str, Any] = {
        "indexed": len(rows),
        "backend": backend_name(),
        "dim": EMBEDDING_DIM,
        "sinks": [],
    }
    artifact = write_jsonl(rows, out_path)
    result["sinks"].append({"jsonl": artifact})
    if settings.opensearch_url:
        try:
            n = _opensearch_bulk(rows)
            result["sinks"].append({"opensearch": knn_index_name(),
                                    "indexed": n})
        except Exception as exc:  # JSONL artifact is the durable fallback
            log.warning("opensearch bulk indexing failed (JSONL kept): %s", exc)
            result["sinks"].append({"opensearch_error": str(exc)})
    log.info("reindex complete", extra={"request_id": "-",
                                        "model_tier": result["backend"]})
    return result


# ---------------------------------------------------------------------------
# Scheduler hook
# ---------------------------------------------------------------------------
_stop = threading.Event()


def start_index_scheduler(interval_seconds: float | None = None,
                          **reindex_kwargs) -> threading.Thread:
    """Background reindex loop (INDEXER_INTERVAL_SECONDS). Returns the thread."""
    interval = interval_seconds or float(
        os.getenv("INDEXER_INTERVAL_SECONDS", "86400"))

    def _loop() -> None:
        while not _stop.is_set():
            try:
                summary = reindex(**reindex_kwargs)
                log.info("scheduled reindex ok: %s", summary)
            except Exception as exc:  # keep the loop alive
                log.error("scheduled reindex failed: %s", exc)
            _stop.wait(interval)

    thread = threading.Thread(target=_loop, name="passage-indexer",
                              daemon=True)
    thread.start()
    return thread


def stop_index_scheduler() -> None:
    _stop.set()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    if not args or args[0] not in ("reindex", "schedule"):
        print("usage: python -m app.retrieval.indexer "
              "{reindex|schedule} [--backend NAME] [--out PATH] "
              "[--batch-size N]")
        return 2

    def _opt(name: str, default: str | None = None) -> str | None:
        return args[args.index(name) + 1] if name in args else default

    kwargs: dict[str, Any] = {
        "backend": _opt("--backend", "auto"),
        "batch_size": int(_opt("--batch-size", "64") or 64),
    }
    if args[0] == "reindex":
        kwargs["out_path"] = _opt("--out")
        print(json.dumps(reindex(**kwargs), indent=2))
        return 0
    # schedule: block forever (compose/systemd entrypoint)
    interval = float(_opt("--interval", os.getenv("INDEXER_INTERVAL_SECONDS",
                                                  "86400")) or 86400)
    start_index_scheduler(interval_seconds=interval, **kwargs)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:  # pragma: no cover
        stop_index_scheduler()
        return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
