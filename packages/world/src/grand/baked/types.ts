import type { Vec3 } from '@chatdom/shared';
import type { BoundsXZ } from '../../settlement/types';
import type { GrandMaterial } from '../palette';
import type { GrandSeat } from '../kingdom/types';

/** Wire-format limits, not a promise to retain the entire land in browser memory. */
export const BAKED_METADATA_BYTES = 256 * 1024;
export const BAKED_REGION_QUAD_BYTES = 8 * 1024 * 1024;
export const BAKED_MAX_SIDE = 4096;
export const BAKED_MAX_HEIGHT = 512;
export const BAKED_REGION_HEADER_BYTES = 64;
export const BAKED_SURFACE_HEADER_BYTES = 32;
/** Artifact byte format, independent of the recipe and compilers (which decide the content). Format 2 orders
 * the same quads and samples for compression (see codec.ts). Readers accept 1 and 2; producers write 2. */
export type BakedFormat = 1 | 2;
export const BAKED_FORMAT: BakedFormat = 2;
export const BAKED_COMPILERS = Object.freeze({ generator: 'grand-land-1', kit: 'grand-artisans-1',
  grader: 'gk11-grade-2', mesher: 'hosted-grand-land-2' } as const);
export const HOSTED_GRAND_COMPILER = BAKED_COMPILERS.mesher;
export const HOSTED_PAVING = 126;

export interface BakedRegionKey { readonly level: number; readonly rx: number; readonly rz: number }
export interface BakedRegionMesh extends BakedRegionKey {
  readonly quads: Uint32Array;
  /** Seven cumulative offsets in QUADS, face order +X,-X,+Y,-Y,+Z,-Z. */
  readonly offsets: Int32Array;
  /** Chunk-aligned bounds in this LOD's voxels, before multiplying by 2^level. */
  readonly minY: number;
  readonly maxY: number;
}
export interface BakedSurface {
  readonly size: number; readonly height: number; readonly seaLevel: number;
  /** Half-metre column heights, x fastest. Water 0 means dry. */
  readonly ground: Uint16Array; readonly water: Uint16Array;
}
export interface BakedBlobRef {
  /** SHA-256 of uncompressed canonical bytes. */
  readonly hash: string; readonly rawBytes: number;
  /** SHA-256 of normalized gzip bytes, separately verified by the transport. */
  readonly gzipHash: string; readonly gzipBytes: number;
}
export interface BakedRegionRef extends BakedBlobRef, BakedRegionKey {
  readonly minY: number; readonly maxY: number; readonly quadCount: number;
}
export interface BakedBounds { readonly min: Vec3; readonly max: Vec3 }
export interface BakedRegion {
  readonly rx: number; readonly rz: number;
  /** True iff the region intersects the installed physical floor. Only L0 is legal. */
  readonly exact: boolean;
  /** Conservative native metre bounds over every stored LOD, including skirts and structures. */
  readonly bounds: BakedBounds;
  readonly meshes: readonly BakedRegionRef[];
}
export interface BakedIdentity {
  readonly kingdomId: string;
  readonly recipeHash: string;
  readonly sourcePlanHash: string;
  readonly sourcePlanRevision: string;
}
export interface BakedMetadata extends BakedIdentity {
  /** The artifact format of this metadata and of every blob it names. */
  readonly version: BakedFormat;
  readonly compilers: typeof BAKED_COMPILERS;
  readonly size: number; readonly height: number; readonly seaLevel: number;
  readonly seat: GrandSeat;
  readonly physicalRegion: BoundsXZ;
  readonly bounds: BakedBounds;
  readonly palette: readonly GrandMaterial[];
  readonly surface: BakedBlobRef;
  readonly regions: readonly BakedRegion[];
}
