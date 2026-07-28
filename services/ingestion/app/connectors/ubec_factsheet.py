"""UBEC factsheet portal connector — PORTAL class, METADATA ONLY.

Fetches the Universal Basic Education Commission publications/resources
index (ubec.gov.ng), extracts the latest factsheet / digest links and
publication dates, and emits `data_source` freshness/catalog records.

Like nbs_bulletin, this connector records publication metadata only —
education statistics themselves are ingested via API-class sources or
human-reviewed file harvests; nothing is fabricated.
"""
from __future__ import annotations

from app.models import CanonicalRecord, RawRecord
from app.connectors.portal import PortalConnector

INDEX_URL = "https://ubec.gov.ng/"


class UbecFactsheetConnector(PortalConnector):
    name = "ubec_factsheet"
    description = (
        "UBEC factsheet portal (ubec.gov.ng) — latest factsheet/digest "
        "links + dates as data_source metadata (no statistic fabrication)"
    )
    source_id = "ubec_portal"
    license = "UBEC portal terms (public index pages)"
    max_record_age_days = 370  # annual digest cadence

    index_url = INDEX_URL
    publication_markers = (".pdf", "factsheet", "fact sheet", "digest", "statistics")

    REQUIRED_KEYS = ("source_id", "title")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        url = params.get("index_url", self.index_url)
        html = self.get_page(url)
        publications = self.extract_publications(html)
        limit = int(params.get("max_publications", 25))
        return [RawRecord(
            provenance=self.provenance(url, {"publications": publications[:limit]}),
            payload={"index_url": url, "publications": publications[:limit]},
        )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            pubs = rec.payload["publications"]
            latest = pubs[0] if pubs else None
            out.append(CanonicalRecord(
                entity="data_source",
                provenance=rec.provenance,
                data={
                    "source_id": "ubec_portal",
                    "title": "Universal Basic Education Commission — factsheet portal",
                    "category": "education_statistics",
                    "index_url": rec.payload["index_url"],
                    "publication_count": len(pubs),
                    "latest_publication_title": latest["title"] if latest else None,
                    "latest_publication_url": latest["url"] if latest else None,
                    "latest_publication_date": latest["published_on"] if latest else None,
                    "publications": pubs,
                },
            ))
        return out
