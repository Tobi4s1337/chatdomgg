import { WALK_BODY } from '@chatdom/shared/realm';

/**
 * Rendered easing of half-metre steps. Presentation only: it reads the predicted feet height after the shared
 * step has run and never feeds anything back into it, so the authoritative body stays exactly where collision
 * put it. Jumps, falls and landings are not steps and pass through untouched.
 *
 * - The camera follows a step over `cameraSeconds` both ways, with its lag bounded to one step, so stairs and
 *   kerbs never jerk the view.
 * - The avatar eases only down a step. The stepped-down body has just swept down through free air, so drawing it
 *   briefly higher can never put it inside a solid. Up a step the avatar is drawn at its real height at once:
 *   drawn any lower its feet would sink into the step it is climbing.
 */
export const STEP_EASE = { bodySeconds: .07, cameraSeconds: .1, cameraLag: 2 * WALK_BODY.stepHeight } as const;

export interface StepEaseHeights {
  /** Rendered feet height for the walker's own avatar. Never below the predicted feet. */
  readonly body: number;
  /** Feet height the player camera should follow; its offset from the feet is within one step. */
  readonly camera: number;
}

export interface StepEase {
  /**
   * Once per rendered frame with the predicted feet height, whether the shared step reported support and the
   * frame's render time in seconds. A grounded-to-grounded change of at most `WALK_BODY.stepHeight` is a step.
   */
  update(y: number, grounded: boolean, dtSeconds: number): StepEaseHeights;
  /** Drops any easing: after a teleport, a reconnect, a recovery placement or a camera takeover. */
  reset(): void;
}

export function createStepEase(): StepEase {
  let lastY = Number.NaN, lastGrounded = false, body = 0, camera = 0;
  return {
    update(y, grounded, dtSeconds) {
      if (!Number.isFinite(y)) return { body: y, camera: y };
      const dy = y - lastY;
      if (grounded && lastGrounded && dy !== 0 && Math.abs(dy) <= WALK_BODY.stepHeight + 1e-6) {
        body = Math.max(0, body - dy);
        camera = Math.max(-STEP_EASE.cameraLag, Math.min(STEP_EASE.cameraLag, camera - dy));
      } else if (!grounded || !lastGrounded || Math.abs(dy) > WALK_BODY.stepHeight + 1e-6) { body = 0; camera = 0; }
      lastY = y; lastGrounded = grounded;
      const t = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
      body *= Math.exp(-t / STEP_EASE.bodySeconds);
      camera *= Math.exp(-t / STEP_EASE.cameraSeconds);
      if (Math.abs(body) < 1e-5) body = 0;
      if (Math.abs(camera) < 1e-5) camera = 0;
      return { body: y + body, camera: y + camera };
    },
    reset() { lastY = Number.NaN; lastGrounded = false; body = 0; camera = 0; },
  };
}
