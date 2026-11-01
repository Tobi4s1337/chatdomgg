// The front door of the public origin: a small page of its own, so a first visit paints at once and the kingdom's
// engine loads only when someone walks in. Built into apps/web/dist/door/ (after the web app), served at `/`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: '/door/',
  logLevel: 'warn',
  plugins: [solid()],
  build: { outDir: fileURLToPath(new URL('../../../dist/door/', import.meta.url)), emptyOutDir: true, target: 'es2022', assetsInlineLimit: 0 },
});
