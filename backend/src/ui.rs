use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use ratatui::layout::{Constraint, Layout};
use ratatui::prelude::{Alignment, Frame, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, List, ListItem, Paragraph, Wrap};
use std::time::Duration;

use crate::types::{AppState, DownloadStatus, Panel, StreamFormat, ProbeState};

#[derive(PartialEq)]
pub enum Action {
    None,
    Quit,
    Enter,
    Copy,
}

pub fn render(frame: &mut Frame, state: &AppState) {
    let area = frame.area();
    let [header_area, body_area] =
        Layout::vertical([Constraint::Length(2), Constraint::Fill(1)]).areas(area);
    render_header(frame, header_area);

    let [top_area, bottom_area] =
        Layout::vertical([Constraint::Fill(2), Constraint::Fill(1)]).areas(body_area);
    let [left_area, right_area] =
        Layout::horizontal([Constraint::Fill(1), Constraint::Fill(1)]).areas(top_area);

    render_stream_list(frame, left_area, state);
    render_metadata(frame, right_area, state);
    render_downloads(frame, bottom_area, state);
}

fn render_header(frame: &mut Frame, area: Rect) {
    let text = Paragraph::new("SPECTUR — Media Stream Sniffer & Downloader")
        .block(Block::bordered())
        .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD))
        .alignment(Alignment::Center);
    frame.render_widget(text, area);
}

fn render_stream_list(frame: &mut Frame, area: Rect, state: &AppState) {
    let mut items: Vec<ListItem> = Vec::new();
    for (tab_idx, tab) in state.tabs.iter().enumerate() {
        let tab_label = if tab.page_title.is_empty() { &tab.page_url } else { &tab.page_title };
        let tab_line = if tab_idx == state.selected_tab_index {
            Line::from(vec![Span::styled(
                format!("▶ [Tab {}] {} ({} streams)", tab_idx + 1, tab_label, tab.streams.len()),
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
            )])
        } else {
            Line::from(format!("  [Tab {}] {} ({} streams)", tab_idx + 1, tab_label, tab.streams.len()))
        };
        items.push(ListItem::new(tab_line));

        if tab_idx == state.selected_tab_index {
            for (stream_idx, stream) in tab.streams.iter().enumerate() {
                let stream_prefix = if stream_idx == state.selected_stream_index { " > " } else { "   " };
                let format_str = match stream.format {
                    StreamFormat::Hls => "HLS", StreamFormat::Dash => "DASH",
                    StreamFormat::Mp4 => "MP4", StreamFormat::Ts => "TS", StreamFormat::Unknown => "?",
                };
                let url_display = if stream.url.len() > 55 {
                    format!("{}...", &stream.url[..52])
                } else { stream.url.clone() };
                let stream_line = format!("{} [{}] {}", stream_prefix, format_str, url_display);
                if stream_idx == state.selected_stream_index && state.focused_panel == Panel::Streams {
                    items.push(ListItem::new(Line::from(vec![
                        Span::styled(stream_line, Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)),
                    ])));
                } else {
                    items.push(ListItem::new(stream_line));
                }
            }
        }
    }
    if items.is_empty() {
        items.push(ListItem::new(Span::styled(
            "Waiting for media streams... (browse to a page with video)",
            Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
        )));
    }
    let list = List::new(items).block(
        Block::bordered().title(" Streams ").border_style(
            if state.focused_panel == Panel::Streams { Style::default().fg(Color::Green) } else { Style::default() }
        ),
    );
    frame.render_widget(list, area);
}

fn render_metadata(frame: &mut Frame, area: Rect, state: &AppState) {
    let content = if let Some(stream) = state.selected_stream() {
        match &stream.probe_state {
            ProbeState::Done(meta) => {
                let mut lines = vec![
                    Line::from(vec![
                        Span::raw("Format: "),
                        Span::styled(match stream.format {
                            StreamFormat::Hls => "HLS Manifest",
                            StreamFormat::Dash => "DASH MPD",
                            StreamFormat::Mp4 => "MP4 Progressive",
                            StreamFormat::Ts => "TS Segment",
                            StreamFormat::Unknown => "Unknown",
                        }, Style::default().fg(Color::Yellow)),
                    ]),
                    Line::from(""),
                ];

                if meta.duration_seconds > 0.0 {
                    let mins = (meta.duration_seconds / 60.0) as u32;
                    let secs = (meta.duration_seconds % 60.0) as u32;
                    lines.push(Line::from(format!("Duration: {:02}:{:02}", mins, secs)));
                }
                if meta.total_segments > 1 {
                    lines.push(Line::from(format!("Total Segments: {}", meta.total_segments)));
                }

                if !meta.resolutions.is_empty() {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![
                        Span::styled("Resolutions (Tab to select):", Style::default().fg(Color::Cyan)),
                    ]));
                    for (i, res) in meta.resolutions.iter().enumerate() {
                        let mut detail = res.label.clone();
                        if res.bandwidth > 0 { detail.push_str(&format!(" ({} kbps)", res.bandwidth / 1000)); }
                        if let Some(ref codecs) = res.codecs { detail.push_str(&format!(" [{}]", codecs)); }
                        if let Some(ref fr) = res.frame_rate { detail.push_str(&format!(" {}fps", fr)); }
                        let prefix = if i == state.selected_resolution_index && state.focused_panel == Panel::Metadata { " > " } else { "   " };
                        let style = if i == state.selected_resolution_index && state.focused_panel == Panel::Metadata {
                            Style::default().fg(Color::Green).add_modifier(Modifier::BOLD)
                        } else { Style::default() };
                        lines.push(Line::from(vec![Span::styled(format!("{}{}", prefix, detail), style)]));
                    }
                }

                if !meta.audio_tracks.is_empty() {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![Span::styled("Audio Tracks:", Style::default().fg(Color::Cyan))]));
                    for (i, track) in meta.audio_tracks.iter().enumerate() {
                        lines.push(Line::from(format!("  [Audio {:02}] {}", i + 1, track)));
                    }
                }

                if !meta.keys.is_empty() {
                    lines.push(Line::from(""));
                    lines.push(Line::from(vec![Span::styled("Encryption Keys:", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD))]));
                    for key in &meta.keys {
                        lines.push(Line::from(format!("  Method: {}", key.method)));
                        if let Some(ref uri) = key.uri { lines.push(Line::from(format!("  Key URI: {}", uri))); }
                        if let Some(ref iv) = key.iv { lines.push(Line::from(format!("  IV: {}", iv))); }
                        if let Some(ref kf) = key.keyformat { lines.push(Line::from(format!("  Key Format: {}", kf))); }
                        if let Some(ref hex) = key.key_hex { lines.push(Line::from(format!("  Key Hex: {}", hex))); }
                        lines.push(Line::from(""));
                    }
                }

                if !meta.drm.is_empty() {
                    lines.push(Line::from(vec![Span::styled("DRM Protection:", Style::default().fg(Color::Red).add_modifier(Modifier::BOLD))]));
                    for drm in &meta.drm {
                        lines.push(Line::from(format!("  System: {}", drm.system)));
                        lines.push(Line::from(format!("  Scheme: {}", drm.scheme_id_uri)));
                        if let Some(ref kid) = drm.default_kid { lines.push(Line::from(format!("  KID: {}", kid))); }
                        if let Some(ref url) = drm.license_url { lines.push(Line::from(format!("  License: {}", url))); }
                        if drm.pssh_data.is_some() { lines.push(Line::from("  PSSH: present")); }
                        lines.push(Line::from(""));
                    }
                }

                lines.push(Line::from(vec![
                    Span::styled("[ Press Enter to download ]", Style::default().fg(Color::Green)),
                ]));
                Text::from(lines)
            }
            ProbeState::Probing => Text::from(vec![
                Line::from(vec![Span::raw("URL: "), Span::styled(&stream.url, Style::default().fg(Color::Blue))]),
                Line::from(""),
                Line::from(vec![Span::styled("Probing manifest...", Style::default().fg(Color::Yellow).add_modifier(Modifier::ITALIC))]),
            ]),
            ProbeState::Failed(err) => Text::from(vec![
                Line::from(vec![Span::raw("URL: "), Span::styled(&stream.url, Style::default().fg(Color::Blue))]),
                Line::from(""),
                Line::from(vec![Span::styled("Probe failed:", Style::default().fg(Color::Red).add_modifier(Modifier::BOLD))]),
                Line::from(vec![Span::styled(err, Style::default().fg(Color::Red))]),
            ]),
        }
    } else {
        Text::from(vec![Line::from(vec![Span::styled("No stream selected", Style::default().fg(Color::DarkGray))])])
    };

    let paragraph = Paragraph::new(content)
        .block(Block::bordered().title(" Metadata ").border_style(
            if state.focused_panel == Panel::Metadata { Style::default().fg(Color::Green) } else { Style::default() }
        ))
        .wrap(Wrap { trim: false });
    frame.render_widget(paragraph, area);
}

fn render_downloads(frame: &mut Frame, area: Rect, state: &AppState) {
    let [progress_area, log_area] =
        Layout::horizontal([Constraint::Fill(1), Constraint::Fill(1)]).areas(area);
    render_progress(frame, progress_area, state);
    render_logs(frame, log_area, state);
}

fn render_progress(frame: &mut Frame, area: Rect, state: &AppState) {
    let mut lines: Vec<Line> = Vec::new();
    if state.downloads.is_empty() {
        lines.push(Line::from(vec![Span::styled("No active downloads", Style::default().fg(Color::DarkGray))]));
        lines.push(Line::from(""));
        lines.push(Line::from(vec![Span::styled("Press Enter on a stream to start downloading", Style::default().fg(Color::DarkGray))]));
    } else {
        for task in &state.downloads {
            let (status_str, status_color) = match &task.status {
                DownloadStatus::Queued => ("QUEUED", Color::Yellow),
                DownloadStatus::Running => ("RUNNING", Color::Cyan),
                DownloadStatus::Finished => ("DONE", Color::Green),
                DownloadStatus::Failed(_) => ("FAILED", Color::Red),
            };
            lines.push(Line::from(vec![
                Span::styled(format!("[{}]", status_str), Style::default().fg(status_color).add_modifier(Modifier::BOLD)),
                Span::raw(format!(" Download #{}", task.id + 1)),
            ]));
            let url_display = if task.stream_url.len() > 45 { format!("{}...", &task.stream_url[..42]) } else { task.stream_url.clone() };
            lines.push(Line::from(format!("  URL: {}", url_display)));
            lines.push(Line::from(format!("  Progress: {:>3}% | Speed: {:.1} MB/s", task.progress, task.speed_mbps)));
            if let DownloadStatus::Failed(err) = &task.status {
                lines.push(Line::from(vec![Span::styled(format!("  Error: {}", err), Style::default().fg(Color::Red))]));
            }
        }
    }
    let paragraph = Paragraph::new(Text::from(lines))
        .block(Block::bordered().title(" Progress ").border_style(
            if state.focused_panel == Panel::Downloads { Style::default().fg(Color::Green) } else { Style::default() }
        ))
        .wrap(Wrap { trim: false });
    frame.render_widget(paragraph, area);
}

fn render_logs(frame: &mut Frame, area: Rect, state: &AppState) {
    let log_lines: Vec<Line> = state.tui_logs.iter().rev().take(15).map(|l| {
        if l.contains("error") || l.contains("Error") || l.contains("FAILED") {
            Line::from(vec![Span::styled(l, Style::default().fg(Color::Red))])
        } else if l.contains("complete") || l.contains("Done") {
            Line::from(vec![Span::styled(l, Style::default().fg(Color::Green))])
        } else {
            Line::from(vec![Span::raw(l)])
        }
    }).collect();
    let list = List::new(log_lines).block(Block::bordered().title(" Logs "));
    frame.render_widget(list, area);
}

pub fn handle_events(state: &mut AppState) -> std::io::Result<Action> {
    if !event::poll(Duration::from_millis(50))? { return Ok(Action::None); }
    match event::read()? {
        Event::Key(key) if key.kind == KeyEventKind::Press => match key.code {
            KeyCode::Char('q') | KeyCode::Esc => return Ok(Action::Quit),
            KeyCode::Tab => {
                state.focused_panel = match state.focused_panel {
                    Panel::Streams => Panel::Metadata,
                    Panel::Metadata => Panel::Downloads,
                    Panel::Downloads => Panel::Streams,
                };
            }
            KeyCode::Up => {
                if state.focused_panel == Panel::Streams { state.prev_stream(); }
                else if state.focused_panel == Panel::Metadata { state.prev_resolution(); }
            }
            KeyCode::Down => {
                if state.focused_panel == Panel::Streams { state.next_stream(); }
                else if state.focused_panel == Panel::Metadata { state.next_resolution(); }
            }
            KeyCode::Left => { if state.focused_panel == Panel::Streams { state.prev_tab(); } }
            KeyCode::Right => { if state.focused_panel == Panel::Streams { state.next_tab(); } }
            KeyCode::Enter => return Ok(Action::Enter),
            KeyCode::Char('c') | KeyCode::Char('C') => return Ok(Action::Copy),
            _ => {}
        },
        _ => {}
    }
    Ok(Action::None)
}
