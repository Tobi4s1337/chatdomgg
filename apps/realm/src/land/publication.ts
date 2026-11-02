import { RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../../../packages/world/src/founded-world/codec';
import { decodeFoundedScene, FOUNDED_SCENE_LIMITS } from '../../../../packages/world/src/founded-world/validate';
import type { LandArtifactStore, StoredLandBinding, StoredLandPlan } from './store';
import { verifyLandArtifact } from './verify';
import { decodeBakedMetadata } from '../../../../packages/world/src/grand/baked/codec';

export interface LandPublicationOptions {
  readonly sceneBytes: Uint8Array;
  readonly receipt: RealmFoundedManifest;
  readonly recipeHash: string;
  readonly store: LandArtifactStore;
  /** Explicit legacy published receipt, never a caller-authored artifact or an inferred current pointer. */
  readonly sourceSceneHash?: string;
  /**
   * 'full' (the default) reopens and decodes every referenced blob. 'catalogued' trusts only blobs that a bake
   * or an earlier full publication already verified (the existing binding or the exact-plan catalogue): it
   * decodes the metadata and checks every blob is present at its recorded size, in milliseconds instead of
   * seconds, so the realm can rebind before a receipt becomes public. Serving still verifies each blob it sends
   * and every browser verifies both digests. An explicit legacy source always takes the full check.
   */
  readonly verification?: 'full' | 'catalogued';
  readonly signal?: AbortSignal;
}
export interface LandPublicationResult {
  readonly binding: StoredLandBinding;
  readonly disposition: 'existing' | 'rebound';
  readonly reused: { readonly regions: number; readonly meshes: number; readonly blobs: number };
}
export class LandNeedsBakeError extends Error {
  readonly code = 'land.needs-bake';
  readonly kingdomId: string;
  readonly recipeHash: string;
  readonly sourcePlanHash: string;
  readonly layoutRevision: string;
  constructor(identity: Pick<StoredLandPlan, 'kingdomId' | 'recipeHash' | 'sourcePlanHash' | 'layoutRevision'>, detail = 'The exact founded plan needs an offline land bake') {
    super(detail); this.name = 'LandNeedsBakeError';
    this.kingdomId = identity.kingdomId; this.recipeHash = identity.recipeHash;
    this.sourcePlanHash = identity.sourcePlanHash; this.layoutRevision = identity.layoutRevision;
  }
}
const HASH = /^[a-f0-9]{64}$/;
function samePlan(source: StoredLandPlan | StoredLandBinding, expected: Pick<StoredLandPlan, 'kingdomId' | 'recipeHash' | 'sourcePlanHash' | 'layoutRevision'>): boolean {
  return source.kingdomId === expected.kingdomId && source.recipeHash === expected.recipeHash
    && source.sourcePlanHash === expected.sourcePlanHash && source.layoutRevision === expected.layoutRevision;
}

/** Bind existing visual artifacts to actual validated scene bytes. It can reuse a complete exact plan;
 * changed plans fail with needs-bake. No request-triggered generation or physical authority is introduced. */
export async function publishFoundedLand(options: LandPublicationOptions): Promise<LandPublicationResult> {
  const { store, signal } = options, check = () => signal?.throwIfAborted();
  check();
  const receipt = RealmFoundedManifestSchema.parse(options.receipt), recipeHash = options.recipeHash;
  if (typeof recipeHash !== 'string' || !HASH.test(recipeHash)
    || (options.sourceSceneHash !== undefined && (typeof options.sourceSceneHash !== 'string' || !HASH.test(options.sourceSceneHash))))
    throw new Error('Invalid land publication content hash');
  if (options.sceneBytes.byteLength > FOUNDED_SCENE_LIMITS.bytes) throw new Error('The founded scene exceeds its byte budget');
  // Own the bytes across async hashing/validation; neither key choice nor publication observes caller mutation.
  const scene = await decodeFoundedScene(new Uint8Array(options.sceneBytes), receipt);
  check();
  if (scene.origin !== 'live') throw new Error('Land publication requires a live founded scene and receipt');
  const pinned = await store.pinnedRecipeHash(scene.kingdomId);
  check();
  if (pinned === null) throw new LandNeedsBakeError({ kingdomId: scene.kingdomId, recipeHash,
    sourcePlanHash: await sha256Hex(utf8(canonicalSceneJson(scene.plan))), layoutRevision: scene.layoutRevision },
    'This kingdom has no baked land in this store yet');
  if (pinned !== recipeHash) throw new Error('Land publication differs from the pinned kingdom recipe');
  check();
  const identity = { kingdomId: scene.kingdomId, recipeHash,
    sourcePlanHash: await sha256Hex(utf8(canonicalSceneJson(scene.plan))), layoutRevision: scene.layoutRevision };
  check();
  const existing = await store.binding(identity.kingdomId, receipt.sceneHash);
  check();
  let source: StoredLandPlan | StoredLandBinding | null = existing;
  if (existing) {
    if (!samePlan(existing, identity) || existing.collisionRevision !== receipt.collisionRevision)
      throw new Error('Existing land binding does not match the validated founded receipt');
  } else if (options.sourceSceneHash !== undefined) {
    source = await store.binding(identity.kingdomId, options.sourceSceneHash);
    check();
    if (!source || !samePlan(source, identity))
      throw new LandNeedsBakeError(identity, 'The published source does not cover this exact founded plan; an offline bake is needed');
  } else {
    source = await store.plan(identity.kingdomId, identity.recipeHash, identity.sourcePlanHash);
    check();
    if (source && !samePlan(source, identity)) throw new Error('Land catalogue does not match the validated founded plan');
  }
  if (!source) throw new LandNeedsBakeError(identity);
  const binding: StoredLandBinding = { version: 1, ...identity, sceneHash: receipt.sceneHash,
    collisionRevision: receipt.collisionRevision, manifest: { ...source.manifest } };
  const catalogued = options.verification === 'catalogued' && options.sourceSceneHash === undefined;
  const { metadata } = catalogued ? await verifyCatalogued(store, binding, check) : await verifyLandArtifact(store, binding, check);
  check();
  // Catalogue first: a conflicting bake for this exact immutable key must not acquire a new receipt binding.
  await store.cataloguePlan({ version: 1, ...identity, manifest: binding.manifest }, signal);
  check();
  await store.bind(binding, signal);
  check();
  const meshes = metadata.regions.reduce((count, region) => count + region.meshes.length, 0);
  return { binding, disposition: existing ? 'existing' : 'rebound', reused: { regions: metadata.regions.length, meshes, blobs: meshes + 2 } };
}

/** The cheap check for artifacts that were completely verified before they were catalogued or bound. */
async function verifyCatalogued(store: LandArtifactStore, binding: StoredLandBinding, check: () => void) {
  const metadata = decodeBakedMetadata(await store.read(binding.manifest));
  if (metadata.kingdomId !== binding.kingdomId || metadata.recipeHash !== binding.recipeHash
    || metadata.sourcePlanHash !== binding.sourcePlanHash || metadata.sourcePlanRevision !== binding.layoutRevision)
    throw new Error('Baked land does not match the founded receipt binding');
  for (const ref of [metadata.surface, ...metadata.regions.flatMap(region => region.meshes)]) {
    check();
    if (!await store.present(ref)) throw new Error('A catalogued land blob is missing from the store');
  }
  return { metadata };
}

export interface LandPublicationGuardOptions {
  readonly store: LandArtifactStore;
  /** Adoption configuration supplies the original pinned hash; a new receipt cannot select its recipe. */
  readonly recipeFor: (kingdomId: string) => string | null;
}
export function createLandPublicationGuard(options: LandPublicationGuardOptions) {
  return async (bytes: Uint8Array, receipt: RealmFoundedManifest, signal?: AbortSignal): Promise<LandPublicationResult | null> => {
    signal?.throwIfAborted();
    const parsed = RealmFoundedManifestSchema.parse(receipt), recipeHash = options.recipeFor(parsed.kingdomId);
    if (recipeHash === null) return null;
    return publishFoundedLand({ sceneBytes: bytes, receipt: parsed, recipeHash, store: options.store, ...(signal ? { signal } : {}) });
  };
}
