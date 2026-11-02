// The lane's read-only land server for a GPU lease, with a request log and a throughput probe.
//
//   node work/lanes/grand-world/serve-land-logged.mjs <store> <port> <log.jsonl>
//
// Serves the baked store exactly as the production read server does (built by build-land-server.mjs into
// shots/grand-world/land-server). Every land request is appended to the log when its response ends: path, status,
// bytes sent and milliseconds from arrival to the last byte. `GET /api/realm/land/__throughput?bytes=N` (at most
// 16 MiB) answers N incompressible bytes uncached, so a page on the far side of the tunnel can time the real link.
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const [store, portText, log] = process.argv.slice(2);
const port = Number(portText);
if (!store || !log || !Number.isInteger(port) || port < 1024) throw new Error('usage: <store> <port> <log.jsonl>');
const { createLandReadServer } = await import(pathToFileURL(resolve('shots/grand-world/land-server/server.mjs')).href);
const server = createLandReadServer(resolve(store));
const handlers = server.listeners('request');
if (handlers.length !== 1) throw new Error('The land read server must have exactly one request handler');
server.removeAllListeners('request');
const started = Date.now();
server.on('request', (request, response) => {
  const arrived = performance.now();
  let bytes = 0;
  const write = response.write.bind(response), end = response.end.bind(response);
  const count = chunk => { if (chunk && typeof chunk !== 'function') bytes += Buffer.byteLength(chunk); };
  response.write = (chunk, ...rest) => { count(chunk); return write(chunk, ...rest); };
  response.end = (chunk, ...rest) => { count(chunk); return end(chunk, ...rest); };
  response.once('finish', () => appendFileSync(log, `${JSON.stringify({ at: Date.now() - started, path: request.url,
    status: response.statusCode, bytes, ms: Math.round(performance.now() - arrived) })}\n`));
  response.once('close', () => { if (!response.writableFinished) appendFileSync(log, `${JSON.stringify({ at: Date.now() - started,
    path: request.url, status: 'aborted', bytes, ms: Math.round(performance.now() - arrived) })}\n`); });
  const url = new URL(request.url ?? '/', 'http://land');
  if (url.pathname === '/api/realm/land/__throughput') {
    const size = Math.min(16 * 1024 * 1024, Math.max(0, Number(url.searchParams.get('bytes')) || 0));
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size, 'cache-control': 'no-store' });
    response.end(randomBytes(size));
    return;
  }
  handlers[0].call(server, request, response);
});
server.listen(port, '127.0.0.1', () => appendFileSync(log, `${JSON.stringify({ at: 0, listening: port, store })}\n`));
