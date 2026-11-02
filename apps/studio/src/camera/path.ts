// Keyframed motion as pure functions of time: the virtual camera over the page, and any eased value.

export interface Key<T> { t: number; v: T; ease?: 'smooth' | 'linear' | 'in' | 'out' | 'hold' }

const curves = {
  smooth: (x: number) => x * x * x * (x * (6 * x - 15) + 10),
  linear: (x: number) => x,
  in: (x: number) => x * x * x,
  out: (x: number) => 1 - (1 - x) ** 3,
  hold: (x: number) => (x < 1 ? 0 : 1),
};

/** The value at t: eased between the surrounding keys by the later key's curve (default smootherstep). */
export function at<T>(keys: readonly Key<T>[], t: number, mix: (a: T, b: T, u: number) => T): T {
  if (!keys.length) throw new Error('no keys');
  if (t <= keys[0]!.t) return keys[0]!.v;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t < b.t) {
      const a = keys[i - 1]!;
      return mix(a.v, b.v, curves[b.ease ?? 'smooth']((t - a.t) / (b.t - a.t)));
    }
  }
  return keys[keys.length - 1]!.v;
}

export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const num = (keys: readonly Key<number>[], t: number) => at(keys, t, lerp);
export const step = <T>(keys: readonly Key<T>[], t: number) => at(keys, t, (a, b, u) => (u < 1 ? a : b));

export interface CameraValue { cx: number; cy: number; zoom: number }
/** Zoom interpolates in log space so a push-in feels like a constant move toward the subject. */
export const camera = (keys: readonly Key<CameraValue>[], t: number): CameraValue =>
  at(keys, t, (a, b, u) => ({ cx: lerp(a.cx, b.cx, u), cy: lerp(a.cy, b.cy, u), zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), u)) }));

export const PAGE_CAMERA: CameraValue = { cx: 960, cy: 540, zoom: 1 };
