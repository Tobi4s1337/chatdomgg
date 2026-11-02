/* global Worker:readonly */
import { sameMeshStamp } from './mesh';
import { assertExactOpaqueShadowChunks } from './shadow-mesh';
import { HALO_VOLUME } from './coordinates';
import type { AssetChunkMesh, VoxelJob, VoxelJobResult, VoxelWorkerResponse } from './protocol';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
export type VoxelJobInput = WithoutId<VoxelJob>;

/** Small adapter permits browser workers and deterministic scheduler tests. */
export interface VoxelWorkerAdapter {
  onmessage: ((event: MessageEvent<VoxelWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  postMessage(job: VoxelJob): void;
  postMessage(job: VoxelJob, transfer: ArrayBuffer[]): void;
  terminate(): void;
}

export interface VoxelWorkerPoolOptions {
  readonly size?: number;
  /** Waiting jobs, in addition to the bounded active worker count. */
  readonly maxQueue?: number;
  readonly createWorker?: () => VoxelWorkerAdapter;
}

export interface VoxelSubmitOptions {
  /** Newer accepted work with this key terminates an active older worker, or replaces queued work. */
  readonly key?: string;
  /** Check external state, such as neighbours changed while this worker was running. */
  readonly isCurrent?: (result: VoxelJobResult) => boolean;
}

interface PendingJob {
  readonly job: VoxelJob;
  readonly options: VoxelSubmitOptions;
  readonly resolve: (result: VoxelJobResult | null) => void;
  readonly reject: (reason: Error) => void;
  settled: boolean;
}

interface WorkerSlot {
  worker: VoxelWorkerAdapter;
  active: PendingJob | null;
}

function defaultWorkerFactory(): VoxelWorkerAdapter {
  // Keep the direct constructor: Vite discovers and bundles this module-worker URL syntactically.
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Voxel worker failed.');
}

function inputBuffers(job: VoxelJobInput): ArrayBuffer[] {
  const views = job.kind === 'mesh' ? [job.request.halo, job.request.sky]
    : job.kind === 'light' ? [job.request.occupancy] : job.kind === 'asset' ? [job.asset.voxels] : [];
  // structuredClone preserves shared memory; this pipeline deliberately owns private snapshots.
  if (views.some(view => !(view.buffer instanceof ArrayBuffer))) throw new Error('Shared voxel input buffers are unsupported.');
  return [...new Set(views.map(view => view.buffer as ArrayBuffer))];
}

/** Alternate depth geometry owns its buffers and uses the same packed build lattice as colour. */
function matchesShadowChunks(shadows: readonly AssetChunkMesh[], colours: readonly AssetChunkMesh[],
  materials: Extract<VoxelJob, { kind: 'blueprint' }>['materials']): boolean {
  if (!Array.isArray(shadows) || shadows.length !== colours.length) return false;
  const buffers = new Set(colours.flatMap(({ mesh }) => [mesh.vertices.buffer, mesh.indices.buffer]));
  for (const chunk of shadows) {
    const mesh: AssetChunkMesh['mesh'] = chunk.mesh;
    if (!(mesh.vertices instanceof Uint32Array) || !(mesh.indices instanceof Uint32Array)) return false;
    for (const view of [mesh.vertices, mesh.indices]) {
      if (!(view.buffer instanceof ArrayBuffer) || buffers.has(view.buffer)) return false;
      buffers.add(view.buffer);
    }
  }
  // The worker may choose a different rectangle tiling, but every original opaque oriented
  // square must remain exactly once. Shared bounded masks also validate indices and winding.
  assertExactOpaqueShadowChunks(colours, shadows, materials);
  return true;
}

/** Metadata checks supplement job IDs: old geometry cannot install with a newer request's ID. */
function matchesJob(result: VoxelJobResult, job: VoxelJob): boolean {
  try {
    if ('shadowChunks' in result && !(job.kind === 'blueprint' && job.shadow === 'opaque-faces-v1')) return false;
    if (job.kind === 'mesh') {
      return result.kind === 'mesh' && sameMeshStamp(result.mesh.stamp, job.request.stamp)
        && result.mesh.vertices instanceof Uint32Array && result.mesh.indices instanceof Uint32Array;
    }
    if (job.kind === 'light') {
      return result.kind === 'light' && result.volume.revision === job.request.revision
        && result.volume.cellSize === job.request.cellSize
        && result.volume.origin.length === 3 && result.volume.size.length === 3
        && result.volume.origin.every((n, axis) => n === job.request.origin[axis])
        && result.volume.size.every((n, axis) => n === job.request.size[axis])
        && result.volume.light instanceof Uint8Array
        && result.volume.light.length === job.request.size[0] * job.request.size[1] * job.request.size[2];
    }
    if (job.kind === 'prepare') {
      if (result.kind !== 'prepared' || result.assetId !== job.blueprint.id || result.revision !== job.revision) return false;
      const counts = job.blueprint.size.map(n => Math.ceil(n / 32));
      const seen = new Set<string>();
      const materials = JSON.stringify(job.materials);
      return result.chunks.every((chunk) => {
        const coordinate = chunk.coordinate;
        if (coordinate.length !== 3 || coordinate.some((n, axis) => !Number.isSafeInteger(n) || n < 0 || n >= counts[axis]!)) return false;
        const key = `${job.blueprint.id}:${coordinate.join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const dependencies = [{ key: `${job.blueprint.id}:full-sky`, revision: job.revision }];
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const neighbour = [coordinate[0] + dx, coordinate[1] + dy, coordinate[2] + dz];
          dependencies.push({ key: `${job.blueprint.id}:${neighbour.join(',')}`,
            revision: neighbour.every((n, axis) => n >= 0 && n < counts[axis]!) ? job.revision : 0 });
        }
        return sameMeshStamp(chunk.stamp, { key, revision: job.revision, materialRevision: job.materialRevision, dependencies })
          && chunk.halo instanceof Uint16Array && chunk.halo.length === HALO_VOLUME
          && chunk.sky instanceof Uint8Array && chunk.sky.length === HALO_VOLUME
          && JSON.stringify(chunk.materials) === materials;
      });
    }
    const assetId = job.kind === 'asset' ? job.asset.id : job.blueprint.id;
    const revision = job.kind === 'asset' ? job.asset.revision : job.revision;
    if (result.kind !== 'asset' || result.assetId !== assetId || result.revision !== revision) return false;
    const factor = job.kind === 'blueprint' ? job.lodFactor ?? 1 : 1;
    const meshId = factor === 1 ? assetId : `${assetId}:renderlod:${factor}`;
    const size = job.kind === 'asset' ? job.asset.size : job.blueprint.size;
    const counts = size.map(n => Math.ceil(n / (factor * 32)));
    const seen = new Set<string>();
    const matchesColour = result.chunks.every(({ coordinate, mesh }) => {
      if (coordinate.length !== 3 || coordinate.some((n, axis) => !Number.isSafeInteger(n) || n < 0 || n >= counts[axis]!)) return false;
      const key = `${meshId}:${coordinate.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      const dependencies = [{ key: `${meshId}:full-sky`, revision }];
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const neighbour = [coordinate[0] + dx, coordinate[1] + dy, coordinate[2] + dz];
        dependencies.push({ key: `${meshId}:${neighbour.join(',')}`,
          revision: neighbour.every((n, axis) => n >= 0 && n < counts[axis]!) ? revision : 0 });
      }
      return sameMeshStamp(mesh.stamp, { key, revision, materialRevision: job.materialRevision, dependencies })
        && mesh.vertices instanceof Uint32Array && mesh.indices instanceof Uint32Array;
    });
    if (!matchesColour) return false;
    if (job.kind !== 'blueprint' || job.shadow === undefined) return result.shadowChunks === undefined;
    return job.shadow === 'opaque-faces-v1' && factor === 1 && result.shadowChunks !== undefined
      && matchesShadowChunks(result.shadowChunks, result.chunks, job.materials);
  } catch {
    return false;
  }
}

/**
 * Bounded module-worker scheduler. An owned snapshot is captured at submission, before any wait;
 * its buffers transfer at dispatch while the caller retains authoritative occupancy.
 */
export class VoxelWorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: PendingJob[] = [];
  private readonly latest = new Map<string, PendingJob>();
  private readonly createWorker: () => VoxelWorkerAdapter;
  private readonly maxQueue: number;
  private nextId = 1;
  private disposed = false;
  private draining = false;

  constructor(options: VoxelWorkerPoolOptions = {}) {
    const size = options.size ?? 2;
    this.maxQueue = options.maxQueue ?? 128;
    if (!Number.isInteger(size) || size < 1 || size > 4) throw new Error('Voxel worker count must be between one and four.');
    if (!Number.isInteger(this.maxQueue) || this.maxQueue < 0 || this.maxQueue > 4096) {
      throw new Error('Voxel waiting queue must hold between zero and 4096 jobs.');
    }
    this.createWorker = options.createWorker ?? defaultWorkerFactory;
    try {
      for (let index = 0; index < size; index++) {
        const slot: WorkerSlot = { worker: this.createWorker(), active: null };
        this.slots.push(slot);
        this.bind(slot);
      }
    } catch (error) {
      this.dispose(asError(error));
      throw error;
    }
  }

  get stats(): { readonly size: number; readonly busy: number; readonly queued: number; readonly disposed: boolean } {
    return { size: this.slots.length, busy: this.slots.filter(slot => slot.active !== null).length,
      queued: this.queue.length, disposed: this.disposed };
  }

  submit(input: VoxelJobInput, options: VoxelSubmitOptions = {}): Promise<VoxelJobResult | null> {
    if (this.disposed) return Promise.reject(new Error('Voxel worker pool is disposed.'));
    if (!Number.isSafeInteger(this.nextId)) return Promise.reject(new Error('Voxel worker job IDs are exhausted.'));
    const submissionOptions = { ...options };
    const previous = submissionOptions.key === undefined ? undefined : this.latest.get(submissionOptions.key);
    const previousQueued = previous === undefined ? -1 : this.queue.indexOf(previous);
    const previousActive = previous === undefined ? undefined : this.slots.find(slot => slot.active === previous);
    const waiting = this.queue.length - Number(previousQueued !== -1);
    if (previousActive === undefined && this.slots.every(slot => slot.active !== null) && waiting >= this.maxQueue) {
      return Promise.reject(new Error('Voxel worker queue is full.'));
    }
    let snapshot: VoxelJobInput;
    try {
      snapshot = globalThis.structuredClone(input);
      inputBuffers(snapshot);
    } catch (error) {
      return Promise.reject(asError(error));
    }
    const job = { ...snapshot, id: this.nextId++ } as VoxelJob;
    const promise = new Promise<VoxelJobResult | null>((resolve, reject) => {
      const pending: PendingJob = { job, options: submissionOptions, resolve, reject, settled: false };
      if (previous !== undefined) {
        if (previousQueued !== -1) this.queue.splice(previousQueued, 1);
        this.finish(previous, null);
      }
      if (submissionOptions.key !== undefined) this.latest.set(submissionOptions.key, pending);
      this.queue.push(pending);
      // A synchronous CPU solve cannot observe a cancellation message. Termination is the
      // cancellation boundary, and each worker owns only this one active job's cloned input.
      if (previousActive !== undefined) this.restartWorker(previousActive);
    });
    this.drain();
    return promise;
  }

  /** Every accepted promise settles even if a worker or replacement factory fails. */
  dispose(reason = new Error('Voxel worker pool was disposed.')): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.queue.splice(0)) this.fail(pending, reason);
    for (const slot of this.slots) {
      this.detach(slot.worker);
      if (slot.active !== null) this.fail(slot.active, reason);
      slot.active = null;
    }
    this.latest.clear();
  }

  private bind(slot: WorkerSlot): void {
    const worker = slot.worker;
    worker.onmessage = (event) => {
      if (this.disposed || slot.worker !== worker) return;
      const pending = slot.active;
      const response = event.data;
      // A delayed response for an already retired ID cannot consume another job's slot.
      if (pending === null || response === null || typeof response !== 'object' || response.id !== pending.job.id) return;
      slot.active = null;
      if (response.kind === 'error') {
        this.fail(pending, new Error(typeof response.message === 'string' ? response.message : 'Voxel worker failed.'));
      } else if (!matchesJob(response, pending.job)) {
        this.fail(pending, new Error('Voxel worker returned incompatible job metadata.'));
      } else if (!pending.settled) {
        try {
          this.finish(pending, pending.options.isCurrent?.(response) === false ? null : response);
        } catch (error) {
          this.fail(pending, asError(error));
        }
      }
      this.drain();
    };
    worker.onerror = (event) => {
      if (this.disposed || slot.worker !== worker) return;
      event.preventDefault?.();
      this.restartWorker(slot, new Error(event.message || 'Voxel worker failed.'));
    };
    worker.onmessageerror = () => {
      if (this.disposed || slot.worker !== worker) return;
      this.restartWorker(slot, new Error('Voxel worker response could not be decoded.'));
    };
  }

  private detach(worker: VoxelWorkerAdapter): void {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }

  private restartWorker(slot: WorkerSlot, reason?: Error): void {
    this.detach(slot.worker);
    if (slot.active !== null) {
      if (reason === undefined) this.finish(slot.active, null);
      else this.fail(slot.active, reason);
    }
    slot.active = null;
    try {
      slot.worker = this.createWorker();
      this.bind(slot);
    } catch (error) {
      this.dispose(asError(error));
      return;
    }
    this.drain();
  }

  private finish(pending: PendingJob, result: VoxelJobResult | null): void {
    if (pending.settled) return;
    pending.settled = true;
    this.forget(pending);
    pending.resolve(result);
  }

  private fail(pending: PendingJob, reason: Error): void {
    if (pending.settled) return;
    pending.settled = true;
    this.forget(pending);
    pending.reject(reason);
  }

  private forget(pending: PendingJob): void {
    const key = pending.options.key;
    if (key !== undefined && this.latest.get(key) === pending) this.latest.delete(key);
  }

  private drain(): void {
    if (this.draining || this.disposed) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const slot = this.slots.find(candidate => candidate.active === null);
        if (slot === undefined) break;
        slot.active = this.queue.shift()!;
        try {
          slot.worker.postMessage(slot.active.job, inputBuffers(slot.active.job));
        } catch (error) {
          this.restartWorker(slot, asError(error));
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
