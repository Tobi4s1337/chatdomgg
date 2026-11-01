import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '../founded-world/types';
import type { LandGroundAt } from '../land-interface';
import type { BoundsXZ, CardinalTurn } from '../settlement/types';

/** Stable installed identity, in settlement metres. Local +Z points out across the water. */
export interface PierAnchor {
  readonly id: string;
  readonly root: Vec3;
  readonly turn: CardinalTurn;
  readonly waterY: number;
  /** Metres below water at local z=0,1,...,length. Dry stations have depth 0. */
  readonly depth: readonly number[];
  readonly water: 'lake' | 'river' | 'sea';
  readonly biome: string;
}
export type LandWaterSample = { readonly state: 'dry' } | {
  readonly state: 'wet'; readonly level: number; readonly depth: number;
  readonly kind: PierAnchor['water']; readonly biome: string;
};
export type LandWaterAt = (x: number, z: number) => LandWaterSample | null;
/** A continuous-footprint certificate, not a handful of point samples. shore is a fully known dry/wet mixture;
 * all its wet portions share level/kind/biome. minDepth is the lower bound over wet portions, including zero. */
interface LandWaterCoverageBody {
  readonly level: number; readonly minDepth: number;
  readonly kind: PierAnchor['water']; readonly biome: string;
}
export type LandWaterCoverage = { readonly state: 'dry' }
  | ({ readonly state: 'wet' } & LandWaterCoverageBody) | ({ readonly state: 'shore' } & LandWaterCoverageBody);
/** Immutable actual drawn-water and physical-bed evidence for one installed scene. A plan's lake label alone
 * cannot supply this. null is unknown, never dry; biome must come from the founded producer, never inferred.
 * coverage certifies the entire rectangle (up to its boundary) at one level/kind/biome; unknown/ambiguous is null. */
export interface LandWaterSource extends Pick<RealmFoundedScene, 'layoutRevision' | 'collisionRevision'> {
  readonly sample: LandWaterAt;
  readonly coverage: (bounds: Readonly<BoundsXZ>) => LandWaterCoverage | null;
}
export interface PierSiteCandidate { readonly id: string; readonly root: Vec3; readonly turn: CardinalTurn }
/** Explicit authored geometry. No permanent deck width/length is guessed by the land seam. All distances metres. */
export interface PierPlanningDimensions {
  readonly width: number;
  /** Whole metres, to keep depth[i] exactly i metres from the root. */
  readonly length: number;
  /** Full supported dry landing depth, centred at the root. */
  readonly landingDepth: number;
  /** Local +Z at which the entire deck width must be over water. >= landingDepth/2 and < length. */
  readonly waterStart: number;
  /** Minimum wet depth across the entire wet footprint. */
  readonly minDepth: number;
  /** Minimum root/deck height above the water, without lifting or changing the root. */
  readonly minFreeboard: number;
}
export interface PierSiteContext {
  readonly scene: RealmFoundedScene;
  readonly groundAt: LandGroundAt;
  readonly collision?: CollisionWorld;
  readonly water?: LandWaterSource;
}
export interface PierSitePlanningOptions {
  readonly dimensions: PierPlanningDimensions;
  /** Authored, stable founding order. No live population, current home centroid or random search is used. */
  readonly candidates?: readonly PierSiteCandidate[];
  /** Exact saved anchor. A changed depth/level/kind/biome fails validation; never choose a replacement. */
  readonly pinned?: PierAnchor;
  readonly maxCandidates?: number;
}
export type PierSiteFailure = 'invalid-site' | 'invalid-dimensions' | 'no-collision' | 'no-water-source'
  | 'revision-mismatch' | 'installed-pier' | 'outside-plan' | 'reserved-lot' | 'road-overlap' | 'civic-overlap'
  | 'placement-overlap' | 'invalid-scene' | 'unknown-ground' | 'uneven-ground' | 'no-physical-support'
  | 'solid-overlap' | 'unknown-water' | 'wet-root' | 'dry-deck' | 'nonflat-water' | 'mixed-water'
  | 'invalid-water' | 'shallow-water' | 'insufficient-freeboard' | 'bed-mismatch' | 'pinned-mismatch' | 'budget-exceeded';
export interface PierSiteWork { candidates: number; preparationChecks: number; groundSamples: number; waterSamples: number; coverageQueries: number; collisionQueries: number; collisionBoxes: number; exclusionChecks: number }
export interface PierSiteDiagnostic {
  readonly reason: 'unavailable' | 'pinned-invalid' | 'budget-exceeded'; readonly checked: number;
  readonly rejected: Readonly<Partial<Record<PierSiteFailure, number>>>;
}
export interface PierSitePlan {
  readonly piers: readonly PierAnchor[]; readonly diagnostics: readonly PierSiteDiagnostic[];
  readonly work: Readonly<PierSiteWork>;
}
export const PIER_SITE_BUDGET = Object.freeze({ candidates: 512, groundSamples: 65_536, waterSamples: 65_536,
  coverageQueries: 2_048, collisionQueries: 2_048, collisionBoxes: 4_096, totalCollisionBoxes: 65_536, exclusionChecks: 4_000_000, primitives: 32_768,
  maxWidth: 32, maxLength: 64, maxLandingDepth: 16 });
