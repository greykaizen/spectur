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
}

export default defineBackground(() => {
  const WS_URL = 'ws://127.0.0.1:8080';
  const MEDIA_EXTENSIONS = /\.(m3u8|mpd|mp4|m4a|m4v|webm|mov)(\?|$)/i;
  const MEDIA_MIME_TYPES = [
    'application/vnd.apple.mpegurl',
    'application/x-mpegURL',
    'application/dash+xml',
    'video/mp4',
    'video/webm',
    'audio/mp4',
    'audio/mpeg',
  ];

  const activeRequests = new Map<string, Partial<StreamPayload>>();
  let ws: WebSocket | null = null;
  let reconnectDelay = 1000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function isMediaRequest(url: string): boolean {
    return MEDIA_EXTENSIONS.test(url);
  }

  function isMediaMimeType(mime: string): boolean {
    return MEDIA_MIME_TYPES.some(t => mime.toLowerCase().startsWith(t.toLowerCase()));
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
    };
  }

  function connectWebSocket(): void {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }
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

  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (!isMediaRequest(details.url)) return;
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
    (details) => {
      activeRequests.delete(details.requestId);
    },
    { urls: ['<all_urls>'] }
  );

  connectWebSocket();
});
