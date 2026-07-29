"""GeoLibre copilot tool tests — template engine over seeded geojsons.

The GeoLibre backend path (GEOLIBRE_URL) is an HTTP seam tested only for
fallback behavior; spatial/metric semantics are pinned against the real
public/geo boundary artifacts and the seeded metrics corpus.
"""
from __future__ import annotations

import pytest

from app.tools import get_tool, list_tools
from app.tools import geolibre_tool as gt


# --- intent parsing ---------------------------------------------------------
def test_parse_corridor_proximity_with_percent_threshold():
    intent = gt.parse_intent(
        "which states within 50km of the Lagos-Calabar corridor have unemployment > 25%?"
    )
    assert intent.kind == "corridor_proximity"
    assert intent.corridor == "lagos-calabar"
    assert intent.radius_km == 50.0
    assert intent.level == "state"
    assert intent.metric == "unemployment_rate"
    assert intent.op == ">"
    assert intent.threshold == pytest.approx(0.25)  # % -> ratio


def test_parse_lga_level_and_absolute_threshold():
    intent = gt.parse_intent(
        "which LGAs within 600km of the lagos calabar corridor have registered smes above 30000?"
    )
    assert intent.level == "lga"
    assert intent.metric == "registered_smes"
    assert intent.op == ">"
    assert intent.threshold == 30000.0  # counts are NOT divided by 100


def test_parse_within_distance_and_per_lga_defaults():
    i1 = gt.parse_intent("show facilities within 10km of Kano")
    assert i1.kind == "within_distance" and i1.corridor is None
    i2 = gt.parse_intent("summarise facilities per LGA in Kaduna")
    assert i2.kind == "per_lga" and i2.level == "lga"


# --- spatial helpers ----------------------------------------------------------
def test_distance_to_corridor_km_seeded_line():
    line = gt.CORRIDORS["lagos-calabar"]
    # Lagos waypoint itself is ~0; Kaduna city is far north (>500km)
    assert gt.distance_to_corridor_km(6.5244, 3.3792, line) < 1.0
    assert gt.distance_to_corridor_km(10.52, 7.44, line) > 400.0


def test_load_boundaries_real_geojsons():
    states, src = gt.load_boundaries("state")
    lgas, src2 = gt.load_boundaries("lga")
    assert src == src2 == "geojson"
    assert len(states) == 37 and len(lgas) == 23
    names = {f["properties"]["name"] for f in states}
    assert {"Lagos", "Kaduna", "Kano"} <= names


# --- end-to-end corridor-proximity question -----------------------------------
def test_corridor_proximity_question_lagos_matches():
    ans = gt.geolibre_geo_qa(
        "which states within 50km of the Lagos-Calabar corridor have unemployment > 24%?"
    )
    assert ans["geo_engine"] == "template"
    assert ans["data_source"] == "geojson"
    names = [r["name"] for r in ans["results"]]
    assert names == ["Lagos"]
    row = ans["results"][0]
    assert row["jurisdiction_id"] == "jur:ng-la"
    assert row["metric_value"] == pytest.approx(0.244)
    assert row["centroid_distance_km"] < 50
    assert "Lagos" in ans["answer"] and "24.4%" in ans["answer"]


def test_corridor_proximity_map_payload_has_corridor_and_matches():
    ans = gt.geolibre_geo_qa(
        "states within 50km of the Lagos-Calabar corridor with unemployment above 24%"
    )
    payload = ans["map_payload"]
    kinds = [f["properties"]["kind"] for f in payload["features"]]
    assert kinds[0] == "corridor"
    assert payload["features"][0]["geometry"]["type"] == "LineString"
    assert len(payload["features"][0]["geometry"]["coordinates"]) == 7
    assert "match" in kinds


def test_threshold_excludes_when_too_high():
    ans = gt.geolibre_geo_qa(
        "states within 50km of the Lagos-Calabar corridor with unemployment > 25%"
    )
    assert ans["results"] == []
    assert "No states" in ans["answer"]
    # Lagos had data but failed the threshold — not a caveat
    assert not any(c.startswith("Lagos") for c in ans["caveats"])


def test_unmapped_jurisdictions_surface_honest_caveats():
    ans = gt.geolibre_geo_qa(
        "states within 100km of the Lagos-Calabar corridor with unemployment > 10%"
    )
    # States near the corridor without seeded metrics (e.g. Edo) are caveated
    assert any("no jurisdiction mapping" in c or "no seeded metric data" in c
               for c in ans["caveats"])


def test_determinism_identical_questions_identical_answers():
    q = "which states within 200km of the Lagos-Calabar corridor have unemployment > 20%?"
    a1 = gt.geolibre_geo_qa(q)
    a2 = gt.geolibre_geo_qa(q)
    assert a1 == a2


def test_geolibre_backend_fallback_when_unreachable(monkeypatch):
    monkeypatch.setenv("GEOLIBRE_URL", "http://127.0.0.1:1/unreachable")
    ans = gt.geolibre_geo_qa(
        "states within 50km of the Lagos-Calabar corridor with unemployment > 24%"
    )
    # honest fallback: template engine marker despite GEOLIBRE_URL being set
    assert ans["geo_engine"] == "template"
    assert [r["name"] for r in ans["results"]] == ["Lagos"]


# --- registry -----------------------------------------------------------------
def test_tool_registered_in_copilot_registry():
    names = [t.name for t in list_tools()]
    assert "geolibre_geo_qa" in names
    spec = get_tool("geolibre_geo_qa")
    assert spec is not None and "geo" in spec.tags
    ans = spec.handler(question="states within 50km of the Lagos-Calabar "
                                "corridor with unemployment > 24%")
    assert ans["results"][0]["name"] == "Lagos"
