import type { Vec3, VoxelBlueprint } from '@chatdom/shared';

/** The cloth a generated kingdom flies: registered material IDs snapped from its arms, never a free colour. */
export interface PieceColours {
  readonly field: number;
  readonly charge: number;
  readonly border: number;
}

export interface PieceOptions {
  readonly style: 'hearth' | 'tide' | 'grove';
  readonly colours: PieceColours;
  /** A 32-bit seed from the channel's recipe: variants, counts and small irregularities, never identity. */
  readonly seed: number;
}

/**
 * A generated kingdom's own landmark, in the build lattice (0.125 m cells), front +Z, origin at the (0,0,0) corner.
 * `lanterns` are cells holding a flame or a lit lamp (the host lights them); `footprint` is the ground it stands on,
 * in cells (x, z), for grounding and clearance. Nothing here asserts a valid site.
 */
export interface GeneratedPiece {
  readonly blueprint: VoxelBlueprint;
  readonly lanterns: readonly Vec3[];
  readonly footprint: { readonly from: readonly [number, number]; readonly to: readonly [number, number] };
}
