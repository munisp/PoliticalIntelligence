"""Graph retrieval path: legal/policy dependency traversal.

Uses Neo4j (bolt driver) when NEO4J_URI is configured; otherwise traverses
the seeded in-process graph of laws -> clauses -> agencies -> sectors with
CITES / ENABLES / RESTRICTS / APPLIES_TO edges.
"""
from __future__ import annotations

from collections import defaultdict, deque

from app.config import settings
from app.data import corpus
from app.logging_setup import get_logger
from app.models import EvidenceSource, RetrievalPath, SourceType

log = get_logger("retrieval.graph")

_SECTOR_HINTS = {
    "education": "sector:education", "teacher": "sector:education",
    "school": "sector:education",
    "sme": "sector:sme", "msme": "sector:sme", "business": "sector:sme",
    "procurement": "sector:procurement", "contract": "sector:procurement",
    "agriculture": "sector:agriculture", "farm": "sector:agriculture",
    "health": "sector:health", "clinic": "sector:health",
    "electricity": "sector:electricity", "power": "sector:electricity",
    "grid": "sector:electricity",
}


class GraphAdapter:
    name = "graph"

    @property
    def mode(self) -> str:
        return "neo4j" if settings.neo4j_uri else "inprocess-fallback"

    def __init__(self):
        self._adj: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for src, rel, dst in corpus.GRAPH_EDGES:
            self._adj[src].append((rel, dst))
            self._adj[dst].append((rel, src))  # traversable both ways

    def search(self, query: str, jurisdiction_id: str,
               filters: dict, top_k: int) -> list[EvidenceSource]:
        if settings.neo4j_uri:
            try:
                return self._search_neo4j(query, jurisdiction_id, filters, top_k)
            except Exception as exc:  # pragma: no cover - env dependent
                log.warning(f"neo4j query failed, falling back: {exc}")
        return self._search_inprocess(query, jurisdiction_id, filters, top_k)

    # ------------------------------------------------------------------
    def _seed_nodes(self, query: str, filters: dict) -> list[str]:
        seeds: list[str] = []
        if filters.get("sector") and f"sector:{filters['sector']}" in corpus.GRAPH_NODES:
            seeds.append(f"sector:{filters['sector']}")
        for tok in query.lower().split():
            hint = _SECTOR_HINTS.get(tok.strip(",.;"))
            if hint and hint not in seeds:
                seeds.append(hint)
        if not seeds:  # default: traverse the two richest law nodes
            seeds = ["law:ube-act-2004", "law:ppa-2007"]
        return seeds

    def _search_inprocess(self, query: str, jurisdiction_id: str,
                          filters: dict, top_k: int) -> list[EvidenceSource]:
        seeds = self._seed_nodes(query, filters)
        visited: dict[str, tuple[int, str]] = {}  # node -> (depth, via-rel)
        queue = deque((s, 0, "SEED") for s in seeds)
        max_depth = int(filters.get("max_depth", 2))
        while queue:
            node, depth, rel = queue.popleft()
            if node in visited or depth > max_depth:
                continue
            visited[node] = (depth, rel)
            for edge_rel, nxt in sorted(self._adj.get(node, [])):
                if nxt not in visited:
                    queue.append((nxt, depth + 1, edge_rel))
        ordered = sorted(visited.items(), key=lambda kv: (kv[1][0], kv[0]))
        out: list[EvidenceSource] = []
        for node_id, (depth, rel) in ordered[:top_k]:
            node = corpus.GRAPH_NODES[node_id]
            out.append(EvidenceSource(
                evidence_source_id=f"graph:{node_id}",
                source_type=SourceType.legal if node["type"] in ("law", "clause")
                else SourceType.policy,
                citation=f"Dependency graph: {node['name']} "
                         f"(reached via {rel}, depth {depth})",
                retrieval_path=RetrievalPath.graph,
                confidence=0.0,
                content=f"{node['type'].upper()}: {node['name']} — linked via "
                        f"{rel} at traversal depth {depth}.",
                attributes={"node_id": node_id, "node_type": node["type"],
                            "depth": depth, "relation": rel},
            ))
        return out

    def _search_neo4j(self, query: str, jurisdiction_id: str,
                      filters: dict, top_k: int) -> list[EvidenceSource]:
        from neo4j import GraphDatabase

        driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password))
        cypher = (
            "MATCH (n)-[r]-(m) WHERE n.jurisdiction IN [$jur, 'jur:ng'] "
            "RETURN n, type(r) AS rel, m LIMIT $k")
        out: list[EvidenceSource] = []
        with driver, driver.session() as session:
            for rec in session.run(cypher, jur=jurisdiction_id, k=top_k):
                node = rec["m"]
                out.append(EvidenceSource(
                    evidence_source_id=f"graph:{node['id']}",
                    source_type=SourceType.legal,
                    citation=f"Dependency graph: {node['name']} (via {rec['rel']})",
                    retrieval_path=RetrievalPath.graph,
                    confidence=0.0,
                    content=f"{node.get('type', 'NODE')}: {node['name']}",
                    attributes={"relation": rec["rel"]},
                ))
        return out
