import { describe, expect, it, vi } from 'vitest';
import { createGestureState, GESTURE_DURATION } from './index';

describe('gesture state', () => {
  it('ends timed gestures once, and publishes their end', () => {
    const send = vi.fn(); const state = createGestureState(send);
    state.play('wave', 100);
    expect(state.sample(100 + GESTURE_DURATION.wave - 1, false)).toBe('wave');
    expect(state.sample(100 + GESTURE_DURATION.wave, false)).toBe('none');
    expect(state.sample(9000, false)).toBe('none');
    expect(send.mock.calls).toEqual([['wave'], ['none']]);
  });
  it('cancels sit and dance on movement, while allowing a walking wave', () => {
    const send = vi.fn(); const state = createGestureState(send);
    state.play('sit', 0); expect(state.sample(100000, false)).toBe('sit');
    expect(state.sample(100001, true)).toBe('none');
    state.play('dance', 100002); expect(state.sample(100003, true)).toBe('none');
    state.play('wave', 100004); expect(state.sample(100005, true)).toBe('wave');
    state.dispose(); state.play('bow', 100006);
    expect(state.sample(100007, false)).toBe('none');
    expect(send.mock.calls).toEqual([['sit'], ['none'], ['dance'], ['none'], ['wave'], ['none']]);
  });
  it('rejects invalid clocks and clears a gesture if the sampling clock fails', () => {
    const send = vi.fn(); const state = createGestureState(send);
    state.play('wave', NaN); state.play('dance', Infinity); state.play('bow', Number.MAX_VALUE);
    expect(send).not.toHaveBeenCalled();
    state.play('wave', 1); expect(state.sample(NaN, false)).toBe('none');
    expect(send.mock.calls).toEqual([['wave'], ['none']]);
  });
  it('lets a seated citizen stand by selecting sit again', () => {
    const send = vi.fn(); const state = createGestureState(send);
    state.play('sit', 0); state.play('sit', 1);
    expect(state.sample(2, false)).toBe('none');
    expect(send.mock.calls).toEqual([['sit'], ['none']]);
  });
});
