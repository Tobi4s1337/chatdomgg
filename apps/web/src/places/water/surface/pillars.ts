import type { Vec3 } from '@chatdom/shared';
import type { WaterAt } from './coverage';

/**
 * Light the caller actually has: lit windows (`createWindowLights().getSources()`), the castle beacon and place
 * lamps resolved through the people-light helper. Nothing here invents a source or a strength.
 */
export type WaterLightKind = 'window' | 'beacon' | 'lamp';
export interface WaterLightSource {
  readonly position: Vec3;
  /** 0..1 as the caller resolved it; zero draws nothing. */
  readonly strength: number;
  readonly kind: WaterLightKind;
  /** Facing of a one-sided emitter such as a pane; a window facing away from the water never reflects in it. */
  readonly normal?: Vec3;
  /** Emitter width in metres; defaults by kind. */
  readonly size?: number;
}

/** Most analytic pillars drawn per frame. Over the cap the weakest projected contributions are dropped and counted. */
export const PILLAR_CAP = 24;
const DEFAULT_SIZE: Record<WaterLightKind, number> = { window: 0.75, lamp: 0.45, beacon: 2.4 };
const KIND_WEIGHT: Record<WaterLightKind, number> = { window: 1, lamp: 1.2, beacon: 1 };
/** Mirrored points this far outside the view still feed pillars that streak into it. */
const VIEW_MARGIN: readonly [number, number] = [1.12, 1.35];

export interface PillarView {
  readonly eye: Vec3;
  /** Column-major projection × view, as three.js stores it. */
  readonly viewProjection: ArrayLike<number>;
}

export interface Pillar {
  readonly source: number;
  readonly kind: WaterLightKind;
  readonly position: Vec3;
  readonly strength: number;
  /** Where the eye sees the light reflected, on the water that reflects it. */
  readonly at: Vec3;
  readonly level: number;
  /** Angular half width of the emitter seen from its reflection point (radians). */
  readonly halfAngle: number;
  readonly score: number;
}

export interface PillarSelection {
  readonly pillars: readonly Pillar[];
  readonly considered: number;
  readonly rejected: { readonly dark: number; readonly below: number; readonly offView: number; readonly dry: number; readonly facing: number };
  /** Valid reflections beyond the cap, dropped by lowest contribution. */
  readonly dropped: number;
}

type WaterQuery = (x: number, z: number) => WaterAt | null;

function project(m: ArrayLike<number>, p: Vec3): [number, number, number] {
  const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
  const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
  return [x / w, y / w, w];
}

/** Where the eye's ray to the mirror image of `source` in the plane y = `level` meets that plane. */
export function reflectionPoint(eye: Vec3, source: Vec3, level: number): Vec3 | null {
  const mirrorY = 2 * level - source[1];
  if (!(eye[1] > level) || !(source[1] > level)) return null;
  const t = (eye[1] - level) / (eye[1] - mirrorY);
  return [eye[0] + (source[0] - eye[0]) * t, level, eye[2] + (source[2] - eye[2]) * t];
}

/**
 * Chooses the bounded analytic pillars for this frame: only lit sources whose mirror image lies in (or streaks into)
 * the view, whose reflection point is real supplied water, and whose emitter faces that point. The beacon is always
 * retained when it reflects; the rest are ranked by strength over distance, ties by source order.
 */
export function selectPillars(
  sources: readonly WaterLightSource[], view: PillarView, level: number, water: WaterQuery, cap = PILLAR_CAP,
): PillarSelection {
  if (!Number.isInteger(cap) || cap < 0) throw new RangeError('Pillar cap must be a non-negative integer');
  const rejected = { dark: 0, below: 0, offView: 0, dry: 0, facing: 0 };
  const valid: Pillar[] = [];
  sources.forEach((source, index) => {
    const { position, strength, kind } = source;
    if (!(strength > 0) || !Number.isFinite(strength) || !position.every(Number.isFinite)) { rejected.dark++; return; }
    // The plane this light reflects in: the dominant plane first, then the water actually found under that point.
    let plane = level, at = reflectionPoint(view.eye, position, plane), here = at && water(at[0], at[2]);
    if (here && Math.abs(here.level - plane) > 0.02) {
      plane = here.level; at = reflectionPoint(view.eye, position, plane); here = at && water(at[0], at[2]);
    }
    if (!at) { rejected.below++; return; }
    const mirror: Vec3 = [position[0], 2 * plane - position[1], position[2]];
    const [nx, ny, w] = project(view.viewProjection, mirror);
    if (!(w > 0) || Math.abs(nx) > VIEW_MARGIN[0] || Math.abs(ny) > VIEW_MARGIN[1]) { rejected.offView++; return; }
    if (!here || Math.abs(here.level - plane) > 0.02) { rejected.dry++; return; }
    const toward: Vec3 = [at[0] - position[0], at[1] - position[1], at[2] - position[2]];
    if (source.normal && source.normal[0] * toward[0] + source.normal[1] * toward[1] + source.normal[2] * toward[2] <= 0) { rejected.facing++; return; }
    const reach = Math.hypot(...toward), eyeDistance = Math.hypot(at[0] - view.eye[0], at[1] - view.eye[1], at[2] - view.eye[2]);
    const size = source.size ?? DEFAULT_SIZE[kind];
    const score = kind === 'beacon' ? Infinity : (Math.min(1, strength) * KIND_WEIGHT[kind]) / (1 + eyeDistance / 25);
    valid.push({ source: index, kind, position, strength: Math.min(1, strength), at, level: plane, halfAngle: Math.max(0.0025, size / 2 / reach), score });
  });
  valid.sort((a, b) => (b.score - a.score) || (a.source - b.source));
  const pillars = valid.slice(0, cap);
  return { pillars, considered: sources.length, rejected, dropped: valid.length - pillars.length };
}
