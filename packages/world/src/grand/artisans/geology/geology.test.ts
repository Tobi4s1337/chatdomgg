import { describe, expect, it } from 'vitest';
import { createGeologyReview, createGeologySampler, createRangeHeightField, createWatercourse, GEOLOGY, GEOLOGY_COLOURS, sampleGeology, strataBand, watercourseProfile } from './index';

const seedKey = 'kingdom:129634568';
const sample = { x: 36, y: 90, z: -45, surfaceY: 90, slope: 0.4, snowline: 70, exposure: 0.4, seedKey };

describe('geology dressing', () => {
  it('lays snow on high ledges but leaves steep faces and buried rock exposed', () => {
    expect(sampleGeology(sample)).toBe(GEOLOGY.snow);
    expect(sampleGeology({ ...sample, y: 89 })).toBe(GEOLOGY.snowShade);
    expect(sampleGeology({ ...sample, y: 87 })).toBeLessThan(GEOLOGY.scree);
    expect(sampleGeology({ ...sample, slope: 3 })).toBeLessThan(GEOLOGY.scree);
    expect(sampleGeology({ ...sample, surfaceY: 40, y: 40 })).toBeLessThan(GEOLOGY.scree);
    expect(sampleGeology({ ...sample, surfaceY: 40, y: 40, talus: true })).toBe(GEOLOGY.scree);
  });
  it('binds the same material in a cached sampler and its columns', () => {
    const sampler = createGeologySampler(seedKey);
    expect(sampler.sample(sample)).toBe(sampleGeology(sample));
    expect(sampler.column(sample.x, sample.z).material(sample.y, sample.surfaceY, sample.slope, sample.snowline, sample.exposure)).toBe(sampleGeology(sample));
  });
  it('builds a continuous seeded spine with unequal peaks', () => {
    const height = createRangeHeightField(seedKey), again = createRangeHeightField(seedKey);
    const other = createRangeHeightField('kingdom:another');
    const maxima: number[] = [];
    for (let x = -60; x <= 60; x += 20) {
      let max = 0;
      for (let z = -44; z <= 36; z += 2) {
        const y = height(x, z);
        expect(y).toBe(again(x, z));
        expect(Math.abs(y - height(x + 1, z))).toBeLessThan(15);
        max = Math.max(max, y);
      }
      maxima.push(max);
    }
    expect(Math.min(...maxima)).toBeGreaterThan(25);
    expect(Math.max(...maxima) - Math.min(...maxima)).toBeGreaterThan(4);
    expect(height(-17, -11)).not.toBe(other(-17, -11));
    for (const [x, z] of [[-166, 0], [166, 0], [0, -110], [0, 110]] as const) expect(height(x, z)).toBe(0);
    expect(height(-120, -13)).toBeGreaterThan(0);
    expect(height(120, -9)).toBeGreaterThan(0);
  });
  it('uses world anchored, slowly warped strata at negative and chunk-edge coordinates', () => {
    for (let y = -45; y <= 100; y++) {
      const a = strataBand(-33, y, 32, seedKey);
      const b = strataBand(-32, y, 32, seedKey);
      const difference = Math.min((a - b + 16) % 16, (b - a + 16) % 16);
      expect(difference).toBeLessThanOrEqual(1);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(16);
    }
    const range = createGeologyReview(seedKey);
    expect(range).toEqual(createGeologyReview(seedKey));
    const snow = range.boxes.filter(box => box.colour === GEOLOGY_COLOURS[GEOLOGY.snow]);
    expect(snow.length).toBeGreaterThan(100);
    expect(snow.every(box => box.min[1] >= 29)).toBe(true);
  });
});

describe('watercourse study', () => {
  it('widens downhill and keeps adjacent reaches connected', () => {
    const reaches = watercourseProfile();
    expect(reaches[0]!.halfWidth).toBeLessThan(reaches.at(-1)!.halfWidth);
    for (let i = 1; i < reaches.length; i++) {
      const a = reaches[i - 1]!, b = reaches[i]!;
      expect(b.z - a.z).toBe(1);
      expect(b.y).toBeLessThanOrEqual(a.y);
      expect(a.y - b.y).toBeLessThanOrEqual(2);
      expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(a.halfWidth + b.halfWidth);
      expect(b.halfWidth).toBeGreaterThanOrEqual(a.halfWidth);
    }
  });
  it('keeps fall, receiving pool and outlet explicit in its review anchors', () => {
    const kit = createWatercourse(seedKey);
    expect(kit.anchors.source![1]).toBeGreaterThan(kit.anchors.pool![1]);
    expect(kit.anchors.falls![2]).toBeLessThan(kit.anchors.pool![2]);
    expect(kit.anchors.mouth![2]).toBeGreaterThan(kit.anchors.pool![2]);
    expect(kit.boxes.every(box => box.size.every(v => v > 0))).toBe(true);
    expect(kit.boxes.length).toBeLessThan(50000);
    expect(createWatercourse(seedKey)).toEqual(kit);
  });
});
