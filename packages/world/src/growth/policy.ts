import type { HomeTier } from '@chatdom/shared';
import type { GrowthCivicPlace } from './types';

/** Proposed balance, not founder decisions. Changing any threshold requires a new policy version. */
export const GROWTH_POLICY_V1 = Object.freeze({
  version: 1 as const,
  qualifiedPresenceMs: 600_000,
  streamDayMs: 86_400_000,
  homeDays: Object.freeze({ hut: 3, cottage: 7, house: 30, manor: 90, hall: 180 } satisfies Record<HomeTier, number>),
  /** Founded places start at level 1. Further levels are earned by distinct qualified stream-days. */
  civicDays: Object.freeze({
    tavern: Object.freeze([7, 30, 90]),
    forge: Object.freeze([14, 45, 120]),
    market: Object.freeze([21, 60, 150]),
    bridge: Object.freeze([28, 75, 180]),
    'castle-court': Object.freeze([35, 90, 210]),
  } satisfies Record<GrowthCivicPlace, readonly number[]>),
  streakMilestones: Object.freeze([3, 7, 14, 30, 60, 90, 180, 365]),
});

export const GROWTH_HOME_TIERS: readonly HomeTier[] = Object.freeze(['hut', 'cottage', 'house', 'manor', 'hall']);
export const GROWTH_CIVIC_PLACES: readonly GrowthCivicPlace[] = Object.freeze(['tavern', 'forge', 'market', 'bridge', 'castle-court']);
