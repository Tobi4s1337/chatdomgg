import { describe, expect, it } from 'vitest';
import { foundKingdomGeography, foundKingdomRoutes, naturalLandHeight, type KingdomGeography, type LandSite } from '@chatdom/world';
import {
  assertWaterPlaces, CELL, floatingFootings, placePieceAnchors, planWaterPlaces, toLocal, toWorld, WaterPlaceError, type WaterPlaceInput,
  type WaterPlacePlan,
} from '../../../../../../packages/world/src/places/water/index';
import { createHumpbackBridge } from '../../../../../../packages/content/src/places/water/bridge/index';
import { createMill } from '../../../../../../packages/content/src/places/water/mill/index';
import { createMillWheel, createWeir, wheelPitFrame } from '../../../../../../packages/content/src/places/water/millrace/index';
import { createFishingRock } from '../../../../../../packages/content/src/places/water/shore/index';
import { geographyFixture } from '../../../kingdom-land/geography-fixture';
import { WATER_PIECE_SPECS } from './specs';

const SEEDS = ['chatdom', 'tobi4s_', 'a', 'kingdom-42', 'streamer_9000', 'river'];
const geography = (seed: string) => foundKingdomGeography({ seed, tier: 'town', firstYear: 2022, year: 2026 });
const input = (land: KingdomGeography, extra: Partial<WaterPlaceInput> = {}): WaterPlaceInput => ({
  landform: land.landform, sites: land.sites, specs: WATER_PIECE_SPECS,
  destinations: { castle: [land.places.court.gate[0], land.places.court.gate[2]] }, ...extra,
});
const codes = (plan: WaterPlacePlan) => plan.needs.map(need => `${need.code}:${need.subject}`);
const near = (a: readonly number[], b: readonly number[], tolerance = 1e-9) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);
const withSite = (land: KingdomGeography, kind: LandSite['kind'], change: (site: LandSite) => LandSite | null) =>
  land.sites.flatMap(site => site.kind === kind ? (change(site) ?? []) : [site]);

describe('water places on the founded land', () => {
  for (const seed of SEEDS) it(`fits the real pieces to the supplied sites and courses on ${seed}`, () => {
    const land = geography(seed), plan = planWaterPlaces(input(land));
    expect(planWaterPlaces(input(land))).toEqual(plan);
    const { lake, mill } = plan;

    // Every static placement keeps its site's cardinal turn; nothing is yawed freely or moved off its site.
    const site = (kind: LandSite['kind']) => land.sites.find(item => item.kind === kind)!;
    for (const [kind, placement] of [['weir', mill.weir?.placement], ['wheel', mill.wheel?.pit], ['wheel', mill.wheel?.wheel],
      ['mill', mill.mill?.placement], ['bridge', mill.bridge?.placement], ['sign', mill.sign?.placement]] as const) {
      expect(placement, `${seed} ${kind}`).toBeTruthy();
      expect(placement!.turn).toBe(site(kind).turn);
    }

    // The lake place: the deck stands 0.6–0.8 m over the water and the head over enough water for boats.
    const pier = lake.pier!, water = lake.water!;
    expect(water.id).toBe('lake');
    expect(pier.deckAboveWater).toBeGreaterThanOrEqual(.6);
    expect(pier.deckAboveWater).toBeLessThanOrEqual(.8);
    expect(pier.shore).toBeGreaterThan(0);
    expect(pier.shore).toBeLessThan(pier.walk.length);
    // Piles beyond the shore land on the bed, which the grid samples from the land's own surface.
    const g = pier.foundation, k = Math.floor(g.rows / 2), i = Math.floor(g.columns / 2);
    const probe = toWorld(pier.frame, [g.min[0] + i * g.step, 0, g.min[1] + k * g.step]);
    expect(g.heights[k * g.columns + i]).toBe(naturalLandHeight(land.landform, probe[0], probe[2]));
    expect(g.heights[k * g.columns + i]).toBeLessThan(water.level);
    // The fishing rock is built for the real water at its site and never floats over the bed.
    const rock = lake.rock!;
    const rockPiece = createFishingRock('grove', 0, rock.water);
    expect(rockPiece.blueprint.size[1]).toBeGreaterThan(rock.water);
    expect(rock.base).toBeLessThanOrEqual(Math.min(...rock.site.footprint.map(([x, z]) => naturalLandHeight(land.landform, x, z))) + 1e-9);

    // The weir: its crest holds the pond's surface and its tail water is the lower stream's first level.
    const weir = mill.weir!, lower = plan.reaches.find(r => r.id === 'stream:lower')!;
    expect(weir.crest[0][1]).toBeCloseTo(weir.pondLevel, 9);
    expect(weir.tailLevel).toBeCloseTo(lower.points[0]!.level, 9);
    const weirPiece = createWeir('grove', weir.factory.width, weir.factory.drop);
    expect(weirPiece.blueprint.size).toEqual(weir.placement.size);

    // The wheel turns on the land's hub line: the pit's frame and the wheel's own axle mount land on one point,
    // the trough begins exactly at the leat's end, and the mill's shaft collar lies on the axle line.
    const wheel = mill.wheel!, leat = plan.reaches.find(r => r.kind === 'leat')!;
    const pf = wheelPitFrame(wheel.factory.run);
    const axle = placePieceAnchors(wheel.wheel, createMillWheel('grove')).mounts.find(m => m.id === 'axle')!;
    expect(near(axle.pivot, wheel.hub)).toBe(true);
    expect(near(axle.axis, wheel.axis)).toBe(true);
    expect(near([wheel.leatEnd[0], wheel.leatEnd[2]], leat.points.at(-1)!.position, CELL / 2)).toBe(true);
    expect(wheel.factory.feet).toHaveLength(pf.trestles.length);
    expect(wheel.lipOverWheel).toBeGreaterThanOrEqual(.3);
    expect(wheel.lipOverWheel).toBeLessThanOrEqual(.5);
    const shaft = placePieceAnchors(mill.mill!.placement, createMill('grove')).mounts.find(m => m.id === 'shaft')!;
    expect(near(shaft.pivot, mill.mill!.shaft)).toBe(true);
    const offset = [shaft.pivot[0] - wheel.hub[0], shaft.pivot[1] - wheel.hub[1], shaft.pivot[2] - wheel.hub[2]];
    const along = offset[0]! * wheel.axis[0] + offset[1]! * wheel.axis[1] + offset[2]! * wheel.axis[2];
    expect(Math.hypot(offset[0]! - along * wheel.axis[0], offset[1]! - along * wheel.axis[1], offset[2]! - along * wheel.axis[2])).toBeLessThan(1e-9);
    expect(near(shaft.axis, wheel.axis)).toBe(true);

    // The bridge: its arch axis over the pool's centreline, its bed the pool bed, its deck ends at the bank tops.
    const bridge = mill.bridge!, piece = createHumpbackBridge('hearth', bridge.factory.water, bridge.factory.bank);
    const anchors = placePieceAnchors(bridge.placement, piece);
    const arch = anchors.sounds.find(s => s.id === 'arch')!;
    const poolPoint = lower.points.reduce((best, q) => Math.hypot(q.position[0] - arch.position[0], q.position[1] - arch.position[2])
      < Math.hypot(best.position[0] - arch.position[0], best.position[1] - arch.position[2]) ? q : best);
    expect(Math.abs(toLocal(bridge.placement, [poolPoint.position[0], 0, poolPoint.position[1]])[0] - 9)).toBeLessThan(1e-9);
    expect(bridge.placement.origin[1]).toBe(bridge.pool.bed);
    expect(near(anchors.walks[0]!.ends[0], bridge.ends[0])).toBe(true);
    expect(near(anchors.walks[0]!.ends[1], bridge.ends[1])).toBe(true);
    expect(bridge.pool.speed).toBeLessThanOrEqual(.15 * bridge.pool.openSpeed);
    // Lamps and seats come from the piece itself: four newel lamps, coping seats at sitting height over the deck.
    expect(anchors.emitters).toHaveLength(4);
    expect(anchors.seats.length).toBeGreaterThan(0);
    expect(floatingFootings(land.landform, anchors)).toEqual([]);

    // The fingerpost points only at the destinations supplied.
    expect(mill.sign!.arms.map(arm => arm.destination)).toEqual(['castle']);
    const arm = mill.sign!.arms[0]!;
    expect(Math.cos(arm.yaw)).toBeCloseTo(Math.sin(arm.bearing), 9);

    // Needs are reported, never thrown by the planner; production mounts refuse them.
    for (const need of plan.needs) expect(need.message.length).toBeGreaterThan(10);
    if (plan.needs.length) expect(() => assertWaterPlaces(plan)).toThrow(WaterPlaceError);
    else expect(assertWaterPlaces(plan)).toBe(plan);
  });

  it('changes its revision with the land and the pieces', () => {
    const land = geography('chatdom'), plan = planWaterPlaces(input(land));
    expect(planWaterPlaces(input(geography('river'))).revision).not.toBe(plan.revision);
    expect(planWaterPlaces({ ...input(land), specs: { ...WATER_PIECE_SPECS, fingerpost: { plan: 14 } } }).revision).not.toBe(plan.revision);
  });
});

describe('water places refuse bad geography', () => {
  const land = geography('chatdom'), base = planWaterPlaces(input(land));

  it('names missing, duplicated and turned sites', () => {
    expect(codes(planWaterPlaces(input(land, { sites: withSite(land, 'wheel', () => null) })))).toContain('site-missing:wheel');
    const twice = withSite(land, 'rock', s => s);
    expect(codes(planWaterPlaces(input(land, { sites: [...twice, land.sites.find(s => s.kind === 'rock')!] })))).toContain('site-duplicate:rock');
    expect(codes(planWaterPlaces(input(land, { sites: withSite(land, 'mill', s => ({ ...s, turn: 1 })) })))).toContain('site-turn:water:mill');
    expect(codes(planWaterPlaces(input(land, { sites: withSite(land, 'weir', s => ({ ...s, turn: 2 })) })))).toContain('site-turn:water:weir');
    expect(codes(planWaterPlaces(input(land, { sites: withSite(land, 'pier', s => ({ ...s, position: [s.position[0], s.position[1] + .5, s.position[2]] })) }))))
      .toContain('site-datum:water:pier');
    // A bridge turned to run along the pool cannot span it.
    const along = planWaterPlaces(input(land, { sites: withSite(land, 'bridge', s => ({ ...s, turn: 1 })) }));
    expect(along.needs.some(need => need.code === 'bridge' && /cross square/.test(need.message))).toBe(true);
  });

  it('names water steps, missing courses and dangling joins', () => {
    const streams = land.landform.streams;
    const raised = streams.map(s => s.id === 'tailrace' ? { ...s, points: s.points.map((p, i, all) => i === all.length - 1 ? { ...p, level: p.level - .5, bed: p.bed - .5 } : p) } : s);
    const lifted = planWaterPlaces(input(land, { landform: { ...land.landform, streams: raised } }));
    expect(lifted.needs.some(need => need.code === 'reach-join' && need.subject === 'tailrace')).toBe(true);
    const noLeat = planWaterPlaces(input(land, { landform: { ...land.landform, streams: streams.filter(s => s.kind !== 'leat') } }));
    expect(codes(noLeat)).toContain('reach-missing:leat');
    expect(noLeat.mill.wheel).toBeNull();
    // A leat that ends beside the wheel's line misses the trough.
    const astray = streams.map(s => s.kind === 'leat' ? { ...s, points: s.points.map((p, i, all) => i === all.length - 1 ? { ...p, position: [p.position[0] + 2, p.position[1]] as const } : p) } : s);
    expect(codes(planWaterPlaces(input(land, { landform: { ...land.landform, streams: astray } })))).toContain('trough:leat');
  });

  it('names a flowing bridge pool, the legacy landform and a sign with nowhere to point', () => {
    // The lower stream redrawn on one even fall from the weir to the lake: no level pool under the crossing.
    const sloped = land.landform.streams.map(s => {
      if (s.id !== 'stream:lower') return s;
      const first = s.points[0]!.level, last = s.points.at(-1)!.level, n = s.points.length - 1;
      return { ...s, points: s.points.map((p, i) => ({ ...p, level: first + (last - first) * i / n, bed: first + (last - first) * i / n - (p.level - p.bed) })) };
    });
    const flowing = planWaterPlaces(input(land, { landform: { ...land.landform, streams: sloped } }));
    expect(flowing.needs.some(need => need.code === 'bridge' && /flows at/.test(need.message))).toBe(true);
    const legacy = planWaterPlaces(input(land, { landform: { ...land.landform, version: 1 } as never }));
    expect(codes(legacy)).toEqual(['land-version:landform']);
    expect(codes(planWaterPlaces(input(land, { destinations: {} })))).toContain('sign:water:sign');
    expect(base.needs.every(need => need.code !== 'sign')).toBe(true);
  });
});

// SIMULATED: today's installed town re-seated on the founded land stands in for LD01's streets (geography-fixture.ts).
describe('water places meet the public walks', () => {
  it('lands the pier walk on its routes and asks for the bridge walk to be rebound', { timeout: 60_000 }, () => {
    const { plan: town, land } = geographyFixture('chatdom');
    const routes = foundKingdomRoutes(land, town);
    const plan = planWaterPlaces(input(land, { nodes: [...town.nodes, ...routes.nodes] }));
    expect(plan.needs.filter(need => need.subject.startsWith('land:pier'))).toEqual([]);
    const head = routes.nodes.find(node => node.id === 'land:pier:head')!;
    expect(Math.abs(head.position[1] - plan.lake.pier!.deck)).toBeLessThanOrEqual(CELL / 2);
    // The interim footbridge's walk nodes sit below the humpback deck: an integrator rebinding, never a silent pass.
    const bridgeNeeds = plan.needs.filter(need => need.code === 'path-join' && need.subject.startsWith('land:bridge'));
    for (const need of bridgeNeeds) expect(need.owner).toBe('integrator');
  });
});
