import { randomUUID } from 'node:crypto';
import { ServerError } from '@colyseus/core';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmPrincipal } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import type { RealmRoomServices } from './ports';

export const REFERENCE_KINGDOM = KingdomIdSchema.parse('999000001');
/** No real identities, ownership or durable success. Only enabled by an explicit process flag. */
export function referenceServices(): RealmRoomServices & { issue(): { ticket: string; kingdomId: string; protocol: 1 } } {
  const tickets = new Map<string, RealmPrincipal>(), sessions = new Map<string, RealmPrincipal>(); let counter = 0, open = false, spawnCount = 0;
  return {
    issue() {
      const number = ++counter, ticket = randomUUID();
      tickets.set(ticket, { personId: PersonIdSchema.parse(String(990000000 + number)), kingdomId: REFERENCE_KINGDOM,
        sessionId: randomUUID(), expiresAt: Date.now() + 60 * 60 * 1000, origin: 'simulated', publicName: `Visitor ${number}`, look: 'reference' });
      sessions.set(tickets.get(ticket)!.sessionId,tickets.get(ticket)!);
      return { ticket, kingdomId: REFERENCE_KINGDOM, protocol: 1 };
    },
    auth: {
      async authenticate(join) {
        const principal = tickets.get(join.ticket);
        if (!principal || principal.expiresAt <= Date.now() || join.kingdomId !== REFERENCE_KINGDOM) throw new ServerError(403, 'Reference entry expired');
        tickets.delete(join.ticket);
        return principal;
      },
      async current(principal, now) { const stored=sessions.get(principal.sessionId);return !!(stored&&stored.personId===principal.personId&&stored.kingdomId===principal.kingdomId&&stored.expiresAt>now&&principal.origin==='simulated'); },
    },
    async open(kingdomId) {
      if (kingdomId !== REFERENCE_KINGDOM || open) throw new ServerError(409, 'The kingdom writer is already held');
      open = true;
      const writerEpoch = randomUUID(), roomEffects = new Set<import('./ports').RealmRoomEffects>();
      return { kingdomId, origin: 'simulated', writerEpoch, layoutRevision: 'reference-court-v1', world: REFERENCE_WORLD, sequence: 0,
        spawn: () => [((spawnCount++ % 3) - 1) * 4, 0, 7],
        intent: async (_context, intent) => ({ version: 1, id: intent.id, status: 'unavailable', message: 'This reference court only hosts walking. Your kingdom work has not been changed.' }),
        bootstrap: () => ({ version: 1, kingdomId, writerEpoch, throughSequence: 0, throughCursor: 0, layoutRevision: 'reference-court-v1', collisionRevision: 1, current: [] }),
        recoverWalker: (walkerId, revision) => revision===REFERENCE_WORLD.revision && [...roomEffects].some(effects=>effects.placeWalker(walkerId,[0,0,7],revision)),
        bindRoom: effects => {roomEffects.add(effects);return()=>{roomEffects.delete(effects);};}, lifecycle: () => {},
        subscribe: () => () => {}, bindTransient: () => () => {}, dispose: async () => { open = false; },
      };
    },
  };
}
