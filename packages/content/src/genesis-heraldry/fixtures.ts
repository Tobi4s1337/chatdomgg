/**
 * Profile colour targets for the three composition targets, in source preference order: the palette proposals
 * main derived from each public Twitch profile image (`apps/web/src/genesis/channels.ts`, captured
 * 2026-10-31T13:07:42.905Z). They are targets, not approved channel colours; the observed recipe fixtures carry none,
 * so tests and the bench add them to the facts to exercise snapping. Keyed by broadcaster id, in the order of
 * `OBSERVED_GENESIS_FIXTURES`.
 */
export const PROFILE_TARGETS: Readonly<Record<string, readonly string[]>> = {
  /** The_AGGman */
  '63920635': ['#C91709', '#F8AE04', '#FE9E79', '#075E86'],
  /** PinkKittyRose */
  '4363967': ['#8753DA', '#651E8C', '#74604C', '#4E125E'],
  /** MashaD4 */
  '154972160': ['#514A98', '#87746F', '#6E5A65', '#3945D8'],
};
