import { describe, expect, it } from 'vitest';
import { HOME_DEPTH_METRES, HomeTierSchema, VoxelBlueprintSchema, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../materials';
import { FAMILIES, type HearthHome } from './family';
import { BLUEPRINTS, HOME_REVIEW, buildHearthHome, createHearthHome } from './index';

const [SX, SY, SZ] = [64, 160, 128] as const;
const FINISHED: readonly HomeTier[] = HomeTierSchema.options;
const KIT = STYLES.hearth;
const PALETTE = new Set<number>([MAT.air, KIT.wall, KIT.roof, KIT.trim, KIT.stone, MAT.glass, MAT.earth, MAT.bark, MAT.leaf, MAT.moss, MAT.petal, MAT.blueFlower]);
/** A citizen: 0.75 m square, 2.25 m of headroom, climbing at most two cells (0.25 m) per step. */
const FOOT = 6, HEAD = 18, STEP = 2;

interface Grid { readonly cells: Uint16Array; get(x: number, y: number, z: number): number }

/** Executes the ordered boxes exactly as the production rasterizer does: later boxes overwrite, air carves. */
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

const homes = FAMILIES.flatMap((family, variant) => FINISHED.map(tier => ({ family, tier, home: buildHearthHome(tier, variant as 0 | 1 | 2) })));
const grids = new Map<string, Grid>(homes.map(({ home }) => [home.blueprint.id, rasterize(home.blueprint)]));
const grid = (home: HearthHome) => grids.get(home.blueprint.id)!;

/**
 * Walkable standing positions for a FOOT×FOOT citizen whose lowest corner is at (x, z) with feet in cell y. The
 * street in front of the lot (z ≥ 128) is open meadow at ground level.
 */
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
  // True when some reached stance covers column (x, z) with its feet at y.
  return (x, y, z) => {
    for (let ax = x - FOOT + 1; ax <= x; ax++) for (let az = z - FOOT + 1; az <= z; az++) {
      if (ax >= 0 && az >= 0 && ax + FOOT <= SX && seen[ax + SX * (y + YM * az)]) return true;
    }
    return false;
  };
}

describe('Hearth collection contract', () => {
  it('exports finished homes in family-major, shared-tier order with stable IDs', () => {
    const expected = FAMILIES.flatMap(family => FINISHED.map(tier => `home-hearth-${family}-${tier}`));
    expect(BLUEPRINTS.map(b => b.id)).toEqual(expected);
    expect(Object.keys(HOME_REVIEW).sort()).toEqual([...expected].sort());
    for (const b of BLUEPRINTS) {
      expect(VoxelBlueprintSchema.parse(b)).toEqual(b);
      expect([b.version, b.kind, b.lattice, b.styleId]).toEqual([1, 'home', 'build', KIT.id]);
      expect(b.size).toEqual([SX, SY, SZ]);
    }
  });

  it('builds every finished home through the factory, identically on every call', () => {
    for (const b of BLUEPRINTS) {
      const variant = FAMILIES.indexOf(b.id.split('-')[2] as typeof FAMILIES[number]) as 0 | 1 | 2;
      const tier = HomeTierSchema.parse(b.id.split('-')[3]);
      expect(JSON.stringify(createHearthHome(tier, variant))).toBe(JSON.stringify(b));
      expect(JSON.stringify(createHearthHome(tier, variant))).toBe(JSON.stringify(createHearthHome(tier, variant)));
    }
  });

  it('rejects invalid tiers and variants', () => {
    expect(() => createHearthHome('palace' as HomeTier, 0)).toThrow(/tier/);
    expect(() => createHearthHome(undefined as unknown as HomeTier, 0)).toThrow(/tier/);
    for (const variant of [3, -1, 0.5, Number.NaN, '0']) expect(() => createHearthHome('hut', variant as 0)).toThrow(/variant/);
  });

  it('holds all fifteen homes: three families, five tiers each', () => {
    expect(BLUEPRINTS).toHaveLength(15);
    expect(Object.keys(HOME_REVIEW)).toHaveLength(15);
  });

  it('uses only the Hearth kit and its restrained natural accents', () => {
    for (const b of BLUEPRINTS) for (const box of b.boxes) expect(PALETTE.has(box.material), `${b.id} material ${box.material}`).toBe(true);
  });
});

describe.each(homes)('$family $tier', ({ home, tier }) => {
  const b = home.blueprint, g = grid(home);

  it('keeps the locked rear empty and does not pave the lot', () => {
    const rear = SZ - HOME_DEPTH_METRES[tier] * 8;
    let ground = 0;
    for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      if (!g.get(x, y, z)) continue;
      expect(z, `${b.id} occupies locked rear at ${x},${y},${z}`).toBeGreaterThanOrEqual(rear);
      if (y === 0) ground++;
    }
    expect(ground / (SX * (SZ - rear))).toBeLessThan(0.7);
  });

  it('connects every solid cell to the ground and carries porches and hoods on real supports', () => {
    const seen = new Uint8Array(g.cells.length), queue: number[] = [];
    let solids = 0;
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i]) solids++;
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) if (g.get(x, 0, z)) { const i = x + SX * SY * z; seen[i] = 1; queue.push(i); }
    while (queue.length) {
      const i = queue.pop()!, x = i % SX, y = Math.floor(i / SX) % SY, z = Math.floor(i / (SX * SY));
      for (const [nx, ny, nz] of [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]] as const) {
        const n = nx + SX * (ny + SY * nz);
        if (g.get(nx, ny, nz) && !seen[n]) { seen[n] = 1; queue.push(n); }
      }
    }
    expect(seen.reduce((n, v) => n + v, 0)).toBe(solids);
    expect(home.supports.length).toBeGreaterThan(0);
    for (const [x, z, y0, y1] of home.supports) {
      for (let y = y0; y < y1; y++) expect(g.get(x, y, z), `${b.id} support ${x},${z} breaks at y=${y}`).not.toBe(MAT.air);
    }
  });

  it('opens a walkable front door into every ground-floor room with steps of at most two cells', () => {
    const reached = reach(g);
    const [ex, ey, ez] = home.entrance;
    expect(g.get(ex, ey, ez)).toBe(MAT.air);
    expect(reached(ex, 2, ez), `${b.id}: doorway not reached from the street`).toBe(true);
    for (const [x, y, z] of home.rooms) expect(reached(x, y, z), `${b.id}: room ${x},${z} unreachable`).toBe(true);
    for (const { at: [x, , z] } of home.exits) expect(reached(x, 2, z), `${b.id}: garden door ${x},${z} unreachable`).toBe(true);
  });

  it('opens every garden door as a real doorway from a room to the open lot', () => {
    for (const { at: [x, y, z], facing } of home.exits) {
      expect(g.get(x, y, z)).toBe(MAT.air);
      const [dx, dz] = facing === 'north' ? [0, -1] : facing === 'south' ? [0, 1] : facing === 'east' ? [1, 0] : [-1, 0];
      // Outward to the lot edge through open air, and back into the room at least a metre.
      for (let s = 0; x + dx * s >= 0 && x + dx * s < SX && z + dz * s >= 0 && z + dz * s < SZ; s++) {
        expect(g.get(x + dx * s, y, z + dz * s), `${b.id} garden door blocked ${s} cells out`).toBe(MAT.air);
      }
      for (let s = 0; s < 8; s++) expect(g.get(x - dx * s, y, z - dz * s), `${b.id} garden door blocked ${s} cells in`).toBe(MAT.air);
      let head = y;
      while (!g.get(x, head, z)) head++;
      expect(head - 2).toBeGreaterThanOrEqual(20);
    }
  });

  it('puts its entrance marker in the doorway, open to the street and to the room behind', () => {
    const [ex, ey, ez] = home.entrance;
    for (let z = ez; z < SZ; z++) expect(g.get(ex, ey, z), `${b.id} doorway blocked at z=${z}`).toBe(MAT.air);
    for (let z = ez; z > ez - 8; z--) expect(g.get(ex, ey, z)).toBe(MAT.air);
    // The marker stands inside the wall thickness: solid wall on both sides of the opening.
    let left = ex, right = ex;
    while (!g.get(left, ey, ez) && left > 0) left--;
    while (!g.get(right, ey, ez) && right < SX - 1) right++;
    expect(right - left - 1).toBeGreaterThanOrEqual(10);
    expect(right - left - 1).toBeLessThanOrEqual(16);
    let head = ey;
    while (!g.get(ex, head, ez)) head++;
    expect(head - 2).toBeGreaterThanOrEqual(20);
  });

  it('keeps the weather out where wings and roofs meet: with the door shut, room air never reaches the open', () => {
    // Glass, timber and plaster are all solid; a shut door is a slab across the doorway inside the wall.
    const doors = [{ at: home.entrance, facing: 'south' }, ...home.exits];
    const YM = 100, rear = SZ - HOME_DEPTH_METRES[tier] * 8;
    const shut = (x: number, y: number, z: number) => doors.some(({ at: [ex, ey, ez], facing }) => {
      const [across, through] = facing === 'north' || facing === 'south' ? [x - ex, z - ez] : [z - ez, x - ex];
      return Math.abs(across) <= 8 && y <= ey + 14 && Math.abs(through) <= 1;
    });
    const seen = new Uint8Array(SX * YM * SZ), queue: number[] = [];
    for (const [x, y, z] of home.rooms) { const i = x + SX * (y + 4 + YM * z); seen[i] = 1; queue.push(i); }
    while (queue.length) {
      const i = queue.pop()!, x = i % SX, y = Math.floor(i / SX) % YM, z = Math.floor(i / (SX * YM));
      const open = x === 0 || x === SX - 1 || z <= rear || z === SZ - 1 || y === YM - 1;
      expect(open, `${b.id}: room air escapes at ${x},${y},${z}`).toBe(false);
      for (const [nx, ny, nz] of [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]] as const) {
        const n = nx + SX * (ny + YM * nz);
        if (!seen[n] && !g.get(nx, ny, nz) && !shut(nx, ny, nz)) { seen[n] = 1; queue.push(n); }
      }
    }
  });

  it('encloses each room under a roof', () => {
    for (const [x, y, z] of home.rooms) {
      let roofed = false;
      for (let up = y; up < SY; up++) if (g.get(x, up, z)) { roofed = true; break; }
      expect(roofed).toBe(true);
      // Walls close the room on every side but at most one, which may line up with an open doorway.
      const walled = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => {
        for (let s = 1; s < 64; s++) if (g.get(x + dx! * s, y + 8, z + dz! * s)) return true;
        return false;
      });
      expect(walled.length, `${b.id} room ${x},${z}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('places every window on real glass with a clear outward view to the lot edge', () => {
    expect(new Set(b.windows.map(w => w.id)).size).toBe(b.windows.length);
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
            expect(at(n), `${b.id}/${w.id} outward view blocked at ${u},${y},${n}`).toBe(MAT.air);
          }
        }
      }
      expect(glass / cells).toBeGreaterThanOrEqual(0.75);
    }
  });
});

describe('Hearth families grow without moving the address', () => {
  it.each(FAMILIES)('%s keeps its entrance and every earlier window as it grows', family => {
    const tiers = homes.filter(h => h.family === family).map(h => h.home);
    for (let i = 1; i < tiers.length; i++) {
      const [before, after] = [tiers[i - 1]!, tiers[i]!];
      expect(after.entrance).toEqual(before.entrance);
      expect(HOME_REVIEW[after.blueprint.id]).toEqual(HOME_REVIEW[before.blueprint.id]);
      for (const w of before.blueprint.windows) expect(after.blueprint.windows).toContainEqual(w);
      expect(after.blueprint.windows.length).toBeGreaterThan(before.blueprint.windows.length);
    }
  });

  it.each(FAMILIES)('%s grows backward into newly opened land with a new room, never moving its street front', family => {
    const tiers = homes.filter(h => h.family === family);
    for (let i = 1; i < tiers.length; i++) {
      const [before, after] = [tiers[i - 1]!, tiers[i]!];
      const [g0, g1] = [grid(before.home), grid(after.home)];
      // Everything from the doorway forward — door, step, porch, hood, planting — is the same cell for cell.
      const front = after.home.entrance[2] - 4;
      let changed = 0;
      for (let z = front; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) if (g0.get(x, y, z) !== g1.get(x, y, z)) changed++;
      expect(changed, `${after.home.blueprint.id} changes its street front`).toBe(0);
      // The new tier builds on land the previous tier could not use.
      const oldRear = SZ - HOME_DEPTH_METRES[before.tier] * 8;
      let opened = 0;
      for (let z = 0; z < oldRear; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) if (g1.get(x, y, z)) opened++;
      expect(opened, `${after.home.blueprint.id} does not use its opened land`).toBeGreaterThan(0);
      // At least one room stands where the previous tier had open sky.
      const fresh = after.home.rooms.filter(([x, y, z]) => {
        for (let up = y; up < SY; up++) if (g0.get(x, up, z)) return false;
        return true;
      });
      expect(fresh.length, `${after.home.blueprint.id} adds no room`).toBeGreaterThan(0);
    }
  });

  it.each(FAMILIES)('%s stays recognisable from the street as it grows', family => {
    const tiers = homes.filter(h => h.family === family).map(h => grid(h.home));
    const street = (g: Grid) => {
      const view = new Uint8Array(SX * SY);
      for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) if (g.get(x, y, z)) view[x + SX * y] = 1;
      return view;
    };
    for (let i = 1; i < tiers.length; i++) {
      const [a, c] = [street(tiers[i - 1]!), street(tiers[i]!)];
      let inter = 0, union = 0;
      a.forEach((v, k) => { inter += v & c[k]!; union += v | c[k]!; });
      expect(inter / union).toBeGreaterThanOrEqual(0.75);
    }
  });

  it.each(FINISHED)('three %s silhouettes that differ broadly in at least two of street, side and plan views', tier => {
    // Occupancy projections ignore colour entirely: this is the shape a viewer reads in a dim thumbnail.
    const views = FAMILIES.map(family => {
      const g = grid(homes.find(h => h.family === family && h.tier === tier)!.home);
      const street = new Uint8Array(SX * SY), side = new Uint8Array(SZ * SY), plan = new Uint8Array(SX * SZ);
      for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
        if (g.get(x, y, z)) { street[x + SX * y] = 1; side[z + SZ * y] = 1; plan[x + SX * z] = 1; }
      }
      return [street, side, plan] as const;
    });
    const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; a.forEach((v, k) => { i += v & b[k]!; u += v | b[k]!; }); return i / u; };
    for (let a = 0; a < 3; a++) for (let c = a + 1; c < 3; c++) {
      const overlap = [0, 1, 2].map(view => iou(views[a]![view]!, views[c]![view]!));
      const label = `${FAMILIES[a]} vs ${FAMILIES[c]} street/side/plan ${overlap.map(v => v.toFixed(2)).join('/')}`;
      expect(overlap.filter(v => v < 0.8).length, label).toBeGreaterThanOrEqual(2);
      expect(Math.max(...overlap), label).toBeLessThan(0.9);
    }
  });
});
