use std::sync::Arc;
use tokio::sync::Mutex;

use crate::types::{AppState, ResolutionInfo, StreamMetadata};

pub async fn analyze_manifest(
    state: Arc<Mutex<AppState>>,
    tab_idx: usize,
    url: String,
) {
    let metadata = match detect_and_fetch(&url).await {
        Ok(m) => m,
        Err(e) => {
            let mut app = state.lock().await;
            app.tui_logs.push(format!("Analyzer error for {}: {}", url, e));
            return;
        }
    };

    let mut app = state.lock().await;
    app.set_stream_metadata(tab_idx, &url, metadata);
}

async fn detect_and_fetch(url: &str) -> Result<StreamMetadata, Box<dyn std::error::Error + Send + Sync>> {
    if url.contains(".m3u8") {
        parse_hls(url).await
    } else if url.contains(".mpd") {
        parse_dash(url).await
    } else {
        Err("unsupported manifest format".into())
    }
}

async fn parse_hls(url: &str) -> Result<StreamMetadata, Box<dyn std::error::Error + Send + Sync>> {
    let client = wreq::Client::builder()
        .emulation(wreq_util::Emulation::Firefox136)
        .build()?;

    let resp = client.get(url).send().await?;
    let body = resp.text().await?;

    let (_, playlist) = m3u8_rs::parse_playlist(body.as_bytes())
        .map_err(|e| format!("m3u8 parse error: {:?}", e))?;

    match playlist {
        m3u8_rs::Playlist::MasterPlaylist(master) => {
            let mut resolutions = Vec::new();
            let mut audio_tracks = Vec::new();

            for variant in &master.variants {
                if let Some(res) = &variant.resolution {
                    let label = format!("{}x{}", res.width, res.height);
                    let bw = variant.bandwidth;
                    if !resolutions.iter().any(|r: &ResolutionInfo| r.label == label) {
                        resolutions.push(ResolutionInfo { label, bandwidth: bw });
                    }
                }
            }

            for alt in &master.alternatives {
                if alt.media_type == m3u8_rs::AlternativeMediaType::Audio {
                    audio_tracks.push(alt.name.clone());
                }
            }

            Ok(StreamMetadata {
                duration_seconds: 0.0,
                total_segments: 0,
                resolutions,
                audio_tracks,
            })
        }
        m3u8_rs::Playlist::MediaPlaylist(media) => {
            let duration: f32 = media.segments.iter().map(|s| s.duration).sum();
            let total_segments = media.segments.len();

            Ok(StreamMetadata {
                duration_seconds: duration,
                total_segments,
                resolutions: Vec::new(),
                audio_tracks: Vec::new(),
            })
        }
    }
}

async fn parse_dash(url: &str) -> Result<StreamMetadata, Box<dyn std::error::Error + Send + Sync>> {
    let client = wreq::Client::builder()
        .emulation(wreq_util::Emulation::Firefox136)
        .build()?;

    let resp = client.get(url).send().await?;
    let body = resp.text().await?;

    let mpd = dash_mpd::parse(&body)
        .map_err(|e| format!("MPD parse error: {:?}", e))?;

    // use std::time::Duration for mediaPresentationDuration
    let duration_seconds = mpd.mediaPresentationDuration
        .as_ref()
        .map(|d| d.as_secs() as f32)
        .unwrap_or(0.0);

    let mut resolutions = Vec::new();
    let mut audio_tracks = Vec::new();

    for period in &mpd.periods {
        for adaptation in &period.adaptations {
            let is_video = adaptation.contentType.as_deref() == Some("video");
            let is_audio = adaptation.contentType.as_deref() == Some("audio");

            for rep in &adaptation.representations {
                if is_video {
                    if let (Some(w), Some(h)) = (rep.width, rep.height) {
                        let label = format!("{}x{}", w, h);
                        let bw = rep.bandwidth.unwrap_or(0);
                        if !resolutions.iter().any(|r: &ResolutionInfo| r.label == label) {
                            resolutions.push(ResolutionInfo { label, bandwidth: bw });
                        }
                    }
                }
                if is_audio {
                    if let Some(id) = &rep.id {
                        audio_tracks.push(id.clone());
                    }
                }
            }
        }
    }

    let total_segments = mpd.periods.iter()
        .flat_map(|p| &p.adaptations)
        .flat_map(|a| &a.representations)
        .filter_map(|r| r.SegmentTemplate.as_ref())
        .filter_map(|st| st.SegmentTimeline.as_ref())
        .map(|tl| tl.segments.len())
        .sum::<usize>()
        + mpd.periods.iter()
            .flat_map(|p| &p.adaptations)
            .flat_map(|a| &a.representations)
            .filter_map(|r| r.SegmentList.as_ref())
            .map(|sl| sl.segment_urls.len())
            .sum::<usize>();

    Ok(StreamMetadata {
        duration_seconds,
        total_segments,
        resolutions,
        audio_tracks,
    })
}
