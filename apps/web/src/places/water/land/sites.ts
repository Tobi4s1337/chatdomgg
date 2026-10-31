import type { Vec3 } from '@chatdom/shared';
import { CELL, foundationAt, toWorld, type BoathousePlan, type CardinalFrame, type PierPlan } from '../../../../../../packages/world/src/places/water/index';
import type { BoathouseSite } from '../../../../../../packages/content/src/places/water/boathouse/index';
import { PIER, type Pier, type PierSite } from '../../../../../../packages/content/src/places/water/pier/index';
import type { WaterPiece } from '../../../../../../packages/content/src/places/water/place-piece';

/** A static piece and the cardinal frame its blueprint corner takes in the world. */
export interface PiecePlacement { readonly id: string; readonly piece: WaterPiece; readonly frame: CardinalFrame }

/**
 * The pier factory's site from the planner's `PierPlan`: the walk length, the deck's height over the water and the
 * real foundation grid, read as depth under the deck top in pier-local cells. Pier x = 0 is the walk's west edge
 * (`plan.walk.x[0]`); the head's span must be the factory's own −22..42 cells about it.
 */
export function pierSite(plan: PierPlan, seed: number): PierSite {
  const x0 = plan.walk.x[0], walk = Math.round(plan.walk.length / CELL);
  const width = Math.round((plan.walk.x[1] - x0) / CELL);
  const head = [Math.round((plan.head.x[0] - x0) / CELL), Math.round((plan.head.x[1] - x0) / CELL)];
  if (width !== PIER.walkWidth || head[0] !== PIER.head.x[0] || head[1] !== PIER.head.x[1] || Math.round((plan.head.z[1] - plan.head.z[0]) / CELL) !== PIER.head.depth) {
    throw new RangeError(`${plan.site.id}: the land's walk (${width} cells) and head (${head.join('..')}) do not match the pier's ${PIER.walkWidth}-cell walk and ${PIER.head.x.join('..')} head.`);
  }
  return {
    walk, seed, freeboard: plan.deckAboveWater / CELL,
    depth: (x, z) => (plan.deck - foundationAt(plan.foundation, [x0 + x * CELL, z * CELL])) / CELL,
  };
}

/** Each pier module's frame: its corner carried by the pier's own frame and cardinal turn, at the deck's datum. */
export function pierPlacements(plan: PierPlan, pier: Pier): PiecePlacement[] {
  return pier.modules.map(module => {
    const local: Vec3 = [plan.walk.x[0] + module.offset[0] * CELL, plan.deckAboveWater + module.offset[1] * CELL, module.offset[2] * CELL];
    return { id: module.id, piece: module.piece, frame: { origin: toWorld(plan.frame, local), turn: plan.frame.turn } };
  });
}

/**
 * The boathouse on the planner's `BoathousePlan`: the piece's y = 0 sits on the lowest cell under its footprint,
 * the lake surface whole cells above it, and the factory reads the real foundation grid as ground in its own cells.
 */
export function boathousePlacement(plan: BoathousePlan, build: (site: BoathouseSite) => WaterPiece): PiecePlacement {
  const level = plan.frame.origin[1], lowest = Math.min(...plan.foundation.heights);
  const water = Math.max(1, Math.ceil((level - lowest) / CELL - 1e-9)), base = level - water * CELL;
  const piece = build({ water, ground: (x, z) => (foundationAt(plan.foundation, [x * CELL, z * CELL]) - base) / CELL });
  const origin = toWorld(plan.frame, [0, base - level, 0]);
  return { id: piece.blueprint.id, piece, frame: { origin, turn: plan.frame.turn } };
}
