import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type PersonId, type Vec3 } from '@chatdom/shared';
import { RealmIntentSchema, type CollisionWorld, type PlayerState, type RealmInteractionLease, type RealmPrincipal, type RealmPrivateMessage, type RealmReceipt, type RealmTransientMessage, type SolidBox } from '@chatdom/shared/realm';
import type { RealmIntentContext } from '../ports';
import { createInteractionRegistry, interactionTargetId, type InteractionPlacement } from '../../../../packages/world/src/interactions';
import { campfirePlacement, tavernPlacement } from '../../../../packages/world/src/interactions/places';
import { composeInteractionHosts, createInteractionAuthority, type CampfireSeatHost, type InteractionAdmission, type InteractionHosts, type InteractionReleaseCause, type TableSeatHost } from '.';

/*
 * One court, authored once: a fire with two logs, the anvil, someone else's home door and a wall that hides the
 * north log from the west path. Everything below runs the real registry, the real rules and the real authority;
 * only the room around it (walkers, clock, rights) is this file's, because that is what the room injects.
 */
const box = (min: Vec3, max: Vec3): SolidBox => ({ min, max });
const SOLIDS: readonly SolidBox[] = [
  box([-50, -1, -50], [50, 0, 50]),          // ground
  box([-.5, 0, -.5], [.5, .3, .5]),          // fire stones
  box([-.8, 0, 1.2], [.8, .4, 1.6]),         // north log
  box([1.2, 0, -.8], [1.6, .4, .8]),         // east log
  box([-4.3, 0, -.3], [-3.7, .8, .3]),       // anvil
  box([-3, 0, 1.75], [-.35, 3, 1.85]),       // wall between the west path and the north log
  box([10.8, 0, -.2], [11.2, .45, .2]),      // tavern chair a
  box([12.8, 0, -.2], [13.2, .45, .2]),      // tavern chair b
];
/** The existing tavern threshold flow (spec 22) says who is inside; here, anyone east of x 9. */
const inTavern = (feet: Vec3) => feet[0] >= 9 ? 'tavern:inn' : null;
function worldOf(revision: number, solids: readonly SolidBox[]): CollisionWorld {
  return { revision, query: q => solids.filter(b => b.min[0] < q.max[0] && b.max[0] > q.min[0] && b.min[1] < q.max[1] && b.max[1] > q.min[1] && b.min[2] < q.max[2] && b.max[2] > q.min[2]) };
}
const NORTH = interactionTargetId.campfireSeat('court', 'north');
const EAST = interactionTargetId.campfireSeat('court', 'east');
const ANVIL = interactionTargetId.anvil('court');
const DOOR = interactionTargetId.homeDoor('p7');
const CHAIR_A = interactionTargetId.tavernSeat('inn', 'a');
const CHAIR_B = interactionTargetId.tavernSeat('inn', 'b');
const COURT: InteractionPlacement = {
  source: 'campfire:court', origin: [0, 0, 0], turn: 0, cell: 1,
  anchors: [
    { id: NORTH, kind: 'campfire-seat', zone: 'street', position: [0, .4, 1.4], approach: [0, 0, 2], rest: [0, .4, 1.4], facing: Math.PI, reach: 1.6 },
    { id: EAST, kind: 'campfire-seat', zone: 'street', position: [1.4, .4, 0], approach: [2, 0, 0], rest: [1.4, .4, 0], facing: -Math.PI / 2, reach: 1.6 },
    { id: ANVIL, kind: 'anvil', zone: 'street', position: [-4, .8, 0], approach: [-4, 0, 1], reach: 1.8 },
    { id: DOOR, kind: 'home-door', zone: 'street', position: [6, 1, 0], approach: [6, 0, 1], rest: [6, 0, -1.5], reach: 1.6, plotId: 'p7' },
  ],
};
const INN: InteractionPlacement = {
  source: 'tavern:inn', origin: [11, 0, 0], turn: 0, cell: 1,
  anchors: [
    { id: CHAIR_A, kind: 'tavern-seat', zone: 'tavern:inn', position: [0, .45, 0], approach: [0, 0, .8], rest: [0, .45, 0], facing: Math.PI, reach: 1.4 },
    { id: CHAIR_B, kind: 'tavern-seat', zone: 'tavern:inn', position: [2, .45, 0], approach: [2, 0, .8], rest: [2, .45, 0], facing: Math.PI, reach: 1.4 },
  ],
};
type Admit = NonNullable<InteractionHosts['admit']>;
const KINGDOM = KingdomIdSchema.parse('5001');
const GRACE = 20_000;

function court(options: { readonly placements?: readonly InteractionPlacement[]; readonly hosts?: InteractionHosts } = {}) {
  const placements = options.placements ?? [COURT, INN];
  let now = 1_000;
  let world = worldOf(1, SOLIDS);
  let registry = createInteractionRegistry({ layoutRevision: 'founded-1', world, placements });
  const walkers = new Map<string, PlayerState>();
  const walking = new Map<string, boolean>();
  const banned = new Set<PersonId>();
  const deeds = new Map<PersonId, string>();
  const transient: RealmTransientMessage[] = [];
  const privates: { personId: string; message: RealmPrivateMessage }[] = [];
  const released: { lease: RealmInteractionLease; why: InteractionReleaseCause }[] = [];
  let rightsGate: Promise<void> | null = null;
  // The table host: absent until a test installs one, so `tavern` is honestly unavailable by default.
  let admit: Admit | null = null;
  const admissions = { asked: 0, cancelled: 0 };
  const authority = createInteractionAuthority({
    writerEpoch: 'epoch-1', clock: () => now, reconnectGraceMs: GRACE,
    world: () => world, registry: () => registry,
    rights: { current: async () => { if (rightsGate) await rightsGate; return true; }, permitted: person => !banned.has(person) },
    homes: { ownedPlotId: person => deeds.get(person) ?? null },
    zones: { zoneOf: (_, feet) => inTavern(feet) },
    hosts: options.hosts ?? {
      admit: request => { admissions.asked++; return admit ? admit(request) : Promise.resolve({ admitted: false, reason: 'unavailable' }); },
      released: (lease, why) => { released.push({ lease, why }); },
    },
  });
  authority.bindRoom({
    readWalker: id => walkers.get(id) ?? null,
    placeWalker: (id, position, revision) => {
      const walker = walkers.get(id);
      if (!walker || revision !== world.revision || position.some(n => !Number.isFinite(n))) return false;
      [walker.x, walker.y, walker.z] = position; walker.vx = walker.vy = walker.vz = 0; return true;
    },
    allowWalking: (id, allowed) => { walking.set(id, allowed); },
  });
  authority.bindDelivery({ transient: message => { transient.push(message); }, owner: (personId, message) => { privates.push({ personId, message }); } });

  let sessions = 0;
  /**
   * One authenticated entry, as the actual room makes it: the principal's `sessionId` is a fresh entry id that
   * Colyseus also uses as the walker id, so a reload or a second window is a new session and a new walker.
   */
  function person(twitch: string, at: Vec3) {
    const personId = PersonIdSchema.parse(twitch);
    const entry = ++sessions;
    const principal: RealmPrincipal = { personId, kingdomId: KINGDOM, sessionId: `entry-${entry}`, expiresAt: now + 3_600_000, origin: 'simulated', publicName: `SIMULATED ${twitch}`, look: 'default' };
    const walkerId = principal.sessionId;
    walkers.set(walkerId, { x: at[0], y: at[1], z: at[2], vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: world.revision });
    authority.lifecycle('join', principal, walkerId, now);
    let ids = 0;
    const context = (): RealmIntentContext => {
      const walker = walkers.get(walkerId)!;
      return { principal, walkerId, position: [walker.x, walker.y, walker.z], collisionRevision: walker.collisionRevision, current: () => walkers.get(walkerId) ?? null };
    };
    return {
      personId, principal, walkerId,
      act: (targetId: string, action: 'sit' | 'forge' | 'tavern' | 'enter-home' | 'exit-home' | 'stand', id = `req-${twitch}-${++ids}`): Promise<RealmReceipt> =>
        authority.intent(context(), { version: 1, type: 'interact', id, targetId, action }),
      moveTo: (at: Vec3) => { const walker = walkers.get(walkerId)!; [walker.x, walker.y, walker.z] = at; },
      state: () => authority.selfState(principal.sessionId),
      /** The room's order for a reload: the newer entry joins, then the replaced socket drops and leaves. */
      reload: (at: Vec3 = [walkers.get(walkerId)!.x, 0, walkers.get(walkerId)!.z]) => {
        const next = person(twitch, at);
        authority.lifecycle('drop', principal, walkerId, now);
        authority.lifecycle('leave', principal, walkerId, now);
        walkers.delete(walkerId);
        return next;
      },
    };
  }
  const occupants = () => authority.seats().seats.map(seat => [seat.targetId, seat.walkerId, seat.status] as const);
  return {
    authority, person, walkers, walking, banned, deeds, transient, privates, released, occupants,
    admissions, setAdmit: (next: Admit | null) => { admit = next; },
    advance: (ms: number) => { now += ms; return now; }, get now() { return now; },
    holdRights: () => { let open!: () => void; rightsGate = new Promise(resolve => { open = resolve; }); return () => { rightsGate = null; open(); }; },
    revise: (solids: readonly SolidBox[]) => { world = worldOf(world.revision + 1, solids); registry = createInteractionRegistry({ layoutRevision: `founded-${world.revision}`, world, placements }); for (const w of walkers.values()) w.collisionRevision = world.revision; authority.adoptRegistry(); },
  };
}

describe('the fire court: one log, two people, one room deciding', () => {
  it('serializes a simultaneous claim, refuses the illegal ones and releases exactly the intended lease', async () => {
    const room = court();
    const ash = room.person('1001', [0, 0, 2.1]);
    const bram = room.person('1002', [.3, 0, 2.2]);

    // Two legal claims for one log arrive together; the room's serialized order seats exactly one.
    const [first, second] = await Promise.all([ash.act(NORTH, 'sit', 'claim-a'), bram.act(NORTH, 'sit', 'claim-b')]);
    expect(first).toMatchObject({ id: 'claim-a', status: 'applied', writerEpoch: 'epoch-1', state: { mode: 'seated', targetId: NORTH } });
    expect(second).toMatchObject({ id: 'claim-b', status: 'refused', message: 'Someone is already sitting there.' });
    expect(room.occupants()).toEqual([[NORTH, ash.walkerId, 'occupied']]);
    expect(ash.state()).toMatchObject({ mode: 'seated', targetId: NORTH });
    expect(bram.state()).toMatchObject({ mode: 'standing', targetId: null });
    // The sitter's authoritative body rests on the authored approach and stops walking; the other walks on.
    expect(room.walkers.get(ash.walkerId)).toMatchObject({ x: 0, y: 0, z: 2 });
    expect(room.walking.get(ash.walkerId)).toBe(false);
    expect(room.walking.get(bram.walkerId)).toBeUndefined();
    // Everyone sees one opaque occupant; only the sitter is told their own state, correlated to their request.
    const seats = room.transient.filter(m => m.type === 'seats');
    expect(seats.at(-1)).toEqual({ type: 'seats', writerEpoch: 'epoch-1', revision: 1, seats: [{ targetId: NORTH, walkerId: ash.walkerId, generation: 1, status: 'occupied' }] });
    // Public occupancy is opaque: the walker's render key, a generation and a status. No person, entry or expiry.
    expect(JSON.stringify(seats)).not.toMatch(/session|1001|1002|expires|person/);
    for (const message of seats) for (const seat of message.type === 'seats' ? message.seats : []) expect(Object.keys(seat).sort()).toEqual(['generation', 'status', 'targetId', 'walkerId']);
    expect(room.privates.filter(p => p.message.type === 'interaction' && p.message.requestId === 'claim-a')).toEqual([
      { personId: ash.personId, message: { type: 'interaction', requestId: 'claim-a', writerEpoch: 'epoch-1', state: { revision: 1, mode: 'seated', targetId: NORTH, plotId: null } } },
    ]);

    // A duplicate delivery of either request returns the same outcome and changes nothing.
    const revision = room.authority.seats().revision;
    expect(await ash.act(NORTH, 'sit', 'claim-a')).toEqual(first);
    expect(await bram.act(EAST, 'sit', 'claim-b')).toEqual(second);
    expect(room.authority.seats().revision).toBe(revision);
    expect(room.occupants()).toEqual([[NORTH, ash.walkerId, 'occupied']]);

    // A seated person cannot also take the other log; standing first is the honest next step.
    expect(await ash.act(EAST, 'sit')).toMatchObject({ status: 'refused', message: 'Stand up first.' });
    expect(room.occupants()).toEqual([[NORTH, ash.walkerId, 'occupied']]);
  });

  it('accepts only what the body can physically reach, from the strict intent and the room’s own pose', async () => {
    const room = court();
    // The intent carries a target and a verb only; actor, position or a claimed seat cannot ride along.
    const base = { version: 1, type: 'interact', id: 'forged', targetId: NORTH, action: 'sit' };
    for (const extra of [{ walkerId: 'walker-9' }, { position: [0, 0, 2] }, { personId: '1001' }, { reachable: true }]) {
      expect(RealmIntentSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
    expect(RealmIntentSchema.safeParse({ ...base, action: 'teleport' }).success).toBe(false);
    expect(RealmIntentSchema.safeParse(base).success).toBe(true);

    const far = room.person('1003', [0, 0, 4.5]);
    expect(await far.act(NORTH, 'sit')).toMatchObject({ status: 'refused', message: 'Come a little closer, with nothing in the way.' });
    // Within arm's reach, but the wall stands between the eye and the log.
    const behindWall = room.person('1004', [-1, 0, 2.3]);
    expect(await behindWall.act(NORTH, 'sit')).toMatchObject({ status: 'refused', message: 'Come a little closer, with nothing in the way.' });
    // A target that does not exist, and a verb that does not belong to this target.
    const near = room.person('1005', [0, 0, 2.1]);
    expect(await near.act('fire:court:seat:west', 'sit')).toMatchObject({ status: 'refused' });
    expect(await near.act(NORTH, 'forge')).toMatchObject({ status: 'refused', message: 'That is not something to do here.' });
    // Someone else's door has no entry for this person, whatever their deed says about another plot.
    const neighbour = room.person('1006', [6, 0, 1.2]);
    room.deeds.set(neighbour.personId, 'p9');
    expect(await neighbour.act(DOOR, 'enter-home')).toMatchObject({ status: 'refused', message: 'Only the owner of this home can open its door.' });
    expect(neighbour.state().mode).toBe('standing');
    expect(room.walkers.get(neighbour.walkerId)).toMatchObject({ x: 6, z: 1.2 });
    expect(room.occupants()).toEqual([]);

    // Walking up the same body to the same log now succeeds: reach is judged from where the room has you.
    far.moveTo([.2, 0, 2.3]);
    expect(await far.act(NORTH, 'sit')).toMatchObject({ status: 'applied', state: { mode: 'seated', targetId: NORTH } });
    // The anvil confirms reach and opens nothing durable: no lease, unchanged standing state.
    const smith = room.person('1007', [-4, 0, 1.2]);
    expect(await smith.act(ANVIL, 'forge')).toMatchObject({ status: 'applied', state: { mode: 'standing' } });
    expect(room.occupants()).toEqual([[NORTH, far.walkerId, 'occupied']]);
  });

  it('rereads rights after an await, and stand, drop, grace, expiry and moderation end only the intended lease', async () => {
    const room = court();
    const ash = room.person('1001', [0, 0, 2.1]);
    const bram = room.person('1002', [2.1, 0, .2]);

    // A timeout lands while the realm is still confirming the session: the room's current rights win.
    const open = room.holdRights();
    const pending = bram.act(EAST, 'sit');
    room.banned.add(bram.personId);
    open();
    expect(await pending).toMatchObject({ status: 'refused', message: 'You cannot do that in this kingdom right now.' });
    expect(room.occupants()).toEqual([]);
    room.banned.delete(bram.personId);

    expect(await ash.act(NORTH, 'sit')).toMatchObject({ status: 'applied' });
    expect(await bram.act(EAST, 'sit')).toMatchObject({ status: 'applied' });
    const generation = room.authority.seats().seats.find(s => s.targetId === NORTH)!.generation;

    // Standing is idempotent and releases only one's own seat; the body walks again.
    expect(await ash.act(NORTH, 'stand')).toMatchObject({ status: 'applied', state: { mode: 'standing', targetId: null } });
    expect(await ash.act(NORTH, 'stand')).toMatchObject({ status: 'applied', state: { mode: 'standing' } });
    expect(room.walking.get(ash.walkerId)).toBe(true);
    expect(room.occupants()).toEqual([[EAST, bram.walkerId, 'occupied']]);
    expect(room.released.map(r => [r.lease.seat.targetId, r.why])).toEqual([[NORTH, 'stand']]);

    // A dropped connection holds the seat for the configured grace on the room clock, then lets go by itself.
    const droppedAt = room.now;
    room.authority.lifecycle('drop', bram.principal, bram.walkerId, droppedAt);
    expect(room.occupants()).toEqual([[EAST, bram.walkerId, 'reconnecting']]);
    expect(room.authority.nextExpiry()).toBe(droppedAt + GRACE);
    // While reconnecting the seat is still taken: nobody else sits on a held log.
    ash.moveTo([2.2, 0, -.3]);
    expect(await ash.act(EAST, 'sit')).toMatchObject({ status: 'refused', message: 'Someone is already sitting there.' });
    room.authority.expire(room.advance(GRACE - 1));
    expect(room.occupants()).toEqual([[EAST, bram.walkerId, 'reconnecting']]);
    room.authority.expire(room.advance(1));
    expect(room.occupants()).toEqual([]);
    expect(room.released.at(-1)).toMatchObject({ why: 'expired', lease: { seat: { targetId: EAST } } });

    // Moderation ends occupancy in the same turn and tells the host; a later stale stand cannot touch the next sitter.
    expect(await ash.act(EAST, 'sit')).toMatchObject({ status: 'applied' });
    room.authority.revoke(ash.personId);
    expect(room.occupants()).toEqual([]);
    expect(ash.state()).toMatchObject({ mode: 'standing' });
    expect(room.walking.get(ash.walkerId)).toBe(true);
    expect(room.released.at(-1)).toMatchObject({ why: 'revoked' });
    const cara = room.person('1008', [.2, 0, 2.2]);
    expect(await cara.act(NORTH, 'sit')).toMatchObject({ status: 'applied' });
    expect(room.authority.seats().seats[0]!.generation).toBeGreaterThan(generation);
    room.authority.release(ash.principal.sessionId);
    expect(room.occupants()).toEqual([[NORTH, cara.walkerId, 'occupied']]);
  });

  it('carries one seat through a reload, so a replaced window can neither unseat nor be told anything', async () => {
    const room = court();
    const ash = room.person('1001', [0, 0, 2.1]);
    const sat = await ash.act(NORTH, 'sit', 'r1');
    expect(sat).toMatchObject({ status: 'applied', state: { mode: 'seated', targetId: NORTH } });
    const seated = room.authority.seats().seats[0]!;
    const before = room.privates.length;

    // A reload is a fresh entry: a new session and walker. The one lease follows the body; nobody sits twice.
    const again = ash.reload([.4, 0, 2.4]);
    expect(room.occupants()).toEqual([[NORTH, again.walkerId, 'occupied']]);
    expect(room.authority.seats().seats[0]!.generation).toBe(seated.generation);
    expect(again.state()).toMatchObject({ mode: 'seated', targetId: NORTH });
    expect(room.walkers.get(again.walkerId)).toMatchObject({ x: 0, y: 0, z: 2 });
    expect(room.walking.get(again.walkerId)).toBe(false);
    // The newer window gets its snapshot with a higher revision than anything the old window ever saw.
    const told = room.privates.slice(before).map(p => p.message);
    expect(told).toEqual([{ type: 'interaction', requestId: null, writerEpoch: 'epoch-1', state: again.state() }]);
    expect(again.state().revision).toBeGreaterThan(sat.status === 'applied' ? sat.state.revision : Infinity);
    expect(room.released).toEqual([]);

    // The same request IDs from the new page are new requests, not the old page's replies.
    const told2 = room.privates.length;
    expect(await again.act(NORTH, 'stand', 'r1')).toMatchObject({ id: 'r1', status: 'applied', state: { mode: 'standing' } });
    expect(room.occupants()).toEqual([]);
    expect(room.privates.slice(told2).map(p => p.message)).toEqual([{ type: 'interaction', requestId: 'r1', writerEpoch: 'epoch-1', state: again.state() }]);
    expect(room.released.map(r => r.why)).toEqual(['stand']);

    // Two windows open at once: the newest takes the seat over; the older window's stand is a no-op for it.
    again.moveTo([2.1, 0, .3]);
    expect(await again.act(EAST, 'sit', 'r2')).toMatchObject({ status: 'applied' });
    const third = room.person('1001', [2.3, 0, .1]);
    expect(room.occupants()).toEqual([[EAST, third.walkerId, 'occupied']]);
    const quiet = room.privates.length;
    expect(await again.act(EAST, 'stand', 'r3')).toMatchObject({ status: 'applied', state: { mode: 'standing' } });
    expect(room.occupants()).toEqual([[EAST, third.walkerId, 'occupied']]);
    // Owner delivery reaches whichever window the person controls now, so the replaced one is never spoken for.
    expect(room.privates.slice(quiet)).toEqual([]);
    expect(third.state()).toMatchObject({ mode: 'seated', targetId: EAST });
  });

  it('holds a dropped seat on the room clock with nobody connected, then lets go; a late return stands honestly', async () => {
    const room = court();
    const ash = room.person('1001', [0, 0, 2.1]);
    const bram = room.person('1002', [2.1, 0, .2]);
    expect(await ash.act(NORTH, 'sit')).toMatchObject({ status: 'applied' });
    expect(await bram.act(EAST, 'sit')).toMatchObject({ status: 'applied' });

    // Everyone drops. No browser, socket or callback is left; only the room clock decides.
    room.authority.lifecycle('drop', ash.principal, ash.walkerId, room.now);
    room.advance(5_000);
    room.authority.lifecycle('drop', bram.principal, bram.walkerId, room.now);
    expect(room.occupants()).toEqual([[EAST, bram.walkerId, 'reconnecting'], [NORTH, ash.walkerId, 'reconnecting']]);
    const delivered = room.privates.length;
    expect(room.authority.nextExpiry()).toBe(room.now - 5_000 + GRACE);
    room.authority.expire(room.advance(GRACE - 5_000));
    expect(room.occupants()).toEqual([[EAST, bram.walkerId, 'reconnecting']]);
    expect(room.authority.nextExpiry()).toBe(room.now + 5_000);
    // A reconnect inside grace resumes the same generation in place.
    const generation = room.authority.seats().seats[0]!.generation;
    room.authority.lifecycle('reconnect', bram.principal, bram.walkerId, room.advance(4_999));
    expect(room.occupants()).toEqual([[EAST, bram.walkerId, 'occupied']]);
    expect(room.authority.seats().seats[0]!.generation).toBe(generation);
    expect(room.authority.nextExpiry()).toBeNull();
    // Nothing was said to anyone while they were away; the returning sitter gets one snapshot.
    expect(room.privates.slice(delivered).map(p => [p.personId, p.message.type === 'interaction' && p.message.state.mode])).toEqual([[bram.personId, 'seated']]);
    expect(room.released.map(r => [r.lease.seat.targetId, r.why])).toEqual([[NORTH, 'expired']]);

    // Coming back after the grace finds nothing held: standing, walking, and the log free for others.
    const late = ash.reload([.3, 0, 2.5]);
    expect(late.state()).toMatchObject({ mode: 'standing', targetId: null });
    expect(room.occupants()).toEqual([[EAST, bram.walkerId, 'occupied']]);
    expect(await late.act(NORTH, 'sit')).toMatchObject({ status: 'applied' });
  });

  it('asks the table host, and a ban during the awaited admission returns it unseated in the same turn', async () => {
    const room = court();
    const ash = room.person('1001', [11, 0, 1]);
    const bram = room.person('1002', [11.3, 0, 1.1]);
    // No table host is bound: an honest unavailable, never a pretend open table.
    expect(await ash.act(CHAIR_A, 'tavern')).toMatchObject({ status: 'unavailable', message: 'The table is not open right now. Nothing has changed.' });
    expect(room.occupants()).toEqual([]);

    // A host that answers later. The ban lands while it is still deciding.
    const pending: { request: Parameters<Admit>[0]; answer: (a: InteractionAdmission) => void }[] = [];
    room.setAdmit(request => new Promise(answer => { pending.push({ request, answer }); }));
    const banned = ash.act(CHAIR_A, 'tavern');
    await Promise.resolve(); await Promise.resolve();
    expect(pending).toHaveLength(1);
    room.banned.add(ash.personId);
    room.authority.revoke(ash.personId);
    expect(pending[0]!.request.signal.aborted).toBe(true);
    pending[0]!.answer({ admitted: true, cancel: () => { room.admissions.cancelled++; } });
    expect(await banned).toMatchObject({ status: 'refused', message: 'You cannot do that in this kingdom right now.' });
    expect(room.admissions.cancelled).toBe(1);
    expect(room.occupants()).toEqual([]);
    expect(ash.state().mode).toBe('standing');

    // Two admitted guests race for one chair: one sits, the other's admission goes straight back to the host.
    room.banned.delete(ash.personId);
    room.setAdmit(async () => ({ admitted: true, cancel: () => { room.admissions.cancelled++; } }));
    const cara = room.person('1003', [11.2, 0, .9]);
    const [first, second] = await Promise.all([bram.act(CHAIR_A, 'tavern'), cara.act(CHAIR_A, 'tavern')]);
    expect([first.status, second.status]).toEqual(['applied', 'refused']);
    expect(second).toMatchObject({ message: 'Someone is already sitting there.' });
    expect(room.occupants()).toEqual([[CHAIR_A, bram.walkerId, 'occupied']]);
    expect(room.admissions.cancelled).toBe(2);
    // The admission belongs to the lease: standing returns it, exactly once.
    expect(await bram.act(CHAIR_A, 'stand')).toMatchObject({ status: 'applied' });
    expect(room.admissions.cancelled).toBe(3);

    // A host that declines leaves no reserved chair behind.
    room.setAdmit(async () => ({ admitted: false, reason: 'refused' }));
    expect(await cara.act(CHAIR_A, 'tavern')).toMatchObject({ status: 'unavailable', message: 'The table did not take a new guest just now.' });
    expect(room.occupants()).toEqual([]);
    // From the street, a tavern chair is not in here with you; the host is not even asked.
    const asked = room.admissions.asked;
    const outside = room.person('1004', [8.6, 0, .8]);
    room.setAdmit(async () => ({ admitted: true, cancel: () => {} }));
    expect(await outside.act(CHAIR_A, 'tavern')).toMatchObject({ status: 'refused' });
    expect(room.admissions.asked).toBe(asked);
  });

  it('fences by generation and writer epoch: stale callbacks, old contexts and a closed writer change nothing', async () => {
    const room = court();
    const ash = room.person('1001', [0, 0, 2.1]);
    const bram = room.person('1002', [.2, 0, 2.2]);
    expect(await ash.act(NORTH, 'sit')).toMatchObject({ status: 'applied' });
    const old = room.authority.seats().seats[0]!.generation;
    expect(await ash.act(NORTH, 'stand')).toMatchObject({ status: 'applied' });
    expect(await bram.act(NORTH, 'sit')).toMatchObject({ status: 'applied' });
    const now = room.authority.seats().seats[0]!.generation;
    expect(now).toBeGreaterThan(old);

    // A host's late callback for the earlier sitter cannot unseat the current one; the current generation can.
    expect(room.authority.endSeat({ targetId: NORTH, generation: old })).toBe(false);
    expect(room.occupants()).toEqual([[NORTH, bram.walkerId, 'occupied']]);
    expect(room.authority.endSeat({ targetId: NORTH, generation: now })).toBe(true);
    expect(room.occupants()).toEqual([]);
    expect(bram.state().mode).toBe('standing');
    expect(room.walking.get(bram.walkerId)).toBe(true);
    expect(room.released.at(-1)).toMatchObject({ why: 'host-ended', lease: { seat: { generation: now } } });

    // A trusted context minted under another writer epoch is refused without touching the book.
    const revision = room.authority.seats().revision;
    const walker = room.walkers.get(ash.walkerId)!;
    const stale = room.authority.act({
      personId: ash.personId, sessionId: ash.principal.sessionId, walkerId: ash.walkerId, writerEpoch: 'epoch-0', now: room.now,
      position: [walker.x, walker.y, walker.z], collisionRevision: 1, ownedPlotId: null,
      target: { id: NORTH, kind: 'campfire-seat', position: [0, .4, 1.4], approach: [0, 0, 2], reach: 1.6 }, unobstructed: true, permitted: true,
    }, 'sit');
    expect(stale).toEqual({ kind: 'refused', reason: 'unavailable' });
    expect(room.authority.seats().revision).toBe(revision);

    // Writer loss: hosts hear every lease end, nothing more is delivered, and a new epoch starts empty.
    expect(await ash.act(NORTH, 'sit')).toMatchObject({ status: 'applied' });
    const pending: (() => void)[] = [];
    room.setAdmit(request => new Promise(answer => { pending.push(() => answer({ admitted: true, cancel: () => { room.admissions.cancelled++; } })); void request; }));
    const guest = room.person('1003', [11, 0, 1]);
    const waiting = guest.act(CHAIR_A, 'tavern');
    await Promise.resolve(); await Promise.resolve();
    const delivered = [room.transient.length, room.privates.length];
    room.authority.dispose();
    expect(room.released.at(-1)).toMatchObject({ why: 'closed', lease: { seat: { targetId: NORTH } } });
    pending[0]!();
    expect(await waiting).toMatchObject({ status: 'unavailable', message: 'The kingdom moved on. Reconnect to try again.' });
    expect(await bram.act(EAST, 'sit')).toMatchObject({ status: 'unavailable' });
    expect([room.transient.length, room.privates.length]).toEqual(delivered);
    expect(room.admissions.cancelled).toBe(1);
  });

  it('answers a limited burst at once and never writes a durable fact', async () => {
    let allowed = true;
    const asked: string[] = [];
    const world = worldOf(1, SOLIDS);
    const registry = createInteractionRegistry({ layoutRevision: 'founded-1', world, placements: [COURT] });
    const authority = createInteractionAuthority({
      writerEpoch: 'epoch-1', clock: () => 0, reconnectGraceMs: GRACE, world: () => world, registry: () => registry,
      rights: { current: async principal => { asked.push(principal.sessionId); return true; }, permitted: () => true },
      homes: { ownedPlotId: () => null }, limiter: () => allowed,
    });
    const walker: PlayerState = { x: 0, y: 0, z: 2.1, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: 1 };
    authority.bindRoom({ readWalker: () => walker, placeWalker: () => true, allowWalking: () => {} });
    const principal: RealmPrincipal = { personId: PersonIdSchema.parse('1001'), kingdomId: KINGDOM, sessionId: 'entry-1', expiresAt: 1e12, origin: 'simulated', publicName: 'SIMULATED 1001', look: 'default' };
    const context: RealmIntentContext = { principal, walkerId: 'entry-1', position: [0, 0, 2.1], collisionRevision: 1, current: () => walker };
    allowed = false;
    expect(await authority.intent(context, { version: 1, type: 'interact', id: 'burst', targetId: NORTH, action: 'sit' })).toMatchObject({ status: 'unavailable', message: 'One moment, that was quick.' });
    expect(asked).toEqual([]);
    expect(authority.seats().seats).toEqual([]);
    allowed = true;
    const receipts = [
      await authority.intent(context, { version: 1, type: 'interact', id: 'sit', targetId: NORTH, action: 'sit' }),
      await authority.intent(context, { version: 1, type: 'interact', id: 'stand', targetId: NORTH, action: 'stand' }),
      await authority.intent(context, { version: 1, type: 'interact', id: 'far', targetId: ANVIL, action: 'forge' }),
    ];
    // Ephemeral acceptance is `applied`; nothing here is ever `committed` with a fact sequence.
    expect(receipts.map(r => r.status)).toEqual(['applied', 'applied', 'refused']);
    expect(JSON.stringify(receipts)).not.toMatch(/committed|sequence/);
  });

  it('places every authored anchor once through its placement, disabling what is unsafe rather than guessing', () => {
    const world = worldOf(3, [box([-50, -1, -50], [50, 0, 50]), box([12.4, 0, 9], [13, 2, 11])]);
    const dup = interactionTargetId.campfireSeat('turned', 'c');
    const registry = createInteractionRegistry({
      layoutRevision: 'founded-3', world, placements: [
        { source: 'campfire:turned', origin: [10, 0, 10], turn: 1, cell: 1, anchors: [
          { id: interactionTargetId.campfireSeat('turned', 'a'), kind: 'campfire-seat', zone: 'street', position: [0, .4, 1.4], approach: [0, 0, 2], rest: [0, .4, 1.4], facing: Math.PI, reach: 1.6 },
          // Once turned, its approach lands inside the post at x 12.4–13: disabled, not nudged.
          { id: interactionTargetId.campfireSeat('turned', 'b'), kind: 'campfire-seat', zone: 'street', position: [0, .4, 2], approach: [0, 0, 2.7], rest: [0, .4, 2], reach: 1.6 },
          { id: dup, kind: 'campfire-seat', zone: 'street', position: [-1, .4, 0], approach: [-1, 0, 1], rest: [-1, .4, 0], reach: 1.6 },
          { id: 'Log 3', kind: 'campfire-seat', zone: 'street', position: [0, 0, 0], approach: [0, 0, 3], rest: [0, 0, 0], reach: 1.6 },
          { id: interactionTargetId.anvil('far'), kind: 'anvil', zone: 'street', position: [0, 0, 0], approach: [0, 0, 1], reach: 9 },
        ] },
        // A second producer naming the same seat makes both ambiguous: neither is offered.
        { source: 'campfire:copy', origin: [0, 0, 0], turn: 0, cell: 1, anchors: [
          { id: dup, kind: 'campfire-seat', zone: 'street', position: [3, .4, 3], approach: [3, 0, 4], rest: [3, .4, 3], reach: 1.6 },
        ] },
      ],
    });
    // The turned placement: local +Z faces world +X, and a quarter turn adds π/2 to the seated heading.
    expect(registry.records.map(r => r.target.id)).toEqual(['fire:turned:seat:a']);
    const [a] = registry.records;
    expect(a!.target).toEqual({ id: 'fire:turned:seat:a', kind: 'campfire-seat', position: [11.4, .4, 10], approach: [12, 0, 10], reach: 1.6 });
    expect(a!.rest).toEqual([11.4, .4, 10]);
    expect(a!.facing).toBeCloseTo(-Math.PI / 2);
    expect(registry.targets()).toEqual([a!.target]);
    expect(registry.disabled.map(d => [d.id, d.reason])).toEqual([
      ['Log 3', 'invalid-id'], ['anvil:far', 'out-of-reach'], ['fire:turned:seat:b', 'approach-blocked'], [dup, 'duplicate'], [dup, 'duplicate'],
    ]);
    // An interior placement uses 0.125 m cells.
    const inside = createInteractionRegistry({ layoutRevision: 'home-p7@2', world, placements: [
      { source: 'home:p7@2', origin: [20, 0, 20], turn: 2, cell: .125, anchors: [
        { id: interactionTargetId.homeExit('p7'), kind: 'home-exit', zone: 'home:p7', position: [0, 8, 8], approach: [0, 0, 4], rest: [0, 0, 24], reach: 1.2, plotId: 'p7' },
      ] },
    ] });
    expect(inside.records[0]).toMatchObject({ target: { position: [20, 1, 19], approach: [20, 0, 19.5] }, rest: [20, 0, 17], leadsTo: 'street' });
  });
});

describe('the fire and the table through their own hosts', () => {
  it('keeps a public market bench independent of campfire admission', async () => {
    let asked = 0;
    const id = interactionTargetId.benchSeat('market:rest:v1:0', 'left');
    const placement: InteractionPlacement = { source: 'market:rest:v1:0', origin: [0, 0, 0], turn: 0, cell: 1,
      anchors: [{ id, kind: 'bench-seat', zone: 'street', position: [-7, .4, 0], approach: [-7, 0, .8], rest: [-7, 0, 0], facing: Math.PI, reach: 2 }] };
    const room = court({ placements: [placement], hosts: composeInteractionHosts({ campfire: {
      admit: async () => { asked++; return { admitted: false, reason: 'refused' }; },
    } }) });
    const ash = room.person('1001', [-7, 0, .8]);
    expect(await ash.act(id, 'sit')).toMatchObject({ status: 'applied', state: { mode: 'seated', targetId: id } });
    expect(asked).toBe(0);
    expect(await ash.act(id, 'stand')).toMatchObject({ status: 'applied', state: { mode: 'standing' } });
    expect(room.occupants()).toEqual([]);
    room.authority.dispose();
  });

  /*
   * The campfire clearing and the tavern layout author their seats in their own frames; the room registers them
   * from those authored points (places.ts) and asks each host through its own seam (hosts.ts). The clearing sits
   * a quarter turn round at x −20: seat 0 is the Magistrate's chair and is never a walk-up seat.
   */
  // The clearing's ring as `campfireArrangement` authors it: hips on the floor, headings toward the fire, and each
  // approved route ending in the corridor between the sitter's feet and the hearth.
  const ROUTES: Record<number, readonly (readonly [number, number])[]> = { 0: [[0, -1.1]], 1: [[-1.5, 2.6], [0, 1]], 2: [[1, 0]] };
  const FIRE = campfirePlacement({ site: 'glade', origin: [-20, 0, 0], turn: 1, seatTop: .45, source: 'campfire:glade@6',
    approach: seat => ROUTES[seat] ?? [], seats: [
      { seat: 0, kind: 'magistrate', hip: [0, -1.7], heading: 0 },
      { seat: 1, kind: 'player', hip: [0, 1.6], heading: Math.PI },
      { seat: 2, kind: 'player', hip: [1.6, 0], heading: -Math.PI / 2 },
    ] });
  const TAVERN = tavernPlacement({ tavern: 'inn', origin: [11, 0, 0], turn: 0, source: 'tavern:inn@snug', seats: [
    { key: 'long:a', tableId: 'long', position: [0, .45, 0], facing: Math.PI, approach: [0, 0, .8] },
    { key: 'long:b', tableId: 'long', position: [2, .45, 0], facing: Math.PI, approach: [2, 0, .8] },
    // A bench by the hearth is for resting, not a table's game seat: no `tavern` target.
    { key: 'hearth:bench-1', tableId: null, position: [4, .45, 0], facing: 0, approach: [4, 0, .8] },
  ] });
  const LOG_1 = 'fire:glade:seat:1', LOG_2 = 'fire:glade:seat:2', CHAIR = 'tavern:long:seat:a';

  it('registers the authored seats once, routes each claim to its own host and tells it the exact lease', async () => {
    // The fire's own rule: log 2 is held by tonight's match; any other log is a social seat.
    const fire = { asked: [] as number[], cancelled: 0, seated: [] as number[], released: [] as [number, number, InteractionReleaseCause][] };
    const campfire: CampfireSeatHost = {
      admit: async ({ seat }) => {
        fire.asked.push(seat);
        return seat === 2 ? { admitted: false, reason: 'refused' } : { admitted: true, cancel: () => { fire.cancelled++; }, seated: s => { fire.seated.push(s.generation); } };
      },
      released: (seat, why) => { fire.released.push([seat.place.seat, seat.generation, why]); },
    };
    const room = court({ placements: [FIRE, TAVERN], hosts: composeInteractionHosts({ campfire }) });
    const registry = createInteractionRegistry({ layoutRevision: 'founded-1', world: worldOf(1, SOLIDS), placements: [FIRE, TAVERN] });
    expect(registry.records.map(r => r.target.id)).toEqual([LOG_1, LOG_2, CHAIR, 'tavern:long:seat:b']);
    // A quarter turn: local +Z faces world +X; the look lands on the log at the clearing's seat height, the rest is the
    // floor under the hips (the sole datum the rig sits on), and the Magistrate's chair is nobody's walk-up seat.
    const log = registry.get(LOG_1)!;
    expect(log.target.position[0]).toBeCloseTo(-18.4); expect(log.target.position[1]).toBeCloseTo(.45);
    expect(log.target.approach[0]).toBeCloseTo(-19); expect(log.rest).toEqual([-18.4, 0, 0]);
    expect(log.facing).toBeCloseTo(-Math.PI / 2);
    expect(registry.get(CHAIR)).toMatchObject({ zone: 'tavern:inn', rest: [11, 0, 0], target: { position: [11, .45, 0], approach: [11, 0, .8] } });

    const ash = room.person('1001', [...log.target.approach]);
    const two = registry.get(LOG_2)!.target.approach;
    const bram = room.person('1002', [two[0], two[1], two[2]]);
    // The log the match holds is refused with the fire's own words; nothing is held, nothing moved.
    expect(await bram.act(LOG_2, 'sit')).toMatchObject({ status: 'refused', message: 'That log is kept for the game at the fire.' });
    expect(room.occupants()).toEqual([]);
    // A social log: the fire says yes, the room seats, and only then does the fire learn the exact generation.
    expect(await ash.act(LOG_1, 'sit')).toMatchObject({ status: 'applied', state: { mode: 'seated', targetId: LOG_1 } });
    const generation = room.authority.seats().seats[0]!.generation;
    expect(fire.seated).toEqual([generation]);
    expect(fire.asked).toEqual([2, 1]);
    // Sitting socially grants nothing else: no table, no host beyond the fire's own seat seam was ever asked.
    expect(await ash.act(LOG_1, 'stand')).toMatchObject({ status: 'applied', state: { mode: 'standing' } });
    expect(fire.released).toEqual([[1, generation, 'stand']]);
    expect(fire.cancelled).toBe(1);

    // Moderation at the fire: the supervisor hears it in the same turn the lease ends.
    await ash.act(LOG_1, 'sit');
    room.banned.add(ash.personId);
    room.authority.revoke(ash.personId);
    expect(fire.seated).toHaveLength(2);
    expect(fire.released.at(-1)).toEqual([1, fire.seated[1], 'revoked']);
    expect(room.occupants()).toEqual([]);
    expect(room.walking.get(ash.walkerId)).toBe(true);

    // No table host is installed: the chair is honestly unavailable and no table opens.
    const cara = room.person('1003', [11, 0, .9]);
    expect(await cara.act(CHAIR, 'tavern')).toMatchObject({ status: 'unavailable', message: 'The table is not open right now. Nothing has changed.' });
    expect(cara.state().mode).toBe('standing');
  });

  it('lets the table host end its own guest by generation and treats a failing host as not now', async () => {
    let authority: ReturnType<typeof court>['authority'] | null = null;
    const table = { cancelled: 0, ended: [] as boolean[], released: [] as [string, InteractionReleaseCause][] };
    let mode: 'admit' | 'decline' | 'throw' = 'admit';
    const tavern: TableSeatHost = {
      admit: async ({ table: id, seat }) => {
        if (mode === 'throw') throw new Error('trestle offline');
        if (mode === 'decline') return { admitted: false, reason: 'refused' };
        expect([id, seat]).toEqual(['long', 'a']);
        // The host keeps the generation it admitted, then later closes that guest's place itself.
        return { admitted: true, cancel: () => { table.cancelled++; }, seated: s => { queueMicrotask(() => { table.ended.push(authority!.endSeat(s)); }); } };
      },
      released: (seat, why) => { table.released.push([`${seat.place.table}:${seat.place.seat}`, why]); },
    };
    const room = court({ placements: [FIRE, TAVERN], hosts: composeInteractionHosts({ tavern }) });
    authority = room.authority;
    const ash = room.person('1001', [11, 0, .9]);
    // Without a campfire host, a log is a social seat and nobody is asked.
    const one = room.person('1002', [-17.8, 0, 0]);
    expect(await one.act(LOG_1, 'sit')).toMatchObject({ status: 'applied' });

    expect(await ash.act(CHAIR, 'tavern')).toMatchObject({ status: 'applied', state: { mode: 'seated', targetId: CHAIR } });
    await Promise.resolve();
    expect(table.ended).toEqual([true]);
    expect(ash.state()).toMatchObject({ mode: 'standing', targetId: null });
    expect(table.released).toEqual([['long:a', 'host-ended']]);
    expect(table.cancelled).toBe(1);
    expect(room.walking.get(ash.walkerId)).toBe(true);
    // A stale callback with the same generation changes nothing more.
    expect(room.authority.endSeat({ targetId: CHAIR, generation: 1 })).toBe(false);

    mode = 'decline';
    expect(await ash.act(CHAIR, 'tavern')).toMatchObject({ status: 'unavailable', message: 'The table did not take a new guest just now.' });
    mode = 'throw';
    expect(await ash.act(CHAIR, 'tavern')).toMatchObject({ status: 'unavailable', message: 'The table is not open right now. Nothing has changed.' });
    expect(room.occupants()).toEqual([[LOG_1, one.walkerId, 'occupied']]);
  });
});
