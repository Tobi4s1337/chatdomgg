import { createServer } from 'node:http';
import { LandArtifactStore } from './store';
import { readLandRoute } from './routes';

/** Isolated read-only host for artifact acceptance. No listen, process or environment ownership here. */
export function createLandReadServer(directory: string) {
  const store = new LandArtifactStore(directory);
  return createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0]!, etag = request.headers['if-none-match'];
    void readLandRoute(store, path, request.method, Array.isArray(etag) ? etag[0] : etag).then(reply => {
      if (response.destroyed) return;
      response.writeHead(reply?.status ?? 404, reply?.headers ?? { 'cache-control': 'no-store' });
      response.end(reply?.body);
    }, () => { if (!response.destroyed) { response.writeHead(503, { 'cache-control': 'no-store' }); response.end(); } });
  });
}
