// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createOpeningJournal, type OpeningState } from './journal';
import { openingView } from './view';
import { openingLandFromSurface } from './sources';
import { contourPath, isolines } from './painter';

const town = { minX: 0, maxX: 64, minZ: 0, maxZ: 64 };
const streets = { bounds: town, streets: [{ points: [[0, 0], [64, 64]] as [number, number][], width: 4, open: true, kind: 'main' as const }],
  homes: [{ slot: 1, minX: 4, maxX: 10, minZ: 4, maxZ: 10 }], squares: [], castle: null, ownSlot: 1, lake: null };

function land() {
  return { bounds: town, columns: 2, rows: 2, heights: new Float32Array(4), water: new Uint8Array(4), seaLevel: 0, town };
}

describe('the opening journal', () => {
  it('stands each home only once its own mesh is in the scene, never from a share of the total', () => {
    const journal = createOpeningJournal();
    journal.streets(streets);
    journal.assets(5, 6);
    expect(journal.state.raised).toEqual([]);
    journal.raised([65534, -1, 1.5]);
    expect(journal.state.raised).toEqual([]);
    const before = journal.state.revision;
    journal.raised([3, 1, 3]);
    expect(journal.state.raised).toEqual([3, 1]);
    journal.raised([1]);
    expect(journal.state.revision).toBe(before + 1);
  });

  it('shows nothing as done before a real step happens, however long it waits', () => {
    vi.useFakeTimers();
    try {
      const journal = createOpeningJournal(), first = journal.state;
      vi.advanceTimersByTime(60_000);
      expect(journal.state).toBe(first);
      expect(openingView(journal.state)).toEqual({ beat: 'unrolling', line: 'Unrolling the map of the kingdom', detail: null, ink: null });
    } finally { vi.useRealTimers(); }
  });

  it('is a pure reading: the same state always draws the same words and ink', () => {
    const journal = createOpeningJournal();
    journal.name('Willowmere'); journal.streets(streets);
    journal.bytes({ received: 1_500_000, planned: 3_000_000, requiredRegions: 16, coveredRegions: 6, cacheHits: 0 });
    const state = journal.state;
    expect(openingView(state)).toEqual(openingView(state));
    expect(openingView(state).ink).toBe(.5);
    expect(openingView(state).detail).toBe('1.5 of 3.0 MB · 6 of 16 regions');
  });

  it('moves each beat only on its own real event', () => {
    const journal = createOpeningJournal(), beats: string[] = [];
    journal.subscribe(state => beats.push(openingView(state).beat));
    journal.name('Willowmere');
    expect(openingView(journal.state).beat).toBe('unrolling');
    journal.streets(streets);
    expect(openingView(journal.state)).toMatchObject({ beat: 'street', line: 'Inking your street' });
    journal.land(land());
    expect(openingView(journal.state)).toMatchObject({ beat: 'land', line: 'Drawing the coast and the high ground' });
    journal.region({ rx: 4, rz: 4, level: 0, exact: true, bounds: town });
    expect(openingView(journal.state)).toMatchObject({ beat: 'rising', line: 'The ink rises into the land' });
    // Bytes, assets and the street's own step never claim the kingdom is lit.
    journal.bytes({ received: 9e6, planned: 3e6, requiredRegions: 16, coveredRegions: 16, cacheHits: 0 });
    journal.assets(10, 10); journal.step('street'); journal.step('ground'); journal.step('homes');
    expect(openingView(journal.state).beat).toBe('rising');
    journal.step('lit');
    expect(openingView(journal.state)).toMatchObject({ beat: 'lit', line: 'Your window is lit', ink: 1 });
    expect(beats.filter((beat, index) => beat !== beats[index - 1])).toEqual(['unrolling', 'street', 'land', 'rising', 'lit']);
  });

  it('never lets the ink run past the bytes really read, or backwards', () => {
    const journal = createOpeningJournal(), inks: number[] = [];
    journal.subscribe(state => { const ink = openingView(state).ink; if (ink !== null) inks.push(ink); });
    for (const received of [0, 400_000, 1_200_000, 2_000_000, 4_000_000]) {
      journal.bytes({ received, planned: received ? 2_000_000 : 0, requiredRegions: 16, coveredRegions: Math.floor(received / 200_000), cacheHits: 0 });
    }
    expect(inks).toEqual([.2, .6, 1, 1]);
    // An unchanged report is not an event.
    const revision = journal.state.revision;
    journal.bytes({ received: 4_000_000, planned: 2_000_000, requiredRegions: 16, coveredRegions: 20, cacheHits: 0 });
    expect(journal.state.revision).toBe(revision);
    journal.bytes({ received: 4_000_000, planned: 2_000_000, requiredRegions: 16, coveredRegions: 16, cacheHits: 0 });
    expect(journal.state.revision).toBe(revision + 1);
  });

  it('says plainly when the land came from the last visit, and counts pieces for a kingdom on today\'s land', () => {
    const kept = createOpeningJournal();
    kept.bytes({ received: 3e6, planned: 3e6, requiredRegions: 16, coveredRegions: 16, cacheHits: 18 });
    expect(openingView(kept.state).detail).toBe('3.0 of 3.0 MB · 16 of 16 regions · kept from your last visit');
    const local = createOpeningJournal();
    local.local(); local.assets(3, 12); local.assets(2, 12);
    expect(openingView(local.state)).toMatchObject({ beat: 'rising', line: 'Raising the homes', detail: '3 of 12 pieces raised', ink: .25 });
  });

  it('records each step and each region once, with a timing mark, and stops at a failure', () => {
    const journal = createOpeningJournal();
    const marks = vi.spyOn(performance, 'mark');
    journal.step('gate', 10); journal.step('gate', 20);
    expect(journal.state.at.gate).toBe(10);
    expect(marks).toHaveBeenCalledWith('chatdom:open:gate');
    journal.region({ rx: 1, rz: 2, level: 1, exact: false, bounds: town });
    journal.region({ rx: 1, rz: 2, level: 0, exact: false, bounds: town });
    expect(journal.state.regions).toHaveLength(1);
    journal.fail('The land could not be read');
    journal.step('lit');
    const state: OpeningState = journal.state;
    expect(state.at.lit).toBeUndefined();
    expect(openingView(state)).toMatchObject({ line: 'The road needs a moment', detail: 'The land could not be read' });
    marks.mockRestore();
  });

  it('refuses an incomplete map rather than drawing a guess', () => {
    const journal = createOpeningJournal();
    expect(() => journal.land({ ...land(), heights: new Float32Array(3) })).toThrow(/complete grid/);
    expect(journal.state.land).toBeNull();
  });
});

describe('the opening map\'s land', () => {
  it('reads heights and water from the verified surface in the settlement frame', () => {
    const size = 8, ground = new Uint16Array(size * size).fill(20), water = new Uint16Array(size * size);
    for (let z = 0; z < size; z++) for (let x = 0; x < 4; x++) water[x + z * size] = 24;
    ground[7 + 7 * size] = 60;
    const result = openingLandFromSurface({ size, height: 128, seaLevel: 22, ground, water },
      { seat: { offset: [1, 2, 3], columns: { x0: 0, z0: 0, x1: 1, z1: 1 }, band: 1 }, physicalRegion: town }, 4);
    expect(result.bounds).toEqual({ minX: -1, maxX: 3, minZ: -3, maxZ: 1 });
    expect([...result.water]).toEqual([1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0]);
    expect(result.heights[0]).toBe(8);
    expect(result.heights[15]).toBe(28);
    expect(result.seaLevel).toBe(9);
  });
});

it('contours every level in one pass with exactly the segments of one pass per level', () => {
  const columns = 48, rows = 40, bounds = { minX: -120, maxX: 120, minZ: -90, maxZ: 110 };
  const value = (c: number, r: number) => 30 * Math.sin(c * .21) * Math.cos(r * .17) + c * .8 + (c === 7 && r === 9 ? 24 : 0);
  const levels = [-24, 0, 24, 48];
  const expected = levels.flatMap(level => { const s = isolines(columns, rows, value, level, bounds), out: string[] = [];
    for (let i = 0; i < s.length; i += 4) out.push([s[i], s[i + 1], s[i + 2], s[i + 3]].map(v => Math.fround(v!)).join(','));
    return out; });
  const moves: number[] = [], recorded: string[] = [];
  const segments = contourPath(columns, rows, value, levels, bounds, {
    moveTo: (x, y) => { moves.push(x, y); }, lineTo: (x, y) => { recorded.push([moves.at(-2)!, moves.at(-1)!, x, y].map(v => Math.fround(v)).join(',')); } });
  expect(segments).toBe(expected.length);
  expect(expected.length).toBeGreaterThan(100);
  expect([...recorded].sort()).toEqual([...expected].sort());
});
