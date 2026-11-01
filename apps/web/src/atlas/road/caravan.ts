import { sampleRoad, type RoadPath } from './geometry';

/**
 * The public caravan's column on the map (Atlas.md §5.2): a banner-bearer and torch-bearers in the raider's colours.
 * The figures are the raid's mark, not a roster: their number grows slowly with the travellers Twitch reported and
 * never stands for anyone in particular. Spacing is kept in screen pixels, so the column reads as a column at every
 * distance instead of collapsing into a blot when the camera pulls back.
 */

export interface Marcher {
  index: number;
  x: number;
  y: number;
  angle: number;
  /** The first carries the kingdom's banner; the rest carry torches. */
  role: 'standard' | 'torch';
  /** Walk-cycle phase in turns, offset per marcher so the column never steps in lockstep. */
  phase: number;
}

/** Figures in the column for a raid of `viewers` travellers: 5 for a handful, 11 for thousands. */
export function caravanCount(viewers: number): number {
  if (!Number.isFinite(viewers) || viewers < 1) return 5;
  return Math.max(5, Math.min(11, 4 + Math.round(Math.log10(viewers) * 2.4)));
}

/** Screen pixels between two marchers' feet along the road. */
export const MARCHER_SPACING_PX = 17;
/** Steps per second at a walk; the torches sway with them. */
export const STEP_RATE = 1.7;

/** How far behind the head the last marcher walks, in fractions of the road, at `scale` CSS px per world unit. */
export function columnTail(path: RoadPath, count: number, scale: number): number {
  if (path.total <= 0 || scale <= 0) return 0;
  return ((count - 1) * MARCHER_SPACING_PX) / (scale * path.total);
}

/**
 * Where each marcher walks when the head is at `head` (fractions of the road; it runs past 1 while the column
 * files into the destination). Marchers not yet out of the source, or already through the destination's gate, are
 * not drawn.
 */
export function caravanLayout(path: RoadPath, head: number, count: number, scale: number, time: number): Marcher[] {
  const out: Marcher[] = [];
  if (path.total <= 0 || scale <= 0) return out;
  const step = MARCHER_SPACING_PX / (scale * path.total);
  for (let index = 0; index < count; index++) {
    const s = head - index * step;
    if (s < 0 || s > 1) continue;
    const at = sampleRoad(path, s);
    out.push({ index, x: at.x, y: at.y, angle: at.angle, role: index === 0 ? 'standard' : 'torch', phase: time * STEP_RATE + index * 0.37 });
  }
  return out;
}
