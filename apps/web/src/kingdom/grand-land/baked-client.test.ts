import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { canonicalSceneJson, utf8 } from '../../../../../packages/world/src/founded-world/codec';
import { openBakedLand } from './baked-client';
import { artifact, expected, memoryCache } from './baked-client.test-helper';
import { BakedRequestGate, gunzipBounded, readBounded } from './baked-client-transport';
import { BAKED_SURFACE_BYTES, decodeLandBinding, validateLandBlob } from './baked-client-binding';

describe('receipt-bound baked land browser source', () => {
  it('downloads metadata and surface once, requests meshes only on demand, and reports actual bytes', async () => {
    const fixture = await artifact(), progress = vi.fn();
    const source = await openBakedLand({ expected, fetch: fixture.fetcher, cache: null, onProgress: progress });
    expect(fixture.requests).toHaveLength(3);
    expect(source.metadata).toEqual(fixture.metadata);
    expect(Object.isFrozen(source.metadata.regions[1]!.meshes[3])).toBe(true);
    expect(source.surface.ground[0]).toBe(8);
    const mesh = await source.mesh(source.metadata.regions[1]!.meshes[3]!);
    expect(mesh.level).toBe(3); expect(mesh.quads.length).toBe(2); expect(fixture.requests).toHaveLength(4);
    const descriptors = [fixture.binding.manifest, fixture.metadata.surface, fixture.metadata.regions[1]!.meshes[3]!];
    expect(source.stats.networkBytes).toBe(utf8(canonicalSceneJson(fixture.binding)).byteLength + descriptors.reduce((n, ref) => n + ref.gzipBytes, 0));
    expect(source.stats.verifiedRawBytes).toBe(descriptors.reduce((n, ref) => n + ref.rawBytes, 0));
    expect(source.stats.completedBlobs).toBe(3); expect(source.stats.activeRequests).toBe(0);
    expect(progress).toHaveBeenCalled(); source.dispose(); expect(source.stats.phase).toBe('disposed');
  });

  it.each(['kingdomId', 'sceneHash', 'layoutRevision', 'collisionRevision', 'sourcePlanHash', 'recipeHash'] as const)(
    'rejects a binding with the wrong %s before fetching metadata', async field => {
      const fixture = await artifact();
      const changed = { ...expected, [field]: field === 'collisionRevision' ? 2 : field === 'kingdomId' ? '456'
        : field === 'layoutRevision' ? 'layout-2' : 'f'.repeat(64) };
      await expect(openBakedLand({ expected: changed, fetch: fixture.fetcher, cache: null })).rejects.toThrow('current founded scene');
      expect(fixture.requests).toHaveLength(1);
    });

  it('strictly rejects extra binding fields, noncanonical bytes and over-budget descriptors', async () => {
    const { binding } = await artifact();
    expect(() => decodeLandBinding(utf8(canonicalSceneJson({ ...binding, citizens: [] })), expected)).toThrow('binding fields');
    expect(() => decodeLandBinding(utf8(JSON.stringify(binding)), expected)).toThrow('canonical');
    expect(() => decodeLandBinding(utf8(canonicalSceneJson({ ...binding, manifest: { ...binding.manifest, secret: true } })), expected)).toThrow('binding fields');
    expect(() => validateLandBlob({ ...binding.manifest, rawBytes: BAKED_SURFACE_BYTES + 1 }, BAKED_SURFACE_BYTES)).toThrow('byte budget');
    expect(() => validateLandBlob({ ...binding.manifest, gzipBytes: 8 * 1024 * 1024 + 1 }, BAKED_SURFACE_BYTES)).toThrow('byte budget');
  });

  it('rejects metadata identity drift and surface dimension drift', async () => {
    const drift = await artifact({ metadata: m => ({ ...m, recipeHash: 'd'.repeat(64) }) });
    await expect(openBakedLand({ expected, fetch: drift.fetcher, cache: null })).rejects.toThrow('metadata does not match');
    const surface = await artifact({ surface: s => ({ ...s, height: 256 }) });
    await expect(openBakedLand({ expected, fetch: surface.fetcher, cache: null })).rejects.toThrow('surface does not match');
  });

  it.each(['material', 'descriptor', 'height'] as const)('rejects an otherwise verified mesh with wrong %s', async defect => {
    const fixture = await artifact({ mesh: mesh => defect === 'descriptor' ? { ...mesh, rx: 0 } : { ...mesh,
      quads: defect === 'material' ? new Uint32Array([mesh.quads[0]!, 127 | (16 << 16)])
        : new Uint32Array([(31 << 5) | (2 << 25), mesh.quads[1]!]) } });
    const source = await openBakedLand({ expected, fetch: fixture.fetcher, cache: null });
    await expect(source.mesh(source.metadata.regions[1]!.meshes[3]!)).rejects.toThrow(defect === 'material' ? 'palette' : defect === 'descriptor' ? 'region reference' : 'world height');
    source.dispose();
  });

  it('rejects mesh references from outside this immutable source', async () => {
    const fixture = await artifact(), source = await openBakedLand({ expected, fetch: fixture.fetcher, cache: null });
    await expect(source.mesh({ ...source.metadata.regions[0]!.meshes[0]! })).rejects.toThrow('not from this scene');
    expect(fixture.requests).toHaveLength(3); source.dispose();
  });

  it('checks compressed and raw digests and bounds decompression before JSON decoding', async () => {
    const badGzip = await artifact();
    const damaged = badGzip.blobs.get(badGzip.binding.manifest.hash)!; damaged[15] = damaged[15]! ^ 1;
    await expect(openBakedLand({ expected, fetch: badGzip.fetcher, cache: null })).rejects.toThrow('compressed digest');
    const badRaw = await artifact(), oldHash = badRaw.binding.manifest.hash;
    Object.assign(badRaw.binding.manifest, { hash: 'e'.repeat(64) });
    badRaw.blobs.set('e'.repeat(64), badRaw.blobs.get(oldHash)!);
    await expect(openBakedLand({ expected, fetch: badRaw.fetcher, cache: null })).rejects.toThrow('raw digest');
    const bomb = await artifact();
    Object.assign(bomb.binding.manifest, { rawBytes: bomb.binding.manifest.rawBytes - 1 });
    await expect(openBakedLand({ expected, fetch: bomb.fetcher, cache: null })).rejects.toThrow('stream exceeded');
  });

  it('reverifies persistent bytes and evicts corruption before exactly one network retry', async () => {
    const fixture = await artifact(), memory = memoryCache();
    const warm = await openBakedLand({ expected, fetch: fixture.fetcher, cache: memory.cache }); warm.dispose();
    const damaged = memory.values.get(fixture.binding.manifest.gzipHash)!; damaged[15] = damaged[15]! ^ 1;
    fixture.requests.length = 0;
    const repaired = await openBakedLand({ expected, fetch: fixture.fetcher, cache: memory.cache });
    expect(fixture.requests).toHaveLength(2); expect(memory.deletes).toContain(fixture.binding.manifest.gzipHash);
    expect(repaired.stats.cacheCorruptions).toBe(1); expect(repaired.stats.cacheHits).toBe(1); repaired.dispose();
    fixture.requests.length = 0;
    const source = await openBakedLand({ expected, fetch: fixture.fetcher, cache: memory.cache });
    expect(fixture.requests).toHaveLength(1); expect(source.stats.cacheHits).toBe(2); source.dispose();
  });

  it('cache unavailability and quota failures cannot fail verified network content', async () => {
    const fixture = await artifact();
    const broken = { async get() { throw new Error('storage disabled'); }, async put() { throw new Error('quota'); }, async delete() { throw new Error('storage disabled'); } };
    const source = await openBakedLand({ expected, fetch: fixture.fetcher, cache: broken });
    expect(source.stats.phase).toBe('ready'); expect(source.stats.completedBlobs).toBe(2); source.dispose();
  });

  it.each(['get', 'put', 'delete'] as const)('bounds a stuck cache %s and disables the cache for the rest of this source', async stage => {
    const fixture = await artifact(), stalled = vi.fn(() => new Promise<never>(() => {}));
    const cache = {
      async get() { return stage === 'get' ? stalled() : stage === 'delete' ? new Uint8Array(24) : null; },
      async put() { if (stage === 'put') await stalled(); },
      async delete() { if (stage === 'delete') await stalled(); },
    };
    const source = await openBakedLand({ expected, fetch: fixture.fetcher, cache });
    expect(source.stats.phase).toBe('ready'); expect(fixture.requests).toHaveLength(3);
    expect(stalled).toHaveBeenCalledTimes(1); source.dispose();
  });

  it.each(['get', 'put', 'delete'] as const)('settles source abort promptly during a cache %s that ignores its signal', async stage => {
    const fixture = await artifact(), abort = new AbortController();
    let enter!: () => void, active: AbortSignal | undefined;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const stall = (signal?: AbortSignal) => { active = signal; enter(); return new Promise<never>(() => {}); };
    const cache = {
      async get(_hash: string, _max: number, signal: AbortSignal) { return stage === 'get' ? stall(signal) : stage === 'delete' ? new Uint8Array(24) : null; },
      async put(_hash: string, _bytes: Uint8Array, signal: AbortSignal) { if (stage === 'put') await stall(signal); },
      async delete(_hash: string, signal?: AbortSignal) { if (stage === 'delete') await stall(signal); },
    };
    const opening = openBakedLand({ expected, fetch: fixture.fetcher, cache, signal: abort.signal });
    const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    await entered; abort.abort(); await rejected; expect(active?.aborted).toBe(true);
  });

  it('rejects transparent HTTP decompression and an oversized body without trusting Content-Length', async () => {
    const fixture = await artifact();
    const encoded = (async (input, init) => {
      const result = await fixture.fetcher(input, init); result.headers.set('content-encoding', 'gzip'); return result;
    }) as typeof fetch;
    await expect(openBakedLand({ expected, fetch: encoded, cache: null })).rejects.toThrow('transport headers');
    const oversized = (async () => new Response(new Uint8Array(4097), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    await expect(openBakedLand({ expected, fetch: oversized, cache: null })).rejects.toThrow('stream exceeded');
  });

  it('abort closes in-flight mesh requests and rejects queued work without late progress or results', async () => {
    const fixture = await artifact(), root = new AbortController(); let wait = false;
    const fetcher = (async (input, init) => {
      if (!wait) return fixture.fetcher(input, init);
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('closed', 'AbortError')), { once: true }));
    }) as typeof fetch;
    const source = await openBakedLand({ expected, fetch: fetcher, cache: null, signal: root.signal }); wait = true;
    const ref = source.metadata.regions[1]!.meshes[3]!;
    const promises = Array.from({ length: 8 }, () => source.mesh(ref));
    const settled = Promise.allSettled(promises);
    await vi.waitFor(() => expect(source.stats.activeRequests).toBe(4));
    expect(source.stats.queuedRequests).toBe(4); root.abort();
    const results = await settled;
    expect(results.every(result => result.status === 'rejected' && result.reason.name === 'AbortError')).toBe(true);
    expect(source.stats.activeRequests).toBe(0); expect(source.stats.pendingCompressedBytes).toBe(0);
    await expect(source.mesh(ref)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('per-mesh cancellation leaves the source and other requests usable', async () => {
    const fixture = await artifact(), source = await openBakedLand({ expected, fetch: fixture.fetcher, cache: null });
    const cancelled = new AbortController(); cancelled.abort();
    await expect(source.mesh(source.metadata.regions[0]!.meshes[0]!, cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(source.mesh(source.metadata.regions[0]!.meshes[0]!)).resolves.toMatchObject({ rx: 0 });
    expect(source.stats.phase).toBe('ready'); source.dispose();
  });
});

it('limits both concurrent requests and aggregate compressed reservations; queued abort frees capacity', async () => {
  const changes: number[][] = [], gate = new BakedRequestGate(4, 8 * 1024 * 1024, (...values) => changes.push(values));
  const signal = new AbortController(), first = await gate.acquire(5 * 1024 * 1024, signal.signal);
  const cancelled = new AbortController(), queued = gate.acquire(4 * 1024 * 1024, cancelled.signal);
  const rejection = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
  cancelled.abort(); await rejection;
  const second = await gate.acquire(3 * 1024 * 1024, signal.signal);
  expect(changes.at(-1)).toEqual([2, 8 * 1024 * 1024, 0]);
  first(); second(); expect(changes.at(-1)).toEqual([0, 0, 0]);
  expect(changes.every(([active, bytes]) => active! <= 4 && bytes! <= 8 * 1024 * 1024)).toBe(true);
});

it('bounded streaming cancels oversized input and compressed expansion', async () => {
  const cancel = vi.fn(), controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({ start(owner) { owner.enqueue(new Uint8Array(17)); }, cancel });
  await expect(readBounded(stream, 16, controller.signal)).rejects.toThrow('byte budget'); expect(cancel).toHaveBeenCalled();
  await expect(gunzipBounded(new Uint8Array(gzipSync(new Uint8Array(1024 * 1024))), 1024, controller.signal)).rejects.toThrow('byte budget');
});

it('bundles the browser source without generators, kits, tree builders or Node runtime imports', async () => {
  const modules = new Set<string>();
  await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'inspect-baked-client', moduleParsed(info) { modules.add(info.id); } }],
    build: { write: false, minify: false, rollupOptions: { input: fileURLToPath(new URL('./baked-client.ts', import.meta.url)) } } });
  expect(modules.size).toBeGreaterThan(0);
  expect([...modules].filter(id => /\/grand\/(?:generate|voxelize|kits|trees|terrain|erosion|recipe)\.ts$|\/grand\/artisans\/|node:/.test(id))).toEqual([]);
}, 20_000);
