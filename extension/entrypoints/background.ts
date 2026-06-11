import { defineBackground } from 'wxt/sandbox';

interface StreamPayload {
  requestId: string;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  serverIp: string;
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
  manifestContent?: string;
}

export default defineBackground(() => {
  const WS_URL = 'ws://127.0.0.1:8080';
  const MEDIA_EXTENSIONS = /\.(m3u8|mpd|mp4|m4v|webm|mov)(\?|$)/i;
  const MEDIA_MIME_TYPES = [
    'application/vnd.apple.mpegurl',
    'application/x-mpegURL',
    'application/mpegurl',
    'application/dash+xml',
    'video/mp4',
    'video/webm',
    'application/m4s',
    'application/octet-stream-m3u8',
    'application/x-mpegurl',
    'application/vnd.apple.mpegurl',
  ];

  const activeRequests = new Map<string, Partial<StreamPayload>>();
  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function isMediaRequest(url: string): boolean {
    return MEDIA_EXTENSIONS.test(url);
  }

  function isMediaMimeType(mime: string): boolean {
    const lower = mime.toLowerCase();
    if (lower.startsWith('video/')) {
      if (lower.includes('mp2t')) return false;
      return true;
    }
    return MEDIA_MIME_TYPES.some(t => lower.startsWith(t.toLowerCase()));
  }

  function buildPayload(id: string, partial: Partial<StreamPayload>): StreamPayload {
    return {
      requestId: id,
      url: partial.url || '',
      method: partial.method || 'GET',
      requestHeaders: partial.requestHeaders || {},
      responseHeaders: partial.responseHeaders || {},
      serverIp: partial.serverIp || '',
      pageUrl: partial.pageUrl || '',
      pageTitle: partial.pageTitle || '',
      timestamp: Date.now(),
      manifestContent: partial.manifestContent,
    };
  }

  function connectWebSocket(): void {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try { ws = new WebSocket(WS_URL); } catch { scheduleReconnect(); return; }
    ws.onopen = () => { reconnectDelay = 1000; };
    ws.onerror = () => { ws?.close(); };
    ws.onclose = () => { ws = null; scheduleReconnect(); };
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connectWebSocket();
    }, reconnectDelay);
  }

  function sendPayload(payload: StreamPayload): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      connectWebSocket();
    }
  }

  function headersToRecord(headers: { name: string; value?: string }[] | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    if (!headers) return result;
    for (const h of headers) {
      if (h.name && h.value !== undefined) {
        result[h.name] = h.value;
      }
    }
    return result;
  }

  function isYouTube(url: string): boolean {
    return /youtube\.com|googlevideo\.com|ytimg\.com/i.test(url);
  }

  function isAudioOnly(url: string, contentType: string): boolean {
    const lowerMime = contentType.toLowerCase();
    if (lowerMime.startsWith('audio/')) return true;
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.toLowerCase();
      if (/\/(audio|aac|mp3|m4a|ogg|opus)(\/|\?|\.|$)/i.test(path)) return true;
    } catch (_) {}
    return false;
  }

  let lastCapturedMediaUrl = '';
  let lastCapturedTimestamp = 0;

  interface CapturedMediaRequest {
    url: string;
    timestamp: number;
    method: string;
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    serverIp: string;
  }
  const capturedMediaRequests: CapturedMediaRequest[] = [];

  function recordCapturedMedia(
    url: string,
    method: string,
    requestHeaders?: Record<string, string>,
    responseHeaders?: Record<string, string>,
    serverIp?: string
  ): void {
    if (isAudioOnly(url, '')) return;
    const now = Date.now();
    const existingIdx = capturedMediaRequests.findIndex(r => r.url === url);
    if (existingIdx !== -1) {
      const existing = capturedMediaRequests[existingIdx];
      existing.timestamp = now;
      if (method) existing.method = method;
      if (requestHeaders) existing.requestHeaders = { ...existing.requestHeaders, ...requestHeaders };
      if (responseHeaders) existing.responseHeaders = { ...existing.responseHeaders, ...responseHeaders };
      if (serverIp) existing.serverIp = serverIp;
    } else {
      capturedMediaRequests.push({ url, timestamp: now, method: method || 'GET', requestHeaders: requestHeaders || {}, responseHeaders: responseHeaders || {}, serverIp: serverIp || '' });
    }
    const limit = now - 20000;
    while (capturedMediaRequests.length > 0 && capturedMediaRequests[0].timestamp < limit) {
      capturedMediaRequests.shift();
    }
  }

  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (isYouTube(details.url)) return;
      if (details.originUrl && isYouTube(details.originUrl)) return;
      if (details.initiator && isYouTube(details.initiator)) return;
      if (isAudioOnly(details.url, '')) return;
      
      const isMedia = details.url.includes('.m3u8') || details.url.includes('.mpd');
      if (isMedia) {
        lastCapturedMediaUrl = details.url;
        lastCapturedTimestamp = Date.now();
        recordCapturedMedia(details.url, details.method, headersToRecord(details.requestHeaders));
      }
      
      activeRequests.set(details.requestId, {
        requestId: details.requestId,
        url: details.url,
        method: details.method,
        requestHeaders: headersToRecord(details.requestHeaders),
        timestamp: Date.now(),
      });
    },
    { urls: ['<all_urls>'] },
    ['requestHeaders']
  );

  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      const entry = activeRequests.get(details.requestId);
      if (!entry) return;
      const contentType = details.responseHeaders?.find(
        h => h.name.toLowerCase() === 'content-type'
      )?.value || '';
      if (isMediaMimeType(contentType) || isMediaRequest(details.url)) {
        if (isAudioOnly(details.url, contentType)) {
          activeRequests.delete(details.requestId);
          return;
        }
        
        const isMedia = details.url.includes('.m3u8') || details.url.includes('.mpd');
        if (isMedia) {
          lastCapturedMediaUrl = details.url;
          lastCapturedTimestamp = Date.now();
          recordCapturedMedia(
            details.url,
            details.method || entry.method || 'GET',
            entry.requestHeaders,
            headersToRecord(details.responseHeaders),
            details.ip || ''
          );
        }
        
        entry.responseHeaders = headersToRecord(details.responseHeaders);
        entry.serverIp = details.ip || '';
      } else {
        activeRequests.delete(details.requestId);
      }
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );

  browser.webRequest.onResponseStarted.addListener(
    async (details) => {
      const entry = activeRequests.get(details.requestId);
      if (!entry) return;
      entry.serverIp = details.ip || '';
      
      const isMedia = details.url.includes('.m3u8') || details.url.includes('.mpd');
      if (isMedia) {
        recordCapturedMedia(
          details.url,
          details.method || entry.method || 'GET',
          entry.requestHeaders,
          entry.responseHeaders,
          details.ip || ''
        );
      }
      
      try {
        const tab = await browser.tabs.get(details.tabId);
        entry.pageUrl = tab.url || '';
        entry.pageTitle = tab.title || '';
      } catch {
        entry.pageUrl = '';
        entry.pageTitle = '';
      }
      const payload = buildPayload(details.requestId, entry);
      sendPayload(payload);
      activeRequests.delete(details.requestId);
    },
    { urls: ['<all_urls>'] }
  );

  browser.webRequest.onErrorOccurred.addListener(
    (details) => { activeRequests.delete(details.requestId); },
    { urls: ['<all_urls>'] }
  );

  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of activeRequests.entries()) {
      if (entry.timestamp && now - entry.timestamp > 30000) {
        activeRequests.delete(id);
      }
    }
  }, 10000);

  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (message.action === 'addDecryptedManifest') {
      if (isAudioOnly(message.url, '')) return;
      const pageUrl = sender.tab?.url || '';
      const pageTitle = sender.tab?.title || '';
      
      let matchedUrl = message.url;
      let matchedHeaders: Record<string, string> = {};
      let matchedResponseHeaders: Record<string, string> = message.format === 'm3u8' 
        ? { 'content-type': 'application/x-mpegurl' }
        : { 'content-type': 'application/dash+xml' };
      let matchedServerIp = '';
      
      if (message.isPageUrl) {
        const now = Date.now();
        const limit = now - 20000;
        while (capturedMediaRequests.length > 0 && capturedMediaRequests[0].timestamp < limit) {
          capturedMediaRequests.shift();
        }

        const format = message.format;
        const candidates = capturedMediaRequests.filter(r => {
          if (format === 'm3u8') return r.url.toLowerCase().includes('.m3u8');
          else if (format === 'mpd') return r.url.toLowerCase().includes('.mpd');
          return false;
        });

        if (candidates.length > 0) {
          candidates.sort((a, b) => b.timestamp - a.timestamp);
          const content = message.content || '';
          const isMaster = content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-MEDIA');
          
          let selectedCandidate = null;
          if (isMaster) {
            selectedCandidate = candidates.find(r => {
              const urlLower = r.url.toLowerCase();
              return urlLower.includes('master') || (!urlLower.includes('video') && !urlLower.includes('audio') && !urlLower.includes('track'));
            });
          } else {
            selectedCandidate = candidates.find(r => {
              const urlLower = r.url.toLowerCase();
              return urlLower.includes('video') || urlLower.includes('audio') || urlLower.includes('track');
            });
          }
          if (!selectedCandidate) selectedCandidate = candidates[0];
          matchedUrl = selectedCandidate.url;
          matchedHeaders = selectedCandidate.requestHeaders;
          matchedResponseHeaders = { ...selectedCandidate.responseHeaders, ...matchedResponseHeaders };
          matchedServerIp = selectedCandidate.serverIp;
        } else {
          let activeMediaUrl = '';
          for (const [, entry] of activeRequests.entries()) {
            if (entry.url && (entry.url.includes('.m3u8') || entry.url.includes('.mpd'))) {
              activeMediaUrl = entry.url;
              break;
            }
          }
          if (activeMediaUrl) {
            matchedUrl = activeMediaUrl;
          } else if (lastCapturedMediaUrl && Date.now() - lastCapturedTimestamp < 15000) {
            matchedUrl = lastCapturedMediaUrl;
          }
        }
      }

      if (!matchedUrl || matchedUrl === pageUrl) return;
      
      const payload: StreamPayload = {
        requestId: 'decrypted-' + Date.now(),
        url: matchedUrl,
        method: 'GET',
        requestHeaders: matchedHeaders,
        responseHeaders: matchedResponseHeaders,
        serverIp: matchedServerIp,
        pageUrl,
        pageTitle,
        timestamp: Date.now(),
        manifestContent: message.content
      };
      
      sendPayload(payload);
    }
  });

  connectWebSocket();
});
