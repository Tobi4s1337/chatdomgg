export type BenchMotion = 'rest' | 'walk-stop';
/**
 * Walking in place on the bench: an ordinary walking pace, an easy stop, then standing still. Main's
 * citizen renderer poses the stride and drives the cloth from the actual speed and distance below.
 */
export const WALK_STOP = { speed: 1.2, stopAt: 1.6, ease: .3, loop: 4.6, step: 1 / 30 } as const;
/** Seconds reviewed in captures: mid-stride, slowing, the moment of stopping, settling, still. */
export const WALK_STOP_FRAMES = [1.2, 1.75, 2.0, 2.5, 3.6] as const;

export function walkStopState(at: number): { speed: number; distance: number } {
  const { speed, stopAt, ease } = WALK_STOP;
  if (at <= stopAt) return { speed, distance: speed * at };
  const into = Math.min(at - stopAt, ease);
  return { speed: speed * (1 - into / ease), distance: speed * stopAt + speed * (into - into * into / (2 * ease)) };
}

export function phaseName(at: number): string {
  const stopped = WALK_STOP.stopAt + WALK_STOP.ease;
  if (at < WALK_STOP.stopAt) return 'walking';
  if (at < stopped) return 'slowing';
  if (at < stopped + .4) return 'just stopped';
  return at < stopped + 1.2 ? 'settling' : 'settled';
}
