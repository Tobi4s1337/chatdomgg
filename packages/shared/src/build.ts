import { z } from 'zod';
import { TokenSchema, UIntSchema } from './identity';
import { Cell3Schema, MaterialIdSchema, StyleIdSchema, type Vec3 } from './voxel';

/** First editable-plot consumer. Cells are .125m, front is +Z; the reserve never moves. */
export const HOME_BUILD_LIMITS = {
  hut: { height: 48, maxVoxels: 32768 }, cottage: { height: 64, maxVoxels: 49152 },
  house: { height: 88, maxVoxels: 81920 }, manor: { height: 120, maxVoxels: 131072 },
  hall: { height: 160, maxVoxels: 196608 },
} as const;
export const BUILD_BRUSH_CELLS = [4, 2, 1] as const;
export const BuildMirrorSchema = z.enum(['x', 'z', 'xz']);
export type BuildMirror = z.infer<typeof BuildMirrorSchema>;
const box = { from: Cell3Schema, to: Cell3Schema, mirror: BuildMirrorSchema.optional() };
export const BuildOperationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('place'), ...box, material: MaterialIdSchema.min(1) }),
  z.strictObject({ kind: z.literal('erase'), ...box }),
  z.strictObject({ kind: z.literal('paint'), ...box, material: MaterialIdSchema.min(1) }),
  z.strictObject({ kind: z.literal('fill'), at: Cell3Schema, material: MaterialIdSchema, mirror: BuildMirrorSchema.optional() }),
]);
export type BuildOperation = z.infer<typeof BuildOperationSchema>;
/** Issued by the owning draft authority; never taken from an imported file or saved draft. */
export interface BuildDraftPolicy {
  plotId: string; ownerId: string; styleId: z.infer<typeof StyleIdSchema>; size: Vec3;
  editableFrom: Vec3; editableTo: Vec3; maxVoxels: number; palette: readonly number[];
  shaping: { wall: readonly number[]; roof: readonly number[]; trim: number; stone: number; glass: number };
}
/** Canonical non-air x-fastest runs. Validation against policy belongs to the draft core. */
export const BuildDraftSnapshotSchema = z.strictObject({
  version: z.literal(1), plotId: TokenSchema, ownerId: TokenSchema, styleId: StyleIdSchema,
  size: Cell3Schema, revision: UIntSchema,
  runs: z.array(z.tuple([UIntSchema, UIntSchema.min(1), MaterialIdSchema.min(1)])).max(196608),
});
export type BuildDraftSnapshot = z.infer<typeof BuildDraftSnapshotSchema>;

export type BuildTool = 'place' | 'erase' | 'paint' | 'fill';
export interface BuildToolsState {
  tool: BuildTool; material: number; brush: 1 | 2 | 4; mirror: BuildMirror | null;
  occupied: number; budget: number; canUndo: boolean; canRedo: boolean; dirty: boolean;
  status: string; publishing: boolean; mode: 'SIMULATED' | 'LIVE';
  materials: readonly { id: number; name: string; colour: string }[];
}
/** View-only controller: tools never pick geometry, mutate voxels or assert ownership. */
export interface BuildToolsController {
  snapshot(): BuildToolsState;
  subscribe(listener: (state: BuildToolsState) => void): () => void;
  tool(value: BuildTool): void; material(value: number): void; brush(value: 1 | 2 | 4): void;
  mirror(value: BuildMirror | null): void; undo(): void; redo(): void;
  publish(): Promise<void>; leave(): void;
}
