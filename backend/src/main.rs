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
                        let (has_metadata, resolution) = match &s.probe_state {
                            crate::types::ProbeState::Done(meta) => {
                                let res = meta.resolutions.get(app.selected_resolution_index).map(|res| res.label.clone());
                                (true, res)
                            }
                            _ => (false, None),
                        };
                        (
                            app.selected_tab_index,
                            s.url.clone(),
                            s.request_headers.clone(),
                            has_metadata,
                            resolution,
                            s.manifest_content.clone(),
                        )
                    })
                };

                if let Some((tab_idx, url, headers, has_metadata, resolution, manifest_content)) = selection {
                    if has_metadata {
                        let download_state = Arc::clone(&state);
                        tokio::spawn(async move {
                            spawner::spawn_download(download_state, url, resolution).await;
                        });
                    } else {
                        let analyzer_state = Arc::clone(&state);
                        tokio::spawn(async move {
                            analyzer::analyze_manifest(analyzer_state, tab_idx, url, headers, manifest_content).await;
                        });
                    }
                }
            }
            Action::Copy => {
                let text_to_copy = {
                    let app = state.lock().await;
                    match app.focused_panel {
                        crate::types::Panel::Metadata => {
                            app.selected_stream().map(|s| format_metadata_for_copy(s, app.selected_resolution_index))
                        }
                        crate::types::Panel::Downloads => {
                            Some(format_logs_for_copy(&app.tui_logs))
                        }
                        _ => None,
                    }
                };

                if let Some(text) = text_to_copy {
                    let copy_res = match arboard::Clipboard::new() {
                        Ok(mut cb) => match cb.set_text(text) {
                            Ok(()) => Ok(()),
                            Err(e) => Err(e.to_string()),
                        },
                        Err(e) => Err(e.to_string()),
                    };

                    let mut app = state.lock().await;
                    match copy_res {
                        Ok(()) => {
                            app.tui_logs.push("Copied selection to system clipboard successfully!".to_string());
                        }
                        Err(e) => {
                            app.tui_logs.push(format!("Failed to copy to clipboard: {}", e));
                        }
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

fn format_metadata_for_copy(stream: &crate::types::CapturedStream, selected_resolution_index: usize) -> String {
    let mut s = String::new();
    s.push_str(&format!("URL: {}\n", stream.url));
    s.push_str(&format!("Method: {}\n", stream.method));
    s.push_str(&format!("Format: {:?}\n", stream.format));
    s.push_str(&format!("Server IP: {}\n", stream.server_ip));
    s.push_str("Headers:\n");
    for (k, v) in &stream.request_headers {
        s.push_str(&format!("  {}: {}\n", k, v));
    }
    s.push_str("Probe State: ");
    match &stream.probe_state {
        crate::types::ProbeState::Probing => {
            s.push_str("Probing...\n");
        }
        crate::types::ProbeState::Failed(err) => {
            s.push_str(&format!("Failed: {}\n", err));
        }
        crate::types::ProbeState::Done(meta) => {
            s.push_str("Done\n");
            s.push_str(&format!("  Duration: {}s\n", meta.duration_seconds));
            s.push_str(&format!("  Total Segments: {}\n", meta.total_segments));
            s.push_str("  Resolutions:\n");
            for (i, r) in meta.resolutions.iter().enumerate() {
                let prefix = if i == selected_resolution_index { " => " } else { "    " };
                s.push_str(&format!("{}{} (bandwidth: {})\n", prefix, r.label, r.bandwidth));
            }
            s.push_str("  Audio Tracks:\n");
            for a in &meta.audio_tracks {
                s.push_str(&format!("    {}\n", a));
            }
            if !meta.keys.is_empty() {
                s.push_str("  Encryption Keys:\n");
                for key in &meta.keys {
                    s.push_str(&format!("    Method: {}\n", key.method));
                    if let Some(ref uri) = key.uri { s.push_str(&format!("    Key URI: {}\n", uri)); }
                    if let Some(ref iv) = key.iv { s.push_str(&format!("    IV: {}\n", iv)); }
                    if let Some(ref kf) = key.keyformat { s.push_str(&format!("    Key Format: {}\n", kf)); }
                    if let Some(ref hex) = key.key_hex { s.push_str(&format!("    Key Hex: {}\n", hex)); }
                }
            }
            if !meta.drm.is_empty() {
                s.push_str("  DRM Protection:\n");
                for drm in &meta.drm {
                    s.push_str(&format!("    System: {}\n", drm.system));
                    s.push_str(&format!("    Scheme: {}\n", drm.scheme_id_uri));
                    if let Some(ref kid) = drm.default_kid { s.push_str(&format!("    KID: {}\n", kid)); }
                    if let Some(ref url) = drm.license_url { s.push_str(&format!("    License: {}\n", url)); }
                }
            }
        }
    }
    s
}

fn format_logs_for_copy(logs: &[String]) -> String {
    logs.join("\n")
}
