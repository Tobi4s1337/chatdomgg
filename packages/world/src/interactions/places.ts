import type { Vec3 } from '@chatdom/shared';
import type { CardinalTurn } from '../settlement/types';
import { interactionTargetId } from './ids';
import { STREET_ZONE, type InteractionAnchor, type InteractionPlacement } from './registry';

/**
 * Producer outputs → registry placements. Each place keeps its own local frame (metres, +Y up, heading zero faces
 * +Z) and its installed origin/turn in the founded layout; these helpers only rename the producer's own authored
 * points into anchors. They never invent a seat, an approach or a table the producer did not author.
 */

/** How close a seated body's own place must be for E to reach it from the approach. */
export const SEAT_REACH = 2;

type XZ = readonly [number, number];

/**
 * One log seat as the campfire's pure ring layout authors it (`campfireArrangement(players, magistrate).seats`,
 * `apps/web/src/campfire/arrangement.ts`): the sitter's hip on the clearing floor, the seated heading, and whether
 * it is the Magistrate's chair. The same arrangement feeds the clearing's drawn people, so both agree.
 */
export interface CampfireSeatSource {
  readonly seat: number;
  readonly kind: 'player' | 'magistrate';
  readonly hip: XZ;
  readonly heading: number;
}

/**
 * The campfire clearing's walk-up log seats as `fire:<site>:seat:<n>` anchors in the street zone, in the clearing's
 * own frame (hearth at the origin, floor at y 0, heading zero faces +Z):
 *
 * - look point: the log under the sitter's hips at the clearing's one shared seat height (`sharedSeatTop()`);
 * - rest: the ground under the hips, the sole datum the citizen rig seats on (the clearing's own figures stand their
 *   root there too), so a seated body is not lifted onto the log top;
 * - approach: the last standing waypoint of the clearing's own approved route (`approachRoute(arrangement, seat,
 *   soleForward)`), in the corridor between feet and hearth stones; a seat with no route gets no target.
 *
 * The Magistrate's chair is the monarch's, never a walk-up seat, so it is left out by kind, not by number.
 */
export function campfirePlacement(input: {
  readonly site: string; readonly origin: Vec3; readonly turn: CardinalTurn;
  readonly seatTop: number; readonly seats: readonly CampfireSeatSource[];
  readonly approach: (seat: number) => readonly XZ[];
  /** `campfire:<site>@<arrangement>`: which installed clearing and ring these came from. A new ring is a new layout. */
  readonly source: string;
}): InteractionPlacement {
  const anchors: InteractionAnchor[] = [];
  for (const seat of input.seats) {
    if (seat.kind !== 'player') continue;
    const route = input.approach(seat.seat), last = route[route.length - 1];
    if (!last) continue;
    let id: string;
    try { id = interactionTargetId.campfireSeat(input.site, String(seat.seat)); } catch { continue; }
    const [x, z] = seat.hip;
    anchors.push({ id, kind: 'campfire-seat', zone: STREET_ZONE, position: [x, input.seatTop, z], approach: [last[0], 0, last[1]],
      reach: SEAT_REACH, rest: [x, 0, z], facing: seat.heading });
  }
  return { source: input.source, origin: input.origin, turn: input.turn, cell: 1, anchors };
}

/**
 * One tavern chair as the tavern layout authors it (`worldSeats(plan)`, already in the tavern's own frame):
 * the centre of the seat surface (where the hips rest), the seated facing and the standing approach. Only chairs at a table (`tableId` set) belong to
 * a table host; a bench by the hearth is not a game seat and has no `tavern` action in the frozen five.
 */
export interface TavernSeatSource {
  readonly key: string;
  readonly tableId: string | null;
  readonly position: Vec3;
  readonly facing: number;
  readonly approach: Vec3;
}

/**
 * Tavern table chairs as `tavern:<table>:seat:<seat>` anchors in the zone `tavern:<id>`, which the tavern's own
 * threshold flow assigns (`InteractionZones.zoneOf`); there is no door action. The seat ID is the authored
 * part of the layout's `<table>:<seat>` key, so it survives occupancy, LOD and load order.
 */
export function tavernPlacement(input: {
  readonly tavern: string; readonly origin: Vec3; readonly turn: CardinalTurn;
  readonly seats: readonly TavernSeatSource[]; readonly source: string;
}): InteractionPlacement {
  const anchors: InteractionAnchor[] = [];
  for (const seat of input.seats) {
    if (!seat.tableId) continue;
    const prefix = `${seat.tableId}:`;
    const local = seat.key.startsWith(prefix) ? seat.key.slice(prefix.length) : null;
    // A key that does not name its own table is not this table's chair: it is left for the registry to never see.
    if (!local) continue;
    let id: string;
    try { id = interactionTargetId.tavernSeat(seat.tableId, local); } catch { continue; }
    // The look lands on the seat surface; the rest is the floor under the sitter's hips (the approach's floor).
    anchors.push({ id, kind: 'tavern-seat', zone: `tavern:${input.tavern}`, position: seat.position,
      approach: seat.approach, reach: SEAT_REACH, rest: [seat.position[0], seat.approach[1], seat.position[2]], facing: seat.facing });
  }
  return { source: input.source, origin: input.origin, turn: input.turn, cell: 1, anchors };
}

/** `fire:<site>:seat:<n>` → its parts, for routing to the campfire host. */
export function campfireSeatOf(targetId: string): { readonly site: string; readonly seat: number } | null {
  const match = /^fire:([^:]+):seat:(\d{1,2})$/.exec(targetId);
  return match ? { site: match[1]!, seat: Number(match[2]) } : null;
}
/** `tavern:<table>:seat:<seat>` → its parts, for routing to the table host. */
export function tavernSeatOf(targetId: string): { readonly table: string; readonly seat: string } | null {
  const match = /^tavern:([^:]+):seat:([^:]+)$/.exec(targetId);
  return match ? { table: match[1]!, seat: match[2]! } : null;
}
