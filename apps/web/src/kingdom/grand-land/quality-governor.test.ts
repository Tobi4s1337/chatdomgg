import { describe, expect, it } from 'vitest';
import { createQualityGovernor, GOVERNOR_BUDGETS, type GovernorSample, type QualityGovernor } from './quality-governor';

/** Feed `seconds` of frames at `hz`, each costing the given times; returns the first proposal and when it came. */
function run(governor: QualityGovernor, from: number, seconds: number, frame: (at: number) => Omit<GovernorSample, 'at'>, hz = 60) {
  const step = 1000 / hz;
  for (let at = from; at < from + seconds * 1000; at += step) {
    const proposed = governor.sample({ at, ...frame(at) });
    if (proposed) return { proposed, at };
  }
  return null;
}
const timed = (gpuMs: number, cpuMs = 2) => () => ({ intervalMs: 1000 / 60, cpuMs, gpuMs });
const interval = (intervalMs: number) => () => ({ intervalMs, cpuMs: 3, gpuMs: null });

describe('the quality governor', () => {
  it('holds high on a fast GPU however fast the display refreshes', () => {
    const governor = createQualityGovernor({ start: 'high', budget: GOVERNOR_BUDGETS.desktop });
    expect(run(governor, 0, 60, () => ({ intervalMs: 1000 / 360, cpuMs: 2.5, gpuMs: 3.5 }), 360)).toBeNull();
    expect(governor.state()).toMatchObject({ quality: 'high', measuredBy: 'timer' });
  });

  it('steps down one tier after two seconds over the GPU budget, and only then', () => {
    const governor = createQualityGovernor({ start: 'high', budget: GOVERNOR_BUDGETS.desktop });
    // A short spike (a camera cut building a few regions) is not a trend.
    expect(run(governor, 0, 1, timed(14))).toBeNull();
    expect(run(governor, 1000, 5, timed(6))).toBeNull();
    const down = run(governor, 6000, 10, timed(14));
    expect(down?.proposed).toBe('balanced');
    expect(down!.at - 6000).toBeGreaterThanOrEqual(2000);
    expect(governor.state().reason).toBe('frame cost over budget');
  });

  it('waits for the host to apply a step, then settles before judging again', () => {
    const governor = createQualityGovernor({ start: 'high', budget: GOVERNOR_BUDGETS.desktop });
    const down = run(governor, 0, 10, timed(14))!;
    // Proposed, not applied: the scene still says high until a cut.
    expect(governor.state()).toMatchObject({ quality: 'high', proposed: 'balanced' });
    governor.applied('balanced', down.at);
    expect(governor.state()).toMatchObject({ quality: 'balanced', proposed: null, steps: 1 });
    // Still slow at balanced: the next step down needs the settle time and two more seconds.
    const again = run(governor, down.at, 20, timed(12))!;
    expect(again.proposed).toBe('low');
    expect(again.at - down.at).toBeGreaterThanOrEqual(5000);
    governor.applied('low', again.at);
    // There is nothing below low.
    expect(run(governor, again.at, 20, timed(30))).toBeNull();
  });

  it('steps up after ten seconds well under budget, never above its ceiling', () => {
    const governor = createQualityGovernor({ start: 'low', budget: GOVERNOR_BUDGETS.desktop, ceiling: 'balanced' });
    const up = run(governor, 0, 30, timed(3))!;
    expect(up.proposed).toBe('balanced');
    expect(up.at).toBeGreaterThanOrEqual(10_000);
    governor.applied('balanced', up.at);
    expect(run(governor, up.at, 60, timed(2))).toBeNull();
  });

  it('counts main-thread render time as cost too', () => {
    const governor = createQualityGovernor({ start: 'high', budget: GOVERNOR_BUDGETS.desktop });
    expect(run(governor, 0, 10, timed(4, 13))?.proposed).toBe('balanced');
  });

  it('holds beside a game in OBS to a 4 ms GPU budget', () => {
    const governor = createQualityGovernor({ start: 'balanced', budget: GOVERNOR_BUDGETS.obs });
    expect(run(governor, 0, 10, timed(6))?.proposed).toBe('low');
    const desktop = createQualityGovernor({ start: 'balanced', budget: GOVERNOR_BUDGETS.desktop });
    expect(run(desktop, 0, 10, timed(6))).toBeNull();
  });

  describe('without timer queries', () => {
    it('steps down when frames miss 60 Hz', () => {
      const governor = createQualityGovernor({ start: 'high', budget: GOVERNOR_BUDGETS.desktop });
      expect(run(governor, 0, 10, interval(33.3), 30)?.proposed).toBe('balanced');
      expect(governor.state()).toMatchObject({ measuredBy: 'interval', reason: 'frame interval over budget' });
    });

    it('probes a higher tier, undoes a probe that misses at once and waits twice as long for the next', () => {
      const governor = createQualityGovernor({ start: 'balanced', budget: GOVERNOR_BUDGETS.desktop });
      const probe = run(governor, 0, 30, interval(1000 / 60))!;
      expect(probe).toMatchObject({ proposed: 'high' });
      expect(probe.at).toBeGreaterThanOrEqual(10_000);
      governor.applied('high', probe.at);
      const undo = run(governor, probe.at, 10, interval(25), 40)!;
      expect(undo.proposed).toBe('balanced');
      expect(governor.state().reason).toBe('probe missed its frame budget');
      // Undone without the usual two seconds of misses.
      expect(undo.at - probe.at).toBeLessThan(3000 + 2000);
      governor.applied('balanced', undo.at);
      const next = run(governor, undo.at, 60, interval(1000 / 60))!;
      expect(next.proposed).toBe('high');
      expect(next.at - undo.at).toBeGreaterThanOrEqual(20_000);
    });

    it('takes an OBS browser source at its default 30 fps for a held frame rate, not a miss', () => {
      // Beside a game, frame intervals cannot see the game's share of the GPU: no blind probe above balanced.
      const governor = createQualityGovernor({ start: 'balanced', budget: GOVERNOR_BUDGETS.obs, blindCeiling: 'balanced' });
      expect(run(governor, 0, 30, interval(1000 / 30), 30)).toBeNull();
      expect(run(governor, 30_000, 10, interval(50), 20)?.proposed).toBe('low');
    });

    it('keeps a probe that holds 60 Hz', () => {
      const governor = createQualityGovernor({ start: 'balanced', budget: GOVERNOR_BUDGETS.desktop });
      const probe = run(governor, 0, 30, interval(1000 / 60))!;
      governor.applied('high', probe.at);
      expect(run(governor, probe.at, 30, interval(1000 / 60))).toBeNull();
      expect(governor.state().quality).toBe('high');
    });
  });

  it('ignores frames without a usable interval (a hidden tab, the first frame)', () => {
    const governor = createQualityGovernor({ start: 'high', budget: GOVERNOR_BUDGETS.desktop });
    expect(governor.sample({ at: 0, intervalMs: Infinity, cpuMs: 1, gpuMs: 1 })).toBeNull();
    expect(governor.sample({ at: 1, intervalMs: 0, cpuMs: 1, gpuMs: 1 })).toBeNull();
    expect(governor.state().p90).toBeNull();
  });
});
