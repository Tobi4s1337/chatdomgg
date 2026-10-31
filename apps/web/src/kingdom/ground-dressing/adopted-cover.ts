import type { SettlementPlan } from '@chatdom/world';
import { pieceRole, planGroundDressing, type GroundDressingInput, type GroundDressingPlan } from './plan';

/**
 * Passive planting and flush stepping stones over the already adopted streets. No replacement land, invented sites or new solid occupancy:
 * rocks and future garden structures enter only with their authoritative collision composition.
 */
export function planAdoptedCover(plan: SettlementPlan,
  input: Omit<GroundDressingInput, 'land' | 'seed' | 'tier'>): GroundDressingPlan {
  const dressed = planGroundDressing({ ...input, seed: plan.config.seed, tier: plan.config.tier,
    land: { plan, sites: [], places: { court: { boundary: plan.castle.court.boundary } } } });
  const pieces = new Map([...dressed.pieces].filter(([, placements]) => {
    const role = pieceRole(placements[0]!.blueprint);
    return !role.solid && (role.cover || role.form === 'stepping-stones');
  }));
  return { pieces, blockers: [], collisionPieces: [], seatAnchors: [],
    report: { ...dressed.report, counts: Object.fromEntries([...pieces].map(([id, placements]) => [id, placements.length])) } };
}
