import type { SettlementPlan } from '../settlement/types';
import { canonicalSceneJson, sha256Hex, utf8 } from '../founded-world/codec';
import { frameSettlement } from './kingdom/frame';
import { landColumnsFor } from './kingdom/seat';
import type { SettlementFrame } from './kingdom/types';
import type { GrandLandSeed } from './types';

/** Persist this at adoption/founding. Never recreate it from the current population. */
export interface GrandLandRecipe {
  readonly version: 1;
  readonly generator: 'grand-land-1';
  readonly kit: 'grand-artisans-1';
  readonly grader: 'gk11-grade-2';
  readonly mesher: 'hosted-grand-land-2';
  readonly seed: GrandLandSeed;
  readonly frame: Pick<SettlementFrame, 'envelope' | 'centre' | 'waterLevel' | 'seaward' | 'castle'>;
}

/** Called once with the selected Genesis profile, not a style guessed from somebody's home. */
export function createGrandLandRecipe(plan: SettlementPlan, profile: Omit<GrandLandSeed, 'minSize'>): GrandLandRecipe {
  if (!profile.kingdomId || !profile.seedKey.includes(profile.kingdomId)) throw new Error('The land recipe needs its full kingdom identity');
  const frame = frameSettlement(plan);
  return freezeGrandLandRecipe({ version: 1, generator: 'grand-land-1', kit: 'grand-artisans-1',
    grader: 'gk11-grade-2', mesher: 'hosted-grand-land-2',
    seed: { ...profile, minSize: landColumnsFor(frame) },
    frame: { envelope: frame.envelope, centre: frame.centre, waterLevel: frame.waterLevel,
      seaward: frame.seaward, castle: frame.castle } });
}

/** Copy before freezing: the caller still owns its scene and profile. */
export function freezeGrandLandRecipe(recipe: GrandLandRecipe): GrandLandRecipe {
  const copy = JSON.parse(canonicalSceneJson(recipe)) as GrandLandRecipe;
  function freeze(value: unknown): void {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  }
  freeze(copy);
  return copy;
}

export function grandLandRecipeHash(recipe: GrandLandRecipe): Promise<string> {
  return sha256Hex(utf8(canonicalSceneJson(recipe)));
}
