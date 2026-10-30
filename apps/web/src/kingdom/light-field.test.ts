import { afterEach, describe, expect, it, vi } from 'vitest';
import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { generateKingdom } from '@chatdom/world';
import { createWindowLights, type WindowHouse } from '@chatdom/render';
import { createHome } from '@chatdom/content';
import { PRESENCE_FIXTURES } from '@chatdom/shared/world-fixtures';
import { Scene } from 'three';
import { sampleLightVolume } from '@chatdom/voxel';
import { createLightField } from './light-field';
import {
  bindLightFieldWorker, compileLightHouses, createLightFieldSolver, LIGHT_FIELD_BUDGET, LIGHT_FIELD_CELLS, LIGHT_FIELD_SIZE,
  type LightFieldRequest, type LightFieldResponse, type LightFieldSolve,
} from './light-field-worker';

const layout = generateKingdom({ seed: 'light-tests', tier: 'hamlet', firstYear: 2026, year: 2026 });
const origin: Vec3 = [-32, 6, -32];
const source: Vec3 = [-0.75, 10.25, 0.25];
const behind: Vec3 = [0.75, 10.25, 0.25];
const wallBox = { from: [0, 0, 0], to: [1, 128, 256], material: 3 } satisfies VoxelBlueprint['boxes'][number];
const carve = { from: [0, 32, 120], to: [4, 40, 136], material: 0 } satisfies VoxelBlueprint['boxes'][number];

function blueprint(boxes: VoxelBlueprint['boxes'] = [wallBox]): VoxelBlueprint {
  return { version: 1, id: 'test-wall', styleId: StyleIdSchema.parse('hearth'), kind: 'home', lattice: 'build', size: [4, 128, 256], boxes, windows: [] };
}
function house(boxes?: VoxelBlueprint['boxes']): WindowHouse {
  return { slot: 0, blueprint: blueprint(boxes), position: [0, 6, -16], yaw: 0 };
}
function request(revision = 1, nextOrigin = origin): LightFieldSolve {
  return { kind: 'solve', revision, origin: nextOrigin, emitters: [{ position: source, level: 15 }] };
}

describe('authoritative worker light geometry', () => {
  it('blocks a 0.125 metre wall on the half-metre field and opens only fully enclosing air carves', () => {
    const closed = createLightFieldSolver(layout, [house()]).solve(request()).volume;
    expect(sampleLightVolume(closed, source)).toBe(15);
    expect(sampleLightVolume(closed, behind)).toBe(0);
    const open = createLightFieldSolver(layout, [house([wallBox, carve])]).solve(request()).volume;
    expect(sampleLightVolume(open, behind)).toBeGreaterThan(0);
    const partial = createLightFieldSolver(layout, [house([wallBox, { ...carve, to: [3, 40, 136] }])]).solve(request()).volume;
    expect(sampleLightVolume(partial, behind)).toBe(0);
  });

  it('keeps authored operation order and never carves terrain or another house', () => {
    for (const boxes of [[carve, wallBox], [wallBox, carve, { ...carve, material: 3 }]]) {
      const volume = createLightFieldSolver(layout, [house(boxes)]).solve(request()).volume;
      expect(sampleLightVolume(volume, behind)).toBe(0);
    }
    const airHouse = house([{ from: [0, 0, 0], to: [4, 128, 256], material: 0 }]);
    const otherHouse = createLightFieldSolver(layout, [house(), airHouse]).solve(request()).volume;
    expect(sampleLightVolume(otherHouse, behind)).toBe(0);
    const belowGround: Vec3 = [0.25, 8.75, 0.25];
    const ground = createLightFieldSolver(layout, [airHouse]).solve({ ...request(), emitters: [{ position: belowGround, level: 15 }] }).volume;
    expect(sampleLightVolume(ground, belowGround)).toBe(0);
  });

  it('uses exact cardinal transforms and rejects unsupported arbitrary yaw', () => {
    const model = { ...blueprint([{ from: [0, 0, 0], to: [8, 16, 24], material: 3 }]), size: [8, 16, 24] as [number, number, number] };
    const expected = [
      [[10, 5, 20], [11, 7, 23]], [[10, 5, 19], [13, 7, 20]],
      [[9, 5, 17], [10, 7, 20]], [[7, 5, 20], [10, 7, 21]],
    ];
    for (let quarter = 0; quarter < 4; quarter++) {
      const transformed = compileLightHouses([{ ...house(), blueprint: model, position: [10, 5, 20], yaw: quarter * Math.PI / 2 }])[0]!;
      expect([transformed.min, transformed.max]).toEqual(expected[quarter]);
      expect(transformed.boxes[0]).toEqual({ min: expected[quarter]![0], max: expected[quarter]![1], solid: true });
    }
    expect(() => compileLightHouses([{ ...house(), yaw: 0.1 }])).toThrow('cardinal');
  });

  it('reuses static occupancy, rebuilds for camera movement, and removes an expired source completely', () => {
    const solver = createLightFieldSolver(layout, [house([wallBox, carve])]);
    const first = solver.solve(request());
    const removed = solver.solve({ ...request(2), emitters: [] });
    expect(first.occupancyBuilds).toBe(1);
    expect(removed.occupancyBuilds).toBe(1);
    expect(removed.volume.light.every(level => level === 0)).toBe(true);
    expect(sampleLightVolume(first.volume, source)).toBe(15);
    expect(solver.solve(request(3, [-24, 6, -32])).occupancyBuilds).toBe(2);
    expect(first.volume.size).toEqual([128, 32, 128]);
    expect(first.volume.light.length).toBe(LIGHT_FIELD_CELLS);
    expect(first.volume.estimatedPeakBytes).toBeLessThanOrEqual(LIGHT_FIELD_BUDGET);
  });

  it('keeps real authored window emitters outside the rotated voxel shells', () => {
    for (const [tier, style, yaw] of [['hut', 'tide', 0], ['cottage', 'hearth', Math.PI], ['manor', 'grove', Math.PI / 2]] as const) {
      const home: WindowHouse = { slot: 0, blueprint: createHome(tier, style, 0), position: [0, 9, 0], yaw };
      const windows = createWindowLights(new Scene(), [home]);
      windows.setFrame({ ...PRESENCE_FIXTURES.public, asOf: PRESENCE_FIXTURES.public.asOf + 1000 });
      const emitters = windows.getSources().map(window => ({ position: window.position, level: Math.round(window.strength * 15) }));
      const volume = createLightFieldSolver(layout, [home]).solve({ ...request(), emitters }).volume;
      expect(emitters.length).toBeGreaterThan(0);
      for (const emitter of emitters) expect(sampleLightVolume(volume, emitter.position)).toBe(15);
      windows.dispose();
    }
  });

  it('transfers only the result field and retains worker-owned occupancy for the next solve', () => {
    const messages: LightFieldResponse[] = [];
    const transferCounts: number[] = [];
    const scope = {
      onmessage: null as ((event: MessageEvent<LightFieldRequest>) => void) | null,
      postMessage(response: LightFieldResponse, transfer: ArrayBuffer[]) {
        transferCounts.push(transfer.length);
        messages.push(structuredClone(response, { transfer }));
      },
    };
    bindLightFieldWorker(scope);
    const send = (data: LightFieldRequest) => scope.onmessage!({ data } as MessageEvent<LightFieldRequest>);
    send({ kind: 'init', layout, houses: [house()] });
    send(request());
    send({ ...request(2), emitters: [] });
    expect(transferCounts).toEqual([0, 1, 1]);
    const solved = messages[1]!;
    expect(solved.kind).toBe('volume');
    if (solved.kind !== 'volume') throw new Error('Expected a light result');
    expect(solved.volume.light.byteLength).toBe(LIGHT_FIELD_CELLS);
    expect(messages[2]).toMatchObject({ kind: 'volume', occupancyBuilds: 1 });
    expect(sampleLightVolume(solved.volume, source)).toBe(15);
  });
});

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<LightFieldResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  messages: LightFieldRequest[] = [];
  terminate = vi.fn();
  constructor(readonly url: URL, readonly options: WorkerOptions) { ControlledWorker.instances.push(this); }
  postMessage(value: LightFieldRequest) { this.messages.push(structuredClone(value)); }
  respond(response: LightFieldResponse) { this.onmessage?.({ data: response } as MessageEvent<LightFieldResponse>); }
  ready() { this.respond({ kind: 'ready' }); }
  result(job: LightFieldSolve): Extract<LightFieldResponse, { kind: 'volume' }> {
    return {
      kind: 'volume', revision: job.revision, occupancyBuilds: 1, solveMs: 10,
      volume: { revision: job.revision, origin: job.origin, size: LIGHT_FIELD_SIZE, cellSize: 0.5, light: new Uint8Array(LIGHT_FIELD_CELLS), visited: 0, estimatedPeakBytes: 4_850_692 },
    };
  }
  latest(): LightFieldSolve {
    const job = this.messages.at(-1)!;
    if (job.kind !== 'solve') throw new Error('Expected a solve job');
    return job;
  }
}

function setup(onVolume = vi.fn(), onError = vi.fn()) {
  ControlledWorker.instances = [];
  vi.stubGlobal('Worker', ControlledWorker);
  const field = createLightField(layout, [house()], onVolume, onError);
  return { field, worker: ControlledWorker.instances[0]!, onVolume, onError };
}

describe('dedicated light worker scheduling', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('waits for init and coalesces one pending job without canceling an active solve', () => {
    const { field, worker, onVolume } = setup();
    field.update([0, 100, 0], [{ position: source, strength: 1 }]);
    field.update([0, 100, 0], [{ position: source, strength: 0.5 }]);
    expect(worker.messages).toHaveLength(1);
    expect(field.stats).toMatchObject({ busy: false, queued: true, requestedRevision: 2 });
    worker.ready();
    const old = worker.latest();
    field.update([8, 100, 0], [{ position: source, strength: 1 }]);
    field.update([16, 100, 0], [{ position: source, strength: 1 }]);
    expect(worker.messages).toHaveLength(2);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.respond(worker.result(old));
    expect(onVolume).not.toHaveBeenCalled();
    expect(field.stats).toMatchObject({ busy: true, queued: false, discardedJobs: 1 });
    const current = worker.latest();
    expect(current.revision).toBe(4);
    expect(current.origin[0]).toBe(-16);
    worker.respond(worker.result(old));
    expect(field.stats.busy).toBe(true);
    worker.respond(worker.result(current));
    expect(onVolume).toHaveBeenCalledOnce();
    expect(field.stats).toMatchObject({ busy: false, queued: false, publishedRevision: 4, completedJobs: 2 });
    field.dispose();
  });

  it('snaps centre to eight metres, uses terrain height, quantizes levels and filters zero/outside sources', () => {
    const { field, worker } = setup();
    worker.ready();
    const sources = [{ position: source, strength: 0.51 }, { position: behind, strength: 0 }, { position: [500, 10, 500] as Vec3, strength: 1 }];
    field.update([0.1, 1000, 0.1], sources);
    expect(worker.latest()).toMatchObject({ origin, emitters: [{ position: source, level: 8 }] });
    field.update([7.9, -1000, 7.9], [{ position: source, strength: 0.52 }]);
    expect(field.stats.requestedRevision).toBe(1);
    expect(worker.messages).toHaveLength(2);
    field.update([-0.1, 0, -0.1], [{ position: source, strength: 1 }]);
    worker.respond(worker.result(worker.latest()));
    expect(worker.latest().origin[0]).toBe(-40);
    expect(worker.latest().origin[2]).toBe(-40);
    expect(() => field.update([0, 0, 0], [{ position: source, strength: 2 }])).toThrow('strengths');
    field.dispose();
  });

  it('owns a snapshot of queued emitters and leaves a published field installed while the next one computes', () => {
    const { field, worker, onVolume } = setup();
    worker.ready();
    const position: [number, number, number] = [...source];
    field.update([0, 0, 0], [{ position, strength: 1 }]);
    const initial = worker.latest();
    worker.respond(worker.result(initial));
    field.update([8, 0, 0], [{ position, strength: 0.5 }]);
    position[0] = 999;
    expect(worker.latest().emitters[0]?.position[0]).toBe(source[0]);
    expect(onVolume).toHaveBeenCalledOnce();
    field.dispose();
  });

  it('rejects mismatched volume metadata and reports failure without publishing it', () => {
    const { field, worker, onVolume, onError } = setup();
    worker.ready();
    field.update([0, 0, 0], []);
    const response = worker.result(worker.latest());
    worker.respond({ ...response, volume: { ...response.volume, origin: [999, 0, 0] } });
    expect(onVolume).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(field.stats).toMatchObject({ failed: true, disposed: true, busy: false, queued: false });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('disposes all worker callbacks and ignores an already queued response after context loss', () => {
    const { field, worker, onVolume } = setup();
    worker.ready();
    field.update([0, 0, 0], []);
    const callback = worker.onmessage;
    const result = worker.result(worker.latest());
    field.dispose();
    field.dispose();
    callback?.({ data: result } as MessageEvent<LightFieldResponse>);
    expect(onVolume).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    field.update([8, 0, 0], []);
    expect(worker.messages).toHaveLength(2);
  });
});
