import { monarchCrownOf, type MonarchTitle } from '@chatdom/shared/realm';

/**
 * The monarch among the walkers (Monarch.md §7.6, Artstyle-Soul-Feel.md §8). The room crowns only the verified
 * broadcaster; this view trusts that mark and nothing else, and when two walkers carry it, it names nobody.
 * Pure in its inputs and the clock it is given, so every rule here is tested without a renderer.
 */
export interface RoyalWalker {
  readonly id: string; readonly x: number; readonly y: number; readonly z: number;
  /** The room's mark: the title while this walker is the verified broadcaster, else empty or absent. */
  readonly crown?: string | null | undefined;
  readonly self?: boolean;
}
export interface MonarchSighting { readonly id: string; readonly title: MonarchTitle; readonly position: readonly [number, number, number]; readonly self: boolean }
export interface MonarchUpdate {
  readonly monarch: MonarchSighting | null;
  /** True on the one update in which the monarch walked in: the bell rings and heads turn. */
  readonly arrived: boolean;
}

/** Away this long and the next appearance is an arrival again; a dropped connection is not a second entrance. */
export const MONARCH_RETURN_MS = 20_000;
/** Heads within this many metres turn when the monarch walks in, for this long. */
export const MONARCH_GAZE_RADIUS_M = 16, MONARCH_GAZE_MS = 7_000;
/** Afterwards, people the monarch passes close by still look up. */
export const MONARCH_NEAR_M = 4.5;
/** A neck turns only so far; past it the body would have to turn. */
const NECK = 1.05;

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

/** The single crowned walker, or null when nobody (or more than one walker) carries the mark. */
export function findMonarch(walkers: readonly RoyalWalker[]): MonarchSighting | null {
  let found: MonarchSighting | null = null;
  for (const walker of walkers) {
    const title = monarchCrownOf(walker.crown);
    if (!title || ![walker.x, walker.y, walker.z].every(Number.isFinite)) continue;
    if (found) return null;
    found = { id: walker.id, title, position: [walker.x, walker.y, walker.z], self: !!walker.self };
  }
  return found;
}

/**
 * How much a walker's head turns toward the monarch, relative to their body heading, at `now`. Undefined means the
 * head keeps its own pose. Heading follows the citizen renderer: zero faces +Z, a heading h looks along (sin h, cos h).
 */
export function gazeToward(monarch: MonarchSighting | null, arrivedAt: number | null, now: number,
  walker: { readonly id: string; readonly x: number; readonly z: number; readonly heading: number }): { readonly yaw: number; readonly weight: number } | undefined {
  if (!monarch || walker.id === monarch.id || ![walker.x, walker.z, walker.heading].every(Number.isFinite)) return undefined;
  const dx = monarch.position[0] - walker.x, dz = monarch.position[2] - walker.z, distance = Math.hypot(dx, dz);
  if (distance < .3) return undefined;
  const since = arrivedAt === null ? Infinity : now - arrivedAt;
  // On arrival: a quick, staggered turn (nearer heads first), held, then eased back; later only close by.
  const arrival = since >= 0 && since < MONARCH_GAZE_MS && distance <= MONARCH_GAZE_RADIUS_M
    ? smooth((since - distance * 25) / 450) * (1 - smooth((since - (MONARCH_GAZE_MS - 1500)) / 1500)) : 0;
  const near = distance <= MONARCH_NEAR_M ? .7 * (1 - smooth((distance - MONARCH_NEAR_M + 1.5) / 1.5)) : 0;
  const weight = Math.max(arrival, near);
  if (weight <= 0.001) return undefined;
  const relative = wrap(Math.atan2(dx, dz) - walker.heading);
  // Someone with their back to the monarch turns as far as a neck allows, never all the way round.
  const yaw = Math.max(-NECK, Math.min(NECK, relative)) * weight;
  return { yaw, weight };
}

/**
 * The beacon catches when the monarch walks in: up to a strong flame over a second and a half, held, then settled
 * to a steady glow for as long as they are in the kingdom. Zero while they are away.
 */
export function monarchBeacon(present: boolean, arrivedAt: number | null, now: number): number {
  if (!present) return 0;
  const since = arrivedAt === null ? Infinity : now - arrivedAt;
  if (since < 0) return .5;
  const rise = 1 - Math.pow(1 - smooth(since / 1600), 2);
  const settle = smooth((since - 5000) / 3000);
  return rise * (.88 - .38 * settle);
}

/** The monarch tracker: one per view of walkers (the walk or the stream's observed walkers). */
export function createMonarchPresence() {
  let primed = false, current: MonarchSighting | null = null, arrivedAt: number | null = null;
  let lastSeenId: string | null = null, lastSeenAt = -Infinity;
  return {
    /**
     * Feed every frame's walkers. The first update primes the view: a monarch already walking when you open the
     * kingdom has not just arrived, unless it is you.
     */
    update(now: number, walkers: readonly RoyalWalker[]): MonarchUpdate {
      const monarch = findMonarch(walkers);
      let arrived = false;
      if (monarch) {
        const returning = lastSeenId === monarch.id && now - lastSeenAt <= MONARCH_RETURN_MS;
        if (!returning && (primed || monarch.self) && current?.id !== monarch.id) { arrived = true; arrivedAt = now; }
        lastSeenId = monarch.id; lastSeenAt = now;
      }
      if (walkers.length) primed = true;
      current = monarch;
      return { monarch, arrived };
    },
    get monarch() { return current; },
    get arrivedAt() { return arrivedAt; },
    gaze(walker: { readonly id: string; readonly x: number; readonly z: number; readonly heading: number }, now: number) {
      return gazeToward(current, arrivedAt, now, walker);
    },
    beacon(now: number) { return monarchBeacon(!!current, arrivedAt, now); },
    reset() { primed = false; current = null; arrivedAt = null; lastSeenId = null; lastSeenAt = -Infinity; },
  };
}
export type MonarchPresence = ReturnType<typeof createMonarchPresence>;
