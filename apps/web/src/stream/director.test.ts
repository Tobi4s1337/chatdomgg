import { afterEach, expect, it, vi } from 'vitest';
import { createDirector, planNight, type DirectorState } from './director';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['calm', 'show'] as const)('leaves the %s opening to the scene instead of covering or replacing its arrival lens', mood => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout });
  const apply = vi.fn(), frames: DirectorState[] = [];
  const director = createDirector(planNight({ layout: 'stage', mood, seam: 'starting', camera: 'hero', hour: 19.5 }), {
    motive: () => true, apply, drawn: () => true, setHour: vi.fn(), reducedMotion: () => false,
    onChange: frame => frames.push(frame),
  }, () => Date.now());
  director.start();
  vi.advanceTimersByTime(40_000); // Wave, descent, homecoming and return to the town.
  expect(apply).not.toHaveBeenCalled();
  expect(frames.every(frame => frame.curtain === 'open')).toBe(true);
  expect(director.state.curtain).toBe('open');
  director.dispose();
});

it.each([[true, ['window', 'pier', 'citizen']], [false, ['window', 'citizen']]] as const)('tours the pier only where the kingdom has one (pier %s)', (hasPier, cuts) => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout });
  const apply = vi.fn();
  const director = createDirector(planNight({ layout: 'stage', mood: 'show', seam: null, camera: 'hero', hour: 19.5 }), {
    motive: shot => shot !== 'pier' || hasPier, apply, drawn: () => true, setHour: vi.fn(), reducedMotion: () => true,
    onChange: () => {},
  }, () => Date.now());
  director.start();
  vi.advanceTimersByTime(16_000 + 10_000 + 12_000 + 1_000);
  expect(apply.mock.calls.map(call => call[0]).slice(0, cuts.length)).toEqual(cuts);
  director.dispose();
});
