// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatCount, formatDay, formatDayRange, formatSpan, scaleBar, sweepCadence, TIER_NAMES, watchUrl } from './format';

const at = (iso: string) => Date.parse(iso);

describe('formatDay and formatDayRange', () => {
  it('formats one day', () => {
    expect(formatDay(at('2026-10-30T01:56:27Z'))).toBe('30 Oct 2026');
    expect(formatDayRange(at('2026-10-30T01:00:00Z'), at('2026-10-30T23:59:59Z'))).toBe('30 Oct 2026');
  });

  it('shares the month and year inside one month', () => {
    expect(formatDayRange(at('2026-10-29T15:44:59Z'), at('2026-10-30T01:56:27Z'))).toBe('29–30 Oct 2026');
  });

  it('shares only the year across months', () => {
    expect(formatDayRange(at('2026-10-30T12:00:00Z'), at('2026-11-02T12:00:00Z'))).toBe('30 Oct – 2 Nov 2026');
    // The same day-of-month in two months is still a range.
    expect(formatDayRange(at('2026-10-01T12:00:00Z'), at('2026-11-01T12:00:00Z'))).toBe('1 Oct – 1 Nov 2026');
  });

  it('spells both dates out across years, even for the same day and month', () => {
    expect(formatDayRange(at('2026-12-30T12:00:00Z'), at('2027-01-02T12:00:00Z'))).toBe('30 Dec 2026 – 2 Jan 2027');
    expect(formatDayRange(at('2025-10-30T12:00:00Z'), at('2026-10-30T12:00:00Z'))).toBe('30 Oct 2025 – 30 Oct 2026');
  });

  it('counts days in UTC, not in the local time zone', () => {
    // 23:30 and 00:30 UTC fall on one local day in most of the world, but on two survey days.
    expect(formatDayRange(at('2026-10-29T23:30:00Z'), at('2026-10-30T00:30:00Z'))).toBe('29–30 Oct 2026');
    expect(formatDayRange(at('2026-10-31T23:59:59.999Z'), at('2026-11-01T00:00:00Z'))).toBe('31 Oct – 1 Nov 2026');
    expect(formatDay(at('2026-12-31T23:59:59Z'))).toBe('31 Dec 2026');
  });
});

describe('formatSpan', () => {
  it.each([
    [9.66, '9.7 hours'],
    [10.19, '10 hours'],
    [1, '1 hour'],
    [0.96, '1 hour'],
    [1.04, '1 hour'],
    [1.06, '1.1 hours'],
    [9.96, '10 hours'],
    [47.4, '47 hours'],
    [48, '2 days'],
    [71.9, '2 days'],
    [72, '3 days'],
    [24 * 30 + 5, '30 days'],
  ])('%f hours reads "%s"', (hours, text) => {
    expect(formatSpan(hours)).toBe(text);
  });
});

describe('sweepCadence', () => {
  it('gives the average gap between sweeps in whole minutes', () => {
    expect(sweepCadence(10.19, 205)).toBe('every 3 minutes');
    expect(sweepCadence(2, 61)).toBe('every 2 minutes');
    expect(sweepCadence(1, 61)).toBe('every minute');
    expect(sweepCadence(0.1, 600)).toBe('every minute'); // never "every 0 minutes"
  });

  it('says nothing without at least two sweeps over some time', () => {
    expect(sweepCadence(10, 1)).toBeNull();
    expect(sweepCadence(10, 0)).toBeNull();
    expect(sweepCadence(0, 205)).toBeNull();
  });
});

describe('watchUrl', () => {
  it('links valid Twitch logins to their channel', () => {
    expect(watchUrl('zackrawrr')).toBe('https://www.twitch.tv/zackrawrr');
    expect(watchUrl('e11ysa')).toBe('https://www.twitch.tv/e11ysa');
    expect(watchUrl('_under_score_')).toBe('https://www.twitch.tv/_under_score_');
    expect(watchUrl('a')).toBe('https://www.twitch.tv/a');
    expect(watchUrl('a'.repeat(25))).toBe(`https://www.twitch.tv/${'a'.repeat(25)}`);
  });

  it.each([
    ['empty', ''],
    ['too long', 'a'.repeat(26)],
    ['upper case (a display name, not a login)', 'HasanAbi'],
    ['a space', 'hasan abi'],
    ['a path', 'foo/../../evil'],
    ['a query', 'foo?redirect=https://evil.test'],
    ['a fragment', 'foo#bar'],
    ['a scheme', 'javascript:alert(1)'],
    ['a host', 'evil.test'],
    ['user info', '@evil.test'],
    ['percent-encoding', 'foo%2f..'],
    ['markup', '<script>alert(1)</script>'],
    ['a quote', 'foo"onmouseover="x'],
    ['a trailing newline', 'foo\n'],
    ['a leading newline', '\nfoo'],
    ['a non-ASCII letter', 'jürgen'],
    ['a look-alike Cyrillic letter', 'xqс'],
    ['a full-width letter', 'ｆｏｏ'],
    ['a zero-width space', 'foo​'],
    ['a dash', 'foo-bar'],
  ])('refuses %s', (_, login) => {
    expect(watchUrl(login)).toBeNull();
  });
});

describe('scaleBar', () => {
  const mantissa = (units: number) => units / 10 ** Math.floor(Math.log10(units) + 1e-9);

  it('picks 1, 2 or 5 × 10ⁿ units between 56 and 140 px at every zoom', () => {
    for (let pxPerUnit = 1e-4; pxPerUnit <= 1e4; pxPerUnit *= 1.0137) {
      const { units, px } = scaleBar(pxPerUnit);
      expect(px).toBeGreaterThanOrEqual(56 - 1e-9);
      expect(px).toBeLessThanOrEqual(140 + 1e-9);
      expect(px).toBeCloseTo(units * pxPerUnit, 9);
      expect([1, 2, 5].some((m) => Math.abs(mantissa(units) - m) < 1e-9), `units ${units}`).toBe(true);
    }
  });

  it('chooses the shortest tidy bar that is long enough', () => {
    const bar = (pxPerUnit: number, units: number, px: number) => {
      const result = scaleBar(pxPerUnit);
      expect(result.units).toBeCloseTo(units, 12);
      expect(result.px).toBeCloseTo(px, 9);
    };
    bar(0.56, 100, 56); // exactly on the lower bound
    bar(1, 100, 100);
    bar(0.3758, 200, 75.16); // the opening laptop view of a real preview
    bar(40, 2, 80); // the deepest zoom
    bar(0.5, 200, 100); // 100 units would be 50 px: too short
    bar(1.2, 50, 60);
  });

  it('respects custom bounds and falls back to the next power of ten when no step fits', () => {
    expect(scaleBar(1, 30, 60)).toEqual({ units: 50, px: 50 });
    expect(scaleBar(3, 40, 41)).toEqual({ units: 100, px: 300 });
  });
});

describe('formatCount and TIER_NAMES', () => {
  it('groups thousands and rounds', () => {
    expect(formatCount(26_764)).toBe('26,764');
    expect(formatCount(176_266.4)).toBe('176,266');
    expect(formatCount(0)).toBe('0');
  });

  it('names tiers in rank order', () => {
    expect(TIER_NAMES).toEqual(['Capital', 'City', 'Town', 'Village']);
  });
});
