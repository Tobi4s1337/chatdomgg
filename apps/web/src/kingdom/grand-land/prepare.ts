import type { SettlementPlan } from '@chatdom/world';
import { generateGrandLand } from '../../../../../packages/world/src/grand/generate';
import { frameSettlement, landColumnsFor, seatKingdomOnLand, settlementGround, clearKingdomStructures, type SeatedKingdom } from '../../../../../packages/world/src/grand/kingdom';
import { GRAND_REGION, type GrandLand, type GrandLandSeed } from '../../../../../packages/world/src/grand/types';
import { HOSTED_PAVING } from './palette';

export const HOSTED_GRAND_COMPILER = 'hosted-grand-land-1';

/** These are rendering inputs. Neither the generated mountains nor their height query grant walking support. */
export function seedForInstalledPlan(plan: SettlementPlan, kingdomId?: string): GrandLandSeed {
  const style = plan.homes[0]?.style;
  return {
    seedKey: JSON.stringify(['installed-kingdom', kingdomId ?? null, plan.config.seed]),
    kingdomId: kingdomId ?? plan.config.seed, name: kingdomId ?? plan.config.seed,
    biome: style === 'grove' ? 'woodland' : style === 'tide' ? 'coastal' : 'meadow',
    tier: plan.config.tier, character: plan.genesisSurface?.character ?? 'river-valley',
    minSize: landColumnsFor(frameSettlement(plan)),
  };
}

export interface PreparedGrandLand { readonly land: GrandLand; readonly seated: SeatedKingdom }

/** The installed plan is a constraint on the larger recipe, never regenerated or moved. */
export function prepareInstalledLand(plan: SettlementPlan, seed: GrandLandSeed = seedForInstalledPlan(plan)): PreparedGrandLand {
  const land = generateGrandLand(seed);
  const seated = seatKingdomOnLand(land, plan);
  if (!seated.seat.fits) throw new Error('The grand landscape cannot contain the installed physical region');
  // A clamp or unsupported quantisation would make a different visible floor from the one the server
  // compiled. Compare every adopted column, not just a few anchors or the grade's extrema.
  const ground = settlementGround(plan), [ox, oy, oz] = seated.seat.offset;
  const { x0, z0, x1, z1 } = seated.seat.columns;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const expected = ground.top((x + .5) * .5 - ox, (z + .5) * .5 - oz) + oy;
    if (!Number.isFinite(expected) || Math.abs(land.ground[x + z * land.size]! * .5 - expected) > 1e-6)
      throw new Error('The grand terrain cannot reproduce the installed physical floor');
  }
  const cleared = clearKingdomStructures(land.structures, land.structureCount, seated.sites.reserve);
  return { land: { ...land, structures: cleared.structures, structureCount: cleared.count }, seated };
}

export function regionTouchesPhysical(rx: number, rz: number, seated: SeatedKingdom): boolean {
  const { x0, z0, x1, z1 } = seated.seat.columns;
  return rx * GRAND_REGION < x1 && (rx + 1) * GRAND_REGION > x0
    && rz * GRAND_REGION < z1 && (rz + 1) * GRAND_REGION > z0;
}

/**
 * Correct the voxeliser's cosmetic tufts and apply real paving before meshing, including its halo.
 * Every column in the installed region has exactly the collision compiler's half-metre top.
 * The caller pins intersecting regions to level zero; a coarse representation cannot replace this floor.
 */
export function restoreInstalledFloor(land: GrandLand, seated: SeatedKingdom, cx: number, cy: number, cz: number, volume: Uint8Array): void {
  const pad = 34, columns = seated.seat.columns;
  for (let z = -1; z <= 32; z++) for (let x = -1; x <= 32; x++) {
    const gx = cx * 32 + x, gz = cz * 32 + z;
    if (gx < columns.x0 || gx >= columns.x1 || gz < columns.z0 || gz >= columns.z1) continue;
    const i = gx + gz * land.size, top = land.ground[i]!, water = land.water[i]!;
    for (let y = -1; y <= 32; y++) {
      const gy = cy * 32 + y, k = x + 1 + (y + 1) * pad + (z + 1) * pad * pad;
      if (gy >= top) volume[k] = gy < Math.max(water, land.seaLevel) ? (gy < land.seaLevel || water <= land.seaLevel ? 37 : 36) : 0;
      else if (gy === top - 1 && seated.paved[i]) volume[k] = HOSTED_PAVING;
    }
  }
}

/** Visual sample only, in the native settlement frame. Out-of-recipe positions remain unknown. */
export function installedVisualHeight(land: Pick<GrandLand, 'size' | 'ground'>, seated: SeatedKingdom, x: number, z: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const [ox, oy, oz] = seated.seat.offset, cx = Math.floor((x + ox) * 2), cz = Math.floor((z + oz) * 2);
  return cx < 0 || cz < 0 || cx >= land.size || cz >= land.size ? null : land.ground[cx + cz * land.size]! * .5 - oy;
}
