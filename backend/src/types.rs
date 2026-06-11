use std::collections::HashMap;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct StreamPayload {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub url: String,
    pub method: String,
    #[serde(rename = "requestHeaders")]
    pub request_headers: HashMap<String, String>,
    #[serde(rename = "responseHeaders")]
    pub response_headers: HashMap<String, String>,
    #[serde(rename = "serverIp")]
    pub server_ip: String,
    #[serde(rename = "pageUrl")]
    pub page_url: String,
    #[serde(rename = "pageTitle")]
    pub page_title: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub selected_tab_index: usize,
    pub selected_stream_index: usize,
    pub tabs: Vec<TabSession>,
    pub downloads: Vec<DownloadTask>,
    pub tui_logs: Vec<String>,
    pub focused_panel: Panel,
}

#[derive(Debug, Clone)]
pub struct TabSession {
    pub page_url: String,
    pub page_title: String,
    pub streams: Vec<CapturedStream>,
}

#[derive(Debug, Clone)]
pub struct CapturedStream {
    pub url: String,
    pub method: String,
    pub request_headers: HashMap<String, String>,
    pub server_ip: String,
    pub format: StreamFormat,
    pub metadata: Option<StreamMetadata>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StreamFormat {
    Hls,
    Dash,
    Mp4,
    Ts,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct StreamMetadata {
    pub duration_seconds: f32,
    pub total_segments: usize,
    pub resolutions: Vec<ResolutionInfo>,
    pub audio_tracks: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ResolutionInfo {
    pub label: String,
    pub bandwidth: u64,
}

#[derive(Debug, Clone)]
pub struct DownloadTask {
    pub id: usize,
    pub stream_url: String,
    pub output_path: String,
    pub progress: u8,
    pub speed_mbps: f32,
    pub log_lines: Vec<String>,
    pub status: DownloadStatus,
}

#[derive(Debug, Clone)]
pub enum DownloadStatus {
    Queued,
    Running,
    Finished,
    Failed(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Panel {
    Streams,
    Downloads,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            selected_tab_index: 0,
            selected_stream_index: 0,
            tabs: Vec::new(),
            downloads: Vec::new(),
            tui_logs: Vec::new(),
            focused_panel: Panel::Streams,
        }
    }

    pub fn add_stream(&mut self, payload: StreamPayload) {
        let format = detect_format(&payload.url);
        let captured = CapturedStream {
            url: payload.url.clone(),
            method: payload.method,
            request_headers: payload.request_headers,
            server_ip: payload.server_ip,
            format,
            metadata: None,
        };

        let tab = self
            .tabs
            .iter_mut()
            .find(|t| t.page_url == payload.page_url);

        if let Some(tab) = tab {
            if !tab.streams.iter().any(|s| s.url == captured.url) {
                tab.streams.push(captured);
            }
        } else {
            self.tabs.push(TabSession {
                page_url: payload.page_url,
                page_title: if payload.page_title.is_empty() {
                    "Unknown Page".into()
                } else {
                    payload.page_title
                },
                streams: vec![captured],
            });
        }
    }

    pub fn selected_stream(&self) -> Option<&CapturedStream> {
        if self.tabs.is_empty() {
            return None;
        }
        let tab = &self.tabs[self.selected_tab_index];
        if tab.streams.is_empty() {
            return None;
        }
        if self.selected_stream_index >= tab.streams.len() {
            return None;
        }
        Some(&tab.streams[self.selected_stream_index])
    }

    pub fn next_tab(&mut self) {
        if self.tabs.len() > 1 {
            self.selected_tab_index = (self.selected_tab_index + 1) % self.tabs.len();
            self.selected_stream_index = 0;
        }
    }

    pub fn prev_tab(&mut self) {
        if !self.tabs.is_empty() {
            self.selected_tab_index = self
                .selected_tab_index
                .checked_sub(1)
                .unwrap_or(self.tabs.len() - 1);
            self.selected_stream_index = 0;
        }
    }

    pub fn next_stream(&mut self) {
        if !self.tabs.is_empty() {
            let tab = &self.tabs[self.selected_tab_index];
            if tab.streams.len() > 1 {
                self.selected_stream_index =
                    (self.selected_stream_index + 1) % tab.streams.len();
            }
        }
    }

    pub fn prev_stream(&mut self) {
        if !self.tabs.is_empty() {
            let tab = &self.tabs[self.selected_tab_index];
            if !tab.streams.is_empty() {
                self.selected_stream_index = self
                    .selected_stream_index
                    .checked_sub(1)
                    .unwrap_or(tab.streams.len() - 1);
            }
        }
    }

    pub fn set_stream_metadata(&mut self, tab_idx: usize, url: &str, metadata: StreamMetadata) {
        if let Some(tab) = self.tabs.get_mut(tab_idx) {
            if let Some(stream) = tab.streams.iter_mut().find(|s| s.url == url) {
                stream.metadata = Some(metadata);
            }
        }
    }
}

fn detect_format(url: &str) -> StreamFormat {
    let lower = url.to_lowercase();
    if lower.contains(".m3u8") {
        StreamFormat::Hls
    } else if lower.contains(".mpd") {
        StreamFormat::Dash
    } else if lower.contains(".mp4") {
        StreamFormat::Mp4
    } else if lower.contains(".ts") {
        StreamFormat::Ts
    } else {
        StreamFormat::Unknown
    }
}
