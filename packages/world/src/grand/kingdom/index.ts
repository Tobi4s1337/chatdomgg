import type { SettlementPlan } from '../../settlement/types';
import { frameSettlement, settlementGround } from './frame';
import { gradeSettlement, type GradeReport } from './grade';
import { seatSettlement, type SeatChoice } from './seat';
import { kingdomSites, type KingdomSites } from './sites';
import type { GrandField, GrandFieldSites, SettlementFrame } from './types';

export * from './types';
export { frameSettlement, settlementGround, settlementWater, pavingMask, PHYSICAL_CHUNK_METRES } from './frame';
export { LAND_COLUMNS_CAP, landColumnsFor, seatSettlement, toLand, toSettlement, SEAT_BAND_METRES, type SeatChoice } from './seat';
export { gradeSettlement, CASTLE_CRAG_REACH, type GradeReport } from './grade';
export { grandGroundSource, grandKingdomLand } from './ground';
export { kingdomSites, clearKingdomStructures, STRUCTURE_STRIDE, type KingdomSites, type KingdomReserve } from './sites';

export interface SeatedKingdom {
  readonly seat: SeatChoice;
  readonly grade: Omit<GradeReport, 'pavedMask'>;
  /** Paved public ground per land column (1 = setts), for the voxeliser. */
  readonly paved: Uint8Array;
  /** The town and castle as drawn, in land columns, and the columns the land's composers keep clear of. */
  readonly sites: KingdomSites;
  /** What this seating was made from and by, so an adopter can tell two seated lands apart without their bytes. */
  readonly identity: { readonly grader: typeof KINGDOM_GRADER; readonly planRevision: SettlementPlan['revision']; readonly seed: string; readonly region: SettlementFrame['region'] };
}

/** The grading recipe's version; it changes whenever the same land and plan would grade to different columns. */
export const KINGDOM_GRADER = 'gk11-grade-3' as const;

/**
 * The one call the land worker makes after raising a land: frame the settlement, seat it, write its exact ground,
 * waters and paving into the land's columns and ease the land around it. The land is changed in place and stays a
 * plain transferable land; the returned seat travels with it so the renderer draws the town at `seat.offset`.
 */
export function seatKingdomOnLand(field: GrandField & { readonly sites: Pick<GrandFieldSites, 'town' | 'harbour'> }, plan: SettlementPlan,
  frozenFrame?: Pick<SettlementFrame, 'envelope' | 'centre' | 'waterLevel' | 'seaward' | 'castle'>): SeatedKingdom {
  const frame = { ...frameSettlement(plan), ...frozenFrame };
  if (frame.region.minX < frame.envelope.minX || frame.region.maxX > frame.envelope.maxX
    || frame.region.minZ < frame.envelope.minZ || frame.region.maxZ > frame.envelope.maxZ)
    throw new Error('The installed region exceeds its founded land reservation');
  const seat = seatSettlement(field, field.sites, frame);
  const { pavedMask, ...grade } = gradeSettlement(field, seat, settlementGround(plan, frame.region), frame.castle.bounds);
  return {
    seat, grade, paved: pavedMask, sites: kingdomSites(field, seat, frame),
    identity: { grader: KINGDOM_GRADER, planRevision: plan.revision, seed: plan.config.seed, region: frame.region },
  };
}
