import { createServer } from 'node:http';
import { LandArtifactStore } from './store';
import { postLandRoute, readLandRoute } from './routes';
import type { SketchService } from './sketches';

/** Isolated host for artifact acceptance and benches. No listen, process or environment ownership here. With a
 * sketch queue it also answers `POST /api/realm/land/<channel>/<recipe-hash>`, as the realm mount does. */
export function createLandReadServer(directory: string, sketches: SketchService | null = null) {
  const store = new LandArtifactStore(directory);
  return createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0]!, etag = request.headers['if-none-match'];
    const send = (reply: Awaited<ReturnType<typeof readLandRoute>>) => {
      if (response.destroyed) return;
      response.writeHead(reply?.status ?? 404, reply?.headers ?? { 'cache-control': 'no-store' });
      response.end(reply?.body);
    };
    const fail = () => { if (!response.destroyed) { response.writeHead(503, { 'cache-control': 'no-store' }); response.end(); } };
    if (request.method !== 'POST') { void readLandRoute(store, path, request.method, Array.isArray(etag) ? etag[0] : etag).then(send, fail); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > 8192) { request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => { void postLandRoute(sketches, path, Buffer.concat(chunks)).then(send, fail); });
  });
}
