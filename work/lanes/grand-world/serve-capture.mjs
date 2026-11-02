// One-port capture host for a still when only one capture port is free:
//   node work/lanes/grand-world/serve-capture.mjs <dist> <store> <port>
// Serves the built web app (SPA fallback), the lane's baked land store exactly as the production read server does
// (shots/grand-world/land-server, built by build-land-server.mjs), and forwards only GET/HEAD of the live realm's public
// founded, watch, entry, chronicle and clock routes to 127.0.0.1:5197. Nothing is ever written to the live realm.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { request as forward } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

const [dist, store, portText] = process.argv.slice(2);
const port = Number(portText);
if (!dist || !store) throw new Error('usage: serve-capture.mjs <dist> <store> <port>');
assertCapturePort(port);
const { createLandReadServer } = await import(pathToFileURL(resolve('shots/grand-world/land-server/server.mjs')).href);
const land = createLandReadServer(resolve(store));
const [landHandler] = land.listeners('request');
const root = resolve(dist);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.jpg': 'image/jpeg' };
const live = /^\/api\/realm\/(founded|watch|entry|chronicle|clock)(\/|$)/;
land.removeAllListeners('request');
land.on('request', (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path.startsWith('/api/realm/land/')) return landHandler(req, res);
  if (path.startsWith('/api/') || path.startsWith('/live-realm-data') || path.startsWith('/presence-data')) {
    if (!live.test(path) || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404, { 'cache-control': 'no-store' }); return res.end(); }
    const upstream = forward({ host: '127.0.0.1', port: 5197, path: req.url, method: req.method, headers: { accept: req.headers.accept ?? '*/*' } }, reply => {
      res.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('close', () => upstream.destroy());
    return upstream.end();
  }
  let file = normalize(join(root, decodeURIComponent(path)));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
land.listen(port, '127.0.0.1', () => console.log(`capture host on ${port}`));
