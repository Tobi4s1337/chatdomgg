import type { HomeTier, VoxelBlueprint } from '@chatdom/shared';

export const FAMILIES = ['emberfold', 'bramblecross', 'heatherstead'] as const;
export type HearthFamily = typeof FAMILIES[number];

/** A finished home plus the authored facts its geometry tests hold it to. */
export interface HearthHome {
  readonly blueprint: VoxelBlueprint;
  /** Middle of the open doorway, half-way up, in build cells. Stable for the family. */
  readonly entrance: readonly [number, number, number];
  /** Feet positions inside each ground-floor room that the front door must reach. */
  readonly rooms: readonly (readonly [number, number, number])[];
  /** Load paths that must be solid without a break: [x, z, fromY, toY) columns under porches and hoods. */
  readonly supports: readonly (readonly [number, number, number, number])[];
}

export type FamilyBuilder = (tier: HomeTier) => HearthHome;

export function homeId(family: HearthFamily, tier: HomeTier): string {
  return `home-hearth-${family}-${tier}`;
}

export function unfinished(family: HearthFamily, tier: HomeTier): never {
  throw new Error(`${homeId(family, tier)} is not part of the finished Hearth collection yet.`);
}
