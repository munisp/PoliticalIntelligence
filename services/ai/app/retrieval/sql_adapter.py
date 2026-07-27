"""SQL retrieval path: analytical metrics & jurisdiction profiles.

Uses a Trino/Postgres endpoint when SQL_DSN is configured (via httpx against
the Trino HTTP protocol); otherwise falls back to the seeded in-process
Nigeria pilot dataset. Both paths return ranked evidence candidates with
provenance.
"""
from __future__ import annotations

from app.config import settings
from app.data import corpus
from app.logging_setup import get_logger
from app.models import EvidenceSource, RetrievalPath, SourceType

log = get_logger("retrieval.sql")


class SqlAdapter:
    name = "sql"

    @property
    def mode(self) -> str:
        return "trino" if settings.sql_dsn else "seeded-fallback"

    def search(self, query: str, jurisdiction_id: str,
               filters: dict, top_k: int) -> list[EvidenceSource]:
        if settings.sql_dsn:
            try:
                return self._search_trino(query, jurisdiction_id, filters, top_k)
            except Exception as exc:  # pragma: no cover - env dependent
                log.warning(f"trino query failed, falling back to seed: {exc}")
        return self._search_seed(query, jurisdiction_id, filters, top_k)

    # ------------------------------------------------------------------
    def _search_seed(self, query: str, jurisdiction_id: str,
                     filters: dict, top_k: int) -> list[EvidenceSource]:
        terms = set(query.lower().split())
        include_federal = filters.get("include_federal", True)

        def jur_ok(jur: str) -> bool:
            if jurisdiction_id in ("jur:ng", ""):
                return True
            return jur == jurisdiction_id or (include_federal and jur == "jur:ng")

        results: list[tuple[float, EvidenceSource]] = []
        for m in corpus.METRICS:
            if not jur_ok(m["jurisdiction"]):
                continue
            text = f"{m['metric']} {m['source']}".lower()
            score = sum(1.0 for t in terms if t in text or t in m["metric"])
            ev = EvidenceSource(
                evidence_source_id=m["id"],
                source_type=SourceType.metric,
                citation=f"{m['source']} — {m['metric']} ({m['period']})",
                retrieval_path=RetrievalPath.sql,
                confidence=0.0,  # set by fusion
                content=(f"{m['metric']} = {m['value']} {m['unit']} "
                         f"[{m['jurisdiction']}, {m['period']}] source: {m['source']}"),
                attributes=m,
            )
            results.append((score, ev))
        for p in corpus.PROFILES:
            if not jur_ok(p["jurisdiction"]):
                continue
            text = p["content"].lower()
            score = sum(1.0 for t in terms if t in text)
            ev = EvidenceSource(
                evidence_source_id=p["id"],
                source_type=SourceType.profile,
                citation=f"Jurisdiction profile — {p['name']}",
                retrieval_path=RetrievalPath.sql,
                confidence=0.0,
                content=p["content"],
                attributes=p,
            )
            results.append((score, ev))
        # relevance gate: require at least one query-term match; if nothing
        # matched, still return the jurisdiction profile as minimal context.
        matched = [r for r in results if r[0] > 0]
        if not matched:
            matched = [r for r in results
                       if r[1].source_type == SourceType.profile]
        matched.sort(key=lambda t: (-t[0], t[1].evidence_source_id))
        return [ev for _, ev in matched[:top_k]]

    def _search_trino(self, query: str, jurisdiction_id: str,
                      filters: dict, top_k: int) -> list[EvidenceSource]:
        """Trino HTTP protocol client (POST /v1/statement)."""
        import httpx

        metric_filter = filters.get("metric")
        where = f"jurisdiction_id = '{jurisdiction_id}'"
        if metric_filter:
            where += f" AND metric = '{metric_filter}'"
        sql = ("SELECT id, metric, value, unit, period, source FROM metrics "
               f"WHERE {where} LIMIT {top_k}")
        resp = httpx.post(f"{settings.sql_dsn}/v1/statement", content=sql,
                          timeout=10.0)
        resp.raise_for_status()
        payload = resp.json()
        out = []
        for row in payload.get("data", []):
            rid, metric, value, unit, period, source = row
            out.append(EvidenceSource(
                evidence_source_id=str(rid),
                source_type=SourceType.metric,
                citation=f"{source} — {metric} ({period})",
                retrieval_path=RetrievalPath.sql,
                confidence=0.0,
                content=f"{metric} = {value} {unit} [{period}] source: {source}",
                attributes={"jurisdiction": jurisdiction_id},
            ))
        return out
