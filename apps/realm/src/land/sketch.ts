import { setImmediate } from 'node:timers/promises';
import { compileChannelGenesis } from '../../../../packages/world/src/genesis';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '../../../../packages/world/src/genesis/observed-fixtures';
import { generateGrandLand } from '../../../../packages/world/src/grand/generate';
import { landMaterials } from '../../../../packages/world/src/grand/kits';
import { GRAND_LEVELS, GRAND_REGION } from '../../../../packages/world/src/grand/types';
import { grandSeedFromGenesis } from '../../../../packages/world/src/grand/world';
import { grandSketchRecipe, grandSketchRecipeHash, validateSketchRecipe, type GrandSketchRecipe, type GrandSketchRecord } from '../../../../packages/world/src/grand/sketch';
import { createInstalledRegionMesher } from '../../../../packages/world/src/grand/baked/mesher';
import { encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { BAKED_FORMAT, type BakedRegionRef } from '../../../../packages/world/src/grand/baked/types';
import type { LandArtifactStore } from './store';

export type { GrandSketchRecipe, GrandSketchRecord };

/** The Genesis channels the first lands were made for, from their observed Atlas facts and curated landforms. */
export function genesisSketchRecipe(broadcasterId: string, name: string): GrandSketchRecipe {
  const facts = OBSERVED_GENESIS_FIXTURES.find(row => row.broadcasterId === broadcasterId);
  if (!facts) throw new Error(`No observed Genesis facts for channel ${broadcasterId}`);
  const genesis = compileChannelGenesis(facts);
  const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(row => row.broadcasterId === broadcasterId);
  if (String(genesis.kingdomId) !== broadcasterId || !genesis.seedKey.includes(broadcasterId)) throw new Error('A sketch needs the full channel identity');
  return grandSketchRecipe(grandSeedFromGenesis(genesis, name, choice ? { character: choice.character } : {}));
}

/**
 * Raise a sketch (see `packages/world/src/grand/sketch.ts`): the whole land from its recipe, every region at every
 * level, each blob stored once by content, then the record under the recipe's hash. The record is written last, so
 * a killed bake leaves only unreferenced blobs and the sketch stays unpublished.
 */
export async function bakeSketchLand(options: { readonly recipe: GrandSketchRecipe; readonly store: LandArtifactStore;
  readonly signal?: AbortSignal; readonly onProgress?: (done: number, total: number) => void }) {
  const wall = performance.now(), cpu = process.cpuUsage(), check = () => options.signal?.throwIfAborted();
  const recipe = validateSketchRecipe(options.recipe);
  const recipeHash = await grandSketchRecipeHash(recipe);
  const generated = performance.now();
  const land = generateGrandLand(recipe.seed);
  const generateSeconds = (performance.now() - generated) / 1000;
  check();
  const surface = await options.store.put(encodeBakedSurface(land));
  const mesher = createInstalledRegionMesher({ land, seated: null }), per = land.size / GRAND_REGION, total = per * per * GRAND_LEVELS;
  const meshes: BakedRegionRef[] = [];
  for (let rz = 0; rz < per; rz++) for (let rx = 0; rx < per; rx++) for (let level = 0; level < GRAND_LEVELS; level++) {
    check();
    const mesh = mesher.mesh({ rx, rz, level }), ref = await options.store.put(encodeBakedRegion(mesh));
    meshes.push({ ...ref, rx, rz, level, minY: mesh.minY, maxY: mesh.maxY, quadCount: mesh.quads.length / 2 });
    options.onProgress?.(meshes.length, total);
    await setImmediate();
  }
  const palette = landMaterials(land).map(material => ({ id: material.id, colour: material.colour, kind: material.kind })).sort((a, b) => a.id - b.id);
  const record: GrandSketchRecord = { version: 2, format: BAKED_FORMAT, kingdomId: recipe.seed.kingdomId, recipeHash, recipe,
    size: land.size, height: land.height, seaLevel: land.seaLevel, sites: land.sites, palette, trees: land.treeCount, surface, meshes };
  await options.store.putSketch(record, options.signal);
  const used = process.cpuUsage(cpu);
  return { kingdomId: recipe.seed.kingdomId, name: recipe.seed.name, character: recipe.seed.character, biome: recipe.seed.biome,
    tier: recipe.seed.tier, recipeHash, size: land.size, regions: per * per, meshes: meshes.length,
    quads: meshes.reduce((n, ref) => n + ref.quadCount, 0),
    rawBytes: surface.rawBytes + meshes.reduce((n, ref) => n + ref.rawBytes, 0),
    storedBytes: surface.gzipBytes + meshes.reduce((n, ref) => n + ref.gzipBytes, 0), surfaceGzipBytes: surface.gzipBytes,
    generateSeconds, wallSeconds: (performance.now() - wall) / 1000, cpuSeconds: (used.user + used.system) / 1e6,
    peakMemoryKiB: process.resourceUsage().maxRSS, workers: 0 };
}
