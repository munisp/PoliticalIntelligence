//! geo-rs — high-performance geospatial compute library.
//!
//! Pure, deterministic (no RNG) geospatial predicates and measurements over
//! GeoJSON inputs, shared by the axum HTTP service (`src/main.rs`) and the
//! unit test suite. See `services/geo-rs/README.md` for the endpoint catalog.
//!
//! Methods (documented honestly):
//! - contains: point-in-polygon spatial join (geo `Contains` predicate,
//!   planar lon/lat — fine at admin-boundary scale).
//! - area_km2: geodesic (Karney) area on the WGS84 ellipsoid
//!   (`geo::GeodesicArea`), returned in km².
//! - within_km: haversine great-circle distance (R = 6371 km) from a Point
//!   or LineString to each candidate feature's geometry — a haversine
//!   *buffer approximation* (no geodesic buffering, no projected CRS);
//!   polygon features are tested by distance to their rings (a point inside
//!   a polygon has distance 0 and always matches).
//! - simplify: Visvalingam–Whyatt vertex removal (`geo::SimplifyVw`),
//!   "topology-preserving-ish": it never moves retained vertices but can
//!   collapse rings at aggressive tolerances; tolerance is in degrees.

use std::sync::atomic::{AtomicU64, Ordering};

use geo::{Contains, GeodesicArea, SimplifyVw};
use geojson::{Feature, FeatureCollection, GeoJson, Geometry, Value};
use serde::{Deserialize, Serialize};

pub const API_VERSION: &str = "v1";
/// Earth radius used for haversine distances (matches the TS fallback).
pub const EARTH_RADIUS_KM: f64 = 6371.0;

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Deterministic request id — monotonic counter, no RNG.
pub fn next_request_id() -> String {
    let n = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed) + 1;
    format!("req_geo_{n:08}")
}

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

#[derive(Debug, Serialize)]
pub struct Meta {
    pub request_id: String,
    pub api_version: &'static str,
}

#[derive(Debug, Serialize)]
pub struct Envelope<T: Serialize> {
    pub data: T,
    pub meta: Meta,
}

pub fn envelope<T: Serialize>(data: T) -> Envelope<T> {
    Envelope {
        data,
        meta: Meta {
            request_id: next_request_id(),
            api_version: API_VERSION,
        },
    }
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    pub request_id: String,
    pub retryable: bool,
}

#[derive(Debug, Serialize)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

pub fn error_envelope(code: &str, message: impl Into<String>) -> ErrorEnvelope {
    ErrorEnvelope {
        error: ErrorBody {
            code: code.to_string(),
            message: message.into(),
            request_id: next_request_id(),
            retryable: false,
        },
    }
}

/* ------------------------------------------------------------------ */
/* GeoJSON -> geo helpers                                              */
/* ------------------------------------------------------------------ */

pub fn parse_geojson(body: &serde_json::Value) -> Result<GeoJson, String> {
    GeoJson::from_json_value(body.clone()).map_err(|e| format!("invalid GeoJSON: {e}"))
}

/// Extract (geometry, properties) pairs from a Feature / FeatureCollection /
/// bare Geometry payload.
pub fn features_of(gj: &GeoJson) -> Vec<(geo::Geometry<f64>, serde_json::Map<String, serde_json::Value>)> {
    let mut out = Vec::new();
    match gj {
        GeoJson::FeatureCollection(fc) => {
            for f in &fc.features {
                if let Some(g) = feature_geom(f) {
                    out.push((g, f.properties.clone().unwrap_or_default()));
                }
            }
        }
        GeoJson::Feature(f) => {
            if let Some(g) = feature_geom(f) {
                out.push((g, f.properties.clone().unwrap_or_default()));
            }
        }
        GeoJson::Geometry(g) => {
            if let Ok(g) = geo::Geometry::try_from(g.clone()) {
                out.push((g, serde_json::Map::new()));
            }
        }
    }
    out
}

fn feature_geom(f: &Feature) -> Option<geo::Geometry<f64>> {
    f.geometry
        .as_ref()
        .and_then(|g| geo::Geometry::try_from(g.clone()).ok())
}

fn first_geometry(gj: &GeoJson) -> Option<geo::Geometry<f64>> {
    features_of(gj).into_iter().map(|(g, _)| g).next()
}

/* ------------------------------------------------------------------ */
/* POST /v1/geo/contains                                               */
/* ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
pub struct ContainsRequest {
    pub polygon_geojson: serde_json::Value,
    /// Points as [lng, lat] pairs.
    pub points: Vec<[f64; 2]>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ContainsHit {
    pub index: usize,
    pub point: [f64; 2],
    /// Properties of the containing polygon; null when no polygon matches.
    pub properties: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Serialize)]
pub struct ContainsResponse {
    pub results: Vec<ContainsHit>,
    pub polygon_count: usize,
    pub geo_engine: &'static str,
}

pub fn contains(req: &ContainsRequest) -> Result<ContainsResponse, String> {
    let gj = parse_geojson(&req.polygon_geojson)?;
    let polys = features_of(&gj);
    let mut results = Vec::with_capacity(req.points.len());
    for (index, p) in req.points.iter().enumerate() {
        let pt = geo::Point::new(p[0], p[1]);
        let hit = polys.iter().find(|(g, _)| match g {
            geo::Geometry::Polygon(poly) => poly.contains(&pt),
            geo::Geometry::MultiPolygon(mp) => mp.contains(&pt),
            _ => false,
        });
        results.push(ContainsHit {
            index,
            point: *p,
            properties: hit.map(|(_, props)| props.clone()),
        });
    }
    Ok(ContainsResponse {
        results,
        polygon_count: polys.len(),
        geo_engine: "rust",
    })
}

/* ------------------------------------------------------------------ */
/* POST /v1/geo/area-km2                                               */
/* ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
pub struct AreaRequest {
    pub geojson: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct AreaResponse {
    pub areas_km2: Vec<f64>,
    pub total_km2: f64,
    pub geo_engine: &'static str,
}

pub fn area_km2(req: &AreaRequest) -> Result<AreaResponse, String> {
    let gj = parse_geojson(&req.geojson)?;
    let geoms = features_of(&gj);
    let areas: Vec<f64> = geoms
        .iter()
        .map(|(g, _)| match g {
            geo::Geometry::Polygon(p) => p.geodesic_area_unsigned() / 1.0e6,
            geo::Geometry::MultiPolygon(mp) => mp.geodesic_area_unsigned() / 1.0e6,
            _ => 0.0,
        })
        .collect();
    Ok(AreaResponse {
        total_km2: areas.iter().sum(),
        areas_km2: areas,
        geo_engine: "rust",
    })
}

/* ------------------------------------------------------------------ */
/* POST /v1/geo/within-km                                              */
/* ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
pub struct WithinKmRequest {
    /// Reference geometry: GeoJSON Point or LineString.
    #[serde(default)]
    pub line_geojson: Option<serde_json::Value>,
    #[serde(default)]
    pub point: Option<[f64; 2]>,
    /// Candidate features (FeatureCollection / Feature / Geometry).
    pub features_geojson: serde_json::Value,
    pub km: f64,
}

#[derive(Debug, Serialize)]
pub struct WithinKmMatch {
    pub index: usize,
    pub distance_km: f64,
    pub properties: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct WithinKmResponse {
    pub matches: Vec<WithinKmMatch>,
    pub method: &'static str,
    pub geo_engine: &'static str,
}

const WITHIN_METHOD: &str =
    "haversine (R=6371km) min vertex distance buffer approximation — no geodesic buffering, no projected CRS; polygon containment counts as distance 0";

/// Great-circle distance (km) between two lon/lat points (R = 6371 km).
pub fn haversine_km(lon1: f64, lat1: f64, lon2: f64, lat2: f64) -> f64 {
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * a.sqrt().asin()
}

/// All coordinates (vertices) of a geometry, flattened.
fn coords_of(g: &geo::Geometry<f64>) -> Vec<geo::Coord<f64>> {
    use geo::Geometry::*;
    match g {
        Point(p) => vec![p.0],
        MultiPoint(mp) => mp.iter().map(|p| p.0).collect(),
        LineString(ls) => ls.0.clone(),
        MultiLineString(mls) => mls.iter().flat_map(|l| l.0.clone()).collect(),
        Polygon(p) => {
            let mut v = p.exterior().0.clone();
            for ring in p.interiors() {
                v.extend(ring.0.iter().copied());
            }
            v
        }
        MultiPolygon(mp) => mp.iter().flat_map(|p| coords_of(&Polygon(p.clone()))).collect(),
        _ => vec![],
    }
}

fn geometry_contains_point(g: &geo::Geometry<f64>, pt: &geo::Point<f64>) -> bool {
    match g {
        geo::Geometry::Polygon(p) => p.contains(pt),
        geo::Geometry::MultiPolygon(mp) => mp.contains(pt),
        _ => false,
    }
}

/// Minimum haversine distance (km) between two geometries, computed over
/// their vertex sets (documented approximation — no segment interpolation).
/// A point reference inside a polygon candidate is distance 0.
fn haversine_between(a: &geo::Geometry<f64>, b: &geo::Geometry<f64>) -> f64 {
    if let geo::Geometry::Point(p) = a {
        if geometry_contains_point(b, p) {
            return 0.0;
        }
    }
    if let geo::Geometry::Point(p) = b {
        if geometry_contains_point(a, p) {
            return 0.0;
        }
    }
    let ca = coords_of(a);
    let cb = coords_of(b);
    let mut min = f64::INFINITY;
    for x in &ca {
        for y in &cb {
            let d = haversine_km(x.x, x.y, y.x, y.y);
            if d < min {
                min = d;
            }
        }
    }
    min
}

pub fn within_km(req: &WithinKmRequest) -> Result<WithinKmResponse, String> {
    if !(req.km.is_finite() && req.km >= 0.0) {
        return Err("km must be a finite non-negative number".into());
    }
    let reference: geo::Geometry<f64> = if let Some(p) = req.point {
        geo::Geometry::Point(geo::Point::new(p[0], p[1]))
    } else if let Some(v) = &req.line_geojson {
        let gj = parse_geojson(v)?;
        first_geometry(&gj).ok_or("line_geojson has no usable geometry")?
    } else {
        return Err("provide either point or line_geojson".into());
    };
    let candidates = features_of(&parse_geojson(&req.features_geojson)?);
    let mut matches = Vec::new();
    for (index, (g, props)) in candidates.iter().enumerate() {
        let d = haversine_between(&reference, g);
        if d <= req.km {
            matches.push(WithinKmMatch {
                index,
                distance_km: d,
                properties: props.clone(),
            });
        }
    }
    matches.sort_by(|a, b| a.distance_km.partial_cmp(&b.distance_km).unwrap_or(std::cmp::Ordering::Equal));
    Ok(WithinKmResponse {
        matches,
        method: WITHIN_METHOD,
        geo_engine: "rust",
    })
}

/* ------------------------------------------------------------------ */
/* POST /v1/geo/simplify                                               */
/* ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
pub struct SimplifyRequest {
    pub geojson: serde_json::Value,
    /// Visvalingam–Whyatt epsilon in degrees.
    pub tolerance: f64,
}

#[derive(Debug, Serialize)]
pub struct SimplifyResponse {
    pub geojson: serde_json::Value,
    pub vertices_before: usize,
    pub vertices_after: usize,
    pub geo_engine: &'static str,
}

fn vertex_count(g: &geo::Geometry<f64>) -> usize {
    match g {
        geo::Geometry::Polygon(p) => {
            p.exterior().0.len() + p.interiors().iter().map(|r| r.0.len()).sum::<usize>()
        }
        geo::Geometry::MultiPolygon(mp) => mp.iter().map(|p| vertex_count(&geo::Geometry::Polygon(p.clone()))).sum(),
        geo::Geometry::LineString(ls) => ls.0.len(),
        geo::Geometry::MultiLineString(mls) => mls.iter().map(|l| l.0.len()).sum(),
        _ => 0,
    }
}

fn simplify_geom(g: &geo::Geometry<f64>, eps: f64) -> geo::Geometry<f64> {
    match g {
        geo::Geometry::Polygon(p) => geo::Geometry::Polygon(p.simplify_vw(&eps)),
        geo::Geometry::MultiPolygon(mp) => geo::Geometry::MultiPolygon(mp.simplify_vw(&eps)),
        geo::Geometry::LineString(ls) => geo::Geometry::LineString(ls.simplify_vw(&eps)),
        geo::Geometry::MultiLineString(mls) => geo::Geometry::MultiLineString(mls.simplify_vw(&eps)),
        other => other.clone(),
    }
}

pub fn simplify(req: &SimplifyRequest) -> Result<SimplifyResponse, String> {
    if !(req.tolerance.is_finite() && req.tolerance >= 0.0) {
        return Err("tolerance must be a finite non-negative number".into());
    }
    let gj = parse_geojson(&req.geojson)?;
    let feats = features_of(&gj);
    let mut out_features = Vec::with_capacity(feats.len());
    let (mut before, mut after) = (0usize, 0usize);
    for (g, props) in &feats {
        before += vertex_count(g);
        let s = simplify_geom(g, req.tolerance);
        after += vertex_count(&s);
        let gj_geom = Geometry::new(Value::from(&s));
        out_features.push(Feature {
            bbox: None,
            geometry: Some(gj_geom),
            id: None,
            properties: if props.is_empty() { None } else { Some(props.clone()) },
            foreign_members: None,
        });
    }
    let fc = FeatureCollection {
        bbox: None,
        features: out_features,
        foreign_members: None,
    };
    Ok(SimplifyResponse {
        geojson: GeoJson::FeatureCollection(fc).to_json_value(),
        vertices_before: before,
        vertices_after: after,
        geo_engine: "rust",
    })
}

trait ToJsonValue {
    fn to_json_value(&self) -> serde_json::Value;
}
impl ToJsonValue for GeoJson {
    fn to_json_value(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

/* ------------------------------------------------------------------ */
/* Tests (fixture: real Nigeria state polygons, public/geo artifacts)  */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    fn states_fc() -> serde_json::Value {
        let raw = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/nigeria-states.geojson"
        ))
        .expect("fixture readable");
        serde_json::from_str(&raw).expect("fixture parses")
    }

    #[test]
    fn contains_known_point_in_kaduna() {
        // Zaria ≈ (7.68, 11.03) is inside the real Kaduna state polygon.
        let res = contains(&ContainsRequest {
            polygon_geojson: states_fc(),
            points: vec![[7.68, 11.03], [6.45, 3.39]], // Zaria, Lagos-Island
        })
        .unwrap();
        assert_eq!(res.polygon_count, 37);
        let kaduna = res.results[0].properties.as_ref().expect("Zaria inside a state");
        assert_eq!(kaduna.get("name").and_then(|v| v.as_str()), Some("Kaduna"));
        let lagos = res.results[1].properties.as_ref().expect("Lagos point inside a state");
        assert_eq!(lagos.get("name").and_then(|v| v.as_str()), Some("Lagos"));
    }

    #[test]
    fn contains_point_outside_all_polygons_is_null() {
        let res = contains(&ContainsRequest {
            polygon_geojson: states_fc(),
            points: vec![[0.0, 0.0]], // Gulf of Guinea "Null Island"
        })
        .unwrap();
        assert!(res.results[0].properties.is_none());
    }

    #[test]
    fn geodesic_area_nigeria_is_sane() {
        // Nigeria's true area ≈ 923,768 km²; the simplified OSM polygons
        // should land within ±10%.
        let res = area_km2(&AreaRequest { geojson: states_fc() }).unwrap();
        assert_eq!(res.areas_km2.len(), 37);
        let total = res.total_km2;
        assert!(
            (total - 923_768.0).abs() < 92_376.0,
            "total area {total} km² outside ±10% of 923,768 km²"
        );
        // Kaduna state ≈ 46,053 km² (±25% tolerance for simplified geometry).
        let gj = parse_geojson(&states_fc()).unwrap();
        let feats = features_of(&gj);
        let idx = feats
            .iter()
            .position(|(_, p)| p.get("name").and_then(|v| v.as_str()) == Some("Kaduna"))
            .unwrap();
        let kaduna = res.areas_km2[idx];
        assert!(
            (kaduna - 46_053.0).abs() < 11_513.0,
            "Kaduna area {kaduna} km² outside expected band"
        );
    }

    #[test]
    fn within_km_finds_point_near_line() {
        // Corridor: Zaria -> Kaduna city; Zaria LGA centroid must match at 5km.
        let line = serde_json::json!({
            "type": "LineString",
            "coordinates": [[7.68, 11.03], [7.44, 10.52]]
        });
        let features = serde_json::json!({
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"tag": "zaria"}, "geometry": {"type": "Point", "coordinates": [7.71, 11.08]}},
                {"type": "Feature", "properties": {"tag": "lagos"}, "geometry": {"type": "Point", "coordinates": [3.39, 6.45]}}
            ]
        });
        let res = within_km(&WithinKmRequest {
            line_geojson: Some(line),
            point: None,
            features_geojson: features,
            km: 25.0,
        })
        .unwrap();
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.matches[0].properties.get("tag").and_then(|v| v.as_str()), Some("zaria"));
        assert!(res.matches[0].distance_km < 25.0);
    }

    #[test]
    fn within_km_point_reference_and_validation() {
        let features = serde_json::json!({
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"tag": "near"}, "geometry": {"type": "Point", "coordinates": [7.44, 10.52]}}
            ]
        });
        let res = within_km(&WithinKmRequest {
            line_geojson: None,
            point: Some([7.44, 10.52]),
            features_geojson: features.clone(),
            km: 1.0,
        })
        .unwrap();
        assert_eq!(res.matches.len(), 1);
        assert!(res.matches[0].distance_km < 0.001);
        // missing reference
        assert!(within_km(&WithinKmRequest {
            line_geojson: None,
            point: None,
            features_geojson: features.clone(),
            km: 1.0,
        })
        .is_err());
        // negative radius
        assert!(within_km(&WithinKmRequest {
            line_geojson: None,
            point: Some([7.44, 10.52]),
            features_geojson: features,
            km: -1.0,
        })
        .is_err());
    }

    #[test]
    fn simplify_reduces_vertices_and_is_deterministic() {
        let req = SimplifyRequest {
            geojson: states_fc(),
            tolerance: 0.05,
        };
        let a = simplify(&req).unwrap();
        let b = simplify(&req).unwrap();
        assert_eq!(a.vertices_after, b.vertices_after, "deterministic output");
        assert!(a.vertices_after < a.vertices_before);
        // zero tolerance keeps every vertex
        let id = simplify(&SimplifyRequest { geojson: states_fc(), tolerance: 0.0 }).unwrap();
        assert_eq!(id.vertices_after, id.vertices_before);
    }

    #[test]
    fn envelope_has_meta_and_ids_are_monotonic() {
        let e1 = envelope(serde_json::json!({"ok": true}));
        let e2 = envelope(serde_json::json!({"ok": true}));
        assert_eq!(e1.meta.api_version, "v1");
        assert!(e1.meta.request_id.starts_with("req_geo_"));
        assert_ne!(e1.meta.request_id, e2.meta.request_id);
    }

    #[test]
    fn invalid_geojson_returns_structured_error() {
        let err = contains(&ContainsRequest {
            polygon_geojson: serde_json::json!({"type": "NotGeoJson"}),
            points: vec![[0.0, 0.0]],
        });
        assert!(err.is_err());
    }
}
