import type { RealmRoomServices } from '../ports';
import { CampfireFire, type FireOptions, type FireRoomPort } from './fire';
import type { FireStore } from './store';

export { CampfireFire, type FireRoomPort } from './fire';
export { MemoryFireStore, createPostgresFireStore, type FireStore, type FireSnapshot } from './store';
export { mountGatherChatRoute } from './http';
export { campfireChatCommands, CAMPFIRE_COMMANDS } from './commands';

/** One fire per kingdom, shared by that kingdom's room (delivery) and its interaction authority (the logs). */
export class Campfires {
  private readonly fires = new Map<string, CampfireFire>();
  constructor(private readonly options: { readonly store?: FireStore; readonly clock?: () => number; readonly tickMs?: number; readonly seed?: () => number }) {}
  fire(kingdomId: string): CampfireFire {
    let fire = this.fires.get(kingdomId);
    if (!fire) {
      const options: FireOptions = { kingdomId, ...this.options };
      fire = new CampfireFire(options);
      this.fires.set(kingdomId, fire);
    }
    return fire;
  }
  known(kingdomId: string): CampfireFire | undefined { return this.fires.get(kingdomId); }
  dispose(): void { for (const fire of this.fires.values()) fire.dispose(); this.fires.clear(); }
}

const installed = new WeakMap<RealmRoomServices, Campfires>();
/** `main.ts`: `installCampfires(boot.services, campfires)` with the Postgres store; tests pass options. */
export function installCampfires(services: RealmRoomServices, options: Campfires | ConstructorParameters<typeof Campfires>[0] = {}): Campfires {
  const campfires = options instanceof Campfires ? options : new Campfires(options);
  installed.set(services, campfires);
  return campfires;
}
export function campfiresFor(services: RealmRoomServices): Campfires | undefined { return installed.get(services); }

/** The kingdom room's one hook. Without an installed fire it does nothing and the room behaves exactly as before. */
export function attachCampfireRoom(services: RealmRoomServices, kingdomId: string, port: FireRoomPort): () => void {
  return campfiresFor(services)?.fire(kingdomId).attachRoom(port) ?? (() => {});
}
