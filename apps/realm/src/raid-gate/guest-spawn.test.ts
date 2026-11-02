import { randomUUID } from 'node:crypto';
import { createServer as createPortProbe } from 'node:net';
import { Client, type Room } from '@colyseus/sdk';
import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type Vec3 } from '@chatdom/shared';
import { KingdomRoomState, WALK_BODY, type CollisionWorld, type RealmPrincipal, type SolidBox } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { foundedGroundAt } from '@chatdom/world/founded-collision';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { compileCollisionWorld } from '@chatdom/voxel/collision';
import { giftRouteOf } from '../../../web/src/kingdom/moments/anchors';
import type { RealmRoomEffects, RealmRoomServices, RealmSpawnPreparation } from '../ports';
import { referenceServices, REFERENCE_KINGDOM } from '../reference';
import { createRealmServer } from '../server';
import { BRAZIER_CELLS, TORCH_CELLS } from '../../../web/src/twitch-moments/raid-art';
import { CELL } from '../../../web/src/twitch-moments/banner';
import { RAID_CHAT_GATE_LAYOUT, RAID_GATE_LAYOUT, RAID_TORCH_LAYOUT } from '../../../web/src/twitch-moments/raid-view';
import { createRaidGuestSpawn, incomingRaidGateOf, incomingRaidRouteOf, raidColumnDistance, raidGateFurnitureOf, raidGuestSpawnAnchors, RAID_COLUMN_CLEARANCE, RAID_GATE_FURNITURE } from './guest-spawn';
import type { RaidGuestAuthority } from './guests';

const plan = generateSettlementPlan({ seed: 'raid-spawn-geometry', tier: 'hamlet', firstYear: 2025, year: 2026 });
const terrain = () => {
  const gate = incomingRaidGateOf(plan)!, x = Math.floor(gate[0] * 2) / 2 - 8, z = Math.floor(gate[2] * 2) / 2 - 8;
  // Compile the actual half-metre terrain around the gate; sampling the entire kingdom is unrelated to this test.
  const heights = Float32Array.from({ length: 32 * 32 }, (_, i) => foundedGroundAt(plan, x + (i % 32 + .5) * .5, z + (Math.floor(i / 32) + .5) * .5)[1]);
  return compileCollisionWorld({ revision: 1, materials: { materials: [{ id: 0, solid: false }] }, assets: [], placements: [],
    terrain: { origin: [x, -16, z], columns: 32, rows: 32, heights, ceilingY: 496 } });
};
const overlaps = (a: SolidBox, b: SolidBox) => a.min.every((value, axis) => value < b.max[axis]! && a.max[axis]! > b.min[axis]!);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const principal: RealmPrincipal = { personId: PersonIdSchema.parse('990700001'), kingdomId: KingdomIdSchema.parse('990700002'),
  sessionId: randomUUID(), expiresAt: Date.now() + 86_400_000, origin: 'simulated', publicName: 'Ash', look: 'reference' };

describe('incoming guest geometry and read-only preparation', () => {
  it.each(['hamlet', 'town'] as const)('selects the actual web caravan gate for %s plans', tier => {
    for (const seed of ['raid-gate-a', 'raid-gate-b', 'raid-gate-c']) {
      const layout = generateSettlementPlan({ seed, tier, firstYear: 2025, year: 2026 });
      expect(incomingRaidGateOf(layout)).toEqual(giftRouteOf(layout)?.inbound[0] ?? null);
      expect(incomingRaidGateOf(layout)).not.toEqual(layout.nodes.find(node => node.id === layout.castle.gateNodeId)!.position);
    }
    expect(incomingRaidGateOf({ ...plan, activeStreetIds: [] })).toBeNull();
  });

  it('finds finite supported, separate positions within six metres of the exact gate on the actual terrain', () => {
    const world = terrain(), gate = incomingRaidGateOf(plan)!;
    const anchors = raidGuestSpawnAnchors(plan, world);
    expect(anchors.length).toBeGreaterThan(1); expect(anchors.length).toBeLessThanOrEqual(128);
    for (const [i, point] of anchors.entries()) {
      expect(point.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(point[0] - gate[0], point[2] - gate[2])).toBeLessThanOrEqual(6.000_001);
      const body = { x: point[0], y: point[1], z: point[2] };
      expect(embeddedSolids(body, world)).toEqual([]); expect(supported(body, world)).toBe(true);
      expect(anchors.slice(0, i).every(other => Math.abs(other[0] - point[0]) >= WALK_BODY.radius * 2 + .05
        || Math.abs(other[2] - point[2]) >= WALK_BODY.radius * 2 + .05 || Math.abs(other[1] - point[1]) >= WALK_BODY.height)).toBe(true);
    }
  });

  it('follows the web caravan road and seats guests beside it inside the gate, never in the column first', () => {
    for (const seed of ['raid-gate-a', 'raid-gate-b', 'raid-spawn-geometry']) {
      const layout = generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
      expect(incomingRaidRouteOf(layout)).toEqual(giftRouteOf(layout)?.inbound ?? null);
    }
    const world = terrain(), route = incomingRaidRouteOf(plan)!, gate = route[0]!;
    const anchors = raidGuestSpawnAnchors(plan, world), furniture = raidGateFurnitureOf(route);
    const blocked = anchors.map(point => raidColumnDistance(route, point[0], point[2]) < RAID_COLUMN_CLEARANCE
      || furniture.some(piece => Math.hypot(point[0] - piece.x, point[2] - piece.z) < piece.radius + WALK_BODY.radius + .1));
    const firstInPath = blocked.indexOf(true);
    // Several guests fit beside the road before anyone would be placed in the caravan's way or the gate's furniture.
    expect(firstInPath === -1 ? anchors.length : firstInPath).toBeGreaterThanOrEqual(4);
    if (firstInPath >= 0) expect(blocked.slice(firstInPath).every(Boolean)).toBe(true);
    // The first guest stands on the town side of the gate, where the column comes towards them.
    const inward = route.find(point => Math.hypot(point[0] - gate[0], point[2] - gate[2]) > .05)!;
    const first = anchors[0]!;
    expect((first[0] - gate[0]) * (inward[0] - gate[0]) + (first[2] - gate[2]) * (inward[2] - gate[2])).toBeGreaterThan(0);
    // The swept column covers the straight approach outside the gate as well as the road in.
    const outward = [gate[0] - (inward[0] - gate[0]), gate[2] - (inward[2] - gate[2])] as const;
    expect(raidColumnDistance(route, outward[0], outward[1])).toBeLessThan(.01);
  });

  it('keeps guests out of the raid layer\'s braziers, standard, torches and lantern stands, with the layer\'s own numbers', () => {
    const F = RAID_GATE_FURNITURE;
    expect(F.gate).toEqual(RAID_GATE_LAYOUT);
    expect(F.torches).toMatchObject({ start: RAID_TORCH_LAYOUT.start, spacing: RAID_TORCH_LAYOUT.spacing, aside: RAID_TORCH_LAYOUT.aside, notBefore: RAID_GATE_LAYOUT.brazierIn + 1 });
    expect(F.chat).toMatchObject({ aside: RAID_CHAT_GATE_LAYOUT.aside, spacing: RAID_CHAT_GATE_LAYOUT.spacing, start: RAID_CHAT_GATE_LAYOUT.start, slots: RAID_CHAT_GATE_LAYOUT.slots });
    expect(F.brazier).toBeGreaterThanOrEqual(Math.max(BRAZIER_CELLS.size[0], BRAZIER_CELLS.size[2]) * CELL / 2);
    expect(F.torches.post).toBeGreaterThanOrEqual(Math.max(TORCH_CELLS.size[0], TORCH_CELLS.size[2]) * CELL / 2);
    for (const seed of ['raid-gate-a', 'raid-gate-b', 'raid-spawn-geometry', 'SIMULATED-tobi4s-incoming-show']) {
      const layout = generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
      const route = incomingRaidRouteOf(layout)!, gate = route[0]!, inward = route.find(point => Math.hypot(point[0] - gate[0], point[2] - gate[2]) > .05)!;
      const length = Math.hypot(inward[0] - gate[0], inward[2] - gate[2]), fx = (inward[0] - gate[0]) / length, fz = (inward[2] - gate[2]) / length;
      const braziers = [-1, 1].map(sign => [gate[0] + fx * F.gate.brazierIn + fz * F.gate.brazierAside * sign, gate[2] + fz * F.gate.brazierIn - fx * F.gate.brazierAside * sign] as const);
      const furniture = raidGateFurnitureOf(route);
      for (const [x, z] of braziers) expect(furniture.some(piece => Math.hypot(piece.x - x, piece.z - z) < 1e-9 && piece.radius === F.brazier)).toBe(true);
      // The first guests (the room seats them in order) stand clear of both fires, on real ground beside the road.
      const gx = Math.floor(gate[0] * 2) / 2 - 8, gz = Math.floor(gate[2] * 2) / 2 - 8;
      const heights = Float32Array.from({ length: 32 * 32 }, (_, i) => foundedGroundAt(layout, gx + (i % 32 + .5) * .5, gz + (Math.floor(i / 32) + .5) * .5)[1]);
      const world = compileCollisionWorld({ revision: 1, materials: { materials: [{ id: 0, solid: false }] }, assets: [], placements: [],
        terrain: { origin: [gx, -16, gz], columns: 32, rows: 32, heights, ceilingY: 496 } });
      for (const point of raidGuestSpawnAnchors(layout, world).slice(0, 4)) {
        for (const [x, z] of braziers) expect(Math.hypot(point[0] - x, point[2] - z)).toBeGreaterThanOrEqual(F.brazier + WALK_BODY.radius);
        expect(furniture.every(piece => Math.hypot(point[0] - piece.x, point[2] - piece.z) >= piece.radius + WALK_BODY.radius)).toBe(true);
      }
    }
  });

  it('refuses absent ground, a blocked gate and isolated support with no clear egress', () => {
    expect(raidGuestSpawnAnchors(plan, { revision: 2, query: () => [] })).toEqual([]);
    const solid: SolidBox = { min: [-1_000, -100, -1_000], max: [1_000, 100, 1_000] };
    expect(raidGuestSpawnAnchors(plan, { revision: 3, query: () => [solid] })).toEqual([]);
    const gate = incomingRaidGateOf(plan)!, ground = foundedGroundAt(plan, gate[0], gate[2]);
    const island: SolidBox = { min: [gate[0] - .32, ground[1] - .5, gate[2] - .32], max: [gate[0] + .32, ground[1], gate[2] + .32] };
    expect(raidGuestSpawnAnchors(plan, { revision: 4, query: bounds => overlaps(bounds, island) ? [island] : [] })).toEqual([]);
  });

  it('preserves ordinary entry; caches only geometry, rechecks each pending entry, and fences a changed authority', async () => {
    let time = Date.now(), world = terrain(), current = true;
    const pendingEntry = vi.fn<RaidGuestAuthority['pendingEntry']>(async () =>
      ({ status: 'pending', raidId: `raid.${'a'.repeat(64)}`, expiresAt: time + 600_000 }));
    const currentWorld = () => current ? { world, plan, layoutRevision: plan.revision, writerEpoch: 'epoch' } : undefined;
    const prepare = createRaidGuestSpawn({ authority: { pendingEntry }, current: currentWorld, clock: () => time });
    const first = await prepare(principal, currentWorld()!);
    const second = await prepare({ ...principal, sessionId: randomUUID() }, currentWorld()!);
    expect(first!.positions).toBe(second!.positions); expect(pendingEntry).toHaveBeenCalledTimes(2);
    expect(pendingEntry.mock.calls[0]).toEqual([{ version: 1, origin: principal.origin, entryId: principal.sessionId,
      personId: principal.personId, kingdomId: principal.kingdomId, at: time }]);
    expect(first!.current()).toBe(true);
    world = { revision: 2, query: world.query.bind(world) };
    expect(first!.current()).toBe(false);
    const revised = await prepare(principal, currentWorld()!);
    expect(revised!.positions).not.toBe(first!.positions);
    time = revised!.expiresAt; expect(revised!.current()).toBe(false);
    current = false;
    await expect(prepare(principal, { world, layoutRevision: plan.revision, writerEpoch: 'epoch' })).rejects.toThrow('changed');
    for (const reason of ['citizen_here', 'no_intent'] as const) {
      const ordinary = createRaidGuestSpawn({ authority: { pendingEntry: async () => ({ status: 'refused', reason }) }, current: () => { throw new Error('Ordinary entry must not read gate geometry'); } });
      expect(await ordinary(principal, { world, layoutRevision: plan.revision, writerEpoch: 'epoch' })).toBeNull();
    }
    const expired = createRaidGuestSpawn({ authority: { pendingEntry: async () => ({ status: 'refused', reason: 'expired' }) }, current: currentWorld });
    await expect(expired(principal, { world, layoutRevision: plan.revision, writerEpoch: 'epoch' })).rejects.toThrow('invitation');
  });
});

async function freePort(): Promise<number> {
  for (let port = 5186; port >= 5170; port--) {
    const probe = createPortProbe();
    const available = await new Promise<boolean>((resolve, reject) => {
      probe.once('error', (error: NodeJS.ErrnoException) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      probe.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (available) { await new Promise<void>(resolve => probe.close(() => resolve())); return port; }
  }
  throw new Error('No free raid-show test port in 5170–5186');
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 5_000;
  while (!predicate()) { if (Date.now() > end) throw new Error('Room state did not arrive'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

it('seats concurrent guests without overlap; retains a moving seat and refuses stale, revoked, unavailable or unsafe preparations before join', async () => {
  const base = referenceServices(), clients: Room<KingdomRoomState>[] = [], sessions = new Map<string, RealmPrincipal>();
  const principals = new Map<string, RealmPrincipal>(), joined = new Map<string, RealmPrincipal>();
  let effects!: RealmRoomEffects, ordinarySpawns = 0, joins = 0, world: CollisionWorld = REFERENCE_WORLD, layoutRevision = 'reference-court-v1';
  let prepare: NonNullable<RealmRoomServices['prepareSpawn']> = async () => null;
  const candidates: readonly Vec3[] = [[-4, 0, 7], [-3.25, 0, 7]];
  const prepared = (): RealmSpawnPreparation => ({ positions: candidates, expiresAt: Date.now() + 600_000, current: () => true });
  const issue = (personId?: RealmPrincipal['personId']) => {
    const ticket = randomUUID(), auth: RealmPrincipal = { ...principal, kingdomId: REFERENCE_KINGDOM,
      personId: personId ?? PersonIdSchema.parse(String(990800000 + sessions.size)), sessionId: randomUUID() };
    principals.set(ticket, auth); sessions.set(auth.sessionId, auth);
    return { kingdomId: REFERENCE_KINGDOM, ticket, protocol: 1 };
  };
  const services: RealmRoomServices = {
    auth: { authenticate: async entry => { const auth = principals.get(entry.ticket); if (!auth) throw new Error('Used ticket'); principals.delete(entry.ticket); return auth; },
      current: async auth => sessions.has(auth.sessionId) },
    prepareSpawn: (auth, context) => prepare(auth, context),
    async open(id) {
      const handle = await base.open(id);
      return { ...handle, get world() { return world; }, get layoutRevision() { return layoutRevision; },
        spawn: () => { ordinarySpawns++; return [4, 0, 7] as const; },
        bindRoom: room => { effects = room; return handle.bindRoom(room); },
        lifecycle: (event, auth, walker) => { if (event === 'join') { joins++; joined.set(walker, auth); } if (event === 'leave') joined.delete(walker); } };
    },
  };
  const { server } = createRealmServer(services), port = await freePort();
  await server.listen(port, '127.0.0.1');
  const client = new Client(`http://127.0.0.1:${port}`);
  const enter = async (ticket = issue()) => { const room = await client.joinOrCreate<KingdomRoomState>('kingdom', ticket, KingdomRoomState); clients.push(room); await until(() => !!room.state.walkers.get(room.sessionId)); return room; };
  try {
    await enter(); expect(ordinarySpawns).toBe(1);
    const gate = deferred<void>(), asked = deferred<void>(); let waiting = 0;
    prepare = async () => { if (++waiting === 2) asked.resolve(); await gate.promise; return prepared(); };
    const both = Promise.all([enter(), enter()]); await asked.promise; gate.resolve();
    const guests = await both;
    expect(guests.map(room => effects.readWalker(room.sessionId)!.x).sort((a, b) => a - b)).toEqual([-4, -3.25]);
    expect(joins).toBe(3); expect(ordinarySpawns).toBe(1);
    prepare = async () => prepared();
    await expect(enter()).rejects.toThrow('safe arrival'); expect(joins).toBe(3);

    // Replacement tab must preserve the actual supported pose and not even ask an expired invitation to spawn.
    const first = guests[0]!, person = joined.get(first.sessionId)!.personId;
    expect(effects.placeWalker(first.sessionId, [0, 0, 7], world.revision)).toBe(true);
    prepare = async () => { throw new Error('Expired invitation must not relocate a resumed person'); };
    const replacement = await enter(issue(person));
    expect(effects.readWalker(replacement.sessionId)).toMatchObject({ x: 0, y: 0, z: 7 }); expect(ordinarySpawns).toBe(1);

    // Hold preparation, then alter authority/session/world while it is suspended. No post-seat lifecycle may fire.
    const joinsBeforeFailures = joins;
    for (const reason of ['revision', 'revocation', 'authority', 'late-authority', 'empty', 'nonfinite', 'unsupported', 'expired'] as const) {
      const ready = deferred<RealmPrincipal>(), release = deferred<void>();
      let authority = true, checks = 0;
      prepare = async auth => { ready.resolve(auth); await release.promise; return { ...prepared(),
        positions: reason === 'empty' ? [] : reason === 'nonfinite' ? [[NaN, 0, 7]] : reason === 'unsupported' ? [[0, 20, 7]] : [[1, 0, 7]],
        expiresAt: reason === 'expired' ? Date.now() - 1 : Date.now() + 600_000,
        current: () => authority && (reason !== 'late-authority' || ++checks === 1) }; };
      const answer = enter().then(() => ({ accepted: true }), () => ({ accepted: false }));
      const auth = await ready.promise;
      if (reason === 'revision') {
        world = { revision: world.revision + 1, query: world.query.bind(world) }; layoutRevision = 'revised-court';
        const positions = new Map<string, Vec3>();
        for (const id of joined.keys()) { const p = effects.readWalker(id); if (p) positions.set(id, [p.x, p.y, p.z]); }
        effects.adoptWorld(world, layoutRevision, positions);
      }
      if (reason === 'revocation') sessions.delete(auth.sessionId);
      if (reason === 'authority') authority = false;
      release.resolve(); expect(await answer).toEqual({ accepted: false });
      expect(joins).toBe(joinsBeforeFailures); expect(ordinarySpawns).toBe(1);
    }
  } finally {
    await Promise.all(clients.map(room => room.leave().catch(() => {})));
    await server.gracefullyShutdown(false);
  }
}, 20_000);
