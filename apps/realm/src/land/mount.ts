import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { LandArtifactStore } from './store';
import { postLandRoute, readLandRoute, type LandResponse } from './routes';
import type { SketchService } from './sketches';

const STATUSES: Record<number, string> = { 200: '200 OK', 202: '202 Accepted', 304: '304 Not Modified', 400: '400 Bad Request',
  404: '404 Not Found', 405: '405 Method Not Allowed', 409: '409 Conflict', 413: '413 Payload Too Large',
  429: '429 Too Many Requests', 503: '503 Service Unavailable' };
/** A sketch recipe is one small JSON document (`SKETCH_RECIPE_BYTES`). */
const POST_BYTES = 8 * 1024;

/**
 * Explicit configuration only. GET and HEAD read complete artifacts; POST asks the sketch queue for a channel's
 * world (`sketches.ts`), which bakes in a child process and never on this request's thread.
 *
 * uWebSockets writes its own Content-Length from the body it is given, so the route's header is left out of a body
 * response (two would make Node clients such as the public gateway refuse the reply). A HEAD reply has no body, so
 * its length is reported through `endWithoutBody`.
 */
export function mountLandRoutes(app: uWebSocketsTransport['app'], source: string | LandArtifactStore, sketches: SketchService | null = null) {
  if (typeof source === 'string' && !source.trim()) throw new Error('The land artifact directory must be explicit');
  const store = typeof source === 'string' ? new LandArtifactStore(source) : source;
  app.any('/api/realm/land/*', (res, req) => {
    // Request objects expire when this synchronous callback returns.
    const path = req.getUrl(), method = req.getMethod().toUpperCase(), etag = req.getHeader('if-none-match');
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    const reply = (response: LandResponse | null) => {
      if (aborted) return;
      const answer = response ?? { status: 404, headers: { 'cache-control': 'no-store' }, body: new Uint8Array() };
      res.cork(() => {
        res.writeStatus(STATUSES[answer.status] ?? '503 Service Unavailable');
        for (const [key, value] of Object.entries(answer.headers)) if (key.toLowerCase() !== 'content-length') res.writeHeader(key, value);
        const length = answer.headers['content-length'];
        if (method === 'HEAD' && length !== undefined) res.endWithoutBody(Number(length));
        else res.end(answer.body);
      });
    };
    const fail = () => { if (!aborted) res.cork(() => res.writeStatus('503 Service Unavailable').writeHeader('Cache-Control', 'no-store').end()); };
    if (method !== 'POST') { void readLandRoute(store, path, method, etag).then(reply, fail); return; }
    // The body arrives in chunks whose buffers are reused after each callback; copy them, and stop at the limit.
    const chunks: Uint8Array[] = [];
    let size = 0, refused = false;
    res.onData((chunk, last) => {
      if (refused) return;
      size += chunk.byteLength;
      if (size > POST_BYTES) {
        refused = true;
        reply({ status: 413, headers: { 'cache-control': 'no-store', connection: 'close' }, body: new Uint8Array() });
        return;
      }
      chunks.push(new Uint8Array(chunk.slice(0)));
      if (!last) return;
      const body = new Uint8Array(size);
      let at = 0;
      for (const part of chunks) { body.set(part, at); at += part.byteLength; }
      void postLandRoute(sketches, path, body).then(reply, fail);
    });
  });
}
