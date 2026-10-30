import { generateKingdom, type KingdomConfig, type KingdomTier } from '@chatdom/world';

/**
 * The presentation layout whose home slots Herald may bind people to. It must be the same config main's
 * preview renders, or a lit slot would sit on a different (or missing) window. A slot is a place to show
 * a light, never a deed or a claim of tenure.
 */
export interface KingdomPresentation {
  readonly config: KingdomConfig;
  /** Every home slot in the generated layout, ascending. */
  readonly slots: readonly number[];
}

export interface KingdomPresentationProblem {
  readonly key: string;
  readonly issue: 'invalid';
}

export const KINGDOM_TIERS: readonly KingdomTier[] = ['hamlet', 'town'];
/** The development kingdom's founding year. Fixed, so slot numbers keep naming the same homes next year. */
export const DEFAULT_FIRST_YEAR = 2026;

export function presentKingdom(config: KingdomConfig): KingdomPresentation {
  const layout = generateKingdom(config);
  return { config: layout.config, slots: layout.homes.map(home => home.slot).sort((a, b) => a - b) };
}

/**
 * Reads the presentation from nonsecret settings. Defaults name a hamlet founded in 2026, seeded by the
 * channel login and grown to the current year; anything else must be set to the preview's config explicitly.
 */
export function kingdomFromSettings(setting: (key: string) => string | null, channelLogin: string, year: number): {
  readonly config: KingdomConfig;
  readonly problems: readonly KingdomPresentationProblem[];
} {
  const problems: KingdomPresentationProblem[] = [];
  const seed = setting('HERALD_KINGDOM_SEED') ?? channelLogin;
  const rawTier = setting('HERALD_KINGDOM_TIER') ?? 'hamlet';
  const tier = KINGDOM_TIERS.find(candidate => candidate === rawTier);
  if (!tier) problems.push({ key: 'HERALD_KINGDOM_TIER', issue: 'invalid' });
  const firstYear = parseYear(setting('HERALD_KINGDOM_FIRST_YEAR'), DEFAULT_FIRST_YEAR);
  if (firstYear === null) problems.push({ key: 'HERALD_KINGDOM_FIRST_YEAR', issue: 'invalid' });
  const lastYear = parseYear(setting('HERALD_KINGDOM_YEAR'), Math.max(year, firstYear ?? year));
  if (lastYear === null) problems.push({ key: 'HERALD_KINGDOM_YEAR', issue: 'invalid' });
  const config: KingdomConfig = { seed, tier: tier ?? 'hamlet', firstYear: firstYear ?? DEFAULT_FIRST_YEAR, year: lastYear ?? year };
  if (problems.length === 0) {
    try {
      generateKingdom(config);
    } catch {
      problems.push({ key: 'HERALD_KINGDOM_YEAR', issue: 'invalid' });
    }
  }
  return { config, problems };
}

function parseYear(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback;
  if (!/^[0-9]{4}$/.test(raw)) return null;
  return Number(raw);
}
