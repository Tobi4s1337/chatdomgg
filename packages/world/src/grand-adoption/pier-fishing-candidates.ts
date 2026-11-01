import { VOXEL_METRES } from '@chatdom/shared';
import { seedHash } from '../seed';
import { transformCardinalPoint } from '../settlement/geometry';
import type { CardinalTurn, SettlementPlan } from '../settlement/types';
import type { LandGroundAt } from '../land-interface';
import type { FishingPierGeometry } from './pier-fishing-proposal';

const LATERALS = [0, 4, -4, 8, -8, 12, -12, 16, -16] as const;
const BACK = [1, 1.25, 1.5, 1.75, 2] as const;
const WALK = [20, 16, 12] as const;
export const FISHING_PIER_CANDIDATE_BUDGET = Object.freeze({ candidates: 540, shoreSamples: 65_536, raySteps: 2_048 });

/** The fishing producer's authored candidate order, before its approximate support filter. A shoreline hint
 * only finds proposals; it never certifies drawn water, a walkable root, the T-head or the casting area.
 * Validate the exact factory pieces against every adopted water surface, then persist the first valid result.
 * An existing installation or saved certificate must be revalidated directly, never searched again. */
export function* fishingPierCandidates(plan: SettlementPlan, groundAt: LandGroundAt,
  shoreHint: (x: number, z: number) => number | null): Generator<FishingPierGeometry> {
  const lake = plan.landform.lake, unit = VOXEL_METRES.build;
  if (![lake.x, lake.z, lake.radiusX, lake.radiusZ, lake.level].every(Number.isFinite)
    || lake.radiusX < 8 || lake.radiusZ < 8) return;
  const turnStart = seedHash(`${plan.config.seed}:fishing-pier`) % 4;
  let samples = 0;
  for (let offset = 0; offset < 4; offset++) {
    const turn = ((turnStart + offset) % 4) as CardinalTurn;
    const forward = transformCardinalPoint([0, 0, 0], turn, [0, 0, 1]);
    const right = transformCardinalPoint([0, 0, 0], turn, [1, 0, 0]);
    const reach = (Math.abs(forward[0]) ? lake.radiusX : lake.radiusZ) * 1.45;
    if (Math.ceil(reach / .25) > FISHING_PIER_CANDIDATE_BUDGET.raySteps) throw new RangeError('Pier shoreline ray exceeds its budget');
    for (const lateral of LATERALS) {
      let shore: readonly [number, number] | undefined;
      for (let distance = -reach; distance < 0; distance += .25) {
        if (++samples > FISHING_PIER_CANDIDATE_BUDGET.shoreSamples) throw new RangeError('Pier shoreline sample budget exhausted');
        const x = lake.x + right[0] * lateral + forward[0] * distance;
        const z = lake.z + right[2] * lateral + forward[2] * distance;
        const level = shoreHint(x, z);
        if (level !== null && Number.isFinite(level) && Math.abs(level - lake.level) < 1e-6) { shore = [x, z]; break; }
      }
      if (!shore) continue;
      for (const back of BACK) {
        const x = Math.round((shore[0] - forward[0] * back) / unit) * unit;
        const z = Math.round((shore[1] - forward[2] * back) / unit) * unit;
        const root = groundAt(x, z);
        if (!root || root[0] !== x || root[2] !== z || !root.every(Number.isFinite)) continue;
        for (const walk of WALK) yield { version: 1, id: 'pier:lake', root, turn,
          deckY: lake.level + .75, waterY: lake.level, walk, water: 'lake' };
      }
    }
  }
}
