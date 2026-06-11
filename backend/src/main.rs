mod analyzer;
mod spawner;
mod types;
mod ui;
mod ws;

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::types::AppState;
use crate::ui::Action;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(Mutex::new(AppState::new()));

    let ws_state = Arc::clone(&state);
    let ws_handle = tokio::spawn(async move {
        if let Err(e) = ws::start_ws_server(ws_state).await {
            eprintln!("WebSocket server error: {}", e);
        }
    });

    let mut terminal = ratatui::init();

    loop {
        let action;
        {
            let mut app = state.lock().await;
            action = ui::handle_events(&mut app)?;
        }

        match action {
            Action::Quit => break,
            Action::Enter => {
                let selection = {
                    let app = state.lock().await;
                    let stream = app.selected_stream();
                    stream.map(|s| {
                        let resolution = s.metadata.as_ref().and_then(|meta| {
                            meta.resolutions.get(app.selected_resolution_index).map(|res| res.label.clone())
                        });
                        (
                            app.selected_tab_index,
                            s.url.clone(),
                            s.request_headers.clone(),
                            s.metadata.is_some(),
                            resolution,
                        )
                    })
                };

                if let Some((tab_idx, url, headers, has_metadata, resolution)) = selection {
                    if has_metadata {
                        let download_state = Arc::clone(&state);
                        tokio::spawn(async move {
                            spawner::spawn_download(download_state, url, resolution).await;
                        });
                    } else {
                        let analyzer_state = Arc::clone(&state);
                        tokio::spawn(async move {
                            analyzer::analyze_manifest(analyzer_state, tab_idx, url, headers).await;
                        });
                    }
                }
            }
            Action::None => {}
        }

        {
            let app = state.lock().await;
            if let Err(e) = terminal.draw(|frame| ui::render(frame, &app)) {
                eprintln!("Terminal draw error: {}", e);
                break;
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(16)).await;
    }

    ratatui::restore();
    ws_handle.abort();

    Ok(())
}
