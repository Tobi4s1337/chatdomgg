import type { WalkerSupport } from './support';

/**
 * - `clamp`: the most the drawn body may differ from its physical feet. Physics rounds terrain to half-metre cells
 *   and stands the body on the highest column under its footprint, so on walkable slopes the drawn surface is
 *   mostly within a quarter metre of it; a larger gap is clamped, the body drawn as near the surface as allowed.
 * - `trust`: a larger gap than this is not the surface under these feet (a cliff edge, a sample from another
 *   tile); the offset fades out instead.
 * - `seconds`: how quickly the offset fades in on arriving on terrain and out on leaving it (a stair, a floor,
 *   a jump), so neither change pops.
 */
export const GROUND_OFFSET = { clamp: .3, trust: .75, seconds: .1 } as const;

export interface GroundOffsetSample {
  /** The feet height the body would otherwise be drawn at (after any step easing). */
  readonly y: number;
  /** Drawn ground under the body's centre, or null where nothing drawn answers. */
  readonly drawnY: number | null;
  /** What the physical feet rest on. Only terrain lets the drawn terrain decide where the body is drawn. */
  readonly support: WalkerSupport;
  /** Known only for the walker's own predicted body; a jump or fall never follows the ground. */
  readonly grounded?: boolean | undefined;
  /** Seated, kneeling or otherwise posed at an authored rest: drawn exactly where the pose says. */
  readonly posed?: boolean | undefined;
  /** Render frame seconds. */
  readonly dt: number;
}

export interface GroundOffset {
  /**
   * Metres to add to this walker's drawn body height this frame, and nothing else: never to the camera, the
   * collision body, prediction or the authority's position.
   */
  update(sample: GroundOffsetSample): number;
  /** After a teleport, a relocation, a reconnect or a new collision revision. The next sample starts fresh. */
  reset(): void;
  readonly value: number;
  /** This frame's body is drawn exactly on the drawn ground (on terrain, fully faded in, inside the clamp). */
  readonly following: boolean;
}

/** True when the drawn terrain may decide where these feet are drawn. */
export function followsDrawnGround(sample: Pick<GroundOffsetSample, 'y' | 'drawnY' | 'support' | 'grounded' | 'posed'>): boolean {
  return sample.support === 'terrain' && sample.grounded !== false && !sample.posed && sample.drawnY !== null
    && Number.isFinite(sample.drawnY) && Number.isFinite(sample.y) && Math.abs(sample.drawnY - sample.y) <= GROUND_OFFSET.trust;
}

/**
 * One walker's visual ground offset. While the feet stand on terrain the body is drawn exactly on the drawn surface
 * (the offset is `drawnY - y` every frame, so walking a slope or over a half-metre physics step never bobs: the drawn
 * surface is continuous), clamped to `GROUND_OFFSET.clamp`. Arriving on or leaving terrain fades a weight in or out over `GROUND_OFFSET.seconds`,
 * holding the last trusted gap while it fades, so stepping onto a stair, a floor or into a jump never pops.
 */
export function createGroundOffset(): GroundOffset {
  let weight = 0, held = 0, value = 0, fresh = true, following = false;
  return {
    get value() { return value; },
    get following() { return following; },
    update(sample) {
      const dt = Number.isFinite(sample.dt) && sample.dt > 0 ? Math.min(sample.dt, .25) : 0;
      const follows = followsDrawnGround(sample);
      const gap = follows ? sample.drawnY! - sample.y : 0;
      if (follows) held = Math.min(GROUND_OFFSET.clamp, Math.max(-GROUND_OFFSET.clamp, gap));
      // Arriving already standing on terrain: no one has seen the body yet, so there is nothing to fade from.
      if (fresh) weight = follows ? 1 : 0;
      else weight += ((follows ? 1 : 0) - weight) * (1 - Math.exp(-dt / GROUND_OFFSET.seconds));
      if (weight < 1e-4) { weight = 0; held = follows ? held : 0; }
      if (weight > 1 - 1e-4) weight = 1;
      fresh = false;
      following = follows && weight === 1 && Math.abs(gap) <= GROUND_OFFSET.clamp;
      value = weight * held;
      return value;
    },
    reset() { weight = 0; held = 0; value = 0; fresh = true; following = false; },
  };
}
