import { setImmediate } from 'node:timers/promises';
import { RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { decodeFoundedScene, FOUNDED_SCENE_LIMITS } from '../../../../packages/world/src/founded-world/validate';
import { freezeGrandLandRecipe, type GrandLandRecipe } from '../../../../packages/world/src/grand/recipe';
import { GRAND_LEVELS, GRAND_REGION } from '../../../../packages/world/src/grand/types';
import { planGrandLand } from '../../../../packages/world/src/grand/plan';
import { assertDimensions } from '../../../../packages/world/src/grand/baked/validation';
import { prepareInstalledLand, regionTouchesPhysical } from '../../../../packages/world/src/grand/baked/prepare';
import { createInstalledRegionMesher } from '../../../../packages/world/src/grand/baked/mesher';
import { createBakedMetadata, identityForBakedLand } from '../../../../packages/world/src/grand/baked/metadata';
import { encodeBakedMetadata, encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { bakedCompilersOf, type BakedRegionRef } from '../../../../packages/world/src/grand/baked/types';
import { LandArtifactStore, type StoredLandBinding } from './store';
import { verifyLandArtifact } from './verify';
export { verifyLandArtifact } from './verify';

export interface LandBakeProgress { readonly stage: 'preparing' | 'surface' | 'meshes' | 'verifying' | 'published'; readonly completed: number; readonly total: number }
export interface LandBakeOptions {
  readonly sceneBytes: Uint8Array;
  readonly receipt: RealmFoundedManifest;
  readonly recipe: GrandLandRecipe;
  readonly store: LandArtifactStore;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LandBakeProgress) => void;
}

/** Offline only: one generator/mesher, one output at a time. No worker or request-triggered generation. */
export async function bakeFoundedLand(options: LandBakeOptions) {
  const wall = performance.now(), cpu = process.cpuUsage();
  const check = () => options.signal?.throwIfAborted();
  check();
  const receipt = RealmFoundedManifestSchema.parse(options.receipt);
  if (options.sceneBytes.byteLength > FOUNDED_SCENE_LIMITS.bytes) throw new Error('The founded scene exceeds its byte budget');
  const scene = await decodeFoundedScene(new Uint8Array(options.sceneBytes), receipt);
  if (scene.origin !== 'live') throw new Error('A public land bake requires a live founded receipt');
  const recipe = freezeGrandLandRecipe(options.recipe);
  if (recipe.version !== 1 || recipe.seed.kingdomId !== scene.kingdomId
    || typeof recipe.seed.seedKey !== 'string' || !recipe.seed.seedKey.includes(scene.kingdomId)
    || !bakedCompilersOf(recipe) || (recipe.generator === 'grand-land-2') !== !!recipe.seed.world)
    throw new Error('The land recipe does not match this kingdom and compiler');
  // Macro planning is bounded and allocation-free with respect to the world raster.
  const planned = planGrandLand(recipe.seed);
  assertDimensions(planned.size, planned.height, planned.seaLevel);
  const identity = await identityForBakedLand(scene.plan, recipe);
  try {
    if (await options.store.recipeHash(scene.kingdomId) !== identity.recipeHash) throw new Error('An adopted land recipe cannot be silently migrated');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  options.onProgress?.({ stage: 'preparing', completed: 0, total: 1 });
  check();
  const prepared = prepareInstalledLand(scene.plan, recipe);
  check();
  const { land, seated } = prepared;
  const surface = await options.store.put(encodeBakedSurface(land));
  options.onProgress?.({ stage: 'surface', completed: 1, total: 1 });
  const mesher = createInstalledRegionMesher(prepared), per = land.size / GRAND_REGION;
  let total = 0;
  for (let rz = 0; rz < per; rz++) for (let rx = 0; rx < per; rx++) total += regionTouchesPhysical(rx, rz, seated) ? 1 : GRAND_LEVELS;
  const refs: BakedRegionRef[] = [];
  for (let rz = 0; rz < per; rz++) for (let rx = 0; rx < per; rx++) {
    const levels = regionTouchesPhysical(rx, rz, seated) ? 1 : GRAND_LEVELS;
    for (let level = 0; level < levels; level++) {
      check();
      const mesh = mesher.mesh({ rx, rz, level });
      const ref = await options.store.put(encodeBakedRegion(mesh));
      refs.push({ ...ref, rx, rz, level, minY: mesh.minY, maxY: mesh.maxY, quadCount: mesh.quads.length / 2 });
      options.onProgress?.({ stage: 'meshes', completed: refs.length, total });
      await setImmediate();
    }
  }
  const metadata = createBakedMetadata(prepared, identity, surface, refs);
  const manifest = await options.store.put(encodeBakedMetadata(metadata));
  const binding: StoredLandBinding = { version: 1, kingdomId: scene.kingdomId, sceneHash: receipt.sceneHash,
    layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision,
    sourcePlanHash: identity.sourcePlanHash, recipeHash: identity.recipeHash, manifest };
  options.onProgress?.({ stage: 'verifying', completed: 0, total: refs.length + 2 });
  await verifyLandArtifact(options.store, binding, check);
  check();
  // Complete verified exact plans can be reused by later receipts. Nothing scans for a newest bake.
  await options.store.pinRecipe(scene.kingdomId, recipe, options.signal);
  check();
  await options.store.cataloguePlan({ version: 1, kingdomId: binding.kingdomId, recipeHash: binding.recipeHash,
    sourcePlanHash: binding.sourcePlanHash, layoutRevision: binding.layoutRevision, manifest }, options.signal);
  check();
  await options.store.bind(binding, options.signal);
  check();
  options.onProgress?.({ stage: 'published', completed: total, total });
  const used = process.cpuUsage(cpu);
  return { binding, regions: metadata.regions.length, meshes: refs.length,
    exactRegions: metadata.regions.filter(region => region.exact).length,
    rawBytes: surface.rawBytes + manifest.rawBytes + refs.reduce((n, ref) => n + ref.rawBytes, 0),
    storedBytes: surface.gzipBytes + manifest.gzipBytes + refs.reduce((n, ref) => n + ref.gzipBytes, 0),
    manifestBytes: manifest.rawBytes, manifestGzipBytes: manifest.gzipBytes, surfaceGzipBytes: surface.gzipBytes,
    wallSeconds: (performance.now() - wall) / 1000, cpuSeconds: (used.user + used.system) / 1e6,
    peakMemoryKiB: process.resourceUsage().maxRSS, workers: 0 };
}
