// A lane capture host for channel sketches: the realm's own sketch service and land read server, raising with the
// realm's own niced bake child (apps/realm/dist/land-bake.mjs), on one capture port. Bundled by capture-sketch.mjs.
import { createServer } from 'node:http';
import { createLandReadServer } from '../../../apps/realm/src/land/server';
import { childSketchBake, createSketchService } from '../../../apps/realm/src/land/sketches';
import { LandArtifactStore } from '../../../apps/realm/src/land/store';

/** The live realm's public founded receipt read (a GET only), relayed so the page and the queue see real status. */
const LIVE_REALM = process.env.GW13_FOUNDED_SOURCE ?? 'http://127.0.0.1:5197';
async function foundedRead(id: string) { return fetch(`${LIVE_REALM}/api/realm/founded/${id}`, { headers: { accept: 'application/json' } }); }

export function serveSketches(directory: string, script: string, port: number, log: (line: string) => void) {
  const founded = async (id: string) => {
    const answer = await foundedRead(id), body = await answer.text();
    return answer.status === 200 || answer.status === 403 ? true : answer.status === 404 && body.includes('"unavailable"') ? false : null;
  };
  const sketches = createSketchService({ store: new LandArtifactStore(directory), bake: childSketchBake(script), founded, log });
  const land = createLandReadServer(directory, sketches);
  const server = createServer((request, response) => {
    const match = /^\/api\/realm\/founded\/([1-9][0-9]{0,31})$/.exec(request.url ?? '');
    if (!match || request.method !== 'GET') { land.emit('request', request, response); return; }
    void foundedRead(match[1]!).then(async answer => {
      response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
      response.end(Buffer.from(await answer.arrayBuffer()));
    }, () => { response.writeHead(503).end(); });
  });
  return new Promise<{ close(): Promise<void> }>(resolve => server.listen(port, '127.0.0.1', () => resolve({
    async close() { await sketches.stop(); await new Promise<void>(done => server.close(() => done())); },
  })));
}
