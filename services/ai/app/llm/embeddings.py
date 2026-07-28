"""Embedding job for the vector path (docs/LLM.md §Embeddings).

Backend order:
  1. sentence-transformers (optional extra `pip install sentence-transformers`,
     lazily imported; model from EMBEDDING_MODEL, default all-MiniLM-L6-v2).
  2. DEFAULT: deterministic hashing embedding (documented): each token maps
     via md5 to (index, sign) in a 384-dim vector, L2-normalized. No model
     download, fully reproducible across runs/machines — a lexical baseline
     that strictly replaces the previous TF-IDF-only fallback for k-NN.
     (TF-IDF retrieval itself remains in retrieval/vector_adapter.py.)

Indexed vectors go to OpenSearch k-NN when OPENSEARCH_URL is configured
(opensearch-py optional extra); otherwise embeddings are written to a JSONL
artifact (EMBEDDINGS_OUT, default artifacts/embeddings.jsonl) for replay.

Batch reindex:
    python -m app.llm.embeddings reindex
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any

import numpy as np

from app.config import settings
from app.logging_setup import get_logger

log = get_logger("llm.embeddings")

EMBEDDING_DIM = 384
DEFAULT_OUT = "artifacts/embeddings.jsonl"

_st_model: Any = None


def _sentence_transformer():
    """Lazy optional sentence-transformers backend; None when unavailable."""
    global _st_model
    if _st_model is not None:
        return _st_model
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        _st_model = SentenceTransformer(os.getenv("EMBEDDING_MODEL",
                                                  "all-MiniLM-L6-v2"))
    except Exception:
        _st_model = None
    return _st_model


def hashing_embed(text: str, dim: int = EMBEDDING_DIM) -> np.ndarray:
    """Deterministic signed hashing embedding (documented default)."""
    vec = np.zeros(dim, dtype=np.float64)
    for tok in re.findall(r"[a-z0-9]+", text.lower()):
        digest = hashlib.md5(tok.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "big") % dim
        sign = 1.0 if digest[4] & 1 else -1.0
        vec[idx] += sign
    norm = math.sqrt(float(vec @ vec))
    return vec / norm if norm > 0 else vec


def embed_texts(texts: list[str], backend: str = "auto") -> np.ndarray:
    """Embed texts; backend: auto | sentence-transformers | hashing."""
    if backend in ("auto", "sentence-transformers"):
        model = _sentence_transformer()
        if model is not None:
            return np.asarray(model.encode(texts, normalize_embeddings=True),
                              dtype=np.float64)
        if backend == "sentence-transformers":
            raise RuntimeError("sentence-transformers is not installed")
    return np.stack([hashing_embed(t) for t in texts])


def backend_name() -> str:
    return "sentence-transformers" if _sentence_transformer() is not None \
        else "hashing"


def _corpus_texts() -> list[dict[str, str]]:
    from app.data import corpus
    return [
        {"id": p.get("id", f"passage:{i}"),
         "text": p.get("content", ""),
         "jurisdiction_id": p.get("jurisdiction", "jur:ng")}
        for i, p in enumerate(corpus.PASSAGES)
    ]


def _index_opensearch(rows: list[dict[str, Any]]) -> int:
    from opensearchpy import OpenSearch  # type: ignore  # optional extra
    client = OpenSearch(settings.opensearch_url)
    index = os.getenv("OPENSEARCH_KNN_INDEX", "policy-embeddings")
    if not client.indices.exists(index=index):
        client.indices.create(index=index, body={
            "settings": {"index": {"knn": True}},
            "mappings": {"properties": {
                "passage_id": {"type": "keyword"},
                "jurisdiction_id": {"type": "keyword"},
                "text": {"type": "text"},
                "embedding": {"type": "knn_vector",
                              "dimension": EMBEDDING_DIM},
            }},
        })
    for row in rows:
        client.index(index=index, id=row["passage_id"], body=row,
                     refresh=False)
    client.indices.refresh(index=index)
    return len(rows)


def reindex(batch_size: int = 64, backend: str = "auto",
            out_path: str | None = None) -> dict[str, Any]:
    """Batch-embed the corpus; push to OpenSearch k-NN or JSONL artifact."""
    texts = _corpus_texts()
    rows: list[dict[str, Any]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        vectors = embed_texts([t["text"] for t in batch], backend=backend)
        for t, v in zip(batch, vectors):
            rows.append({"passage_id": t["id"],
                         "jurisdiction_id": t["jurisdiction_id"],
                         "text": t["text"],
                         "embedding": [round(float(x), 6) for x in v]})
    if settings.opensearch_url:
        try:
            n = _index_opensearch(rows)
            return {"indexed": n, "sink": "opensearch",
                    "backend": backend_name()}
        except Exception as exc:  # fall through to JSONL artifact
            log.warning("opensearch k-NN indexing failed, writing JSONL: %s",
                        exc)
    path = Path(out_path or os.getenv("EMBEDDINGS_OUT", DEFAULT_OUT))
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    return {"indexed": len(rows), "sink": str(path),
            "backend": backend_name()}


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args or args[0] != "reindex":
        print("usage: python -m app.llm.embeddings reindex [--backend NAME] "
              "[--out PATH]")
        return 2
    backend = "auto"
    out = None
    if "--backend" in args:
        backend = args[args.index("--backend") + 1]
    if "--out" in args:
        out = args[args.index("--out") + 1]
    summary = reindex(backend=backend, out_path=out)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
