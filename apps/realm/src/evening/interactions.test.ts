import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { PersonIdSchema, type Vec3 } from '@chatdom/shared';
import type { PlayerState, RealmFoundedManifest, RealmOwnedHome, RealmPrincipal, RealmPrivateMessage, RealmPrivateState, RealmTransientMessage } from '@chatdom/shared/realm';
import { createFoundedInteractionRegistry } from '@chatdom/world/interactions';
import { createRealmState } from '@chatdom/world/realm';
import { createFoundedWorld, decodeFoundedScene } from '../founded';
import { createDurableRealmServices, type DurableRepository } from '../persistence';
import type { RealmIntentContext } from '../ports';
import { attachEveningInteractions } from './interactions';

it('uses the retained writer, actual native targets, current pose, session rights and street deed (SIMULATED)', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../founded/artifacts/simulated-town.scene.json', import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL('../founded/artifacts/simulated-town.manifest.json', import.meta.url), 'utf8')) as RealmFoundedManifest;
  const scene = await decodeFoundedScene(bytes, manifest), founded = createFoundedWorld(scene);
  const registry = createFoundedInteractionRegistry(scene, founded.world), anvil = registry.records.find(record => record.target.kind === 'anvil')!;
  const door = registry.records.find(record => record.target.kind === 'home-door')!;
  expect(anvil, 'the actual native anvil has a safe approach').toBeDefined();
  expect(door, 'at least one actual native home has a safe doorway').toBeDefined();
  expect(registry.records.every(record => ['anvil', 'home-door', 'home-exit'].includes(record.target.kind))).toBe(true);
  const plot = scene.plan.homes.find(plot => plot.id === door.target.plotId)!;
  const placement = scene.placements.find(placement => placement.id === `home:${plot.id}`)!;
  const blueprint = scene.assets.find(asset => asset.assetHash === placement.assetHash)!.blueprint;
  const personId = PersonIdSchema.parse('900001111'), other = PersonIdSchema.parse('900001112');
  const home: RealmOwnedHome = { id: plot.id, ownerId: personId, slot: plot.slot, layoutRevision: scene.layoutRevision,
    allocationReceipt: 'PRIVATE-SIMULATED-deed', revision: 'SIMULATED-approved', digest: placement.assetHash,
    family: plot.style, blueprint, attachments: {}, attribution: { makerName: 'SIMULATED', kingdomName: 'SIMULATED', approvalId: 'SIMULATED' } };
  let state: RealmPrivateState = { ...createRealmState(scene.kingdomId, scene.origin), homes: { [home.id]: home } };
  const lease = { kingdomId: scene.kingdomId, epoch: 'SIMULATED-one-writer', expiresAt: Date.now() + 60_000 };
  const acquire = vi.fn(async () => lease), release = vi.fn(async () => {});
  const repository: DurableRepository = { leaseMs: 60_000, acquire, release,
    renew: async () => ({ ...lease, expiresAt: Date.now() + 60_000 }), load: async () => state, committedState: () => state,
    execute: async () => ({ status: 'unchanged', reason: 'SIMULATED-unused' }),
    lookup: async () => null, loadIngress: async () => null, executeIngress: async () => ({ status: 'unchanged', reason: 'SIMULATED-unused' }), snapshot: async () => 0 };
  let valid = true, gate: Promise<void> | null = null;
  const auth = { authenticate: vi.fn(), current: vi.fn(async () => { if (gate) await gate; return valid; }) };
  const services = createDurableRealmServices({ repository, auth, kingdom: () => founded.options,
    outbox: { open: async () => 0, prefix: async () => ({ homes: [], presence: null, sequence: 0, committed: 0 }), read: async () => [], acknowledge: async () => {} },
    attach: kingdom => attachEveningInteractions(kingdom, { auth, scene: () => scene }) });
  const hold = await services.retain(scene.kingdomId), room = await services.open(scene.kingdomId);
  const principal: RealmPrincipal = { kingdomId: scene.kingdomId, personId, origin: scene.origin, sessionId: 'SIMULATED-session',
    expiresAt: Date.now() + 60_000, publicName: 'SIMULATED', look: 'hearth' };
  let pose!: PlayerState;
  const move = (position: Vec3) => { pose = { x: position[0], y: position[1], z: position[2], vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: room.world.revision }; };
  move(anvil.target.approach);
  const placed = vi.fn((id: string, position: Vec3, revision: number) => {
    if (id !== principal.sessionId || revision !== room.world.revision) return false;
    move(position); return true;
  });
  const messages: RealmPrivateMessage[] = [], publicMessages: RealmTransientMessage[] = [];
  const detachRoom = room.bindRoom({ readWalker: id => id === principal.sessionId ? pose : null,
    placeWalker: placed, allowWalking: vi.fn(), close: vi.fn(), adoptWorld: vi.fn() });
  const detachDelivery = room.bindTransient(message => publicMessages.push(message), (owner, message) => { expect(owner).toBe(personId); messages.push(message); });
  room.lifecycle('join', principal, principal.sessionId, Date.now());
  let request = 0;
  const act = (targetId: string, action: 'forge' | 'enter-home' | 'exit-home', actor = principal) => {
    const context: RealmIntentContext = { principal: actor, walkerId: principal.sessionId,
      position: [pose.x, pose.y, pose.z], collisionRevision: pose.collisionRevision, current: () => pose };
    return room.intent(context, { version: 1, id: `SIMULATED-request-${++request}`, type: 'interact', targetId, action });
  };
  try {
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(await act(anvil.target.id, 'forge')).toMatchObject({ status: 'applied' });
    expect(placed).not.toHaveBeenCalled();
    let resume!: () => void;
    gate = new Promise<void>(resolve => { resume = resolve; });
    const pending = act(anvil.target.id, 'forge');
    move([anvil.target.approach[0] + 50, anvil.target.approach[1], anvil.target.approach[2]]);
    resume(); gate = null;
    expect(await pending).toMatchObject({ status: 'refused' });
    move(door.target.approach);
    expect(await act(door.target.id, 'enter-home', { ...principal, personId: other })).toMatchObject({ status: 'refused' });
    expect(placed).not.toHaveBeenCalled();
    expect(await act(door.target.id, 'enter-home')).toMatchObject({ status: 'applied', state: { mode: 'interior', plotId: plot.id } });
    expect(placed).toHaveBeenLastCalledWith(principal.sessionId, door.rest, room.world.revision);
    messages.length = 0; publicMessages.length = 0;
    room.bootstrap(principal);
    expect(messages).toContainEqual({ type: 'home.owned', plotId: plot.id });
    expect(messages).toContainEqual(expect.objectContaining({ type: 'interaction', requestId: null, state: expect.objectContaining({ mode: 'interior' }) }));
    expect(publicMessages).toContainEqual(expect.objectContaining({ type: 'seats', seats: [] }));
    const exit = registry.records.find(record => record.target.kind === 'home-exit' && record.target.plotId === plot.id)!;
    expect(await act(exit.target.id, 'exit-home')).toMatchObject({ status: 'applied', state: { mode: 'standing' } });
    valid = false;
    expect(await act(door.target.id, 'enter-home')).toMatchObject({ status: 'refused' });
    valid = true;
    state = { ...state, rights: { [personId]: { revision: 1, build: false, forge: false, blocked: true, safetyIdentifier: 'PRIVATE-SIMULATED' } } };
    await hold.kingdom.execute('SIMULATED-rights-refresh', { type: 'stream.observe', sessionId: null, startedAt: 0, liveUntil: 0 }, 'presence');
    expect(await act(door.target.id, 'enter-home')).toMatchObject({ status: 'refused' });
    expect(auth.current).toHaveBeenCalledWith(principal, expect.any(Number));
    expect(await room.intent({ principal, walkerId: principal.sessionId, position: [pose.x, pose.y, pose.z], collisionRevision: pose.collisionRevision, current: () => pose },
      { version: 1, id: 'SIMULATED-browser-wish', type: 'forge.wish', words: 'SIMULATED wish' })).toMatchObject({ status: 'unavailable' });
    room.lifecycle('drop', principal, principal.sessionId, Date.now());
    room.lifecycle('reconnect', principal, principal.sessionId, Date.now());
    room.lifecycle('leave', principal, principal.sessionId, Date.now());
    detachRoom(); detachDelivery();
    await room.dispose();
    expect(hold.kingdom.current).toBe(true);
    expect(release).not.toHaveBeenCalled();
  } finally { detachRoom(); detachDelivery(); await room.dispose(); await hold.release(); }
  expect(release).toHaveBeenCalledTimes(1);
  expect(hold.kingdom.current).toBe(false);
}, 30_000);
