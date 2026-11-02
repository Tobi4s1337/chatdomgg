import { describe, expect, it } from 'vitest';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { transformCardinalPoint, type RealmFoundedScene } from '@chatdom/world';
import { PIER_REVIEW_SITE } from '../../../../packages/content/src/places/water/pier';
import { createFishingPier } from '../../../../packages/content/src/pier/layout';
import { foundedPier } from './founded-pier';

const CELL = VOXEL_METRES.build;
type Scene = Pick<RealmFoundedScene, 'assets' | 'placements'>;

/** The modules placed the way the realm's installer places them (apps/realm/src/fishing/site.ts `pierLocalToWorld`). */
function installed(turn: 0 | 1 | 2 | 3, root: Vec3, deckY: number) {
  const content = createFishingPier('hearth', PIER_REVIEW_SITE);
  const local = (at: Vec3) => transformCardinalPoint([root[0], deckY, root[2]], turn, [(at[0] - 10) * CELL, at[1] * CELL, at[2] * CELL]);
  const scene: Scene = {
    assets: content.modules.map(module => ({ assetHash: `hash-${module.id}`, blueprint: module.blueprint })) as Scene['assets'],
    placements: [
      { id: 'home:1', assetHash: 'hash-root', position: [0, 0, 0], rotation: 0 },
      ...content.modules.map(module => ({ id: `pier:lake:${module.id}`, assetHash: `hash-${module.id}`, position: local(module.offset), rotation: turn })),
    ] as Scene['placements'],
  };
  return { scene, content, lights: content.lights.map(light => local(light.at)) };
}
const key = (points: readonly Vec3[]) => points.map(point => point.map(value => value.toFixed(4)).join(',')).sort();

describe('the installed pier, read back for a watcher', () => {
  it.each([0, 1, 2, 3] as const)('turn %i: the frame and every lantern match what the realm installed', turn => {
    const root: Vec3 = [120.5, 3.25, -40], { scene, lights } = installed(turn, root, 1.5);
    const pier = foundedPier(scene)!;
    expect(pier).not.toBeNull();
    expect(pier.turn).toBe(turn);
    expect(pier.walk).toBeCloseTo(PIER_REVIEW_SITE.walk * CELL, 6);
    expect(pier.root[0]).toBeCloseTo(root[0], 6); expect(pier.root[2]).toBeCloseTo(root[2], 6);
    expect(key(pier.lights)).toEqual(key(lights));
    // The head's middle lies out over the water along the turn's +Z, past the walk.
    const out = transformCardinalPoint([0, 0, 0], turn, [0, 0, 1]);
    const along = (pier.head[0] - root[0]) * out[0] + (pier.head[2] - root[2]) * out[2];
    expect(along).toBeCloseTo(pier.walk + 16 * CELL, 6);
    const site = pier.withWater(.5);
    expect(site).toMatchObject({ id: 'pier:lake', turn, waterY: .5, walk: pier.walk });
    expect(site.deckY).toBeGreaterThan(site.waterY);
  });

  it('has no pier where none was installed, or where the modules disagree', () => {
    const { scene } = installed(1, [0, 0, 0], 1);
    expect(foundedPier({ ...scene, placements: scene.placements.filter(p => !p.id.startsWith('pier:')) })).toBeNull();
    expect(foundedPier({ ...scene, placements: scene.placements.filter(p => p.id !== 'pier:lake:head') })).toBeNull();
    expect(foundedPier({ ...scene, placements: scene.placements.map(p => (p.id === 'pier:lake:bay-32' ? { ...p, rotation: 2 } : p)) })).toBeNull();
    expect(foundedPier({ ...scene, assets: scene.assets.filter(a => a.assetHash !== 'hash-head') })).toBeNull();
  });
});
