import { describe, expect, it } from 'vitest';
import {
  GAUGE, TAG_HOLD_MS, TAG_SLIDE_MS, STAMP_FALL_MS, STAMP_DELAY_MS, arcPath, containFit, firstInLine, measureLine, needleDegrees, noteDuration, polar,
  quantize, snapHalf, strained, tagSummary, tagTimeline, tensionColour, tensionWord, tickPath, worldTagLeaving,
} from './logic';

describe('the catch tag words', () => {
  it('joins weight and length and drops an empty part', () => {
    expect(measureLine('412 g', '31 cm')).toBe('412 g · 31 cm');
    expect(measureLine('412 g', '')).toBe('412 g');
    expect(measureLine('', ' 31 cm ')).toBe('31 cm');
    expect(measureLine('', '')).toBe('');
  });
  it('says what was caught and what it means', () => {
    const tag = { name: 'Copper Perch', weight: '412 g', length: '31 cm', personalFirst: true, kingdomFirst: true };
    expect(tagSummary(tag, 'Willowmere')).toBe('You caught a Copper Perch, 412 g, 31 cm. New in your Almanac. First in Willowmere.');
    expect(tagSummary({ ...tag, weight: '', personalFirst: false, kingdomFirst: false }, 'Willowmere')).toBe('You caught a Copper Perch, 31 cm.');
    expect(tagSummary({ ...tag, weight: '', length: '', personalFirst: false }, '')).toBe('You caught a Copper Perch. First in the kingdom.');
    for (const text of [tagSummary(tag, 'Willowmere'), firstInLine('  ')]) expect(text).not.toMatch(/undefined|NaN|null/);
  });
});

describe('the catch tag timeline', () => {
  it('stamps the Almanac seal about 0.6 s after the tag settles, then the wax', () => {
    const t = tagTimeline(true, true, false);
    expect(t.stamps.map(s => s.seal)).toEqual(['almanac', 'kingdom']);
    expect(t.stamps[0]!.impact).toBe(TAG_SLIDE_MS + STAMP_DELAY_MS);
    expect(t.stamps[0]!.impact - t.stamps[0]!.at).toBe(STAMP_FALL_MS);
    expect(t.stamps[1]!.impact).toBeGreaterThan(t.stamps[0]!.impact + 300);
  });
  it('holds about five seconds and always leaves time to read the last seal', () => {
    for (const [a, b] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      const t = tagTimeline(a, b, false);
      expect(t.out).toBeGreaterThanOrEqual(TAG_SLIDE_MS + TAG_HOLD_MS);
      expect(t.out).toBeLessThan(7000);
      const last = t.stamps[t.stamps.length - 1];
      if (last) expect(t.out - last.impact).toBeGreaterThanOrEqual(2500);
      expect(t.stamps.length).toBe(Number(a) + Number(b));
    }
    expect(tagTimeline(false, true, false).stamps[0]!.seal).toBe('kingdom');
  });
  it('keeps the rhythm under reduced motion and only shortens the slide', () => {
    const calm = tagTimeline(true, true, true), full = tagTimeline(true, true, false);
    expect(calm.slideIn).toBeLessThan(full.slideIn);
    expect(calm.stamps).toEqual(full.stamps);
  });
});

describe('notes', () => {
  it('stay long enough to read and never linger', () => {
    expect(noteDuration('No.')).toBe(2800);
    expect(noteDuration('The kingdom is keeping your catch.')).toBeGreaterThan(3500);
    expect(noteDuration('x'.repeat(400))).toBe(7000);
  });
});

describe('the fight gauge', () => {
  it('quantises frame values into a fixed table, NaN and overflow included', () => {
    expect(quantize(0.5, 400)).toBe(200);
    expect(quantize(-1, 400)).toBe(0);
    expect(quantize(2, 400)).toBe(400);
    expect(quantize(Number.NaN, 400)).toBe(0);
    expect(quantize(Number.POSITIVE_INFINITY, 64)).toBe(0);
  });
  it('leans the needle across the span', () => {
    expect(needleDegrees(0)).toBe(-GAUGE.spanDeg);
    expect(needleDegrees(0.5)).toBe(0);
    expect(needleDegrees(1)).toBe(GAUGE.spanDeg);
  });
  it('draws the arc inside its view box', () => {
    const top = polar(GAUGE.cx, GAUGE.cy, GAUGE.radius, 0), left = polar(GAUGE.cx, GAUGE.cy, GAUGE.radius, -GAUGE.spanDeg);
    expect(top.y).toBeGreaterThan(8);
    expect(left.x).toBeGreaterThan(8);
    expect(left.y + 6).toBeLessThan(GAUGE.height);
    expect(arcPath(GAUGE.radius)).toMatch(/^M[\d.]+ [\d.]+A150 150 0 0 1 [\d.]+ [\d.]+$/);
    expect(arcPath(GAUGE.radius, 0.85, 1)).not.toBe(arcPath(GAUGE.radius));
    expect(tickPath(16, 152, 155).match(/M/g)).toHaveLength(17);
  });
  it('runs from a cool slack line through warm to red at the snap', () => {
    const red = (hex: string): number => parseInt(hex.slice(1, 3), 16), blue = (hex: string): number => parseInt(hex.slice(5, 7), 16);
    expect(tensionColour(0)).toBe('#86a9b4');
    expect(tensionColour(1)).toBe('#c02e1e');
    expect(red(tensionColour(0.5))).toBeGreaterThan(red(tensionColour(0)));
    expect(blue(tensionColour(0.9))).toBeLessThan(blue(tensionColour(0.5)));
    for (let i = 0; i <= 64; i += 1) expect(tensionColour(i / 64)).toMatch(/^#[0-9a-f]{6}$/);
    expect(tensionColour(Number.NaN)).toBe('#86a9b4');
  });
  it('shivers above 0.85 without flickering at the threshold', () => {
    expect(strained(false, 0.84)).toBe(false);
    expect(strained(false, 0.86)).toBe(true);
    expect(strained(true, 0.84)).toBe(true);
    expect(strained(true, 0.8)).toBe(false);
  });
  it('names the tension for a screen reader', () => {
    expect(tensionWord(0.1)).toBe('slack');
    expect(tensionWord(0.4)).toBe('taut');
    expect(tensionWord(0.7)).toBe('straining');
    expect(tensionWord(0.9)).toBe('about to snap');
  });
});

describe('the portrait', () => {
  it('fits the render inside its print window, centred', () => {
    const fit = containFit(400, 200, 236, 112, 6)!;
    expect(fit.height).toBeCloseTo(100);
    expect(fit.width).toBeCloseTo(200);
    expect(fit.x).toBeCloseTo(18);
    expect(fit.y).toBeCloseTo(6);
    expect(containFit(0, 200, 236, 112)).toBeNull();
    expect(containFit(10, 10, 0, 112)).toBeNull();
    expect(containFit(10, 10, 100, 100, 0, 2)!.width).toBe(20);
  });
});

describe('world tags', () => {
  it('fade when hidden or no longer sent', () => {
    expect(worldTagLeaving({ seen: 3, visible: true, leavingSince: -1 }, 3)).toBe(false);
    expect(worldTagLeaving({ seen: 3, visible: false, leavingSince: -1 }, 3)).toBe(true);
    expect(worldTagLeaving({ seen: 2, visible: true, leavingSince: -1 }, 3)).toBe(true);
  });
  it('snap positions to half pixels', () => {
    expect(snapHalf(10.2)).toBe(10);
    expect(snapHalf(10.3)).toBe(10.5);
    expect(snapHalf(-3.76)).toBe(-4);
  });
});
