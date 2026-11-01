import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../materials';

/**
 * One authored piece of The_AGGman's coastal hamlet, in its own local frame: build cells (0.125 m), x right,
 * y up, +Z the front (the face that looks onto the street, quay or sea, as each factory documents), origin at
 * the blueprint's (0,0,0) corner and y = 0 the ground contact (the keel bottom for a floating hull). The host
 * turns pieces only by whole quarter turns about that corner and supplies every world position.
 */
export interface AggmanPiece {
  readonly blueprint: VoxelBlueprint;
  /** Lantern glass cells the host lights as warm keeper lamps (never presence). Local build cells. */
  readonly lanterns: readonly Vec3[];
  /** Ground contact, local build cells, half-open: x in [from[0], to[0]), z in [from[1], to[1]). */
  readonly footprint: { readonly from: readonly [number, number]; readonly to: readonly [number, number] };
  /** Floating pieces only: whole cells from y = 0 up to the waterline. */
  readonly draft?: number;
}

/**
 * The kingdom's livery: registered materials chosen by snapping the channel's four profile colour targets
 * (#C91709, #F8AE04, #FE9E79, #075E86) to the heraldic tinctures. A proposal from public profile colours, never
 * approved channel branding. Factories take the livery as an argument and never hard-code a dye.
 */
export interface Livery {
  /** Field of the arms: sails, banners, awnings. */
  readonly red: number;
  /** The gold accent: stripes, pennant tips, painted strakes. */
  readonly gold: number;
  /** The arms' charge (the peach target snaps to cream): the wave, lettering, sail bands. */
  readonly cream: number;
  /** The deep-blue target: hulls, shutters, doors. */
  readonly blue: number;
  /** Border and fittings. */
  readonly brass: number;
}

/** The_AGGman's livery as the heraldry snapper resolves it (tested against `composeGenesisHeraldry`). */
export const AGGMAN_LIVERY: Livery = Object.freeze({
  red: MAT.fabricRed, gold: MAT.fabricGold, cream: MAT.cream, blue: MAT.fabricBlue, brass: MAT.brass,
});
