import type { RealmAuthenticator } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { createFoundedInteractionRegistry, type InteractionRegistry } from '@chatdom/world/interactions';
import { REALM_RECONNECT_GRACE_MS } from '../auth/seats';
import { createInteractionAuthority } from '../interactions';
import type { DurableKingdom } from '../persistence';

/** Native targets, live session rights and installed street deeds on the already retained evening writer. */
export function attachEveningInteractions(kingdom: DurableKingdom, options: {
  readonly auth: RealmAuthenticator;
  /** The loader's currently adopted scene; prospective preparations must never be returned here. */
  readonly scene: () => RealmFoundedScene | undefined;
}): () => void {
  let scene: RealmFoundedScene | undefined, registry: InteractionRegistry | null = null;
  const authority = createInteractionAuthority({
    writerEpoch: kingdom.writerEpoch, clock: Date.now, reconnectGraceMs: REALM_RECONNECT_GRACE_MS,
    world: () => kingdom.world,
    registry: () => {
      const current = options.scene();
      if (!kingdom.current || !current || current.kingdomId !== kingdom.kingdomId || current.origin !== kingdom.origin
        || current.layoutRevision !== kingdom.layoutRevision || current.collisionRevision !== kingdom.world.revision) return null;
      if (scene !== current) { registry = createFoundedInteractionRegistry(current, kingdom.world); scene = current; }
      return registry;
    },
    rights: {
      current: async (principal, now) => kingdom.current && principal.kingdomId === kingdom.kingdomId
        && principal.origin === kingdom.origin && principal.expiresAt > now && await options.auth.current(principal, now),
      permitted: personId => kingdom.current && !kingdom.privateState.rights[personId]?.blocked,
    },
    homes: { ownedPlotId: personId => Object.values(kingdom.privateState.homes)
      .find(home => home.ownerId === personId && home.layoutRevision === kingdom.layoutRevision)?.id ?? null },
    recovery: (walkerId, revision) => kingdom.recoverWalker(walkerId, revision),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = () => {
    clearTimeout(timer);
    if (stopped || !kingdom.current) return;
    const expiry = authority.nextExpiry();
    if (expiry === null) return;
    timer = setTimeout(() => { authority.expire(Date.now()); schedule(); }, Math.max(1, expiry - Date.now()));
    timer.unref?.();
  };
  const offChange = authority.onChange(schedule);
  const unbind = kingdom.bindInteractionAuthority(authority);
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer);
    offClosed(); offChange(); unbind();
    scene = undefined; registry = null;
  };
  const offClosed = kingdom.onClosed(stop);
  return stop;
}
