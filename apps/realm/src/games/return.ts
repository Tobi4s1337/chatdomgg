import type { KingdomId, TavernAnchor } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { standingClear } from '@chatdom/world/interactions';
import { STEP_HEIGHT } from '@chatdom/world/movement';
import type { RealmRoomServices } from '../ports';
import { tavernPortalFor } from './portal';

/**
 * Coming back out of the tavern. When a person leaves the kingdom's tavern room, by its doorway or any other way,
 * the realm remembers it for a short while; their next arrival in that kingdom's room stands them outside the
 * tavern's street door, facing out, instead of at the usual gate. The realm decides this from its own record of the
 * leave and its own derivation of the door: the client never chooses where it appears.
 *
 * Both rooms of a kingdom live in this one realm process (`server.ts` filters both by kingdomId), so the record is
 * in memory. It is consumed by the first arrival, expires after `RETURN_WINDOW_MS`, and is bounded.
 */
export const RETURN_WINDOW_MS = 120_000;
const MAX_PENDING = 4096;
/**
 * Two people who come out together never stand inside each other. The first takes the anchor; later ones take the
 * nearest free spot just outside the door, beside it or a step further out, never back towards the doorway, all
 * facing out. Offsets are [beside, out] in metres in the anchor's own frame. Each spot is reached from the anchor on
 * clear, supported feet that follow the ground (up a step, down a block), so nobody appears behind a fence or on a wall. With
 * every spot taken (a crowd at the door), the spot farthest from everyone is used; bodies never block each other,
 * so it stays a sound arrival.
 */
export const RETURN_SPACING = .7;
const RETURN_OFFSETS = [[0, 0], [-.75, 0], [.75, 0], [0, .75], [-.75, .75], [.75, .75], [-1.5, 0], [1.5, 0],
  [-1.5, .75], [1.5, .75], [0, 1.5], [-.75, 1.5], [.75, 1.5], [-1.5, 1.5], [1.5, 1.5], [0, 2.25]] as const;
const REACH_STEP = .25;
/**
 * Walking out may drop down one block (a terrace edge beside the door), which a jump climbs back (apex 1.25 m);
 * walking up is one step at most.
 */
const RETURN_DROP = 1;
/** Clear standing feet on the ground at (x, z), up a step or down a block from `from`, nearest that height first. */
function groundNear(world: CollisionWorld, x: number, from: number, z: number): number | null {
  const tops = world.query({ min: [x - .3, from - RETURN_DROP - .01, z - .3], max: [x + .3, from + STEP_HEIGHT + .01, z + .3] })
    .map(box => box.max[1]).filter(top => top <= from + STEP_HEIGHT + 1e-9 && top >= from - RETURN_DROP - 1e-9);
  for (const y of [from, ...new Set(tops)].sort((a, b) => Math.abs(a - from) - Math.abs(b - from)))
    if (standingClear(world, [x, y, z])) return y;
  return null;
}
type Standing = { readonly x: number; readonly z: number };
/** The anchor, then its spots that are standing-clear and reachable from it in a straight walk, nearest first. */
function returnSpots(anchor: TavernAnchor, world: CollisionWorld): TavernAnchor[] {
  const turn = anchor.yaw / 256 * Math.PI * 2, out = [Math.sin(turn), Math.cos(turn)] as const, side = [out[1], -out[0]] as const;
  const [x, y, z] = anchor.feet, spots: TavernAnchor[] = [anchor];
  // No safe step at the door itself: no spot at all, and the person arrives at the usual gate.
  if (!standingClear(world, anchor.feet)) return [];
  for (const [b, o] of RETURN_OFFSETS.slice(1)) {
    const dx = side[0] * b + out[0] * o, dz = side[1] * b + out[1] * o, steps = Math.ceil(Math.hypot(dx, dz) / REACH_STEP);
    // Walked out from the anchor a quarter metre at a time, following the ground.
    let height: number | null = y;
    for (let i = 1; i <= steps && height !== null; i++) height = groundNear(world, x + dx * i / steps, height, z + dz * i / steps);
    if (height !== null) spots.push({ feet: [x + dx, height, z + dz], yaw: anchor.yaw });
  }
  return spots;
}

export interface TavernReturns {
  /** The tavern room: this person's last tavern session has ended. */
  left(kingdomId: string, personId: string, now: number): void;
  /**
   * The kingdom room, once per fresh arrival: where this person stands if they have just come out of the tavern,
   * or null (nobody left the tavern, the record expired, no door can be derived, or its step is not safe now).
   */
  arrival(kingdomId: string, personId: string, world: CollisionWorld, now: number, standing?: Iterable<Standing>): TavernAnchor | null;
}

const installed = new WeakMap<RealmRoomServices, TavernReturns>();
/** One line in `main.ts`: the scene source is the founded loader's current scene for the kingdom. */
export function installTavernReturns(services: RealmRoomServices, scene: (kingdomId: KingdomId) => RealmFoundedScene | undefined): TavernReturns {
  const returns = createTavernReturns(scene);
  installed.set(services, returns);
  return returns;
}
export function tavernReturnsFor(services: RealmRoomServices): TavernReturns | undefined { return installed.get(services); }

export function createTavernReturns(scene: (kingdomId: KingdomId) => RealmFoundedScene | undefined): TavernReturns {
  const pending = new Map<string, number>();
  // The door depends only on the installed scene and the collision it was compiled into.
  const doors = new WeakMap<CollisionWorld, { readonly scene: RealmFoundedScene; readonly spots: readonly TavernAnchor[] }>();
  const key = (kingdomId: string, personId: string) => `${kingdomId}\n${personId}`;
  return {
    left(kingdomId, personId, now) {
      for (const [entry, at] of pending) if (now - at > RETURN_WINDOW_MS) pending.delete(entry);
      if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
      pending.delete(key(kingdomId, personId));
      pending.set(key(kingdomId, personId), now);
    },
    arrival(kingdomId, personId, world, now, standing = []) {
      const entry = key(kingdomId, personId), at = pending.get(entry);
      if (at === undefined) return null;
      pending.delete(entry);
      if (now - at > RETURN_WINDOW_MS || now < at) return null;
      // Only the scene this exact collision was compiled from; mid-adoption the person arrives at the gate.
      const current = scene(kingdomId as KingdomId);
      if (!current || current.kingdomId !== kingdomId || current.collisionRevision !== world.revision) return null;
      let door = doors.get(world);
      if (!door || door.scene !== current) {
        let anchor: TavernAnchor | null;
        // A door that cannot be derived is no door: an arrival is never refused because of it.
        try { anchor = tavernPortalFor(current.kingdomId, current, world)?.returnAnchor ?? null; } catch { anchor = null; }
        door = { scene: current, spots: anchor ? returnSpots(anchor, world) : [] };
        doors.set(world, door);
      }
      const others = [...standing];
      const gap = (feet: TavernAnchor['feet']) => others.reduce((least, o) => Math.min(least, Math.hypot(o.x - feet[0], o.z - feet[2])), Infinity);
      let roomiest: TavernAnchor | null = null, widest = -1;
      for (const spot of door.spots) {
        const free = gap(spot.feet);
        if (free >= RETURN_SPACING) return spot;
        if (free > widest) { widest = free; roomiest = spot; }
      }
      return roomiest;
    },
  };
}
