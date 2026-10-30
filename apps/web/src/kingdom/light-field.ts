/* global Worker:readonly */
import type { Vec3 } from '@chatdom/shared';
import type { WindowHouse } from '@chatdom/render';
import { terrainHeight } from '@chatdom/world';
import type { LightVolume } from '@chatdom/voxel';
import {
  LIGHT_FIELD_BUDGET, resolveLightFieldConfig,
  type LightFieldEmitter, type LightFieldLayout, type LightFieldOptions, type LightFieldRequest, type LightFieldResponse, type LightFieldSolve,
} from './light-field-worker';

export type { LightFieldOptions } from './light-field-worker';
export interface LightFieldSource { readonly position: Vec3; readonly strength: number; readonly normal?: Vec3 }
export interface LightFieldStats {
  readonly busy: boolean;
  readonly queued: boolean;
  readonly disposed: boolean;
  readonly failed: boolean;
  readonly requestedRevision: number;
  readonly publishedRevision: number;
  readonly completedJobs: number;
  readonly discardedJobs: number;
  readonly occupancyBuilds: number;
  readonly lastWorkerMs: number;
  readonly estimatedPeakBytes: number;
  readonly cells: number;
  readonly error: string | null;
}

/** Main calls at most 5 Hz. No geometry rasterization or occupancy allocation runs here. */
export function createLightField(
  layout: LightFieldLayout, houses: readonly WindowHouse[], onVolume: (volume: LightVolume) => void, onError?: (error: Error) => void,
  options: LightFieldOptions = {},
): {
  update(centre: Vec3, sources: readonly LightFieldSource[]): void;
  /** Rebuild occupancy after a published home changes. The displayed volume survives the replacement. */
  replaceHouses(houses: readonly WindowHouse[]): void;
  dispose(): void;
  readonly stats: LightFieldStats;
} {
  const config = resolveLightFieldConfig(layout, options);
  let worker = new Worker(new URL('./light-field-worker.ts', import.meta.url), { type: 'module' });
  let ready = false, disposed = false, failed = false;
  let revision = 0, published = 0, completed = 0, discarded = 0, occupancyBuilds = 0, lastWorkerMs = 0, estimatedPeakBytes = 0;
  let errorMessage: string | null = null;
  let active: LightFieldSolve | null = null, pending: LightFieldSolve | null = null;
  let latestSolve: LightFieldSolve | null = null;
  let latestKey: string | null = null;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    active = pending = null;
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    worker.terminate();
  }

  function fail(error: unknown): void {
    if (disposed) return;
    const reason = error instanceof Error ? error : new Error('Light field failed');
    failed = true;
    errorMessage = reason.message;
    dispose();
    onError?.(reason);
  }

  function post(request: LightFieldRequest): void {
    try { worker.postMessage(request); }
    catch (error) { fail(error); }
  }

  function drain(): void {
    if (!disposed && ready && !active && pending) {
      active = pending;
      pending = null;
      post(active);
    }
  }

  function initialize(nextHouses: readonly WindowHouse[]): void {
  const owner = worker;
  worker.onmessage = (event: MessageEvent<LightFieldResponse>) => {
    if (disposed || owner !== worker) return;
    const response = event.data;
    if (response === null || typeof response !== 'object') { fail(new Error('Invalid light field worker response')); return; }
    if (response.kind === 'ready') { ready = true; drain(); return; }
    if (response.kind === 'error') {
      if (response.revision === null || response.revision === active?.revision) fail(new Error(response.message));
      return;
    }
    if (response.kind !== 'volume') { fail(new Error('Unknown light field worker response')); return; }
    if (!active || response.revision !== active.revision) return;
    const job = active, volume = response.volume;
    if (!volume || volume.revision !== job.revision || volume.cellSize !== config.cellSize
      || !Array.isArray(volume.origin) || !Array.isArray(volume.size)
      || volume.origin.length !== 3 || volume.size.length !== 3
      || volume.origin.some((value, axis) => value !== job.origin[axis])
      || volume.size.some((value, axis) => value !== config.size[axis])
      || !(volume.light instanceof Uint8Array) || volume.light.length !== config.cells
      || !(volume.surfaceSamples instanceof Uint8Array) || volume.surfaceSamples.length !== config.size.reduce((count, value) => count * (value + 1), 1)
      || !Number.isFinite(volume.estimatedPeakBytes) || volume.estimatedPeakBytes < 0 || volume.estimatedPeakBytes > LIGHT_FIELD_BUDGET) {
      fail(new Error('Light field worker returned incompatible metadata'));
      return;
    }
    active = null;
    completed++;
    occupancyBuilds = response.occupancyBuilds;
    lastWorkerMs = response.solveMs;
    estimatedPeakBytes = volume.estimatedPeakBytes;
    if (job.revision === revision) {
      published = job.revision;
      try { onVolume(volume); }
      catch (error) { fail(error); }
    } else discarded++;
    drain();
  };
  worker.onerror = event => { if (owner !== worker) return; event.preventDefault(); fail(new Error(event.message || 'Light field worker failed')); };
  worker.onmessageerror = () => { if (owner === worker) fail(new Error('Light field response could not be decoded')); };
  post({ kind: 'init', layout, houses: nextHouses, options: { mode: config.mode, ...(options.position ? { position: [...options.position] as Vec3 } : {}), ...(options.bounds ? { bounds: { ...options.bounds } } : {}) } });
  }
  initialize(houses);

  return {
    update(centre, sources) {
      if (disposed) return;
      if (centre.some(value => !Number.isFinite(value))) throw new TypeError('Light field centre must be finite');
      const x = Math.floor(centre[0] / 8) * 8, z = Math.floor(centre[2] / 8) * 8;
      const origin: Vec3 = config.origin ?? [x - 32, Math.floor((terrainHeight(layout, x, z) - 3) / config.cellSize) * config.cellSize, z - 32];
      const emitters: LightFieldEmitter[] = [];
      for (const source of sources) {
        if (source.position.some(value => !Number.isFinite(value)) || !Number.isFinite(source.strength) || source.strength < 0 || source.strength > 1) {
          throw new TypeError('Light sources need finite positions and strengths in 0..1');
        }
        if (source.normal && source.normal.some(value => !Number.isFinite(value))) throw new TypeError('Light source normals must be finite');
        const level = Math.min(15, Math.round(15 * source.strength / config.levelScale) * config.levelScale);
        if (level === 0 || source.position.some((value, axis) => value < origin[axis]! || value >= origin[axis]! + config.size[axis]! * config.cellSize)) continue;
        emitters.push({ position: [...source.position], level, ...(source.normal ? { normal: [...source.normal] as Vec3 } : {}) });
      }
      const key = JSON.stringify([origin, emitters]);
      if (key === latestKey) return;
      if (!Number.isSafeInteger(revision + 1)) throw new Error('Light field revision exhausted');
      latestKey = key;
      pending = latestSolve = { kind: 'solve', revision: ++revision, origin, emitters };
      drain();
    },
    replaceHouses(nextHouses) {
      if (disposed) return;
      if (!Number.isSafeInteger(revision + 1)) throw new Error('Light field revision exhausted');
      // Each publication owns a new worker. A late ready/volume/error from the old
      // occupancy cannot satisfy or fail a request made against the replacement.
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      if (active) discarded++;
      active = null; ready = false; occupancyBuilds = 0;
      if (latestSolve) pending = latestSolve = { ...latestSolve, revision: ++revision };
      else pending = null;
      worker = new Worker(new URL('./light-field-worker.ts', import.meta.url), { type: 'module' });
      initialize(nextHouses);
    },
    dispose,
    get stats() {
      return { busy: active !== null, queued: pending !== null, disposed, failed, requestedRevision: revision, publishedRevision: published,
        completedJobs: completed, discardedJobs: discarded, occupancyBuilds, lastWorkerMs, estimatedPeakBytes, cells: config.cells, error: errorMessage };
    },
  };
}
