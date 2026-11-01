import { describe, expect, it } from 'vitest';
import { GrowthSceneFrameSchema, type GrowthSceneBeat, type GrowthSceneFeed, type GrowthSceneFrame } from '@chatdom/shared';
import { createGrowthBatcher } from './batch';
import { watchGrowthFeed, type GrowthFeedStatus } from './feed';
import { createSimulatedGrowthFeed } from './simulated-feed';

const beat = (sourceSeq: number): GrowthSceneBeat => ({ kind: 'streak-reached', sourceSeq, at: 1, plotId: 'a', days: sourceSeq });
const frame = (sequence: number, beats: GrowthSceneBeat[] = [], origin: 'live' | 'simulated' = 'live'): GrowthSceneFrame =>
  GrowthSceneFrameSchema.parse({ version: 1, kingdomId: '123', origin, sequence, asOf: 1,
    homes: [{ plotId: 'a', stage: 'tent', qualifiedDays: 0, qualifiedMinutes: 0, currentStreak: 0, bestStreak: 0, nextGoal: null }],
    civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 }, beats });
function feed(label: GrowthSceneFeed['label']) {
  let receive: (frame: GrowthSceneFrame) => void = () => { throw new Error('not subscribed'); };
  let unavailable: () => void = () => { throw new Error('not subscribed'); };
  let cancelled = 0;
  const source: GrowthSceneFeed = { label, subscribe(onFrame, onUnavailable) {
    receive = onFrame; unavailable = onUnavailable; return () => { cancelled++; };
  } };
  return { source, send: (value: GrowthSceneFrame) => receive(value), unavailable: () => unavailable(), cancelled: () => cancelled };
}
const start = () => createGrowthBatcher({ quietWindowMs: 10, maxMessageLength: 128, maxPending: 128 }, 'stream-a');

describe('read-only growth feed adapter', () => {
  it('offers an explicitly simulated fixture feed without accepting live frames', () => {
    let clock = 0;
    const simulated = createSimulatedGrowthFeed();
    const adapter = watchGrowthFeed(simulated.feed, start(), () => clock, () => {});
    expect(() => simulated.publish(frame(1))).toThrow();
    simulated.publish(frame(1, [], 'simulated'));
    simulated.publish(frame(2, [beat(2)], 'simulated'));
    clock = 10;
    expect(adapter.flush()?.text).toBe('SIMULATED: A citizen has reached a 2-day streak.');
    adapter.close();
  });

  it('baselines each connection, preserving pending facts but never replaying a missed tail', () => {
    let clock = 0;
    const statuses: GrowthFeedStatus[] = [];
    const a = feed('LIVE');
    const first = watchGrowthFeed(a.source, start(), () => clock, status => statuses.push(status));
    a.send(frame(1, [beat(1)]));
    a.send(frame(2, [beat(1), beat(2)]));
    first.close();
    const b = feed('LIVE');
    const second = watchGrowthFeed(b.source, first.state, () => clock, status => statuses.push(status));
    b.send(frame(4, [beat(2), beat(3), beat(4)]));
    b.send(frame(5, [beat(4), beat(5)]));
    clock = 10;
    const batch = second.flush();
    expect(batch?.evidence).toEqual([beat(2), beat(5)]);
    expect(statuses).toEqual(['baseline', 'accepted', 'baseline', 'accepted']);
    first.close();
    expect(a.cancelled()).toBe(1);
  });

  it('reports mismatched labels, invalid frames and unavailability without producing live success', () => {
    const statuses: GrowthFeedStatus[] = [];
    const a = feed('LIVE');
    const adapter = watchGrowthFeed(a.source, start(), () => 0, status => statuses.push(status));
    a.send(frame(1, [], 'simulated'));
    a.send(frame(2));
    expect(statuses).toEqual(['invalid']);
    expect(a.cancelled()).toBe(1);
    expect(adapter.state.sequence).toBeNull();
    const b = feed('SIMULATED');
    watchGrowthFeed(b.source, start(), () => 0, status => statuses.push(status));
    b.unavailable();
    expect(statuses).toEqual(['invalid', 'unavailable']);
    expect(b.cancelled()).toBe(1);
  });

  it('stops on backpressure, retains the refused frame and retries after draining', () => {
    let clock = 0;
    const source = feed('SIMULATED');
    const statuses: GrowthFeedStatus[] = [];
    const adapter = watchGrowthFeed(source.source, start(), () => clock, status => statuses.push(status));
    source.send(frame(0, [], 'simulated'));
    source.send(frame(128, Array.from({ length: 128 }, (_, i) => beat(i + 1)), 'simulated'));
    source.send(frame(129, [beat(129)], 'simulated'));
    expect(adapter.blocked).toBe(true);
    expect(adapter.state.sequence).toBe(128);
    expect(source.cancelled()).toBe(1);
    source.send(frame(130, [beat(130)], 'simulated'));
    expect(adapter.state.sequence).toBe(128);
    clock = -1;
    expect(adapter.retry()).toBe('invalid');
    expect(adapter.blocked).toBe(true);
    clock = 10;
    expect(adapter.flush()?.text).toMatch(/^SIMULATED: /);
    expect(adapter.retry()).toBe('accepted');
    expect(adapter.blocked).toBe(false);
    expect(adapter.state.sequence).toBe(129);
    expect(adapter.state.pending.at(-1)).toEqual(beat(129));
    expect(statuses).toEqual(['baseline', 'accepted', 'backpressure', 'invalid', 'accepted']);
  });

  it('cleans up if the feed reports unavailable synchronously during subscription', () => {
    let cancelled = 0;
    const statuses: GrowthFeedStatus[] = [];
    watchGrowthFeed({ label: 'LIVE', subscribe(_receive, unavailable) { unavailable(); return () => { cancelled++; }; } },
      start(), () => 0, status => statuses.push(status));
    expect(statuses).toEqual(['unavailable']);
    expect(cancelled).toBe(1);
  });
});
