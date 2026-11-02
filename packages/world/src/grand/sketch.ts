import { canonicalSceneJson, sha256Hex, utf8 } from '../founded-world/codec';
import { GENESIS_VERSION } from '../genesis/contracts';
import { GRAND_CREST_CLAY, GRAND_GROVE_SPECIES, GRAND_LANDFORMS } from './world';
import { GRAND_LEVELS, GRAND_REGION, type GrandLandSeed, type GrandSites } from './types';
import type { GrandMaterial } from './palette';
import { BAKED_FORMAT, BAKED_MAX_HEIGHT, BAKED_MAX_SIDE, HOSTED_GRAND_COMPILER, type BakedBlobRef, type BakedRegionRef } from './baked/types';

/**
 * A channel's own world before anyone founds it there (GW13, decision 3: an unclaimed kingdom is a private sketch).
 * The land is raised from the channel's full identity and Genesis profile alone. There is no town graded into it
 * yet, so every region is baked at every level. Visitors who look a channel up are shown it; the realm makes it
 * once per recipe, stores it under the recipe's hash and serves it like a founded land: immutable bytes, no
 * people, no presence, nothing about anyone's home. A founding later bakes the founded land against the real plan.
 *
 * The recipe is all a visitor's browser needs to know which land it expects: it compiles the channel's Genesis
 * recipe from the survey facts it already reads, makes this recipe and asks the realm for that exact hash. The
 * browser never generates land; the realm never accepts a recipe that is not a well-formed channel world.
 */
export interface GrandSketchRecipe {
  readonly version: 1;
  readonly kind: 'sketch';
  readonly generator: 'grand-land-2';
  readonly kit: 'grand-artisans-1';
  readonly mesher: typeof HOSTED_GRAND_COMPILER;
  readonly seed: GrandLandSeed & { readonly world: NonNullable<GrandLandSeed['world']> };
}

/** The sketch's manifest: the recipe it was made from, the land's frame and every blob it is made of. */
export interface GrandSketchRecord {
  readonly version: 2;
  readonly format: number;
  readonly kingdomId: string;
  readonly recipeHash: string;
  readonly recipe: GrandSketchRecipe;
  readonly size: number;
  readonly height: number;
  readonly seaLevel: number;
  /** The places the land is composed around (castle rock, town flat, harbour, mere, summit), in land voxels. */
  readonly sites: GrandSites;
  /** The land's materials, kit pieces included (the palette texture's rows). */
  readonly palette: readonly GrandMaterial[];
  readonly trees: number;
  readonly surface: BakedBlobRef;
  readonly meshes: readonly BakedRegionRef[];
}

/** Wire limits. A 1,792-column capital has 49 regions × 4 levels; the record stays far below this. */
export const SKETCH_RECORD_BYTES = 512 * 1024;
export const SKETCH_RECIPE_BYTES = 4096;

export const sketchSeedKey = (kingdomId: string) => `${GENESIS_VERSION}/broadcaster/${kingdomId}`;

export function grandSketchRecipe(seed: GrandLandSeed): GrandSketchRecipe {
  if (!seed.world) throw new Error('A sketch is a channel’s own world: its seed needs world traits');
  const { minSize: _minSize, ...rest } = seed;
  return validateSketchRecipe({ version: 1, kind: 'sketch', generator: 'grand-land-2', kit: 'grand-artisans-1',
    mesher: HOSTED_GRAND_COMPILER, seed: { ...rest, world: seed.world } });
}

export const grandSketchRecipeHash = (recipe: GrandSketchRecipe): Promise<string> => sha256Hex(utf8(canonicalSceneJson(recipe)));

const KINGDOM = /^[1-9][0-9]{0,31}$/;
const HASH = /^[a-f0-9]{64}$/;
const BIOMES = ['meadow', 'woodland', 'coastal', 'highland'];
const TIERS = ['hamlet', 'village', 'town', 'city', 'capital'];
const CHARACTERS = ['coastal-harbour', 'river-valley', 'mountain-pass'];
const LANDMARKS = ['watermill', 'lighthouse', 'watchtower', 'bell-garden', 'stone-circle', 'open-air-stage'];
const CHARGES = ['#efe4cc', '#e2b64e', '#3a3b46', '#f3d9a4', ...GRAND_CREST_CLAY];

function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid sketch ${label}`);
  const own = Object.keys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) throw new Error(`Invalid sketch ${label} fields`);
  return value as Record<string, unknown>;
}
const oneOf = (value: unknown, options: readonly string[], label: string) => {
  if (typeof value !== 'string' || !options.includes(value)) throw new Error(`Invalid sketch ${label}`);
};

/**
 * Accept only a channel world this build can raise: the exact recipe shape, the channel's full Genesis identity
 * as its only seed, a display name and world traits from the curated sets. Returns a frozen canonical copy.
 */
export function validateSketchRecipe(value: unknown): GrandSketchRecipe {
  const recipe = exact(value, ['version', 'kind', 'generator', 'kit', 'mesher', 'seed'], 'recipe');
  if (recipe.version !== 1 || recipe.kind !== 'sketch' || recipe.generator !== 'grand-land-2' || recipe.kit !== 'grand-artisans-1'
    || recipe.mesher !== HOSTED_GRAND_COMPILER) throw new Error('A sketch names compilers this build does not bake');
  const seed = exact(recipe.seed, ['seedKey', 'kingdomId', 'name', 'biome', 'tier', 'character', 'world'], 'seed');
  if (typeof seed.kingdomId !== 'string' || !KINGDOM.test(seed.kingdomId)) throw new Error('Invalid sketch channel identity');
  if (seed.seedKey !== sketchSeedKey(seed.kingdomId)) throw new Error('A sketch is keyed by the channel’s full Genesis identity');
  if (typeof seed.name !== 'string' || !seed.name.trim() || seed.name.length > 64 || /[\u0000-\u001f]/.test(seed.name)) throw new Error('Invalid sketch name');
  oneOf(seed.biome, BIOMES, 'biome'); oneOf(seed.tier, TIERS, 'tier'); oneOf(seed.character, CHARACTERS, 'character');
  const world = exact(seed.world, ['landform', 'forest', 'crest', 'landmark'], 'world');
  oneOf(world.landform, GRAND_LANDFORMS, 'landform'); oneOf(world.landmark, LANDMARKS, 'landmark');
  if (!Array.isArray(world.forest) || world.forest.length !== 2) throw new Error('Invalid sketch forest');
  for (const species of world.forest) oneOf(species, GRAND_GROVE_SPECIES, 'forest');
  const crest = exact(world.crest, ['field', 'charge'], 'crest');
  oneOf(crest.field, GRAND_CREST_CLAY, 'crest'); oneOf(crest.charge, CHARGES, 'crest');
  const copy = JSON.parse(canonicalSceneJson(recipe)) as GrandSketchRecipe;
  if (utf8(canonicalSceneJson(copy)).byteLength > SKETCH_RECIPE_BYTES) throw new Error('Sketch recipe exceeds its byte budget');
  return deepFreeze(copy);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function blob(ref: unknown, label: string): void {
  const value = ref as Record<string, unknown>;
  if (!value || typeof value !== 'object' || typeof value.hash !== 'string' || !HASH.test(value.hash) || typeof value.gzipHash !== 'string'
    || !HASH.test(value.gzipHash) || !Number.isSafeInteger(value.rawBytes) || (value.rawBytes as number) < 1
    || !Number.isSafeInteger(value.gzipBytes) || (value.gzipBytes as number) < 20) throw new Error(`Invalid sketch ${label} reference`);
}

/**
 * A sketch record from the realm, checked against the recipe this browser (or bake) expects: canonical bytes, the
 * same recipe and hash, a land frame this build can draw, and exactly one mesh for every region at every level.
 */
export function decodeSketchRecord(bytes: Uint8Array, expected: { readonly kingdomId: string; readonly recipeHash: string }): GrandSketchRecord {
  if (!bytes.byteLength || bytes.byteLength > SKETCH_RECORD_BYTES) throw new RangeError('Invalid sketch record length');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text) as GrandSketchRecord;
  if (canonicalSceneJson(value) !== text) throw new Error('A sketch record must use canonical JSON bytes');
  exact(value, ['version', 'format', 'kingdomId', 'recipeHash', 'recipe', 'size', 'height', 'seaLevel', 'sites', 'palette', 'trees', 'surface', 'meshes'], 'record');
  if (value.version !== 2 || (value.format !== 1 && value.format !== BAKED_FORMAT) || value.kingdomId !== expected.kingdomId
    || value.recipeHash !== expected.recipeHash) throw new Error('The sketch record is not the land this view expects');
  const recipe = validateSketchRecipe(value.recipe);
  if (recipe.seed.kingdomId !== expected.kingdomId) throw new Error('The sketch record belongs to another channel');
  if (!Number.isSafeInteger(value.size) || value.size < GRAND_REGION || value.size > BAKED_MAX_SIDE || value.size % GRAND_REGION
    || !Number.isSafeInteger(value.height) || value.height < 16 || value.height > BAKED_MAX_HEIGHT
    || !Number.isSafeInteger(value.seaLevel) || value.seaLevel < 1 || value.seaLevel >= value.height
    || !Number.isSafeInteger(value.trees) || value.trees < 0) throw new Error('Invalid sketch land frame');
  if (!value.sites || typeof value.sites !== 'object' || !Array.isArray(value.palette) || !value.palette.length || value.palette.length > 256)
    throw new Error('Invalid sketch sites or palette');
  for (const material of value.palette) {
    if (!Number.isSafeInteger(material.id) || material.id < 1 || material.id > 255 || typeof material.colour !== 'string'
      || !/^#[0-9a-f]{6}$/i.test(material.colour) || !Number.isSafeInteger(material.kind)) throw new Error('Invalid sketch palette');
  }
  blob(value.surface, 'surface');
  const per = value.size / GRAND_REGION, seen = new Set<string>();
  if (!Array.isArray(value.meshes) || value.meshes.length !== per * per * GRAND_LEVELS) throw new Error('A sketch carries every region at every level');
  for (const mesh of value.meshes) {
    blob(mesh, 'mesh');
    const key = `${mesh.rx}:${mesh.rz}:${mesh.level}`;
    if (!Number.isSafeInteger(mesh.rx) || !Number.isSafeInteger(mesh.rz) || !Number.isSafeInteger(mesh.level) || mesh.rx < 0 || mesh.rz < 0
      || mesh.rx >= per || mesh.rz >= per || mesh.level < 0 || mesh.level >= GRAND_LEVELS || seen.has(key)
      || !Number.isSafeInteger(mesh.minY) || !Number.isSafeInteger(mesh.maxY) || mesh.minY < 0 || mesh.maxY < mesh.minY
      || !Number.isSafeInteger(mesh.quadCount) || mesh.quadCount < 0) throw new Error('Invalid sketch mesh reference');
    seen.add(key);
  }
  return deepFreeze(value);
}
