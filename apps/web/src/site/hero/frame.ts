// The hero's camera and framing, shared by the captured frames and the live land so the two are the same picture.
// The captures are shot at 1920x1080 from the grand land's orbit view (`/-/grand?channel=tobi4s_&view=orbit&yaw=…`)
// and cropped by `scripts/public/site-pictures.mjs`; the live land draws the same 16:9 frame and is placed so its
// crop lands exactly where the picture's does.

/** The land on the front page: tobi4s_'s, the kingdom featured until other streamers consent (PRD decision 4). */
export const HERO_CHANNEL = 'tobi4s_';
/**
 * The hour of the live land. The captures are re-shot at this hour on a real GPU (`scripts/public/hero-gpu.mjs`), so
 * the live land fades in over its own picture.
 */
export const HERO_HOUR = 18.2;
/** The land's clock is held, so it draws only when the camera moves (and rests when the hero is out of view). */
export const HERO_TIME = 0;

/** The captured frames, in the order the page shows them, and the orbit yaw each was shot from (degrees). */
export const HERO_FRAMES = [
  { id: 'hero-a', yaw: 120 },
  { id: 'hero-b', yaw: 90 },
  { id: 'hero-c', yaw: 150 },
] as const;

/** The shot's full frame and the crop the pictures keep (the top rows are empty sky under the header). */
export const SHOT = { width: 1920, height: 1080, cropTop: 72, cropHeight: 1008 } as const;

export interface Rect { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/**
 * Where the full 16:9 shot sits in a box of `width` x `height` when its crop is drawn like the hero picture
 * (`object-fit: cover` with the given vertical `object-position`, horizontally centred).
 */
export function coverFrame(width: number, height: number, positionY = 0.58): Rect {
  const scale = Math.max(width / SHOT.width, height / SHOT.cropHeight);
  const cropWidth = SHOT.width * scale, cropHeight = SHOT.cropHeight * scale;
  const left = (width - cropWidth) / 2;
  const cropTopAt = (height - cropHeight) * positionY;
  return { left, top: cropTopAt - SHOT.cropTop * scale, width: SHOT.width * scale, height: SHOT.height * scale };
}

/**
 * The slow orbit: a pendulum over the island's lit side, `centre ± swing` degrees, `speed` degrees a second at the
 * middle of its swing. It starts from rest and eases up to speed over `ease` seconds, and does so again each time it
 * resumes (after the hero was out of view), so the camera never jerks into motion.
 */
export interface Orbit { readonly centre: number; readonly swing: number; readonly speed: number; readonly ease: number }
export const HERO_ORBIT: Orbit = { centre: 120, swing: 46, speed: 1.1, ease: 7 };

export interface OrbitState { readonly phase: number; readonly moving: number }

/** At rest at `yaw` (clamped into the swing). */
export function startOrbit(yaw: number, orbit: Orbit = HERO_ORBIT): OrbitState {
  return { phase: Math.asin(Math.max(-1, Math.min(1, (yaw - orbit.centre) / orbit.swing))), moving: 0 };
}

/** Holds the phase and starts the ease again (the next steps rise from rest). */
export function restOrbit(state: OrbitState): OrbitState { return { phase: state.phase, moving: 0 }; }

/** One step of `dt` seconds. */
export function stepOrbit(state: OrbitState, dt: number, orbit: Orbit = HERO_ORBIT): OrbitState {
  const step = Math.max(0, Math.min(0.1, dt));
  const moving = state.moving + step;
  const u = orbit.ease > 0 ? Math.min(1, moving / orbit.ease) : 1;
  const ramp = u * u * (3 - 2 * u);
  return { phase: state.phase + (orbit.speed / orbit.swing) * ramp * step, moving };
}

export function orbitYaw(state: OrbitState, orbit: Orbit = HERO_ORBIT): number {
  return orbit.centre + orbit.swing * Math.sin(state.phase);
}

/** The captured frame nearest a yaw (for stepping back from the live land to a picture). */
export function nearestFrame(yaw: number): number {
  let best = 0;
  HERO_FRAMES.forEach((frame, index) => { if (Math.abs(frame.yaw - yaw) < Math.abs(HERO_FRAMES[best]!.yaw - yaw)) best = index; });
  return best;
}
