import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createNativeForgeHost } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import type { PlayerState, RealmOwnedHome, RealmPrincipal, RealmWriterLease } from '@chatdom/shared/realm';
import { generateSettlementPlan, transformCardinalPoint } from '@chatdom/world';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import { createRealmState } from '@chatdom/world/realm';
import { DurableKingdom, type DurableRepository } from '../persistence/kingdom';
import type { RealmOutboxStore } from '../outbox';
import { createFoundedWorldLoader } from './provider';
import { FileFoundedStore } from './store';

const deferred = () => {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
};

it('adopts committed home geometry only after public exposure, with fresh safe occupied poses and one writer (SIMULATED)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-adoption-'));
  let kingdom: DurableKingdom | undefined;
  const preparing = deferred(), prepared = deferred();
  try {
    const kingdomId = KingdomIdSchema.parse('900000001'), personId = PersonIdSchema.parse('900001111');
    const plan = generateSettlementPlan({ seed: 'SIMULATED-adoption', tier: 'hamlet', firstYear: 2026, year: 2026 });
    const plot = plan.homes[0]!, host = createNativeForgeHost(plot), blueprint = host.blueprint;
    const home: RealmOwnedHome = { id: plot.id, ownerId: personId, slot: plot.slot, layoutRevision: plan.revision,
      allocationReceipt: 'PRIVATE-SIMULATED-deed', revision: 'approved:1', digest: 'a'.repeat(64), family: plot.style,
      blueprint, attachments: {}, attribution: { makerName: 'SIMULATED', kingdomName: 'SIMULATED', approvalId: 'SIMULATED' } };
    const initial = { ...createRealmState(kingdomId, 'simulated'), sequence: 1, homes: { [plot.id]: home } };
    // An accepted build closes the old interior. Its bystander must move to supported, clear ground.
    const edited: RealmOwnedHome = { ...home, revision: 'approved:2', digest: 'b'.repeat(64), blueprint: { ...blueprint,
      boxes: [...blueprint.boxes, { from: [0, 0, 0], to: [...blueprint.size], material: 1 }] } };
    const next = { ...initial, sequence: 2, homes: { [plot.id]: edited } };
    const store = new FileFoundedStore(directory), put = store.put.bind(store);
    const loader = createFoundedWorldLoader({ origin: 'simulated', currentLayout: async () => ({ revision: plan.revision, foundedAt: 1, adoptedAt: 1 }), layoutPlan: async () => plan }, store);
    await loader.prepare(kingdomId);
    let writes = 0;
    store.put = async (bytes, manifest) => { if (++writes === 2) { preparing.resolve(); await prepared.promise; } await put(bytes, manifest); };
    let acquires = 0, committed = initial, publicReady = false;
    const lease: RealmWriterLease = { kingdomId, epoch: 'SIMULATED-one-writer', expiresAt: Date.now() + 60_000 };
    const repository: DurableRepository = { leaseMs: 60_000, acquire: async () => { acquires++; return lease; },
      renew: async () => ({ ...lease, expiresAt: Date.now() + 60_000 }), load: async () => committed, committedState: () => committed,
      execute: async () => { committed = next; return { status: 'committed', sequence: 2, at: Date.now() }; },
      lookup: async () => null, loadIngress: async () => null, executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }),
      snapshot: async () => committed.sequence, release: async () => {} };
    const publicHome = (h: RealmOwnedHome) => ({ type: 'home' as const, plotId: h.id, revision: h.revision, assetHash: h.digest, attachments: [] });
    const outbox: RealmOutboxStore = { open: async () => 1, prefix: async () => ({ homes: [publicHome(home)], presence: null, sequence: 1, committed: 1 }),
      read: async (_id, after) => publicReady && after < 2 ? [{ id: 2, sequence: 2, eventId: 'SIMULATED-home-edit', plotId: plot.id, message: publicHome(edited) }] : [],
      acknowledge: async () => {} };
    kingdom = await DurableKingdom.open(repository, outbox, kingdomId, state => loader.options(kingdomId, state));
    const first = loader.current(kingdomId)!, oldWorld = kingdom.world;
    const pose = (p: Vec3): PlayerState => ({ x: p[0], y: p[1], z: p[2], vx: 0, vy: 0, vz: 0, yaw: 0, grounded: true, distance: 0, collisionRevision: oldWorld.revision });
    let interior: Vec3 | undefined;
    const width = blueprint.size[0] * VOXEL_METRES.build, depth = blueprint.size[2] * VOXEL_METRES.build;
    for (let x = .5; x < width - .5 && !interior; x += .5) for (let z = .5; z < depth - .5 && !interior; z += .5) for (let y = 0; y <= .5; y += .125) {
      const p = transformCardinalPoint(host.position, plot.rotation, [x, y, z]), body = pose(p);
      if (!embeddedSolids(body, oldWorld).length && supported(body, oldWorld)) { interior = p; break; }
    }
    expect(interior, 'reviewed home has a usable interior').toBeDefined();
    const walkers = new Map<string, PlayerState>([['bystander', pose(first.anchors[0]!)], ['peer', pose(first.anchors[15]!)]]);
    const principal: RealmPrincipal = { kingdomId, personId, origin: 'simulated', sessionId: 'SIMULATED-session', expiresAt: Date.now() + 60_000, publicName: 'SIMULATED', look: 'hearth' };
    let adoptions = 0;
    kingdom.bindRoom({ close: () => {}, allowWalking: () => {}, placeWalker: () => false, readWalker: id => walkers.get(id) ?? null,
      adoptWorld: (world, _layout, positions) => {
        expect(kingdom!.publicCheckpoint().current).toEqual([publicHome(edited)]);
        expect(positions.size).toBe(2);
        for (const [id, p] of positions) {
          expect(embeddedSolids(pose(p), world)).toHaveLength(0); expect(supported(pose(p), world)).toBe(true);
          walkers.set(id, { ...pose(p), collisionRevision: world.revision });
        }
        adoptions++;
      } });
    for (const id of walkers.keys()) kingdom.lifecycle('join', principal, id, Date.now());
    const unsubscribe = kingdom.subscribe(() => {});
    const command = kingdom.execute('SIMULATED-edit', { type: 'stream.observe', sessionId: null, startedAt: 0, liveUntil: 0 }, 'presence');
    await preparing.promise;
    expect(kingdom.world).toBe(oldWorld); expect(loader.current(kingdomId)).toBe(first);
    // Movement continues while bytes are prepared; final adoption must inspect this fresh occupied position.
    walkers.set('bystander', pose(interior!));
    prepared.resolve(); await command;
    expect(adoptions).toBe(0); expect(loader.current(kingdomId)).toBe(first);
    publicReady = true;
    const checkpoint = await kingdom.preparePublicCheckpoint(), current = loader.current(kingdomId)!;
    expect(acquires).toBe(1); expect(adoptions).toBe(1);
    expect(kingdom.world).toBe(current.world); expect(current.world.revision).not.toBe(oldWorld.revision);
    expect(current.manifestFor(checkpoint)).toEqual(current.build.manifest);
    expect([walkers.get('bystander')!.x, walkers.get('bystander')!.y, walkers.get('bystander')!.z]).not.toEqual(interior);
    expect([walkers.get('peer')!.x, walkers.get('peer')!.y, walkers.get('peer')!.z]).toEqual(first.anchors[15]);
    expect(await store.get(first.build.manifest.sceneHash)).toEqual(first.build.bytes);
    unsubscribe();
  } finally { prepared.resolve(); await kingdom?.dispose(); await rm(directory, { recursive: true, force: true }); }
}, 30_000);
