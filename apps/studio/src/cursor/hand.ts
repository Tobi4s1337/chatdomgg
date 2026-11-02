// The cursor, moved like a hand: each move follows a minimum-jerk profile with a slight overshoot and settle,
// and while resting it breathes with a small tremor. Everything is a pure function of t.
import type { Cursor } from '../types';

export interface CursorKey {
  /** When the cursor arrives at (x, y). */
  t: number;
  x: number;
  y: number;
  /** How long the move into this key takes (default 0.6 s). */
  move?: number;
  shape?: Cursor['shape'];
  /** A click at arrival. */
  click?: boolean;
  hidden?: boolean;
}

const minJerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);

export function cursorAt(keys: readonly CursorKey[], t: number): Cursor {
  if (!keys.length) return { x: 0, y: 0, visible: false, pressed: 0, shape: 'arrow' };
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1]!.t - (keys[i + 1]!.move ?? 0.6) <= t) i++;
  const here = keys[i]!, next = keys[i + 1];
  let x = here.x, y = here.y, shape = here.shape ?? 'arrow';
  // In motion toward the next key?
  if (next) {
    const move = next.move ?? 0.6, begin = next.t - move;
    if (t >= begin) {
      const u = Math.min(1, (t - begin) / move);
      // A hand overshoots a little along the move, then settles back.
      const over = Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.025 * (u > 0.85 ? (1 - u) / 0.15 : 1);
      const m = minJerk(u) + over * (u > 0.6 ? 1 : 0);
      x = here.x + (next.x - here.x) * m;
      y = here.y + (next.y - here.y) * m;
      // A slight arc: hands don't move in straight lines.
      const arc = Math.sin(Math.PI * u) * Math.hypot(next.x - here.x, next.y - here.y) * 0.04;
      const len = Math.hypot(next.x - here.x, next.y - here.y) || 1;
      x += (-(next.y - here.y) / len) * arc;
      y += ((next.x - here.x) / len) * arc;
      if (u > 0.7) shape = next.shape ?? shape;
    }
  }
  // Resting tremor: two slow incommensurate sines, under a pixel.
  x += Math.sin(t * 1.7 + 0.3) * 0.45 + Math.sin(t * 3.1) * 0.25;
  y += Math.sin(t * 1.3 + 1.1) * 0.4 + Math.sin(t * 2.7 + 0.5) * 0.2;
  // A press dips for 0.12 s at a click's arrival.
  let pressed = 0;
  for (const key of keys) if (key.click && t >= key.t && t < key.t + 0.16) pressed = Math.sin(Math.PI * (t - key.t) / 0.16);
  const visible = !(here.hidden ?? false);
  return { x: Math.round(x * 4) / 4, y: Math.round(y * 4) / 4, visible, pressed, shape };
}
