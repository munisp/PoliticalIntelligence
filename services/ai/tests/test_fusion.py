"""Fusion ranking + retrieval adapter tests."""
from __future__ import annotations

from app.models import EvidenceSource, RetrievalPath, SourceType
from app.retrieval.fusion import HybridRetriever, RRF_K


def _ev(eid: str, path: RetrievalPath) -> EvidenceSource:
    return EvidenceSource(
        evidence_source_id=eid, source_type=SourceType.legal,
        citation=f"cite:{eid}", retrieval_path=path,
        confidence=0.0, content=f"content {eid}")


def test_rrf_item_on_multiple_paths_wins():
    shared = _ev("shared", RetrievalPath.vector)
    per_path = {
        RetrievalPath.sql: [_ev("shared", RetrievalPath.sql), _ev("sql-only", RetrievalPath.sql)],
        RetrievalPath.vector: [shared, _ev("vec-only", RetrievalPath.vector)],
        RetrievalPath.graph: [_ev("graph-only", RetrievalPath.graph)],
    }
    fused = HybridRetriever.fuse(per_path, top_k=4)
    assert fused[0].evidence_source_id == "shared"
    # rrf: shared = 1/61 (sql) + 1/61 (vector); singles = 1/61
    assert fused[0].confidence == 1.0
    for ev in fused:
        assert 0.0 < ev.confidence <= 1.0


def test_rrf_rank_order_respected_within_path():
    per_path = {
        RetrievalPath.sql: [_ev("a", RetrievalPath.sql), _ev("b", RetrievalPath.sql),
                            _ev("c", RetrievalPath.sql)],
        RetrievalPath.vector: [], RetrievalPath.graph: [],
    }
    fused = HybridRetriever.fuse(per_path, top_k=3)
    ids = [e.evidence_source_id for e in fused]
    assert ids == ["a", "b", "c"]
    expected_a = 1.0 / (RRF_K + 1)
    expected_b = 1.0 / (RRF_K + 2)
    assert abs(fused[0].confidence - 1.0) < 1e-9
    assert abs(fused[1].confidence - expected_b / expected_a) < 1e-3


def test_rrf_deterministic():
    per_path = {
        RetrievalPath.sql: [_ev("a", RetrievalPath.sql), _ev("b", RetrievalPath.sql)],
        RetrievalPath.vector: [_ev("b", RetrievalPath.vector)],
        RetrievalPath.graph: [_ev("g", RetrievalPath.graph)],
    }
    f1 = HybridRetriever.fuse(per_path, 5)
    f2 = HybridRetriever.fuse(per_path, 5)
    assert [e.model_dump() for e in f1] == [e.model_dump() for e in f2]


def test_end_to_end_retrieval_all_paths():
    retriever = HybridRetriever()
    bundle = retriever.retrieve(
        "teacher licensing education jobs", "jur:ng-kd", {}, top_k=8)
    assert bundle.evidence, "expected evidence"
    paths = {e.retrieval_path for e in bundle.evidence}
    assert RetrievalPath.sql in paths
    assert RetrievalPath.vector in paths
    assert RetrievalPath.graph in paths
    assert bundle.retrieval_paths_used
    assert bundle.adapter_modes["vector"] == "tfidf-fallback"
    # every evidence item conforms to spec section 39 shape
    for ev in bundle.evidence:
        assert ev.evidence_source_id
        assert ev.citation
        assert ev.content
        assert 0.0 < ev.confidence <= 1.0


def test_vector_semantic_relevance():
    retriever = HybridRetriever()
    bundle = retriever.retrieve(
        "school meal programme cooks agriculture", "jur:ng", {}, top_k=5)
    vector_hits = [e for e in bundle.evidence
                   if e.retrieval_path == RetrievalPath.vector]
    assert vector_hits
    assert any("school" in e.content.lower() or "meal" in e.content.lower()
               for e in vector_hits)


def test_graph_traversal_sector_hint():
    retriever = HybridRetriever()
    bundle = retriever.retrieve(
        "electricity mini-grid investment", "jur:ng", {}, top_k=10)
    graph_hits = [e for e in bundle.evidence
                  if e.retrieval_path == RetrievalPath.graph]
    node_ids = {e.attributes.get("node_id") for e in graph_hits}
    assert "sector:electricity" in node_ids
    assert "law:electricity-2023" in node_ids  # reached within 2 hops
