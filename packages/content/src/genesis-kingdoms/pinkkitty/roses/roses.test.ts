import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, MATERIALS, STYLES } from '../../../materials';
import {
  createRiverCresset, createRoseArch, createRoseBush, createRosePlanter, roseArchFrame, RIVER_CRESSET, ROSE_ARCH_CLEAR_HEIGHT,
  ROSE_ARCH_POST, ROSE_BLOOM_MATERIALS, ROSE_BUSH_FORMS, ROSE_PLANTER_LENGTHS, type RoseBushVariant,
} from './index';

const FOLIAGE: readonly number[] = [MAT.leaf, MAT.moss];

/** The ordered boxes executed into a dense grid exactly as the rasterizer does: later boxes win, air carves. */
function raster(b: VoxelBlueprint) {
  const [sx, sy, sz] = b.size, cells = new Uint8Array(sx * sy * sz);
  const at = (x: number, y: number, z: number) => x + sx * (z + sz * y);
  for (const { from, to, material } of b.boxes)
    for (let y = from[1]; y < to[1]; y++) for (let z = from[2]; z < to[2]; z++) for (let x = from[0]; x < to[0]; x++) cells[at(x, y, z)] = material;
  const get = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? MAT.air : cells[at(x, y, z)]!);
  return { cells, get, size: b.size, at };
}
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

/** Every occupied cell reachable from a y = 0 cell through face neighbours: the README's structural rule. */
function ungrounded(b: VoxelBlueprint): number {
  const { cells, get, size: [sx, sy, sz], at } = raster(b), seen = new Uint8Array(cells.length), queue: number[] = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (get(x, 0, z)) { seen[at(x, 0, z)] = 1; queue.push(x, 0, z); }
  for (let i = 0; i < queue.length; i += 3) {
    const x = queue[i]!, y = queue[i + 1]!, z = queue[i + 2]!;
    for (const [dx, dy, dz] of FACES) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!get(nx, ny, nz) || seen[at(nx, ny, nz)]) continue;
      seen[at(nx, ny, nz)] = 1;
      queue.push(nx, ny, nz);
    }
  }
  let loose = 0;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (get(x, y, z) && !seen[at(x, y, z)]) loose++;
  return loose;
}

/**
 * Rose heads grouped into face-connected clusters of bloom material. Each cluster must touch plant tissue (leaf or
 * moss) through a face, so it sits on its plant, and must show at least one face to the air, so it is not buried.
 * Two exceptions are recognised and counted: petals fallen on a bush's earth bed, and the arch's brass crown boss.
 */
function heads(b: VoxelBlueprint) {
  const { get, size: [sx, sy, sz] } = raster(b), seen = new Set<string>(), clusters: { cells: number; onPlant: boolean; shows: boolean; fallen: boolean; emblem: boolean; at: string }[] = [];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (!ROSE_BLOOM_MATERIALS.includes(get(x, y, z)) || seen.has(`${x},${y},${z}`)) continue;
    const stack: [number, number, number][] = [[x, y, z]], cluster = { cells: 0, onPlant: false, shows: false, fallen: true, emblem: false, at: `${x},${y},${z}` };
    seen.add(`${x},${y},${z}`);
    while (stack.length) {
      const [cx, cy, cz] = stack.pop()!;
      cluster.cells++;
      // A petal lying on the bed is fallen, not a head: it must rest on earth at ground level.
      if (cy !== 0 || get(cx, cy + 1, cz) !== MAT.air || ![...FACES].some(([dx, , dz]) => get(cx + dx, 0, cz + dz) === MAT.earth)) cluster.fallen = false;
      for (const [dx, dy, dz] of FACES) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz, m = get(nx, ny, nz);
        if (FOLIAGE.includes(m)) cluster.onPlant = true;
        if (m === MAT.brass) cluster.emblem = true;
        if (m === MAT.air) cluster.shows = true;
        if (ROSE_BLOOM_MATERIALS.includes(m) && !seen.has(`${nx},${ny},${nz}`)) { seen.add(`${nx},${ny},${nz}`); stack.push([nx, ny, nz]); }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

const bushes = ([0, 1, 2, 3] as const).map(v => createRoseBush(v));
const arches = [32, 36, 40, 44, 48].map(w => createRoseArch(w));
const cresset = createRiverCresset();
const planters = ROSE_PLANTER_LENGTHS.map(l => createRosePlanter(l));
const all: readonly [VoxelBlueprint, number][] = [
  ...bushes.map(b => [b, 400] as [VoxelBlueprint, number]), ...arches.map(b => [b, 1200] as [VoxelBlueprint, number]),
  [cresset.blueprint, 300], ...planters.map(b => [b, 500] as [VoxelBlueprint, number]),
];
const registered = new Set(MATERIALS.materials.map(m => m.id));

describe('PinkKittyRose roses', () => {
  it('parse as strict Hearth build blueprints with registered materials, inside their budgets', () => {
    for (const [b, budget] of all) {
      expect(VoxelBlueprintSchema.safeParse(b).success, b.id).toBe(true);
      expect(b.styleId).toBe(STYLES.hearth.id);
      expect(b.lattice).toBe('build');
      expect(b.windows).toEqual([]);
      expect(b.id.startsWith('genesis-pinkkitty-')).toBe(true);
      expect(b.boxes.length, b.id).toBeLessThanOrEqual(budget);
      for (const box of b.boxes) expect(registered.has(box.material) && box.material !== MAT.air, b.id).toBe(true);
    }
    expect(bushes.every(b => b.kind === 'flora')).toBe(true);
    expect(arches.every(b => b.kind === 'civic')).toBe(true);
    expect([cresset.blueprint, ...planters].every(b => b.kind === 'prop')).toBe(true);
  });

  it('are deterministic and give every parameter its own id', () => {
    expect(([0, 1, 2, 3] as const).map(v => createRoseBush(v))).toEqual(bushes);
    expect([32, 36, 40, 44, 48].map(w => createRoseArch(w))).toEqual(arches);
    expect(createRiverCresset()).toEqual(cresset);
    expect(ROSE_PLANTER_LENGTHS.map(l => createRosePlanter(l))).toEqual(planters);
    const ids = all.map(([b]) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(createRoseArch(37).id).toBe('genesis-pinkkitty-rose-arch-w37');
    expect(createRoseArch().id).toBe('genesis-pinkkitty-rose-arch-w40');
    expect(new Set(bushes.map(b => JSON.stringify(b.boxes))).size).toBe(4);
  });

  it('refuse parameters they were not made for', () => {
    expect(() => createRoseBush(4 as RoseBushVariant)).toThrow();
    for (const w of [31, 49, 40.5]) expect(() => createRoseArch(w)).toThrow();
    expect(() => createRosePlanter(30 as 24)).toThrow();
  });

  it('stand on the ground: every occupied cell reaches y = 0 through face neighbours', () => {
    for (const w of [32, 33, 37, 40, 41, 45, 48]) expect(ungrounded(createRoseArch(w)), `arch ${w}`).toBe(0);
    for (const [b] of all) expect(ungrounded(b), b.id).toBe(0);
  });

  it('set every rose head on its plant, showing to the air, one or two cells big', () => {
    for (const [b] of all) {
      const found = heads(b);
      for (const head of found) {
        expect(head.onPlant || head.fallen || head.emblem, `${b.id} head at ${head.at}`).toBe(true);
        expect(head.shows, `${b.id} head at ${head.at}`).toBe(true);
      }
      expect(found.filter(h => h.fallen).length, b.id).toBeLessThanOrEqual(2);
      // The only rose not on a plant is the arch's brass crown boss, once on each face.
      expect(found.filter(h => !h.onPlant && h.emblem).length, b.id).toBe(b.kind === 'civic' ? 2 : 0);
    }
    // Bush heads are the 1–2-cell clusters the brief asks for (two touching heads may merge into a bigger patch).
    for (const b of bushes) {
      const found = heads(b), small = found.filter(h => h.cells <= 2).length;
      expect(found.length, b.id).toBeGreaterThanOrEqual(8);
      expect(small / found.length, b.id).toBeGreaterThan(0.8);
    }
  });

  it('size the bushes as clipped garden roses and colour them by variant', () => {
    for (const [i, b] of bushes.entries()) {
      const { get, size: [sx, sy, sz] } = raster(b), used = new Set<number>();
      let x0 = sx, x1 = 0, top = 0;
      for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        const m = get(x, y, z);
        if (!m) continue;
        used.add(m);
        if (y > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); top = Math.max(top, y + 1); }
      }
      expect((x1 - x0) * 0.125, b.id).toBeGreaterThanOrEqual(1);
      expect((x1 - x0) * 0.125, b.id).toBeLessThanOrEqual(1.5);
      expect(top * 0.125, b.id).toBeGreaterThanOrEqual(0.9);
      expect(top * 0.125, b.id).toBeLessThanOrEqual(1.4);
      expect(used.has(MAT.bark) && used.has(MAT.leaf) && used.has(MAT.moss), b.id).toBe(true);
      if (ROSE_BUSH_FORMS[i as RoseBushVariant].palette === 'rose') expect(used.has(MAT.petal), b.id).toBe(true);
      else expect(used.has(MAT.fabricViolet) && used.has(MAT.fabricMutedViolet), b.id).toBe(true);
      expect(used.has(MAT.fabricRed), b.id).toBe(true);
      // The stem meets the ground at the centre.
      expect(get(Math.floor(sx / 2) - 1, 0, Math.floor(sz / 2) - 1), b.id).toBe(MAT.bark);
    }
  });

  it('keep the arch opening clear for its full width, depth and 28 cells of height', () => {
    for (const w of [32, 33, 40, 47, 48]) {
      const b = createRoseArch(w), frame = roseArchFrame(w), { get } = raster(b);
      expect(b.size).toEqual([...frame.size]);
      expect(frame.opening.x[1] - frame.opening.x[0]).toBe(w);
      expect(frame.opening.x[0]).toBe(b.size[0] - frame.opening.x[1]);
      expect(b.size[2]).toBeGreaterThanOrEqual(6);
      expect(b.size[2]).toBeLessThanOrEqual(10);
      for (let x = frame.opening.x[0]; x < frame.opening.x[1]; x++)
        for (let y = 0; y < ROSE_ARCH_CLEAR_HEIGHT; y++) for (let z = 0; z < b.size[2]; z++) expect(get(x, y, z), `arch ${w} at ${x},${y},${z}`).toBe(MAT.air);
      // The opening is bounded by the posts' sides: something solid stands just outside it on both sides.
      let left = false, right = false;
      for (let y = 0; y < ROSE_ARCH_CLEAR_HEIGHT; y++) for (let z = 0; z < b.size[2]; z++) {
        left ||= get(frame.opening.x[0] - 1, y, z) !== MAT.air;
        right ||= get(frame.opening.x[1], y, z) !== MAT.air;
      }
      expect(left && right).toBe(true);
      // Everything below the clear height lies inside the two post footprints.
      for (let y = 0; y < ROSE_ARCH_CLEAR_HEIGHT; y++) for (let z = 0; z < b.size[2]; z++) for (let x = 0; x < b.size[0]; x++) {
        if (!get(x, y, z)) continue;
        expect(frame.posts.some(p => x >= p.x[0] && x < p.x[1] && z >= p.z[0] && z < p.z[1])).toBe(true);
      }
      // The footings are dark stone and the hoop carries brass and timber over the opening.
      for (const f of frame.footings) expect(get(f.x[0] + 1, 0, f.z[0] + 1)).toBe(MAT.darkStone);
      const mid = Math.floor(b.size[0] / 2);
      const column = Array.from({ length: b.size[1] }, (_, y) => get(mid, y, 4));
      expect(column.includes(MAT.timber)).toBe(true);
    }
    expect(ROSE_ARCH_POST.side * 2 + 40).toBe(createRoseArch().size[0]);
  });

  it('give the cresset an open basket with its fire point in the air above the ember bed', () => {
    const b = cresset.blueprint, { get } = raster(b), [fx, fy, fz] = cresset.fire;
    expect(cresset.fire).toEqual([...RIVER_CRESSET.fire]);
    expect(b.size[1] * 0.125).toBeGreaterThanOrEqual(3);
    expect(b.size[1] * 0.125).toBeLessThanOrEqual(3.4);
    // The fire point sits at a cell corner: the four cells around it are air, with embers or the cage beneath.
    for (const [x, z] of [[fx - 1, fz - 1], [fx, fz - 1], [fx - 1, fz], [fx, fz]]) {
      expect(get(x!, fy, z!)).toBe(MAT.air);
      expect([MAT.fabricGold, MAT.fabricOrange, MAT.bark, MAT.darkStone]).toContain(get(x!, fy - 1, z!));
    }
    // Open to the sky above the fire, all the way out of the basket.
    for (let y = fy; y < b.size[1]; y++) for (const [x, z] of [[fx - 1, fz - 1], [fx, fz]]) expect(get(x!, y, z!)).toBe(MAT.air);
    // The rim is a closed iron ring around the open mouth, with gaps between the bars below it.
    const { x: [mx0, mx1], z: [mz0, mz1], rim } = RIVER_CRESSET.mouth;
    for (let x = mx0; x < mx1; x++) { expect(get(x, rim, mz0)).not.toBe(MAT.air); expect(get(x, rim, mz1 - 1)).not.toBe(MAT.air); }
    let gaps = 0;
    for (let x = mx0; x < mx1; x++) if (get(x, rim - 1, mz0) === MAT.air) gaps++;
    expect(gaps).toBeGreaterThanOrEqual(3);
    // Embers glow inside the basket, and the base is stone.
    const inside = [21, 22].flatMap(y => [3, 4, 5, 6].flatMap(x => [3, 4, 5, 6].map(z => get(x, y, z))));
    expect(inside).toContain(MAT.fabricOrange);
    expect(inside).toContain(MAT.fabricGold);
    expect(get(5, 0, 5)).toBe(MAT.darkStone);
    expect(get(5, 2, 2)).toBe(MAT.limestone);
  });

  it('build the planters as limestone troughs with dark coping, earth and roses spilling over', () => {
    for (const b of planters) {
      const { get, size: [sx, sy, sz] } = raster(b), L = sx;
      expect(b.id).toBe(`genesis-pinkkitty-rose-planter-l${L}`);
      expect(get(5, 0, 4)).toBe(MAT.limestone);
      expect(get(0, 5, 4)).toBe(MAT.darkStone);
      expect(get(L - 1, 5, 4)).toBe(MAT.darkStone);
      // Earth inside, at least somewhere visible to the sky past the plants' ends.
      let earth = 0, spill = 0;
      for (let x = 0; x < sx; x++) for (let z = 0; z < sz; z++) if (get(x, 4, z) === MAT.earth) earth++;
      for (let x = 0; x < sx; x++) for (let y = 1; y < 6; y++) for (const z of [0, sz - 1]) if (FOLIAGE.includes(get(x, y, z))) spill++;
      expect(earth).toBeGreaterThan(L);
      expect(spill).toBeGreaterThan(3);
      // The trough body tops out at 0.75 m; foliage never goes past the coping's inner ends.
      for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (const x of [0, 1, L - 2, L - 1]) {
        const m = get(x, y, z);
        expect(FOLIAGE.includes(m) || ROSE_BLOOM_MATERIALS.includes(m), `${b.id} end at ${x},${y},${z}`).toBe(false);
      }
    }
  });
});
