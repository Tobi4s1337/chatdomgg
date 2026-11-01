import { createNativeForgeHost } from '@chatdom/forge';
import type { HomeTier } from '@chatdom/shared';
import type { SettlementHome, SettlementPlan } from '@chatdom/world';
import { simulateGrowthHistory } from '../growth/history';
import type { History } from './replay';

/**
 * These are explicitly staged construction commits, not deductions from a growth qualification or the recent beat
 * window. The dates and assets are local fixture facts. Castle, streets, other civic places and other homes remain at the
 * generated plan revision throughout: there is no historic record of changes to them in this fixture. The market
 * has its own explicitly staged construction commit, independent of the qualification projection.
 */
const COMMITS: readonly { date: string; tier: HomeTier; days: number }[] = [
  { date: '2025-02-15', tier: 'hut', days: 3 },
  { date: '2025-03-05', tier: 'cottage', days: 7 },
  { date: '2025-05-15', tier: 'house', days: 30 },
  { date: '2025-09-01', tier: 'manor', days: 90 },
  { date: '2026-01-02', tier: 'hall', days: 180 },
];
export const SIMULATED_WORLD_REVISION = 'chronicle-simulated-hamlet-v1';
export const simulatedWorldRevision = (plan: SettlementPlan, market: 1 | 2 = 1) => `${SIMULATED_WORLD_REVISION}:${plan.revision}:market-${market}`;

/** Complete local snapshots cover every plot. Simulated attendance never enters a live feed or mints credit. */
export function simulatedHistory(plan: SettlementPlan, hero: SettlementHome): History {
  if (!plan.homes.some(home => home.id === hero.id)) throw new Error('The simulated plot must belong to this settlement.');
  const neighbours = plan.homes.filter(home => home.id !== hero.id).map((home, i) => ({
    plotId: home.id, installedTier: home.tier, attendance: .55 + (i % 4) * .08,
  }));
  const recorded = simulateGrowthHistory({ heroPlotId: hero.id, neighbours });
  const fixed = plan.homes.filter(home => home.id !== hero.id).map(home => ({ plotId: home.id, assetRevision: createNativeForgeHost(home).blueprint.id }));
  const commits = COMMITS.map(commit => {
    const frame = recorded.frames.find(candidate => candidate.asOf >= Date.parse(`${commit.date}T00:00:00Z`));
    if (!frame) throw new Error(`The simulated record has no night after ${commit.date}.`);
    const qualifying = frame.homes.find(home => home.plotId === hero.id);
    if (!qualifying || qualifying.qualifiedDays < commit.days) throw new Error('A simulated construction commit cannot precede its earned capacity.');
    return { ...commit, sequence: frame.sequence };
  });
  if (new Set(commits.map(commit => commit.sequence)).size !== commits.length) throw new Error('Simulated constructions must be on separate nights.');
  // The fixture records an actual market construction on a particular observed night; reducer eligibility alone
  // never installs assets. The remaining civic places keep their existing generated baseline.
  const marketNight = recorded.frames.find(frame => frame.asOf >= Date.parse('2025-07-01T00:00:00Z'));
  if (!marketNight || marketNight.civic.market < 2) throw new Error('The simulated market must earn its construction first.');
  const marketSequence = marketNight.sequence;
  const firstIndex = recorded.frames.findIndex(frame => frame.sequence === commits[0]!.sequence);
  const commitAt = new Map(commits.map(commit => [commit.sequence, commit]));
  let constructed: HomeTier | undefined;
  const snapshots = recorded.frames.slice(firstIndex).flatMap((frame, index, frames) => {
    const commit = commitAt.get(frame.sequence);
    if (commit) constructed = commit.tier;
    // Sample ordinary recorded nights and include every explicit build commit, regardless of sample spacing.
    const marketCommit = frame.sequence === marketSequence;
    if (index % 6 !== 0 && !commit && !marketCommit && index !== frames.length - 1) return [];
    if (!constructed) throw new Error('The simulated history has no built home at its start.');
    const qualifying = frame.homes.find(home => home.plotId === hero.id);
    if (!qualifying) throw new Error('The simulated plot is missing from a night.');
    const assetRevision = createNativeForgeHost({ ...hero, tier: constructed }).blueprint.id;
    const fact = `${qualifying.qualifiedDays} nights of presence had been recorded for this plot.`;
    const market = frame.sequence >= marketSequence ? 2 : 1;
    const civic = { tavern: 1, forge: 1, market, bridge: 1, 'castle-court': 1 };
    return [{
      // Recent presentation beats are not the historical fact log and are never replayed as ceremonies.
      frame: { ...frame, civic, beats: [] },
      homes: [...fixed, { plotId: hero.id, assetRevision }],
      worldRevision: simulatedWorldRevision(plan, market),
      focus: marketCommit ? 'market' as const : 'home' as const,
      caption: marketCommit ? `The market gained a second stall, a gift cart and stores. ${fact}`
        : commit ? `The ${commit.tier} was built on this plot. ${fact}` : fact,
    }];
  });
  return { label: 'SIMULATED', snapshots };
}
