import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { KingdomIdSchema } from '@chatdom/shared';
import { KingdomRoomState, RealmJoinSchema, type RealmJoin, type RealmPrincipal } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createRealmServer } from '../server';
import { REFERENCE_KINGDOM, referenceServices } from '../reference';
import { installPortalArrivals, PORTAL_DEPARTURES_MAX, PORTAL_RETURN_WINDOW_MS, RealmPortalArrivals } from './arrivals';

const DOOR = `tavern:${REFERENCE_KINGDOM}:door`;
const OUTSIDE = { feet: [2, 0, 12] as const, yaw: 192 };

describe('RealmPortalArrivals', () => {
  const clock = () => { let t = 1_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

  it('places a person outside a door once per time they left, and never on a first walk', () => {
    const time = clock(), arrivals = new RealmPortalArrivals(time.now);
    arrivals.door('tavern', () => OUTSIDE);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
    arrivals.departed(REFERENCE_KINGDOM, 'p1');
    time.advance(40 * 60 * 1000);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toEqual(OUTSIDE);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
  });

  it('forgets a departure after the window and spends it on any ask, found or not', () => {
    const time = clock(), arrivals = new RealmPortalArrivals(time.now);
    arrivals.door('tavern', () => OUTSIDE);
    arrivals.departed(REFERENCE_KINGDOM, 'p1');
    time.advance(PORTAL_RETURN_WINDOW_MS + 1);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
    arrivals.departed(REFERENCE_KINGDOM, 'p1');
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', 'cellar:999000001:door', REFERENCE_WORLD)).toBeNull();
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
  });

  it('never places anyone by another kingdom\'s door, a malformed id, a missing door or a broken finder', () => {
    const arrivals = new RealmPortalArrivals(() => 0), other = KingdomIdSchema.parse('999000002');
    let answer: unknown = OUTSIDE;
    arrivals.door('tavern', () => { if (answer instanceof Error) throw answer; return answer as typeof OUTSIDE | null; });
    const ask = (portal: string) => { arrivals.departed(REFERENCE_KINGDOM, 'p1'); return arrivals.arrival(REFERENCE_KINGDOM, 'p1', portal, REFERENCE_WORLD); };
    expect(ask(`tavern:${other}:door`)).toBeNull();
    expect(ask('tavern')).toBeNull();
    expect(ask(`Tavern:${REFERENCE_KINGDOM}:door`)).toBeNull();
    answer = null; expect(ask(DOOR)).toBeNull();
    answer = new Error('no installed scene'); expect(ask(DOOR)).toBeNull();
    answer = { feet: [Number.NaN, 0, 0], yaw: 0 }; expect(ask(DOOR)).toBeNull();
    answer = { feet: [1, 0, 1], yaw: -64 }; expect(ask(DOOR)).toEqual({ feet: [1, 0, 1], yaw: 192 });
    // A departure from one kingdom is not one from another.
    arrivals.departed(other, 'p1');
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
  });

  it('keeps one finder per door kind and stays bounded', () => {
    const arrivals = new RealmPortalArrivals(() => 0);
    const off = arrivals.door('tavern', () => OUTSIDE);
    expect(() => arrivals.door('tavern', () => OUTSIDE)).toThrow();
    expect(() => arrivals.door('Tavern Door', () => OUTSIDE)).toThrow();
    off();
    arrivals.door('tavern', () => OUTSIDE);
    for (let n = 0; n <= PORTAL_DEPARTURES_MAX; n++) arrivals.departed(REFERENCE_KINGDOM, `p${n}`);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p0', DOOR, REFERENCE_WORLD)).toBeNull();
    expect(arrivals.arrival(REFERENCE_KINGDOM, `p${PORTAL_DEPARTURES_MAX}`, DOOR, REFERENCE_WORLD)).toEqual(OUTSIDE);
  });

  it('accepts `arrive` on a join and nothing else beside it', () => {
    const join = { kingdomId: REFERENCE_KINGDOM, ticket: 'x'.repeat(16), protocol: 1 };
    expect(RealmJoinSchema.safeParse({ ...join, arrive: { portal: DOOR } }).success).toBe(true);
    expect(RealmJoinSchema.safeParse({ ...join, arrive: { portal: DOOR, feet: [0, 0, 0] } }).success).toBe(false);
    expect(RealmJoinSchema.safeParse({ ...join, arrive: { portal: '' } }).success).toBe(false);
  });
});

describe('the kingdom room', () => {
  const rooms: Room<KingdomRoomState>[] = [];
  let shutdown: (() => Promise<void>) | undefined;
  afterAll(async () => { await Promise.all(rooms.map(room => room.leave().catch(() => {}))); await shutdown?.(); });
  const waitFor = async (predicate: () => boolean, what: string) => {
    const end = Date.now() + 8000;
    while (!predicate()) { if (Date.now() > end) throw new Error(`Timed out: ${what}`); await new Promise(resolve => setTimeout(resolve, 25)); }
  };

  it('stands a person who comes back through a door outside it, and everyone else at the gate', async () => {
    // The reference court with a session that travels: each join takes a fresh one-use ticket for the same person.
    const base = referenceServices(), seen = new Map<string, RealmPrincipal>(), again = new Map<string, RealmPrincipal>();
    const services = { ...base, auth: {
      async authenticate(join: RealmJoin) {
        const carried = again.get(join.ticket);
        if (carried) { again.delete(join.ticket); return carried; }
        const principal = await base.auth.authenticate(join); seen.set(join.ticket, principal); return principal;
      },
      current: base.auth.current,
    } };
    const arrivals = new RealmPortalArrivals();
    arrivals.door('tavern', ({ kingdomId, portal }) => portal === `tavern:${kingdomId}:door` ? OUTSIDE : null);
    // A second door whose outside is inside a wall: the room refuses it and uses the gate.
    arrivals.door('cellar', () => ({ feet: [-2, 0, -1], yaw: 0 }));
    installPortalArrivals(services, arrivals);
    const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No test port');
    const port = address.port; await new Promise<void>(resolve => probe.close(() => resolve()));
    const { server } = createRealmServer(services); shutdown = () => server.gracefullyShutdown(false);
    await server.listen(port, '127.0.0.1');
    const client = new Client(`http://127.0.0.1:${port}`);
    const join = async (ticket: { ticket: string; kingdomId: string; protocol: 1 }, arrive?: string) => {
      const room = await client.joinOrCreate<KingdomRoomState>('kingdom', arrive ? { ...ticket, arrive: { portal: arrive } } : ticket, KingdomRoomState);
      rooms.push(room); await waitFor(() => room.state.walkers.has(room.sessionId), 'own walker');
      const walker = room.state.walkers.get(room.sessionId)!;
      return { room, at: [walker.x, walker.y, walker.z], yaw: walker.yaw };
    };
    const fresh = (principal: RealmPrincipal) => { const ticket = randomUUID(); again.set(ticket, principal); return { ticket, kingdomId: REFERENCE_KINGDOM, protocol: 1 as const }; };

    // Someone who never left names the door on a first walk: the gate (z 7 in the reference court). They stay, so
    // the room stays open through the leaves below.
    const stranger = await join(base.issue(), DOOR);
    expect(stranger.at[2]).toBe(7);
    const left: string[] = [], departed = arrivals.departed.bind(arrivals);
    arrivals.departed = (kingdomId, personId) => { left.push(personId); departed(kingdomId, personId); };
    const walkOut = async (room: Room<KingdomRoomState>) => { const before = left.length; await room.leave(true); await waitFor(() => left.length > before, 'departure'); };
    const firstTicket = base.issue(), first = await join(firstTicket);
    expect(first.at[2]).toBe(7);
    const person = seen.get(firstTicket.ticket)!;
    // Walk out (into the tavern), then back through its door: outside the door, facing out.
    await walkOut(first.room);
    expect(left).toEqual([person.personId]);
    const back = await join(fresh(person), DOOR);
    expect(back.at).toEqual([...OUTSIDE.feet]);
    expect(back.yaw).toBe(OUTSIDE.yaw);
    // Everyone sees them there.
    await waitFor(() => stranger.room.state.walkers.get(back.room.sessionId)?.z === OUTSIDE.feet[2], 'shared arrival');
    // Leaving again and naming another kingdom's door, or a door whose outside is not clear: the gate.
    await walkOut(back.room);
    const foreign = await join(fresh(person), 'tavern:999000002:door');
    expect(foreign.at[2]).toBe(7);
    await walkOut(foreign.room);
    expect((await join(fresh(person), `cellar:${REFERENCE_KINGDOM}:door`)).at[2]).toBe(7);
  }, 25_000);
});
