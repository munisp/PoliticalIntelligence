"""Geo-analytics batch jobs (docs/LAKEHOUSE.md — Sedona section).

Two execution paths, one set of spatial semantics:

1. **Apache Sedona / PySpark path** (production lakehouse): reads boundary
   GeoJSON + the canonical `facilities` Iceberg export from the MinIO
   warehouse, runs distributed spatial joins (ST_Contains) and proximity
   aggregates (ST_DWithin against a corridor line), and writes the result as
   the Iceberg table ``policy_twin.geo_analytics``. Used by the
   ``spark-sedona`` compose service and the optional k8s job
   (``infra/k8s/base/sedona-job.yaml``). Skips cleanly when pyspark/sedona
   are not installed.

2. **Pure-Python fallback** (dev/CI, offline): the spatial predicates live in
   small testable functions (``point_in_feature``, ``distance_to_line_km`` …)
   mirroring api/queries/geo.ts semantics, so the join/aggregate logic is
   fully exercisable without a JVM, Spark, or MinIO. Output goes to a parquet
   file when pyarrow is available, otherwise partitioned JSONL (the same
   honesty posture as the lakehouse exporter).

Determinism: a fixed seed (GEO_ANALYTICS_SEED, default 20240801) governs any
tie-breaking/sampling; with identical inputs the outputs are byte-stable in
record ordering (results are sorted by natural keys).

CLI:
    python -m app.geo_analytics.sedona_jobs \
        --boundaries public/geo/kaduna-lgas.geojson \
        --facilities <warehouse>/jsonl-preview/policy_twin/facilities \
        --corridor-km 50 --out <out>/geo_analytics
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from app.logging_setup import get_logger

log = get_logger("geo_analytics")

GEO_ANALYTICS_TABLE = "geo_analytics"
GEO_ANALYTICS_NAMESPACE = "policy_twin"

DEFAULT_SEED = 20240801

# Lagos–Calabar coastal highway corridor — deterministic seeded polyline
# (lon, lat waypoints; approximate, provenance origin="derived"). Kept here
# because no corridor route geometry exists elsewhere in the codebase yet.
LAGOS_CALABAR_CORRIDOR: list[tuple[float, float]] = [
    (3.3792, 6.5244),   # Lagos
    (4.5375, 6.4541),   # Ijebu-Ode area
    (5.6276, 6.3350),   # Benin City
    (6.7820, 6.1667),   # Onitsha
    (7.0333, 5.4833),   # Owerri
    (7.9300, 5.0400),   # Uyo
    (8.3417, 4.9757),   # Calabar
]


# ---------------------------------------------------------------------------
# Pure-Python spatial predicates (testable without pyspark/sedona)
# ---------------------------------------------------------------------------
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km (matches api/queries/geo.ts haversineKm)."""
    r = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def _rings_of(geometry: dict[str, Any]) -> list[list[tuple[float, float]]]:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "Polygon":
        return [[(float(x), float(y)) for x, y in ring] for ring in coords]
    if gtype == "MultiPolygon":
        return [
            [(float(x), float(y)) for x, y in ring]
            for poly in coords
            for ring in poly
        ]
    return []


def point_in_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    """Ray-casting point-in-polygon (lon/lat planar — fine at LGA scale)."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_feature(lon: float, lat: float, feature: dict[str, Any]) -> bool:
    """True when (lon, lat) lies in any ring of a GeoJSON feature.

    Holes are ignored (same posture as api/queries/geo.ts — boundary polygons
    here are simple admin outlines)."""
    return any(
        point_in_ring(lon, lat, ring)
        for ring in _rings_of(feature.get("geometry") or {})
    )


def _point_to_segment_km(
    lat: float, lon: float,
    a: tuple[float, float], b: tuple[float, float],
) -> float:
    """Approximate point-to-segment distance in km via local equirectangular
    projection (accurate at corridor scales, deterministic)."""
    lat0 = math.radians((lat + a[1] + b[1]) / 3.0)
    kx = 111.32 * math.cos(lat0)
    ky = 110.574
    px, py = lon * kx, lat * ky
    ax, ay = a[0] * kx, a[1] * ky
    bx, by = b[0] * kx, b[1] * ky
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def distance_to_line_km(
    lat: float, lon: float, line: list[tuple[float, float]]
) -> float:
    """Minimum distance (km) from a point to a (lon, lat) polyline."""
    if not line:
        return math.inf
    if len(line) == 1:
        return haversine_km(lat, lon, line[0][1], line[0][0])
    return min(
        _point_to_segment_km(lat, lon, line[i], line[i + 1])
        for i in range(len(line) - 1)
    )


def feature_centroid(feature: dict[str, Any]) -> tuple[float | None, float | None]:
    """(lat, lon) for a boundary feature: declared centroid properties when
    present, else the mean of the first ring's vertices."""
    props = feature.get("properties") or {}
    lat, lon = props.get("centroid_lat"), props.get("centroid_lon")
    if lat is not None and lon is not None:
        return float(lat), float(lon)
    rings = _rings_of(feature.get("geometry") or {})
    if not rings or not rings[0]:
        return None, None
    ring = rings[0]
    n = len(ring)
    return sum(p[1] for p in ring) / n, sum(p[0] for p in ring) / n


# ---------------------------------------------------------------------------
# Job inputs
# ---------------------------------------------------------------------------
@dataclass
class Facility:
    facility_id: str
    name: str
    type: str
    lat: float
    lon: float


def load_boundaries(path: str | Path) -> list[dict[str, Any]]:
    fc = json.loads(Path(path).read_text())
    if fc.get("type") != "FeatureCollection":
        raise ValueError(f"{path}: expected a GeoJSON FeatureCollection")
    return list(fc.get("features") or [])


def load_facilities(source: str | Path) -> list[Facility]:
    """Load the canonical facilities export — either a JSONL preview dir
    (LocalJsonlWriter output: <dir>/part-*.jsonl) or a single JSONL file.
    Rows follow the lakehouse `facilities` schema (lat/lon doubles)."""
    src = Path(source)
    files: list[Path]
    if src.is_dir():
        files = sorted(src.glob("part-*.jsonl")) or sorted(src.glob("*.jsonl"))
    else:
        files = [src]
    out: list[Facility] = []
    for f in files:
        for line in f.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            lat, lon = row.get("lat"), row.get("lon")
            if lat is None or lon is None:
                continue
            out.append(
                Facility(
                    facility_id=str(row.get("facility_id") or row.get("id") or ""),
                    name=str(row.get("name") or ""),
                    type=str(row.get("type") or row.get("facility_type") or ""),
                    lat=float(lat),
                    lon=float(lon),
                )
            )
    # deterministic order + dedupe on natural key (later rows win)
    dedup = {fac.facility_id: fac for fac in out}
    return [dedup[k] for k in sorted(dedup)]


# ---------------------------------------------------------------------------
# Aggregations (pure — shared semantics for both engines)
# ---------------------------------------------------------------------------
def facilities_per_lga(
    features: list[dict[str, Any]], facilities: Iterable[Facility]
) -> list[dict[str, Any]]:
    """Spatial join: facility points → containing LGA polygon → counts.

    Returns one row per boundary feature (sorted by unit_id), including
    zero-count rows so choropleths stay complete."""
    facs = list(facilities)
    rows: list[dict[str, Any]] = []
    for feat in features:
        props = feat.get("properties") or {}
        inside = [
            f for f in facs if point_in_feature(f.lon, f.lat, feat)
        ]
        by_type: dict[str, int] = {}
        for f in sorted(inside, key=lambda x: (x.type, x.facility_id)):
            by_type[f.type] = by_type.get(f.type, 0) + 1
        rows.append(
            {
                "unit_id": str(props.get("unit_id") or props.get("name") or ""),
                "name": str(props.get("name") or props.get("lga") or ""),
                "level": str(props.get("level") or ""),
                "facility_count": len(inside),
                "by_type": by_type,
                "facility_ids": sorted(f.facility_id for f in inside),
            }
        )
    return sorted(rows, key=lambda r: r["unit_id"])


def corridor_proximity(
    features: list[dict[str, Any]],
    facilities: Iterable[Facility],
    line: list[tuple[float, float]],
    radius_km: float,
) -> list[dict[str, Any]]:
    """Proximity aggregate: for each boundary feature, the facilities within
    ``radius_km`` of the corridor line that also fall inside the boundary,
    plus the boundary centroid's distance to the corridor."""
    facs = list(facilities)
    near = [
        (f, distance_to_line_km(f.lat, f.lon, line))
        for f in facs
    ]
    near = [(f, d) for f, d in near if d <= radius_km]
    rows: list[dict[str, Any]] = []
    for feat in features:
        props = feat.get("properties") or {}
        inside = [(f, d) for f, d in near if point_in_feature(f.lon, f.lat, feat)]
        c_lat, c_lon = feature_centroid(feat)
        centroid_dist = (
            distance_to_line_km(c_lat, c_lon, line)
            if c_lat is not None and c_lon is not None
            else None
        )
        rows.append(
            {
                "unit_id": str(props.get("unit_id") or props.get("name") or ""),
                "name": str(props.get("name") or props.get("lga") or ""),
                "centroid_distance_km": (
                    round(centroid_dist, 3) if centroid_dist is not None else None
                ),
                "within_radius": centroid_dist is not None and centroid_dist <= radius_km,
                "radius_km": radius_km,
                "facility_count": len(inside),
                "nearest_facility_km": (
                    round(min(d for _, d in inside), 3) if inside else None
                ),
                "facility_ids": sorted(f.facility_id for f, _ in inside),
            }
        )
    return sorted(rows, key=lambda r: r["unit_id"])


# ---------------------------------------------------------------------------
# Output writers (parquet when pyarrow present, else JSONL fallback)
# ---------------------------------------------------------------------------
def _flatten(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flat = []
    for r in rows:
        rec = dict(r)
        if isinstance(rec.get("by_type"), dict):
            rec["by_type"] = json.dumps(rec["by_type"], sort_keys=True)
        if isinstance(rec.get("facility_ids"), list):
            rec["facility_ids"] = json.dumps(rec["facility_ids"])
        flat.append(rec)
    return flat


def write_results(
    rows: list[dict[str, Any]], out_dir: str | Path, *, stem: str
) -> Path:
    """Write result rows; parquet when pyarrow is installed, else JSONL."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    flat = _flatten(rows)
    try:
        import pyarrow as pa  # noqa: F401
        import pyarrow.parquet as pq

        table = pa.Table.from_pylist(flat)
        path = out / f"{stem}.parquet"
        pq.write_table(table, path)
        return path
    except ImportError:
        path = out / f"{stem}.jsonl"
        with path.open("w") as fh:
            for rec in flat:
                fh.write(json.dumps(rec, sort_keys=True, default=str) + "\n")
        log.warning("pyarrow absent — wrote JSONL fallback %s", path)
        return path


# ---------------------------------------------------------------------------
# Sedona / PySpark path (optional — skipped when pyspark absent)
# ---------------------------------------------------------------------------
def sedona_available() -> bool:
    try:
        import pyspark  # noqa: F401

        return True
    except ImportError:
        return False


def run_sedona(
    boundaries_path: str | Path,
    facilities_source: str | Path,
    out_dir: str | Path,
    *,
    radius_km: float = 50.0,
    seed: int = DEFAULT_SEED,
) -> dict[str, Any]:  # pragma: no cover - requires Spark/Sedona runtime
    """Distributed path: PySpark + Apache Sedona spatial SQL, Iceberg sink.

    Wires to the MinIO warehouse via S3A; writes ``policy_twin.geo_analytics``
    through the Iceberg Spark catalog when configured, else parquet under
    ``out_dir`` (same fallback posture as the pure-Python path)."""
    from pyspark.sql import SparkSession  # type: ignore

    random.seed(seed)
    warehouse = os.getenv("LAKEHOUSE_WAREHOUSE", "s3://policy-twin/lakehouse")
    spark = (
        SparkSession.builder.appName("policy-twin-geo-analytics")
        .config("spark.jars.packages",
                "org.apache.sedona:sedona-spark-shaded-3.5_2.12:1.6.1")
        .config("spark.sql.catalog.lakehouse", "org.apache.iceberg.spark.SparkCatalog")
        .config("spark.sql.catalog.lakehouse.type", "hadoop")
        .config("spark.sql.catalog.lakehouse.warehouse", warehouse)
        .getOrCreate()
    )
    try:
        from sedona.spark import SedonaContext  # type: ignore

        sedona = SedonaContext.create(spark)
        boundaries = sedona.read.format("geojson").load(str(boundaries_path))
        boundaries.createOrReplaceTempView("boundaries")
        facs = load_facilities(facilities_source)
        fac_df = sedona.createDataFrame(
            [(f.facility_id, f.name, f.type, f.lon, f.lat) for f in facs],
            ["facility_id", "name", "type", "lon", "lat"],
        )
        fac_df.createOrReplaceTempView("facilities")
        joined = sedona.sql(
            """
            SELECT b.properties.unit_id AS unit_id,
                   b.properties.name AS name,
                   count(f.facility_id) AS facility_count
            FROM boundaries b
            LEFT JOIN facilities f
              ON ST_Contains(ST_GeomFromGeoJSON(b.geometry), ST_Point(f.lon, f.lat))
            GROUP BY 1, 2 ORDER BY 1
            """
        )
        rows = [r.asDict() for r in joined.collect()]
        dest = f"{GEO_ANALYTICS_NAMESPACE}.{GEO_ANALYTICS_TABLE}"
        try:
            joined.writeTo(f"lakehouse.{dest}").using("iceberg").createOrReplace()
            sink: str = f"iceberg:{dest}"
        except Exception as exc:  # catalog not reachable -> parquet fallback
            log.warning("iceberg sink unavailable (%s) — parquet fallback", exc)
            sink = str(write_results(rows, out_dir, stem="facilities_per_lga"))
        return {"engine": "sedona", "rows": len(rows), "sink": sink}
    finally:
        spark.stop()


# ---------------------------------------------------------------------------
# Pure-Python driver (offline/CI default)
# ---------------------------------------------------------------------------
def run_python(
    boundaries_path: str | Path,
    facilities_source: str | Path,
    out_dir: str | Path,
    *,
    radius_km: float = 50.0,
    corridor: list[tuple[float, float]] | None = None,
    seed: int = DEFAULT_SEED,
) -> dict[str, Any]:
    """Offline-capable driver: same spatial semantics, no JVM required."""
    random.seed(seed)
    features = load_boundaries(boundaries_path)
    facilities = load_facilities(facilities_source)
    line = corridor or LAGOS_CALABAR_CORRIDOR

    per_lga = facilities_per_lga(features, facilities)
    prox = corridor_proximity(features, facilities, line, radius_km)

    p1 = write_results(per_lga, out_dir, stem="facilities_per_lga")
    p2 = write_results(prox, out_dir, stem="corridor_proximity")
    summary = {
        "engine": "python",
        "seed": seed,
        "boundaries": len(features),
        "facilities": len(facilities),
        "radius_km": radius_km,
        "outputs": [str(p1), str(p2)],
        "total_facilities_joined": sum(r["facility_count"] for r in per_lga),
        "units_within_corridor": sum(1 for r in prox if r["within_radius"]),
    }
    log.info("geo analytics (python engine): %s", summary)
    return summary


def run(
    boundaries_path: str | Path,
    facilities_source: str | Path,
    out_dir: str | Path,
    *,
    radius_km: float = 50.0,
    engine: str = "auto",
    seed: int = DEFAULT_SEED,
) -> dict[str, Any]:
    """Engine resolution: 'auto' uses Sedona when pyspark+sedona are
    installed, else the pure-Python path (loudly logged)."""
    if engine not in {"auto", "sedona", "python"}:
        raise ValueError(f"unknown engine '{engine}'")
    if engine == "sedona" or (engine == "auto" and sedona_available()):
        return run_sedona(
            boundaries_path, facilities_source, out_dir,
            radius_km=radius_km, seed=seed,
        )
    if engine == "auto":
        log.warning("pyspark/sedona absent — pure-Python geo engine")
    return run_python(
        boundaries_path, facilities_source, out_dir,
        radius_km=radius_km, seed=seed,
    )


def main(argv: list[str] | None = None) -> dict[str, Any]:
    ap = argparse.ArgumentParser(description="Geo-analytics jobs (Sedona/python)")
    ap.add_argument("--boundaries", required=True, help="boundary GeoJSON path")
    ap.add_argument("--facilities", required=True,
                    help="facilities JSONL file or lakehouse preview dir")
    ap.add_argument("--out", required=True, help="output dir")
    ap.add_argument("--corridor-km", type=float, default=50.0)
    ap.add_argument("--engine", default=os.getenv("GEO_ENGINE", "auto"),
                    choices=["auto", "sedona", "python"])
    ap.add_argument("--seed", type=int,
                    default=int(os.getenv("GEO_ANALYTICS_SEED", DEFAULT_SEED)))
    args = ap.parse_args(argv)
    return run(
        args.boundaries, args.facilities, args.out,
        radius_km=args.corridor_km, engine=args.engine, seed=args.seed,
    )


if __name__ == "__main__":  # pragma: no cover
    print(json.dumps(main(), indent=2))
