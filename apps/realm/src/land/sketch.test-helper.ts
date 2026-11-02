// A small stand-in sketch for the land module's tests: one 256-column region at every level, real codecs and store.
import { encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { BAKED_FORMAT, type BakedRegionRef } from '../../../../packages/world/src/grand/baked/types';
import { grandSketchRecipeHash, type GrandSketchRecipe, type GrandSketchRecord } from '../../../../packages/world/src/grand/sketch';
import type { LandArtifactStore } from './store';

const sites = { castle: { x: 1, z: 1, radius: 1, top: 2 }, town: { x: 1, z: 1, rx: 1, rz: 1, angle: 0, level: 2 }, harbour: { x: 1, z: 1, facing: 0 },
  headland: { x: 1, z: 1, y: 2 }, mere: null, fields: { x: 1, z: 1, radius: 1 }, summit: { x: 1, z: 1, y: 3 }, focus: [] };

export async function storeSketch(store: LandArtifactStore, recipe: GrandSketchRecipe, onMesh?: (done: number) => void): Promise<GrandSketchRecord> {
  const surface = await store.put(encodeBakedSurface({ size: 256, height: 64, seaLevel: 4, ground: new Uint16Array(256 ** 2).fill(8), water: new Uint16Array(256 ** 2) }));
  const meshes: BakedRegionRef[] = [];
  for (let level = 0; level < 4; level++) {
    const ref = await store.put(encodeBakedRegion({ rx: 0, rz: 0, level, minY: 0, maxY: 32, quads: new Uint32Array([level, 3]), offsets: new Int32Array([0, 1, 1, 1, 1, 1, 1]) }));
    meshes.push({ ...ref, rx: 0, rz: 0, level, minY: 0, maxY: 32, quadCount: 1 });
    onMesh?.(level + 1);
  }
  const record: GrandSketchRecord = { version: 2, format: BAKED_FORMAT, kingdomId: recipe.seed.kingdomId, recipeHash: await grandSketchRecipeHash(recipe),
    recipe, size: 256, height: 64, seaLevel: 4, sites, palette: [{ id: 3, colour: '#777777', kind: 1 }], trees: 0, surface, meshes };
  await store.putSketch(record);
  return record;
}
