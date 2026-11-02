import { Client, type Room } from '@colyseus/sdk';
import { randomUUID } from 'node:crypto';
import { KingdomIdSchema, TavernRoomState, type GrowthPrivateState } from '@chatdom/shared';
import { KingdomRoomState, type RealmJoin, type RealmPrincipal } from '@chatdom/shared/realm';
import { generateSettlementPlan, type RealmFoundedScene } from '@chatdom/world';
import { createGrowthState } from '@chatdom/world/growth';
import { createRealmState } from '@chatdom/world/realm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createNativeTown } from '../founded/native';
import { assembleFoundedScene } from '../founded/scene';
import { compileFoundedScene } from '../founded/collision';
import { foundedSpawnAnchors } from '../founded/anchors';
import { createRealmServer } from '../server';
import { REFERENCE_KINGDOM, referenceServices } from '../reference';
import { tavernPortalFor } from './portal';
import { createTavernInterior } from './interior';
import { createTavernReturns, installTavernReturns, RETURN_WINDOW_MS } from './return';
import { listenForTest } from './test-socket';

const growthAt = (kingdomId: ReturnType<typeof KingdomIdSchema.parse>): GrowthPrivateState => {
  const growth = createGrowthState(kingdomId, 'simulated');
  return { ...growth, civic: { ...growth.civic, levels: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 } } };
};
async function hamlet(kingdomId: ReturnType<typeof KingdomIdSchema.parse>, seed: string): Promise<RealmFoundedScene> {
  const plan = generateSettlementPlan({ seed, tier: 'hamlet', firstYear: 2025, year: 2026 });
  const { scene } = await assembleFoundedScene({ kingdomId, plan, native: createNativeTown(plan),
    state: { ...createRealmState(kingdomId, 'simulated'), growth: growthAt(kingdomId) }, collisionRevision: 7 });
  return scene;
}

describe('coming back out of the tavern', () => {
  const kingdomId = KingdomIdSchema.parse('900000041');
  let scene: RealmFoundedScene;
  beforeAll(async () => { scene = await hamlet(kingdomId, 'tobi4s_'); }, 120_000);

  it('stands only the person who just left outside the street door, once, within the window', () => {
    const world = compileFoundedScene(scene), portal = tavernPortalFor(kingdomId, scene, world)!;
    const returns = createTavernReturns(id => id === kingdomId ? scene : undefined), now = 1_800_000_000_000;
    expect(returns.arrival(kingdomId, 'person-a', world, now)).toBeNull();
    returns.left(kingdomId, 'person-a', now);
    // Someone else, or the same person in another kingdom, did not come out of this tavern.
    expect(returns.arrival(kingdomId, 'person-b', world, now + 10)).toBeNull();
    expect(returns.arrival(KingdomIdSchema.parse('900000042'), 'person-a', world, now + 10)).toBeNull();
    expect(returns.arrival(kingdomId, 'person-a', world, now + 500)).toEqual(portal.returnAnchor);
    // Consumed by that arrival: the next one is at the usual gate.
    expect(returns.arrival(kingdomId, 'person-a', world, now + 600)).toBeNull();
    returns.left(kingdomId, 'person-a', now);
    expect(returns.arrival(kingdomId, 'person-a', world, now + RETURN_WINDOW_MS + 1)).toBeNull();
    // A kingdom whose scene is unknown (the reference realm) never moves anyone.
    const blind = createTavernReturns(() => undefined);
    blind.left(kingdomId, 'person-a', now);
    expect(blind.arrival(kingdomId, 'person-a', world, now + 10)).toBeNull();
  }, 60_000);

  it('falls back to the gate when the current collision offers no door or no safe step', () => {
    const returns = createTavernReturns(() => scene), other = createTavernInterior().world;
    // A world the scene was not compiled into (here the tavern's own interior): no derivable street door, no move.
    returns.left(kingdomId, 'p', 1);
    expect(returns.arrival(kingdomId, 'p', other, 2)).toBeNull();
    // Facing out at every exterior turn is proven against the authored form in packages/content/src/tavern/portal.test.ts.
  }, 60_000);
});

/** A join request as the client sends it; the realm checks the kingdom itself. */
type Ticket = { readonly ticket: string; readonly kingdomId: string; readonly protocol: 1 };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (predicate: () => boolean, what: string, timeout = 8_000) => {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new Error(`Timed out: ${what}`); await pause(25); }
};
it('returns the traveller to the street door facing out through the real rooms; everyone else arrives at the gate', async () => {
  const scene = await hamlet(REFERENCE_KINGDOM, 'tobi4s_'), world = compileFoundedScene(scene);
  const portal = tavernPortalFor(REFERENCE_KINGDOM, scene, world)!, anchors = foundedSpawnAnchors(scene.plan, world);
  const base = referenceServices(), fresh = new Map<string, RealmPrincipal>(), principals = new Map<string, RealmPrincipal>();
  let arrivals = 0;
  const services = { ...base,
    auth: { ...base.auth, async authenticate(join: RealmJoin) {
      const carried = fresh.get(join.ticket);
      if (carried) { fresh.delete(join.ticket); return carried; }
      const principal = await base.auth.authenticate(join); principals.set(join.ticket, principal); return principal;
    } },
    // The kingdom room on the founded hamlet's own collision; its usual gate is the founded market anchors.
    open: async (kingdom: Parameters<typeof base.open>[0]) => {
      const handle = await base.open(kingdom);
      return { ...handle, world, layoutRevision: scene.layoutRevision, spawn: () => anchors[arrivals++ % anchors.length]!,
        bootstrap: (principal: RealmPrincipal) => ({ ...handle.bootstrap(principal), layoutRevision: scene.layoutRevision, collisionRevision: world.revision }) };
    } };
  installTavernReturns(services, kingdom => kingdom === REFERENCE_KINGDOM ? scene : undefined);
  const again = (principal: RealmPrincipal): Ticket => { const ticket = randomUUID(); fresh.set(ticket, principal); return { ticket, kingdomId: REFERENCE_KINGDOM, protocol: 1 }; };
  const created = createRealmServer(services), rooms: Room[] = [];
  const url = await listenForTest(created);
  try {
    const client = new Client(url);
    const quiet = <R extends Room>(room: R) => { room.reconnection.enabled = false; room.onMessage('*', () => {}); rooms.push(room); return room; };
    const kingdom = async (join: Ticket) => quiet(await client.joinOrCreate<InstanceType<typeof KingdomRoomState>>('kingdom', join, KingdomRoomState));
    const tavern = async (join: Ticket) => quiet(await client.joinOrCreate<InstanceType<typeof TavernRoomState>>('tavern', join, TavernRoomState));

    const watcherTicket = base.issue(), watcher = await kingdom(watcherTicket);
    const firstTicket = base.issue(), outside = await kingdom(firstTicket), traveller = principals.get(firstTicket.ticket)!;
    await waitFor(() => watcher.state.walkers.size === 2, 'two people on the square');
    const gate = watcher.state.walkers.get(outside.sessionId)!;
    expect(Math.hypot(gate.x - portal.returnAnchor.feet[0], gate.z - portal.returnAnchor.feet[2])).toBeGreaterThan(1);

    // In: the square lets go first, the tavern takes the same person with a fresh ticket.
    await outside.leave();
    await waitFor(() => watcher.state.walkers.size === 1, 'the traveller left the square');
    const inside = await tavern(again(traveller));
    await waitFor(() => inside.state.walkers.has(inside.sessionId), 'the traveller inside');
    // Out: the tavern lets go, then the square takes them back outside its street door, facing out, once.
    await inside.leave();
    await pause(50);
    const back = await kingdom(again(traveller));
    await waitFor(() => watcher.state.walkers.has(back.sessionId), 'the traveller back on the square');
    const returned = watcher.state.walkers.get(back.sessionId)!;
    expect([returned.x, returned.y, returned.z]).toEqual([...portal.returnAnchor.feet]);
    expect(returned.yaw).toBe(portal.returnAnchor.yaw);
    expect([...watcher.state.walkers.values()].filter(w => w.name === traveller.publicName)).toHaveLength(1);

    // The record was spent by that arrival: leaving the square and coming back is the usual gate again.
    await back.leave();
    await waitFor(() => watcher.state.walkers.size === 1, 'the traveller left again');
    const later = await kingdom(again(traveller));
    await waitFor(() => watcher.state.walkers.has(later.sessionId), 'the traveller at the gate');
    const atGate = watcher.state.walkers.get(later.sessionId)!;
    expect(Math.hypot(atGate.x - portal.returnAnchor.feet[0], atGate.z - portal.returnAnchor.feet[2])).toBeGreaterThan(1);
    // Someone who was never inside arrives at the gate too.
    const strangerTicket = base.issue(), stranger = await kingdom(strangerTicket);
    await waitFor(() => watcher.state.walkers.has(stranger.sessionId), 'a stranger on the square');
    const s = watcher.state.walkers.get(stranger.sessionId)!;
    expect(Math.hypot(s.x - portal.returnAnchor.feet[0], s.z - portal.returnAnchor.feet[2])).toBeGreaterThan(1);
  } finally {
    await Promise.all(rooms.map(room => room.leave().catch(() => {})));
    await created.server.gracefullyShutdown(false);
  }
}, 120_000);
