import type { RealmAuthenticator, RealmPrivateState } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { createFoundedInteractionRegistry, type InteractionRegistry } from '@chatdom/world/interactions';
import { REALM_RECONNECT_GRACE_MS } from '../auth/seats';
import { composeInteractionHosts, createInteractionAuthority, ownedHomes, type CampfireSeatHost } from '../interactions';
import { canonicalSceneJson } from '../founded/codec';
import type { DurableKingdom } from '../persistence';

/** Native targets, live session rights and installed street deeds on the already retained evening writer. */
export function attachEveningInteractions(kingdom: DurableKingdom, options: {
  readonly auth: RealmAuthenticator;
  /** The loader's currently adopted scene; prospective preparations must never be returned here. */
  readonly scene: () => RealmFoundedScene | undefined;
  /** The kingdom's fire (gather): its logs' seat policy. Absent, logs stay social seats. */
  readonly campfire?: CampfireSeatHost;
}): () => void {
  let scene: RealmFoundedScene | undefined, registry: InteractionRegistry | null = null;
  let homes: RealmPrivateState['homes'] | undefined;
  const authority = createInteractionAuthority({
    writerEpoch: kingdom.writerEpoch, clock: Date.now, reconnectGraceMs: REALM_RECONNECT_GRACE_MS,
    world: () => kingdom.world,
    registry: () => {
      const current = options.scene();
      if (!kingdom.current || !current || current.kingdomId !== kingdom.kingdomId || current.origin !== kingdom.origin
        || current.layoutRevision !== kingdom.layoutRevision || current.collisionRevision !== kingdom.world.revision) return null;
      const committed = kingdom.privateState.homes;
      if (scene !== current || homes !== committed) {
        const assets = new Map(current.assets.map(asset => [asset.assetHash, asset.blueprint]));
        const revisions = new Map<string, string>();
        for (const home of Object.values(committed)) {
          if (home.layoutRevision !== kingdom.layoutRevision) continue;
          const installed = current.placements.filter(placement => placement.plotId === home.id && assets.get(placement.assetHash)?.kind === 'home');
          const expectedParts = Object.values(home.attachments).map(id => `forge:${id}`).sort();
          const installedParts = current.placements.filter(placement => placement.plotId === home.id && placement.id.startsWith('forge:')).map(placement => placement.id).sort();
          const matches = installed.length === 1 && canonicalSceneJson(assets.get(installed[0]!.assetHash)) === canonicalSceneJson(home.blueprint)
            && JSON.stringify(expectedParts) === JSON.stringify(installedParts);
          revisions.set(home.id, matches ? home.revision : '');
        }
        registry = createFoundedInteractionRegistry(current, kingdom.world, revisions); scene = current; homes = committed;
      }
      return registry;
    },
    rights: {
      current: async (principal, now) => kingdom.current && principal.kingdomId === kingdom.kingdomId
        && principal.origin === kingdom.origin && principal.expiresAt > now && await options.auth.current(principal, now),
      permitted: personId => kingdom.current && !kingdom.privateState.rights[personId]?.blocked,
    },
    homes: ownedHomes(() => kingdom.privateState, () => kingdom.layoutRevision),
    recovery: (walkerId, revision) => kingdom.recoverWalker(walkerId, revision),
    ...(options.campfire ? { hosts: composeInteractionHosts({ campfire: options.campfire }) } : {}),
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
  // Home revisions also change through committed domain delivery without adopting a different scene object.
  // Reconcile existing interiors then, as well as on the world's existing adoption hook.
  const offHomes = kingdom.subscribe(delivery => { if (delivery.message.type === 'home') authority.adoptRegistry(); });
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer);
    offClosed(); offHomes(); offChange(); unbind();
    scene = undefined; homes = undefined; registry = null;
  };
  const offClosed = kingdom.onClosed(stop);
  return stop;
}
