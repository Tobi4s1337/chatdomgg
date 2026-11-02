import { randomUUID } from 'node:crypto';
import { PersonIdSchema, type Vec3 } from '@chatdom/shared';
import type { CollisionWorld, RealmPrincipal, RealmPrivateMessage, RealmReceipt, RealmTransientMessage } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { createFoundedInteractionRegistry } from '@chatdom/world/interactions';
import { composeInteractionHosts, createInteractionAuthority } from '../interactions';
import type { RealmRoomEffects, RealmRoomServices } from '../ports';
import { REFERENCE_KINGDOM, referenceServices } from '../reference';
import { Campfires, installCampfires } from './index';
import { MemoryFireStore, type FireStore } from './store';

/**
 * A SIMULATED kingdom around the fire, for socket tests and the recorded round: reference identities, a founded
 * scene held in memory, and the same interaction authority, campfire seat policy and kingdom-room hook the live
 * realm uses. Nothing here is durable or signed in; `issue` hands out single-use reference tickets.
 */
export interface CampfireReference {
  readonly services: RealmRoomServices;
  readonly campfires: Campfires;
  /** A fresh visitor ticket, or one for a named person (the streamer is `REFERENCE_KINGDOM`). */
  issue(person?: { readonly personId: string; readonly name: string }): { ticket: string; kingdomId: string; protocol: 1 };
  /**
   * Harness only: the person's current walker asks to sit on a log, through the same interaction authority and seat
   * host a pressed E reaches, standing where the room has them. For a browser that cannot press keys (the real-GPU
   * stills); a later page of the same person replaces the session, leaves the log and is seated again. Null while they
   * are not in the room.
   */
  sit(personId: string, seat: number): Promise<RealmReceipt | null>;
}

export function campfireReference(options: {
  readonly scene: RealmFoundedScene; readonly world: CollisionWorld; readonly spawn: (index: number) => Vec3;
  readonly store?: FireStore; readonly clock?: () => number; readonly live?: () => boolean; readonly tickMs?: number;
}): CampfireReference {
  const base = referenceServices(), named = new Map<string, RealmPrincipal>(), sessions = new Map<string, RealmPrincipal>();
  const clock = options.clock ?? Date.now;
  let spawned = 0, sitting = 0;
  // The walker each person controls now (join and reconnect), so the operator can seat a browser that cannot press E.
  const present = new Map<string, { readonly principal: RealmPrincipal; readonly walkerId: string; readonly sit: (targetId: string, id: string) => Promise<RealmReceipt | null> }>();
  const campfires = new Campfires({ store: options.store ?? new MemoryFireStore(), clock, ...(options.tickMs !== undefined ? { tickMs: options.tickMs } : {}) });
  const services: RealmRoomServices = {
    auth: {
      async authenticate(join) {
        const principal = named.get(join.ticket);
        if (principal) { named.delete(join.ticket); sessions.set(principal.sessionId, principal); return principal; }
        return base.auth.authenticate(join);
      },
      async current(principal, now) {
        const own = sessions.get(principal.sessionId);
        return own ? own.personId === principal.personId && own.expiresAt > now : base.auth.current(principal, now);
      },
    },
    async open(kingdomId) {
      const handle = await base.open(kingdomId), scene = options.scene, world = options.world;
      const registry = createFoundedInteractionRegistry(scene, world), fire = campfires.fire(kingdomId);
      if (options.live) fire.bindLive(options.live);
      const effects = new Set<RealmRoomEffects>();
      let transient: ((message: RealmTransientMessage) => void) | null = null, owner: ((personId: string, message: RealmPrivateMessage) => void) | null = null;
      const authority = createInteractionAuthority({ writerEpoch: handle.writerEpoch, clock, reconnectGraceMs: 20_000,
        world: () => world, registry: () => registry, rights: { current: async (principal, now) => services.auth.current(principal, now), permitted: () => true },
        homes: { ownedPlotId: () => null }, hosts: composeInteractionHosts({ campfire: fire.seats }) });
      authority.bindRoom({
        readWalker: id => { for (const bound of effects) { const walker = bound.readWalker(id); if (walker) return walker; } return null; },
        placeWalker: (id, position, revision) => [...effects].some(bound => !!bound.readWalker(id) && bound.placeWalker(id, position, revision)),
        allowWalking: (id, allowed) => { for (const bound of effects) bound.allowWalking(id, allowed); },
      });
      authority.bindDelivery({ transient: message => transient?.(message), owner: (personId, message) => owner?.(personId, message) });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        clearTimeout(timer);
        const expiry = authority.nextExpiry();
        if (expiry !== null) { timer = setTimeout(() => { authority.expire(clock()); schedule(); }, Math.max(1, expiry - clock())); timer.unref?.(); }
      };
      const offChange = authority.onChange(schedule);
      await fire.restore();
      return { ...handle, layoutRevision: scene.layoutRevision, world,
        spawn: () => options.spawn(spawned++),
        recoverWalker: (id, revision) => revision === world.revision && [...effects].some(bound => bound.placeWalker(id, options.spawn(0), revision)),
        intent: async (context, intent) => intent.type === 'interact' ? authority.intent(context, intent) : handle.intent(context, intent),
        bootstrap: principal => {
          transient?.(authority.seats());
          owner?.(principal.personId, { type: 'interaction', requestId: null, writerEpoch: handle.writerEpoch, state: authority.selfState(principal.sessionId) });
          return { ...handle.bootstrap(principal), layoutRevision: scene.layoutRevision, collisionRevision: world.revision };
        },
        lifecycle: (event, principal, walkerId, now) => {
          handle.lifecycle(event, principal, walkerId, now); authority.lifecycle(event, principal, walkerId, now);
          if (event === 'join' || event === 'reconnect') present.set(principal.personId, { principal, walkerId, sit: async (targetId, id) => {
            const read = () => { for (const bound of effects) { const walker = bound.readWalker(walkerId); if (walker) return walker; } return null; };
            const body = read();
            if (!body) return null;
            return authority.intent({ principal, walkerId, position: [body.x, body.y, body.z], collisionRevision: body.collisionRevision, current: read },
              { version: 1, type: 'interact', id, targetId, action: 'sit' });
          } });
          else if (present.get(principal.personId)?.walkerId === walkerId) present.delete(principal.personId);
        },
        bindRoom: bound => { effects.add(bound); const off = handle.bindRoom(bound); return () => { effects.delete(bound); off(); }; },
        bindTransient: (send, privately) => { transient = send; owner = privately; return () => { if (transient === send) { transient = null; owner = null; } }; },
        dispose: async () => { clearTimeout(timer); offChange(); authority.dispose(); await handle.dispose(); },
      };
    },
  };
  installCampfires(services, campfires);
  return {
    services, campfires,
    async sit(personId, seat) {
      const walker = present.get(personId);
      return walker ? walker.sit(`fire:clearing:seat:${seat}`, `harness-sit-${++sitting}`) : null;
    },
    issue(person) {
      if (!person) return base.issue();
      const ticket = randomUUID();
      named.set(ticket, { personId: PersonIdSchema.parse(person.personId), kingdomId: REFERENCE_KINGDOM, sessionId: randomUUID(),
        expiresAt: clock() + 3_600_000, origin: 'simulated', publicName: person.name, look: 'reference' });
      return { ticket, kingdomId: REFERENCE_KINGDOM, protocol: 1 };
    },
  };
}
