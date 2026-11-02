import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { ServerError } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import { PersonIdSchema } from '@chatdom/shared';
import { KingdomRoomState, MONARCH_CHANNEL, isVerifiedMonarch, type MonarchChannelReply, type RealmPrincipal, type RealmWalkerFrame } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createRealmServer } from '../server';
import { REFERENCE_KINGDOM } from '../reference';
import type { RealmRoomServices } from '../ports';
import { createMemoryMonarchTitles, createMonarchRoomChannel } from '.';

/**
 * A live-origin court on the reference world. Tickets are minted here for chosen people, so the test decides who is
 * the broadcaster (person id = kingdom id) and who is not; nothing reaches Twitch.
 */
function liveCourt() {
  const tickets = new Map<string, RealmPrincipal>(), sessions = new Map<string, RealmPrincipal>(), frames: RealmWalkerFrame[] = [];
  const titles = createMemoryMonarchTitles(new Map([[REFERENCE_KINGDOM, 'court_streamer']]));
  let open = false;
  const services: RealmRoomServices & { issue(personId: string, name: string): { ticket: string; kingdomId: string; protocol: 1 } } = {
    issue(personId, name) {
      const ticket = randomUUID(), principal: RealmPrincipal = { personId: PersonIdSchema.parse(personId), kingdomId: REFERENCE_KINGDOM,
        sessionId: randomUUID(), expiresAt: Date.now() + 3_600_000, origin: 'live', publicName: name, look: 'reference' };
      tickets.set(ticket, principal); sessions.set(principal.sessionId, principal);
      return { ticket, kingdomId: REFERENCE_KINGDOM, protocol: 1 };
    },
    auth: {
      async authenticate(join) {
        const principal = tickets.get(join.ticket);
        if (!principal) throw new ServerError(403, 'Entry expired');
        tickets.delete(join.ticket);
        return principal;
      },
      async current(principal, now) { const stored = sessions.get(principal.sessionId); return !!stored && stored.expiresAt > now; },
    },
    monarch: titles,
    channels: [createMonarchRoomChannel(titles)],
    // As main.ts composes it (withMonarchArrival): the monarch's own arrival point and the way they face.
    prepareSpawn: async who => isVerifiedMonarch(who) ? { positions: [[4, 0, 7]], expiresAt: Date.now() + 10_000, current: () => true, faceToward: [14, 7] } : null,
    async open(kingdomId) {
      if (open) throw new ServerError(409, 'held');
      open = true;
      const writerEpoch = randomUUID();
      return { kingdomId, origin: 'live', writerEpoch, layoutRevision: 'reference-court-v1', world: REFERENCE_WORLD, sequence: 0,
        spawn: () => [0, 0, 7],
        intent: async (_context, intent) => ({ version: 1, id: intent.id, status: 'unavailable', message: 'Walking only.' }),
        bootstrap: () => ({ version: 1, kingdomId, writerEpoch, throughSequence: 0, throughCursor: 0, layoutRevision: 'reference-court-v1', collisionRevision: 1, current: [] }),
        recoverWalker: () => false, bindRoom: () => () => {}, lifecycle: () => {},
        publishWalkers: frame => { frames.push(frame); },
        subscribe: () => () => {}, bindTransient: () => () => {}, dispose: async () => { open = false; },
      };
    },
  };
  return { services, titles, frames };
}

const waitFor = async (predicate: () => boolean) => {
  const end = Date.now() + 8000;
  while (!predicate()) { if (Date.now() > end) throw new Error('Room state did not arrive'); await new Promise(resolve => setTimeout(resolve, 25)); }
};
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

it('crowns only the verified broadcaster, shows the crown to everyone, and lets only them choose the title', async () => {
  const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const court = liveCourt(), { server } = createRealmServer(court.services);
  await server.listen(address.port, '127.0.0.1');
  const rooms: Room<KingdomRoomState>[] = [];
  cleanup = async () => { await Promise.all(rooms.map(room => room.leave().catch(() => {}))); await server.gracefullyShutdown(false); };
  const client = new Client(`http://127.0.0.1:${address.port}`);
  // A citizen whose public name is the streamer's own: names never crown anyone.
  const citizen = await client.joinOrCreate<KingdomRoomState>('kingdom', court.services.issue('990000777', 'court_streamer'), KingdomRoomState); rooms.push(citizen);
  const monarch = await client.joinOrCreate<KingdomRoomState>('kingdom', court.services.issue(REFERENCE_KINGDOM, 'court_streamer'), KingdomRoomState); rooms.push(monarch);
  await waitFor(() => citizen.state.walkers.size === 2 && monarch.state.walkers.size === 2);
  expect(citizen.state.walkers.get(monarch.sessionId)!.crown).toBe('Monarch');
  expect(monarch.state.walkers.get(citizen.sessionId)!.crown).toBe('');
  // They step out at their own arrival point, turned toward the town (+X here: yaw byte 64).
  expect(citizen.state.walkers.get(monarch.sessionId)!.x).toBe(4);
  expect(citizen.state.walkers.get(monarch.sessionId)!.yaw).toBe(64);
  expect(citizen.state.walkers.get(citizen.sessionId)!.yaw).toBe(0);
  await waitFor(() => court.frames.some(frame => frame.walkers.length === 2));
  const frame = [...court.frames].reverse().find(item => item.walkers.length === 2)!;
  expect(frame.walkers.find(walker => walker.id === monarch.sessionId)!.crown).toBe('Monarch');
  expect(frame.walkers.find(walker => walker.id === citizen.sessionId)!.crown).toBeUndefined();

  // Who rules here: everyone may ask; only the monarch's own reply says `you`.
  const replies = new Map<string, MonarchChannelReply[]>();
  for (const room of [citizen, monarch]) { replies.set(room.sessionId, []); room.onMessage(MONARCH_CHANNEL, (reply: MonarchChannelReply) => replies.get(room.sessionId)!.push(reply)); }
  citizen.send(MONARCH_CHANNEL, { version: 1, type: 'who' });
  await waitFor(() => replies.get(citizen.sessionId)!.length === 1);
  expect(replies.get(citizen.sessionId)![0]).toEqual({ version: 1, type: 'monarch', name: 'court_streamer', title: 'Monarch', you: false });

  // A citizen cannot choose the title; the monarch can, and the crown on their seat follows at once.
  citizen.send(MONARCH_CHANNEL, { version: 1, type: 'title', title: 'King' });
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(await court.titles.title(REFERENCE_KINGDOM)).toBe('Monarch');
  monarch.send(MONARCH_CHANNEL, { version: 1, type: 'title', title: 'Queen' });
  await waitFor(() => citizen.state.walkers.get(monarch.sessionId)?.crown === 'Queen');
  await waitFor(() => replies.get(monarch.sessionId)!.length === 1);
  expect(replies.get(monarch.sessionId)![0]).toMatchObject({ title: 'Queen', you: true });
  expect(citizen.state.walkers.get(citizen.sessionId)!.crown).toBe('');
  // Anything but the three words is refused by the contract.
  monarch.send(MONARCH_CHANNEL, { version: 1, type: 'title', title: 'Emperor' });
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(await court.titles.title(REFERENCE_KINGDOM)).toBe('Queen');
});
