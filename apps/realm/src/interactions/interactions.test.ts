import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type PersonId, type Vec3 } from '@chatdom/shared';
import { RealmIntentSchema, type CollisionWorld, type PlayerState, type RealmInteractionLease, type RealmPrincipal, type RealmPrivateMessage, type RealmReceipt, type RealmTransientMessage, type SolidBox } from '@chatdom/shared/realm';
import type { RealmIntentContext } from '../ports';
import { createInteractionRegistry, interactionTargetId, type InteractionPlacement } from '../../../../packages/world/src/interactions';
import { createInteractionAuthority, type InteractionReleaseCause } from '.';

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
];
function worldOf(revision: number, solids: readonly SolidBox[]): CollisionWorld {
  return { revision, query: q => solids.filter(b => b.min[0] < q.max[0] && b.max[0] > q.min[0] && b.min[1] < q.max[1] && b.max[1] > q.min[1] && b.min[2] < q.max[2] && b.max[2] > q.min[2]) };
}
const NORTH = interactionTargetId.campfireSeat('court', 'north');
const EAST = interactionTargetId.campfireSeat('court', 'east');
const ANVIL = interactionTargetId.anvil('court');
const DOOR = interactionTargetId.homeDoor('p7');
const COURT: InteractionPlacement = {
  source: 'campfire:court', origin: [0, 0, 0], turn: 0, cell: 1,
  anchors: [
    { id: NORTH, kind: 'campfire-seat', zone: 'street', position: [0, .4, 1.4], approach: [0, 0, 2], rest: [0, .4, 1.4], facing: Math.PI, reach: 1.6 },
    { id: EAST, kind: 'campfire-seat', zone: 'street', position: [1.4, .4, 0], approach: [2, 0, 0], rest: [1.4, .4, 0], facing: -Math.PI / 2, reach: 1.6 },
    { id: ANVIL, kind: 'anvil', zone: 'street', position: [-4, .8, 0], approach: [-4, 0, 1], reach: 1.8 },
    { id: DOOR, kind: 'home-door', zone: 'street', position: [6, 1, 0], approach: [6, 0, 1], rest: [6, 0, -1.5], reach: 1.6, plotId: 'p7' },
  ],
};
const KINGDOM = KingdomIdSchema.parse('5001');
const GRACE = 20_000;

function court() {
  let now = 1_000;
  let world = worldOf(1, SOLIDS);
  let registry = createInteractionRegistry({ layoutRevision: 'founded-1', world, placements: [COURT] });
  const walkers = new Map<string, PlayerState>();
  const walking = new Map<string, boolean>();
  const banned = new Set<PersonId>();
  const deeds = new Map<PersonId, string>();
  const transient: RealmTransientMessage[] = [];
  const privates: { personId: string; message: RealmPrivateMessage }[] = [];
  const released: { lease: RealmInteractionLease; why: InteractionReleaseCause }[] = [];
  let rightsGate: Promise<void> | null = null;
  const authority = createInteractionAuthority({
    writerEpoch: 'epoch-1', clock: () => now, reconnectGraceMs: GRACE,
    world: () => world, registry: () => registry,
    rights: { current: async () => { if (rightsGate) await rightsGate; return true; }, permitted: person => !banned.has(person) },
    homes: { ownedPlotId: person => deeds.get(person) ?? null },
    hosts: { released: (lease, why) => { released.push({ lease, why }); } },
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
  function person(twitch: string, at: Vec3) {
    const personId = PersonIdSchema.parse(twitch);
    const principal: RealmPrincipal = { personId, kingdomId: KINGDOM, sessionId: `session-${twitch}-${++sessions}`, expiresAt: now + 3_600_000, origin: 'simulated', publicName: `SIMULATED ${twitch}`, look: 'default' };
    const walkerId = `walker-${sessions}`;
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
    };
  }
  const occupants = () => authority.seats().seats.map(seat => [seat.targetId, seat.walkerId, seat.status] as const);
  return {
    authority, person, walkers, walking, banned, deeds, transient, privates, released, occupants,
    advance: (ms: number) => { now += ms; return now; }, get now() { return now; },
    holdRights: () => { let open!: () => void; rightsGate = new Promise(resolve => { open = resolve; }); return () => { rightsGate = null; open(); }; },
    revise: (solids: readonly SolidBox[]) => { world = worldOf(world.revision + 1, solids); registry = createInteractionRegistry({ layoutRevision: `founded-${world.revision}`, world, placements: [COURT] }); for (const w of walkers.values()) w.collisionRevision = world.revision; authority.adoptRegistry(); },
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
    expect(JSON.stringify(seats)).not.toMatch(/session|1001|1002|expires/);
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
