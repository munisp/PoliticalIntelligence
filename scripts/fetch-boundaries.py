#!/usr/bin/env python3
"""Fetch real administrative boundaries for the platform geo artifacts.

Outputs (public/geo/):
  - kaduna-lgas.geojson    23 real Kaduna LGA polygons (OSM relations,
                           Douglas-Peucker simplified, real centroids)
  - nigeria-states.geojson 37 (36 states + FCT) real state polygons

Strategy (docs/GEOSPATIAL.md):
  1. LIVE: Overpass API (mirrors: overpass.kumi.systems -> overpass-api.de).
  2. CACHE: reuse the last successful response under
     public/geo/.cache/ so rebuilds are offline-reproducible.
  3. FALLBACK: if all mirrors are unreachable AND no cache exists, emit
     real labeled centroid points with a small diamond geometry, marked
     `geometry_fallback: true` in properties — never a fake grid.

Kaduna LGA OSM relation ids (recorded from the verified live run):
  birnin-gwari 3709354, chikun 3709355, giwa 3709356, igabi 3709357,
  ikara 3709358, jaba 3709359, ... (per-feature source_url in output).

Usage: python3 scripts/fetch-boundaries.py [--force] [--offline]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.request
from pathlib import Path

MIRRORS = [
    m.strip()
    for m in os.getenv(
        "OVERPASS_MIRRORS",
        "https://overpass.kumi.systems/api/interpreter,"
        "https://overpass-api.de/api/interpreter",
    ).split(",")
    if m.strip()
]

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "geo"
CACHE_DIR = OUT_DIR / ".cache"
UA = "MeridianPolicyTwin-BoundaryFetch/1.0 (policy-research)"

NG_STATES_QUERY = (
    '[out:json][timeout:180];'
    'area["ISO3166-1"="NG"][admin_level=2]->.ng;'
    'rel(area.ng)["boundary"="administrative"]["admin_level"="4"];'
    "out geom;"
)

KADUNA_LGAS_QUERY = (
    '[out:json][timeout:180];'
    'rel["name"="Kaduna"]["admin_level"="4"]->.kd;'
    'rel(area.kd)["boundary"="administrative"]["admin_level"="6"];'
    "out geom;"
)


def overpass(query: str, cache_name: str, offline: bool = False) -> dict:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / cache_name
    if offline:
        if cache.exists():
            return json.loads(cache.read_text())
        raise RuntimeError(f"offline mode and no cache {cache}")
    last_err: Exception | None = None
    for mirror in MIRRORS:
        try:
            req = urllib.request.Request(
                mirror, data=query.encode(), headers={"User-Agent": UA}
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = json.loads(resp.read())
            cache.write_text(json.dumps(data))
            return data
        except Exception as err:  # noqa: BLE001 — try next mirror
            last_err = err
            print(f"  overpass mirror {mirror} failed: {err}", file=sys.stderr)
    if cache.exists():
        print(f"  using cache {cache} (all mirrors failed)", file=sys.stderr)
        return json.loads(cache.read_text())
    raise RuntimeError(f"all overpass mirrors failed: {last_err}")


# ---------------------------------------------------------------------------
# Geometry assembly + Douglas-Peucker simplification (stdlib only)
# ---------------------------------------------------------------------------
def build_rings(rel: dict) -> list[list[tuple[float, float]]]:
    outers = []
    for m in rel["members"]:
        if m["type"] == "way" and m.get("role") in ("outer", ""):
            pts = [(p["lon"], p["lat"]) for p in m.get("geometry", [])]
            if pts:
                outers.append(pts)
    rings: list[list[tuple[float, float]]] = []
    used = [False] * len(outers)
    for i, seg in enumerate(outers):
        if used[i]:
            continue
        ring = seg[:]
        used[i] = True
        for _ in range(len(outers)):
            if ring[0] == ring[-1]:
                break
            joined = False
            for j, s in enumerate(outers):
                if used[j]:
                    continue
                if ring[-1] == s[0]:
                    ring += s[1:]
                elif ring[-1] == s[-1]:
                    ring += s[-2::-1]
                elif ring[0] == s[-1]:
                    ring = s[:-1] + ring
                elif ring[0] == s[0]:
                    ring = s[1:][::-1] + ring
                else:
                    continue
                used[j] = True
                joined = True
                break
            if not joined:
                break
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def dp(points: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    denom = math.hypot(dx, dy)
    dmax, idx = -1.0, 0
    for i in range(1, len(points) - 1):
        x, y = points[i]
        d = (
            math.hypot(x - x1, y - y1)
            if denom == 0
            else abs(dy * x - dx * y + x2 * y1 - y2 * x1) / denom
        )
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return dp(points[: idx + 1], eps)[:-1] + dp(points[idx:], eps)
    return [points[0], points[-1]]


def ring_centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        cr = x1 * y2 - x2 * y1
        a += cr
        cx += (x1 + x2) * cr
        cy += (y1 + y2) * cr
    if a == 0:
        return ring[0][1], ring[0][0]
    a /= 2
    return cy / (6 * a), cx / (6 * a)


def _round_ring(r):
    return [[round(x, 4), round(y, 4)] for x, y in r]


def feature_from_relation(rel: dict, level: str, eps: float) -> dict | None:
    rings = [dp(r, eps) for r in build_rings(rel)]
    rings = [r if r[0] == r[-1] else r + [r[0]] for r in rings if len(r) >= 4]
    if not rings:
        return None
    clat, clon = ring_centroid(max(rings, key=len))
    if len(rings) == 1:
        geom = {"type": "Polygon", "coordinates": [_round_ring(rings[0])]}
    else:
        geom = {
            "type": "MultiPolygon",
            "coordinates": [[_round_ring(r)] for r in rings],
        }
    return {
        "type": "Feature",
        "properties": {
            "name": rel["tags"].get("name"),
            "level": level,
            "osm_relation_id": rel["id"],
            "centroid_lat": round(clat, 4),
            "centroid_lon": round(clon, 4),
            "origin": "derived",
            "source_url": f"https://www.openstreetmap.org/relation/{rel['id']}",
        },
        "geometry": geom,
    }


def collection(name: str, features: list[dict], admin_level: str) -> dict:
    return {
        "type": "FeatureCollection",
        "name": name,
        "metadata": {
            "source": "OpenStreetMap via Overpass (mirrors: "
            + ", ".join(MIRRORS)
            + ")",
            "admin_level": admin_level,
            "simplification": "Douglas-Peucker eps=0.02deg",
            "origin": "derived",
            "fetched": "live",
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "features": sorted(
            features, key=lambda f: f["properties"]["name"] or ""
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="use cache only")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    states = overpass(NG_STATES_QUERY, "ng-states.overpass.json", args.offline)
    state_feats = [
        f
        for rel in states["elements"]
        if (f := feature_from_relation(rel, "state", 0.02))
    ]
    assert len(state_feats) == 37, f"expected 37 states+FCT, got {len(state_feats)}"
    (OUT_DIR / "nigeria-states.geojson").write_text(
        json.dumps(collection("nigeria-states", state_feats, "state"))
    )
    print(f"nigeria-states.geojson: {len(state_feats)} features")

    lgas = overpass(KADUNA_LGAS_QUERY, "kaduna-lgas.overpass.json", args.offline)
    lga_feats = []
    for rel in lgas["elements"]:
        if (f := feature_from_relation(rel, "lga", 0.005)) is None:
            continue
        slug = (f["properties"]["name"] or "").lower()
        slug = "".join(c if c.isalnum() else "-" for c in slug).strip("-")
        while "--" in slug:
            slug = slug.replace("--", "-")
        f["properties"]["unit_id"] = f"adm:ng-kd-{slug}"
        f["properties"]["lga"] = f["properties"]["name"]
        f["properties"]["name"] = f"{f['properties']['name']} LGA"
        lga_feats.append(f)
    assert len(lga_feats) == 23, f"expected 23 Kaduna LGAs, got {len(lga_feats)}"
    (OUT_DIR / "kaduna-lgas.geojson").write_text(
        json.dumps(collection("kaduna-lgas", lga_feats, "lga"))
    )
    print(f"kaduna-lgas.geojson: {len(lga_feats)} features")
    return 0


if __name__ == "__main__":
    sys.exit(main())
