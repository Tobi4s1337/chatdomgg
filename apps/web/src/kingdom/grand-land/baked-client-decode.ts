import { sha256Hex } from '../../../../../packages/world/src/founded-world/codec';
import { decodeBakedMetadata, decodeBakedRegion, decodeBakedSurface } from '../../../../../packages/world/src/grand/baked/codec';
import { BAKED_REGION_HEADER_BYTES, BAKED_REGION_QUAD_BYTES,
  type BakedBlobRef, type BakedMetadata, type BakedRegionMesh, type BakedRegionRef, type BakedSurface } from '../../../../../packages/world/src/grand/baked/types';
import { BAKED_SURFACE_BYTES, validateLandBlob, type BakedLandExpected } from './baked-client-binding';
import { checkSignal, gunzipBounded } from './baked-client-transport';

export type BakedDecodeContext = { readonly kind: 'metadata'; readonly expected: BakedLandExpected }
  | { readonly kind: 'surface'; readonly size: number; readonly height: number; readonly seaLevel: number }
  | { readonly kind: 'mesh'; readonly ref: BakedRegionRef; readonly height: number; readonly materials: readonly number[] };
export interface BakedDecoded {
  readonly value: BakedMetadata | BakedSurface | BakedRegionMesh;
  readonly compressed: Uint8Array;
  readonly rawBytes: number;
}
export interface BakedDecodeRequest { readonly id: number; readonly bytes: Uint8Array; readonly ref: BakedBlobRef; readonly context: BakedDecodeContext }
export type BakedDecodeReply = { readonly id: number; readonly result: BakedDecoded } | { readonly id: number; readonly error: string };

/** Runs in a worker in browsers. Raw buffers are local scratch and never retained or posted back. */
export async function verifyAndDecode(bytes: Uint8Array, ref: BakedBlobRef, context: BakedDecodeContext, signal: AbortSignal): Promise<BakedDecoded> {
  checkSignal(signal);
  if (bytes.byteLength !== ref.gzipBytes || await sha256Hex(bytes) !== ref.gzipHash) throw new Error('Baked land compressed digest or length differs');
  checkSignal(signal);
  const raw = await gunzipBounded(bytes, ref.rawBytes, signal);
  if (raw.byteLength !== ref.rawBytes || await sha256Hex(raw) !== ref.hash) throw new Error('Baked land raw digest or length differs');
  checkSignal(signal);
  let value: BakedDecoded['value'];
  if (context.kind === 'metadata') {
    const metadata = decodeBakedMetadata(raw), expected = context.expected;
    if (metadata.kingdomId !== expected.kingdomId || metadata.recipeHash !== expected.recipeHash
      || metadata.sourcePlanHash !== expected.sourcePlanHash || metadata.sourcePlanRevision !== expected.layoutRevision)
      throw new Error('Baked metadata does not match the founded scene binding');
    validateLandBlob(metadata.surface, BAKED_SURFACE_BYTES);
    for (const region of metadata.regions) for (const mesh of region.meshes)
      validateLandBlob(mesh, BAKED_REGION_HEADER_BYTES + BAKED_REGION_QUAD_BYTES);
    value = metadata;
  } else if (context.kind === 'surface') {
    const surface = decodeBakedSurface(raw);
    if (surface.size !== context.size || surface.height !== context.height || surface.seaLevel !== context.seaLevel)
      throw new Error('Baked surface does not match the land metadata');
    value = surface;
  } else {
    const mesh = decodeBakedRegion(raw), descriptor = context.ref;
    if (mesh.rx !== descriptor.rx || mesh.rz !== descriptor.rz || mesh.level !== descriptor.level || mesh.minY !== descriptor.minY
      || mesh.maxY !== descriptor.maxY || mesh.quads.length / 2 !== descriptor.quadCount)
      throw new Error('Baked mesh does not match its region reference');
    const materials = new Set(context.materials);
    for (let i = 0; i < mesh.quads.length; i += 2) {
      const a = mesh.quads[i]!, b = mesh.quads[i + 1]!, face = (a >>> 25) & 7, axis = face >> 1;
      if (!materials.has(b & 255)) throw new Error('Baked mesh uses a material outside its palette');
      const y = ((b >>> 20) & 15) * 32 + ((a >>> 5) & 31);
      const span = axis === 1 ? (face % 2 === 0 ? 1 : 0)
        : (axis + 1) % 3 === 1 ? ((a >>> 15) & 31) + 1 : ((a >>> 20) & 31) + 1;
      if ((y + span) * (1 << mesh.level) > context.height) throw new Error('Baked mesh exceeds the declared world height');
    }
    value = mesh;
  }
  checkSignal(signal);
  return { value, compressed: bytes, rawBytes: raw.byteLength };
}

export function freezeMetadata(value: BakedMetadata): void {
  function freeze(object: unknown): void {
    if (object && typeof object === 'object' && !Object.isFrozen(object)) {
      Object.values(object).forEach(freeze); Object.freeze(object);
    }
  }
  freeze(value);
}
