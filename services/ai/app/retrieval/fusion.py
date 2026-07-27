"""Reciprocal-rank fusion (RRF) across the three retrieval paths (spec 20)."""
from __future__ import annotations

import uuid

from app.models import (EvidenceBundle, EvidenceSource, RetrievalPath)
from app.retrieval.graph_adapter import GraphAdapter
from app.retrieval.sql_adapter import SqlAdapter
from app.retrieval.vector_adapter import VectorAdapter

RRF_K = 60.0  # standard RRF smoothing constant

# Path weights: legal passages & metrics outweigh raw graph hits slightly.
PATH_WEIGHTS = {
    RetrievalPath.sql: 1.0,
    RetrievalPath.vector: 1.0,
    RetrievalPath.graph: 0.8,
}


class HybridRetriever:
    def __init__(self, sql: SqlAdapter | None = None,
                 vector: VectorAdapter | None = None,
                 graph: GraphAdapter | None = None):
        self.sql = sql or SqlAdapter()
        self.vector = vector or VectorAdapter()
        self.graph = graph or GraphAdapter()

    def adapter_modes(self) -> dict[str, str]:
        return {"sql": self.sql.mode, "vector": self.vector.mode,
                "graph": self.graph.mode}

    def retrieve(self, query: str, jurisdiction_id: str,
                 filters: dict, top_k: int) -> EvidenceBundle:
        per_path = {
            RetrievalPath.sql: self.sql.search(query, jurisdiction_id, filters, top_k),
            RetrievalPath.vector: self.vector.search(query, jurisdiction_id, filters, top_k),
            RetrievalPath.graph: self.graph.search(query, jurisdiction_id, filters, top_k),
        }
        fused = self.fuse(per_path, top_k)
        return EvidenceBundle(
            bundle_id=f"evb:{uuid.uuid4().hex[:12]}",
            query=query,
            jurisdiction_id=jurisdiction_id,
            evidence=fused,
            retrieval_paths_used=[p for p, items in per_path.items() if items],
            adapter_modes=self.adapter_modes(),
        )

    @staticmethod
    def fuse(per_path: dict[RetrievalPath, list[EvidenceSource]],
             top_k: int) -> list[EvidenceSource]:
        """Reciprocal-rank fusion; confidence = normalized fused score."""
        scores: dict[str, float] = {}
        items: dict[str, EvidenceSource] = {}
        for path, ranked in per_path.items():
            weight = PATH_WEIGHTS.get(path, 1.0)
            for rank, ev in enumerate(ranked):
                key = ev.evidence_source_id
                scores[key] = scores.get(key, 0.0) + weight / (RRF_K + rank + 1)
                if key not in items:
                    items[key] = ev
        if not scores:
            return []
        max_score = max(scores.values())
        ordered = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))

        # Path-diversity guarantee: a path that produced candidates must
        # contribute at least one item to the fused bundle (promote its best
        # item into the tail if RRF crowded it out). Deterministic.
        head = ordered[:top_k]
        paths_in_head = {items[k].retrieval_path for k, _ in head}
        for path in sorted(per_path, key=lambda p: p.value):
            if not per_path[path] or path in paths_in_head:
                continue
            best = next(((k, s) for k, s in ordered
                         if items[k].retrieval_path == path), None)
            if best is None:
                continue
            if len(head) < top_k:
                head.append(best)
            else:
                head[-1] = best
            paths_in_head.add(path)

        out: list[EvidenceSource] = []
        for key, score in head:
            ev = items[key].model_copy(
                update={"confidence": round(score / max_score, 4)})
            out.append(ev)
        return out
