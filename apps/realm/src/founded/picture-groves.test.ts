import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { VOXEL_METRES } from '@chatdom/shared';
import { transformCardinalPoint, type RealmFoundedScene } from '@chatdom/world';
import { enrichNativePictureGroves } from './picture-groves';
import type { NativeHome, NativePiece, NativeTown } from './native';

it('grows picture trees on the pinned roots without changing native homes or other fixtures', async () => {
  const scene = JSON.parse(await readFile(new URL('./artifacts/simulated-town.scene.json', import.meta.url), 'utf8')) as RealmFoundedScene;
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const homes = new Map<string, NativeHome>(), fixtures: NativePiece[] = [];
  for (const placement of scene.placements) {
    const piece = { id: placement.id, blueprint: assets.get(placement.assetHash)!, position: placement.position, rotation: placement.rotation };
    if (placement.plotId) homes.set(placement.plotId, { ...piece, plot: scene.plan.homes.find(plot => plot.id === placement.plotId)! });
    else fixtures.push(piece);
  }
  const native: NativeTown = { revision: scene.plan.revision, homes, fixtures }, snapshot = JSON.stringify([...homes.values(), ...fixtures]);
  const enriched = enrichNativePictureGroves(scene.plan, native);
  const root = (piece: NativePiece) => transformCardinalPoint(piece.position, piece.rotation,
    [piece.blueprint.size[0] * VOXEL_METRES.build / 2, 0, piece.blueprint.size[2] * VOXEL_METRES.build / 2]);
  const forms = new Set<string>();
  expect(enriched.homes).toBe(homes);
  fixtures.forEach((piece, index) => {
    const next = enriched.fixtures[index]!;
    expect(next.id).toBe(piece.id);
    if (/^tree:\d+$/.test(piece.id) && piece.blueprint.kind === 'flora') {
      expect(root(next)).toEqual(root(piece));
      expect(next.blueprint.id).toMatch(/^tree-(oak|pine|birch|willow|elder)-/);
      forms.add(next.blueprint.id);
    } else expect(next).toBe(piece);
  });
  expect(forms.size).toBeGreaterThan(1);
  expect(JSON.stringify([...homes.values(), ...fixtures])).toBe(snapshot);
});
