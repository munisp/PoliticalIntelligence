"""HDX (Humanitarian Data Exchange) CKAN API connector — LIVE.

Verified (docs/DATA_SOURCES_REAL.md §8):
  GET https://data.humdata.org/api/3/action/package_search?q=...&rows=N
Resources (CSV/SHP/GeoJSON/XLSX) are downloadable without auth; GRID3 and
HFR health-facility datasets are republished here.

Emits: facilities (from CSV resources with lat/lon columns) and admin_units
(boundary datasets are registered as data_source catalog entries with their
resource URLs — geometry ingestion happens downstream).
"""
from __future__ import annotations

import csv
import io

from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

CKAN = "https://data.humdata.org/api/3/action"

# Common lat/lon header spellings across HDX/GRID3/HXL CSV exports.
LAT_KEYS = ("latitude", "lat", "y", "geo_lat", "#geo+lat")
LON_KEYS = ("longitude", "lon", "long", "lng", "x", "geo_lon", "#geo+lon")
NAME_KEYS = ("name", "facility_name", "facility", "school_name", "admin2name_en")
TYPE_KEYS = ("type", "facility_type", "amenity", "category")


def _first(row: dict, keys: tuple[str, ...]) -> str | None:
    lowered = {k.lower(): v for k, v in row.items()}
    for k in keys:
        if lowered.get(k):
            return str(lowered[k])
    return None


class HDXConnector(BaseConnector):
    name = "hdx"
    description = "HDX CKAN API — boundaries, health facilities, GRID3 datasets"
    source_id = "hdx_ckan"
    license = "varies-per-dataset (see dataset license_id)"

    REQUIRED_KEYS = ("name",)

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        queries = params.get("queries") or [f"{params.get('country', 'nigeria')}"]
        max_rows = int(params.get("rows", 5))
        download_csv = bool(params.get("download_csv", True))
        max_csv_rows = int(params.get("max_csv_rows", 500))
        raw: list[RawRecord] = []
        for q in queries:
            url = f"{CKAN}/package_search?q={q}&rows={max_rows}"
            body = self.get_json(url)
            raw.append(RawRecord(
                provenance=self.provenance(url, body),
                payload={"query": q, "result": body.get("result", {})},
            ))
            if not download_csv:
                continue
            for pkg in body.get("result", {}).get("results", []):
                for res in pkg.get("resources", []):
                    if (res.get("format") or "").lower() != "csv":
                        continue
                    try:
                        resp = self.client.get(res["url"])
                        resp.raise_for_status()
                    except Exception:
                        continue  # resource-level failures don't fail the run
                    text = resp.text
                    rows = list(csv.DictReader(io.StringIO(text)))[:max_csv_rows]
                    raw.append(RawRecord(
                        provenance=self.provenance(res["url"], {"rows": len(rows)}),
                        payload={
                            "package": pkg.get("name"),
                            "resource": res.get("name"),
                            "resource_url": res["url"],
                            "csv_rows": rows,
                        },
                    ))
        return raw

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            p = rec.payload
            if "csv_rows" in p:
                for row in p["csv_rows"]:
                    lat, lon = _first(row, LAT_KEYS), _first(row, LON_KEYS)
                    name = _first(row, NAME_KEYS)
                    if not name or not lat or not lon:
                        continue
                    try:
                        latf, lonf = float(lat), float(lon)
                    except ValueError:
                        continue
                    out.append(CanonicalRecord(
                        entity="facility",
                        provenance=rec.provenance,
                        data={
                            "name": name,
                            "type": (_first(row, TYPE_KEYS) or "unknown")[:64],
                            "lat": latf,
                            "lon": lonf,
                            "source": f"hdx:{p.get('package')}",
                        },
                    ))
            else:
                for pkg in p.get("result", {}).get("results", []):
                    resources = pkg.get("resources", [])
                    out.append(CanonicalRecord(
                        entity="data_source",
                        provenance=rec.provenance,
                        data={
                            "source_id": f"hdx:{pkg.get('name')}",
                            "title": pkg.get("title"),
                            "organization": (pkg.get("organization") or {}).get("title"),
                            "dataset_date": pkg.get("dataset_date"),
                            "resource_count": len(resources),
                            "formats": sorted({(r.get("format") or "") for r in resources}),
                            "catalog_url": f"https://data.humdata.org/dataset/{pkg.get('name')}",
                        },
                    ))
        return out
