import type { Vec3, VoxelBlueprint } from '@chatdom/shared';

/**
 * Lane-local metadata for the castle court, Lookout Hill and forest-edge pieces. Every coordinate is in local build
 * cells (0.125 m) from the blueprint's (0,0,0) corner, which is the placement origin. Static pieces only turn by
 * whole quarter turns about that corner (yaw = turn * PI/2; turn 1 maps local +Z to +X). Nothing here names a
 * person, claims presence or lights a lamp: the host supplies those through their owners.
 */
export type CellBox = { readonly from: Vec3; readonly to: Vec3 };
export type Facing = 'north' | 'south' | 'east' | 'west';
export type CardinalTurn = 0 | 1 | 2 | 3;

/** Where the piece bears on its foundation at local y = 0 (court flags, ground or a supplied wall-walk). */
export interface Footing { readonly id: string; readonly box: CellBox }

/**
 * A walkable top: every column in `box` (x/z extent) is solid at `top - 1` and clear for a citizen above it.
 * `top` is in cells from the piece origin.
 */
export interface WalkSurface { readonly id: string; readonly box: CellBox; readonly top: number }

/** A seat: the top face of `box` is the sitting surface; a sitter faces `facing`. */
export interface SeatEdge { readonly id: string; readonly box: CellBox; readonly facing: Facing }

/**
 * An honest place to stand and act. The host owns any prompt and its receipt; content only says where a citizen
 * stands (`stand`, on the walk surface) and what they face (`look`). No reward or success is implied.
 */
export interface InteractionAnchor {
  readonly id: string;
  readonly kind: 'draw-water' | 'read-crest' | 'sit' | 'lean' | 'look';
  readonly stand: Vec3;
  readonly look: Vec3;
}

/** A flat face reserved for host-drawn text: the centre lies on the face, `facing` is its outward normal. */
export interface TextPlane { readonly id: string; readonly centre: Vec3; readonly facing: Facing; readonly width: number; readonly height: number }

export interface PlacePiece {
  readonly blueprint: VoxelBlueprint;
  readonly footings: readonly Footing[];
  readonly walks: readonly WalkSurface[];
  readonly seats: readonly SeatEdge[];
  readonly interactions: readonly InteractionAnchor[];
  readonly texts: readonly TextPlane[];
}

/** One placed piece of an assembly, in world metres. `position` is the blueprint origin; yaw = turn * PI/2. */
export interface PlacePlacement {
  readonly id: string;
  readonly blueprint: VoxelBlueprint;
  readonly position: Vec3;
  readonly turn: CardinalTurn;
  /** Whether the piece casts sun shadows and blocks the light field like the castle (false for flat floors). */
  readonly blocker: boolean;
}

/** An XZ rectangle in world metres that the assembly keeps free of its own pieces. */
export interface KeepClear { readonly id: string; readonly reason: string; readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
