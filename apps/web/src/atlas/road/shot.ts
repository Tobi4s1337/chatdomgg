import { DISTANCE_SCALE, type Viewport } from '../map/camera';
import type { CameraState } from '../map/motion';
import { roadBounds, sampleRoad, type RoadPath } from './geometry';

/**
 * The camera of a raid's journey across the map (Atlas.md §7.5–7.6): out of the source's drawing as the kingdom
 * recedes, close on the column as it leaves, pulled back so both holdings and the land between them read while it
 * rides, close again as it reaches the destination, and into that drawing as it wakes. A pure function of the
 * journey's progress, so a seek, a reload or a capture lands on exactly the same frame.
 */

/** Close enough that holdings are drawn as stamps with their names and the column's torches read. */
export const NEAR_SCALE = DISTANCE_SCALE.kingdom * 1.2;

export interface RoadShotInput {
  /** 0…1: the rise out of the source kingdom into its drawing. 1 once the journey is under way. */
  rise: number;
  /** 0…1: the column's banner-bearer along the road. */
  travel: number;
  /** 0…1: the destination's drawing waking into its world. 0 until the column has arrived. */
  wake: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The scale that frames the whole road with room for the holdings' names and the chrome around the map. */
export function farScale(path: RoadPath, view: Viewport): number {
  const box = roadBounds(path);
  const w = Math.max(1, box.maxX - box.minX), h = Math.max(1, box.maxY - box.minY);
  const fit = Math.min((view.width * 0.62) / w, (view.height * 0.56) / h);
  // Never closer than the near shot (a short road simply stays close) and never farther than continent distance.
  return Math.min(NEAR_SCALE, Math.max(DISTANCE_SCALE.continent * 0.9, fit));
}

/** How far the camera has pulled back from the column at `travel` (0 close, 1 framing the whole road). */
export function pullBack(travel: number): number {
  return smoothstep(0.02, 0.34, travel) * (1 - smoothstep(0.64, 0.97, travel));
}

export function roadShot(path: RoadPath, input: RoadShotInput, view: Viewport): CameraState {
  const near = NEAR_SCALE;
  const from = sampleRoad(path, 0), to = sampleRoad(path, 1);
  if (input.wake > 0) {
    // Into the destination's drawing as its colour floods out.
    const t = input.wake * input.wake;
    return { x: to.x, y: to.y, scale: near * lerp(1, 2.6, t) };
  }
  if (input.rise < 1) {
    // Out of the source: the drawing of the kingdom first fills the screen, then gives way to its land.
    const t = smoothstep(0, 1, input.rise);
    return { x: from.x, y: from.y, scale: near * lerp(2.4, 1, t) };
  }
  const head = sampleRoad(path, clamp01(input.travel));
  const z = pullBack(input.travel);
  const box = roadBounds(path);
  const middle = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const far = farScale(path, view);
  const scale = Math.exp(lerp(Math.log(near), Math.log(far), z));
  // Pulled back, the camera holds the whole road; close, it rides with the column.
  const hold = z ** 1.4;
  return { x: lerp(head.x, middle.x, hold), y: lerp(head.y, middle.y, hold), scale };
}
