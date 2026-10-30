import { HomeTierSchema, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { bramblecross } from './bramblecross';
import { emberfold } from './emberfold';
import { heatherstead } from './heatherstead';
import { FAMILIES, type FamilyBuilder, type HearthHome } from './family';

const BUILDERS: Readonly<Record<typeof FAMILIES[number], FamilyBuilder>> = { emberfold, bramblecross, heatherstead };

export function buildHearthHome(tier: HomeTier, variant: 0 | 1 | 2): HearthHome {
  const parsed = HomeTierSchema.safeParse(tier);
  if (!parsed.success) throw new Error(`Unknown home tier ${String(tier)}.`);
  if (variant !== 0 && variant !== 1 && variant !== 2) throw new Error(`Hearth variant must be 0, 1 or 2, not ${String(variant)}.`);
  return BUILDERS[FAMILIES[variant]](parsed.data);
}

/** Family-major, then the shared tier order: hut, cottage, house, manor, hall. */
const HOMES = FAMILIES.flatMap((_, variant) => HomeTierSchema.options.map(tier => buildHearthHome(tier, variant as 0 | 1 | 2)));
export const BLUEPRINTS: readonly VoxelBlueprint[] = HOMES.map(home => home.blueprint);

/**
 * The finished blueprint for a tier and family. Construction is deterministic, so a street of many homes shares the
 * fifteen built when this module loads instead of rebuilding one per plot; treat the result as read-only.
 */
export function createHearthHome(tier: HomeTier, variant: 0 | 1 | 2): VoxelBlueprint {
  const parsed = HomeTierSchema.safeParse(tier);
  if (!parsed.success) throw new Error(`Unknown home tier ${String(tier)}.`);
  if (variant !== 0 && variant !== 1 && variant !== 2) throw new Error(`Hearth variant must be 0, 1 or 2, not ${String(variant)}.`);
  return BLUEPRINTS[variant * HomeTierSchema.options.length + HomeTierSchema.options.indexOf(parsed.data)]!;
}
export const HOME_REVIEW: Readonly<Record<string, { entrance: readonly [number, number, number] }>> = Object.fromEntries(HOMES.map(home => [home.blueprint.id, { entrance: home.entrance }]));
