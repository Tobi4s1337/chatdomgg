import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// A Twitch Extension is a static zip served from a nested, versioned path on Twitch's CDN.
// Relative URLs keep every view working there; nothing is inlined, because the Extension
// policy forbids data: fonts and inline scripts.
const root = import.meta.dirname;
export default defineConfig({
  root,
  base: './',
  plugins: [solid()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    // Reviewers read the shipped code; it stays human-readable and well under the 1 MB first load.
    minify: false,
    rolldownOptions: {
      input: {
        panel: resolve(root, 'panel.html'),
        mobile: resolve(root, 'mobile.html'),
        config: resolve(root, 'config.html'),
        live_config: resolve(root, 'live_config.html'),
      },
    },
  },
  preview: { host: '127.0.0.1', port: 5195, strictPort: true },
});
