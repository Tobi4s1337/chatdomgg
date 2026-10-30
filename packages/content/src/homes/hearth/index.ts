import { HomeTierSchema, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { bramblecross } from './bramblecross';
import { emberfold } from './emberfold';
import { heatherstead } from './heatherstead';
import { FAMILIES, type FamilyBuilder, type HearthHome } from './family';

const BUILDERS: Partial<Record<typeof FAMILIES[number], FamilyBuilder>> = { emberfold, bramblecross, heatherstead };
/** Tiers whose three family forms are finished and reviewed. */
const FINISHED: readonly HomeTier[] = ['hut', 'cottage', 'house'];

export function buildHearthHome(tier: HomeTier, variant: 0 | 1 | 2): HearthHome {
  const parsed = HomeTierSchema.safeParse(tier);
  if (!parsed.success) throw new Error(`Unknown home tier ${String(tier)}.`);
  if (variant !== 0 && variant !== 1 && variant !== 2) throw new Error(`Hearth variant must be 0, 1 or 2, not ${String(variant)}.`);
  const build = BUILDERS[FAMILIES[variant]];
  if (!build) throw new Error(`${FAMILIES[variant]} is not finished.`);
  return build(parsed.data);
}

export function createHearthHome(tier: HomeTier, variant: 0 | 1 | 2): VoxelBlueprint {
  return buildHearthHome(tier, variant).blueprint;
}

const HOMES = FAMILIES.flatMap((family, variant) => !BUILDERS[family] ? [] : FINISHED.map(tier => buildHearthHome(tier, variant as 0 | 1 | 2)));
export const BLUEPRINTS: readonly VoxelBlueprint[] = HOMES.map(home => home.blueprint);
export const HOME_REVIEW: Readonly<Record<string, { entrance: readonly [number, number, number] }>> = Object.fromEntries(HOMES.map(home => [home.blueprint.id, { entrance: home.entrance }]));
