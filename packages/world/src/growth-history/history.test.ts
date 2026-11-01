import { describe, expect, it } from 'vitest';
import { createGrowthState, reduceGrowth } from '../growth';
import type { GrowthObservation } from '../growth';
import { createSimulatedGrowthHistory, growthFactTimeline, replaySimulatedGrowth } from './index';

describe('witnessed simulated growth history', () => {
  it('replays the same seed exactly, with ordered sources and reducer-emitted milestones over seven weeks', () => {
    const history = createSimulatedGrowthHistory(17);
    expect(createSimulatedGrowthHistory(17)).toEqual(history);
    const observations = history.facts.map(fact => fact.observation);
    expect(replaySimulatedGrowth(observations)).toEqual(history.facts);
    expect(observations.at(-1)!.at - observations[0]!.at).toBeGreaterThanOrEqual(42 * 86_400_000);
    expect(observations.every((item, index) => item.seq === index + 1 && item.origin === 'simulated'
      && (index === 0 || item.at >= observations[index - 1]!.at))).toBe(true);
    const milestones = history.facts.flatMap(fact => fact.milestones);
    expect(milestones.some(item => item.kind === 'home-grown' && item.to === 'house')).toBe(true);
    expect(milestones.some(item => item.kind === 'civic-levelled' && item.to >= 2)).toBe(true);
    expect(milestones.some(item => item.kind === 'streak-reached')).toBe(true);
    expect(history.facts.every(fact => fact.milestones.every(item => item.sourceSeq === fact.observation.seq && item.at === fact.observation.at))).toBe(true);
    expect(new Set(observations.filter(item => item.type === 'home-bound').map(item => item.plotId)).size).toBe(3);
    expect(growthFactTimeline(history).map(entry => entry.milestone)).toEqual(milestones);
    expect(growthFactTimeline(history)[0]?.date).toMatch(/^2026-01-/);
    expect(history.label).toBe('SIMULATED');
    expect(history.state.origin).toBe('simulated');
    expect(createSimulatedGrowthHistory(18).facts).not.toEqual(history.facts);
  });

  it('records quiet streams and refuses paid or live evidence', () => {
    const history = createSimulatedGrowthHistory();
    const observations = history.facts.map(fact => fact.observation);
    expect(observations.some((item, index) => item.type === 'stream-observed' && observations[index + 1]?.type === 'stream-observed')).toBe(true);
    const presence = observations.find(item => item.type === 'presence-qualified')!;
    expect(presence.type === 'presence-qualified' && presence.source).toBe('observed-presence');
    expect(() => replaySimulatedGrowth([{ ...observations[0]!, origin: 'live' }])).toThrow();
    const before = observations.slice(0, observations.indexOf(presence)).reduce((state, item) => reduceGrowth(state, item).state,
      createGrowthState(presence.kingdomId, 'simulated'));
    expect(() => reduceGrowth(before, { ...presence, source: 'subscription' } as unknown as GrowthObservation)).toThrow();
  });
});
