import { z } from 'zod';
import { TokenSchema, UIntSchema } from './identity';

/** Metres at scene boundaries; integer cells inside a lattice. +Y is up. */
export const VOXEL_METRES = { terrain: 0.5, build: 0.125, avatar: 0.0625 } as const;
export const CHUNK_SIZE = 32;
export const CHUNK_CELLS = CHUNK_SIZE ** 3;
export const HALO_SIZE = CHUNK_SIZE + 2;
export const MAX_ASSET_PADDED_CELLS = 16_777_216;
export const VoxelLatticeSchema = z.enum(['terrain', 'build', 'avatar']);
export type VoxelLattice = z.infer<typeof VoxelLatticeSchema>;
export type Vec3 = readonly [number, number, number];
export const Cell3Schema = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
export const StyleIdSchema = TokenSchema.brand<'StyleId'>();
export type StyleId = z.infer<typeof StyleIdSchema>;
export const MaterialIdSchema = z.number().int().min(0).max(65535);
export const VoxelMaterialSchema = z.strictObject({
  id: MaterialIdSchema,
  name: TokenSchema,
  solid: z.boolean(),
  occludesFaces: z.boolean(),
  occludesAo: z.boolean(),
  blocksLight: z.boolean(),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  surface: z.enum(['air', 'earth', 'grass', 'stone', 'wood', 'plaster', 'roof', 'leaf', 'metal', 'fabric', 'glass']),
});
export type VoxelMaterial = z.infer<typeof VoxelMaterialSchema>;
/** Material zero is air. IDs are stable registry keys, never palette offsets. */
export const MaterialRegistrySchema = z.strictObject({
  version: z.literal(1), revision: UIntSchema, materials: z.array(VoxelMaterialSchema).min(1).max(256),
}).superRefine(({ materials }, ctx) => {
  if (new Set(materials.map(m => m.id)).size !== materials.length) ctx.addIssue({ code: 'custom', message: 'Duplicate material ID' });
  const air = materials.find(m => m.id === 0);
  if (!air || air.solid || air.occludesFaces || air.occludesAo || air.blocksLight || air.surface !== 'air') ctx.addIssue({ code: 'custom', message: 'Material zero must be non-occluding air' });
});
export type MaterialRegistry = z.infer<typeof MaterialRegistrySchema>;

/** x is contiguous: x + size.x * (y + size.y * z). Owned CPU buffers, never a renderer resource. */
export interface VoxelAsset {
  readonly id: string;
  readonly revision: number;
  readonly lattice: VoxelLattice;
  readonly size: Vec3;
  readonly voxels: Uint16Array;
}
export interface ChunkDependency { readonly key: string; readonly revision: number | null }
export interface MeshStamp {
  readonly key: string;
  readonly revision: number;
  readonly materialRevision: number;
  readonly dependencies: readonly ChunkDependency[];
}
/** Palette packed chunk interchange. Missing chunks are unknown, not automatically air. */
export interface PackedVoxelChunk {
  readonly version: 1;
  readonly lattice: VoxelLattice;
  readonly coordinate: Vec3;
  readonly revision: number;
  readonly palette: Uint16Array;
  readonly bits: 0 | 1 | 2 | 4 | 8;
  readonly indices: Uint8Array;
}

export const HomeTierSchema = z.enum(['hut', 'cottage', 'house', 'manor', 'hall']);
export type HomeTier = z.infer<typeof HomeTierSchema>;
export const HOME_DEPTH_METRES = { hut: 8, cottage: 10, house: 12, manor: 14, hall: 16 } as const;
export const RESERVED_LOT_METRES = [8, 20, 16] as const; // width, height, depth

/** Executable source for content; half-open boxes, all coordinates in build cells. */
export const VoxelBoxSchema = z.strictObject({ from: Cell3Schema, to: Cell3Schema, material: MaterialIdSchema });
export const ContentWindowSchema = z.strictObject({
  id: TokenSchema, centre: Cell3Schema, width: z.number().int().positive(), height: z.number().int().positive(),
  facing: z.enum(['north', 'east', 'south', 'west']),
});
/** Authored bench contacts, in build cells at the asset's local origin; not a client sit request. */
export const ContentSeatSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/),
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  approach: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  /** Seated animation root (drawn feet), independent of the authoritative standing approach. */
  rest: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  facing: z.number().int().min(0).max(3),
}).superRefine((seat, ctx) => {
  if ([...seat.position, ...seat.approach, ...seat.rest].some(n => Math.abs(n) > 512))
    ctx.addIssue({ code: 'custom', message: 'Seat anchors must stay in the asset neighbourhood' });
});
export const VoxelBlueprintSchema = z.strictObject({
  version: z.literal(1), id: TokenSchema, styleId: StyleIdSchema,
  kind: z.enum(['home', 'prop', 'civic', 'flora']), lattice: z.literal('build'),
  size: Cell3Schema, boxes: z.array(VoxelBoxSchema).max(20000),
  windows: z.array(ContentWindowSchema).max(64),
  seats: z.array(ContentSeatSchema).max(8).optional(),
}).superRefine((asset, ctx) => {
  if (asset.size.some(n => n < 1 || n > 256)) ctx.addIssue({ code: 'custom', path: ['size'], message: 'Each dimension must be 1..256 build cells' });
  if (asset.size.reduce((n, axis) => n * (axis + 2), 1) > MAX_ASSET_PADDED_CELLS) ctx.addIssue({ code: 'custom', path: ['size'], message: 'Padded asset exceeds allocation budget' });
  for (const [index, box] of asset.boxes.entries()) {
    if (box.from.some((v, d) => v < 0 || v >= box.to[d]! || box.to[d]! > asset.size[d]!)) ctx.addIssue({ code: 'custom', path: ['boxes', index], message: 'Box must be non-empty and inside bounds' });
  }
  if (new Set(asset.windows.map(w => w.id)).size !== asset.windows.length) ctx.addIssue({ code: 'custom', message: 'Window IDs must be unique' });
  if (asset.seats && (asset.kind !== 'civic' || new Set(asset.seats.map(s => s.id)).size !== asset.seats.length))
    ctx.addIssue({ code: 'custom', message: 'Seat anchors belong to civic assets and have unique IDs' });
  for (const window of asset.windows) {
    if (window.centre.some((v, d) => v < 0 || v > asset.size[d]!)) ctx.addIssue({ code: 'custom', message: 'Window centre outside bounds' });
    const horizontal = window.facing === 'north' || window.facing === 'south' ? 0 : 2;
    if (window.centre[horizontal] - window.width / 2 < 0 || window.centre[horizontal] + window.width / 2 > asset.size[horizontal] || window.centre[1] - window.height / 2 < 0 || window.centre[1] + window.height / 2 > asset.size[1]) ctx.addIssue({ code: 'custom', message: 'Whole window must fit inside asset bounds' });
  }
});
export type VoxelBlueprint = z.infer<typeof VoxelBlueprintSchema>;
export type ContentWindow = z.infer<typeof ContentWindowSchema>;

export function cellIndex(x: number, y: number, z: number, sx = CHUNK_SIZE, sy = CHUNK_SIZE): number { return x + sx * (y + sy * z); }
export function splitCell(cell: number): { chunk: number; local: number } {
  if (!Number.isSafeInteger(cell)) throw new Error('Cell coordinate must be a safe integer');
  const chunk = Math.floor(cell / CHUNK_SIZE);
  return { chunk, local: cell - chunk * CHUNK_SIZE };
}
