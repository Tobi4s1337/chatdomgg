import { HomeTierSchema, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import type { HearthHome } from '../homes/hearth/family';
import { emberfoldGrowth, growthHomeId } from './hearth/emberfold';

export { emberfoldGrowth, growthHomeId };
export const GROWTH_HOME_FAMILIES = ['emberfold'] as const;
export type GrowthHomeFamily = typeof GROWTH_HOME_FAMILIES[number];

/**
 * Street-readable growth lines: each tier is unmistakable from across the lane while the address, the door and
 * every earlier pane stay put. The hut is the family's existing hut; the grown tiers carry a `-v2` id so an
 * installed home only changes when its owner is published a new revision.
 */
export function buildGrowthHome(family: GrowthHomeFamily, tier: HomeTier): HearthHome {
  if (family !== 'emberfold') throw new Error(`Unknown growth home family ${String(family)}.`);
  const parsed = HomeTierSchema.safeParse(tier);
  if (!parsed.success) throw new Error(`Unknown home tier ${String(tier)}.`);
  return emberfoldGrowth(parsed.data);
}

const HOMES = GROWTH_HOME_FAMILIES.flatMap(family => HomeTierSchema.options.map(tier => buildGrowthHome(family, tier)));
/** Family-major, then hut, cottage, house, manor, hall. */
export const GROWTH_HOME_BLUEPRINTS: readonly VoxelBlueprint[] = HOMES.map(home => home.blueprint);
export const GROWTH_HOME_REVIEW: Readonly<Record<string, { entrance: readonly [number, number, number] }>> = Object.fromEntries(HOMES.map(home => [home.blueprint.id, { entrance: home.entrance }]));
/** Standard content-library adapters; they retain the exact authored blueprints. */
export const BLUEPRINTS = GROWTH_HOME_BLUEPRINTS;
export const HOME_REVIEW = GROWTH_HOME_REVIEW;

/** The shared, read-only blueprint for a family's tier; built once when this module loads. */
export function createGrowthHome(family: GrowthHomeFamily, tier: HomeTier): VoxelBlueprint {
  const parsed = HomeTierSchema.safeParse(tier);
  if (!parsed.success) throw new Error(`Unknown home tier ${String(tier)}.`);
  const index = GROWTH_HOME_FAMILIES.indexOf(family);
  if (index < 0) throw new Error(`Unknown growth home family ${String(family)}.`);
  return GROWTH_HOME_BLUEPRINTS[index * HomeTierSchema.options.length + HomeTierSchema.options.indexOf(parsed.data)]!;
}
