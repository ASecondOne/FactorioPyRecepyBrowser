mod solver;

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tower_http::{compression::CompressionLayer, services::ServeDir};

struct AppState {
    dataset_raw: Bytes,
    dataset: solver::Dataset,
    layouts_dir: PathBuf,
}

fn find_root() -> PathBuf {
    if let Ok(r) = std::env::var("PLANNER_ROOT") {
        return PathBuf::from(r);
    }
    let cwd = std::env::current_dir().unwrap();
    if cwd.join("data/dataset.json").exists() {
        return cwd;
    }
    if let Ok(exe) = std::env::current_exe() {
        for a in exe.ancestors() {
            if a.join("data/dataset.json").exists() {
                return a.to_path_buf();
            }
        }
    }
    cwd
}

fn sanitize(name: &str) -> Option<String> {
    let s: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || "-_ .".contains(*c)).collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() || s.len() > 100 { None } else { Some(s) }
}

async fn get_data(State(st): State<Arc<AppState>>) -> Response {
    ([(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-cache")], st.dataset_raw.clone()).into_response()
}

async fn post_solve(State(st): State<Arc<AppState>>, Json(req): Json<solver::SolveReq>) -> Json<solver::SolveResp> {
    Json(solver::solve(&st.dataset, &req))
}

async fn list_layouts(State(st): State<Arc<AppState>>) -> Json<Vec<String>> {
    let mut v = vec![];
    if let Ok(rd) = std::fs::read_dir(&st.layouts_dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "json").unwrap_or(false) {
                if let Some(s) = p.file_stem() {
                    v.push(s.to_string_lossy().to_string());
                }
            }
        }
    }
    v.sort();
    Json(v)
}

async fn get_layout(State(st): State<Arc<AppState>>, Path(name): Path<String>) -> Response {
    let Some(n) = sanitize(&name) else { return StatusCode::BAD_REQUEST.into_response() };
    match std::fs::read(st.layouts_dir.join(format!("{n}.json"))) {
        Ok(b) => ([(header::CONTENT_TYPE, "application/json")], b).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn put_layout(State(st): State<Arc<AppState>>, Path(name): Path<String>, body: Bytes) -> Response {
    let Some(n) = sanitize(&name) else { return StatusCode::BAD_REQUEST.into_response() };
    if serde_json::from_slice::<serde_json::Value>(&body).is_err() {
        return (StatusCode::BAD_REQUEST, "invalid json").into_response();
    }
    let _ = std::fs::create_dir_all(&st.layouts_dir);
    match std::fs::write(st.layouts_dir.join(format!("{n}.json")), &body) {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn delete_layout(State(st): State<Arc<AppState>>, Path(name): Path<String>) -> Response {
    let Some(n) = sanitize(&name) else { return StatusCode::BAD_REQUEST.into_response() };
    match std::fs::remove_file(st.layouts_dir.join(format!("{n}.json"))) {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Icons rarely change: cache them a day. Everything else (index.html, app.js, style.css, api) must be
/// revalidated so a rebuilt/updated planner is picked up on a normal reload.
async fn cache_headers(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let icons = req.uri().path().starts_with("/icons/");
    let mut res = next.run(req).await;
    let v = if icons { "public, max-age=86400" } else { "no-cache" };
    res.headers_mut().entry(header::CACHE_CONTROL).or_insert(header::HeaderValue::from_static(v));
    res
}

#[tokio::main]
async fn main() {
    let root = find_root();
    let ds_path = root.join("data/dataset.json");
    let raw = std::fs::read(&ds_path).unwrap_or_else(|e| panic!("cannot read {}: {e}", ds_path.display()));
    let dataset: solver::Dataset = serde_json::from_slice(&raw).expect("dataset.json parse error");
    println!("loaded {} recipes, {} machines from {}", dataset.recipes.len(), dataset.machines.len(), ds_path.display());
    let state = Arc::new(AppState { dataset_raw: Bytes::from(raw), dataset, layouts_dir: root.join("layouts") });

    let app = Router::new()
        .route("/api/data", get(get_data))
        .route("/api/solve", post(post_solve))
        .route("/api/layouts", get(list_layouts))
        .route("/api/layouts/:name", get(get_layout).put(put_layout).delete(delete_layout))
        .with_state(state)
        .fallback_service(ServeDir::new(root.join("static")))
        .layer(axum::middleware::from_fn(cache_headers))
        .layer(CompressionLayer::new());

    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8642);
    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let addr: SocketAddr = format!("{host}:{port}").parse().expect("bad HOST/PORT");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap_or_else(|e| panic!("cannot bind {addr}: {e}"));
    println!("Pyanodons planner running at http://{addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap();
}
