import type { SettlementPlan } from '@chatdom/world';
import { pieceRole, planGroundDressing, type GroundDressingInput, type GroundDressingPlan } from './plan';

/**
 * Planting over the already adopted streets: cover, beds and the flush stepping stones walked over. No replacement
 * land or invented sites. Solid garden pieces (back fences, vignettes, field runs, rocks) join only with `solids`,
 * which the integrator sets once it binds the returned `blockers` to the light field and `collisionPieces` to citizen
 * and camera clearance; until then the adopted scene gains no unbound solid.
 */
export function planAdoptedCover(plan: SettlementPlan,
  input: Omit<GroundDressingInput, 'land' | 'seed' | 'tier'>, { solids = false }: { solids?: boolean } = {}): GroundDressingPlan {
  const dressed = planGroundDressing({ ...input, seed: plan.config.seed, tier: plan.config.tier,
    land: { plan, sites: [], places: { court: { boundary: plan.castle.court.boundary } } } });
  if (solids) return dressed;
  const pieces = new Map([...dressed.pieces].filter(([, placements]) => !pieceRole(placements[0]!.blueprint).solid));
  return { pieces, blockers: [], collisionPieces: [], seatAnchors: [],
    report: { ...dressed.report, counts: Object.fromEntries([...pieces].map(([id, placements]) => [id, placements.length])) } };
}

/** The scene's keep-out around the plan's lake, as it passes to the planner on every land. */
export function lakeKeepOut(plan: SettlementPlan): (x: number, z: number, margin: number) => boolean {
  const lake = plan.lake;
  return (x, z, margin) => Math.hypot((x - lake.x) / (lake.radiusX + margin), (z - lake.z) / (lake.radiusZ + margin)) < 1.19;
}
