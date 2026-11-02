import { canonicalSceneJson } from '../../../../packages/world/src/founded-world/codec';
import { decodeSketchRecord, grandSketchRecipeHash, SKETCH_RECIPE_BYTES, SKETCH_RECORD_BYTES, validateSketchRecipe, type GrandSketchRecipe, type GrandSketchRecord } from '../../../../packages/world/src/grand/sketch';
import { BAKED_REGION_HEADER_BYTES, BAKED_REGION_QUAD_BYTES, type BakedBlobRef, type BakedFormat, type BakedRegionMesh, type BakedRegionRef, type BakedSurface } from '../../../../packages/world/src/grand/baked/types';
import { BAKED_PENDING_COMPRESSED_BYTES, BAKED_SURFACE_BYTES, validateLandBlob } from '../kingdom/grand-land/baked-client-binding';
import { abortError, BakedRequestGate, checkSignal, readBounded } from '../kingdom/grand-land/baked-client-transport';
import { boundedBakedCache, createBakedCache, type BakedCompressedCache } from '../kingdom/grand-land/baked-cache';
import { BakedDecoder } from '../kingdom/grand-land/baked-client-decoder';
import type { BakedDecodeContext } from '../kingdom/grand-land/baked-client-decode';

/**
 * Where a channel's sketch stands, as the realm and this browser actually saw it. Nothing here is estimated:
 * `raising` carries the bake's own counts, `reading` the bytes really read and the blobs really verified.
 */
export type SketchSourceState =
  | { readonly kind: 'asking' }
  | { readonly kind: 'raising'; readonly stage: 'raising' | 'meshes'; readonly done: number; readonly total: number; readonly ahead: number }
  | { readonly kind: 'reading'; readonly bytes: number; readonly blobs: number; readonly cacheHits: number };

export class SketchRefused extends Error {
  constructor(readonly reason: 'invalid' | 'pinned' | 'founded' | 'busy' | 'resting' | 'failed' | 'unreachable', message: string) { super(message); this.name = 'SketchRefused'; }
}

/** Where a channel stands before anything is drawn: founded (its kingdom is the place to go), or the world it has. */
export type ChannelWorld =
  | { readonly kind: 'founded' }
  /** `pinned`: the realm already keeps this world for the channel; otherwise it is the one this browser proposes. */
  | { readonly kind: 'world'; readonly recipe: GrandSketchRecipe; readonly pinned: boolean };

/**
 * Ask the realm, never the Atlas alone, what a channel's land is (GW13). A founded kingdom is answered by its
 * founded receipt and is never shown a sketch; an unfounded channel's world is the one the realm pinned the first
 * time anyone looked it up, so a survey that drifted since cannot show a different land. Only when the channel has
 * no world yet does this browser's own recipe stand, and asking the realm to raise it is what pins it.
 */
export async function resolveChannelWorld(options: {
  readonly proposed: GrandSketchRecipe;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<ChannelWorld> {
  const fetcher = options.fetch ?? globalThis.fetch, kingdomId = options.proposed.seed.kingdomId;
  const ask = async (path: string, accept: string) => {
    options.signal?.throwIfAborted();
    try { return await fetcher(path, { signal: options.signal ?? null, credentials: 'same-origin', cache: 'no-store', headers: { accept } }); }
    catch (error) { options.signal?.throwIfAborted(); void error; throw new SketchRefused('unreachable', 'The realm could not be reached'); }
  };
  const founded = await ask(`/api/realm/founded/${kingdomId}`, 'application/json');
  // A receipt or a closed door means founded. Only the realm's own JSON 404 ("no adopted layout") means not yet;
  // anything else (a geometry still preparing, a gateway's page) cannot tell, so nothing is promised.
  if (founded.status === 200 || founded.status === 403) { void founded.body?.cancel().catch(() => undefined); return { kind: 'founded' }; }
  let unfounded = false;
  if (founded.status === 404 && (founded.headers.get('content-type') ?? '').split(';')[0]!.trim() === 'application/json') {
    try {
      const answer = JSON.parse(new TextDecoder().decode(await readBounded(founded.body, 1024, options.signal ?? new AbortController().signal))) as { status?: unknown };
      unfounded = answer.status === 'unavailable';
    } catch (error) { options.signal?.throwIfAborted(); void error; }
  } else void founded.body?.cancel().catch(() => undefined);
  if (!unfounded) throw new SketchRefused('unreachable', 'The realm could not say whether this kingdom is founded');
  const world = await ask(`/api/realm/land/${kingdomId}/world`, 'application/json');
  if (world.status === 404) { void world.body?.cancel().catch(() => undefined); return { kind: 'world', recipe: options.proposed, pinned: false }; }
  if (world.status !== 200 || (world.headers.get('content-type') ?? '').split(';')[0]!.trim() !== 'application/json') {
    void world.body?.cancel().catch(() => undefined);
    throw new SketchRefused('unreachable', 'The realm could not say which land this channel has');
  }
  const bytes = await readBounded(world.body, SKETCH_RECIPE_BYTES, options.signal ?? new AbortController().signal);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), recipe = validateSketchRecipe(JSON.parse(text));
  if (canonicalSceneJson(recipe) !== text || recipe.seed.kingdomId !== kingdomId) throw new Error('The realm answered with another channel’s world');
  return { kind: 'world', recipe, pinned: true };
}

export interface SketchLand {
  readonly record: GrandSketchRecord;
  readonly surface: BakedSurface;
  /** The verified mesh of one region at one level, nearest asked first by the caller. */
  mesh(ref: BakedRegionRef, signal?: AbortSignal): Promise<BakedRegionMesh>;
  readonly stats: { readonly networkBytes: number; readonly cacheBytes: number; readonly blobs: number; readonly cacheHits: number };
  dispose(): void;
}

/** Wait between asking the realm how the bake goes; the bake takes tens of seconds, the answer is a few bytes. */
export const SKETCH_POLL_MS = 1500;
const REASONS = new Set(['invalid', 'pinned', 'founded', 'busy', 'resting', 'failed']);

/**
 * Open a channel's own world from the realm (GW13). The browser knows which land it expects (the recipe it made from
 * the channel's survey facts), asks for exactly that hash, follows the bake while the realm raises it, then reads the
 * record and every blob through the same verified, bounded and cached path as a founded kingdom's land. It never
 * generates land and never accepts bytes for another recipe.
 */
export async function openSketchLand(options: {
  readonly recipe: GrandSketchRecipe;
  readonly signal?: AbortSignal;
  readonly onState?: (state: SketchSourceState) => void;
  readonly fetch?: typeof globalThis.fetch;
  readonly cache?: BakedCompressedCache | null;
  readonly pollMs?: number;
  /** False when the realm keeps no world for this channel yet: ask it first, which is what pins this one. */
  readonly pinned?: boolean;
}): Promise<SketchLand> {
  const recipe = options.recipe, kingdomId = recipe.seed.kingdomId, recipeHash = await grandSketchRecipeHash(recipe);
  const fetcher = options.fetch ?? globalThis.fetch, cache = options.cache === undefined ? createBakedCache() : options.cache;
  const controller = new AbortController(), signal = controller.signal, decoder = new BakedDecoder();
  const base = `/api/realm/land/${kingdomId}/${recipeHash}`;
  const stats = { networkBytes: 0, cacheBytes: 0, blobs: 0, cacheHits: 0 };
  let cacheEnabled = true;
  const reading = () => options.onState?.({ kind: 'reading', bytes: stats.networkBytes + stats.cacheBytes, blobs: stats.blobs, cacheHits: stats.cacheHits });
  const dispose = () => { if (!signal.aborted) { options.signal?.removeEventListener('abort', dispose); decoder.dispose(); controller.abort(); } };
  options.signal?.addEventListener('abort', dispose, { once: true });
  if (options.signal?.aborted) dispose();
  const gate = new BakedRequestGate(6, BAKED_PENDING_COMPRESSED_BYTES, () => {});

  async function get(path: string, limit: number, format: 'application/json' | 'application/gzip', active: AbortSignal): Promise<Uint8Array | null> {
    checkSignal(active);
    let response: Response;
    try { response = await fetcher(path, { signal: active, credentials: 'same-origin', headers: { accept: format } }); }
    catch (error) { checkSignal(active); void error; throw new SketchRefused('unreachable', 'The realm could not be reached'); }
    if (response.status === 404) { void response.body?.cancel().catch(() => undefined); return null; }
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(), declared = response.headers.get('content-length');
    if (response.status !== 200 || type !== format || (response.headers.get('content-encoding') ?? 'identity') !== 'identity'
      || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))) {
      void response.body?.cancel().catch(() => undefined);
      throw new SketchRefused('unreachable', 'The land could not be read');
    }
    return readBounded(response.body, limit, active, count => { stats.networkBytes += count; reading(); });
  }

  /** Ask the realm to raise this exact recipe and follow its own counts until it is ready. */
  async function raise(): Promise<void> {
    const body = canonicalSceneJson(recipe);
    for (;;) {
      checkSignal(signal);
      let response: Response;
      try { response = await fetcher(base, { method: 'POST', signal, credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body }); }
      catch (error) { checkSignal(signal); void error; throw new SketchRefused('unreachable', 'The realm could not be reached'); }
      const text = await readBounded(response.body, 4096, signal).then(bytes => new TextDecoder().decode(bytes)).catch(() => '');
      let status: { state?: unknown; reason?: unknown; stage?: unknown; done?: unknown; total?: unknown; ahead?: unknown } = {};
      try { status = JSON.parse(text) as typeof status; } catch { /* answered below */ }
      if (response.status === 200 && status.state === 'ready') return;
      if (response.status === 202 && status.state === 'raising') {
        const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
        options.onState?.({ kind: 'raising', stage: status.stage === 'meshes' ? 'meshes' : 'raising', done: count(status.done), total: count(status.total), ahead: count(status.ahead) });
        await new Promise<void>((done, fail) => {
          const timer = setTimeout(done, options.pollMs ?? SKETCH_POLL_MS);
          signal.addEventListener('abort', () => { clearTimeout(timer); fail(abortError()); }, { once: true });
        });
        continue;
      }
      const reason = typeof status.reason === 'string' && REASONS.has(status.reason) ? status.reason as SketchRefused['reason'] : 'unreachable';
      throw new SketchRefused(reason, 'The realm will not raise this land just now');
    }
  }

  async function blob<T>(ref: BakedBlobRef, context: BakedDecodeContext, active: AbortSignal): Promise<T> {
    const release = await gate.acquire(ref.gzipBytes, active);
    try {
      if (cache && cacheEnabled) {
        let compressed: Uint8Array | null = null;
        try { compressed = await boundedBakedCache(work => cache.get(ref.gzipHash, ref.gzipBytes, work), active); }
        catch (error) { checkSignal(active); if (error instanceof DOMException && error.name === 'TimeoutError') cacheEnabled = false; }
        if (compressed) {
          // The decoder takes the bytes to its worker, so their length is read first.
          const length = compressed.byteLength;
          try {
            const result = await decoder.decode(compressed, ref, context, active);
            stats.cacheBytes += length; stats.cacheHits++; stats.blobs++; reading();
            return result.value as T;
          } catch { checkSignal(active); await cache.delete(ref.gzipHash, active).catch(() => undefined); }
        }
      }
      const compressed = await get(`${base}/${ref.hash}`, ref.gzipBytes, 'application/gzip', active);
      if (!compressed) throw new SketchRefused('unreachable', 'A piece of the land is missing');
      const result = await decoder.decode(compressed, ref, context, active);
      if (cache && cacheEnabled) await boundedBakedCache(work => cache.put(ref.gzipHash, result.compressed, work), active).catch(() => { checkSignal(active); });
      stats.blobs++; reading();
      return result.value as T;
    } finally { release(); }
  }

  try {
    options.onState?.({ kind: 'asking' });
    let bytes = options.pinned === false ? null : await get(base, SKETCH_RECORD_BYTES, 'application/json', signal);
    if (!bytes) { await raise(); bytes = await get(base, SKETCH_RECORD_BYTES, 'application/json', signal); }
    if (!bytes) throw new SketchRefused('unreachable', 'The land was raised but could not be read');
    const record = decodeSketchRecord(bytes, { kingdomId, recipeHash });
    if (canonicalSceneJson(record.recipe) !== canonicalSceneJson(recipe)) throw new Error('The realm answered with another land');
    validateLandBlob(record.surface, BAKED_SURFACE_BYTES);
    for (const mesh of record.meshes) validateLandBlob(mesh, BAKED_REGION_HEADER_BYTES + BAKED_REGION_QUAD_BYTES);
    const format = record.format as BakedFormat;
    const surface = await blob<BakedSurface>(record.surface, { kind: 'surface', format, size: record.size, height: record.height, seaLevel: record.seaLevel }, signal);
    const refs = new Set(record.meshes), materials = record.palette.map(material => material.id);
    return {
      record, surface, get stats() { return { ...stats }; }, dispose,
      async mesh(ref, own) {
        if (!refs.has(ref)) throw new Error('This mesh is not part of the sketch');
        const request = new AbortController(), stop = () => request.abort();
        signal.addEventListener('abort', stop, { once: true }); own?.addEventListener('abort', stop, { once: true });
        if (signal.aborted || own?.aborted) request.abort();
        try { return await blob<BakedRegionMesh>(ref, { kind: 'mesh', format, ref, height: record.height, materials }, request.signal); }
        finally { signal.removeEventListener('abort', stop); own?.removeEventListener('abort', stop); }
      },
    };
  } catch (error) { dispose(); throw error; }
}
