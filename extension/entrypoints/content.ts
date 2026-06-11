import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    // 1. Inject hook script into MAIN world page context
    try {
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          const _post = (url, content, format, isPageUrl) => {
            window.postMessage({ type: 'SPECTUR_DECRYPTED', url, content, format, isPageUrl }, '*');
          };

          const _atob = window.atob;
          window.atob = function(str) {
            const res = _atob.apply(this, arguments);
            if (typeof res === 'string') {
              const upper = res.toUpperCase();
              if (upper.includes('#EXTM3U')) {
                _post(window.location.href, res, 'm3u8', true);
              } else if (upper.includes('<MPD') && upper.includes('</MPD>')) {
                _post(window.location.href, res, 'mpd', true);
              }
            }
            return res;
          };

          const _decode = TextDecoder.prototype.decode;
          TextDecoder.prototype.decode = function() {
            const res = _decode.apply(this, arguments);
            if (typeof res === 'string') {
              const upper = res.toUpperCase();
              if (upper.includes('#EXTM3U')) {
                _post(window.location.href, res, 'm3u8', true);
              } else if (upper.includes('<MPD') && upper.includes('</MPD>')) {
                _post(window.location.href, res, 'mpd', true);
              }
            }
            return res;
          };

          const _fetch = window.fetch;
          window.fetch = async function(input, init) {
            const res = await _fetch.apply(this, arguments);
            try {
              const clone = res.clone();
              const text = await clone.text();
              const upper = text.toUpperCase();
              let url = typeof input === 'string' ? input : (input && input.url) || '';
              if (upper.includes('#EXTM3U')) {
                _post(url, text, 'm3u8', false);
              } else if (upper.includes('<MPD') && upper.includes('</MPD>')) {
                _post(url, text, 'mpd', false);
              }
            } catch (_) {}
            return res;
          };

          const _open = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url) {
            this.addEventListener('readystatechange', function() {
              if (this.readyState === 4 && this.status === 200) {
                try {
                  if (this.responseType === "" || this.responseType === "text") {
                    const text = this.responseText;
                    if (typeof text === 'string') {
                      const upper = text.toUpperCase();
                      if (upper.includes('#EXTM3U')) {
                        _post(url, text, 'm3u8', false);
                      } else if (upper.includes('<MPD') && upper.includes('</MPD>')) {
                        _post(url, text, 'mpd', false);
                      }
                    }
                  } else if (this.responseType === "arraybuffer" && this.response) {
                    const decoder = new TextDecoder('utf-8');
                    const text = decoder.decode(this.response);
                    const upper = text.toUpperCase();
                    if (upper.includes('#EXTM3U')) {
                      _post(url, text, 'm3u8', false);
                    } else if (upper.includes('<MPD') && upper.includes('</MPD>')) {
                      _post(url, text, 'mpd', false);
                    }
                  }
                } catch (_) {}
              }
            });
            return _open.apply(this, arguments);
          };

          const _indexOf = String.prototype.indexOf;
          String.prototype.indexOf = function(searchValue, fromIndex) {
            const out = _indexOf.apply(this, arguments);
            if (searchValue === '#EXTM3U' && out !== -1) {
              const data = this.substring(out);
              _post(window.location.href, data, 'm3u8', true);
            }
            return out;
          };

          const _arrayJoin = Array.prototype.join;
          Array.prototype.join = function() {
            const data = _arrayJoin.apply(this, arguments);
            if (typeof data === 'string' && data.toUpperCase().includes('#EXTM3U')) {
              _post(window.location.href, data, 'm3u8', true);
            }
            return data;
          };

          const _fromCharCode = String.fromCharCode;
          String.fromCharCode = new Proxy(_fromCharCode, {
            apply(target, thisArg, argumentsList) {
              const data = Reflect.apply(target, thisArg, argumentsList);
              if (data.length >= 7 && data.toUpperCase().includes('#EXTM3U')) {
                _post(window.location.href, data, 'm3u8', true);
              }
              return data;
            }
          });
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {
      console.error('Spectur hook script injection failed:', e);
    }

    // 2. Listen for SPECTUR_DECRYPTED messages from the page context hooks
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === 'SPECTUR_DECRYPTED') {
        const { url, content, format, isPageUrl } = event.data;
        try {
          browser.runtime.sendMessage({
            action: 'addDecryptedManifest',
            url: isPageUrl ? url : getAbsoluteUrl(url),
            content,
            format,
            isPageUrl
          });
        } catch (_) {}
      }
    });
  },
});

function getAbsoluteUrl(url: string): string {
  if (!url) return '';
  try {
    return new URL(url, window.location.href).href;
  } catch (_) {
    return url;
  }
}
