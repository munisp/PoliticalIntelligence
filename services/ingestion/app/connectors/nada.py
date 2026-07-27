"""NBS microdata catalog (IHSN NADA) connector — LIVE for METADATA.

Verified (docs/DATA_SOURCES_REAL.md §2):
  GET https://microdata.nigerianstat.gov.ng/index.php/api/catalog/search?ps=N
Catalog metadata is open; the microdata files themselves are
registration/licence-gated (form_model: licensed/direct) — this connector
intentionally ingests only the open catalog metadata as data_source records.
"""
from __future__ import annotations

from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

BASE = "https://microdata.nigerianstat.gov.ng/index.php/api/catalog"


class NadaConnector(BaseConnector):
    name = "nada"
    description = "NBS microdata catalog (IHSN NADA) — survey metadata"
    source_id = "nbs_nada"
    license = "NBS catalog terms (metadata open; microdata licensed)"

    REQUIRED_KEYS = ("source_id", "title")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        ps = int(params.get("page_size", 50))
        sk = params.get("search")
        url = f"{BASE}/search?ps={ps}" + (f"&sk={sk}" if sk else "")
        body = self.get_json(url)
        return [RawRecord(
            provenance=self.provenance(url, body),
            payload={"result": body.get("result", {})},
        )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            for row in rec.payload["result"].get("rows", []):
                out.append(CanonicalRecord(
                    entity="data_source",
                    provenance=rec.provenance,
                    data={
                        "source_id": f"nada:{row.get('idno')}",
                        "title": row.get("title"),
                        "survey_year": row.get("year_start") or row.get("year"),
                        "nation": row.get("nation"),
                        "authoring_entity": row.get("authoring_entity"),
                        "abstract": (row.get("abstract") or "")[:2000],
                        "access": row.get("form_model"),
                        "catalog_url": (
                            "https://microdata.nigerianstat.gov.ng/index.php"
                            f"/catalog/{row.get('id')}"
                        ),
                    },
                ))
        return out
