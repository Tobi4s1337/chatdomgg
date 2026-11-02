// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compareRoads, networkBudget, roadFaded, roadKey, roadStroke, roadWidth, ROAD_WIDTH, seaLane, UNUSED_SEASON_MS } from './network';
import { dayMonth, roadRest, roadSilence, roadStory, roadWays } from './story';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2, 12);

describe('road ink', () => {
  it('inks on the first raid and thickens on a log scale, within its bounds', () => {
    expect(roadWidth(0, 0)).toBe(ROAD_WIDTH.min);
    expect(roadWidth(1, 0)).toBe(ROAD_WIDTH.min);
    const widths = [1, 2, 4, 8, 16, 32].map(raids => roadWidth(raids, raids * 50));
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    // Each doubling adds about the same weight: a log scale, not a linear one.
    const steps = widths.slice(1).map((w, i) => w - widths[i]!);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(0.05);
    expect(roadWidth(1_000_000, 1e9)).toBe(ROAD_WIDTH.max);
    // Travellers thicken a little; raids decide.
    expect(roadWidth(4, 4_000)).toBeGreaterThan(roadWidth(4, 4));
    expect(roadWidth(16, 16)).toBeGreaterThan(roadWidth(4, 40_000));
  });

  it('fades to dotted after one unused season and is still drawn', () => {
    const fresh = { lastAt: NOW - UNUSED_SEASON_MS + DAY, ra: 1, rb: 1 };
    const old = { lastAt: NOW - UNUSED_SEASON_MS - DAY, ra: 1, rb: 1 };
    expect(roadFaded(fresh.lastAt, NOW)).toBe(false);
    expect(roadStroke(fresh, NOW)).toBe('road');
    expect(roadFaded(old.lastAt, NOW)).toBe(true);
    // Fading is a pen, never a deletion: the faded road keeps its width and is drawn dotted.
    expect(roadStroke(old, NOW)).toBe('dotted');
    expect(roadWidth(3, 300)).toBeGreaterThan(0);
    expect(UNUSED_SEASON_MS).toBe(90 * DAY);
  });

  it('crosses between two languages as a sea lane, never when an end has no known land', () => {
    expect(seaLane(2, 5)).toBe(true);
    expect(seaLane(2, 2)).toBe(false);
    expect(seaLane(null, 5)).toBe(false);
    expect(roadStroke({ lastAt: NOW, ra: 2, rb: 5 }, NOW)).toBe('sea');
    expect(roadStroke({ lastAt: NOW - 200 * DAY, ra: 2, rb: 5 }, NOW)).toBe('dotted');
  });

  it('draws few roads at the whole world and all of them among the kingdoms', () => {
    expect(networkBudget(1, 1)).toBe(48);
    expect(networkBudget(2, 1)).toBe(110);
    expect(networkBudget(5, 1)).toBe(220);
    expect(networkBudget(20, 1)).toBe(400);
  });

  it('keys a road by its pair, whichever way the raid rode, and orders by use', () => {
    expect(roadKey('42', '1337')).toBe(roadKey('1337', '42'));
    expect(roadKey('42', '1337')).toBe('42~1337');
    const roads = [
      { raids: 2, travellers: 10, lastAt: NOW, key: 'b' },
      { raids: 5, travellers: 1, lastAt: NOW - DAY, key: 'a' },
      { raids: 2, travellers: 10, lastAt: NOW, key: 'a' },
    ].sort(compareRoads);
    expect(roads.map(road => `${road.raids}${road.key}`)).toEqual(['5a', '2a', '2b']);
  });
});

describe('road stories', () => {
  const oct30 = Date.UTC(2026, 9, 30, 21);
  it('tells what was witnessed', () => {
    expect(roadStory({ raids: 7, firstAt: oct30, lastAt: NOW, basis: 'observations' }, NOW)).toBe('7 raids since 30 October');
    expect(roadStory({ raids: 1, firstAt: oct30, lastAt: oct30, basis: 'observations' }, NOW)).toBe('1 raid on 30 October');
    expect(roadStory({ raids: 12, firstAt: null, lastAt: oct30, basis: 'at-least' }, NOW)).toBe('At least 12 raids, the last on 30 October');
    expect(roadStory({ raids: 1_204, firstAt: Date.UTC(2025, 11, 1), lastAt: NOW, basis: 'observations' }, NOW)).toBe('1,204 raids since 1 December 2025');
  });

  it('never says "no raids" of what was not observed', () => {
    const silence = roadSilence(oct30, NOW);
    expect(silence).toBe('No raid between them seen since 30 October');
    expect(silence).not.toMatch(/no raids/i);
    expect(roadSilence(oct30, NOW, 'to or from this channel')).toBe('No raid to or from this channel seen since 30 October');
    expect(roadStory({ raids: 0, firstAt: null, lastAt: null, basis: 'none' }, NOW)).toBe('No raid seen yet');
  });

  it('says since when a faded road rests, and each way', () => {
    expect(roadRest(NOW - DAY, NOW)).toBeNull();
    expect(roadRest(Date.UTC(2026, 6, 1), NOW)).toBe('Unused since 1 July');
    expect(roadWays(3, 4)).toBe('3 sent · 4 received');
    expect(roadWays(0, 2)).toBe('2 received');
    expect(dayMonth(Date.UTC(2026, 9, 31, 23, 59), NOW)).toBe('31 October');
  });
});
