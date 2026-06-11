import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    try {
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          var _post = function(url, content, format, isPageUrl) {
            window.postMessage({ type: 'SPECTUR_DECRYPTED', url: url, content: content, format: format, isPageUrl: isPageUrl }, '*');
          };

          // ---- atob hook ----
          var _atob = window.atob;
          window.atob = function(str) {
            var res = _atob.apply(this, arguments);
            if (typeof res === 'string') {
              var upper = res.toUpperCase();
              if (upper.indexOf('#EXTM3U') !== -1) {
                _post(window.location.href, res, 'm3u8', true);
              } else if (upper.indexOf('<MPD') !== -1 && upper.indexOf('</MPD>') !== -1) {
                _post(window.location.href, res, 'mpd', true);
              }
            }
            return res;
          };

          // ---- btoa hook (cat-catch style: 24-char base64 = 16-byte key) ----
          var _btoa = window.btoa;
          window.btoa = function(str) {
            var res = _btoa.apply(this, arguments);
            if (str && str.length === 16) {
              try { _post(window.location.href, '', 'm3u8', true); } catch(e) {}
            }
            return res;
          };

          // ---- TextDecoder.prototype.decode hook ----
          var _decode = TextDecoder.prototype.decode;
          TextDecoder.prototype.decode = function() {
            var res = _decode.apply(this, arguments);
            if (typeof res === 'string') {
              var upper = res.toUpperCase();
              if (upper.indexOf('#EXTM3U') !== -1) {
                _post(window.location.href, res, 'm3u8', true);
              } else if (upper.indexOf('<MPD') !== -1 && upper.indexOf('</MPD>') !== -1) {
                _post(window.location.href, res, 'mpd', true);
              }
            }
            return res;
          };

          // ---- fetch hook ----
          var _fetch = window.fetch;
          window.fetch = async function(input, init) {
            var res = await _fetch.apply(this, arguments);
            try {
              var clone = res.clone();
              var url = typeof input === 'string' ? input : (input && input.url) || '';
              // Try text first
              clone.text().then(function(text) {
                var upper = text.toUpperCase();
                if (upper.indexOf('#EXTM3U') !== -1) {
                  _post(url, text, 'm3u8', false);
                } else if (upper.indexOf('<MPD') !== -1 && upper.indexOf('</MPD>') !== -1) {
                  _post(url, text, 'mpd', false);
                }
              }).catch(function() {});
            } catch (_) {}
            return res;
          };

          // ---- XMLHttpRequest hook ----
          var _open = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url) {
            var self = this;
            this.addEventListener('readystatechange', function() {
              if (self.readyState === 4 && self.status === 200) {
                try {
                  if (self.responseType === "" || self.responseType === "text") {
                    var text = self.responseText;
                    if (typeof text === 'string') {
                      var upper = text.toUpperCase();
                      if (upper.indexOf('#EXTM3U') !== -1) {
                        _post(url, text, 'm3u8', false);
                      } else if (upper.indexOf('<MPD') !== -1 && upper.indexOf('</MPD>') !== -1) {
                        _post(url, text, 'mpd', false);
                      }
                    }
                  } else if (self.responseType === "arraybuffer" && self.response) {
                    try {
                      var decoder = new TextDecoder('utf-8');
                      var text = decoder.decode(self.response);
                      var upper = text.toUpperCase();
                      if (upper.indexOf('#EXTM3U') !== -1) {
                        _post(url, text, 'm3u8', false);
                      } else if (upper.indexOf('<MPD') !== -1 && upper.indexOf('</MPD>') !== -1) {
                        _post(url, text, 'mpd', false);
                      }
                    } catch(e) {}
                  }
                } catch (_) {}
              }
            });
            return _open.apply(this, arguments);
          };

          // ---- String.indexOf hook (cat-catch: detect #EXTM3U in whole page) ----
          var _indexOf = String.prototype.indexOf;
          String.prototype.indexOf = function(searchValue, fromIndex) {
            var out = _indexOf.apply(this, arguments);
            if (searchValue === '#EXTM3U' && out !== -1) {
              var data = this.substring(out);
              _post(window.location.href, data, 'm3u8', true);
            }
            return out;
          };

          // ---- Array.join hook (cat-catch: detect m3u8 in joined arrays) ----
          var _arrayJoin = Array.prototype.join;
          Array.prototype.join = function() {
            var data = _arrayJoin.apply(this, arguments);
            if (typeof data === 'string' && data.toUpperCase().indexOf('#EXTM3U') !== -1) {
              _post(window.location.href, data, 'm3u8', true);
            }
            return data;
          };

          // ---- String.fromCharCode hook ----
          var _fromCharCode = String.fromCharCode;
          String.fromCharCode = function() {
            var data = _fromCharCode.apply(this, arguments);
            if (data.length >= 7 && data.toUpperCase().indexOf('#EXTM3U') !== -1) {
              _post(window.location.href, data, 'm3u8', true);
            }
            return data;
          };

          // ---- Uint8Array constructor hook (cat-catch: detect 16-byte key) ----
          var _Uint8Array = window.Uint8Array;
          var _OriginalU8 = _Uint8Array;
          window.Uint8Array = function(arg) {
            var instance;
            if (this instanceof window.Uint8Array) {
              instance = new _OriginalU8(arg);
            } else {
              instance = new _OriginalU8(arg);
            }
            if (instance.byteLength === 16) {
              _post(window.location.href, '', 'm3u8', true);
            }
            return instance;
          };
          window.Uint8Array.prototype = _OriginalU8.prototype;

          // ---- Uint8Array.prototype.subarray hook ----
          var _subarray = _OriginalU8.prototype.subarray;
          _OriginalU8.prototype.subarray = function(begin, end) {
            var result = _subarray.call(this, begin, end);
            if (result.byteLength === 16) {
              _post(window.location.href, '', 'm3u8', true);
            }
            return result;
          };

          // ---- Array.prototype.slice hook (cat-catch: 16-element numeric arrays = key) ----
          var _slice = Array.prototype.slice;
          Array.prototype.slice = function() {
            var result = _slice.apply(this, arguments);
            if (result.length === 16 && result.every(function(x) { return typeof x === 'number' && x <= 255; })) {
              _post(window.location.href, '', 'm3u8', true);
            }
            return result;
          };

          // ---- DataView hooks (cat-catch: detect 16-byte buffer writes) ----
          var _DataView = window.DataView;
          window.DataView = function(buffer, byteOffset, byteLength) {
            var dv = new _DataView(buffer, byteOffset, byteLength);
            if (dv.byteLength === 16) {
              _post(window.location.href, '', 'm3u8', true);
            }
            return dv;
          };
          window.DataView.prototype = _DataView.prototype;
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {
      console.error('Spectur hook script injection failed:', e);
    }

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
  try { return new URL(url, window.location.href).href; } catch (_) { return url; }
}
