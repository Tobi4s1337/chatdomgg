import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { compileChannelGenesis } from '../../../../packages/world/src/genesis';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '../../../../packages/world/src/genesis/observed-fixtures';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../../../packages/world/src/founded-world/codec';
import { generateGrandLand } from '../../../../packages/world/src/grand/generate';
import { GRAND_LEVELS, GRAND_REGION, type GrandLandSeed } from '../../../../packages/world/src/grand/types';
import { createInstalledRegionMesher } from '../../../../packages/world/src/grand/baked/mesher';
import { encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { BAKED_FORMAT, HOSTED_GRAND_COMPILER, type BakedBlobRef, type BakedRegionRef } from '../../../../packages/world/src/grand/baked/types';
import type { LandArtifactStore } from './store';

/**
 * A sketch is the land of a channel that has not founded its kingdom (decision 3: an unclaimed kingdom is a private
 * sketch). It is raised from the channel's full identity and Genesis profile alone: there is no installed town to
 * grade to, so every region is baked at every level. It is stored, never served: at founding the realm bakes the
 * founded land against the real plan, and this record is only what the land of that channel costs to keep.
 */
export interface GrandSketchRecipe {
  readonly version: 1;
  readonly kind: 'sketch';
  readonly generator: 'grand-land-1';
  readonly kit: 'grand-artisans-1';
  readonly mesher: typeof HOSTED_GRAND_COMPILER;
  readonly seed: GrandLandSeed;
}
export interface GrandSketchRecord {
  readonly version: 1;
  readonly format: number;
  readonly kingdomId: string;
  readonly recipeHash: string;
  readonly recipe: GrandSketchRecipe;
  readonly size: number;
  readonly height: number;
  readonly seaLevel: number;
  readonly surface: BakedBlobRef;
  readonly meshes: readonly BakedRegionRef[];
}

/** The Genesis channels the first lands were made for, from their observed Atlas facts and curated landforms. */
export function genesisSketchRecipe(broadcasterId: string, name: string): GrandSketchRecipe {
  const facts = OBSERVED_GENESIS_FIXTURES.find(row => row.broadcasterId === broadcasterId);
  if (!facts) throw new Error(`No observed Genesis facts for channel ${broadcasterId}`);
  const genesis = compileChannelGenesis(facts);
  const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(row => row.broadcasterId === broadcasterId);
  const landscape = genesis.landscapes.find(row => row.id === genesis.recommendedLandscapeId) ?? genesis.landscapes[0]!;
  if (String(genesis.kingdomId) !== broadcasterId || !genesis.seedKey.includes(broadcasterId)) throw new Error('A sketch needs the full channel identity');
  return { version: 1, kind: 'sketch', generator: 'grand-land-1', kit: 'grand-artisans-1', mesher: HOSTED_GRAND_COMPILER,
    seed: { seedKey: genesis.seedKey, kingdomId: broadcasterId, name, biome: genesis.identity.biome, tier: genesis.size.tier,
      character: choice?.character ?? landscape.character } };
}

export async function bakeSketchLand(options: { readonly recipe: GrandSketchRecipe; readonly store: LandArtifactStore;
  readonly signal?: AbortSignal; readonly onProgress?: (done: number, total: number) => void }) {
  const wall = performance.now(), cpu = process.cpuUsage(), check = () => options.signal?.throwIfAborted();
  const recipe = JSON.parse(canonicalSceneJson(options.recipe)) as GrandSketchRecipe;
  if (recipe.kind !== 'sketch' || recipe.mesher !== HOSTED_GRAND_COMPILER) throw new Error('Not a sketch recipe for this compiler');
  const recipeHash = await sha256Hex(utf8(canonicalSceneJson(recipe)));
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
  const record: GrandSketchRecord = { version: 1, format: BAKED_FORMAT, kingdomId: recipe.seed.kingdomId, recipeHash, recipe,
    size: land.size, height: land.height, seaLevel: land.seaLevel, surface, meshes };
  const directory = join(options.store.directory, 'sketches', recipe.seed.kingdomId);
  await mkdir(directory, { recursive: true });
  const file = await open(join(directory, `${recipeHash}.json`), 'w', 0o600);
  try { await file.writeFile(canonicalSceneJson(record)); await file.sync(); } finally { await file.close(); }
  const used = process.cpuUsage(cpu);
  return { kingdomId: recipe.seed.kingdomId, name: recipe.seed.name, character: recipe.seed.character, biome: recipe.seed.biome,
    tier: recipe.seed.tier, recipeHash, size: land.size, regions: per * per, meshes: meshes.length,
    quads: meshes.reduce((n, ref) => n + ref.quadCount, 0),
    rawBytes: surface.rawBytes + meshes.reduce((n, ref) => n + ref.rawBytes, 0),
    storedBytes: surface.gzipBytes + meshes.reduce((n, ref) => n + ref.gzipBytes, 0), surfaceGzipBytes: surface.gzipBytes,
    generateSeconds, wallSeconds: (performance.now() - wall) / 1000, cpuSeconds: (used.user + used.system) / 1e6,
    peakMemoryKiB: process.resourceUsage().maxRSS, workers: 0 };
}
