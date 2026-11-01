import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RealmFoundedScene } from '../../founded-world/types';
import { compileFoundedScene, foundedGroundAt } from '../../founded-world/collision';
import { foundedAnvilPosition } from '../../interactions/founded';
import { frameSettlement, settlementGround } from './frame';
import { landColumnsFor, SEAT_BAND_METRES, seatSettlement } from './seat';
import { gradeSettlement } from './grade';
import { grandGroundSource, grandKingdomLand } from './ground';
import { clearKingdomStructures, kingdomSites, STRUCTURE_STRIDE } from './sites';
import { KINGDOM_COVER, LAND_CELL, TREE_STRIDE, type GrandField, type GrandFieldSites } from './types';

const scene = JSON.parse(readFileSync(new URL('../../../../../apps/realm/src/founded/artifacts/simulated-town.scene.json', import.meta.url), 'utf8')) as RealmFoundedScene;

/** A plain test island: a cone of land with a ridge behind the town site, sea all round, a tree every 24 columns. */
function island(size = 2048): { field: GrandField; sites: GrandFieldSites } {
  const n = size * size, ground = new Uint16Array(n), water = new Uint16Array(n), cover = new Uint8Array(n), coast = new Int8Array(n);
  const sea = 48, c = size / 2, trees: number[] = [];
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const i = x + z * size, r = Math.hypot(x - c, (z - c) * 1.2) / (size * 0.42);
    const ridge = 160 * Math.exp(-(((z - c + 380) / 140) ** 2));
    const g = Math.round(sea - 30 + 52 * (1 - r) + (r < 1 ? ridge * (1 - r) : 0) + 3 * Math.sin(x * 0.05) * Math.cos(z * 0.04));
    ground[i] = Math.max(2, g);
    if (ground[i]! <= sea) { water[i] = sea; cover[i] = KINGDOM_COVER.sea; } else cover[i] = KINGDOM_COVER.grass;
    coast[i] = Math.max(-127, Math.min(127, Math.round((1 - r) * 200)));
    if (x % 24 === 0 && z % 24 === 0 && ground[i]! > sea) trees.push(x + 0.5, z + 0.5, ground[i]!, 0, x * 31 + z, 1);
  }
  const field: GrandField = { size, height: 384, seaLevel: sea, ground, water, cover, coast, trees: Float32Array.from(trees), treeCount: trees.length / TREE_STRIDE };
  const sites: GrandFieldSites = {
    castle: { x: c, z: c - 120, radius: 100, top: 110 }, town: { x: c, z: c, rx: 200, rz: 150, angle: 0, level: 56 },
    harbour: { x: c, z: c + 700, facing: Math.PI / 2 }, headland: { x: c + 300, z: c + 700, y: 50 }, fields: { x: c + 500, z: c, radius: 150 },
  };
  return { field, sites };
}

const column = (field: GrandField, x: number, z: number) => Math.floor(x / LAND_CELL) + Math.floor(z / LAND_CELL) * field.size;

describe('the grand kingdom seat', () => {
  const frame = frameSettlement(scene.plan);
  const { field, sites } = island();
  const seat = seatSettlement(field, sites, frame);
  const grade = gradeSettlement(field, seat, settlementGround(scene.plan));

  it('frames the installed physical region exactly as the founded compiler does', () => {
    const b = scene.plan.bounds;
    expect(frame.region.minX).toBe(Math.floor(b.minX / 16) * 16);
    expect(frame.region.minZ).toBe(Math.floor(b.minZ / 16) * 16);
    expect((frame.region.maxX - frame.region.minX) % 16).toBe(0);
    expect(frame.region.maxX).toBeGreaterThanOrEqual(b.maxX);
    expect(frame.waterLevel).toBe(scene.plan.lake.level);
    expect(frame.seaward).not.toBeNull();
  });

  it('seats by a half-metre translation that puts the town water on the sea', () => {
    for (const v of seat.offset) expect(Math.abs(v / LAND_CELL - Math.round(v / LAND_CELL))).toBeLessThan(1e-9);
    expect(seat.offset[1]).toBe(field.seaLevel * LAND_CELL - scene.plan.lake.level);
    expect(seat.fits).toBe(true);
    expect(seat.landShare).toBeGreaterThan(0.6);
    expect(grade.exact).toBe((seat.columns.x1 - seat.columns.x0) * (seat.columns.z1 - seat.columns.z0));
  });

  it('keeps exact physical support under every home, active street, square and the castle gate', () => {
    const plan = scene.plan, active = new Set(plan.activeStreetIds);
    const points = [
      ...plan.homes.map(h => h.position),
      ...plan.streets.filter(s => active.has(s.id)).flatMap(s => s.points),
      ...plan.nodes.filter(n => n.kind === 'market' || n.kind === 'castle-gate').map(n => n.position),
      foundedAnvilPosition(scene),
    ];
    expect(points.length).toBeGreaterThan(500);
    for (const p of points) {
      const physical = foundedGroundAt(plan, p[0], p[2])[1];
      const i = column(field, p[0] + seat.offset[0], p[2] + seat.offset[2]);
      expect(field.ground[i]! * LAND_CELL).toBe(physical + seat.offset[1]);
      expect(field.water[i]).toBe(0);
    }
  });

  it('paves the public ground and floods only the settlement’s own water', () => {
    expect(grade.paved).toBeGreaterThan(10_000);
    expect(grade.wet).toBeGreaterThan(1_000);
    const lake = scene.plan.lake;
    const i = column(field, lake.x + seat.offset[0], lake.z + seat.offset[2]);
    expect(field.water[i]! * LAND_CELL).toBe(lake.level + seat.offset[1]);
  });

  it('meets the natural land without a step at the region edge', () => {
    const { x0, z0, x1, z1 } = seat.columns;
    let worst = 0;
    for (let x = x0; x < x1; x++) for (const [inside, outside] of [[z0, z0 - 1], [z1 - 1, z1]] as const) {
      worst = Math.max(worst, Math.abs(field.ground[x + inside * field.size]! - field.ground[x + outside * field.size]!));
    }
    for (let z = z0; z < z1; z++) for (const [inside, outside] of [[x0, x0 - 1], [x1 - 1, x1]] as const) {
      worst = Math.max(worst, Math.abs(field.ground[inside + z * field.size]! - field.ground[outside + z * field.size]!));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('clears the land’s trees from the town and seats the rest on graded ground', () => {
    expect(grade.treesRemoved).toBeGreaterThan(0);
    const { x0, z0, x1, z1 } = seat.columns;
    for (let n = 0; n < field.treeCount; n++) {
      const x = Math.floor(field.trees[n * TREE_STRIDE]!), z = Math.floor(field.trees[n * TREE_STRIDE + 1]!);
      expect(x >= x0 && x < x1 && z >= z0 && z < z1).toBe(false);
      expect(field.trees[n * TREE_STRIDE + 2]).toBe(field.ground[x + z * field.size]);
    }
  });

  it('aims the land at the town and castle as drawn, and keeps the land’s own pieces off them', () => {
    const drawn = kingdomSites(field, seat, frameSettlement(scene.plan));
    const castle = scene.plan.castle.centre;
    expect(drawn.castle.x).toBe(Math.round((castle[0] + seat.offset[0]) / LAND_CELL));
    expect(drawn.castle.z).toBe(Math.round((castle[2] + seat.offset[2]) / LAND_CELL));
    const { x0, z0, x1, z1 } = seat.columns, r = drawn.reserve;
    expect(r.x0 < x0 && r.z0 < z0 && r.x1 > x1 && r.z1 > z1).toBe(true);
    for (const point of drawn.focus) expect(point.x >= x0 && point.x < x1 && point.z >= z0 && point.z < z1).toBe(true);
    expect(drawn.town.rx).toBeGreaterThan(20);
    // A windmill box far out on the land stays; a castle wing composed over the town goes.
    const boxes = Int32Array.from([r.x1 + 40, 60, r.z0, r.x1 + 44, 80, r.z0 + 4, 3, drawn.castle.x - 4, 60, drawn.castle.z - 4, drawn.castle.x + 4, 90, drawn.castle.z + 4, 4]);
    const cleared = clearKingdomStructures(boxes, 2, r);
    expect(cleared).toMatchObject({ count: 1, removed: 1 });
    expect(Array.from(cleared.structures.subarray(0, STRUCTURE_STRIDE))).toEqual(Array.from(boxes.subarray(0, STRUCTURE_STRIDE)));
  });

  it('asks for a land whose narrow axis holds the region, its band and a beach', () => {
    const frame = frameSettlement(scene.plan), columns = landColumnsFor(frame), r = frame.region;
    expect(columns % 128).toBe(0);
    // GK10's island is at its slimmest 0.54 of the land's side across.
    expect(columns * LAND_CELL * 0.54).toBeGreaterThanOrEqual((Math.max(r.maxX - r.minX, r.maxZ - r.minZ) + 2 * SEAT_BAND_METRES) * 1.2);
    expect(columns).toBe(2560);
  });

  it('is deterministic', () => {
    const again = island();
    const seat2 = seatSettlement(again.field, again.sites, frameSettlement(scene.plan));
    gradeSettlement(again.field, seat2, settlementGround(scene.plan));
    expect(seat2.offset).toEqual(seat.offset);
    expect(Buffer.from(again.field.ground.buffer).equals(Buffer.from(field.ground.buffer))).toBe(true);
  }, 60_000);
});

describe('the grand kingdom land seam', () => {
  it('answers exact physical ground inside the installed region and nothing outside it', () => {
    const source = grandGroundSource(scene), frame = frameSettlement(scene.plan);
    const home = scene.plan.homes[0]!.position;
    expect(source.sample(home[0], home[2])).toEqual(foundedGroundAt(scene.plan, home[0], home[2]));
    expect(source.sample(frame.region.maxX + 0.25, home[2])).toBeNull();
    expect(source.sample(frame.region.minX - 300, frame.region.minZ - 300)).toBeNull();
  });

  it('keeps the installed identities, Forge and moment anchors, with an approach only under real collision', () => {
    const plain = grandKingdomLand(scene);
    expect(plain.scene).toBe(scene);
    expect(plain.light.placements).toBe(scene.placements);
    expect(plain.paths.streets).toBe(scene.plan.streets);
    expect(plain.forge.anvil).toEqual(foundedAnvilPosition(scene));
    expect(plain.forge.approach).toBeNull();
    expect(plain.moments.plaza).not.toBeNull();
    expect(plain.moments.castleGate).not.toBeNull();
    const walked = grandKingdomLand(scene, compileFoundedScene(scene));
    expect(walked.forge.approach).not.toBeNull();
  }, 60_000);
});
