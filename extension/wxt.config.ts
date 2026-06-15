import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Spectur Network Grabber',
    version: '1.0.0',
    description: 'Real-time media stream sniffer and context relay.',
    manifest_version: 2,
    icons: {
      '16': 'icons/whitex256.png',
      '32': 'icons/whitex256.png',
      '48': 'icons/whitex256.png',
      '128': 'icons/whitex256.png',
    },
    action: {
      default_icon: {
        '16': 'icons/whitex256.png',
        '32': 'icons/whitex256.png',
        '48': 'icons/whitex256.png',
        '128': 'icons/whitex256.png',
      },
      default_title: 'Spectur Network Grabber',
    },
    permissions: [
      'webRequest',
      'tabs',
      '<all_urls>',
      'http://127.0.0.1:9117/*',
      'ws://127.0.0.1:9117/*',
      'http://localhost:9117/*',
      'ws://localhost:9117/*'
    ]
  },
  vite: () => ({
    define: {
      global: 'globalThis',
    },
  }),
});
