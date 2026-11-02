import { createRequire } from 'node:module';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalSceneJson } from '../../../../packages/world/src/founded-world/codec';
import { grandSketchRecipeHash } from '../../../../packages/world/src/grand/sketch';
import { mountLandRoutes } from './mount';
import { genesisSketchRecipe } from './sketch';
import { createSketchService } from './sketches';
import { LandArtifactStore } from './store';
import { storeSketch } from './sketch.test-helper';

// The realm reaches uWebSockets through its Colyseus transport; load that same copy.
const transport = createRequire(import.meta.url).resolve('@colyseus/uwebsockets-transport');
type App = uWebSocketsTransport['app'] & { listen(host: string, port: number, done: (token: unknown) => void): unknown };
const uWS = createRequire(transport)('uWebSockets.js') as { App(): App; us_socket_local_port(token: unknown): number; us_listen_socket_close(token: unknown): void };
let directory: string, store: LandArtifactStore, app: App, socket: unknown = false, port = 0;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'chatdom-land-http-')); store = new LandArtifactStore(directory);
  app = uWS.App();
});
afterEach(async () => { if (socket) uWS.us_listen_socket_close(socket); socket = false; await rm(directory, { recursive: true, force: true }); });
function listen() {
  // An address the system assigns: this test owns no named port.
  return new Promise<void>((done, fail) => app.listen('127.0.0.1', 0, (token: unknown) => {
    if (!token) { fail(new Error('no listen socket')); return; }
    socket = token; port = uWS.us_socket_local_port(token); done();
  }));
}
function call(method: string, path: string, body?: Uint8Array) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; raw: string[]; body: Buffer }>((done, fail) => {
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers: body ? { 'content-type': 'application/json', 'content-length': body.byteLength } : {} }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done({ status: response.statusCode!, headers: response.headers, raw: response.rawHeaders, body: Buffer.concat(chunks) }));
    });
    outgoing.on('error', fail);
    outgoing.end(body);
  });
}

describe('land routes through uWebSockets to a Node client', () => {
  it('send one Content-Length that Node accepts, for GET and HEAD of a blob', async () => {
    const blob = await store.put(Buffer.from('a stored land blob, long enough to be gzipped'));
    const recipe = genesisSketchRecipe('63920635', 'The_AGGman'), hash = await grandSketchRecipeHash(recipe);
    mountLandRoutes(app, store, createSketchService({ store, bake: null }));
    await listen();
    // Nothing is published for this recipe yet: a calm no-store 404, read without a parser error.
    const missing = await call('GET', `/api/realm/land/63920635/${hash}/${blob.hash}`);
    expect(missing.status).toBe(404);
    expect(missing.headers['cache-control']).toBe('no-store');
    // The POST body reaches the queue; a realm without a bake command says it is resting.
    const posted = await call('POST', `/api/realm/land/63920635/${hash}`, Buffer.from(canonicalSceneJson(recipe)));
    expect(posted.status).toBe(503);
    expect(JSON.parse(posted.body.toString())).toEqual({ state: 'refused', reason: 'resting' });
    expect(posted.raw.filter(name => name.toLowerCase() === 'content-length')).toHaveLength(1);
    // Once published, the record and a blob read cleanly with exactly one length each, also for HEAD.
    const record = await storeSketch(store, recipe), mesh = record.meshes[1]!;
    for (const path of [`/api/realm/land/63920635/${hash}`, `/api/realm/land/63920635/${hash}/${mesh.hash}`]) {
      const got = await call('GET', path);
      expect(got.status).toBe(200);
      expect(got.raw.filter(name => name.toLowerCase() === 'content-length')).toHaveLength(1);
      expect(Number(got.headers['content-length'])).toBe(got.body.byteLength);
      const head = await call('HEAD', path);
      expect(head.status).toBe(200);
      expect(head.raw.filter(name => name.toLowerCase() === 'content-length')).toHaveLength(1);
      expect(Number(head.headers['content-length'])).toBe(got.body.byteLength);
    }
    expect((await call('GET', `/api/realm/land/63920635/${hash}/${mesh.hash}`)).body.byteLength).toBe(mesh.gzipBytes);
  });
});
