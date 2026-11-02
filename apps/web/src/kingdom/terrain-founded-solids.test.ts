import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { RealmFoundedScene } from '@chatdom/world';
import { compileFoundedScene, compileFoundedSceneWithSolids, foundedPlacedSolidsInput } from '@chatdom/world/founded-collision';
import { compileFoundedSolidsPacked, prepareFoundedSolids } from './terrain-founded-solids';
import { packCollisionBoxes, unpackCollisionBoxes } from '@chatdom/voxel/collision';

const scene = JSON.parse(readFileSync(new URL('../../../realm/src/founded/artifacts/simulated-town.scene.json', import.meta.url), 'utf8')) as RealmFoundedScene;

it('builds the same collision world from solids compiled in another realm', async () => {
  // A worker receives a structured clone of the input and returns packed float64 boxes.
  const packed = compileFoundedSolidsPacked(structuredClone(foundedPlacedSolidsInput(scene)));
  const placed = unpackCollisionBoxes(packed);
  expect(Array.from(packCollisionBoxes(placed))).toEqual(Array.from(packed));
  const direct = compileFoundedScene(scene), rebuilt = compileFoundedSceneWithSolids(scene, placed);
  expect(rebuilt.revision).toBe(direct.revision);
  const b = scene.plan.bounds;
  for (let z = b.minZ; z < b.maxZ; z += 3.7) for (let x = b.minX; x < b.maxX; x += 3.7) {
    const query = { min: [x, -2, z] as const, max: [x + 2.6, 30, z + 2.6] as const };
    expect(rebuilt.query(query)).toEqual(direct.query(query));
  }
  // Without workers (this test) the host compiles in place, to the same boxes.
  expect(Array.from(packCollisionBoxes(await prepareFoundedSolids(scene)))).toEqual(Array.from(packed));
  expect(() => unpackCollisionBoxes(new Float64Array([0, 0, 0, 1, 1]))).toThrow('six');
  expect(() => unpackCollisionBoxes(new Float64Array([0, 0, 0, 0, 1, 1]))).toThrow('nonempty');
}, 120_000);
