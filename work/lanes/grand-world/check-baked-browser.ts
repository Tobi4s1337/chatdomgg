import { openBakedLand, type BakedLandExpected } from '../../../apps/web/src/kingdom/grand-land/baked-client';

const cacheName = 'chatdom-baked-land-gzip-v1';
async function digest(array: ArrayBufferView): Promise<string> {
  const copy = new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice();
  const hash = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function run(expected: BakedLandExpected) {
  if (!globalThis.caches || typeof Worker !== 'function' || !navigator.locks) throw new Error('CacheStorage, Worker and Web Locks are required');
  await caches.delete(cacheName);
  const summaries = [];
  for (let pass = 0; pass < 3; pass++) {
    if (pass === 2) {
      const ref = summaries[0]!.ref;
      const cache = await caches.open(cacheName);
      const key = new URL(`/__chatdom/baked-land/gzip/v1/${ref.gzipHash}`, location.origin).href;
      const response = await cache.match(key);
      if (!response) throw new Error('Physical mesh was not cached');
      const body = new Uint8Array(await response.arrayBuffer());
      body[0] = body[0]! ^ 0xff;
      await cache.put(key, new Response(body, { headers: response.headers }));
    }
    const source = await openBakedLand({ expected });
    try {
      const ref = source.metadata.regions.find(region => region.exact && region.meshes.some(mesh => mesh.level === 0 && mesh.quadCount > 0))
        ?.meshes.find(mesh => mesh.level === 0 && mesh.quadCount > 0);
      if (!ref) throw new Error('No non-empty physical L0 mesh');
      const mesh = await source.mesh(ref);
      summaries.push({ metadata: JSON.stringify(source.metadata), surfaceGround: await digest(source.surface.ground),
        surfaceWater: await digest(source.surface.water), meshQuads: await digest(mesh.quads), meshOffsets: await digest(mesh.offsets),
        ref, stats: source.stats });
    } finally { source.dispose(); }
  }
  await caches.delete(cacheName);
  let unlock!: () => void, locked!: () => void;
  const acquired = new Promise<void>(resolve => { locked = resolve; });
  const held = navigator.locks.request(cacheName, async () => { locked(); await new Promise<void>(resolve => { unlock = resolve; }); });
  await acquired;
  const controller = new AbortController();
  try {
    const started = performance.now();
    const lockedSource = await Promise.race([
      openBakedLand({ expected }),
      pause(8000).then(() => { throw new Error('Load stalled on held cache lock'); }),
    ]);
    try {
      if (lockedSource.stats.cacheHits !== 0) throw new Error('Unexpected cache hit after clearing cache');
      const ref = lockedSource.metadata.regions.find(region => region.exact && region.meshes.some(mesh => mesh.level === 0 && mesh.quadCount > 0))
        ?.meshes.find(mesh => mesh.level === 0 && mesh.quadCount > 0);
      if (!ref) throw new Error('No physical mesh under held lock');
      await lockedSource.mesh(ref);
      if (await digest(lockedSource.surface.ground) !== summaries[0]!.surfaceGround) throw new Error('Locked load differs');
    } finally { lockedSource.dispose(); }
    const opening = openBakedLand({ expected, signal: controller.signal,
      onProgress: stats => { if (stats.networkBytes > 4096) controller.abort(); } });
    const settled = opening.then(source => { source.dispose(); return 'resolved'; }, error => error.name as string);
    const result = await Promise.race([settled, pause(2000).then(() => 'timeout')]);
    if (result !== 'AbortError') throw new Error(`Held cache lock cancellation returned ${result}`);
    return { summaries, lockedMs: performance.now() - started };
  } finally { controller.abort(); unlock(); await held; }
}

Object.assign(window, { checkBakedBrowser: run });
