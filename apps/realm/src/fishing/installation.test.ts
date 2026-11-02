import { beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, VOXEL_METRES } from '@chatdom/shared';
import { generateSettlementPlan, type RealmFoundedScene } from '@chatdom/world';
import { compileFoundedScene, foundedGroundAt } from '@chatdom/world/founded-collision';
import { embeddedSolids, supported } from '@chatdom/world/movement';
import { createRealmState } from '@chatdom/world/realm';
import { assetHashOf } from '../founded/codec';
import { assembleFoundedScene } from '../founded/scene';
import { createFishingInstallationReader, fishingInstallationFromScene } from './installation';
import { installPier, pierLocalToWorld, pierWaterAt } from './site';

let scene: RealmFoundedScene;
beforeAll(async () => {
  const kingdomId = KingdomIdSchema.parse('900000002');
  const plan = generateSettlementPlan({ seed: 'founded-scene-test', tier: 'hamlet', firstYear: 2025, year: 2026 });
  scene = (await assembleFoundedScene({ kingdomId, plan, state: createRealmState(kingdomId, 'simulated'), collisionRevision: 7 })).scene;
}, 120_000);

describe('trusted founded pier installation', () => {
  it('accepts the exact assembled modules, hashes, transforms, real water and reachable rack', async () => {
    const placements = scene.placements.filter(piece => piece.id.startsWith('pier:'));
    const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
    const pieces = scene.placements.map(piece => ({ ...piece, blueprint: assets.get(piece.assetHash)! }));
    const installed = installPier(scene.plan, pieces)!;
    expect(placements).toHaveLength(6);
    expect(installed.pieces).toHaveLength(6);
    for (const expected of installed.pieces) {
      const actual = placements.find(piece => piece.id === expected.id)!;
      expect(actual).toMatchObject({ position: expected.position, rotation: expected.rotation, assetHash: await assetHashOf(expected.blueprint) });
    }
    const resolved = await fishingInstallationFromScene(scene, 7);
    expect(resolved).not.toBeNull();
    expect(resolved!.biome).toBeNull();
    expect(resolved!.rack).toEqual(pierLocalToWorld(installed.site, installed.content.anchors.rack));
    const wet = pierLocalToWorld(installed.site, [10, 0, (installed.site.walk + 7) / VOXEL_METRES.build]);
    expect(resolved!.sample(wet[0], wet[2])).toEqual({ waterY: pierWaterAt(scene.plan, wet[0], wet[2]), groundY: foundedGroundAt(scene.plan, wet[0], wet[2])[1] });
    expect(resolved!.sample(wet[0], wet[2]).waterY).toBe(installed.site.waterY);
    expect(resolved!.sample(wet[0], wet[2]).waterY! - resolved!.sample(wet[0], wet[2]).groundY).toBeGreaterThanOrEqual(1);
    const world = compileFoundedScene(scene), [x, y, z] = resolved!.rack;
    const walker = { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: 7 };
    expect(embeddedSolids(walker, world)).toEqual([]);
    expect(supported(walker, world)).toBe(true);
    expect((await fishingInstallationFromScene(scene, 7, 'meadow'))?.biome).toBe('meadow');
  }, 120_000);

  it('refuses absent, partial, extra, transformed, wrong-asset or wrong-revision placements', async () => {
    const pier = scene.placements.filter(piece => piece.id.startsWith('pier:'));
    expect(pier.length).toBeGreaterThan(1);
    const target = pier[0]!, other = pier[1]!;
    const withPlacements = (placements: RealmFoundedScene['placements']): RealmFoundedScene => ({ ...scene, placements });
    const replace = (placement: typeof target) => withPlacements(scene.placements.map(piece => piece.id === target.id ? placement : piece));
    const candidates = [
      withPlacements(scene.placements.filter(piece => !piece.id.startsWith('pier:'))),
      withPlacements(scene.placements.filter(piece => piece.id !== target.id)),
      withPlacements([...scene.placements, { ...target, id: 'pier:unexpected' }]),
      withPlacements([...scene.placements, { ...target, id: 'other:obstruction' }]),
      withPlacements([...scene.placements, target]),
      replace({ ...target, position: [target.position[0] + .125, target.position[1], target.position[2]] }),
      replace({ ...target, rotation: ((target.rotation + 1) % 4) as 0 | 1 | 2 | 3 }),
      replace({ ...target, assetHash: other.assetHash }),
      replace({ ...target, assetHash: 'missing' }),
    ];
    for (const candidate of candidates) expect(await fishingInstallationFromScene(candidate, 7)).toBeNull();
    const falseContent: RealmFoundedScene = { ...scene, assets: scene.assets.map(asset => asset.assetHash === target.assetHash
      ? { ...asset, blueprint: { ...asset.blueprint, id: 'tampered-blueprint' } } : asset) };
    expect(await fishingInstallationFromScene(falseContent, 7)).toBeNull();
    expect(await fishingInstallationFromScene(scene, 8)).toBeNull();
  }, 120_000);

  it('reuses only an unchanged immutable scene and biome and rejects a stale collision revision', async () => {
    let adopted: RealmFoundedScene | null = scene, revision = 7, biome: string | null = null;
    const read = createFishingInstallationReader({ scene: () => adopted, revision: () => revision, biome: () => biome });
    const first = await read(); expect(first).not.toBeNull(); expect(await read()).toBe(first);
    biome = 'meadow'; const changedBiome = await read(); expect(changedBiome).not.toBe(first); expect(changedBiome?.biome).toBe('meadow');
    adopted = { ...scene }; const changedScene = await read(); expect(changedScene).not.toBe(changedBiome);
    revision = 8; expect(await read()).toBeNull();
    adopted = { ...scene, collisionRevision: 8 }; const changedRevision = await read(); expect(changedRevision).not.toBeNull(); expect(changedRevision?.revision).toBe(8);
    adopted = null; expect(await read()).toBeNull();
  }, 120_000);
});
