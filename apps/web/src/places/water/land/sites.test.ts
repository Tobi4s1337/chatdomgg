import { describe, expect, it } from 'vitest';
import { foundKingdomGeography, naturalLandHeight, type KingdomGeography } from '@chatdom/world';
import { planWaterPlaces, placePieceAnchors, floatingFootings, CELL } from '../../../../../../packages/world/src/places/water/index';
import { createPier } from '../../../../../../packages/content/src/places/water/pier/index';
import { pieceFailures, walkFailures } from '../../../../../../packages/content/src/places/water/piece-checks';
import { WATER_PIECE_SPECS } from './specs';
import { pierPlacements, pierSite } from './sites';

const SEEDS = ['chatdom', 'tobi4s_', 'a', 'kingdom-42', 'streamer_9000', 'river'];
const SLOW = 180_000;
const geography = (seed: string) => foundKingdomGeography({ seed, tier: 'town', firstYear: 2022, year: 2026 });
const plan = (land: KingdomGeography) => planWaterPlaces({ landform: land.landform, sites: land.sites, specs: WATER_PIECE_SPECS, destinations: {} });

describe('the pier on the founded lakes', () => {
  for (const seed of SEEDS) it(`stands on ${seed}'s sampled bed with a continuous deck at the land's height`, () => {
    const land = geography(seed), pierPlan = plan(land).lake.pier!;
    const pier = createPier('tide', pierSite(pierPlan, 7));
    const placed = pierPlacements(pierPlan, pier);
    expect(placed.length).toBe(7);
    for (const { piece } of placed) expect(pieceFailures(piece, 'tide', false), piece.blueprint.id).toEqual([]);
    for (const { piece } of placed) for (const walk of piece.walks) expect(walkFailures(piece.blueprint, walk)).toEqual([]);

    // Every pile and the stone landing bear on the land's own ground: none floats, none sinks more than a cell.
    const ground = (x: number, z: number) => naturalLandHeight(land.landform, x, z);
    for (const { frame, piece } of placed) {
      expect(floatingFootings(land.landform, placePieceAnchors(frame, piece)), piece.blueprint.id).toEqual([]);
      for (const footing of placePieceAnchors(frame, piece).footings) {
        // Never deeper than a cell under the lowest ground it covers (piles and courses are bedded, not buried).
        const [cx, cz] = footing.outline.reduce(([sx, sz], [x, z]) => [sx + x / footing.outline.length, sz + z / footing.outline.length], [0, 0]);
        const lowest = Math.min(ground(cx, cz), ...footing.outline.map(([x, z]) => ground(x + (cx - x) * 0.02, z + (cz - z) * 0.02)));
        expect(footing.base, `${piece.blueprint.id}/${footing.id}`).toBeGreaterThan(lowest - CELL - 1e-6);
      }
    }

    // One walk from the root to the head's end: the strips join end to end, never stepping more than one cell, and
    // the head's deck lies at the land's deck height, where the pier-head path node stands.
    const walks = placed.flatMap(({ frame, piece }) => placePieceAnchors(frame, piece).walks).filter(w => w.id !== 'head-end');
    for (let i = 1; i < walks.length; i++) {
      const [a, b] = [walks[i - 1]!.ends[1], walks[i]!.ends[0]];
      expect(Math.hypot(a[0] - b[0], a[2] - b[2]), `${walks[i]!.id} joins`).toBeLessThan(1e-6);
      expect(Math.abs(a[1] - b[1]), `${walks[i]!.id} step`).toBeLessThanOrEqual(CELL + 1e-9);
    }
    const head = walks.at(-1)!;
    expect(Math.abs(head.ends[1][1] - pierPlan.deck)).toBeLessThan(1e-9);
    // The lantern hangs over the head; the boats' mooring rings stand above the water at both wing ends.
    const headPiece = placed.at(-1)!, anchors = placePieceAnchors(headPiece.frame, headPiece.piece);
    expect(anchors.emitters).toHaveLength(1);
    expect(anchors.mounts.map(m => m.id).sort()).toEqual(['mooring-east', 'mooring-west']);
    for (const mount of anchors.mounts) expect(mount.pivot[1]).toBeGreaterThan(pierPlan.deck - pierPlan.deckAboveWater);
  }, SLOW);

  it('refuses a pier site whose head the factory cannot build', () => {
    const pierPlan = plan(geography('chatdom')).lake.pier!;
    expect(() => pierSite({ ...pierPlan, head: { ...pierPlan.head, x: [pierPlan.head.x[0] + 1, pierPlan.head.x[1]] } }, 7)).toThrow(/head/);
  });
});
