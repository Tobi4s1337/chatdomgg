import { createThresholdWatch, type KingdomId, type TavernPortal, type Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { standingClear } from '@chatdom/world/interactions';
import { foundedTavernPortal } from '../../../../packages/content/src/tavern/portal';
import type { RealmEntry } from '../realm/client';
import type { TavernClient } from './client';

/**
 * The tavern door for the kingdom's portal owner, from the same installed scene and collision the kingdom page
 * walks on (and the realm authorises). Watch `door` with `createThresholdWatch` against the predicted feet; on a
 * crossing, transfer to `destinationRoom` and spawn at `entry`. Returning, spawn at `returnAnchor`, facing out.
 */
export function tavernPortalFor(kingdomId: KingdomId, scene: RealmFoundedScene, world: CollisionWorld): TavernPortal | null {
  return foundedTavernPortal({ kingdomId, scene, world, standingClear });
}

/**
 * The tavern as a door into a room of its own (SEAMS.md §1; play's `play/portal.ts`). Play owns the transfer, the
 * curtain and the way back; the tavern gives it the door's descriptor, a watch for the crossing and, in
 * `play-slot.ts`, the destination that mounts the room. The shapes below are the structural part of play's published
 * `PortalDescriptor`, `PortalVisit`, `PortalSurface` and `PortalDestination`, so either side builds without the other.
 */
export interface TavernPortalAnchor { readonly feet: Vec3; readonly yaw: number }
export interface TavernPortalDescriptor {
  readonly id: string;
  readonly kingdomId: KingdomId;
  readonly sourceRoom: 'kingdom';
  readonly destinationRoom: 'tavern';
  /** Just inside the tavern's door, facing the room, in the tavern room's frame. */
  readonly entryAnchor: TavernPortalAnchor;
  /** Just outside the exterior door, facing out, in the kingdom room's frame. */
  readonly returnAnchor: TavernPortalAnchor;
  readonly title: string;
}
export interface TavernPortalVisit {
  readonly portal: { readonly id: string; readonly kingdomId: KingdomId };
  readonly entry: RealmEntry;
  readonly endpoint: string;
  readonly active: boolean;
  leave(): void;
  fail(reason: string): void;
}
export interface TavernPortalSurface { readonly ready: Promise<void>; dispose(): Promise<void> }
export interface TavernPortalDestination {
  readonly room: 'tavern';
  readonly title: string;
  mount(host: HTMLElement, visit: TavernPortalVisit): TavernPortalSurface;
}

export const TAVERN_TITLE = 'The tavern';
/** Walker yaw bytes (zero faces +Z, 64 faces +X) as radians in the same frame: zero faces +Z, π/2 faces +X. */
export const yawRadians = (byte: number) => (((byte % 256) + 256) % 256) * Math.PI / 128;

const anchor = ({ feet: [x, y, z], yaw }: TavernPortal['entry']): TavernPortalAnchor => ({ feet: [x, y, z], yaw: yawRadians(yaw) });
/** Play's descriptor for an installed tavern door. Derive the portal again whenever the collision revision changes. */
export function tavernPortalDescriptor(portal: TavernPortal): TavernPortalDescriptor {
  return { id: portal.id, kingdomId: portal.kingdomId, sourceRoom: 'kingdom', destinationRoom: 'tavern', title: TAVERN_TITLE,
    entryAnchor: anchor(portal.entry), returnAnchor: anchor(portal.returnAnchor) };
}

/**
 * The door is crossed, not pressed (PRD decision 2026-11-02). Feed it the walker's predicted feet every frame; it
 * calls `enter` once per inward crossing, never on arrival at the return anchor, from beside the door or backwards.
 */
export function watchTavernDoor(portal: TavernPortal, enter: () => void): (feet: readonly [number, number, number]) => void {
  const crossed = createThresholdWatch(portal.door);
  return feet => { if (crossed(feet)) enter(); };
}

/** What the mounted room needs from the visit; the room surface itself is drawn by `render`. */
export interface TavernVisitHooks {
  open(): Promise<TavernClient>;
  leave(): void;
  onReady(): void;
  onTerminal(reason: string): void;
}
type Opened = Pick<TavernClient, 'leave' | 'dispose'>;

/**
 * The visit's lifecycle, apart from drawing. `ready` resolves once you stand in the room; a room that never opens
 * rejects it, and one that ends afterwards asks play to take you back outside. `dispose` resolves only once every
 * connection this visit opened has really let you go, and rejects while one may still hold you; play calls it again.
 */
export function tavernVisit(visit: TavernPortalVisit, connect: () => Promise<TavernClient>, draw: (hooks: TavernVisitHooks) => () => void): TavernPortalSurface {
  let settle: { resolve(): void; reject(error: Error): void } | undefined, arrived = false, disposed = false;
  const ready = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
  // Play may stop listening once it has moved on; an unobserved rejection is not an error.
  ready.catch(() => undefined);
  const opened = new Set<Opened>(), opening = new Set<Promise<unknown>>();
  let undraw: (() => void) | undefined;
  const hooks: TavernVisitHooks = {
    open() {
      if (disposed || !visit.active) return Promise.reject(new Error('The tavern visit has ended.'));
      const attempt = connect().then(client => { opened.add(client); if (disposed) client.dispose(); return client; });
      opening.add(attempt); void attempt.then(() => opening.delete(attempt), () => opening.delete(attempt));
      return attempt;
    },
    leave() { if (!disposed && visit.active) visit.leave(); },
    onReady() { if (disposed || arrived) return; arrived = true; settle?.resolve(); },
    onTerminal(reason) {
      if (disposed) return;
      if (!arrived) settle?.reject(new Error(reason));
      else if (visit.active) visit.fail(reason);
    },
  };
  undraw = draw(hooks);
  return {
    ready,
    async dispose() {
      if (!disposed) {
        disposed = true; settle?.reject(new Error('The tavern visit has ended.'));
        const stop = undraw; undraw = undefined; stop?.();
      }
      // An open still in flight is left as soon as it lands; a failed one never held you.
      await Promise.allSettled([...opening]);
      await Promise.all([...opened].map(client => client.leave()));
    },
  };
}
