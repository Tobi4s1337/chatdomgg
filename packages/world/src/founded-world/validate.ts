import { z } from 'zod';
import { MaterialRegistrySchema, Sha256Schema, TokenSchema, VoxelBlueprintSchema } from '@chatdom/shared';
import { RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from './types';
import type { SettlementPlan } from '../settlement/types';
import { assetHashOf, canonicalSceneJson, sha256Hex, utf8 } from './codec';

/** Upper bounds for one founded scene. A town today is far below these; exceeding one fails before writing. */
export const FOUNDED_SCENE_LIMITS = {
  assets: 1024,
  placements: 8192,
  /** Ordered voxel boxes summed over unique assets. */
  boxes: 1_000_000,
  homes: 4096,
  bytes: 48 * 1024 * 1024,
  /** World metres from the origin; every adopted plan sits well inside. */
  extent: 4096,
} as const;

export class FoundedSceneError extends Error {
  readonly code = 'realm.founded-scene';
  constructor(detail: string) { super(detail); this.name = 'FoundedSceneError'; }
}

const finite = z.number().refine(n => Number.isFinite(n) && Math.abs(n) <= FOUNDED_SCENE_LIMITS.extent, 'outside the founded extent');
const point = z.tuple([finite, finite, finite]);
const xz = z.tuple([finite, finite]);
const turn = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const count = z.number().int().min(0).max(100_000);
const positive = finite.refine(n => n > 0);
const bounds = z.strictObject({ minX: finite, maxX: finite, minZ: finite, maxZ: finite }).refine(b => b.minX < b.maxX && b.minZ < b.maxZ);
const square = z.strictObject({ id: TokenSchema, boundary: z.array(xz).min(3).max(256), elevation: finite, nodeId: TokenSchema });
const plotFields = { id: TokenSchema, quarterYear: count, ordinal: count, street: z.string().max(256), streetId: TokenSchema,
  courtId: TokenSchema, approachId: TokenSchema, position: point, rotation: turn,
  lot: z.strictObject({ minX: finite, maxX: finite, minZ: finite, maxZ: finite, height: z.literal(20), depth: z.literal(16), frontage: z.literal(8) }) };
const homeSchema = z.strictObject({ ...plotFields, slot: count, tier: z.enum(['hut', 'cottage', 'house', 'manor', 'hall']),
  allowedDepth: positive, style: z.enum(['hearth', 'tide', 'grove']), variant: z.number().int().min(0).max(2) });
const lakeSchema = z.strictObject({ x: finite, z: finite, radiusX: positive, radiusZ: positive, level: finite });
/** Complete public plan shape: nested records cannot smuggle private fields into otherwise allowed plan keys. */
const PlanSchema = z.strictObject({
  version: z.literal(2), revision: TokenSchema,
  config: z.strictObject({ seed: z.string().min(1).max(256), tier: z.enum(['hamlet', 'town']), firstYear: count, year: count }),
  landform: z.strictObject({ version: z.literal(1), seed: z.number().int().min(0).max(0xffffffff),
    ridge: z.strictObject({ origin: xz, bearing: finite, length: positive, width: positive, height: finite }),
    castleRise: z.strictObject({ centre: xz, radius: positive, height: finite }), lake: lakeSchema }),
  homes: z.array(homeSchema).max(FOUNDED_SCENE_LIMITS.homes),
  reservations: z.array(z.strictObject(plotFields)).max(16384),
  quarters: z.array(z.strictObject({ year: count, name: z.string().max(256), rootNodeId: TokenSchema,
    courtIds: z.array(TokenSchema).max(4096), growthNodeIds: z.array(TokenSchema).max(4096) })).max(64),
  nodes: z.array(z.strictObject({ id: TokenSchema, position: point, kind: z.enum(['junction', 'market', 'court', 'frontage', 'castle-gate', 'frontier']) })).max(32768),
  streets: z.array(z.strictObject({ id: TokenSchema, from: TokenSchema, to: TokenSchema, kind: z.enum(['main', 'lane', 'approach', 'trail']),
    name: z.string().max(256), points: z.array(point).min(2).max(4096), width: positive, verge: finite.refine(n => n >= 0), quarterYear: count.optional() })).max(32768),
  activeStreetIds: z.array(TokenSchema).max(32768), market: square, courts: z.array(square).max(4096),
  castle: z.strictObject({ centre: point, bounds, modules: z.array(z.strictObject({ id: TokenSchema,
    kind: z.enum(['keep', 'gatehouse', 'curtain', 'tower']), position: point, rotation: turn, size: z.tuple([positive, positive, positive]) })).max(1024),
    court: square, gateNodeId: TokenSchema, beaconModuleId: TokenSchema }),
  bounds, lake: lakeSchema,
});

const PlacementSchema = z.strictObject({
  id: TokenSchema,
  assetHash: Sha256Schema,
  position: z.tuple([finite, finite, finite]),
  rotation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  plotId: TokenSchema.optional(),
});
const AssetSchema = z.strictObject({ assetHash: Sha256Schema, blueprint: VoxelBlueprintSchema });
const ReceiptSchema = RealmFoundedManifestSchema.omit({ sceneHash: true });
/** The persisted SettlementPlan's own keys; anything else is not part of the adopted plan. */
const PLAN_KEYS = ['activeStreetIds', 'bounds', 'castle', 'config', 'courts', 'homes', 'lake', 'landform', 'market', 'nodes',
  'quarters', 'reservations', 'revision', 'streets', 'version'] as const;
const SCENE_KEYS = ['assets', 'collisionRevision', 'kingdomId', 'layoutRevision', 'materials', 'origin', 'placements', 'plan', 'version'] as const;

/**
 * Runtime validation of a whole public scene: exact allowlisted shape, receipt fields, material registry, every
 * blueprint (schema, bounds, known materials, exact content hash), unique placements with finite cardinal
 * transforms and resolved references, one home per adopted plot, no unreferenced asset and bounded counts.
 * Throws FoundedSceneError; never repairs. Browser-safe.
 */
export async function validateFoundedScene(input: unknown): Promise<RealmFoundedScene> {
  const fail = (detail: string): never => { throw new FoundedSceneError(detail); };
  if (!isPlain(input)) return fail('the scene is not an object');
  exactKeys(input, SCENE_KEYS, 'scene', fail);
  const receipt = parse(ReceiptSchema, pick(input, ['version', 'kingdomId', 'origin', 'layoutRevision', 'collisionRevision']), 'receipt', fail);
  const plan = input['plan'];
  if (!isPlain(plan)) return fail('the scene has no plan');
  exactKeys(plan, PLAN_KEYS, 'plan', fail);
  if (plan['version'] !== 2) fail('the plan version is unsupported');
  if (plan['revision'] !== receipt.layoutRevision) fail('the plan revision differs from the layout revision');
  if (!isPlain(plan['landform']) || plan['landform']['version'] !== 1) fail('the landform has no installed sampler');
  parse(PlanSchema, plan, 'plan geometry', fail);
  const homes = plan['homes'];
  if (!Array.isArray(homes) || homes.length > FOUNDED_SCENE_LIMITS.homes) return fail('the plan homes are missing or unbounded');
  const plots = new Map<string, unknown>(), slots = new Set<number>();
  for (const home of homes) {
    if (!isPlain(home) || typeof home['id'] !== 'string' || typeof home['slot'] !== 'number') return fail('a plan home is malformed');
    if (plots.has(home['id']) || slots.has(home['slot'])) fail(`plan home ${home['id']} is repeated`);
    plots.set(home['id'], home); slots.add(home['slot']);
  }
  const materials = parse(MaterialRegistrySchema, input['materials'], 'materials', fail);
  const known = new Set(materials.materials.map(m => m.id));

  const rawAssets = input['assets'], rawPlacements = input['placements'];
  if (!Array.isArray(rawAssets) || rawAssets.length > FOUNDED_SCENE_LIMITS.assets) return fail('the assets are missing or unbounded');
  if (!Array.isArray(rawPlacements) || rawPlacements.length > FOUNDED_SCENE_LIMITS.placements) return fail('the placements are missing or unbounded');
  const assets = new Map<string, z.infer<typeof AssetSchema>>();
  let boxes = 0;
  for (const [i, raw] of rawAssets.entries()) {
    const asset = parse(AssetSchema, raw, `asset ${i}`, fail);
    if (assets.has(asset.assetHash)) fail(`asset ${asset.assetHash} is repeated`);
    boxes += asset.blueprint.boxes.length;
    if (boxes > FOUNDED_SCENE_LIMITS.boxes) fail('the scene has too many voxel boxes');
    for (const box of asset.blueprint.boxes) if (!known.has(box.material)) fail(`asset ${asset.blueprint.id} uses unknown material ${box.material}`);
    // Hash the blueprint exactly as it will travel; a stale or borrowed hash cannot name other geometry.
    if (await assetHashOf(asset.blueprint) !== asset.assetHash) fail(`asset ${asset.blueprint.id} does not match its hash`);
    assets.set(asset.assetHash, asset);
  }
  const ids = new Set<string>(), used = new Set<string>(), housed = new Set<string>();
  const placements = rawPlacements.map((raw, i) => {
    const placement = parse(PlacementSchema, raw, `placement ${i}`, fail);
    if (ids.has(placement.id)) fail(`placement ${placement.id} is repeated`);
    ids.add(placement.id);
    const asset = assets.get(placement.assetHash) ?? fail(`placement ${placement.id} references a missing asset`);
    used.add(placement.assetHash);
    if (placement.plotId !== undefined && !plots.has(placement.plotId)) fail(`placement ${placement.id} references unknown plot ${placement.plotId}`);
    if (asset.blueprint.kind === 'home') {
      if (placement.plotId === undefined) fail(`home placement ${placement.id} has no plot`);
      if (housed.has(placement.plotId!)) fail(`plot ${placement.plotId} has two homes`);
      housed.add(placement.plotId!);
    }
    const { plotId, ...placed } = placement;
    return plotId === undefined ? placed : { ...placed, plotId };
  });
  if (housed.size !== plots.size) fail('a plan home has no placement');
  if (used.size !== assets.size) fail('the scene carries an unreferenced asset');
  return { ...receipt, plan: input['plan'] as unknown as SettlementPlan, materials, assets: [...assets.values()], placements };
}

/** Exact scene bytes and their receipt. The scene must already be validated (assembly does this before encoding). */
export async function encodeFoundedScene(scene: RealmFoundedScene): Promise<{ readonly bytes: Uint8Array; readonly manifest: RealmFoundedManifest }> {
  const bytes = utf8(canonicalSceneJson(scene));
  if (bytes.byteLength > FOUNDED_SCENE_LIMITS.bytes) throw new FoundedSceneError(`the scene is ${bytes.byteLength} bytes, above its bound`);
  const manifest = RealmFoundedManifestSchema.parse({ version: 1, kingdomId: scene.kingdomId, origin: scene.origin,
    layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision, sceneHash: await sha256Hex(bytes) });
  return { bytes, manifest };
}

/**
 * What a browser (or the server reloading its store) does with fetched bytes: check the SHA-256 the receipt names,
 * parse, validate, and require the receipt's kingdom, origin and both revisions. Any mismatch is an error; there is
 * no local regeneration fallback.
 */
export async function decodeFoundedScene(bytes: Uint8Array, manifest: RealmFoundedManifest): Promise<RealmFoundedScene> {
  const receipt = RealmFoundedManifestSchema.parse(manifest);
  if (bytes.byteLength > FOUNDED_SCENE_LIMITS.bytes) throw new FoundedSceneError('the scene bytes are above their bound');
  if (await sha256Hex(bytes) !== receipt.sceneHash) throw new FoundedSceneError('the scene bytes do not match the receipt hash');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new FoundedSceneError('the scene bytes are not JSON'); }
  const scene = await validateFoundedScene(parsed);
  if (scene.kingdomId !== receipt.kingdomId || scene.origin !== receipt.origin || scene.layoutRevision !== receipt.layoutRevision
    || scene.collisionRevision !== receipt.collisionRevision) throw new FoundedSceneError('the scene disagrees with its receipt');
  return scene;
}

type Plain = Record<string, unknown>;
function isPlain(value: unknown): value is Plain {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value: Plain, allowed: readonly string[], label: string, fail: (detail: string) => never): void {
  const keys = Object.keys(value).filter(key => value[key] !== undefined);
  for (const key of keys) if (!allowed.includes(key)) fail(`${label} carries an unexpected field`);
  for (const key of allowed) if (!(key in value)) fail(`${label} is missing ${key}`);
}
function pick(value: Plain, keys: readonly string[]): Plain {
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
function parse<T>(schema: z.ZodType<T>, value: unknown, label: string, fail: (detail: string) => never): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fail(`${label} is invalid: ${result.error.issues[0]?.message ?? 'schema'}`);
}
