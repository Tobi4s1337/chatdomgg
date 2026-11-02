import type { BakedBlobRef, BakedMetadata, BakedRegionMesh, BakedRegionRef, BakedSurface } from '../../../../../packages/world/src/grand/baked/types';
import { BAKED_BINDING_BYTES, BAKED_PENDING_COMPRESSED_BYTES, decodeLandBinding,
  validateLandExpected, type BakedLandExpected } from './baked-client-binding';
import { abortError, BakedRequestGate, checkSignal, readBounded } from './baked-client-transport';
import { boundedBakedCache, createBakedCache, type BakedCompressedCache } from './baked-cache';
import { BakedDecoder } from './baked-client-decoder';
import { freezeMetadata, type BakedDecodeContext } from './baked-client-decode';
export type { BakedLandExpected } from './baked-client-binding';

export interface BakedLandStats {
  phase: 'opening' | 'ready' | 'failed' | 'disposed';
  /** Actual bytes read from response bodies, including the binding. No estimated progress. */
  networkBytes: number;
  cacheBytes: number;
  verifiedRawBytes: number;
  completedBlobs: number;
  cacheHits: number;
  cacheCorruptions: number;
  activeRequests: number;
  queuedRequests: number;
  pendingCompressedBytes: number;
}
export interface BakedLandSource {
  readonly metadata: BakedMetadata;
  readonly surface: BakedSurface;
  mesh(ref: BakedRegionRef, signal?: AbortSignal): Promise<BakedRegionMesh>;
  readonly stats: Readonly<BakedLandStats>;
  dispose(): void;
}
export interface BakedLandOptions {
  readonly expected: BakedLandExpected;
  readonly signal?: AbortSignal;
  readonly onProgress?: (stats: Readonly<BakedLandStats>) => void;
  /** Injection seams for isolated transport tests. Production uses same-origin fetch and CacheStorage. */
  readonly fetch?: typeof globalThis.fetch;
  readonly cache?: BakedCompressedCache | null;
}

/** Read-only, receipt-bound artifact source. No generator, adoption or physical-authority path lives here.
 * A source is for one immutable scene identity; its owner must dispose it when that scene becomes stale.
 * Mesh buffers transfer to the caller. The source retains only metadata and one <=25 MiB surface raster. */
export async function openBakedLand(options: BakedLandOptions): Promise<BakedLandSource> {
  const expected = validateLandExpected(options.expected), controller = new AbortController();
  const decoder = new BakedDecoder();
  const stats: BakedLandStats = { phase: 'opening', networkBytes: 0, cacheBytes: 0, verifiedRawBytes: 0,
    completedBlobs: 0, cacheHits: 0, cacheCorruptions: 0, activeRequests: 0, queuedRequests: 0, pendingCompressedBytes: 0 };
  const fetcher = options.fetch ?? globalThis.fetch, cache = options.cache === undefined ? createBakedCache() : options.cache;
  let cacheEnabled = true;
  const base = `/api/realm/land/${expected.kingdomId}/${expected.sceneHash}`;
  function progress() { options.onProgress?.(Object.freeze({ ...stats })); }
  const gate = new BakedRequestGate(4, BAKED_PENDING_COMPRESSED_BYTES, (active, bytes, queued) => {
    stats.activeRequests = active; stats.pendingCompressedBytes = bytes; stats.queuedRequests = queued; progress();
  });
  function dispose() {
    if (controller.signal.aborted) return;
    options.signal?.removeEventListener('abort', dispose);
    if (stats.phase !== 'failed') stats.phase = 'disposed';
    decoder.dispose(); controller.abort(); progress();
  }
  options.signal?.addEventListener('abort', dispose, { once: true });
  if (options.signal?.aborted) dispose();
  async function cacheCall<T>(work: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    try { return await boundedBakedCache(work, signal); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') cacheEnabled = false;
      throw error;
    }
  }
  async function evict(hash: string, signal: AbortSignal): Promise<void> {
    if (!cache || !cacheEnabled) return;
    try { await cacheCall(active => cache.delete(hash, active), signal); }
    catch { checkSignal(signal); }
  }
  async function response(path: string, limit: number, signal: AbortSignal, format: 'application/json' | 'application/gzip') {
    checkSignal(signal);
    const result = await fetcher(path, { signal, credentials: 'same-origin', headers: { accept: format } });
    checkSignal(signal);
    if (result.status !== 200) { void result.body?.cancel().catch(() => undefined); throw new Error('The kingdom landscape is unavailable'); }
    const declared = result.headers.get('content-length');
    const encoding = result.headers.get('content-encoding');
    if ((result.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase() !== format
      || (encoding !== null && encoding !== 'identity')
      || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))) {
      void result.body?.cancel().catch(() => undefined); throw new Error('Invalid baked land transport headers');
    }
    const bytes = await readBounded(result.body, limit, signal, count => { stats.networkBytes += count; progress(); });
    if (declared !== null && Number(declared) !== bytes.byteLength) throw new Error('Baked land response length disagrees');
    return bytes;
  }
  async function blob<T>(ref: BakedBlobRef, signal: AbortSignal, context: BakedDecodeContext): Promise<T> {
    const release = await gate.acquire(ref.gzipBytes, signal);
    try {
      let compressed: Uint8Array | null = null;
      if (cache && cacheEnabled) {
        try { compressed = await cacheCall(active => cache.get(ref.gzipHash, ref.gzipBytes, active), signal); }
        catch { checkSignal(signal); await evict(ref.gzipHash, signal); }
      }
      if (compressed) {
        stats.cacheBytes += compressed.byteLength;
        try {
          const result = await decoder.decode(compressed, ref, context, signal);
          checkSignal(signal); stats.cacheHits++; stats.verifiedRawBytes += result.rawBytes; stats.completedBlobs++; progress(); checkSignal(signal); return result.value as T;
        } catch {
          checkSignal(signal); stats.cacheCorruptions++;
          await evict(ref.gzipHash, signal);
          compressed = null;
        }
      }
      // One network attempt after a corrupt persistent entry; no retries of corrupt server bytes.
      compressed = await response(`${base}/${ref.hash}`, ref.gzipBytes, signal, 'application/gzip');
      const result = await decoder.decode(compressed, ref, context, signal);
      checkSignal(signal);
      if (cache && cacheEnabled) {
        try { await cacheCall(active => cache.put(ref.gzipHash, result.compressed, active), signal); }
        catch { checkSignal(signal); }
      }
      checkSignal(signal); stats.verifiedRawBytes += result.rawBytes; stats.completedBlobs++; progress(); checkSignal(signal); return result.value as T;
    } finally { release(); }
  }
  try {
    checkSignal(controller.signal);
    const release = await gate.acquire(BAKED_BINDING_BYTES, controller.signal);
    let binding;
    try { binding = decodeLandBinding(await response(base, BAKED_BINDING_BYTES, controller.signal, 'application/json'), expected); }
    finally { release(); }
    const metadata = await blob<BakedMetadata>(binding.manifest, controller.signal, { kind: 'metadata', expected });
    // Structured cloning out of a worker drops property descriptors, so restore metadata immutability.
    freezeMetadata(metadata);
    const surface = await blob<BakedSurface>(metadata.surface, controller.signal,
      { kind: 'surface', format: metadata.version, size: metadata.size, height: metadata.height, seaLevel: metadata.seaLevel });
    const refs = new Set(metadata.regions.flatMap(region => region.meshes));
    const materials = metadata.palette.map(material => material.id);
    checkSignal(controller.signal); stats.phase = 'ready'; progress(); checkSignal(controller.signal);
    return { metadata, surface, get stats() { return Object.freeze({ ...stats }); }, dispose,
      async mesh(ref, signal) {
        if (!refs.has(ref)) throw new Error('Baked mesh reference is not from this scene metadata');
        const request = new AbortController();
        const abort = () => request.abort();
        controller.signal.addEventListener('abort', abort, { once: true });
        signal?.addEventListener('abort', abort, { once: true });
        if (controller.signal.aborted || signal?.aborted) request.abort();
        try {
          checkSignal(request.signal);
          return await blob<BakedRegionMesh>(ref, request.signal, { kind: 'mesh', format: metadata.version, ref, height: metadata.height, materials });
        } finally {
          controller.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort);
        }
      },
    };
  } catch (error) {
    if (!controller.signal.aborted) stats.phase = 'failed';
    dispose();
    throw controller.signal.aborted && options.signal?.aborted ? abortError() : error;
  }
}
