import { describe, expect, it } from 'vitest';
import { Biquad, lapLoop, normalisePeak, normaliseRms, pinkLoop, rainLoop, TEXTURE_CHUNK, TextureJob } from './texture';

function stats(data: Float32Array) {
  let peak = 0, sum = 0, finite = true;
  for (const x of data) { if (!Number.isFinite(x)) finite = false; peak = Math.max(peak, Math.abs(x)); sum += x * x; }
  return { peak, rms: Math.sqrt(sum / data.length), finite };
}

/** The jump across the loop's seam, against the jumps inside it (the 99.9th percentile). */
function seam(data: Float32Array) {
  const steps: number[] = [];
  for (let i = 1; i < data.length; i++) steps.push(Math.abs(data[i]! - data[i - 1]!));
  steps.sort((a, b) => a - b);
  return { jump: Math.abs(data[0]! - data[data.length - 1]!), inside: steps[Math.floor(steps.length * 0.999)]! };
}

function bake(recipe: Generator<void, Float32Array, void>): { data: Float32Array; slices: number } {
  const job = new TextureJob([recipe]);
  let slices = 0;
  while (!job.step()) slices++;
  return { data: job.result![0]!, slices };
}

describe('baked water', () => {
  const lap = bake(lapLoop(22050, 4, 0x1a9f));

  it('is a finite, audible loop of the asked length at the asked peak', () => {
    const { peak, rms, finite } = stats(lap.data);
    expect(lap.data.length).toBe(4 * 22050);
    expect(finite).toBe(true);
    expect(peak).toBeCloseTo(0.85, 5);
    expect(rms).toBeGreaterThan(0.02);
  });

  it('is made of events, not a steady hiss: loud moments and quiet ones', () => {
    const window = 2205, levels: number[] = [];
    for (let i = 0; i + window <= lap.data.length; i += window) levels.push(stats(lap.data.subarray(i, i + window)).rms);
    levels.sort((a, b) => a - b);
    expect(levels[levels.length - 1]! / levels[Math.floor(levels.length * 0.2)]!).toBeGreaterThan(3);
  });

  it('loops without a click at the seam', () => {
    const { jump, inside } = seam(lap.data);
    expect(jump).toBeLessThanOrEqual(inside);
  });

  it('is the same for the same seed, and different for another', () => {
    const again = bake(lapLoop(22050, 4, 0x1a9f)).data, other = bake(lapLoop(22050, 4, 0x77c3)).data;
    const same = (a: Float32Array, b: Float32Array) => Buffer.from(a.buffer).equals(Buffer.from(b.buffer));
    expect(same(again, lap.data)).toBe(true);
    expect(same(other, lap.data)).toBe(false);
  });

  it('bakes in slices, so a frame only ever pays for one', () => {
    expect(lap.slices).toBeGreaterThan(4);
  });
});

describe('baked rain', () => {
  const rain = bake(rainLoop(32000, 2, 0x3b61));

  it('sits at its RMS and never passes its ceiling', () => {
    const { peak, rms, finite } = stats(rain.data);
    expect(finite).toBe(true);
    expect(rms).toBeGreaterThan(0.13);
    expect(rms).toBeLessThan(0.17);
    expect(peak).toBeLessThanOrEqual(0.95);
  });

  it('is dense and even, as rain is, and loops cleanly', () => {
    const window = 3200, levels: number[] = [];
    for (let i = 0; i + window <= rain.data.length; i += window) levels.push(stats(rain.data.subarray(i, i + window)).rms);
    expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(3);
    const { jump, inside } = seam(rain.data);
    expect(jump).toBeLessThanOrEqual(inside);
  });
});

describe('air', () => {
  it('is pink: most of its energy is low, and it loops cleanly', () => {
    const air = pinkLoop(24000, 2, 0x41e), { rms, peak, finite } = stats(air);
    expect(finite).toBe(true);
    expect(rms).toBeCloseTo(0.2, 2);
    expect(peak).toBeLessThanOrEqual(0.95);
    const low = new Biquad().set('lowpass', 500, 0.7, 24000), high = new Biquad().set('highpass', 4000, 0.7, 24000);
    let lowEnergy = 0, highEnergy = 0;
    for (const x of air) { lowEnergy += low.run(x) ** 2; highEnergy += high.run(x) ** 2; }
    // White noise would put ~16x more energy above 4 kHz than below 500 Hz; pink puts about as much or less.
    expect(highEnergy / lowEnergy).toBeLessThan(2);
    const { jump, inside } = seam(air);
    expect(jump).toBeLessThanOrEqual(inside);
  });
});

describe('levels and filters', () => {
  it('normalises to a peak, and leaves silence alone', () => {
    expect(Math.max(...normalisePeak(Float32Array.from([0.1, -0.4, 0.2]), 0.8).map(Math.abs))).toBeCloseTo(0.8, 6);
    expect([...normalisePeak(new Float32Array(3), 0.8)]).toEqual([0, 0, 0]);
  });

  it('normalises to an RMS and rounds off peaks under the ceiling', () => {
    const data = new Float32Array(1000).fill(0.01);
    data[500] = 5;
    const out = normaliseRms(data, 0.2, 0.95);
    expect(Math.max(...out)).toBeLessThan(0.95);
    expect([...normaliseRms(new Float32Array(4), 0.2, 0.95)]).toEqual([0, 0, 0, 0]);
  });

  it('band-passes: passes its centre at unity and rejects far away', () => {
    const measure = (hz: number) => {
      const band = new Biquad().set('bandpass', 1000, 2, 48000);
      let peak = 0;
      for (let i = 0; i < 48000; i++) { const y = band.run(Math.sin((2 * Math.PI * hz * i) / 48000)); if (i > 24000) peak = Math.max(peak, Math.abs(y)); }
      return peak;
    };
    expect(measure(1000)).toBeCloseTo(1, 2);
    expect(measure(100)).toBeLessThan(0.1);
  });

  it('a job bakes everything at once when asked, and reports nothing until done', () => {
    const job = new TextureJob([lapLoop(8000, 1, 1), rainLoop(8000, 0.5, 2)]);
    expect(job.result).toBeNull();
    job.step();
    expect(job.ready).toBe(false);
    const done = job.finish();
    expect(done).toHaveLength(2);
    expect(done[0]!.length).toBe(8000);
    expect(job.step()).toBe(true);
    expect(TEXTURE_CHUNK).toBeGreaterThan(1000);
  });
});
