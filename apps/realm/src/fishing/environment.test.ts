import { expect, it } from 'vitest';
import { FishingRequestSchema, KingdomIdSchema, fishingHourBand, kingdomFishingHour, kingdomWaterMood, FISHING_MOODS } from '@chatdom/shared';

it('uses UTC epoch hours with exact dawn, day, dusk and night boundaries', () => {
  for (const [at, hour, band] of [
    ['2026-11-02T04:59:59.999Z', 'night'], ['2026-11-02T05:00:00.000Z', 'dawn'], ['2026-11-02T07:59:59.999Z', 'dawn'],
    ['2026-11-02T08:00:00.000Z', 'day'], ['2026-11-02T17:59:59.999Z', 'day'], ['2026-11-02T18:00:00.000Z', 'dusk'],
    ['2026-11-02T20:59:59.999Z', 'dusk'], ['2026-11-02T21:00:00.000Z', 'night'], ['2026-11-03T00:00:00.000Z', 'night'],
  ].map(([at, band]) => [at!, new Date(at!).getUTCHours() + new Date(at!).getUTCMinutes() / 60 + new Date(at!).getUTCSeconds() / 3600 + new Date(at!).getUTCMilliseconds() / 3600000, band!] as const)) {
    const time = Date.parse(at);
    expect(kingdomFishingHour(time)).toBeCloseTo(hour, 10);
    expect(fishingHourBand(kingdomFishingHour(time))).toBe(band);
  }
  for (const invalid of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => kingdomFishingHour(invalid)).toThrow();
  for (const invalid of [-1, 24, NaN, Infinity]) expect(() => fishingHourBand(invalid)).toThrow();
});

it('keeps mood deterministic within a kingdom half-hour bucket and validates time', () => {
  const kingdom = KingdomIdSchema.parse('200'), other = KingdomIdSchema.parse('201');
  const start = Date.parse('2026-11-02T12:30:00Z');
  for (let bucket = 0; bucket < 40; bucket++) {
    const at = start + bucket * 1_800_000, mood = kingdomWaterMood(kingdom, at);
    expect(FISHING_MOODS).toContain(mood);
    expect(kingdomWaterMood(kingdom, at + 1_799_999)).toBe(mood);
    expect(kingdomWaterMood(kingdom, at)).toBe(mood);
  }
  expect(Array.from({ length: 40 }, (_, n) => kingdomWaterMood(kingdom, start + n * 1_800_000))).not.toEqual(Array.from({ length: 40 }, (_, n) => kingdomWaterMood(other, start + n * 1_800_000)));
  for (const invalid of [-1, NaN, Infinity, 0.5]) expect(() => kingdomWaterMood(kingdom, invalid)).toThrow();
});

it('accepts controls only and refuses client-selected state or outcomes', () => {
  const draw = { type: 'pier.draw', id: 'request-1' };
  const release = { type: 'pier.release', id: 'request-2', castId: '123e4567-e89b-42d3-a456-426614174000', seq: 1 };
  expect(FishingRequestSchema.safeParse(draw).success).toBe(true);
  expect(FishingRequestSchema.safeParse(release).success).toBe(true);
  for (const request of [draw, release]) for (const [key, value] of Object.entries({ time: 123, timestamp: 123, seed: 8, pose: [0, 0, 0], position: [0, 0, 0], yaw: 0, species: 'fish:perch', catch: true, grant: true, weightG: 300, outcome: 'landed' })) {
    expect(FishingRequestSchema.safeParse({ ...request, [key]: value }).success, key).toBe(false);
  }
  for (const invalid of [{ ...release, seq: 0 }, { ...release, seq: 10001 }, { ...release, castId: 'forged' }, { type: 'pier.grant', id: 'x' }, { type: 'pier.catch', id: 'x' }]) expect(FishingRequestSchema.safeParse(invalid).success).toBe(false);
});
