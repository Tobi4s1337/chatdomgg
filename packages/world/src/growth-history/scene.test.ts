import { describe, expect, it, vi } from 'vitest';
import { GrowthSceneFrameSchema } from '@chatdom/shared';
import { createGrowthState, projectGrowthScene, reduceGrowth } from '../growth';
import type { GrowthObservation } from '../growth';
import { createSimulatedGrowthFeed, createSimulatedGrowthHistory, parseGrowthSceneFrameForLabel, projectSimulatedGrowthHistory } from './index';

describe('simulated growth scene projections', () => {
  it('projects each witnessed transition through the reducer, with valid provenance and no private facts', () => {
    const history = createSimulatedGrowthHistory();
    const observations = history.facts.map(fact => fact.observation);
    const frames = projectSimulatedGrowthHistory(observations);
    expect(frames).toHaveLength(observations.length);
    expect(projectSimulatedGrowthHistory(observations)).toEqual(frames);
    let state = createGrowthState(observations[0]!.kingdomId, 'simulated');
    const allBeats = frames.flatMap((frame, index) => {
      const observation = observations[index]!;
      const transition = reduceGrowth(state, observation);
      state = transition.state;
      expect(GrowthSceneFrameSchema.parse(frame)).toEqual(frame);
      expect(frame).toEqual(projectGrowthScene(state, transition.milestones.filter(item => item.kind !== 'home-grown')));
      expect(frame).toMatchObject({ origin: 'simulated', sequence: observation.seq, asOf: observation.at });
      for (const beat of frame.beats) {
        expect(beat).toMatchObject({ sourceSeq: observation.seq, at: observation.at });
        if ('plotId' in beat) expect(frame.homes.some(home => home.plotId === beat.plotId)).toBe(true);
      }
      return frame.beats;
    });
    const earnedHome = history.facts.flatMap(fact => fact.milestones).find(item => item.kind === 'home-grown' && item.to === 'house');
    expect(earnedHome).toBeDefined();
    expect(frames.some(frame => frame.homes.some(home => home.plotId === earnedHome!.plotId && home.stage === 'house'))).toBe(true);
    expect(allBeats.some(beat => beat.kind === 'home-grown')).toBe(false);
    expect(allBeats.some(beat => beat.kind === 'civic-levelled' && beat.to >= 2)).toBe(true);
    expect(history.facts.some(fact => fact.milestones.length > 1)).toBe(true); // simultaneous private milestones survive
    expect(JSON.stringify(frames)).not.toMatch(/personId|evidenceReceipt|sessionId|observed-presence/);
    expect(frames.every(frame => frame.beats.length <= 128)).toBe(true);
  });

  it('rejects reordered, missing, foreign, live and backwards evidence before producing a projection', () => {
    const observations = createSimulatedGrowthHistory().facts.map(fact => fact.observation);
    const changed = (index: number, patch: object) => observations.map((item, i) => i === index ? { ...item, ...patch } as GrowthObservation : item);
    expect(() => projectSimulatedGrowthHistory(observations.slice(1))).toThrow();
    expect(() => projectSimulatedGrowthHistory([observations[0]!, observations[0]!])).toThrow();
    expect(() => projectSimulatedGrowthHistory(changed(1, { origin: 'live' }))).toThrow();
    expect(() => projectSimulatedGrowthHistory(changed(1, { kingdomId: '123' }))).toThrow();
    expect(() => projectSimulatedGrowthHistory(changed(1, { at: observations[0]!.at - 1 }))).toThrow();
    expect(projectSimulatedGrowthHistory([])).toEqual([]);
  });

  it('validates external snapshots against their label and fails unavailable without leaking mutable state', () => {
    const frame = projectSimulatedGrowthHistory(createSimulatedGrowthHistory().facts.map(fact => fact.observation))
      .find(candidate => candidate.beats.some(beat => 'plotId' in beat))!;
    const live = { ...frame, origin: 'live' };
    expect(parseGrowthSceneFrameForLabel(frame, 'LIVE')).toBeNull();
    expect(parseGrowthSceneFrameForLabel(live, 'SIMULATED')).toBeNull();
    expect(parseGrowthSceneFrameForLabel(live, 'LIVE')).toEqual(live);
    const beat = { kind: 'streak-reached', plotId: frame.homes[0]!.plotId, days: 3, sourceSeq: frame.sequence, at: frame.asOf };
    const invalidFrames = [
      { ...frame, beats: [{ ...beat, plotId: 'missing' }] },
      { ...frame, beats: [{ ...beat, sourceSeq: frame.sequence + 1 }] },
      { ...frame, beats: [{ ...beat, at: frame.asOf + 1 }] },
      { ...frame, homes: [...frame.homes, frame.homes[0]] },
    ];
    for (const invalid of invalidFrames) expect(parseGrowthSceneFrameForLabel(invalid, 'SIMULATED')).toBeNull();
    for (const input of [live, ...invalidFrames, null]) {
      const receive = vi.fn(); const unavailable = vi.fn();
      const feed = createSimulatedGrowthFeed(input);
      expect(feed.label).toBe('SIMULATED');
      feed.subscribe(receive, unavailable)();
      expect(receive).not.toHaveBeenCalled();
      expect(unavailable).toHaveBeenCalledOnce();
    }
    const feed = createSimulatedGrowthFeed(frame);
    const receive = vi.fn(); const unavailable = vi.fn();
    const unsubscribe = feed.subscribe(receive, unavailable);
    expect(receive).toHaveBeenCalledOnce();
    expect(unavailable).not.toHaveBeenCalled();
    receive.mock.calls[0]![0].homes.length = 0;
    unsubscribe();
    const again = vi.fn();
    feed.subscribe(again, unavailable)();
    expect(again.mock.calls[0]![0]).toEqual(frame);
    expect(receive).toHaveBeenCalledOnce();
  });
});
