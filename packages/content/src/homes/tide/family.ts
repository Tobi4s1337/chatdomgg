import { HomeTierSchema, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';

export const FAMILIES = ['gullstep', 'saltbend', 'keelcroft'] as const;
export type Family = typeof FAMILIES[number];
/** A finished home and its bench focus: the middle of the real open doorway, in build cells. */
export interface TideHome { blueprint: VoxelBlueprint; entrance: [number, number, number] }

/** Tiers that are not yet authored are refused outright rather than standing in for a finished home. */
export function finished(family: Family, tier: HomeTier, built: readonly HomeTier[]): void {
  if (!HomeTierSchema.options.includes(tier)) throw new Error(`Unknown home tier ${String(tier)}.`);
  if (!built.includes(tier)) throw new Error(`The ${family} ${tier} has not been built for the Tide collection.`);
}
