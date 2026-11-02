import type { KingdomId, TavernAnchor } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { embeddedSolids, supported } from '@chatdom/world/movement';
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

export interface TavernReturns {
  /** The tavern room: this person's last tavern session has ended. */
  left(kingdomId: string, personId: string, now: number): void;
  /**
   * The kingdom room, once per fresh arrival: where this person stands if they have just come out of the tavern,
   * or null (nobody left the tavern, the record expired, no door can be derived, or its step is not safe now).
   */
  arrival(kingdomId: string, personId: string, world: CollisionWorld, now: number): TavernAnchor | null;
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
  const doors = new WeakMap<CollisionWorld, { readonly scene: RealmFoundedScene; readonly anchor: TavernAnchor | null }>();
  const key = (kingdomId: string, personId: string) => `${kingdomId}\n${personId}`;
  return {
    left(kingdomId, personId, now) {
      for (const [entry, at] of pending) if (now - at > RETURN_WINDOW_MS) pending.delete(entry);
      if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
      pending.delete(key(kingdomId, personId));
      pending.set(key(kingdomId, personId), now);
    },
    arrival(kingdomId, personId, world, now) {
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
        door = { scene: current, anchor };
        doors.set(world, door);
      }
      const anchor = door.anchor;
      if (!anchor) return null;
      const body = { x: anchor.feet[0], y: anchor.feet[1], z: anchor.feet[2] };
      return embeddedSolids(body, world).length === 0 && supported(body, world) ? anchor : null;
    },
  };
}
