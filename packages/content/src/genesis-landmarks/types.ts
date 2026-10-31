import type { Vec3, VoxelBlueprint } from '@chatdom/shared';

/**
 * Genesis landmark pieces: one strict `VoxelBlueprint` plus the honest local metadata a host needs to ground,
 * validate and mount it. Every coordinate is in local build cells (0.125 m) measured from the blueprint's
 * (0,0,0) corner, which is the placement origin. The door is always on the local front, +Z ("south" in the
 * window convention). A placement turns the piece by whole positive-Y quarter turns about that corner, where
 * turn 1 maps local +Z to world +X (as `turnBox` in the water places and `CardinalTurn` in the recipe).
 *
 * Nothing here asserts a valid placement, ground contact, a walkable route, a person or a lit window. These are
 * the measured planes main checks against its sampled ground and its own placement rules.
 */
export type CellBox = { readonly from: Vec3; readonly to: Vec3 };
export type LocalFacing = 'north' | 'south' | 'east' | 'west';

/** Where the piece bears on its foundation. `embed` cells of it may be sunk into rising ground. */
export interface LandmarkFooting { readonly id: string; readonly box: CellBox; readonly embed: number }

/**
 * A continuous walking surface. `across` is the half-open lateral extent of the clear strip on the other
 * horizontal axis; `tops[i]` is the walking height (top of the supporting cell, in cells) over cell
 * `along[0] + i`. Adjacent tops never differ by more than one cell. A strip may run past the blueprint's bounds
 * onto the host's ground, where its tops are the ground heights the host must provide.
 */
export interface LandmarkWalk {
  readonly id: string;
  readonly axis: 'x' | 'z';
  readonly along: readonly [number, number];
  readonly across: readonly [number, number];
  readonly tops: readonly number[];
}

/**
 * A doorway: the open reveal in front of a closed leaf, the sill height, and the approach that reaches it from
 * the ground. `clearance` must remain air after placement (terrain, props and other content included); it
 * reaches past the blueprint's front so main can test it against its own ground. The leaf is closed. Opening it,
 * entering and any interior belong to the host and do not exist yet.
 */
export interface LandmarkDoorway {
  readonly id: string;
  readonly facing: LocalFacing;
  /** The open reveal, from the outer face of the door case back to the leaf. */
  readonly opening: CellBox;
  /** The closed timber leaf. */
  readonly leaf: CellBox;
  /** Walking height of the sill, in cells. */
  readonly threshold: number;
  /** From the leaf out across the steps and onto `groundAt` cells of ground. */
  readonly approach: LandmarkWalk;
  /** The air the approach needs: the approach strip, head height above it, and the ground run beyond. */
  readonly clearance: CellBox;
  /** Height of the ground the approach expects at its outer end, in cells above the piece's y = 0. */
  readonly groundAt: number;
  readonly state: 'closed';
}

/** A sitting edge: the top face of `box` is the seat, and a sitter's legs hang towards `facing`. */
export interface LandmarkSeat { readonly id: string; readonly box: CellBox; readonly facing: LocalFacing }

export type EmitterKind = 'beacon' | 'lantern';
/** Where a physical flame or lamp sits. Content never lights it; the host feeds its own light result. */
export interface LandmarkEmitter { readonly id: string; readonly kind: EmitterKind; readonly position: Vec3; readonly reach: number }

export type LandmarkSoundKind = 'beacon-fire' | 'flag' | 'surf' | 'rope-creak' | 'river' | 'bell' | 'mill-wheel' | 'wind';
/** A point for the host's audio mix. Content supplies the hook only; it never plays sound. */
export interface LandmarkSound { readonly id: string; readonly kind: LandmarkSoundKind; readonly position: Vec3 }

/** A pivot for a moving part. `position` is the exact pivot in cells; `axis` is the unit axis in local space. */
export interface LandmarkMount { readonly id: string; readonly position: Vec3; readonly axis: Vec3 }

export type ClearRole =
  | 'doorway' | 'approach' | 'lookout' | 'flag-swing' | 'beacon-flame' | 'waterway' | 'bell-swing' | 'wheel-sweep'
  /** The playing surface of a board: nothing stands on it but what a host sets down. */
  | 'board'
  /** Land held for a building not yet raised: only the setting-out markers stand in it. */
  | 'reserve';
/** A volume that must stay air in the piece itself, and in anything the host puts around it. */
export interface LandmarkClear { readonly id: string; readonly role: ClearRole; readonly box: CellBox }

/**
 * Interactions the piece is drawn to support, described for the host rather than performed here. Each names
 * the anchor geometry it uses and what the host must still provide before it is real.
 */
export interface LandmarkAffordance {
  readonly id: string;
  readonly kind: 'enter' | 'sit' | 'tend-beacon' | 'look-out' | 'ring-bell' | 'play-board' | 'raise-cathedral';
  readonly uses: readonly string[];
  readonly status: 'needs-host';
  readonly requires: string;
}

/**
 * A moving part drawn as its own blueprint and hung on one of the piece's mounts (the flag on its hoist). At rest
 * the part's local origin sits at `offset` in the piece's cells; `pivot` is the mount's point in the part's own
 * cells, about which the host turns it on the mount's axis. A host that does not animate it mounts it at rest.
 */
export interface LandmarkPart {
  readonly id: string;
  readonly blueprint: VoxelBlueprint;
  readonly mount: string;
  readonly offset: Vec3;
  readonly pivot: Vec3;
}

/**
 * The water a piece stands in, for a piece whose y = 0 is a river bed rather than dry ground. `level` is the water
 * surface the piece is drawn for and `bank` the ground height it expects at both abutments, both in cells above
 * y = 0. `channel` is the clear waterway between the abutments, through the arches.
 */
export interface LandmarkWater { readonly level: number; readonly bank: number; readonly channel: CellBox }

/**
 * One glazed pane, in the shape of a content window (`centre` on the glass's outer face, `width` across the face,
 * `height`, outward `facing`), so a host can hand the hall's glass to its window lights. Panes of one opening share
 * its `opening` id; a stepped head is several panes. Content never lights them: a host lights them only from real
 * presence in the room behind.
 */
export interface LandmarkGlazing {
  readonly id: string;
  readonly opening: string;
  readonly centre: Vec3;
  readonly width: number;
  readonly height: number;
  readonly facing: LocalFacing;
}

export interface LandmarkPiece {
  readonly blueprint: VoxelBlueprint;
  readonly parts: readonly LandmarkPart[];
  /** Occupied bounds, measured from the authored boxes. */
  readonly extent: CellBox;
  readonly footings: readonly LandmarkFooting[];
  readonly doorways: readonly LandmarkDoorway[];
  readonly walks: readonly LandmarkWalk[];
  readonly seats: readonly LandmarkSeat[];
  readonly emitters: readonly LandmarkEmitter[];
  readonly sounds: readonly LandmarkSound[];
  readonly mounts: readonly LandmarkMount[];
  readonly clear: readonly LandmarkClear[];
  readonly affordances: readonly LandmarkAffordance[];
  /** Glass a host may light from presence; absent on a piece whose glass is all lamps. */
  readonly glazing?: readonly LandmarkGlazing[];
  /** Present only on a piece that stands in water. */
  readonly water?: LandmarkWater;
}
