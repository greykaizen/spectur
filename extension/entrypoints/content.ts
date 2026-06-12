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
          var _postKey = function(keyBytes) {
            window.postMessage({ type: 'SPECTUR_KEY_INTERCEPTED', key: keyBytes, href: window.location.href }, '*');
          };
          var _postYTFormats = function(formats) {
            window.postMessage({ type: 'SPECTUR_YT_FORMATS', formats: formats, href: window.location.href }, '*');
          };

          // ---- ytInitialPlayerResponse observer (YouTube-specific) ----
          // YT sets this on window when page loads with video data including all formats
          try {
            if (/youtube\.com/.test(window.location.hostname)) {
              var _desc = Object.getOwnPropertyDescriptor(window, 'ytInitialPlayerResponse');
              var _ytValue;
              if (_desc) {
                _ytValue = _desc.value;
              }
              Object.defineProperty(window, 'ytInitialPlayerResponse', {
                get: function() { return _ytValue; },
                set: function(v) {
                  _ytValue = v;
                  try {
                    var data = JSON.parse(JSON.stringify(v));
                    if (data && data.streamingData) {
                      _postYTFormats(data.streamingData);
                    }
                  } catch(e) {}
                },
                configurable: true,
                enumerable: true
              });
              // Check various YouTube configuration locations
              var checkInterval = setInterval(function() {
                try {
                  var cfg = window.ytplayer && window.ytplayer.config;
                  if (cfg) {
                    var prStr = null;
                    if (cfg.args && cfg.args.player_response) {
                      prStr = cfg.args.player_response;
                    } else if (cfg.player_response) {
                      prStr = cfg.player_response;
                    } else if (cfg.args && cfg.args.raw_player_response) {
                      prStr = cfg.args.raw_player_response;
                    } else if (cfg.args && cfg.args.embedded_player_response) {
                      prStr = cfg.args.embedded_player_response;
                    }

                    if (prStr) {
                      var pr = typeof prStr === 'string' ? JSON.parse(prStr) : prStr;
                      if (pr && pr.streamingData) {
                        _postYTFormats(pr.streamingData);
                        clearInterval(checkInterval);
                      }
                    }
                  }
                } catch(e) {}
              }, 500);
              setTimeout(function() { clearInterval(checkInterval); }, 15000);
            }
          } catch(e) {}

          // ---- WebCrypto importKey hook (zero-competitor advantage) ----
          // All modern players (HLS.js, Shaka, Dash.js) call crypto.subtle.importKey
          // with raw AES-128 keys. Intercept this for 100% key capture with zero noise.
          if (window.crypto && window.crypto.subtle) {
            var _importKey = window.crypto.subtle.importKey;
            window.crypto.subtle.importKey = function(format, keyData, algorithm, extractable, keyUsages) {
              if (format === 'raw' && keyData) {
                try {
                  var buf = null;
                  if (keyData instanceof ArrayBuffer) buf = keyData;
                  else if (keyData.buffer instanceof ArrayBuffer) buf = keyData.buffer;
                  if (buf && buf.byteLength === 16) {
                    _postKey(Array.from(new Uint8Array(buf)));
                  }
                } catch(e) {}
              }
              return _importKey.apply(this, arguments);
            };
          }

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

          // ---- btoa hook ----
          var _btoa = window.btoa;
          window.btoa = function(str) {
            var res = _btoa.apply(this, arguments);
            if (str && str.length === 16) {
              try { _postKey([]); } catch(e) {}
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

          // ---- String.indexOf hook ----
          var _indexOf = String.prototype.indexOf;
          String.prototype.indexOf = function(searchValue, fromIndex) {
            var out = _indexOf.apply(this, arguments);
            if (searchValue === '#EXTM3U' && out !== -1) {
              var data = this.substring(out);
              _post(window.location.href, data, 'm3u8', true);
            }
            return out;
          };

          // ---- Array.join hook ----
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

          // ---- Uint8Array constructor hook ----
          var _OriginalU8 = window.Uint8Array;
          window.Uint8Array = function() {
            var instance = Reflect.construct(_OriginalU8, arguments);
            if (instance.byteLength === 16) _postKey(Array.from(instance));
            return instance;
          };
          window.Uint8Array.prototype = _OriginalU8.prototype;
          Object.setPrototypeOf(window.Uint8Array, _OriginalU8);

          // ---- Uint8Array.prototype.subarray hook ----
          var _subarray = _OriginalU8.prototype.subarray;
          _OriginalU8.prototype.subarray = function(begin, end) {
            var result = _subarray.apply(this, arguments);
            if (result.byteLength === 16) _postKey(Array.from(result));
            return result;
          };

          // ---- Uint8Array.prototype.slice hook ----
          var _sliceU8 = _OriginalU8.prototype.slice;
          _OriginalU8.prototype.slice = function() {
            var result = _sliceU8.apply(this, arguments);
            if (result.byteLength === 16) _postKey(Array.from(result));
            return result;
          };

          // ---- Uint16Array constructor hook ----
          var _OriginalU16 = window.Uint16Array;
          window.Uint16Array = function() {
            var instance = Reflect.construct(_OriginalU16, arguments);
            if (instance.length === 8) { // 8 x uint16 = 16 bytes
              _postKey(Array.from(new _OriginalU8(instance.buffer, instance.byteOffset, 16)));
            }
            return instance;
          };
          window.Uint16Array.prototype = _OriginalU16.prototype;
          Object.setPrototypeOf(window.Uint16Array, _OriginalU16);

          // ---- Uint32Array constructor hook ----
          var _OriginalU32 = window.Uint32Array;
          window.Uint32Array = function() {
            var instance = Reflect.construct(_OriginalU32, arguments);
            if (instance.length === 4) { // 4 x uint32 = 16 bytes
              _postKey(Array.from(new _OriginalU8(instance.buffer, instance.byteOffset, 16)));
            }
            return instance;
          };
          window.Uint32Array.prototype = _OriginalU32.prototype;
          Object.setPrototypeOf(window.Uint32Array, _OriginalU32);

          // ---- Array.prototype.slice hook ----
          var _slice = Array.prototype.slice;
          Array.prototype.slice = function() {
            var result = _slice.apply(this, arguments);
            if (result.length === 16 && result.every(function(x) { return typeof x === 'number' && x <= 255; })) {
              _postKey(result);
            }
            return result;
          };

          // ---- DataView hooks ----
          var _OriginalDataView = window.DataView;
          window.DataView = function() {
            var dv = Reflect.construct(_OriginalDataView, arguments);
            if (dv.byteLength === 16) {
              _postKey(Array.from(new _OriginalU8(dv.buffer, dv.byteOffset, 16)));
            }
            return dv;
          };
          window.DataView.prototype = _OriginalDataView.prototype;
          Object.setPrototypeOf(window.DataView, _OriginalDataView);
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
      if (event.data && event.data.type === 'SPECTUR_KEY_INTERCEPTED') {
        const { key, href } = event.data;
        try {
          browser.runtime.sendMessage({
            action: 'keyIntercepted',
            key,
            href
          });
        } catch (_) {}
      }
      if (event.data && event.data.type === 'SPECTUR_YT_FORMATS') {
        const { formats, href } = event.data;
        try {
          browser.runtime.sendMessage({
            action: 'youtubeFormats',
            streamingData: formats,
            href
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
