import type { AudioCue } from '@chatdom/audio';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';

/**
 * A finished piece this person may set into their own plot: a forged gift kept for later, or anything else the
 * kingdom hands them to place. It is placed exactly like a starting shape: the core previews the replacement of its
 * own space, and setting it in is one ordinary, undoable change to the private draft.
 */
export interface BuildPiece {
  readonly id: string;
  /** The piece's own name, as its maker or the Forge gave it. */
  readonly name: string;
  /** One short line of its story, when the data has one ("Forged at Emberwick"). */
  readonly note?: string;
  /** A picture of the piece, when the data has one. Without it the rack draws the piece from its own voxels. */
  readonly picture?: string;
  /** Build-lattice voxels in this plot's style. */
  readonly blueprint: VoxelBlueprint;
  /** Where it stands on this plot, in plot-local build cells. */
  readonly origin: Vec3;
}

/**
 * What the build core lends the rack beyond the frozen controller: the pieces on offer, the core's own preview and
 * insertion of one of them, and the kingdom's sound for presses that change only the rack (a drawer, a choice).
 */
export interface BuildRackBridge {
  /** Pieces the core offers right now. Empty when nothing is offered or the street is not open to building. */
  pieces(): readonly BuildPiece[];
  /** The piece the core is previewing on the plot, if any. Any edit or other preview ends it. */
  previewing(): string | null;
  /** Show (or with `null`, take away) a piece where it would stand. Nothing enters the draft. */
  preview(id: string | null): void;
  /** Set the piece into the draft as one undoable change. False, with the reason in the core's status, if it did not fit. */
  place(id: string): boolean;
  cue(kind: AudioCue): void;
}
