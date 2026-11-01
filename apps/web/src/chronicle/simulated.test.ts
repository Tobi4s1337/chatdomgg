import { describe, expect, it } from 'vitest';
import { generateSettlementPlan } from '@chatdom/world';
import { validateHistory } from './replay';
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
      expect(snapshot.worldRevision).toBe(simulatedWorldRevision(plan));
      expect(snapshot.homes).toHaveLength(plan.homes.length);
      expect(snapshot.frame.beats).toEqual([]);
    }
    expect(new Set(history.snapshots.map(snapshot => snapshot.homes.find(home => home.plotId === hero.id)!.assetRevision)).size).toBe(5);
    for (let i = 1; i < history.snapshots.length; i++) {
      const before = history.snapshots[i - 1]!, after = history.snapshots[i]!;
      if (!after.caption.includes('was built')) expect(after.homes).toEqual(before.homes);
      expect(after.frame.sequence).toBeGreaterThan(before.frame.sequence);
    }
    for (const plot of plan.homes.filter(home => home.id !== hero.id)) {
      expect(new Set(history.snapshots.map(snapshot => snapshot.homes.find(home => home.plotId === plot.id)!.assetRevision)).size).toBe(1);
    }
  });
});
