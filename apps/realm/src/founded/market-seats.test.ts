import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MARKET_SEAT_LOG_GROUND, STYLES } from '@chatdom/content';
import { PersonIdSchema, VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import type { PlayerState, RealmPrincipal } from '@chatdom/shared/realm';
import { transformCardinalPoint, type RealmFoundedScene } from '@chatdom/world';
import { createFoundedInteractionRegistry, interactionTargetId, standingClear, withinReach } from '@chatdom/world/interactions';
import { compileFoundedScene } from './collision';
import { assetHashOf } from './codec';
import { enrichNativeMarket } from './market-furnishings';
import { enrichNativeMarketSeats } from './market-seats';
import type { NativeHome, NativePiece, NativeTown } from './native';
import { createInteractionAuthority } from '../interactions';

// Fixed, committed SIMULATED adopted town. Tests never regenerate its plan or native geometry.
async function fixture() {
  const scene = JSON.parse(await readFile(new URL('./artifacts/simulated-town.scene.json', import.meta.url), 'utf8')) as RealmFoundedScene;
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const homes = new Map<string, NativeHome>(), fixtures: NativePiece[] = [];
  for (const placement of scene.placements) {
    const piece: NativePiece = { id: placement.id, blueprint: assets.get(placement.assetHash)!, position: placement.position, rotation: placement.rotation };
    if (placement.plotId) homes.set(placement.plotId, { ...piece, plot: scene.plan.homes.find(plot => plot.id === placement.plotId)! });
    else fixtures.push(piece);
  }
  return { scene, native: { revision: scene.plan.revision, homes, fixtures } satisfies NativeTown };
}
async function install(scene: RealmFoundedScene, pieces: readonly NativePiece[]): Promise<RealmFoundedScene> {
  const additions = await Promise.all(pieces.map(async piece => ({ ...piece, assetHash: await assetHashOf(piece.blueprint) })));
  return { ...scene, assets: [...scene.assets, ...additions.map(piece => ({ assetHash: piece.assetHash, blueprint: piece.blueprint }))],
    placements: [...scene.placements, ...additions.map(({ id, assetHash, position, rotation }) => ({ id, assetHash, position, rotation }))] };
}

describe('installed adopted market log seats', () => {
  it('adds one grounded log, preserves every existing object, and enables only its two supported authored contacts', async () => {
    const { scene, native } = await fixture(), plan = scene.plan;
    const furnished = enrichNativeMarket(plan, native), before = JSON.stringify([...furnished.homes.values(), ...furnished.fixtures]);
    const enriched = enrichNativeMarketSeats(plan, furnished), added = enriched.fixtures.slice(furnished.fixtures.length);
    expect(added).toHaveLength(1);
    expect(enriched.homes).toBe(furnished.homes); expect(enriched.revision).toBe(furnished.revision);
    furnished.fixtures.forEach((piece, index) => expect(enriched.fixtures[index]).toBe(piece));
    expect(JSON.stringify([...furnished.homes.values(), ...furnished.fixtures])).toBe(before);
    expect(enrichNativeMarketSeats(plan, enriched)).toBe(enriched);
    expect(enrichNativeMarketSeats(plan, furnished)).toEqual(enriched);
    const bench = added[0]!;
    expect(bench.id).toBe('market:rest:v1:0'); expect(bench.blueprint.id).toBe('civic-market-seat-log-v1');
    const scaled = (point: Vec3): Vec3 => [point[0] * VOXEL_METRES.build, point[1] * VOXEL_METRES.build, point[2] * VOXEL_METRES.build];
    expect(transformCardinalPoint(bench.position, bench.rotation, scaled(MARKET_SEAT_LOG_GROUND))[1]).toBe(plan.market.elevation);
    const installed = await install(scene, enriched.fixtures.slice(native.fixtures.length)), world = compileFoundedScene(installed);
    const registry = createFoundedInteractionRegistry(installed, world), seats = registry.records.filter(record => record.target.kind === 'bench-seat');
    expect(seats).toHaveLength(2); expect(registry.disabled.filter(record => record.source === bench.id)).toEqual([]);
    for (const seat of bench.blueprint.seats!) {
      const record = registry.get(interactionTargetId.benchSeat(bench.id, seat.id))!;
      expect(record.source).toBe(bench.id);
      expect(record.target.position).toEqual(transformCardinalPoint(bench.position, bench.rotation, scaled(seat.position)));
      expect(record.target.approach).toEqual(transformCardinalPoint(bench.position, bench.rotation, scaled(seat.approach)));
      expect(record.rest).toEqual(transformCardinalPoint(bench.position, bench.rotation, scaled(seat.rest)));
      expect(standingClear(world, record.target.approach)).toBe(true);
      expect(withinReach(world, record.target.approach, record.target)).toBe(true);
    }
    const target = seats[0]!.target, at = target.approach;
    const principal: RealmPrincipal = { kingdomId: scene.kingdomId, personId: PersonIdSchema.parse('900001111'), sessionId: 'SIMULATED-market-seat',
      publicName: 'SIMULATED bench visitor', look: 'default', origin: 'simulated', expiresAt: 100_000 };
    const walker: PlayerState = { x: at[0], y: at[1], z: at[2], vx: 0, vy: 0, vz: 0, grounded: true,
      yaw: 0, distance: 0, collisionRevision: world.revision };
    let walking = true;
    const authority = createInteractionAuthority({ writerEpoch: 'SIMULATED-market-seat', clock: () => 1_000, reconnectGraceMs: 20_000,
      world: () => world, registry: () => registry, rights: { current: async () => true, permitted: () => true }, homes: { ownedPlotId: () => null } });
    authority.bindRoom({ readWalker: () => walker, placeWalker: (_, position, revision) => {
      if (revision !== world.revision || !standingClear(world, position)) return false;
      [walker.x, walker.y, walker.z] = position; return true;
    }, allowWalking: (_, allowed) => { walking = allowed; } });
    authority.lifecycle('join', principal, principal.sessionId, 1_000);
    const context = () => ({ principal, walkerId: principal.sessionId, position: [walker.x, walker.y, walker.z] as Vec3,
      collisionRevision: world.revision, current: () => walker });
    expect(await authority.intent(context(), { version: 1, type: 'interact', id: 'SIMULATED-sit', targetId: target.id, action: 'sit' }))
      .toMatchObject({ status: 'applied', state: { mode: 'seated', targetId: target.id } });
    expect(walking).toBe(false); expect(authority.seats().seats).toHaveLength(1);
    expect(await authority.intent(context(), { version: 1, type: 'interact', id: 'SIMULATED-stand', targetId: target.id, action: 'stand' }))
      .toMatchObject({ status: 'applied', state: { mode: 'standing', targetId: null } });
    expect(walking).toBe(true); expect(authority.seats().seats).toEqual([]); authority.dispose();
    // Merely shipping a seat-bearing asset does not manufacture a place in the kingdom.
    const absent = { ...scene, assets: installed.assets };
    expect(createFoundedInteractionRegistry(absent, compileFoundedScene(absent)).records.filter(record => record.target.kind === 'bench-seat')).toEqual([]);
  }, 30_000);

  it('retains the exact town when the market is absent, unsupported or completely occupied', async () => {
    const { scene, native } = await fixture(), plan = scene.plan;
    const absent = { ...native, fixtures: native.fixtures.filter(piece => piece.id !== 'market:well') };
    expect(enrichNativeMarketSeats(plan, absent)).toBe(absent);
    expect(enrichNativeMarketSeats(plan, { ...native, revision: 'another-adoption' }).fixtures).toBe(native.fixtures);
    const blocked: NativeTown = { ...native, fixtures: [...native.fixtures, { id: 'SIMULATED-market-blocker', rotation: 0,
      position: [-16, plan.market.elevation, -16], blueprint: { version: 1, id: 'SIMULATED-market-blocker', kind: 'civic', styleId: STYLES.hearth.id, lattice: 'build',
        size: [256, 32, 256], boxes: [{ from: [0, 0, 0], to: [256, 32, 256], material: 1 }], windows: [] } }] };
    expect(enrichNativeMarketSeats(plan, blocked)).toBe(blocked);
  });
});
