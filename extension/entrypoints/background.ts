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

interface KeyPayload {
  key: number[];
  href: string;
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
}

export default defineBackground(() => {
  const WS_URL = 'ws://127.0.0.1:8080';
  const MEDIA_EXTENSIONS = /\.(m3u8|mpd|mp4|m4s|m4v|webm|mov|f4m|f4f)(\?|$)/i;
  const MEDIA_MIME_TYPES = [
    'application/vnd.apple.mpegurl',
    'application/x-mpegurl',
    'application/mpegurl',
    'application/octet-stream-m3u8',
    'audio/vnd.apple.mpegurl',
    'audio/mpegurl',
    'audio/x-mpegurl',
    'application/dash+xml',
    'video/vnd.mpeg.dash.mpd',
    'application/m4s',
    'video/mp4',
    'video/x-mp4',
    'video/mpg4',
    'video/x-mpg4',
    'video/x-m4v',
    'video/m4v',
    'video/mp2t',
    'video/webm',
    'audio/webm',
    'video/x-flv',
    'video/flv',
    'application/f4m+xml',
    'video/f4f',
    'video/f4m',
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
    if (lower.startsWith('video/') || lower.startsWith('audio/')) {
      if (lower.includes('mp2t')) return true; // TS segments are media
      return true;
    }
    return MEDIA_MIME_TYPES.some(t => lower.startsWith(t.toLowerCase()));
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

  function sendKeyPayload(payload: KeyPayload): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'keyIntercepted', ...payload }));
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
      const contentType = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
      if (isMediaMimeType(contentType) || isMediaRequest(details.url)) {
        const isMedia = details.url.includes('.m3u8') || details.url.includes('.mpd');
        if (isMedia) {
          lastCapturedMediaUrl = details.url;
          lastCapturedTimestamp = Date.now();
          recordCapturedMedia(details.url, details.method || entry.method || 'GET', entry.requestHeaders, headersToRecord(details.responseHeaders), details.ip || '');
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
        recordCapturedMedia(details.url, details.method || entry.method || 'GET', entry.requestHeaders, entry.responseHeaders, details.ip || '');
      }
      try {
        const tab = await browser.tabs.get(details.tabId);
        entry.pageUrl = tab.url || '';
        entry.pageTitle = tab.title || '';
      } catch {
        entry.pageUrl = '';
        entry.pageTitle = '';
      }
      const payload: StreamPayload = {
        requestId: details.requestId,
        url: entry.url || details.url,
        method: entry.method || details.method,
        requestHeaders: entry.requestHeaders || {},
        responseHeaders: entry.responseHeaders || {},
        serverIp: entry.serverIp || '',
        pageUrl: entry.pageUrl || '',
        pageTitle: entry.pageTitle || '',
        timestamp: Date.now(),
        manifestContent: entry.manifestContent,
      };
      sendPayload(payload);
      activeRequests.delete(details.requestId);
    },
    { urls: ['<all_urls>'] }
  );

  browser.webRequest.onCompleted.addListener(
    (details) => {
      const entry = activeRequests.get(details.requestId);
      if (entry && !entry.pageUrl) {
        browser.tabs.get(details.tabId).then(tab => {
          entry.pageUrl = tab.url || '';
          entry.pageTitle = tab.title || '';
          const payload: StreamPayload = {
            requestId: details.requestId,
            url: entry.url || details.url,
            method: entry.method || details.method,
            requestHeaders: entry.requestHeaders || {},
            responseHeaders: entry.responseHeaders || {},
            serverIp: entry.serverIp || '',
            pageUrl: entry.pageUrl || '',
            pageTitle: entry.pageTitle || '',
            timestamp: Date.now(),
            manifestContent: entry.manifestContent,
          };
          sendPayload(payload);
          activeRequests.delete(details.requestId);
        }).catch(() => {
          activeRequests.delete(details.requestId);
        });
      }
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
          let selectedCandidate = candidates.find(r => {
            const urlLower = r.url.toLowerCase();
            if (isMaster) return urlLower.includes('master') || (!urlLower.includes('video') && !urlLower.includes('audio') && !urlLower.includes('track'));
            return urlLower.includes('video') || urlLower.includes('audio') || urlLower.includes('track');
          }) || candidates[0];
          matchedUrl = selectedCandidate.url;
          matchedHeaders = selectedCandidate.requestHeaders;
          matchedResponseHeaders = { ...selectedCandidate.responseHeaders, ...matchedResponseHeaders };
          matchedServerIp = selectedCandidate.serverIp;
        } else {
          for (const [, entry] of activeRequests.entries()) {
            if (entry.url && (entry.url.includes('.m3u8') || entry.url.includes('.mpd'))) {
              matchedUrl = entry.url;
              break;
            }
          }
          if (!matchedUrl && lastCapturedMediaUrl && Date.now() - lastCapturedTimestamp < 15000) {
            matchedUrl = lastCapturedMediaUrl;
          }
        }
      }

      if (!matchedUrl || matchedUrl === pageUrl || matchedUrl.startsWith('blob:')) return;
      
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

    if (message.action === 'keyIntercepted') {
      const pageUrl = sender.tab?.url || '';
      const pageTitle = sender.tab?.title || '';
      const keyPayload: KeyPayload = {
        key: message.key,
        href: message.href || pageUrl,
        pageUrl,
        pageTitle,
        timestamp: Date.now(),
      };
      sendKeyPayload(keyPayload);
    }

    if (message.action === 'youtubeFormats') {
      const pageUrl = sender.tab?.url || '';
      const pageTitle = sender.tab?.title || '';
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'youtubeFormats',
          pageUrl,
          pageTitle,
          streamingData: message.streamingData,
          timestamp: Date.now()
        }));
      }
    }
  });

  connectWebSocket();
});
