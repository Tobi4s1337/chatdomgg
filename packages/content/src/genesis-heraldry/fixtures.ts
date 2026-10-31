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

/** Public display names of the three composition targets, for bench plates only (from the same public metadata). */
export const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  '63920635': 'The_AGGman',
  '4363967': 'PinkKittyRose',
  '154972160': 'MashaD4',
};

/**
 * The landscape a showcase selects, named by its character (spec 39's `OBSERVED_GENESIS_SHOWCASE_CHOICES`): the
 * recipe's one candidate of that character, chosen explicitly. Two of the three are not the recommendation.
 */
export function selectLandscape<L extends { readonly id: string; readonly character: string }>(landscapes: readonly L[], character: string): L {
  const matches = landscapes.filter(land => land.character === character);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${character} candidate, found ${matches.length}.`);
  return matches[0]!;
}
