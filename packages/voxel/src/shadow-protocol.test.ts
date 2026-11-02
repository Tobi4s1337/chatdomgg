import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelMaterial } from '@chatdom/shared';
import { executeVoxelJob, resultTransferables, type VoxelJob, type VoxelWorkerResponse } from './protocol';
import { VoxelWorkerPool, type VoxelWorkerAdapter } from './worker-pool';

const material: VoxelMaterial = { id: 1, name: 'stone', solid: true, occludesFaces: true, occludesAo: true,
  blocksLight: true, colour: '#777777', surface: 'stone' };
const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: 'shadow-worker', styleId: 'stone', kind: 'prop', lattice: 'build',
  size: [34, 4, 2], boxes: [{ from: [0, 0, 0], to: [34, 4, 2], material: 1 },
    { from: [2, 0, 0], to: [4, 3, 2], material: 0 }], windows: [] });
const job = { id: 10, kind: 'blueprint', blueprint, revision: 4, materials: [material], materialRevision: 7 } as const;

class ControlledWorker implements VoxelWorkerAdapter {
  onmessage: VoxelWorkerAdapter['onmessage'] = null;
  onerror: VoxelWorkerAdapter['onerror'] = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  jobs: VoxelJob[] = [];
  terminated = false;
  postMessage(input: VoxelJob): void { this.jobs.push(structuredClone(input)); }
  terminate(): void { this.terminated = true; }
  respond(response: VoxelWorkerResponse): void { this.onmessage?.({ data: response } as MessageEvent<VoxelWorkerResponse>); }
}
function setup() {
  const workers: ControlledWorker[] = [];
  const pool = new VoxelWorkerPool({ size: 1, createWorker: () => { const worker = new ControlledWorker(); workers.push(worker); return worker; } });
  return { pool, workers };
}

describe('shadow worker contract', () => {
  it('emits independent shadow chunks only for requested full-detail blueprints and transfers their ownership', () => {
    const plain = executeVoxelJob(job), requested = executeVoxelJob({ ...job, shadow: 'opaque-faces-v1' });
    if (plain.kind !== 'asset' || requested.kind !== 'asset') throw new Error('Expected asset results');
    expect(plain.shadowChunks).toBeUndefined();
    const explicitFull = executeVoxelJob({ ...job, lodFactor: 1, shadow: 'opaque-faces-v1' });
    expect(explicitFull).toEqual(requested);
    expect(requested.chunks).toEqual(plain.chunks);
    expect(requested.shadowChunks).toHaveLength(requested.chunks.length);
    const transfers = resultTransferables(requested);
    expect(new Set(transfers).size).toBe(requested.chunks.length * 4);
    for (const chunk of requested.shadowChunks!) {
      expect(chunk.mesh.vertices.byteLength).toBeGreaterThan(0);
      expect(transfers).toContain(chunk.mesh.vertices.buffer);
      expect(transfers).toContain(chunk.mesh.indices.buffer);
    }
    const moved = structuredClone(requested, { transfer: transfers });
    expect(requested.shadowChunks![0]!.mesh.vertices.byteLength).toBe(0);
    expect(moved.shadowChunks![0]!.mesh.vertices.byteLength).toBeGreaterThan(0);
    expect(blueprint.boxes).toHaveLength(2);
    expect(() => executeVoxelJob({ ...job, lodFactor: 2, shadow: 'opaque-faces-v1' })).toThrow();
  });

  it.each(['missing', 'wrong-stamp', 'wrong-coordinate', 'bad-buffer'] as const)(
    'rejects requested %s shadow response', async fault => {
      const { pool, workers } = setup();
      const input = { kind: job.kind, blueprint, revision: job.revision, materials: job.materials, materialRevision: job.materialRevision };
      const pending = pool.submit({ ...input, shadow: 'opaque-faces-v1' });
      const rejected = expect(pending).rejects.toThrow('incompatible job metadata');
      const response = executeVoxelJob(workers[0]!.jobs[0]!);
      if (response.kind !== 'asset' || !response.shadowChunks) throw new Error('Expected shadow chunks');
      const first = response.shadowChunks[0]!;
      const malformed = fault === 'missing' ? { ...response, shadowChunks: undefined }
        : fault === 'wrong-stamp' ? { ...response, shadowChunks: [{ ...first, mesh: { ...first.mesh, stamp: { ...first.mesh.stamp, key: 'wrong' } } }, ...response.shadowChunks.slice(1)] }
        : fault === 'wrong-coordinate' ? { ...response, shadowChunks: [{ ...first, coordinate: [9, 0, 0] as const }, ...response.shadowChunks.slice(1)] }
        : { ...response, shadowChunks: [{ ...first, mesh: { ...first.mesh, indices: new Uint32Array([999]) } }, ...response.shadowChunks.slice(1)] };
      workers[0]!.respond(malformed as VoxelWorkerResponse);
      await rejected; pool.dispose();
    });

  it.each(['empty', 'zero-indices', 'collapsed', 'shifted'] as const)(
    'rejects a %s shadow response that loses or moves opaque coverage', async fault => {
      const { pool, workers } = setup();
      const input = { kind: job.kind, blueprint, revision: job.revision, materials: job.materials, materialRevision: job.materialRevision };
      const pending = pool.submit({ ...input, shadow: 'opaque-faces-v1' });
      const settled = pending.then(() => 'resolved', (error: Error) => error.message);
      const response = executeVoxelJob(workers[0]!.jobs[0]!);
      if (response.kind !== 'asset' || !response.shadowChunks) throw new Error('Expected shadow chunks');
      const first = response.shadowChunks[0]!, mesh = first.mesh;
      const vertices = mesh.vertices.slice(), indices = mesh.indices.slice();
      let invalid = mesh;
      if (fault === 'empty') invalid = { ...mesh, vertices: new Uint32Array(), indices: new Uint32Array(), quadCount: 0, bounds: null };
      if (fault === 'zero-indices') { indices.fill(0); invalid = { ...mesh, indices }; }
      if (fault === 'collapsed') {
        for (let q = 0; q < mesh.quadCount; q++) for (let v = 1; v < 4; v++) vertices[q * 8 + v * 2] = vertices[q * 8]!;
        invalid = { ...mesh, vertices };
      }
      if (fault === 'shifted') {
        for (let i = 0; i < vertices.length; i += 2) vertices[i] = vertices[i]! + (1 << 12);
        const bounds = mesh.bounds!;
        invalid = { ...mesh, vertices, bounds: { min: [bounds.min[0], bounds.min[1], bounds.min[2] + 1],
          max: [bounds.max[0], bounds.max[1], bounds.max[2] + 1] } };
      }
      workers[0]!.respond({ ...response, shadowChunks: [{ ...first, mesh: invalid }, ...response.shadowChunks.slice(1)] });
      expect(await settled).toContain('incompatible job metadata'); pool.dispose();
    });

  it('rejects shadow data when the caller did not request it', async () => {
    const { pool, workers } = setup();
    const input = { kind: job.kind, blueprint, revision: job.revision, materials: job.materials, materialRevision: job.materialRevision };
    const pending = pool.submit(input);
    const rejected = expect(pending).rejects.toThrow('incompatible job metadata');
    const dispatched = workers[0]!.jobs[0]!;
    if (dispatched.kind !== 'blueprint') throw new Error('Expected blueprint job');
    workers[0]!.respond(executeVoxelJob({ ...dispatched, shadow: 'opaque-faces-v1' }));
    await rejected; pool.dispose();
  });

  it('does not install stale or cancelled shadow replies', async () => {
    const { pool, workers } = setup();
    const input = { kind: job.kind, blueprint, revision: job.revision, materials: job.materials, materialRevision: job.materialRevision };
    let current = false;
    const obsolete = pool.submit({ ...input, shadow: 'opaque-faces-v1' }, { isCurrent: () => current });
    workers[0]!.respond(executeVoxelJob(workers[0]!.jobs[0]!));
    expect(await obsolete).toBeNull();
    current = true;
    const first = pool.submit({ ...input, shadow: 'opaque-faces-v1' }, { key: 'home' });
    const firstWorker = workers.at(-1)!;
    const second = pool.submit({ ...input, shadow: 'opaque-faces-v1' }, { key: 'home' });
    expect(await first).toBeNull(); expect(firstWorker.terminated).toBe(true);
    firstWorker.respond(executeVoxelJob(firstWorker.jobs.at(-1)!));
    const active = workers.at(-1)!;
    active.respond(executeVoxelJob(active.jobs.at(-1)!));
    expect(await second).toMatchObject({ kind: 'asset', shadowChunks: expect.any(Array) });
    pool.dispose();
  });
});
