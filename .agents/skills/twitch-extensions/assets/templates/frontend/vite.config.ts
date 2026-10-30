/**
 * Vite multi-page build for a Twitch Extension.
 *
 * Why these settings:
 *  - base: './'  → asset URLs are RELATIVE. Twitch serves your zip from
 *    https://<client_id>.ext-twitch.tv/<client_id>/<version>/<hash>/, so absolute "/assets/x.js" 404s.
 *  - one HTML entry per view; the view paths you enter in Asset Hosting are these file names.
 *  - assetsInlineLimit: 0 → never inline fonts/images as data: URIs (font-src forbids data:).
 *  - modulePreload polyfill off → nothing extra injected; Vite never emits inline <script> for this setup
 *    (CSP script-src has no 'unsafe-inline').
 *  - sourcemap off by default; reviewers require human-readable JS — keep minify off or submit source
 *    (see dev-workflow.md "Review").
 *
 * Local Test needs HTTPS: put mkcert files in ./certs (mkcert -cert-file certs/localhost.pem
 * -key-file certs/localhost-key.pem localhost) — they are picked up automatically.
 */
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const certFile = resolve(root, 'certs/localhost.pem');
const keyFile = resolve(root, 'certs/localhost-key.pem');
const https = existsSync(certFile) && existsSync(keyFile)
  ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
  : undefined;

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2019',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    minify: false, // human-readable output eases review (policy 2.5); set true + submit source if you prefer
    rolldownOptions: { // Vite 8 (Rolldown); on Vite 5–7 this key is `rollupOptions`
      input: {
        panel: resolve(root, 'panel.html'),
        video_overlay: resolve(root, 'video_overlay.html'),
        mobile: resolve(root, 'mobile.html'),
        config: resolve(root, 'config.html'),
        live_config: resolve(root, 'live_config.html'),
      },
    },
  },
  // `vite` (dev) and `vite preview` both serve on 8080 = the console's default Testing Base URI port.
  server: { port: 8080, strictPort: true, https, cors: true },
  preview: { port: 8080, strictPort: true, https, cors: true },
});
