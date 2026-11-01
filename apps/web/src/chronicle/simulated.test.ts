import { describe, expect, it } from 'vitest';
import { generateSettlementPlan } from '@chatdom/world';
import { createReplay, validateHistory, type HistoricalSnapshot } from './replay';
import { simulatedHistory, simulatedWorldRevision } from './simulated';

describe('simulated Chronicle history', () => {
  it('records whole-plot revisions and explicit constructions without replaying the recent event tail', () => {
    const plan = generateSettlementPlan({ seed: 'chronicle-lantern', tier: 'hamlet', firstYear: 2025, year: 2026 });
    const hero = plan.homes.find(home => home.style === 'hearth')!;
    const history = validateHistory(simulatedHistory(plan, hero));
    expect(history.label).toBe('SIMULATED');
    expect(history.snapshots.length).toBeGreaterThanOrEqual(31);
    expect(history.snapshots.filter(snapshot => snapshot.caption.includes('was built'))).toHaveLength(5);
    expect(history.snapshots.some(snapshot => !snapshot.caption.includes('was built'))).toBe(true);
    for (const snapshot of history.snapshots) {
      expect(snapshot.worldRevision).toBe(simulatedWorldRevision(plan, snapshot.frame.civic.market as 1 | 2));
      expect(snapshot.frame.civic).toEqual({ tavern: 1, forge: 1, market: snapshot.frame.civic.market, bridge: 1, 'castle-court': 1 });
      expect(snapshot.homes).toHaveLength(plan.homes.length);
      expect(snapshot.frame.beats).toEqual([]);
    }
    expect(new Set(history.snapshots.map(snapshot => snapshot.homes.find(home => home.plotId === hero.id)!.assetRevision)).size).toBe(5);
    const marketIndex = history.snapshots.findIndex(snapshot => snapshot.focus === 'market');
    expect(marketIndex).toBeGreaterThan(0);
    expect(history.snapshots[marketIndex]!.caption).toContain('market gained');
    expect(history.snapshots[marketIndex - 1]!.frame.civic.market).toBe(1);
    expect(history.snapshots[marketIndex]!.frame.civic.market).toBe(2);
    expect(history.snapshots[marketIndex + 1]!.focus).toBe('home');
    expect(history.snapshots.filter(snapshot => snapshot.focus === 'market')).toHaveLength(1);
    for (let i = 1; i < history.snapshots.length; i++) {
      const before = history.snapshots[i - 1]!, after = history.snapshots[i]!;
      if (!after.caption.includes('was built')) expect(after.homes).toEqual(before.homes);
      expect(after.frame.sequence).toBeGreaterThan(before.frame.sequence);
    }
    for (const plot of plan.homes.filter(home => home.id !== hero.id)) {
      expect(new Set(history.snapshots.map(snapshot => snapshot.homes.find(home => home.plotId === plot.id)!.assetRevision)).size).toBe(1);
    }
  });
  it('replaces complete home and civic revisions on forward and backward seeks', () => {
    const plan = generateSettlementPlan({ seed: 'chronicle-lantern', tier: 'hamlet', firstYear: 2025, year: 2026 });
    const hero = plan.homes.find(home => home.style === 'hearth')!;
    const history = simulatedHistory(plan, hero);
    const marketIndex = history.snapshots.findIndex(snapshot => snapshot.focus === 'market');
    const rendered: { current: HistoricalSnapshot | undefined } = { current: undefined };
    const replay = createReplay({ replace: snapshot => { rendered.current = snapshot; }, clear: () => { rendered.current = undefined; }, dispose: () => {} });
    replay.load(history);
    const original = rendered.current;
    replay.seek(marketIndex);
    expect(rendered.current?.frame.civic.market).toBe(2);
    expect(rendered.current?.caption).toContain('market gained');
    replay.seek(history.snapshots.length - 1);
    expect(rendered.current?.homes.find(home => home.plotId === hero.id)?.assetRevision).not.toBe(original?.homes.find(home => home.plotId === hero.id)?.assetRevision);
    replay.seek(0);
    expect(rendered.current).toEqual(original);
    expect(rendered.current?.frame.civic.market).toBe(1);
    replay.dispose(); expect(rendered.current).toBeUndefined();
  });

});
