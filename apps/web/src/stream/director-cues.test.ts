import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDirector, type DirectorCue, type DirectorCueSource, type Plan } from './director';

const tour: Plan = { beats: [{ shot: 'hero', hold: 8 }, { shot: 'window', hold: 8 }], cut: 'shutter', sky: null, drift: false };
const held: Plan = { beats: [{ shot: 'citizen', hold: Infinity }], cut: null, sky: null, drift: true };
const cue = (id: string, until: number | null = null): DirectorCue => ({ id, priority: 'game', shot: { eye: [1, 2, 3], at: [0, 0, 0] }, until });

function source(initial: DirectorCue | null = null) {
  let receive: (value: DirectorCue | null) => void = () => {};
  const unsubscribe = vi.fn();
  const producer: DirectorCueSource = { subscribe: callback => { receive = callback; callback(initial); return unsubscribe; } };
  return { producer, emit: (value: DirectorCue | null) => receive(value), unsubscribe };
}
function setup() {
  let epoch = 100_000;
  const host = { motive: vi.fn(() => true), apply: vi.fn(), applyPlace: vi.fn(), drawn: vi.fn(() => true),
    setHour: vi.fn(), reducedMotion: vi.fn(() => false), onChange: vi.fn() };
  const director = createDirector(tour, host, () => Date.now(), () => epoch);
  return { director, host, epoch: (value: number) => { epoch = value; } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('holds the game shot over the tour and resumes the underlying camera after withdrawal', () => {
  const { director, host } = setup(), game = source(cue('chess'));
  director.connect(game.producer); director.start();
  expect(director.state.placeCue).toBe('chess');
  expect(host.applyPlace).toHaveBeenLastCalledWith(cue('chess').shot);
  vi.advanceTimersByTime(30_000);
  expect(host.apply).not.toHaveBeenCalled();
  game.emit(null);
  expect(host.applyPlace).toHaveBeenLastCalledWith(null);
  expect(director.state.shot).toBe('hero');
  vi.advanceTimersByTime(8_500);
  expect(host.apply).toHaveBeenCalledWith('window');
  director.dispose();
});

it('uses subscription order for equal priority sources and promotes the next on unsubscribe', () => {
  const { director, host } = setup(), first = source(cue('first')), second = source(cue('second'));
  const disconnect = director.connect(first.producer); director.connect(second.producer); director.start();
  expect(director.state.placeCue).toBe('first');
  second.emit(cue('second-new'));
  expect(director.state.placeCue).toBe('first');
  disconnect();
  expect(first.unsubscribe).toHaveBeenCalledOnce();
  expect(director.state.placeCue).toBe('second-new');
  expect(host.applyPlace).toHaveBeenCalledTimes(2);
  director.dispose();
});

it('expires using epoch time independently of the monotonic tour clock', () => {
  const { director, host, epoch } = setup(), game = source(cue('timed', 101_000));
  director.connect(game.producer); director.start();
  vi.advanceTimersByTime(10_000);
  expect(director.state.placeCue).toBe('timed');
  epoch(101_000); vi.advanceTimersByTime(250);
  expect(director.state.placeCue).toBeUndefined();
  expect(host.applyPlace).toHaveBeenLastCalledWith(null);
  director.dispose();
});

it('stop clears the place and start restores only an unexpired source', () => {
  const { director, host, epoch } = setup(), game = source(cue('timed', 101_000));
  director.connect(game.producer); director.start(); director.stop();
  expect(host.applyPlace).toHaveBeenLastCalledWith(null);
  director.start(); expect(director.state.placeCue).toBe('timed');
  director.stop(); epoch(101_000); director.start();
  expect(director.state.placeCue).toBeUndefined();
  expect(host.applyPlace).toHaveBeenLastCalledWith(null);
  director.dispose();
});

it('detaches a cue snapshot from producer-owned arrays', () => {
  const { director, host } = setup(), game = source();
  const eye = [1, 2, 3] as [number, number, number], at = [0, 0, 0] as [number, number, number];
  director.connect(game.producer); director.start();
  game.emit({ id: 'game', priority: 'game', shot: { eye, at }, until: null });
  const applied = host.applyPlace.mock.calls.at(-1)![0]!;
  eye[0] = 99; at[1] = 77;
  expect(applied).toEqual({ eye: [1, 2, 3], at: [0, 0, 0] });
  director.dispose();
});

it.each([
  { id: '', priority: 'game', shot: cue('a').shot, until: null },
  { ...cue('a'), shot: { eye: [0, 0, 0], at: [0, 0, 0] } },
  { ...cue('a'), until: 100_000 },
] as DirectorCue[])('withdraws a source when it publishes an invalid or expired update %#', invalid => {
  const { director, host } = setup(), game = source(cue('valid'));
  director.connect(game.producer); director.start(); game.emit(invalid);
  expect(director.state.placeCue).toBeUndefined();
  expect(host.applyPlace).toHaveBeenLastCalledWith(null);
  director.dispose();
});

it('fences callbacks after unsubscribe and disposal', () => {
  const { director, host } = setup(), first = source(cue('first')), second = source(cue('second'));
  const disconnect = director.connect(first.producer); director.connect(second.producer); director.start();
  disconnect(); first.emit(cue('late'));
  expect(director.state.placeCue).toBe('second');
  director.dispose();
  const calls = host.applyPlace.mock.calls.length;
  second.emit(cue('later'));
  expect(host.applyPlace).toHaveBeenCalledTimes(calls);
  expect(second.unsubscribe).toHaveBeenCalledOnce();
});

it('cancels a pending shutter cut when a game takes the camera', () => {
  const { director, host } = setup(), game = source();
  director.connect(game.producer); director.start();
  vi.advanceTimersByTime(8_000);
  expect(director.state.curtain).toBe('closing');
  game.emit(cue('game'));
  expect(director.state.curtain).toBe('open');
  vi.advanceTimersByTime(3_000);
  expect(host.apply).not.toHaveBeenCalled();
  expect(director.state.shot).toBe('hero');
  expect(tour.beats[director.state.beat]?.shot).toBe('hero');
  director.dispose();
});

it('replans the base shot while a game remains in control', () => {
  const { director, host } = setup(), game = source(cue('game'));
  director.connect(game.producer); director.start(); director.replan(held);
  expect(director.state.placeCue).toBe('game');
  expect(director.state.shot).toBe('citizen');
  expect(host.apply).toHaveBeenLastCalledWith('citizen');
  game.emit(null);
  expect(director.state.shot).toBe('citizen');
  expect(host.applyPlace).toHaveBeenLastCalledWith(null);
  director.dispose();
});
