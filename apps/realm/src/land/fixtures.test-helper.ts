// Small founded scenes and baked artifacts for the land module's tests (kingdom 123, recipe {version: 1}).
import { KingdomIdSchema, VoxelBlueprintSchema } from '@chatdom/shared';
import { generateSettlementPlan } from '../../../../packages/world/src/settlement/generator';
import { assetHashOf, canonicalSceneJson, sha256Hex, utf8 } from '../../../../packages/world/src/founded-world/codec';
import { encodeFoundedScene, validateFoundedScene } from '../../../../packages/world/src/founded-world/validate';
import type { RealmFoundedScene } from '../../../../packages/world/src/founded-world/types';
import { encodeBakedMetadata, encodeBakedRegion, encodeBakedSurface } from '../../../../packages/world/src/grand/baked/codec';
import { BAKED_COMPILERS, type BakedMetadata } from '../../../../packages/world/src/grand/baked/types';
import type { LandArtifactStore } from './store';

const plan = { ...generateSettlementPlan({ seed: 'publication-test', tier: 'hamlet', firstYear: 2025, year: 2026 }), homes: [] };
const materials = { version: 1, revision: 1, materials: [
  { id: 0, name: 'Air', solid: false, occludesFaces: false, occludesAo: false, blocksLight: false, colour: '#000000', surface: 'air' },
  { id: 3, name: 'Stone', solid: true, occludesFaces: true, occludesAo: true, blocksLight: true, colour: '#777777', surface: 'stone' },
] };
export async function scene(variant = 0, options: { origin?: 'live' | 'simulated'; kingdomId?: string; changedPlan?: boolean } = {}) {
  const blueprint = VoxelBlueprintSchema.parse({ version: 1, id: `prop:${variant}`, styleId: 'hearth', kind: 'prop', lattice: 'build',
    size: [2, 2, 2], boxes: [{ from: [0, 0, 0], to: [2, 2, 2], material: 3 }], windows: [] });
  const assetHash = await assetHashOf(blueprint);
  const value = await validateFoundedScene({ version: 1, kingdomId: KingdomIdSchema.parse(options.kingdomId ?? '123'),
    origin: options.origin ?? 'live', layoutRevision: plan.revision, collisionRevision: variant + 1,
    plan: options.changedPlan ? { ...plan, config: { ...plan.config, seed: 'different-plan' } } : plan,
    materials, assets: [{ assetHash, blueprint }], placements: [{ id: 'prop:one', assetHash, position: [0, 0, 0], rotation: 0 }] });
  return { scene: value, ...(await encodeFoundedScene(value)) };
}
export async function artifact(store: LandArtifactStore, value: RealmFoundedScene, groundHeight = 8) {
  const recipeHash = await store.pinRecipe('123', { version: 1 });
  const sourcePlanHash = await sha256Hex(utf8(canonicalSceneJson(value.plan)));
  const surface = await store.put(encodeBakedSurface({ size: 256, height: 256, seaLevel: 0,
    ground: new Uint16Array(256 ** 2).fill(groundHeight), water: new Uint16Array(256 ** 2) }));
  const mesh = await store.put(encodeBakedRegion({ rx: 0, rz: 0, level: 0, minY: 0, maxY: 32,
    quads: new Uint32Array([0, 126]), offsets: new Int32Array([0, 1, 1, 1, 1, 1, 1]) }));
  const metadata: BakedMetadata = { version: 2, kingdomId: '123', recipeHash, sourcePlanHash, sourcePlanRevision: value.layoutRevision,
    compilers: BAKED_COMPILERS, size: 256, height: 256, seaLevel: 0,
    seat: { offset: [16, 5, 32], columns: { x0: 32, z0: 64, x1: 64, z1: 96 }, band: 96 },
    physicalRegion: { minX: 0, maxX: 16, minZ: 0, maxZ: 16 }, bounds: { min: [-16, -5, -32], max: [112, 123, 96] },
    palette: [{ id: 126, colour: '#aaaaaa', kind: 0 }], surface,
    regions: [{ rx: 0, rz: 0, exact: true, bounds: { min: [-16, -5, -32], max: [112, 11, 96] },
      meshes: [{ ...mesh, level: 0, rx: 0, rz: 0, minY: 0, maxY: 32, quadCount: 1 }] }] };
  const manifest = await store.put(encodeBakedMetadata(metadata));
  const encoded = await encodeFoundedScene(value);
  const binding = { version: 1 as const, kingdomId: '123', sceneHash: encoded.manifest.sceneHash,
    layoutRevision: value.layoutRevision, collisionRevision: value.collisionRevision, sourcePlanHash, recipeHash, manifest };
  await store.bind(binding);
  await store.cataloguePlan({ version: 1, kingdomId: '123', recipeHash, sourcePlanHash, layoutRevision: value.layoutRevision, manifest });
  return { binding, surface, mesh, recipeHash };
}
