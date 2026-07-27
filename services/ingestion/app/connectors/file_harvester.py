"""File harvester — scheduled download + checksum of XLSX/PDF/CSV bulletins.

Targets DOWNLOAD-class sources (docs/DATA_SOURCES_REAL.md §4): Budget Office
appropriation acts / implementation reports (PDF/XLSX), Open Treasury CSVs.

Parsing is stdlib-only (zip + xml for XLSX, csv module for CSV) — NO pandas.
PDF files are harvested (checksum + provenance) but text extraction is left
to the downstream document pipeline; a parser hook can be registered.
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from typing import Any, Callable
from xml.etree import ElementTree as ET

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector, checksum_bytes

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def parse_xlsx_rows(data: bytes, max_rows: int = 1000) -> list[dict[str, Any]]:
    """Minimal stdlib XLSX reader: first sheet, first row = header."""
    rows: list[list[str]] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{_NS}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{_NS}t")))
        sheet_name = next(
            (n for n in zf.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n)),
            None,
        )
        if not sheet_name:
            return []
        sheet = ET.fromstring(zf.read(sheet_name))
        for row in sheet.iter(f"{_NS}row"):
            cells: list[str] = []
            for c in row.findall(f"{_NS}c"):
                v = c.find(f"{_NS}v")
                text = v.text if v is not None else ""
                if c.get("t") == "s" and text:
                    text = shared[int(text)]
                cells.append(text or "")
            rows.append(cells)
            if len(rows) > max_rows:
                break
    if not rows:
        return []
    header = [h.strip().lower().replace(" ", "_") for h in rows[0]]
    return [
        {header[i]: cell for i, cell in enumerate(r) if i < len(header)}
        for r in rows[1:]
        if any(r)
    ]


def parse_csv_rows(text: str, max_rows: int = 1000) -> list[dict[str, Any]]:
    return list(csv.DictReader(io.StringIO(text)))[:max_rows]


ParserHook = Callable[[bytes, str], list[dict[str, Any]]]


class FileHarvesterConnector(BaseConnector):
    name = "file_harvester"
    description = "Scheduled download + checksum of portal files (XLSX/CSV/PDF)"
    source_id = "file_harvester"
    license = "varies-per-portal"

    REQUIRED_KEYS = ()

    def __init__(self, *args, parser_hook: ParserHook | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.parser_hook = parser_hook

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        files = params.get("files")
        if not files:
            raise ServiceError(
                code="INVALID_PARAMS",
                message="file_harvester requires params.files: [{url, kind?}]",
                http_status=400,
            )
        raw: list[RawRecord] = []
        for f in files:
            url = f["url"]
            kind = (f.get("kind") or url.rsplit(".", 1)[-1]).lower()
            resp = self.client.get(url)
            if resp.status_code >= 400:
                # Harvest is best-effort per file; record the failure with
                # provenance rather than failing the whole run.
                raw.append(RawRecord(
                    provenance=self.provenance(url, {"status": resp.status_code}),
                    payload={"url": url, "kind": kind, "error": resp.status_code,
                             "rows": []},
                ))
                continue
            data = resp.content
            rows: list[dict[str, Any]] = []
            if self.parser_hook:
                rows = self.parser_hook(data, kind)
            elif kind == "csv":
                rows = parse_csv_rows(resp.text, int(params.get("max_rows", 1000)))
            elif kind in ("xlsx", "xls"):
                rows = parse_xlsx_rows(data, int(params.get("max_rows", 1000)))
            # pdf/others: harvested (checksum + provenance), parsed downstream.
            prov = self.provenance(url, {"bytes": len(data)})
            prov.checksum = checksum_bytes(data)
            raw.append(RawRecord(
                provenance=prov,
                payload={"url": url, "kind": kind, "rows": rows,
                         "bytes": len(data)},
            ))
        return raw

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            p = rec.payload
            out.append(CanonicalRecord(
                entity="data_source",
                provenance=rec.provenance,
                data={
                    "source_id": f"file:{p['url'].rsplit('/', 1)[-1]}",
                    "title": p["url"].rsplit("/", 1)[-1],
                    "catalog_url": p["url"],
                    "kind": p["kind"],
                    "bytes": p.get("bytes"),
                    "row_count": len(p.get("rows", [])),
                    **({"error": p["error"]} if p.get("error") else {}),
                },
            ))
            # Parsed tabular rows are surfaced as derived metric payloads for
            # downstream mapping (portal layouts vary too much to auto-map).
            for row in p.get("rows", []):
                out.append(CanonicalRecord(
                    entity="sector_metric",
                    provenance=rec.provenance.model_copy(update={"origin": "derived"}),
                    data={
                        "jurisdiction_id": "unassigned",
                        "sector_code": "general",
                        "metric_key": "bulletin_row",
                        "value": 0.0,
                        "period": "unknown",
                        "raw_row": row,
                    },
                ))
        return out
