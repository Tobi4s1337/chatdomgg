import { afterEach, describe, expect, it, vi } from 'vitest';
import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { generateKingdom } from '@chatdom/world';
import { createWindowLights, type WindowHouse } from '@chatdom/render';
import { createHome, createCastle, CASTLE_BEACON_ANCHOR_METRES, MATERIALS } from '@chatdom/content';
import { PRESENCE_FIXTURES } from '@chatdom/shared/world-fixtures';
import { Scene } from 'three';
import { createVoxelMaterial } from '@chatdom/render';
import { sampleLightVolume } from '@chatdom/voxel';
import { createLightField, type LightFieldOptions } from './light-field';
import {
  bindLightFieldWorker, compileLightHouses, createLightFieldSolver, LIGHT_FIELD_BUDGET, LIGHT_FIELD_CELLS,
  resolveLightFieldConfig, buildLightFieldSamples, type SurfaceLightVolume, type LightFieldRequest, type LightFieldResponse, type LightFieldSolve,
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
    expect(transferCounts).toEqual([0, 2, 2]);
    const solved = messages[1]!;
    expect(solved.kind).toBe('volume');
    if (solved.kind !== 'volume') throw new Error('Expected a light result');
    expect(solved.volume.light.byteLength).toBe(LIGHT_FIELD_CELLS);
    expect(messages[2]).toMatchObject({ kind: 'volume', occupancyBuilds: 1 });
    expect(sampleLightVolume(solved.volume, source)).toBe(15);
  });
});

describe('bounded kingdom light field', () => {
  const options = { mode: 'kingdom' } as const;
  const config = resolveLightFieldConfig(layout, options);
  const kingdomOrigin = config.origin!;
  const coarseSource: Vec3 = [-1, 15, 1];
  const coarseRequest = (revision = 1): LightFieldSolve => ({ kind: 'solve', revision, origin: kingdomOrigin, emitters: [{ position: coarseSource, level: 15 }] });

  it('covers every town quarter at two metres and bounds larger tenure layouts', () => {
    const town = generateKingdom({ seed: 'lanternmere', tier: 'town', firstYear: 2022, year: 2026 });
    const townConfig = resolveLightFieldConfig(town, options);
    expect(townConfig).toMatchObject({ origin: [-170, -2, -102], size: [170, 16, 185], cellSize: 2, cells: 503_200, levelScale: 3 });
    const capital = generateKingdom({ seed: 'old-town', tier: 'town', firstYear: 1996, year: 2026 });
    const capitalConfig = resolveLightFieldConfig(capital, options);
    expect(capitalConfig.cells).toBeLessThanOrEqual(LIGHT_FIELD_CELLS);
    expect(capitalConfig.cellSize).toBeGreaterThan(2);
    expect(capitalConfig.origin![0] + capitalConfig.size[0] * capitalConfig.cellSize).toBeGreaterThanOrEqual(capital.bounds.maxX);
    expect(capitalConfig.origin![2] + capitalConfig.size[2] * capitalConfig.cellSize).toBeGreaterThanOrEqual(capital.bounds.maxZ);
    expect(() => resolveLightFieldConfig({ ...town, bounds: { ...town.bounds, maxZ: NaN } }, options)).toThrow('bounds');
  });

  it('retains thin blockers and only admits carves enclosing the whole coarse cell', () => {
    const closed = createLightFieldSolver(layout, [house()], options).solve(coarseRequest()).volume;
    expect(sampleLightVolume(closed, coarseSource)).toBe(15);
    expect(sampleLightVolume(closed, [3, 15, 1])).toBe(0);
    const doorway = { from: [0, 32, 112], to: [16, 64, 144], material: 0 } satisfies VoxelBlueprint['boxes'][number];
    const openedHouse: WindowHouse = { ...house(), blueprint: { ...blueprint([wallBox, doorway]), size: [16, 128, 256] } };
    const openRequest = { ...coarseRequest(), emitters: [{ position: [-1, 11, 1] as Vec3, level: 15 }] };
    const open = createLightFieldSolver(layout, [openedHouse], options).solve(openRequest).volume;
    expect(sampleLightVolume(open, [3, 11, 1])).toBe(9);
    const partialHouse: WindowHouse = { ...openedHouse, blueprint: { ...openedHouse.blueprint, boxes: [wallBox, { ...doorway, to: [15, 64, 144] }] } };
    expect(sampleLightVolume(createLightFieldSolver(layout, [partialHouse], options).solve(openRequest).volume, [3, 11, 1])).toBe(0);
    expect(sampleLightVolume(createLightFieldSolver(layout, [openedHouse, house()], options).solve(openRequest).volume, [3, 11, 1])).toBe(0);
  });

  it('projects a buried facade outward into first air without crossing a real wall', () => {
    const buried = { position: [0.53, 15, 1] as Vec3, level: 15, normal: [1, 0, 0] as Vec3 };
    const projected = createLightFieldSolver(layout, [house()], options).solve({ ...coarseRequest(), emitters: [buried] }).volume;
    expect(sampleLightVolume(projected, buried.position)).toBe(0);
    expect(sampleLightVolume(projected, [2.01, 15, 1])).toBe(15);
    expect(sampleLightVolume(projected, coarseSource)).toBe(0);
    const secondWall: WindowHouse = { ...house(), position: [1.125, 6, -16] };
    const blocked = createLightFieldSolver(layout, [house(), secondWall], options).solve({ ...coarseRequest(), emitters: [buried] }).volume;
    expect(blocked.light.every(level => level === 0)).toBe(true);
    const noNormal = createLightFieldSolver(layout, [house()], options).solve({ ...coarseRequest(), emitters: [{ position: buried.position, level: 15 }] }).volume;
    expect(noNormal.light.every(level => level === 0)).toBe(true);
    expect(() => createLightFieldSolver(layout, [house()], options).solve({ ...coarseRequest(), emitters: [{ ...buried, normal: [0.5, 0, 0.5] }] })).toThrow('cardinal');
    const carvedWall: WindowHouse = { ...secondWall, blueprint: blueprint([wallBox, { ...wallBox, material: 0 }]) };
    const opened = createLightFieldSolver(layout, [house(), carvedWall], options).solve({ ...coarseRequest(), emitters: [buried] }).volume;
    expect(sampleLightVolume(opened, [2.01, 15, 1])).toBe(15);
    const restoredWall: WindowHouse = { ...secondWall, blueprint: blueprint([{ ...wallBox, material: 0 }, wallBox]) };
    expect(createLightFieldSolver(layout, [house(), restoredWall], options).solve({ ...coarseRequest(), emitters: [buried] }).volume.light.every(level => level === 0)).toBe(true);
    const westWall: WindowHouse = { ...house(), position: [-0.125, 6, -16] };
    const west = createLightFieldSolver(layout, [westWall], options).solve({ ...coarseRequest(), emitters: [{ position: [-0.53, 15, 1], normal: [-1, 0, 0], level: 15 }] }).volume;
    expect(sampleLightVolume(west, [-2.01, 15, 1])).toBe(15);
    expect(sampleLightVolume(west, [1, 15, 1])).toBe(0);
  });

  it('keeps attenuation in metres, quantizes brightness, and removes only expired sources', () => {
    const solver = createLightFieldSolver(layout, [], options);
    const initial = solver.solve(coarseRequest());
    for (const [distance, expected] of [[0, 15], [2, 12], [4, 9], [6, 6], [8, 3], [10, 0]]) {
      expect(sampleLightVolume(initial.volume, [-1 - distance!, 15, 1])).toBe(expected);
    }
    const dimmed = solver.solve({ ...coarseRequest(2), emitters: [{ position: coarseSource, level: 8 }] });
    expect(sampleLightVolume(dimmed.volume, coarseSource)).toBe(9);
    const survivor = { position: [-11, 15, 1] as Vec3, level: 15 };
    const overlap = solver.solve({ ...coarseRequest(3), emitters: [...coarseRequest().emitters, survivor] });
    expect(sampleLightVolume(overlap.volume, coarseSource)).toBe(15);
    const oneRemoved = solver.solve({ ...coarseRequest(4), emitters: [survivor] });
    expect(sampleLightVolume(oneRemoved.volume, survivor.position)).toBe(15);
    expect(sampleLightVolume(oneRemoved.volume, coarseSource)).toBe(0);
    const empty = solver.solve({ ...coarseRequest(5), emitters: [] });
    expect(empty.volume.light.every(level => level === 0)).toBe(true);
    expect(empty.occupancyBuilds).toBe(1);
    expect(empty.volume.revision).toBe(5);
    expect(initial.volume.light).not.toBe(empty.volume.light);
    expect(() => solver.solve({ ...coarseRequest(6), origin })).toThrow('fixed');
  });

  it('lights actual authored homes in all five town quarters within the combined budget', () => {
    const town = generateKingdom({ seed: 'lanternmere', tier: 'town', firstYear: 2022, year: 2026 });
    const townConfig = resolveLightFieldConfig(town, options);
    const homes = town.homes.map(plot => {
      const model = createHome(plot.tier, plot.style, plot.variant);
      const streetZ = plot.rotation === 0 ? plot.lot.maxZ + 4 : plot.lot.minZ - 4;
      const depth = model.size[2] * 0.125;
      return { slot: plot.slot, blueprint: model, position: plot.rotation === 0
        ? [plot.position[0] - 4, plot.position[1], streetZ - 4 - depth]
        : [plot.position[0] + 4, plot.position[1], streetZ + 4 + depth], yaw: plot.rotation * Math.PI / 2 } satisfies WindowHouse;
    });
    const windows = createWindowLights(new Scene(), homes);
    try {
      windows.setFrame({ ...PRESENCE_FIXTURES.public, asOf: PRESENCE_FIXTURES.public.asOf + 1000,
        windows: town.homes.map(plot => ({ slot: plot.slot, present: true, publicName: null, since: PRESENCE_FIXTURES.public.asOf })) });
      const sources = windows.getSources();
      const solver = createLightFieldSolver(town, homes, options);
      const volume = solver.solve({ kind: 'solve', revision: 1, origin: townConfig.origin!, emitters: sources.map(window => ({ position: window.position, normal: window.normal, level: Math.round(window.strength * 15) })) }).volume;
      expect(volume.light.length).toBe(503_200);
      expect(volume.estimatedPeakBytes).toBeLessThanOrEqual(LIGHT_FIELD_BUDGET);
      const near = createLightFieldSolver(town, homes).solve({ kind: 'solve', revision: 1, origin, emitters: [] }).volume;
      expect(volume.estimatedPeakBytes + near.estimatedPeakBytes).toBeLessThan(12 * 1024 * 1024);
      for (const quarter of town.quarters) {
        const slots = new Set(town.homes.filter(plot => plot.quarterYear === quarter.year).map(plot => plot.slot));
        const quarterSources = sources.filter(source => slots.has(source.slot));
        expect(quarterSources.length).toBeGreaterThan(0);
        for (const slot of slots) {
          // A sub-cell alley can close conservatively between neighbouring
          // homes. Every home must still light its street-facing exterior.
          const levels = quarterSources.filter(source => source.slot === slot && Math.abs(source.normal[2]) > 0.99).flatMap(source =>
            [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map(distance => sampleLightVolume(volume,
              source.position.map((value, axis) => value + source.normal[axis]! * distance) as unknown as Vec3)));
          expect(Math.max(...levels), `Quarter ${quarter.year}, slot ${slot}`).toBe(15);
        }
      }
      const removed = solver.solve({ kind: 'solve', revision: 2, origin: townConfig.origin!, emitters: [] });
      expect(removed.volume.light.every(level => level === 0)).toBe(true);
      expect(removed.occupancyBuilds).toBe(1);
    } finally { windows.dispose(); }
  });
});

/** Independent generic trilinear evaluation of the worker's shared corners. */
function reconstructed(volume: SurfaceLightVolume, position: Vec3): number {
  const q = position.map((value, axis) => (value - volume.origin[axis]!) / volume.cellSize);
  const cell = q.map(Math.floor), size = volume.size.map(value => value + 1);
  if (cell.some((value, axis) => value < 0 || value >= volume.size[axis]!)) return 0;
  const at = (x: number, y: number, z: number) => volume.surfaceSamples[x + size[0]! * (y + size[1]! * z)]!;
  if (at(cell[0]!, cell[1]!, cell[2]!) & 128) return 0;
  let value = 0;
  for (let corner = 0; corner < 8; corner++) {
    let weight = 1;
    const index = cell.map((base, axis) => {
      const upper = (corner >> axis) & 1, fraction = q[axis]! - base;
      weight *= upper ? fraction : 1 - fraction;
      return base + upper;
    });
    value += (at(index[0]!, index[1]!, index[2]!) & 15) * weight;
  }
  return value;
}

function sampledFixture(size: Vec3, occupancy: Uint8Array, light: Uint8Array): SurfaceLightVolume {
  return { origin: [0, 0, 0], size, cellSize: 1, revision: 1, visited: 0, estimatedPeakBytes: 0,
    light, surfaceSamples: buildLightFieldSamples(size, occupancy, light) };
}

describe('continuous occluded surface reconstruction', () => {
  it('preserves constants at field edges and affine gradients in open air', () => {
    const size: Vec3 = [4, 4, 4], empty = new Uint8Array(64), constant = new Uint8Array(64).fill(13);
    const uniform = sampledFixture(size, empty, constant);
    for (const point of [[0.001, 0.001, 0.001], [3.999, 3.999, 3.999], [2.2, 1.3, 2.9]] as const) expect(reconstructed(uniform, point)).toBeCloseTo(13);
    const light = Uint8Array.from({ length: 64 }, (_, i) => 2 * (i % 4) + 2 * (Math.floor(i / 4) % 4));
    const gradient = sampledFixture(size, empty, light);
    expect(reconstructed(gradient, [1.25, 2.2, 1.75])).toBeCloseTo(4.9);
    expect(light).toEqual(gradient.light);
    expect(reconstructed(gradient, [-0.001, 1, 1])).toBe(0);
    expect(reconstructed(gradient, [4, 1, 1])).toBe(0);
  });

  it('does not light the far side of a sealed wall or disconnected diagonal air', () => {
    const occupancy = Uint8Array.from({ length: 27 }, (_, i) => Number(i % 3 === 1));
    const light = Uint8Array.from({ length: 27 }, (_, i) => i % 3 === 0 ? 15 : 0);
    const sealed = sampledFixture([3, 3, 3], occupancy, light);
    for (const x of [1.001, 1.5, 1.999, 2.001, 2.5, 2.999]) expect(reconstructed(sealed, [x, 1.37, 1.61])).toBe(0);
    const diagonal = sampledFixture([2, 2, 2], new Uint8Array([0, 1, 1, 0, 0, 1, 1, 0]), new Uint8Array([15, 0, 0, 0, 15, 0, 0, 0]));
    expect(reconstructed(diagonal, [1.001, 1.001, 0.5])).toBe(0);
    expect(reconstructed(diagonal, [0.1, 0.1, 0.5])).toBeGreaterThan(10);
  });

  it('agrees across air cell faces beside blockers, including the asymmetric stencil counterexample', () => {
    const volume = sampledFixture([2, 2, 2], new Uint8Array([0, 0, 1, 0, 0, 0, 1, 0]), new Uint8Array([13, 14, 0, 15, 13, 14, 0, 15]));
    for (const y of [0.05, 0.25, 0.75, 0.95]) {
      const left = reconstructed(volume, [1 - 1e-7, y, 0.5]);
      const right = reconstructed(volume, [1 + 1e-7, y, 0.5]);
      expect(Math.abs(left - right)).toBeLessThan(1e-5);
    }
  });

  it('uploads packed corners separately and reuses texture allocation after source removal', () => {
    const solver = createLightFieldSolver(layout, [house()]);
    const lit = solver.solve(request()).volume;
    const before = lit.light.slice();
    const renderer = createVoxelMaterial(MATERIALS, 'build');
    try {
      renderer.setLight(lit);
      const texture = renderer.material.uniforms.uLight!.value;
      expect([texture.image.width, texture.image.height, texture.image.depth]).toEqual([129, 33, 129]);
      expect(texture.image.data).toBe(lit.surfaceSamples);
      expect(lit.light.every((value, index) => value === before[index])).toBe(true);
      expect(lit.surfaceSamples.some(value => value & 128)).toBe(true);
      const dark = solver.solve({ ...request(2), emitters: [] }).volume;
      expect(dark.surfaceSamples.every(value => (value & 15) === 0)).toBe(true);
      renderer.setLight(dark);
      expect(renderer.material.uniforms.uLight!.value).toBe(texture);
      expect(texture.image.data).toBe(dark.surfaceSamples);
    } finally { renderer.dispose(); }
  });

  it('lights the actual castle crown from its beacon while retaining roof occlusion and full removal', () => {
    const position: Vec3 = [layout.castle[0] - 16 + CASTLE_BEACON_ANCHOR_METRES[0], layout.castle[1] + CASTLE_BEACON_ANCHOR_METRES[1], layout.castle[2] - 16 + CASTLE_BEACON_ANCHOR_METRES[2]];
    const options = { mode: 'beacon', position } as const, config = resolveLightFieldConfig(layout, options);
    expect(config).toMatchObject({ size: [32, 24, 32], cells: 24_576, cellSize: 2, levelScale: 1 });
    const castle: WindowHouse = { slot: 65534, blueprint: createCastle('tide'), position: [layout.castle[0] - 16, layout.castle[1], layout.castle[2] - 16], yaw: 0 };
    const solver = createLightFieldSolver(layout, [castle], options);
    const lit = solver.solve({ kind: 'solve', revision: 1, origin: config.origin!, emitters: [{ position, level: 15, normal: [0, 1, 0] }] });
    expect(sampleLightVolume(lit.volume, position)).toBe(0);
    expect(sampleLightVolume(lit.volume, [position[0], position[1] + 0.51, position[2]])).toBe(15);
    expect(sampleLightVolume(lit.volume, [0, 37, -42])).toBeGreaterThan(0);
    expect(sampleLightVolume(lit.volume, [0, 37, -48])).toBe(0);
    expect(sampleLightVolume(lit.volume, [0, 22, -43])).toBe(0);
    expect(lit.volume.estimatedPeakBytes).toBeLessThan(300_000);
    const removed = solver.solve({ kind: 'solve', revision: 2, origin: config.origin!, emitters: [] });
    expect(removed.volume.light.every(value => value === 0)).toBe(true);
    expect(removed.volume.surfaceSamples.every(value => (value & 15) === 0)).toBe(true);
    expect(removed.occupancyBuilds).toBe(1);
    expect(() => resolveLightFieldConfig(layout, { mode: 'beacon' })).toThrow('position');
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
    const init = this.messages[0]!;
    if (init.kind !== 'init') throw new Error('Expected field initialization');
    const config = resolveLightFieldConfig(init.layout, init.options);
    return {
      kind: 'volume', revision: job.revision, occupancyBuilds: 1, solveMs: 10,
      volume: { revision: job.revision, origin: job.origin, size: config.size, cellSize: config.cellSize, light: new Uint8Array(config.cells), surfaceSamples: new Uint8Array(config.size.reduce((count, value) => count * (value + 1), 1)), visited: 0, estimatedPeakBytes: 4_850_692 },
    };
  }
  latest(): LightFieldSolve {
    const job = this.messages.at(-1)!;
    if (job.kind !== 'solve') throw new Error('Expected a solve job');
    return job;
  }
}

function setup(onVolume = vi.fn(), onError = vi.fn(), options: LightFieldOptions = {}) {
  ControlledWorker.instances = [];
  vi.stubGlobal('Worker', ControlledWorker);
  const field = createLightField(layout, [house()], onVolume, onError, options);
  return { field, worker: ControlledWorker.instances[0]!, onVolume, onError };
}

describe('dedicated light worker scheduling', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('keeps kingdom bounds fixed during camera travel and snapshots normals with quantized pending revisions', () => {
    const { field, worker, onVolume } = setup(vi.fn(), vi.fn(), { mode: 'kingdom' });
    const normal: [number, number, number] = [1, 0, 0];
    const distant = { position: [60, 15, 50] as Vec3, strength: 0.51, normal };
    expect(worker.messages[0]).toMatchObject({ options: { mode: 'kingdom' } });
    field.update([0, 0, 0], [distant]);
    field.update([500, 100, -500], [{ ...distant, strength: 0.52 }]);
    expect(field.stats.requestedRevision).toBe(1);
    normal[0] = -1;
    worker.ready();
    const first = worker.latest();
    expect(first).toMatchObject({ origin: resolveLightFieldConfig(layout, { mode: 'kingdom' }).origin,
      emitters: [{ position: distant.position, normal: [1, 0, 0], level: 9 }] });
    field.update([0, 0, 0], [{ ...distant, strength: 1 }]);
    field.update([0, 0, 0], []);
    worker.respond(worker.result(first));
    expect(onVolume).not.toHaveBeenCalled();
    const latest = worker.latest();
    expect(latest).toMatchObject({ revision: 3, origin: first.origin, emitters: [] });
    worker.respond(worker.result(latest));
    expect(onVolume).toHaveBeenCalledOnce();
    expect(field.stats).toMatchObject({ publishedRevision: 3, discardedJobs: 1 });
    field.dispose();
  });

  it('rejects a local-resolution worker result for a kingdom field', () => {
    const { field, worker, onVolume, onError } = setup(vi.fn(), vi.fn(), { mode: 'kingdom' });
    worker.ready();
    field.update([0, 0, 0], []);
    const result = worker.result(worker.latest());
    worker.respond({ ...result, volume: { ...result.volume, cellSize: 0.5 } });
    expect(onVolume).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(field.stats.failed).toBe(true);
  });

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
