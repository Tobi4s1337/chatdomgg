import { describe, expect, it } from 'vitest';
import {
  ambienceShape, BED_REST_SECONDS, coalesces, COALESCE_SECONDS, emptyAmbienceShape, emptyReelShape, emptyTensionShape, envelopeAt,
  HEARING_METRES, lanternWarmth, MAX_VOICES, nextVariation, placeCue, reelShape, RestClock, seeded, shade, swellCurve, tailFor, tauFor,
  tensionShape, VoicePool,
} from './law';
import type { PierMood } from './types';

describe('placement', () => {
  it('plays a local cue at full level, centred and with its full top', () => {
    expect(placeCue()).toEqual({ gain: 1, pan: 0, air: null, wet: 1 });
  });

  it('follows the kingdom distance law: half at 8 m, a quarter at 24 m', () => {
    expect(placeCue({ distance: 8 })!.gain).toBeCloseTo(0.5, 9);
    expect(placeCue({ distance: 24 })!.gain).toBeCloseTo(0.25, 9);
  });

  it('dulls with distance but never below 1.2 kHz', () => {
    expect(placeCue({ distance: 0.5 })!.air).toBeNull();
    expect(placeCue({ distance: 8 })!.air).toBeCloseTo(18000 / (1 + 8 / 6), 6);
    expect(placeCue({ distance: 55 })!.air).toBeGreaterThanOrEqual(1200);
    const near = placeCue({ distance: 4 })!.air!, far = placeCue({ distance: 30 })!.air!;
    expect(far).toBeLessThan(near);
  });

  it('gives far cues proportionally more open air', () => {
    expect(placeCue({ distance: 30 })!.wet).toBeGreaterThan(placeCue({ distance: 3 })!.wet);
    expect(placeCue({ distance: 30 })!.wet).toBeLessThanOrEqual(2.5);
  });

  it('clamps pan, treats a negative distance as here, and drops what cannot or need not play', () => {
    expect(placeCue({ pan: 3 })!.pan).toBe(1);
    expect(placeCue({ pan: -3 })!.pan).toBe(-1);
    expect(placeCue({ distance: -2 })!.gain).toBe(1);
    expect(placeCue({ distance: Number.NaN })).toBeNull();
    expect(placeCue({ pan: Number.POSITIVE_INFINITY })).toBeNull();
    expect(placeCue({ distance: HEARING_METRES + 0.1 })).toBeNull();
    expect(placeCue({ distance: HEARING_METRES })).not.toBeNull();
  });
});

describe('shade', () => {
  it('is neutral at the default intensity', () => {
    expect(shade()).toEqual({ level: 1, bright: 1, size: 1 });
    expect(shade(Number.NaN)).toEqual(shade());
  });

  it('grows louder, brighter and bigger with intensity, within a few dB', () => {
    const small = shade(0), big = shade(1);
    expect(small.level).toBeCloseTo(0.55, 9);
    expect(big.level).toBeCloseTo(1.45, 9);
    expect(20 * Math.log10(big.level)).toBeLessThan(3.5);
    expect(big.bright / small.bright).toBeCloseTo(2 ** 1.2, 9);
    expect(big.size).toBeGreaterThan(small.size);
    expect(shade(4)).toEqual(big);
    expect(shade(-1)).toEqual(small);
  });
});

describe('envelopes', () => {
  it('time constants and tails are inverse', () => {
    for (const seconds of [0.01, 0.2, 1.5]) expect(tailFor(tauFor(seconds, 60), 60)).toBeCloseTo(seconds, 12);
    expect(tailFor(0.1, 20)).toBeCloseTo(0.1 * Math.LN10, 12);
  });

  it('rises linearly to the peak, then falls exponentially', () => {
    expect(envelopeAt(-0.1, 0.01, 0.5, 0.1)).toBe(0);
    expect(envelopeAt(0.005, 0.01, 0.5, 0.1)).toBeCloseTo(0.25, 12);
    expect(envelopeAt(0.01, 0.01, 0.5, 0.1)).toBeCloseTo(0.5, 12);
    expect(envelopeAt(0.01 + tailFor(0.1, 60), 0.01, 0.5, 0.1)).toBeCloseTo(0.5e-3, 9);
    // An attack never shorter than a millisecond: no click.
    expect(envelopeAt(0.0005, 0, 1, 0.1)).toBeCloseTo(0.5, 12);
  });

  it('swells from silence to the peak without a corner', () => {
    const curve = swellCurve(0.4);
    expect(curve[0]).toBe(0);
    expect(curve[curve.length - 1]).toBeCloseTo(0.4, 6);
    for (let i = 1; i < curve.length; i++) expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
    // Flat at both ends: the first and last steps are much smaller than the middle one.
    const step = (i: number) => curve[i + 1]! - curve[i]!;
    expect(step(0)).toBeLessThan(step(15) / 10);
    expect(step(curve.length - 2)).toBeLessThan(step(15) / 10);
  });
});

describe('variations', () => {
  it('never plays the same take twice in a row, and reaches every take', () => {
    const random = seeded(7), seen = new Set<number>();
    let last: number | undefined;
    for (let i = 0; i < 300; i++) {
      const next = nextVariation(last, 3, random);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(3);
      if (last !== undefined) expect(next).not.toBe(last);
      seen.add(next); last = next;
    }
    expect(seen.size).toBe(3);
    expect(nextVariation(0, 1, random)).toBe(0);
    expect(nextVariation(9, 3, () => 0.999999)).toBeLessThan(3);
  });
});

describe('voice pool', () => {
  it('holds twelve voices and makes the oldest give way to a new one', () => {
    const pool = new VoicePool<number>();
    expect(pool.limit).toBe(MAX_VOICES);
    for (let i = 0; i < MAX_VOICES; i++) expect(pool.admit(i)).toBeUndefined();
    expect(pool.size).toBe(MAX_VOICES);
    expect(pool.admit(100)).toBe(0);
    expect(pool.admit(101)).toBe(1);
    expect(pool.size).toBe(MAX_VOICES);
  });

  it('frees a slot when a voice ends on its own, so nothing is stolen needlessly', () => {
    const pool = new VoicePool<string>(2);
    pool.admit('a'); pool.admit('b');
    pool.release('a');
    expect(pool.admit('c')).toBeUndefined();
    expect(pool.admit('d')).toBe('b');
    pool.release('missing');
    expect(pool.size).toBe(2);
  });

  it('does not count a voice twice and empties oldest first', () => {
    const pool = new VoicePool<string>(3);
    pool.admit('a'); pool.admit('b'); pool.admit('a');
    expect(pool.size).toBe(2);
    expect(pool.clear()).toEqual(['a', 'b']);
    expect(pool.size).toBe(0);
  });

  it('never exceeds its limit under any order of starts and ends', () => {
    const pool = new VoicePool<number>(4), random = seeded(99), live = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      if (random() < 0.6) {
        const giving = pool.admit(i);
        live.add(i);
        if (giving !== undefined) { expect(live.has(giving)).toBe(true); live.delete(giving); }
      } else if (live.size) {
        const ending = [...live][Math.floor(random() * live.size)]!;
        pool.release(ending); live.delete(ending);
      }
      expect(pool.size).toBe(live.size);
      expect(pool.size).toBeLessThanOrEqual(4);
    }
  });

  it('refuses an empty pool', () => {
    expect(() => new VoicePool(0)).toThrow(RangeError);
  });
});

describe('rest clock', () => {
  it('stops a bed only after it has been unwanted for the rest time', () => {
    const clock = new RestClock();
    expect(clock.rest).toBe(BED_REST_SECONDS);
    expect(clock.update(true, 0)).toBe(false);
    expect(clock.update(false, 1)).toBe(false);
    expect(clock.update(false, 2.9)).toBe(false);
    expect(clock.update(false, 3)).toBe(true);
  });

  it('starts over whenever the bed is wanted again', () => {
    const clock = new RestClock(2);
    clock.update(false, 0);
    clock.update(true, 1.5);
    expect(clock.update(false, 2)).toBe(false);
    expect(clock.update(false, 3.9)).toBe(false);
    expect(clock.update(false, 4)).toBe(true);
    clock.reset();
    expect(clock.update(false, 10)).toBe(false);
    expect(clock.update(false, Number.NaN)).toBe(false);
  });
});

describe('coalescing', () => {
  it('treats the same cue within 30 ms as one sound unless it is clearly nearer', () => {
    expect(coalesces(undefined, 0, 1, 1)).toBe(false);
    expect(coalesces(1, 1, 1 + COALESCE_SECONDS / 2, 1)).toBe(true);
    expect(coalesces(1, 1, 1 + COALESCE_SECONDS, 1)).toBe(false);
    expect(coalesces(1, 0.3, 1.01, 0.5)).toBe(false);
    expect(coalesces(1, 0.3, 1.01, 0.4)).toBe(true);
    // A clock that went backwards (a new context) never swallows a cue.
    expect(coalesces(5, 1, 1, 1)).toBe(false);
  });
});

describe('the reel', () => {
  it('is silent at rest and clicks faster and brighter as it winds', () => {
    const shape = emptyReelShape();
    expect(reelShape(0, shape)).toBe(shape);
    expect(shape.click).toBe(0);
    expect(shape.whirr).toBe(0);
    let last = reelShape(0.05, emptyReelShape());
    for (const rate of [0.2, 0.5, 0.8, 1]) {
      const next = reelShape(rate, emptyReelShape());
      expect(next.click).toBeGreaterThan(last.click);
      expect(next.clickHz).toBeGreaterThan(last.clickHz);
      expect(next.pawlHz).toBeGreaterThan(last.pawlHz);
      last = next;
    }
    expect(last.clickHz).toBeCloseTo(38, 9);
    expect(reelShape(Number.NaN, emptyReelShape()).click).toBe(0);
    expect(reelShape(7, emptyReelShape())).toEqual(reelShape(1, emptyReelShape()));
  });
});

describe('the line under load', () => {
  it('is silent slack and rises towards the snap, trembling only at the very end', () => {
    expect(tensionShape(0, emptyTensionShape())).toMatchObject({ creak: 0, strain: 0, tremble: 0 });
    const half = tensionShape(0.5, emptyTensionShape()), full = tensionShape(1, emptyTensionShape());
    expect(full.creak).toBeGreaterThan(half.creak);
    expect(full.strain).toBeGreaterThan(half.strain * 3);
    expect(full.strainHz).toBeGreaterThan(half.strainHz);
    expect(half.tremble).toBe(0);
    expect(full.tremble).toBe(1);
    expect(tensionShape(Number.NaN, emptyTensionShape()).strain).toBe(0);
  });
});

describe('the pier bed', () => {
  const moods: PierMood[] = ['clear', 'breeze', 'mist', 'rain'];

  it('is completely silent away from the pier, in every mood and hour', () => {
    for (const mood of moods) for (const hour of [0, 6, 12, 21]) {
      const shape = ambienceShape(0, mood, hour, emptyAmbienceShape());
      expect([shape.lap, shape.rain, shape.breeze, shape.mist, shape.lantern]).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it('carries each mood: rain only in rain, mist muffles the water, a breeze brightens and quickens it', () => {
    const clear = ambienceShape(1, 'clear', 12, emptyAmbienceShape());
    const mist = ambienceShape(1, 'mist', 12, emptyAmbienceShape());
    const breeze = ambienceShape(1, 'breeze', 12, emptyAmbienceShape());
    const rain = ambienceShape(1, 'rain', 12, emptyAmbienceShape());
    expect(clear.rain).toBe(0); expect(mist.rain).toBe(0); expect(breeze.rain).toBe(0);
    expect(rain.rain).toBeGreaterThan(0);
    expect(mist.mist).toBeGreaterThan(0); expect(clear.mist).toBe(0);
    expect(mist.lapTone).toBeLessThan(clear.lapTone / 2);
    expect(breeze.lapTone).toBeGreaterThan(clear.lapTone);
    expect(breeze.lapRate).toBeGreaterThan(1);
    expect(breeze.breeze).toBeGreaterThan(clear.breeze);
    expect(mist.breeze).toBe(0);
  });

  it('lights the lantern hum only after dusk, by the same law as the window glow', () => {
    expect(lanternWarmth(12)).toBe(0);
    expect(lanternWarmth(16)).toBe(0);
    expect(lanternWarmth(18.5)).toBe(1);
    expect(lanternWarmth(0)).toBe(1);
    expect(lanternWarmth(24 + 3)).toBe(1);
    expect(lanternWarmth(-1)).toBe(1);
    expect(lanternWarmth(17.3)).toBeGreaterThan(0);
    expect(lanternWarmth(17.3)).toBeLessThan(1);
    expect(ambienceShape(1, 'clear', 13, emptyAmbienceShape()).lantern).toBe(0);
    expect(ambienceShape(1, 'clear', 22, emptyAmbienceShape()).lantern).toBeGreaterThan(0);
    // The flame is small: halfway to the pier it is a quarter as loud.
    const close = ambienceShape(1, 'clear', 22, emptyAmbienceShape()).lantern;
    expect(ambienceShape(0.5, 'clear', 22, emptyAmbienceShape()).lantern).toBeCloseTo(close / 4, 9);
  });

  it('writes into the object it is given and survives a mood it does not know', () => {
    const shape = emptyAmbienceShape();
    expect(ambienceShape(1, 'rain', 3, shape)).toBe(shape);
    const odd = ambienceShape(1, 'thunder' as PierMood, 12, emptyAmbienceShape());
    expect(odd).toEqual(ambienceShape(1, 'clear', 12, emptyAmbienceShape()));
    expect(ambienceShape(Number.NaN, 'clear', Number.NaN, emptyAmbienceShape()).lap).toBe(0);
  });
});
