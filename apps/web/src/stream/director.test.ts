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

it('tours the grand land\'s island and vista only where the scene offers them', () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval, clearInterval, setTimeout, clearTimeout });
  const plan = planNight({ layout: 'stage', mood: 'show', seam: null, camera: 'hero', hour: 19.5 });
  expect(plan.beats.map(beat => beat.shot)).toEqual(['hero', 'window', 'citizen', 'vista', 'island']);
  for (const grand of [true, false]) {
    const applied: string[] = [];
    const director = createDirector(plan, {
      motive: shot => shot === 'island' || shot === 'vista' ? grand : true, apply: shot => applied.push(shot), drawn: () => true,
      setHour: vi.fn(), reducedMotion: () => true, onChange: () => {},
    }, () => Date.now());
    director.start();
    vi.advanceTimersByTime(120_000);
    expect(applied.includes('vista') && applied.includes('island')).toBe(grand);
    director.dispose();
  }
});
