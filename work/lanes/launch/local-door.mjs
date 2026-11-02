// A local stand-in for chatdom.io's gateway, to see web-app fixes before they are deployed: it serves this
// checkout's apps/web/dist for the app's pages and assets, and passes every data and API read through to
// https://chatdom.io unchanged (GET and HEAD only; it refuses anything that could write).
//
//   node work/lanes/launch/local-door.mjs [--port 5173] [--loopback]
//
// `--loopback` (for when chatdom.io itself is down): the same public reads go to this host's services directly
// (Atlas data 127.0.0.1:5193, the realm's `/api/realm/…` on 127.0.0.1:5197), and the front door's kingdom list is
// answered with what chatdom.io answers (`PUBLIC_KINGDOMS=129634568:tobi4s_`, Willowmere).
//
// The port must be a capture port (packages/testing/capture-ports.mjs). Run it under the capture lock with the walk:
//   node work/lanes/launch/walk.mjs --target http://127.0.0.1:5173 --only search,card,kingdom
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] || 5173);
assertCapturePort(port);
const loopback = args.includes('--loopback');
const UPSTREAM = 'https://chatdom.io';
const upstreamFor = pathname => !loopback ? UPSTREAM
  : pathname.startsWith('/map-data/') ? 'http://127.0.0.1:5193'
    : pathname.startsWith('/api/realm/') ? 'http://127.0.0.1:5197'
      : pathname.startsWith('/live-realm-data/') ? 'http://127.0.0.1:5197/-' : null;
const DOOR = JSON.stringify({ version: 1, mode: 'live', kingdoms: [{ kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_' }] });
const dist = resolve(import.meta.dirname, '../../../apps/web/dist');
const PAGES = /^\/(?:stream|panel|dock\/?|map(?:\/(?:[a-z0-9_]{1,25}|road\/[a-z0-9_]{1,25}\/[a-z0-9_]{1,25}))?|kingdom\/[1-9][0-9]{0,31}|-\/grand)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary' };

const file = pathname => {
  const path = normalize(join(dist, decodeURIComponent(pathname)));
  return path.startsWith(`${dist}/`) && existsSync(path) && statSync(path).isFile() ? path : null;
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://local.invalid');
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
  const local = PAGES.test(url.pathname) ? join(dist, 'index.html') : url.pathname.startsWith('/assets/') || /^\/[\w.-]+\.(?:svg|png|ico|webmanifest)$/.test(url.pathname) ? file(url.pathname) : null;
  if (local) {
    response.writeHead(200, { 'Content-Type': TYPES[extname(local)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (request.method === 'HEAD') response.end(); else createReadStream(local).pipe(response);
    return;
  }
  if (loopback && url.pathname === '/api/public/door') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(DOOR); return; }
  const base = upstreamFor(url.pathname);
  if (!base) { response.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"not-served-locally"}'); return; }
  try {
    // The gateway serves the realm's reads under /live-realm-data; the realm itself has them at its root.
    const path = base.endsWith('/-') ? url.pathname.slice('/live-realm-data'.length) : url.pathname;
    const upstream = await fetch(`${base.replace(/\/-$/, '')}${path}${url.search}`, { method: request.method, redirect: 'manual',
      headers: { accept: request.headers.accept ?? '*/*', 'accept-language': request.headers['accept-language'] ?? 'en' } });
    const headers = {};
    for (const name of ['content-type', 'cache-control', 'location', 'retry-after']) { const value = upstream.headers.get(name); if (value) headers[name] = value; }
    response.writeHead(upstream.status, headers);
    // Streamed, not buffered: the realm's watch is a server-sent event stream that never ends.
    if (request.method === 'HEAD' || !upstream.body) response.end(); else await pipeline(Readable.fromWeb(upstream.body), response).catch(() => response.destroy());
  } catch { if (!response.headersSent) response.writeHead(502).end(); else response.destroy(); }
}).listen(port, '127.0.0.1', () => console.log(`local door on http://127.0.0.1:${port} (app from apps/web/dist, data from ${loopback ? 'this host' : UPSTREAM})`));
