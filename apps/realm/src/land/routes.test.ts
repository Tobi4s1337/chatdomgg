import { createHash } from 'node:crypto';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeBakedMetadata, encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { BAKED_COMPILERS, type BakedMetadata } from '../../../../packages/world/src/grand/baked/types';
import { LandArtifactStore } from './store';
import { readLandRoute } from './routes';

let directory: string;
let store: LandArtifactStore;
const scene = 'a'.repeat(64), sourcePlanHash = 'b'.repeat(64);
const base = `/api/realm/land/123/${scene}`;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'chatdom-land-route-')); store = new LandArtifactStore(directory); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

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
  const binding = { version: 1 as const, kingdomId: '123', sceneHash: scene, layoutRevision: 'layout-1', collisionRevision: 1,
    sourcePlanHash, recipeHash, manifest };
  await store.bind(binding);
  return { binding, manifest, surface, mesh };
}

describe('read-only land route', () => {
  it('fails closed for unknown paths, methods and unpublished blobs', async () => {
    const unbound = await store.put(Buffer.from('private'));
    expect(await readLandRoute(store, '/another/path')).toBeNull();
    for (const path of ['/api/realm/land/../123', `${base}/../${unbound.hash}`, `/api/realm/land/0123/${scene}`, `${base}/bad`]) {
      expect((await readLandRoute(store, path))?.status).toBe(404);
    }
    const method = await readLandRoute(store, base, 'POST');
    expect(method?.status).toBe(405);
    expect(method?.headers.allow).toBe('GET, HEAD');
    expect((await readLandRoute(store, `${base}/${unbound.hash}`))?.status).toBe(404);
  });

  it('serves the complete immutable binding and authorized gzip artifacts with HEAD and ETag', async () => {
    const { binding, manifest, surface, mesh } = await publish();
    const response = await readLandRoute(store, base);
    expect(response?.status).toBe(200);
    expect(JSON.parse(Buffer.from(response!.body).toString())).toEqual(binding);
    expect(response?.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response?.headers.etag).toBe(`"${sha(response!.body)}"`);
    expect((await readLandRoute(store, base, 'GET', response!.headers.etag))?.status).toBe(304);
    for (const ref of [manifest, surface, mesh]) {
      const path = `${base}/${ref.hash}`, get = await readLandRoute(store, path);
      expect(get?.status).toBe(200);
      expect(get?.headers['content-type']).toBe('application/gzip');
      expect(get?.headers['content-encoding']).toBeUndefined();
      expect(get?.headers.etag).toBe(`"${ref.gzipHash}"`);
      expect(Buffer.from(get!.body)).toEqual(Buffer.from(await store.compressed(ref)));
      const head = await readLandRoute(store, path, 'HEAD');
      expect(head?.status).toBe(200);
      expect(head?.body.byteLength).toBe(0);
      expect(head?.headers['content-length']).toBe(String(ref.gzipBytes));
      const cached = await readLandRoute(store, path, 'GET', get!.headers.etag);
      expect(cached?.status).toBe(304);
      expect(cached?.body.byteLength).toBe(0);
    }
    const unbound = await store.put(Buffer.from('not referenced'));
    expect((await readLandRoute(store, `${base}/${unbound.hash}`))?.status).toBe(404);
  });

  it('returns unavailable on corrupt or missing published artifacts without generating replacements', async () => {
    const { manifest, surface } = await publish();
    const surfacePath = join(directory, 'blobs', `${surface.hash}.gz`);
    await unlink(surfacePath);
    const missing = await readLandRoute(store, `${base}/${surface.hash}`);
    expect(missing?.status).toBe(503);
    expect(missing?.headers['cache-control']).toBe('no-store');
    await expect(store.compressed(surface)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(join(directory, 'blobs', `${manifest.hash}.gz`), Buffer.alloc(manifest.gzipBytes));
    expect((await readLandRoute(store, `${base}/${surface.hash}`))?.status).toBe(503);
    expect((await readLandRoute(store, `${base}/${manifest.hash}`))?.status).toBe(503);
  });
});
