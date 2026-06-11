use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use regex::Regex;

use crate::types::{AppState, DownloadStatus};

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

    let result = run_downloader(&stream_url, &output_path, state.clone(), task_id, resolution).await;

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

async fn run_downloader(
    url: &str,
    output_path: &str,
    state: Arc<Mutex<AppState>>,
    task_id: usize,
    resolution: Option<String>,
) -> Result<(), String> {
    let tool = select_downloader(url);
    let args = build_args(&tool, url, output_path, resolution);

    let mut child = Command::new(&tool.binary)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", tool.binary, e))?;

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
        return Err(format!("{} exited with status: {}", tool.binary, status));
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

fn build_args(tool: &Downloader, url: &str, output_path: &str, resolution: Option<String>) -> Vec<String> {
    match tool.binary {
        "N_m3u8DL-RE" => {
            let path = std::path::Path::new(output_path);
            let parent = path.parent().and_then(|p| p.to_str()).unwrap_or("/tmp/spectur-downloads");
            let file_stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("download");
            let mut args = vec![
                url.to_string(),
                "--save-dir".into(),
                parent.to_string(),
                "--save-name".into(),
                file_stem.to_string(),
            ];
            if let Some(res) = resolution {
                args.push("-sv".into());
                args.push(format!("res={}", res));
            }
            args
        }
        "aria2c" => vec![
            url.to_string(),
            "-d".into(),
            output_path.to_string(),
            "--continue=true".into(),
            "-x16".into(),
            "-s16".into(),
        ],
        "ffmpeg" => vec![
            "-i".into(),
            url.to_string(),
            "-c".into(),
            "copy".into(),
            output_path.to_string(),
        ],
        _ => vec![url.to_string(), "-o".into(), output_path.to_string()],
    }
}
