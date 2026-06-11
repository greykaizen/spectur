use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::accept_async;
use futures_util::StreamExt;

use crate::types::{AppState, StreamPayload};

pub async fn start_ws_server(state: Arc<Mutex<AppState>>) -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:8080").await?;

    loop {
        let (stream, _addr) = listener.accept().await?;
        let state = Arc::clone(&state);

        tokio::spawn(async move {
            if let Ok(ws_stream) = accept_async(stream).await {
                handle_connection(ws_stream, state).await;
            }
        });
    }
}

async fn handle_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    state: Arc<Mutex<AppState>>,
) {
    let (_, mut rx) = ws_stream.split();

    while let Some(result) = rx.next().await {
        match result {
            Ok(msg) => {
                if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
                    match serde_json::from_str::<StreamPayload>(&text) {
                        Ok(payload) => {
                            let url = payload.url.clone();
                            let headers = payload.request_headers.clone();
                            let manifest_content = payload.manifest_content.clone();

                            let mut app = state.lock().await;
                            let (tab_idx, exists) = app.add_stream(payload);

                            if !exists {
                                let analyzer_state = Arc::clone(&state);
                                tokio::spawn(async move {
                                    crate::analyzer::analyze_manifest(analyzer_state, tab_idx, url, headers, manifest_content).await;
                                });
                            }
                        }
                        Err(e) => {
                            let mut app = state.lock().await;
                            app.tui_logs.push(format!("WS parse error: {}", e));
                        }
                    }
                }
            }
            Err(e) => {
                let mut app = state.lock().await;
                app.tui_logs.push(format!("WS error: {}", e));
                break;
            }
        }
    }
}
