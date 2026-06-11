use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use regex::Regex;

use crate::types::{AppState, DownloadStatus, YtFormat};

pub async fn spawn_download(
    state: Arc<Mutex<AppState>>,
    stream_url: String,
    resolution: Option<String>,
) {
    let output_dir = "/tmp/spectur-downloads";
    let _ = std::fs::create_dir_all(output_dir);

    let filename = stream_url
        .split('/')
        .last()
        .unwrap_or("download")
        .split('?')
        .next()
        .unwrap_or("download");

    let output_path = format!("{}/{}", output_dir, filename);

    let task_id: usize;
    {
        let mut app = state.lock().await;
        task_id = app.downloads.len();
        app.downloads.push(crate::types::DownloadTask {
            id: task_id,
            stream_url: stream_url.clone(),
            output_path: output_path.clone(),
            progress: 0,
            speed_mbps: 0.0,
            log_lines: Vec::new(),
            status: DownloadStatus::Running,
        });
        app.tui_logs.push(format!("Starting download: {}", stream_url));
    }

    let (request_headers, keys, is_yt, yt_format) = {
        let app = state.lock().await;
        let stream = app.tabs.iter()
            .flat_map(|t| &t.streams)
            .find(|s| s.url == stream_url);
        let headers = stream.map(|s| s.request_headers.clone()).unwrap_or_default();
        let keys = stream.and_then(|s| match &s.probe_state {
            crate::types::ProbeState::Done(m) => Some(m.keys.clone()),
            _ => None,
        }).unwrap_or_default();
        let is_yt = stream_url.contains("youtube.com") || stream_url.contains("youtu.be");
        let yt_fmt = if is_yt && resolution.is_some() {
            let res = resolution.as_deref().unwrap_or("");
            app.yt_formats.iter().find(|f| &f.short_label() == res).cloned()
        } else {
            None
        };
        (headers, keys, is_yt, yt_fmt)
    };

    let result = if is_yt {
        spawn_yt_download(&stream_url, &output_path, state.clone(), task_id, yt_format).await
    } else {
        run_downloader(&stream_url, &output_path, state.clone(), task_id, resolution, request_headers, keys).await
    };

    let mut app = state.lock().await;
    if let Some(task) = app.downloads.get_mut(task_id) {
        let output_path = task.output_path.clone();
        match result {
            Ok(()) => {
                task.status = DownloadStatus::Finished;
                task.progress = 100;
                app.tui_logs.push(format!("Download complete: {}", output_path));
            }
            Err(e) => {
                task.status = DownloadStatus::Failed(e.clone());
                app.tui_logs.push(format!("Download failed: {}", e));
            }
        }
    }
}

async fn spawn_yt_download(
    url: &str,
    output_path: &str,
    state: Arc<Mutex<AppState>>,
    task_id: usize,
    format: Option<YtFormat>,
) -> Result<(), String> {
    let path = std::path::Path::new(output_path);
    let parent = path.parent().and_then(|p| p.to_str()).unwrap_or("/tmp/spectur-downloads");
    let file_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("download");

    let mut args = vec![
        url.to_string(),
        "-o".into(),
        format!("{}/%(title)s.%(ext)s", parent),
    ];

    if let Some(ref fmt) = format {
        args.push("-f".into());
        args.push(fmt.itag.to_string());
    } else {
        args.push("-f".into());
        args.push("bestvideo+bestaudio/best".into());
    }

    spawn_and_stream("yt-dlp", &args, state, task_id).await
}

async fn run_downloader(
    url: &str,
    output_path: &str,
    state: Arc<Mutex<AppState>>,
    task_id: usize,
    resolution: Option<String>,
    headers: std::collections::HashMap<String, String>,
    keys: Vec<crate::types::KeyInfo>,
) -> Result<(), String> {
    let tool = select_downloader(url);
    let args = build_args(&tool, url, output_path, resolution, &headers, &keys);

    spawn_and_stream(tool.binary, &args, state, task_id).await
}

async fn spawn_and_stream(
    binary: &str,
    args: &[String],
    state: Arc<Mutex<AppState>>,
    task_id: usize,
) -> Result<(), String> {
    let mut child = Command::new(binary)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", binary, e))?;

    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let stderr = child.stderr.take().ok_or("no stderr pipe")?;

    let progress_re = Regex::new(r"([0-9.]+)%").unwrap();

    let stdout_task = tokio::spawn(read_and_parse(
        BufReader::new(stdout),
        state.clone(),
        task_id,
        progress_re.clone(),
    ));
    let stderr_task = tokio::spawn(read_and_parse(
        BufReader::new(stderr),
        state.clone(),
        task_id,
        progress_re,
    ));

    let status = child.wait().await.map_err(|e| e.to_string())?;

    stdout_task.abort();
    stderr_task.abort();

    if !status.success() {
        return Err(format!("{} exited with status: {}", binary, status));
    }

    Ok(())
}

async fn read_and_parse<R: tokio::io::AsyncRead + Unpin>(
    reader: BufReader<R>,
    state: Arc<Mutex<AppState>>,
    task_id: usize,
    progress_re: Regex,
) {
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let mut app = state.lock().await;
        if let Some(task) = app.downloads.get_mut(task_id) {
            task.log_lines.push(line.clone());
            if task.log_lines.len() > 200 {
                task.log_lines.remove(0);
            }
            if let Some(cap) = progress_re.captures(&line) {
                if let Ok(pct) = cap[1].parse::<f32>() {
                    task.progress = pct.min(100.0) as u8;
                }
            }
        }
    }
}

struct Downloader {
    binary: &'static str,
}

fn select_downloader(url: &str) -> Downloader {
    let lower = url.to_lowercase();
    if lower.contains(".m3u8") || lower.contains(".mpd") {
        Downloader { binary: "N_m3u8DL-RE" }
    } else {
        Downloader { binary: "aria2c" }
    }
}

fn build_args(
    tool: &Downloader,
    url: &str,
    output_path: &str,
    resolution: Option<String>,
    headers: &std::collections::HashMap<String, String>,
    keys: &[crate::types::KeyInfo],
) -> Vec<String> {
    let mut args = Vec::new();
    let header_flag = if tool.binary == "aria2c" { "--header=" } else { "-H" };
    let need_header_separate = tool.binary == "N_m3u8DL-RE" || tool.binary == "ffmpeg";

    for (k, v) in headers {
        let kl = k.to_lowercase();
        if kl == "host" || kl == "accept-encoding" || kl == "content-length" || kl == "connection" {
            continue;
        }
        if need_header_separate && kl == "cookie" {
            args.push("-H".into());
            args.push(format!("Cookie: {}", v));
        } else if need_header_separate {
            args.push("-H".into());
            args.push(format!("{}: {}", k, v));
        } else {
            args.push(format!("{}{}: {}", header_flag, k, v));
        }
    }

    match tool.binary {
        "N_m3u8DL-RE" => {
            let path = std::path::Path::new(output_path);
            let parent = path.parent().and_then(|p| p.to_str()).unwrap_or("/tmp/spectur-downloads");
            let file_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("download");
            args.push(url.to_string());
            args.push("--save-dir".into());
            args.push(parent.to_string());
            args.push("--save-name".into());
            args.push(file_stem.to_string());
            if let Some(res) = resolution {
                args.push("-sv".into());
                args.push(format!("res={}", res));
            }
            for key in keys {
                if let Some(ref hex) = key.key_hex {
                    args.push("--key".into());
                    args.push(hex.clone());
                }
            }
        }
        "aria2c" => {
            args.push(url.to_string());
            args.push("-d".into());
            args.push(output_path.to_string());
            args.push("--continue=true".into());
            args.push("-x16".into());
            args.push("-s16".into());
        }
        "ffmpeg" => {
            args.push("-i".into());
            args.push(url.to_string());
            args.push("-c".into());
            args.push("copy".into());
            args.push(output_path.to_string());
        }
        _ => {
            args.push(url.to_string());
            args.push("-o".into());
            args.push(output_path.to_string());
        }
    }

    args
}
