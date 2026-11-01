import { describe, expect, it } from 'vitest';
import { createSoulSampler, DEFAULT_SOUL_TOPOLOGY, SOUL_DUSK_HOUR, soulAt, type SoulConfig } from './index';

const config: SoulConfig = { seed: 427, biome: 'coastal', population: 9 };
const time = (month: number, day: number, hour = 0) => Date.UTC(2026, month, day, hour);

describe('kingdom soul', () => {
  it('is deterministic across offline jumps and repeated samples', () => {
    const t = time(1, 17, 18);
    const offline = soulAt(config, t);
    for (let h = 0; h < 24; h++) soulAt(config, t - h * 3_600_000);
    expect(soulAt(config, t)).toEqual(offline);
    expect(soulAt({ ...config, seed: 428 }, t).weather).not.toEqual(offline.weather);
  });
  it('keeps weather and accumulated surfaces continuous over midnight', () => {
    const t = time(0, 10);
    const a = soulAt(config, t - 1000).weather;
    const b = soulAt(config, t + 1000).weather;
    for (const key of ['rain', 'snow', 'wetness', 'snowCover', 'fog', 'wind', 'cloud'] as const) expect(Math.abs(a[key] - b[key])).toBeLessThan(.01);
  });
  it('accumulates rain and snow while keeping surface amounts bounded', () => {
    let rainy = 0; let snowy = 0; let warm = 0;
    for (let d = 0; d < 365; d++) {
      const frame = soulAt({ ...config, biome: 'highland' }, time(0, 1) + d * 86_400_000);
      expect(frame.weather.wetness).toBeGreaterThanOrEqual(0);
      expect(frame.weather.wetness).toBeLessThanOrEqual(1);
      expect(frame.weather.snowCover).toBeGreaterThanOrEqual(0);
      expect(frame.weather.snowCover).toBeLessThanOrEqual(1);
      rainy = Math.max(rainy, frame.weather.wetness);
      snowy = Math.max(snowy, frame.weather.snowCover);
      if (frame.weather.temperature > 10) warm = Math.max(warm, frame.weather.snowCover);
    }
    expect(rainy).toBeGreaterThan(.05);
    expect(snowy).toBeGreaterThan(.05);
    expect(warm).toBe(0);
  });
  it('has plain keepers without presence lights and no invented harbour', () => {
    const hamlet = soulAt({ ...config, biome: 'meadow', topology: { ...DEFAULT_SOUL_TOPOLOGY, harbour: false } }, time(4, 2, 18));
    expect(hamlet.keepers.map(k => k.role)).toContain('baker');
    expect(hamlet.keepers.map(k => k.role)).toContain('lamplighter');
    expect(hamlet.keepers.every(k => k.light === false)).toBe(true);
    expect(hamlet.keepers.some(k => k.role === 'harbour-master')).toBe(false);
    expect(hamlet.shipBell).toBe(false);
  });
  it('follows solstice and equinox dates and steps keepers inside when streets fill', () => {
    expect(soulAt(config, time(2, 19)).season).toBe('winter');
    expect(soulAt(config, time(2, 20)).season).toBe('spring');
    expect(soulAt(config, time(5, 21)).season).toBe('summer');
    expect(soulAt(config, time(8, 22)).season).toBe('autumn');
    expect(soulAt(config, time(11, 21)).season).toBe('winter');
    expect(soulAt({ ...config, population: 12 }, time(4, 2, 18)).keepers.every(k => !k.visible)).toBe(true);
  });
  it('only rings on an explicit witnessed harbour arrival', () => {
    const t = time(4, 2, 13);
    expect(soulAt(config, t).shipBell).toBe(false);
    expect(soulAt({ ...config, shipArrivals: [t] }, t + 5000).shipBell).toBe(true);
    expect(soulAt({ ...config, shipArrivals: [t] }, t + 12000).shipBell).toBe(false);
  });
  it('walks at a readable speed, stops at waypoints, and lights lamps on arrival', () => {
    const topology = { routes: { lamplighter: [[0, 0, 0], [10, 0, 0], [10, 0, 10]] as const }, lamps: [{ position: [5, 0, 0] as const, routeProgress: .25 }, { position: [10, 0, 5] as const, routeProgress: .75 }] };
    const start = time(4, 2) + SOUL_DUSK_HOUR * 3_600_000;
    const at = (seconds: number) => soulAt({ ...config, topology }, start + seconds * 1000);
    expect(at(5).keepers[0]!.position[0]).toBeCloseTo(2.75);
    expect(at(9).lamps[0]!.lit).toBe(false);
    expect(at(10).lamps[0]!.lit).toBe(true);
    expect(at(19).keepers[0]!.moving).toBe(false); // pause at the corner
    expect(at(29).lamps[1]!.lit).toBe(false);
    expect(at(31).lamps[1]!.lit).toBe(true);
    const beforeEnd = at(84);
    const afterEnd = at(85);
    expect(Math.hypot(...beforeEnd.keepers[0]!.position.map((v, i) => v - afterEnd.keepers[0]!.position[i]!))).toBeLessThan(.56);
    expect(at(120).keepers[0]!.visible).toBe(false);
  });
  it('has identifiable keepers at their daytime duties and repeats morning rounds', () => {
    for (const hour of [8, 10, 12, 16]) {
      const frame = soulAt(config, time(4, 2, hour));
      expect(frame.keepers.find(k => k.role === 'smith')?.visible).toBe(true);
      expect(frame.keepers.find(k => k.role === 'harbour-master')?.visible).toBe(true);
    }
    const start = time(4, 2, 6);
    expect(soulAt(config, start + 2_000).keepers.find(k => k.role === 'baker')?.moving).toBe(true);
    expect(soulAt(config, start + 15 * 60_000 + 2_000).keepers.find(k => k.role === 'baker')?.moving).toBe(true);
    expect(soulAt(config, start + 14 * 60_000 + 59_000).keepers.find(k => k.role === 'baker')?.visible).toBe(false);
    expect(soulAt(config, time(4, 2, 3)).keepers.every(k => !k.visible)).toBe(true);
  });
  it('rejects invalid input and amortizes weather while preserving motion', () => {
    expect(() => soulAt(config, NaN)).toThrow();
    expect(() => soulAt(config, Date.UTC(1900, 0, 2))).toThrow();
    expect(() => soulAt(config, Date.UTC(9999, 0, 1))).toThrow();
    expect(() => soulAt({ ...config, shipArrivals: [NaN] }, time(4, 2))).toThrow();
    expect(() => soulAt({ ...config, topology: { routes: { baker: Array.from({ length: 102 }, () => [0, 0, 0] as const) }, lamps: [] } }, time(4, 2))).toThrow();
    expect(() => soulAt({ ...config, topology: { routes: { baker: [[0, 0, 0], [1001, 0, 0]] }, lamps: [] } }, time(4, 2))).toThrow();
    expect(() => soulAt({ ...config, topology: { routes: { baker: [[0, 0, 0], [1000, 0, 0]] }, lamps: [] } }, time(4, 2))).not.toThrow();
    expect(() => soulAt({ ...config, population: NaN }, time(4, 2))).toThrow();
    expect(() => soulAt({ ...config, population: -1 }, time(4, 2))).toThrow();
    expect(() => soulAt({ ...config, topology: { routes: { baker: [[NaN, 0, 0]] }, lamps: [] } }, time(4, 2))).toThrow();
    expect(() => soulAt({ ...config, topology: { routes: {}, lamps: [{ position: [0, 0, 0], routeProgress: NaN }] } }, time(4, 2))).toThrow();
    const sample = createSoulSampler(config);
    const start = time(4, 2) + SOUL_DUSK_HOUR * 3_600_000;
    const a = sample(start + 1000); const b = sample(start + 2000);
    expect(a.weather).toBe(b.weather);
    const other = createSoulSampler(config);
    other(start + 59_000);
    expect(other(start + 2000).weather).toEqual(b.weather);
    expect(createSoulSampler(config)(start + 2000).weather).toEqual(b.weather);
    expect(a.keepers.find(k => k.role === 'lamplighter')!.position).not.toEqual(b.keepers.find(k => k.role === 'lamplighter')!.position);
    expect(sample(start + 60_000).weather).not.toBe(b.weather);
  });
});
