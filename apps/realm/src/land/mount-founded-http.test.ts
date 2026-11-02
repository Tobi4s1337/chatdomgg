import { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeBakedMetadata, encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { BAKED_COMPILERS, type BakedMetadata } from '../../../../packages/world/src/grand/baked/types';
import { mountLandRoutes } from './mount';
import { LandArtifactStore } from './store';

// The public gateway forwards land through Node's http client, which refuses a reply with two Content-Length
// headers. This serves a real store through a real uWS listener and reads it the same way.
const uws = createRequire(import.meta.resolve('@colyseus/uwebsockets-transport'))('uWebSockets.js') as {
  us_socket_local_port(socket: object): number; us_listen_socket_close(socket: object): void;
};
const scene = 'c'.repeat(64), sourcePlanHash = 'd'.repeat(64);
let directory: string, store: LandArtifactStore, socket: object | undefined, endpoint: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'chatdom-land-http-'));
  store = new LandArtifactStore(directory);
  const transport = new uWebSocketsTransport();
  mountLandRoutes(transport.app, store);
  socket = await new Promise<object>((resolve, reject) => transport.app.listen('127.0.0.1', 0, value => {
    if (value) resolve(value); else reject(new Error('loopback listener failed'));
  }));
  endpoint = `http://127.0.0.1:${uws.us_socket_local_port(socket)}`;
});
afterEach(async () => {
  if (socket) uws.us_listen_socket_close(socket);
  socket = undefined;
  await rm(directory, { recursive: true, force: true });
});

async function publish() {
  const recipeHash = await store.pinRecipe('123', { version: 1 });
  const surface = await store.put(encodeBakedSurface({ size: 256, height: 256, seaLevel: 0,
    ground: new Uint16Array(256 ** 2).fill(8), water: new Uint16Array(256 ** 2) }));
  const mesh = await store.put(encodeBakedRegion({ rx: 0, rz: 0, level: 0, minY: 0, maxY: 0, quads: new Uint32Array(), offsets: new Int32Array(7) }));
  const metadata: BakedMetadata = { version: 2, kingdomId: '123', recipeHash, sourcePlanHash, sourcePlanRevision: 'layout-1',
    compilers: BAKED_COMPILERS, size: 256, height: 256, seaLevel: 0,
    seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
    physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [-16, -5, -32], max: [112, 123, 96] },
    palette: [{ id: 126, colour: '#aaaaaa', kind: 0 }], surface,
    regions: [{ rx: 0, rz: 0, exact: true, bounds: { min: [-16, -5, -32], max: [112, -5, 96] },
      meshes: [{ ...mesh, level: 0, rx: 0, rz: 0, minY: 0, maxY: 0, quadCount: 0 }] }] };
  const manifest = await store.put(encodeBakedMetadata(metadata));
  await store.bind({ version: 1, kingdomId: '123', sceneHash: scene, layoutRevision: 'layout-1', collisionRevision: 1,
    sourcePlanHash, recipeHash, manifest });
  return { surface };
}

type Reply = { status: number; raw: string[]; body: Buffer };
const get = (path: string, method = 'GET', headers: Record<string, string> = {}) => new Promise<Reply>((resolve, reject) => {
  const sent = request(`${endpoint}${path}`, { method, headers, agent: false }, response => {
    const chunks: Buffer[] = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode ?? 0, raw: response.rawHeaders, body: Buffer.concat(chunks) }));
    response.on('error', reject);
  });
  sent.on('error', reject);
  sent.end();
});
const lengths = (reply: Reply) => reply.raw.filter((_value, i) => i % 2 === 0 && reply.raw[i]!.toLowerCase() === 'content-length')
  .map(name => reply.raw[reply.raw.indexOf(name) + 1]);
const header = (reply: Reply, name: string) => {
  const i = reply.raw.findIndex((value, at) => at % 2 === 0 && value.toLowerCase() === name);
  return i < 0 ? undefined : reply.raw[i + 1];
};

describe('land over a real listener, read by a Node http client', () => {
  it('sends one Content-Length that matches the bytes, for the binding and a blob', async () => {
    const { surface } = await publish();
    const base = `/api/realm/land/123/${scene}`;
    const binding = await get(base);
    expect(binding.status).toBe(200);
    expect(lengths(binding)).toEqual([String(binding.body.byteLength)]);
    expect(JSON.parse(binding.body.toString('utf8'))).toMatchObject({ kingdomId: '123', sceneHash: scene });

    const blob = await get(`${base}/${surface.hash}`);
    expect(blob.status).toBe(200);
    expect(header(blob, 'content-type')).toBe('application/gzip');
    expect(lengths(blob)).toEqual([String(blob.body.byteLength)]);
    expect(blob.body.byteLength).toBe(surface.gzipBytes);
    expect([...blob.body.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
  });

  it('answers HEAD with the real length and no body, and 304 with neither', async () => {
    const { surface } = await publish();
    const path = `/api/realm/land/123/${scene}/${surface.hash}`;
    const head = await get(path, 'HEAD');
    expect(head.status).toBe(200);
    expect(lengths(head)).toEqual([String(surface.gzipBytes)]);
    expect(head.body.byteLength).toBe(0);

    const etag = header(head, 'etag')!;
    const unchanged = await get(path, 'GET', { 'if-none-match': etag });
    expect(unchanged.status).toBe(304);
    expect(unchanged.body.byteLength).toBe(0);
    expect(lengths(unchanged).length).toBeLessThanOrEqual(1);
  });

  it('fails closed with one Content-Length for unknown land', async () => {
    const missing = await get(`/api/realm/land/123/${scene}`);
    expect(missing.status).toBe(404);
    expect(lengths(missing)).toEqual([String(missing.body.byteLength)]);
    expect(header(missing, 'cache-control')).toBe('no-store');
  });
});
