import type { GrowthCivicPlace, GrowthHomeStage, GrowthPrivateCitizen, GrowthPrivateState, HomeTier, KingdomId, PersonId } from '@chatdom/shared';
export type { GrowthCivicPlace, GrowthHomeStage, GrowthHomeView } from '@chatdom/shared';

interface GrowthMilestoneEvidence { readonly sourceSeq: number; readonly at: number }
export type GrowthMilestone = GrowthMilestoneEvidence & (
  | { readonly kind: 'home-grown'; readonly personId: PersonId; readonly plotId: string;
      readonly from: GrowthHomeStage; readonly to: HomeTier; readonly qualifiedDays: number }
  | { readonly kind: 'civic-levelled'; readonly place: GrowthCivicPlace; readonly from: number; readonly to: number }
  | { readonly kind: 'streak-reached'; readonly personId: PersonId; readonly days: number }
);

export type GrowthCitizen = GrowthPrivateCitizen;

/** Private durable projection. No chat text, open presence leases or unbounded receipt collection. */
export type GrowthState = GrowthPrivateState;

/** Trusted committed observations only, never a browser command or an unverified Herald payload. */
export interface GrowthObservationBase {
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  /** Canonical durable source sequence; gaps are allowed, reordering is not. */
  readonly seq: number;
  readonly at: number;
}
export type GrowthObservation = GrowthObservationBase & (
  | { readonly type: 'stream-observed'; readonly sessionId: string; readonly startedAt: number }
  | { readonly type: 'presence-qualified'; readonly personId: PersonId; readonly sessionId: string;
      readonly source: 'observed-presence'; readonly coveredMs: number; readonly evidenceReceipt: string }
  | { readonly type: 'home-bound'; readonly personId: PersonId; readonly plotId: string;
      /** Existing adopted homes keep this tier as a floor. Null is a new tent. */
      readonly installedTier: HomeTier | null }
);

export interface GrowthTransition {
  readonly state: GrowthState;
  /** Append beside the source fact; Chronicle and ceremonies never infer them from current totals. */
  readonly milestones: readonly GrowthMilestone[];
}
