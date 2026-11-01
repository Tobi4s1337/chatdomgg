import type { Vec3 } from './voxel';

/** Absolute metres, on the exact founded plan. Local +Z points from the bank out over the water. */
export interface FishingPierSite {
  readonly version: 1;
  readonly id: 'pier:lake';
  /** Centre of the dry end of the landing, at the actual sampled ground height. */
  readonly root: Vec3;
  readonly turn: 0 | 1 | 2 | 3;
  /** The module datum is the deck top; the short root ramp joins it to root[1]. */
  readonly deckY: number;
  readonly waterY: number;
  /** Length of the narrow walk before the four-metre-deep T-head begins, in metres. */
  readonly walk: number;
  readonly water: 'lake' | 'river' | 'sea';
  readonly biome: string;
  /** Water depth at metre steps from the dry root through the end of the head. Dry samples are zero. */
  readonly depth: readonly number[];
}
