import type { Vec3 } from '@chatdom/shared';
import type { CitizenMotionSample } from '../citizens/types';
import { BEHAVIOUR_TUNING as T } from './tuning';
import type { CitizenOverlay } from './types';

/** Shared timing and head helpers for greetings and chat looks. Pure presentation math. */
export const ease = (n: number): number => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
export const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
export const between = ([low, high]: readonly [number, number], unit: number): number => Math.round(low + (high - low) * unit);
export const NONE: CitizenOverlay = { gesture: 'none', lookYaw: 0, time: 0 };

/** Body-relative bearing to `target`, unclamped. */
export const bearing = (self: CitizenMotionSample, target: Vec3): number =>
  wrap(Math.atan2(target[0] - self.position[0], target[2] - self.position[2]) - self.heading);
/** How far a head may turn: walking heads turn less. */
export const neckLimit = (sample: CitizenMotionSample): number => sample.speed > .05 ? T.look.walkingLimit : T.look.standingLimit;
/** Head yaw, relative to the body, that faces `target`; clamped to a comfortable neck. */
export function relativeYaw(self: CitizenMotionSample, target: Vec3): number {
  const limit = neckLimit(self);
  return Math.max(-limit, Math.min(limit, bearing(self, target)));
}
/** 0 → 1 over [in0, in1], hold, 1 → 0 over [out0, out1]. */
export function envelope(t: number, in0: number, in1: number, out0: number, out1: number): number {
  if (t <= in0 || t >= out1) return 0;
  if (t < in1) return ease((t - in0) / Math.max(1, in1 - in0));
  if (t <= out0) return 1;
  return 1 - ease((t - out0) / Math.max(1, out1 - out0));
}
/** The renderer's own gesture clock inside a finite pose window; outside it, nothing. */
export const gestureAt = (gesture: 'nod' | 'wave', poseAtMs: number, poseEndMs: number, atMs: number): Pick<CitizenOverlay, 'gesture' | 'time'> =>
  atMs >= poseAtMs && atMs < poseEndMs ? { gesture, time: (atMs - poseAtMs) / 1000 + T.gestures[gesture].phaseSeconds } : { gesture: 'none', time: 0 };
