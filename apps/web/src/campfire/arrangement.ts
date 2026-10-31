import { DUSK_COURT_MAX_PLAYERS } from './ports';

/*
 * The ring of logs. Pure layout in metres around the hearth at the origin, +Y up. Angles are about
 * +Y with 0 toward +Z (the establishing camera's side). The Magistrate's seat is across the fire from
 * that camera so the streamer faces the stream; the footpath back to the kingdom leaves on the left.
 */

export type XZ = readonly [number, number];

/** Direction of the worn footpath, back toward the kingdom on the far-left horizon. */
export const PATH_ANGLE = -2.3;
export const MAGISTRATE_ANGLE = Math.PI - .2;
export const HEARTH_RADIUS = .78;
const PATH_GAP = .44;
const SEAT_PITCH = .8;
const LOG_END = .26;
const LOG_GAP = .5;
const MAGISTRATE_ARC = 1.05;
const MIN_RADIUS = 2.1;
/** The root sits a little in front of the log's centre line, so the seat of the breeches meets its crown. */
export const HIP_FORWARD = .05;
const LANTERN_FORWARD = .3;
const LANTERN_SIDE = .42;
/** The walking corridor between the sitters' feet and the hearth stones, measured in from the ring. */
const CORRIDOR = .8;

export interface SeatPlace {
  readonly seat: number;
  readonly kind: 'magistrate' | 'player';
  /** Where the root (under the pelvis) sits, on the seat's centre line. */
  readonly hip: XZ;
  /** Body yaw about +Y; zero faces +Z. */
  readonly heading: number;
  /** Index into `logs`, or -1 for the Magistrate's chair. */
  readonly log: number;
  readonly lantern: XZ | null;
}

export interface LogPlace {
  readonly seats: readonly number[];
  readonly centre: XZ;
  readonly length: number;
  /** Yaw about +Y applied to a log authored along local +X. */
  readonly yaw: number;
}

export interface Arrangement {
  readonly players: number;
  readonly radius: number;
  readonly logs: readonly LogPlace[];
  readonly seats: readonly SeatPlace[];
  readonly magistrate: { readonly centre: XZ; readonly yaw: number } | null;
}

const at = (angle: number, radius: number): XZ => [Math.sin(angle) * radius, Math.cos(angle) * radius];
const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
/** Heading that faces from `from` toward `to`. */
export const facing = (from: XZ, to: XZ): number => Math.atan2(to[0] - from[0], to[1] - from[1]);

/** Logs of two, with one log of three when the count is odd (a single sitter shares nothing). */
export function logGroups(players: number): readonly number[] {
  if (players <= 0) return [];
  if (players === 1) return [1];
  const groups = Array<number>(Math.floor(players / 2)).fill(2);
  if (players % 2) groups[groups.length - 1] = 3;
  return groups;
}

const logLength = (seats: number): number => seats * SEAT_PITCH + LOG_END;

/**
 * A ring for 0–11 players and an optional Magistrate. Logs share the open arc evenly, each straight
 * and tangent to the ring, never across the footpath or the Magistrate's place.
 */
export function campfireArrangement(players: number, magistrate: boolean): Arrangement {
  if (!Number.isSafeInteger(players) || players < 0 || players > DUSK_COURT_MAX_PLAYERS) throw new Error(`A campfire seats 0–${DUSK_COURT_MAX_PLAYERS} players.`);
  const groups = logGroups(players);
  // Open arc runs clockwise from just past the Magistrate around to the footpath and on to the Magistrate again.
  const blocked = PATH_GAP * 2 + (magistrate ? MAGISTRATE_ARC : 0);
  const open = Math.PI * 2 - blocked;
  const lengths = groups.map(logLength);
  const needed = lengths.reduce((n, l) => n + l, 0) + LOG_GAP * (groups.length + 1);
  const radius = Math.max(MIN_RADIUS, needed / open);
  // The open arc is two runs: Magistrate → footpath and footpath → Magistrate, both increasing angle.
  const start = MAGISTRATE_ANGLE + (magistrate ? MAGISTRATE_ARC / 2 : 0);
  const pathStart = start + ((PATH_ANGLE - PATH_GAP - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const runs = [{ from: start, span: pathStart - start }, { from: pathStart + PATH_GAP * 2, span: open - (pathStart - start) }];
  const arcs = lengths.map(l => l / radius);
  const gap = LOG_GAP / radius;
  // As many logs as fit go into the first run; the rest share the second evenly.
  let first = 0;
  for (let used = gap; first < arcs.length && used + arcs[first]! + gap <= runs[0]!.span + 1e-9; first++) used += arcs[first]! + gap;
  const members = [arcs.slice(0, first), arcs.slice(first)];
  const middles: number[] = [];
  members.forEach((list, r) => {
    const run = runs[r]!, spare = (run.span - list.reduce((n, a) => n + a, 0)) / (list.length + 1);
    let cursor = run.from + spare;
    for (const arc of list) { middles.push(cursor + arc / 2); cursor += arc + spare; }
  });
  const logs: LogPlace[] = [];
  const seats: SeatPlace[] = [];
  if (magistrate) {
    const centre = at(MAGISTRATE_ANGLE, radius + .12);
    const heading = facing(centre, [0, 0]);
    seats.push({ seat: 0, kind: 'magistrate', hip: forward(centre, heading, HIP_FORWARD), heading, log: -1, lantern: null });
  }
  let next = 1;
  for (const [index, size] of groups.entries()) {
    const middle = middles[index]!;
    const centre = at(middle, radius);
    const inward = facing(centre, [0, 0]);
    // Local +X runs along the tangent; with three.js yaw, +X maps to (cos ψ, −sin ψ).
    const tangent: XZ = [Math.cos(middle), -Math.sin(middle)];
    const yaw = Math.atan2(-tangent[1], tangent[0]);
    const log = logs.length;
    const ids: number[] = [];
    for (let k = 0; k < size; k++) {
      const offset = (k - (size - 1) / 2) * SEAT_PITCH;
      const seatAt: XZ = [centre[0] + tangent[0] * offset, centre[1] + tangent[1] * offset];
      // Face across the log toward the fire, turned a little toward the flame itself.
      const toFire = facing(seatAt, [0, 0]);
      const heading = inward + wrap(toFire - inward) * .6;
      // Beside the shins on the log's outer ends; a log's middle sitter takes the gap on their left.
      const side = k === size - 1 && size > 1 ? -1 : 1;
      const lantern = forward(seatAt, inward, LANTERN_FORWARD, side * LANTERN_SIDE);
      ids.push(next);
      seats.push({ seat: next++, kind: 'player', hip: forward(seatAt, inward, HIP_FORWARD), heading, log, lantern });
    }
    logs.push({ seats: ids, centre, length: lengths[index]!, yaw });
  }
  return { players, radius, logs, seats, magistrate: magistrate ? { centre: at(MAGISTRATE_ANGLE, radius + .12), yaw: facing(at(MAGISTRATE_ANGLE, radius), [0, 0]) } : null };
}

/** A point `distance` ahead along `heading`, plus `side` metres to the sitter's left. */
export function forward(from: XZ, heading: number, distance: number, side = 0): XZ {
  return [from[0] + Math.sin(heading) * distance + Math.cos(heading) * side, from[1] + Math.cos(heading) * distance - Math.sin(heading) * side];
}

/**
 * Walking route (soles, metres) from the footpath to standing in front of a seat: up the path, in
 * through its gap in the ring, round the corridor between feet and hearth, then to the seat.
 */
export function approachRoute(arrangement: Arrangement, seat: number, soleForward: number): readonly XZ[] {
  const place = arrangement.seats.find(s => s.seat === seat);
  if (!place) throw new Error(`No seat ${seat} in this ring.`);
  const inside = arrangement.radius - CORRIDOR;
  const seatAngle = Math.atan2(place.hip[0], place.hip[1]);
  const route: XZ[] = [at(PATH_ANGLE, 9.5), at(PATH_ANGLE, arrangement.radius + 1.2), at(PATH_ANGLE, inside)];
  const turn = wrap(seatAngle - PATH_ANGLE), steps = Math.ceil(Math.abs(turn) / .28);
  for (let i = 1; i <= steps; i++) route.push(at(PATH_ANGLE + turn * i / steps, inside));
  route.push(forward(place.hip, place.heading, soleForward + .04));
  return route;
}
