import type { KingdomId } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmRoomServices } from '../ports';

/**
 * Coming back through a door. A person who walked from the kingdom into another room (the tavern) and then out
 * again should stand outside that door, not at the kingdom gate. The client only names the door; the feet always
 * come from the server's own installed scene, and the room still checks them against its current collision world
 * before anyone stands there.
 */
export interface RealmPortalReturn {
  /** Feet in metres, just outside the door, in the kingdom's collision frame. */
  readonly feet: readonly [number, number, number];
  /** The walker's yaw byte (0 faces +Z, 64 faces +X), facing out of the door. */
  readonly yaw: number;
}
export interface RealmPortalReturnQuery {
  readonly kingdomId: KingdomId;
  /** The full portal id as the client named it, for example `tavern:<kingdomId>:door`. */
  readonly portal: string;
  readonly world: CollisionWorld;
}
/** Server truth for one kind of door. Null when this kingdom has no such door now (no tavern, a blocked forecourt). */
export type RealmPortalReturnFinder = (query: RealmPortalReturnQuery) => RealmPortalReturn | null;

/** A visit to the room behind a door may be long (an evening at the tavern), but not a day. */
export const PORTAL_RETURN_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Departures held in memory; the oldest go first. Losing one only means arriving at the gate. */
export const PORTAL_DEPARTURES_MAX = 20_000;
const PORTAL_ID = /^([a-z][a-z0-9-]{0,23}):([^:\s]{1,40})(?::[a-z0-9-]{1,24})?$/;

/**
 * Doors by kind, and who left which kingdom when. A departure is spent by one arrival through a door, so a person
 * can come back outside a door once per time they left, and never choose a door instead of the gate on a first walk.
 */
export class RealmPortalArrivals {
  private readonly doors = new Map<string, RealmPortalReturnFinder>();
  private readonly departures = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  /** Registers the finder for a door kind: the portal id's first segment (`tavern` for `tavern:<kingdomId>:door`). */
  door(kind: string, find: RealmPortalReturnFinder): () => void {
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(kind)) throw new Error(`A door kind is a short lowercase word, not ${JSON.stringify(kind)}.`);
    if (this.doors.has(kind)) throw new Error(`The ${kind} door already has a finder.`);
    this.doors.set(kind, find);
    return () => { if (this.doors.get(kind) === find) this.doors.delete(kind); };
  }

  /** The person's walker left this kingdom's room (not replaced by a second tab of their own). */
  departed(kingdomId: KingdomId, personId: string): void {
    const key = `${kingdomId}\u0000${personId}`;
    this.departures.delete(key);
    this.departures.set(key, this.now());
    while (this.departures.size > PORTAL_DEPARTURES_MAX) this.departures.delete(this.departures.keys().next().value!);
  }

  /**
   * The return feet for a person coming back through `portal`, or null for the usual gate. Spends the departure
   * whenever a door is asked for, found or not, so a refused door never stays open for a retry with another name.
   */
  arrival(kingdomId: KingdomId, personId: string, portal: string, world: CollisionWorld): RealmPortalReturn | null {
    const key = `${kingdomId}\u0000${personId}`, left = this.departures.get(key);
    this.departures.delete(key);
    if (left === undefined || this.now() - left > PORTAL_RETURN_WINDOW_MS) return null;
    const match = PORTAL_ID.exec(portal);
    // A door of another kingdom never places anyone here.
    if (!match || match[2] !== kingdomId) return null;
    const find = this.doors.get(match[1]!);
    if (!find) return null;
    let found: RealmPortalReturn | null;
    try { found = find({ kingdomId, portal, world }); } catch { return null; }
    if (!found || found.feet.length !== 3 || !found.feet.every(Number.isFinite) || !Number.isInteger(found.yaw)) return null;
    return { feet: [found.feet[0], found.feet[1], found.feet[2]], yaw: ((found.yaw % 256) + 256) % 256 };
  }
}

const installed = new WeakMap<RealmRoomServices, RealmPortalArrivals>();
/** Composition (main.ts) installs one set of doors per realm; the kingdom room reads it from its services. */
export function installPortalArrivals(services: RealmRoomServices, arrivals: RealmPortalArrivals): void { installed.set(services, arrivals); }
export function portalArrivalsFor(services: RealmRoomServices): RealmPortalArrivals | undefined { return installed.get(services); }
