import { describe, expect, it } from 'vitest';
import { ContentSeatSchema, type VoxelAsset } from '@chatdom/shared';
import { rasterizeBlueprint } from '../../../../../voxel/src/index';
import { createRenderLodAsset } from '../../../../../voxel/src/lod';
import { MAT, MATERIALS } from '../../../materials';
import { createDressing, ELDER_OAK_SEAT, type DressingForm } from '../index';
import { grow } from './grammar';

type Cell = readonly [number, number, number];
const FOLIAGE = new Set<number>([MAT.leaf, MAT.moss, MAT.goldLeaf, MAT.grass]);
const WOOD = new Set<number>([MAT.bark, MAT.stone, MAT.cream, MAT.terracotta, MAT.darkStone, MAT.thatch]);
const TREES: readonly DressingForm[] = ['oak-old-a', 'oak-old-b', 'beech', 'elder-oak', 'pine-windbent', 'fir', 'birch', 'alder', 'sapling-staked', 'bramble-hedge', 'pear-espalier', 'woodland-clump'];
/** Free-standing trees with a bole: everything but the hedge, the espalier and the far clump. */
const STANDING: readonly DressingForm[] = ['oak-old-a', 'oak-old-b', 'beech', 'elder-oak', 'pine-windbent', 'fir', 'birch', 'alder', 'sapling-staked'];

/** The rasterized cells of an asset, indexed for fast neighbour queries. */
function grid(asset: VoxelAsset) {
  const [sx, sy, sz] = asset.size;
  const at = (x: number, y: number, z: number) => x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : asset.voxels[x + sx * (y + sy * z)]!;
  const each = (visit: (x: number, y: number, z: number, m: number) => void) => {
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) { const m = at(x, y, z); if (m) visit(x, y, z, m); }
  };
  return { size: asset.size, at, each };
}
const cache = new Map<DressingForm, ReturnType<typeof grid>>();
const cellsOf = (form: DressingForm) => cache.get(form) ?? cache.set(form, grid(rasterizeBlueprint(createDressing(form)))).get(form)!;

/** Face-connected groups of the cells that pass `keep`. */
function components(g: ReturnType<typeof grid>, keep: (m: number) => boolean): Cell[][] {
  const [sx, sy] = g.size, seen = new Set<number>(), groups: Cell[][] = [];
  const id = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  g.each((x, y, z, m) => {
    if (!keep(m) || seen.has(id(x, y, z))) return;
    const group: Cell[] = [], queue: Cell[] = [[x, y, z]];
    seen.add(id(x, y, z));
    while (queue.length) {
      const c = queue.pop()!;
      group.push(c);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const n: Cell = [c[0] + dx, c[1] + dy, c[2] + dz];
        if (keep(g.at(...n)) && !seen.has(id(...n))) { seen.add(id(...n)); queue.push(n); }
      }
    }
    groups.push(group);
  });
  return groups;
}

/** The front (looking along -Z) silhouette of an asset on its own cells, scaled by `scale` to the source lattice. */
function silhouette(asset: VoxelAsset, scale = 1): Set<string> {
  const out = new Set<string>(), g = grid(asset);
  g.each((x, y) => { for (let i = 0; i < scale; i++) for (let j = 0; j < scale; j++) out.add(`${x * scale + i},${y * scale + j}`); });
  return out;
}

function extent(cells: readonly Cell[], axis: 0 | 1 | 2): readonly [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const c of cells) { lo = Math.min(lo, c[axis]); hi = Math.max(hi, c[axis] + 1); }
  return [lo, hi];
}
/** The crown: every mass of foliage of at least 64 cells (moss pads on roots and limbs are smaller). */
const foliageOf = (form: DressingForm) => components(cellsOf(form), m => FOLIAGE.has(m)).filter(group => group.length >= 64).flat();

describe('tree grammar', () => {
  it('refuses a lobe that the form box would slice flat, and a limb that leaves it', () => {
    expect(() => grow([16, 16, 16]).lobe([4, 8, 8], [6, 4, 4])).toThrow('cut by');
    expect(() => grow([16, 16, 16]).limb([8, 0, 8], [20, 8, 8], 1, 1)).toThrow('leaves');
    expect(() => grow([16, 16, 16]).limb([8, 0, 8], [8, 8, 8], 0.5, 1)).toThrow('0.9');
  });

  it('writes every cell once and keeps fewer boxes than cells', () => {
    const t = grow([32, 32, 32]);
    t.bough([[16, 0, 16], [16, 12, 16]], 3, 2);
    t.cloud([16, 18, 16], [10, 8, 10], 3, 0.2);
    t.light(MAT.leaf, MAT.moss);
    const { boxes } = t.piece(), seen = new Set<string>();
    let cells = 0;
    for (const { from, to } of boxes) for (let x = from[0]; x < to[0]; x++) for (let y = from[1]; y < to[1]; y++) for (let z = from[2]; z < to[2]; z++) {
      const k = `${x},${y},${z}`; expect(seen.has(k)).toBe(false); seen.add(k); cells++;
    }
    expect(cells).toBe(t.cells.filter(Boolean).length);
    expect(boxes.length * 10).toBeLessThan(cells);
  });
});

describe('trees', () => {
  it.each(TREES)('%s: every mass of leaves is held by wood, and none is confetti', form => {
    const g = cellsOf(form);
    for (const group of components(g, m => FOLIAGE.has(m))) {
      expect(group.length, `${form} has a speck of ${group.length} leaf cells`).toBeGreaterThanOrEqual(form === 'pear-espalier' ? 4 : 8);
      // Held: some leaf of the mass touches a limb, or (a hedge or a far crown) the mass stands on the ground.
      const held = group.some(([x, y, z]) => y === 0 || [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => WOOD.has(g.at(x + dx!, y + dy!, z + dz!))));
      expect(held, `${form} has a leaf mass at ${group[0]} with nothing under it`).toBe(true);
    }
  });

  it.each(STANDING.filter(form => form !== 'sapling-staked'))('%s: a root flare spreads the foot wider than the bole', form => {
    const g = cellsOf(form), [sx, , sz] = g.size, wood = (y: number) => {
      const xs: number[] = [];
      for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (WOOD.has(g.at(x, y, z)) && g.at(x, y, z) !== MAT.thatch) xs.push(x);
      return Math.max(...xs) - Math.min(...xs) + 1;
    };
    expect(wood(0)).toBeGreaterThanOrEqual(wood(12) * 1.4);
  });

  it.each(['oak-old-a', 'oak-old-b', 'beech', 'elder-oak', 'alder', 'birch'] as const)('%s: a broad crown over a trunk that shows below it, never a lollipop', form => {
    const foliage = foliageOf(form), height = extent(foliage, 1)[1];
    const [x0, x1] = extent(foliage, 0), [z0, z1] = extent(foliage, 2), base = extent(foliage, 1)[0];
    // The crown fills more than the top half, is at least two-thirds as wide as the tree is tall, and still clears a
    // walker's head: trunks show only below it.
    expect(base).toBeLessThan(height * 0.55);
    expect(base).toBeGreaterThanOrEqual(form === 'birch' || form === 'alder' ? 20 : 32);
    expect(Math.max(x1 - x0, z1 - z0)).toBeGreaterThanOrEqual(height * (form === 'birch' || form === 'alder' ? 0.5 : form === 'beech' ? 0.65 : 0.75));
    // Authored asymmetry: the crown reaches further to one side of its bole than the other.
    const g = cellsOf(form), trunk: Cell[] = [];
    g.each((x, y, z, m) => { if (y === 12 && WOOD.has(m)) trunk.push([x, y, z]); });
    const [tx0, tx1] = extent(trunk, 0), [tz0, tz1] = extent(trunk, 2), mx = (tx0 + tx1) / 2, mz = (tz0 + tz1) / 2;
    expect(Math.max(Math.abs((x1 - mx) - (mx - x0)), Math.abs((z1 - mz) - (mz - z0)))).toBeGreaterThanOrEqual(3);
  });

  it.each(TREES)('%s: its LOD-4 silhouette keeps the full form', form => {
    const asset = rasterizeBlueprint(createDressing(form));
    const full = silhouette(asset), far = silhouette(createRenderLodAsset(asset, 4, MATERIALS.materials), 4);
    // LOD is conservative: the far form covers the near one. It may only thicken it, never lose a limb or a lobe.
    let covered = 0;
    for (const k of full) if (far.has(k)) covered++;
    expect(covered).toBe(full.size);
    expect(full.size / far.size).toBeGreaterThan(form === 'pear-espalier' || form === 'sapling-staked' || form === 'bramble-hedge' ? 0.4 : 0.7);
  });

  it('wind-bent pine leans and streams toward local +X, its roots gripping the windward side', () => {
    const foliage = foliageOf('pine-windbent'), g = cellsOf('pine-windbent');
    const cx = foliage.reduce((n, c) => n + c[0], 0) / foliage.length, ground: number[] = [];
    g.each((x, y) => { if (y === 0) ground.push(x); });
    expect(cx - 18).toBeGreaterThan(20);
    expect(Math.min(...ground)).toBeLessThan(8);
    expect([...new Set(foliage.map(c => g.at(...c)))].sort()).toEqual([MAT.leaf, MAT.moss].sort());
  });

  it('fir stands in whorled skirts that narrow to the tip', () => {
    const foliage = foliageOf('fir'), widths: number[] = [];
    for (let y = 0; y < 96; y += 2) { const row = foliage.filter(c => c[1] === y); widths.push(row.length ? extent(row, 0)[1] - extent(row, 0)[0] : 0); }
    // Each skirt flares out below the one above it: the width steps out again at least five times going down.
    let flares = 0;
    for (let i = 1; i < widths.length; i++) if (widths[i - 1]! > widths[i]! + 2) flares++;
    expect(flares).toBeGreaterThanOrEqual(5);
    let top = widths.length - 1; while (top > 0 && !widths[top]) top--;
    expect(top * 2).toBeGreaterThanOrEqual(80);
  });

  it('birch is pale-stemmed with dark bands, under a light gold-green crown', () => {
    const counts = new Map<number, number>();
    cellsOf('birch').each((x, y, z, m) => counts.set(m, (counts.get(m) ?? 0) + 1));
    expect(counts.get(MAT.cream)!).toBeGreaterThan(200);
    expect(counts.get(MAT.darkStone)!).toBeGreaterThanOrEqual(8);
    expect(counts.get(MAT.moss)!).toBeGreaterThan(counts.get(MAT.leaf) ?? 0);
    expect(counts.get(MAT.goldLeaf)!).toBeLessThan(counts.get(MAT.moss)! * 0.1);
  });

  it('the staked sapling is tied to a one-cell stake in its turned ring', () => {
    const g = cellsOf('sapling-staked');
    for (let y = 0; y < 17; y++) expect(g.at(11, y, 8)).toBe(MAT.thatch);
    expect(g.at(9, 12, 8)).toBe(MAT.cream);
    expect(g.at(10, 12, 8)).toBe(MAT.cream);
    let ring = 0;
    g.each((x, y, z, m) => { if (m === MAT.earth) { expect(y).toBe(0); ring++; } });
    expect(ring).toBeGreaterThan(20);
  });

  it('the bramble hedge stays below a stile, lower at both ends than in its run, and bears nothing to pick', () => {
    const g = cellsOf('bramble-hedge'), top = (x: number) => { let t = 0; g.each((cx, y) => { if (cx === x) t = Math.max(t, y + 1); }); return t; };
    expect(Math.max(...Array.from({ length: 32 }, (_, x) => top(x)))).toBeLessThanOrEqual(12);
    expect(top(1)).toBeLessThan(top(10));
    expect(top(30)).toBeLessThan(top(22));
    const materials = new Set<number>(); g.each((x, y, z, m) => materials.add(m));
    expect([...materials].every(m => m === MAT.bark || FOLIAGE.has(m))).toBe(true);
  });

  it('the pear espalier is trained flat in tiers, with blossom and no fruit', () => {
    const g = cellsOf('pear-espalier');
    const materials = new Set<number>(); g.each((x, y, z, m) => materials.add(m));
    expect([...materials].sort()).toEqual([MAT.bark, MAT.leaf, MAT.moss, MAT.cream].sort());
    // Four tiers of level arms reach out both sides of the stem.
    for (const y of [8, 16, 24]) { expect(g.at(6, y, 3)).toBe(MAT.bark); expect(g.at(42, y, 3)).toBe(MAT.bark); }
    let blossom = 0; g.each((x, y, z, m) => { if (m === MAT.cream) blossom++; });
    expect(blossom).toBeLessThanOrEqual(10);
  });

  it('the woodland clump is six crowns and a spire on short trunks, one mass at LOD 4', () => {
    const g = cellsOf('woodland-clump'), trunks = components({ ...g, each: v => g.each((x, y, z, m) => { if (y === 0) v(x, y, z, m); }) }, m => m === MAT.bark);
    expect(trunks).toHaveLength(7);
    const far = createRenderLodAsset(rasterizeBlueprint(createDressing('woodland-clump')), 4, MATERIALS.materials);
    expect(components(grid(far), m => FOLIAGE.has(m)).length).toBeLessThanOrEqual(3);
  });
});

describe('elder oak', () => {
  const g = cellsOf('elder-oak'), seat = ELDER_OAK_SEAT;

  it('is the eighteen-metre landmark of the forest edge', () => {
    const foliage = foliageOf('elder-oak');
    expect(extent(foliage, 1)[1]).toBeGreaterThanOrEqual(136);
    expect(extent(foliage, 0)[1] - extent(foliage, 0)[0]).toBeGreaterThanOrEqual(104);
  });

  it('publishes a real root seat facing +Z: a worn top to sit on, the bole for a back, open air for a sitter', () => {
    expect(ContentSeatSchema.parse(seat)).toEqual(seat);
    const [x, y, z] = seat.position;
    expect(seat.facing).toBe(0);
    expect(g.at(x, y - 1, z)).toBe(MAT.thatch);
    // A seat about half a metre high, its whole top worn pale across a metre and a half.
    expect(y * 0.125).toBeCloseTo(0.5);
    for (let sx = x - 6; sx < x + 6; sx++) expect(g.at(sx, y - 1, z)).toBe(MAT.thatch);
    // Room for a seated body: nothing above the seat for 1.25 m, the bole a little behind it.
    for (let sy = y; sy < y + 10; sy++) for (let sx = x - 3; sx <= x + 3; sx++) for (let sz = z; sz <= z + 2; sz++) expect(g.at(sx, sy, sz), `${sx},${sy},${sz}`).toBe(0);
    let back = 0;
    for (let sz = z - 1; sz > z - 8; sz--) if (WOOD.has(g.at(x, y + 4, sz))) { back = z - sz; break; }
    expect(back).toBeGreaterThan(0);
    // Feet rest on open turf, and the approach in front is clear to standing height.
    for (let sy = 0; sy < 4; sy++) expect(g.at(seat.rest[0], sy, seat.rest[2])).toBe(0);
    for (let sy = 0; sy < 15; sy++) expect(g.at(seat.approach[0], sy, seat.approach[2])).toBe(0);
  });

  it('carries a few small marks cut in the bark above the seat, and no more', () => {
    const marks: Cell[] = [];
    g.each((x, y, z, m) => { if (m === MAT.thatch && y >= 10) marks.push([x, y, z]); });
    expect(marks.length).toBeGreaterThanOrEqual(12);
    expect(marks.length).toBeLessThanOrEqual(30);
    for (const [x, y, z] of marks) { expect(g.at(x, y, z + 1)).toBe(0); expect(y).toBeLessThan(26); expect(Math.abs(x - seat.position[0])).toBeLessThan(10); }
  });
});
