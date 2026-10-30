import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type MeshStamp } from '@chatdom/shared';
import { HALO_VOLUME } from './coordinates';
import { executeVoxelJob, type VoxelJob, type VoxelWorkerResponse } from './protocol';
import { VoxelWorkerPool, type VoxelJobInput, type VoxelWorkerAdapter } from './worker-pool';

class ControlledWorker implements VoxelWorkerAdapter {
  onmessage: VoxelWorkerAdapter['onmessage'] = null;
  onerror: VoxelWorkerAdapter['onerror'] = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly jobs: VoxelJob[] = [];
  readonly transfers: ArrayBuffer[][] = [];
  terminated = false;
  throwOnPost: Error | null = null;

  postMessage(job: VoxelJob, transfer: ArrayBuffer[] = []): void {
    if (this.throwOnPost !== null) throw this.throwOnPost;
    this.transfers.push(transfer);
    this.jobs.push(globalThis.structuredClone(job, { transfer }));
  }

  terminate(): void { this.terminated = true; }

  complete(index = this.jobs.length - 1): void {
    this.respond(executeVoxelJob(this.jobs[index]!));
  }

  respond(response: VoxelWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<VoxelWorkerResponse>);
  }

  crash(message = 'Worker crashed'): void {
    this.onerror?.({ message, preventDefault() {} } as ErrorEvent);
  }
}

function setup(size = 2, maxQueue = 128) {
  const workers: ControlledWorker[] = [];
  const pool = new VoxelWorkerPool({ size, maxQueue, createWorker: () => {
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  } });
  return { pool, workers };
}

function lightJob(revision = 1): VoxelJobInput {
  return { kind: 'light', request: { revision, origin: [0, 0, 0], size: [2, 2, 2], cellSize: 0.5,
    occupancy: new Uint8Array(8), emitters: [{ position: [0, 0, 0], level: 15 }] } };
}

function meshJob(stamp: MeshStamp): VoxelJobInput {
  return { kind: 'mesh', request: { stamp, halo: new Uint16Array(HALO_VOLUME), sky: new Uint8Array(HALO_VOLUME), materials: [] } };
}

function prepareJob(): Extract<VoxelJobInput, { kind: 'prepare' }> {
  return { kind: 'prepare', revision: 7, materialRevision: 3,
    blueprint: VoxelBlueprintSchema.parse({ version: 1, id: 'beam', styleId: 'stone', kind: 'prop', lattice: 'build',
      size: [34, 1, 1], boxes: [{ from: [0, 0, 0], to: [34, 1, 1], material: 1 }], windows: [] }),
    materials: [{ id: 1, name: 'stone', solid: true, occludesFaces: true, occludesAo: true,
      blocksLight: true, colour: '#666666', surface: 'stone' }] };
}

describe('voxel module-worker scheduler', () => {
  it('limits concurrency, drains FIFO, and allocates unique increasing IDs', async () => {
    const { pool, workers } = setup(2);
    const first = pool.submit(lightJob(1));
    const second = pool.submit(lightJob(2));
    const third = pool.submit(lightJob(3));
    expect(pool.stats).toEqual({ size: 2, busy: 2, queued: 1, disposed: false });
    expect(workers.map(worker => worker.jobs.length)).toEqual([1, 1]);
    workers[1]!.complete();
    expect(workers[1]!.jobs.map(job => job.id)).toEqual([2, 3]);
    workers[0]!.complete();
    workers[1]!.complete();
    expect((await Promise.all([first, second, third])).map(result => result!.id)).toEqual([1, 2, 3]);
    expect(pool.stats.busy).toBe(0);
    pool.dispose();
  });

  it('transfers owned snapshots while keeping authoritative caller buffers attached', async () => {
    const { pool, workers } = setup(1);
    const input = lightJob();
    if (input.kind !== 'light') throw new Error('Expected light request');
    const result = pool.submit(input);
    expect(input.request.occupancy.byteLength).toBe(8);
    expect(workers[0]!.transfers[0]).toHaveLength(1);
    expect(workers[0]!.transfers[0]![0]).not.toBe(input.request.occupancy.buffer);
    expect(workers[0]!.transfers[0]![0]!.byteLength).toBe(0);
    input.request.occupancy[0] = 1;
    expect((workers[0]!.jobs[0] as Extract<VoxelJob, { kind: 'light' }>).request.occupancy[0]).toBe(0);
    workers[0]!.complete();
    expect(await result).not.toBeNull();
    pool.dispose();
  });

  it('deduplicates aliased mesh buffers before transferring a private snapshot', async () => {
    const { pool, workers } = setup(1);
    const original = new ArrayBuffer(HALO_VOLUME * 2);
    const pending = pool.submit({ kind: 'mesh', request: {
      stamp: { key: 'terrain:0,0,0', revision: 1, materialRevision: 1, dependencies: [] },
      halo: new Uint16Array(original), sky: new Uint8Array(original, 0, HALO_VOLUME), materials: [] } });
    expect(original.byteLength).toBe(HALO_VOLUME * 2);
    expect(workers[0]!.transfers[0]).toHaveLength(1);
    expect(workers[0]!.transfers[0]![0]).not.toBe(original);
    expect(workers[0]!.transfers[0]![0]!.byteLength).toBe(0);
    const dispatched = workers[0]!.jobs[0]!;
    if (dispatched.kind !== 'mesh') throw new Error('Expected mesh input');
    expect(dispatched.request.halo.buffer).toBe(dispatched.request.sky.buffer);
    workers[0]!.complete();
    expect((await pending)?.kind).toBe('mesh');
    pool.dispose();
  });

  it('transfers raw asset voxels and accepts their response after its pool snapshot detaches', async () => {
    const { pool, workers } = setup(1);
    const voxels = new Uint16Array(1);
    const pending = pool.submit({ kind: 'asset', asset: { id: 'empty', revision: 7,
      lattice: 'build', size: [1, 1, 1], voxels }, materials: [], materialRevision: 1 });
    expect(voxels.byteLength).toBe(2);
    expect(workers[0]!.transfers[0]).toHaveLength(1);
    expect(workers[0]!.transfers[0]![0]).not.toBe(voxels.buffer);
    expect(workers[0]!.transfers[0]![0]!.byteLength).toBe(0);
    workers[0]!.complete();
    expect(await pending).toMatchObject({ kind: 'asset', assetId: 'empty', revision: 7 });
    pool.dispose();
  });

  it('snapshots queued buffers and metadata before callers can mutate them', async () => {
    const { pool, workers } = setup(1);
    const active = pool.submit(lightJob(1));
    const request = { revision: 2, origin: [0, 0, 0] as [number, number, number],
      size: [2, 2, 2] as [number, number, number], cellSize: 0.5,
      occupancy: new Uint8Array(8), emitters: [{ position: [0, 0, 0] as [number, number, number], level: 15 }] };
    const queued = pool.submit({ kind: 'light', request });
    request.revision = 99;
    request.origin[0] = 99;
    request.occupancy[0] = 1;
    request.emitters[0]!.level = 0;
    workers[0]!.complete();
    const dispatched = workers[0]!.jobs[1]!;
    if (dispatched.kind !== 'light') throw new Error('Expected light request');
    expect(dispatched.request).toMatchObject({ revision: 2, origin: [0, 0, 0], emitters: [{ level: 15 }] });
    expect(dispatched.request.occupancy[0]).toBe(0);
    workers[0]!.complete();
    const result = await queued;
    if (result?.kind !== 'light') throw new Error('Expected light result');
    expect(result.volume.revision).toBe(2);
    expect(result.volume.light[0]).toBe(15);
    await active;
    pool.dispose();
  });

  it('snapshots active mesh stamps and dependency metadata used to validate responses', async () => {
    const { pool, workers } = setup(1);
    const dependencies = [{ key: 'terrain:1,0,0', revision: 2 }];
    const stamp = { key: 'terrain:0,0,0', revision: 1, materialRevision: 1, dependencies };
    const input = meshJob(stamp);
    const pending = pool.submit(input);
    stamp.revision = 99;
    dependencies[0]!.revision = 99;
    dependencies.push({ key: 'terrain:-1,0,0', revision: 99 });
    workers[0]!.complete();
    const result = await pending;
    if (result?.kind !== 'mesh') throw new Error('Expected mesh result');
    expect(result.mesh.stamp).toEqual({ key: 'terrain:0,0,0', revision: 1, materialRevision: 1,
      dependencies: [{ key: 'terrain:1,0,0', revision: 2 }] });
    pool.dispose();
  });

  it('rejects clone failures without throwing synchronously or cancelling valid keyed work', async () => {
    const { pool, workers } = setup(1);
    const active = pool.submit(lightJob(), { key: 'plot' });
    const invalid = { ...lightJob(2), uncloneable: () => 0 };
    let rejected: Promise<unknown> | undefined;
    expect(() => { rejected = pool.submit(invalid, { key: 'plot' }); }).not.toThrow();
    await expect(rejected).rejects.toThrow();
    expect(workers[0]!.terminated).toBe(false);
    expect(pool.stats.busy).toBe(1);
    workers[0]!.complete();
    expect(await active).not.toBeNull();
    pool.dispose();
  });

  it('rejects shared memory rather than calling it an owned input snapshot', async () => {
    const { pool } = setup(1);
    const input = lightJob();
    if (input.kind !== 'light') throw new Error('Expected light input');
    await expect(pool.submit({ ...input, request: { ...input.request,
      occupancy: new Uint8Array(new SharedArrayBuffer(8)) } })).rejects.toThrow('Shared voxel input buffers');
    expect(pool.stats.busy).toBe(0);
    pool.dispose();
  });

  it('accepts prepared asset chunks for individually scheduled meshing', async () => {
    const { pool, workers } = setup(1);
    const pending = pool.submit(prepareJob());
    expect(workers[0]!.transfers[0]).toEqual([]);
    workers[0]!.complete();
    const result = await pending;
    if (result?.kind !== 'prepared') throw new Error('Expected prepared chunks');
    expect(result.assetId).toBe('beam');
    expect(result.chunks.map(chunk => chunk.coordinate)).toEqual([[0, 0, 0], [1, 0, 0]]);
    pool.dispose();
  });

  it.each(['assetId', 'revision', 'stamp', 'materialRevision', 'dependency', 'materials', 'halo', 'sky', 'coordinate', 'duplicate'] as const)(
    'rejects incompatible prepared %s metadata', async (field) => {
      const { pool, workers } = setup(1);
      const pending = pool.submit(prepareJob());
      const check = expect(pending).rejects.toThrow('incompatible job metadata');
      const response = executeVoxelJob(workers[0]!.jobs[0]!);
      if (response.kind !== 'prepared') throw new Error('Expected prepared response');
      const first = response.chunks[0]!;
      const altered = field === 'stamp' ? { ...first, stamp: { ...first.stamp, key: 'other:0,0,0' } }
        : field === 'materialRevision' ? { ...first, stamp: { ...first.stamp, materialRevision: 99 } }
          : field === 'dependency' ? { ...first, stamp: { ...first.stamp, dependencies: [] } }
            : field === 'materials' ? { ...first, materials: [] }
              : field === 'halo' ? { ...first, halo: new Uint16Array(32 ** 3) }
                : field === 'sky' ? { ...first, sky: new Uint8Array(32 ** 3) }
                  : field === 'coordinate' ? { ...first, coordinate: [2, 0, 0] as const } : first;
      workers[0]!.respond({ ...response,
        assetId: field === 'assetId' ? 'other' : response.assetId,
        revision: field === 'revision' ? 99 : response.revision,
        chunks: field === 'duplicate' ? [first, first] : [altered, ...response.chunks.slice(1)] });
      await check;
      pool.dispose();
    });

  it('terminates an older in-flight keyed solve and ignores its late callback', async () => {
    const { pool, workers } = setup(2);
    const old = pool.submit(lightJob(1), { key: 'camera-light' });
    const retiredCallback = workers[0]!.onmessage;
    const retiredResult = executeVoxelJob(workers[0]!.jobs[0]!);
    const current = pool.submit(lightJob(2), { key: 'camera-light' });
    expect(await old).toBeNull();
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(3);
    workers[2]!.complete();
    expect((await current)?.kind).toBe('light');
    retiredCallback?.({ data: retiredResult } as MessageEvent<VoxelWorkerResponse>);
    expect(pool.stats).toEqual({ size: 2, busy: 0, queued: 0, disposed: false });
    pool.dispose();
  });

  it('coalesces queued keyed jobs without consuming additional queue capacity', async () => {
    const { pool, workers } = setup(1, 1);
    const active = pool.submit(lightJob(1));
    const obsolete = pool.submit(lightJob(2), { key: 'plot' });
    const current = pool.submit(lightJob(3), { key: 'plot' });
    expect(await obsolete).toBeNull();
    expect(pool.stats.queued).toBe(1);
    workers[0]!.complete();
    expect(workers[0]!.jobs.map(job => job.kind === 'light' ? job.request.revision : -1)).toEqual([1, 3]);
    workers[0]!.complete();
    await Promise.all([active, current]);
    pool.dispose();
  });

  it('replaces active keyed work even with a zero-length waiting queue', async () => {
    const { pool, workers } = setup(1, 0);
    const active = pool.submit(lightJob(1), { key: 'plot' });
    const current = pool.submit(lightJob(2), { key: 'plot' });
    expect(await active).toBeNull();
    expect(workers[0]!.terminated).toBe(true);
    workers[1]!.complete();
    expect(await current).not.toBeNull();
    pool.dispose();
  });

  it('rejects unrelated overload without superseding valid active work', async () => {
    const { pool, workers } = setup(1, 0);
    const active = pool.submit(lightJob(1), { key: 'plot' });
    await expect(pool.submit(lightJob(2), { key: 'other' })).rejects.toThrow('queue is full');
    workers[0]!.complete();
    expect(await active).not.toBeNull();
    pool.dispose();
  });

  it('preserves other active and queued jobs when an active key is cancelled', async () => {
    const { pool, workers } = setup(2, 1);
    const obsolete = pool.submit(lightJob(1), { key: 'plot' });
    const otherActive = pool.submit(lightJob(2), { key: 'other' });
    const queued = pool.submit(lightJob(3), { key: 'queued' });
    const current = pool.submit(lightJob(4), { key: 'plot' });
    expect(await obsolete).toBeNull();
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.terminated).toBe(false);
    expect(workers[2]!.jobs.map(job => job.id)).toEqual([3]);
    expect(pool.stats.queued).toBe(1);
    workers[2]!.complete();
    expect(workers[2]!.jobs.map(job => job.id)).toEqual([3, 4]);
    workers[2]!.complete();
    workers[1]!.complete();
    const results = await Promise.all([otherActive, queued, current]);
    expect(results.map(result => result!.id)).toEqual([2, 3, 4]);
    pool.dispose();
  });

  it('discards a result when neighbours have changed after dispatch', async () => {
    const { pool, workers } = setup(1);
    const pending = pool.submit(lightJob(), { isCurrent: () => false });
    workers[0]!.complete();
    expect(await pending).toBeNull();
    pool.dispose();
  });

  it('rejects a changed chunk dependency even with the right job ID', async () => {
    const { pool, workers } = setup(1);
    const stamp: MeshStamp = { key: 'terrain:0,0,0', revision: 1, materialRevision: 1,
      dependencies: [{ key: 'terrain:1,0,0', revision: 2 }] };
    const pending = pool.submit(meshJob(stamp));
    const check = expect(pending).rejects.toThrow('incompatible job metadata');
    const response = executeVoxelJob(workers[0]!.jobs[0]!);
    if (response.kind !== 'mesh') throw new Error('Expected mesh result');
    workers[0]!.respond({ ...response, mesh: { ...response.mesh, stamp: { ...stamp,
      dependencies: [{ key: 'terrain:1,0,0', revision: 1 }] } } });
    await check;
    pool.dispose();
  });

  it('ignores a late ID without freeing the active slot', async () => {
    const { pool, workers } = setup(1);
    const pending = pool.submit(lightJob());
    const response = executeVoxelJob(workers[0]!.jobs[0]!);
    workers[0]!.respond({ ...response, id: 999 });
    expect(pool.stats.busy).toBe(1);
    workers[0]!.respond(response);
    expect(await pending).not.toBeNull();
    pool.dispose();
  });

  it('rejects kind mismatches and continues draining queued work', async () => {
    const { pool, workers } = setup(1);
    const wrong = pool.submit(lightJob());
    const check = expect(wrong).rejects.toThrow('incompatible job metadata');
    const next = pool.submit(lightJob(2));
    workers[0]!.respond({ id: workers[0]!.jobs[0]!.id, kind: 'asset', assetId: 'wrong', revision: 1, chunks: [] });
    await check;
    workers[0]!.complete();
    expect(await next).not.toBeNull();
    pool.dispose();
  });

  it('rejects light bounds from an old camera volume despite a reused revision', async () => {
    const { pool, workers } = setup(1);
    const pending = pool.submit(lightJob());
    const check = expect(pending).rejects.toThrow('incompatible job metadata');
    const response = executeVoxelJob(workers[0]!.jobs[0]!);
    if (response.kind !== 'light') throw new Error('Expected light result');
    workers[0]!.respond({ ...response, volume: { ...response.volume, origin: [1, 0, 0] } });
    await check;
    pool.dispose();
  });

  it('rejects calculation errors without losing the queued successor', async () => {
    const { pool, workers } = setup(1);
    const failed = pool.submit(lightJob());
    const check = expect(failed).rejects.toThrow('Invalid source');
    const next = pool.submit(lightJob(2));
    workers[0]!.respond({ id: workers[0]!.jobs[0]!.id, kind: 'error', message: 'Invalid source' });
    await check;
    workers[0]!.complete();
    expect(await next).not.toBeNull();
    pool.dispose();
  });

  it('replaces a crashed worker and runs queued work on the replacement', async () => {
    const { pool, workers } = setup(1);
    const failed = pool.submit(lightJob());
    const check = expect(failed).rejects.toThrow('Worker crashed');
    const next = pool.submit(lightJob(2));
    const retiredCallback = workers[0]!.onmessage;
    const retiredResult = executeVoxelJob(workers[0]!.jobs[0]!);
    workers[0]!.crash();
    await check;
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    retiredCallback?.({ data: retiredResult } as MessageEvent<VoxelWorkerResponse>);
    expect(pool.stats.busy).toBe(1);
    workers[1]!.complete();
    expect(await next).not.toBeNull();
    pool.dispose();
  });

  it('settles all accepted promises if replacement construction fails', async () => {
    const worker = new ControlledWorker();
    let constructions = 0;
    const pool = new VoxelWorkerPool({ size: 1, createWorker: () => {
      if (constructions++ > 0) throw new Error('Worker construction failed');
      return worker;
    } });
    const active = pool.submit(lightJob());
    const queued = pool.submit(lightJob(2));
    const activeCheck = expect(active).rejects.toThrow('Worker crashed');
    const queuedCheck = expect(queued).rejects.toThrow('Worker construction failed');
    worker.crash();
    await Promise.all([activeCheck, queuedCheck]);
    expect(pool.stats.disposed).toBe(true);
    await expect(pool.submit(lightJob())).rejects.toThrow('disposed');
  });

  it('settles new and queued jobs when cancellation replacement construction fails', async () => {
    const worker = new ControlledWorker();
    let constructions = 0;
    const pool = new VoxelWorkerPool({ size: 1, createWorker: () => {
      if (constructions++ > 0) throw new Error('Replacement unavailable');
      return worker;
    } });
    const obsolete = pool.submit(lightJob(1), { key: 'plot' });
    const queued = pool.submit(lightJob(2), { key: 'other' });
    const queuedCheck = expect(queued).rejects.toThrow('Replacement unavailable');
    const current = pool.submit(lightJob(3), { key: 'plot' });
    const currentCheck = expect(current).rejects.toThrow('Replacement unavailable');
    expect(await obsolete).toBeNull();
    await Promise.all([queuedCheck, currentCheck]);
    expect(pool.stats).toEqual({ size: 1, busy: 0, queued: 0, disposed: true });
  });

  it('recovers from a postMessage failure without abandoning the next accepted job', async () => {
    const { pool, workers } = setup(1);
    workers[0]!.throwOnPost = new Error('Could not clone request');
    const failed = pool.submit(lightJob());
    await expect(failed).rejects.toThrow('Could not clone request');
    expect(workers[0]!.terminated).toBe(true);
    const next = pool.submit(lightJob(2));
    workers[1]!.complete();
    expect(await next).not.toBeNull();
    pool.dispose();
  });

  it('settles a decoding failure and drains the queue through a new worker', async () => {
    const { pool, workers } = setup(1);
    const failed = pool.submit(lightJob());
    const check = expect(failed).rejects.toThrow('could not be decoded');
    const next = pool.submit(lightJob(2));
    workers[0]!.onmessageerror?.({} as MessageEvent);
    await check;
    workers[1]!.complete();
    expect(await next).not.toBeNull();
    pool.dispose();
  });

  it('cleans up workers when initial construction fails partway through', () => {
    const worker = new ControlledWorker();
    let constructions = 0;
    expect(() => new VoxelWorkerPool({ createWorker: () => {
      if (constructions++ > 0) throw new Error('Unavailable');
      return worker;
    } })).toThrow('Unavailable');
    expect(worker.terminated).toBe(true);
  });

  it('rejects active and queued jobs on disposal and terminates every worker', async () => {
    const { pool, workers } = setup(2);
    const promises = [pool.submit(lightJob(1)), pool.submit(lightJob(2)), pool.submit(lightJob(3))];
    const checks = promises.map(promise => expect(promise).rejects.toThrow('disposed'));
    pool.dispose();
    pool.dispose();
    await Promise.all(checks);
    expect(workers.every(worker => worker.terminated && worker.onmessage === null && worker.onerror === null)).toBe(true);
    expect(pool.stats).toEqual({ size: 2, busy: 0, queued: 0, disposed: true });
  });

  it('survives a throwing external freshness check and continues the queue', async () => {
    const { pool, workers } = setup(1);
    const failed = pool.submit(lightJob(), { isCurrent: () => { throw new Error('Consumer check failed'); } });
    const check = expect(failed).rejects.toThrow('Consumer check failed');
    const next = pool.submit(lightJob(2));
    workers[0]!.complete();
    await check;
    workers[0]!.complete();
    expect(await next).not.toBeNull();
    pool.dispose();
  });

  it('rejects invalid pool bounds', () => {
    for (const size of [0, 5, 1.5]) expect(() => new VoxelWorkerPool({ size })).toThrow('worker count');
    for (const maxQueue of [-1, 4097, 0.5]) expect(() => new VoxelWorkerPool({ maxQueue })).toThrow('waiting queue');
  });
});
