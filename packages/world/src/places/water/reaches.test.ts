import { describe, expect, it } from 'vitest';
import { foundKingdomGeography } from '../../kingdom-land/geography';
import type { KingdomLandform, LandStream } from '../../kingdom-land/types';
import { deriveWaterReaches, flowAlong, MAX_FLOW, STILL_FLOW, type WaterReach } from './reaches';

const SEEDS = ['chatdom', 'tobi4s_', 'a', 'kingdom-42', 'streamer_9000', 'river'];
const land = (seed: string) => foundKingdomGeography({ seed, tier: 'town', firstYear: 2022, year: 2026 });
const reach = (reaches: readonly WaterReach[], id: string) => reaches.find(r => r.id === id)!;
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]!;

describe('water reaches on the founded land', () => {
  for (const seed of SEEDS) it(`reads flow along the supplied courses only, on ${seed}`, () => {
    const { landform, sites } = land(seed), reaches = deriveWaterReaches(landform);
    expect(deriveWaterReaches(landform)).toEqual(reaches);
    expect(reaches.map(r => r.id).sort()).toEqual(landform.streams.map(s => s.id).sort());
    for (const r of reaches) {
      const stream = landform.streams.find(s => s.id === r.id)!;
      // Every derived point is the supplied record: nothing re-routed, re-levelled or resampled.
      expect(r.points.map(p => [p.position, p.bed, p.level, p.width])).toEqual(stream.points.map(p => [p.position, p.bed, p.level, p.width]));
      r.points.forEach((p, i) => {
        // Downstream along the record, never back up it, never faster than the cap.
        const next = r.points[Math.min(i + 1, r.points.length - 1)]!, prev = r.points[Math.max(i - 1, 0)]!;
        expect(dot(p.tangent, [next.position[0] - prev.position[0], next.position[1] - prev.position[1]]), `${r.id} ${i}`).toBeGreaterThan(0);
        expect(dot(p.flow, p.tangent) >= -1e-9 || r.mouth.kind === 'water', `${r.id} ${i} runs upstream`).toBe(true);
        expect(p.speed).toBeLessThanOrEqual(MAX_FLOW + 1e-9);
        expect(p.depth).toBeGreaterThan(0);
      });
      // No step between neighbouring points sharper than a riffle's onset (0.6 m/s per metre).
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1]!, b = r.points[i]!, ds = b.s - a.s;
        expect(Math.hypot(b.flow[0] - a.flow[0], b.flow[1] - a.flow[1]) / Math.max(ds, 1), `${r.id} jumps at ${i}`).toBeLessThan(.6);
      }
    }

    // The joins the land drew: upper into the pond, over the weir, tailrace into the lower stream, into the lake.
    const upper = reach(reaches, 'stream:upper'), lower = reach(reaches, 'stream:lower');
    const leat = reach(reaches, 'leat'), tail = reach(reaches, 'tailrace');
    expect(upper.source.kind).toBe('spring');
    expect(upper.mouth).toMatchObject({ kind: 'water', id: 'pond', step: 0 });
    expect(lower.source).toMatchObject({ kind: 'fall', id: 'pond' });
    if (lower.source.kind === 'fall') expect(lower.source.drop).toBeGreaterThanOrEqual(.5);
    expect(lower.mouth).toMatchObject({ kind: 'water', id: 'lake', step: 0 });
    expect(leat.source).toMatchObject({ kind: 'water', id: 'pond', step: 0 });
    expect(leat.mouth.kind).toBe('open');
    expect(tail.source.kind).toBe('open');
    expect(tail.mouth).toMatchObject({ kind: 'water', id: 'stream:lower' });

    // Arriving in still water the flow comes to rest; joining a course it takes that course's own velocity.
    expect(lower.points.at(-1)!.speed).toBeLessThan(1e-9);
    expect(upper.points.at(-1)!.speed).toBeLessThan(1e-9);
    const end = tail.points.at(-1)!, into = lower.points.reduce((best, p) =>
      Math.hypot(p.position[0] - end.position[0], p.position[1] - end.position[1]) < Math.hypot(best.position[0] - end.position[0], best.position[1] - end.position[1]) ? p : best);
    expect(Math.hypot(end.flow[0] - into.flow[0], end.flow[1] - into.flow[1])).toBeLessThan(1e-6);
    // Leaving the pond the leat gathers from rest; over the weir the lower stream starts under way.
    expect(leat.points[0]!.speed).toBeLessThan(1e-9);

    // The level pool under the crossing is still, at most 15% of the open reach.
    const bridge = sites.find(site => site.kind === 'bridge')!, cx = bridge.position[0] + 4, cz = bridge.position[2] + 2;
    const pool = lower.points.filter(p => Math.abs(p.position[0] - cx) < 3 && Math.abs(p.position[1] - cz) <= 6);
    expect(pool.length).toBeGreaterThan(2);
    for (const p of pool) { expect(p.still).toBe(true); expect(p.speed).toBeLessThanOrEqual(.15 * lower.openSpeed); }
    expect(lower.openSpeed).toBeGreaterThan(STILL_FLOW * 3);
  });
});

// SIMULATED: a hand-drawn landform in the frozen v2 types, for flow behaviour the founded land does not isolate.
function channel(points: LandStream['points']): KingdomLandform {
  return { version: 2, seed: 7, ridge: { origin: [0, 0], bearing: 0, length: 200, width: 100, height: 2 },
    castleRise: { centre: [0, -500], radius: 10, height: 5 }, lake: { x: 0, z: 400, radiusX: 20, radiusZ: 20, level: 0 },
    hills: [], waters: [], streams: [{ id: 'brook', kind: 'stream', bank: 4, points }] };
}

describe('water reach flow', () => {
  it('runs faster through a narrows on the same fall, and creeps over a level stretch', () => {
    const points = Array.from({ length: 31 }, (_, i) => {
      const narrow = i >= 13 && i <= 17, level = i <= 20 ? 10 - i * .05 : 9;
      return { position: [0, i * 2] as const, level, bed: level - (narrow ? .5 : .8), width: narrow ? 1.5 : 3.5 };
    });
    const brook = deriveWaterReaches(channel(points))[0]!;
    const wide = brook.points[8]!, narrows = brook.points[15]!, flat = brook.points[27]!;
    expect(wide.slope).toBeCloseTo(narrows.slope, 6);
    expect(narrows.speed).toBeGreaterThan(wide.speed * 1.3);
    expect(flat.slope).toBe(0);
    expect(flat.still).toBe(true);
    expect(flat.speed).toBeGreaterThan(0);
    // Interpolated flow between points follows the records.
    const mid = flowAlong(brook, (wide.s + brook.points[9]!.s) / 2);
    expect(mid.speed).toBeGreaterThan(0);
    expect(mid.level).toBeCloseTo((wide.level + brook.points[9]!.level) / 2, 9);
  });
});
