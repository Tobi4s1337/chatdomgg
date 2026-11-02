/** Offline producer helpers. Browser readers import codec.ts, never this module. */
import type { SettlementPlan } from '../../settlement/types';
import { canonicalSceneJson, sha256Hex, utf8 } from '../../founded-world/codec';
import { grandLandRecipeHash, type GrandLandRecipe } from '../recipe';
import { landMaterials } from '../kits';
import { GrandKind } from '../palette';
import { regionTouchesPhysical, type PreparedGrandLand } from './prepare';
import { BAKED_COMPILERS, BAKED_FORMAT, HOSTED_PAVING, type BakedBlobRef, type BakedIdentity, type BakedMetadata, type BakedRegionRef } from './types';
import { encodeBakedMetadata, decodeBakedMetadata } from './metadata-codec';

export async function identityForBakedLand(plan: SettlementPlan, recipe: GrandLandRecipe): Promise<BakedIdentity> {
  return Object.freeze({ kingdomId: recipe.seed.kingdomId, recipeHash: await grandLandRecipeHash(recipe),
    sourcePlanHash: await sha256Hex(utf8(canonicalSceneJson(plan))), sourcePlanRevision: plan.revision });
}
export function createBakedMetadata(prepared: PreparedGrandLand, identity: BakedIdentity,
  surface: BakedBlobRef, meshes: readonly BakedRegionRef[]): BakedMetadata {
  const { land, seated } = prepared, { size, height, seaLevel } = land, [ox, oy, oz] = seated.seat.offset;
  if (identity.kingdomId !== land.seed.kingdomId || identity.sourcePlanRevision !== seated.identity.planRevision)
    throw new Error('Baked identity does not match prepared land');
  const per = size / 256;
  const regions = Array.from({ length: per ** 2 }, (_, i) => {
    const rx = i % per, rz = Math.floor(i / per), refs = meshes.filter(m => m.rx === rx && m.rz === rz).sort((a, b) => a.level - b.level);
    const low = Math.min(...refs.map(r => r.minY * (1 << r.level))), high = Math.max(...refs.map(r => r.maxY * (1 << r.level)));
    return { rx, rz, exact: regionTouchesPhysical(rx, rz, seated),
      bounds: { min: [rx * 128 - ox, low * .5 - oy, rz * 128 - oz] as const,
        max: [(rx + 1) * 128 - ox, high * .5 - oy, (rz + 1) * 128 - oz] as const }, meshes: refs };
  });
  if (regions.reduce((sum, r) => sum + r.meshes.length, 0) !== meshes.length) throw new RangeError('Baked mesh lies outside the land');
  // Explicit projection. Seated data contains paved masks, debug timings and the generator's private inputs.
  return decodeBakedMetadata(encodeBakedMetadata({ version: BAKED_FORMAT, ...identity, compilers: BAKED_COMPILERS,
    size, height, seaLevel, seat: { offset: seated.seat.offset, columns: seated.seat.columns, band: seated.seat.band },
    physicalRegion: seated.identity.region,
    bounds: { min: [-ox, -oy, -oz], max: [size * .5 - ox, height * .5 - oy, size * .5 - oz] },
    palette: [...landMaterials(land).filter(m => m.id !== HOSTED_PAVING), { id: HOSTED_PAVING, colour: '#9b9483', kind: GrandKind.stone }].sort((a, b) => a.id - b.id),
    surface, regions }));
}
