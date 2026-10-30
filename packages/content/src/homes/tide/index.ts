import { HomeTierSchema, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { FAMILIES, type Family, type TideHome } from './family';
import { gullstep } from './gullstep';
import { keelcroft } from './keelcroft';
import { saltbend } from './saltbend';

const BUILDERS: Readonly<Record<Family, (tier: HomeTier) => TideHome>> = { gullstep, saltbend, keelcroft };
/** Tiers finished for every family, in the shared tier order. */
const READY: readonly HomeTier[] = ['hut', 'cottage', 'house', 'manor', 'hall'];

function build(tier: HomeTier, variant: 0 | 1 | 2): TideHome {
  if (!HomeTierSchema.safeParse(tier).success) throw new Error(`Unknown home tier ${String(tier)}.`);
  if (variant !== 0 && variant !== 1 && variant !== 2) throw new Error(`Tide family variant must be 0, 1 or 2, not ${String(variant)}.`);
  return BUILDERS[FAMILIES[variant]](tier);
}

/** Family-major, then the shared tier order. Only finished homes are listed. */
const HOMES = FAMILIES.flatMap((_, variant) => READY.map(tier => build(tier, variant as 0 | 1 | 2)));
export const BLUEPRINTS: readonly VoxelBlueprint[] = HOMES.map(home => home.blueprint);

/** Builds one Salt & slate home: gullstep, saltbend or keelcroft (variants 0, 1, 2) at an earned tier. */
export function createTideHome(tier: HomeTier, variant: 0 | 1 | 2): VoxelBlueprint {
  return build(tier, variant).blueprint;
}

/** Bench-only doorway focus for every finished blueprint; not navigation authority or blueprint metadata. */
export const HOME_REVIEW: Readonly<Record<string, { entrance: readonly [number, number, number] }>> =
  Object.fromEntries(HOMES.map(home => [home.blueprint.id, { entrance: home.entrance }]));
