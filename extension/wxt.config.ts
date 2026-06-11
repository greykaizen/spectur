import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Spectur Network Grabber',
    version: '1.0.0',
    description: 'Real-time media stream sniffer and context relay.',
    manifest_version: 2,
    permissions: [
      'webRequest',
      'tabs',
      '<all_urls>',
      'http://127.0.0.1:8080/*',
      'ws://127.0.0.1:8080/*',
      'http://localhost:8080/*',
      'ws://localhost:8080/*'
    ]
  },
  vite: () => ({
    define: {
      global: 'globalThis',
    },
  }),
});
