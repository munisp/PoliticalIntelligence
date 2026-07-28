"""ING-8: Airbyte declarative manifest schema validity (no airbyte needed —
structural assertions over the low-code CDK YAML shape)."""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

AIRBYTE_DIR = Path(__file__).resolve().parents[3] / "infra" / "airbyte"

EXPECTED = {
    "source-worldbank.yaml": "indicators",
    "source-hdx.yaml": "datasets",
    "source-overpass.yaml": "elements",
    "source-budeshi.yaml": "releases",
    "source-nada.yaml": "surveys",
    "source-nbs_bulletin.yaml": "publications",
    "source-ubec.yaml": "fact_sheets",
    "source-file_harvester.yaml": "files",
}


@pytest.mark.parametrize("fname,stream", sorted(EXPECTED.items()))
def test_manifest_schema(fname: str, stream: str):
    doc = yaml.safe_load((AIRBYTE_DIR / fname).read_text())
    # top-level low-code CDK shape
    assert doc["version"].startswith("3")
    assert "definitions" in doc and "streams" in doc and "check" in doc and "spec" in doc
    # requester + retriever wired
    req = doc["definitions"]["requester"]
    assert req["type"] == "HttpRequester" and req["url_base"]
    ret = doc["definitions"]["retriever"]
    assert ret["type"] == "SimpleRetriever"
    assert ret["record_selector"]["extractor"]["type"] == "DpathExtractor"
    # stream registered + checked
    sdef = doc["definitions"]["streams"][stream]
    assert sdef["type"] == "DeclarativeStream"
    assert sdef["name"] == stream and sdef["primary_key"]
    assert doc["check"]["stream_names"] == [stream]
    assert doc["streams"] == [{"$ref": f"#/definitions/streams/{stream}"}]
    # provenance tag on every record
    add_fields = sdef["transformations"][0]
    assert add_fields["type"] == "AddFields"
    assert add_fields["fields"][0]["path"] == ["_source"]
    # spec present (UI-renderable)
    assert doc["spec"]["connection_specification"]["type"] == "object"


def test_all_eight_manifests_present():
    found = {p.name for p in AIRBYTE_DIR.glob("source-*.yaml")}
    assert found == set(EXPECTED)
