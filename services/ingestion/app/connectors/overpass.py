"""OpenStreetMap Overpass connector — LIVE (verified via mirror, §10).

POSTs Overpass QL to a mirror (default overpass.kumi.systems — verified
working in docs/DATA_SOURCES_REAL.md), retries to overpass-api.de, always
with a descriptive User-Agent. Extracts schools / clinics / hospitals /
markets in a named admin area -> facilities with lat/lon.
"""
from __future__ import annotations

import httpx

from app.config import settings
from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

AMENITY_MAP = {
    "school": "school",
    "clinic": "clinic",
    "hospital": "hospital",
    "marketplace": "market",
}

QUERY_TMPL = """
[out:json][timeout:{timeout}];
area["name"="{area}"]["admin_level"="{admin_level}"]->.a;
(
  node["amenity"="{amenity}"](area.a);
  way["amenity"="{amenity}"](area.a);
);
out center {limit};
""".strip()


class OverpassConnector(BaseConnector):
    name = "overpass"
    description = "OSM Overpass — POI facilities (schools/clinics/markets) by admin area"
    source_id = "osm_overpass"
    license = "ODbL-1.0 (OpenStreetMap contributors)"

    REQUIRED_KEYS = ("name", "type", "lat", "lon")

    def _build_query(self, params: dict) -> tuple[str, str]:
        area = params.get("area_name") or params.get("area") or "Kaduna"
        admin_level = str(params.get("admin_level", 4))
        amenity = params.get("amenity", "school")
        if amenity not in AMENITY_MAP:
            raise ServiceError(
                code="INVALID_PARAMS",
                message=f"amenity must be one of {sorted(AMENITY_MAP)}",
                http_status=400,
            )
        limit = int(params.get("limit", 500))
        timeout = int(params.get("timeout", 60))
        q = QUERY_TMPL.format(
            area=area, admin_level=admin_level, amenity=amenity,
            limit=limit, timeout=timeout,
        )
        return q, amenity

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        query, amenity = self._build_query(params)
        mirrors = params.get("mirrors") or list(settings.overpass_mirrors)
        last_exc: Exception | None = None
        for mirror in mirrors:
            url = mirror if isinstance(mirror, str) else str(mirror)
            try:
                resp = self.client.post(url, data={"data": query})
                resp.raise_for_status()
                body = resp.json()
                return [RawRecord(
                    provenance=self.provenance(url, body),
                    payload={"amenity": amenity, "query": query,
                             "elements": body.get("elements", [])},
                )]
            except (httpx.HTTPError, ValueError) as exc:
                last_exc = exc
                continue
        raise ServiceError(
            code="SOURCE_FETCH_FAILED",
            message=f"overpass: all mirrors failed ({last_exc})",
            http_status=502,
            retryable=True,
            details={"mirrors": mirrors},
        )

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            amenity = rec.payload["amenity"]
            for el in rec.payload["elements"]:
                tags = el.get("tags", {})
                lat = el.get("lat") or (el.get("center") or {}).get("lat")
                lon = el.get("lon") or (el.get("center") or {}).get("lon")
                if lat is None or lon is None:
                    continue
                out.append(CanonicalRecord(
                    entity="facility",
                    provenance=rec.provenance,
                    data={
                        "name": tags.get("name") or f"{amenity} osm:{el.get('id')}",
                        "type": AMENITY_MAP[amenity],
                        "lat": float(lat),
                        "lon": float(lon),
                        "source": f"osm:{el.get('type')}/{el.get('id')}",
                    },
                ))
        return out
