/* global Worker:readonly */
import type { Vec3 } from '@chatdom/shared';
import type { AssetChunkMesh } from '@chatdom/voxel';
import type { KingdomLayout } from '@chatdom/world';
import type { TerrainProgress, TerrainWorkerRequest, TerrainWorkerResponse } from './terrain-worker';

export type { TerrainProgress } from './terrain-worker';
export interface TerrainResult { readonly chunks: AssetChunkMesh[]; readonly origin: Vec3 }
export interface TerrainLoadOptions {
  readonly signal?: AbortSignal;
  /** Includes preparation and all chunks; progress is observable well before this deadline. */
  readonly timeoutMs?: number;
}

/** Owns one cancellable terrain worker; completion, failure and abort all terminate it. */
export function loadTerrain(layout: KingdomLayout, onProgress?: (progress: TerrainProgress) => void,
  options: TerrainLoadOptions = {}): Promise<TerrainResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const signal = options.signal;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('Terrain timeout must be positive.'));
  if (signal?.aborted) return Promise.reject(new DOMException('Terrain loading was cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./terrain-worker.ts', import.meta.url), { type: 'module' });
    } catch (error) { reject(error); return; }
    let finished = false, origin: Vec3 | undefined, total = -1, completed = 0;
    const chunks: AssetChunkMesh[] = [];
    const coordinates = new Set<string>();
    const cleanup = (): void => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (error: unknown): void => {
      if (finished) return;
      finished = true; cleanup(); reject(error);
    };
    const abort = (): void => fail(new DOMException('Terrain loading was cancelled.', 'AbortError'));
    const timeout = globalThis.setTimeout(() => fail(new Error('Terrain preparation exceeded its time budget.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'Terrain worker failed.')); };
    worker.onmessageerror = () => fail(new Error('Terrain worker response could not be decoded.'));
    worker.onmessage = (event: MessageEvent<TerrainWorkerResponse>) => {
      if (finished) return;
      try {
        const response = event.data;
        if (response.kind === 'error') { fail(new Error(response.message)); return; }
        if (response.kind === 'start') {
          if (origin !== undefined || !Number.isSafeInteger(response.total) || response.total < 0
            || response.origin.length !== 3 || response.origin.some(n => !Number.isFinite(n) || n % 16 !== 0)) {
            throw new Error('Terrain worker returned invalid preparation bounds.');
          }
          origin = response.origin; total = response.total;
          onProgress?.({ completed: 0, total, origin });
        } else if (response.kind === 'chunk') {
          const progress = response.progress;
          if (origin === undefined || progress.completed !== completed + 1 || progress.total !== total
            || progress.origin.length !== 3 || progress.origin.some((n, axis) => n !== origin![axis]) || progress.completed > total) {
            throw new Error('Terrain worker returned out-of-order progress.');
          }
          if (progress.chunk !== undefined) {
            const { coordinate, mesh } = progress.chunk, key = coordinate.join(',');
            if (coordinate.length !== 3 || coordinate.some(n => !Number.isInteger(n) || n < 0 || n > 31)
              || coordinates.has(key) || !(mesh.vertices instanceof Uint32Array) || !(mesh.indices instanceof Uint32Array)
              || mesh.vertices.length % 8 !== 0 || mesh.indices.length !== mesh.quadCount * 6) {
              throw new Error('Terrain worker returned an invalid chunk.');
            }
            coordinates.add(key); chunks.push(progress.chunk);
          }
          completed = progress.completed;
          onProgress?.(progress);
        } else if (response.kind === 'complete') {
          if (origin === undefined || response.completed !== completed || response.total !== total || completed !== total) {
            throw new Error('Terrain worker completed before its chunks arrived.');
          }
          finished = true; cleanup(); resolve({ chunks, origin });
        } else throw new Error('Unknown terrain worker response.');
      } catch (error) { fail(error); }
    };
    try {
      const request: TerrainWorkerRequest = { kind: 'build-terrain', layout };
      worker.postMessage(request);
    } catch (error) { fail(error); }
    if (signal?.aborted) abort();
  });
}
