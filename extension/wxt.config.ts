import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 2,
  manifest: {
    name: 'Spectur',
    version: '1.0.0',
    description: 'Browser companion for the Tur download suite. Detects and transfers media stream contexts.',
    icons: {
      '16': 'icons/pebble180nobg.png',
      '32': 'icons/pebble180nobg.png',
      '48': 'icons/pebble180nobg.png',
      '128': 'icons/pebble180nobg.png',
    },
    action: {
      default_icon: {
        '16': 'icons/pebble180nobg.png',
        '32': 'icons/pebble180nobg.png',
        '48': 'icons/pebble180nobg.png',
        '128': 'icons/pebble180nobg.png',
      },
      default_title: 'Spectur',
    },
    permissions: [
      'webRequest',
      'tabs',
      '<all_urls>',
      'http://127.0.0.1:6236/*',
      'ws://127.0.0.1:6236/*',
      'http://localhost:6236/*',
      'ws://localhost:6236/*'
    ],
    web_accessible_resources: [
      'icons/*.png'
    ]
  },
  vite: () => ({
    define: {
      global: 'globalThis',
    },
  }),
});
