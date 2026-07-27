"""Vector retrieval path: semantic passage search.

Uses OpenSearch (k-NN / BM25) when OPENSEARCH_URL is configured; otherwise a
deterministic TF-IDF cosine index over the seeded legal/policy corpus
implemented in numpy — no external embedding service required.
"""
from __future__ import annotations

import re
from collections import Counter

import numpy as np

from app.config import settings
from app.data import corpus
from app.logging_setup import get_logger
from app.models import EvidenceSource, RetrievalPath, SourceType

log = get_logger("retrieval.vector")

_TOKEN = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


class _TfIdfIndex:
    """Deterministic TF-IDF cosine similarity over the seeded corpus."""

    def __init__(self, docs: list[dict]):
        self.docs = docs
        self.doc_tokens = [_tokens(d["content"] + " " + d["title"]) for d in docs]
        df: Counter = Counter()
        for toks in self.doc_tokens:
            df.update(set(toks))
        n = len(docs)
        self.vocab = sorted(df)
        self.idf = np.array([np.log((1 + n) / (1 + df[t])) + 1.0 for t in self.vocab])
        self.vocab_index = {t: i for i, t in enumerate(self.vocab)}
        self.matrix = np.stack([self._vectorize(toks) for toks in self.doc_tokens])

    def _vectorize(self, toks: list[str]) -> np.ndarray:
        counts = Counter(toks)
        vec = np.zeros(len(self.vocab))
        for t, c in counts.items():
            idx = self.vocab_index.get(t)
            if idx is not None:  # ignore out-of-vocabulary query tokens
                vec[idx] = c
        vec *= self.idf
        norm = np.linalg.norm(vec)
        return vec / norm if norm else vec

    def search(self, query: str, top_k: int) -> list[tuple[int, float]]:
        q = self._vectorize(_tokens(query))
        scores = self.matrix @ q
        order = np.argsort(-scores)
        return [(int(i), float(scores[i])) for i in order[:top_k] if scores[i] > 0]


_INDEX: _TfIdfIndex | None = None


def _index() -> _TfIdfIndex:
    global _INDEX
    if _INDEX is None:
        _INDEX = _TfIdfIndex(corpus.PASSAGES)
    return _INDEX


class VectorAdapter:
    name = "vector"

    @property
    def mode(self) -> str:
        return "opensearch" if settings.opensearch_url else "tfidf-fallback"

    def search(self, query: str, jurisdiction_id: str,
               filters: dict, top_k: int) -> list[EvidenceSource]:
        if settings.opensearch_url:
            try:
                return self._search_opensearch(query, jurisdiction_id, filters, top_k)
            except Exception as exc:  # pragma: no cover - env dependent
                log.warning(f"opensearch query failed, falling back: {exc}")
        return self._search_tfidf(query, jurisdiction_id, filters, top_k)

    # ------------------------------------------------------------------
    def _search_tfidf(self, query: str, jurisdiction_id: str,
                      filters: dict, top_k: int) -> list[EvidenceSource]:
        type_filter = filters.get("source_type")
        out: list[EvidenceSource] = []
        for idx, score in _index().search(query, top_k=top_k * 3):
            doc = corpus.PASSAGES[idx]
            if jurisdiction_id not in ("jur:ng", "") and \
                    doc["jurisdiction"] not in (jurisdiction_id, "jur:ng"):
                continue
            if type_filter and doc["type"] != type_filter:
                continue
            out.append(EvidenceSource(
                evidence_source_id=doc["id"],
                source_type=SourceType(doc["type"]),
                citation=doc["citation"],
                retrieval_path=RetrievalPath.vector,
                confidence=0.0,
                content=doc["content"],
                attributes={"title": doc["title"], "tfidf_score": round(score, 4),
                            "jurisdiction": doc["jurisdiction"]},
            ))
            if len(out) >= top_k:
                break
        return out

    def _search_opensearch(self, query: str, jurisdiction_id: str,
                           filters: dict, top_k: int) -> list[EvidenceSource]:
        import httpx

        body = {
            "size": top_k,
            "query": {"bool": {
                "must": [{"match": {"content": query}}],
                "filter": [{"terms": {"jurisdiction": [jurisdiction_id, "jur:ng"]}}],
            }},
        }
        resp = httpx.post(
            f"{settings.opensearch_url}/{settings.opensearch_index}/_search",
            json=body, timeout=10.0)
        resp.raise_for_status()
        hits = resp.json()["hits"]["hits"]
        return [
            EvidenceSource(
                evidence_source_id=h["_id"],
                source_type=SourceType(h["_source"].get("type", "legal")),
                citation=h["_source"]["citation"],
                retrieval_path=RetrievalPath.vector,
                confidence=0.0,
                content=h["_source"]["content"],
                attributes={"opensearch_score": h["_score"]},
            )
            for h in hits
        ]
