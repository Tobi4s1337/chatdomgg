import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, MATERIALS } from '../../../materials';
import { landmarkPalette } from '../../../genesis-landmarks/kit';
import { meshCost } from '../../../places/water/piece-checks';
import { LANTERN_AND_OAR, createLanternAndOar, signMotif } from './index';

/** The blueprint executed into a dense grid, boxes in order, material zero carving. */
function voxels(blueprint: VoxelBlueprint) {
  const [sx, sy, sz] = blueprint.size, cells = new Uint16Array(sx * sy * sz);
  for (const { from, to, material } of blueprint.boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) cells.fill(material, from[0] + sx * (y + sy * z), to[0] + sx * (y + sy * z));
  }
  const at = (x: number, y: number, z: number): number => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? MAT.air : cells[x + sx * (y + sy * z)]!);
  return { cells, at, size: [sx, sy, sz] as const };
}

/** Occupied cells that no chain of face neighbours joins to a solid cell in the bottom layer. */
function floating(blueprint: VoxelBlueprint): number {
  const { cells, size: [sx, sy, sz] } = voxels(blueprint);
  const seen = new Uint8Array(cells.length), stack: number[] = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = x + sx * sy * z;
    if (cells[i]) { seen[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop()!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
      const j = nx + sx * (ny + sy * nz);
      if (cells[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
  }
  let loose = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] && !seen[i]) loose++;
  return loose;
}

/** One above the highest solid cell of a column. */
function surface(at: (x: number, y: number, z: number) => number, x: number, z: number, height: number): number {
  for (let y = height - 1; y >= 0; y--) if (at(x, y, z)) return y + 1;
  return 0;
}

const cell = (p: Vec3): Vec3 => [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
const registered = new Set(MATERIALS.materials.map(m => m.id));
const T = LANTERN_AND_OAR;

describe('The Lantern and Oar, PinkKittyRose’s river tavern', () => {
  const inn = createLanternAndOar(), { blueprint } = inn;
  const grid = voxels(blueprint), { at } = grid;
  const G = inn.ground;

  it('is a strict, deterministic Hearth civic blueprint within the content budgets', () => {
    expect(() => VoxelBlueprintSchema.parse(blueprint)).not.toThrow();
    expect(blueprint.id).toBe('genesis-pinkkitty-tavern-lantern-and-oar');
    expect(blueprint.kind).toBe('civic');
    expect(blueprint.styleId).toBe('hearth');
    expect(blueprint.lattice).toBe('build');
    expect(blueprint.size).toEqual([...inn.size]);
    expect(blueprint.size).toEqual([...T.size]);
    expect(Math.max(...blueprint.size)).toBeLessThanOrEqual(256);
    expect(blueprint.boxes.length).toBeLessThanOrEqual(2000);
    for (const box of blueprint.boxes) expect(registered.has(box.material)).toBe(true);
    const cost = meshCost(blueprint);
    expect(cost.occupied).toBeLessThanOrEqual(1_000_000);
    expect(cost.triangles).toBeLessThanOrEqual(250_000);
    expect(JSON.stringify(createLanternAndOar())).toBe(JSON.stringify(inn));
  });

  it('keeps every pane unlit: no window anchors, no seats, no ember materials, glass only over dark rooms', () => {
    expect(blueprint.windows).toEqual([]);
    expect(blueprint.seats).toBeUndefined();
    expect(blueprint.boxes.some(b => b.material === MAT.forgeCopper || b.material === MAT.goldLeaf)).toBe(false);
    // Every glass cell outside the lanterns has air on at least one side along X or Z: a pane, never a lamp block.
    const lamps = inn.fires.map(cell);
    const [sx, sy, sz] = grid.size;
    let blocks = 0;
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      if (at(x, y, z) !== MAT.glass) continue;
      if (lamps.some(([lx, ly, lz]) => Math.abs(x - lx) <= 2 && Math.abs(z - lz) <= 2 && y >= ly - 3 && y <= ly + 3)) continue;
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => at(x + dx!, y, z + dz!) === MAT.air).length;
      if (!open) blocks++;
    }
    expect(blocks).toBe(0);
  });

  it('builds in the Hearth kit with a light touch of the kingdom’s colours', () => {
    const allowed = new Set([...landmarkPalette('hearth'), MAT.brick, MAT.petal, MAT.paving]);
    for (const box of blueprint.boxes) expect(allowed.has(box.material), `material ${box.material}`).toBe(true);
    const counts = new Map<number, number>();
    for (const m of grid.cells) if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const share = (...ms: number[]) => ms.reduce((n, m) => n + (counts.get(m) ?? 0), 0) / total;
    expect(share(MAT.limestone, MAT.plaster, MAT.timber, MAT.terracotta, MAT.stone, MAT.cream)).toBeGreaterThan(0.85);
    expect(share(MAT.fabricViolet)).toBeGreaterThan(0);
    expect(share(MAT.fabricViolet)).toBeLessThan(0.01);
    expect(share(MAT.petal)).toBeGreaterThan(0);
  });

  it('stands 12–14 m across and 10–12 m deep, its ridge 10–13 m over the street and the stack above it', () => {
    const [x0, x1] = T.body.x, [z0, z1] = T.body.z;
    expect((x1 - x0) / 8).toBeGreaterThanOrEqual(12);
    expect((x1 - x0) / 8).toBeLessThanOrEqual(14);
    expect((z1 - z0) / 8).toBeGreaterThanOrEqual(10);
    expect((z1 - z0) / 8).toBeLessThanOrEqual(12);
    // The ridge over the middle of the main roof, and the west stack's head.
    const ridge = surface(at, 60, 77, grid.size[1]) - G;
    expect(ridge / 8).toBeGreaterThanOrEqual(10);
    expect(ridge / 8).toBeLessThanOrEqual(13);
    expect(at(60, ridge + G - 1, 77)).toBe(MAT.brick);
    let stack = 0;
    for (let x = 10; x < 30; x++) for (let z = 60; z < 90; z++) stack = Math.max(stack, surface(at, x, z, grid.size[1]));
    expect(stack - G).toBeGreaterThan(ridge + 8);
  });

  it('reads as a roof from above: tile covers most of the plan, the wing and porch gables break it', () => {
    const [x0, x1] = T.body.x, [z0, z1] = T.body.z;
    let tile = 0, n = 0;
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      const y = surface(at, x, z, grid.size[1]) - 1, m = at(x, y, z);
      n++;
      if (m === MAT.terracotta || m === MAT.brick || m === MAT.moss) tile++;
    }
    expect(tile / n).toBeGreaterThan(0.8);
    // The cross-wing's ridge runs out to the street over the bay, below the main ridge.
    const wingRidge = surface(at, 110, 130, grid.size[1]);
    expect(wingRidge).toBeLessThan(surface(at, 60, 77, grid.size[1]) - 12);
    expect(at(110, wingRidge - 1, 130)).toBe(MAT.brick);
  });

  it('sets the keeper’s door point on the ground before an open doorway with headroom and standing room', () => {
    const [dx, dy, dz] = inn.door;
    expect(dy).toBe(G);
    expect(dy).toBe(T.ground);
    const [ox0, ox1] = T.door.x;
    expect(dx).toBe((ox0 + ox1) / 2);
    // The ground under the point is paved and solid; the doorway in front of it is open to the leaf and its ironwork.
    expect(at(dx, dy - 1, dz)).not.toBe(MAT.air);
    let shut = 0;
    for (let x = ox0; x < ox1; x++) for (let y = dy; y < dy + T.door.height; y++) for (let z = T.door.leaf + 2; z < T.body.z[1]; z++) if (at(x, y, z)) shut++;
    expect(shut).toBe(0);
    for (let x = ox0; x < ox1; x++) for (let y = dy; y < dy + T.door.height; y++) expect([MAT.timber, MAT.bark]).toContain(at(x, y, T.door.leaf));
    expect(T.door.height / 8).toBeGreaterThanOrEqual(2.25);
    // Headroom of at least 2.25 m over a 1 m × 1 m standing square round the point, and the walk to the door.
    let blocked = 0;
    for (let x = dx - 4; x < dx + 4; x++) for (let z = T.body.z[1]; z < dz + 4; z++) for (let y = dy; y < dy + 18; y++) if (at(x, y, z)) blocked++;
    expect(blocked).toBe(0);
    for (let x = dx - 4; x < dx + 4; x++) for (let z = T.body.z[1] + 1; z < dz + 4; z++) expect(at(x, dy - 1, z), `${x},${z}`).not.toBe(MAT.air);
    // The street side of the porch is open to the keeper's route out.
    for (let z = dz; z < T.porch.front; z++) for (let y = dy; y < T.porch.tie; y++) expect(at(dx, y, z)).toBe(MAT.air);
  });

  it('puts a flame base over every lantern’s candle inside its glass, and the porch pair either side of the door', () => {
    expect(inn.fires.length).toBe(4);
    for (const f of inn.fires) {
      const [x, y, z] = cell(f);
      expect(at(x, y, z), `flame ${f}`).toBe(MAT.air);
      expect(at(x, y - 1, z), `candle ${f}`).toBe(MAT.cream);
      for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) expect(at(x + ox, y, z + oz), `cage ${f}`).toBe(MAT.glass);
      expect(at(x, y + 3, z), `hood ${f}`).toBe(MAT.brass);
      // A lantern burns in the open air, not inside a wall.
      expect(y).toBeGreaterThan(G + 8);
    }
    const [a, b] = inn.fires;
    expect(a![0]).toBeLessThan(inn.door[0]);
    expect(b![0]).toBeGreaterThan(inn.door[0]);
    expect(Math.abs((a![0] + b![0]) / 2 - inn.door[0])).toBeLessThanOrEqual(1);
  });

  it('hangs the sign board clear of the ground, the motif proud on both faces, from an arm joined to the wall', () => {
    const [x, y, z] = cell(inn.sign);
    expect(at(x, y, z)).not.toBe(MAT.air);
    expect(y - G).toBeGreaterThan(16);
    // Clear headroom under the board.
    for (let yy = G; yy < 41; yy++) expect(at(x, yy, z)).toBe(MAT.air);
    // The motif's lantern, oar, flame and lights all appear, standing proud of the field on the street face.
    const motif = signMotif().join('');
    for (const mark of ['k', 'c', 'o', 'a']) expect(motif.includes(mark)).toBe(true);
    let proud = 0;
    for (let xx = 2; xx < 18; xx++) for (let yy = 43; yy < 57; yy++) if (at(xx, yy, 120)) proud++;
    expect(proud).toBe([...motif].filter(c => c !== '.').length);
    expect(at(T.body.x[0] - 1, 63, 119)).toBe(MAT.darkStone);
    expect(at(T.body.x[0], 63, 119)).not.toBe(MAT.air);
  });

  it('gives the barrel top, the bench seat and the mooring tops air above solid', () => {
    for (const [name, p, under] of [['barrel', inn.barrel, MAT.bark], ['bench', inn.bench, MAT.timber]] as const) {
      const [x, y, z] = cell(p);
      expect(at(x, y, z), name).toBe(MAT.air);
      expect(at(x, y - 1, z), name).toBe(under);
    }
    const [bx, by, bz] = cell(inn.bench);
    expect(by - G).toBe(4);
    for (let y = by; y < by + 10; y++) expect(at(bx, y, bz)).toBe(MAT.air);
    expect(inn.moorings.length).toBe(2);
    const [jx0, jz0, jx1, jz1] = inn.jetty;
    for (const m of inn.moorings) {
      const [x, y, z] = cell(m);
      expect(at(x, y, z)).toBe(MAT.air);
      expect(at(x, y - 1, z)).not.toBe(MAT.air);
      expect(y).toBeGreaterThan(G);
      expect(x >= jx0 && x < jx1 && z >= jz0 && z < jz1).toBe(true);
      // The post runs solid from the bed to its top.
      for (let yy = 0; yy < y; yy++) expect(at(x, yy, z), `${m} at ${yy}`).not.toBe(MAT.air);
    }
  });

  it('lays the jetty deck at street level over piles that reach at least 2.5 m below it', () => {
    const [x0, z0, x1, z1] = inn.jetty;
    expect(z1).toBeLessThanOrEqual(inn.footprint[1]);
    for (const [x, z] of [[Math.floor((x0 + x1) / 2), Math.floor((z0 + z1) / 2)], [x0 + 6, z1 - 1], [x1 - 7, z0 + 6]] as const) expect(surface(at, x, z, G + 2), `${x},${z}`).toBe(G);
    let deepest = Infinity;
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) for (let y = 0; y < G - 4; y++) if (at(x, y, z)) deepest = Math.min(deepest, y);
    expect(G - deepest).toBeGreaterThanOrEqual(20);
  });

  it('founds its masonry a metre into the ground across the footprint, holding everything that meets the street', () => {
    const [x0, z0, x1, z1] = inn.footprint;
    expect(z0).toBe(T.quay.z[0]);
    for (const p of [inn.door, inn.barrel, inn.bench]) expect(p[0] >= x0 && p[0] < x1 && p[2] >= z0 && p[2] < z1).toBe(true);
    // Every column under the walls, porch, yard and apron is solid from the footing to the street.
    const rects: [number, number, number, number][] = [
      [T.body.x[0], T.body.z[0], T.body.x[1], T.body.z[1]], [T.wing.x[0], T.body.z[1], T.wing.x[1], T.wing.front],
      [T.porch.roof[0], T.body.z[1] + 1, T.porch.roof[1], T.porch.front], [T.yard.x[0], T.yard.z[0], T.yard.x[1], T.yard.z[1]],
    ];
    for (const [ax, az, bx, bz] of rects) for (let x = ax; x < bx; x++) for (let z = az; z < bz; z++) {
      for (let y = T.found; y < G; y++) expect(at(x, y, z), `${x},${y},${z}`).not.toBe(MAT.air);
    }
    // Nothing of the inn but the quay and the jetty reaches below the footing.
    let deep = 0;
    for (let x = 0; x < grid.size[0]; x++) for (let z = T.quay.z[1]; z < grid.size[2]; z++) for (let y = 0; y < T.found; y++) if (at(x, y, z)) deep++;
    expect(deep).toBe(0);
  });

  it('joins every occupied cell to the ground through face neighbours', () => {
    expect(floating(blueprint)).toBe(0);
  });
});
