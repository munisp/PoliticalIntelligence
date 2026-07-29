"""Geo-analytics job tests — pure-Python spatial predicates + driver.

The Sedona/PySpark path is exercised only when pyspark is installed (the
compose spark-sedona service / k8s job); here we pin the shared spatial
semantics against the real seeded boundary geojsons + facility fixtures.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from app.geo_analytics import sedona_jobs as sj

REPO = Path(__file__).resolve().parents[3]
KADUNA_LGAS = REPO / "public" / "geo" / "kaduna-lgas.geojson"
NIGERIA_STATES = REPO / "public" / "geo" / "nigeria-states.geojson"

KADUNA_CITY = (7.44, 10.52)  # (lon, lat) inside Kaduna North area


def _facility(fid, lat, lon, ftype="school", name=None):
    return sj.Facility(
        facility_id=fid, name=name or fid, type=ftype, lat=lat, lon=lon
    )


@pytest.fixture(scope="module")
def kaduna_features():
    return sj.load_boundaries(KADUNA_LGAS)


# --- spatial predicates ----------------------------------------------------
def test_haversine_matches_known_pair():
    # Lagos (6.5244, 3.3792) -> Abuja (9.0765, 7.3986) ≈ 535 km
    d = sj.haversine_km(6.5244, 3.3792, 9.0765, 7.3986)
    assert 500 < d < 570
    assert sj.haversine_km(6.5244, 3.3792, 6.5244, 3.3792) == pytest.approx(0.0)


def test_point_in_feature_real_boundary(kaduna_features):
    kd = next(
        f for f in kaduna_features
        if (f["properties"].get("name") or "").startswith("Kaduna North")
    )
    assert sj.point_in_feature(*KADUNA_CITY, kd)
    # Calabar is definitively not in Kaduna North LGA
    assert not sj.point_in_feature(8.3417, 4.9757, kd)


def test_point_in_ring_simple_square():
    ring = [(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0), (0.0, 0.0)]
    assert sj.point_in_ring(2.0, 2.0, ring)
    assert not sj.point_in_ring(5.0, 2.0, ring)


def test_distance_to_line_km_endpoints_and_segment():
    line = [(3.0, 6.0), (4.0, 6.0)]  # ~111 km east-west at lat 6
    d_end = sj.distance_to_line_km(6.0, 2.0, line)
    assert d_end == pytest.approx(sj.haversine_km(6.0, 2.0, 6.0, 3.0), rel=0.02)
    d_mid = sj.distance_to_line_km(6.5, 3.5, line)  # ~55km north of midpoint
    assert 40 < d_mid < 70
    assert sj.distance_to_line_km(6.0, 3.5, line) < 1.0  # on the line


# --- aggregations -----------------------------------------------------------
def test_facilities_per_lga_joins_and_counts(kaduna_features):
    facs = [
        _facility("fac:1", *KADUNA_CITY[::-1], "school"),
        _facility("fac:2", 10.5201, 7.4401, "clinic"),
        _facility("fac:3", 4.9757, 8.3417, "school"),  # Calabar — outside all
    ]
    rows = sj.facilities_per_lga(kaduna_features, facs)
    assert len(rows) == len(kaduna_features)  # zero-count rows retained
    total = sum(r["facility_count"] for r in rows)
    assert total == 2  # Calabar facility joins nothing
    kd = next(r for r in rows if "Kaduna North" in r["name"])
    assert kd["facility_count"] == 2
    assert kd["by_type"] == {"clinic": 1, "school": 1}
    assert kd["facility_ids"] == ["fac:1", "fac:2"]
    assert [r["unit_id"] for r in rows] == sorted(r["unit_id"] for r in rows)


def test_corridor_proximity_radius_filter(kaduna_features):
    # A facility 10km from Lagos and one deep in Kaduna (far from corridor)
    facs = [
        _facility("fac:near", 6.6, 3.4, "port"),
        _facility("fac:far", 10.52, 7.44, "school"),
    ]
    rows = sj.corridor_proximity(
        kaduna_features, facs, sj.LAGOS_CALABAR_CORRIDOR, 50.0
    )
    assert all(r["facility_count"] == 0 for r in rows)
    assert all(r["nearest_facility_km"] is None for r in rows)
    # Kaduna centroids are >500km from the coastal corridor
    assert not any(r["within_radius"] for r in rows)

    # Widen radius hugely — Kaduna rows flip
    rows2 = sj.corridor_proximity(
        kaduna_features, facs, sj.LAGOS_CALABAR_CORRIDOR, 900.0
    )
    kd = next(r for r in rows2 if "Kaduna North" in r["name"])
    assert kd["facility_count"] == 1 and kd["facility_ids"] == ["fac:far"]
    assert kd["within_radius"]


def test_corridor_proximity_states_seeded_real_geojson():
    states = sj.load_boundaries(NIGERIA_STATES)
    rows = sj.corridor_proximity(states, [], sj.LAGOS_CALABAR_CORRIDOR, 50.0)
    within = {r["name"] for r in rows if r["within_radius"]}
    # Lagos centroid sits essentially on the corridor; Kaduna far away
    assert "Lagos" in within
    assert "Kaduna" not in within


# --- loading / writing / driver --------------------------------------------
def test_load_facilities_jsonl_dedupes_and_skips_null(tmp_path):
    d = tmp_path / "facilities"
    d.mkdir()
    (d / "part-1.jsonl").write_text(
        "\n".join(
            [
                json.dumps({"facility_id": "fac:b", "name": "B", "type": "school",
                            "lat": 10.5, "lon": 7.4}),
                json.dumps({"facility_id": "fac:a", "name": "A", "type": "clinic",
                            "lat": 10.6, "lon": 7.5}),
                json.dumps({"facility_id": "fac:noloc", "name": "X"}),
                json.dumps({"facility_id": "fac:b", "name": "B2", "type": "school",
                            "lat": 10.51, "lon": 7.41}),
            ]
        )
    )
    facs = sj.load_facilities(d)
    assert [f.facility_id for f in facs] == ["fac:a", "fac:b"]
    assert next(f for f in facs if f.facility_id == "fac:b").name == "B2"


def test_write_results_jsonl_fallback_and_flattening(tmp_path):
    rows = [{"unit_id": "u1", "by_type": {"school": 2}, "facility_ids": ["a"]}]
    path = sj.write_results(rows, tmp_path, stem="out")
    assert path.exists()
    if path.suffix == ".jsonl":
        rec = json.loads(path.read_text().splitlines()[0])
        assert rec["by_type"] == json.dumps({"school": 2})
        assert rec["facility_ids"] == json.dumps(["a"])
    else:  # parquet when pyarrow is installed
        import pyarrow.parquet as pq

        assert pq.read_table(path).num_rows == 1


def test_run_python_deterministic_end_to_end(tmp_path, kaduna_features):
    fac_path = tmp_path / "facs.jsonl"
    fac_path.write_text(
        "\n".join(
            json.dumps({"facility_id": f"fac:{i}", "name": f"F{i}",
                        "type": "school" if i % 2 else "clinic",
                        "lat": 10.52 + i * 0.001, "lon": 7.44 + i * 0.001})
            for i in range(4)
        )
    )
    out1, out2 = tmp_path / "o1", tmp_path / "o2"
    s1 = sj.run_python(KADUNA_LGAS, fac_path, out1, radius_km=50.0)
    s2 = sj.run_python(KADUNA_LGAS, fac_path, out2, radius_km=50.0)
    assert s1["engine"] == "python" and s1["boundaries"] == len(kaduna_features)
    assert s1["facilities"] == 4 and s1["total_facilities_joined"] == 4
    # determinism: identical inputs -> identical output bytes per stem
    for p1 in sorted(out1.iterdir()):
        p2 = out2 / p1.name
        assert p1.read_bytes() == p2.read_bytes()


def test_run_engine_resolution_python_forced(tmp_path):
    fac_path = tmp_path / "f.jsonl"
    fac_path.write_text("")
    summary = sj.run(KADUNA_LGAS, fac_path, tmp_path / "o", engine="python")
    assert summary["engine"] == "python"
    with pytest.raises(ValueError):
        sj.run(KADUNA_LGAS, fac_path, tmp_path / "o2", engine="nope")


def test_seed_affects_nothing_for_sorted_output(tmp_path):
    fac_path = tmp_path / "f.jsonl"
    fac_path.write_text(
        json.dumps({"facility_id": "fac:1", "name": "F", "type": "school",
                    "lat": 10.52, "lon": 7.44})
    )
    a = sj.run_python(KADUNA_LGAS, fac_path, tmp_path / "a", seed=1)
    b = sj.run_python(KADUNA_LGAS, fac_path, tmp_path / "b", seed=999)
    assert a["total_facilities_joined"] == b["total_facilities_joined"] == 1
    assert a["seed"] == 1 and b["seed"] == 999


@pytest.mark.skipif(not sj.sedona_available(), reason="pyspark not installed")
def test_sedona_path_smoke(tmp_path):  # pragma: no cover - env dependent
    fac_path = tmp_path / "f.jsonl"
    fac_path.write_text(
        json.dumps({"facility_id": "fac:1", "name": "F", "type": "school",
                    "lat": 10.52, "lon": 7.44})
    )
    res = sj.run(KADUNA_LGAS, fac_path, tmp_path / "o", engine="sedona")
    assert res["engine"] == "sedona" and res["rows"] > 0
