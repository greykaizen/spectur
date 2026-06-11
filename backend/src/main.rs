mod analyzer;
mod spawner;
mod types;
mod ui;
mod ws;

use std::collections::HashSet;
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
    let mut analyzed_urls: HashSet<String> = HashSet::new();

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
                    stream.map(|s| (app.selected_tab_index, s.url.clone()))
                };

                if let Some((tab_idx, url)) = selection {
                    if !analyzed_urls.contains(&url) {
                        analyzed_urls.insert(url.clone());
                        let analyzer_state = Arc::clone(&state);
                        tokio::spawn(async move {
                            analyzer::analyze_manifest(analyzer_state, tab_idx, url).await;
                        });
                    } else {
                        let download_state = Arc::clone(&state);
                        tokio::spawn(async move {
                            spawner::spawn_download(download_state, url).await;
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
