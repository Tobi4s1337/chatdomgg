// Compile the same component entry and route its immutable bytes inside Chrome.
// No listener is created here. Explicit allowedOrigins may name only the caller's owned capture services.
// Call under the shared capture lock; no fallback port or unrelated service is used.
import { build } from 'vite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm' };
export async function createOfflineReview(context, entry, outputDirectory, { plugins = [], allowedOrigins = [] } = {}) {
  const directory = await mkdtemp(resolve(outputDirectory, '.review-build-'));
  try {
    await build({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', base: '/', plugins,
      build: { outDir: directory, emptyOutDir: true, rollupOptions: { input: resolve('apps/web', entry.replace(/^\//, '')) } } });
    const origin = 'https://walking-together.invalid';
    const serve = async route => {
      try {
        const url = new URL(route.request().url());
        if (allowedOrigins.includes(url.origin)) return await route.continue();
        const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
        const file = resolve(directory, `.${decodeURIComponent(pathname)}`);
        const path = relative(directory, file);
        if (url.origin !== origin || path === '..' || path.startsWith(`..${sep}`)) throw new Error('Outside the compiled review');
        const body = await readFile(file);
        await route.fulfill({ status: 200, contentType: mime[extname(file)] ?? 'application/octet-stream', body,
          headers: { 'Cache-Control': 'no-store' } });
      } catch { await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Missing compiled review asset' }); }
    };
    await context.route('**/*', serve);
    return { origin, close: async () => {
      try { await context.unroute('**/*', serve); } finally { await rm(directory, { recursive: true, force: true }); }
    } };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
