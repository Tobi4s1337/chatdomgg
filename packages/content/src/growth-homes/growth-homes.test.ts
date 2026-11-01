import { describe, expect, it } from 'vitest';
import { HOME_DEPTH_METRES, HomeTierSchema, VoxelBlueprintSchema, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import { createHearthHome } from '../homes/hearth/index';
import { settle } from '../homes/hearth/grammar';
import type { HearthHome } from '../homes/hearth/family';
import { GROWTH_HOME_BLUEPRINTS, GROWTH_HOME_REVIEW, buildGrowthHome, createGrowthHome } from './index';

const [SX, SY, SZ] = [64, 160, 128] as const;
const TIERS: readonly HomeTier[] = HomeTierSchema.options;
const KIT = STYLES.hearth;
const PALETTE = new Set<number>([MAT.air, KIT.wall, KIT.roof, KIT.trim, KIT.stone, MAT.glass, MAT.earth, MAT.bark, MAT.leaf, MAT.moss, MAT.petal, MAT.blueFlower]);
const FOOT = 6, HEAD = 18, STEP = 2;

interface Grid { readonly cells: Uint16Array; get(x: number, y: number, z: number): number }

function rasterize(b: VoxelBlueprint): Grid {
  const cells = new Uint16Array(SX * SY * SZ);
  for (const { from, to, material } of b.boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) {
      const row = from[0] + SX * (y + SY * z);
      cells.fill(material, row, row + to[0] - from[0]);
    }
  }
  return { cells, get: (x, y, z) => x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ ? 0 : cells[x + SX * (y + SY * z)]! };
}

const homes = TIERS.map(tier => ({ tier, home: buildGrowthHome('emberfold', tier) }));
const grids = homes.map(({ home }) => rasterize(home.blueprint));

function reach(g: Grid): (x: number, y: number, z: number) => boolean {
  const ZE = SZ + FOOT, YM = 48;
  const free = new Uint8Array(SX * YM * ZE);
  for (let z = 0; z < ZE; z++) for (let x = 0; x < SX; x++) {
    let run = 0;
    for (let y = YM + HEAD; y >= 0; y--) {
      run = g.get(x, y, z) ? 0 : run + 1;
      if (y < YM) free[x + SX * (y + YM * z)] = run >= HEAD ? 1 : 0;
    }
  }
  const stand = new Int8Array(SX * YM * ZE).fill(-1);
  const can = (x: number, y: number, z: number): boolean => {
    if (x < 0 || z < 0 || y < 0 || y >= YM || x + FOOT > SX || z + FOOT > ZE) return false;
    const i = x + SX * (y + YM * z);
    if (stand[i]! >= 0) return stand[i] === 1;
    let ok = true, support = y === 0;
    for (let dz = 0; dz < FOOT && ok; dz++) for (let dx = 0; dx < FOOT; dx++) {
      if (!free[x + dx + SX * (y + YM * (z + dz))]) { ok = false; break; }
      if (!support && g.get(x + dx, y - 1, z + dz)) support = true;
    }
    stand[i] = ok && support ? 1 : 0;
    return stand[i] === 1;
  };
  const seen = new Uint8Array(SX * YM * ZE), queue: number[] = [];
  for (let x = 0; x + FOOT <= SX; x++) if (can(x, 0, SZ)) { seen[x + SX * YM * SZ] = 1; queue.push(x + SX * YM * SZ); }
  while (queue.length) {
    const i = queue.pop()!, x = i % SX, y = Math.floor(i / SX) % YM, z = Math.floor(i / (SX * YM));
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]] as const) {
      for (let ny = y - STEP; ny <= y + STEP; ny++) {
        if (!can(nx, ny, nz)) continue;
        const n = nx + SX * (ny + YM * nz);
        if (!seen[n]) { seen[n] = 1; queue.push(n); }
      }
    }
  }
  return (x, y, z) => {
    for (let ax = x - FOOT + 1; ax <= x; ax++) for (let az = z - FOOT + 1; az <= z; az++) {
      if (ax >= 0 && az >= 0 && ax + FOOT <= SX && seen[ax + SX * (y + YM * az)]) return true;
    }
    return false;
  };
}

/** Width of a street view: wide enough for the 45° views, which shear depth across the lot. */
const VW = SX + SZ;
/**
 * Occupancy seen from across the lane, colour ignored: the shape a neighbour reads at dusk. `skew` 0 looks
 * straight up the lot; ±1 looks from either corner of the lane at 45°, so depth shows beside the street front.
 */
function streetView(g: Grid, skew: number): Uint8Array {
  const view = new Uint8Array(VW * SY);
  for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
    if (g.get(x, y, z)) view[x + (skew > 0 ? SZ - 1 - z : skew < 0 ? z : 0) + VW * y] = 1;
  }
  return view;
}

describe('Emberfold growth line', () => {
  it('keeps the hut as the family hut and versions every grown tier', () => {
    expect(GROWTH_HOME_BLUEPRINTS[0]).toEqual(createHearthHome('hut', 0));
    expect(GROWTH_HOME_BLUEPRINTS.map(b => b.id)).toEqual(['home-hearth-emberfold-hut', ...TIERS.slice(1).map(t => `home-hearth-emberfold-${t}-v2`)]);
    for (const b of GROWTH_HOME_BLUEPRINTS) {
      expect(VoxelBlueprintSchema.parse(b)).toEqual(b);
      expect([b.version, b.kind, b.lattice, b.styleId]).toEqual([1, 'home', 'build', KIT.id]);
      expect(b.size).toEqual([SX, SY, SZ]);
      expect(b.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/);
    }
    for (const tier of TIERS) {
      expect(createGrowthHome('emberfold', tier)).toBe(GROWTH_HOME_BLUEPRINTS[TIERS.indexOf(tier)]);
      expect(JSON.stringify(buildGrowthHome('emberfold', tier).blueprint)).toBe(JSON.stringify(createGrowthHome('emberfold', tier)));
    }
    expect(() => createGrowthHome('emberfold', 'palace' as HomeTier)).toThrow(/tier/);
    expect(() => createGrowthHome('bramble' as 'emberfold', 'hut')).toThrow(/family/);
  });

  it('uses only the Hearth kit, within budget, with no hidden geometry', () => {
    homes.forEach(({ home: { blueprint: b } }, i) => {
      for (const box of b.boxes) expect(PALETTE.has(box.material), `${b.id} material ${box.material}`).toBe(true);
      expect(b.boxes.length, b.id).toBeLessThanOrEqual(2000);
      expect(b.windows.length, b.id).toBeLessThanOrEqual(64);
      expect(grids[i]!.cells.reduce((n, v) => n + (v ? 1 : 0), 0), b.id).toBeLessThanOrEqual(1_000_000);
      expect(settle(b.boxes).length, b.id).toBe(b.boxes.length);
    });
  });
});

describe.each(homes.map((entry, i) => ({ ...entry, i })))('emberfold $tier', ({ home, tier, i }) => {
  const b = home.blueprint, g = grids[i]!;

  it('keeps the locked rear empty and does not pave the lot', () => {
    const rear = SZ - HOME_DEPTH_METRES[tier] * 8;
    let ground = 0;
    for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      if (!g.get(x, y, z)) continue;
      if (z < rear) expect.fail(`${b.id} occupies locked rear at ${x},${y},${z}`);
      if (y === 0) ground++;
    }
    expect(ground / (SX * (SZ - rear))).toBeLessThan(0.7);
  });

  it('connects every solid cell to the ground and carries hoods on real supports', () => {
    const seen = new Uint8Array(g.cells.length), queue: number[] = [];
    let solids = 0;
    for (let k = 0; k < g.cells.length; k++) if (g.cells[k]) solids++;
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) if (g.get(x, 0, z)) { const k = x + SX * SY * z; seen[k] = 1; queue.push(k); }
    while (queue.length) {
      const k = queue.pop()!, x = k % SX, y = Math.floor(k / SX) % SY, z = Math.floor(k / (SX * SY));
      for (const [nx, ny, nz] of [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]] as const) {
        const n = nx + SX * (ny + SY * nz);
        if (g.get(nx, ny, nz) && !seen[n]) { seen[n] = 1; queue.push(n); }
      }
    }
    expect(seen.reduce((n, v) => n + v, 0)).toBe(solids);
    for (const [x, z, y0, y1] of home.supports) {
      for (let y = y0; y < y1; y++) expect(g.get(x, y, z), `${b.id} support ${x},${z} breaks at y=${y}`).not.toBe(MAT.air);
    }
  });

  it('opens a walkable front door into every ground-floor room', () => {
    const reached = reach(g);
    const [ex, ey, ez] = home.entrance;
    expect(g.get(ex, ey, ez)).toBe(MAT.air);
    expect(reached(ex, 2, ez), `${b.id}: doorway not reached from the street`).toBe(true);
    for (const [x, y, z] of home.rooms) expect(reached(x, y, z), `${b.id}: room ${x},${z} unreachable`).toBe(true);
    for (const { at: [x, , z] } of home.exits) expect(reached(x, 2, z), `${b.id}: garden door ${x},${z} unreachable`).toBe(true);
  });

  it('opens every garden door as a real doorway to the open lot', () => {
    for (const { at: [x, y, z], facing } of home.exits) {
      expect(g.get(x, y, z)).toBe(MAT.air);
      const [dx, dz] = facing === 'north' ? [0, -1] : facing === 'south' ? [0, 1] : facing === 'east' ? [1, 0] : [-1, 0];
      for (let s = 0; x + dx * s >= 0 && x + dx * s < SX && z + dz * s >= 0 && z + dz * s < SZ; s++) {
        expect(g.get(x + dx * s, y, z + dz * s), `${b.id} garden door blocked ${s} cells out`).toBe(MAT.air);
      }
      for (let s = 0; s < 8; s++) expect(g.get(x - dx * s, y, z - dz * s), `${b.id} garden door blocked ${s} cells in`).toBe(MAT.air);
    }
  });

  it('keeps the weather out: with the doors shut, room air never reaches the open', () => {
    const doors = [{ at: home.entrance, facing: 'south' }, ...home.exits];
    const YM = 100, rear = SZ - HOME_DEPTH_METRES[tier] * 8;
    const shut = (x: number, y: number, z: number) => doors.some(({ at: [ex, ey, ez], facing }) => {
      const [across, through] = facing === 'north' || facing === 'south' ? [x - ex, z - ez] : [z - ez, x - ex];
      return Math.abs(across) <= 8 && y <= ey + 14 && Math.abs(through) <= 1;
    });
    const seen = new Uint8Array(SX * YM * SZ), queue: number[] = [];
    for (const [x, y, z] of home.rooms) { const k = x + SX * (y + 4 + YM * z); seen[k] = 1; queue.push(k); }
    while (queue.length) {
      const k = queue.pop()!, x = k % SX, y = Math.floor(k / SX) % YM, z = Math.floor(k / (SX * YM));
      if (x === 0 || x === SX - 1 || z <= rear || z === SZ - 1 || y === YM - 1) expect.fail(`${b.id}: room air escapes at ${x},${y},${z}`);
      for (const [nx, ny, nz] of [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]] as const) {
        const n = nx + SX * (ny + YM * nz);
        if (!seen[n] && !g.get(nx, ny, nz) && !shut(nx, ny, nz)) { seen[n] = 1; queue.push(n); }
      }
    }
  });

  it('roofs and walls every room', () => {
    for (const [x, y, z] of home.rooms) {
      let roofed = false;
      for (let up = y; up < SY; up++) if (g.get(x, up, z)) { roofed = true; break; }
      expect(roofed).toBe(true);
      const walled = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => {
        for (let s = 1; s < 64; s++) if (g.get(x + dx! * s, y + 8, z + dz! * s)) return true;
        return false;
      });
      expect(walled.length, `${b.id} room ${x},${z}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('places every window on real glass with a clear outward view to the lot edge', () => {
    expect(new Set(b.windows.map(w => w.id)).size).toBe(b.windows.length);
    for (let a = 0; a < b.windows.length; a++) for (let c = a + 1; c < b.windows.length; c++) {
      const [p, q] = [b.windows[a]!, b.windows[c]!];
      if (p.facing !== q.facing) continue;
      const along = p.facing === 'south' || p.facing === 'north' ? 0 : 2, normal = along === 0 ? 2 : 0;
      const apart = p.centre[normal] !== q.centre[normal]
        || Math.abs(p.centre[along] - q.centre[along]) >= (p.width + q.width) / 2
        || Math.abs(p.centre[1] - q.centre[1]) >= (p.height + q.height) / 2;
      expect(apart, `${b.id}: ${p.id} overlaps ${q.id}`).toBe(true);
    }
    for (const w of b.windows) {
      const along = w.facing === 'south' || w.facing === 'north' ? 0 : 2, normal = along === 0 ? 2 : 0;
      const out = w.facing === 'south' || w.facing === 'east' ? 1 : -1;
      const glassCell = out > 0 ? w.centre[normal] - 1 : w.centre[normal];
      let glass = 0, cells = 0;
      for (let y = w.centre[1] - w.height / 2; y < w.centre[1] + w.height / 2; y++) {
        for (let u = w.centre[along] - w.width / 2; u < w.centre[along] + w.width / 2; u++) {
          const at = (n: number) => { const c = [0, y, 0]; c[along] = u; c[normal] = n; return g.get(c[0]!, c[1]!, c[2]!); };
          const pane = at(glassCell);
          cells++;
          if (pane === MAT.glass) glass++;
          else expect(pane, `${b.id}/${w.id} glass plane has ${pane}`).toBe(KIT.trim);
          for (let n = glassCell + out; n >= 0 && n < (normal === 0 ? SX : SZ); n += out) {
            if (at(n) !== MAT.air) expect.fail(`${b.id}/${w.id} outward view blocked at ${u},${y},${n}`);
          }
        }
      }
      expect(glass / cells).toBeGreaterThanOrEqual(0.75);
    }
  });
});

describe('Emberfold grows where the street can see it', () => {
  it('keeps its entrance, its door and hood, and every earlier pane at every tier', () => {
    for (let i = 1; i < homes.length; i++) {
      const [before, after] = [homes[i - 1]!.home, homes[i]!.home];
      expect(after.entrance).toEqual(before.entrance);
      expect(GROWTH_HOME_REVIEW[after.blueprint.id]).toEqual(GROWTH_HOME_REVIEW[before.blueprint.id]);
      expect(after.blueprint.windows.slice(0, before.blueprint.windows.length)).toEqual(before.blueprint.windows);
      expect(after.blueprint.windows.length).toBeGreaterThan(before.blueprint.windows.length);
      // The doorway, its step and the hood on its brackets are the hut's, cell for cell.
      const [g0, g1] = [grids[i - 1]!, grids[i]!];
      let changed = 0;
      // Below the hood's eaves everything from the wall forward; above them, the hood's own gable.
      const hood = (x: number, y: number) => y < 26 || Math.abs(x + 0.5 - 37) < 36 - y;
      for (let x = 28; x < 46; x++) for (let z = 120; z < SZ; z++) for (let y = 0; y < 37; y++) {
        if ((y < 26 || z >= 125) && hood(x, y) && g0.get(x, y, z) !== g1.get(x, y, z)) changed++;
      }
      expect(changed, `${after.blueprint.id} moves its door`).toBe(0);
    }
  });

  it('builds a new room on newly opened land at every tier', () => {
    for (let i = 1; i < homes.length; i++) {
      const [before, after] = [homes[i - 1]!, homes[i]!];
      const [g0, g1] = [grids[i - 1]!, grids[i]!];
      const oldRear = SZ - HOME_DEPTH_METRES[before.tier] * 8;
      let opened = 0;
      for (let z = 0; z < oldRear; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) if (g1.get(x, y, z)) opened++;
      expect(opened, `${after.home.blueprint.id} does not use its opened land`).toBeGreaterThan(0);
      const fresh = after.home.rooms.filter(([x, y, z]) => {
        for (let up = y; up < SY; up++) if (g0.get(x, up, z)) return false;
        return true;
      });
      expect(fresh.length, `${after.home.blueprint.id} adds no room`).toBeGreaterThan(0);
    }
  });

  it('reads as a different home from across the lane at every step', () => {
    // Straight on, and from each corner of the lane at 45°: how a neighbour actually sees the plot.
    const views = grids.map(g => [0, 1, -1].map(skew => streetView(g, skew)));
    const area = (v: Uint8Array) => v.reduce((n, c) => n + c, 0);
    const top = (v: Uint8Array) => { for (let k = v.length - 1; k >= 0; k--) if (v[k]) return Math.floor(k / VW) + 1; return 0; };
    const iou = (a: Uint8Array, c: Uint8Array) => { let n = 0, u = 0; a.forEach((v, k) => { n += v & c[k]!; u += v | c[k]!; }); return n / u; };
    for (let i = 1; i < views.length; i++) {
      const [a, c] = [views[i - 1]!, views[i]!];
      const growth = a.map((v, k) => area(c[k]!) / area(v)), overlap = a.map((v, k) => iou(v, c[k]!));
      const label = `${TIERS[i - 1]} → ${TIERS[i]}: area ×${growth.map(v => v.toFixed(2)).join('/')}, overlap ${overlap.map(v => v.toFixed(2)).join('/')}, top ${top(a[0]!)} → ${top(c[0]!)}`;
      // From at least one side of the lane there is a fifth more house, or the skyline rises by three metres,
      // and the silhouette no longer matches.
      expect(Math.max(...growth) >= 1.2 || top(c[0]!) - top(a[0]!) >= 24, label).toBe(true);
      expect(Math.min(...overlap), label).toBeLessThanOrEqual(0.9);
      console.info(label);
      // From every side it only ever grows.
      for (const g of growth) expect(g, label).toBeGreaterThan(1);
      expect(top(c[0]!), label).toBeGreaterThanOrEqual(top(a[0]!));
    }
    // The checkpoint pair: the cottage stands a full storey taller than the hut, with twice the street panes and more.
    expect(top(views[1]![0]!) - top(views[0]![0]!)).toBeGreaterThanOrEqual(20);
    const lit = (b: VoxelBlueprint) => b.windows.filter(w => w.facing === 'south').length;
    expect(lit(homes[1]!.home.blueprint)).toBeGreaterThanOrEqual(2 * lit(homes[0]!.home.blueprint));
  });
});

export type { HearthHome };
