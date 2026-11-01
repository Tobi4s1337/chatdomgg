import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RealmFoundedScene } from '../../founded-world/types';
import { compileFoundedScene, foundedGroundAt } from '../../founded-world/collision';
import { foundedAnvilPosition } from '../../interactions/founded';
import { generateSettlementPlan } from '../../settlement/generator';
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
    // Paving is its own cover, and the rest of the town is the settlement's lawn, never the wild grass with flowers.
    let pavedCover = 0, wild = 0;
    for (let z = seat.columns.z0; z < seat.columns.z1; z++) for (let x = seat.columns.x0; x < seat.columns.x1; x++) {
      const i = x + z * field.size;
      if (grade.pavedMask[i]) { expect(field.cover[i]).toBe(KINGDOM_COVER.paved); pavedCover++; }
      else if (field.cover[i] === KINGDOM_COVER.grass || field.cover[i] === KINGDOM_COVER.meadow) wild++;
    }
    expect(pavedCover).toBe(grade.paved);
    expect(wild).toBe(0);
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

describe('the castle on its rock', () => {
  it('breaks the castle’s ground off at the region edge as a rock face, and leaves the exact region alone', () => {
    const frame = frameSettlement(scene.plan);
    const plain = island(), rocky = island();
    const seat = seatSettlement(plain.field, plain.sites, frame);
    const natural = Uint16Array.from(plain.field.ground);
    const eased = gradeSettlement(plain.field, seat, settlementGround(scene.plan));
    const crag = gradeSettlement(rocky.field, seat, settlementGround(scene.plan), frame.castle.bounds);
    const { x0, x1, z0, z1 } = seat.columns, size = plain.field.size;
    for (let z = z0; z < z1; z += 3) for (let x = x0; x < x1; x += 3) expect(rocky.field.ground[x + z * size]).toBe(plain.field.ground[x + z * size]);
    // Walk out of the region from the castle's nearest edge: 12 m out the crag has met the land, the plain band has not.
    const c = frame.castle.bounds, cx = Math.round(((c.minX + c.maxX) / 2 + seat.offset[0]) / LAND_CELL);
    const edges = [{ d: Math.abs((c.minZ + seat.offset[2]) / LAND_CELL - z0), at: (n: number) => cx + (z0 - 1 - n) * size },
      { d: Math.abs(z1 - (c.maxZ + seat.offset[2]) / LAND_CELL), at: (n: number) => cx + (z1 + n) * size }];
    const near = edges.sort((a, b) => a.d - b.d)[0]!;
    const out = near.at(Math.round(12 / LAND_CELL));
    expect(rocky.field.ground[out]).toBe(natural[out]);
    const step = Math.abs(plain.field.ground[near.at(0)]! - natural[near.at(0)]!);
    if (step > 4) expect(plain.field.ground[out]).not.toBe(natural[out]);
    expect(crag.rock).toBeGreaterThan(eased.rock);
    // Inland water above the sea stands only on ground the band did not cut down.
    const band = seat.band;
    for (let z = Math.max(0, z0 - band); z < Math.min(size, z1 + band); z += 2) for (let x = Math.max(0, x0 - band); x < Math.min(size, x1 + band); x += 2) {
      if (x >= x0 && x < x1 && z >= z0 && z < z1) continue;
      const i = x + z * size;
      if (rocky.field.water[i]! > rocky.field.seaLevel) expect(rocky.field.ground[i]).toBeGreaterThanOrEqual(natural[i]!);
    }
    expect(crag.exact).toBe(eased.exact);
  }, 60_000);
});

describe('the grand kingdom as it grows', () => {
  // A hamlet becomes a town on the same reserved addresses: the land around it must not move.
  const config = { seed: 'willowmere', firstYear: 2025, year: 2026 };
  const hamlet = generateSettlementPlan({ ...config, tier: 'hamlet' }), town = generateSettlementPlan({ ...config, tier: 'town' });
  const small = frameSettlement(hamlet), grown = frameSettlement(town);

  it('frames growth inside an envelope that building reserved plots does not change', () => {
    expect(town.homes.length).toBeGreaterThan(hamlet.homes.length);
    expect(grown.region).not.toEqual(small.region);
    expect(grown.envelope).toEqual(small.envelope);
    expect(grown.centre).toEqual(small.centre);
    for (const frame of [small, grown]) {
      expect(frame.envelope.minX).toBeLessThanOrEqual(frame.region.minX);
      expect(frame.envelope.maxX).toBeGreaterThanOrEqual(frame.region.maxX);
      expect(frame.envelope.minZ).toBeLessThanOrEqual(frame.region.minZ);
      expect(frame.envelope.maxZ).toBeGreaterThanOrEqual(frame.region.maxZ);
    }
    expect(landColumnsFor(grown)).toBe(landColumnsFor(small));
  });

  it('keeps the seat, and every home and door already built at the same place on the land', () => {
    const before = island(), after = island();
    const a = seatSettlement(before.field, before.sites, small), b = seatSettlement(after.field, after.sites, grown);
    expect(b.offset).toEqual(a.offset);
    for (const home of hamlet.homes) {
      const same = town.homes.find(next => next.id === home.id)!;
      expect(same.position).toEqual(home.position);
      expect(same.rotation).toBe(home.rotation);
    }
    // The town's new exact ground is graded in; land past the grown region's band is the same land either way.
    gradeSettlement(before.field, a, settlementGround(hamlet, small.region));
    gradeSettlement(after.field, b, settlementGround(town, grown.region));
    const band = SEAT_BAND_METRES / LAND_CELL, x0 = b.columns.x0 - band - 1, x1 = b.columns.x1 + band + 1;
    let compared = 0;
    for (let z = 0; z < after.field.size; z += 7) for (let x = 0; x < after.field.size; x += 7) {
      if (x >= x0 && x < x1 && z >= b.columns.z0 - band - 1 && z < b.columns.z1 + band + 1) continue;
      const i = x + z * after.field.size;
      expect(after.field.ground[i]).toBe(before.field.ground[i]);
      compared++;
    }
    expect(compared).toBeGreaterThan(10_000);
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
