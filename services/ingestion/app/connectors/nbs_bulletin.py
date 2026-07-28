"""NBS bulletin portal connector — PORTAL class, METADATA ONLY.

Fetches the National Bureau of Statistics publication index page
(www.nigerianstat.gov.ng), extracts the latest bulletin/report links and
their publication dates, and emits `data_source` freshness/catalog records.

This connector deliberately does NOT extract indicator values from PDFs —
no fabricated statistics. Values enter the platform only through API-class
connectors or licensed, human-reviewed channels (docs/DATA_SOURCES_REAL.md).
"""
from __future__ import annotations

from app.models import CanonicalRecord, RawRecord
from app.connectors.portal import PortalConnector

INDEX_URL = "https://www.nigerianstat.gov.ng/"


class NbsBulletinConnector(PortalConnector):
    name = "nbs_bulletin"
    description = (
        "NBS bulletin portal (nigerianstat.gov.ng) — latest publication "
        "links + dates as data_source metadata (no statistic fabrication)"
    )
    source_id = "nbs_portal"
    license = "NBS portal terms (public index pages)"
    max_record_age_days = 45  # bulletins are monthly/quarterly

    index_url = INDEX_URL
    publication_markers = (".pdf", "bulletin", "report", "digest")

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
                    "source_id": "nbs_portal",
                    "title": "National Bureau of Statistics — bulletin portal",
                    "category": "official_statistics",
                    "index_url": rec.payload["index_url"],
                    "publication_count": len(pubs),
                    "latest_publication_title": latest["title"] if latest else None,
                    "latest_publication_url": latest["url"] if latest else None,
                    "latest_publication_date": latest["published_on"] if latest else None,
                    "publications": pubs,
                },
            ))
        return out
