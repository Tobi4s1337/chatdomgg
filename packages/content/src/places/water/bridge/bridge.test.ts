import { describe, expect, it } from 'vitest';
import { CIVIC_KITS, CIVIC_SHIELD, type CivicStyle } from '../../../civic/kit';
import { MAT } from '../../../materials';
import { pieceFailures, voxels } from '../piece-checks';
import { BRIDGE, BRIDGE_BLUEPRINTS, BRIDGE_PIECES, bridgeFrame, createHumpbackBridge, humpbackDeckTop } from './index';

const SLOW = 120_000;
const CELL = 0.125;
/** Sites across the admitted range: shallow and deep pools, low and high banks. */
const SITES: readonly [CivicStyle, number, number][] = [['hearth', 6, 14], ['tide', 2, 3], ['hearth', 12, 24], ['tide', 4, 20], ['hearth', 9, 10]];
const [L, , D] = BRIDGE.size;
const C = BRIDGE.centre;

describe('humpback bridge', () => {
  it('is honest at every admitted site: palette, support, footings, clear arch, deck walk and budgets', () => {
    expect(BRIDGE_PIECES.map(p => p.blueprint.styleId)).toEqual(['hearth', 'tide']);
    expect(BRIDGE_BLUEPRINTS).toEqual(BRIDGE_PIECES.map(p => p.blueprint));
    for (const [style, water, bank] of SITES) {
      const piece = createHumpbackBridge(style, water, bank);
      expect(pieceFailures(piece, style), piece.blueprint.id).toEqual([]);
      expect(Math.max(...piece.blueprint.size)).toBeLessThanOrEqual(256);
    }
  }, SLOW);

  for (const [style, water, bank] of SITES) {
    describe(`${style} over ${water} cells of water, banks at ${bank}`, () => {
      const piece = createHumpbackBridge(style, water, bank), frame = bridgeFrame(water, bank);
      const { at } = voxels(piece.blueprint);
      const deck = piece.walks.find(w => w.id === 'deck')!;

      it('springs its open arch from the water, so arch and reflection close into a circle', () => {
        // The opening at the waterline spans about seven metres between solid springers.
        // The opening on one row: the run of air either side of the axis (face joints elsewhere are not the arch).
        const opening = (y: number, z: number): [number, number] => {
          let a = C, c = C;
          while (a > 0 && !at(a - 1, y, z)) a--;
          while (c < L && !at(c, y, z)) c++;
          return [a, c];
        };
        const [s0, s1] = opening(water, D >> 1);
        expect((s1 - s0) * CELL).toBeGreaterThanOrEqual(6.5);
        expect((s1 - s0) * CELL).toBeLessThanOrEqual(7.5);
        expect(at(s0 - 1, water, D >> 1)).not.toBe(0);
        expect(at(s1, water, D >> 1)).not.toBe(0);
        // Every row above the water is a chord of one semicircle about the springing line, centred on the axis:
        // half-width²+height² stays at the radius² within a cell, right through the barrel from face to face.
        for (let i = 0; i < BRIDGE.radius - 1; i++) {
          // The masonry faces (the outer layers carry only what projects: cutwaters, keystone and arms).
          for (const z of [BRIDGE.faces[0], D >> 1, BRIDGE.faces[1]]) {
            const [a, c] = opening(water + i, z), half = (c - a) / 2;
            expect(Math.abs((a + c) / 2 - C), `centred at row ${i}`).toBeLessThanOrEqual(0.5);
            expect(Math.abs(Math.hypot(half, i + 0.5) - BRIDGE.radius), `round at row ${i}, z ${z}`).toBeLessThan(1.2);
          }
        }
        // The crown is closed: the ring, then the deck over it.
        expect(at(C, frame.crownUnderside, D >> 1)).not.toBe(0);
        expect(frame.crownDeck - frame.crownUnderside).toBeGreaterThanOrEqual(BRIDGE.ring + 1);
      });

      it('carries one walkable deck from bank to bank, four metres wide, never steeper than one in two', () => {
        expect(deck.axis).toBe('x');
        expect([deck.along[0], deck.along[1]]).toEqual([0, L]);
        expect((deck.across[1] - deck.across[0]) * CELL).toBeGreaterThanOrEqual(3);
        expect(D * CELL).toBe(4);
        expect(deck.tops[0]).toBe(bank);
        expect(deck.tops.at(-1)).toBe(bank);
        expect(Math.max(...deck.tops)).toBe(frame.crownDeck);
        expect(deck.tops).toEqual(Array.from({ length: L }, (_, x) => humpbackDeckTop(x, water, bank)));
        // Each one-cell rise is followed by at least one level column: a 1:2 ramp at its steepest.
        deck.tops.forEach((top, x) => {
          if (x && top !== deck.tops[x - 1]) expect(deck.tops[x + 1], `column ${x}`).toBe(top);
        });
        // Symmetric about the arch axis, so the hump reads true.
        expect(deck.tops).toEqual([...deck.tops].reverse());
        // The setts are dry and worn, never mossed: moss belongs to the shade under and beside the arch.
        deck.tops.forEach((top, x) => { for (let z = deck.across[0]; z < deck.across[1]; z++) expect(at(x, top - 1, z)).not.toBe(MAT.moss); });
      });

      it('guards both sides of the deck with a sitting-height parapet and offers real seats on it', () => {
        // No gap a person could step through: through its three-cell thickness (mortar joints are recessed into one
        // face only) the wall stands from the deck to at least three cells above it.
        for (const side of [[1, 2, 3], [D - 2, D - 3, D - 4]]) for (let x = BRIDGE.newel; x < L - BRIDGE.newel; x++) {
          for (let y = deck.tops[x]!; y < deck.tops[x]! + 3; y++) {
            expect(side.some(z => at(x, y, z) !== 0), `parapet ${x},${y},${side[0]}`).toBe(true);
          }
        }
        expect(piece.seats.length).toBeGreaterThanOrEqual(4);
        expect(new Set(piece.seats.map(s => s.facing))).toEqual(new Set(['north', 'south']));
        for (const seat of piece.seats) {
          const { from, to } = seat.box, inward = seat.facing === 'south' ? to[2] : from[2] - 1;
          for (let x = from[0]; x < to[0]; x++) {
            // The seat is the parapet's own top, three to five cells over the setts in front of it, with air above.
            expect(at(x, to[1] - 1, from[2])).not.toBe(0);
            expect(at(x, to[1], from[2])).toBe(0);
            const rise = to[1] - deck.tops[x]!;
            expect(rise * CELL).toBeGreaterThanOrEqual(0.375);
            expect(rise * CELL).toBeLessThanOrEqual(0.625);
            expect(inward).toBeGreaterThanOrEqual(deck.across[0] - 1);
            expect(inward).toBeLessThanOrEqual(deck.across[1]);
          }
        }
      });

      it('sets the kingdom\'s own arms on both faces, their point resting on the projecting keystone', () => {
        const kit = CIVIC_KITS[style], width = CIVIC_SHIELD[0]!.length, x0 = C - width / 2;
        const marks = { B: kit.border, C: kit.charge } as Record<string, number>;
        for (const [face, proud] of [[1, 0], [D - 2, D - 1]] as const) {
          CIVIC_SHIELD.forEach((row, i) => {
            const y = frame.keystoneTop + CIVIC_SHIELD.length - 1 - i;
            [...row].forEach((mark, col) => {
              if (mark === '.') return;
              expect(at(x0 + col, y, face)).toBe(kit.field);
              expect(at(x0 + col, y, proud)).toBe(mark === 'F' ? 0 : marks[mark]);
            });
          });
          // The lowest row of the shield stands on the keystone, which projects to the outer layer.
          const point = [...CIVIC_SHIELD.at(-1)!].flatMap((mark, col) => (mark === '.' ? [] : [x0 + col]));
          expect(point.length).toBeGreaterThan(0);
          for (const x of point) expect(at(x, frame.keystoneTop - 1, proud)).toBe(kit.band);
        }
      });

      it('hangs four lamps on the corner newels whose glass the host lights only for real people', () => {
        expect(piece.emitters).toHaveLength(4);
        for (const e of piece.emitters) {
          const [x, y, z] = e.position.map(Math.floor) as [number, number, number];
          expect(at(x, y, z)).toBe(MAT.glass);
          expect(e.reach * CELL).toBeGreaterThanOrEqual(4);
          // Its newel stands at a deck end and the lamp is above the walkers' heads.
          expect(x < BRIDGE.newel || x >= L - BRIDGE.newel).toBe(true);
          expect(y - bank).toBeGreaterThanOrEqual(8);
        }
        // The pieces carry no presence windows of their own.
        expect(piece.blueprint.windows).toEqual([]);
      });

      it('grows moss only in shade and at the water, never on top of the copings', () => {
        const { size: [sx, sy, sz] } = voxels(piece.blueprint);
        let shaded = 0;
        for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) {
          if (at(x, y, z) !== MAT.moss) continue;
          let roofed = false;
          for (let above = y + 1; above < sy; above++) if (at(x, above, z)) { roofed = true; break; }
          if (roofed) shaded++;
          // Open-sky moss hugs the water: the cutwaters' weatherings and the waterline only.
          else expect(y - water, `moss in the sun at ${x},${y},${z}`).toBeLessThanOrEqual(3);
        }
        expect(shaded).toBeGreaterThan(20);
      });
    });
  }

  it('refuses kits without a civic dressing and impossible sites', () => {
    expect(() => createHumpbackBridge('grove' as CivicStyle, 6, 14)).toThrow(RangeError);
    for (const [water, bank] of [[1, 8], [13, 20], [6, 6], [6, 25], [4.5, 10], [6, Number.NaN]] as const) {
      expect(() => createHumpbackBridge('hearth', water, bank)).toThrow(RangeError);
    }
    expect(() => humpbackDeckTop(L, 6, 14)).toThrow(RangeError);
  });
});
