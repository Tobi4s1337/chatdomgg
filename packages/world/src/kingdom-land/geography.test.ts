import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import { generateSettlementPlan } from '../settlement/generator';
import { createCastlePlan } from '../settlement/castle';
import { naturalTerrainHeight, samplePublicGround, settlementTerrainHeight } from '../settlement/terrain';
import type { SettlementPlan, StreetEdge } from '../settlement/types';
import { BRIDGE_SPAN, foundKingdomGeography, geographyBounds, LAND_FRAME, signedArea, WHEEL_HEAD_METRES } from './geography';
import { naturalLandHeight, sampleLandWater, waterKeepOut, waterSurfaceAt } from './surface';

const fingerprint = (values: readonly number[]) => {
  let hash = 2166136261;
  for (const byte of new Uint8Array(new Float64Array(values).buffer)) { hash ^= byte; hash = Math.imul(hash, 16777619) >>> 0; }
  return hash;
};
const config = (seed: string) => ({ seed, tier: 'town' as const, firstYear: 2022, year: 2026 });
const course = (land: ReturnType<typeof foundKingdomGeography>, id: string) => land.landform.streams.find(s => s.id === id)!;
const body = (land: ReturnType<typeof foundKingdomGeography>, id: string) => land.landform.waters.find(w => w.id === id)!;

describe('kingdom land geography', () => {
  it('leaves the installed version 1 surface exactly as it was', () => {
    const plan = generateSettlementPlan(config('chatdom'));
    const natural: number[] = [], graded: number[] = [], open: number[] = [];
    for (let z = -100; z < 300; z += 9.7) for (let x = -190; x < 260; x += 9.7) {
      natural.push(naturalTerrainHeight(plan.landform, x, z)); graded.push(settlementTerrainHeight(plan, x, z));
      const ground = samplePublicGround(plan, x, z); open.push(ground ? ground.height + ground.pavingDistance * 3 + ground.reservedDistance * 7 : -999);
    }
    expect([plan.revision, fingerprint(natural), fingerprint(graded), fingerprint(open)])
      .toEqual(['settlement:2:ce2be60e', 3470514567, 1534295510, 3254735638]);
    // Version 1 water queries read its own carved shore.
    const { lake } = plan.landform;
    expect(waterSurfaceAt(plan.landform, lake.x, lake.z)).toBe(lake.level);
    expect(waterSurfaceAt(plan.landform, lake.x + lake.radiusX * 1.4, lake.z)).toBeNull();
    const edge = sampleLandWater(plan.landform, lake.x + lake.radiusX * .9, lake.z)!;
    expect(edge.shoreDistance < 0).toBe(naturalTerrainHeight(plan.landform, lake.x + lake.radiusX * .9, lake.z) < lake.level);
  });

  it('founds the same land for a hamlet and the town it grows into, on every seed', () => {
    const seeds = ['chatdom', 'tobi4s_', 'a', 'kingdom-42', 'streamer_9000'];
    for (const seed of seeds) {
      const land = foundKingdomGeography(config(seed));
      expect(foundKingdomGeography({ seed, tier: 'hamlet', firstYear: 2025, year: 2025 })).toEqual(land);
      const bounds = geographyBounds(land);
      expect(bounds.minX >= LAND_FRAME.minX && bounds.maxX <= LAND_FRAME.maxX && bounds.minZ >= LAND_FRAME.minZ && bounds.maxZ <= LAND_FRAME.maxZ, seed).toBe(true);
      // One terrain request: the plan's 16 m margin keeps 32 chunks of 16 m on each axis, and every bed stays above the -4 m floor.
      expect(Math.ceil((LAND_FRAME.maxX + 16) / 16) - Math.floor((LAND_FRAME.minX - 16) / 16)).toBeLessThanOrEqual(32);
      expect(Math.ceil((LAND_FRAME.maxZ + 16) / 16) - Math.floor((LAND_FRAME.minZ - 16) / 16)).toBeLessThanOrEqual(32);
      for (const water of land.landform.waters) expect(water.level - water.depth).toBeGreaterThan(-4);

      const lake = body(land, 'lake'), pond = body(land, 'pond');
      expect(land.landform.lake).toEqual({ x: lake.x, z: lake.z, radiusX: lake.radiusX, radiusZ: lake.radiusZ, level: lake.level });
      expect(pond.radiusX * 2 >= 10 && pond.radiusZ * 2 >= 14).toBe(true);
      const upper = course(land, 'stream:upper'), lower = course(land, 'stream:lower'), leat = course(land, 'leat'), tailrace = course(land, 'tailrace');
      // Junction levels: into the pond, over the weir, out of the wheel, into the lake.
      expect(upper.points.at(-1)!.level).toBe(pond.level);
      expect(pond.level - lower.points[0]!.level).toBeGreaterThanOrEqual(.5);
      expect(pond.level - lower.points[0]!.level).toBeLessThanOrEqual(1);
      expect(lower.points.at(-1)!.level).toBe(lake.level);
      expect(pond.level - tailrace.points[0]!.level).toBeGreaterThanOrEqual(WHEEL_HEAD_METRES);
      const wheel = land.sites.find(site => site.id === 'water:wheel')!, wheelCentre = [wheel.position[0] + 1.25, wheel.position[2] + 3.5];
      const trough = Math.hypot(leat.points.at(-1)!.position[0] - wheelCentre[0]!, leat.points.at(-1)!.position[1] - wheelCentre[1]!);
      expect(trough >= 8 && trough <= 16).toBe(true);
      for (const stream of land.landform.streams) for (const [i, point] of stream.points.entries()) {
        // Every surface flows downhill above an actual carved bed.
        if (i) expect(point.level).toBeLessThanOrEqual(stream.points[i - 1]!.level);
        expect(naturalLandHeight(land.landform, ...point.position)).toBeLessThan(point.level);
      }
      // The bridge's clear span crosses a level, narrower pool, with dry landings either side.
      const bridge = land.sites.find(site => site.id === 'water:bridge')!, cx = bridge.position[0] + BRIDGE_SPAN.length / 2, cz = bridge.position[2] + BRIDGE_SPAN.width / 2;
      const under = lower.points.filter(point => Math.abs(point.position[1] - cz) <= BRIDGE_SPAN.width / 2 + 1);
      expect(new Set(under.map(point => point.level)).size).toBe(1);
      for (const point of under) expect(point.width).toBeLessThan(BRIDGE_SPAN.clear);
      for (const x of [cx - 3.75, cx + 3.75]) expect(waterKeepOut(land.landform, x, cz, .5)).toBe(false);
      expect(waterSurfaceAt(land.landform, cx, cz)).toBe(under[0]!.level);

      // Built ground stays dry; structures standing in water are the pier, boathouse, rock, weir and wheel.
      for (const site of land.sites) {
        expect(signedArea(site.footprint), site.id).toBeGreaterThan(0);
        if (['mill', 'sign'].includes(site.kind)) for (const [x, z] of site.footprint) expect(waterKeepOut(land.landform, x, z, .5), site.id).toBe(false);
      }
      for (const point of land.places.lookout.trail) expect(waterKeepOut(land.landform, point[0], point[2], 1)).toBe(false);
      const trail = land.places.lookout.trail;
      for (let i = 1; i < trail.length; i++) expect(Math.abs(trail[i]![1] - trail[i - 1]![1]) / Math.hypot(trail[i]![0] - trail[i - 1]![0], trail[i]![2] - trail[i - 1]![2])).toBeLessThan(.23);
      const rise = land.places.lookout.summit[1] - lake.level;
      expect(rise >= 26 && rise <= 30).toBe(true);
      expect(land.places.forest.clearing.radius).toBeGreaterThanOrEqual(9.6 + 8);
    }
  });

  it('keeps every metre of land within what the terrain skin can follow', () => {
    // The worker rounds each 0.5 m column (sampled 0.25 m in from a patch corner) to 0.5 m and lets a patch
    // corner sit at most 2 m from it: corners stay within 1.75 m of that sample, with the rounding to spare.
    for (const seed of ['chatdom', 'kingdom-42']) {
      const land = foundKingdomGeography(config(seed)), h = (x: number, z: number) => naturalLandHeight(land.landform, x, z);
      let worst = 0;
      for (let z = LAND_FRAME.minZ - 16; z < LAND_FRAME.maxZ + 16; z++) for (let x = LAND_FRAME.minX - 16; x < LAND_FRAME.maxX + 16; x++) {
        const column = h(x + .25, z + .25);
        worst = Math.max(worst, Math.abs(h(x, z) - column), Math.abs(h(x, z + 1) - column), Math.abs(h(x + 1, z + 1) - column), Math.abs(h(x + 1, z) - column));
      }
      expect(worst, seed).toBeLessThanOrEqual(1.75);
    }
  }, 120_000);

  it('masks each water to its own wet ground and never floats a sheet over lower land', () => {
    const land = foundKingdomGeography(config('chatdom')), pond = body(land, 'pond');
    const weir = land.sites.find(site => site.id === 'water:weir')!;
    let below = 0;
    for (let z = pond.z - 40; z <= pond.z + 60; z += .7) for (let x = pond.x - 40; x <= pond.x + 30; x += .7) {
      const surface = waterSurfaceAt(land.landform, x, z);
      if (surface === null) continue;
      expect(naturalLandHeight(land.landform, x, z)).toBeLessThanOrEqual(surface + 1e-9);
      expect(sampleLandWater(land.landform, x, z)!.surface).toBe(surface);
      // Downstream of the weir only the lower courses show, at their own lower levels.
      if (z > weir.position[2] + 4) { below++; expect(surface).toBeLessThan(pond.level); }
    }
    expect(below).toBeGreaterThan(100);
    expect(() => waterKeepOut(land.landform, 0, 0, -1)).toThrow();
    expect(() => sampleLandWater(land.landform, Number.NaN, 0)).toThrow();
  });

  it('opens the court to 40×24 m and keeps the accepted front curtains', () => {
    const land = foundKingdomGeography(config('chatdom')), old = createCastlePlan();
    for (const id of ['castle:front:0', 'castle:front:1']) {
      const was = old.modules.find(m => m.id === id)!, now = land.castle.modules.find(m => m.id === id)!;
      expect([now.position, now.size, now.rotation]).toEqual([was.position, was.size, was.rotation]);
    }
    const xs = land.places.court.boundary.map(p => p[0]), zs = land.places.court.boundary.map(p => p[1]);
    expect([Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]).toEqual([40, 24]);
    // The keep's inner door sill, not its compound's bounding edge.
    const keep = land.castle.modules.find(m => m.id === 'castle:keep')!;
    expect(land.places.court.keepDoor).toEqual([keep.position[0] + 16, keep.position[1] + 1.625, keep.position[2] + 21.125]);
    expect(naturalLandHeight(land.landform, 0, -48)).toBe(land.places.court.elevation);
  });

  it('grades trails as hillside shelves and never fills a channel beneath a crossing', () => {
    const land = foundKingdomGeography(config('chatdom')), base = generateSettlementPlan(config('chatdom'));
    const bridge = land.sites.find(site => site.id === 'water:bridge')!, cz = bridge.position[2] + 2, deck = bridge.position[1];
    const road: StreetEdge = { id: 'road:bridge', from: 'a', to: 'b', kind: 'lane', name: 'Mill Lane', width: 4, verge: 1,
      points: [[bridge.position[0] - 12, deck, cz], [bridge.position[0] + 20, deck, cz]] as Vec3[] };
    const trail: StreetEdge = { id: 'trail:lookout', from: 'c', to: 'd', kind: 'trail', name: 'Lookout path', width: 2, verge: .5,
      points: land.places.lookout.trail };
    const plan: SettlementPlan = { ...base, landform: land.landform, castle: land.castle, homes: [], reservations: [], courts: [],
      streets: [road, trail], activeStreetIds: [road.id, trail.id], lake: land.landform.lake };
    // Metre corners carry the authored grade: the one nearest the pool's centre keeps its carved bed.
    const cx = Math.round(bridge.position[0] + BRIDGE_SPAN.length / 2), corner = Math.round(cz);
    expect(waterSurfaceAt(land.landform, cx, corner)).not.toBeNull();
    expect(settlementTerrainHeight(plan, cx, corner)).toBe(Math.fround(naturalLandHeight(land.landform, cx, corner)));
    expect(settlementTerrainHeight(plan, Math.round(bridge.position[0] - 8), corner)).toBeCloseTo(deck, 4);
    const mid = land.places.lookout.trail[Math.floor(land.places.lookout.trail.length / 2)]!;
    expect(samplePublicGround(plan, mid[0], mid[2])).toMatchObject({ kind: 'trail', pavingDistance: Infinity });
    expect(samplePublicGround(plan, mid[0] + 12, mid[2] + 12)?.id).not.toBe(trail.id);
  });
});
