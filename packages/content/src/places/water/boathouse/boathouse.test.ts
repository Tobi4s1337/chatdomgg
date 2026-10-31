import { describe, expect, it } from 'vitest';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { occupiedIn, pieceFailures, unsupported, voxels } from '../piece-checks';
import { BOATHOUSE, BOATHOUSE_BLUEPRINTS, BOATHOUSE_PIECES, BOATHOUSE_REVIEW_SITE, createBoathouse, type BoathouseSite } from './index';

const STYLE_KEYS = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];
const SLOW = 180_000;
/** Build cell, in metres. */
const CELL = 0.125;
const site = BOATHOUSE_REVIEW_SITE;
const tide = createBoathouse('tide', site);
const [SPAN, LENGTH] = BOATHOUSE.footprint;

describe('the Tide boathouse', () => {
  it('stands honestly in every kit: palette, budgets, support from its own footings and open clear volumes', () => {
    expect(BOATHOUSE_PIECES).toHaveLength(STYLE_KEYS.length);
    expect(new Set(BOATHOUSE_BLUEPRINTS.map(b => b.id)).size).toBe(STYLE_KEYS.length);
    for (const piece of BOATHOUSE_PIECES) {
      const b = piece.blueprint, style = b.styleId as StyleKey;
      expect(pieceFailures(piece, style), b.id).toEqual([]);
      expect(b.size.every(v => v <= 256), b.id).toBe(true);
      expect(b.size).toEqual([SPAN, site.water + BOATHOUSE.heightAboveWater, LENGTH]);
      // Every cell is carried down to a declared footing, not to an implied y = 0 slab.
      expect(unsupported(b, piece.footings.map(f => f.box.from)), b.id).toBe(0);
    }
  }, SLOW);

  it('keeps its water bay open from the bed to the lintel, from the slipway out through the mouth', () => {
    const bay = tide.clear.find(c => c.id === 'bay')!;
    expect(bay.box.from[0]).toBe(BOATHOUSE.bay.x[0]);
    expect(bay.box.to[0]).toBe(BOATHOUSE.bay.x[1]);
    expect(bay.box.to[2]).toBe(LENGTH);
    expect(bay.box.to[1] - site.water).toBe(BOATHOUSE.lintelAboveWater);
    // At least four metres of water in front of the slip, and a rowing boat's beam and freeboard fit under the lintel.
    expect((bay.box.to[2] - bay.box.from[2]) * CELL).toBeGreaterThanOrEqual(BOATHOUSE.bay.minLength * CELL);
    expect(bay.box.from[1]).toBeLessThanOrEqual(site.water - 2);
    expect((bay.box.to[0] - bay.box.from[0]) * CELL).toBeGreaterThan(1.4 * 2);
    expect(occupiedIn(tide.blueprint, bay.box)).toEqual([]);
  });

  it('wears a steep slate roof whose ridge stands at least 8 m above the lake', () => {
    expect(BOATHOUSE.ridgeAboveWater * CELL).toBeGreaterThanOrEqual(8);
    const { at, size } = voxels(tide.blueprint);
    // The roof's top cell at mid-span is Tide's slate, and the roof falls steeply to the eaves (pitch ≥ 45°).
    const topAt = (x: number) => { for (let y = size[1] - 1; y >= 0; y--) if (at(x, y, LENGTH / 2)) return y; return -1; };
    const ridge = topAt(SPAN / 2), eave = topAt(4);
    expect(at(SPAN / 2 - 6, topAt(SPAN / 2 - 6), LENGTH / 2)).toBe(STYLES.tide.roof);
    expect((ridge - eave) / (SPAN / 2 - 4)).toBeGreaterThanOrEqual(1);
    expect((ridge - site.water) * CELL).toBeGreaterThanOrEqual(8);
  });

  it('claims no presence: no windows, no glass and no lamps; staging walks and the mooring sit where the deck is', () => {
    for (const piece of BOATHOUSE_PIECES) {
      expect(piece.blueprint.windows).toEqual([]);
      expect(piece.emitters).toEqual([]);
      expect(piece.blueprint.boxes.some(b => b.material === MAT.glass)).toBe(false);
    }
    const deckTop = site.water + BOATHOUSE.deckAboveWater;
    expect(tide.walks.map(w => w.id)).toEqual(['west-staging', 'east-staging']);
    for (const walk of tide.walks) expect(new Set(walk.tops)).toEqual(new Set([deckTop]));
    const mooring = tide.mounts.find(m => m.id === 'bay-mooring')!;
    expect(mooring.position[1]).toBeGreaterThan(site.water);
    expect(mooring.position[1]).toBeLessThan(deckTop);
  });

  it('follows the supplied ground: a deeper lake lengthens the piles and every pile still finds the bed', () => {
    // Six more cells of lake over the same bed offshore; the bank rises with it so the back still stands ashore.
    const deep: BoathouseSite = { water: 16, ground: (x, z) => site.ground(x, z) + 6 * Math.max(0, 1 - z / 48) };
    const piece = createBoathouse('tide', deep), shallowPiles = tide.footings.filter(f => f.id.startsWith('pile-'));
    const piles = piece.footings.filter(f => f.id.startsWith('pile-'));
    expect(piles.length).toBeGreaterThanOrEqual(shallowPiles.length);
    for (const f of piles) {
      const [x, , z] = f.box.from, bed = Math.floor(Math.min(deep.ground(x, z), deep.ground(x + 1, z), deep.ground(x, z + 1), deep.ground(x + 1, z + 1)));
      expect(f.box.from[1], f.id).toBe(bed);
    }
    expect(pieceFailures(piece, 'tide')).toEqual([]);
  }, SLOW);

  it('refuses a site it cannot honestly stand on', () => {
    // The back drowned, a mouth too shallow for a boat, ground rising over the stagings, a bad sample.
    expect(() => createBoathouse('tide', { water: 10, ground: () => 2 })).toThrow(/under water/);
    expect(() => createBoathouse('tide', { water: 10, ground: (_x, z) => (z > 70 ? 8 : 14) })).toThrow(/a boat needs/);
    expect(() => createBoathouse('tide', { water: 10, ground: (_x, z) => (z < 40 ? 24 : 0) })).toThrow(/above the stagings/);
    expect(() => createBoathouse('tide', { water: 10, ground: () => Number.NaN })).toThrow(/height at or above/);
  });
});
