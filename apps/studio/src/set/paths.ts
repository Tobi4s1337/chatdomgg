// Camera paths for the set pieces, as data. A key places the camera on a sphere around a target:
// `at` is a named site of the land or a point in land fractions [x, height in metres, z]; `yaw` is the bearing
// in degrees relative to the land's front (the bearing from the centre to the harbour); `pitch` in degrees above
// the horizon; `dist` in fractions of the land's width; `fov` in degrees. Keys are eased with a smooth spline.

export type SiteName = 'centre' | 'castle' | 'town' | 'harbour' | 'summit' | 'fields' | 'mere' | 'headland';
export interface PathKey { t: number; at: SiteName | readonly [number, number, number]; yaw: number; pitch: number; dist: number; fov: number; lift?: number }
/** `clouds: false` hides the cloud deck for a path that climbs through it. */
export interface CameraPath { id: string; duration: number; hour: number; keys: readonly PathKey[]; clouds?: boolean }

export const PATHS: Record<string, CameraPath> = {
  // S04: golden hour, low over the sea toward the harbour, then rising and turning as the peaks, falls and the
  // mere open up behind the shore.
  'island-golden': {
    id: 'island-golden', duration: 7, hour: 18.0,
    keys: [
      { t: 0, at: 'harbour', yaw: -38, pitch: 6, dist: 0.30, fov: 40, lift: 10 },
      { t: 3.5, at: 'centre', yaw: -18, pitch: 11, dist: 0.62, fov: 40, lift: 30 },
      { t: 7, at: 'centre', yaw: 4, pitch: 17, dist: 0.86, fov: 40, lift: 30 },
    ],
  },
  // S19: the kingdom falls away: the camera climbs high above the island toward a map-like view.
  'island-rise': {
    id: 'island-rise', duration: 5, hour: 20.4, clouds: false,
    keys: [
      { t: 0, at: 'centre', yaw: 10, pitch: 22, dist: 0.8, fov: 40, lift: 30 },
      { t: 5, at: 'centre', yaw: 24, pitch: 72, dist: 1.9, fov: 36, lift: 0 },
    ],
  },
  // S22 alternative and S21 bed: the island at night, a slow drift.
  'island-night': {
    id: 'island-night', duration: 6, hour: 21.2,
    keys: [
      { t: 0, at: 'centre', yaw: -8, pitch: 14, dist: 0.9, fov: 40, lift: 30 },
      { t: 6, at: 'centre', yaw: 2, pitch: 15, dist: 0.84, fov: 40, lift: 30 },
    ],
  },
};

const smooth = (x: number) => x * x * (3 - 2 * x);

/** The pose parameters at time t: piecewise smoothstep between keys, so moves ease in and out of each key. */
export function samplePath(path: CameraPath, t: number): { a: PathKey; b: PathKey; u: number } {
  const keys = path.keys;
  if (t <= keys[0]!.t) return { a: keys[0]!, b: keys[0]!, u: 0 };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]!, b = keys[i]!;
    if (t <= b.t) {
      // Ease only at the ends of the whole path; inner keys pass through at speed.
      const raw = (t - a.t) / (b.t - a.t);
      const first = i === 1, last = i === keys.length - 1;
      const u = first && last ? smooth(raw) : first ? raw < 1 ? 2 * smooth(raw / 2) : 1 : last ? 2 * smooth(0.5 + raw / 2) - 1 : raw;
      return { a, b, u };
    }
  }
  const end = keys[keys.length - 1]!;
  return { a: end, b: end, u: 0 };
}
