# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# ui
- Keep popup UI minimal and utilitarian — simple rows with a download icon button on the right, no name or fancy elements. Confidence: 0.85
- Register Alt+Shift+D keyboard shortcut to open the popup instantly without requiring mouse navigation. Confidence: 0.80
- Popup rows should show filename per entry (e.g., master.m3u8, index-f1.m3u8) like cat-catch, with resolution info so users can choose directly. Confidence: 0.70
- Row click-to-copy should be available on popup window entries to easily copy URLs. Confidence: 0.65

# rust-backend
- Download tool priority: use aria2c/ffmpeg/N_m3u8DL-RE as primary downloaders, not yt-dlp. yt-dlp is only for specific known platform sites much later. Confidence: 0.75
- Parse manifest files (.m3u8/.mpd) to extract media segment URLs before downloading — never download the playlist file itself as if it were the media. The backend must fetch + parse the manifest, select the best quality track, then download the actual media segments. Confidence: 0.80
- During manifest parsing, extract encryption key metadata: EXT-X-KEY URLs and attributes for HLS manifests, ContentProtection/pssh elements for DASH manifests — pass this encryption context to the downloader so it can handle DRM-protected streams. Confidence: 0.70

# testing
- Compare detection results against cat-catch on test sites — our popup must show detected manifests at least as visibly as cat-catch does (master.m3u8, index.m3u8, etc.). Confidence: 0.70

# extension-architecture
- Study cat-catch and stream-detector as reference implementations — the extension should capture complete auth context (cookies, headers, tokens) browser-side and pass it as a ready-to-use package to Rust. Rust's role is just to run the download with the already-prepared auth. Confidence: 0.70
- Firefox webRequest details objects are immutable per-stage copies — use Map<requestId, Buffer> to share state across onBeforeRequest/onBeforeSendHeaders/onHeadersReceived/onBeforeRedirect/onCompleted instead of mutating the details object. Confidence: 0.75

# communication
- When asked for thoughts on architecture or strategy, provide analysis without code first — the user wants the reasoning before seeing any implementation. Confidence: 0.75

# workflow
- Stay anchored in the current phase of work — avoid re-litigating past architectural discussions or referencing stale context from earlier phases unless the user explicitly brings it back. Confidence: 0.70
