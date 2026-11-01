import { describe, expect, it } from 'vitest';
import { GrowthSceneFrameSchema, type GrowthSceneBeat, type GrowthSceneFrame } from '@chatdom/shared';
import { createGrowthBatcher, flushGrowthBatch, ingestGrowthFrame, resetGrowthBatcher } from './batch';

const options = { quietWindowMs: 100, maxMessageLength: 128, maxPending: 128 };
const civic = (sourceSeq: number, place: 'forge' | 'market' | 'tavern' = 'forge', at = 100): GrowthSceneBeat =>
  ({ kind: 'civic-levelled', sourceSeq, at, place, from: 1, to: 2 });
const streak = (sourceSeq: number, days = 1, at = 100): GrowthSceneBeat =>
  ({ kind: 'streak-reached', sourceSeq, at, plotId: 'plot-a', days });
const frame = (sequence: number, beats: GrowthSceneBeat[] = [], origin: 'live' | 'simulated' = 'live'): GrowthSceneFrame =>
  GrowthSceneFrameSchema.parse({ version: 1, kingdomId: '123', origin, sequence, asOf: 1000,
    homes: [{ plotId: 'plot-a', stage: 'tent', qualifiedDays: 0, qualifiedMinutes: 0, currentStreak: 0, bestStreak: 0, nextGoal: null }],
    civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 }, beats });
const start = () => createGrowthBatcher(options, 'session-a');

describe('growth crier batcher', () => {
  it('resets only on an explicit change of session', () => {
    const state = ingestGrowthFrame(start(), frame(1), 0).state;
    expect(() => resetGrowthBatcher(state, 'session-a')).toThrow();
    expect(resetGrowthBatcher(state, 'session-b')).toEqual(createGrowthBatcher(options, 'session-b'));
  });

  it('extends the quiet window when a new fact arrives', () => {
    const base = ingestGrowthFrame(start(), frame(0), 0).state;
    const first = ingestGrowthFrame(base, frame(1, [streak(1)]), 10).state;
    const second = ingestGrowthFrame(first, frame(2, [streak(2)]), 100).state;
    expect(flushGrowthBatch(second, 110).batch).toBeNull();
    expect(flushGrowthBatch(second, 200).batch?.evidence).toEqual([streak(1), streak(2)]);
  });
  it('suppresses a baseline tail and accepts only newer beats after reconnect overlap', () => {
    const baseline = ingestGrowthFrame(start(), frame(4, [civic(4)]), 0);
    expect(baseline.status).toBe('baseline');
    expect(flushGrowthBatch(baseline.state, 1000).batch).toBeNull();
    const overlap = ingestGrowthFrame(baseline.state, frame(6, [civic(4), streak(5), civic(6)]), 10);
    expect(overlap.status).toBe('accepted');
    const batch = flushGrowthBatch(overlap.state, 110).batch;
    expect(batch?.evidence).toEqual([streak(5), civic(6)]);
    expect(batch?.text).toContain('streak');
    expect(batch?.text).toContain('forge');
    expect(ingestGrowthFrame(overlap.state, frame(6, [streak(5), civic(6)]), 11).status).toBe('unchanged');
  });

  it('deduplicates exact beats, retains distinct beats with one sequence and sorts deterministically', () => {
    const baseline = ingestGrowthFrame(start(), frame(1), 0).state;
    const beats = [civic(3, 'market', 102), streak(2, 2, 101), civic(3, 'forge', 102), civic(3, 'market', 102)];
    const a = ingestGrowthFrame(baseline, frame(3, beats), 10);
    const b = ingestGrowthFrame(baseline, frame(3, [...beats].reverse()), 10);
    expect(a.status).toBe('accepted');
    const first = flushGrowthBatch(a.state, 110).batch;
    const second = flushGrowthBatch(b.state, 110).batch;
    expect(first?.evidence).toHaveLength(3);
    expect(first?.evidence[0]).toEqual(streak(2, 2, 101));
    expect(first?.evidence.slice(1)).toEqual(expect.arrayContaining([civic(3, 'market', 102), civic(3, 'forge', 102)]));
    expect(first).toEqual(second);
  });

  it('flushes at the inclusive quiet boundary and delays subsequent length-limited chunks', () => {
    const baseline = ingestGrowthFrame(start(), frame(0), 0).state;
    const accepted = ingestGrowthFrame(baseline, frame(4, [streak(1), streak(2), streak(3), streak(4)]), 20);
    expect(flushGrowthBatch(accepted.state, 119).batch).toBeNull();
    const first = flushGrowthBatch(accepted.state, 120);
    expect(first.batch).not.toBeNull();
    expect(first.batch!.text.length).toBeLessThanOrEqual(options.maxMessageLength);
    expect(first.batch!.evidence.length).toBeLessThan(4);
    expect(flushGrowthBatch(first.state, 219).batch).toBeNull();
    const second = flushGrowthBatch(first.state, 220);
    expect(second.batch).not.toBeNull();
    expect([...first.batch!.evidence, ...second.batch!.evidence]).toEqual([streak(1), streak(2), streak(3), streak(4)]);
  });

  it('labels simulated batches and rejects malformed or foreign frames without changing pending work', () => {
    const baseline = ingestGrowthFrame(start(), frame(1, [], 'simulated'), 0).state;
    const accepted = ingestGrowthFrame(baseline, frame(2, [streak(2)], 'simulated'), 10).state;
    for (const bad of [{ ...frame(3), kingdomId: '456' }, frame(3), { ...frame(3, [], 'simulated'), sequence: -1 }]) {
      const result = ingestGrowthFrame(accepted, bad, 20);
      expect(result.status).toBe('invalid');
      expect(flushGrowthBatch(result.state, 110).batch).toEqual(flushGrowthBatch(accepted, 110).batch);
    }
    const batch = flushGrowthBatch(accepted, 110).batch;
    expect(batch?.origin).toBe('simulated');
    expect(batch?.text).toContain('SIMULATED');
    expect(batch?.evidence).toEqual([streak(2)]);
  });

  it('applies backpressure atomically when the pending capacity is full', () => {
    const baseline = ingestGrowthFrame(start(), frame(0), 0).state;
    const beats = Array.from({ length: 128 }, (_, i) => streak(i + 1, i + 1));
    const full = ingestGrowthFrame(baseline, frame(128, beats), 10);
    expect(full.status).toBe('accepted');
    const rejected = ingestGrowthFrame(full.state, frame(129, [streak(129)]), 20);
    expect(rejected.status).toBe('backpressure');
    expect(rejected.state.sequence).toBe(full.state.sequence);
    expect(rejected.state.pending).toEqual(full.state.pending);
    expect(ingestGrowthFrame(rejected.state, frame(130, [streak(130)]), 20).status).toBe('backpressure');
    expect(flushGrowthBatch(rejected.state, 110).batch).toEqual(flushGrowthBatch(full.state, 110).batch);
  });
});
