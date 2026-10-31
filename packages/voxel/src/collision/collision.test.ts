import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import type { SolidBox } from '@chatdom/shared/realm';
import {
  CollisionAssetCache, CollisionCompileError, collisionSolidity, compileCollisionAsset, compileCollisionWorld,
  type CollisionBlueprint, type CollisionMaterial, type CollisionPlacement, type SampledTerrain,
} from './index';

const AIR = 0, STONE = 3, GLASS = 14, MIST = 60;
const MATERIALS: CollisionMaterial[] = [
  { id: AIR, solid: false }, { id: STONE, solid: true }, { id: GLASS, solid: true }, { id: MIST, solid: false },
];
const solidity = collisionSolidity(MATERIALS);

/** A 2 m × 3 m wall, 0.25 m thick, with a carved doorway and a glass pane: build cells (0.125 m). */
const WALL: CollisionBlueprint = {
  lattice: 'build', size: [16, 24, 2],
  boxes: [
    { from: [0, 0, 0], to: [16, 24, 2], material: STONE },
    { from: [6, 0, 0], to: [10, 16, 2], material: AIR },
    { from: [1, 10, 0], to: [4, 14, 2], material: GLASS },
    { from: [12, 10, 0], to: [15, 14, 2], material: MIST },
  ],
};

function flat(top: number, size = 16, cell = .5, origin = -size / 2): SampledTerrain {
  return { cellMetres: cell, originX: origin, originZ: origin, columns: size / cell, rows: size / cell,
    heights: new Int32Array((size / cell) ** 2).fill(Math.round(top / cell)), bottom: -8, ceiling: 64 };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

const point = (x: number, y: number, z: number): SolidBox => ({ min: [x, y, z], max: [x, y, z] });
/** Strictly inside some returned box (faces don't count): a point probe for occupancy. */
function solidAt(world: { query(b: SolidBox): readonly SolidBox[] }, x: number, y: number, z: number): boolean {
  return world.query(point(x, y, z)).some(b => b.min[0] < x && x < b.max[0] && b.min[1] < y && y < b.max[1] && b.min[2] < z && z < b.max[2]);
}
function rotate(local: Vec3, turn: number): Vec3 {
  const [x, y, z] = local;
  return turn === 0 ? [x, y, z] : turn === 1 ? [z, y, -x] : turn === 2 ? [-x, y, -z] : [-z, y, x];
}
/** Reference occupancy of a blueprint by replaying its operations cell by cell. */
function denseSolid(blueprint: CollisionBlueprint): Uint8Array {
  const [sx, sy, sz] = blueprint.size;
  const cells = new Uint8Array(sx * sy * sz);
  for (const op of blueprint.boxes) {
    const v = MATERIALS.find(m => m.id === op.material)!.solid ? 1 : 0;
    for (let z = op.from[2]; z < op.to[2]; z++) for (let y = op.from[1]; y < op.to[1]; y++) for (let x = op.from[0]; x < op.to[0]; x++) cells[x + sx * (y + sy * z)] = v;
  }
  return cells;
}

describe('collision assets resolve final cells', () => {
  it('keeps a carved doorway open, glass solid and non-solid materials passable', () => {
    const asset = compileCollisionAsset(WALL, solidity);
    const expected = denseSolid(WALL).reduce((n, v) => n + v, 0);
    expect(asset.solidCells).toBe(expected);
    expect(expected).toBe(16 * 24 * 2 - 4 * 16 * 2 - 3 * 4 * 2);
    const world = compileCollisionWorld({ revision: 7, materials: MATERIALS, blueprints: new Map([['wall', WALL]]),
      placements: [{ id: 'wall', blueprint: 'wall', position: [0, 0, 0], rotation: 0 }], terrain: flat(-1) });
    expect(solidAt(world, 1, 1, .125)).toBe(false); // doorway: 0.75–1.25 m wide, 2 m tall
    expect(solidAt(world, 1, 2.2, .125)).toBe(true); // lintel above it
    expect(solidAt(world, .3, 1.5, .125)).toBe(true); // glass pane
    expect(solidAt(world, 1.7, 1.5, .125)).toBe(false); // the non-solid pane is an opening
    expect(solidAt(world, .3, .5, .125)).toBe(true);
  });

  it('applies operations in order: a later fill closes an earlier carve', () => {
    const refilled: CollisionBlueprint = { ...WALL, boxes: [...WALL.boxes, { from: [6, 0, 0], to: [10, 8, 2], material: STONE }] };
    const asset = compileCollisionAsset(refilled, solidity);
    expect(asset.solidCells).toBe(denseSolid(refilled).reduce((n, v) => n + v, 0));
    const world = compileCollisionWorld({ revision: 1, materials: MATERIALS, blueprints: new Map([['w', refilled]]),
      placements: [{ id: 'w', blueprint: 'w', position: [0, 0, 0], rotation: 0 }], terrain: flat(-1) });
    expect(solidAt(world, 1, .5, .125)).toBe(true);
    expect(solidAt(world, 1, 1.5, .125)).toBe(false);
  });

  it('covers exactly the final solid cells with disjoint boxes, at the asset lattice', () => {
    const random = rng(38);
    for (let trial = 0; trial < 12; trial++) {
      const size: Vec3 = [3 + Math.floor(random() * 14), 3 + Math.floor(random() * 14), 3 + Math.floor(random() * 14)];
      const boxes = Array.from({ length: 4 + Math.floor(random() * 24) }, () => {
        const from = size.map(n => Math.floor(random() * (n - 1))) as unknown as Vec3;
        const to = from.map((f, d) => f + 1 + Math.floor(random() * (size[d]! - f))) as unknown as Vec3;
        return { from, to, material: [STONE, AIR, GLASS, MIST][Math.floor(random() * 4)]! };
      });
      const blueprint: CollisionBlueprint = { lattice: trial % 2 ? 'avatar' : 'build', size, boxes };
      const asset = compileCollisionAsset(blueprint, solidity);
      expect(asset.cellMetres).toBe(trial % 2 ? .0625 : .125);
      const covered = new Uint8Array(size[0] * size[1] * size[2]);
      for (let b = 0; b < asset.count; b++) {
        const o = b * 6;
        for (let z = asset.boxes[o + 2]!; z < asset.boxes[o + 5]!; z++) for (let y = asset.boxes[o + 1]!; y < asset.boxes[o + 4]!; y++)
          for (let x = asset.boxes[o]!; x < asset.boxes[o + 3]!; x++) covered[x + size[0] * (y + size[1] * z)]!++;
      }
      expect(Array.from(covered)).toEqual(Array.from(denseSolid(blueprint)));
    }
  });

  it('fails closed on unknown materials, bad lattices and malformed operations', () => {
    expect(() => compileCollisionAsset({ ...WALL, boxes: [{ from: [0, 0, 0], to: [1, 1, 1], material: 99 }] }, solidity)).toThrow(CollisionCompileError);
    // Even an operation that a later carve overwrites must name a registered material.
    expect(() => compileCollisionAsset({ ...WALL, boxes: [{ from: [0, 0, 0], to: [1, 1, 1], material: 99 }, { from: [0, 0, 0], to: [1, 1, 1], material: AIR }] }, solidity)).toThrow(/unknown material/);
    expect(() => compileCollisionAsset({ ...WALL, lattice: 'terrain' }, solidity)).toThrow(CollisionCompileError);
    expect(() => compileCollisionAsset({ ...WALL, boxes: [{ from: [0, 0, 0], to: [17, 1, 1], material: STONE }] }, solidity)).toThrow(CollisionCompileError);
    expect(() => compileCollisionAsset({ ...WALL, boxes: [{ from: [2, 0, 0], to: [2, 1, 1], material: STONE }] }, solidity)).toThrow(CollisionCompileError);
    expect(() => collisionSolidity([{ id: 0, solid: true }])).toThrow(/air/);
    expect(() => collisionSolidity([{ id: 1, solid: true }])).toThrow(/zero/);
    expect(() => collisionSolidity([...MATERIALS, { id: STONE, solid: false }])).toThrow(/twice/);
  });
});

describe('collision worlds', () => {
  const placements: CollisionPlacement[] = [0, 1, 2, 3].map(turn => ({ id: `wall:${turn}`, blueprint: 'wall', position: [turn * 3 - 4.5, 0, turn % 2 ? -3 : 3] as Vec3, rotation: turn }));
  const world = compileCollisionWorld({ revision: 42, materials: MATERIALS, blueprints: new Map([['wall', WALL]]), placements, terrain: flat(0) });

  it('preserves every opening and solid under all four cardinal turns', () => {
    const solid = denseSolid(WALL);
    for (const placement of placements) for (let z = 0; z < 2; z++) for (let y = 0; y < 24; y++) for (let x = 0; x < 16; x++) {
      const local: Vec3 = [(x + .5) * .125, (y + .5) * .125, (z + .5) * .125];
      const r = rotate(local, placement.rotation);
      const p = placement.position;
      expect(solidAt(world, p[0] + r[0], p[1] + r[1], p[2] + r[2])).toBe(solid[x + 16 * (y + 24 * z)] === 1);
    }
  });

  it('answers stable, duplicate-free, frozen queries that include touching boxes', () => {
    const all = world.query({ min: [-1e3, -1e3, -1e3], max: [1e3, 1e3, 1e3] });
    expect(new Set(all).size).toBe(all.length);
    expect(Object.isFrozen(all) && Object.isFrozen(all[0]) && Object.isFrozen(all[0]!.min)).toBe(true);
    const index = new Map(all.map((b, n) => [b, n]));
    const random = rng(9);
    for (let n = 0; n < 400; n++) {
      const c = [random() * 20 - 10, random() * 4 - 1, random() * 20 - 10];
      const e = [random() * 2, random() * 2, random() * 2];
      const q: SolidBox = { min: [c[0]!, c[1]!, c[2]!], max: [c[0]! + e[0]!, c[1]! + e[1]!, c[2]! + e[2]!] };
      const got = world.query(q);
      const want = all.filter(b => b.min.every((v, d) => v <= q.max[d]!) && b.max.every((v, d) => v >= q.min[d]!));
      expect(got).toEqual(want);
      expect(got.every((b, i) => i === 0 || index.get(got[i - 1]!)! < index.get(b)!)).toBe(true);
      expect(world.query(q).every((b, i) => b === got[i])).toBe(true);
    }
    // A face shared exactly with the query still counts: the solver's support and tread probes rely on it.
    expect(world.query(point(0, 0, 0)).some(b => b.max[1] === 0)).toBe(true);
  });

  it('blocks unknown space beyond the footprint, below its bottom, above its ceiling and for unreadable bounds', () => {
    expect(world.footprint).toMatchObject({ minX: -8, maxX: 8, minZ: -8, maxZ: 8, bottom: -8, ceiling: 64 });
    for (const [x, y, z] of [[9, 1, 0], [-9, 1, 0], [0, 1, 9], [0, 1, -9], [0, -9, 0], [0, 65, 0], [1e6, 1, -1e6]] as const) {
      expect(solidAt(world, x, y, z), `${x},${y},${z}`).toBe(true);
    }
    expect(world.query({ min: [NaN, 0, 0], max: [1, 1, 1] }).length).toBe(6);
    expect(world.query({ min: [1, 0, 0], max: [0, 1, 1] }).length).toBe(6);
    expect(solidAt(world, 0, 1, 0)).toBe(false);
    expect(world.stats).toMatchObject({ placements: 4, assets: 1, barrierBoxes: 6, terrainBoxes: 1 });
  });

  it('keeps every half-metre terrain step as its own face', () => {
    const heights = new Int32Array(32 * 32);
    for (let k = 0; k < 32; k++) for (let i = 0; i < 32; i++) heights[i + 32 * k] = i < 16 ? 0 : i < 20 ? 1 : 3;
    const terrain: SampledTerrain = { cellMetres: .5, originX: -8, originZ: -8, columns: 32, rows: 32, heights, bottom: -4, ceiling: 32 };
    const steps = compileCollisionWorld({ revision: 3, materials: MATERIALS, blueprints: new Map(), placements: [], terrain });
    expect(steps.stats.terrainBoxes).toBe(3);
    const tops = steps.query({ min: [-1, 0, 0], max: [3, 0, 0] }).filter(b => Number.isFinite(b.max[1])).map(b => [b.min[0], b.max[0], b.max[1]]);
    expect(tops).toEqual([[-8, 0, 0], [0, 2, .5], [2, 8, 1.5]]);
  });

  it('is deterministic across input order and reuses compiled assets by key and solidity', () => {
    const cache = new CollisionAssetCache(8);
    const a = compileCollisionWorld({ revision: 42, materials: MATERIALS, blueprints: new Map([['wall', WALL]]), placements, terrain: flat(0), cache });
    const b = compileCollisionWorld({ revision: 42, materials: [...MATERIALS].reverse(), blueprints: new Map([['wall', WALL]]), placements: [...placements].reverse(), terrain: flat(0), cache });
    const big: SolidBox = { min: [-50, -50, -50], max: [50, 50, 50] };
    expect(b.query(big)).toEqual(a.query(big));
    expect(cache.size).toBe(1);
    // Glass that stops being solid is a different solidity rule and a different compile.
    compileCollisionWorld({ revision: 43, materials: MATERIALS.map(m => m.id === GLASS ? { ...m, solid: false } : m), blueprints: new Map([['wall', WALL]]), placements, terrain: flat(0), cache });
    expect(cache.size).toBe(2);
  });

  it('refuses an unchecked revision, duplicate or dangling placements and bad turns', () => {
    const base = { materials: MATERIALS, blueprints: new Map([['wall', WALL]]), terrain: flat(0) };
    expect(() => compileCollisionWorld({ ...base, revision: 2 ** 32, placements: [] })).toThrow(/uint32/);
    expect(() => compileCollisionWorld({ ...base, revision: -1, placements: [] })).toThrow(/uint32/);
    expect(() => compileCollisionWorld({ ...base, revision: 1, placements: [placements[0]!, placements[0]!] })).toThrow(/twice/);
    expect(() => compileCollisionWorld({ ...base, revision: 1, placements: [{ ...placements[0]!, blueprint: 'gone' }] })).toThrow(/missing/);
    expect(() => compileCollisionWorld({ ...base, revision: 1, placements: [{ ...placements[0]!, rotation: 1.5 }] })).toThrow(/cardinal/);
    expect(() => compileCollisionWorld({ ...base, revision: 1, placements: [{ ...placements[0]!, position: [0, NaN, 0] }] })).toThrow(/finite/);
    expect(() => compileCollisionWorld({ ...base, revision: 1, placements: [], terrain: { ...flat(0), heights: new Int32Array(3) } })).toThrow(/heights/);
    expect(() => compileCollisionWorld({ ...base, revision: 1, placements: [], terrain: { ...flat(0), bottom: 1 } })).toThrow(/vertical/);
  });
});
