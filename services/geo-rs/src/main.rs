//! geo-rs HTTP service (axum). Endpoints under the platform's standard
//! JSON envelope {data, meta{request_id, api_version}}. See README.md.

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use geo_rs::{
    area_km2, contains, envelope, error_envelope, simplify, within_km, AreaRequest,
    ContainsRequest, SimplifyRequest, WithinKmRequest,
};
use serde::Serialize;
use tower_http::trace::TraceLayer;
use tracing::info;

#[derive(Clone)]
struct AppState;

#[derive(Serialize)]
struct Health {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

async fn health() -> impl IntoResponse {
    Json(envelope(Health {
        status: "ok",
        service: "geo-rs",
        version: env!("CARGO_PKG_VERSION"),
    }))
}

macro_rules! handler {
    ($name:ident, $req:ty, $fun:path) => {
        async fn $name(
            State(_): State<AppState>,
            body: Result<Json<$req>, axum::extract::rejection::JsonRejection>,
        ) -> impl IntoResponse {
            let Json(req) = match body {
                Ok(v) => v,
                Err(e) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::to_value(error_envelope(
                            "INVALID_JSON",
                            format!("malformed request body: {e}"),
                        ))
                        .unwrap()),
                    )
                        .into_response();
                }
            };
            match $fun(&req) {
                Ok(res) => {
                    info!(endpoint = stringify!($name), "ok");
                    (StatusCode::OK, Json(serde_json::to_value(envelope(res)).unwrap()))
                        .into_response()
                }
                Err(msg) => (
                    StatusCode::BAD_REQUEST,
                    Json(
                        serde_json::to_value(error_envelope("GEO_COMPUTE_ERROR", msg)).unwrap(),
                    ),
                )
                    .into_response(),
            }
        }
    };
}

handler!(contains_handler, ContainsRequest, contains);
handler!(area_handler, AreaRequest, area_km2);
handler!(within_handler, WithinKmRequest, within_km);
handler!(simplify_handler, SimplifyRequest, simplify);

pub fn app() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/geo/contains", post(contains_handler))
        .route("/v1/geo/area-km2", post(area_handler))
        .route("/v1/geo/within-km", post(within_handler))
        .route("/v1/geo/simplify", post(simplify_handler))
        .layer(TraceLayer::new_for_http())
        .with_state(AppState)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "geo_rs=info,tower_http=info".into()),
        )
        .json()
        .init();

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8500);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    info!(%addr, "geo-rs listening");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app()).await.expect("serve");
}

#[cfg(test)]
mod http_tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::util::ServiceExt;

    async fn post(app: Router, path: &str, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
        let res = app
            .oneshot(
                axum::http::Request::post(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn health_envelope() {
        let res = app()
            .oneshot(axum::http::Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["data"]["status"], "ok");
        assert_eq!(v["meta"]["api_version"], "v1");
        assert!(v["meta"]["request_id"].as_str().unwrap().starts_with("req_geo_"));
    }

    #[tokio::test]
    async fn contains_endpoint_kaduna() {
        let fc: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/nigeria-states.geojson"
            ))
            .unwrap(),
        )
        .unwrap();
        let (status, v) = post(
            app(),
            "/v1/geo/contains",
            serde_json::json!({"polygon_geojson": fc, "points": [[7.68, 11.03]]}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(v["data"]["results"][0]["properties"]["name"], "Kaduna");
        assert_eq!(v["data"]["geo_engine"], "rust");
    }

    #[tokio::test]
    async fn area_endpoint_sane_total() {
        let fc: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/nigeria-states.geojson"
            ))
            .unwrap(),
        )
        .unwrap();
        let (status, v) = post(app(), "/v1/geo/area-km2", serde_json::json!({"geojson": fc})).await;
        assert_eq!(status, StatusCode::OK);
        let total = v["data"]["total_km2"].as_f64().unwrap();
        assert!((total - 923_768.0).abs() < 92_376.0, "total {total}");
    }

    #[tokio::test]
    async fn bad_body_is_structured_error() {
        let (status, v) = post(app(), "/v1/geo/contains", serde_json::json!({"points": "nope"})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(v["error"]["code"].is_string());
        assert!(v["error"]["request_id"].as_str().unwrap().starts_with("req_geo_"));
    }
}
