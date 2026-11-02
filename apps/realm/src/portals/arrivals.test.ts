import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { KingdomIdSchema } from '@chatdom/shared';
import { KingdomRoomState, RealmJoinSchema, type RealmJoin, type RealmPrincipal } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createRealmServer } from '../server';
import { REFERENCE_KINGDOM, referenceServices } from '../reference';
import { installPortalArrivals, PORTAL_DEPARTURE_REACH, PORTAL_DEPARTURES_MAX, PORTAL_RETURN_WINDOW_MS, RealmPortalArrivals } from './arrivals';

const DOOR = `tavern:${REFERENCE_KINGDOM}:door`;
// Just in front of the reference gate's middle spawn (0, 0, 7), so a walker who walks in there stands at the door.
const OUTSIDE = { feet: [-1, 0, 8.5] as const, yaw: 192 };
const AT_DOOR = [-0.5, 0, 9] as const, AT_MARKET = [12, 0, 3] as const;

describe('RealmPortalArrivals', () => {
  const clock = () => { let t = 1_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

  it('places a person outside a door once per time they left, and never on a first walk', () => {
    const time = clock(), arrivals = new RealmPortalArrivals(time.now);
    arrivals.door('tavern', () => OUTSIDE);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
    arrivals.departed(REFERENCE_KINGDOM, 'p1', AT_DOOR);
    time.advance(40 * 60 * 1000);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toEqual(OUTSIDE);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
  });

  it('forgets a departure after the window and spends it on any ask, found or not', () => {
    const time = clock(), arrivals = new RealmPortalArrivals(time.now);
    arrivals.door('tavern', () => OUTSIDE);
    arrivals.departed(REFERENCE_KINGDOM, 'p1', AT_DOOR);
    time.advance(PORTAL_RETURN_WINDOW_MS + 1);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
    arrivals.departed(REFERENCE_KINGDOM, 'p1', AT_DOOR);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', 'cellar:999000001:door', REFERENCE_WORLD)).toBeNull();
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
  });

  it('never places anyone by another kingdom\'s door, a malformed id, a missing door or a broken finder', () => {
    const arrivals = new RealmPortalArrivals(() => 0), other = KingdomIdSchema.parse('999000002');
    let answer: unknown = OUTSIDE;
    arrivals.door('tavern', () => { if (answer instanceof Error) throw answer; return answer as typeof OUTSIDE | null; });
    const ask = (portal: string) => { arrivals.departed(REFERENCE_KINGDOM, 'p1', [1, 0, 1]); return arrivals.arrival(REFERENCE_KINGDOM, 'p1', portal, REFERENCE_WORLD); };
    expect(ask(`tavern:${other}:door`)).toBeNull();
    expect(ask('tavern')).toBeNull();
    expect(ask(`Tavern:${REFERENCE_KINGDOM}:door`)).toBeNull();
    answer = null; expect(ask(DOOR)).toBeNull();
    answer = new Error('no installed scene'); expect(ask(DOOR)).toBeNull();
    answer = { feet: [Number.NaN, 0, 0], yaw: 0 }; expect(ask(DOOR)).toBeNull();
    answer = { feet: [1, 0, 1], yaw: -64 }; expect(ask(DOOR)).toEqual({ feet: [1, 0, 1], yaw: 192 });
    // A departure from one kingdom is not one from another.
    arrivals.departed(other, 'p1', AT_DOOR);
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
  });

  it('opens a door only for a leave taken at that door, the latest leave only', () => {
    const arrivals = new RealmPortalArrivals(() => 0), [x, y, z] = OUTSIDE.feet;
    arrivals.door('tavern', () => OUTSIDE);
    const left = (feet: readonly [number, number, number]) => { arrivals.departed(REFERENCE_KINGDOM, 'p1', feet); return arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD); };
    // Walked out from the market and named the tavern: the gate.
    expect(left(AT_MARKET)).toBeNull();
    // At the edge of the door's reach, across and up, and just past it.
    expect(left([x + PORTAL_DEPARTURE_REACH.across - 0.01, y, z])).toEqual(OUTSIDE);
    expect(left([x + PORTAL_DEPARTURE_REACH.across + 0.01, y, z])).toBeNull();
    expect(left([x, y + PORTAL_DEPARTURE_REACH.up - 0.01, z])).toEqual(OUTSIDE);
    expect(left([x, y + PORTAL_DEPARTURE_REACH.up + 0.01, z])).toBeNull();
    // A later leave elsewhere replaces one at the door; a leave with no real feet records nothing.
    arrivals.departed(REFERENCE_KINGDOM, 'p1', AT_DOOR);
    expect(left(AT_MARKET)).toBeNull();
    arrivals.departed(REFERENCE_KINGDOM, 'p1', AT_DOOR);
    expect(left([Number.NaN, 0, 9])).toBeNull();
    // A leave the room reports without feet (the room as it is on main) replaces one at the door and opens nothing.
    arrivals.departed(REFERENCE_KINGDOM, 'p1', AT_DOOR);
    arrivals.departed(REFERENCE_KINGDOM, 'p1');
    expect(arrivals.arrival(REFERENCE_KINGDOM, 'p1', DOOR, REFERENCE_WORLD)).toBeNull();
  });

  it('keeps one finder per door kind and stays bounded', () => {
    const arrivals = new RealmPortalArrivals(() => 0);
    const off = arrivals.door('tavern', () => OUTSIDE);
    expect(() => arrivals.door('tavern', () => OUTSIDE)).toThrow();
    expect(() => arrivals.door('Tavern Door', () => OUTSIDE)).toThrow();
    off();
    arrivals.door('tavern', () => OUTSIDE);
    for (let n = 0; n <= PORTAL_DEPARTURES_MAX; n++) arrivals.departed(REFERENCE_KINGDOM, `p${n}`, AT_DOOR);
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
  const rooms: Room<KingdomRoomState>[] = [], shutdowns: (() => Promise<void>)[] = [];
  afterAll(async () => { await Promise.all(rooms.map(room => room.leave().catch(() => {}))); await Promise.all(shutdowns.map(stop => stop())); });
  const waitFor = async (predicate: () => boolean, what: string) => {
    const end = Date.now() + 8000;
    while (!predicate()) { if (Date.now() > end) throw new Error(`Timed out: ${what}`); await new Promise(resolve => setTimeout(resolve, 25)); }
  };
  /** The reference court with a session that travels: each join takes a fresh one-use ticket for the same person. */
  const court = async () => {
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
    const { server } = createRealmServer(services); shutdowns.push(() => server.gracefullyShutdown(false));
    await server.listen(port, '127.0.0.1');
    const client = new Client(`http://127.0.0.1:${port}`);
    const join = async (ticket: { ticket: string; kingdomId: string; protocol: 1 }, arrive?: string) => {
      const room = await client.joinOrCreate<KingdomRoomState>('kingdom', arrive ? { ...ticket, arrive: { portal: arrive } } : ticket, KingdomRoomState);
      rooms.push(room); await waitFor(() => room.state.walkers.has(room.sessionId), 'own walker');
      const walker = room.state.walkers.get(room.sessionId)!;
      return { room, at: [walker.x, walker.y, walker.z], yaw: walker.yaw };
    };
    const fresh = (principal: RealmPrincipal) => { const ticket = randomUUID(); again.set(ticket, principal); return { ticket, kingdomId: REFERENCE_KINGDOM, protocol: 1 as const }; };
    const left: string[] = [], departed = arrivals.departed.bind(arrivals);
    arrivals.departed = (kingdomId, personId, feet) => { left.push(personId); departed(kingdomId, personId, feet); };
    const walkOut = async (room: Room<KingdomRoomState>) => { const before = left.length; await room.leave(true); await waitFor(() => left.length > before, 'departure'); };
    return { base, seen, join, fresh, left, walkOut };
  };

  it('stands everyone at the gate who did not go through the door: a first walk, a foreign door, a walled door', async () => {
    const { base, seen, join, fresh, walkOut } = await court();
    // Someone who never left names the door on a first walk: the gate (z 7 in the reference court). They stay, so
    // the room stays open through the leaves below.
    const stranger = await join(base.issue(), DOOR);
    expect(stranger.at[2]).toBe(7);
    const firstTicket = base.issue(), first = await join(firstTicket);
    const person = seen.get(firstTicket.ticket)!;
    await walkOut(first.room);
    const foreign = await join(fresh(person), 'tavern:999000002:door');
    expect(foreign.at[2]).toBe(7);
    // That walk-in took the gate's east spawn (4, 0, 7), 5 m from the tavern door: walking out from there and naming
    // the tavern is not going through it, so the gate again.
    expect(Math.hypot(foreign.at[0]! - OUTSIDE.feet[0], foreign.at[2]! - OUTSIDE.feet[2])).toBeGreaterThan(PORTAL_DEPARTURE_REACH.across);
    await walkOut(foreign.room);
    const elsewhere = await join(fresh(person), DOOR);
    expect(elsewhere.at[2]).toBe(7);
    await walkOut(elsewhere.room);
    expect((await join(fresh(person), `cellar:${REFERENCE_KINGDOM}:door`)).at[2]).toBe(7);
  }, 25_000);

  // Expected to fail until the room records where its own walker left on purpose (the realm room owner's change,
  // work/lanes/play/patches/kingdom-room-door-departure.patch). Until then the room reports leaves without feet and
  // everyone comes back at the gate. When the patch lands, this fails as "passed": turn it into an ordinary `it`.
  it.fails('stands a person who walked out at the door and comes back through it outside it, facing out', async () => {
    const { base, seen, join, fresh, left, walkOut } = await court();
    const stranger = await join(base.issue());
    const firstTicket = base.issue(), first = await join(firstTicket);
    expect(first.at[2]).toBe(7);
    const person = seen.get(firstTicket.ticket)!;
    // Walk out at the door (the middle spawn stands within its reach), then back through it: outside, facing out.
    expect(Math.hypot(first.at[0]! - OUTSIDE.feet[0], first.at[2]! - OUTSIDE.feet[2])).toBeLessThan(PORTAL_DEPARTURE_REACH.across);
    await walkOut(first.room);
    expect(left).toEqual([person.personId]);
    const back = await join(fresh(person), DOOR);
    expect(back.at).toEqual([...OUTSIDE.feet]);
    expect(back.yaw).toBe(OUTSIDE.yaw);
    // Everyone sees them there.
    await waitFor(() => stranger.room.state.walkers.get(back.room.sessionId)?.z === OUTSIDE.feet[2], 'shared arrival');
  }, 25_000);
});
