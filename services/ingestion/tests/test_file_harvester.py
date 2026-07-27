"""File harvester tests: stdlib XLSX/CSV parsing, checksum, failure tolerance."""
import io
import zipfile

from app.connectors.file_harvester import (FileHarvesterConnector,
                                           parse_csv_rows, parse_xlsx_rows)
from tests.test_connectors import mock_client

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def make_xlsx(header: list[str], rows: list[list[str]]) -> bytes:
    def esc(s):
        return s.replace("&", "&amp;").replace("<", "&lt;")

    shared = [esc(c) for c in header + [c for r in rows for c in r]]
    shared_xml = (
        f'<?xml version="1.0"?><sst xmlns="{NS}">'
        + "".join(f"<si><t>{s}</t></si>" for s in shared)
        + "</sst>"
    )
    all_rows = [header] + rows
    rows_xml = ""
    counter = 0
    for r in all_rows:
        cells = ""
        for _ in r:
            cells += f'<c t="s"><v>{counter}</v></c>'
            counter += 1
        rows_xml += f"<row>{cells}</row>"
    sheet_xml = (
        f'<?xml version="1.0"?><worksheet xmlns="{NS}">'
        f"<sheetData>{rows_xml}</sheetData></worksheet>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("xl/sharedStrings.xml", shared_xml)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    return buf.getvalue()


def test_parse_xlsx_rows_stdlib():
    data = make_xlsx(["Item", "Amount"], [["Schools", "1200"], ["Roads", "3400"]])
    rows = parse_xlsx_rows(data)
    assert rows == [
        {"item": "Schools", "amount": "1200"},
        {"item": "Roads", "amount": "3400"},
    ]


def test_parse_csv_rows():
    rows = parse_csv_rows("a,b\n1,2\n3,4\n")
    assert rows == [{"a": "1", "b": "2"}, {"a": "3", "b": "4"}]


def test_harvester_fetches_and_checksums():
    xlsx = make_xlsx(["Vote", "Naira"], [["Health", "500"]])
    conn = FileHarvesterConnector(client=mock_client({
        "budget.xlsx": (200, xlsx),
    }))
    raw = conn.fetch("ng", None, {"files": [
        {"url": "https://budgetoffice.gov.ng/files/budget.xlsx"}]})
    prov = raw[0].provenance
    assert prov.checksum.startswith("sha256:")
    assert prov.origin == "live"
    out = conn.normalize(raw)
    ds = [r for r in out if r.entity == "data_source"][0]
    assert ds.data["row_count"] == 1
    derived = [r for r in out if r.entity == "sector_metric"][0]
    assert derived.provenance.origin == "derived"
    assert derived.data["raw_row"] == {"vote": "Health", "naira": "500"}


def test_harvester_tolerates_failed_file():
    conn = FileHarvesterConnector(client=mock_client({}))
    raw = conn.fetch("ng", None, {"files": [
        {"url": "https://opentreasury.gov.ng/payments.csv"}]})
    assert raw[0].payload["error"] == 404
    out = conn.normalize(raw)
    assert out[0].data["error"] == 404


def test_harvester_requires_files_param():
    import pytest
    from app.errors import ServiceError
    conn = FileHarvesterConnector(client=mock_client({}))
    with pytest.raises(ServiceError) as ei:
        conn.fetch("ng", None, {})
    assert ei.value.code == "INVALID_PARAMS"
