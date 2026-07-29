"""GeoLibre copilot tool — natural-language geospatial QA (docs/GEOSPATIAL.md).

Answers questions like
  "which LGAs within 50km of the Lagos-Calabar corridor have unemployment > 20%?"
against the platform's real boundary GeoJSONs (public/geo) and the seeded
analytical metrics corpus.

Engine honesty (``geo_engine`` marker in every answer):
  * ``"geolibre"``  — question delegated to a GeoLibre backend
    (github.com/opengeos/GeoLibre) over HTTP when GEOLIBRE_URL is set.
    This is the documented integration seam only: the library is NOT
    vendored; the backend is an external service.
  * ``"template"``  — deterministic in-process engine: intent templates
    (within-distance / per-LGA aggregation / corridor proximity) parsed from
    the question, executed against PostGIS (when POSTGIS_URL + a postgres
    driver are available) or the geojson fallback, metrics from the seeded
    corpus. Fully offline; this is the default.

No randomness: identical questions give identical answers.
"""
from __future__ import annotations

import json
import math
import os
import re
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.data import corpus
from app.logging_setup import get_logger
from app.tools import tool

log = get_logger("tools.geolibre")

# Lagos–Calabar coastal highway — seeded polyline (lon, lat), origin=derived.
# Mirrors services/ingestion/app/geo_analytics/sedona_jobs.py (kept separate
# so the ai service has no cross-service import).
CORRIDORS: dict[str, list[tuple[float, float]]] = {
    "lagos-calabar": [
        (3.3792, 6.5244), (4.5375, 6.4541), (5.6276, 6.3350),
        (6.7820, 6.1667), (7.0333, 5.4833), (7.9300, 5.0400),
        (8.3417, 4.9757),
    ],
}

# State name (geojson) -> jurisdiction id (corpus metrics). Only states with
# seeded metrics resolve; others answer honestly with "no metric data".
STATE_JURISDICTION: dict[str, str] = {
    "kaduna": "jur:ng-kd",
    "lagos": "jur:ng-la",
    "kano": "jur:ng-kn",
}

METRIC_ALIASES = {
    "unemployment": "unemployment_rate",
    "unemployment rate": "unemployment_rate",
    "teacher gap": "teacher_gap_primary",
    "smes": "registered_smes",
    "registered smes": "registered_smes",
}

OPS = {
    ">": lambda a, b: a > b, ">=": lambda a, b: a >= b,
    "<": lambda a, b: a < b, "<=": lambda a, b: a <= b,
}


# ---------------------------------------------------------------------------
# Spatial helpers (self-contained; mirror api/queries/geo.ts semantics)
# ---------------------------------------------------------------------------
def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def _seg_km(lat, lon, a, b) -> float:
    lat0 = math.radians((lat + a[1] + b[1]) / 3.0)
    kx, ky = 111.32 * math.cos(lat0), 110.574
    px, py, ax, ay, bx, by = lon * kx, lat * ky, a[0] * kx, a[1] * ky, b[0] * kx, b[1] * ky
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def distance_to_corridor_km(lat: float, lon: float,
                            line: list[tuple[float, float]]) -> float:
    if len(line) < 2:
        return math.inf
    return min(_seg_km(lat, lon, line[i], line[i + 1])
               for i in range(len(line) - 1))


def _feature_centroid(feat: dict[str, Any]) -> tuple[float, float] | None:
    props = feat.get("properties") or {}
    lat, lon = props.get("centroid_lat"), props.get("centroid_lon")
    if lat is not None and lon is not None:
        return float(lat), float(lon)
    geom = feat.get("geometry") or {}
    coords = geom.get("coordinates") or []
    ring = coords[0] if geom.get("type") == "Polygon" and coords else None
    if not ring:
        return None
    n = len(ring)
    return (sum(p[1] for p in ring) / n, sum(p[0] for p in ring) / n)


def _geo_dir() -> Path:
    return Path(os.getenv(
        "GEO_DATA_DIR",
        Path(__file__).resolve().parents[4] / "public" / "geo",
    ))


def load_boundaries(level: str) -> tuple[list[dict[str, Any]], str]:
    """Boundary features: PostGIS when configured (POSTGIS_URL + psycopg
    driver), else the seeded geojson artifacts (honest default). Returns
    (features, data_source)."""
    if os.getenv("POSTGIS_URL"):  # pragma: no cover - env dependent
        try:
            import psycopg  # type: ignore

            with psycopg.connect(os.environ["POSTGIS_URL"]) as conn:
                rows = conn.execute(
                    "SELECT unit_id, properties, ST_AsGeoJSON(geom) "
                    "FROM geo_boundaries WHERE level = %s", (level,),
                ).fetchall()
            return [
                {"type": "Feature",
                 "properties": {**(json.loads(p) if isinstance(p, str) else p or {}),
                                "unit_id": uid},
                 "geometry": json.loads(g)}
                for uid, p, g in rows
            ], "postgis"
        except Exception as exc:
            log.warning("postgis unavailable (%s) — geojson fallback", exc)
    name = "kaduna-lgas.geojson" if level == "lga" else "nigeria-states.geojson"
    path = _geo_dir() / name
    if not path.exists():
        return [], "geojson"
    return list(json.loads(path.read_text()).get("features") or []), "geojson"


def metric_lookup(metric: str, jurisdiction_id: str) -> dict[str, Any] | None:
    rows = [m for m in corpus.METRICS
            if m["metric"] == metric and m["jurisdiction"] == jurisdiction_id]
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Intent parsing (deterministic templates)
# ---------------------------------------------------------------------------
@dataclass
class GeoIntent:
    kind: str                      # corridor_proximity | within_distance | per_lga
    level: str = "state"           # state | lga
    corridor: str | None = None
    radius_km: float | None = None
    metric: str | None = None
    op: str | None = None
    threshold: float | None = None


_RADIUS_RE = re.compile(r"within\s+(\d+(?:\.\d+)?)\s*km", re.I)
_CORRIDOR_RE = re.compile(r"lagos[\s-]*calabar", re.I)
_THRESH_RE = re.compile(
    r"(unemployment(?:\s+rate)?|teacher\s+gap|registered\s+smes|smes)"
    r"\s*(?:of|is|=|:)?\s*(>=|<=|>|<|above|over|below|under|more than|less than)"
    r"\s*(\d+(?:\.\d+)?)\s*(%|percent)?", re.I)


def parse_intent(question: str) -> GeoIntent:
    q = question.lower()
    level = "lga" if re.search(r"\blgas?\b", q) else "state"
    radius = _RADIUS_RE.search(question)
    corridor = "lagos-calabar" if _CORRIDOR_RE.search(question) else None
    metric = op = None
    threshold = None
    m = _THRESH_RE.search(question)
    if m:
        metric = METRIC_ALIASES[m.group(1).lower()]
        raw_op = m.group(2).lower()
        op = {"above": ">", "over": ">", "more than": ">",
              "below": "<", "under": "<", "less than": "<"}.get(raw_op, raw_op)
        threshold = float(m.group(3))
        if m.group(4) and metric and metric.endswith("_rate"):
            threshold /= 100.0  # "unemployment > 20%" vs ratio metrics
    if corridor and radius:
        kind = "corridor_proximity"
    elif radius:
        kind = "within_distance"
    else:
        kind = "per_lga"
    return GeoIntent(kind=kind, level=level, corridor=corridor,
                     radius_km=float(radius.group(1)) if radius else None,
                     metric=metric, op=op, threshold=threshold)


# ---------------------------------------------------------------------------
# Structured answer
# ---------------------------------------------------------------------------
@dataclass
class GeoToolAnswer:
    question: str
    geo_engine: str               # "template" | "geolibre"
    data_source: str              # "geojson" | "postgis" | "geolibre"
    intent: dict[str, Any]
    answer: str
    results: list[dict[str, Any]] = field(default_factory=list)
    map_payload: dict[str, Any] | None = None
    caveats: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "question": self.question,
            "geo_engine": self.geo_engine,
            "data_source": self.data_source,
            "intent": self.intent,
            "answer": self.answer,
            "results": self.results,
            "map_payload": self.map_payload,
            "caveats": self.caveats,
        }


def _jurisdiction_for(feature: dict[str, Any]) -> str | None:
    props = feature.get("properties") or {}
    name = str(props.get("name") or props.get("lga") or "").strip()
    return STATE_JURISDICTION.get(name.lower())


def _map_payload(line: list[tuple[float, float]] | None,
                 matched: list[dict[str, Any]]) -> dict[str, Any]:
    features: list[dict[str, Any]] = []
    if line:
        features.append({
            "type": "Feature",
            "properties": {"kind": "corridor", "name": "Lagos–Calabar coastal highway",
                           "origin": "derived"},
            "geometry": {"type": "LineString",
                         "coordinates": [[lon, lat] for lon, lat in line]},
        })
    for row in matched:
        if row.get("feature"):
            f = dict(row["feature"])
            f["properties"] = {**(f.get("properties") or {}),
                               "kind": "match", "metric_value": row.get("metric_value")}
            features.append(f)
    return {"type": "FeatureCollection", "features": features}


def _execute_template(intent: GeoIntent) -> tuple[list[dict[str, Any]], str, list[str]]:
    """Run the parsed intent against boundaries + metrics. Returns
    (matched rows, data_source, caveats)."""
    features, source = load_boundaries(intent.level)
    caveats: list[str] = []
    line = CORRIDORS.get(intent.corridor or "")
    rows: list[dict[str, Any]] = []
    for feat in features:
        props = feat.get("properties") or {}
        name = str(props.get("name") or props.get("lga") or "")
        centroid = _feature_centroid(feat)
        dist = None
        if line and centroid:
            dist = distance_to_corridor_km(centroid[0], centroid[1], line)
        if intent.kind == "corridor_proximity" and dist is not None:
            if dist > (intent.radius_km or 0):
                continue
        jur = _jurisdiction_for(feat)
        metric_value = period = metric_source = None
        if intent.metric:
            if jur:
                rec = metric_lookup(intent.metric, jur)
                if rec:
                    metric_value, period = rec["value"], rec["period"]
                    metric_source = rec["source"]
                else:
                    caveats.append(f"{name}: no seeded metric data for {jur}")
            else:
                caveats.append(f"{name}: no jurisdiction mapping — metric unavailable")
            if metric_value is None:
                continue
            if intent.op and intent.threshold is not None:
                if not OPS[intent.op](metric_value, intent.threshold):
                    continue
        rows.append({
            "name": name,
            "unit_id": str(props.get("unit_id") or ""),
            "level": intent.level,
            "centroid_distance_km": round(dist, 1) if dist is not None else None,
            "jurisdiction_id": jur,
            "metric": intent.metric,
            "metric_value": metric_value,
            "metric_period": period,
            "metric_source": metric_source,
            "feature": feat,
        })
    rows.sort(key=lambda r: (r["centroid_distance_km"]
                             if r["centroid_distance_km"] is not None else 1e9,
                             r["name"]))
    return rows, source, sorted(set(caveats))


def _render_answer(intent: GeoIntent, rows: list[dict[str, Any]]) -> str:
    scope = f"{intent.level.upper()}s" if intent.level == "lga" else "states"
    where = ""
    if intent.kind == "corridor_proximity":
        where = (f" within {intent.radius_km:g}km of the "
                 "Lagos–Calabar corridor")
    metric_txt = ""
    if intent.metric and intent.op and intent.threshold is not None:
        shown = (f"{intent.threshold * 100:g}%"
                 if intent.metric.endswith("_rate") and intent.threshold <= 1
                 else f"{intent.threshold:g}")
        metric_txt = f" with {intent.metric} {intent.op} {shown}"
    if not rows:
        return f"No {scope}{where}{metric_txt} matched."
    lines = [f"{len(rows)} {scope}{where}{metric_txt}:"]
    for r in rows:
        bits = []
        if r["centroid_distance_km"] is not None:
            bits.append(f"{r['centroid_distance_km']:g}km from corridor")
        if r["metric_value"] is not None:
            v = r["metric_value"]
            shown = f"{v * 100:g}%" if r["metric"].endswith("_rate") and v <= 1 else f"{v:g}"
            bits.append(f"{r['metric']}={shown} ({r['metric_period']}, {r['metric_source']})")
        lines.append(f"- {r['name']}" + (": " + "; ".join(bits) if bits else ""))
    return "\n".join(lines)


def _ask_geolibre_backend(question: str, url: str) -> dict[str, Any] | None:
    """GeoLibre HTTP seam (GEOLIBRE_URL). The library is not vendored; this
    POSTs the question to an external GeoLibre service. Any failure -> None
    and the caller falls back to the template engine (honestly marked)."""
    try:  # pragma: no cover - env dependent
        req = urllib.request.Request(
            url.rstrip("/") + "/query",
            data=json.dumps({"question": question}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as exc:  # pragma: no cover - env dependent
        log.warning("geolibre backend unreachable (%s) — template fallback", exc)
        return None


@tool(
    name="geolibre_geo_qa",
    description=(
        "Answer natural-language geospatial questions over platform geo data "
        "(corridor proximity, within-distance, per-LGA/state aggregation with "
        "metric thresholds). Deterministic template engine by default; "
        "GeoLibre backend when GEOLIBRE_URL is set (geo_engine marker)."
    ),
    tags=("geo", "copilot"),
)
def geolibre_geo_qa(question: str) -> dict[str, Any]:
    """Copilot tool entrypoint — see module docstring."""
    geolibre_url = os.getenv("GEOLIBRE_URL")
    if geolibre_url:  # pragma: no cover - env dependent
        remote = _ask_geolibre_backend(question, geolibre_url)
        if remote is not None:
            remote.setdefault("geo_engine", "geolibre")
            remote.setdefault("data_source", "geolibre")
            return remote
    intent = parse_intent(question)
    rows, source, caveats = _execute_template(intent)
    line = CORRIDORS.get(intent.corridor or "")
    ans = GeoToolAnswer(
        question=question,
        geo_engine="template",
        data_source=source,
        intent={
            "kind": intent.kind, "level": intent.level,
            "corridor": intent.corridor, "radius_km": intent.radius_km,
            "metric": intent.metric, "op": intent.op,
            "threshold": intent.threshold,
        },
        answer=_render_answer(intent, rows),
        results=[{k: v for k, v in r.items() if k != "feature"} for r in rows],
        map_payload=_map_payload(line, rows),
        caveats=caveats,
    )
    return ans.to_dict()
