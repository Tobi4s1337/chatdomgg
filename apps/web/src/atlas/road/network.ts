/**
 * How a remembered road is inked (spec 23 R11, Atlas.md §5.2): a road appears on the first witnessed raid, thickens
 * with use on a log scale (raids first, travellers a little), crosses the sea between two languages as a sea lane, and
 * after an unused season fades to a dotted line. It never disappears: fading is a way of drawing, never a deletion.
 * Pure, so the map, the still and the tests agree.
 */

/** Seasons are not decided yet (decision 40): an unused season is 90 days, kept in this one place. */
export const UNUSED_SEASON_MS = 90 * 86_400_000;

export const ROAD_WIDTH = { min: 0.9, max: 4.4 } as const;

/** Stroke width in CSS px for a road of `raids` witnessed raids carrying `travellers` in all. */
export function roadWidth(raids: number, travellers: number): number {
  if (!Number.isFinite(raids) || raids < 1) return ROAD_WIDTH.min;
  const t = Math.max(0, Number.isFinite(travellers) ? travellers : 0);
  const width = ROAD_WIDTH.min + 0.62 * Math.log2(raids) + 0.2 * Math.log10(1 + t / Math.max(1, raids));
  return Math.round(Math.min(ROAD_WIDTH.max, Math.max(ROAD_WIDTH.min, width)) * 100) / 100;
}

/** Whether a road last used at `lastAt` has gone a whole season unused by `now` (it is drawn dotted). */
export function roadFaded(lastAt: number, now: number): boolean {
  return Number.isFinite(lastAt) && now - lastAt > UNUSED_SEASON_MS;
}

/** A road between two languages' lands is a sea lane; an end whose land is unknown never makes one. */
export function seaLane(regionA: number | null | undefined, regionB: number | null | undefined): boolean {
  return regionA !== null && regionA !== undefined && regionB !== null && regionB !== undefined && regionA !== regionB;
}

export type RoadStroke = 'road' | 'sea' | 'dotted';

/** The pen a road is drawn with. A faded sea lane is dotted too: the season wins over the water. */
export function roadStroke(road: { lastAt: number; ra: number | null; rb: number | null }, now: number): RoadStroke {
  if (roadFaded(road.lastAt, now)) return 'dotted';
  return seaLane(road.ra, road.rb) ? 'sea' : 'road';
}

/**
 * How many of the busiest roads the map inks at a scale (CSS px per world unit): few at the whole world, so the land
 * stays land and the roads read as a handful of trade routes, and all of them once you are among the kingdoms.
 */
export function networkBudget(scale: number, minScale: number): number {
  const zoom = minScale > 0 ? scale / minScale : 1;
  if (zoom < 1.6) return 48;
  if (zoom < 3.5) return 110;
  if (zoom < 8) return 220;
  return 400;
}

/** The order the network is inked in and trimmed by: most raids, then most travellers, then the latest, then the pair. */
export function compareRoads(a: { raids: number; travellers: number; lastAt: number; key: string }, b: { raids: number; travellers: number; lastAt: number; key: string }): number {
  return b.raids - a.raids || b.travellers - a.travellers || b.lastAt - a.lastAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** The undirected key of a road: the two channel IDs in a fixed order, so the road back is the same road. */
export function roadKey(a: string, b: string): string {
  return a.length < b.length || (a.length === b.length && a < b) ? `${a}~${b}` : `${b}~${a}`;
}
