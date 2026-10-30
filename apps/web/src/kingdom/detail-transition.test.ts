import { describe, expect, it } from 'vitest';
import { advanceDetailTransition, type DetailLevel, type DetailTransition } from './detail-transition';

function visibleLevel(state: DetailTransition, threshold: number): DetailLevel {
  return !state.active || threshold < state.progress ? state.to : state.from;
}

function weights(state: DetailTransition): Map<DetailLevel, number> {
  return state.active ? new Map([[state.from, 1 - state.progress], [state.to, state.progress]]) : new Map([[state.to, 1]]);
}

describe('continuous detail transitions', () => {
  it('starts fully visible, fades for 400 ms and settles to one mesh', () => {
    let state = advanceDetailTransition(undefined, 1, 0);
    expect(state).toMatchObject({ from: 1, to: 1, progress: 1, active: false });
    state = advanceDetailTransition(state, 2, 20);
    expect(state).toMatchObject({ from: 1, to: 2, progress: 0, active: true });
    state = advanceDetailTransition(state, 2, 120);
    expect(state.progress).toBeCloseTo(.25);
    state = advanceDetailTransition(state, 2, 420);
    expect(state).toMatchObject({ from: 2, to: 2, progress: 1, active: false });
  });

  it('reverses without replacing either visible mesh or flipping the dither partition', () => {
    const initial = advanceDetailTransition(undefined, 1, 0);
    const started = advanceDetailTransition(initial, 2, 0);
    const quarter = advanceDetailTransition(started, 2, 100);
    const reverse = advanceDetailTransition(quarter, 1, 100);
    expect(reverse).toMatchObject({ from: 1, to: 2, progress: .25, active: true, direction: -1 });
    for (let threshold = 0; threshold < 1; threshold += .001) {
      expect(visibleLevel(reverse, threshold)).toBe(visibleLevel(quarter, threshold));
    }
    expect(advanceDetailTransition(reverse, 1, 150)).toMatchObject({ progress: .125, active: true });
    expect(advanceDetailTransition(reverse, 1, 200)).toMatchObject({ from: 1, to: 1, active: false });
  });

  it('can reverse again while returning, at the same speed and without changing roles', () => {
    let state = advanceDetailTransition(advanceDetailTransition(undefined, 1, 0), 2, 0);
    state = advanceDetailTransition(state, 1, 200);
    expect(state.progress).toBe(.5);
    state = advanceDetailTransition(state, 2, 300);
    expect(state).toMatchObject({ from: 1, to: 2, progress: .25, direction: 1 });
    expect(advanceDetailTransition(state, 2, 600)).toMatchObject({ from: 2, to: 2, active: false });
  });

  it('queues a third level until the current pair completes, then starts from the visible endpoint', () => {
    let state = advanceDetailTransition(advanceDetailTransition(undefined, 1, 0), 2, 0);
    state = advanceDetailTransition(state, 4, 100);
    expect(state).toMatchObject({ from: 1, to: 2, progress: .25, queued: 4 });
    state = advanceDetailTransition(state, 4, 399);
    expect(state).toMatchObject({ from: 1, to: 2, queued: 4 });
    state = advanceDetailTransition(state, 4, 400);
    expect(state).toMatchObject({ from: 2, to: 4, progress: 0, active: true, queued: null });
    for (const threshold of [0, .2, .999]) expect(visibleLevel(state, threshold)).toBe(2);
    expect(advanceDetailTransition(state, 4, 800)).toMatchObject({ from: 4, to: 4, active: false });
  });

  it('honours a changed third-level request while reversing towards the original source', () => {
    let state = advanceDetailTransition(advanceDetailTransition(undefined, 1, 0), 2, 0);
    state = advanceDetailTransition(state, 4, 100);
    state = advanceDetailTransition(state, 1, 200);
    expect(state).toMatchObject({ direction: -1, queued: null, progress: .5 });
    state = advanceDetailTransition(state, 4, 300);
    expect(state).toMatchObject({ direction: -1, queued: 4, progress: .25 });
    expect(advanceDetailTransition(state, 4, 400)).toMatchObject({ from: 1, to: 4, progress: 0, active: true });
  });

  it('returns directly to the source when reversed before the incoming mesh becomes visible', () => {
    const state = advanceDetailTransition(advanceDetailTransition(undefined, 1, 0), 2, 10);
    expect(advanceDetailTransition(state, 1, 10)).toMatchObject({ from: 1, to: 1, active: false });
  });

  it('supports fixed captures, leaves its input unchanged and never runs time backwards', () => {
    const state = Object.freeze(advanceDetailTransition(advanceDetailTransition(undefined, 1, 100), 2, 100));
    const quarter = Object.freeze(advanceDetailTransition(state, 2, 200));
    expect(advanceDetailTransition(quarter, 2, 190)).toEqual(quarter);
    expect(advanceDetailTransition(quarter, 4, 200, true)).toMatchObject({ from: 4, to: 4, progress: 1, active: false, queued: null });
    expect(quarter.progress).toBe(.25);
    expect(state.progress).toBe(0);
    expect(() => advanceDetailTransition(state, 3 as DetailLevel, 201)).toThrow('Detail level');
    expect(() => advanceDetailTransition(state, 2, NaN)).toThrow('finite');
  });

  it('keeps camera threshold oscillation continuous with at most two visible levels', () => {
    let state = advanceDetailTransition(undefined, 1, 0);
    for (let frame = 1; frame <= 240; frame++) {
      const wanted = ([1, 2, 4, 2, 1, 4] as const)[Math.floor(frame / 7) % 6]!;
      const next = advanceDetailTransition(state, wanted, frame * 16);
      const before = weights(state), after = weights(next);
      expect([...after.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
      expect(after.size).toBeLessThanOrEqual(2);
      for (const level of [1, 2, 4] as const) {
        expect(Math.abs((after.get(level) ?? 0) - (before.get(level) ?? 0))).toBeLessThanOrEqual(.04000001);
      }
      state = next;
    }
  });
});
