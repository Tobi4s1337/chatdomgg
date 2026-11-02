import { afterEach, expect, it, vi } from 'vitest';
import { BakedDecoder } from './baked-client-decoder';
import { verifyAndDecode, type BakedDecodeReply, type BakedDecodeRequest } from './baked-client-decode';
import { artifact, expected, memoryCache } from './baked-client.test-helper';
import { openBakedLand } from './baked-client';

/** Models actual structured-clone transfers, rather than retaining the original JS object as a mock.
 * Native worker execution is checked by the browser capture; this probes the ownership/cancellation edge. */
class TransferWorker {
  static readonly instances: TransferWorker[] = [];
  static paused = false;
  onmessage: ((event: MessageEvent<BakedDecodeReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  request: BakedDecodeRequest | undefined;
  constructor() { TransferWorker.instances.push(this); }
  terminate() { this.terminated = true; this.request = undefined; }
  postMessage(message: BakedDecodeRequest, transfer: Transferable[]) {
    const request = structuredClone(message, { transfer }); this.request = request;
    if (TransferWorker.paused) return;
    void verifyAndDecode(request.bytes, request.ref, request.context, new AbortController().signal).then(result => {
      if (this.terminated) return;
      const buffers = [result.compressed.buffer as ArrayBuffer];
      if ('ground' in result.value) buffers.push(result.value.ground.buffer as ArrayBuffer, result.value.water.buffer as ArrayBuffer);
      else if ('quads' in result.value) buffers.push(result.value.quads.buffer as ArrayBuffer, result.value.offsets.buffer as ArrayBuffer);
      this.request = undefined;
      this.onmessage?.({ data: structuredClone({ id: request.id, result }, { transfer: buffers }) } as MessageEvent<BakedDecodeReply>);
    }, error => {
      if (!this.terminated) this.onmessage?.({ data: { id: request.id, error: String(error) } } as MessageEvent<BakedDecodeReply>);
    });
  }
}
afterEach(() => { vi.unstubAllGlobals(); TransferWorker.instances.length = 0; TransferWorker.paused = false; });

it('transfers compressed buffers into no more than two workers, returns only decoded data, and refills its queue', async () => {
  vi.stubGlobal('Worker', TransferWorker);
  const fixture = await artifact(), decoder = new BakedDecoder(), ref = fixture.metadata.regions[1]!.meshes[3]!;
  const bytes = Array.from({ length: 5 }, () => fixture.blobs.get(ref.hash)!.slice());
  const results = await Promise.all(bytes.map(bytes => decoder.decode(bytes, ref,
    { kind: 'mesh', format: fixture.metadata.version, ref, height: fixture.metadata.height, materials: [126] }, new AbortController().signal)));
  expect(TransferWorker.instances).toHaveLength(2);
  expect(bytes.every(bytes => bytes.byteLength === 0)).toBe(true);
  for (const result of results) {
    expect(result.compressed.byteLength).toBe(ref.gzipBytes);
    expect(result).not.toHaveProperty('raw');
    expect('quads' in result.value && result.value.quads.length).toBe(2);
  }
  decoder.dispose(); expect(TransferWorker.instances.every(worker => worker.terminated)).toBe(true);
});

it('terminates a cancelled active decoder before replacing it, and rejects every queued job on disposal', async () => {
  vi.stubGlobal('Worker', TransferWorker); TransferWorker.paused = true;
  const fixture = await artifact(), decoder = new BakedDecoder(), ref = fixture.metadata.regions[1]!.meshes[3]!;
  const signals = Array.from({ length: 4 }, () => new AbortController());
  const requests = signals.map(signal => decoder.decode(fixture.blobs.get(ref.hash)!.slice(), ref,
    { kind: 'mesh', format: fixture.metadata.version, ref, height: fixture.metadata.height, materials: [126] }, signal.signal));
  const settled = Promise.allSettled(requests);
  expect(TransferWorker.instances).toHaveLength(2); signals[0]!.abort();
  expect(TransferWorker.instances[0]!.terminated).toBe(true);
  expect(TransferWorker.instances.filter(worker => !worker.terminated)).toHaveLength(2);
  decoder.dispose();
  expect((await settled).every(result => result.status === 'rejected' && result.reason.name === 'AbortError')).toBe(true);
  expect(TransferWorker.instances.every(worker => worker.terminated)).toBe(true);
});

it('restores metadata immutability after worker cloning and writes the returned compressed ownership to cache', async () => {
  vi.stubGlobal('Worker', TransferWorker);
  const fixture = await artifact(), memory = memoryCache();
  const source = await openBakedLand({ expected, fetch: fixture.fetcher, cache: memory.cache });
  expect(Object.isFrozen(source.metadata)).toBe(true);
  expect(Object.isFrozen(source.metadata.regions[1]!.meshes[3])).toBe(true);
  expect(memory.values.get(fixture.binding.manifest.gzipHash)?.byteLength).toBe(fixture.binding.manifest.gzipBytes);
  expect(memory.values.get(fixture.metadata.surface.gzipHash)?.byteLength).toBe(fixture.metadata.surface.gzipBytes);
  source.dispose(); expect(TransferWorker.instances.every(worker => worker.terminated)).toBe(true);
});
