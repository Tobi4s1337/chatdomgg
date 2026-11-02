import { canonicalSceneJson } from '../../../../../packages/world/src/founded-world/codec';
import { BAKED_METADATA_BYTES, type BakedBlobRef } from '../../../../../packages/world/src/grand/baked/types';

/** Supplied only after the founded scene and its current receipt have been validated. The recipe hash
 * comes from the pinned adoption recipe; an artifact response must never choose these expected values. */
export interface BakedLandExpected {
  readonly kingdomId: string;
  readonly sceneHash: string;
  readonly layoutRevision: string;
  readonly collisionRevision: number;
  readonly sourcePlanHash: string;
  readonly recipeHash: string;
}
export interface BakedLandBinding extends BakedLandExpected { readonly version: 1; readonly manifest: BakedBlobRef }
export const BAKED_PENDING_COMPRESSED_BYTES = 8 * 1024 * 1024;
export const BAKED_SURFACE_BYTES = 25 * 1024 * 1024 + 32;
export const BAKED_BINDING_BYTES = 4096;
const HASH = /^[a-f0-9]{64}$/;
const identityKeys = ['kingdomId', 'sceneHash', 'layoutRevision', 'collisionRevision', 'sourcePlanHash', 'recipeHash'] as const;
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)))
    throw new Error('Invalid baked land binding fields');
  return value as Record<string, unknown>;
}
export function validateLandExpected(value: BakedLandExpected): BakedLandExpected {
  object(value, identityKeys);
  if (typeof value.kingdomId !== 'string' || !/^[1-9][0-9]{0,31}$/.test(value.kingdomId)
    || [value.sceneHash, value.sourcePlanHash, value.recipeHash].some(hash => typeof hash !== 'string' || !HASH.test(hash))
    || typeof value.layoutRevision !== 'string' || !value.layoutRevision || value.layoutRevision.length > 256
    || !Number.isSafeInteger(value.collisionRevision) || value.collisionRevision < 0)
    throw new Error('Invalid expected baked land identity');
  return Object.freeze({ ...value });
}
export function validateLandBlob(ref: BakedBlobRef, rawCap: number): void {
  if (!ref || !HASH.test(ref.hash) || !HASH.test(ref.gzipHash)
    || !Number.isSafeInteger(ref.rawBytes) || ref.rawBytes < 1 || ref.rawBytes > rawCap
    || !Number.isSafeInteger(ref.gzipBytes) || ref.gzipBytes < 20 || ref.gzipBytes > BAKED_PENDING_COMPRESSED_BYTES)
    throw new RangeError('Baked land blob exceeds its byte budget or has an invalid hash');
}
export function decodeLandBinding(bytes: Uint8Array, expected: BakedLandExpected): BakedLandBinding {
  if (!bytes.length || bytes.length > BAKED_BINDING_BYTES) throw new RangeError('Invalid baked land binding length');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = object(JSON.parse(text), ['version', ...identityKeys, 'manifest']) as unknown as BakedLandBinding;
  object(value.manifest, ['hash', 'rawBytes', 'gzipHash', 'gzipBytes']);
  if (value.version !== 1 || identityKeys.some(key => value[key] !== expected[key]))
    throw new Error('Baked land binding does not match the current founded scene');
  validateLandBlob(value.manifest, BAKED_METADATA_BYTES);
  if (canonicalSceneJson(value) !== text) throw new Error('Baked land binding must use canonical JSON bytes');
  Object.freeze(value.manifest);
  return Object.freeze(value);
}
