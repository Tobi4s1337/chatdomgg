// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DISTANCE_SCALE } from '../map/camera';
import { caravanCount, caravanLayout, columnTail, MARCHER_SPACING_PX } from './caravan';
import { planRoad, rideSeconds, roadStretch, sampleRoad } from './geometry';
import { farScale, NEAR_SCALE, roadShot } from './shot';
import { roadHolding, RoadAtlasError } from './index';
import type { Settler } from '../data/model';

const A = { x: -521.85, y: -342.5 }, B = { x: -323.2, y: 153.5 };
const view = { width: 1920, height: 1080 };

describe('the road between two holdings', () => {
  it('leaves and enters each holding exactly, and the same pair always draws the same road', () => {
    const road = planRoad(A, B, 'a>b');
    expect(sampleRoad(road, 0)).toMatchObject({ x: A.x, y: A.y });
    const end = sampleRoad(road, 1);
    expect(end.x).toBeCloseTo(B.x, 6);
    expect(end.y).toBeCloseTo(B.y, 6);
    expect(planRoad(A, B, 'a>b').points).toEqual(road.points);
    expect(road.total).toBeGreaterThan(Math.hypot(B.x - A.x, B.y - A.y));
    expect(road.total).toBeLessThan(Math.hypot(B.x - A.x, B.y - A.y) * 1.2);
  });

  it('draws a stretch with exact ends, and nothing for an empty one', () => {
    const road = planRoad(A, B, 'a>b');
    const part = roadStretch(road, 0.25, 0.5);
    const start = sampleRoad(road, 0.25), stop = sampleRoad(road, 0.5);
    expect(part.slice(0, 2)).toEqual([start.x, start.y]);
    expect(part.slice(-2)).toEqual([stop.x, stop.y]);
    expect(roadStretch(road, 0.4, 0.4)).toEqual([]);
  });

  it('rides 12 to 30 seconds by distance, a sea lane bending wider', () => {
    const near = planRoad(A, { x: A.x + 10, y: A.y }, 'short');
    const far = planRoad(A, { x: A.x + 3000, y: A.y }, 'long');
    expect(rideSeconds(near, 5000)).toBe(12);
    expect(rideSeconds(far, 5000)).toBe(30);
    const sea = planRoad(A, B, 'a>b', true);
    expect(sea.sea).toBe(true);
    expect(sea.total).toBeGreaterThan(planRoad(A, B, 'a>b').total);
  });
});

describe('the torch column', () => {
  it('grows slowly with the travellers and never stands for a roster', () => {
    expect(caravanCount(0)).toBe(5);
    expect(caravanCount(23)).toBe(7);
    expect(caravanCount(612)).toBe(11);
    expect(caravanCount(100_000)).toBe(11);
  });

  it('keeps its spacing in screen pixels at every distance and draws only who is on the road', () => {
    const road = planRoad(A, B, 'a>b');
    for (const scale of [1.5, NEAR_SCALE]) {
      const column = caravanLayout(road, 0.5, 7, scale, 0);
      expect(column).toHaveLength(7);
      const gap = Math.hypot(column[1]!.x - column[0]!.x, column[1]!.y - column[0]!.y) * scale;
      expect(gap).toBeGreaterThan(MARCHER_SPACING_PX * 0.9);
      expect(gap).toBeLessThan(MARCHER_SPACING_PX * 1.1);
      expect(column[0]!.role).toBe('standard');
    }
    // At the source only the banner-bearer has stepped out; past the end, everyone has gone in.
    expect(caravanLayout(road, 0, 7, NEAR_SCALE, 0)).toHaveLength(1);
    expect(caravanLayout(road, 1 + columnTail(road, 7, NEAR_SCALE) + 1e-6, 7, NEAR_SCALE, 0)).toHaveLength(0);
  });
});

describe('the journey camera', () => {
  const road = planRoad(A, B, 'a>b');
  it('rises out of the source drawing, rides close, pulls back to hold the road, and arrives close', () => {
    const rising = roadShot(road, { rise: 0, travel: 0, wake: 0 }, view);
    expect(rising).toMatchObject({ x: A.x, y: A.y });
    expect(rising.scale).toBeCloseTo(NEAR_SCALE * 2.4);
    expect(roadShot(road, { rise: 1, travel: 0, wake: 0 }, view).scale).toBeCloseTo(NEAR_SCALE);
    const middle = roadShot(road, { rise: 1, travel: 0.5, wake: 0 }, view);
    expect(middle.scale).toBeCloseTo(farScale(road, view));
    expect(middle.scale).toBeGreaterThanOrEqual(DISTANCE_SCALE.continent * 0.9);
    const arrived = roadShot(road, { rise: 1, travel: 1, wake: 0 }, view);
    expect(arrived.x).toBeCloseTo(B.x, 6);
    expect(arrived.scale).toBeCloseTo(NEAR_SCALE);
    expect(roadShot(road, { rise: 1, travel: 1, wake: 1 }, view).scale).toBeCloseTo(NEAR_SCALE * 2.6);
  });
});

describe('the ends of a road', () => {
  const settler = (over: Partial<Settler> = {}): Settler => ({ index: 0, ordinal: 0, id: '41254337', login: 'pinkkittyrose', name: 'PinkKittyRose', freshUntil: 0, withheld: false,
    tier: 'town', tierRank: 2, foundingHolding: true, x: 12, y: -8, average: 140, game: null, region: 3, realm: 1, realmName: 'the Crossroads', ...over });

  it('rides to a holding whose name the survey is not serving just now, unnamed, for the caller to name', () => {
    const end = roadHolding(settler({ name: null, login: null }), 'raided');
    expect(end).toMatchObject({ id: '41254337', name: null, login: null, x: 12, y: -8, region: 3 });
  });

  it('refuses a withheld holding and a channel off the survey, saying which end', () => {
    expect(() => roadHolding(settler({ withheld: true }), 'raided')).toThrow(RoadAtlasError);
    try { roadHolding(settler({ withheld: true, name: 'PinkKittyRose' }), 'raided'); } catch (error) {
      expect(error).toMatchObject({ reason: 'withheld', message: 'The raided channel is not shown on the Atlas.' });
    }
    try { roadHolding(null, 'raiding'); } catch (error) {
      expect(error).toMatchObject({ reason: 'missing', message: 'The raiding channel has no holding on this survey of the Atlas.' });
    }
    expect.assertions(3);
  });
});
