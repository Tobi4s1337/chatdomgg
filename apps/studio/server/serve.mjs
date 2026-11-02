// The studio's own server. It binds to 127.0.0.1 only and is never part of the public site.
//
// One origin serves three things, so the studio can drive the hooks of the frames it embeds:
//   /studio/...        the studio page (the Twitch page replica), through Vite in middleware mode
//   /media/teaser/...  the lane's media folder (reference fonts, badges, emotes, plates), read only
//   /evidence/...      the repo's work/evidence stills (stand-ins moved in the edit), read only
//   everything else    this worktree's web build (apps/web/dist): /stream, /panel, /-/grand, /assets/...
//
//   node apps/studio/server/serve.mjs --port 5182
//
// Inside a GPU lease the studio runs on 127.0.0.1:5192 (Tobias's tunnel forwards it); outside a lease use a free
// capture port from packages/testing/capture-ports.mjs and never 5191 or 5192.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const STUDIO_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(STUDIO_ROOT, '../..');
export const WEB_DIST = resolve(REPO_ROOT, 'apps/web/dist');
export const MEDIA_ROOT = process.env.CHATDOM_TEASER_MEDIA ?? '/srv/chatdom/media/teaser';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.vox': 'application/octet-stream', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2',
};

/** Resolves `path` under `root`, or null when it escapes the root or is not a file. */
function inside(root, path) {
  const target = normalize(join(root, decodeURIComponent(path)));
  if (target !== root && !target.startsWith(root + '/')) return null;
  return existsSync(target) && statSync(target).isFile() ? target : null;
}

function send(res, file, cache = 'no-cache') {
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': cache,
    // The stream view's workers and SharedArrayBuffer users expect isolation when available; harmless otherwise.
    'Cross-Origin-Resource-Policy': 'same-origin' });
  createReadStream(file).pipe(res);
}

/** `watch` reloads pages when files change: on for a person at the studio, off for recordings (a reload mid-take
 * would destroy it). */
export async function startStudio({ port, host = '127.0.0.1', web = WEB_DIST, quiet = false, watch = false } = {}) {
  if (host !== '127.0.0.1') throw new Error('The studio binds to 127.0.0.1 only.');
  const { createServer } = await import('vite');
  const solid = (await import('vite-plugin-solid')).default;
  let vite;
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // The repo's evidence stills, for stand-ins moved in the edit (read only).
    if (url.pathname.startsWith('/evidence/')) {
      const file = inside(join(REPO_ROOT, 'work/evidence'), url.pathname.slice('/evidence/'.length));
      if (!file) { res.writeHead(404).end('not found'); return; }
      send(res, file, 'max-age=3600');
      return;
    }
    if (url.pathname.startsWith('/media/teaser/')) {
      const file = inside(MEDIA_ROOT, url.pathname.slice('/media/teaser/'.length));
      if (!file) { res.writeHead(404).end('not found'); return; }
      send(res, file, 'max-age=3600');
      return;
    }
    const page = url.pathname === '/studio' || url.pathname === '/studio/' ? 'index.html'
      : /^\/studio\/[a-z0-9-]+\.html$/.test(url.pathname) ? url.pathname.slice('/studio/'.length) : null;
    if (page && existsSync(join(STUDIO_ROOT, page))) {
      vite.transformIndexHtml(url.pathname, readFileSync(join(STUDIO_ROOT, page), 'utf8')).then(html => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).end(html);
      }, error => { res.writeHead(500).end(String(error)); });
      return;
    }
    if (url.pathname.startsWith('/studio/')) { vite.middlewares(req, res, () => { res.writeHead(404).end('not found'); }); return; }
    if (!existsSync(web)) { res.writeHead(503).end('apps/web/dist is missing: build the web app first'); return; }
    const file = inside(web, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (file) { send(res, file, url.pathname.startsWith('/assets/') ? 'max-age=31536000, immutable' : 'no-cache'); return; }
    // Single-page routes (/stream, /panel, /-/grand) fall back to the app shell; missing assets stay 404.
    if (extname(url.pathname)) { res.writeHead(404).end('not found'); return; }
    send(res, join(web, 'index.html'));
  });
  // Vite's client socket shares this server and port (the tunnel forwards only the studio's port).
  vite = await createServer({
    root: STUDIO_ROOT, base: '/studio/', configFile: false, appType: 'custom', logLevel: quiet ? 'error' : 'info',
    plugins: [solid()], server: { middlewareMode: true, hmr: { server }, ...(watch ? {} : { watch: null }), fs: { allow: [REPO_ROOT, MEDIA_ROOT] } },
  });
  try {
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port ?? 0, host, resolveListen); });
  } catch (error) {
    // A taken port: free Vite's watchers before the caller tries another.
    await vite.close();
    throw error;
  }
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`;
  return { base, close: async () => { await vite.close(); await new Promise(done => server.close(() => done())); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--port');
  const port = at > 0 ? Number(process.argv[at + 1]) : 0;
  const { base } = await startStudio({ port, watch: true });
  process.stdout.write(`studio: ${base}/studio/  (web build: ${WEB_DIST})\n`);
}
